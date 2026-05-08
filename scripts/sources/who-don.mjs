// WHO Disease Outbreak News (DON) — RSS first, with fallback feeds.
// Filters items down to virus-related public-health events.

import Parser from "rss-parser";
import { fetchText } from "../lib/fetch.mjs";
import { detectVirus, makeEvent } from "../lib/schema.mjs";

const FEED_CANDIDATES = [
  "https://www.who.int/feeds/entity/csr/don/en/rss.xml",
  "https://www.who.int/rss-feeds/news-english.xml",
];

const SOURCE = "WHO DON";
const SOURCE_ID = "who-don";

export const meta = {
  id: SOURCE_ID,
  name: "WHO Disease Outbreak News",
  url: "https://www.who.int/emergencies/disease-outbreak-news",
};

export async function scrape({ logger }) {
  const parser = new Parser({ timeout: 30_000 });
  let feed = null;
  let usedUrl = null;

  for (const url of FEED_CANDIDATES) {
    try {
      const xml = await fetchText(url, { accept: "application/rss+xml,application/xml,text/xml" });
      feed = await parser.parseString(xml);
      usedUrl = url;
      break;
    } catch (e) {
      logger.warn("who_don.feed_unavailable", { url, error: e.message });
    }
  }
  if (!feed) {
    logger.error("who_don.no_feed_available");
    return [];
  }
  logger.info("who_don.feed_loaded", { url: usedUrl, items: feed.items.length });

  const events = [];
  for (const item of feed.items) {
    const title = item.title || "";
    const summary = item.contentSnippet || item.content || item.summary || "";
    const link = item.link || "";
    const virus = detectVirus(`${title} ${summary}`);
    // Only keep items that match a tracked virus. WHO publishes a lot of
    // policy/governance news that mentions "disease" generically — those
    // create noise on a virus-focused dashboard.
    if (!virus) continue;
    events.push(
      makeEvent({
        source: SOURCE,
        source_id: SOURCE_ID,
        source_url: link,
        title,
        summary,
        report_date: item.isoDate || item.pubDate || null,
        region: "Global",
        virus,
      })
    );
  }
  logger.info("who_don.scraped", { count: events.length });
  return events;
}
