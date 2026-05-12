// 01:00 ET orchestrator. Runs every source connector, writes per-source
// raw output and a normalized snapshot under data/YYYY-MM-DD/, and updates
// sources.json with last_scraped timestamps. Always exits with a run summary
// even if some sources fail — the 02:00 verifier decides whether to publish.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { makeLogger } from "./lib/log.mjs";
import * as cdc from "./sources/cdc.mjs";
import * as paho from "./sources/paho.mjs";
import * as whoDon from "./sources/who-don.mjs";
import * as ecdc from "./sources/ecdc.mjs";
import * as africaCdc from "./sources/africa-cdc.mjs";
import * as whoAfro from "./sources/who-afro.mjs";
import * as outbreakNewsToday from "./sources/outbreak-news-today.mjs";
import * as cdcNndss from "./sources/cdc-nndss.mjs";
import * as healthmap from "./sources/healthmap.mjs";
import * as stateDph from "./sources/state-dph.mjs";
import * as cdcHantavirus from "./sources/cdc-hantavirus.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const CONNECTORS = [
  { mod: cdc, id: "cdc" },
  { mod: paho, id: "paho" },
  { mod: whoDon, id: "who-don" },
  { mod: ecdc, id: "ecdc" },
  { mod: africaCdc, id: "africa-cdc" },
  { mod: whoAfro, id: "who-afro" },
  { mod: outbreakNewsToday, id: "outbreak-news-today" },
  { mod: cdcNndss, id: "cdc-nndss" },
  { mod: healthmap, id: "healthmap" },
  { mod: stateDph, id: "state-dph" },
  { mod: cdcHantavirus, id: "cdc-hantavirus" },
];

function parseArgs(argv) {
  const args = { source: null, dry: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--source" && argv[i + 1]) { args.source = argv[++i]; continue; }
    if (argv[i] === "--dry") { args.dry = true; continue; }
  }
  return args;
}

async function runConnector(c, logger) {
  const subLogger = {
    info: (e, f) => logger.info(`[${c.id}] ${e}`, f),
    warn: (e, f) => logger.warn(`[${c.id}] ${e}`, f),
    error: (e, f) => logger.error(`[${c.id}] ${e}`, f),
  };
  const t0 = Date.now();
  // Per-connector wall-clock cap so one slow source can't stall the nightly
  // pipeline. The internal fetch timeouts handle individual requests; this is
  // a belt-and-braces deadline for the connector as a whole.
  const CONNECTOR_TIMEOUT_MS = 90_000;
  try {
    const events = await Promise.race([
      c.mod.scrape({ logger: subLogger }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`connector timeout after ${CONNECTOR_TIMEOUT_MS}ms`)), CONNECTOR_TIMEOUT_MS)
      ),
    ]);
    const ms = Date.now() - t0;
    logger.info("connector.done", { source: c.id, count: events.length, duration_ms: ms });
    return { id: c.id, ok: true, events, ms, error: null };
  } catch (e) {
    const ms = Date.now() - t0;
    logger.error("connector.failed", { source: c.id, error: e.message, duration_ms: ms });
    return { id: c.id, ok: false, events: [], ms, error: e.message };
  }
}

function dedupeAndSort(events) {
  const byId = new Map();
  for (const e of events) {
    const existing = byId.get(e.id);
    if (!existing) { byId.set(e.id, e); continue; }
    // Prefer the row with a non-null report_date or longer summary
    if (!existing.report_date && e.report_date) byId.set(e.id, e);
    else if ((e.summary?.length || 0) > (existing.summary?.length || 0)) byId.set(e.id, e);
  }
  const sorted = [...byId.values()].sort((a, b) => {
    const da = a.report_date ? Date.parse(a.report_date) : 0;
    const db = b.report_date ? Date.parse(b.report_date) : 0;
    return db - da;
  });
  return sorted;
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

async function main() {
  const args = parseArgs(process.argv);
  const runId = randomUUID();
  const day = new Date().toISOString().slice(0, 10);
  const dayDir = path.join(ROOT, "data", day);
  const logger = makeLogger("scrape", runId);
  logger.info("scrape.start", { run: runId, day, dry: args.dry, source: args.source || "all" });

  const targets = args.source
    ? CONNECTORS.filter((c) => c.id === args.source)
    : CONNECTORS;
  if (targets.length === 0) {
    logger.error("scrape.unknown_source", { source: args.source });
    process.exit(2);
  }

  const results = await Promise.all(targets.map((c) => runConnector(c, logger)));
  const totalEvents = results.reduce((n, r) => n + r.events.length, 0);
  const successCount = results.filter((r) => r.ok).length;

  if (!args.dry) {
    fs.mkdirSync(dayDir, { recursive: true });
    for (const r of results) {
      writeJson(path.join(dayDir, `${r.id}.raw.json`), {
        run: runId,
        source: r.id,
        ok: r.ok,
        error: r.error,
        scraped_at: new Date().toISOString(),
        count: r.events.length,
        events: r.events,
      });
    }
    const allEvents = dedupeAndSort(results.flatMap((r) => r.events));
    writeJson(path.join(dayDir, "normalized.json"), {
      run: runId,
      generated_at: new Date().toISOString(),
      source_count: successCount,
      total_sources: targets.length,
      event_count: allEvents.length,
      sources: results.map(({ id, ok, ms, count: _, error, events }) => ({
        id,
        ok,
        duration_ms: ms,
        count: events.length,
        error,
      })),
      events: allEvents,
    });

    // Update sources.json with last_scraped per source. If a connector ran
    // for a source that isn't yet in the registry (e.g. a new connector was
    // added since the last manual edit), seed an entry from the connector's
    // exported `meta` so the dashboard registry stays in sync automatically.
    const sourcesPath = path.join(ROOT, "public", "data", "sources.json");
    let registry = [];
    try { registry = JSON.parse(fs.readFileSync(sourcesPath, "utf8")); } catch {}
    const now = new Date().toISOString();
    for (const r of results) {
      const target = targets.find((t) => t.id === r.id);
      const meta = target?.mod?.meta;
      let idx = registry.findIndex((s) => s.id === r.id);
      if (idx === -1) {
        registry.push({
          id: r.id,
          name: meta?.name || r.id,
          url: meta?.url || "",
          format: meta?.format || "—",
          access: meta?.access || "public",
          region_scope: meta?.region_scope || "—",
          last_scraped: null,
          last_event_count: 0,
          last_error: null,
        });
        idx = registry.length - 1;
      }
      if (r.ok) {
        registry[idx].last_scraped = now;
        registry[idx].last_event_count = r.events.length;
        registry[idx].last_error = null;
      } else {
        registry[idx].last_error = r.error;
      }
    }
    writeJson(sourcesPath, registry);
  }

  logger.info("scrape.done", {
    run: runId,
    sources_ok: successCount,
    sources_total: targets.length,
    events: totalEvents,
    dry: args.dry,
  });
  await logger.close();

  // Exit code reflects overall health: 0 if any source succeeded with events,
  // 1 if all succeeded but yielded no events (probably a parse-rule problem),
  // 2 if every source failed.
  if (successCount === 0) process.exit(2);
  if (totalEvents === 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(99);
});
