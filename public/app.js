// PublicHealthAlert frontend — loads /data/{events,sources,meta}.json and renders
// the dashboard. Graceful empty-state behavior so the page always loads even
// before the first nightly scrape has populated real data.

const PATHWAY_LABELS = {
  air_travel: "Air travel",
  land_border: "Land border",
  returning_resident: "Returning resident",
  vector: "Vector / mosquito",
  animal_exposure: "Animal exposure",
};

const STATUS_LABELS = {
  active: "Active outbreak",
  advisory: "Travel advisory",
  imported: "Imported case",
  monitoring: "Monitoring",
  contained: "Contained",
};

const state = {
  events: [],
  sources: [],
  meta: null,
  filters: { virus: "", region: "", pathway: "", status: "" },
  map: null,
};

async function loadJson(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

async function loadAll() {
  const [events, sources, meta] = await Promise.all([
    loadJson("./data/events.json").catch(() => []),
    loadJson("./data/sources.json").catch(() => []),
    loadJson("./data/meta.json").catch(() => null),
  ]);
  state.events = Array.isArray(events) ? events : [];
  state.sources = Array.isArray(sources) ? sources : [];
  state.meta = meta;
}

function setStatus(text, kind) {
  const bar = document.getElementById("statusBar");
  bar.innerHTML = `<span class="status-pill" data-status="${kind}">${text}</span>`;
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function fmtRelative(iso) {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return iso;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function applyFilters() {
  return state.events.filter((e) => {
    const f = state.filters;
    if (f.virus && (e.virus || "") !== f.virus) return false;
    if (f.region && (e.region || e.origin_country || "") !== f.region) return false;
    if (f.pathway && (e.us_pathway || "") !== f.pathway) return false;
    if (f.status && (e.status || "") !== f.status) return false;
    return true;
  });
}

function populateFilterOptions() {
  const viruses = new Set();
  const regions = new Set();
  for (const e of state.events) {
    if (e.virus) viruses.add(e.virus);
    const r = e.region || e.origin_country;
    if (r) regions.add(r);
  }
  const fillSelect = (id, values, defaultLabel) => {
    const sel = document.getElementById(id);
    sel.innerHTML = `<option value="">${defaultLabel}</option>` +
      [...values].sort().map((v) => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`).join("");
  };
  fillSelect("filterVirus", viruses, "All viruses");
  fillSelect("filterRegion", regions, "All regions");
}

function renderAlerts(events) {
  const tbody = document.getElementById("alertsBody");
  document.getElementById("alertsCount").textContent =
    `${events.length} event${events.length === 1 ? "" : "s"}`;
  if (events.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No events match the current filters.</td></tr>`;
    return;
  }
  tbody.innerHTML = events.map((e) => `
    <tr>
      <td>${fmtDate(e.report_date)}</td>
      <td><strong>${escapeHtml(e.virus || "—")}</strong></td>
      <td><span class="event-type" data-type="${escapeAttr(e.status || "")}">${escapeHtml(STATUS_LABELS[e.status] || e.event_type || "—")}</span></td>
      <td>${escapeHtml(e.origin_country || "—")}${e.origin_setting ? `<div class="muted small">${escapeHtml(e.origin_setting)}</div>` : ""}</td>
      <td>${escapeHtml(formatList(e.current_spread))}</td>
      <td>${escapeHtml(PATHWAY_LABELS[e.us_pathway] || e.us_pathway || "—")}</td>
      <td>${e.source_url
        ? `<a href="${escapeAttr(e.source_url)}" rel="noopener" target="_blank">${escapeHtml(e.source || "link")}</a>`
        : escapeHtml(e.source || "—")}</td>
    </tr>
  `).join("");
}

function renderSources() {
  const ul = document.getElementById("sources");
  if (state.sources.length === 0) {
    ul.innerHTML = `<li class="muted">No sources registered yet.</li>`;
    return;
  }
  ul.innerHTML = state.sources.map((s) => `
    <li>
      <div>
        <span class="source-name">${escapeHtml(s.name)}</span>
        <span class="access-tag" data-access="${escapeAttr(s.access || "unknown")}">${escapeHtml(s.access || "unknown")}</span>
      </div>
      <div class="source-meta">
        ${escapeHtml(s.format || "—")} &middot;
        last scraped: ${escapeHtml(fmtRelative(s.last_scraped))}
        ${s.url ? ` &middot; <a href="${escapeAttr(s.url)}" rel="noopener" target="_blank">site</a>` : ""}
      </div>
    </li>
  `).join("");
}

function renderMap() {
  if (!window.maplibregl) return;
  const node = document.getElementById("map");
  // Empty state if no geocoded events
  const points = state.events.filter((e) => Number.isFinite(e.latitude) && Number.isFinite(e.longitude));
  if (state.map) state.map.remove();
  state.map = new maplibregl.Map({
    container: node,
    style: "https://demotiles.maplibre.org/style.json",
    center: [0, 20],
    zoom: 1.3,
    attributionControl: { compact: true },
  });
  state.map.on("load", () => {
    if (points.length === 0) {
      const overlay = document.createElement("div");
      overlay.className = "map-empty";
      overlay.textContent = "No geocoded events to plot yet.";
      node.appendChild(overlay);
      return;
    }
    const fc = {
      type: "FeatureCollection",
      features: points.map((e) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [e.longitude, e.latitude] },
        properties: e,
      })),
    };
    state.map.addSource("events", { type: "geojson", data: fc, cluster: true, clusterRadius: 45 });
    state.map.addLayer({
      id: "event-clusters", type: "circle", source: "events",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": ["step", ["get", "point_count"], "#22c55e", 10, "#f59e0b", 50, "#ef4444"],
        "circle-radius": ["step", ["get", "point_count"], 16, 10, 22, 50, 30],
      },
    });
    state.map.addLayer({
      id: "event-points", type: "circle", source: "events",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": "#14b8a6",
        "circle-radius": 6,
        "circle-stroke-width": 1,
        "circle-stroke-color": "#fff",
      },
    });
    state.map.on("click", "event-points", (ev) => {
      const p = ev.features?.[0]?.properties || {};
      new maplibregl.Popup()
        .setLngLat(ev.lngLat)
        .setHTML(`<strong>${escapeHtml(p.virus || "")}</strong><br>${escapeHtml(p.origin_country || "")}<br>${escapeHtml(fmtDate(p.report_date))}<br>${p.source_url ? `<a href="${escapeAttr(p.source_url)}" target="_blank" rel="noopener">${escapeHtml(p.source || "source")}</a>` : ""}`)
        .addTo(state.map);
    });
  });
}

function renderStatus() {
  const m = state.meta;
  if (!m) {
    setStatus("Awaiting first scrape", "stale");
    document.getElementById("footerRefresh").textContent = "never";
    return;
  }
  if (m.status === "scaffold" || !m.last_updated) {
    setStatus("Scaffold — first scrape pending", "stale");
    document.getElementById("footerRefresh").textContent = "—";
    return;
  }
  const ageHours = (Date.now() - new Date(m.last_updated).getTime()) / 3_600_000;
  const kind = ageHours < 30 ? "ok" : ageHours < 72 ? "stale" : "error";
  const evCount = state.events.length;
  setStatus(`${evCount} event${evCount === 1 ? "" : "s"} &middot; updated ${fmtRelative(m.last_updated)}`, kind);
  document.getElementById("footerRefresh").textContent =
    `${fmtDate(m.last_updated)} (${fmtRelative(m.last_updated)})`;
}

function bindFilters() {
  const ids = ["filterVirus", "filterRegion", "filterPathway", "filterStatus"];
  const keys = ["virus", "region", "pathway", "status"];
  ids.forEach((id, i) => {
    document.getElementById(id).addEventListener("change", (e) => {
      state.filters[keys[i]] = e.target.value;
      renderAlerts(applyFilters());
    });
  });
  document.getElementById("filterReset").addEventListener("click", () => {
    state.filters = { virus: "", region: "", pathway: "", status: "" };
    ids.forEach((id) => { document.getElementById(id).value = ""; });
    renderAlerts(applyFilters());
  });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
function formatList(v) {
  if (!v) return "—";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

(async function init() {
  setStatus("Loading status…", "loading");
  try {
    await loadAll();
  } catch (e) {
    setStatus("Failed to load data", "error");
    console.error(e);
    return;
  }
  populateFilterOptions();
  bindFilters();
  renderAlerts(applyFilters());
  renderSources();
  renderMap();
  renderStatus();
})();
