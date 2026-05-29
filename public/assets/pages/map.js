import { mount } from "../layout.js";
import { loadAll } from "../data.js";
import { ensureGeo, aggregateByCountry, geocodeEvent } from "../geo.js";
import {
  virusLabel, fmtDate, fmtRelative, escapeHtml, escapeAttr, truncate,
  STATUS_LABELS,
} from "../format.js";

const state = { selected: null, virusFilter: "", map: null, allEvents: [], geo: null };

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

function buildLayers(events) {
  const aggregated = aggregateByCountry(events);
  const enriched = {
    type: "FeatureCollection",
    features: state.geo.features.map((f) => {
      const name = f.properties?.NAME || f.properties?.NAME_LONG;
      const slot = name ? aggregated.get(name) : null;
      return {
        ...f,
        properties: { ...f.properties, phaCount: slot?.count || 0, phaName: name },
      };
    }),
  };
  // One pin PER EVENT (not per country). Every data point that can be placed
  // gets its own marker, deterministically jittered around its country centroid
  // so co-located events form a readable cluster instead of stacking on one dot.
  const pinFeatures = [];
  let placed = 0, unplaceable = 0;
  for (const e of events) {
    const coords = geocodeEvent(e);
    if (!coords) { unplaceable++; continue; }
    placed++;
    pinFeatures.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [coords.lng, coords.lat] },
      properties: {
        country: e.origin_country || "",
        virus: e.virus || "",
        status: e.status || "monitoring",
        title: e.title || "",
        report_date: e.report_date || "",
        source: e.source || "",
        source_url: e.source_url || "",
      },
    });
  }
  if (unplaceable) console.info(`pha.map placed ${placed} event pins, ${unplaceable} without resolvable location`);
  const pins = { type: "FeatureCollection", features: pinFeatures };
  return { enriched, pins, aggregated };
}

function applyVirusFilter() {
  const filtered = state.virusFilter
    ? state.allEvents.filter((e) => e.virus === state.virusFilter)
    : state.allEvents;
  const { enriched, pins, aggregated } = buildLayers(filtered);
  if (state.map?.getSource("countries")) state.map.getSource("countries").setData(enriched);
  if (state.map?.getSource("pins")) state.map.getSource("pins").setData(pins);
  state.aggregated = aggregated;
  // Refresh side panel if a country was selected
  if (state.selected) {
    const slot = aggregated.get(state.selected);
    selectCountry(state.selected, slot);
  }
}

(async function init() {
  await mount();
  const data = await loadAll();
  const { geo } = await ensureGeo();
  state.geo = geo;
  state.allEvents = data.events;
  const { enriched, pins, aggregated } = buildLayers(data.events);
  state.aggregated = aggregated;

  // Populate virus filter
  const virusSel = document.getElementById("mapVirusFilter");
  if (virusSel) {
    virusSel.innerHTML = `<option value="">All viruses (${data.indices.viruses.length})</option>` +
      data.indices.viruses.sort().map((v) => {
        const count = (data.indices.byVirus.get(v) || []).length;
        return `<option value="${escapeAttr(v)}">${escapeHtml(virusLabel(v))} (${count})</option>`;
      }).join("");
    virusSel.addEventListener("change", () => {
      state.virusFilter = virusSel.value;
      applyVirusFilter();
    });
    // Pre-select from URL
    const presel = new URLSearchParams(window.location.search).get("virus");
    if (presel && data.indices.byVirus.has(presel)) {
      virusSel.value = presel;
      state.virusFilter = presel;
    }
  }

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
  state.map = map;
  map.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), "bottom-left");

  map.on("load", () => {
    map.addSource("countries", { type: "geojson", data: enriched });
    map.addSource("pins", { type: "geojson", data: pins });
    if (state.virusFilter) applyVirusFilter();

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
        // Fixed-size per-event dots that grow slightly as you zoom in.
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 3.2, 4, 5, 7, 7],
        // Colour by event status so the cluster is readable at a glance.
        "circle-color": [
          "match", ["get", "status"],
          "active", "rgba(244, 63, 94, 0.92)",
          "advisory", "rgba(245, 158, 11, 0.95)",
          "imported", "rgba(168, 85, 247, 0.92)",
          "contained", "rgba(110, 130, 170, 0.85)",
          /* monitoring + default */ "rgba(45, 212, 191, 0.9)",
        ],
        "circle-stroke-color": "#04070d",
        "circle-stroke-width": 1,
        "circle-opacity": 0.92,
      },
    });

    map.on("click", "country-fill", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const name = f.properties?.phaName;
      if (!name) return;
      const slot = state.aggregated.get(name);
      selectCountry(name, slot);
      if (slot) {
        map.flyTo({ center: [slot.lng, slot.lat], zoom: Math.max(map.getZoom(), 3.2), duration: 700 });
      }
    });
    map.on("click", "pins-circle", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const name = f.properties?.country;
      const slot = name ? state.aggregated.get(name) : null;
      if (slot) selectCountry(name, slot);
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

    // Per-event hover popup on individual pins.
    const pinPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
    map.on("mousemove", "pins-circle", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties || {};
      pinPopup
        .setLngLat(f.geometry.coordinates)
        .setHTML(
          `<strong>${escapeHtml(virusLabel(p.virus))}</strong>` +
          `<br>${escapeHtml(truncate(p.title || "Untitled", 90))}` +
          `<br><span style="opacity:0.7">${escapeHtml(p.country || "")} · ${escapeHtml(fmtDate(p.report_date))}</span>`
        )
        .addTo(map);
    });
    map.on("mouseleave", "pins-circle", () => pinPopup.remove());
  });

  // If user passes ?country=X, auto-select it
  const preCountry = new URLSearchParams(window.location.search).get("country");
  if (preCountry && state.aggregated.has(preCountry)) {
    selectCountry(preCountry, state.aggregated.get(preCountry));
  }
})();
