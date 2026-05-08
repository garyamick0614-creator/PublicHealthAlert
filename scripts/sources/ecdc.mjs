// ECDC — Communicable Disease Threats Report (CDTR) and publications.
// ECDC has rotated its RSS endpoints; we try the historical feeds first and
// fall back to scraping the public threats / news pages.

import Parser from "rss-parser";
import * as cheerio from "cheerio";
import { fetchText } from "../lib/fetch.mjs";
import { detectVirus, makeEvent } from "../lib/schema.mjs";

const FEED_CANDIDATES = [
  "https://www.ecdc.europa.eu/en/taxonomy/term/381/feed",
  "https://www.ecdc.europa.eu/en/threats-and-outbreaks/feed",
];

const HTML_FALLBACKS = [
  "https://www.ecdc.europa.eu/en/threats-and-outbreaks",
  "https://www.ecdc.europa.eu/en/news-events",
];

const SOURCE = "ECDC";
const SOURCE_ID = "ecdc";

export const meta = {
  id: SOURCE_ID,
  name: "ECDC — Communicable Disease Threats",
  url: "https://www.ecdc.europa.eu/en/threats-and-outbreaks",
};

async function tryRss(logger) {
  const parser = new Parser({ timeout: 30_000 });
  for (const url of FEED_CANDIDATES) {
    try {
      const xml = await fetchText(url, { accept: "application/rss+xml,application/xml,text/xml" });
      const feed = await parser.parseString(xml);
      logger.info("ecdc.feed_loaded", { url, items: feed.items.length });
      const events = [];
      for (const item of feed.items) {
        const title = item.title || "";
        const summary = item.contentSnippet || item.content || item.summary || "";
        const virus = detectVirus(`${title} ${summary}`);
        if (!virus) continue;
        events.push(
          makeEvent({
            source: SOURCE,
            source_id: SOURCE_ID,
            source_url: item.link || url,
            title,
            summary,
            report_date: item.isoDate || item.pubDate || null,
            region: "Europe / global signal",
            virus,
          })
        );
      }
      return events;
    } catch (e) {
      logger.warn("ecdc.feed_unavailable", { url, error: e.message });
    }
  }
  return null;
}

async function scrapeHtml(url, logger) {
  try {
    const html = await fetchText(url);
    const $ = cheerio.load(html);
    const events = [];
    const seen = new Set();
    // ECDC Drupal pages use a mix of card structures; try a broad set of
    // selectors and dedupe by URL.
    $("article a, .views-row a, .node a, h2 a, h3 a").each((_, a) => {
      const $a = $(a);
      const text = $a.text().trim();
      const href = $a.attr("href");
      if (!text || !href) return;
      if (text.length < 6) return;
      const virus = detectVirus(text);
      if (!virus) return;
      const u = href.startsWith("http") ? href : new URL(href, "https://www.ecdc.europa.eu").toString();
      if (seen.has(u)) return;
      seen.add(u);
      const $card = $a.closest("article, .views-row, .node");
      const dateText = $card.find("time").attr("datetime") || null;
      events.push(
        makeEvent({
          source: SOURCE,
          source_id: SOURCE_ID,
          source_url: u,
          title: text,
          summary: "",
          report_date: dateText ? new Date(dateText).toISOString() : null,
          region: "Europe / global signal",
          virus,
        })
      );
    });
    logger.info("ecdc.html_parsed", { url, count: events.length });
    return events;
  } catch (e) {
    logger.warn("ecdc.html_unavailable", { url, error: e.message });
    return [];
  }
}

export async function scrape({ logger }) {
  const rssEvents = await tryRss(logger);
  if (rssEvents && rssEvents.length > 0) {
    logger.info("ecdc.scraped", { count: rssEvents.length, mode: "rss" });
    return rssEvents;
  }

  // RSS unavailable or empty — fall back to HTML scraping
  const all = [];
  for (const url of HTML_FALLBACKS) {
    const events = await scrapeHtml(url, logger);
    all.push(...events);
  }
  // Cross-page de-dupe by id
  const seen = new Set();
  const unique = all.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
  logger.info("ecdc.scraped", { count: unique.length, mode: "html" });
  return unique;
}
