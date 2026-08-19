/**
 * index.js
 * --------
 * Entry point for the Webflow Change Tracker CLI.
 *
 * Flow:
 *   1. Load environment variables from .env
 *   2. Validate required env vars (WEBFLOW_API_TOKEN, WEBFLOW_SITE_ID)
 *   3. Fetch site metadata + all pages from the Webflow API
 *   4. Build the structured report + console summary
 *   5. Print the summary to stdout
 *   6. Write report.json to the project root
 */

import { createRequire } from "module";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";

// Load .env before anything else so env vars are available throughout.
// `dotenv` is a CommonJS package; we use createRequire for ESM compatibility.
const require = createRequire(import.meta.url);
const dotenv = require("dotenv");
dotenv.config();

import { getSite, getAllPages, getPage, getPageDom } from "./src/webflowClient.js";
import { buildReport, formatDate } from "./src/report.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPORT_PATH = path.join(__dirname, "report.json");

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------

function validateEnv() {
  const missing = [];

  if (!process.env.WEBFLOW_API_TOKEN) missing.push("WEBFLOW_API_TOKEN");
  if (!process.env.WEBFLOW_SITE_ID) missing.push("WEBFLOW_SITE_ID");

  if (missing.length > 0) {
    console.error(
      "\n❌  Missing required environment variables:\n" +
        missing.map((v) => `     • ${v}`).join("\n") +
        "\n\n" +
        "  Create a .env file in the project root with the following:\n\n" +
        "    WEBFLOW_API_TOKEN=your_api_token_here\n" +
        "    WEBFLOW_SITE_ID=your_site_id_here\n\n" +
        "  See README.md for details.\n"
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Inside change extraction helpers for CLI
// ---------------------------------------------------------------------------

function normStr(str) {
  return String(str ?? '').replace(/\s+/g, ' ').trim();
}

function decodeHtml(str) {
  return (str ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function extractHeadingsFromLiveHtml(html) {
  let clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<div[^>]*class=["'][^"']*(?:footer|cart|nav|menu)[^"']*["'][\s\S]*?<\/div>/gi, "");

  const headings = [];
  const hRe = /<(h[1-4])[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = hRe.exec(clean)) !== null) {
    const text = normStr(decodeHtml(m[2].replace(/<[^>]+>/g, "")));
    if (text && text.length < 300) headings.push({ level: m[1].toUpperCase(), text });
  }
  return headings;
}

function extractHeadingsFromDomNodes(nodes) {
  const headings = [];
  if (!Array.isArray(nodes)) return headings;
  for (const node of nodes) {
    if (node.type === "text" && node.text) {
      const html = node.text.html || "";
      const rawText = normStr(node.text.text);
      const hMatch = html.match(/<(h[1-4])[^>]*>([\s\S]*?)<\/\1>/i);
      if (hMatch) {
        const text = normStr(decodeHtml(hMatch[2].replace(/<[^>]+>/g, "") || rawText));
        if (text) headings.push({ level: hMatch[1].toUpperCase(), text });
      }
    }
  }
  return headings;
}

async function fetchPageInsights(page, site, token) {
  const insights = [];
  try {
    const fullPage = await getPage(page.id, token);
    const customDomains = site.customDomains ?? [];
    const baseUrl = customDomains.length > 0
      ? `https://${customDomains[0].url}`
      : `https://${site.shortName}.webflow.io`;
    const liveUrl = `${baseUrl.replace(/\/$/, "")}${fullPage.publishedPath ?? "/" + fullPage.slug}`;

    let liveHtml = "";
    try {
      const res = await fetch(liveUrl, {
        headers: { "User-Agent": "WebflowTracker/1.0" },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) liveHtml = await res.text();
    } catch {}

    const domData = await getPageDom(page.id, token, fullPage.localeId);
    const domNodes = domData?.nodes ?? domData?.dom ?? [];

    if (liveHtml && domNodes.length > 0) {
      const liveHeadings = extractHeadingsFromLiveHtml(liveHtml);
      const domHeadings  = extractHeadingsFromDomNodes(domNodes);

      for (const pubH of liveHeadings) {
        for (const curH of domHeadings) {
          if (pubH.level === curH.level && normStr(pubH.text) !== normStr(curH.text)) {
            const w1 = normStr(pubH.text).toLowerCase().split(/\s+/);
            const w2 = normStr(curH.text).toLowerCase().split(/\s+/);
            const set2 = new Set(w2);
            let matches = 0;
            for (const w of w1) if (set2.has(w)) matches++;
            if (matches > 0 || w1[0] === w2[0]) {
              insights.push(`📐 Heading (${pubH.level}): "${pubH.text}" ➔ "${curH.text}"`);
            }
          }
        }
      }
    }

    if (insights.length === 0) {
      insights.push(`✨ Page content updated in Webflow Designer`);
    }
  } catch {}
  return insights;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  validateEnv();

  const token = process.env.WEBFLOW_API_TOKEN;
  const siteId = process.env.WEBFLOW_SITE_ID;

  console.log(`\n🔍  Fetching data from Webflow API for site: ${siteId} …`);

  let site;
  try {
    site = await getSite(siteId, token);
  } catch (err) {
    console.error(`\n❌  Failed to fetch site info:\n     ${err.message}\n`);
    process.exit(1);
  }

  let pages;
  try {
    pages = await getAllPages(siteId, token);
  } catch (err) {
    console.error(`\n❌  Failed to fetch pages:\n     ${err.message}\n`);
    process.exit(1);
  }

  console.log(
    `✅  Retrieved site info + ${pages.length} page${pages.length === 1 ? "" : "s"}.`
  );

  const { report: initialReport } = buildReport(site, pages);

  if (initialReport.pendingChanges.length > 0) {
    console.log(`🔍  Inspecting inside changes for ${initialReport.pendingChanges.length} pending page(s)…`);
    for (const p of initialReport.pendingChanges) {
      const pageObj = pages.find(item => item.id === p.id);
      if (pageObj) {
        pageObj.insights = await fetchPageInsights(p, site, token);
      }
    }
  }

  const { report, summary } = buildReport(site, pages);

  // Print console summary
  console.log(summary);

  // Write JSON report
  try {
    await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2), "utf-8");
    console.log(`📄  JSON report saved to: ${REPORT_PATH}\n`);
  } catch (err) {
    console.error(
      `\n⚠️   Could not write report.json: ${err.message}\n`
    );
  }
}

main();

