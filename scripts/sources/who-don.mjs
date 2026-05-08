// WHO Disease Outbreak News — structured OData JSON API.
// This is a real WHO API (not RSS) that returns Title, PublicationDate,
// full Summary, and a canonical DonId per item. Compared with the news RSS
// (which mixes governance and policy items), the DON API gives us actual
// outbreak events with proper dates and bodies.

import { fetchJson } from "../lib/fetch.mjs";
import { detectVirus, makeEvent } from "../lib/schema.mjs";

const API_URL = "https://www.who.int/api/news/diseaseoutbreaknews";
const PAGE_SIZE = 60;

const SOURCE = "WHO DON";
const SOURCE_ID = "who-don";

export const meta = {
  id: SOURCE_ID,
  name: "WHO Disease Outbreak News",
  url: "https://www.who.int/emergencies/disease-outbreak-news",
};

function stripHtml(s) {
  if (!s) return "";
  return String(s)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

// WHO DON titles often follow the pattern "<Virus> – <country> – <update>"
// or "<Virus> in <country>". When detectVirus matches the title we get the
// virus directly; the country can be extracted by splitting on em-dash.
// WHO often uses regional designations as the second em-dash field
// ("Virus – Region of the Americas – update N"). Those aren't countries; we
// filter them out so they don't end up in country breakdowns.
const NON_COUNTRY_LABELS = /^(Region of the Americas|African Region|European Region|South-East Asia Region|Western Pacific Region|Eastern Mediterranean Region|Multi[- ]country|Multiple countries|Global|update [0-9]+|situation [0-9]+|cluster|outbreak)$/i;

function extractCountryFromTitle(title) {
  if (!title) return null;
  // Pattern 1: "Virus – Country – update N"
  const parts = title.split(/\s+[–—-]\s+/).map((s) => s.trim());
  if (parts.length >= 2) {
    const candidate = parts[1].replace(/\(.*?\)/g, "").trim();
    if (candidate && !NON_COUNTRY_LABELS.test(candidate) && !/situation|update|cluster/i.test(candidate)) {
      return candidate;
    }
  }
  // Pattern 2: "Virus in Country"
  const m2 = title.match(/\bin\s+([A-Z][A-Za-z\s,'-]{2,})$/);
  if (m2) {
    const candidate = m2[1].trim();
    if (!NON_COUNTRY_LABELS.test(candidate)) return candidate;
  }
  return null;
}

export async function scrape({ logger }) {
  const url = new URL(API_URL);
  url.searchParams.set("$top", String(PAGE_SIZE));
  url.searchParams.set("$orderby", "PublicationDate desc");
  url.searchParams.set("$select", "Title,PublicationDate,ItemDefaultUrl,Summary,DonId,Overview");
  let payload;
  try {
    payload = await fetchJson(url.toString());
  } catch (e) {
    logger.error("who_don.api_failed", { error: e.message });
    return [];
  }
  const items = Array.isArray(payload?.value) ? payload.value : [];
  logger.info("who_don.api_loaded", { items: items.length });

  const events = [];
  for (const it of items) {
    const title = (it.Title || "").trim();
    const summary = stripHtml(it.Summary || it.Overview || "");
    if (!title) continue;
    const virus = detectVirus(`${title} ${summary}`);
    if (!virus) continue; // DON publishes a small number of non-pathogen items

    const donId = it.DonId || (it.ItemDefaultUrl || "").replace(/^\//, "");
    const sourceUrl = donId
      ? `https://www.who.int/emergencies/disease-outbreak-news/item/${donId}`
      : "https://www.who.int/emergencies/disease-outbreak-news";

    events.push(
      makeEvent({
        source: SOURCE,
        source_id: SOURCE_ID,
        source_url: sourceUrl,
        title,
        summary,
        report_date: it.PublicationDate || null,
        region: "Global",
        origin_country: extractCountryFromTitle(title),
        virus,
      })
    );
  }
  logger.info("who_don.scraped", { count: events.length });
  return events;
}
