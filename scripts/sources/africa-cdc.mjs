// Africa CDC — Disease pages and news index.
// No documented public outbreak API exists; we capture the disease-class
// pages and the news listing, filtered to virus-related items.

import * as cheerio from "cheerio";
import { fetchText } from "../lib/fetch.mjs";
import { detectVirus, makeEvent } from "../lib/schema.mjs";

const NEWS_URL = "https://africacdc.org/news/";
const DISEASE_INDEX = "https://africacdc.org/disease/";

const SOURCE = "Africa CDC";
const SOURCE_ID = "africa-cdc";

export const meta = {
  id: SOURCE_ID,
  name: "Africa CDC — Outbreak Archive",
  url: "https://africacdc.org/disease/",
};

async function scrapePage(url, logger) {
  try {
    const html = await fetchText(url);
    const $ = cheerio.load(html);
    const rows = new Map();
    $("article a, .post a, .entry-title a, h2 a, h3 a").each((_, a) => {
      const $a = $(a);
      const text = $a.text().trim();
      const href = $a.attr("href");
      if (!text || !href) return;
      const virus = detectVirus(text);
      if (!virus) return;
      const u = href.startsWith("http") ? href : new URL(href, "https://africacdc.org").toString();
      if (rows.has(u)) return;
      const $card = $a.closest("article, .post");
      const dateText = $card.find("time").attr("datetime") || null;
      rows.set(u, { text, url: u, virus, dateText });
    });
    return [...rows.values()];
  } catch (e) {
    logger.warn("africa_cdc.page_unavailable", { url, error: e.message });
    return [];
  }
}

export async function scrape({ logger }) {
  const [news, diseases] = await Promise.all([
    scrapePage(NEWS_URL, logger),
    scrapePage(DISEASE_INDEX, logger),
  ]);
  const combined = [...news, ...diseases];
  const events = [];
  const seen = new Set();
  for (const r of combined) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    events.push(
      makeEvent({
        source: SOURCE,
        source_id: SOURCE_ID,
        source_url: r.url,
        title: r.text,
        summary: "",
        report_date: parseDate(r.dateText),
        region: "Africa",
        virus: r.virus,
      })
    );
  }
  logger.info("africa_cdc.scraped", { count: events.length });
  return events;
}

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
