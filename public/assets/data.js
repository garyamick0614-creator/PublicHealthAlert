// Shared data loader. Each page calls loadAll() and gets back consistent
// snapshots of events.json, sources.json, meta.json plus precomputed indices.

import { PRIORITY_VIRUSES } from "./format.js";

let cached = null;
let cachedPromise = null;

async function loadJson(path, fallback) {
  try {
    const res = await fetch(path, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn("data.load_failed", path, e);
    return fallback;
  }
}

export async function loadAll(force = false) {
  if (cached && !force) return cached;
  if (cachedPromise && !force) return cachedPromise;
  cachedPromise = (async () => {
    const [events, sources, meta] = await Promise.all([
      loadJson("./data/events.json", []),
      loadJson("./data/sources.json", []),
      loadJson("./data/meta.json", null),
    ]);
    const evList = Array.isArray(events) ? events : [];
    cached = {
      events: evList,
      sources: Array.isArray(sources) ? sources : [],
      meta,
      indices: buildIndices(evList),
    };
    return cached;
  })();
  return cachedPromise;
}

function buildIndices(events) {
  const byVirus = new Map();
  const byCountry = new Map();
  const bySource = new Map();
  const viruses = new Set();
  const countries = new Set();
  let activeCount = 0;
  let advisoryCount = 0;

  for (const e of events) {
    if (e.virus) {
      viruses.add(e.virus);
      if (!byVirus.has(e.virus)) byVirus.set(e.virus, []);
      byVirus.get(e.virus).push(e);
    }
    const country = e.origin_country;
    if (country) {
      countries.add(country);
      if (!byCountry.has(country)) byCountry.set(country, []);
      byCountry.get(country).push(e);
    }
    if (e.source) {
      if (!bySource.has(e.source)) bySource.set(e.source, []);
      bySource.get(e.source).push(e);
    }
    if (e.status === "active") activeCount++;
    if (e.status === "advisory") advisoryCount++;
  }

  const priorityHits = PRIORITY_VIRUSES.filter((v) => viruses.has(v));

  return {
    byVirus,
    byCountry,
    bySource,
    viruses: [...viruses],
    countries: [...countries],
    counts: {
      total: events.length,
      active: activeCount,
      advisory: advisoryCount,
      viruses: viruses.size,
      countries: countries.size,
      priorityHits: priorityHits.length,
    },
    priorityHits,
  };
}

export function applyFilters(events, filters) {
  return events.filter((e) => {
    if (filters.virus && (e.virus || "") !== filters.virus) return false;
    if (filters.country && (e.origin_country || "") !== filters.country) return false;
    if (filters.pathway && (e.us_pathway || "") !== filters.pathway) return false;
    if (filters.status && (e.status || "") !== filters.status) return false;
    if (filters.source && (e.source || "") !== filters.source) return false;
    if (filters.q) {
      const q = filters.q.toLowerCase();
      const blob = `${e.title || ""} ${e.summary || ""} ${e.origin_country || ""} ${e.virus || ""}`.toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  });
}
