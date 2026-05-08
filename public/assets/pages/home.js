import { mount } from "../layout.js";
import {
  virusLabel, virusGlyph, fmtRelative, fmtNumber, escapeHtml, escapeAttr, truncate, animateCount,
  STATUS_LABELS, PRIORITY_VIRUSES,
} from "../format.js";
import { ensureGeo, aggregateByCountry } from "../geo.js";

function renderStats(data) {
  const c = data.indices.counts;
  const meta = data.meta;
  const ageHours = meta?.last_updated
    ? ((Date.now() - new Date(meta.last_updated).getTime()) / 3_600_000).toFixed(1)
    : null;
  const cards = [
    { label: "Tracked events", value: c.total, foot: meta?.last_updated ? `Refreshed ${fmtRelative(meta.last_updated)}` : "Awaiting first run", tone: "" },
    { label: "Active outbreaks", value: c.active, foot: c.active === 0 ? "No active outbreak signals tonight" : "Status = active in latest scrape", tone: "alert" },
    { label: "Travel advisories", value: c.advisory, foot: c.advisory === 0 ? "No advisories from CDC tonight" : "From CDC travel notices", tone: "advisory" },
    { label: "Distinct viruses", value: c.viruses, foot: `${c.priorityHits} of 6 priority pathogens`, tone: "monitor" },
    { label: "Source origins", value: c.countries, foot: `Countries appearing in titles`, tone: "" },
    { label: "Sources reporting", value: data.sources.length, foot: data.sources.filter(s => s.last_scraped).length + " confirmed live", tone: "" },
  ];
  const grid = document.getElementById("statGrid");
  grid.innerHTML = cards.map((c) => `
    <div class="stat-card fade-in"${c.tone ? ` data-tone="${c.tone}"` : ""}>
      <div class="stat-label">${escapeHtml(c.label)}</div>
      <div class="stat-value" data-target="${Number(c.value || 0)}">0</div>
      <div class="stat-foot">${escapeHtml(c.foot)}</div>
    </div>
  `).join("");
  grid.querySelectorAll(".stat-value").forEach((el) => {
    animateCount(el, Number(el.dataset.target || 0));
  });
}

function renderFeatured(data) {
  const grid = document.getElementById("featuredGrid");
  const events = data.events.slice(0, 6);
  if (events.length === 0) {
    grid.innerHTML = `
      <div class="panel" style="grid-column: 1 / -1;">
        <div class="empty-state">
          <strong>No events in the feed yet</strong>
          The scrape pipeline is wired up. After tonight's 01:00 ET run the latest signals will land here automatically.
        </div>
      </div>`;
    return;
  }
  grid.innerHTML = events.map((e) => {
    const tone = e.status || "monitoring";
    return `
      <a class="alert-card fade-in" href="${escapeAttr(e.source_url || "#")}" rel="noopener" target="_blank" data-tone="${escapeAttr(tone)}">
        <div class="alert-meta">
          <span class="alert-virus">${escapeHtml(virusLabel(e.virus))}</span>
          <span>·</span>
          <span>${escapeHtml(e.origin_country || "—")}</span>
          <span>·</span>
          <span>${escapeHtml(fmtRelative(e.report_date))}</span>
        </div>
        <div class="alert-headline">${escapeHtml(e.title || "Untitled")}</div>
        ${e.summary ? `<div class="alert-summary">${escapeHtml(truncate(e.summary, 220))}</div>` : ""}
        <div class="alert-footer">
          <span class="chip" data-tone="${escapeAttr(tone)}">${escapeHtml(STATUS_LABELS[tone] || tone)}</span>
          <span>${escapeHtml(e.source || "")}</span>
        </div>
      </a>`;
  }).join("");
}

function renderPriorityGrid(data) {
  const grid = document.getElementById("priorityGrid");
  grid.innerHTML = PRIORITY_VIRUSES.map((v) => {
    const list = data.indices.byVirus.get(v) || [];
    const newest = list[0];
    return `
      <a class="virus-tile fade-in" href="./virus.html?id=${encodeURIComponent(v)}">
        <div class="virus-glyph">${escapeHtml(virusGlyph(virusLabel(v)))}</div>
        <div>
          <div class="virus-name">${escapeHtml(virusLabel(v))}</div>
          <div class="virus-meta">${list.length === 0 ? "No current signals" : `Last seen ${fmtRelative(newest?.report_date)}`}</div>
        </div>
        <div class="virus-count">${fmtNumber(list.length)}</div>
      </a>`;
  }).join("");
}

async function renderMapPreview(data) {
  if (!window.maplibregl) return;
  const container = document.getElementById("map");
  if (!container) return;

  const { geo } = await ensureGeo();
  const counts = aggregateByCountry(data.events);

  // Build a name->count map and write into the geojson properties so MapLibre
  // can drive paint expressions off it.
  const enriched = {
    type: "FeatureCollection",
    features: geo.features.map((f) => {
      const name = f.properties?.NAME || f.properties?.NAME_LONG;
      const slot = name ? counts.get(name) : null;
      return {
        ...f,
        properties: {
          ...f.properties,
          phaCount: slot?.count || 0,
        },
      };
    }),
  };

  const map = new maplibregl.Map({
    container,
    style: {
      version: 8,
      sources: {},
      layers: [
        { id: "ocean", type: "background", paint: { "background-color": "#04070d" } },
      ],
    },
    center: [10, 22],
    zoom: 1.15,
    minZoom: 1,
    maxZoom: 5,
    attributionControl: false,
    interactive: false,
  });

  map.on("load", () => {
    map.addSource("countries", { type: "geojson", data: enriched });
    map.addLayer({
      id: "country-fill",
      type: "fill",
      source: "countries",
      paint: {
        "fill-color": [
          "step", ["get", "phaCount"],
          "rgba(40, 56, 90, 0.9)",
          1, "rgba(45, 212, 191, 0.4)",
          2, "rgba(245, 158, 11, 0.55)",
          5, "rgba(244, 63, 94, 0.7)",
        ],
        "fill-outline-color": "rgba(58, 72, 112, 0.7)",
      },
    });
    map.addLayer({
      id: "country-stroke",
      type: "line",
      source: "countries",
      paint: { "line-color": "rgba(90, 110, 150, 0.45)", "line-width": 0.5 },
    });
  });
}

(async function init() {
  const data = await mount();
  renderStats(data);
  renderFeatured(data);
  renderPriorityGrid(data);
  renderMapPreview(data).catch((e) => console.warn("map preview failed:", e));
})();
