// Country geocoding from the bundled Natural Earth admin0 GeoJSON.
// We use the LABEL_X / LABEL_Y properties (label-placement coordinates) for
// the centroid because they're explicitly chosen to land on visible land —
// far better than computed polygon centroids for shapes like Russia or France.

const NAME_ALIASES = {
  "United States": ["United States of America", "USA", "U.S.A.", "U.S."],
  "Russia": ["Russian Federation"],
  "South Korea": ["Republic of Korea", "Korea, Republic of"],
  "North Korea": ["Democratic People's Republic of Korea", "Korea, North"],
  "Democratic Republic of the Congo": ["DRC", "DR Congo", "Congo, Democratic Republic of the", "Congo (Kinshasa)"],
  "Republic of the Congo": ["Congo", "Congo (Brazzaville)"],
  "Ivory Coast": ["Côte d'Ivoire", "Cote d'Ivoire"],
  "Czechia": ["Czech Republic"],
  "Eswatini": ["Swaziland"],
  "Myanmar": ["Burma"],
  "Tanzania": ["United Republic of Tanzania"],
  "Vietnam": ["Viet Nam"],
  "Laos": ["Lao PDR", "Lao People's Democratic Republic"],
  "Iran": ["Islamic Republic of Iran"],
  "Syria": ["Syrian Arab Republic"],
  "Bolivia": ["Plurinational State of Bolivia"],
  "Venezuela": ["Bolivarian Republic of Venezuela"],
  "Moldova": ["Republic of Moldova"],
};

let lookup = null;
let loadingPromise = null;

function indexFeatures(geo) {
  const map = new Map();
  const add = (name, lat, lng) => {
    if (!name) return;
    map.set(name.toLowerCase(), { lat, lng });
  };
  for (const f of geo.features || []) {
    const p = f.properties || {};
    const lng = Number(p.LABEL_X);
    const lat = Number(p.LABEL_Y);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    add(p.NAME, lat, lng);
    add(p.NAME_LONG, lat, lng);
    add(p.ADMIN, lat, lng);
    add(p.NAME_EN, lat, lng);
    add(p.SOVEREIGNT, lat, lng);
  }
  // Fold in user-friendly aliases mapping back to canonical names already indexed.
  for (const [canonical, aliases] of Object.entries(NAME_ALIASES)) {
    const c = map.get(canonical.toLowerCase());
    if (!c) continue;
    for (const a of aliases) map.set(a.toLowerCase(), c);
  }
  return map;
}

export async function ensureGeo() {
  if (lookup) return { lookup, geo: cachedGeo };
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    const res = await fetch("./vendor/world-110m.geojson", { cache: "force-cache" });
    if (!res.ok) throw new Error(`world-110m.geojson HTTP ${res.status}`);
    const geo = await res.json();
    cachedGeo = geo;
    lookup = indexFeatures(geo);
    return { lookup, geo };
  })();
  return loadingPromise;
}

let cachedGeo = null;

export function geocodeCountry(name) {
  if (!lookup || !name) return null;
  return lookup.get(String(name).toLowerCase()) || null;
}

// Aggregate events to a country-level summary the choropleth and side-panel
// consume. Drops events with no recognisable origin_country.
export function aggregateByCountry(events) {
  if (!lookup) return new Map();
  const out = new Map();
  for (const e of events) {
    const c = e.origin_country;
    if (!c) continue;
    const coords = geocodeCountry(c);
    if (!coords) continue;
    const key = c;
    if (!out.has(key)) out.set(key, { country: key, lat: coords.lat, lng: coords.lng, events: [], viruses: new Set() });
    const slot = out.get(key);
    slot.events.push(e);
    if (e.virus) slot.viruses.add(e.virus);
  }
  for (const slot of out.values()) {
    slot.viruses = [...slot.viruses];
    slot.count = slot.events.length;
  }
  return out;
}
