import { mount } from "../layout.js";
import { loadAll } from "../data.js";
import { ensureGeo, aggregateByCountry } from "../geo.js";
import {
  virusLabel, fmtDate, fmtRelative, escapeHtml, escapeAttr, truncate,
  STATUS_LABELS,
} from "../format.js";

const state = { selected: null };

function selectCountry(country, slot) {
  state.selected = country;
  const titleEl = document.getElementById("mapSideTitle");
  const metaEl = document.getElementById("mapSideMeta");
  const listEl = document.getElementById("mapSideList");
  if (!country || !slot) {
    titleEl.textContent = "Pick a country";
    metaEl.textContent = "—";
    listEl.innerHTML = `<div class="map-side-empty">Click any highlighted country or pin to see the events feeding the dashboard from there.</div>`;
    return;
  }
  const events = slot.events.slice().sort((a, b) =>
    (b.report_date ? Date.parse(b.report_date) : 0) - (a.report_date ? Date.parse(a.report_date) : 0)
  );
  titleEl.textContent = country;
  metaEl.textContent = `${events.length} event${events.length === 1 ? "" : "s"} · ${slot.viruses.length} virus${slot.viruses.length === 1 ? "" : "es"}`;
  listEl.innerHTML = events.map((e) => `
    <div class="map-side-item">
      <div style="display:flex; gap:0.5rem; align-items:center; justify-content:space-between;">
        <strong>${escapeHtml(virusLabel(e.virus))}</strong>
        <span class="chip" data-tone="${escapeAttr(e.status || "monitoring")}">${escapeHtml(STATUS_LABELS[e.status] || e.status || "Monitoring")}</span>
      </div>
      <div style="margin-top:0.3rem; line-height:1.4;">
        ${e.source_url
          ? `<a href="${escapeAttr(e.source_url)}" rel="noopener" target="_blank">${escapeHtml(truncate(e.title || "Untitled", 110))}</a>`
          : escapeHtml(truncate(e.title || "Untitled", 110))}
      </div>
      <div class="muted small" style="margin-top:0.2rem;">${escapeHtml(fmtDate(e.report_date))} · ${escapeHtml(fmtRelative(e.report_date))} · ${escapeHtml(e.source || "")}</div>
    </div>
  `).join("");
}

(async function init() {
  await mount();
  const data = await loadAll();
  const { geo } = await ensureGeo();
  const aggregated = aggregateByCountry(data.events);

  // Enrich the GeoJSON with phaCount so the choropleth fill expression has data
  const enriched = {
    type: "FeatureCollection",
    features: geo.features.map((f) => {
      const name = f.properties?.NAME || f.properties?.NAME_LONG;
      const slot = name ? aggregated.get(name) : null;
      return {
        ...f,
        properties: {
          ...f.properties,
          phaCount: slot?.count || 0,
          phaName: name,
        },
      };
    }),
  };

  // Pin GeoJSON for individual events with detected origin_country
  const pins = {
    type: "FeatureCollection",
    features: [...aggregated.values()].map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.lng, s.lat] },
      properties: {
        country: s.country,
        count: s.count,
        viruses: s.viruses.join(", "),
      },
    })),
  };

  const map = new maplibregl.Map({
    container: "map",
    style: {
      version: 8,
      sources: {},
      layers: [{ id: "ocean", type: "background", paint: { "background-color": "#04070d" } }],
    },
    center: [10, 22],
    zoom: 1.5,
    minZoom: 1,
    maxZoom: 7,
    attributionControl: false,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), "bottom-left");

  map.on("load", () => {
    map.addSource("countries", { type: "geojson", data: enriched });
    map.addSource("pins", { type: "geojson", data: pins });

    map.addLayer({
      id: "country-fill",
      type: "fill",
      source: "countries",
      paint: {
        "fill-color": [
          "step", ["get", "phaCount"],
          "rgba(40, 56, 90, 0.85)",
          1, "rgba(45, 212, 191, 0.45)",
          2, "rgba(245, 158, 11, 0.6)",
          5, "rgba(244, 63, 94, 0.72)",
        ],
        "fill-outline-color": "rgba(58, 72, 112, 0.8)",
      },
    });
    map.addLayer({
      id: "country-stroke",
      type: "line",
      source: "countries",
      paint: { "line-color": "rgba(110, 130, 170, 0.6)", "line-width": 0.6 },
    });
    map.addLayer({
      id: "country-hover",
      type: "line",
      source: "countries",
      paint: { "line-color": "var(--accent)", "line-width": 1.6 },
      filter: ["==", ["get", "phaName"], "__none__"],
    });
    map.addLayer({
      id: "pins-circle",
      type: "circle",
      source: "pins",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["get", "count"], 1, 6, 5, 12, 20, 22],
        "circle-color": [
          "step", ["get", "count"],
          "rgba(45, 212, 191, 0.9)",
          2, "rgba(245, 158, 11, 0.95)",
          5, "rgba(244, 63, 94, 0.95)",
        ],
        "circle-stroke-color": "#04070d",
        "circle-stroke-width": 1.5,
      },
    });

    map.on("click", "country-fill", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const name = f.properties?.phaName;
      if (!name) return;
      const slot = aggregated.get(name);
      selectCountry(name, slot);
      if (slot) {
        map.flyTo({ center: [slot.lng, slot.lat], zoom: Math.max(map.getZoom(), 3.2), duration: 700 });
      }
    });
    map.on("click", "pins-circle", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const name = f.properties?.country;
      const slot = aggregated.get(name);
      selectCountry(name, slot);
      map.flyTo({ center: f.geometry.coordinates, zoom: Math.max(map.getZoom(), 3.2), duration: 700 });
    });

    let hoveredName = null;
    const setHover = (name) => {
      hoveredName = name;
      map.setFilter("country-hover", ["==", ["get", "phaName"], name || "__none__"]);
    };
    map.on("mousemove", "country-fill", (e) => {
      const f = e.features?.[0];
      const name = f?.properties?.phaName;
      if (name && name !== hoveredName) setHover(name);
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "country-fill", () => { setHover(null); map.getCanvas().style.cursor = ""; });
    map.on("mouseenter", "pins-circle", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "pins-circle", () => { map.getCanvas().style.cursor = ""; });

    // Hover popup with country name + count
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
    map.on("mousemove", "country-fill", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const name = f.properties?.phaName;
      const count = f.properties?.phaCount || 0;
      if (count === 0) { popup.remove(); return; }
      popup
        .setLngLat(e.lngLat)
        .setHTML(`<strong>${escapeHtml(name)}</strong><br>${count} event${count === 1 ? "" : "s"}`)
        .addTo(map);
    });
    map.on("mouseleave", "country-fill", () => popup.remove());
  });

  // If user passes ?country=X, auto-select it
  const presel = new URLSearchParams(window.location.search).get("country");
  if (presel && aggregated.has(presel)) {
    selectCountry(presel, aggregated.get(presel));
  }
})();
