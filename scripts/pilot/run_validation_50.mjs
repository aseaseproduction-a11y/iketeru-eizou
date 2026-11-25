#!/usr/bin/env node
/**
 * 50-video bias-correction validation runner (fit=25, validation=25)
 * using Gemini API direct YouTube URL scoring via gemini-api CLI v0.5.0+.
 *
 * Guarantees:
 *  - Identical model, thinking_level, prompt, and JSON schema to run_20261125_125425/run_config.json (asserted via SHA-256).
 *  - Verifies & records SHA-256 of analysis/pilot_gemini_api_url/validation_preregistration.json (never modifies it).
 *  - Standard tier only (NO Batch / Flex calls).
 *  - 2+1 ensemble rule: 2 independent calls per video; if |r1 - r2| >= 5, run 3rd independent call and take median.
 *  - Reserve substitution if a specific video URL is unreadable on Gemini side (non-402/403/429 error).
 *  - Hard stops:
 *      1) Projected cumulative cost after next call > $13.00 USD (or current > $13.00) -> stop before next call
 *      2) Total requests (including retries) >= 130
 *      3) HTTP/API error 402, 403, or 429
 *      4) 2 consecutive malformed/invalid JSON outputs
 *      5) input_video_tokens < 1000 on a completed call (suspect video not processed)
 *  - NEVER writes to TiDB, SQLite, production runs, E:\iketeru_blind_eval\, analysis/claims/, or frozen 13 files.
 *  - NEVER accesses YouTube directly from this PC.
 *  - NEVER prints, logs, or saves GEMINI_API_KEY anywhere.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const require = createRequire(path.join(REPO_ROOT, "package.json"));
const dotenv = require("dotenv");

const PREV_RUN_CONFIG_PATH = path.join(
  REPO_ROOT,
  "analysis",
  "pilot_gemini_api_url",
  "run_20261125_125425",
  "run_config.json"
);
const PREREG_PATH = path.join(
  REPO_ROOT,
  "analysis",
  "pilot_gemini_api_url",
  "validation_preregistration.json"
);

const INPUT_USD_PER_M = 3.0;
const OUTPUT_THOUGHT_USD_PER_M = 15.0;
const STOP_COST_USD = 13.0;
const MAX_REQUESTS = 130;
const SLEEP_BETWEEN_CALLS_MS = 3000;
const CALL_TIMEOUT_MS = 360_000;

// Conservative per-call cost predictor from 10-video pilot for pre-call $13 guard
function estimateNextCallCostUsd(durationSec) {
  return 0.0473 + 0.0003135 * (durationSec || 180);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256Buffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function redactSecret(text, secret) {
  if (!text) return "";
  let out = String(text);
  if (secret && secret.length >= 6) {
    out = out.split(secret).join("[REDACTED_API_KEY]");
  }
  out = out.replace(/AIza[0-9A-Za-z\-_]{20,}/g, "[REDACTED_API_KEY]");
  return out;
}

function extractModelText(resp) {
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

function extractUsageBreakdown(resp) {
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
  const totalOutput = Number(
    u.total_output_tokens ?? u.candidatesTokenCount ?? u.candidates_token_count ?? 0
  );
  const totalThought = Number(
    u.total_thought_tokens ?? u.thoughtsTokenCount ?? u.thoughts_token_count ?? 0
  );
  const totalTokens = Number(
    u.total_tokens ?? u.totalTokenCount ?? u.total_token_count ?? (totalInput + totalOutput + totalThought)
  );

  const videoTok = inputVideo ?? 0;

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
    suspect_video_not_processed: videoTok < 1000,
  };
}

function calcCostUsd(usage) {
  const inputCost = (usage.total_input_tokens / 1_000_000) * INPUT_USD_PER_M;
  const outputThoughtCost =
    ((usage.total_output_tokens + usage.total_thought_tokens) / 1_000_000) *
    OUTPUT_THOUGHT_USD_PER_M;
  return {
    input_cost_usd: Math.round(inputCost * 1_000_000) / 1_000_000,
    output_thought_cost_usd: Math.round(outputThoughtCost * 1_000_000) / 1_000_000,
    call_cost_usd: Math.round((inputCost + outputThoughtCost) * 1_000_000) / 1_000_000,
  };
}

function parseAndValidateScoreJson(rawText) {
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
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 20) {
      return { ok: false, error: `invalid_dimension_${d}`, parsed: obj };
    }
    sum += v;
  }
  if (typeof obj.total_score !== "number" || !Number.isFinite(obj.total_score) || obj.total_score < 0 || obj.total_score > 100) {
    return { ok: false, error: "invalid_total_score", parsed: obj };
  }
  if (typeof obj.rank !== "string" || !obj.rank.trim()) {
    return { ok: false, error: "missing_rank", parsed: obj };
  }
  if (!obj.post_check || typeof obj.post_check.knows_work !== "boolean") {
    return { ok: false, error: "missing_post_check_knows_work", parsed: obj };
  }
  if (!Array.isArray(obj.timestamped_observations) || obj.timestamped_observations.length < 3) {
    return { ok: false, error: "missing_3_timestamped_observations", parsed: obj };
  }

  const sumMismatch = Math.round(sum) !== Math.round(obj.total_score);
  return { ok: true, error: null, sum_mismatch: sumMismatch, scores_sum: sum, parsed: obj };
}

function detectFatalHttpStop(errText, respObj) {
  const hay = `${errText || ""} ${JSON.stringify(respObj?.error || "")} ${respObj?.status || ""}`;
  if (/\b402\b|PAYMENT_REQUIRED|insufficient.*balance|billing/i.test(hay)) return "402";
  if (/\b403\b|PERMISSION_DENIED|FORBIDDEN/i.test(hay)) return "403";
  if (/\b429\b|RESOURCE_EXHAUSTED|RATE_LIMIT|TOO_MANY_REQUESTS/i.test(hay)) return "429";
  return null;
}

function isVideoUnreadableError(exitCode, errText, respObj) {
  if (exitCode === 0 && respObj?.status === "completed") return false;
  const hay = `${errText || ""} ${JSON.stringify(respObj?.error || "")}`;
  // Detect per-video fetch/availability failure (400/404/INVALID_ARGUMENT/NOT_FOUND/unavailable/private/cannot fetch)
  return /\b400\b|\b404\b|INVALID_ARGUMENT|NOT_FOUND|unavailable|private|cannot.*(fetch|access|read|download|process)|failed.*video|youtube/i.test(
    hay
  );
}

function pickBestReserve(failedVideo, availableReserves) {
  if (!availableReserves.length) return null;
  let bestIdx = 0;
  let bestScore = -1e9;
  for (let i = 0; i < availableReserves.length; i++) {
    const r = availableReserves[i];
    let s = 0;
    if (r.band === failedVideo.band) s += 100;
    if (r.duration_bin === failedVideo.duration_bin) s += 50;
    if (r.route_raw === failedVideo.route_raw) s += 20;
    if (r.near_63_pm3 === failedVideo.near_63_pm3 && failedVideo.near_63_pm3) s += 40;
    if (r.near_83_pm3 === failedVideo.near_83_pm3 && failedVideo.near_83_pm3) s += 40;
    s -= Math.abs(r.calibrated_score - failedVideo.calibrated_score);
    if (s > bestScore) {
      bestScore = s;
      bestIdx = i;
    }
  }
  const [chosen] = availableReserves.splice(bestIdx, 1);
  return chosen;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  dotenv.config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!dryRun && !apiKey) {
    throw new Error("GEMINI_API_KEY is missing in E:\\iketeru-eizou\\.env");
  }

  // Load previous run_config.json and assert exact identity
  const prevCfg = JSON.parse(fs.readFileSync(PREV_RUN_CONFIG_PATH, "utf8"));
  const promptText = prevCfg.prompt_text;
  const promptSha256 = crypto.createHash("sha256").update(promptText, "utf8").digest("hex");
  if (promptSha256 !== prevCfg.prompt_sha256) {
    throw new Error(`Prompt SHA-256 mismatch vs run_20261125_125425: ${promptSha256} !== ${prevCfg.prompt_sha256}`);
  }

  const MODEL = prevCfg.model;
  const THINKING_LEVEL = prevCfg.thinking_level;
  const bodyObj = {
    generation_config: { thinking_level: THINKING_LEVEL },
    store: false,
  };
  const bodyJson = JSON.stringify(bodyObj);

  // Load preregistration & compute exact file SHA-256 (read-only)
  const preregBuf = fs.readFileSync(PREREG_PATH);
  const preregSha256 = sha256Buffer(preregBuf);
  const prereg = JSON.parse(preregBuf.toString("utf8"));

  const cliExe = resolveCliPath();
  const cliVersion = execFileSync(cliExe, ["--version"], { encoding: "utf8" }).trim();

  if (dryRun) {
    const sample = prereg.main_50[0];
    const out = execFileSync(
      cliExe,
      [
        "generate",
        promptText,
        "-m",
        MODEL,
        "-i",
        sample.youtube_url,
        "--stream=false",
        "--body",
        bodyJson,
        "--dry-run",
        "-o",
        "json",
      ],
      { encoding: "utf8" }
    );
    console.log("CLI VERSION:", cliVersion);
    console.log("PREREG SHA256:", preregSha256);
    console.log("PROMPT SHA256 (exact match run_20261125_125425):", promptSha256);
    console.log("MODEL:", MODEL, "THINKING_LEVEL:", THINKING_LEVEL);
    console.log("MAIN VIDEOS:", prereg.main_50.length, "RESERVE:", prereg.reserve_8.length);
    console.log("DRY-RUN REQUEST:", redactSecret(out.trim(), apiKey));
    return;
  }

  const runStamp = localTimestampStamp();
  const runDir = path.join(REPO_ROOT, "analysis", "pilot_gemini_api_url", `run_${runStamp}`);
  const callsDir = path.join(runDir, "calls");
  fs.mkdirSync(callsDir, { recursive: true });

  const runConfig = {
    run_id: `run_${runStamp}`,
    started_at: new Date().toISOString(),
    preregistration_path: "analysis/pilot_gemini_api_url/validation_preregistration.json",
    preregistration_sha256: preregSha256,
    identical_config_source: "analysis/pilot_gemini_api_url/run_20261125_125425/run_config.json",
    cli_version: cliVersion,
    model: MODEL,
    thinking_level: THINKING_LEVEL,
    store: false,
    stream: false,
    service_tier: "standard",
    ensemble_rule: "2+1 (3rd call if |r1 - r2| >= 5, median of 3 else mean of 2)",
    sleep_between_calls_ms: SLEEP_BETWEEN_CALLS_MS,
    pricing_usd_per_1m: {
      input: INPUT_USD_PER_M,
      output_and_thought: OUTPUT_THOUGHT_USD_PER_M,
    },
    stop_conditions: {
      budget_max_usd: 15.0,
      stop_cost_usd: STOP_COST_USD,
      max_requests: MAX_REQUESTS,
      stop_http_codes: [402, 403, 429],
      max_consecutive_json_errors: 2,
      stop_on_video_tokens_lt_1000: true,
    },
    prompt_sha256: promptSha256,
    prompt_text: promptText,
  };
  fs.writeFileSync(
    path.join(runDir, "run_config.json"),
    redactSecret(JSON.stringify(runConfig, null, 2) + "\n", apiKey),
    "utf8"
  );

  console.log(`=== Starting 50-Video Validation Run: run_${runStamp} ===`);
  console.log(`Output dir: ${runDir}`);
  console.log(`Preregistration SHA-256: ${preregSha256}`);
  console.log(`Prompt SHA-256 (verified identical): ${promptSha256}`);

  const queue = prereg.main_50.map((v, idx) => ({ ...v, slot_order: idx + 1, substituted_from: null }));
  const availableReserves = prereg.reserve_8.map((r) => ({ ...r }));
  const substitutions = [];

  let requestCount = 0;
  let cumulativeCostUsd = 0;
  let consecutiveJsonErrors = 0;
  let stoppedEarly = false;
  let stopReason = null;
  const callSummaries = [];
  const videoResults = [];
  const logPath = path.join(runDir, "calls_log.jsonl");

  async function runSingleCall(videoObj, attempt) {
    const estNext = estimateNextCallCostUsd(videoObj.duration_sec);
    if (cumulativeCostUsd > STOP_COST_USD || cumulativeCostUsd + estNext > STOP_COST_USD) {
      stoppedEarly = true;
      stopReason = `projected_cost_would_exceed_${STOP_COST_USD}_usd (cum=${cumulativeCostUsd.toFixed(4)}, est_next=${estNext.toFixed(4)})`;
      console.error(`[STOP] ${stopReason}`);
      return { halted: true };
    }
    if (requestCount >= MAX_REQUESTS) {
      stoppedEarly = true;
      stopReason = `max_requests_${MAX_REQUESTS}_reached`;
      console.error(`[STOP] ${stopReason}`);
      return { halted: true };
    }

    if (requestCount > 0) {
      await sleep(SLEEP_BETWEEN_CALLS_MS);
    }

    requestCount++;
    const callIdxStr = String(requestCount).padStart(3, "0");
    const startedAt = new Date().toISOString();
    const t0 = Date.now();

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
          MODEL,
          "-i",
          videoObj.youtube_url,
          "--stream=false",
          "--body",
          bodyJson,
          "-o",
          "json",
        ],
        {
          encoding: "utf8",
          timeout: CALL_TIMEOUT_MS,
          maxBuffer: 20 * 1024 * 1024,
          env: {
            ...process.env,
            GEMINI_API_KEY: apiKey,
          },
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

    const fatalCode = detectFatalHttpStop(`${safeStderr} ${safeStdout}`, respObj);
    const usage = extractUsageBreakdown(respObj);
    const cost = calcCostUsd(usage);
    cumulativeCostUsd = Math.round((cumulativeCostUsd + cost.call_cost_usd) * 1_000_000) / 1_000_000;

    const modelText = extractModelText(respObj);
    const parsedRes = parseAndValidateScoreJson(modelText);
    const videoUnreadable = !fatalCode && isVideoUnreadableError(exitCode, `${safeStderr} ${safeStdout}`, respObj);

    const callRecord = {
      call_index: requestCount,
      slot_order: videoObj.slot_order,
      split: videoObj.split,
      video_id: videoObj.video_id,
      substituted_from: videoObj.substituted_from,
      attempt,
      started_at: startedAt,
      finished_at: finishedAt,
      elapsed_sec: elapsedSec,
      request: {
        model: MODEL,
        thinking_level: THINKING_LEVEL,
        store: false,
        stream: false,
        service_tier: "standard",
        youtube_url: videoObj.youtube_url,
        prompt_sha256: promptSha256,
      },
      exit_code: exitCode,
      api_status: respObj?.status || null,
      interaction_id: respObj?.id || null,
      fatal_http_code: fatalCode,
      video_unreadable: videoUnreadable,
      usage_breakdown: {
        total_input_tokens: usage.total_input_tokens,
        input_text_tokens: usage.input_text_tokens,
        input_video_tokens: usage.input_video_tokens,
        input_audio_tokens: usage.input_audio_tokens,
        input_other_tokens: usage.input_other_tokens,
        total_output_tokens: usage.total_output_tokens,
        total_thought_tokens: usage.total_thought_tokens,
        total_tokens: usage.total_tokens,
        suspect_video_not_processed: usage.suspect_video_not_processed,
        video_tokens_per_sec:
          videoObj.duration_sec > 0
            ? Math.round((usage.input_video_tokens / videoObj.duration_sec) * 100) / 100
            : null,
      },
      usage_raw: usage.raw,
      cost: {
        ...cost,
        cumulative_cost_usd: cumulativeCostUsd,
      },
      parse_ok: parsedRes.ok,
      parse_error: parsedRes.error,
      scores_sum_mismatch: parsedRes.sum_mismatch ?? null,
      parsed_json: parsedRes.parsed,
      extracted_text: modelText,
      stderr: safeStderr || null,
      raw_response: respObj ?? safeStdout,
    };

    const callFileName = `${callIdxStr}_${videoObj.video_id}_r${attempt}.json`;
    fs.writeFileSync(
      path.join(callsDir, callFileName),
      redactSecret(JSON.stringify(callRecord, null, 2) + "\n", apiKey),
      "utf8"
    );

    const summaryLine = {
      call_index: requestCount,
      file: callFileName,
      slot_order: videoObj.slot_order,
      split: videoObj.split,
      video_id: videoObj.video_id,
      attempt,
      baseline_score: videoObj.calibrated_score,
      api_score: parsedRes.ok ? parsedRes.parsed.total_score : null,
      api_rank: parsedRes.ok ? parsedRes.parsed.rank : null,
      api_knows_work: parsedRes.ok ? parsedRes.parsed.post_check.knows_work : null,
      elapsed_sec: elapsedSec,
      total_input_tokens: usage.total_input_tokens,
      input_text_tokens: usage.input_text_tokens,
      input_video_tokens: usage.input_video_tokens,
      input_audio_tokens: usage.input_audio_tokens,
      total_output_tokens: usage.total_output_tokens,
      total_thought_tokens: usage.total_thought_tokens,
      suspect_video_not_processed: usage.suspect_video_not_processed,
      call_cost_usd: cost.call_cost_usd,
      cumulative_cost_usd: cumulativeCostUsd,
      parse_ok: parsedRes.ok,
      parse_error: parsedRes.error,
      exit_code: exitCode,
      fatal_http_code: fatalCode,
      video_unreadable: videoUnreadable,
    };
    callSummaries.push(summaryLine);
    fs.appendFileSync(logPath, redactSecret(JSON.stringify(summaryLine) + "\n", apiKey), "utf8");

    const tag = videoUnreadable
      ? " [VIDEO_UNREADABLE]"
      : usage.suspect_video_not_processed && exitCode === 0
      ? " [STOP:VIDEO_TOK<1000]"
      : "";
    console.log(
      `[${callIdxStr}] (${videoObj.slot_order}/50 ${videoObj.split}) ${videoObj.video_id} r${attempt} | base=${videoObj.calibrated_score} api=${summaryLine.api_score ?? "ERR"} | kw=${summaryLine.api_knows_work} | in=${usage.total_input_tokens} (txt=${usage.input_text_tokens}, vid=${usage.input_video_tokens}) out=${usage.total_output_tokens} th=${usage.total_thought_tokens} | $${cost.call_cost_usd.toFixed(4)} (cum $${cumulativeCostUsd.toFixed(4)}) | ${elapsedSec}s${tag}`
    );

    // Check global stop conditions
    if (fatalCode) {
      stoppedEarly = true;
      stopReason = `fatal_http_${fatalCode}_detected`;
      console.error(`[STOP] ${stopReason}`);
      return { halted: true, callRecord };
    }

    if (videoUnreadable) {
      // Do not increment consecutive JSON errors for unreadable YouTube video; caller will substitute from reserve
      return { halted: false, unreadable: true, callRecord };
    }

    if (exitCode === 0 && usage.suspect_video_not_processed) {
      stoppedEarly = true;
      stopReason = `suspect_video_not_processed (video_tokens=${usage.input_video_tokens} < 1000 on ${videoObj.video_id} r${attempt})`;
      console.error(`[STOP] ${stopReason}`);
      return { halted: true, callRecord };
    }

    if (exitCode !== 0 || !parsedRes.ok) {
      consecutiveJsonErrors++;
      if (consecutiveJsonErrors >= 2) {
        stoppedEarly = true;
        stopReason = `2_consecutive_json_or_call_errors (last=${parsedRes.error || "exit_" + exitCode})`;
        console.error(`[STOP] ${stopReason}`);
        return { halted: true, callRecord };
      }
      return { halted: false, jsonError: true, callRecord };
    } else {
      consecutiveJsonErrors = 0;
    }

    return { halted: false, ok: true, callRecord };
  }

  for (let i = 0; i < queue.length; i++) {
    let v = queue[i];
    let finishedVideo = false;

    while (!finishedVideo && !stoppedEarly) {
      const r1 = await runSingleCall(v, 1);
      if (r1.halted) break;

      if (r1.unreadable) {
        const rep = pickBestReserve(v, availableReserves);
        if (!rep) {
          stoppedEarly = true;
          stopReason = `no_reserve_available_for_${v.video_id}`;
          console.error(`[STOP] ${stopReason}`);
          break;
        }
        substitutions.push({
          slot_order: v.slot_order,
          split: v.split,
          original_video_id: v.video_id,
          replacement_video_id: rep.video_id,
          reason: r1.callRecord?.stderr || r1.callRecord?.parse_error || "video_unreadable",
        });
        console.log(`[SUBSTITUTE] slot ${v.slot_order} (${v.split}): ${v.video_id} -> ${rep.video_id}`);
        v = { ...rep, split: v.split, slot_order: v.slot_order, substituted_from: v.video_id };
        queue[i] = v;
        continue;
      }

      if (r1.jsonError) {
        // Retry once (if next also fails, consecutiveJsonErrors hits 2 and halts)
        const r1Retry = await runSingleCall(v, 1);
        if (r1Retry.halted || !r1Retry.ok) break;
        r1.callRecord = r1Retry.callRecord;
      }

      const r2 = await runSingleCall(v, 2);
      if (r2.halted) break;
      if (r2.unreadable) {
        const rep = pickBestReserve(v, availableReserves);
        if (!rep) {
          stoppedEarly = true;
          stopReason = `no_reserve_available_for_${v.video_id}_on_r2`;
          break;
        }
        substitutions.push({
          slot_order: v.slot_order,
          split: v.split,
          original_video_id: v.video_id,
          replacement_video_id: rep.video_id,
          reason: "video_unreadable_on_r2",
        });
        console.log(`[SUBSTITUTE] slot ${v.slot_order} (${v.split}): ${v.video_id} -> ${rep.video_id}`);
        v = { ...rep, split: v.split, slot_order: v.slot_order, substituted_from: v.video_id };
        queue[i] = v;
        continue;
      }
      if (r2.jsonError) {
        const r2Retry = await runSingleCall(v, 2);
        if (r2Retry.halted || !r2Retry.ok) break;
        r2.callRecord = r2Retry.callRecord;
      }

      const s1 = r1.callRecord.parsed_json.total_score;
      const s2 = r2.callRecord.parsed_json.total_score;
      const diff12 = Math.abs(s1 - s2);
      let r3Rec = null;
      let finalScore;
      let ensembleRule;

      if (diff12 >= 5) {
        console.log(`[TIEBREAKER] ${v.video_id}: r1=${s1}, r2=${s2} (|diff|=${diff12} >= 5) -> running r3`);
        const r3 = await runSingleCall(v, 3);
        if (r3.halted) break;
        if (r3.jsonError) {
          const r3Retry = await runSingleCall(v, 3);
          if (r3Retry.halted || !r3Retry.ok) break;
          r3Rec = r3Retry.callRecord;
        } else if (r3.ok) {
          r3Rec = r3.callRecord;
        } else {
          stoppedEarly = true;
          stopReason = `r3_failed_for_${v.video_id}`;
          break;
        }
        const s3 = r3Rec.parsed_json.total_score;
        const sorted3 = [s1, s2, s3].sort((a, b) => a - b);
        finalScore = sorted3[1];
        ensembleRule = "median_of_3";
      } else {
        finalScore = Math.round(((s1 + s2) / 2) * 100) / 100;
        ensembleRule = "mean_of_2";
      }

      videoResults.push({
        slot_order: v.slot_order,
        split: v.split,
        video_id: v.video_id,
        substituted_from: v.substituted_from,
        calibrated_score: v.calibrated_score,
        raw_scores: r3Rec ? [s1, s2, r3Rec.parsed_json.total_score] : [s1, s2],
        api_final_score: finalScore,
        ensemble_rule: ensembleRule,
        tiebreaker_triggered: Boolean(r3Rec),
      });
      finishedVideo = true;
    }

    if (stoppedEarly) break;
  }

  // Re-verify preregistration SHA-256 unchanged after run
  const preregShaAfter = sha256Buffer(fs.readFileSync(PREREG_PATH));

  const runSummary = {
    run_id: `run_${runStamp}`,
    run_dir: runDir,
    finished_at: new Date().toISOString(),
    preregistration_sha256_before: preregSha256,
    preregistration_sha256_after: preregShaAfter,
    preregistration_immutable_verified: preregSha256 === preregShaAfter,
    total_requests: requestCount,
    videos_completed: videoResults.length,
    tiebreakers_triggered: videoResults.filter((x) => x.tiebreaker_triggered).length,
    substitutions,
    stopped_early: stoppedEarly,
    stop_reason: stopReason,
    total_cost_usd: cumulativeCostUsd,
    suspect_video_calls: callSummaries.filter((c) => c.suspect_video_not_processed && c.exit_code === 0).length,
    video_results: videoResults,
  };

  fs.writeFileSync(
    path.join(runDir, "run_summary.json"),
    redactSecret(JSON.stringify(runSummary, null, 2) + "\n", apiKey),
    "utf8"
  );

  console.log("=== 50-VIDEO VALIDATION RUN FINISHED ===");
  console.log(
    JSON.stringify(
      {
        run_id: runSummary.run_id,
        total_requests: runSummary.total_requests,
        videos_completed: runSummary.videos_completed,
        tiebreakers_triggered: runSummary.tiebreakers_triggered,
        substitutions_count: substitutions.length,
        stopped_early: runSummary.stopped_early,
        stop_reason: runSummary.stop_reason,
        total_cost_usd: runSummary.total_cost_usd,
        preregistration_immutable_verified: runSummary.preregistration_immutable_verified,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error("FATAL:", err?.message || err);
  process.exit(1);
});
