// State Department-of-Health connectors (Indiana, Illinois, Kentucky).
//
// Why three different shapes:
//   - Indiana DOH no longer publishes an HTML news index; the /health/erc/news/
//     URL now redirects to a landing page with no article list. The state
//     health department's Twitter (@StateHealthIN) is the most current
//     channel and is mirrored via nitter.net's per-handle RSS.
//   - Illinois DPH news pages are JS-rendered (Elastic AppSearch). HEAD-tested
//     RSS endpoints all 404. @IDPH Twitter via nitter is the only reliable
//     scrape target we found in HEAD-testing.
//   - Kentucky CHFS DOES publish a server-rendered news table at
//     /News/Pages/default.aspx (probed structure: <table class="table-newsroom">
//     with <td>title<a/></td><td>NewsDate</td> per row). We HTML-scrape that
//     directly. We also pull @KYHealthAlerts via nitter for newer items.
//
// All sub-feeds are filtered with detectVirus(); anything that doesn't
// mention a tracked virus gets dropped so we don't pollute the dashboard
// with unrelated DPH content.

import Parser from "rss-parser";
import * as cheerio from "cheerio";
import { fetchText } from "../lib/fetch.mjs";
import { detectVirus, makeEvent } from "../lib/schema.mjs";

const SOURCE = "State DPH";
const SOURCE_ID = "state-dph";

export const meta = {
  id: SOURCE_ID,
  name: "State Departments of Health (IN, IL, KY)",
  url: "https://www.in.gov/health/idepd/",
  format: "RSS (via nitter) + HTML",
  access: "public",
  region_scope: "United States (Indiana, Illinois, Kentucky)",
};

// Recency window — DPH content is mostly evergreen, so we trim to the last
// 90 days to keep the dashboard focused on current events.
const RECENCY_DAYS = 90;

async function scrapeNitterHandle(handle, stateName, stateCode, logger) {
  const url = `https://nitter.net/${handle}/rss`;
  try {
    const xml = await fetchText(url, { accept: "application/rss+xml,application/xml" });
    const parser = new Parser({ timeout: 30_000 });
    const feed = await parser.parseString(xml);
    const cutoff = Date.now() - RECENCY_DAYS * 24 * 3600 * 1000;
    const events = [];
    for (const item of feed.items || []) {
      const title = (item.title || "").trim();
      const summary = (item.contentSnippet || item.content || "").trim();
      if (!title) continue;
      const dt = item.isoDate || item.pubDate;
      const ts = dt ? Date.parse(dt) : NaN;
      if (Number.isFinite(ts) && ts < cutoff) continue;
      const virus = detectVirus(`${title} ${summary}`);
      if (!virus) continue;
      events.push(
        makeEvent({
          source: SOURCE,
          source_id: SOURCE_ID,
          source_url: item.link || url,
          title,
          summary,
          report_date: dt || null,
          region: stateName,
          origin_country: "United States",
          virus,
          raw: { sub_source: `@${handle}`, state_code: stateCode },
        })
      );
    }
    logger.info("state_dph.nitter_scraped", { handle, kept: events.length });
    return events;
  } catch (e) {
    logger.warn("state_dph.nitter_failed", { handle, error: e.message });
    return [];
  }
}

async function scrapeKyChfs(logger) {
  const url = "https://www.chfs.ky.gov/News/Pages/default.aspx";
  try {
    const html = await fetchText(url);
    const $ = cheerio.load(html);
    const cutoff = Date.now() - RECENCY_DAYS * 24 * 3600 * 1000;
    const events = [];
    $("table.table-newsroom tbody tr").each((_, tr) => {
      const $tr = $(tr);
      const $titleCell = $tr.find('td[data-title=""]').first();
      const $a = $titleCell.find("a").first();
      const title = $a.text().trim();
      const href = $a.attr("href") || "";
      const dateText = $tr.find('td[data-title="NewsDate"]').first().text().trim();
      if (!title) return;
      // Date format on KY CHFS is M/D/YYYY.
      let reportDate = null;
      if (dateText) {
        const t = Date.parse(dateText);
        if (!Number.isNaN(t)) reportDate = new Date(t).toISOString();
      }
      if (reportDate && Date.parse(reportDate) < cutoff) return;
      const virus = detectVirus(title);
      if (!virus) return;
      events.push(
        makeEvent({
          source: SOURCE,
          source_id: SOURCE_ID,
          source_url: href.startsWith("http") ? href : new URL(href, "https://www.chfs.ky.gov").toString(),
          title,
          summary: "Kentucky Cabinet for Health and Family Services press release.",
          report_date: reportDate,
          region: "Kentucky",
          origin_country: "United States",
          virus,
          raw: { sub_source: "KY CHFS", state_code: "KY" },
        })
      );
    });
    logger.info("state_dph.ky_chfs_scraped", { count: events.length });
    return events;
  } catch (e) {
    logger.warn("state_dph.ky_chfs_failed", { error: e.message });
    return [];
  }
}

export async function scrape({ logger }) {
  const [in_tw, il_tw, ky_tw, ky_chfs] = await Promise.all([
    scrapeNitterHandle("StateHealthIN", "Indiana", "IN", logger),
    scrapeNitterHandle("IDPH", "Illinois", "IL", logger),
    scrapeNitterHandle("KYHealthAlerts", "Kentucky", "KY", logger),
    scrapeKyChfs(logger),
  ]);
  const combined = [...in_tw, ...il_tw, ...ky_tw, ...ky_chfs];
  const seen = new Set();
  const unique = combined.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
  logger.info("state_dph.scraped", {
    total: unique.length,
    indiana: in_tw.length,
    illinois: il_tw.length,
    kentucky_twitter: ky_tw.length,
    kentucky_chfs: ky_chfs.length,
  });
  return unique;
}
