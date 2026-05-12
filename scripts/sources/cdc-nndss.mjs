// CDC NNDSS — National Notifiable Diseases Surveillance System.
// Structured Socrata JSON of state-by-state weekly case counts for tracked
// notifiable diseases. We pull the most-recent week with any non-zero counts
// and emit one event per (disease, state) row where state is an actual state
// (filtering out census regions like "New England", "Pacific", territory
// aggregations, and the national/residents rollup).
//
// Dataset: data.cdc.gov/resource/x9gk-5huc (Weekly Cases of Notifiable
// Diseases, 2022-present). Probed real-time: returns 2026 weekly data.

import { fetchJson } from "../lib/fetch.mjs";
import { makeEvent, detectVirus } from "../lib/schema.mjs";

const DATASET_URL = "https://data.cdc.gov/resource/x9gk-5huc.json";

const SOURCE = "CDC NNDSS";
const SOURCE_ID = "cdc-nndss";

export const meta = {
  id: SOURCE_ID,
  name: "CDC NNDSS — Weekly Notifiable Disease Counts",
  url: "https://wwwn.cdc.gov/nndss/",
  format: "JSON API (Socrata)",
  access: "public",
  region_scope: "United States (by state)",
};

// Census regions and rollups we DO NOT want as per-event "origin_country" —
// only true state rows go in. NNDSS uses the literal label "U.S. Residents"
// for the national rollup, and these census-division names for regional rows.
const NOT_A_STATE = new Set([
  "U.S. Residents",
  "US RESIDENTS",
  "Total",
  "New England",
  "Middle Atlantic",
  "East North Central",
  "West North Central",
  "South Atlantic",
  "East South Central",
  "West South Central",
  "Mountain",
  "Pacific",
  "U.S. Territories",
  "American Samoa",
  "Northern Mariana Islands",
  "Guam",
  "U.S. Virgin Islands",
  "Puerto Rico",
]);

// Map NNDSS disease labels to virus keys understood by `detectVirus`.
// We only emit events for diseases the dashboard already tracks; the rest
// (anthrax, mumps, etc.) are filed in the raw JSON but not normalized.
function diseaseToVirus(label) {
  const l = String(label || "");
  if (/Chikungunya/i.test(l)) return "chikungunya";
  if (/Dengue/i.test(l)) return "dengue";
  if (/Measles|Rubeola/i.test(l)) return "measles";
  if (/Mpox|Monkeypox/i.test(l)) return "mpox";
  if (/Hantavirus|HPS|Pulmonary Syndrome/i.test(l)) return "hantavirus";
  if (/Polio/i.test(l)) return "poliovirus";
  if (/Yellow fever/i.test(l)) return "yellow_fever";
  if (/Zika/i.test(l)) return "zika";
  if (/West Nile/i.test(l)) return "west_nile";
  if (/Norovirus/i.test(l)) return "norovirus";
  if (/Avian|H5N1|Bird flu|Influenza A.*novel/i.test(l)) return "avian_influenza";
  if (/RSV|Respiratory syncytial/i.test(l)) return "rsv";
  if (/Cholera/i.test(l)) return "cholera";
  if (/Lassa/i.test(l)) return "lassa";
  if (/Marburg/i.test(l)) return "marburg";
  if (/Ebola/i.test(l)) return "ebola";
  if (/Nipah/i.test(l)) return "nipah";
  // Fall back to free-text detection so synonyms get caught.
  return detectVirus(l);
}

// Pull the latest year+week with any rows. We pull (year, week) descending,
// then filter to that pair client-side, plus add filters for non-zero count.
async function fetchLatestWeek(logger) {
  const probeUrl = new URL(DATASET_URL);
  probeUrl.searchParams.set("$select", "year,week");
  probeUrl.searchParams.set("$order", "year DESC, week DESC");
  probeUrl.searchParams.set("$limit", "1");
  const probe = await fetchJson(probeUrl.toString());
  if (!Array.isArray(probe) || !probe.length) {
    throw new Error("nndss probe returned empty");
  }
  const { year, week } = probe[0];
  logger.info("cdc_nndss.latest_week", { year, week });
  return { year, week };
}

export async function scrape({ logger }) {
  let week;
  try {
    week = await fetchLatestWeek(logger);
  } catch (e) {
    logger.error("cdc_nndss.probe_failed", { error: e.message });
    return [];
  }

  const url = new URL(DATASET_URL);
  url.searchParams.set("$where", `year='${week.year}' AND week='${week.week}' AND m2>0`);
  url.searchParams.set("$order", "label,states");
  url.searchParams.set("$limit", "5000");

  let rows;
  try {
    rows = await fetchJson(url.toString());
  } catch (e) {
    logger.error("cdc_nndss.fetch_failed", { error: e.message });
    return [];
  }
  if (!Array.isArray(rows)) {
    logger.warn("cdc_nndss.unexpected_payload");
    return [];
  }
  logger.info("cdc_nndss.rows_loaded", { count: rows.length, year: week.year, week: week.week });

  const events = [];
  // NNDSS reports weeks running Sunday-Saturday; we synthesize a report_date
  // anchored at the Friday of that MMWR week so the events sort with other
  // late-week reports. This is intentionally an approximation; the truth is
  // the (year, week) pair, which we keep in raw.
  const reportDate = mmwrWeekToDate(Number(week.year), Number(week.week));

  for (const r of rows) {
    const label = String(r.label || "").trim();
    const state = String(r.states || "").trim();
    const count = Number(r.m2 || 0);
    if (!label || !state) continue;
    if (NOT_A_STATE.has(state)) continue;
    if (!Number.isFinite(count) || count <= 0) continue;

    const virus = diseaseToVirus(label);
    if (!virus) continue;

    const title = `${label}: ${count} new case${count === 1 ? "" : "s"} reported in ${state}`;
    const summary = `CDC NNDSS week ${week.week} of ${week.year}. State-reported confirmed/probable cases per the national notifiable diseases surveillance feed. Counts can revise upward as late reports arrive.`;
    const sourceUrl = `https://data.cdc.gov/resource/x9gk-5huc.json?year=${encodeURIComponent(
      week.year
    )}&week=${encodeURIComponent(week.week)}&label=${encodeURIComponent(label)}&states=${encodeURIComponent(state)}`;

    events.push(
      makeEvent({
        source: SOURCE,
        source_id: SOURCE_ID,
        source_url: sourceUrl,
        title,
        summary,
        report_date: reportDate,
        region: "United States",
        origin_country: "United States",
        status: "monitoring",
        event_type: "surveillance",
        virus,
        us_cases: count,
        raw: { state, disease: label, count, mmwr_year: week.year, mmwr_week: week.week },
      })
    );
  }

  logger.info("cdc_nndss.scraped", { events: events.length, week: `${week.year}W${week.week}` });
  return events;
}

// MMWR weeks: week 1 of year Y is the week containing Jan 4. We approximate
// by computing Jan 4 + (week-1)*7 days and snapping to the Friday of that
// week. Good enough for sort-order on a daily dashboard.
function mmwrWeekToDate(year, week) {
  if (!Number.isFinite(year) || !Number.isFinite(week)) return new Date().toISOString();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay(); // 0=Sun
  // Start of MMWR week 1 = the Sunday on or before Jan 4
  const week1Start = new Date(jan4);
  week1Start.setUTCDate(jan4.getUTCDate() - jan4Day);
  const target = new Date(week1Start);
  target.setUTCDate(week1Start.getUTCDate() + (week - 1) * 7 + 5); // Friday of MMWR week
  return target.toISOString();
}
