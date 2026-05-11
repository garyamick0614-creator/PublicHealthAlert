// PublicHealthAlert — deep-fill panels (additive)
//
// Reads the consolidated deep snapshot at ./data/deep-snapshot.json (written
// daily by H:\TCG Group\TCGBatch\pha-deep-fill.mjs) and renders four new
// panels into a container appended at the end of <main>:
//
//   1) Outbreaks by condition
//   2) State advisories
//   3) Federal court — public-health litigation (CourtListener)
//   4) National health news
//
// Each panel paginates client-side (20 items / page) with prev/next buttons.
// If the snapshot is missing or empty, the whole block is hidden gracefully.
// Styles reuse the existing CSS variables (--text, --muted, --panel-bg, etc.)
// so the panels look native to the site.

const SNAPSHOT_URL = "./data/deep-snapshot.json";
const PAGE_SIZE = 20;

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
function fmtRel(iso) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return mins <= 1 ? "just now" : `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const d = new Date(t);
  return d.toISOString().slice(0, 10);
}

function buildContainer() {
  const main = document.querySelector("main.container");
  if (!main) return null;
  const wrap = document.createElement("section");
  wrap.className = "section";
  wrap.id = "deepFillBlock";
  wrap.setAttribute("aria-labelledby", "deepFillTitle");
  wrap.innerHTML = `
    <header class="section-head">
      <div>
        <h2 id="deepFillTitle" class="section-title">Deep signal feeds</h2>
        <div class="section-subtitle">Daily firecrawl pass over CDC, FDA, state health departments, CourtListener, and curated health newsrooms. <span id="deepFillRunAt" class="muted"></span></div>
      </div>
    </header>
    <div class="deep-grid">
      <article class="panel" data-deep="advisories">
        <header class="panel-header">
          <h3 class="panel-title">Federal &amp; state advisories</h3>
          <span class="status-pill" id="deepAdvCount" data-status="ok"><span class="status-dot"></span><span class="status-text">—</span></span>
        </header>
        <ul class="deep-list" id="deepAdvList"></ul>
        <footer class="deep-pager" data-pager="adv">
          <button type="button" data-act="prev">‹ Prev</button>
          <span class="muted" data-page-label></span>
          <button type="button" data-act="next">Next ›</button>
        </footer>
      </article>

      <article class="panel" data-deep="cases">
        <header class="panel-header">
          <h3 class="panel-title">Federal court — public-health litigation</h3>
          <span class="status-pill" id="deepCaseCount" data-status="ok"><span class="status-dot"></span><span class="status-text">—</span></span>
        </header>
        <ul class="deep-list" id="deepCaseList"></ul>
        <footer class="deep-pager" data-pager="cases">
          <button type="button" data-act="prev">‹ Prev</button>
          <span class="muted" data-page-label></span>
          <button type="button" data-act="next">Next ›</button>
        </footer>
      </article>

      <article class="panel" data-deep="news">
        <header class="panel-header">
          <h3 class="panel-title">National health newsrooms</h3>
          <span class="status-pill" id="deepNewsCount" data-status="ok"><span class="status-dot"></span><span class="status-text">—</span></span>
        </header>
        <ul class="deep-list" id="deepNewsList"></ul>
        <footer class="deep-pager" data-pager="news">
          <button type="button" data-act="prev">‹ Prev</button>
          <span class="muted" data-page-label></span>
          <button type="button" data-act="next">Next ›</button>
        </footer>
      </article>

      <article class="panel" data-deep="outbreaks">
        <header class="panel-header">
          <h3 class="panel-title">Outbreaks by condition</h3>
          <span class="status-pill" id="deepObCount" data-status="ok"><span class="status-dot"></span><span class="status-text">—</span></span>
        </header>
        <ul class="deep-list" id="deepObList"></ul>
        <footer class="deep-pager" data-pager="outbreaks">
          <button type="button" data-act="prev">‹ Prev</button>
          <span class="muted" data-page-label></span>
          <button type="button" data-act="next">Next ›</button>
        </footer>
      </article>
    </div>
    <style>
      #deepFillBlock .deep-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); }
      #deepFillBlock .deep-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; min-height: 200px; }
      #deepFillBlock .deep-list li { padding: 8px 10px; border-radius: 8px; background: rgba(255,255,255,0.02); }
      #deepFillBlock .deep-list li a { color: var(--text); text-decoration: none; font-weight: 600; line-height: 1.35; display: block; }
      #deepFillBlock .deep-list li a:hover { color: var(--accent); text-decoration: underline; }
      #deepFillBlock .deep-list li .meta { color: var(--muted); font-size: 0.82rem; margin-top: 4px; display: flex; gap: 8px; flex-wrap: wrap; }
      #deepFillBlock .deep-list li .sev-critical { color: #f43f5e; font-weight: 700; }
      #deepFillBlock .deep-list li .sev-warn { color: #f59e0b; font-weight: 700; }
      #deepFillBlock .deep-list li .sev-info { color: var(--muted); }
      #deepFillBlock .deep-pager { display: flex; justify-content: space-between; align-items: center; padding-top: 10px; gap: 8px; }
      #deepFillBlock .deep-pager button { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); color: var(--text); padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; }
      #deepFillBlock .deep-pager button:hover:not(:disabled) { background: rgba(45,212,191,0.15); border-color: var(--accent); }
      #deepFillBlock .deep-pager button:disabled { opacity: 0.4; cursor: not-allowed; }
      #deepFillBlock .muted { color: var(--muted); font-size: 0.82rem; }
    </style>
  `;
  main.appendChild(wrap);
  return wrap;
}

function paginator(panelKey, items, render) {
  let page = 0;
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const pager = document.querySelector(`[data-pager="${panelKey}"]`);
  if (!pager) return;
  const prevBtn = pager.querySelector('[data-act="prev"]');
  const nextBtn = pager.querySelector('[data-act="next"]');
  const label   = pager.querySelector('[data-page-label]');
  function paint() {
    const start = page * PAGE_SIZE;
    const slice = items.slice(start, start + PAGE_SIZE);
    render(slice);
    if (label) label.textContent = `Page ${page + 1} of ${pages} · ${items.length} items`;
    if (prevBtn) prevBtn.disabled = page === 0;
    if (nextBtn) nextBtn.disabled = page >= pages - 1;
  }
  prevBtn?.addEventListener("click", () => { if (page > 0) { page--; paint(); } });
  nextBtn?.addEventListener("click", () => { if (page < pages - 1) { page++; paint(); } });
  paint();
}

function setPill(elId, count, ok) {
  const el = document.getElementById(elId);
  if (!el) return;
  const txt = el.querySelector(".status-text");
  if (txt) txt.textContent = `${count} item${count === 1 ? "" : "s"}`;
  el.dataset.status = ok ? "ok" : "warn";
}

(async function initDeepPanels() {
  let snap = null;
  try {
    const r = await fetch(SNAPSHOT_URL, { cache: "no-store" });
    if (!r.ok) return;
    snap = await r.json();
  } catch { return; }
  if (!snap || !snap.counts) return;
  const total = (snap.counts.advisories || 0) + (snap.counts.court_cases || 0) + (snap.counts.news || 0) + (snap.counts.outbreaks || 0);
  if (total === 0) return;

  const wrap = buildContainer();
  if (!wrap) return;

  const runAt = document.getElementById("deepFillRunAt");
  if (runAt) {
    const ts = snap.generated_at;
    runAt.textContent = ts ? `Last harvested ${fmtRel(ts)}.` : "";
  }

  // Advisories
  const advisories = Array.isArray(snap.advisories) ? snap.advisories : [];
  setPill("deepAdvCount", advisories.length, advisories.length > 0);
  paginator("adv", advisories, (slice) => {
    document.getElementById("deepAdvList").innerHTML = slice.map((a) => `
      <li>
        <a href="${escapeAttr(a.url || "#")}" target="_blank" rel="noopener noreferrer">${escapeHtml(a.title || "(untitled)")}</a>
        <div class="meta">
          <span class="sev-${escapeAttr(a.severity || "info")}">${escapeHtml((a.severity || "info").toUpperCase())}</span>
          <span>${escapeHtml(a.source || "")}</span>
          <span>${escapeHtml(fmtRel(a.ts || a.fetched_at))}</span>
        </div>
      </li>
    `).join("");
  });

  // Court cases
  const cases = Array.isArray(snap.court_cases) ? snap.court_cases : [];
  setPill("deepCaseCount", cases.length, cases.length > 0);
  paginator("cases", cases, (slice) => {
    document.getElementById("deepCaseList").innerHTML = slice.map((c) => `
      <li>
        <a href="${escapeAttr(c.html_url || "#")}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.case_name || "(untitled)")}</a>
        <div class="meta">
          <span>${escapeHtml(c.court_id || "")}</span>
          <span>${escapeHtml(c.case_kind || "")}</span>
          <span>${escapeHtml(c.date_filed || "")}</span>
        </div>
      </li>
    `).join("");
  });

  // News
  const news = Array.isArray(snap.news) ? snap.news : [];
  setPill("deepNewsCount", news.length, news.length > 0);
  paginator("news", news, (slice) => {
    document.getElementById("deepNewsList").innerHTML = slice.map((n) => `
      <li>
        <a href="${escapeAttr(n.url || "#")}" target="_blank" rel="noopener noreferrer">${escapeHtml(n.headline || "(untitled)")}</a>
        <div class="meta">
          <span>${escapeHtml(n.publisher || n.source || "")}</span>
          <span>${escapeHtml(fmtRel(n.published_at || n.fetched_at))}</span>
        </div>
      </li>
    `).join("");
  });

  // Outbreaks
  const outbreaks = Array.isArray(snap.outbreaks) ? snap.outbreaks : [];
  setPill("deepObCount", outbreaks.length, outbreaks.length > 0);
  paginator("outbreaks", outbreaks, (slice) => {
    document.getElementById("deepObList").innerHTML = slice.map((o) => `
      <li>
        <a href="${escapeAttr(o.source_url || "#")}" target="_blank" rel="noopener noreferrer">${escapeHtml(o.condition || "(unknown)")} — ${escapeHtml(o.location_name || "")}</a>
        <div class="meta">
          <span>${escapeHtml(o.week_of || "")}</span>
          ${o.case_count ? `<span>cases: ${escapeHtml(o.case_count)}</span>` : ""}
          ${o.hospitalizations ? `<span>hosp: ${escapeHtml(o.hospitalizations)}</span>` : ""}
          ${o.deaths ? `<span>deaths: ${escapeHtml(o.deaths)}</span>` : ""}
          <span>${escapeHtml(o.source || "")}</span>
        </div>
      </li>
    `).join("");
  });
})();
