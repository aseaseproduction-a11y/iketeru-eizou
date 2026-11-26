#!/usr/bin/env node
/**
 * 2-video probe for P0 embedStatus="restricted" YouTube videos using exact Stage 1 blind scoring
 * prompt (Standard tier, 1 call each, budget cap $0.30).
 *
 * Strictly obeys:
 *  - Identical prompt & SHA-256 to run_20261125_125425/run_config.json (CANONICAL_PROMPT_SHA256)
 *  - Model: gemini-4-neon, thinking_level: high, service_tier: standard, store: false
 *  - Deterministic selection: 1 from unavailable_embed_restricted + 1 from unavailable_private_or_deleted
 *    by SHA-256("iketeru_restricted_probe_20261125:" + video_id) ascending.
 *  - NEVER accesses YouTube directly from this PC.
 *  - NEVER writes to TiDB or SQLite.
 *  - NEVER prints, logs, or saves GEMINI_API_KEY anywhere.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  REPO_ROOT,
  CANONICAL_PROMPT_SOURCE,
  CANONICAL_PROMPT_SHA256,
  DEFAULT_LEDGER_PATH,
  DEFAULT_LOGS_ROOT,
  DEFAULT_TIMEOUT_MS,
  redactSecret,
  sha256Text,
  calcCallCostUsd,
  classifyApiError,
  extractModelText,
  extractUsageBreakdown,
  parseAndValidateScoreJson,
  updateLedger,
} from "../run-api-url-batch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(REPO_ROOT, "package.json"));
const dotenv = require("dotenv");

const PROBE_VIDEOS = [
  {
    video_id: "zPDMm7XUpkI",
    embed_status: "restricted",
    embed_reason: "unavailable_embed_restricted",
    ref_duration_sec: 64,
    selection_rule: "SHA-256('iketeru_restricted_probe_20261125:' + id) rank #1 within unavailable_embed_restricted (13 videos)",
  },
  {
    video_id: "YH2qyPanqK4",
    embed_status: "restricted",
    embed_reason: "unavailable_private_or_deleted",
    ref_duration_sec: 62,
    selection_rule: "SHA-256('iketeru_restricted_probe_20261125:' + id) rank #1 within unavailable_private_or_deleted (15 videos)",
  },
];

function resolveCliPath() {
  const localAppData = process.env.LOCALAPPDATA || "";
  const defaultExe = path.join(localAppData, "Programs", "gemini-api", "gemini-api.exe");
  if (fs.existsSync(defaultExe)) return defaultExe;
  return "gemini-api";
}

async function main() {
  dotenv.config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing in .env");

  const canonicalCfg = JSON.parse(fs.readFileSync(CANONICAL_PROMPT_SOURCE, "utf8"));
  const promptText = canonicalCfg.prompt_text;
  const promptSha256 = sha256Text(promptText);
  if (promptSha256 !== CANONICAL_PROMPT_SHA256) {
    throw new Error(`Prompt SHA-256 mismatch: ${promptSha256}`);
  }

  const runId = "restricted_probe_20261125_180700";
  const budgetCapUsd = 0.3;
  const model = canonicalCfg.model;
  const thinkingLevel = canonicalCfg.thinking_level;
  const serviceTier = "standard";
  const bodyJson = JSON.stringify({
    generation_config: { thinking_level: thinkingLevel },
    service_tier: serviceTier,
    store: false,
  });

  const outDir = path.join(REPO_ROOT, "analysis", "pilot_gemini_api_url", runId);
  const logsDir = path.join(DEFAULT_LOGS_ROOT, runId, "calls");
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });

  const cliExe = resolveCliPath();
  const results = [];
  let totalCostUsd = 0;
  let succeededCalls = 0;
  const congestionTimestamps = [];

  for (let i = 0; i < PROBE_VIDEOS.length; i++) {
    const v = PROBE_VIDEOS[i];
    if (totalCostUsd + 0.12 > budgetCapUsd) {
      throw new Error(`Budget cap $${budgetCapUsd} would be exceeded (spent=$${totalCostUsd})`);
    }
    const url = `https://www.youtube.com/watch?v=${v.video_id}`;
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    let stdoutStr = "";
    let stderrStr = "";
    let exitCode = 0;
    try {
      stdoutStr = execFileSync(
        cliExe,
        ["generate", promptText, "-m", model, "-i", url, "--stream=false", "--body", bodyJson, "-o", "json"],
        {
          encoding: "utf8",
          timeout: DEFAULT_TIMEOUT_MS,
          maxBuffer: 20 * 1024 * 1024,
          env: { ...process.env, GEMINI_API_KEY: apiKey },
        }
      );
    } catch (err) {
      exitCode = typeof err.status === "number" ? err.status : 1;
      stdoutStr = err.stdout ? String(err.stdout) : "";
      stderrStr = err.stderr ? String(err.stderr) : String(err.message || err);
    }
    const elapsedSec = Math.round(((Date.now() - t0) / 1000) * 100) / 100;
    const finishedAt = new Date().toISOString();
    const safeStdout = redactSecret(stdoutStr, apiKey);
    const safeStderr = redactSecret(stderrStr, apiKey);
    let respObj = null;
    try {
      respObj = JSON.parse(safeStdout);
    } catch {
      respObj = null;
    }

    const cls = classifyApiError(exitCode, `${safeStderr} ${safeStdout}`, respObj);
    const usage = extractUsageBreakdown(respObj, v.ref_duration_sec);
    const modelText = extractModelText(respObj);
    const parsed = parseAndValidateScoreJson(modelText);

    // Compute billed cost whenever API returned usage tokens (even if video tokens fell short)
    const hasUsage = usage.total_input_tokens > 0 || usage.total_output_tokens > 0 || usage.total_thought_tokens > 0;
    const cost = hasUsage
      ? calcCallCostUsd(usage, serviceTier)
      : { input_cost_usd: 0, output_thought_cost_usd: 0, call_cost_usd: 0 };

    if (hasUsage) {
      succeededCalls++;
      totalCostUsd = Math.round((totalCostUsd + cost.call_cost_usd) * 1_000_000) / 1_000_000;
    }
    if (cls.kind === "retryable_congestion") {
      congestionTimestamps.push(finishedAt);
    }

    const callFile = path.join(logsDir, `00${i + 1}_${v.video_id}_r1.json`);
    const fullRec = {
      run_id: runId,
      video_id: v.video_id,
      embed_status: v.embed_status,
      embed_reason: v.embed_reason,
      ref_duration_sec: v.ref_duration_sec,
      started_at: startedAt,
      finished_at: finishedAt,
      elapsed_sec: elapsedSec,
      exit_code: exitCode,
      classification: cls,
      api_status: respObj?.status || null,
      usage_breakdown: usage,
      cost,
      video_watched_pass: exitCode === 0 && !usage.suspect_video_not_processed,
      parse_ok: parsed.ok,
      parse_error: parsed.error,
      parsed_json: parsed.parsed,
      stderr: safeStderr || null,
      raw_response: respObj ?? safeStdout,
    };
    fs.writeFileSync(callFile, redactSecret(JSON.stringify(fullRec, null, 2) + "\n", apiKey), "utf8");

    results.push({
      video_id: v.video_id,
      embed_reason: v.embed_reason,
      ref_duration_sec: v.ref_duration_sec,
      selection_rule: v.selection_rule,
      exit_code: exitCode,
      classification_kind: cls.kind,
      classification_code: cls.code,
      elapsed_sec: elapsedSec,
      input_video_tokens: usage.input_video_tokens,
      min_required_video_tokens: usage.min_required_video_tokens,
      video_tokens_per_sec: usage.video_tokens_per_sec,
      total_input_tokens: usage.total_input_tokens,
      total_output_tokens: usage.total_output_tokens,
      total_thought_tokens: usage.total_thought_tokens,
      video_watched_pass: exitCode === 0 && !usage.suspect_video_not_processed,
      parse_ok: parsed.ok,
      api_score: parsed.ok ? parsed.parsed.total_score : null,
      cost_usd: cost.call_cost_usd,
      cost_incurred: cost.call_cost_usd > 0,
      error_snippet: exitCode !== 0 ? (safeStderr || safeStdout).slice(0, 400) : null,
      evidence_file: callFile,
    });
  }

  const summary = {
    schema_version: 1,
    run_id: runId,
    service_tier: serviceTier,
    model,
    thinking_level: thinkingLevel,
    prompt_sha256: promptSha256,
    budget_cap_usd: budgetCapUsd,
    total_cost_usd: totalCostUsd,
    billed_calls: succeededCalls,
    results,
  };
  fs.writeFileSync(
    path.join(outDir, "restricted_probe_report.json"),
    redactSecret(JSON.stringify(summary, null, 2) + "\n", apiKey),
    "utf8"
  );

  const monthKey = new Date().toISOString().slice(0, 7);
  if (succeededCalls > 0 || congestionTimestamps.length > 0) {
    updateLedger(DEFAULT_LEDGER_PATH, monthKey, {
      run_id: runId,
      purpose: "probe_p0_restricted_2_standard",
      service_tier: serviceTier,
      calls_count: succeededCalls,
      cost_usd: totalCostUsd,
      congestion_failure_count: congestionTimestamps.length,
      congestion_timestamps: congestionTimestamps,
      recorded_at: new Date().toISOString(),
    });
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error("FATAL:", err?.message || err);
  process.exit(1);
});
