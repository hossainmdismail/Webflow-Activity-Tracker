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
        <div class="page-card clickable" onclick="openPageModal('${page.id}', '${escHtml(page.title).replace(/'/g,"&#39;")}', '${escHtml(path).replace(/'/g,"&#39;")}')">
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
            <div style="margin-top:10px;font-size:11px;color:var(--accent-blue);display:flex;align-items:center;gap:5px;font-weight:500;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              Click to view page content &amp; design diff →
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
            <div class="page-title">
              ${escHtml(page.title)}
              <span class="badge badge-purple" style="margin-left:8px;">Draft</span>
            </div>
            <div class="page-path">${escHtml(path)}</div>
            <div class="page-meta">
              <span class="meta-item">
                ${iconEdit()} Last edited: <strong>${edited}</strong> ${editedAgo ? `(${editedAgo})` : ''}
              </span>
              <span class="meta-item">
                ${iconId()} Page ID: <code style="font-family:'JetBrains Mono',monospace;font-size:11px;">${page.id}</code>
              </span>
            </div>
          </div>
          <div class="page-card-right">
            <span style="font-size:11px;color:var(--text-muted);text-align:right;">Won't go live<br>on publish</span>
          </div>
        </div>`;
    }).join('');
  }

  show('dashboard');
}

// ── Modal: open / close / render ─────────────────────────────────────────────
async function openPageModal(pageId, title, path) {
  document.body.style.overflow = 'hidden';
  setText('modal-title', title);
  setText('modal-path', path);
  hide('modal-body');
  $('modal-loading').innerHTML = `<div class="spinner"></div><span>Fetching live page &amp; comparing with current…</span>`;
  show('modal-loading');
  show('modal-overlay');

  try {
    const res = await fetch('/api/page-compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: state.token || undefined, siteId: state.siteId, pageId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch comparison');
    renderModal(data);
  } catch (err) {
    $('modal-loading').innerHTML = `
      <div style="color:var(--accent-red);font-size:13px;padding:8px 0;">
        <strong>⚠️ Could not load comparison:</strong> ${escHtml(err.message)}
      </div>`;
  }
}

function renderModal(data) {
  const { page, site, liveUrl, liveFetchOk, changes } = data;
  const lastPublished = site?.lastPublished ?? state.report?.site?.lastPublished ?? null;

  const designerUrl = `https://webflow.com/design/${page.siteId}`;
  $('modal-links').innerHTML = `
    <a href="${escHtml(designerUrl)}" target="_blank" rel="noopener noreferrer" class="modal-link-btn primary">
      🎨 Open in Webflow Designer
    </a>
    <a href="${escHtml(liveUrl)}" target="_blank" rel="noopener noreferrer" class="modal-link-btn secondary">
      🌍 View Live Page
    </a>
    <a class="modal-link-btn secondary" style="cursor:pointer"
       onclick="navigator.clipboard.writeText('${escHtml(liveUrl)}').then(()=>toast('URL copied! 📋'))">
      📋 Copy URL
    </a>`;

  const delta = calcDelta(page.lastUpdated, lastPublished);
  $('modal-timeline').innerHTML = `
    <div class="tl-card">
      <div class="tl-label">Last Published</div>
      <div class="tl-value">${lastPublished ? timeAgo(lastPublished) : 'Never'}</div>
      <div class="tl-sub">${fmtDate(lastPublished)}</div>
    </div>
    <div class="tl-card highlight">
      <div class="tl-label">Last Edited</div>
      <div class="tl-value">${timeAgo(page.lastUpdated)}</div>
      <div class="tl-sub">${fmtDate(page.lastUpdated)}</div>
    </div>
    <div class="tl-card">
      <div class="tl-label">Change Gap</div>
      <div class="tl-value" style="color:var(--accent-amber)">${delta.label}</div>
      <div class="tl-sub">edit vs publish</div>
    </div>`;

  if (!liveFetchOk) {
    show('modal-live-warn');
  } else {
    hide('modal-live-warn');
  }

  const changedFields = changes.filter(field => field.changed === true);
  
  if (changedFields.length === 0) {
    $('modal-diff').innerHTML = `
      <div class="diff-field unchanged" style="padding:14px;background:rgba(52,211,153,0.06);border-color:rgba(52,211,153,0.2);color:var(--accent-green);font-size:13px;display:flex;align-items:center;gap:8px;">
        <span>✅</span> <strong>Metadata Unchanged:</strong> SEO Title, SEO Description, OG fields, and Page Title match the live published state.
      </div>`;
  } else {
    $('modal-diff').innerHTML = changedFields.map(field => renderDiffField(field, liveFetchOk)).join('');
  }

  hide('modal-loading');
  show('modal-body');

  renderContentSection(data);
}

function renderContentSection(data) {
  const { liveContent, currentContent, domApiAvailable, page } = data;

  const dLink = $('modal-designer-link');
  if (dLink) dLink.href = `https://webflow.com/design/${page.siteId}`;

  const badge = $('modal-dom-badge');
  if (domApiAvailable && badge) {
    setText('modal-dom-badge', 'Only Changed Content (DOM API)');
    badge.style.cssText = 'background:rgba(52,211,153,.12);color:#34d399;padding:3px 9px;border-radius:100px;border:1px solid rgba(52,211,153,.25)';
    hide('modal-dom-unavail');
  } else if (liveContent && badge) {
    setText('modal-dom-badge', 'Published state only');
    badge.style.cssText = 'background:rgba(255,255,255,.05);color:var(--text-muted);padding:3px 9px;border-radius:100px;border:1px solid var(--border)';
    show('modal-dom-unavail');
  } else {
    hide('modal-content-section');
    return;
  }

  const container = $('modal-content-diff');
  const parts = [];

  // Headings — show ONLY changed headings
  if (liveContent?.headings?.length > 0 || currentContent?.headings?.length > 0) {
    const aligned = renderOnlyChangedHeadings(liveContent?.headings ?? [], currentContent?.headings ?? [], domApiAvailable);
    if (aligned.hasChanges) {
      parts.push(`
        <div class="content-group">
          <div class="content-group-header">📐 Changed Headings</div>
          ${domApiAvailable
            ? `<div class="content-compare-grid">
                 <div class="content-col before"><div class="content-col-header">Published</div><div class="content-col-body" style="padding:0">${aligned.beforeHtml}</div></div>
                 <div class="content-col after"><div class="content-col-header">Current</div><div class="content-col-body" style="padding:0">${aligned.afterHtml}</div></div>
               </div>`
            : aligned.beforeHtml}
        </div>`);
    } else {
      parts.push(`
        <div class="content-group" style="padding:12px 14px;background:rgba(52,211,153,0.04);color:var(--accent-green);font-size:12px;">
          ✅ <strong>Headings Unchanged:</strong> All heading structure and text match published state.
        </div>`);
    }
  }

  // Paragraphs — show ONLY changed paragraphs
  if (liveContent?.paragraphs?.length > 0 || currentContent?.paragraphs?.length > 0) {
    const pDiff = renderOnlyChangedParas(liveContent?.paragraphs ?? [], currentContent?.paragraphs ?? [], domApiAvailable);
    if (pDiff.hasChanges) {
      parts.push(`
        <div class="content-group">
          <div class="content-group-header">📝 Changed Paragraphs</div>
          ${domApiAvailable
            ? `<div class="content-compare-grid">
                 <div class="content-col before"><div class="content-col-header">Published</div><div class="content-col-body" style="padding:0">${pDiff.beforeHtml}</div></div>
                 <div class="content-col after"><div class="content-col-header">Current</div><div class="content-col-body" style="padding:0">${pDiff.afterHtml}</div></div>
               </div>`
            : pDiff.beforeHtml}
        </div>`);
    } else {
      parts.push(`
        <div class="content-group" style="padding:12px 14px;background:rgba(52,211,153,0.04);color:var(--accent-green);font-size:12px;">
          ✅ <strong>Paragraph Text Unchanged:</strong> All body paragraphs match published state.
        </div>`);
    }
  }

  container.innerHTML = parts.length > 0
    ? parts.join('')
    : `<div class="modal-live-warn">No extractable content found on this page.</div>`;
}

/** Normalize string whitespace (collapses multiple spaces/newlines to single space) */
function normStr(str) {
  return String(str ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Renders ONLY changed headings (filters out identical headings AND unmatched CMS collection items).
 */
function renderOnlyChangedHeadings(publishedHeadings, currentHeadings, showDiff) {
  const pubList = publishedHeadings ?? [];
  const curList = currentHeadings ?? [];

  if (!showDiff || curList.length === 0) {
    return { beforeHtml: '', afterHtml: '', hasChanges: false };
  }

  const paired = [];
  const usedCurIndices = new Set();

  for (let i = 0; i < pubList.length; i++) {
    const pub = pubList[i];
    let bestMatchIdx = -1;
    let bestScore = -1;

    for (let j = 0; j < curList.length; j++) {
      if (usedCurIndices.has(j)) continue;
      const cur = curList[j];

      const score = calcSimilarity(normStr(pub.text), normStr(cur.text));
      const levelBonus = (pub.level === cur.level) ? 0.2 : 0;
      const totalScore = score + levelBonus;

      if (totalScore > bestScore && totalScore >= 0.30) {
        bestScore = totalScore;
        bestMatchIdx = j;
      }
    }

    if (bestMatchIdx !== -1) {
      usedCurIndices.add(bestMatchIdx);
      paired.push({ pub, cur: curList[bestMatchIdx] });
    }
  }

  // Filter ONLY pairs where BOTH exist and text/level actually changed (ignores CMS false-removals)
  const changedPairs = paired.filter(pair => {
    const { pub, cur } = pair;
    if (!pub || !cur) return false; // Ignore unmatched CMS collection items
    return normStr(pub.text) !== normStr(cur.text) || pub.level !== cur.level;
  });

  if (changedPairs.length === 0) {
    return { beforeHtml: '', afterHtml: '', hasChanges: false };
  }

  const beforeCols = [];
  const afterCols  = [];

  for (const pair of changedPairs) {
    const { pub, cur } = pair;
    const { beforeHtml, afterHtml } = wordDiff(normStr(pub.text), normStr(cur.text));
    const pLvl = pub.level.toLowerCase();
    const cLvl = cur.level.toLowerCase();
    beforeCols.push(`<div class="heading-item"><span class="heading-level ${pLvl}">${escHtml(pub.level)}</span><span class="heading-text">${beforeHtml}</span></div>`);
    afterCols.push(`<div class="heading-item"><span class="heading-level ${cLvl}">${escHtml(cur.level)}</span><span class="heading-text">${afterHtml}</span></div>`);
  }

  return { beforeHtml: beforeCols.join(''), afterHtml: afterCols.join(''), hasChanges: true };
}

/**
 * Renders ONLY changed paragraphs (filters out identical paragraphs AND CMS false-removals).
 */
function renderOnlyChangedParas(publishedParas, currentParas, showDiff) {
  const pubList = publishedParas ?? [];
  const curList = currentParas ?? [];

  if (!showDiff || curList.length === 0) {
    return { beforeHtml: '', afterHtml: '', hasChanges: false };
  }

  const paired = [];
  const usedCurIndices = new Set();

  for (let i = 0; i < pubList.length; i++) {
    const pub = pubList[i];
    let bestMatchIdx = -1;
    let bestScore = -1;

    for (let j = 0; j < curList.length; j++) {
      if (usedCurIndices.has(j)) continue;
      const cur = curList[j];
      const score = calcSimilarity(normStr(pub), normStr(cur));
      if (score > bestScore && score >= 0.30) {
        bestScore = score;
        bestMatchIdx = j;
      }
    }

    if (bestMatchIdx !== -1) {
      usedCurIndices.add(bestMatchIdx);
      paired.push({ pub, cur: curList[bestMatchIdx] });
    }
  }

  // Filter ONLY pairs where BOTH exist and text actually changed (ignoring whitespace & CMS noise)
  const changedPairs = paired.filter(pair => {
    const { pub, cur } = pair;
    if (!pub || !cur) return false;
    return normStr(pub) !== normStr(cur);
  });

  if (changedPairs.length === 0) {
    return { beforeHtml: '', afterHtml: '', hasChanges: false };
  }

  const beforeCols = [];
  const afterCols  = [];

  for (const pair of changedPairs) {
    const { pub, cur } = pair;
    const { beforeHtml, afterHtml } = wordDiff(normStr(pub), normStr(cur));
    beforeCols.push(`<div class="para-item">${beforeHtml}</div>`);
    afterCols.push(`<div class="para-item">${afterHtml}</div>`);
  }

  return { beforeHtml: beforeCols.join(''), afterHtml: afterCols.join(''), hasChanges: true };
}



function calcSimilarity(s1, s2) {
  if (!s1 || !s2) return 0;
  const w1 = s1.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  const w2 = s2.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  if (w1.length === 0 || w2.length === 0) return 0;
  const set2 = new Set(w2);
  let matches = 0;
  for (const w of w1) {
    if (set2.has(w)) matches++;
  }
  return (2.0 * matches) / (w1.length + w2.length);
}

function renderContentGroup(title, beforeItems, afterItems, showDiff, renderFn) {
  const bHtml = renderFn(beforeItems, afterItems, showDiff, true);
  const aHtml = showDiff && afterItems ? renderFn(afterItems, beforeItems, false, false) : null;
  return `
    <div class="content-group">
      <div class="content-group-header">${title}</div>
      ${showDiff && aHtml
        ? `<div class="content-compare-grid">
             <div class="content-col before"><div class="content-col-header">Published</div><div class="content-col-body" style="padding:0">${bHtml}</div></div>
             <div class="content-col after"><div class="content-col-header">Current</div><div class="content-col-body" style="padding:0">${aHtml}</div></div>
           </div>`
        : bHtml}
    </div>`;
}

function renderParasBlock(paras, other, applyDiff, isBefore) {
  if (!paras || paras.length === 0)
    return `<div class="para-item" style="color:var(--text-muted);font-style:italic;">No paragraphs found</div>`;
  return paras.map((p, i) => {
    let html = escHtml(p);
    if (applyDiff && other && other[i]) {
      const d = wordDiff(p, other[i]);
      html = isBefore ? d.beforeHtml : d.afterHtml;
    }
    return `<div class="para-item">${html}</div>`;
  }).join('');
}


function renderImagesBlock(images) {
  if (!images || images.length === 0) return `<div class="para-item" style="color:var(--text-muted);font-style:italic;">No images</div>`;
  return `<div class="image-grid">${images.map(img => `
    <div class="image-card">
      <img src="${escHtml(img.src)}" alt="${escHtml(img.alt)}" loading="lazy" onerror="this.style.display='none'">
      <div class="image-card-alt">${img.alt ? escHtml(img.alt) : '(no alt text)'}</div>
    </div>`).join('')}</div>`;
}

function renderDiffField(field, liveFetchOk) {
  const { label, icon, before, after, changed } = field;

  if (!liveFetchOk || changed === null) {
    const cls = after ? '' : 'empty';
    return `
      <div class="diff-field unchanged">
        <div class="diff-field-header">
          <span class="diff-field-icon">${icon}</span>
          <span class="diff-field-label">${escHtml(label)}</span>
          <span class="diff-status nodata">No live data</span>
        </div>
        <div class="diff-same-row ${cls}">${after ? escHtml(after) : '(not set)'}</div>
      </div>`;
  }

  if (!changed) {
    const val = after ?? before ?? null;
    const cls = val ? '' : 'empty';
    return `
      <div class="diff-field unchanged">
        <div class="diff-field-header">
          <span class="diff-field-icon">${icon}</span>
          <span class="diff-field-label">${escHtml(label)}</span>
          <span class="diff-status same">No change</span>
        </div>
        <div class="diff-same-row ${cls}">${val ? escHtml(val) : '(not set)'}</div>
      </div>`;
  }

  const { beforeHtml, afterHtml } = wordDiff(before, after);
  return `
    <div class="diff-field changed">
      <div class="diff-field-header">
        <span class="diff-field-icon">${icon}</span>
        <span class="diff-field-label">${escHtml(label)}</span>
        <span class="diff-status changed">Changed</span>
      </div>
      <div class="diff-before">
        <div class="diff-row-label">Published</div>
        <div class="diff-row-value ${before ? '' : 'empty'}">${before ? beforeHtml : '(not set)'}</div>
      </div>
      <div class="diff-after">
        <div class="diff-row-label">Current</div>
        <div class="diff-row-value ${after ? '' : 'empty'}">${after ? afterHtml : '(not set)'}</div>
      </div>
    </div>`;
}

function wordDiff(before, after) {
  if (!before && !after) return { beforeHtml: '', afterHtml: '' };
  if (!before) return { beforeHtml: '', afterHtml: `<ins>${escHtml(after)}</ins>` };
  if (!after)  return { beforeHtml: `<del>${escHtml(before)}</del>`, afterHtml: '' };
  if (before === after) {
    const h = escHtml(before);
    return { beforeHtml: h, afterHtml: h };
  }

  const tokenise = str => str.split(/(\s+)/);
  const bToks = tokenise(before);
  const aToks = tokenise(after);
  const m = bToks.length, n = aToks.length;

  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = bToks[i-1] === aToks[j-1]
        ? dp[i-1][j-1] + 1
        : Math.max(dp[i-1][j], dp[i][j-1]);

  const ops = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && bToks[i-1] === aToks[j-1]) {
      ops.unshift({ type: 'keep', b: bToks[i-1], a: aToks[j-1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      ops.unshift({ type: 'ins', a: aToks[j-1] });
      j--;
    } else {
      ops.unshift({ type: 'del', b: bToks[i-1] });
      i--;
    }
  }

  const beforeHtml = ops
    .filter(op => op.type !== 'ins')
    .map(op => op.type === 'del' ? `<del>${escHtml(op.b)}</del>` : escHtml(op.b))
    .join('');

  const afterHtml = ops
    .filter(op => op.type !== 'del')
    .map(op => op.type === 'ins' ? `<ins>${escHtml(op.a)}</ins>` : escHtml(op.a))
    .join('');

  return { beforeHtml, afterHtml };
}

function closeModal(event) {
  if (event.target === $('modal-overlay')) closeModalDirect();
}

function closeModalDirect() {
  hide('modal-overlay');
  document.body.style.overflow = '';
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('modal-overlay').classList.contains('hidden')) {
    closeModalDirect();
  }
});

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
