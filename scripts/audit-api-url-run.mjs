#!/usr/bin/env node
/**
 * Automated 7-point auditor & human spot-check sampler for Gemini API YouTube URL runs.
 * Does NOT touch frozen audit-blind-transcript.mjs or any Phase 2 frozen files.
 *
 * 7 automated checks (all must pass 100% before phase3_batch_payload.json is allowed):
 *  1) prompt_sha256_match: exact match with canonical prompt SHA-256 & zero metadata leak
 *  2) model_and_tier_match: gemini-4-neon, thinking_level=high, expected service_tier, completed
 *  3) output_json_valid: 5 dims 0..20 ints, sum == total_score, rank matches score band,
 *     non-empty rationale, full post_check, >= 3 timestamped_observations
 *  4) video_tokens_threshold: input_video_tokens >= max(1000, duration_sec * 90)
 *     (when duration_sec unknown, >= 1000 and r1/r2 video tokens agree within 10)
 *  5) observations_within_duration: all 3 timestamps parseable, 0 <= t <= ref_dur + 5s, not all identical
 *  6) raw_response_and_no_secrets: full raw response file exists, matches evidence_manifest SHA-256,
 *     non-empty raw_response, zero secret/API-key patterns
 *  7) ensemble_and_anchor_separation: every target video complete (mean_of_2 or median_of_3),
 *     zero anchor IDs present in target updates list
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_PROMPT_SHA256,
  aggregate2Plus1Scores,
  parseAndValidateScoreJson,
  scoreToCalibratedRank,
  sha256Text,
} from "./run-api-url-batch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const SECRET_RE = /(?:AIza[0-9A-Za-z\-_]{20,}|GEMINI_API_KEY\s*=\s*["']?[A-Za-z0-9\-_]{12,}|mysql2?:\/\/[^:\s]+:[^@\s]+@)/;

export function parseTimestampToSec(ts) {
  if (typeof ts !== "string") return null;
  const trimmed = ts.trim();
  const parts = trimmed.split(":");
  if (parts.length === 2) {
    const m = Number(parts[0]);
    const s = Number(parts[1]);
    if (!Number.isFinite(m) || !Number.isFinite(s) || m < 0 || s < 0 || s >= 60) return null;
    return m * 60 + s;
  }
  if (parts.length === 3) {
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    const s = Number(parts[2]);
    if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s) || h < 0 || m < 0 || m >= 60 || s < 0 || s >= 60) return null;
    return h * 3600 + m * 60 + s;
  }
  return null;
}

/**
 * Audit a single call record against Checks 1-6.
 */
export function auditCallRecord(callRecord, {
  expectedPromptSha256 = CANONICAL_PROMPT_SHA256,
  expectedModel = "gemini-4-neon",
  expectedThinkingLevel = "high",
  expectedServiceTier = "flex",
  knownDurationSec = null,
  rawFileText = null,
  expectedSha256 = null,
} = {}) {
  const checks = {
    prompt_sha256_match: true,
    model_and_tier_match: true,
    output_json_valid: true,
    video_tokens_threshold: true,
    observations_within_duration: true,
    raw_response_and_no_secrets: true,
  };
  const errors = [];

  // Check 1: Prompt SHA-256
  if (callRecord?.request?.prompt_sha256 !== expectedPromptSha256) {
    checks.prompt_sha256_match = false;
    errors.push(`prompt_sha256 mismatch: got=${callRecord?.request?.prompt_sha256}, expected=${expectedPromptSha256}`);
  }

  // Check 2: Model, thinking_level, service_tier, completed status
  const req = callRecord?.request || {};
  if (req.model !== expectedModel) {
    checks.model_and_tier_match = false;
    errors.push(`model mismatch: got=${req.model}, expected=${expectedModel}`);
  }
  if (req.thinking_level !== expectedThinkingLevel) {
    checks.model_and_tier_match = false;
    errors.push(`thinking_level mismatch: got=${req.thinking_level}, expected=${expectedThinkingLevel}`);
  }
  if (expectedServiceTier && req.service_tier !== expectedServiceTier) {
    checks.model_and_tier_match = false;
    errors.push(`service_tier mismatch: got=${req.service_tier}, expected=${expectedServiceTier}`);
  }
  if (callRecord?.exit_code !== 0 || callRecord?.api_status !== "completed") {
    checks.model_and_tier_match = false;
    errors.push(`call not completed: exit_code=${callRecord?.exit_code}, api_status=${callRecord?.api_status}`);
  }
  if (callRecord?.response_model && !String(callRecord.response_model).includes(expectedModel)) {
    checks.model_and_tier_match = false;
    errors.push(`response_model mismatch: got=${callRecord.response_model}`);
  }

  // Check 3: Output JSON structure + rank concordance
  const parsed = callRecord?.parsed_json;
  const recheck = parseAndValidateScoreJson(callRecord?.extracted_text || (parsed ? JSON.stringify(parsed) : ""));
  if (!recheck.ok) {
    checks.output_json_valid = false;
    errors.push(`output_json_invalid: ${recheck.error}`);
  } else {
    const expectedRank = scoreToCalibratedRank(recheck.parsed.total_score);
    if (recheck.parsed.rank !== expectedRank) {
      checks.output_json_valid = false;
      errors.push(`rank_score_mismatch: score=${recheck.parsed.total_score}, rank=${recheck.parsed.rank}, expected=${expectedRank}`);
    }
  }

  // Check 4: Video tokens >= duration_sec * 90 (and >= 1000)
  const vidTok = Number(callRecord?.usage_breakdown?.input_video_tokens ?? 0);
  const dur = knownDurationSec ?? callRecord?.ref_duration_sec ?? null;
  const minRequired = typeof dur === "number" && dur > 0 ? Math.max(1000, Math.floor(dur * 90)) : 1000;
  if (!Number.isFinite(vidTok) || vidTok < minRequired) {
    checks.video_tokens_threshold = false;
    errors.push(`video_tokens_too_low: got=${vidTok}, required>=${minRequired} (dur=${dur ?? "unknown"})`);
  }

  // Check 5: Timestamped observations within duration
  const obsList = recheck.ok ? recheck.parsed.timestamped_observations : [];
  if (obsList.length < 3) {
    checks.observations_within_duration = false;
    errors.push(`observations_count_lt_3: got=${obsList.length}`);
  } else {
    const refDur = typeof dur === "number" && dur > 0 ? dur : vidTok > 0 ? vidTok / 95 : null;
    const secs = [];
    for (let i = 0; i < obsList.length; i++) {
      const tSec = parseTimestampToSec(obsList[i]?.timestamp);
      if (tSec === null) {
        checks.observations_within_duration = false;
        errors.push(`invalid_timestamp_format[${i}]: ${String(obsList[i]?.timestamp)}`);
        continue;
      }
      secs.push(tSec);
      if (refDur !== null && tSec > refDur + 5) {
        checks.observations_within_duration = false;
        errors.push(`timestamp_exceeds_duration[${i}]: ${obsList[i].timestamp} (${tSec}s) > ${refDur.toFixed(1)}s + 5s`);
      }
      if (!obsList[i]?.observation || String(obsList[i].observation).trim().length < 8) {
        checks.observations_within_duration = false;
        errors.push(`observation_too_short[${i}]`);
      }
    }
    if (secs.length >= 3 && new Set(secs).size < 2) {
      checks.observations_within_duration = false;
      errors.push("all_observation_timestamps_identical");
    }
  }

  // Check 6: Full raw response saved, SHA-256 matches, no secrets
  const hasRaw =
    callRecord?.raw_response &&
    ((typeof callRecord.raw_response === "object" && Object.keys(callRecord.raw_response).length > 0) ||
      (typeof callRecord.raw_response === "string" && callRecord.raw_response.length > 0));
  if (!hasRaw) {
    checks.raw_response_and_no_secrets = false;
    errors.push("missing_raw_response");
  }
  const textToScan = rawFileText !== null ? rawFileText : JSON.stringify(callRecord);
  if (SECRET_RE.test(textToScan)) {
    checks.raw_response_and_no_secrets = false;
    errors.push("secret_pattern_detected_in_call_record");
  }
  if (expectedSha256 && rawFileText !== null) {
    const actualSha = sha256Text(rawFileText);
    if (actualSha !== expectedSha256) {
      checks.raw_response_and_no_secrets = false;
      errors.push(`evidence_sha256_mismatch: actual=${actualSha}, expected=${expectedSha256}`);
    }
  }

  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    errors,
  };
}

/**
 * Audit an entire API URL run (Checks 1-7 across all calls + ensemble + anchor separation).
 */
export function auditApiUrlRun({
  runConfig,
  callRecordsWithMeta,
  plannedPayloadVideoIds = null,
  knownDurationById = new Map(),
}) {
  const runErrors = [];
  const checkSummary = {
    prompt_sha256_match: true,
    model_and_tier_match: true,
    output_json_valid: true,
    video_tokens_threshold: true,
    observations_within_duration: true,
    raw_response_and_no_secrets: true,
    ensemble_and_anchor_separation: true,
  };

  if (sha256Text(runConfig.prompt_text || "") !== CANONICAL_PROMPT_SHA256) {
    checkSummary.prompt_sha256_match = false;
    runErrors.push("run_config.prompt_text SHA-256 mismatch with canonical prompt");
  }

  const perCall = [];
  const byVideo = new Map();

  for (const item of callRecordsWithMeta) {
    const rec = item.record;
    const res = auditCallRecord(rec, {
      expectedPromptSha256: CANONICAL_PROMPT_SHA256,
      expectedModel: runConfig.model || "gemini-4-neon",
      expectedThinkingLevel: runConfig.thinking_level || "high",
      expectedServiceTier: runConfig.service_tier || "flex",
      knownDurationSec: knownDurationById.get(rec.video_id) ?? rec.ref_duration_sec ?? null,
      rawFileText: item.rawFileText ?? null,
      expectedSha256: item.expectedSha256 ?? null,
    });
    for (const [k, v] of Object.entries(res.checks)) {
      if (!v) checkSummary[k] = false;
    }
    perCall.push({
      call_index: rec.call_index,
      video_id: rec.video_id,
      attempt: rec.attempt,
      passed: res.passed,
      errors: res.errors,
    });
    if (!byVideo.has(rec.video_id)) byVideo.set(rec.video_id, []);
    byVideo.get(rec.video_id).push(rec);
  }

  // Check 4b: When duration unknown, r1/r2 video tokens must agree within 10
  // Check 7: 2+1 ensemble completeness + anchor non-inclusion in payload
  const anchorSet = new Set((runConfig.anchor_video_ids || []).map(String));
  const targetIds = (runConfig.target_video_ids || []).map(String);

  for (const vid of targetIds) {
    const calls = (byVideo.get(vid) || [])
      .filter((c) => c.exit_code === 0 && c.parse_ok)
      .sort((a, b) => a.attempt - b.attempt);
    const scores = calls.map((c) => c.parsed_json.total_score);
    const agg = aggregate2Plus1Scores(scores);
    if (agg.status !== "complete") {
      checkSummary.ensemble_and_anchor_separation = false;
      runErrors.push(`target_video_incomplete: ${vid} (scores=${JSON.stringify(scores)}, status=${agg.status})`);
    }
    if (calls.length >= 2) {
      const dur = knownDurationById.get(vid) ?? calls[0].ref_duration_sec ?? null;
      if (dur === null) {
        const v1 = calls[0].usage_breakdown?.input_video_tokens ?? 0;
        const v2 = calls[1].usage_breakdown?.input_video_tokens ?? 0;
        if (Math.abs(v1 - v2) > 10) {
          checkSummary.video_tokens_threshold = false;
          runErrors.push(`unknown_dur_video_tokens_mismatch: ${vid} (r1=${v1}, r2=${v2})`);
        }
      }
    }
  }

  if (Array.isArray(plannedPayloadVideoIds)) {
    for (const pid of plannedPayloadVideoIds) {
      if (anchorSet.has(String(pid))) {
        checkSummary.ensemble_and_anchor_separation = false;
        runErrors.push(`anchor_leaked_into_payload: ${pid}`);
      }
    }
  }

  const failedCalls = perCall.filter((c) => !c.passed);
  const allPassed = Object.values(checkSummary).every(Boolean) && failedCalls.length === 0 && runErrors.length === 0;

  return {
    schema_version: 1,
    audited_at: new Date().toISOString(),
    run_id: runConfig.run_id,
    all_checks_passed: allPassed,
    checks: checkSummary,
    total_calls: perCall.length,
    failed_calls_count: failedCalls.length,
    run_errors: runErrors,
    failed_calls: failedCalls,
  };
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) args[k] = true;
      else {
        args[k] = next;
        i++;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function loadSqliteScenesForIds(ids) {
  const sqlitePath = "E:/iketeru-creative-studio/data/iketeru_knowledge.db";
  if (!fs.existsSync(sqlitePath) || !ids.length) return {};
  const pyCode = [
    "import sqlite3, json, sys",
    "ids = json.loads(sys.argv[2])",
    "conn = sqlite3.connect(f'file:{sys.argv[1]}?mode=ro', uri=True)",
    "cur = conn.cursor()",
    "out = {}",
    "for vid in ids:",
    "    cur.execute('SELECT start_mmss, end_mmss, shot_title, description FROM scenes WHERE video_id=? ORDER BY shot_index', (vid,))",
    "    out[vid] = [{'start': r[0], 'end': r[1], 'title': r[2], 'desc': r[3]} for r in cur.fetchall()]",
    "conn.close()",
    "print(json.dumps(out, ensure_ascii=False))",
  ].join("\n");
  return JSON.parse(execFileSync("python", ["-c", pyCode, sqlitePath, JSON.stringify(ids)], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }));
}

function main() {
  const args = parseArgs(process.argv);
  const runId = args._[0] || args["run-id"];
  if (!runId) {
    console.error("Usage: node scripts/audit-api-url-run.mjs <run_id> [--out-root <dir>] [--sample-review] [--write-report]");
    process.exit(2);
  }
  const outRoot = args["out-root"]
    ? path.resolve(REPO_ROOT, String(args["out-root"]))
    : path.join(REPO_ROOT, "analysis", "runs");
  const runDir = path.join(outRoot, runId);
  const runConfig = JSON.parse(fs.readFileSync(path.join(runDir, "run_config.json"), "utf8"));
  const manifest = JSON.parse(fs.readFileSync(path.join(runDir, "evidence_manifest.json"), "utf8"));

  const callRecordsWithMeta = [];
  for (const entry of manifest.files || []) {
    const abs = entry.abs_path;
    if (!fs.existsSync(abs)) {
      callRecordsWithMeta.push({
        record: { call_index: entry.call_index, video_id: entry.video_id, attempt: entry.attempt },
        rawFileText: "",
        expectedSha256: entry.sha256,
      });
      continue;
    }
    const rawFileText = fs.readFileSync(abs, "utf8");
    const record = JSON.parse(rawFileText);
    callRecordsWithMeta.push({ record, rawFileText, expectedSha256: entry.sha256 });
  }

  const report = auditApiUrlRun({ runConfig, callRecordsWithMeta });

  if (args["write-report"]) {
    const outPath = path.join(runDir, "api_audit_report.json");
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    console.log(`Wrote audit report: ${outPath}`);
  }

  if (args["sample-review"]) {
    // Pick up to 5 videos (prioritize tiebreakers, boundary scores, and first anchors)
    const byVid = new Map();
    for (const x of callRecordsWithMeta) {
      if (!byVid.has(x.record.video_id)) byVid.set(x.record.video_id, []);
      byVid.get(x.record.video_id).push(x.record);
    }
    const ranked = [...byVid.entries()].map(([vid, list]) => {
      const scores = list.filter((c) => c.parse_ok).map((c) => c.parsed_json.total_score);
      const meanScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      const isTie = scores.length >= 3 || (scores.length >= 2 && Math.abs(scores[0] - scores[1]) >= 4);
      const isBoundary = Math.abs(meanScore - 83) <= 3 || Math.abs(meanScore - 63) <= 3;
      const prio = (isTie ? 4 : 0) + (isBoundary ? 2 : 0) + (list[0]?.role === "anchor" ? 1 : 0);
      return { vid, prio, list };
    });
    ranked.sort((a, b) => b.prio - a.prio || a.vid.localeCompare(b.vid));
    const sample = ranked.slice(0, 5);
    const scenesMap = loadSqliteScenesForIds(sample.map((s) => s.vid));
    console.log("\n=== HUMAN SPOT-CHECK SAMPLE (up to 5 videos) ===");
    for (const s of sample) {
      console.log(`\nVIDEO ${s.vid} (prio=${s.prio}, scenes=${(scenesMap[s.vid] || []).length}):`);
      for (const sc of scenesMap[s.vid] || []) {
        console.log(`  SCENE [${sc.start}-${sc.end}] ${sc.title}`);
      }
      for (const c of s.list) {
        console.log(`  API r${c.attempt} score=${c.parsed_json?.total_score}:`);
        for (const o of c.parsed_json?.timestamped_observations || []) {
          console.log(`    [${o.timestamp}] ${o.observation}`);
        }
      }
    }
  }

  console.log(JSON.stringify(report, null, 2));
  if (!report.all_checks_passed) process.exit(1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
