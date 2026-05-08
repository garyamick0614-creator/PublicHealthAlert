// Outbreak News Today — independent infectious disease news outlet with a
// stable WordPress RSS feed. Titles consistently lead with the country
// (e.g. "India: H5N1 Reported..."), so we can extract origin_country with
// a simple prefix split.

import Parser from "rss-parser";
import { fetchText } from "../lib/fetch.mjs";
import { detectVirus, makeEvent } from "../lib/schema.mjs";

const FEED_URL = "https://outbreaknewstoday.com/feed/";
const SOURCE = "Outbreak News Today";
const SOURCE_ID = "outbreak-news-today";

// Items where the colon-prefix is a US state name should be tagged as United States.
const US_STATES = new Set([
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut",
  "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan",
  "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire",
  "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
  "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia",
  "Wisconsin", "Wyoming", "District of Columbia",
]);

const NON_GEO_PREFIXES = new Set([
  "Update", "Breaking", "Opinion", "Analysis", "Editorial", "Interview",
]);

export const meta = {
  id: SOURCE_ID,
  name: "Outbreak News Today",
  url: "https://outbreaknewstoday.com/",
};

function extractCountryFromPrefix(title) {
  if (!title) return null;
  const colonIdx = title.indexOf(":");
  if (colonIdx === -1 || colonIdx > 35) return null;
  const prefix = title.slice(0, colonIdx).trim();
  if (!prefix || prefix.length < 2 || prefix.length > 30) return null;
  if (NON_GEO_PREFIXES.has(prefix)) return null;
  if (US_STATES.has(prefix)) return "United States";
  // Heuristic: prefix should look like a country/state name (mostly letters and spaces)
  if (!/^[A-Z][A-Za-z][A-Za-z\s.'-]{1,28}$/.test(prefix)) return null;
  return prefix;
}

export async function scrape({ logger }) {
  const parser = new Parser({ timeout: 30_000 });
  let feed;
  try {
    const xml = await fetchText(FEED_URL, { accept: "application/rss+xml,application/xml" });
    feed = await parser.parseString(xml);
  } catch (e) {
    logger.error("ont.feed_failed", { error: e.message });
    return [];
  }
  logger.info("ont.feed_loaded", { items: feed.items.length });

  const events = [];
  for (const item of feed.items) {
    const title = item.title || "";
    const summary = item.contentSnippet || item.content || "";
    const virus = detectVirus(`${title} ${summary}`);
    if (!virus) continue;
    const country = extractCountryFromPrefix(title);
    events.push(
      makeEvent({
        source: SOURCE,
        source_id: SOURCE_ID,
        source_url: item.link || FEED_URL,
        title,
        summary,
        report_date: item.isoDate || item.pubDate || null,
        region: "Global",
        origin_country: country,
        virus,
      })
    );
  }
  logger.info("ont.scraped", { count: events.length });
  return events;
}
