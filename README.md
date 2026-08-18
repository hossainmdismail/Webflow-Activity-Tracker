# Webflow Change Tracker

A lightweight Node.js CLI tool that connects to the **Webflow Data API v2** and gives you an instant snapshot of your site's publishing health:

- 📅 **When the site was last published**
- ⚠️  **Which pages have unpublished changes** (edited *after* the last publish)
- 📝 **Which pages are in draft** (will never go live even after a publish)

---

## Requirements

| Requirement | Version |
|-------------|---------|
| Node.js     | ≥ 18.0  |
| npm         | ≥ 8.0   |

> Node.js 18+ ships with the native `fetch` API — no HTTP library needed.

---

## Setup

### 1. Clone / download the project

```bash
git clone <your-repo-url>
cd webflow-tracker
```

### 2. Install dependencies

```bash
npm install
```

Only one dependency is installed: `dotenv` (for reading your `.env` file).

### 3. Configure your credentials

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env`:

```env
WEBFLOW_API_TOKEN=your_api_token_here
WEBFLOW_SITE_ID=your_site_id_here
```

#### Where to get these values

| Variable | How to find it |
|---|---|
| `WEBFLOW_API_TOKEN` | Webflow Dashboard → **Account Settings** → **API Access** → Generate a Personal Access Token. Required scopes: **`sites:read`**, **`pages:read`** |
| `WEBFLOW_SITE_ID` | Open any page in the Webflow Designer. The URL is `https://webflow.com/design/<SITE_ID>/...` — copy the `SITE_ID` portion. Alternatively, call `GET https://api.webflow.com/v2/sites` with your token and look for the `id` field. |

> ⚠️ **Never commit your `.env` file.** It is already listed in `.gitignore`.

---

## Running the tool

```bash
npm start
```

Or with the file watcher for development:

```bash
npm run dev
```

---

## Example output

```
🔍  Fetching data from Webflow API for site: 64a3b2c1f8e0d9... 
✅  Retrieved site info + 12 pages.

╔══════════════════════════════════════════════════════╗
║          Webflow Site Change Report                  ║
╚══════════════════════════════════════════════════════╝

  Site        : Acme Corp Website
  Last published : Aug 10, 2026, 2:32 PM
  Report time : Aug 18, 2026, 8:58 PM

⚠️   3 pages have unpublished changes:
       • /about
           Title     : About Us
           Edited    : Aug 15, 2026, 9:12 AM (5 days after last publish)
       • /pricing
           Title     : Pricing
           Edited    : Aug 16, 2026, 3:00 PM (6 days after last publish)
       • /contact
           Title     : Contact
           Edited    : Aug 17, 2026, 11:45 AM (7 days after last publish)

📝  2 pages are currently in draft (will not go live on publish):
       • /new-landing
           Title     : New Landing (WIP)
           Last edited: Aug 16, 2026, 11:00 AM
       • /team-v2
           Title     : Team (Redesign)
           Last edited: Aug 14, 2026, 4:22 PM

──────────────────────────────────────────────────────

📄  JSON report saved to: /path/to/project/report.json
```

---

## Output files

### `report.json`

A machine-readable JSON file is written to the project root after every run:

```json
{
  "generatedAt": "2026-08-18T14:58:56.000Z",
  "site": {
    "id": "64a3b2c1f8e0d9...",
    "displayName": "Acme Corp Website",
    "lastPublished": "2026-08-10T14:32:00.000Z"
  },
  "pendingChanges": [
    {
      "id": "page-id-abc",
      "slug": "about",
      "title": "About Us",
      "lastUpdated": "2026-08-15T09:12:00.000Z",
      "draft": false,
      "publishedPath": "/about"
    }
  ],
  "draftPages": [
    {
      "id": "page-id-xyz",
      "slug": "new-landing",
      "title": "New Landing (WIP)",
      "lastUpdated": "2026-08-16T11:00:00.000Z",
      "publishedPath": null
    }
  ]
}
```

---

## Project structure

```
webflow-tracker/
├── src/
│   ├── webflowClient.js   # Webflow API calls: getSite(), getAllPages() + pagination
│   └── report.js          # Classification logic + console/JSON report builders
├── index.js               # Entry point: orchestrates the flow
├── .env.example           # Template for your .env credentials
├── .gitignore
├── package.json
└── README.md
```

---

## How it works

```
┌─────────────────────────────────────────────────┐
│                   index.js                      │
│  1. Load .env  →  2. Validate env vars          │
│  3. getSite()  →  4. getAllPages()              │
│  5. buildReport()  →  6. Print  →  7. Write     │
└─────────────────────────────────────────────────┘
         │                    │
         ▼                    ▼
  webflowClient.js        report.js
  ─────────────────       ──────────────────────
  getSite(id, token)      buildReport(site, pages)
  getAllPages(id, token)   │
    └─ pagination loop     ├─ skip archived pages
       offset + total      ├─ flag draft pages
                           └─ compare lastUpdated
                              vs lastPublished
```

### Classification rules

| Condition | Classification |
|---|---|
| `archived === true` | **Skipped** — not shown in report |
| `draft === true` | **Draft page** — shown in `draftPages` |
| `lastUpdated > lastPublished` | **Pending change** — shown in `pendingChanges` |
| Everything else | **Clean** — not shown (no action needed) |

> A draft page is the dominant classification — if a page is both draft *and* has been edited after publish, it only appears in `draftPages`.

---

## Error handling

| Scenario | Behaviour |
|---|---|
| Missing `.env` variables | Prints a clear message listing which variables are missing, then exits |
| Invalid / expired token | HTTP 401/403 → descriptive error with remediation hint |
| Wrong site ID | HTTP 404 → descriptive error |
| Rate limited | HTTP 429 → prints the `Retry-After` duration and exits |
| Unexpected API errors | Prints status code + Webflow error message |

---

## Non-goals (v1)

- ❌ Content-level diffing (HTML, text, images) — this uses metadata only
- ❌ Webhook / real-time listening — this is an on-demand CLI run
- ❌ Browser screenshots or visual regression
- ❌ CMS collection item tracking

---

## License

MIT
