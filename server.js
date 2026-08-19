/**
 * server.js
 * ---------
 * Express web server that exposes the Webflow tracker logic as a REST API
 * and serves the local dashboard frontend.
 *
 * API routes:
 *   POST /api/sites          { token }          → list all sites for the token
 *   POST /api/report         { token, siteId }  → full change report for a site
 */

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const dotenv = require("dotenv");
dotenv.config();

import { getSites, getSite, getAllPages, getPage, getPageDom } from "./src/webflowClient.js";
import { buildReport } from "./src/report.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Helper ───────────────────────────────────────────────────────────────────
/**
 * Resolve the API token: prefer request body, fall back to .env.
 */
function resolveToken(bodyToken) {
  return bodyToken || process.env.WEBFLOW_API_TOKEN || null;
}

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/sites
 * Body: { token?: string }
 *
 * Returns the list of all Webflow sites accessible with the token.
 * If no token is provided in the body, falls back to WEBFLOW_API_TOKEN in .env.
 */
app.post("/api/sites", async (req, res) => {
  const token = resolveToken(req.body?.token);

  if (!token) {
    return res.status(400).json({
      error: "No API token provided. Pass { token } in the request body or set WEBFLOW_API_TOKEN in .env.",
    });
  }

  try {
    const sites = await getSites(token);
    // Also tell the client whether the env token is pre-configured
    res.json({
      sites,
      tokenSource: req.body?.token ? "user" : "env",
      envSiteId: process.env.WEBFLOW_SITE_ID || null,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/report
 * Body: { token?: string, siteId: string }
 *
 * Runs the full change report for a site and returns structured JSON.
 */
app.post("/api/report", async (req, res) => {
  const token = resolveToken(req.body?.token);
  const siteId = req.body?.siteId || process.env.WEBFLOW_SITE_ID;

  if (!token) {
    return res.status(400).json({ error: "No API token provided." });
  }
  if (!siteId) {
    return res.status(400).json({ error: "No site ID provided." });
  }

  try {
    const [site, pages] = await Promise.all([
      getSite(siteId, token),
      getAllPages(siteId, token),
    ]);

    const { report } = buildReport(site, pages);

    // Augment the report with extra metadata the dashboard can display
    report.totalPages = pages.filter((p) => !p.archived).length;
    report.archivedPages = pages.filter((p) => p.archived).length;
    report.cleanPages =
      report.totalPages -
      report.pendingChanges.length -
      report.draftPages.length;

    res.json(report);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/page-compare
 * Body: { token?, siteId, pageId }
 *
 * The real "before vs after" endpoint.
 *   - "Before" = content extracted from the LIVE published HTML page
 *   - "After"  = current state returned by the Webflow API (unpublished edits)
 *
 * Tracked fields: SEO title, SEO description, OG title, OG description, page title.
 * Returns a `changes` array with { label, before, after, changed } for each field.
 */
app.post("/api/page-compare", async (req, res) => {
  const token  = resolveToken(req.body?.token);
  const siteId = req.body?.siteId || process.env.WEBFLOW_SITE_ID;
  const pageId = req.body?.pageId;

  if (!token)  return res.status(400).json({ error: "No API token provided." });
  if (!siteId) return res.status(400).json({ error: "No site ID provided." });
  if (!pageId) return res.status(400).json({ error: "No page ID provided." });

  try {
    const [page, site] = await Promise.all([
      getPage(pageId, token),
      getSite(siteId, token),
    ]);

    // Build live (published) URL
    const customDomains = site.customDomains ?? [];
    const baseUrl = customDomains.length > 0
      ? `https://${customDomains[0].url}`
      : `https://${site.shortName}.webflow.io`;
    const liveUrl = `${baseUrl.replace(/\/$/, "")}${page.publishedPath ?? "/" + page.slug}`;

    let liveHtml = "";
    let liveFetchOk = false;
    try {
      const htmlRes = await fetch(liveUrl, {
        headers: { "User-Agent": "WebflowTracker/1.0 (change-detector)" },
        signal: AbortSignal.timeout(8000),
      });
      if (htmlRes.ok) {
        liveHtml = await htmlRes.text();
        liveFetchOk = true;
      }
    } catch { /* site offline / CORS / timeout — handled gracefully */ }

    // Helpers to extract content from live HTML
    const extractMeta = (name) => {
      const patterns = [
        new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']*?)["']`, "i"),
        new RegExp(`<meta[^>]+content=["']([^"']*?)["'][^>]+name=["']${name}["']`, "i"),
      ];
      for (const re of patterns) {
        const m = liveHtml.match(re);
        if (m) return decodeHtmlEntities(m[1]);
      }
      return null;
    };
    const extractOg = (prop) => {
      const patterns = [
        new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']*?)["']`, "i"),
        new RegExp(`<meta[^>]+content=["']([^"']*?)["'][^>]+property=["']${prop}["']`, "i"),
      ];
      for (const re of patterns) {
        const m = liveHtml.match(re);
        if (m) return decodeHtmlEntities(m[1]);
      }
      return null;
    };
    const extractTitle = () => {
      const m = liveHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      return m ? decodeHtmlEntities(m[1].trim()) : null;
    };

    // Clean site title suffix from live <title> tag for Page Title comparison
    const rawLiveTitle = extractTitle();
    let baseLivePageTitle = page.title;
    if (rawLiveTitle) {
      if (rawLiveTitle.toLowerCase().startsWith(page.title.toLowerCase())) {
        baseLivePageTitle = page.title;
      } else {
        baseLivePageTitle = rawLiveTitle.split(/\s+[-|–—]\s+/)[0].trim();
      }
    }

    const beforeSeoTitle = extractMeta("title") || rawLiveTitle;
    const beforeOgTitle  = extractOg("og:title") || beforeSeoTitle;
    const beforeSeoDesc  = extractMeta("description");
    const beforeOgDesc   = extractOg("og:description") || beforeSeoDesc;

    const before = liveFetchOk ? {
      pageTitle:      baseLivePageTitle,
      seoTitle:       beforeSeoTitle,
      seoDescription: beforeSeoDesc,
      ogTitle:        beforeOgTitle,
      ogDescription:  beforeOgDesc,
    } : null;

    const currentSeoTitle = page.seo?.title ?? null;
    const currentSeoDesc  = page.seo?.description ?? null;
    const currentOgTitle  = page.openGraph?.titleCopied
      ? currentSeoTitle
      : (page.openGraph?.title ?? null);
    const currentOgDesc   = page.openGraph?.descriptionCopied
      ? currentSeoDesc
      : (page.openGraph?.description ?? null);

    const after = {
      pageTitle:      page.title ?? null,
      seoTitle:       currentSeoTitle,
      seoDescription: currentSeoDesc,
      ogTitle:        currentOgTitle,
      ogDescription:  currentOgDesc,
    };

    const fieldDefs = [
      { key: "seoTitle",       label: "SEO Title",       icon: "🔍" },
      { key: "seoDescription", label: "SEO Description", icon: "📝" },
      { key: "ogTitle",        label: "OG Title",        icon: "🌐" },
      { key: "ogDescription",  label: "OG Description",  icon: "🌐" },
      { key: "pageTitle",      label: "Page Title",      icon: "📄" },
    ];

    const changes = fieldDefs.map(({ key, label, icon }) => ({
      key,
      label,
      icon,
      before: before ? (before[key] ?? null) : null,
      after:  after[key] ?? null,
      changed: before ? (before[key] ?? "") !== (after[key] ?? "") : null,
    }));

    const liveContent = liveFetchOk ? extractLiveContent(liveHtml) : null;

    let currentContent = null;
    let domApiAvailable = false;
    const domData = await getPageDom(pageId, token, page.localeId);
    if (domData && (domData.nodes ?? domData.fields ?? domData.dom)) {
      const nodes = domData.nodes ?? domData.fields ?? domData.dom ?? [];
      currentContent = extractDomContent(nodes);
      domApiAvailable = true;
    }

    res.json({
      page,
      site: { id: site.id, displayName: site.displayName, lastPublished: site.lastPublished },
      liveUrl,
      liveFetchOk,
      changes,
      liveContent,
      currentContent,
      domApiAvailable,
      generatedAt: new Date().toISOString(),
    });

  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function extractLiveContent(html) {
  let clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<div[^>]*class=["'][^"']*w-commerce-[^"']*["'][\s\S]*?<\/div>/gi, "")
    .replace(/<div[^>]*class=["'][^"']*(?:footer|cart|nav|menu)[^"']*["'][\s\S]*?<\/div>/gi, "");

  const headings = [];
  const hRe = /<(h[1-4])[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = hRe.exec(clean)) !== null) {
    const text = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (text && text.length < 300) headings.push({ level: m[1].toUpperCase(), text: decodeHtmlEntities(text) });
  }

  const paragraphs = [];
  const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  while ((m = pRe.exec(clean)) !== null && paragraphs.length < 8) {
    const text = m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (text && text.length > 20) paragraphs.push(decodeHtmlEntities(text.substring(0, 400)));
  }

  const images = [];
  const imgRe = /<img([^>]+)>/gi;
  while ((m = imgRe.exec(clean)) !== null && images.length < 8) {
    const attrs = m[1];
    const srcM = attrs.match(/src=["']([^"']+)["']/i);
    const altM = attrs.match(/alt=["']([^"']*?)["']/i);
    if (srcM && !srcM[1].startsWith("data:") && !srcM[1].includes("pixel")) {
      images.push({ src: srcM[1], alt: altM ? decodeHtmlEntities(altM[1]) : "" });
    }
  }

  const ctas = [];
  const btnRe = /<(?:button|a)[^>]*>([\s\S]*?)<\/(?:button|a)>/gi;
  while ((m = btnRe.exec(clean)) !== null && ctas.length < 6) {
    const text = m[1].replace(/<[^>]+>/g, "").trim();
    if (text && text.length > 2 && text.length < 80) ctas.push(decodeHtmlEntities(text));
  }

  return { headings, paragraphs, images, ctas };
}

function extractDomContent(nodes) {
  const result = { headings: [], paragraphs: [], images: [], ctas: [] };
  if (!Array.isArray(nodes)) return result;

  for (const node of nodes) {
    if (node.type === "text" && node.text) {
      const html = node.text.html || "";
      const rawText = (node.text.text || "").trim();

      const hMatch = html.match(/<(h[1-4])[^>]*>([\s\S]*?)<\/\1>/i);
      if (hMatch) {
        const level = hMatch[1].toUpperCase();
        const text = decodeHtmlEntities(hMatch[2].replace(/<[^>]+>/g, "").trim() || rawText);
        if (text) result.headings.push({ level, text });
      } else if (html.match(/<p[^>]*>/i) || (rawText && rawText.length > 25 && !html.match(/<label|<button|<a/i))) {
        const text = decodeHtmlEntities(rawText || html.replace(/<[^>]+>/g, "").trim());
        if (text && text.length > 15 && !text.toLowerCase().includes("no items found")) {
          result.paragraphs.push(text);
        }
      }
    } else if (node.type === "image" && node.image) {
      result.images.push({
        src: node.image.assetId ? `https://assets-global.website-files.com/${node.image.assetId}` : "",
        alt: node.image.alt === "__wf_reserved_inherit" ? "" : (node.image.alt || "")
      });
    } else if (node.type === "component-instance" && Array.isArray(node.propertyOverrides)) {
      for (const override of node.propertyOverrides) {
        if (override.text && override.text.text) {
          const txt = override.text.text.trim();
          if (txt && override.label && override.label.toLowerCase().includes("heading")) {
            result.headings.push({ level: "H2", text: txt });
          } else if (txt && txt.length > 15) {
            result.paragraphs.push(txt);
          }
        }
      }
    }
  }

  return result;
}


function collectTextFromNode(node) {
  if (node.type === "text" || node.nodeType === "text") return (node.text ?? node.data ?? "").trim();
  const children = node.children ?? node.nodes ?? node.childNodes ?? [];
  return children.map(collectTextFromNode).join(" ").replace(/\s+/g, " ").trim();
}

/**
 * GET /api/env-token
 * Tells the frontend if a token is pre-configured in .env (without exposing it).
 */
app.get("/api/env-token", (req, res) => {
  res.json({
    hasEnvToken: !!process.env.WEBFLOW_API_TOKEN,
    hasEnvSiteId: !!process.env.WEBFLOW_SITE_ID,
    envSiteId: process.env.WEBFLOW_SITE_ID || null,
  });
});


// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🌐  Webflow Dashboard running at http://localhost:${PORT}\n`);
});
