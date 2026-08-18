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

import { getSite, getAllPages } from "./src/webflowClient.js";
import { buildReport } from "./src/report.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPORT_PATH = path.join(__dirname, "report.json");

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------

/**
 * Validates that required environment variables are set.
 * Exits the process with a helpful message if they are missing.
 */
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
// Main
// ---------------------------------------------------------------------------

async function main() {
  validateEnv();

  const token = process.env.WEBFLOW_API_TOKEN;
  const siteId = process.env.WEBFLOW_SITE_ID;

  console.log(`\n🔍  Fetching data from Webflow API for site: ${siteId} …`);

  // Step 1: Fetch site metadata.
  let site;
  try {
    site = await getSite(siteId, token);
  } catch (err) {
    console.error(`\n❌  Failed to fetch site info:\n     ${err.message}\n`);
    process.exit(1);
  }

  // Step 2: Fetch all pages (with automatic pagination).
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

  // Step 3: Build the report.
  const { report, summary } = buildReport(site, pages);

  // Step 4: Print the human-readable console summary.
  console.log(summary);

  // Step 5: Write the JSON report file.
  try {
    await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2), "utf-8");
    console.log(`📄  JSON report saved to: ${REPORT_PATH}\n`);
  } catch (err) {
    console.error(
      `\n⚠️   Could not write report.json: ${err.message}\n` +
        "     (The console output above is still valid.)\n"
    );
  }
}

main();
