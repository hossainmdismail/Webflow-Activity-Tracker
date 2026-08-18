/**
 * report.js
 * ---------
 * Pure logic module — no side effects, no I/O.
 *
 * Responsibilities:
 *   1. Classify pages into: pendingChanges, draftPages, clean pages
 *   2. Build the structured report object
 *   3. Render a human-readable console string
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format an ISO date string into a human-readable locale string.
 * e.g. "2026-08-10T14:32:00.000Z" → "Aug 10, 2026, 2:32 PM"
 *
 * @param {string|null} isoString
 * @returns {string}
 */
export function formatDate(isoString) {
  if (!isoString) return "N/A";
  return new Date(isoString).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Return a human-readable relative-time phrase like "5 days after last publish".
 * Used in the console summary lines.
 *
 * @param {string} pageLastUpdated   - ISO date string for the page
 * @param {string} siteLastPublished - ISO date string for the site
 * @returns {string}
 */
function relativeTime(pageLastUpdated, siteLastPublished) {
  const diffMs =
    new Date(pageLastUpdated).getTime() -
    new Date(siteLastPublished).getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "same day as last publish";
  if (diffDays === 1) return "1 day after last publish";
  return `${diffDays} days after last publish`;
}

/**
 * Pick the most user-friendly display path for a page.
 * Falls back through publishedPath → slug → id.
 *
 * @param {object} page
 * @returns {string}
 */
function displayPath(page) {
  if (page.publishedPath) return page.publishedPath;
  if (page.slug) return `/${page.slug}`;
  return `[id:${page.id}]`;
}

// ---------------------------------------------------------------------------
// Core classification logic
// ---------------------------------------------------------------------------

/**
 * Analyse a flat list of Webflow page objects against the site's lastPublished
 * timestamp and return a structured report.
 *
 * Classification rules:
 *   - Skip  : archived === true  (these pages are hidden from Webflow entirely)
 *   - Draft : draft === true     (will never go live even after a publish)
 *   - Pending: lastUpdated > lastPublished  (edited since the last publish)
 *   - Clean : everything else
 *
 * Note: a page can simultaneously be "draft" AND have been edited after publish;
 * in that case it appears only in `draftPages` (draft is the dominant state).
 *
 * @param {object} site  - Webflow site object (must include `lastPublished`)
 * @param {Array}  pages - Array of Webflow page objects
 * @returns {{ report: object, summary: string }}
 */
export function buildReport(site, pages) {
  const lastPublished = site.lastPublished ?? null;
  const lastPublishedTs = lastPublished ? new Date(lastPublished).getTime() : null;

  const pendingChanges = [];
  const draftPages = [];

  for (const page of pages) {
    // Rule 1: Skip archived pages entirely.
    if (page.archived === true) continue;

    // Rule 2: Draft pages — flag separately, regardless of timestamps.
    if (page.draft === true) {
      draftPages.push({
        id: page.id,
        slug: page.slug ?? "",
        title: page.title ?? page.name ?? "(untitled)",
        lastUpdated: page.lastUpdated ?? null,
        publishedPath: page.publishedPath ?? null,
      });
      continue; // Draft is the dominant classification; skip further checks.
    }

    // Rule 3: Pending (edited after last publish).
    // If the site has never been published, every non-draft, non-archived page
    // is technically "pending" — we handle that by treating lastPublishedTs
    // as 0 (epoch) when null.
    const pageUpdatedTs = page.lastUpdated
      ? new Date(page.lastUpdated).getTime()
      : null;
    const effectivePublishedTs = lastPublishedTs ?? 0;

    if (pageUpdatedTs !== null && pageUpdatedTs > effectivePublishedTs) {
      pendingChanges.push({
        id: page.id,
        slug: page.slug ?? "",
        title: page.title ?? page.name ?? "(untitled)",
        lastUpdated: page.lastUpdated,
        draft: false,
        publishedPath: page.publishedPath ?? null,
      });
    }
  }

  // --- Build the report object ---
  const report = {
    generatedAt: new Date().toISOString(),
    site: {
      id: site.id,
      displayName: site.displayName ?? site.shortName ?? site.id,
      lastPublished,
    },
    pendingChanges,
    draftPages,
  };

  // --- Build the human-readable console summary ---
  const summary = buildConsoleSummary(report, lastPublished);

  return { report, summary };
}

// ---------------------------------------------------------------------------
// Console output formatting
// ---------------------------------------------------------------------------

/**
 * Build the multi-line human-readable console report string.
 *
 * @param {object}      report        - The structured report object
 * @param {string|null} lastPublished - ISO date of last publish (may be null)
 * @returns {string}
 */
function buildConsoleSummary(report, lastPublished) {
  const lines = [];

  // ── Header ──────────────────────────────────────────────────────────────
  lines.push("");
  lines.push("╔══════════════════════════════════════════════════════╗");
  lines.push("║          Webflow Site Change Report                  ║");
  lines.push("╚══════════════════════════════════════════════════════╝");
  lines.push("");

  // ── Site info ───────────────────────────────────────────────────────────
  lines.push(`  Site        : ${report.site.displayName}`);
  lines.push(`  Last published : ${formatDate(lastPublished)}`);
  lines.push(`  Report time : ${formatDate(report.generatedAt)}`);
  lines.push("");

  // ── Pending changes ─────────────────────────────────────────────────────
  const pending = report.pendingChanges;
  if (pending.length === 0) {
    lines.push("✅  No pages have unpublished changes.");
  } else {
    lines.push(
      `⚠️   ${pending.length} page${pending.length === 1 ? "" : "s"} have unpublished changes:`
    );
    for (const page of pending) {
      const path = page.publishedPath ?? `/${page.slug}`;
      const when = formatDate(page.lastUpdated);
      const rel = lastPublished
        ? relativeTime(page.lastUpdated, lastPublished)
        : "site never published";
      lines.push(`       • ${path}`);
      lines.push(`           Title     : ${page.title}`);
      lines.push(`           Edited    : ${when} (${rel})`);
    }
  }

  lines.push("");

  // ── Draft pages ─────────────────────────────────────────────────────────
  const drafts = report.draftPages;
  if (drafts.length === 0) {
    lines.push("✅  No pages are currently in draft.");
  } else {
    lines.push(
      `📝  ${drafts.length} page${drafts.length === 1 ? "" : "s"} are currently in draft (will not go live on publish):`
    );
    for (const page of drafts) {
      const path = page.publishedPath ?? `/${page.slug}`;
      lines.push(`       • ${path}`);
      lines.push(`           Title     : ${page.title}`);
      if (page.lastUpdated) {
        lines.push(`           Last edited: ${formatDate(page.lastUpdated)}`);
      }
    }
  }

  lines.push("");
  lines.push("──────────────────────────────────────────────────────");
  lines.push("");

  return lines.join("\n");
}
