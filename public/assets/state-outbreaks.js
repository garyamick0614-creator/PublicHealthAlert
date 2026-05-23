// PublicHealthAlert — Per-State Outbreak Map
// iter12-pha-state-outbreaks   · 2026-05-12 (original)
// iter18-pha-cdc-fluview       · 2026-05-18 (federal-source rebuild)
//
// Renders an 8-state outbreak grid driven by federal CDC data:
//   • CDC FluView (per-state weekly ILI counts + wILI %)
//   • CDC NCHS r8kw-7aab (per-state weekly COVID/flu/pneumonia deaths)
//   • CDC RESP-NET kvib-3txy (per-state weekly hospitalization rates for
//     FluSurv-NET / COVID-NET / RSV-NET — catchment subset of state)
//
// Each tile = one (state, condition, source) latest weekly record. Tiles
// carry a small source badge naming the originating CDC endpoint and a
// rate-vs-count axis label where applicable.
//
// Data flow: TCG-PHA-CDC-FluView-Daily schtask (03:30) →
//            pha-cdc-fluview-fetcher.mjs →
//            pha.db pha_state_outbreaks →
//            /api/public/pha/state-outbreaks →
//            this renderer.
//
// MARKER: iter18-pha-cdc-fluview

(function () {
  const API = "https://api.thatcomputerguy26.org";
  const URL = API + "/api/public/pha/state-outbreaks?since-weeks=52&limit=500";
  const REFRESH_MS = 60 * 60 * 1000; // hourly
  const STATES = ["CA", "TX", "FL", "NY", "IL", "IN", "OH", "MI"];

  // Condition display ordering — most-prominent first. RESP-NET conditions
  // float to bottom because they carry rates not absolute counts.
  const CONDITION_ORDER = [
    "influenza", "covid-19", "pneumonia", "rsv",
    "measles", "pertussis", "mpox", "h5n1",
    "hepatitis-a", "norovirus", "tuberculosis",
  ];

  // Friendly display strings for source label + condition.
  const CONDITION_LABEL = {
    "influenza": "Influenza",
    "covid-19": "COVID-19",
    "pneumonia": "Pneumonia",
    "rsv": "RSV",
    "measles": "Measles",
    "pertussis": "Pertussis",
    "mpox": "Mpox",
    "h5n1": "H5N1 Avian Flu",
    "hepatitis-a": "Hepatitis A",
    "norovirus": "Norovirus",
    "tuberculosis": "Tuberculosis",
  };
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

  function fmtNum(n) {
    if (n === null || n === undefined) return "—";
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    if (Math.abs(v) >= 1000) return v.toLocaleString();
    return String(v);
  }

  function buildBlock() {
    const main = document.querySelector("main.container");
    if (!main) return null;
    const wrap = document.createElement("section");
    wrap.className = "section";
    wrap.id = "stateOutbreaksBlock";
    wrap.setAttribute("data-marker", "iter18-pha-cdc-fluview");
    wrap.innerHTML = `
      <header class="section-head">
        <div>
          <h2 class="section-title">Per-State Outbreak Map</h2>
          <div class="section-subtitle">
            Federally-sourced weekly outbreak signals for ${STATES.length} priority watch states.
            <span id="stateOutbreaksUpdated" class="muted"></span>
          </div>
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
        <strong>Methodology:</strong> Counts and rates pulled from
        <a href="https://api.delphi.cmu.edu/epidata/fluview/" target="_blank" rel="noopener">CDC FluView ILINet</a>,
        <a href="https://data.cdc.gov/NCHS/Provisional-COVID-19-Death-Counts-by-Week-Ending-D/r8kw-7aab" target="_blank" rel="noopener">CDC NCHS Provisional Death Counts</a>,
        and <a href="https://data.cdc.gov/Public-Health-Surveillance/Weekly-Rates-of-Laboratory-Confirmed-RSV-COVID-19-/kvib-3txy" target="_blank" rel="noopener">CDC RESP-NET (FluSurv-NET / COVID-NET / RSV-NET)</a>.
        Federal data lags 1–2 weeks behind real-time. RESP-NET catchment covers metro counties only in
        CA, NY, OH, MI — non-catchment states are shown without hospitalization rates.
        Refreshed daily at 03:30 by <code>TCG-PHA-CDC-FluView-Daily</code>.
      </p>
    `;
    main.appendChild(wrap);
    return wrap;
  }

  function row(k, v) {
    return `<div style="display:flex;justify-content:space-between;gap:8px;font-size:.85rem;padding:3px 0;border-bottom:1px dashed var(--border);">
      <span style="color:var(--text-muted);">${esc(k)}</span><span style="font-variant-numeric:tabular-nums;">${v}</span></div>`;
  }

  function sourceColor(sourceName) {
    if (!sourceName) return "#94a3b8";
    if (sourceName.includes("FluView")) return "#60a5fa";       // blue
    if (sourceName.includes("NCHS"))    return "#f59e0b";       // amber
    if (sourceName.includes("FluSurv")) return "#34d399";       // green
    if (sourceName.includes("COVID-NET")) return "#a78bfa";     // purple
    if (sourceName.includes("RSV-NET"))   return "#fb7185";     // rose
    return "#94a3b8";                                           // slate
  }

  function tile(rec) {
    const tileBase = "padding:0.9rem 1rem;background:var(--bg-1);border:1px solid var(--border);border-radius:var(--radius);";
    const cb = rec.county_breakdown || {};
    const isNational = cb._source === "cdc-national";

    // 2026-05-13: stop duplicating CDC national totals across every state tile.
    if (isNational && rec.cases == null && rec.hospitalizations == null && rec.deaths == null) {
      return ""; // suppress empty national rollup rows
    }

    const condition = CONDITION_LABEL[rec.condition] || rec.condition || "—";
    const sourceName = cb._source || (rec.source_url ? "State DPH" : "—");
    const sourceColorVal = sourceColor(sourceName);
    const isRate = cb._network && /(FluSurv|COVID-NET|RSV-NET)/.test(cb._network);
    const isStale = !!cb._stale;
    const ageDays = cb._age_days;

    // Build the metric block based on what the source provides.
    let metrics = "";
    if (rec.cases != null) {
      const wili = (cb.wili_percent != null) ? ` (${Number(cb.wili_percent).toFixed(2)}% wILI)` : "";
      metrics += row("ILI cases", `<strong>${esc(fmtNum(rec.cases))}</strong>${esc(wili)}`);
      if (cb.num_patients != null) metrics += row("Total patient visits", esc(fmtNum(cb.num_patients)));
      if (cb.num_providers != null) metrics += row("Reporting providers", esc(cb.num_providers));
    }
    if (rec.deaths != null) {
      metrics += row("Deaths (provisional)", `<strong>${esc(fmtNum(rec.deaths))}</strong>`);
    }
    if (rec.hospitalizations != null && isRate) {
      metrics += row("Hospitalization rate / 100k", `<strong>${esc(rec.hospitalizations)}</strong>`);
      if (cb.cumulative_rate_per_100k != null) {
        metrics += row("Cumulative rate / 100k (season)", esc(cb.cumulative_rate_per_100k));
      }
    } else if (rec.hospitalizations != null) {
      metrics += row("Hospitalizations", `<strong>${esc(fmtNum(rec.hospitalizations))}</strong>`);
    }
    if (!metrics) {
      // No signal at all (NCHS row with all values suppressed) — skip.
      return "";
    }

    const sourceUrl = cb._source_url || rec.source_url || null;
    return `
      <article style="${tileBase}">
        <header style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <span class="status-pill" data-status="ok" style="font-weight:700;"><span class="status-dot"></span>${esc(rec.state)}</span>
          <span class="status-pill" style="font-size:.7rem;background:${sourceColorVal}22;color:${sourceColorVal};border:1px solid ${sourceColorVal}44;" title="Federal data source">${esc(sourceName)}</span>
        </header>
        <h3 style="margin:8px 0 6px;text-transform:capitalize;font-size:1.05rem;font-weight:600;">${esc(condition)}</h3>
        ${row("Week ending", esc(fmtDate(rec.week_ending)))}
        ${metrics}
        ${isStale ? `<div class="muted small" style="margin-top:6px;color:#fbbf24;font-size:.75rem;">Note: most-recent reported value is ${esc(ageDays)} days old — endpoint hasn't refreshed this state.</div>` : ""}
        ${sourceUrl ? `<div style="margin-top:8px;"><a class="btn btn-ghost" href="${esc(sourceUrl)}" target="_blank" rel="noopener" style="font-size:.8rem;">Source: ${esc(sourceName)} →</a></div>` : ""}
      </article>`;
  }

  function pickLatestByStateCondSource(items) {
    // Group by (state, condition, _source). Keep newest week_ending (fall back fetched_at).
    const byKey = new Map();
    for (const it of items) {
      const k = it.state;
      if (!k) continue;
      const cb = it.county_breakdown || {};
      const src = cb._source || "unknown";
      const key = `${k}|${it.condition}|${src}`;
      const cur = byKey.get(key);
      if (!cur) { byKey.set(key, it); continue; }
      const ta = Date.parse(it.week_ending || it.fetched_at || 0) || it.id || 0;
      const tb = Date.parse(cur.week_ending || cur.fetched_at || 0) || cur.id || 0;
      if (ta > tb) byKey.set(key, it);
    }
    return [...byKey.values()];
  }

  function conditionRank(c) {
    const i = CONDITION_ORDER.indexOf(c);
    return i === -1 ? 99 : i;
  }

  function sortTiles(list) {
    return list.sort((a, b) => {
      const sa = STATES.indexOf(a.state); const sb = STATES.indexOf(b.state);
      if (sa !== sb) return sa - sb;
      const ca = conditionRank(a.condition); const cb = conditionRank(b.condition);
      if (ca !== cb) return ca - cb;
      // Same state+condition: sort by source name
      const cba = (a.county_breakdown || {})._source || "";
      const cbb = (b.county_breakdown || {})._source || "";
      return cba.localeCompare(cbb);
    });
  }

  function render(items) {
    const grid = document.getElementById("stateOutbreaksGrid");
    if (!grid) return;
    const filt = (document.getElementById("stateOutbreaksFilter") || {}).value || "all";
    const filtered = filt === "all" ? items : items.filter((it) => it.state === filt);
    const latest = pickLatestByStateCondSource(filtered);
    const sorted = sortTiles(latest);
    const tiles = sorted.map(tile).filter(Boolean);
    if (tiles.length === 0) {
      grid.innerHTML = '<div class="muted" style="padding:1rem;">No outbreak records currently indexed for the selected state(s).</div>';
    } else {
      grid.innerHTML = tiles.join("");
    }
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
