#!/usr/bin/env node
/**
 * Immediate post-dispatch prompt exact-match verifier for Phase 3 blind scoring.
 *
 * Purpose:
 *   Right after invoking scoring subagents (WITHOUT waiting for scoring to complete),
 *   inspects step 0 of each subagent's transcript.jsonl / transcript_full.jsonl and
 *   verifies byte-for-byte equality against renderCalibrationPrompt(spec).
 *
 *   If any mismatch is detected (e.g., missing blank line after header), exits non-zero
 *   so the parent agent can discard that subagent's result and re-dispatch immediately.
 *
 * Also supports `--print-prompt` to output the exact frozen prompt text directly from
 * `specs/<video_id>_<mode>.json` (preventing prompt reconstruction from memory after
 * conversation compaction).
 *
 * Does NOT modify any frozen Phase 2 files or audit-blind-transcript.mjs.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractParentMessageContent,
  renderCalibrationPrompt,
} from "./lib/calibration-prompt-template.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const BRAIN_ROOT =
  process.env.ANTIGRAVITY_BRAIN_ROOT ||
  path.join(os.homedir(), ".gemini", "antigravity", "brain");

export const VALUE_FLAGS = Object.freeze(
  new Set([
    "run-id",
    "video-id",
    "mode",
    "subagent-id",
    "last",
    "wait-ms",
    "brain-root",
    "repo-root",
  ])
);
const ALLOW_LEADING_DOUBLE_DASH_VALUE_FLAGS = new Set(["video-id"]);

export function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (VALUE_FLAGS.has(k)) {
        if (next === undefined || next === "") {
          throw new Error(`Missing value for --${k}`);
        }
        if (ALLOW_LEADING_DOUBLE_DASH_VALUE_FLAGS.has(k)) {
          if (next.startsWith("--") && VALUE_FLAGS.has(next.slice(2))) {
            throw new Error(`Missing value for --${k} (got flag "${next}")`);
          }
        } else if (next.startsWith("--")) {
          throw new Error(`Missing value for --${k} (got flag "${next}")`);
        }
        args[k] = next;
        i++;
      } else if (!next || next.startsWith("--")) {
        args[k] = true;
      } else {
        args[k] = next;
        i++;
      }
    }
  }
  return args;
}

export function findFirstDiff(expected, actual) {
  const minLen = Math.min(expected.length, actual.length);
  for (let i = 0; i < minLen; i++) {
    if (expected[i] !== actual[i]) return i;
  }
  return expected.length === actual.length ? -1 : minLen;
}

function readFirstPromptStep(transcriptPath) {
  const fullPath = transcriptPath.replace(/transcript\.jsonl$/i, "transcript_full.jsonl");
  const targetPath = fs.existsSync(fullPath) ? fullPath : transcriptPath;
  if (!fs.existsSync(targetPath)) return null;

  const lines = fs
    .readFileSync(targetPath, "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(Boolean);

  for (const line of lines) {
    let step;
    try {
      step = JSON.parse(line);
    } catch {
      continue;
    }
    const isIncomingPrompt =
      (step.source === "SYSTEM" && step.type === "SYSTEM_MESSAGE") ||
      step.source === "USER";
    if (isIncomingPrompt && typeof step.content === "string" && step.content.length > 0) {
      return step;
    }
  }
  return null;
}

export function verifyDispatchedPrompt({
  spec,
  transcriptPath,
}) {
  const expectedPrompt = renderCalibrationPrompt(spec).replace(/\r\n/g, "\n").trim();
  const step = readFirstPromptStep(transcriptPath);
  if (!step) {
    return {
      ok: false,
      reason: "transcript_or_initial_prompt_not_found",
      transcript_path: transcriptPath,
      expected_length: expectedPrompt.length,
      actual_length: null,
      first_diff_index: null,
    };
  }

  const actualPrompt = extractParentMessageContent(step.content).replace(/\r\n/g, "\n").trim();
  if (actualPrompt === expectedPrompt) {
    return {
      ok: true,
      reason: null,
      transcript_path: transcriptPath,
      step_index: step.step_index ?? 0,
      expected_length: expectedPrompt.length,
      actual_length: actualPrompt.length,
      first_diff_index: null,
    };
  }

  const diffIdx = findFirstDiff(expectedPrompt, actualPrompt);
  const start = Math.max(0, diffIdx - 25);
  return {
    ok: false,
    reason: "prompt_exact_match_mismatch",
    transcript_path: transcriptPath,
    step_index: step.step_index ?? 0,
    expected_length: expectedPrompt.length,
    actual_length: actualPrompt.length,
    first_diff_index: diffIdx,
    expected_snippet: expectedPrompt.slice(start, diffIdx + 60),
    actual_snippet: actualPrompt.slice(start, diffIdx + 60),
  };
}

async function verifyWithShortWait(opts, waitMs) {
  const deadline = Date.now() + Math.max(0, waitMs);
  while (true) {
    const res = verifyDispatchedPrompt(opts);
    if (res.ok || res.reason !== "transcript_or_initial_prompt_not_found" || Date.now() >= deadline) {
      return res;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const repoRoot = args["repo-root"] ? path.resolve(args["repo-root"]) : REPO_ROOT;
  const brainRoot = args["brain-root"] ? path.resolve(args["brain-root"]) : BRAIN_ROOT;
  const runId = args["run-id"];
  const waitMs = parseInt(args["wait-ms"] || "3000", 10);

  if (!runId) {
    throw new Error(
      "Usage:\n" +
        "  node scripts/verify-dispatched-prompt.mjs --run-id <run_id> --video-id <id> --mode <video|contact_sheet> --subagent-id <convId> [--wait-ms 3000]\n" +
        "  node scripts/verify-dispatched-prompt.mjs --run-id <run_id> --from-dispatch-log [--last <N>] [--wait-ms 3000]\n" +
        "  node scripts/verify-dispatched-prompt.mjs --run-id <run_id> --video-id <id> --mode <video|contact_sheet> --print-prompt"
    );
  }

  const runDir = path.join(repoRoot, "analysis", "runs", runId);

  if (args["print-prompt"]) {
    const videoId = args["video-id"];
    const mode = args["mode"];
    if (!videoId || !mode) {
      throw new Error("--print-prompt requires --video-id and --mode");
    }
    const specPath = path.join(runDir, "specs", `${videoId}_${mode}.json`);
    const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
    process.stdout.write(renderCalibrationPrompt(spec) + "\n");
    return;
  }

  const jobs = [];
  if (args["from-dispatch-log"]) {
    const logPath = path.join(runDir, "dispatch_log.jsonl");
    const lines = fs
      .readFileSync(logPath, "utf8")
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .filter(Boolean);
    const allEntries = lines.map((l) => JSON.parse(l));
    const lastN = args["last"] ? Math.max(1, parseInt(args["last"], 10)) : allEntries.length;
    for (const e of allEntries.slice(-lastN)) {
      jobs.push({
        video_id: e.video_id,
        mode: e.mode,
        attempt: e.attempt ?? null,
        subagent_id: e.subagent_id,
      });
    }
  } else {
    const videoId = args["video-id"];
    const mode = args["mode"];
    const subagentId = args["subagent-id"];
    if (!videoId || !mode || !subagentId) {
      throw new Error("Specify either --from-dispatch-log or all of --video-id, --mode, --subagent-id");
    }
    jobs.push({ video_id: videoId, mode, attempt: null, subagent_id: subagentId });
  }

  const results = [];
  let failedCount = 0;
  for (const job of jobs) {
    const specPath = path.join(runDir, "specs", `${job.video_id}_${job.mode}.json`);
    const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
    const transcriptPath = path.join(
      brainRoot,
      job.subagent_id,
      ".system_generated",
      "logs",
      "transcript.jsonl"
    );
    const res = await verifyWithShortWait({ spec, transcriptPath }, waitMs);
    if (!res.ok) failedCount++;
    results.push({ ...job, ...res });
  }

  console.log(
    JSON.stringify(
      {
        run_id: runId,
        checked: results.length,
        passed: results.length - failedCount,
        failed: failedCount,
        failures: results.filter((r) => !r.ok),
      },
      null,
      2
    )
  );
  if (failedCount > 0) process.exit(1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(2);
  });
}
