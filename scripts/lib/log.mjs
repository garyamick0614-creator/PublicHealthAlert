// JSON-line logger. Each run writes to logs/<kind>/<YYYY-MM-DD>.jsonl so
// the verifier can parse run history without regex on free-form text.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");

export function makeLogger(kind, runId) {
  const day = new Date().toISOString().slice(0, 10);
  const dir = path.join(ROOT, "logs", kind);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${day}.jsonl`);
  const stream = fs.createWriteStream(file, { flags: "a" });

  function write(level, event, fields = {}) {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      run: runId,
      level,
      event,
      ...fields,
    });
    stream.write(line + "\n");
    if (level === "error" || level === "warn" || process.env.PHA_VERBOSE) {
      console.error(`[${level}] ${event}`, fields);
    } else {
      console.log(`[${level}] ${event}`, Object.keys(fields).length ? fields : "");
    }
  }

  return {
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
    file,
    close: () => new Promise((r) => stream.end(r)),
  };
}
