// CDC Hantavirus surveillance pages — real-time first-party scrape.
//
// Two HTML pages probed-and-confirmed on 2026-05-12:
//   - /hantavirus/situation-summary/index.html (Current Situation)
//   - /hantavirus/data-research/cases/index.html (Reported Cases of HPS)
//
// The situation summary is the highest-signal endpoint: when CDC opens a
// hantavirus response (e.g. the cruise-ship Andes-virus outbreak posted
// 2026-05-02), the response statement is on this page. We extract the
// first substantive paragraph and emit it as a single "hantavirus" event so
// the dashboard reflects the current CDC posture.
//
// We deliberately keep the parser permissive — the page is a CMS-rendered
// info page and the precise selector for the "active response" section can
// change. We grab the first 1-3 long paragraphs and emit them.

import * as cheerio from "cheerio";
import { fetchText } from "../lib/fetch.mjs";
import { makeEvent } from "../lib/schema.mjs";

const SITUATION_URL = "https://www.cdc.gov/hantavirus/situation-summary/index.html";
const CASES_URL = "https://www.cdc.gov/hantavirus/data-research/cases/index.html";

const SOURCE = "CDC Hantavirus";
const SOURCE_ID = "cdc-hantavirus";

export const meta = {
  id: SOURCE_ID,
  name: "CDC Hantavirus — Situation Summary & Reported Cases",
  url: SITUATION_URL,
  format: "HTML",
  access: "public",
  region_scope: "United States",
};

// Common .gov boilerplate prefixes we want to skip — they appear on every
// CDC page at the top ("A .gov website belongs to..." etc.) and aren't
// surveillance content.
const BOILERPLATE = [
  /belongs to an official government/i,
  /safely connected to the .gov website/i,
  /share sensitive information/i,
  /encrypted and transmitted securely/i,
];

function extractParagraphs(html, max = 4) {
  const $ = cheerio.load(html);
  // CDC main content is usually under main, .syndicate, or #content; try in
  // order and fall back to all <p>.
  const candidates = $("main p, .syndicate p, #content p, p");
  const out = [];
  candidates.each((_, el) => {
    if (out.length >= max) return false;
    let text = $(el).text().replace(/\s+/g, " ").trim();
    if (text.length < 60) return; // skip headers / footnotes
    if (BOILERPLATE.some((re) => re.test(text))) return;
    out.push(text);
  });
  return out;
}

async function scrapeSituation(logger) {
  try {
    const html = await fetchText(SITUATION_URL);
    const paragraphs = extractParagraphs(html, 3);
    if (!paragraphs.length) {
      logger.warn("cdc_hantavirus.situation_empty");
      return [];
    }
    const headline = paragraphs[0].slice(0, 220);
    const summary = paragraphs.slice(0, 3).join(" ").slice(0, 800);

    // We synthesize the report_date as "now" — CDC does not publish a
    // machine-readable update timestamp on this page and the body itself
    // mentions the date inline ("reported on May 2, 2026").
    return [
      makeEvent({
        source: SOURCE,
        source_id: SOURCE_ID,
        source_url: SITUATION_URL,
        title: `CDC Hantavirus Current Situation: ${headline}`,
        summary,
        report_date: new Date().toISOString(),
        region: "United States",
        origin_country: "United States",
        virus: "hantavirus",
        status: /response|outbreak|active/i.test(summary) ? "active" : "monitoring",
        event_type: "situation_summary",
      }),
    ];
  } catch (e) {
    logger.warn("cdc_hantavirus.situation_failed", { error: e.message });
    return [];
  }
}

async function scrapeCases(logger) {
  try {
    const html = await fetchText(CASES_URL);
    const paragraphs = extractParagraphs(html, 4);
    if (!paragraphs.length) {
      logger.warn("cdc_hantavirus.cases_empty");
      return [];
    }
    const summary = paragraphs.slice(0, 3).join(" ").slice(0, 800);
    return [
      makeEvent({
        source: SOURCE,
        source_id: SOURCE_ID,
        source_url: CASES_URL,
        title: "CDC Reported Cases of Hantavirus Disease — surveillance update",
        summary,
        report_date: new Date().toISOString(),
        region: "United States",
        origin_country: "United States",
        virus: "hantavirus",
        event_type: "surveillance",
        status: "monitoring",
      }),
    ];
  } catch (e) {
    logger.warn("cdc_hantavirus.cases_failed", { error: e.message });
    return [];
  }
}

export async function scrape({ logger }) {
  const [sit, cases] = await Promise.all([scrapeSituation(logger), scrapeCases(logger)]);
  const events = [...sit, ...cases];
  logger.info("cdc_hantavirus.scraped", {
    total: events.length,
    situation: sit.length,
    cases: cases.length,
  });
  return events;
}
