import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO_ROOT = "E:\\iketeru-eizou";
const BRAIN_ROOT = process.env.ANTIGRAVITY_BRAIN_ROOT || path.join(os.homedir(), ".gemini", "antigravity", "brain");

const runId = process.argv[2];
const parentId = process.argv[3];
if (!runId || !parentId) {
  console.error("Usage: node scripts/sync-dispatched-runs.mjs <run_id> <parent_id>");
  process.exit(2);
}

const runDir = path.join(REPO_ROOT, "analysis", "runs", runId);
const dispatchPath = path.join(runDir, "dispatch_log.jsonl");
const scoresPath = path.join(runDir, "raw_scores.jsonl");

const dispatched = fs.readFileSync(dispatchPath, "utf8").split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
const recorded = fs.existsSync(scoresPath)
  ? fs.readFileSync(scoresPath, "utf8").split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l))
  : [];
const recordedSubIds = new Set(recorded.map(r => r.subagent_id));

let newlyRecorded = 0;
let newlyValid = 0;
let newlyInvalid = 0;
let pending = 0;

for (const d of dispatched) {
  if (recordedSubIds.has(d.subagent_id)) continue;
  const tPath = path.join(BRAIN_ROOT, d.subagent_id, ".system_generated", "logs", "transcript.jsonl");
  if (!fs.existsSync(tPath)) {
    pending++;
    continue;
  }
  const txt = fs.readFileSync(tPath, "utf8");
  if (!txt.includes('"send_message"')) {
    pending++;
    continue;
  }
  // Wait until send_message has completed (a step after send_message exists)
  const lines = txt.split(/\r?\n/).filter(Boolean);
  const lastStep = JSON.parse(lines[lines.length - 1]);
  if (lastStep.status !== "DONE") {
    pending++;
    continue;
  }

  try {
    const out = execFileSync(process.execPath, [
      path.join(REPO_ROOT, "scripts", "record-scored-run.mjs"),
      "--run-id", runId,
      "--video-id", d.video_id,
      "--mode", d.mode,
      "--attempt", String(d.attempt),
      "--subagent-id", d.subagent_id,
      "--parent-id", parentId,
    ], { encoding: "utf8" });
    const summary = JSON.parse(out);
    newlyRecorded++;
    newlyValid++;
    console.log(`[OK] ${summary.video_id} ${summary.mode.padEnd(13)} r${summary.attempt} | score=${summary.total_score} (${summary.rank}) | in=${summary.token_usage.first_post_read_input_tokens} eff=${summary.token_usage.first_post_read_effective_input_tokens} | knows=${summary.post_check.knows_work}/${summary.post_check.knows_award_history}/${summary.post_check.award_badge_visible_in_video}`);
  } catch (err) {
    newlyRecorded++;
    newlyInvalid++;
    console.error(`[INVALID] ${d.video_id} ${d.mode} r${d.attempt} sub=${d.subagent_id}: ${(err.stdout || err.stderr || err.message).slice(0, 400)}`);
  }
}

const totalRecorded = recorded.length + newlyRecorded;
console.log(`\nSync summary: dispatched=${dispatched.length}, total_recorded=${totalRecorded}, newly_valid=${newlyValid}, newly_invalid=${newlyInvalid}, pending=${pending}`);
