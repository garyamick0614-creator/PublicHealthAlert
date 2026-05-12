// HealthMap — global ProMED-style alert aggregator (Boston Children's
// Hospital). The public getAlerts.php endpoint returns a JSON document where
// `listview` is a list of arrays in column-positional order:
//   [icon_html, date_str, headline_anchor_html, disease, place_anchor_html,
//    null, null, null, rating_html]
// We re-extract clean text + source URLs and filter on the dashboard's
// tracked-virus list. The endpoint accepts days= (recency window in days).

import { fetchJson } from "../lib/fetch.mjs";
import { detectVirus, detectCountry, makeEvent } from "../lib/schema.mjs";

const API_URL = "https://www.healthmap.org/getAlerts.php?days=14";

const SOURCE = "HealthMap";
const SOURCE_ID = "healthmap";

export const meta = {
  id: SOURCE_ID,
  name: "HealthMap — Global outbreak intelligence",
  url: "https://www.healthmap.org/",
  format: "JSON",
  access: "public",
  region_scope: "Global",
};

function stripTags(s) {
  return String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function extractHref(html) {
  if (!html) return null;
  const m = String(html).match(/href="([^"]+)"/);
  if (!m) return null;
  let href = m[1];
  // HealthMap headlines often use relative ../ai.php?ID URLs. Normalize to
  // an absolute URL on healthmap.org so the link works from the dashboard.
  if (href.startsWith("../")) href = href.slice(3);
  if (href.startsWith("javascript:")) return null;
  if (href.startsWith("//")) return `https:${href}`;
  if (href.startsWith("http")) return href;
  return `https://www.healthmap.org/${href.replace(/^\/+/, "")}`;
}

function extractRating(html) {
  if (!html) return null;
  const m = String(html).match(/<span>(\d+)<\/span>/);
  return m ? Number(m[1]) : null;
}

export async function scrape({ logger }) {
  let payload;
  try {
    payload = await fetchJson(API_URL);
  } catch (e) {
    logger.error("healthmap.api_failed", { error: e.message });
    return [];
  }
  const rows = Array.isArray(payload?.listview) ? payload.listview : [];
  logger.info("healthmap.api_loaded", { rows: rows.length });

  const events = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const dateStr = String(row[1] || "").trim();
    const headlineHtml = row[2];
    const disease = String(row[3] || "").trim();
    const placeHtml = row[4];
    const ratingHtml = row.length > 8 ? row[8] : null;

    const title = stripTags(headlineHtml);
    if (!title) continue;
    const place = stripTags(placeHtml);
    const link = extractHref(headlineHtml);

    const detected = detectVirus(`${disease} ${title}`);
    if (!detected) continue;

    // HealthMap dates look like "12 May 2026"; Date.parse handles that well.
    let reportDate = null;
    if (dateStr) {
      const t = Date.parse(dateStr);
      if (!Number.isNaN(t)) reportDate = new Date(t).toISOString();
    }

    const rating = extractRating(ratingHtml);
    const country = detectCountry(place) || (place.split(",").pop() || "").trim() || null;

    events.push(
      makeEvent({
        source: SOURCE,
        source_id: SOURCE_ID,
        source_url: link || "https://www.healthmap.org/",
        title,
        summary: `HealthMap aggregated alert. Disease: ${disease || detected}. Place: ${place || "—"}. Editorial confidence rating: ${rating ?? "—"}/5.`,
        report_date: reportDate,
        region: place || null,
        origin_country: country,
        virus: detected,
        raw: { disease, place, rating, date_str: dateStr },
      })
    );
  }

  // De-dupe by id (title+url collisions across multi-source aggregation).
  const seen = new Set();
  const unique = events.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  logger.info("healthmap.scraped", { count: unique.length, dropped_dupes: events.length - unique.length });
  return unique;
}
