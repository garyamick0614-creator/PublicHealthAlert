// PublicHealthAlert — live deep outbreak feed + H5N1 dairy watch
// iter6-pha-deep-live · 2026-05-11
//
// Renders two sections appended to <main> on the home page:
//   1) "Deep Outbreak Feed" — live snapshot of pha.db (advisories/court/news)
//      Source dropdown filter, 15 rows/panel, 30-min auto-refresh, 429 backoff.
//   2) "H5N1 Dairy Watch" — empty-state explainer + auto-fill when USDA flows.
//
// Endpoints (api.thatcomputerguy26.org):
//   GET /api/public/pha/deep/snapshot
//   GET /api/public/pha/h5n1-dairy?limit=30
//
// CSP: connect-src already permits api.thatcomputerguy26.org (visitor badge).
// MARKER: iter6-pha-deep-live

(function () {
  const API = "https://api.thatcomputerguy26.org";
  const SNAPSHOT_URL = API + "/api/public/pha/deep/snapshot";
  const H5N1_URL     = API + "/api/public/pha/h5n1-dairy?limit=30";
  const REFRESH_MS   = 30 * 60 * 1000;  // 30 min
  const LIMIT_PER_PANEL = 15;
  let backoff = 0;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmtRel(iso) {
    if (!iso) return "";
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return "";
    const diff = Date.now() - t;
    const mins = Math.round(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + " min ago";
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    const days = Math.round(hrs / 24);
    if (days < 30) return days + "d ago";
    return new Date(t).toISOString().slice(0, 10);
  }

  function buildBlock() {
    const main = document.querySelector("main.container");
    if (!main) return null;
    const wrap = document.createElement("section");
    wrap.className = "section";
    wrap.id = "liveDeepFeedBlock";
    wrap.setAttribute("data-marker", "iter6-pha-deep-live");
    wrap.innerHTML = `
      <header class="section-head">
        <div>
          <h2 class="section-title">Deep Outbreak Feed</h2>
          <div class="section-subtitle">Live from <code>pha.db</code> — federal/state advisories, public-health litigation, and curated news. Auto-refresh every 30 min. <span id="liveDeepUpdated" class="muted"></span></div>
        </div>
        <label class="muted" style="display:flex;align-items:center;gap:6px;font-size:.85rem;">
          Source:
          <select id="liveDeepSourceFilter" style="background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.1);color:var(--text);border-radius:6px;padding:4px 8px;">
            <option value="all">All</option>
            <option value="cdc">CDC</option>
            <option value="fda">FDA</option>
            <option value="idoh">IDOH</option>
            <option value="state">Other state</option>
          </select>
        </label>
      </header>
      <div class="ldf-grid">
        <article class="panel" data-ldf="advisories">
          <header class="panel-header">
            <h3 class="panel-title">Advisories</h3>
            <span class="status-pill" id="ldfAdvCount" data-status="ok"><span class="status-dot"></span><span class="status-text">—</span></span>
          </header>
          <ul class="ldf-list" id="ldfAdvList"><li class="ldf-empty">Loading…</li></ul>
        </article>
        <article class="panel" data-ldf="court">
          <header class="panel-header">
            <h3 class="panel-title">Court Cases</h3>
            <span class="status-pill" id="ldfCourtCount" data-status="ok"><span class="status-dot"></span><span class="status-text">—</span></span>
          </header>
          <ul class="ldf-list" id="ldfCourtList"><li class="ldf-empty">Loading…</li></ul>
        </article>
        <article class="panel" data-ldf="news">
          <header class="panel-header">
            <h3 class="panel-title">News</h3>
            <span class="status-pill" id="ldfNewsCount" data-status="ok"><span class="status-dot"></span><span class="status-text">—</span></span>
          </header>
          <ul class="ldf-list" id="ldfNewsList"><li class="ldf-empty">Loading…</li></ul>
        </article>
      </div>

      <header class="section-head" style="margin-top:24px;">
        <div>
          <h2 class="section-title">H5N1 Dairy Watch</h2>
          <div class="section-subtitle">Live detections in U.S. dairy cattle, sourced from USDA APHIS. <span id="h5n1Updated" class="muted"></span></div>
        </div>
      </header>
      <article class="panel" data-ldf="h5n1">
        <div id="h5n1Body" class="ldf-h5n1">Loading…</div>
      </article>

      <style>
        #liveDeepFeedBlock .ldf-grid { display:grid; gap:16px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
        #liveDeepFeedBlock .ldf-list { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:8px; }
        #liveDeepFeedBlock .ldf-list li { padding:8px 10px; border-radius:8px; background:rgba(255,255,255,.02); }
        #liveDeepFeedBlock .ldf-list li.ldf-empty { color:var(--muted); font-style:italic; padding:14px 10px; text-align:center; }
        #liveDeepFeedBlock .ldf-list li a { color:var(--text); text-decoration:none; font-weight:600; line-height:1.35; display:block; }
        #liveDeepFeedBlock .ldf-list li a:hover { color:var(--accent); text-decoration:underline; }
        #liveDeepFeedBlock .ldf-list li .meta { color:var(--muted); font-size:.8rem; margin-top:4px; display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
        #liveDeepFeedBlock .ldf-sev-critical { background:rgba(244,63,94,.15); color:#f43f5e; padding:1px 6px; border-radius:99px; font-size:.7rem; font-weight:700; letter-spacing:.04em; }
        #liveDeepFeedBlock .ldf-sev-warn { background:rgba(245,158,11,.15); color:#f59e0b; padding:1px 6px; border-radius:99px; font-size:.7rem; font-weight:700; }
        #liveDeepFeedBlock .ldf-sev-info { background:rgba(255,255,255,.05); color:var(--muted); padding:1px 6px; border-radius:99px; font-size:.7rem; }
        #liveDeepFeedBlock .ldf-h5n1 { padding:6px; color:var(--text); line-height:1.55; }
        #liveDeepFeedBlock .ldf-h5n1 .empty-note { padding:18px; border:1px dashed rgba(255,255,255,.12); border-radius:8px; background:rgba(255,255,255,.02); color:var(--muted); }
        #liveDeepFeedBlock .ldf-h5n1 .empty-note strong { color:var(--text); }
        #liveDeepFeedBlock .ldf-h5n1 table { width:100%; border-collapse:collapse; font-size:13px; }
        #liveDeepFeedBlock .ldf-h5n1 th, #liveDeepFeedBlock .ldf-h5n1 td { padding:8px 10px; border-bottom:1px solid rgba(255,255,255,.06); text-align:left; }
        #liveDeepFeedBlock .ldf-h5n1 th { color:var(--muted); font-size:.75rem; letter-spacing:.06em; text-transform:uppercase; }
      </style>
    `;
    main.appendChild(wrap);
    return wrap;
  }

  function classifySource(src) {
    const s = String(src || "").toLowerCase();
    if (s.includes("cdc")) return "cdc";
    if (s.includes("fda")) return "fda";
    if (s.includes("idoh") || s.includes("indiana")) return "idoh";
    if (s.includes("state") || /^[a-z]{2}-/i.test(s)) return "state";
    return "other";
  }

  let LAST_SNAP = null;

  function setPill(id, n, ok) {
    const el = document.getElementById(id);
    if (!el) return;
    const t = el.querySelector(".status-text");
    if (t) t.textContent = n + " item" + (n === 1 ? "" : "s");
    el.dataset.status = ok ? "ok" : "warn";
  }

  function renderSnapshot() {
    if (!LAST_SNAP) return;
    const filter = (document.getElementById("liveDeepSourceFilter") || {}).value || "all";
    const matches = (src) => filter === "all" ? true : classifySource(src) === filter;

    const adv = (LAST_SNAP.advisories || []).filter((a) => matches(a.source)).slice(0, LIMIT_PER_PANEL);
    const court = (LAST_SNAP.court_cases || []).filter((c) => matches(c.court_id)).slice(0, LIMIT_PER_PANEL);
    const news = (LAST_SNAP.news || []).filter((n) => matches(n.publisher || n.source)).slice(0, LIMIT_PER_PANEL);

    setPill("ldfAdvCount", adv.length, adv.length > 0);
    setPill("ldfCourtCount", court.length, court.length > 0);
    setPill("ldfNewsCount", news.length, news.length > 0);

    const advHtml = adv.length ? adv.map((a) => {
      const sev = String(a.severity || "info").toLowerCase();
      const sevClass = sev === "critical" ? "ldf-sev-critical" : (sev === "warn" || sev === "warning" ? "ldf-sev-warn" : "ldf-sev-info");
      return `<li>
        <a href="${esc(a.url || "#")}" target="_blank" rel="noopener noreferrer">${esc(a.title || "(untitled)")}</a>
        <div class="meta"><span class="${sevClass}">${esc(sev.toUpperCase())}</span><span>${esc(a.source || "")}</span><span>${esc(fmtRel(a.fetched_at || a.ts))}</span></div>
      </li>`;
    }).join("") : '<li class="ldf-empty">No advisories for this filter.</li>';
    document.getElementById("ldfAdvList").innerHTML = advHtml;

    const courtHtml = court.length ? court.map((c) => `
      <li>
        <a href="${esc(c.html_url || c.url || "#")}" target="_blank" rel="noopener noreferrer">${esc(c.case_name || c.title || "(untitled)")}</a>
        <div class="meta"><span class="ldf-sev-info">COURT</span><span>${esc(c.court_id || "")}</span><span>${esc(c.date_filed || fmtRel(c.fetched_at))}</span></div>
      </li>
    `).join("") : '<li class="ldf-empty">No court cases for this filter.</li>';
    document.getElementById("ldfCourtList").innerHTML = courtHtml;

    const newsHtml = news.length ? news.map((n) => `
      <li>
        <a href="${esc(n.url || "#")}" target="_blank" rel="noopener noreferrer">${esc(n.headline || n.title || "(untitled)")}</a>
        <div class="meta"><span class="ldf-sev-info">NEWS</span><span>${esc(n.publisher || n.source || "")}</span><span>${esc(fmtRel(n.published_at || n.fetched_at))}</span></div>
      </li>
    `).join("") : '<li class="ldf-empty">No news for this filter.</li>';
    document.getElementById("ldfNewsList").innerHTML = newsHtml;

    const upd = document.getElementById("liveDeepUpdated");
    if (upd && LAST_SNAP.fetchedAt) upd.textContent = "Live snapshot · " + fmtRel(LAST_SNAP.fetchedAt) + ".";
  }

  async function fetchWithBackoff(url) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (r.status === 429) {
        backoff = Math.min(60_000, (backoff || 5_000) * 2);
        setTimeout(() => fetchSnapshot(), backoff);
        return null;
      }
      backoff = 0;
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      backoff = Math.min(60_000, (backoff || 5_000) * 2);
      return null;
    }
  }

  async function fetchSnapshot() {
    const j = await fetchWithBackoff(SNAPSHOT_URL);
    if (j && j.ok) {
      LAST_SNAP = j;
      renderSnapshot();
    }
  }

  async function fetchH5N1() {
    const body = document.getElementById("h5n1Body");
    if (!body) return;
    const j = await fetchWithBackoff(H5N1_URL);
    if (!j) {
      body.innerHTML = '<div class="empty-note">Feed temporarily unavailable. Will retry next refresh cycle.</div>';
      return;
    }
    const items = Array.isArray(j.items) ? j.items : [];
    const totals = j.totals || {};
    if (items.length === 0) {
      body.innerHTML = `
        <div class="empty-note">
          <strong>No detections currently in the feed.</strong><br><br>
          USDA APHIS publishes H5N1 dairy cattle detections via a Tableau visualization only — no public REST endpoint. The fetcher is shipped and the API contract is ready; once a structured source is unblocked, this panel will auto-fill with date / state / premises affected.<br><br>
          Authoritative source: <a href="https://www.aphis.usda.gov/livestock-poultry-disease/avian/avian-influenza/hpai-detections/livestock" target="_blank" rel="noopener noreferrer">USDA APHIS — HPAI in Livestock</a>
        </div>`;
      return;
    }
    body.innerHTML = `
      <div class="meta" style="display:flex;gap:14px;margin-bottom:10px;font-size:.85rem;color:var(--muted)">
        <span><strong style="color:var(--text)">${esc(totals.total_rows ?? items.length)}</strong> detections</span>
        <span><strong style="color:var(--text)">${esc(totals.states_affected ?? "—")}</strong> states</span>
        <span><strong style="color:var(--text)">${esc(totals.premises_affected ?? "—")}</strong> premises</span>
        <span>latest detection on record: ${esc(totals.latest_date || "—")}</span>
      </div>
      <table>
        <thead><tr><th>Date</th><th>State</th><th>County</th><th>Premises</th><th>Notes</th></tr></thead>
        <tbody>
          ${items.slice(0, 30).map((r) => `
            <tr>
              <td>${esc(r.detection_date || r.date || "—")}</td>
              <td>${esc(r.state || "—")}</td>
              <td>${esc(r.county || "—")}</td>
              <td>${esc(r.premises_type || r.premises || "—")}</td>
              <td>${esc(r.notes || r.flock_type || "")}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    `;
    const upd = document.getElementById("h5n1Updated");
    if (upd) upd.textContent = "USDA APHIS source · last sync " + fmtRel(j.fetchedAt || new Date().toISOString()) + ".";
  }

  function init() {
    const wrap = buildBlock();
    if (!wrap) return;
    document.getElementById("liveDeepSourceFilter").addEventListener("change", renderSnapshot);
    fetchSnapshot();
    fetchH5N1();
    setInterval(fetchSnapshot, REFRESH_MS);
    setInterval(fetchH5N1, REFRESH_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
