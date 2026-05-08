// Africa CDC — news index. WordPress structure with a /news-item/<slug>/
// pattern for individual posts. We harvest those anchors directly.

import * as cheerio from "cheerio";
import { fetchText } from "../lib/fetch.mjs";
import { detectVirus, makeEvent } from "../lib/schema.mjs";

const NEWS_PAGES = [
  "https://africacdc.org/news/",
];

const FETCH_OPTS = { timeoutMs: 12_000, retries: 0 };

const SOURCE = "Africa CDC";
const SOURCE_ID = "africa-cdc";

export const meta = {
  id: SOURCE_ID,
  name: "Africa CDC — News & Outbreak Archive",
  url: "https://africacdc.org/news/",
};

async function harvestPage(url, logger) {
  let html;
  try {
    html = await fetchText(url, FETCH_OPTS);
  } catch (e) {
    logger.warn("africa_cdc.fetch_failed", { url, error: e.message });
    return [];
  }
  const $ = cheerio.load(html);
  const events = [];
  const seen = new Set();

  $('a[href*="/news-item/"]').each((_, a) => {
    const $a = $(a);
    const href = $a.attr("href") || "";
    const text = $a.text().replace(/\s+/g, " ").trim();
    if (!text || text.length < 8) return;
    const u = href.startsWith("http") ? href : new URL(href, "https://africacdc.org").toString();
    if (seen.has(u)) return;
    seen.add(u);
    const virus = detectVirus(text);
    if (!virus) return;
    // Try to find a date in a sibling element (.entry-date, time)
    const $card = $a.closest("article, .post, .entry");
    const dateAttr = $card.find("time").attr("datetime");
    const reportDate = dateAttr ? new Date(dateAttr).toISOString() : null;
    events.push(
      makeEvent({
        source: SOURCE,
        source_id: SOURCE_ID,
        source_url: u,
        title: text,
        summary: "",
        report_date: reportDate,
        region: "Africa",
        virus,
      })
    );
  });

  return events;
}

export async function scrape({ logger }) {
  const all = [];
  for (const url of NEWS_PAGES) {
    const events = await harvestPage(url, logger);
    all.push(...events);
  }
  const seen = new Set();
  const unique = all.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
  logger.info("africa_cdc.scraped", { count: unique.length });
  return unique;
}
