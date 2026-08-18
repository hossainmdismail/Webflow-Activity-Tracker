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

import { getSites, getSite, getAllPages } from "./src/webflowClient.js";
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
