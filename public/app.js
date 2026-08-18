/**
 * app.js — Webflow Tracker Dashboard Frontend
 * --------------------------------------------------
 * State machine: Token → Site Select → Report View
 */

// ── State ──────────────────────────────────────────────────────────────────
let state = {
  token: null,       // active token (from input or .env)
  tokenSource: null, // "user" | "env"
  siteId: null,      // selected site ID
  report: null,      // last fetched report object
};

// ── DOM helpers ────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const show = (id) => $(id).classList.remove('hidden');
const hide = (id) => $(id).classList.add('hidden');
const setText = (id, val) => { const el = $(id); if (el) el.textContent = val; };

// ── Toast ──────────────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  $('toast-container').appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ── Date helpers ────────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return 'N/A';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/**
 * Returns the ms difference between pageUpdated and lastPublished,
 * and a human-readable label + CSS class for the delta badge.
 */
function calcDelta(pageUpdatedIso, lastPublishedIso) {
  if (!lastPublishedIso || !pageUpdatedIso) {
    return { ms: 0, label: 'Site never published', cls: 'delta-same', pct: 0 };
  }
  const diffMs = new Date(pageUpdatedIso) - new Date(lastPublishedIso);
  const diffMins = Math.round(diffMs / 60000);
  const diffHrs  = Math.round(diffMs / 3600000);
  const diffDays = Math.round(diffMs / 86400000);

  if (diffMs <= 0)         return { ms: diffMs, label: 'Edited before publish', cls: 'delta-same', pct: 0 };
  if (diffMins < 60)       return { ms: diffMs, label: `+${diffMins}min after publish`, cls: 'delta-hours', pct: Math.min(diffMins / 60, 1) * 100 };
  if (diffHrs < 24)        return { ms: diffMs, label: `+${diffHrs}h after publish`, cls: 'delta-hours', pct: Math.min(diffHrs / 24, 1) * 100 };
  return { ms: diffMs, label: `+${diffDays} day${diffDays===1?'':'s'} after publish`, cls: 'delta-days', pct: Math.min(diffDays / 30, 1) * 100 };
}

// ── Error banner ────────────────────────────────────────────────────────────
function showError(title, msg) {
  setText('error-title', title);
  setText('error-msg', ' ' + msg);
  show('error-banner');
}
function clearError() { hide('error-banner'); }

// ── Loading states ──────────────────────────────────────────────────────────
function setLoading(btnId, spinnerId, labelId, loading) {
  $(btnId).disabled = loading;
  loading ? show(spinnerId) : hide(spinnerId);
  setText(labelId, loading ? 'Loading…' : (btnId === 'btn-connect' ? 'Connect →' : 'Run Report →'));
}

// ── Step 1: Connect token ───────────────────────────────────────────────────
async function connectToken() {
  clearError();
  const inputToken = $('input-token').value.trim();

  setLoading('btn-connect', 'connect-spinner', 'connect-label', true);

  try {
    const res = await fetch('/api/sites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: inputToken || undefined }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Failed to connect');

    state.token = inputToken || null; // null = server uses .env token
    state.tokenSource = data.tokenSource;

    // Populate site selector
    const select = $('select-site');
    select.innerHTML = '<option value="">— Choose a site —</option>';
    data.sites.forEach(site => {
      const opt = document.createElement('option');
      opt.value = site.id;
      opt.textContent = `${site.displayName} (${site.shortName})`;
      select.appendChild(opt);
    });

    // Auto-select if env has a site ID or only one site
    if (data.envSiteId) {
      select.value = data.envSiteId;
    } else if (data.sites.length === 1) {
      select.value = data.sites[0].id;
    }

    show('panel-site');
    hide('panel-token');
    toast(`Connected! Found ${data.sites.length} site${data.sites.length === 1 ? '' : 's'}.`);

    // Auto-run report if a site is already selected
    if (select.value) {
      setTimeout(runReport, 300);
    }

  } catch (err) {
    showError('Connection Failed', err.message);
    toast(err.message, 'error');
  } finally {
    setLoading('btn-connect', 'connect-spinner', 'connect-label', false);
  }
}

function resetToken() {
  state = { token: null, tokenSource: null, siteId: null, report: null };
  hide('panel-site');
  hide('dashboard');
  show('panel-token');
  clearError();
}

// ── Step 2: Run report ──────────────────────────────────────────────────────
async function runReport() {
  const siteId = $('select-site').value;
  if (!siteId) { toast('Please select a site first.', 'error'); return; }

  clearError();
  setLoading('btn-run', 'run-spinner', 'run-label', true);

  try {
    const res = await fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: state.token || undefined, siteId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Report failed');

    state.siteId = siteId;
    state.report = data;
    renderDashboard(data);
    toast('Report updated ✓');

  } catch (err) {
    showError('Report Error', err.message);
    toast(err.message, 'error');
  } finally {
    setLoading('btn-run', 'run-spinner', 'run-label', false);
  }
}

// ── Step 3: Render dashboard ────────────────────────────────────────────────
function renderDashboard(report) {
  const { site, pendingChanges, draftPages, totalPages, archivedPages, cleanPages, generatedAt } = report;

  // ── Site info bar
  setText('info-site-name', site.displayName);
  setText('info-site-id', `ID: ${site.id}`);

  // ── Stats
  const pubLabel = site.lastPublished ? timeAgo(site.lastPublished) : 'Never';
  const pubDate  = site.lastPublished ? fmtDate(site.lastPublished) : 'Never published';
  setText('stat-published', pubLabel);
  setText('stat-published-rel', pubDate);

  setText('stat-pending', pendingChanges.length);
  setText('stat-pending-sub', pendingChanges.length === 0
    ? 'All pages are live'
    : `${pendingChanges.length} page${pendingChanges.length===1?'':'s'} need publishing`);

  setText('stat-drafts', draftPages.length);
  setText('stat-clean', cleanPages ?? 0);
  setText('stat-total-sub', `Out of ${totalPages} active pages`);

  // ── Report meta
  setText('meta-generated', fmtDate(generatedAt));
  setText('meta-total', totalPages);
  setText('meta-archived', archivedPages);

  // ── Badge counts
  setText('badge-pending', pendingChanges.length);
  setText('badge-drafts', draftPages.length);

  // ── Pending list
  const pendingList = $('list-pending');
  if (pendingChanges.length === 0) {
    pendingList.innerHTML = `
      <div class="empty-state">
        ✅ All published pages are up to date — nothing pending.
      </div>`;
  } else {
    pendingList.innerHTML = pendingChanges.map((page) => {
      const path    = page.publishedPath ?? `/${page.slug}`;
      const delta   = calcDelta(page.lastUpdated, site.lastPublished);
      const edited  = fmtDate(page.lastUpdated);
      const editedAgo = timeAgo(page.lastUpdated);

      return `
        <div class="page-card">
          <div class="page-card-left">
            <div class="page-title">${escHtml(page.title)}</div>
            <div class="page-path">${escHtml(path)}</div>
            <div class="page-meta">
              <span class="meta-item">
                ${iconEdit()} Last edited: <strong>${edited}</strong> (${editedAgo})
              </span>
              <span class="meta-item">
                ${iconId()} Page ID: <code style="font-family:'JetBrains Mono',monospace;font-size:11px;">${page.id}</code>
              </span>
              ${page.slug ? `<span class="meta-item">${iconSlug()} Slug: <code style="font-family:'JetBrains Mono',monospace;font-size:11px;">${escHtml(page.slug)}</code></span>` : ''}
            </div>
          </div>
          <div class="page-card-right">
            <span class="delta-badge ${delta.cls}">${delta.label}</span>
            <div>
              <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;text-align:right;">Change gap</div>
              <div class="timeline-bar">
                <div class="timeline-fill" style="width:${Math.max(delta.pct, 8)}%"></div>
              </div>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  // ── Draft list
  const draftList = $('list-drafts');
  if (draftPages.length === 0) {
    draftList.innerHTML = `
      <div class="empty-state">
        ✅ No draft pages — every page is eligible to be published.
      </div>`;
  } else {
    draftList.innerHTML = draftPages.map((page) => {
      const path = page.publishedPath ?? `/${page.slug}`;
      const edited    = page.lastUpdated ? fmtDate(page.lastUpdated) : 'Unknown';
      const editedAgo = page.lastUpdated ? timeAgo(page.lastUpdated) : '';

      return `
        <div class="page-card draft">
          <div class="page-card-left">
            <div class="page-title">${escHtml(page.title)}</div>
            <div class="page-path" style="background:var(--accent-purple-bg);color:var(--accent-purple);">${escHtml(path)}</div>
            <div class="page-meta">
              ${page.lastUpdated ? `<span class="meta-item">${iconEdit()} Last edited: <strong>${edited}</strong> (${editedAgo})</span>` : ''}
              <span class="meta-item">
                ${iconId()} Page ID: <code style="font-family:'JetBrains Mono',monospace;font-size:11px;">${page.id}</code>
              </span>
              ${page.slug ? `<span class="meta-item">${iconSlug()} Slug: <code style="font-family:'JetBrains Mono',monospace;font-size:11px;">${escHtml(page.slug)}</code></span>` : ''}
            </div>
          </div>
          <div class="page-card-right">
            <span class="delta-badge" style="background:var(--accent-purple-bg);color:var(--accent-purple);border:1px solid rgba(167,139,250,0.25);">
              📝 Draft
            </span>
            <span style="font-size:11px;color:var(--text-muted);text-align:right;">Won't go live<br>on publish</span>
          </div>
        </div>`;
    }).join('');
  }

  show('dashboard');
}

// ── Tiny SVG icons ──────────────────────────────────────────────────────────
const iconEdit = () => `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
const iconId   = () => `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="8" x2="11" y2="8"/><line x1="8" y1="16" x2="11" y2="16"/></svg>`;
const iconSlug = () => `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>`;

// ── Security helper ──────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Boot ────────────────────────────────────────────────────────────────────
(async function boot() {
  // Check if .env has a token pre-configured, then auto-connect
  try {
    const res  = await fetch('/api/env-token');
    const data = await res.json();

    if (data.hasEnvToken) {
      show('env-hint');
      // Auto-connect silently using the env token
      await connectToken();
    }
  } catch {
    // silently ignore — user will connect manually
  }

  // Allow pressing Enter in the token field to connect
  $('input-token').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') connectToken();
  });
})();
