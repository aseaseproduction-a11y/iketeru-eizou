#!/usr/bin/env node
/**
 * Appends one or more dispatched subagent records to analysis/runs/<run_id>/dispatch_log.jsonl.
 * Usage:
 *   node scripts/append-dispatch-log.mjs <run_id> video_id:mode:attempt:subagent_id [...]
 */
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = "E:\\iketeru-eizou";
const [runId, ...entries] = process.argv.slice(2);
if (!runId || entries.length === 0) {
  console.error("Usage: node scripts/append-dispatch-log.mjs <run_id> video_id:mode:attempt:subagent_id [...]");
  process.exit(2);
}

const dispatchPath = path.join(REPO_ROOT, "analysis", "runs", runId, "dispatch_log.jsonl");
const now = new Date().toISOString();
const lines = [];
for (const e of entries) {
  const parts = e.split(":");
  if (parts.length !== 4) {
    throw new Error(`Invalid entry format (expected video_id:mode:attempt:subagent_id): ${e}`);
  }
  const [video_id, mode, attemptStr, subagent_id] = parts;
  lines.push(
    JSON.stringify({
      dispatched_at: now,
      run_id: runId,
      video_id,
      mode,
      attempt: parseInt(attemptStr, 10),
      subagent_id,
    })
  );
}
fs.appendFileSync(dispatchPath, lines.join("\n") + "\n", "utf8");
console.log(`Appended ${lines.length} entries to ${dispatchPath}`);
