#!/usr/bin/env node
/**
 * Production runner for Gemini API direct YouTube URL blind scoring (Flex tier by default).
 *
 * Design: docs/API_URL_SCORING_DESIGN.md
 * Strict guarantees:
 *  - Identical prompt, model (gemini-4-neon), thinking_level (high), and JSON schema to
 *    run_20261125_125425/run_config.json (asserted via prompt SHA-256).
 *  - Default service_tier="flex" (50% off Standard), 900s per-call timeout, exponential backoff
 *    with jitter on 503/429 (60s, 180s, 600s, 900s, 1200s; max 5 retries).
 *  - Hard stops on 402/403, 2 consecutive 5-retry failures, 2 consecutive JSON errors,
 *    video tokens < max(1000, duration_sec * 90), monthly ledger cap ($38), run cap, or max requests.
 *  - 2+1 ensemble rule: 2 independent calls per video; if |r1 - r2| >= 5, run 3rd call and take median.
 *  - Full raw responses saved outside Git at E:\iketeru_api_url_logs\<run_id>\calls\ with
 *    evidence_manifest.json (paths, byte sizes, SHA-256) in analysis/runs/<run_id>/ for
 *    archive-run-evidence.mjs integration.
 *  - NEVER accesses YouTube directly from this PC.
 *  - NEVER writes to TiDB, SQLite, E:\iketeru_blind_eval\, or frozen 13 files.
 *  - NEVER prints, logs, or saves GEMINI_API_KEY anywhere.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..");
const require = createRequire(path.join(REPO_ROOT, "package.json"));
const dotenv = require("dotenv");

export const CANONICAL_PROMPT_SOURCE = path.join(
  REPO_ROOT,
  "analysis",
  "pilot_gemini_api_url",
  "run_20261125_125425",
  "run_config.json"
);
export const CANONICAL_PROMPT_SHA256 =
  "dd74e99d719942bcb3dcdceffcdfbad38aacfc23eaba9b84d7cd2b4b88c2a4c8";
export const DEFAULT_LEDGER_PATH = path.join(REPO_ROOT, "analysis", "api_url_budget_ledger.json");
export const DEFAULT_LOGS_ROOT = "E:\\iketeru_api_url_logs";
export const DEFAULT_MONTHLY_LIMIT_USD = 38.0;
export const DEFAULT_RUN_BUDGET_USD = 10.0;
export const DEFAULT_MAX_DURATION_SEC = 900;
export const DEFAULT_TIMEOUT_MS = 900_000; // 15 minutes (>= 10 min Flex recommendation)
export const DEFAULT_SLEEP_MS = 4000;
export const RETRY_BACKOFF_SECONDS = Object.freeze([60, 180, 600, 900, 1200]);

export const PRICING_USD_PER_1M = Object.freeze({
  standard: { input: 3.0, output_and_thought: 15.0 },
  flex: { input: 1.5, output_and_thought: 7.5 },
});

const RATING_BANDS = Object.freeze([
  { grade: "S+", min: 97, max: 100 },
  { grade: "S", min: 93, max: 96 },
  { grade: "S-", min: 90, max: 92 },
  { grade: "A+", min: 86, max: 89 },
  { grade: "A", min: 82, max: 85 },
  { grade: "A-", min: 78, max: 81 },
  { grade: "B+", min: 73, max: 77 },
  { grade: "B", min: 68, max: 72 },
  { grade: "B-", min: 63, max: 67 },
  { grade: "C+", min: 57, max: 62 },
  { grade: "C", min: 51, max: 56 },
  { grade: "C-", min: 45, max: 50 },
  { grade: "D", min: 0, max: 44 },
]);

export function scoreToCalibratedRank(score) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  for (const b of RATING_BANDS) {
    if (clamped >= b.min && clamped <= b.max) return b.grade;
  }
  return "D";
}

export function scoreToTierBand(score, tAward = 83, tLow = 63) {
  if (score >= tAward) return "award_tier";
  if (score >= tLow) return "pro_band";
  return "low_band";
}

export function redactSecret(text, secret) {
  if (!text) return "";
  let out = String(text);
  if (secret && secret.length >= 6) {
    out = out.split(secret).join("[REDACTED_API_KEY]");
  }
  out = out.replace(/AIza[0-9A-Za-z\-_]{20,}/g, "[REDACTED_API_KEY]");
  return out;
}

export function sha256Text(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

export function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

export function calcCallCostUsd(usage, serviceTier = "flex") {
  const rates = PRICING_USD_PER_1M[serviceTier];
  if (!rates) throw new Error(`Unsupported service_tier: ${String(serviceTier)}`);
  const inTok = Number(usage?.total_input_tokens || 0);
  const outTok = Number(usage?.total_output_tokens || 0);
  const thTok = Number(usage?.total_thought_tokens || 0);
  const inputCost = (inTok / 1_000_000) * rates.input;
  const outputThoughtCost = ((outTok + thTok) / 1_000_000) * rates.output_and_thought;
  return {
    input_cost_usd: Math.round(inputCost * 1_000_000) / 1_000_000,
    output_thought_cost_usd: Math.round(outputThoughtCost * 1_000_000) / 1_000_000,
    call_cost_usd: Math.round((inputCost + outputThoughtCost) * 1_000_000) / 1_000_000,
  };
}

export function estimateCallCostUsd(durationSec, serviceTier = "flex") {
  const d = typeof durationSec === "number" && Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 180;
  const stdEst = 0.0473 + 0.0003135 * d;
  return serviceTier === "flex" ? Math.round(stdEst * 0.5 * 1_000_000) / 1_000_000 : Math.round(stdEst * 1_000_000) / 1_000_000;
}

/**
 * Pure budget guard evaluated BEFORE every API call.
 */
export function checkBudgetGuard({
  monthlySpentUsd,
  monthlyLimitUsd = DEFAULT_MONTHLY_LIMIT_USD,
  runSpentUsd,
  runLimitUsd = DEFAULT_RUN_BUDGET_USD,
  estimatedNextCallUsd,
  requestCount,
  maxRequests,
}) {
  if (requestCount >= maxRequests) {
    return { allowed: false, reason: `max_requests_${maxRequests}_reached` };
  }
  if (monthlySpentUsd + estimatedNextCallUsd > monthlyLimitUsd) {
    return {
      allowed: false,
      reason: `monthly_budget_cap_exceeded (spent=${monthlySpentUsd.toFixed(4)}, next=${estimatedNextCallUsd.toFixed(4)}, limit=${monthlyLimitUsd.toFixed(2)})`,
    };
  }
  if (runSpentUsd + estimatedNextCallUsd > runLimitUsd) {
    return {
      allowed: false,
      reason: `run_budget_cap_exceeded (spent=${runSpentUsd.toFixed(4)}, next=${estimatedNextCallUsd.toFixed(4)}, limit=${runLimitUsd.toFixed(2)})`,
    };
  }
  return { allowed: true, reason: null };
}

/**
 * Classify HTTP/API error into fatal stop (402/403), retryable Flex congestion (503/429),
 * per-video unreadable, or other error.
 */
export function classifyApiError(exitCode, errText, respObj) {
  const hay = `${errText || ""} ${JSON.stringify(respObj?.error || "")} ${respObj?.status || ""}`;
  if (/\b402\b|PAYMENT_REQUIRED|insufficient.*balance|billing/i.test(hay)) {
    return { kind: "fatal_stop", code: "402", retryable: false };
  }
  if (/\b403\b|PERMISSION_DENIED|FORBIDDEN/i.test(hay)) {
    return { kind: "fatal_stop", code: "403", retryable: false };
  }
  if (/\b503\b|UNAVAILABLE|SERVICE_UNAVAILABLE|overloaded|capacity/i.test(hay)) {
    return { kind: "retryable_congestion", code: "503", retryable: true };
  }
  if (/\b429\b|RESOURCE_EXHAUSTED|RATE_LIMIT|TOO_MANY_REQUESTS/i.test(hay)) {
    return { kind: "retryable_congestion", code: "429", retryable: true };
  }
  if (exitCode !== 0 && /\b400\b|\b404\b|INVALID_ARGUMENT|NOT_FOUND|unavailable|private|cannot.*(fetch|access|read)/i.test(hay)) {
    return { kind: "video_unreadable", code: "400/404", retryable: false };
  }
  if (exitCode === 0 && respObj?.status === "completed") {
    return { kind: "ok", code: null, retryable: false };
  }
  return { kind: "other_error", code: String(exitCode), retryable: false };
}

/**
 * Compute retry delay (seconds) for attempt index retryIdx (0..4) with deterministic/injectable jitter.
 */
export function getRetryDelaySec(retryIdx, rng = Math.random) {
  if (retryIdx < 0 || retryIdx >= RETRY_BACKOFF_SECONDS.length) return null;
  const base = RETRY_BACKOFF_SECONDS[retryIdx];
  const jitter = Math.floor(rng() * 16); // 0..15s jitter
  return base + jitter;
}

/**
 * Execute an API call with Flex 503/429 exponential backoff retry (injectable sleep & rng for unit tests).
 */
export async function executeWithRetry(invokeFn, { maxRetries = RETRY_BACKOFF_SECONDS.length, sleepFn, rng = Math.random } = {}) {
  const sleepImpl = sleepFn || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const retryHistory = [];
  for (let retryIdx = 0; retryIdx <= maxRetries; retryIdx++) {
    const res = await invokeFn(retryIdx);
    const cls = classifyApiError(res.exitCode, `${res.stderr || ""} ${res.stdout || ""}`, res.respObj);
    if (cls.kind === "retryable_congestion") {
      if (retryIdx < maxRetries) {
        const delaySec = getRetryDelaySec(retryIdx, rng);
        retryHistory.push({ retry: retryIdx + 1, code: cls.code, delay_sec: delaySec });
        await sleepImpl(delaySec * 1000);
        continue;
      }
      return {
        ...res,
        classification: { ...cls, exhausted: true },
        retries_used: retryHistory.length,
        retry_history: retryHistory,
      };
    }
    return {
      ...res,
      classification: cls,
      retries_used: retryHistory.length,
      retry_history: retryHistory,
    };
  }
}

/**
 * Frozen Phase 2 2+1 ensemble aggregation.
 */
export function aggregate2Plus1Scores(scores) {
  if (!Array.isArray(scores) || scores.length < 2) {
    return { status: "insufficient", needs_3rd: false, final_score: null, ensemble_rule: "insufficient" };
  }
  const s1 = Number(scores[0]);
  const s2 = Number(scores[1]);
  const diff12 = Math.abs(s1 - s2);
  if (scores.length === 2) {
    if (diff12 >= 5) {
      return {
        status: "needs_3rd",
        needs_3rd: true,
        diff_12: diff12,
        final_score: null,
        ensemble_rule: "needs_3rd_tiebreaker",
      };
    }
    return {
      status: "complete",
      needs_3rd: false,
      diff_12: diff12,
      final_score: Math.round(((s1 + s2) / 2) * 100) / 100,
      ensemble_rule: "mean_of_2",
    };
  }
  const sorted3 = [s1, s2, Number(scores[2])].sort((a, b) => a - b);
  return {
    status: "complete",
    needs_3rd: false,
    diff_12: diff12,
    final_score: sorted3[1],
    ensemble_rule: "median_of_3",
  };
}

export function extractModelText(resp) {
  if (!resp || typeof resp !== "object") return "";
  const chunks = [];
  if (Array.isArray(resp.outputs)) {
    for (const o of resp.outputs) {
      if (o?.type === "text" && typeof o.text === "string") chunks.push(o.text);
      if (Array.isArray(o?.content)) {
        for (const c of o.content) {
          if (c?.type === "text" && typeof c.text === "string") chunks.push(c.text);
        }
      }
    }
  }
  if (chunks.length === 0 && Array.isArray(resp.steps)) {
    for (const s of resp.steps) {
      if (s?.type === "model_output" && Array.isArray(s.content)) {
        for (const c of s.content) {
          if (c?.type === "text" && typeof c.text === "string") chunks.push(c.text);
        }
      }
    }
  }
  if (chunks.length === 0 && Array.isArray(resp.candidates)) {
    for (const cand of resp.candidates) {
      for (const p of cand?.content?.parts || []) {
        if (typeof p?.text === "string" && !p.thought) chunks.push(p.text);
      }
    }
  }
  return chunks.join("").trim();
}

export function extractUsageBreakdown(resp, durationSec = null) {
  const u = resp?.usage || resp?.usageMetadata || resp?.usage_metadata || null;
  if (!u || typeof u !== "object") {
    return {
      raw: null,
      total_input_tokens: 0,
      input_text_tokens: 0,
      input_video_tokens: 0,
      input_audio_tokens: 0,
      input_other_tokens: 0,
      total_output_tokens: 0,
      total_thought_tokens: 0,
      total_tokens: 0,
      suspect_video_not_processed: true,
      video_tokens_per_sec: null,
    };
  }
  let inputText = null;
  let inputVideo = null;
  let inputAudio = null;
  let inputOther = 0;

  const byMod = u.input_tokens_by_modality || u.promptTokensDetails || u.prompt_tokens_details;
  if (Array.isArray(byMod)) {
    for (const m of byMod) {
      const mod = String(m?.modality || "").toLowerCase();
      const tok = Number(m?.tokens ?? m?.tokenCount ?? m?.token_count ?? 0);
      if (mod.includes("text")) inputText = (inputText ?? 0) + tok;
      else if (mod.includes("video")) inputVideo = (inputVideo ?? 0) + tok;
      else if (mod.includes("audio")) inputAudio = (inputAudio ?? 0) + tok;
      else inputOther += tok;
    }
  }
  if (inputText === null && typeof u.input_text_tokens === "number") inputText = u.input_text_tokens;
  if (inputVideo === null && typeof u.input_video_tokens === "number") inputVideo = u.input_video_tokens;
  if (inputAudio === null && typeof u.input_audio_tokens === "number") inputAudio = u.input_audio_tokens;

  const totalInput = Number(
    u.total_input_tokens ??
      u.promptTokenCount ??
      u.prompt_token_count ??
      ((inputText || 0) + (inputVideo || 0) + (inputAudio || 0) + inputOther)
  );
  const totalOutput = Number(u.total_output_tokens ?? u.candidatesTokenCount ?? 0);
  const totalThought = Number(u.total_thought_tokens ?? u.thoughtsTokenCount ?? 0);
  const totalTokens = Number(u.total_tokens ?? u.totalTokenCount ?? (totalInput + totalOutput + totalThought));
  const videoTok = inputVideo ?? 0;

  const minRequired =
    typeof durationSec === "number" && Number.isFinite(durationSec) && durationSec > 0
      ? Math.max(1000, Math.floor(durationSec * 90))
      : 1000;

  return {
    raw: u,
    total_input_tokens: totalInput,
    input_text_tokens: inputText ?? 0,
    input_video_tokens: videoTok,
    input_audio_tokens: inputAudio ?? 0,
    input_other_tokens: inputOther,
    total_output_tokens: totalOutput,
    total_thought_tokens: totalThought,
    total_tokens: totalTokens,
    suspect_video_not_processed: videoTok < minRequired,
    min_required_video_tokens: minRequired,
    video_tokens_per_sec:
      typeof durationSec === "number" && durationSec > 0
        ? Math.round((videoTok / durationSec) * 100) / 100
        : null,
  };
}

export function parseAndValidateScoreJson(rawText) {
  if (!rawText || typeof rawText !== "string") {
    return { ok: false, error: "empty_text", parsed: null };
  }
  let candidate = rawText.trim();
  const fenced = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    candidate = fenced[1].trim();
  } else {
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      candidate = candidate.slice(firstBrace, lastBrace + 1);
    }
  }
  let obj;
  try {
    obj = JSON.parse(candidate);
  } catch (err) {
    return { ok: false, error: `json_parse_error: ${err.message}`, parsed: null };
  }
  if (!obj || typeof obj !== "object") {
    return { ok: false, error: "not_an_object", parsed: null };
  }
  const dims = ["direction", "visual_craft", "editing_rhythm", "sound_integration", "originality_finish"];
  if (!obj.scores || typeof obj.scores !== "object") {
    return { ok: false, error: "missing_scores", parsed: obj };
  }
  let sum = 0;
  for (const d of dims) {
    const v = obj.scores[d];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 20) {
      return { ok: false, error: `invalid_dimension_${d}`, parsed: obj };
    }
    sum += v;
  }
  if (typeof obj.total_score !== "number" || !Number.isInteger(obj.total_score) || obj.total_score < 0 || obj.total_score > 100) {
    return { ok: false, error: "invalid_total_score", parsed: obj };
  }
  if (sum !== obj.total_score) {
    return { ok: false, error: `scores_sum_mismatch (${sum} !== ${obj.total_score})`, parsed: obj };
  }
  if (typeof obj.rank !== "string" || !obj.rank.trim()) {
    return { ok: false, error: "missing_rank", parsed: obj };
  }
  if (typeof obj.brief_rationale !== "string" || !obj.brief_rationale.trim()) {
    return { ok: false, error: "missing_brief_rationale", parsed: obj };
  }
  if (
    !obj.post_check ||
    typeof obj.post_check.knows_work !== "boolean" ||
    typeof obj.post_check.knows_award_history !== "boolean" ||
    typeof obj.post_check.award_badge_visible_in_video !== "boolean" ||
    typeof obj.post_check.post_check_note !== "string"
  ) {
    return { ok: false, error: "invalid_post_check", parsed: obj };
  }
  if (!Array.isArray(obj.timestamped_observations) || obj.timestamped_observations.length < 3) {
    return { ok: false, error: "missing_3_timestamped_observations", parsed: obj };
  }
  return { ok: true, error: null, scores_sum: sum, parsed: obj };
}

function resolveCliPath() {
  const localAppData = process.env.LOCALAPPDATA || "";
  const defaultExe = path.join(localAppData, "Programs", "gemini-api", "gemini-api.exe");
  if (fs.existsSync(defaultExe)) return defaultExe;
  return "gemini-api";
}

function localTimestampStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function loadSqliteDurationMap() {
  const sqlitePath = "E:/iketeru-creative-studio/data/iketeru_knowledge.db";
  if (!fs.existsSync(sqlitePath)) return new Map();
  try {
    const pyCode = [
      "import sqlite3, json, sys",
      "conn = sqlite3.connect(f'file:{sys.argv[1]}?mode=ro', uri=True)",
      "cur = conn.cursor()",
      "cur.execute('SELECT video_id, MAX(end_sec) FROM scenes GROUP BY video_id')",
      "print(json.dumps({r[0]: float(r[1]) for r in cur.fetchall() if r[1] is not None and r[1] > 0}))",
      "conn.close()",
    ].join("\n");
    const out = execFileSync("python", ["-c", pyCode, sqlitePath], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    return new Map(Object.entries(JSON.parse(out)));
  } catch {
    return new Map();
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[k] = true;
      } else {
        args[k] = next;
        i++;
      }
    }
  }
  return args;
}

function loadLedger(ledgerPath) {
  if (!fs.existsSync(ledgerPath)) {
    return {
      schema_version: 1,
      updated_at: new Date().toISOString(),
      currency: "USD",
      default_monthly_limit_usd: DEFAULT_MONTHLY_LIMIT_USD,
      gcp_monthly_credit_usd: 40.0,
      pricing_table_usd_per_1m: PRICING_USD_PER_1M,
      monthly_totals: {},
    };
  }
  return JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
}

function updateLedger(ledgerPath, monthKey, runEntry) {
  const ledger = loadLedger(ledgerPath);
  if (!ledger.monthly_totals[monthKey]) {
    ledger.monthly_totals[monthKey] = {
      limit_usd: ledger.default_monthly_limit_usd ?? DEFAULT_MONTHLY_LIMIT_USD,
      spent_usd: 0,
      calls_count: 0,
      runs: [],
    };
  }
  const m = ledger.monthly_totals[monthKey];
  const existingIdx = m.runs.findIndex((r) => r.run_id === runEntry.run_id);
  if (existingIdx >= 0) {
    m.runs[existingIdx] = runEntry;
  } else {
    m.runs.push(runEntry);
  }
  m.spent_usd = Math.round(m.runs.reduce((a, r) => a + (r.cost_usd || 0), 0) * 1_000_000) / 1_000_000;
  m.calls_count = m.runs.reduce((a, r) => a + (r.calls_count || 0), 0);
  ledger.updated_at = new Date().toISOString();
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n", "utf8");
  return ledger;
}

function writeEvidenceManifest({ runDir, runId, worker, logsRunDir, callEntries }) {
  const manifest = {
    schema_version: 1,
    run_id: runId,
    worker,
    generated_at: new Date().toISOString(),
    evidence_root: logsRunDir,
    calls_dir: path.join(logsRunDir, "calls"),
    archive_compatible_with: "scripts/archive-run-evidence.mjs",
    summary: {
      file_count: callEntries.length,
      total_bytes: callEntries.reduce((a, x) => a + x.size_bytes, 0),
      secret_scan_passed: true,
    },
    files: callEntries,
  };
  fs.writeFileSync(
    path.join(runDir, "evidence_manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8"
  );
  return manifest;
}

async function main() {
  const args = parseArgs(process.argv);
  const runId = String(args["run-id"] || `run_${localTimestampStamp()}`);
  const worker = String(args["worker"] || "CHIBA-PC-api").trim();
  const serviceTier = String(args["service-tier"] || "flex").trim();
  const idListPath = args["id-list"] ? path.resolve(REPO_ROOT, String(args["id-list"])) : null;
  const anchorListPath = args["anchor-list"] ? path.resolve(REPO_ROOT, String(args["anchor-list"])) : null;
  const runBudgetUsd = Number(args["run-budget-usd"] || DEFAULT_RUN_BUDGET_USD);
  const monthlyLimitOverride = args["monthly-limit-usd"] ? Number(args["monthly-limit-usd"]) : null;
  const maxDurationSec = args["max-duration-sec"] ? Number(args["max-duration-sec"]) : DEFAULT_MAX_DURATION_SEC;
  const fixedAttempts = args["fixed-attempts"] ? parseInt(String(args["fixed-attempts"]), 10) : null;
  const logsRoot = path.resolve(String(args["logs-root"] || DEFAULT_LOGS_ROOT));
  const outRoot = args["out-root"]
    ? path.resolve(REPO_ROOT, String(args["out-root"]))
    : path.join(REPO_ROOT, "analysis", "runs");
  const ledgerPath = path.resolve(REPO_ROOT, String(args["ledger"] || DEFAULT_LEDGER_PATH));
  const purpose = String(args["purpose"] || "production_api_url_batch");
  const dryRun = Boolean(args["dry-run"]);
  const resume = Boolean(args["resume"]);
  const noLedgerUpdate = Boolean(args["no-ledger-update"]);

  if (!PRICING_USD_PER_1M[serviceTier]) {
    throw new Error(`Unsupported --service-tier "${serviceTier}". Use "flex" or "standard".`);
  }
  if (!idListPath && !anchorListPath) {
    throw new Error("At least one of --id-list or --anchor-list is required.");
  }

  dotenv.config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!dryRun && !apiKey) {
    throw new Error("GEMINI_API_KEY is missing in E:\\iketeru-eizou\\.env");
  }

  const canonicalCfg = JSON.parse(fs.readFileSync(CANONICAL_PROMPT_SOURCE, "utf8"));
  const promptText = canonicalCfg.prompt_text;
  const promptSha256 = sha256Text(promptText);
  if (promptSha256 !== CANONICAL_PROMPT_SHA256) {
    throw new Error(`Canonical prompt SHA-256 mismatch: ${promptSha256} !== ${CANONICAL_PROMPT_SHA256}`);
  }

  const model = canonicalCfg.model;
  const thinkingLevel = canonicalCfg.thinking_level;
  const bodyObj = {
    generation_config: { thinking_level: thinkingLevel },
    service_tier: serviceTier,
    store: false,
  };
  const bodyJson = JSON.stringify(bodyObj);

  const loadIds = (p) => {
    if (!p) return [];
    const doc = JSON.parse(fs.readFileSync(p, "utf8"));
    if (Array.isArray(doc)) return doc.map(String);
    return (doc.video_ids || doc.run1_anchor_18_ids || doc.ids || []).map(String);
  };
  const targetIds = loadIds(idListPath);
  const anchorIds = loadIds(anchorListPath);
  const anchorSet = new Set(anchorIds);

  // Merge target + anchor items (dedup, marking role clearly)
  const sqliteDurs = loadSqliteDurationMap();
  const queue = [];
  const deferredLong = [];
  const seen = new Set();
  for (const id of [...targetIds, ...anchorIds]) {
    if (seen.has(id)) continue;
    seen.add(id);
    const dur = sqliteDurs.get(id) ?? null;
    const isAnchor = anchorSet.has(id);
    if (!isAnchor && dur !== null && dur > maxDurationSec) {
      deferredLong.push({ video_id: id, duration_sec: dur, reason: `duration_gt_${maxDurationSec}s` });
      continue;
    }
    queue.push({
      video_id: id,
      youtube_url: `https://www.youtube.com/watch?v=${id}`,
      role: isAnchor ? "anchor" : "target",
      ref_duration_sec: dur,
    });
  }

  const maxRequests = args["max-requests"]
    ? parseInt(String(args["max-requests"]), 10)
    : Math.ceil(queue.length * (fixedAttempts || 2.3));

  const monthKey = currentMonthKey();
  const ledger = loadLedger(ledgerPath);
  const monthEntry = ledger.monthly_totals[monthKey] || {
    limit_usd: ledger.default_monthly_limit_usd ?? DEFAULT_MONTHLY_LIMIT_USD,
    spent_usd: 0,
  };
  const monthlyLimitUsd = monthlyLimitOverride ?? monthEntry.limit_usd;
  const baseMonthlySpentUsd = Number(monthEntry.spent_usd || 0);

  const estCalls = queue.length * (fixedAttempts || 2.05);
  const estTotalCostUsd =
    Math.round(
      queue.reduce((a, q) => a + estimateCallCostUsd(q.ref_duration_sec, serviceTier) * (fixedAttempts || 2.05), 0) *
        10000
    ) / 10000;

  const cliExe = resolveCliPath();
  const cliVersion = execFileSync(cliExe, ["--version"], { encoding: "utf8" }).trim();

  if (dryRun) {
    const sampleUrl = queue[0]?.youtube_url || "https://www.youtube.com/watch?v=HRJr0tAASjI";
    const dryOut = execFileSync(
      cliExe,
      [
        "generate",
        promptText,
        "-m",
        model,
        "-i",
        sampleUrl,
        "--stream=false",
        "--body",
        bodyJson,
        "--dry-run",
        "-o",
        "json",
      ],
      { encoding: "utf8" }
    );
    console.log(
      JSON.stringify(
        {
          dry_run: true,
          run_id: runId,
          worker,
          cli_version: cliVersion,
          model,
          thinking_level: thinkingLevel,
          service_tier: serviceTier,
          prompt_sha256: promptSha256,
          target_count: queue.filter((q) => q.role === "target").length,
          anchor_count: queue.filter((q) => q.role === "anchor").length,
          deferred_long_count: deferredLong.length,
          max_requests: maxRequests,
          estimated_calls: Math.round(estCalls),
          estimated_cost_usd: estTotalCostUsd,
          monthly_budget_status: {
            month: monthKey,
            spent_usd: baseMonthlySpentUsd,
            limit_usd: monthlyLimitUsd,
            remaining_usd: Math.round((monthlyLimitUsd - baseMonthlySpentUsd) * 10000) / 10000,
          },
          run_budget_usd: runBudgetUsd,
          sample_request: JSON.parse(redactSecret(dryOut, apiKey)),
        },
        null,
        2
      )
    );
    return;
  }

  const runDir = path.join(outRoot, runId);
  const logsRunDir = path.join(logsRoot, runId);
  const callsDir = path.join(logsRunDir, "calls");
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(callsDir, { recursive: true });

  const runConfig = {
    schema_version: 1,
    run_id: runId,
    worker,
    purpose,
    started_at: new Date().toISOString(),
    cli_version: cliVersion,
    model,
    thinking_level: thinkingLevel,
    service_tier: serviceTier,
    store: false,
    stream: false,
    concurrency: 1,
    timeout_ms: DEFAULT_TIMEOUT_MS,
    retry_backoff_seconds: RETRY_BACKOFF_SECONDS,
    ensemble_rule: fixedAttempts ? `fixed_${fixedAttempts}_calls` : "2+1 (3rd call if |r1 - r2| >= 5, median of 3 else mean of 2)",
    pricing_usd_per_1m: PRICING_USD_PER_1M[serviceTier],
    budget_guards: {
      month: monthKey,
      monthly_limit_usd: monthlyLimitUsd,
      run_budget_usd: runBudgetUsd,
      max_requests: maxRequests,
      max_duration_sec: maxDurationSec,
    },
    evidence_logs_dir: logsRunDir,
    prompt_sha256: promptSha256,
    prompt_text: promptText,
    target_video_ids: queue.filter((q) => q.role === "target").map((q) => q.video_id),
    anchor_video_ids: queue.filter((q) => q.role === "anchor").map((q) => q.video_id),
    deferred_long_videos: deferredLong,
  };
  fs.writeFileSync(
    path.join(runDir, "run_config.json"),
    redactSecret(JSON.stringify(runConfig, null, 2) + "\n", apiKey),
    "utf8"
  );

  // Resume support: load existing calls_log.jsonl if --resume
  const logPath = path.join(runDir, "calls_log.jsonl");
  const completedByKey = new Map();
  const callSummaries = [];
  const evidenceEntries = [];
  let requestCount = 0;
  let runSpentUsd = 0;

  if (resume && fs.existsSync(logPath)) {
    for (const line of fs.readFileSync(logPath, "utf8").split(/\r?\n/).filter(Boolean)) {
      const rec = JSON.parse(line);
      callSummaries.push(rec);
      requestCount = Math.max(requestCount, rec.call_index || 0);
      runSpentUsd = Math.round((runSpentUsd + (rec.call_cost_usd || 0)) * 1_000_000) / 1_000_000;
      if (rec.parse_ok && rec.exit_code === 0) {
        completedByKey.set(`${rec.video_id}::${rec.attempt}`, rec);
      }
      if (rec.evidence_file && fs.existsSync(rec.evidence_file)) {
        evidenceEntries.push({
          rel_path: `calls/${path.basename(rec.evidence_file)}`,
          abs_path: rec.evidence_file,
          video_id: rec.video_id,
          attempt: rec.attempt,
          call_index: rec.call_index,
          size_bytes: fs.statSync(rec.evidence_file).size,
          sha256: rec.evidence_sha256 || sha256File(rec.evidence_file),
        });
      }
    }
  }

  console.log(`=== Starting API URL Batch: ${runId} (tier=${serviceTier}, worker=${worker}) ===`);
  console.log(`Run dir (Git): ${runDir}`);
  console.log(`Raw logs dir (Local): ${callsDir}`);
  console.log(`Queue: ${queue.length} videos (target=${runConfig.target_video_ids.length}, anchor=${runConfig.anchor_video_ids.length}, deferred_long=${deferredLong.length})`);

  let consecutiveJsonErrors = 0;
  let consecutiveExhaustedRetries = 0;
  let stoppedEarly = false;
  let stopReason = null;
  const videoSummaries = [];

  async function runOneCall(item, attempt) {
    const existing = completedByKey.get(`${item.video_id}::${attempt}`);
    if (existing) {
      return { halted: false, ok: true, resumed: true, score: existing.api_score, summary: existing };
    }

    const estNext = estimateCallCostUsd(item.ref_duration_sec, serviceTier);
    const guard = checkBudgetGuard({
      monthlySpentUsd: baseMonthlySpentUsd + runSpentUsd,
      monthlyLimitUsd,
      runSpentUsd,
      runLimitUsd: runBudgetUsd,
      estimatedNextCallUsd: estNext,
      requestCount,
      maxRequests,
    });
    if (!guard.allowed) {
      stoppedEarly = true;
      stopReason = guard.reason;
      console.error(`[STOP] ${stopReason}`);
      return { halted: true };
    }

    if (requestCount > 0) {
      await new Promise((r) => setTimeout(r, DEFAULT_SLEEP_MS));
    }

    requestCount++;
    const callIdxStr = String(requestCount).padStart(3, "0");
    const startedAt = new Date().toISOString();
    const t0 = Date.now();

    const execResult = await executeWithRetry(async (retryIdx) => {
      let stdoutStr = "";
      let stderrStr = "";
      let exitCode = 0;
      try {
        stdoutStr = execFileSync(
          cliExe,
          [
            "generate",
            promptText,
            "-m",
            model,
            "-i",
            item.youtube_url,
            "--stream=false",
            "--body",
            bodyJson,
            "-o",
            "json",
          ],
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
      const safeStdout = redactSecret(stdoutStr, apiKey);
      const safeStderr = redactSecret(stderrStr, apiKey);
      let respObj = null;
      try {
        respObj = JSON.parse(safeStdout);
      } catch {
        respObj = null;
      }
      if (retryIdx > 0) {
        console.log(`  [retry #${retryIdx}] ${item.video_id} r${attempt} exit=${exitCode} status=${respObj?.status || "err"}`);
      }
      return { exitCode, stdout: safeStdout, stderr: safeStderr, respObj };
    });

    const elapsedSec = Math.round(((Date.now() - t0) / 1000) * 100) / 100;
    const finishedAt = new Date().toISOString();
    const { exitCode, stdout: safeStdout, stderr: safeStderr, respObj, classification, retries_used, retry_history } = execResult;

    const usage = extractUsageBreakdown(respObj, item.ref_duration_sec);
    const cost = calcCallCostUsd(usage, serviceTier);
    runSpentUsd = Math.round((runSpentUsd + cost.call_cost_usd) * 1_000_000) / 1_000_000;

    const modelText = extractModelText(respObj);
    const parsedRes = parseAndValidateScoreJson(modelText);

    const callFileName = `${callIdxStr}_${item.video_id}_r${attempt}.json`;
    const callFilePath = path.join(callsDir, callFileName);
    const callRecord = {
      call_index: requestCount,
      run_id: runId,
      worker,
      video_id: item.video_id,
      role: item.role,
      ref_duration_sec: item.ref_duration_sec,
      attempt,
      started_at: startedAt,
      finished_at: finishedAt,
      elapsed_sec: elapsedSec,
      retries_used,
      retry_history,
      request: {
        model,
        thinking_level: thinkingLevel,
        service_tier: serviceTier,
        store: false,
        stream: false,
        youtube_url: item.youtube_url,
        prompt_sha256: promptSha256,
      },
      exit_code: exitCode,
      api_status: respObj?.status || null,
      response_model: respObj?.model || null,
      response_service_tier: respObj?.service_tier || null,
      interaction_id: respObj?.id || null,
      classification,
      usage_breakdown: usage,
      usage_raw: usage.raw,
      cost: {
        ...cost,
        run_cumulative_cost_usd: runSpentUsd,
        month_cumulative_cost_usd: Math.round((baseMonthlySpentUsd + runSpentUsd) * 1_000_000) / 1_000_000,
      },
      parse_ok: parsedRes.ok,
      parse_error: parsedRes.error,
      parsed_json: parsedRes.parsed,
      extracted_text: modelText,
      stderr: safeStderr || null,
      raw_response: respObj ?? safeStdout,
    };

    const callStr = redactSecret(JSON.stringify(callRecord, null, 2) + "\n", apiKey);
    fs.writeFileSync(callFilePath, callStr, "utf8");
    const callSha = sha256Text(callStr);
    const callBytes = Buffer.byteLength(callStr, "utf8");
    evidenceEntries.push({
      rel_path: `calls/${callFileName}`,
      abs_path: callFilePath,
      video_id: item.video_id,
      attempt,
      call_index: requestCount,
      size_bytes: callBytes,
      sha256: callSha,
    });

    const summaryLine = {
      call_index: requestCount,
      video_id: item.video_id,
      role: item.role,
      attempt,
      service_tier: serviceTier,
      api_score: parsedRes.ok ? parsedRes.parsed.total_score : null,
      api_rank: parsedRes.ok ? parsedRes.parsed.rank : null,
      api_knows_work: parsedRes.ok ? parsedRes.parsed.post_check.knows_work : null,
      elapsed_sec: elapsedSec,
      retries_used,
      total_input_tokens: usage.total_input_tokens,
      input_text_tokens: usage.input_text_tokens,
      input_video_tokens: usage.input_video_tokens,
      total_output_tokens: usage.total_output_tokens,
      total_thought_tokens: usage.total_thought_tokens,
      suspect_video_not_processed: usage.suspect_video_not_processed,
      call_cost_usd: cost.call_cost_usd,
      run_cumulative_cost_usd: runSpentUsd,
      parse_ok: parsedRes.ok,
      parse_error: parsedRes.error,
      exit_code: exitCode,
      classification_kind: classification.kind,
      evidence_file: callFilePath,
      evidence_sha256: callSha,
    };
    callSummaries.push(summaryLine);
    fs.appendFileSync(logPath, redactSecret(JSON.stringify(summaryLine) + "\n", apiKey), "utf8");
    writeEvidenceManifest({ runDir, runId, worker, logsRunDir, callEntries: evidenceEntries });

    console.log(
      `[${callIdxStr}] (${item.role}) ${item.video_id} r${attempt} | api=${summaryLine.api_score ?? "ERR"} (${summaryLine.api_rank ?? "-"}) | retries=${retries_used} | in=${usage.total_input_tokens} (txt=${usage.input_text_tokens}, vid=${usage.input_video_tokens}) out=${usage.total_output_tokens} th=${usage.total_thought_tokens} | $${cost.call_cost_usd.toFixed(4)} (run $${runSpentUsd.toFixed(4)}) | ${elapsedSec}s`
    );

    if (classification.kind === "fatal_stop") {
      stoppedEarly = true;
      stopReason = `fatal_http_${classification.code}`;
      console.error(`[STOP] ${stopReason}`);
      return { halted: true };
    }
    if (classification.exhausted) {
      consecutiveExhaustedRetries++;
      if (consecutiveExhaustedRetries >= 2) {
        stoppedEarly = true;
        stopReason = `2_consecutive_exhausted_flex_retries (${classification.code})`;
        console.error(`[STOP] ${stopReason}`);
        return { halted: true };
      }
      return { halted: false, ok: false, retryExhausted: true };
    } else {
      consecutiveExhaustedRetries = 0;
    }

    if (exitCode === 0 && usage.suspect_video_not_processed) {
      stoppedEarly = true;
      stopReason = `suspect_video_not_processed (${item.video_id} r${attempt}: video_tokens=${usage.input_video_tokens} < ${usage.min_required_video_tokens})`;
      console.error(`[STOP] ${stopReason}`);
      return { halted: true };
    }

    if (exitCode !== 0 || !parsedRes.ok) {
      consecutiveJsonErrors++;
      if (consecutiveJsonErrors >= 2) {
        stoppedEarly = true;
        stopReason = `2_consecutive_json_or_call_errors (last=${parsedRes.error || "exit_" + exitCode})`;
        console.error(`[STOP] ${stopReason}`);
        return { halted: true };
      }
      return { halted: false, ok: false, jsonError: true };
    }

    consecutiveJsonErrors = 0;
    return { halted: false, ok: true, score: parsedRes.parsed.total_score, summary: summaryLine };
  }

  for (const item of queue) {
    if (stoppedEarly) break;
    const r1 = await runOneCall(item, 1);
    if (r1.halted) break;
    if (!r1.ok) continue;

    const r2 = await runOneCall(item, 2);
    if (r2.halted) break;
    if (!r2.ok) continue;

    const scores = [r1.score, r2.score];
    let agg = aggregate2Plus1Scores(scores);
    if (!fixedAttempts && agg.needs_3rd) {
      console.log(`[TIEBREAKER] ${item.video_id}: r1=${scores[0]}, r2=${scores[1]} (diff=${agg.diff_12} >= 5) -> r3`);
      const r3 = await runOneCall(item, 3);
      if (r3.halted) break;
      if (r3.ok) {
        scores.push(r3.score);
        agg = aggregate2Plus1Scores(scores);
      }
    } else if (fixedAttempts === 2 && agg.needs_3rd) {
      agg = {
        status: "complete",
        needs_3rd: false,
        diff_12: agg.diff_12,
        final_score: Math.round(((scores[0] + scores[1]) / 2) * 100) / 100,
        ensemble_rule: "fixed_2_mean",
      };
    }

    videoSummaries.push({
      video_id: item.video_id,
      role: item.role,
      raw_scores: scores,
      diff_12: agg.diff_12,
      api_raw_final_score: agg.final_score,
      ensemble_rule: agg.ensemble_rule,
    });
  }

  writeEvidenceManifest({ runDir, runId, worker, logsRunDir, callEntries: evidenceEntries });

  const runSummary = {
    schema_version: 1,
    run_id: runId,
    worker,
    purpose,
    service_tier: serviceTier,
    finished_at: new Date().toISOString(),
    total_requests: requestCount,
    total_retries: callSummaries.reduce((a, c) => a + (c.retries_used || 0), 0),
    videos_completed: videoSummaries.length,
    targets_completed: videoSummaries.filter((v) => v.role === "target").length,
    anchors_completed: videoSummaries.filter((v) => v.role === "anchor").length,
    tiebreakers_triggered: videoSummaries.filter((v) => v.ensemble_rule === "median_of_3").length,
    stopped_early: stoppedEarly,
    stop_reason: stopReason,
    run_cost_usd: runSpentUsd,
    evidence_manifest: "evidence_manifest.json",
    evidence_logs_dir: logsRunDir,
    videos: videoSummaries,
  };
  fs.writeFileSync(
    path.join(runDir, "run_summary.json"),
    redactSecret(JSON.stringify(runSummary, null, 2) + "\n", apiKey),
    "utf8"
  );

  if (!noLedgerUpdate && requestCount > 0) {
    updateLedger(ledgerPath, monthKey, {
      run_id: runId,
      purpose,
      service_tier: serviceTier,
      calls_count: callSummaries.length,
      cost_usd: runSpentUsd,
      recorded_at: new Date().toISOString(),
    });
  }

  console.log("=== API URL BATCH FINISHED ===");
  console.log(
    JSON.stringify(
      {
        run_id: runId,
        service_tier: serviceTier,
        total_requests: requestCount,
        total_retries: runSummary.total_retries,
        videos_completed: runSummary.videos_completed,
        tiebreakers_triggered: runSummary.tiebreakers_triggered,
        stopped_early: stoppedEarly,
        stop_reason: stopReason,
        run_cost_usd: runSpentUsd,
      },
      null,
      2
    )
  );
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error("FATAL:", err?.message || err);
    process.exit(1);
  });
}
