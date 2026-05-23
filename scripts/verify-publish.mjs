// 02:00 ET verifier + publisher.
// Reads the latest scrape under data/YYYY-MM-DD/normalized.json, runs
// validation gates, and publishes to the live site by:
//   1. Copying events into public/data/, updating meta.json
//   2. git commit + push (audit history on GitHub)
//   3. netlify deploy --prod (decoupled from GitHub-Netlify CD; works even
//      if the repo isn't linked in the Netlify UI)
//
// If verification fails, the previous publish (state/last_publish.json) is
// republished with a status=stale flag so the site never goes empty.

import fs from "node:fs";
import path from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { makeLogger } from "./lib/log.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PUBLIC_DATA = path.join(ROOT, "public", "data");
const STATE_DIR = path.join(ROOT, "state");
const DATA_DIR = path.join(ROOT, "data");

const MIN_EVENTS = 3;
const MIN_SOURCES_OK = 1;
const MAX_SCRAPE_AGE_HOURS = 6;

function parseArgs(argv) {
  const args = { dry: false, skipDeploy: false, skipPush: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--dry") args.dry = true;
    if (argv[i] === "--no-deploy") args.skipDeploy = true;
    if (argv[i] === "--no-push") args.skipPush = true;
  }
  return args;
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function findLatestScrape() {
  if (!fs.existsSync(DATA_DIR)) return null;
  const days = fs.readdirSync(DATA_DIR)
    .filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n))
    .sort()
    .reverse();
  for (const day of days) {
    const file = path.join(DATA_DIR, day, "normalized.json");
    if (fs.existsSync(file)) return { day, file };
  }
  return null;
}

function validate(scrape, logger) {
  const failures = [];
  if (!scrape) {
    failures.push("no scrape output found");
    return { ok: false, failures };
  }
  const ageMs = Date.now() - new Date(scrape.generated_at).getTime();
  const ageHours = ageMs / 3_600_000;
  if (ageHours > MAX_SCRAPE_AGE_HOURS) {
    failures.push(`scrape is ${ageHours.toFixed(1)}h old (limit ${MAX_SCRAPE_AGE_HOURS}h)`);
  }
  if (!Array.isArray(scrape.events) || scrape.events.length < MIN_EVENTS) {
    failures.push(`event count ${scrape.events?.length ?? 0} below minimum ${MIN_EVENTS}`);
  }
  if ((scrape.source_count ?? 0) < MIN_SOURCES_OK) {
    failures.push(`only ${scrape.source_count} source(s) succeeded (minimum ${MIN_SOURCES_OK})`);
  }
  const allFailed = scrape.sources?.every((s) => !s.ok);
  if (allFailed) failures.push("every source connector failed");
  logger.info("validate.result", { ok: failures.length === 0, failures });
  return { ok: failures.length === 0, failures };
}

function publishEvents(events, meta) {
  writeJson(path.join(PUBLIC_DATA, "events.json"), events);
  writeJson(path.join(PUBLIC_DATA, "meta.json"), meta);
}

function gitPushIfChanged(logger, runId, kind) {
  const opts = { cwd: ROOT, stdio: "pipe" };
  try {
    execSync('git add public/data/events.json public/data/meta.json public/data/sources.json', opts);
    const status = execSync('git status --porcelain public/data/', opts).toString().trim();
    if (!status) {
      logger.info("git.nothing_to_commit");
      return { committed: false };
    }
    const message = `Nightly publish (${kind}) — run ${runId.slice(0, 8)}`;
    execSync(`git commit -m "${message}"`, opts);
    execSync('git push origin main', opts);
    logger.info("git.pushed", { message });
    return { committed: true, message };
  } catch (e) {
    logger.error("git.failed", { error: e.message });
    return { committed: false, error: e.message };
  }
}

function netlifyDeploy(logger, runId) {
  try {
    const out = execFileSync(
      "netlify",
      ["deploy", "--prod", "--dir=public", "--message", `Nightly publish run ${runId.slice(0, 8)}`],
      { cwd: ROOT, stdio: "pipe", shell: true }
    ).toString();
    const urlMatch = out.match(/Production URL:[^\n]*<?(https:\/\/[^\s>]+)>?/);
    logger.info("netlify.deployed", { url: urlMatch ? urlMatch[1] : "unknown" });
    return { ok: true, url: urlMatch?.[1] };
  } catch (e) {
    logger.error("netlify.deploy_failed", { error: e.message });
    return { ok: false, error: e.message };
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const runId = randomUUID();
  const logger = makeLogger("verify", runId);
  logger.info("verify.start", { run: runId, dry: args.dry });

  fs.mkdirSync(STATE_DIR, { recursive: true });

  const latest = findLatestScrape();
  const scrape = latest ? readJson(latest.file) : null;
  if (latest) logger.info("verify.found_scrape", { day: latest.day, file: latest.file });

  // Idempotence: skip if we already published this run id.
  const lastPublishFile = path.join(STATE_DIR, "last_publish.json");
  const lastPublish = readJson(lastPublishFile);
  if (scrape && lastPublish && lastPublish.scrape_run === scrape.run) {
    logger.info("verify.already_published", { run: scrape.run });
    await logger.close();
    process.exit(0);
  }

  const v = validate(scrape, logger);

  let publishMode, eventsToPublish, metaToPublish;
  if (v.ok) {
    publishMode = "fresh";
    eventsToPublish = scrape.events;
    metaToPublish = {
      version: "0.1.0",
      status: "ok",
      last_updated: scrape.generated_at,
      next_run: "01:00 ET daily",
      event_count: scrape.events.length,
      source_count: scrape.source_count,
      total_sources: scrape.total_sources,
      operator: "TCG Solutions",
      run: runId,
      scrape_run: scrape.run,
    };
  } else {
    // Republish last-known-good with stale flag
    publishMode = "stale";
    const previousEventsFile = path.join(PUBLIC_DATA, "events.json");
    eventsToPublish = readJson(previousEventsFile, []);
    const prevMeta = readJson(path.join(PUBLIC_DATA, "meta.json"), {});
    metaToPublish = {
      ...prevMeta,
      status: "stale",
      stale_reason: v.failures.join("; "),
      last_verify_attempt: new Date().toISOString(),
      run: runId,
    };
    logger.warn("verify.publishing_stale", { reasons: v.failures });
  }

  if (args.dry) {
    logger.info("verify.dry_run", { mode: publishMode, events: eventsToPublish.length });
    await logger.close();
    process.exit(v.ok ? 0 : 3);
  }

  publishEvents(eventsToPublish, metaToPublish);
  logger.info("verify.local_files_written", { mode: publishMode, events: eventsToPublish.length });

  const gitResult = args.skipPush ? { committed: false, skipped: true } : gitPushIfChanged(logger, runId, publishMode);
  const deployResult = args.skipDeploy ? { ok: false, skipped: true } : netlifyDeploy(logger, runId);

  // 2026-05-23 — Only update last_publish.json when this run ACTUALLY published
  // (either committed to git or deployed to Netlify). Otherwise the hourly
  // refresh (which runs with --no-push --no-deploy purely for cache priming)
  // overwrites scrape_run with the new id, and the next legitimate daily run
  // sees scrape_run === lastPublish.scrape_run and early-exits as
  // "already_published" — silently skipping git push + netlify deploy.
  // Root-cause fix for the deploy gap (deployed site stale ~24h every day).
  const didPublish = gitResult.committed === true || deployResult.ok === true;
  if (didPublish) {
    writeJson(lastPublishFile, {
      run: runId,
      scrape_run: scrape?.run ?? null,
      mode: publishMode,
      published_at: new Date().toISOString(),
      event_count: eventsToPublish.length,
      git: gitResult,
      netlify: deployResult,
    });
  } else {
    logger.info("verify.publish_skipped_no_state_write", {
      reason: "git+deploy both skipped or failed; preserving previous last_publish.json so the next real publish run is not mis-flagged as already-published",
      git_skipped: gitResult.skipped === true,
      deploy_skipped: deployResult.skipped === true,
    });
  }

  // Set ready_to_publish flag (carries the run id of the freshest published run)
  fs.writeFileSync(
    path.join(STATE_DIR, "ready_to_publish.flag"),
    `${runId}\n${new Date().toISOString()}\n${publishMode}\n`
  );

  logger.info("verify.done", {
    mode: publishMode,
    deploy_ok: deployResult.ok,
    git_committed: gitResult.committed,
  });
  await logger.close();

  // Exit codes: 0 = published fresh data, 3 = published stale (verification failed)
  process.exit(v.ok ? 0 : 3);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(99);
});
