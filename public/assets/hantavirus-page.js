// hantavirus-page.js — externalized from hantavirus.html (2026-06-23).
// Moved out of an inline <script> so it passes the site CSP
// `script-src 'self' https://api.thatcomputerguy26.org` (no 'unsafe-inline').
// Behavior is byte-for-byte identical to the previous inline block.
//
// 1. Pre-render from local snapshot data/hantavirus.json (instant first paint).
// 2. Re-render with /api/public/hantavirus/snapshot if newer (live update).
// 3. Inline SVG US map drawn from a compact path table embedded below.

(function () {
  const API_BASE = 'https://api.thatcomputerguy26.org/api/public/hantavirus';
  const LOCAL_JSON = './data/hantavirus.json';

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  // Minimal US choropleth — 50 states + DC + PR, simplified centroid-based
  // squares (Albers-USA inspired tile map). Better than nothing without a
  // 200kB geojson dependency, and works fully offline.
  const TILE_MAP = [
    ['AK',0,7],['ME',10,0],
    ['VT',8,1],['NH',9,1],['WA',1,1],['ID',2,2],['MT',3,1],['ND',4,1],['MN',5,1],['WI',6,1],['MI',7,2],['NY',8,2],['MA',9,2],['RI',10,2],
    ['OR',1,2],['UT',2,3],['WY',3,2],['SD',4,2],['IA',5,2],['IL',6,2],['IN',7,3],['OH',7,2],['PA',8,3],['NJ',9,3],['CT',10,3],
    ['CA',1,3],['NV',2,2],['CO',3,3],['NE',4,3],['MO',5,3],['KY',6,3],['WV',8,4],['VA',9,4],['MD',10,4],['DE',11,4],
    ['AZ',2,4],['NM',3,4],['KS',4,4],['AR',5,4],['TN',6,4],['NC',8,5],['SC',9,5],['HI',0,6],
    ['OK',4,5],['LA',5,5],['MS',6,5],['AL',7,5],['GA',8,6],['FL',9,7],
    ['TX',4,6],['DC',10,4],['PR',10,7]
  ];
  const TILE_W = 11, TILE_H = 8, CELL = 36, GAP = 4;

  function buildSvg(byState) {
    const buckets = (n) => {
      if (!n || n <= 0) return '0';
      if (n < 10) return '1';
      if (n < 50) return '2';
      if (n < 150) return '3';
      return '4';
    };
    const w = TILE_W * (CELL + GAP);
    const h = TILE_H * (CELL + GAP);
    const cells = TILE_MAP.map(([code, col, row]) => {
      const x = col * (CELL + GAP);
      const y = row * (CELL + GAP);
      const total = (byState[code] && byState[code].total) || 0;
      const b = buckets(total);
      const safeCode = code.replace(/[^A-Z0-9]/g, '');
      return `<g class="hv-cell" data-state="${safeCode}" tabindex="0" role="button" aria-label="${safeCode}: ${total} cases">
        <path d="M${x},${y} h${CELL} v${CELL} h-${CELL} z" data-bucket="${b}" data-state="${safeCode}" />
        <text x="${x + CELL / 2}" y="${y + CELL / 2 + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="#e7ecf5" style="pointer-events:none;">${safeCode}</text>
        <text x="${x + CELL / 2}" y="${y + CELL - 4}" text-anchor="middle" font-size="8.5" fill="rgba(231,236,245,0.65)" style="pointer-events:none;">${total || ''}</text>
      </g>`;
    }).join('');
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">${cells}</svg>`;
  }

  let snapshot = null;
  let selectedState = null;
  let allNews = [];
  let allAdvisories = [];

  function fmtTs(ts) {
    if (!ts) return '—';
    try { return new Date(ts).toISOString().slice(0, 16).replace('T',' '); } catch { return String(ts).slice(0, 16); }
  }

  function renderStats() {
    $('#statTotal').textContent = (snapshot.totals?.cases_all_time ?? 0).toLocaleString();
    $('#statStates').textContent = (snapshot.stateRollup || []).filter(r => (r.total || 0) > 0).length || (snapshot.totals?.states_with_cases ?? 0);
    const lr = snapshot.lastRun?.ts || snapshot.generatedAt;
    $('#statLastRun').textContent = fmtTs(lr);
  }

  function renderMap() {
    const byState = {};
    for (const r of (snapshot.stateRollup || [])) {
      if (r.state_code) byState[r.state_code] = { state: r.state, total: r.total };
    }
    const svgEl = $('#hvMap');
    svgEl.innerHTML = buildSvg(byState);
    // Click-to-filter
    svgEl.querySelectorAll('path[data-state]').forEach(p => {
      p.addEventListener('click', () => {
        const code = p.getAttribute('data-state');
        selectedState = (selectedState === code) ? null : code;
        svgEl.querySelectorAll('path[data-state]').forEach(x => x.setAttribute('data-selected', x.getAttribute('data-state') === selectedState ? 'true' : 'false'));
        renderTable();
        renderNews();
        $('#newsTitle').textContent = selectedState ? `News for ${selectedState} (last 90 days)` : 'News (last 90 days)';
      });
    });
  }

  function renderTable() {
    const tbody = $('#hvStateBody');
    const rows = (snapshot.stateRollup || []).filter(r => r.state_code).slice();
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="hv-empty">No case counts parsed yet. Run TCG-Hantavirus-Daily or check the data sources.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => {
      const active = selectedState === r.state_code ? 'active' : '';
      return `<tr class="${active}" data-state="${r.state_code}">
        <td>${escapeHtml(r.state || '')}</td>
        <td>${escapeHtml(r.state_code || '')}</td>
        <td style="text-align:right; font-variant-numeric: tabular-nums;">${(r.total || 0).toLocaleString()}</td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('tr[data-state]').forEach(tr => {
      tr.addEventListener('click', () => {
        const code = tr.getAttribute('data-state');
        selectedState = (selectedState === code) ? null : code;
        renderMap();
        renderTable();
        renderNews();
        $('#newsTitle').textContent = selectedState ? `News for ${selectedState} (last 90 days)` : 'News (last 90 days)';
      });
    });
  }

  function renderAdvisories() {
    const ul = $('#hvAdvisories');
    const items = allAdvisories;
    if (!items.length) { ul.innerHTML = '<li class="hv-empty">No advisories captured yet.</li>'; return; }
    ul.innerHTML = items.map(a => `
      <li>
        <a href="${escapeAttr(a.url || '#')}" target="_blank" rel="noopener">${escapeHtml(a.title || a.url || '(untitled)')}</a>
        <div class="meta">
          <span class="pill info">${escapeHtml(a.source || 'CDC')}</span>
          ${a.severity ? `<span class="pill">${escapeHtml(a.severity)}</span>` : ''}
          <span>${fmtTs(a.ts || a.fetched_at)}</span>
        </div>
      </li>`).join('');
  }

  function renderNews() {
    const ul = $('#hvNews');
    let items = allNews;
    if (selectedState) items = items.filter(n => (n.mentioned_states || []).includes(selectedState));
    if (!items.length) { ul.innerHTML = '<li class="hv-empty">No news matched the current filter.</li>'; return; }
    ul.innerHTML = items.slice(0, 50).map(n => `
      <li>
        <a href="${escapeAttr(n.url || '#')}" target="_blank" rel="noopener">${escapeHtml(n.headline || n.url || '(no title)')}</a>
        <div class="meta">
          <span class="pill info">${escapeHtml(n.publisher || '')}</span>
          ${(n.mentioned_states || []).slice(0,4).map(s => `<span class="pill state">${escapeHtml(s)}</span>`).join('')}
          <span>${fmtTs(n.published_at || n.fetched_at)}</span>
        </div>
      </li>`).join('');
  }

  function renderNewsFilters() {
    // Build filter chips from states that appear in news
    const seen = new Set();
    for (const n of allNews) {
      for (const s of (n.mentioned_states || [])) if (s) seen.add(s);
    }
    const states = Array.from(seen).sort();
    const row = $('#hvNewsFilter');
    row.innerHTML = `<button class="${selectedState ? '' : 'active'}" data-state="">All states</button>` +
      states.map(s => `<button class="${selectedState===s?'active':''}" data-state="${escapeAttr(s)}">${escapeHtml(s)}</button>`).join('');
    row.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        selectedState = b.getAttribute('data-state') || null;
        renderMap();
        renderTable();
        renderNews();
        renderNewsFilters();
        $('#newsTitle').textContent = selectedState ? `News for ${selectedState} (last 90 days)` : 'News (last 90 days)';
      });
    });
  }

  function applySnapshot(s) {
    snapshot = s || { totals: {}, stateRollup: [], recentAdvisories: [], recentNews: [] };
    allNews = snapshot.recentNews || [];
    allAdvisories = snapshot.recentAdvisories || [];
    renderStats();
    renderMap();
    renderTable();
    renderAdvisories();
    renderNews();
    renderNewsFilters();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // 1. Pre-render from local JSON (instant)
  fetch(LOCAL_JSON, { cache: 'no-cache' })
    .then(r => r.ok ? r.json() : null)
    .then(j => { if (j) applySnapshot(j); })
    .catch(() => { /* swallow — we'll try API */ })
    .finally(() => {
      // 2. Refresh from API if reachable
      fetch(`${API_BASE}/snapshot`, { cache: 'no-cache' })
        .then(r => r.ok ? r.json() : null)
        .then(j => { if (j && j.ok && j.hv_db) applySnapshot(j); })
        .catch(() => { /* offline-OK; keep local snapshot */ });
    });

  // === Hantavirus live panel ===========================================
  // Pulls two streams every hour:
  //   1. Fabric REST endpoint /cases — server-side aggregated cases.
  //      May 401 when the local admin token has expired; we degrade
  //      silently to events.json + still show CDC situation summary.
  //   2. ./data/events.json — the nightly scraper output filtered to
  //      virus === 'hantavirus' (includes CDC-Hantavirus situation
  //      summary, NNDSS HPS counts, WHO DON hantavirus alerts, etc.).
  const HV_LIVE_REFRESH_MS = 60 * 60 * 1000;
  const HV_EVENTS_URL = './data/events.json';

  function renderHvLive(items, fetchedAt) {
    const ul = document.getElementById('hvLive');
    if (!ul) return;
    document.getElementById('hvLiveTs').textContent = fmtTs(fetchedAt);
    if (!items.length) {
      ul.innerHTML = '<li class="hv-empty">No live hantavirus signal at this moment. Most recent fabric refresh shown above.</li>';
      return;
    }
    ul.innerHTML = items.slice(0, 25).map(it => `
      <li>
        <a href="${escapeAttr(it.url || '#')}" target="_blank" rel="noopener">${escapeHtml(it.title || '(untitled)')}</a>
        <div class="meta">
          <span class="pill info">${escapeHtml(it.source || '')}</span>
          ${it.status ? `<span class="pill">${escapeHtml(it.status)}</span>` : ''}
          ${it.state ? `<span class="pill state">${escapeHtml(it.state)}</span>` : ''}
          <span>${fmtTs(it.ts)}</span>
        </div>
        ${it.summary ? `<div style="margin-top:0.35rem; color:var(--muted); font-size:0.85rem;">${escapeHtml(it.summary).slice(0, 320)}</div>` : ''}
      </li>`).join('');
  }

  async function loadHvLive() {
    const merged = [];
    const fetchedAt = new Date().toISOString();

    // Fabric endpoint — best-effort. /cases is the most useful sub-route.
    try {
      const r = await fetch(`${API_BASE}/cases`, { cache: 'no-cache' });
      if (r.ok) {
        const j = await r.json();
        const cases = Array.isArray(j) ? j : (j.cases || j.items || []);
        for (const c of cases.slice(0, 40)) {
          merged.push({
            title: c.title || c.headline || `Hantavirus case — ${c.state || c.region || 'US'}`,
            summary: c.summary || c.body_md || '',
            url: c.url || c.source_url || 'https://api.thatcomputerguy26.org/api/public/hantavirus/cases',
            source: 'TCG fabric (live)',
            state: c.state || c.state_code || null,
            status: c.status || null,
            ts: c.ts || c.reported_at || c.fetched_at || fetchedAt,
          });
        }
      }
    } catch (e) { /* offline-OK */ }

    // Local events.json — always available after a successful nightly
    // scrape. Filter to hantavirus events and the CDC-Hantavirus source
    // (which always carries virus === 'hantavirus').
    try {
      const r = await fetch(HV_EVENTS_URL, { cache: 'no-cache' });
      if (r.ok) {
        const all = await r.json();
        const hv = all.filter(e => e.virus === 'hantavirus' || (e.source_id || '').includes('hantavirus'));
        // Sort newest first.
        hv.sort((a, b) => (Date.parse(b.report_date || 0)) - (Date.parse(a.report_date || 0)));
        for (const e of hv.slice(0, 25)) {
          merged.push({
            title: e.title,
            summary: e.summary,
            url: e.source_url,
            source: e.source,
            state: e.region && e.region.length < 25 ? e.region : null,
            status: e.status,
            ts: e.report_date,
          });
        }
      }
    } catch (e) { /* offline-OK */ }

    // De-dupe by title+url, keep newest order.
    const seen = new Set();
    const unique = merged.filter(m => {
      const k = `${m.title}|${m.url}`;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    renderHvLive(unique, fetchedAt);
  }

  loadHvLive();
  setInterval(loadHvLive, HV_LIVE_REFRESH_MS);
})();
