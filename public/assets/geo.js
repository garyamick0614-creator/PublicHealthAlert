// Country geocoding from the bundled Natural Earth admin0 GeoJSON.
// We use the LABEL_X / LABEL_Y properties (label-placement coordinates) for
// the centroid because they're explicitly chosen to land on visible land —
// far better than computed polygon centroids for shapes like Russia or France.

const NAME_ALIASES = {
  "United States": ["United States of America", "USA", "U.S.A.", "U.S."],
  "Russia": ["Russian Federation"],
  "South Korea": ["Republic of Korea", "Korea, Republic of"],
  "North Korea": ["Democratic People's Republic of Korea", "Korea, North"],
  "Democratic Republic of the Congo": [
    "DRC", "DR Congo", "Congo, Democratic Republic of the", "Congo (Kinshasa)",
    "Democratic Republic Of Congo", "Democratic Republic of Congo", "Dem. Rep. Congo",
  ],
  "Republic of the Congo": ["Congo", "Congo (Brazzaville)", "Republic of Congo"],
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
  "North Macedonia": ["Macedonia", "Republic of Macedonia", "Republic of Macedonia (FYROM)", "FYROM"],
  "Spain": ["Canary Islands", "Canary Islands [Spain]"],
  "France": ["La Réunion and Mayotte", "Réunion", "Reunion", "Mayotte"],
};

// Centroids for places NOT present in the bundled 110m admin0 GeoJSON
// (small island nations, city-states, special administrative regions and
// territories). 110m omits anything tiny, so without this table their events
// silently vanish from the map. [lat, lng].
const SUPPLEMENTAL_CENTROIDS = {
  "hong kong": [22.32, 114.17],
  "singapore": [1.35, 103.82],
  "macau": [22.20, 113.54],
  "samoa": [-13.76, -172.10],
  "american samoa": [-14.27, -170.13],
  "kiribati": [1.87, -157.36],
  "tonga": [-21.18, -175.20],
  "tuvalu": [-7.48, 178.68],
  "nauru": [-0.53, 166.92],
  "palau": [7.51, 134.58],
  "marshall islands": [7.13, 171.18],
  "micronesia": [6.92, 158.16],
  "vatican city": [41.90, 12.45],
  "vatican": [41.90, 12.45],
  "holy see": [41.90, 12.45],
  "san marino": [43.94, 12.46],
  "monaco": [43.74, 7.42],
  "liechtenstein": [47.16, 9.55],
  "andorra": [42.55, 1.60],
  "malta": [35.94, 14.38],
  "mauritius": [-20.28, 57.57],
  "seychelles": [-4.68, 55.49],
  "comoros": [-11.65, 43.33],
  "cape verde": [16.00, -24.01],
  "cabo verde": [16.00, -24.01],
  "maldives": [3.20, 73.22],
  "bahrain": [26.07, 50.55],
  "barbados": [13.19, -59.54],
  "grenada": [12.12, -61.68],
  "saint lucia": [13.91, -60.98],
  "antigua and barbuda": [17.27, -61.80],
  "dominica": [15.41, -61.37],
  "saint vincent and the grenadines": [13.25, -61.20],
  "saint kitts and nevis": [17.34, -62.76],
  "fiji": [-17.71, 178.07],
  "canary islands": [28.29, -16.63],
  "canary islands [spain]": [28.29, -16.63],
  "la réunion and mayotte": [-20.88, 55.45],
  "réunion": [-21.12, 55.54],
  "reunion": [-21.12, 55.54],
  "mayotte": [-12.83, 45.17],
  "taiwan": [23.70, 120.96],
  "guam": [13.44, 144.79],
  "puerto rico": [18.22, -66.43],
  "curaçao": [12.18, -68.99],
  "aruba": [12.52, -69.97],
  "gibraltar": [36.14, -5.35],
  "bermuda": [32.31, -64.75],
  "basankusu, equateur- democratic republic of the congo": [1.22, 19.80],
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
  // Fold in supplemental centroids for places the 110m dataset omits.
  // These are added BEFORE aliases so an alias can also point at a supplemental
  // entry (e.g. an alias resolving to a city-state not in admin0).
  for (const [name, [lat, lng]] of Object.entries(SUPPLEMENTAL_CENTROIDS)) {
    if (!map.has(name)) map.set(name, { lat, lng });
  }
  // Fold in user-friendly aliases mapping back to canonical names already indexed.
  for (const [canonical, aliases] of Object.entries(NAME_ALIASES)) {
    const c = map.get(canonical.toLowerCase());
    if (!c) continue;
    for (const a of aliases) map.set(a.toLowerCase(), c);
  }
  return map;
}

// Normalise a country string so messy feed values still resolve:
// lowercase, strip bracketed/parenthetical qualifiers, collapse whitespace,
// drop trailing punctuation. e.g. "Taiwan (non-extant)" -> "taiwan",
// "Canary Islands [Spain]" -> "canary islands".
function normalizeCountry(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")   // [Spain]
    .replace(/\([^)]*\)/g, " ")    // (non-extant), (FYROM)
    .replace(/[.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  const raw = String(name).toLowerCase().trim();
  // 1) exact match on the raw value
  let hit = lookup.get(raw);
  if (hit) return hit;
  // 2) normalised match (strips [..], (..), punctuation)
  const norm = normalizeCountry(name);
  if (norm && norm !== raw) {
    hit = lookup.get(norm);
    if (hit) return hit;
  }
  // 3) substring fallback — pick the longest indexed country name that the
  //    normalised value ends with or contains, so messy strings like
  //    "Basankusu, Equateur- Democratic Republic of the Congo" still resolve.
  if (norm) {
    let best = null, bestLen = 0;
    for (const [key, coords] of lookup) {
      if (key.length < 4) continue; // avoid spurious 2–3 char hits
      if (norm === key || norm.endsWith(" " + key) || norm.includes(key)) {
        if (key.length > bestLen) { best = coords; bestLen = key.length; }
      }
    }
    if (best) return best;
  }
  return null;
}

// Deterministic per-event coordinate: country centroid plus a stable jitter
// derived from the event id, so many events in the same country render as a
// readable cluster of distinct dots instead of stacking on one pixel.
export function geocodeEvent(event) {
  // Prefer real per-event coordinates when the feed supplies them.
  const lat = Number(event?.latitude);
  const lng = Number(event?.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
    return { lat, lng };
  }
  const base = geocodeCountry(event?.origin_country);
  if (!base) return null;
  const seed = hashString(String(event?.id || event?.source_url || event?.title || ""));
  // Spread inside roughly a ~0.6° box around the centroid (deterministic).
  const angle = (seed % 360) * (Math.PI / 180);
  const radius = 0.12 + ((seed >> 9) % 50) / 100; // 0.12°–0.62°
  return {
    lat: base.lat + Math.sin(angle) * radius,
    lng: base.lng + Math.cos(angle) * radius,
  };
}

function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
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
