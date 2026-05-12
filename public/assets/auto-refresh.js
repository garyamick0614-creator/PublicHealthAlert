// PublicHealthAlert client-side auto-refresh shim.
// Polls /api/proxy/pha/snapshot/health every 60s, refetches the full
// snapshot every 5 minutes, and updates a "Last updated: Nm ago" chip
// pinned near the top of each page. Designed to be drop-in: works on every
// page (index/outbreaks/state/country/feeds/about/map/sources/virus/viruses)
// without coupling to any specific page's render code.
//
// Renders an in-page chip element (id=phaFreshChip) so users can see the
// hourly refresh cadence at a glance. The chip is server-truth-driven:
// shows minutes since meta.last_updated. If >75min, marks as stale.
//
// Side-effect: fires a custom event 'pha:freshness' on document with the
// freshness payload — pages that want to reactively re-render can listen.

(function () {
  "use strict";
  if (window.__PHA_AUTO_REFRESH_INSTALLED__) return;
  window.__PHA_AUTO_REFRESH_INSTALLED__ = true;

  var API = "https://api.thatcomputerguy26.org";
  var HEALTH_ENDPOINT = API + "/api/proxy/pha/snapshot/health";
  var SNAPSHOT_ENDPOINT = API + "/api/proxy/pha/snapshot";
  var POLL_HEALTH_MS = 60 * 1000;          // 1 min
  var POLL_SNAPSHOT_MS = 5 * 60 * 1000;    // 5 min
  var TICK_CHIP_MS = 30 * 1000;            // re-render relative time every 30s

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "style") n.setAttribute("style", attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }

  function fmtRel(iso) {
    if (!iso) return "never";
    var ms = Date.now() - new Date(iso).getTime();
    if (!isFinite(ms) || ms < 0) return "just now";
    var mins = Math.floor(ms / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    var days = Math.floor(hrs / 24);
    return days + "d ago";
  }

  function ensureChip() {
    var chip = document.getElementById("phaFreshChip");
    if (chip) return chip;
    chip = el("div", {
      id: "phaFreshChip",
      role: "status",
      "aria-live": "polite",
      style: [
        "position:fixed",
        "top:12px",
        "right:14px",
        "z-index:9999",
        "background:rgba(20,184,166,0.16)",
        "border:1px solid rgba(20,184,166,0.4)",
        "color:#5eead4",
        "padding:6px 12px",
        "border-radius:999px",
        "font:600 11.5px system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
        "letter-spacing:0.04em",
        "text-transform:uppercase",
        "box-shadow:0 4px 14px rgba(0,0,0,0.25)",
        "backdrop-filter:blur(6px)",
        "pointer-events:none"
      ].join(";")
    }, []);
    chip.textContent = "checking...";
    document.body.appendChild(chip);
    return chip;
  }

  var state = {
    lastUpdated: null,
    stale: false,
    eventCount: null
  };

  function renderChip() {
    var chip = ensureChip();
    var label = state.lastUpdated
      ? "Updated " + fmtRel(state.lastUpdated)
      : "checking...";
    if (state.eventCount !== null) {
      label = state.eventCount + " events - " + label;
    }
    chip.textContent = label;
    if (state.stale) {
      chip.style.background = "rgba(245,158,11,0.16)";
      chip.style.borderColor = "rgba(245,158,11,0.45)";
      chip.style.color = "#fcd34d";
    } else {
      chip.style.background = "rgba(20,184,166,0.16)";
      chip.style.borderColor = "rgba(20,184,166,0.4)";
      chip.style.color = "#5eead4";
    }
  }

  function fireFreshness(payload) {
    try {
      document.dispatchEvent(new CustomEvent("pha:freshness", { detail: payload }));
    } catch (_) { /* old browsers */ }
  }

  async function pollHealth() {
    try {
      var r = await fetch(HEALTH_ENDPOINT, { cache: "no-cache" });
      if (!r.ok) return;
      var d = await r.json();
      state.lastUpdated = d.last_updated || state.lastUpdated;
      state.stale = !!d.stale;
      state.eventCount = typeof d.event_count === "number" ? d.event_count : state.eventCount;
      renderChip();
      fireFreshness(d);
    } catch (_) { /* ignore transient */ }
  }

  // Pages that loaded from the static deploy may show data older than 1h.
  // We don't try to retrofit every page's render code; instead, if the
  // freshness check shows new data exists, we refetch the snapshot once
  // and broadcast it via a 'pha:snapshot' event, which interested pages
  // can opt into. The chip plus periodic re-render keeps the visible
  // freshness honest.
  var lastSnapshotTs = 0;
  async function pollSnapshot(force) {
    if (!force && Date.now() - lastSnapshotTs < POLL_SNAPSHOT_MS - 1000) return;
    try {
      var r = await fetch(SNAPSHOT_ENDPOINT, { cache: "no-cache" });
      if (!r.ok) return;
      var d = await r.json();
      lastSnapshotTs = Date.now();
      if (d && d.meta && d.meta.last_updated) {
        state.lastUpdated = d.meta.last_updated;
        state.eventCount = Array.isArray(d.events) ? d.events.length : state.eventCount;
        renderChip();
      }
      try {
        document.dispatchEvent(new CustomEvent("pha:snapshot", { detail: d }));
      } catch (_) { /* old browsers */ }
    } catch (_) { /* ignore */ }
  }

  function start() {
    renderChip();
    pollHealth();
    pollSnapshot(true);
    setInterval(pollHealth, POLL_HEALTH_MS);
    setInterval(pollSnapshot, POLL_SNAPSHOT_MS);
    setInterval(renderChip, TICK_CHIP_MS);
    // Refresh as soon as the tab regains focus, so a user returning to a
    // long-idle tab sees current data quickly.
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        pollHealth();
        pollSnapshot(true);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
