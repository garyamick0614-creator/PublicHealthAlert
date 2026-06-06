// PublicHealthAlert — Hand-rolled SVG US state-grid map + outbreak charts
// 2026-06-06 (task: charts + US state map, real-data-only, no external libs)
//
// Adds ONE new section ("U.S. outbreak map & charts") to the home page,
// driven entirely by live PHA endpoints. No CDNs, no libraries — every
// visual is hand-built inline SVG using the site's existing module style
// (esc()/fetchJson helpers, section/panel markup, CSS variables).
//
// Endpoints (api.thatcomputerguy26.org), shapes confirmed live 2026-06-06:
//   GET /api/public/pha/deep/snapshot
//       → { freshest, counts, county_coverage[], state_outbreaks[] }
//   GET /api/public/pha/h5n1-dairy?limit=400   (server caps at 200 rows)
//       → { totals:{ total_rows, states_affected, premises_affected, latest_date },
//           items:[ { state(full name), county, date_confirmed, herd_size, status } ] }
//   GET /api/public/pha/state-outbreaks?since-weeks=52&limit=500
//       → { items:[ { state(2-letter), condition, week_ending, cases, deaths,
//                     hospitalizations, county_breakdown } ] }
//   GET /api/public/pha/deep/history?state=XX&limit=520
//       → { items:[ { state, condition, week_ending, deaths, cases, source } ] }
//
// MAP METRIC: choice of (a) H5N1 dairy-cattle detections per state, or
// (b) state outbreak weekly records per state. Both are real counts grouped
// from the endpoints above. States with no data render in the empty tone and
// say "no data" on hover/click — honest empty states, no fabrication.

(function () {
  "use strict";

  const API = "https://api.thatcomputerguy26.org";
  const SNAP_URL = API + "/api/public/pha/deep/snapshot";
  const H5N1_URL = API + "/api/public/pha/h5n1-dairy?limit=400";
  const STATE_OB_URL = API + "/api/public/pha/state-outbreaks?since-weeks=52&limit=500";
  const HISTORY_URL = (st) =>
    API + "/api/public/pha/deep/history?state=" + encodeURIComponent(st) + "&limit=520";
  const REFRESH_MS = 60 * 60 * 1000; // hourly
  // Priority states for the weekly-trend chart (these have NCHS history).
  const TREND_STATES = ["CA", "NY", "TX", "FL"];

  // ---- helpers (match existing module conventions) ------------------------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  async function fetchJson(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error("http-" + r.status);
    return r.json();
  }
  function fmtNum(n) {
    if (n == null) return "—";
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    return v.toLocaleString();
  }

  const CONDITION_LABEL = {
    "influenza": "Influenza", "covid-19": "COVID-19", "pneumonia": "Pneumonia",
    "rsv": "RSV", "measles": "Measles", "pertussis": "Pertussis", "mpox": "Mpox",
    "h5n1": "H5N1 Avian Flu", "hepatitis-a": "Hepatitis A",
    "norovirus": "Norovirus", "tuberculosis": "Tuberculosis",
  };
  const condLabel = (c) => CONDITION_LABEL[c] || (c ? c.charAt(0).toUpperCase() + c.slice(1) : "—");

  // Full state-name → 2-letter (h5n1 rows carry full names; outbreaks carry codes).
  const NAME_TO_ABBR = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
    "district of columbia": "DC", "florida": "FL", "georgia": "GA", "hawaii": "HI",
    "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
    "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK",
    "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI",
    "south carolina": "SC", "south dakota": "SD", "tennessee": "TN", "texas": "TX",
    "utah": "UT", "vermont": "VT", "virginia": "VA", "washington": "WA",
    "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
  };
  const ABBR_TO_NAME = (() => {
    const m = {};
    for (const k in NAME_TO_ABBR) m[NAME_TO_ABBR[k]] = k.replace(/\b\w/g, (c) => c.toUpperCase());
    return m;
  })();
  function toAbbr(s) {
    if (!s) return null;
    const t = String(s).trim();
    if (t.length === 2) return t.toUpperCase();
    return NAME_TO_ABBR[t.toLowerCase()] || null;
  }

  // Tile-grid cartogram layout: [row, col] for each state (standard US grid).
  // Rows 0..7, cols 0..10. This is a labeled state-grid (acceptable per spec)
  // rather than a heavy geo path — clean and dependency-free.
  const GRID = {
    AK: [0, 0], ME: [0, 10],
    VT: [1, 9], NH: [1, 10],
    WA: [2, 0], ID: [2, 1], MT: [2, 2], ND: [2, 3], MN: [2, 4], IL: [2, 5], WI: [2, 6], MI: [2, 7], NY: [2, 8], RI: [2, 9], MA: [2, 10],
    OR: [3, 0], NV: [3, 1], WY: [3, 2], SD: [3, 3], IA: [3, 4], IN: [3, 5], OH: [3, 6], PA: [3, 7], NJ: [3, 8], CT: [3, 9],
    CA: [4, 0], UT: [4, 1], CO: [4, 2], NE: [4, 3], MO: [4, 4], KY: [4, 5], WV: [4, 6], VA: [4, 7], MD: [4, 8], DE: [4, 9],
    AZ: [5, 1], NM: [5, 2], KS: [5, 3], AR: [5, 4], TN: [5, 5], NC: [5, 6], SC: [5, 7], DC: [5, 8],
    OK: [6, 3], LA: [6, 4], MS: [6, 5], AL: [6, 6], GA: [6, 7],
    HI: [7, 0], TX: [7, 3], FL: [7, 8],
  };

  // Sequential teal→amber→rose ramp consistent with the site palette.
  const RAMP = ["#0e3a44", "#10707e", "#1f9aa6", "#5fc7c1", "#e7c46b", "#f59e0b", "#fb7185", "#f43f5e"];
  function rampColor(value, max) {
    if (!max || value <= 0) return "rgba(255,255,255,0.05)";
    const t = Math.min(1, value / max);
    const idx = Math.min(RAMP.length - 1, Math.floor(t * (RAMP.length - 1) + 0.0001));
    return RAMP[idx];
  }

  // ---- state machine ------------------------------------------------------
  const ST = {
    freshest: null,
    h5n1ByState: {},   // abbr -> count
    h5n1Totals: null,
    obByState: {},     // abbr -> { records, conds:Set, latestWeek }
    metric: "h5n1",    // "h5n1" | "outbreaks"
    selected: null,
  };

  function buildSection(main) {
    const wrap = document.createElement("section");
    wrap.className = "section";
    wrap.id = "phaMapChartsSection";
    wrap.setAttribute("data-marker", "pha-charts-map-2026-06-06");
    wrap.innerHTML =
      '<header class="section-head">' +
        '<div>' +
          '<h2 class="section-title">U.S. outbreak map &amp; charts</h2>' +
          '<div class="section-subtitle">A by-state view of live signals: H5N1 dairy-cattle detections (USDA APHIS) and weekly state outbreak records (CDC). All figures are real counts from the PHA API. <span id="phaMapFreshness" class="muted"></span></div>' +
        "</div>" +
        '<label class="muted" style="display:flex;align-items:center;gap:6px;font-size:.85rem;">' +
          "Map metric:" +
          '<select id="phaMapMetric" style="background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.1);color:var(--text);border-radius:6px;padding:4px 8px;">' +
            '<option value="h5n1">H5N1 dairy detections</option>' +
            '<option value="outbreaks">State outbreak records</option>' +
          "</select>" +
        "</label>" +
      "</header>" +
      '<div class="pha-mc-grid">' +
        '<article class="panel pha-mc-mappanel">' +
          '<header class="panel-header"><h3 class="panel-title" id="phaMapTitle">H5N1 dairy detections by state</h3></header>' +
          '<div id="phaMapHost" style="position:relative;min-height:300px">Loading map…</div>' +
          '<div id="phaMapLegend" class="pha-mc-legend"></div>' +
          '<div id="phaMapDetail" class="pha-mc-detail">Hover or tap a state to see its numbers.</div>' +
        "</article>" +
        '<div class="pha-mc-charts">' +
          '<article class="panel"><header class="panel-header"><h3 class="panel-title">H5N1 detections — top states</h3></header><div id="phaBarH5N1">Loading…</div></article>' +
          '<article class="panel"><header class="panel-header"><h3 class="panel-title">State outbreak records — top states</h3></header><div id="phaBarOutbreaks">Loading…</div></article>' +
          '<article class="panel"><header class="panel-header"><h3 class="panel-title">Weekly deaths trend (last 26 wk)</h3></header><div id="phaTrend">Loading…</div></article>' +
        "</div>" +
      "</div>" +
      '<p class="muted small" style="margin-top:10px;line-height:1.5">' +
        "<strong>Methodology:</strong> The state grid is a labeled tile cartogram (hand-built inline SVG, no map libraries). " +
        "H5N1 counts group USDA APHIS dairy-cattle detection rows by state from <code>/api/public/pha/h5n1-dairy</code> " +
        "(server returns the 200 most-recent detections). State outbreak records group weekly CDC signals by state from " +
        "<code>/api/public/pha/state-outbreaks</code>. The trend lines plot weekly death counts from " +
        "<code>/api/public/pha/deep/history</code> for priority states. States with no published data are shown blank." +
      "</p>";
    main.appendChild(wrap);
    return wrap;
  }

  function ensureStyles() {
    if (document.getElementById("pha-mc-styles")) return;
    const s = document.createElement("style");
    s.id = "pha-mc-styles";
    s.textContent = [
      ".pha-mc-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:1rem;margin-top:.75rem}",
      "@media (max-width:900px){.pha-mc-grid{grid-template-columns:1fr}}",
      ".pha-mc-charts{display:flex;flex-direction:column;gap:1rem}",
      ".pha-mc-legend{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:10px;font-size:12px;color:var(--muted)}",
      ".pha-mc-legend .sw{display:inline-block;width:14px;height:14px;border-radius:3px;vertical-align:middle;margin-right:4px;border:1px solid rgba(255,255,255,.12)}",
      ".pha-mc-detail{margin-top:12px;padding:10px 12px;background:rgba(15,21,46,.55);border:1px dashed rgba(255,255,255,.12);border-radius:10px;font-size:13.5px;color:var(--text);min-height:30px}",
      ".pha-mc-cell{cursor:pointer;transition:opacity .12s}",
      ".pha-mc-cell:hover .pha-mc-rect,.pha-mc-cell.sel .pha-mc-rect{stroke:#fff;stroke-width:1.6}",
      ".pha-mc-rect{stroke:rgba(255,255,255,.18);stroke-width:.8;rx:3}",
      ".pha-mc-lbl{font:600 9px system-ui,sans-serif;fill:var(--text);pointer-events:none;text-anchor:middle;dominant-baseline:central}",
      ".pha-bar-row{display:grid;grid-template-columns:42px 1fr 52px;gap:8px;align-items:center;font-size:.82rem;padding:2px 0}",
      ".pha-bar-track{height:14px;background:rgba(255,255,255,.05);border-radius:4px;overflow:hidden}",
      ".pha-bar-fill{height:100%;border-radius:4px}",
      ".pha-bar-val{text-align:right;font-variant-numeric:tabular-nums;color:var(--muted)}",
      ".pha-trend-row{display:grid;grid-template-columns:38px 1fr 56px;gap:8px;align-items:center;padding:3px 0;border-bottom:1px solid var(--border,#2a2a2a)}",
      ".pha-trend-spark{min-height:34px}",
      ".pha-trend-val{text-align:right;font-size:.85rem;font-variant-numeric:tabular-nums}",
    ].join("\n");
    document.head.appendChild(s);
  }

  // ---- SVG state-grid map -------------------------------------------------
  function metricForState(abbr) {
    if (ST.metric === "h5n1") return ST.h5n1ByState[abbr] || 0;
    const o = ST.obByState[abbr];
    return o ? o.records : 0;
  }

  function renderMap() {
    const host = document.getElementById("phaMapHost");
    if (!host) return;
    const COLS = 11, ROWS = 8, CELL = 34, GAP = 4, PAD = 6;
    const W = PAD * 2 + COLS * CELL + (COLS - 1) * GAP;
    const H = PAD * 2 + ROWS * CELL + (ROWS - 1) * GAP;
    let max = 0;
    for (const ab in GRID) max = Math.max(max, metricForState(ab));

    let cells = "";
    for (const ab in GRID) {
      const [r, c] = GRID[ab];
      const x = PAD + c * (CELL + GAP);
      const y = PAD + r * (CELL + GAP);
      const v = metricForState(ab);
      const fill = rampColor(v, max);
      const sel = ST.selected === ab ? " sel" : "";
      cells +=
        '<g class="pha-mc-cell' + sel + '" data-st="' + ab + '" role="button" tabindex="0" ' +
        'aria-label="' + esc(ABBR_TO_NAME[ab] || ab) + ': ' + v + '">' +
          '<rect class="pha-mc-rect" x="' + x + '" y="' + y + '" width="' + CELL + '" height="' + CELL +
            '" rx="3" fill="' + fill + '"></rect>' +
          '<text class="pha-mc-lbl" x="' + (x + CELL / 2) + '" y="' + (y + CELL / 2) + '">' + ab + "</text>" +
        "</g>";
    }
    host.innerHTML =
      '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" preserveAspectRatio="xMidYMid meet" ' +
      'role="img" aria-label="U.S. state grid shaded by ' + esc(ST.metric === "h5n1" ? "H5N1 dairy detections" : "state outbreak records") + '">' +
      cells + "</svg>";

    // Legend (5 buckets from the ramp across [0..max]).
    const legend = document.getElementById("phaMapLegend");
    if (legend) {
      if (max <= 0) {
        legend.innerHTML = '<span>No data available for this metric.</span>';
      } else {
        const stops = [0.001, 0.25, 0.5, 0.75, 1].map((t) => Math.max(1, Math.round(t * max)));
        let html = '<span class="sw" style="background:rgba(255,255,255,.05)"></span><span>0 / no data</span>';
        const seen = new Set();
        for (const v of stops) {
          if (seen.has(v)) continue; seen.add(v);
          html += '<span class="sw" style="background:' + rampColor(v, max) + '"></span><span>' + v + "</span>";
        }
        legend.innerHTML = html;
      }
    }

    // Wire interactions.
    host.querySelectorAll(".pha-mc-cell").forEach((g) => {
      const ab = g.getAttribute("data-st");
      const show = () => showStateDetail(ab);
      g.addEventListener("mouseenter", show);
      g.addEventListener("click", () => { ST.selected = ab; renderMap(); show(); });
      g.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ST.selected = ab; renderMap(); show(); }
      });
    });
  }

  function showStateDetail(abbr) {
    const el = document.getElementById("phaMapDetail");
    if (!el) return;
    const name = ABBR_TO_NAME[abbr] || abbr;
    const h5 = ST.h5n1ByState[abbr] || 0;
    const ob = ST.obByState[abbr];
    const parts = [];
    parts.push("<strong>" + esc(name) + " (" + esc(abbr) + ")</strong>");
    parts.push("H5N1 dairy detections: <strong>" + fmtNum(h5) + "</strong>" +
      (h5 === 0 ? " <span class='muted'>(none in latest 200 USDA rows)</span>" : ""));
    if (ob && ob.records) {
      const conds = Array.from(ob.conds).map(condLabel).sort().join(", ");
      parts.push("State outbreak records: <strong>" + fmtNum(ob.records) + "</strong>" +
        (ob.latestWeek ? " <span class='muted'>(through week ending " + esc(ob.latestWeek) + ")</span>" : ""));
      if (conds) parts.push("<span class='muted'>Signals tracked: " + esc(conds) + "</span>");
    } else {
      parts.push("State outbreak records: <strong>0</strong> <span class='muted'>(no weekly records published)</span>");
    }
    el.innerHTML = parts.join("<br>");
  }

  // ---- horizontal bar charts ---------------------------------------------
  function renderBars(hostId, pairs, color) {
    const host = document.getElementById(hostId);
    if (!host) return;
    if (!pairs.length) { host.innerHTML = '<div class="muted">No data available.</div>'; return; }
    const max = Math.max(...pairs.map((p) => p[1])) || 1;
    host.innerHTML = pairs.map(([st, v]) => {
      const pct = Math.max(2, (v / max) * 100);
      return '<div class="pha-bar-row">' +
        '<span>' + esc(st) + "</span>" +
        '<div class="pha-bar-track"><div class="pha-bar-fill" style="width:' + pct.toFixed(1) + "%;background:" + color + '"></div></div>' +
        '<span class="pha-bar-val">' + fmtNum(v) + "</span>" +
      "</div>";
    }).join("");
  }

  // ---- multi-series weekly trend (deaths) ---------------------------------
  function sparkPath(values, w, h) {
    if (!values.length) return "";
    const max = Math.max(...values, 1);
    const min = 0;
    const range = Math.max(1, max - min);
    return values.map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return (i === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1);
    }).join(" ");
  }

  async function renderTrend() {
    const host = document.getElementById("phaTrend");
    if (!host) return;
    const COLORS = ["#5fc7c1", "#f59e0b", "#fb7185", "#a78bfa"];
    try {
      const results = await Promise.all(TREND_STATES.map(async (st) => {
        try {
          const j = await fetchJson(HISTORY_URL(st));
          const items = (j.items || []).filter((r) => r.deaths != null);
          // Aggregate deaths per week across all conditions for this state.
          const byWeek = new Map();
          for (const r of items) {
            const wk = String(r.week_ending || "");
            byWeek.set(wk, (byWeek.get(wk) || 0) + Number(r.deaths || 0));
          }
          const weeks = Array.from(byWeek.keys()).sort();
          const tail = weeks.slice(-26);
          return { st, vals: tail.map((w) => byWeek.get(w)), latest: tail.length ? byWeek.get(tail[tail.length - 1]) : null, latestWk: tail[tail.length - 1] };
        } catch { return { st, vals: [], latest: null }; }
      }));
      const W = 200, H = 34;
      const rows = results.map((res, i) => {
        const col = COLORS[i % COLORS.length];
        const spark = res.vals.length
          ? '<svg width="100%" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="' + esc(res.st) + ' weekly deaths trend">' +
              '<path d="' + sparkPath(res.vals, W, H) + '" fill="none" stroke="' + col + '" stroke-width="1.6"/>' +
            "</svg>"
          : '<span class="muted" style="font-size:.78rem">no history</span>';
        return '<div class="pha-trend-row">' +
          '<span style="color:' + col + ';font-weight:700">' + esc(res.st) + "</span>" +
          '<div class="pha-trend-spark">' + spark + "</div>" +
          '<span class="pha-trend-val">' + (res.latest == null ? "—" : fmtNum(res.latest)) + "</span>" +
        "</div>";
      }).join("");
      host.innerHTML = rows +
        '<div class="muted" style="font-size:.75rem;margin-top:6px">Weekly all-cause-tracked death counts (CDC NCHS), summed across conditions. Value = most recent week on record.</div>';
    } catch (e) {
      host.innerHTML = '<div class="muted">Failed to load trend data. ' + esc(e.message || "") + "</div>";
    }
  }

  // ---- data load ----------------------------------------------------------
  function applyMetricLabels() {
    const t = document.getElementById("phaMapTitle");
    if (t) t.textContent = ST.metric === "h5n1"
      ? "H5N1 dairy detections by state"
      : "State outbreak records by state";
  }

  async function loadAll() {
    // Freshness from snapshot.
    try {
      const snap = await fetchJson(SNAP_URL);
      ST.freshest = snap.freshest || null;
      const f = document.getElementById("phaMapFreshness");
      if (f && ST.freshest) {
        const d = new Date(ST.freshest);
        if (!isNaN(d)) f.textContent = "Data as of " + d.toISOString().slice(0, 16).replace("T", " ") + "Z.";
      }
    } catch {}

    // H5N1 by state.
    try {
      const j = await fetchJson(H5N1_URL);
      ST.h5n1Totals = j.totals || null;
      const by = {};
      for (const r of (j.items || [])) {
        const ab = toAbbr(r.state);
        if (!ab) continue;
        by[ab] = (by[ab] || 0) + 1;
      }
      ST.h5n1ByState = by;
      const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 10);
      renderBars("phaBarH5N1", top, "#fb7185");
    } catch (e) {
      const h = document.getElementById("phaBarH5N1");
      if (h) h.innerHTML = '<div class="muted">H5N1 feed unavailable. ' + esc(e.message || "") + "</div>";
    }

    // State outbreak records by state.
    try {
      const j = await fetchJson(STATE_OB_URL);
      const by = {};
      for (const r of (j.items || [])) {
        const ab = toAbbr(r.state);
        if (!ab) continue;
        if (!by[ab]) by[ab] = { records: 0, conds: new Set(), latestWeek: "" };
        by[ab].records += 1;
        if (r.condition) by[ab].conds.add(r.condition);
        const wk = String(r.week_ending || "");
        if (wk > by[ab].latestWeek) by[ab].latestWeek = wk;
      }
      ST.obByState = by;
      const top = Object.entries(by).map(([k, v]) => [k, v.records]).sort((a, b) => b[1] - a[1]).slice(0, 10);
      renderBars("phaBarOutbreaks", top, "#5fc7c1");
    } catch (e) {
      const h = document.getElementById("phaBarOutbreaks");
      if (h) h.innerHTML = '<div class="muted">State outbreaks feed unavailable. ' + esc(e.message || "") + "</div>";
    }

    renderMap();
    renderTrend();
  }

  function init() {
    const main = document.querySelector("main.container") || document.querySelector("main");
    if (!main) return;
    if (document.getElementById("phaMapChartsSection")) return; // idempotent
    ensureStyles();
    buildSection(main);
    const sel = document.getElementById("phaMapMetric");
    if (sel) sel.addEventListener("change", () => {
      ST.metric = sel.value;
      applyMetricLabels();
      renderMap();
    });
    loadAll();
    setInterval(loadAll, REFRESH_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
