// WHO AFRO — Africa region news. Path patterns:
//   /news/<slug>                — region-wide news releases
//   /countries/<country>/news/  — country-specific bulletins (origin_country
//                                   can be inferred directly from the URL)
// Per the data.txt plan, WHO AFRO is the right Africa-region source given
// no documented free outbreak API exists from individual ministries.

import * as cheerio from "cheerio";
import { fetchText } from "../lib/fetch.mjs";
import { detectVirus, makeEvent } from "../lib/schema.mjs";

const NEWS_PAGES = [
  "https://www.afro.who.int/news/news-releases",
  "https://www.afro.who.int/news/country-news",
];

const SOURCE = "WHO AFRO";
const SOURCE_ID = "who-afro";

const COUNTRY_RE = /\/countries\/([^/]+)\/news\//;

const COUNTRY_SLUG_TO_NAME = {
  "togo": "Togo",
  "mauritania": "Mauritania",
  "united-republic-of-tanzania": "Tanzania",
  "kenya": "Kenya",
  "uganda": "Uganda",
  "nigeria": "Nigeria",
  "ethiopia": "Ethiopia",
  "ghana": "Ghana",
  "south-africa": "South Africa",
  "democratic-republic-of-the-congo": "Democratic Republic of the Congo",
  "sudan": "Sudan",
  "south-sudan": "South Sudan",
  "rwanda": "Rwanda",
  "burundi": "Burundi",
  "madagascar": "Madagascar",
  "mozambique": "Mozambique",
  "zimbabwe": "Zimbabwe",
  "zambia": "Zambia",
  "malawi": "Malawi",
  "angola": "Angola",
  "namibia": "Namibia",
  "botswana": "Botswana",
  "lesotho": "Lesotho",
  "eswatini": "Eswatini",
  "cameroon": "Cameroon",
  "gabon": "Gabon",
  "equatorial-guinea": "Equatorial Guinea",
  "central-african-republic": "Central African Republic",
  "chad": "Chad",
  "niger": "Niger",
  "mali": "Mali",
  "burkina-faso": "Burkina Faso",
  "senegal": "Senegal",
  "guinea": "Guinea",
  "guinea-bissau": "Guinea-Bissau",
  "sierra-leone": "Sierra Leone",
  "liberia": "Liberia",
  "ivory-coast": "Ivory Coast",
  "benin": "Benin",
  "gambia": "Gambia",
  "cabo-verde": "Cape Verde",
  "comoros": "Comoros",
  "seychelles": "Seychelles",
  "mauritius": "Mauritius",
  "algeria": "Algeria",
  "eritrea": "Eritrea",
  "somalia": "Somalia",
  "djibouti": "Djibouti",
  "sao-tome-and-principe": "São Tomé and Príncipe",
};

export const meta = {
  id: SOURCE_ID,
  name: "WHO AFRO — Africa Regional Office",
  url: "https://www.afro.who.int/news",
};

function countryFromUrl(url) {
  const m = COUNTRY_RE.exec(url);
  if (!m) return null;
  return COUNTRY_SLUG_TO_NAME[m[1]] || m[1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

async function harvestPage(url, logger) {
  let html;
  try {
    html = await fetchText(url);
  } catch (e) {
    logger.warn("who_afro.fetch_failed", { url, error: e.message });
    return [];
  }
  const $ = cheerio.load(html);
  const events = [];
  const seen = new Set();

  $('a[href*="/news/"], a[href*="/countries/"]').each((_, a) => {
    const $a = $(a);
    const href = $a.attr("href") || "";
    const text = $a.text().replace(/\s+/g, " ").trim();
    if (!text || text.length < 8) return;
    const u = href.startsWith("http") ? href : new URL(href, "https://www.afro.who.int").toString();
    // Skip section pages and language switchers
    if (/\/news\/(news-releases|country-news|technical-unit-news)\/?$/.test(u)) return;
    if (/^https:\/\/www\.afro\.who\.int\/(fr|pt)\//.test(u)) return;
    if (seen.has(u)) return;
    seen.add(u);
    const virus = detectVirus(text);
    if (!virus) return;
    const country = countryFromUrl(u);
    events.push(
      makeEvent({
        source: SOURCE,
        source_id: SOURCE_ID,
        source_url: u,
        title: text,
        summary: "",
        report_date: null,
        region: "Africa",
        origin_country: country,
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
  logger.info("who_afro.scraped", { count: unique.length });
  return unique;
}
