// CDC — outbreak index page + travel notices RSS.
// CDC publishes a structured travel notices RSS plus an HTML outbreak index;
// using both gives us U.S.-relevant import warnings and outbreak signals.

import Parser from "rss-parser";
import * as cheerio from "cheerio";
import { fetchText } from "../lib/fetch.mjs";
import { detectVirus, makeEvent } from "../lib/schema.mjs";

const TRAVEL_RSS = "https://wwwnc.cdc.gov/travel/rss/notices.xml";
const NEWSROOM_RSS = "https://tools.cdc.gov/api/v2/resources/media/132608.rss";
const OUTBREAKS_HTML = "https://www.cdc.gov/outbreaks/index.html";

const SOURCE = "CDC";
const SOURCE_ID = "cdc";

export const meta = {
  id: SOURCE_ID,
  name: "CDC — Outbreaks & Travel Advisories",
  url: "https://www.cdc.gov/outbreaks/",
};

async function scrapeTravelRss(logger) {
  try {
    const parser = new Parser({ timeout: 30_000 });
    const xml = await fetchText(TRAVEL_RSS, { accept: "application/rss+xml,application/xml" });
    const feed = await parser.parseString(xml);
    logger.info("cdc.travel_feed_loaded", { items: feed.items.length });
    const events = [];
    for (const item of feed.items) {
      const title = item.title || "";
      const summary = item.contentSnippet || item.content || "";
      const blob = `${title} ${summary}`;
      const virus = detectVirus(blob);
      if (!virus) continue;
      events.push(
        makeEvent({
          source: SOURCE,
          source_id: SOURCE_ID,
          source_url: item.link || TRAVEL_RSS,
          title,
          summary,
          report_date: item.isoDate || item.pubDate || null,
          region: "United States (advisory issuer)",
          us_pathway: "air_travel",
          status: "advisory",
          event_type: "advisory",
          virus,
        })
      );
    }
    return events;
  } catch (e) {
    logger.warn("cdc.travel_feed_unavailable", { error: e.message });
    return [];
  }
}

// CDC's newsroom RSS includes years of historical items. We only want
// content within the recency window — old policy/funding announcements that
// happen to mention a virus name are noise on a current-events dashboard.
const NEWSROOM_RECENCY_DAYS = 180;

async function scrapeNewsroomRss(logger) {
  try {
    const parser = new Parser({ timeout: 30_000 });
    const xml = await fetchText(NEWSROOM_RSS, { accept: "application/rss+xml,application/xml" });
    const feed = await parser.parseString(xml);
    logger.info("cdc.newsroom_feed_loaded", { items: feed.items.length });
    const cutoff = Date.now() - NEWSROOM_RECENCY_DAYS * 24 * 3600 * 1000;
    const events = [];
    for (const item of feed.items) {
      const title = item.title || "";
      const summary = item.contentSnippet || item.content || "";
      // The recency filter does the heavy lifting; we keep matching on
      // title + summary so press releases that mention the virus in the
      // body (but not the headline) still get through.
      const dt = item.isoDate || item.pubDate;
      const ts = dt ? Date.parse(dt) : NaN;
      if (Number.isNaN(ts) || ts < cutoff) continue;
      const virus = detectVirus(`${title} ${summary}`);
      if (!virus) continue;
      events.push(
        makeEvent({
          source: SOURCE,
          source_id: SOURCE_ID,
          source_url: item.link || NEWSROOM_RSS,
          title,
          summary,
          report_date: dt,
          region: "United States",
          virus,
        })
      );
    }
    logger.info("cdc.newsroom_filtered", { kept: events.length, recency_days: NEWSROOM_RECENCY_DAYS });
    return events;
  } catch (e) {
    logger.warn("cdc.newsroom_feed_unavailable", { error: e.message });
    return [];
  }
}

async function scrapeOutbreaksHtml(logger) {
  try {
    const html = await fetchText(OUTBREAKS_HTML);
    const $ = cheerio.load(html);
    const events = [];
    // CDC outbreak index lists current outbreaks as anchor lists; we capture
    // every same-domain link with title text and apply virus filter.
    $('a[href*="/outbreaks/"], a[href*="/measles/"], a[href*="/parasites/"]').each((_, a) => {
      const $a = $(a);
      const text = $a.text().trim();
      const href = $a.attr("href");
      if (!text || !href) return;
      if (text.length < 4) return;
      const virus = detectVirus(text);
      if (!virus) return;
      const url = href.startsWith("http") ? href : new URL(href, "https://www.cdc.gov").toString();
      events.push(
        makeEvent({
          source: SOURCE,
          source_id: SOURCE_ID,
          source_url: url,
          title: text,
          summary: "",
          report_date: null,
          region: "United States",
          virus,
        })
      );
    });
    // De-dupe by URL
    const seen = new Set();
    const unique = events.filter((e) => {
      if (seen.has(e.source_url)) return false;
      seen.add(e.source_url);
      return true;
    });
    logger.info("cdc.outbreaks_html_parsed", { count: unique.length });
    return unique;
  } catch (e) {
    logger.warn("cdc.outbreaks_html_unavailable", { error: e.message });
    return [];
  }
}

export async function scrape({ logger }) {
  const [travel, newsroom, outbreaks] = await Promise.all([
    scrapeTravelRss(logger),
    scrapeNewsroomRss(logger),
    scrapeOutbreaksHtml(logger),
  ]);
  const combined = [...travel, ...newsroom, ...outbreaks];
  // De-dupe across all feeds by id
  const seen = new Set();
  const unique = combined.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
  logger.info("cdc.scraped", {
    total: unique.length,
    travel: travel.length,
    newsroom: newsroom.length,
    outbreaks: outbreaks.length,
  });
  return unique;
}
