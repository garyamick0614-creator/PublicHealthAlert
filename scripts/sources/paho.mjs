// PAHO — Pan American Health Organization news listing.
// PAHO does not expose a documented RSS for outbreaks at a stable URL; we
// scrape the news index and filter by virus keywords. Cards are the spread
// signal for the Americas region.

import * as cheerio from "cheerio";
import { fetchText } from "../lib/fetch.mjs";
import { detectVirus, makeEvent } from "../lib/schema.mjs";

const NEWS_URL = "https://www.paho.org/en/news";

const SOURCE = "PAHO";
const SOURCE_ID = "paho";

export const meta = {
  id: SOURCE_ID,
  name: "PAHO — Pan American Health Organization",
  url: "https://www.paho.org/en/topics",
};

export async function scrape({ logger }) {
  let html;
  try {
    html = await fetchText(NEWS_URL);
  } catch (e) {
    logger.error("paho.fetch_failed", { error: e.message });
    return [];
  }
  const $ = cheerio.load(html);
  const events = [];

  // PAHO Drupal markup commonly uses .views-row > h3 > a for news cards.
  // We try a few selector patterns to be resilient to layout changes.
  const candidates = [
    ".views-row h3 a",
    ".node--type-article h2 a",
    "article h2 a",
    ".views-row a[href*='/news/']",
  ];

  const rows = new Map();
  for (const sel of candidates) {
    $(sel).each((_, a) => {
      const $a = $(a);
      const text = $a.text().trim();
      const href = $a.attr("href");
      if (!text || !href) return;
      const virus = detectVirus(text);
      if (!virus) return;
      const url = href.startsWith("http") ? href : new URL(href, "https://www.paho.org").toString();
      if (rows.has(url)) return;
      const $card = $a.closest(".views-row, article");
      const dateText = $card.find("time").attr("datetime") || $card.find(".date, .views-field-created").first().text().trim() || null;
      rows.set(url, { text, url, virus, dateText });
    });
  }

  for (const { text, url, virus, dateText } of rows.values()) {
    events.push(
      makeEvent({
        source: SOURCE,
        source_id: SOURCE_ID,
        source_url: url,
        title: text,
        summary: "",
        report_date: parseDate(dateText),
        region: "Americas",
        virus,
      })
    );
  }
  logger.info("paho.scraped", { count: events.length });
  return events;
}

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
