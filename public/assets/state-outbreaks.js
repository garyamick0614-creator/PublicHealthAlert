// PublicHealthAlert — Per-State Outbreak Map
// iter12-pha-state-outbreaks · 2026-05-12
//
// Renders an 8-state grid showing latest reported per-state outbreak data
// from /api/public/pha/state-outbreaks. Includes a state dropdown filter and
// an honesty caveat (most state DPH pages are JS dashboards we can't scrape).
//
// MARKER: iter12-pha-state-outbreaks

(function () {
  const API = "https://api.thatcomputerguy26.org";
  const URL = API + "/api/public/pha/state-outbreaks?since-weeks=52";
  const REFRESH_MS = 60 * 60 * 1000; // hourly
  const STATES = ["CA", "TX", "FL", "NY", "IL", "IN", "OH", "MI"];
  let backoff = 0;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function buildBlock() {
    const main = document.querySelector("main.container");
    if (!main) return null;
    const wrap = document.createElement("section");
    wrap.className = "section";
    wrap.id = "stateOutbreaksBlock";
    wrap.setAttribute("data-marker", "iter12-pha-state-outbreaks");
    wrap.innerHTML = `
      <header class="section-head">
        <div>
          <h2 class="section-title">Per-State Outbreak Map</h2>
          <div class="section-subtitle">Latest reported per-state outbreak signals for ${STATES.length} watch states. <span id="stateOutbreaksUpdated" class="muted"></span></div>
        </div>
        <label class="muted" style="display:flex;align-items:center;gap:6px;font-size:.85rem;">
          State:
          <select id="stateOutbreaksFilter" style="background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.1);color:var(--text);border-radius:6px;padding:4px 8px;">
            <option value="all">All ${STATES.length}</option>
            ${STATES.map(s => `<option value="${s}">${s}</option>`).join("")}
          </select>
        </label>
      </header>
      <div id="stateOutbreaksGrid" class="virus-grid"></div>
      <p class="muted small" style="margin-top:10px;line-height:1.5;">
        <strong>Note on coverage:</strong> Per-state outbreak data is sparse — most state DPH (Department of Public Health) sites publish their data via JavaScript-rendered dashboards
        that the nightly scraper can't reliably parse. The tiles below show the most recent reported records ingested from CDC/state sources. Many state-level rows
        carry a national CDC attribution rather than precise per-state counts. We'll deepen this as more state endpoints become machine-readable.
      </p>
    `;
    main.appendChild(wrap);
    return wrap;
  }

  function row(k, v) {
    return `<div style="display:flex;justify-content:space-between;gap:8px;font-size:.85rem;padding:3px 0;border-bottom:1px dashed var(--border);">
      <span style="color:var(--text-muted);">${esc(k)}</span><span style="font-variant-numeric:tabular-nums;">${v}</span></div>`;
  }

  function tile(rec, stateCode) {
    const tileBase = "padding:0.9rem 1rem;background:var(--bg-1);border:1px solid var(--border);border-radius:var(--radius);";
    if (!rec) {
      return `
        <article style="${tileBase}opacity:0.55;">
          <header style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <span class="status-pill" data-status="stale" style="font-weight:700;">${esc(stateCode)}</span>
            <span class="muted" style="font-size:.75rem;">No recent report</span>
          </header>
          <div class="muted" style="margin-top:8px;font-size:.8rem;">No outbreak record currently indexed for this state in the last 52 weeks.</div>
        </article>`;
    }
    const cb = rec.county_breakdown || {};
    const isNational = cb._source === "cdc-national";
    const cases = rec.cases != null
      ? rec.cases
      : (cb.national_cases != null ? cb.national_cases : "—");
    const deaths = rec.deaths != null
      ? rec.deaths
      : (cb.national_deaths != null ? cb.national_deaths : "—");
    const hosp = rec.hospitalizations != null
      ? rec.hospitalizations
      : (cb.national_hospitalized != null ? cb.national_hospitalized : "—");
    const attribLabel = isNational ? "CDC national" : "state-reported";
    const labelClass = isNational ? "stale" : "ok";
    return `
      <article style="${tileBase}">
        <header style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <span class="status-pill" data-status="ok" style="font-weight:700;"><span class="status-dot"></span>${esc(stateCode)}</span>
          <span class="status-pill" data-status="${labelClass}" style="font-size:.7rem;"><span class="status-dot"></span>${esc(attribLabel)}</span>
        </header>
        <h3 style="margin:8px 0 6px;text-transform:capitalize;font-size:1.05rem;font-weight:600;">${esc(rec.condition || "—")}</h3>
        ${row("Week ending", esc(fmtDate(rec.week_ending)))}
        ${row("Cases", `<strong>${esc(cases)}</strong>`)}
        ${row("Hospitalizations", esc(hosp))}
        ${row("Deaths", esc(deaths))}
        ${rec.source_url ? `<div style="margin-top:8px;"><a class="btn btn-ghost" href="${esc(rec.source_url)}" target="_blank" rel="noopener" style="font-size:.8rem;">Source →</a></div>` : ""}
      </article>`;
  }

  function pickLatestByState(items) {
    // Group by state, keep newest by fetched_at (fall back to id)
    const byState = new Map();
    for (const it of items) {
      const k = it.state;
      if (!k) continue;
      const cur = byState.get(k);
      if (!cur) { byState.set(k, it); continue; }
      const ta = Date.parse(it.fetched_at || 0) || it.id || 0;
      const tb = Date.parse(cur.fetched_at || 0) || cur.id || 0;
      if (ta > tb) byState.set(k, it);
    }
    return byState;
  }

  function render(items) {
    const grid = document.getElementById("stateOutbreaksGrid");
    if (!grid) return;
    const filt = (document.getElementById("stateOutbreaksFilter") || {}).value || "all";
    const map = pickLatestByState(items);
    const states = filt === "all" ? STATES : [filt];
    grid.innerHTML = states.map(s => tile(map.get(s), s)).join("");
    const u = document.getElementById("stateOutbreaksUpdated");
    if (u) u.textContent = "Last refreshed " + new Date().toLocaleTimeString();
  }

  async function fetchData() {
    try {
      const r = await fetch(URL, { cache: "no-store" });
      if (r.status === 429) {
        backoff = Math.min(60000, (backoff || 5000) * 2);
        setTimeout(fetchData, backoff);
        return;
      }
      backoff = 0;
      if (!r.ok) {
        const grid = document.getElementById("stateOutbreaksGrid");
        if (grid) grid.innerHTML = '<div class="muted" style="color:#fda4af">State outbreaks feed returned ' + r.status + '</div>';
        return;
      }
      const d = await r.json();
      const items = Array.isArray(d.items) ? d.items : [];
      render(items);
    } catch (e) {
      const grid = document.getElementById("stateOutbreaksGrid");
      if (grid) grid.innerHTML = '<div class="muted" style="color:#fda4af">' + esc(e.message) + '</div>';
    }
  }

  function init() {
    if (!document.querySelector("main.container")) return;
    if (document.getElementById("stateOutbreaksBlock")) return;
    buildBlock();
    const sel = document.getElementById("stateOutbreaksFilter");
    if (sel) sel.addEventListener("change", fetchData);
    fetchData();
    setInterval(fetchData, REFRESH_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
