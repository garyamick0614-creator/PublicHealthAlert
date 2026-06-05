// PublicHealthAlert — State weekly time-series + county-detail widget
// 2026-05-21 — Renders the new /api/public/pha/deep/history and /counties
// surfaces in a single section: select a state, see weekly death counts by
// condition (sparkline) + per-county wastewater/case detail for the 4
// priority states (CA/NY/FL/TX). States without per-county data render an
// honest "no per-county dataset available" pill.
//
// Data flow:
//   TCG-PHA-Outbreaks-Deep-Daily (05:30) → pha-outbreaks-deep-fetcher.mjs →
//     state_outbreak_history → /api/public/pha/deep/history
//   TCG-PHA-County-Daily (06:15) → pha-county-fetcher.mjs →
//     state_outbreak_counties → /api/public/pha/deep/counties

(function () {
  const API = "https://api.thatcomputerguy26.org";
  const SNAP_URL = API + "/api/public/pha/deep/snapshot";
  const HISTORY_URL = (st) =>
    API + "/api/public/pha/deep/history?state=" + encodeURIComponent(st) + "&limit=520";
  const COUNTIES_URL = (st) =>
    API + "/api/public/pha/deep/counties?state=" + encodeURIComponent(st) + "&limit=200";
  const STATES = ["CA", "TX", "FL", "NY", "IL", "IN", "OH", "MI", "PA", "GA"];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  async function fetchJson(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error("http-" + r.status);
    return r.json();
  }

  function sparkline(values, w = 200, h = 38) {
    if (!values || values.length === 0) return "";
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(1, max - min);
    const pts = values.map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return x.toFixed(1) + "," + y.toFixed(1);
    }).join(" ");
    return (
      '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" ' +
      'role="img" aria-label="weekly trend">' +
        '<polyline fill="none" stroke="currentColor" stroke-width="1.5" points="' + pts + '"/>' +
      "</svg>"
    );
  }

  function renderHistorySection(state, items) {
    // Group by condition, sort week_ending ASC for the spark
    const byCond = {};
    for (const r of items) {
      if (!byCond[r.condition]) byCond[r.condition] = [];
      byCond[r.condition].push(r);
    }
    const blocks = [];
    for (const cond of Object.keys(byCond).sort()) {
      const rows = byCond[cond].slice().sort((a, b) =>
        String(a.week_ending).localeCompare(String(b.week_ending)));
      const tail = rows.slice(-26); // last 26 weeks
      const vals = tail.map((r) => Number(r.deaths || r.cases || 0));
      const latest = rows[rows.length - 1];
      const latestVal = latest.deaths != null ? latest.deaths : latest.cases;
      blocks.push(
        '<div class="phx-history-row">' +
          '<div class="phx-history-cond">' + esc(cond) + "</div>" +
          '<div class="phx-history-spark">' + sparkline(vals) + "</div>" +
          '<div class="phx-history-latest">' +
            '<strong>' + esc(latestVal == null ? "—" : latestVal) + "</strong>" +
            ' <span class="muted">(' + esc(latest.week_ending || "") + ")</span>" +
          "</div>" +
        "</div>"
      );
    }
    if (blocks.length === 0) return '<div class="muted">No history available for ' + esc(state) + ".</div>";
    return blocks.join("");
  }

  function renderCountiesSection(state, payload) {
    const items = payload.items || [];
    const coverage = (payload.coverage || []).find((c) => c.state === state);
    if (!items.length) {
      return (
        '<div class="phx-county-empty muted">' +
          'No per-county dataset currently published for ' + esc(state) + ". " +
          '<small>(Feed dormant — operator action needed.)</small>' +
        "</div>"
      );
    }
    // Group by county, show latest record only
    const latestByCounty = new Map();
    for (const r of items) {
      const k = r.county;
      if (!latestByCounty.has(k) ||
          String(r.week_ending) > String(latestByCounty.get(k).week_ending)) {
        latestByCounty.set(k, r);
      }
    }
    const rows = Array.from(latestByCounty.values())
      .sort((a, b) => (Number(b.cases || 0) - Number(a.cases || 0)));
    const top = rows.slice(0, 15);
    const cells = top.map((r) =>
      '<tr>' +
        '<td>' + esc(r.county) + "</td>" +
        '<td>' + esc(r.condition) + "</td>" +
        '<td class="num">' + esc(r.cases == null ? "—" : r.cases) + "</td>" +
        '<td>' + esc(r.week_ending || "") + "</td>" +
        '<td><small class="muted">' + esc(r.source || "") + "</small></td>" +
      "</tr>"
    ).join("");
    return (
      '<div class="phx-county-coverage muted">Coverage: <strong>' +
        (coverage ? coverage.n_counties : 0) + "</strong> counties, " +
        (coverage ? coverage.n_rows : 0) + " weekly records" +
      "</div>" +
      '<table class="phx-county-table"><thead><tr>' +
        "<th>County</th><th>Signal</th><th class='num'>Value</th>" +
        "<th>Week</th><th>Source</th>" +
      "</tr></thead><tbody>" + cells + "</tbody></table>"
    );
  }

  function ensureStyles() {
    if (document.getElementById("phx-state-history-styles")) return;
    const s = document.createElement("style");
    s.id = "phx-state-history-styles";
    s.textContent = [
      ".phx-history-block{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:.75rem}",
      "@media (max-width:780px){.phx-history-block{grid-template-columns:1fr}}",
      ".phx-history-row{display:grid;grid-template-columns:1fr 220px 1fr;gap:.5rem;align-items:center;padding:.35rem 0;border-bottom:1px solid var(--border, #2a2a2a)}",
      ".phx-history-cond{font-size:.9rem;color:var(--muted, #888)}",
      ".phx-history-spark{color:var(--accent, #f33);min-height:38px}",
      ".phx-history-latest{text-align:right;font-size:.9rem}",
      ".phx-state-tabs{display:flex;flex-wrap:wrap;gap:.5rem;margin:.75rem 0}",
      ".phx-state-tab{padding:.4rem .8rem;background:var(--panel-bg, #1a1a1a);border:1px solid var(--border, #333);border-radius:6px;color:var(--text, #eee);cursor:pointer;font-size:.9rem}",
      ".phx-state-tab.active{background:var(--accent, #f33);border-color:var(--accent, #f33);color:#fff}",
      ".phx-county-table{width:100%;border-collapse:collapse;margin-top:.5rem;font-size:.85rem}",
      ".phx-county-table th{text-align:left;padding:.4rem .5rem;background:var(--panel-bg, #1a1a1a);color:var(--muted, #888);font-weight:600;border-bottom:1px solid var(--border, #333)}",
      ".phx-county-table td{padding:.35rem .5rem;border-bottom:1px solid var(--border, #2a2a2a)}",
      ".phx-county-table td.num,.phx-county-table th.num{text-align:right;font-variant-numeric:tabular-nums}",
      ".phx-county-empty{padding:.75rem;background:var(--panel-bg, #1a1a1a);border-radius:6px;text-align:center}",
      ".phx-county-coverage{margin:.5rem 0;font-size:.85rem}",
    ].join("\n");
    document.head.appendChild(s);
  }

  async function mount() {
    const main = document.querySelector("main.container") || document.querySelector("main");
    if (!main) return;
    if (document.getElementById("phxStateHistorySection")) return; // idempotent
    ensureStyles();

    const wrap = document.createElement("section");
    wrap.className = "section";
    wrap.id = "phxStateHistorySection";
    wrap.innerHTML =
      '<header class="section-head">' +
        '<div>' +
          '<h2 class="section-title">State weekly trends &amp; county detail</h2>' +
          '<div class="section-subtitle">CDC NCHS weekly state-level death counts + CDC NWSS county-level wastewater signal. <span id="phxStateHistoryFreshness" class="muted"></span></div>' +
        "</div>" +
      "</header>" +
      '<div class="phx-state-tabs" role="tablist"></div>' +
      '<div class="phx-history-block">' +
        '<article class="panel"><h3 class="panel-title">Weekly trend (last 26 wk)</h3><div id="phxHistoryBody">Loading…</div></article>' +
        '<article class="panel"><h3 class="panel-title">Top counties (most recent week on record)</h3><div id="phxCountiesBody">Loading…</div></article>' +
      "</div>";
    main.appendChild(wrap);

    const tabs = wrap.querySelector(".phx-state-tabs");
    STATES.forEach((st, i) => {
      const b = document.createElement("button");
      b.className = "phx-state-tab" + (i === 0 ? " active" : "");
      b.type = "button";
      b.textContent = st;
      b.setAttribute("data-state", st);
      b.addEventListener("click", () => {
        tabs.querySelectorAll(".phx-state-tab").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        loadState(st);
      });
      tabs.appendChild(b);
    });

    // Load freshness once
    try {
      const snap = await fetchJson(SNAP_URL);
      const freshness = wrap.querySelector("#phxStateHistoryFreshness");
      if (snap.freshest) {
        const d = new Date(snap.freshest);
        freshness.textContent = "Data as of " + d.toISOString().slice(0, 16).replace("T", " ") + "Z";
      }
    } catch {}

    async function loadState(st) {
      const hb = wrap.querySelector("#phxHistoryBody");
      const cb = wrap.querySelector("#phxCountiesBody");
      hb.textContent = "Loading…";
      cb.textContent = "Loading…";
      try {
        const [h, c] = await Promise.all([
          fetchJson(HISTORY_URL(st)),
          fetchJson(COUNTIES_URL(st)),
        ]);
        hb.innerHTML = renderHistorySection(st, h.items || []);
        cb.innerHTML = renderCountiesSection(st, c);
      } catch (e) {
        hb.innerHTML = '<div class="muted">Failed to load history. ' + esc(e.message || "") + "</div>";
        cb.innerHTML = '<div class="muted">Failed to load counties.</div>';
      }
    }

    loadState(STATES[0]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
