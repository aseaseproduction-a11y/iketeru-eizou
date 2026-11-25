#!/usr/bin/env node
/**
 * Pilot runner for Gemini API direct YouTube URL Craft Recipe v2 draft generation.
 *
 * Strictly obeys:
 *  - analysis/pilot_api_craft_recipe/preregistration.json (immutability verified via LF SHA-256)
 *  - docs/API_CRAFT_RECIPE_DESIGN.md & docs/DECISIONS.md (D-016..D-023)
 *  - Identical 503/429 deferred-queue policy from scripts/run-api-url-batch.mjs:
 *      1) On 1st 503/429 in normal pass: wait 30-60s random then retry once.
 *      2) On 2nd consecutive 503/429: defer ONLY failed call to deferred_retry_queue.json,
 *         preserve succeeded attempts, move immediately to next video.
 *      3) 3 consecutive deferred videos -> stop immediately.
 *      4) After normal pass: retry deferred queue once each with 60-120s interval;
 *         any 503/429 stops immediately and preserves remaining queue.
 *      5) --resume processes deferred_retry_queue.json FIRST.
 *      6) 402/403 stops immediately (0 retries).
 *      7) Budget ledger records ONLY succeeded call costs; 503/429 records counts & timestamps only.
 *  - NEVER injects existing SQLite scenes or existing craft_recipes into the prompt.
 *  - NEVER accesses YouTube directly from this PC.
 *  - NEVER writes to TiDB, production SQLite, or frozen 13 files.
 *  - NEVER prints, logs, or writes GEMINI_API_KEY anywhere.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  REPO_ROOT,
  DEFAULT_LEDGER_PATH,
  DEFAULT_LOGS_ROOT,
  DEFAULT_MONTHLY_LIMIT_USD,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_SLEEP_MS,
  INITIAL_RETRY_MIN_SEC,
  INITIAL_RETRY_MAX_SEC,
  DEFERRED_PASS_MIN_SEC,
  DEFERRED_PASS_MAX_SEC,
  MAX_CONSECUTIVE_DEFERRED_VIDEOS,
  PRICING_USD_PER_1M,
  redactSecret,
  sha256Text,
  sha256File,
  calcCallCostUsd,
  checkBudgetGuard,
  executeWithRetry,
  runBatchOrchestrator,
  extractModelText,
  extractUsageBreakdown,
  updateLedger,
} from "../run-api-url-batch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(REPO_ROOT, "package.json"));
const dotenv = require("dotenv");

export const PREREG_PATH = path.join(
  REPO_ROOT,
  "analysis",
  "pilot_api_craft_recipe",
  "preregistration.json"
);
export const EXPECTED_PREREG_LF_SHA256 =
  "e01cc0097d1995e2ae84ec850275132445d5d58d458c2130c345c29d5a45be94";
export const EXPECTED_PROMPT_SHA256 =
  "1c088bb9ff08365d4054dc682f2e5134857181f517c7be1fade208fd8213b0d3";
export const DEFAULT_PASS1_BUDGET_USD = 1.2;
export const DEFAULT_PASS2_BUDGET_USD = 0.3;

export function sha256LfNormalized(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

export function loadAndVerifyPreregistration(preregPath = PREREG_PATH) {
  if (!fs.existsSync(preregPath)) {
    throw new Error(`Preregistration file not found: ${preregPath}`);
  }
  const lfSha = sha256LfNormalized(preregPath);
  if (lfSha !== EXPECTED_PREREG_LF_SHA256) {
    throw new Error(
      `Preregistration LF SHA-256 mismatch: ${lfSha} !== ${EXPECTED_PREREG_LF_SHA256}`
    );
  }
  const doc = JSON.parse(fs.readFileSync(preregPath, "utf8"));
  const promptSha = sha256Text(doc?.prompt?.prompt_text || "");
  if (promptSha !== EXPECTED_PROMPT_SHA256) {
    throw new Error(
      `Preregistration prompt SHA-256 mismatch: ${promptSha} !== ${EXPECTED_PROMPT_SHA256}`
    );
  }
  if (!Array.isArray(doc.selected_videos) || doc.selected_videos.length !== 5) {
    throw new Error(`Expected 5 selected_videos in preregistration, got ${doc.selected_videos?.length}`);
  }
  return { prereg: doc, preregLfSha256: lfSha, promptSha256: promptSha };
}

export function renderCraftPrompt(promptTemplate, videoMeta) {
  const replacements = {
    "{{video_id}}": String(videoMeta.video_id ?? ""),
    "{{title}}": String(videoMeta.title ?? ""),
    "{{genres}}": Array.isArray(videoMeta.genres) ? videoMeta.genres.join(", ") : String(videoMeta.genres ?? ""),
    "{{directions}}": Array.isArray(videoMeta.directions)
      ? videoMeta.directions.join(", ")
      : String(videoMeta.directions ?? ""),
    "{{tones}}": Array.isArray(videoMeta.tones) ? videoMeta.tones.join(", ") : String(videoMeta.tones ?? ""),
    "{{ref_duration_sec}}": String(videoMeta.ref_duration_sec ?? ""),
  };
  let out = String(promptTemplate);
  for (const [k, v] of Object.entries(replacements)) {
    out = out.split(k).join(v);
  }
  const leftover = out.match(/\{\{[^}]+\}\}/g);
  if (leftover) {
    throw new Error(`Unreplaced prompt placeholders: ${leftover.join(", ")}`);
  }
  return out;
}

export function buildPass2RefinementPrompt({ videoMeta, startOffsetSec, endOffsetSec, pass1Cuts }) {
  const cutsBrief = (pass1Cuts || []).map((c) => ({
    cut_index: c.cut_index,
    title: c.title,
    category: c.category,
    start_sec: c.start_sec,
    end_sec: c.end_sec,
    primary_tool: c.primary_tool,
  }));
  return [
    "あなたは映像制作・モーショングラフィックス・VFXの専門テクニカルディレクターです。",
    `添付された YouTube 動画の抜粋区間（${startOffsetSec}秒〜${endOffsetSec}秒、4 fps で高密度サンプリング）を実際に視聴し、Pass 1（1 fps）で抽出したカットの開始・終了時刻とフレームタイムラインを 0.1 秒精度で精密化してください。`,
    "",
    "# 対象動画・抜粋区間メタデータ",
    `- video_id: ${videoMeta.video_id}`,
    `- title: ${videoMeta.title}`,
    `- clip_window_sec: ${startOffsetSec}s - ${endOffsetSec}s (4 fps, frames only)`,
    `- pass1_cuts_in_or_near_window: ${JSON.stringify(cutsBrief)}`,
    "",
    "# 厳守ルール",
    "1. 添付された 4 fps 映像内で実際に視認したカット境界（切り替わり瞬間）のみを記述し、捏造しないこと。",
    "2. 返却する `start_sec` / `end_sec` は動画先頭からの絶対秒数（小数第2位まで）で記述すること。",
    "3. 各カットは必ず 15.0 秒以下に収めること。極短遷移（0.1〜0.8 秒）が見える場合は `micro_transition` として正確に切り出すこと。",
    "4. 焼き込み生成AI動画ツールや画像テロップは禁止。",
    "",
    "# 出力 JSON スキーマ（この形式の JSON のみを出力し、前後に説明文を書かないこと）",
    "```json",
    JSON.stringify(
      {
        schema_version: "craft_recipe_api_pass2_4fps_v1",
        video_id: videoMeta.video_id,
        clip_window: { start_sec: startOffsetSec, end_sec: endOffsetSec, fps: 4.0 },
        refined_cuts: [
          {
            cut_index: 1,
            title: "カット名",
            category: "micro_fx_glitch",
            start_mmss: "00:00",
            end_mmss: "00:03",
            start_sec: 0.0,
            end_sec: 3.0,
            fps: 30.0,
            frame_timeline: [
              { frame: 0, time_offset_sec: 0.0, event: "開始状態", params: {} },
              { frame: 15, time_offset_sec: 0.5, event: "転換ピーク", params: {} },
            ],
            observed_timestamps: [
              { timestamp: "00:00.5", visual_evidence: "実際に視認した変化1" },
              { timestamp: "00:01.2", visual_evidence: "実際に視認した変化2" },
            ],
            timing_change_note: "Pass 1 からの時刻修正理由",
          },
        ],
      },
      null,
      2
    ),
    "```",
  ].join("\n");
}

export function buildCraftRequestBody({
  promptText,
  youtubeUrl,
  thinkingLevel = "high",
  serviceTier = "flex",
  videoProcessing = { type: "static", fps: 1.0, content_layers: ["frames", "audio"] },
  resolution = "low",
}) {
  const proc = {
    type: videoProcessing.type || "static",
    fps: Number(videoProcessing.fps ?? 1.0),
    content_layers: Array.isArray(videoProcessing.content_layers)
      ? videoProcessing.content_layers
      : ["frames", "audio"],
  };
  if (videoProcessing.start_offset != null) proc.start_offset = String(videoProcessing.start_offset);
  if (videoProcessing.end_offset != null) proc.end_offset = String(videoProcessing.end_offset);

  const videoInput = {
    type: "video",
    uri: youtubeUrl,
    processing: proc,
  };
  if (resolution) {
    videoInput.resolution = resolution;
  }

  return {
    generation_config: { thinking_level: thinkingLevel },
    service_tier: serviceTier,
    store: false,
    input: [
      { type: "text", text: promptText },
      videoInput,
    ],
  };
}

export function estimateCraftCallCostUsd(
  durationSec,
  serviceTier = "flex",
  { fps = 1.0, outThoughtTok = 7000 } = {}
) {
  const rates = PRICING_USD_PER_1M[serviceTier];
  if (!rates) throw new Error(`Unsupported service_tier: ${String(serviceTier)}`);
  const d = typeof durationSec === "number" && Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 180;
  const inputTok = 2500 + 105 * d * fps;
  const cost = (inputTok / 1_000_000) * rates.input + (outThoughtTok / 1_000_000) * rates.output_and_thought;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export function extractJsonCandidate(rawText) {
  if (!rawText || typeof rawText !== "string") return null;
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
  return candidate;
}

export function parseAndValidateCraftRecipeJson(rawText, { isPass2 = false } = {}) {
  const candidate = extractJsonCandidate(rawText);
  if (!candidate) {
    return { ok: false, error: "empty_text", parsed: null, cuts_count: 0 };
  }
  let obj;
  try {
    obj = JSON.parse(candidate);
  } catch (err) {
    return { ok: false, error: `json_parse_error: ${err.message}`, parsed: null, cuts_count: 0 };
  }
  if (!obj || typeof obj !== "object") {
    return { ok: false, error: "not_an_object", parsed: null, cuts_count: 0 };
  }
  const cutsKey = isPass2 ? "refined_cuts" : "cuts";
  if (!Array.isArray(obj[cutsKey]) || obj[cutsKey].length === 0) {
    return { ok: false, error: `missing_or_empty_${cutsKey}`, parsed: obj, cuts_count: 0 };
  }
  return { ok: true, error: null, parsed: obj, cuts_count: obj[cutsKey].length };
}

export function attachApiProvenance(parsedRecipe, { videoMeta, model, thinkingLevel, serviceTier, videoProcessing, resolution, usage, attempt, isPass2 = false }) {
  const prov = {
    source: isPass2 ? "gemini_api_url_v1_pass2_4fps" : "gemini_api_url_v1",
    model,
    thinking_level: thinkingLevel,
    service_tier: serviceTier,
    video_processing: { ...videoProcessing, resolution: resolution || "low" },
    visual_observation_basis: "youtube_url_video_stream",
    input_video_tokens: usage?.input_video_tokens ?? 0,
    media_telemetry_status: "missing_requires_local_video",
    pilot_attempt: attempt,
    field_provenance: {
      semantic_craft_fields: "api_observed",
      timestamps_and_duration: isPass2 ? "api_estimated_4fps_pass2" : "api_estimated_1fps",
      fps_and_frames: "api_estimated",
      color_palette_hex: "api_estimated",
      easing_and_timing: "api_estimated",
      media_and_telemetry: "missing",
    },
  };
  const enriched = JSON.parse(JSON.stringify(parsedRecipe));
  enriched.video_id = videoMeta.video_id;
  enriched.title = videoMeta.title;
  enriched.technique_rating = videoMeta.technique_rating;
  enriched.provenance = prov;
  const cutsList = Array.isArray(enriched.cuts) ? enriched.cuts : [];
  for (const c of cutsList) {
    if (!c || typeof c !== "object") continue;
    c.provenance = { ...(c.provenance || {}), ...prov };
    if (c.easing_and_timing && typeof c.easing_and_timing === "object") {
      c.easing_and_timing.source = "api_estimated";
      c.easing_and_timing.verified = false;
    }
    if (c.ae_blueprint && typeof c.ae_blueprint === "object") {
      c.ae_blueprint.source = "api_estimated";
    }
    if (c.transition_bridge && typeof c.transition_bridge === "object") {
      c.transition_bridge.source = "api_estimated";
    }
    c.media = {
      available: false,
      status: "missing_requires_local_video",
      telemetry: { available: false },
    };
  }
  return enriched;
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

function writeEvidenceManifest({ runDir, runId, worker, logsRunDir, callEntries }) {
  const manifest = {
    schema_version: 1,
    run_id: runId,
    worker,
    generated_at: new Date().toISOString(),
    evidence_root: logsRunDir,
    calls_dir: path.join(logsRunDir, "calls"),
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
  const isPass2 = Boolean(args["pass2"]);
  const runId = String(args["run-id"] || (isPass2 ? `pass2_${localTimestampStamp()}` : `pilot_${localTimestampStamp()}`));
  const worker = String(args["worker"] || "CHIBA-PC-api").trim();
  const dryRun = Boolean(args["dry-run"]);
  const resume = Boolean(args["resume"]);
  const noLedgerUpdate = Boolean(args["no-ledger-update"]);
  const preregPath = args["prereg"] ? path.resolve(REPO_ROOT, String(args["prereg"])) : PREREG_PATH;
  const ledgerPath = path.resolve(REPO_ROOT, String(args["ledger"] || DEFAULT_LEDGER_PATH));
  const logsRoot = path.resolve(String(args["logs-root"] || DEFAULT_LOGS_ROOT));
  const outRoot = args["out-root"]
    ? path.resolve(REPO_ROOT, String(args["out-root"]))
    : path.join(REPO_ROOT, "analysis", "pilot_api_craft_recipe");

  const { prereg, preregLfSha256, promptSha256 } = loadAndVerifyPreregistration(preregPath);
  const cfg = prereg.api_execution_config;
  const model = cfg.model;
  const thinkingLevel = cfg.thinking_level;
  const serviceTier = String(args["service-tier"] || cfg.service_tier || "flex").trim();
  if (!PRICING_USD_PER_1M[serviceTier]) {
    throw new Error(`Unsupported --service-tier "${serviceTier}".`);
  }

  const runBudgetUsd = Number(
    args["run-budget-usd"] || (isPass2 ? DEFAULT_PASS2_BUDGET_USD : cfg.budget_cap_usd || DEFAULT_PASS1_BUDGET_USD)
  );
  const monthlyLimitOverride = args["monthly-limit-usd"] ? Number(args["monthly-limit-usd"]) : null;
  const attemptsPerVideo = Number(args["attempts"] || (isPass2 ? 1 : cfg.calls_per_video || 2));
  const purpose = String(args["purpose"] || (isPass2 ? "pilot_craft_recipe_pass2_4fps" : "pilot_craft_recipe_5x2_1fps"));

  dotenv.config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!dryRun && !apiKey) {
    throw new Error("GEMINI_API_KEY is missing in E:\\iketeru-eizou\\.env");
  }

  const videoMap = new Map(prereg.selected_videos.map((v) => [v.video_id, v]));
  let queue = [];

  if (isPass2) {
    const specPath = args["pass2-spec"] ? path.resolve(REPO_ROOT, String(args["pass2-spec"])) : null;
    if (!specPath || !fs.existsSync(specPath)) {
      throw new Error("--pass2 requires --pass2-spec <json_file>");
    }
    const specList = JSON.parse(fs.readFileSync(specPath, "utf8"));
    for (const entry of specList) {
      const meta = videoMap.get(entry.video_id);
      if (!meta) throw new Error(`Pass 2 video_id not in preregistration: ${entry.video_id}`);
      const startSec = Number(entry.start_offset_sec ?? 0);
      const endSec = Number(entry.end_offset_sec ?? Math.min(meta.ref_duration_sec, startSec + 15));
      const clipDur = Math.max(1, endSec - startSec);
      const p2Proc = {
        type: "static",
        start_offset: `${startSec}s`,
        end_offset: `${endSec}s`,
        fps: 4.0,
        content_layers: ["frames"],
      };
      queue.push({
        video_id: meta.video_id,
        youtube_url: meta.youtube_url,
        role: "pass2_fast_cut",
        ref_duration_sec: clipDur,
        full_duration_sec: meta.ref_duration_sec,
        video_meta: meta,
        video_processing: p2Proc,
        resolution: "low",
        prompt_text: buildPass2RefinementPrompt({
          videoMeta: meta,
          startOffsetSec: startSec,
          endOffsetSec: endSec,
          pass1Cuts: entry.pass1_cuts || [],
        }),
      });
    }
  } else {
    const defProc = cfg.video_processing_default;
    for (const meta of prereg.selected_videos) {
      queue.push({
        video_id: meta.video_id,
        youtube_url: meta.youtube_url,
        role: meta.stratum,
        ref_duration_sec: meta.ref_duration_sec,
        full_duration_sec: meta.ref_duration_sec,
        video_meta: meta,
        video_processing: {
          type: defProc.type,
          fps: defProc.fps,
          content_layers: defProc.content_layers,
        },
        resolution: defProc.resolution || "low",
        prompt_text: renderCraftPrompt(prereg.prompt.prompt_text, meta),
      });
    }
  }

  const maxRequests = args["max-requests"]
    ? parseInt(String(args["max-requests"]), 10)
    : Math.ceil(queue.length * attemptsPerVideo * 2.5);

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
    const sample = queue[0];
    const sampleBody = buildCraftRequestBody({
      promptText: sample.prompt_text,
      youtubeUrl: sample.youtube_url,
      thinkingLevel,
      serviceTier,
      videoProcessing: sample.video_processing,
      resolution: sample.resolution,
    });
    const dryOut = execFileSync(
      cliExe,
      ["generate", "-m", model, "--stream=false", "--body", "@-", "--dry-run", "-o", "json"],
      { input: JSON.stringify(sampleBody), encoding: "utf8" }
    );
    const estTotalCostUsd =
      Math.round(
        queue.reduce(
          (acc, q) =>
            acc +
            estimateCraftCallCostUsd(q.ref_duration_sec, serviceTier, {
              fps: q.video_processing.fps,
              outThoughtTok: isPass2 ? 3000 : 7000,
            }) *
              attemptsPerVideo,
          0
        ) * 10000
      ) / 10000;
    console.log(
      JSON.stringify(
        {
          dry_run: true,
          mode: isPass2 ? "pass2_4fps" : "pass1_1fps",
          run_id: runId,
          worker,
          cli_version: cliVersion,
          prereg_lf_sha256: preregLfSha256,
          prompt_sha256: promptSha256,
          model,
          thinking_level: thinkingLevel,
          service_tier: serviceTier,
          videos_count: queue.length,
          attempts_per_video: attemptsPerVideo,
          planned_calls: queue.length * attemptsPerVideo,
          run_budget_usd: runBudgetUsd,
          estimated_cost_usd: estTotalCostUsd,
          monthly_budget_status: {
            month: monthKey,
            spent_usd: baseMonthlySpentUsd,
            limit_usd: monthlyLimitUsd,
            remaining_usd: Math.round((monthlyLimitUsd - baseMonthlySpentUsd) * 10000) / 10000,
          },
          sample_request: JSON.parse(redactSecret(dryOut, apiKey)),
        },
        null,
        2
      )
    );
    return;
  }

  const runDir = path.join(outRoot, runId);
  const draftsDir = path.join(runDir, "drafts");
  const logsRunDir = path.join(logsRoot, `pilot_craft_recipe_${runId}`);
  const callsDir = path.join(logsRunDir, "calls");
  fs.mkdirSync(draftsDir, { recursive: true });
  fs.mkdirSync(callsDir, { recursive: true });

  const runConfig = {
    schema_version: 1,
    run_id: runId,
    mode: isPass2 ? "pass2_4fps" : "pass1_1fps",
    worker,
    purpose,
    started_at: new Date().toISOString(),
    cli_version: cliVersion,
    prereg_path: path.relative(REPO_ROOT, preregPath).replace(/\\/g, "/"),
    prereg_lf_sha256: preregLfSha256,
    prompt_sha256: promptSha256,
    model,
    thinking_level: thinkingLevel,
    service_tier: serviceTier,
    store: false,
    stream: false,
    concurrency: 1,
    timeout_ms: DEFAULT_TIMEOUT_MS,
    attempts_per_video: attemptsPerVideo,
    congestion_policy: {
      initial_retry_wait_sec: [INITIAL_RETRY_MIN_SEC, INITIAL_RETRY_MAX_SEC],
      defer_after_consecutive_503_429: 2,
      stop_after_consecutive_deferred_videos: MAX_CONSECUTIVE_DEFERRED_VIDEOS,
      deferred_pass_interval_sec: [DEFERRED_PASS_MIN_SEC, DEFERRED_PASS_MAX_SEC],
      deferred_pass_tries: 1,
      resume_prioritizes_deferred_queue: true,
    },
    pricing_usd_per_1m: PRICING_USD_PER_1M[serviceTier],
    budget_guards: {
      month: monthKey,
      monthly_limit_usd: monthlyLimitUsd,
      run_budget_usd: runBudgetUsd,
      max_requests: maxRequests,
    },
    evidence_logs_dir: logsRunDir,
    videos: queue.map((q) => ({
      video_id: q.video_id,
      role: q.role,
      ref_duration_sec: q.ref_duration_sec,
      full_duration_sec: q.full_duration_sec,
      video_processing: q.video_processing,
      resolution: q.resolution,
    })),
  };
  fs.writeFileSync(
    path.join(runDir, "run_config.json"),
    redactSecret(JSON.stringify(runConfig, null, 2) + "\n", apiKey),
    "utf8"
  );

  const logPath = path.join(runDir, "calls_log.jsonl");
  const deferredPath = path.join(runDir, "deferred_retry_queue.json");
  const initialCompletedScores = new Map();
  let initialDeferredQueue = [];
  const callSummaries = [];
  const evidenceEntries = [];
  let requestCount = 0;
  let succeededCallsCount = 0;
  let runSpentUsd = 0;

  if (resume && fs.existsSync(logPath)) {
    for (const line of fs.readFileSync(logPath, "utf8").split(/\r?\n/).filter(Boolean)) {
      const rec = JSON.parse(line);
      callSummaries.push(rec);
      requestCount = Math.max(requestCount, rec.call_index || 0);
      if (rec.parse_ok && rec.exit_code === 0 && !rec.suspect_video_not_processed) {
        succeededCallsCount++;
        runSpentUsd = Math.round((runSpentUsd + (rec.call_cost_usd || 0)) * 1_000_000) / 1_000_000;
        if (!initialCompletedScores.has(rec.video_id)) initialCompletedScores.set(rec.video_id, new Map());
        initialCompletedScores.get(rec.video_id).set(rec.attempt, rec.cuts_count || 1);
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

  // Note: runBatchOrchestrator runs attempt 1 & 2 when fixedAttempts === 2.
  // For Pass 2 (attemptsPerVideo === 1), we pre-mark attempt 2 as already done so only attempt 1 executes.
  if (attemptsPerVideo === 1) {
    for (const q of queue) {
      if (!initialCompletedScores.has(q.video_id)) initialCompletedScores.set(q.video_id, new Map());
      initialCompletedScores.get(q.video_id).set(2, 0);
    }
  }

  let consecutiveJsonErrors = 0;
  const allCongestionEvents = [...initialCongestionEvents];

  const orch = await runBatchOrchestrator({
    queue,
    initialCompletedScores,
    initialDeferredQueue,
    fixedAttempts: 2,
    sleepFn: (ms) => new Promise((r) => setTimeout(r, ms)),
    runAttemptFn: async ({ item, attempt, phase }) => {
      const estNext = estimateCraftCallCostUsd(item.ref_duration_sec, serviceTier, {
        fps: item.video_processing.fps,
        outThoughtTok: isPass2 ? 3000 : 7000,
      });
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
      const reqBody = buildCraftRequestBody({
        promptText: item.prompt_text,
        youtubeUrl: item.youtube_url,
        thinkingLevel,
        serviceTier,
        videoProcessing: item.video_processing,
        resolution: item.resolution,
      });
      const reqBodyJson = JSON.stringify(reqBody);

      console.log(
        `[${callIdxStr}] ${phase} ${item.video_id} r${attempt} (fps=${item.video_processing.fps}, dur=${item.ref_duration_sec}s, est=$${estNext.toFixed(4)})...`
      );

      const execResult = await executeWithRetry(
        async () => {
          let stdoutStr = "";
          let stderrStr = "";
          let exitCode = 0;
          try {
            stdoutStr = execFileSync(
              cliExe,
              ["generate", "-m", model, "--stream=false", "--body", "@-", "-o", "json"],
              {
                input: reqBodyJson,
                encoding: "utf8",
                timeout: DEFAULT_TIMEOUT_MS,
                maxBuffer: 30 * 1024 * 1024,
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
      const {
        exitCode,
        stdout: safeStdout,
        stderr: safeStderr,
        respObj,
        classification,
        retries_used,
        retry_history,
        congestion_events,
      } = execResult;

      const taggedCongestion = (congestion_events || []).map((e) => ({
        ...e,
        video_id: item.video_id,
        attempt,
      }));
      allCongestionEvents.push(...taggedCongestion);

      const usage = extractUsageBreakdown(respObj, item.ref_duration_sec);
      // For Pass 2 (4 fps), scale min_required check appropriately (90 tok/s * fps * 0.7 safety floor, min 1000)
      if (isPass2 && item.ref_duration_sec > 0) {
        const p2Min = Math.max(1000, Math.floor(item.ref_duration_sec * 90 * item.video_processing.fps * 0.7));
        usage.min_required_video_tokens = p2Min;
        usage.suspect_video_not_processed = usage.input_video_tokens < p2Min;
      }

      const modelText = extractModelText(respObj);
      const parsedRes = parseAndValidateCraftRecipeJson(modelText, { isPass2 });

      // Rule 7: Ledger records ONLY succeeded call costs
      const callSucceeded = exitCode === 0 && parsedRes.ok && !usage.suspect_video_not_processed;
      const cost = callSucceeded
        ? calcCallCostUsd(usage, serviceTier)
        : { input_cost_usd: 0, output_thought_cost_usd: 0, call_cost_usd: 0 };
      if (callSucceeded) {
        succeededCallsCount++;
        runSpentUsd = Math.round((runSpentUsd + cost.call_cost_usd) * 1_000_000) / 1_000_000;
      }

      let draftFileRel = null;
      if (callSucceeded) {
        const enrichedDraft = attachApiProvenance(parsedRes.parsed, {
          videoMeta: item.video_meta,
          model,
          thinkingLevel,
          serviceTier,
          videoProcessing: item.video_processing,
          resolution: item.resolution,
          usage,
          attempt,
          isPass2,
        });
        const draftName = `${item.video_id}_r${attempt}.json`;
        const draftPath = path.join(draftsDir, draftName);
        fs.writeFileSync(
          draftPath,
          redactSecret(JSON.stringify(enrichedDraft, null, 2) + "\n", apiKey),
          "utf8"
        );
        draftFileRel = `drafts/${draftName}`;
      }

      const callFileName = `${callIdxStr}_${item.video_id}_r${attempt}.json`;
      const callFilePath = path.join(callsDir, callFileName);
      const callRecord = {
        call_index: requestCount,
        run_id: runId,
        mode: isPass2 ? "pass2_4fps" : "pass1_1fps",
        worker,
        phase,
        video_id: item.video_id,
        role: item.role,
        ref_duration_sec: item.ref_duration_sec,
        full_duration_sec: item.full_duration_sec,
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
          video_processing: item.video_processing,
          resolution: item.resolution,
          prompt_sha256: isPass2 ? sha256Text(item.prompt_text) : promptSha256,
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
        cuts_count: parsedRes.cuts_count,
        draft_file: draftFileRel,
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
        fps: item.video_processing.fps,
        elapsed_sec: elapsedSec,
        retries_used,
        congestion_count: taggedCongestion.length,
        total_input_tokens: usage.total_input_tokens,
        input_text_tokens: usage.input_text_tokens,
        input_video_tokens: usage.input_video_tokens,
        input_audio_tokens: usage.input_audio_tokens,
        total_output_tokens: usage.total_output_tokens,
        total_thought_tokens: usage.total_thought_tokens,
        suspect_video_not_processed: usage.suspect_video_not_processed,
        call_cost_usd: cost.call_cost_usd,
        run_cumulative_cost_usd: runSpentUsd,
        parse_ok: parsedRes.ok,
        parse_error: parsedRes.error,
        cuts_count: parsedRes.cuts_count,
        draft_file: draftFileRel,
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
        `  -> status=${classification.kind}${classification.deferred ? "(DEFERRED)" : ""} parse_ok=${parsedRes.ok} cuts=${parsedRes.cuts_count} vid_tok=${usage.input_video_tokens} out=${usage.total_output_tokens} th=${usage.total_thought_tokens} cost=$${cost.call_cost_usd.toFixed(4)} elapsed=${elapsedSec}s 503/429=${taggedCongestion.length}`
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
      return { status: "ok", score: parsedRes.cuts_count, congestionEvents: taggedCongestion };
    },
  });

  saveDeferredQueue(runDir, runId, orch.deferred_queue, allCongestionEvents);
  writeEvidenceManifest({ runDir, runId, worker, logsRunDir, callEntries: evidenceEntries });

  const videosSummary = queue.map((q) => {
    const vRec = orch.videos.find((v) => v.video_id === q.video_id);
    const completedAttempts = (vRec?.attempts_completed || []).filter((a) => a <= attemptsPerVideo);
    return {
      video_id: q.video_id,
      role: q.role,
      attempts_completed: completedAttempts,
      complete: completedAttempts.length >= attemptsPerVideo,
    };
  });

  const runSummary = {
    schema_version: 1,
    run_id: runId,
    mode: isPass2 ? "pass2_4fps" : "pass1_1fps",
    worker,
    purpose,
    service_tier: serviceTier,
    prereg_lf_sha256: preregLfSha256,
    prompt_sha256: promptSha256,
    finished_at: new Date().toISOString(),
    total_requests: requestCount,
    succeeded_calls: succeededCallsCount,
    planned_calls: queue.length * attemptsPerVideo,
    congestion_failure_count: allCongestionEvents.length,
    congestion_events: allCongestionEvents,
    deferred_remaining_count: orch.deferred_queue.length,
    videos_completed: videosSummary.filter((v) => v.complete).length,
    stopped_early: orch.stopped_early,
    stop_reason: orch.stop_reason,
    run_cost_usd: runSpentUsd,
    evidence_manifest: "evidence_manifest.json",
    deferred_queue_file: "deferred_retry_queue.json",
    evidence_logs_dir: logsRunDir,
    videos: videosSummary,
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
      service_tier: serviceTier,
      calls_count: succeededCallsCount,
      cost_usd: runSpentUsd,
      congestion_failure_count: allCongestionEvents.length,
      congestion_timestamps: allCongestionEvents.map((e) => e.timestamp),
      recorded_at: new Date().toISOString(),
    });
  }

  console.log("=== PILOT CRAFT RECIPE RUN FINISHED ===");
  console.log(
    JSON.stringify(
      {
        run_id: runId,
        mode: runSummary.mode,
        service_tier: serviceTier,
        succeeded_calls: succeededCallsCount,
        planned_calls: runSummary.planned_calls,
        congestion_failure_count: allCongestionEvents.length,
        deferred_remaining_count: orch.deferred_queue.length,
        videos_completed: runSummary.videos_completed,
        stopped_early: orch.stopped_early,
        stop_reason: orch.stop_reason,
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
