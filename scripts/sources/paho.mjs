// PAHO — Pan American Health Organization news listing.
// PAHO uses Drupal with a clean URL pattern: /en/news/<DD-M-YYYY>-<slug>.
// We harvest every anchor whose href starts with /en/news/<digit> (the
// date-prefixed slug pattern) and parse the date out of the URL itself —
// far more reliable than chasing specific Drupal class names which rotate.

import * as cheerio from "cheerio";
import { fetchText } from "../lib/fetch.mjs";
import { detectVirus, makeEvent } from "../lib/schema.mjs";

const NEWS_PAGES = [
  "https://www.paho.org/en/news",
  "https://www.paho.org/en/news/news-releases",
];

const SOURCE = "PAHO";
const SOURCE_ID = "paho";

// /en/news/7-5-2026-paho-supports-...   →   2026-05-07
const URL_DATE_RE = /\/news\/(\d{1,2})-(\d{1,2})-(\d{4})-/;

export const meta = {
  id: SOURCE_ID,
  name: "PAHO — Pan American Health Organization",
  url: "https://www.paho.org/en/news",
};

function parseDateFromUrl(url) {
  const m = URL_DATE_RE.exec(url);
  if (!m) return null;
  const [, d, mo, y] = m;
  // PAHO URLs are D-M-YYYY (European). Build an ISO date at noon UTC.
  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T12:00:00Z`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : iso;
}

async function harvestPage(url, logger) {
  let html;
  try {
    html = await fetchText(url);
  } catch (e) {
    logger.warn("paho.fetch_failed", { url, error: e.message });
    return [];
  }
  const $ = cheerio.load(html);
  const events = [];
  const seen = new Set();

  $('a[href*="/en/news/"]').each((_, a) => {
    const $a = $(a);
    const href = $a.attr("href") || "";
    if (!URL_DATE_RE.test(href)) return; // skip section anchors like /en/news/news-releases
    const text = $a.text().replace(/\s+/g, " ").trim();
    if (!text || text.length < 8) return;
    const u = href.startsWith("http") ? href : new URL(href, "https://www.paho.org").toString();
    if (seen.has(u)) return;
    seen.add(u);
    const virus = detectVirus(text);
    if (!virus) return;
    events.push(
      makeEvent({
        source: SOURCE,
        source_id: SOURCE_ID,
        source_url: u,
        title: text,
        summary: "",
        report_date: parseDateFromUrl(u),
        region: "Americas",
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
  // Cross-page dedupe by id
  const seen = new Set();
  const unique = all.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
  logger.info("paho.scraped", { count: unique.length });
  return unique;
}
