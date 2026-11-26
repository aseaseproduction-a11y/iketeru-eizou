#!/usr/bin/env node
/**
 * Production runner for Gemini API direct YouTube URL blind scoring (Flex tier by default).
 *
 * Design: docs/API_URL_SCORING_DESIGN.md (revised 2026-11-25 for deferred-queue 503/429 handling)
 * Strict guarantees:
 *  - Identical prompt, model (gemini-4-neon), thinking_level (high), and JSON schema to
 *    run_20261125_125425/run_config.json (asserted via prompt SHA-256).
 *  - Default service_tier="flex" (50% off Standard), 900s per-call timeout.
 *  - 503/429 deferred-queue policy:
 *      1) On 1st 503/429 in normal pass, wait 30-60s random then retry once.
 *         If 503/429 occurs twice in a row on a call, defer ONLY the failed call(s) to
 *         deferred_retry_queue.json and move on to the next video immediately.
 *      2) Never discard succeeded attempts (e.g., if r1 succeeds and r2 hits 503x2, keep r1 and defer only r2).
 *      3) If 3 consecutive videos are deferred due to 503/429, treat as global Flex congestion and stop run
 *         (preserving all succeeded results and deferred_retry_queue.json).
 *      4) After finishing one full pass over all videos, retry deferred_retry_queue items once each with
 *         60-120s (1-2 min) interval between calls. If any call still hits 503/429, stop run and save remaining queue.
 *      5) 402/403 always stop immediately with zero retries.
 *      6) Budget ledger records ONLY succeeded call costs; 503/429 failures record counts & timestamps only.
 *      7) --resume processes deferred_retry_queue.json FIRST before remaining normal-queue videos.
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
export const DEFAULT_TIMEOUT_MS = 900_000; // 15 minutes (unchanged)
export const DEFAULT_SLEEP_MS = 4000;

export const INITIAL_RETRY_MIN_SEC = 30;
export const INITIAL_RETRY_MAX_SEC = 60;
export const DEFERRED_PASS_MIN_SEC = 60;
export const DEFERRED_PASS_MAX_SEC = 120;
export const MAX_CONSECUTIVE_DEFERRED_VIDEOS = 3;

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
  return serviceTier === "flex"
    ? Math.round(stdEst * 0.5 * 1_000_000) / 1_000_000
    : Math.round(stdEst * 1_000_000) / 1_000_000;
}

export function checkBudgetGuard({
  monthlySpentUsd,
  monthlyLimitUsd = DEFAULT_MONTHLY_LIMIT_USD,
  runSpentUsd,
  runLimitUsd = DEFAULT_RUN_BUDGET_USD,
  estimatedNextCallUsd,
  maxObservedCallCostUsd = 0,
  observedSafetyMultiplier = 1.2,
  requestCount,
  maxRequests,
}) {
  if (requestCount >= maxRequests) {
    return { allowed: false, reason: `max_requests_${maxRequests}_reached` };
  }
  const estVal = Number(estimatedNextCallUsd || 0);
  const obsBufferedVal =
    Number(maxObservedCallCostUsd || 0) > 0
      ? Math.round(Number(maxObservedCallCostUsd) * Number(observedSafetyMultiplier || 1.2) * 1_000_000) / 1_000_000
      : 0;
  const effectiveNextCallUsd = Math.max(estVal, obsBufferedVal);
  if (monthlySpentUsd + effectiveNextCallUsd > monthlyLimitUsd) {
    return {
      allowed: false,
      reason: `monthly_budget_cap_exceeded (spent=${monthlySpentUsd.toFixed(4)}, next_guard=${effectiveNextCallUsd.toFixed(4)} [est=${estVal.toFixed(4)}, obs_max_x${observedSafetyMultiplier}=${obsBufferedVal.toFixed(4)}], limit=${monthlyLimitUsd.toFixed(2)})`,
    };
  }
  if (runSpentUsd + effectiveNextCallUsd > runLimitUsd) {
    return {
      allowed: false,
      reason: `run_budget_cap_exceeded (spent=${runSpentUsd.toFixed(4)}, next_guard=${effectiveNextCallUsd.toFixed(4)} [est=${estVal.toFixed(4)}, obs_max_x${observedSafetyMultiplier}=${obsBufferedVal.toFixed(4)}], limit=${runLimitUsd.toFixed(2)})`,
    };
  }
  return { allowed: true, reason: null, effective_next_call_usd: effectiveNextCallUsd };
}

export function determineRunExitCode(orch) {
  if (!orch || !orch.stopped_early) return 0;
  const reason = String(orch.stop_reason || "");
  if (/3_consecutive_(?:videos_)?deferred|deferred_retry_pass_congestion/i.test(reason)) return 3;
  if (/budget_cap_exceeded|max_requests_/i.test(reason)) return 4;
  return 1;
}

export function classifyApiError(exitCode, errText, respObj) {
  const hay = `${errText || ""} ${JSON.stringify(respObj?.error || "")} ${respObj?.status || ""}`;
  if (/\b402\b|PAYMENT_REQUIRED|insufficient.*balance|billing|spend(?:ing)?[\s_-]*cap/i.test(hay)) {
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
  if (
    exitCode !== 0 &&
    /\b400\b|\b404\b|INVALID_ARGUMENT|NOT_FOUND|unavailable|private|cannot.*(fetch|access|read)/i.test(hay)
  ) {
    return { kind: "video_unreadable", code: "400/404", retryable: false };
  }
  if (exitCode === 0 && respObj?.status === "completed") {
    return { kind: "ok", code: null, retryable: false };
  }
  return { kind: "other_error", code: String(exitCode), retryable: false };
}

export function randomBetweenSec(minSec, maxSec, rng = Math.random) {
  return minSec + Math.floor(rng() * (maxSec - minSec + 1));
}

/**
 * Normal-pass single call execution:
 * - On 1st 503/429: sleep 30-60s random, then retry once.
 * - On 2nd consecutive 503/429: immediately return deferred=true (no further wait).
 * - On 402/403: immediately return fatal_stop (0 retries).
 */
export async function executeWithRetry(
  invokeFn,
  {
    mode = "initial", // "initial" (1 retry after 30-60s, then defer) | "deferred_pass" (1 try only, fail stops run)
    sleepFn,
    rng = Math.random,
    nowFn = () => new Date().toISOString(),
  } = {}
) {
  const sleepImpl = sleepFn || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const retryHistory = [];
  const congestionEvents = [];
  const maxRetries = mode === "deferred_pass" ? 0 : 1;

  for (let tryIdx = 0; tryIdx <= maxRetries; tryIdx++) {
    const res = await invokeFn(tryIdx);
    const cls = classifyApiError(res.exitCode, `${res.stderr || ""} ${res.stdout || ""}`, res.respObj);
    if (cls.kind === "retryable_congestion") {
      const event = {
        timestamp: nowFn(),
        code: cls.code,
        try_index: tryIdx + 1,
        phase: mode === "deferred_pass" ? "deferred_pass" : tryIdx === 0 ? "initial_try1" : "initial_try2_deferred",
      };
      congestionEvents.push(event);

      if (tryIdx < maxRetries) {
        const delaySec = randomBetweenSec(INITIAL_RETRY_MIN_SEC, INITIAL_RETRY_MAX_SEC, rng);
        retryHistory.push({ retry: tryIdx + 1, code: cls.code, delay_sec: delaySec, timestamp: event.timestamp });
        await sleepImpl(delaySec * 1000);
        continue;
      }

      return {
        ...res,
        classification: { ...cls, deferred: true },
        retries_used: retryHistory.length,
        retry_history: retryHistory,
        congestion_events: congestionEvents,
      };
    }

    return {
      ...res,
      classification: { ...cls, deferred: false },
      retries_used: retryHistory.length,
      retry_history: retryHistory,
      congestion_events: congestionEvents,
    };
  }
}

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

/**
 * Pure, testable batch scheduler implementing all 8 Flex 503/429 deferred-queue rules:
 *  - When resuming with initialDeferredQueue non-empty, processes deferred queue FIRST.
 *  - Normal pass: for each video, runs missing attempts (r1, r2, and r3 if |r1-r2|>=5).
 *    If an attempt hits 503/429 twice -> preserves succeeded attempts, defers only failed/remaining attempts.
 *    If 3 consecutive videos are deferred -> stops immediately ("3_consecutive_videos_deferred_flex_congestion").
 *  - After normal pass completes, retries deferred queue once each with 60-120s wait between calls.
 *    If ANY call in deferred pass hits 503/429 -> stops immediately ("deferred_retry_pass_congestion"),
 *    keeping failed + remaining items in deferredQueue.
 *  - On 402/403 or fatal stop -> stops immediately.
 */
export async function runBatchOrchestrator({
  queue,
  initialCompletedScores = new Map(), // Map<video_id, Map<attempt, number>>
  initialDeferredQueue = [], // [{ video_id, role, ref_duration_sec, attempt }]
  fixedAttempts = null,
  runAttemptFn, // async ({ item, attempt, phase }) => { status: "ok"|"deferred"|"fatal_stop"|"error"|"budget_stop", score?, stopReason?, congestionEvents? }
  sleepFn = async () => {},
  rng = Math.random,
  maxConsecutiveDeferredVideos = MAX_CONSECUTIVE_DEFERRED_VIDEOS,
}) {
  const scoresByVid = new Map();
  for (const [vid, m] of initialCompletedScores.entries()) {
    scoresByVid.set(vid, new Map(m));
  }
  const itemById = new Map(queue.map((q) => [q.video_id, q]));
  const getScoresMap = (vid) => {
    if (!scoresByVid.has(vid)) scoresByVid.set(vid, new Map());
    return scoresByVid.get(vid);
  };

  let stoppedEarly = false;
  let stopReason = null;
  const executionOrder = [];
  const allCongestionEvents = [];
  let deferredQueue = [];
  const deferredKeys = new Set();

  function enqueueDeferred(entry) {
    const key = `${entry.video_id}::${entry.attempt}`;
    if (deferredKeys.has(key)) return;
    deferredKeys.add(key);
    deferredQueue.push({
      video_id: entry.video_id,
      role: entry.role,
      ref_duration_sec: entry.ref_duration_sec ?? null,
      attempt: entry.attempt,
    });
  }

  async function processDeferredPass(entries, phaseLabel) {
    const remaining = [];
    let executedInPass = 0;
    for (let idx = 0; idx < entries.length; idx++) {
      const entry = entries[idx];
      const sm = getScoresMap(entry.video_id);
      if (sm.has(entry.attempt)) continue;

      if (executedInPass > 0) {
        const waitSec = randomBetweenSec(DEFERRED_PASS_MIN_SEC, DEFERRED_PASS_MAX_SEC, rng);
        await sleepFn(waitSec * 1000);
      }
      executedInPass++;

      const item = itemById.get(entry.video_id) || {
        video_id: entry.video_id,
        role: entry.role || "target",
        ref_duration_sec: entry.ref_duration_sec ?? null,
      };
      executionOrder.push({ phase: phaseLabel, video_id: entry.video_id, attempt: entry.attempt });
      const res = await runAttemptFn({ item, attempt: entry.attempt, phase: "deferred_pass" });
      if (res.congestionEvents) allCongestionEvents.push(...res.congestionEvents);

      if (res.status === "ok") {
        sm.set(entry.attempt, res.score);
        // If r1 & r2 now complete and |r1-r2|>=5 (and not fixedAttempts), also queue/run r3 in this pass
        if (!fixedAttempts && sm.has(1) && sm.has(2) && !sm.has(3)) {
          const agg = aggregate2Plus1Scores([sm.get(1), sm.get(2)]);
          if (agg.needs_3rd) {
            entries.splice(idx + 1, 0, {
              video_id: entry.video_id,
              role: item.role,
              ref_duration_sec: item.ref_duration_sec,
              attempt: 3,
            });
          }
        }
        continue;
      }

      // 503/429 in deferred pass OR fatal/budget stop -> preserve this and all remaining items and STOP run
      remaining.push(entry, ...entries.slice(idx + 1));
      stoppedEarly = true;
      stopReason =
        res.status === "deferred"
          ? `deferred_retry_pass_congestion (${entry.video_id} r${entry.attempt})`
          : res.stopReason || `${phaseLabel}_${res.status}`;
      return remaining;
    }
    return remaining;
  }

  // Phase 0 (when --resume has leftover deferred queue): process deferred queue FIRST
  if (initialDeferredQueue.length > 0) {
    const leftover = await processDeferredPass([...initialDeferredQueue], "resume_deferred_first");
    if (stoppedEarly) {
      deferredQueue = leftover;
      return buildResult();
    }
  }

  // Phase 1: Normal pass over all videos in queue
  let consecutiveDeferredVideos = 0;

  for (const item of queue) {
    if (stoppedEarly) break;
    const sm = getScoresMap(item.video_id);
    let videoDeferredThisPass = false;

    // Attempt 1
    if (!sm.has(1)) {
      executionOrder.push({ phase: "initial", video_id: item.video_id, attempt: 1 });
      const r1 = await runAttemptFn({ item, attempt: 1, phase: "initial" });
      if (r1.congestionEvents) allCongestionEvents.push(...r1.congestionEvents);
      if (r1.status === "ok") {
        sm.set(1, r1.score);
      } else if (r1.status === "deferred") {
        videoDeferredThisPass = true;
        enqueueDeferred({ ...item, attempt: 1 });
        if (!sm.has(2)) enqueueDeferred({ ...item, attempt: 2 });
      } else if (r1.status === "fatal_stop" || r1.status === "budget_stop") {
        stoppedEarly = true;
        stopReason = r1.stopReason || r1.status;
        break;
      } else {
        continue;
      }
    }

    // Attempt 2 (only if attempt 1 succeeded and not already done)
    if (!videoDeferredThisPass && !sm.has(2)) {
      executionOrder.push({ phase: "initial", video_id: item.video_id, attempt: 2 });
      const r2 = await runAttemptFn({ item, attempt: 2, phase: "initial" });
      if (r2.congestionEvents) allCongestionEvents.push(...r2.congestionEvents);
      if (r2.status === "ok") {
        sm.set(2, r2.score);
      } else if (r2.status === "deferred") {
        videoDeferredThisPass = true;
        // Preserve succeeded r1! Only defer failed r2.
        enqueueDeferred({ ...item, attempt: 2 });
      } else if (r2.status === "fatal_stop" || r2.status === "budget_stop") {
        stoppedEarly = true;
        stopReason = r2.stopReason || r2.status;
        break;
      } else {
        continue;
      }
    }

    // Attempt 3 tiebreaker (if r1 & r2 succeeded and |r1-r2|>=5 and not fixedAttempts)
    if (!videoDeferredThisPass && !fixedAttempts && sm.has(1) && sm.has(2) && !sm.has(3)) {
      const agg = aggregate2Plus1Scores([sm.get(1), sm.get(2)]);
      if (agg.needs_3rd) {
        executionOrder.push({ phase: "initial", video_id: item.video_id, attempt: 3 });
        const r3 = await runAttemptFn({ item, attempt: 3, phase: "initial" });
        if (r3.congestionEvents) allCongestionEvents.push(...r3.congestionEvents);
        if (r3.status === "ok") {
          sm.set(3, r3.score);
        } else if (r3.status === "deferred") {
          videoDeferredThisPass = true;
          enqueueDeferred({ ...item, attempt: 3 });
        } else if (r3.status === "fatal_stop" || r3.status === "budget_stop") {
          stoppedEarly = true;
          stopReason = r3.stopReason || r3.status;
          break;
        }
      }
    }

    if (videoDeferredThisPass) {
      consecutiveDeferredVideos++;
      if (consecutiveDeferredVideos >= maxConsecutiveDeferredVideos) {
        stoppedEarly = true;
        stopReason = `${maxConsecutiveDeferredVideos}_consecutive_videos_deferred_flex_congestion`;
        break;
      }
    } else {
      consecutiveDeferredVideos = 0;
    }
  }

  // Phase 2: After full pass over all videos, retry deferred queue once each (60-120s interval)
  if (!stoppedEarly && deferredQueue.length > 0) {
    const remaining = await processDeferredPass([...deferredQueue], "post_pass_deferred");
    deferredQueue = remaining;
  }

  return buildResult();

  function buildResult() {
    const videos = [];
    for (const item of queue) {
      const sm = getScoresMap(item.video_id);
      const rawScores = [1, 2, 3].filter((a) => sm.has(a)).map((a) => sm.get(a));
      let agg = aggregate2Plus1Scores(rawScores);
      if (fixedAttempts === 2 && rawScores.length === 2 && agg.needs_3rd) {
        agg = {
          status: "complete",
          needs_3rd: false,
          diff_12: agg.diff_12,
          final_score: Math.round(((rawScores[0] + rawScores[1]) / 2) * 100) / 100,
          ensemble_rule: "fixed_2_mean",
        };
      }
      videos.push({
        video_id: item.video_id,
        role: item.role,
        attempts_completed: [1, 2, 3].filter((a) => sm.has(a)),
        raw_scores: rawScores,
        diff_12: agg.diff_12 ?? null,
        api_raw_final_score: agg.final_score,
        ensemble_rule: agg.ensemble_rule,
        complete: agg.status === "complete",
      });
    }
    return {
      stopped_early: stoppedEarly,
      stop_reason: stopReason,
      deferred_queue: deferredQueue,
      congestion_events: allCongestionEvents,
      execution_order: executionOrder,
      videos,
    };
  }
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

  // Reference durations come from SQLite scenes MAX(end_sec), which can overestimate actual YouTube
  // runtime by ~10-15% (e.g., fvbEnWLRo1s: 47,154 video tokens vs 524s scenes = 89.99 tok/s),
  // and short idents (<10s, e.g. 6sX_BfDnyrg 5s = 515 video tokens = 103 tok/s) legitimately have <1000 tokens.
  // Require >= max(200, floor(durationSec * 80)) when duration is known (1000 when unknown).
  const minRequired =
    typeof durationSec === "number" && Number.isFinite(durationSec) && durationSec > 0
      ? Math.max(200, Math.floor(durationSec * 80))
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
      if (!next || next.startsWith("--")) args[k] = true;
      else {
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

/**
 * Rule 7: Ledger records ONLY succeeded call costs; 503/429 failures record count & timestamps only.
 */
export function updateLedger(ledgerPath, monthKey, runEntry) {
  const ledger = loadLedger(ledgerPath);
  if (!ledger.monthly_totals[monthKey]) {
    ledger.monthly_totals[monthKey] = {
      limit_usd: ledger.default_monthly_limit_usd ?? DEFAULT_MONTHLY_LIMIT_USD,
      spent_usd: 0,
      calls_count: 0,
      congestion_failure_count: 0,
      runs: [],
    };
  }
  const m = ledger.monthly_totals[monthKey];
  const existingIdx = m.runs.findIndex((r) => r.run_id === runEntry.run_id);
  if (existingIdx >= 0) m.runs[existingIdx] = runEntry;
  else m.runs.push(runEntry);

  m.spent_usd = Math.round(m.runs.reduce((a, r) => a + (r.cost_usd || 0), 0) * 1_000_000) / 1_000_000;
  m.calls_count = m.runs.reduce((a, r) => a + (r.calls_count || 0), 0);
  m.congestion_failure_count = m.runs.reduce((a, r) => a + (r.congestion_failure_count || 0), 0);
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
  fs.writeFileSync(path.join(runDir, "evidence_manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return manifest;
}

function saveDeferredQueue(runDir, runId, deferredQueue, congestionEvents) {
  const out = {
    schema_version: 1,
    run_id: runId,
    updated_at: new Date().toISOString(),
    remaining_count: deferredQueue.length,
    deferred_calls: deferredQueue,
    congestion_events_count: congestionEvents.length,
    congestion_events: congestionEvents,
  };
  fs.writeFileSync(path.join(runDir, "deferred_retry_queue.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
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
  const bodyJson = JSON.stringify({
    generation_config: { thinking_level: thinkingLevel },
    service_tier: serviceTier,
    store: false,
  });

  const loadIds = (p) => {
    if (!p) return [];
    const doc = JSON.parse(fs.readFileSync(p, "utf8"));
    if (Array.isArray(doc)) return doc.map(String);
    return (doc.video_ids || doc.run1_anchor_18_ids || doc.ids || []).map(String);
  };
  const targetIds = loadIds(idListPath);
  const anchorIds = loadIds(anchorListPath);
  const anchorSet = new Set(anchorIds);

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

  const cliExe = resolveCliPath();
  const cliVersion = execFileSync(cliExe, ["--version"], { encoding: "utf8" }).trim();

  if (dryRun) {
    const estTotalCostUsd =
      Math.round(
        queue.reduce((a, q) => a + estimateCallCostUsd(q.ref_duration_sec, serviceTier) * (fixedAttempts || 2.05), 0) *
          10000
      ) / 10000;
    const sampleUrl = queue[0]?.youtube_url || "https://www.youtube.com/watch?v=HRJr0tAASjI";
    const dryOut = execFileSync(
      cliExe,
      ["generate", promptText, "-m", model, "-i", sampleUrl, "--stream=false", "--body", bodyJson, "--dry-run", "-o", "json"],
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
    schema_version: 2,
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
    congestion_policy: {
      initial_retry_wait_sec: [INITIAL_RETRY_MIN_SEC, INITIAL_RETRY_MAX_SEC],
      defer_after_consecutive_503_429: 2,
      stop_after_consecutive_deferred_videos: MAX_CONSECUTIVE_DEFERRED_VIDEOS,
      deferred_pass_interval_sec: [DEFERRED_PASS_MIN_SEC, DEFERRED_PASS_MAX_SEC],
      deferred_pass_tries: 1,
      resume_prioritizes_deferred_queue: true,
    },
    ensemble_rule: fixedAttempts
      ? `fixed_${fixedAttempts}_calls`
      : "2+1 (3rd call if |r1 - r2| >= 5, median of 3 else mean of 2)",
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

  // Resume state loading
  const logPath = path.join(runDir, "calls_log.jsonl");
  const deferredPath = path.join(runDir, "deferred_retry_queue.json");
  const initialCompletedScores = new Map();
  let initialDeferredQueue = [];
  const callSummaries = [];
  const evidenceEntries = [];
  let requestCount = 0;
  let succeededCallsCount = 0;
  let runSpentUsd = 0;
  let maxObservedCallCostUsd = 0;

  const tierScaleForResume = (fromTier, toTier) => {
    const f = PRICING_USD_PER_1M[fromTier]?.output_and_thought;
    const t = PRICING_USD_PER_1M[toTier]?.output_and_thought;
    if (!f || !t) return 1;
    return t / f;
  };

  if (resume && fs.existsSync(logPath)) {
    for (const line of fs.readFileSync(logPath, "utf8").split(/\r?\n/).filter(Boolean)) {
      const rec = JSON.parse(line);
      callSummaries.push(rec);
      requestCount = Math.max(requestCount, rec.call_index || 0);
      if (rec.parse_ok && rec.exit_code === 0 && !rec.suspect_video_not_processed) {
        succeededCallsCount++;
        const cUsd = Number(rec.call_cost_usd || 0);
        runSpentUsd = Math.round((runSpentUsd + cUsd) * 1_000_000) / 1_000_000;
        const scaled = Math.round(cUsd * tierScaleForResume(rec.service_tier || serviceTier, serviceTier) * 1_000_000) / 1_000_000;
        if (scaled > maxObservedCallCostUsd) maxObservedCallCostUsd = scaled;
        if (!initialCompletedScores.has(rec.video_id)) initialCompletedScores.set(rec.video_id, new Map());
        initialCompletedScores.get(rec.video_id).set(rec.attempt, rec.api_score);
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
  }
  let initialCongestionEvents = [];
  if (resume && fs.existsSync(deferredPath)) {
    const dqDoc = JSON.parse(fs.readFileSync(deferredPath, "utf8"));
    initialDeferredQueue = Array.isArray(dqDoc.deferred_calls) ? dqDoc.deferred_calls : [];
    initialCongestionEvents = Array.isArray(dqDoc.congestion_events) ? dqDoc.congestion_events : [];
  }

  let consecutiveJsonErrors = 0;
  const allCongestionEvents = [...initialCongestionEvents];

  const orch = await runBatchOrchestrator({
    queue,
    initialCompletedScores,
    initialDeferredQueue,
    fixedAttempts,
    sleepFn: (ms) => new Promise((r) => setTimeout(r, ms)),
    runAttemptFn: async ({ item, attempt, phase }) => {
      const estNext = estimateCallCostUsd(item.ref_duration_sec, serviceTier);
      const guard = checkBudgetGuard({
        monthlySpentUsd: baseMonthlySpentUsd + runSpentUsd,
        monthlyLimitUsd,
        runSpentUsd,
        runLimitUsd: runBudgetUsd,
        estimatedNextCallUsd: estNext,
        maxObservedCallCostUsd,
        observedSafetyMultiplier: 1.2,
        requestCount,
        maxRequests,
      });
      if (!guard.allowed) {
        console.error(`[STOP] ${guard.reason}`);
        return { status: "budget_stop", stopReason: guard.reason };
      }

      if (requestCount > 0 && phase === "initial") {
        await new Promise((r) => setTimeout(r, DEFAULT_SLEEP_MS));
      }

      requestCount++;
      const callIdxStr = String(requestCount).padStart(3, "0");
      const startedAt = new Date().toISOString();
      const t0 = Date.now();

      const execResult = await executeWithRetry(
        async () => {
          let stdoutStr = "";
          let stderrStr = "";
          let exitCode = 0;
          try {
            stdoutStr = execFileSync(
              cliExe,
              ["generate", promptText, "-m", model, "-i", item.youtube_url, "--stream=false", "--body", bodyJson, "-o", "json"],
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
          return { exitCode, stdout: safeStdout, stderr: safeStderr, respObj };
        },
        { mode: phase === "deferred_pass" ? "deferred_pass" : "initial" }
      );

      const elapsedSec = Math.round(((Date.now() - t0) / 1000) * 100) / 100;
      const finishedAt = new Date().toISOString();
      const { exitCode, stdout: safeStdout, stderr: safeStderr, respObj, classification, retries_used, retry_history, congestion_events } = execResult;

      const taggedCongestion = (congestion_events || []).map((e) => ({
        ...e,
        video_id: item.video_id,
        attempt,
      }));
      allCongestionEvents.push(...taggedCongestion);

      const usage = extractUsageBreakdown(respObj, item.ref_duration_sec);
      const modelText = extractModelText(respObj);
      const parsedRes = parseAndValidateScoreJson(modelText);

      // Rule 7: Only succeeded calls count toward cost ledger
      const callSucceeded = exitCode === 0 && parsedRes.ok && !usage.suspect_video_not_processed;
      const cost = callSucceeded ? calcCallCostUsd(usage, serviceTier) : { input_cost_usd: 0, output_thought_cost_usd: 0, call_cost_usd: 0 };
      if (callSucceeded) {
        succeededCallsCount++;
        runSpentUsd = Math.round((runSpentUsd + cost.call_cost_usd) * 1_000_000) / 1_000_000;
        if (cost.call_cost_usd > maxObservedCallCostUsd) {
          maxObservedCallCostUsd = cost.call_cost_usd;
        }
      }

      const callFileName = `${callIdxStr}_${item.video_id}_r${attempt}.json`;
      const callFilePath = path.join(callsDir, callFileName);
      const callRecord = {
        call_index: requestCount,
        run_id: runId,
        worker,
        phase,
        video_id: item.video_id,
        role: item.role,
        ref_duration_sec: item.ref_duration_sec,
        attempt,
        started_at: startedAt,
        finished_at: finishedAt,
        elapsed_sec: elapsedSec,
        retries_used,
        retry_history,
        congestion_events: taggedCongestion,
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
      if (callSucceeded) {
        evidenceEntries.push({
          rel_path: `calls/${callFileName}`,
          abs_path: callFilePath,
          video_id: item.video_id,
          attempt,
          call_index: requestCount,
          size_bytes: callBytes,
          sha256: callSha,
        });
      }

      const summaryLine = {
        call_index: requestCount,
        phase,
        video_id: item.video_id,
        role: item.role,
        attempt,
        service_tier: serviceTier,
        api_score: parsedRes.ok ? parsedRes.parsed.total_score : null,
        api_rank: parsedRes.ok ? parsedRes.parsed.rank : null,
        api_knows_work: parsedRes.ok ? parsedRes.parsed.post_check.knows_work : null,
        elapsed_sec: elapsedSec,
        retries_used,
        congestion_count: taggedCongestion.length,
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
        deferred: Boolean(classification.deferred),
        evidence_file: callFilePath,
        evidence_sha256: callSha,
      };
      callSummaries.push(summaryLine);
      fs.appendFileSync(logPath, redactSecret(JSON.stringify(summaryLine) + "\n", apiKey), "utf8");
      writeEvidenceManifest({ runDir, runId, worker, logsRunDir, callEntries: evidenceEntries });
      console.log(
        `[${callIdxStr}] ${phase} ${item.video_id} (${item.role}) r${attempt} tier=${serviceTier} -> kind=${classification.kind} deferred=${Boolean(classification.deferred)} parse_ok=${parsedRes.ok} score=${summaryLine.api_score ?? "-"} vid_tok=${usage.input_video_tokens} cost=$${cost.call_cost_usd.toFixed(4)} cum=$${runSpentUsd.toFixed(4)} elapsed=${elapsedSec}s 503/429=${taggedCongestion.length}`
      );

      if (classification.kind === "fatal_stop") {
        return { status: "fatal_stop", stopReason: `fatal_http_${classification.code}`, congestionEvents: taggedCongestion };
      }
      if (classification.deferred) {
        return { status: "deferred", congestionEvents: taggedCongestion };
      }
      if (exitCode === 0 && usage.suspect_video_not_processed) {
        return {
          status: "fatal_stop",
          stopReason: `suspect_video_not_processed (${item.video_id} r${attempt}: video_tokens=${usage.input_video_tokens} < ${usage.min_required_video_tokens})`,
          congestionEvents: taggedCongestion,
        };
      }
      if (exitCode !== 0 || !parsedRes.ok) {
        consecutiveJsonErrors++;
        if (consecutiveJsonErrors >= 2) {
          return {
            status: "fatal_stop",
            stopReason: `2_consecutive_json_or_call_errors (last=${parsedRes.error || "exit_" + exitCode})`,
            congestionEvents: taggedCongestion,
          };
        }
        return { status: "error", congestionEvents: taggedCongestion };
      }

      consecutiveJsonErrors = 0;
      return { status: "ok", score: parsedRes.parsed.total_score, congestionEvents: taggedCongestion };
    },
  });

  saveDeferredQueue(runDir, runId, orch.deferred_queue, allCongestionEvents);
  writeEvidenceManifest({ runDir, runId, worker, logsRunDir, callEntries: evidenceEntries });

  const costByServiceTier = {};
  const callsByServiceTier = {};
  for (const s of callSummaries) {
    if (s.parse_ok && s.exit_code === 0 && !s.suspect_video_not_processed) {
      const t = s.service_tier || serviceTier;
      callsByServiceTier[t] = (callsByServiceTier[t] || 0) + 1;
      costByServiceTier[t] = Math.round(((costByServiceTier[t] || 0) + Number(s.call_cost_usd || 0)) * 1_000_000) / 1_000_000;
    }
  }

  const runSummary = {
    schema_version: 2,
    run_id: runId,
    worker,
    purpose,
    service_tier: serviceTier,
    calls_by_service_tier: callsByServiceTier,
    cost_by_service_tier: costByServiceTier,
    finished_at: new Date().toISOString(),
    total_requests: requestCount,
    succeeded_calls: succeededCallsCount,
    congestion_failure_count: allCongestionEvents.length,
    congestion_events: allCongestionEvents,
    deferred_remaining_count: orch.deferred_queue.length,
    videos_completed: orch.videos.filter((v) => v.complete).length,
    targets_completed: orch.videos.filter((v) => v.complete && v.role === "target").length,
    anchors_completed: orch.videos.filter((v) => v.complete && v.role === "anchor").length,
    tiebreakers_triggered: orch.videos.filter((v) => v.ensemble_rule === "median_of_3").length,
    stopped_early: orch.stopped_early,
    stop_reason: orch.stop_reason,
    max_observed_call_cost_usd: maxObservedCallCostUsd,
    run_cost_usd: runSpentUsd,
    evidence_manifest: "evidence_manifest.json",
    deferred_queue_file: "deferred_retry_queue.json",
    evidence_logs_dir: logsRunDir,
    videos: orch.videos,
  };
  fs.writeFileSync(
    path.join(runDir, "run_summary.json"),
    redactSecret(JSON.stringify(runSummary, null, 2) + "\n", apiKey),
    "utf8"
  );

  if (!noLedgerUpdate && (succeededCallsCount > 0 || allCongestionEvents.length > 0)) {
    updateLedger(ledgerPath, monthKey, {
      run_id: runId,
      purpose,
      service_tier: Object.keys(callsByServiceTier).length > 1 ? "mixed_flex_standard" : serviceTier,
      calls_by_service_tier: callsByServiceTier,
      cost_by_service_tier: costByServiceTier,
      calls_count: succeededCallsCount,
      cost_usd: runSpentUsd,
      congestion_failure_count: allCongestionEvents.length,
      congestion_timestamps: allCongestionEvents.map((e) => e.timestamp),
      recorded_at: new Date().toISOString(),
    });
  }

  const exitCode = determineRunExitCode(orch);
  console.log("=== API URL BATCH FINISHED ===");
  console.log(
    JSON.stringify(
      {
        run_id: runId,
        service_tier: serviceTier,
        calls_by_service_tier: callsByServiceTier,
        cost_by_service_tier: costByServiceTier,
        succeeded_calls: succeededCallsCount,
        congestion_failure_count: allCongestionEvents.length,
        deferred_remaining_count: orch.deferred_queue.length,
        videos_completed: runSummary.videos_completed,
        stopped_early: orch.stopped_early,
        stop_reason: orch.stop_reason,
        exit_code: exitCode,
        run_cost_usd: runSpentUsd,
      },
      null,
      2
    )
  );
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error("FATAL:", err?.message || err);
    process.exit(1);
  });
}
