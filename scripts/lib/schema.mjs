// Normalized event schema, virus detection, and status classification.
// All connectors emit rows in this shape so the orchestrator can concat
// without per-source branching.

import { createHash } from "node:crypto";

export const TRACKED_VIRUSES = [
  { key: "measles", patterns: [/\bmeasles\b/i, /\brubeola\b/i] },
  { key: "chikungunya", patterns: [/\bchikungunya\b/i] },
  { key: "poliovirus", patterns: [/\bpolio(virus)?\b/i, /\bcVDPV[12]?\b/i, /\bWPV1?\b/i] },
  { key: "oropouche", patterns: [/\boropouche\b/i, /\bOROV\b/i] },
  { key: "avian_influenza", patterns: [/\bavian (influenza|flu)\b/i, /\bH5N1\b/i, /\bH9N2\b/i, /\bH7N9\b/i, /\bbird flu\b/i] },
  { key: "yellow_fever", patterns: [/\byellow fever\b/i] },
  // Additional viruses worth surfacing if they appear, even if not headline:
  { key: "dengue", patterns: [/\bdengue\b/i] },
  { key: "zika", patterns: [/\bzika\b/i] },
  { key: "mpox", patterns: [/\bmpox\b/i, /\bmonkeypox\b/i] },
  { key: "ebola", patterns: [/\bebola\b/i] },
  { key: "marburg", patterns: [/\bmarburg\b/i] },
  { key: "west_nile", patterns: [/\bwest nile\b/i, /\bWNV\b/i] },
  { key: "covid_19", patterns: [/\bcovid[- ]?19\b/i, /\bsars[- ]cov[- ]?2\b/i] },
  { key: "rsv", patterns: [/\bRSV\b/i, /\brespiratory syncytial\b/i] },
  { key: "norovirus", patterns: [/\bnorovirus\b/i] },
  { key: "hantavirus", patterns: [/\bhantavirus\b/i, /\bandes virus\b/i] },
  { key: "lassa", patterns: [/\blassa\b/i] },
  { key: "nipah", patterns: [/\bnipah\b/i] },
  { key: "cholera", patterns: [/\bcholera\b/i] },
  { key: "rabies", patterns: [/\brabies\b/i] },
];

export const VIRUS_LABELS = {
  measles: "Measles",
  chikungunya: "Chikungunya",
  poliovirus: "Poliovirus",
  oropouche: "Oropouche",
  avian_influenza: "Avian influenza",
  yellow_fever: "Yellow fever",
  dengue: "Dengue",
  zika: "Zika",
  mpox: "Mpox",
  ebola: "Ebola",
  marburg: "Marburg",
  west_nile: "West Nile",
  covid_19: "COVID-19",
  rsv: "RSV",
  norovirus: "Norovirus",
  hantavirus: "Hantavirus",
  lassa: "Lassa fever",
  nipah: "Nipah",
  cholera: "Cholera",
  rabies: "Rabies",
};

const STATUS_RULES = [
  { status: "active", patterns: [/\boutbreak\b/i, /\bcluster\b/i, /\bepidemic\b/i] },
  { status: "advisory", patterns: [/\btravel (notice|advisory|warning)\b/i, /\blevel [1-4]\b/i, /\bissued (a )?notice\b/i] },
  { status: "imported", patterns: [/\bimported case\b/i, /\btraveler[- ]associated\b/i, /\breturning traveler\b/i] },
  { status: "monitoring", patterns: [/\bsurveillance\b/i, /\bmonitoring\b/i, /\bsituation report\b/i] },
  { status: "contained", patterns: [/\bdeclared over\b/i, /\bcontained\b/i, /\bend of outbreak\b/i] },
];

const EVENT_TYPE_RULES = [
  { type: "lineage", patterns: [/\blineage\b/i, /\bgenotype\b/i, /\bsequencing\b/i] },
  { type: "environmental", patterns: [/\bwastewater\b/i, /\benvironmental (sample|detection)\b/i] },
  { type: "advisory", patterns: [/\btravel (notice|advisory|warning)\b/i] },
  { type: "imported_case", patterns: [/\bimported case\b/i, /\btraveler[- ]associated\b/i] },
  { type: "outbreak", patterns: [/\boutbreak\b/i, /\bcluster\b/i] },
];

const PATHWAY_RULES = [
  { pathway: "vector", patterns: [/\bmosquito\b/i, /\bAedes\b/i, /\bvector[- ]borne\b/i] },
  { pathway: "animal_exposure", patterns: [/\bpoultry\b/i, /\banimal exposure\b/i, /\bzoonotic\b/i] },
  { pathway: "land_border", patterns: [/\bland border\b/i, /\bborder crossing\b/i] },
  { pathway: "air_travel", patterns: [/\bair (travel|port)\b/i, /\bflight\b/i, /\bairline\b/i] },
  { pathway: "returning_resident", patterns: [/\breturning (resident|traveler)\b/i, /\brepatriation\b/i] },
];

export function detectVirus(text) {
  const t = String(text || "");
  for (const { key, patterns } of TRACKED_VIRUSES) {
    if (patterns.some((re) => re.test(t))) return key;
  }
  return null;
}

export function detectStatus(text) {
  const t = String(text || "");
  for (const { status, patterns } of STATUS_RULES) {
    if (patterns.some((re) => re.test(t))) return status;
  }
  return null;
}

export function detectEventType(text) {
  const t = String(text || "");
  for (const { type, patterns } of EVENT_TYPE_RULES) {
    if (patterns.some((re) => re.test(t))) return type;
  }
  return "news";
}

export function detectUSPathway(text) {
  const t = String(text || "");
  for (const { pathway, patterns } of PATHWAY_RULES) {
    if (patterns.some((re) => re.test(t))) return pathway;
  }
  return null;
}

// Country detection — kept lightweight (high-frequency outbreak countries).
// Geocoding is deferred; the dashboard just shows the country name.
const COUNTRY_RULES = [
  ["United States", /\b(United States|USA|U\.S\.|U\.S\.A\.)\b/i],
  ["Brazil", /\bBrazil\b/i],
  ["Suriname", /\bSuriname\b/i],
  ["Venezuela", /\bVenezuela\b/i],
  ["Mexico", /\bMexico\b/i],
  ["Canada", /\bCanada\b/i],
  ["Italy", /\bItaly\b/i],
  ["Senegal", /\bSenegal\b/i],
  ["Ethiopia", /\bEthiopia\b/i],
  ["Uganda", /\bUganda\b/i],
  ["Democratic Republic of the Congo", /\b(Democratic Republic of the Congo|DRC|DR Congo)\b/i],
  ["Sudan", /\bSudan\b/i],
  ["Pakistan", /\bPakistan\b/i],
  ["Afghanistan", /\bAfghanistan\b/i],
  ["Yemen", /\bYemen\b/i],
  ["Madagascar", /\bMadagascar\b/i],
  ["Nigeria", /\bNigeria\b/i],
  ["Kenya", /\bKenya\b/i],
  ["Tanzania", /\bTanzania\b/i],
  ["Indonesia", /\bIndonesia\b/i],
  ["Philippines", /\bPhilippines\b/i],
  ["India", /\bIndia\b/i],
  ["China", /\bChina\b/i],
];

export function detectCountry(text) {
  const t = String(text || "");
  for (const [name, re] of COUNTRY_RULES) {
    if (re.test(t)) return name;
  }
  return null;
}

export function makeEventId(parts) {
  const h = createHash("sha1");
  for (const p of parts) h.update(String(p ?? ""));
  return h.digest("hex").slice(0, 16);
}

// Build a normalized event row from a per-connector raw record. Connectors
// can pass additional fields (origin_country, current_spread, etc.) and they
// override the auto-detected values.
export function makeEvent({
  source,
  source_id,
  source_url,
  title,
  summary = "",
  report_date,
  origin_country = null,
  origin_setting = null,
  current_spread = null,
  us_pathway = null,
  us_cases = null,
  region = null,
  latitude = null,
  longitude = null,
  status = null,
  event_type = null,
  virus = null,
  raw = null,
}) {
  const blob = `${title} ${summary}`;
  // Country detection runs against the title only — scanning the full body
  // produces too many false positives (e.g. "In Brazil, similarly...").
  const titleStr = String(title || "");
  return {
    id: makeEventId([source_id, source_url, title, report_date]),
    source,
    source_id,
    source_url,
    report_date: report_date || new Date().toISOString(),
    virus: virus || detectVirus(blob),
    event_type: event_type || detectEventType(blob),
    status: status || detectStatus(blob) || "monitoring",
    origin_country: origin_country || detectCountry(titleStr),
    origin_setting,
    current_spread,
    us_pathway: us_pathway || detectUSPathway(blob),
    us_cases,
    title: titleStr.trim(),
    summary: String(summary || "").trim().slice(0, 800),
    region,
    latitude,
    longitude,
    scraped_at: new Date().toISOString(),
    raw,
  };
}
