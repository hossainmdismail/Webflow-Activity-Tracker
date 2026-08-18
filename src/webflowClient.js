/**
 * webflowClient.js
 * ----------------
 * Wraps all Webflow Data API v2 HTTP calls.
 * Uses the native `fetch` API (Node.js >= 18) — no extra HTTP library needed.
 *
 * Handles:
 *   - Base URL + auth header injection
 *   - Rate-limit (HTTP 429) detection
 *   - Pagination for the /pages endpoint
 *   - Common error messaging for 401 / 403 / 404 / 5xx
 */

const WEBFLOW_BASE_URL = "https://api.webflow.com/v2";

/**
 * Low-level fetch wrapper that attaches auth headers and interprets
 * common error responses into descriptive Error objects.
 *
 * @param {string} url        - Full URL to fetch
 * @param {string} token      - Webflow API bearer token
 * @returns {Promise<object>} - Parsed JSON response body
 */
async function apiFetch(url, token) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "accept-version": "1.0.0",
      Accept: "application/json",
    },
  });

  // --- Error Handling ---
  if (!response.ok) {
    const status = response.status;

    // Try to extract a Webflow error message from the JSON body if available.
    let errorDetail = "";
    try {
      const body = await response.json();
      errorDetail = body.message || body.msg || JSON.stringify(body);
    } catch {
      errorDetail = response.statusText;
    }

    if (status === 401 || status === 403) {
      throw new Error(
        `Authentication failed (HTTP ${status}). ` +
          `Check that your WEBFLOW_API_TOKEN is valid and has the required scopes ` +
          `(sites:read, pages:read). Webflow said: "${errorDetail}"`
      );
    }

    if (status === 404) {
      throw new Error(
        `Resource not found (HTTP 404). ` +
          `Check that your WEBFLOW_SITE_ID is correct. Webflow said: "${errorDetail}"`
      );
    }

    if (status === 429) {
      // Webflow returns a Retry-After header on rate-limit responses.
      const retryAfter = response.headers.get("Retry-After") || "60";
      throw new Error(
        `Rate limited by Webflow API (HTTP 429). ` +
          `Please wait ${retryAfter} seconds before retrying.`
      );
    }

    throw new Error(
      `Webflow API returned an unexpected error (HTTP ${status}): "${errorDetail}"`
    );
  }

  return response.json();
}

// ---------------------------------------------------------------------------
// Public API surface
// ---------------------------------------------------------------------------

/**
 * Fetches all sites accessible with the given token.
 * Used by the dashboard to auto-populate the site selector.
 *
 * @param {string} token - Webflow API bearer token
 * @returns {Promise<Array>} - Array of site objects
 */
export async function getSites(token) {
  const url = `${WEBFLOW_BASE_URL}/sites`;
  const data = await apiFetch(url, token);
  return data.sites ?? [];
}

/**
 * Fetches the site object for a given site ID.
 * Relevant fields returned by Webflow: id, displayName, shortName,
 * lastPublished, previewUrl, timeZone, ...
 *
 * @param {string} siteId - Webflow site ID
 * @param {string} token  - Webflow API bearer token
 * @returns {Promise<object>} - Site object
 */
export async function getSite(siteId, token) {
  const url = `${WEBFLOW_BASE_URL}/sites/${siteId}`;
  return apiFetch(url, token);
}

/**
 * Fetches ALL pages for a given site, transparently handling cursor-based
 * pagination (Webflow uses `?offset` / `pagination.total` style).
 *
 * Each page object includes: id, siteId, title, slug, draft, archived,
 * lastUpdated, publishedPath, createdOn, ...
 *
 * @param {string} siteId - Webflow site ID
 * @param {string} token  - Webflow API bearer token
 * @returns {Promise<Array>} - Flat array of all page objects
 */
export async function getAllPages(siteId, token) {
  const LIMIT = 100; // maximum allowed by Webflow v2
  let offset = 0;
  let allPages = [];

  while (true) {
    const url = `${WEBFLOW_BASE_URL}/sites/${siteId}/pages?limit=${LIMIT}&offset=${offset}`;
    const data = await apiFetch(url, token);

    const pages = data.pages ?? [];
    allPages = allPages.concat(pages);

    // Pagination metadata shape: { limit, offset, total }
    const pagination = data.pagination ?? {};
    const total = pagination.total ?? allPages.length;

    // Break when we have retrieved all pages
    if (allPages.length >= total || pages.length === 0) {
      break;
    }

    offset += LIMIT;
  }

  return allPages;
}
