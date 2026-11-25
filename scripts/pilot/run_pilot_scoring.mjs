#!/usr/bin/env node
/**
 * Pilot test: Direct YouTube URL blind scoring via Gemini API (gemini-4-neon, thinking_level=high)
 * using gemini-api CLI v0.5.0+.
 *
 * Strict safety & budget guarantees:
 *  - NEVER writes to TiDB, SQLite, production runs, E:\iketeru_blind_eval\, analysis/claims/, or frozen 13 files.
 *  - NEVER accesses YouTube directly from this PC (video fetching is done solely by Gemini API servers).
 *  - NEVER prints, logs, or saves GEMINI_API_KEY anywhere (explicit redaction guard on all outputs).
 *  - Hard stops:
 *      1) Cumulative estimated cost > $4.00 USD (computed after every call; stops before next call)
 *      2) Total requests (including retries) >= 25
 *      3) HTTP/API error 402, 403, or 429
 *      4) 2 consecutive malformed/invalid JSON outputs
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

const MODEL = "gemini-4-neon";
const THINKING_LEVEL = "high";
const INPUT_USD_PER_M = 3.0;
const OUTPUT_THOUGHT_USD_PER_M = 15.0;
const STOP_COST_USD = 4.0;
const MAX_REQUESTS = 25;
const SLEEP_BETWEEN_CALLS_MS = 5000;
const CALL_TIMEOUT_MS = 300_000;
const ATTEMPTS_PER_VIDEO = 2;

const SELECTED_PATH = path.join(
  REPO_ROOT,
  "analysis",
  "pilot_gemini_api_url",
  "selected_10_videos.json"
);

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

function redactSecret(text, secret) {
  if (!text) return "";
  let out = String(text);
  if (secret && secret.length >= 6) {
    out = out.split(secret).join("[REDACTED_API_KEY]");
  }
  // Extra belt-and-suspenders pattern for Google API key prefixes
  out = out.replace(/AIza[0-9A-Za-z\-_]{20,}/g, "[REDACTED_API_KEY]");
  return out;
}

/**
 * Prompt faithfully mirrors scripts/lib/calibration-prompt-template.mjs (v1_baseline):
 * - Same 5-criterion 100pt craft rubric
 * - Same S+..D rank table
 * - Same JSON structure & post_check
 * - Replaces assigned local files section with "this YouTube URL video"
 * - Adds 3 timestamped concrete observations to verify actual video watching
 * - Passes ZERO metadata (no title, channel name, genre, awards, etc.)
 */
function buildYoutubeBlindPrompt() {
  return [
    "[PILOT_GEMINI_API_URL_BLIND_EVAL | v1_baseline_url]",
    "",
    "あなたは映像制作・演出の専門審査員です。添付されたこの YouTube URL の動画のみを観察（映像・音声の両方を視聴）し、映像クラフトの到達度を0〜100点で独立採点してください。",
    "",
    "## 厳守事項（違反時は採点無効）",
    "- 添付されたこの YouTube URL の動画のみを最初から最後まで視聴・観察したうえで採点してください。",
    "- 外部のWeb検索や周辺メタデータ（タイトル・チャンネル名・概要欄・再生数・コメント等）に頼らず、動画内の映像と音声のクラフト実行力のみに基づいて独立採点してください。",
    "- 実際に動画を見て採点したことを示すため、動画内の異なるタイミングにおける「時刻つきの具体的な観察（映像・カット・動作・文字・音など）」を3つ必ず出力 JSON に含めてください。",
    "",
    "## 対象動画",
    "添付されているこの YouTube URL の動画（映像＋音声）を観察対象とします。",
    "",
    "## 採点ルーブリック（100点満点・クラフト実行力優先）",
    "以下の5項目を各0〜20点で採点し、合計点（0〜100の整数）と対応ランクを決定してください。アイデア単体ではなく、映像としての実行・クラフト（purpose-driven craft）が物語や感情をどれだけ引き上げているかを厳格に評価します。",
    "1. `direction` (0-20): 演出設計・構成力・感情曲線・意図の一貫性",
    "2. `visual_craft` (0-20): 撮影・ライティング・美術・構図・カラグレーディング・VFX/CG/アニメーションの完成度",
    "3. `editing_rhythm` (0-20): 編集テンポ・カット割り・緩急・トランジション・視覚的リズム",
    "4. `sound_integration` (0-20): 音響・音楽・SE・間合いと映像の統合度（※静止画方式で音声非聴取の場合は実測LUFSと視覚的テンポから中立推定し、根拠欄に明記）",
    "5. `originality_finish` (0-20): 表現の独自性・記憶残留力・細部の仕上げ品質（定型・量産的ショートカットは厳しく減点）",
    "",
    "### 点数帯とランク対応表（審査基準）",
    "- `S+` (97-100): 歴史的・世界最高峰の映像クラフト到達点。全要素が極めて高次元で融合",
    "- `S`  (93-96): 国際最上位水準の傑作。圧倒的な演出・技術・完成度",
    "- `S-` (90-92): 国際上位水準の秀作。複数分野で際立つクラフト強度",
    "- `A+` (86-89): 国内外の一線級プロ水準を大きく超える高到達作",
    "- `A`  (82-85): 明確な技術的・演出的強みを持つ上位プロ品質",
    "- `A-` (78-81): 確かな工夫と完成度を備えた良質なプロ作品",
    "- `B+` (73-77): 商業品質として堅実で一部に見どころがある水準",
    "- `B`  (68-72): 標準的な商業・企業映像品質（大きな欠点はないが特筆点も限定的）",
    "- `B-` (63-67): 実用レベルだが演出・構成・仕上げのいずれかに粗さ・凡庸さが残る",
    "- `C+` (57-62): 意図は伝わるが映像表現・技術面で課題が目立つ",
    "- `C`  (51-56): 基礎的な撮影・編集・デザインに明確な不足がある",
    "- `C-` (45-50): 品質・視認性・構成の破綻が大きい",
    "- `D`  (0-44): 重大な技術的・演出的欠陥があり商業水準に大きく未達",
    "",
    "## 出力形式（厳守・JSON のみ）",
    "説明文や前置きは一切書かず、以下の形式の有効な JSON オブジェクトのみを返してください。点数確定後、同じ JSON 内に必ず「時刻つきの具体的な観察3つ（`timestamped_observations`）」と末尾の自己申告（`post_check`）を含めてください。",
    "```json",
    "{",
    '  "scores": {',
    '    "direction": 0,',
    '    "visual_craft": 0,',
    '    "editing_rhythm": 0,',
    '    "sound_integration": 0,',
    '    "originality_finish": 0',
    "  },",
    '  "total_score": 0,',
    '  "rank": "B",',
    '  "brief_rationale": "200文字以内で視覚・構成・技術上の根拠を記述",',
    '  "timestamped_observations": [',
    '    { "timestamp": "00:05", "observation": "その時刻に実際に映っている映像・動き・構図・音などの具体的な観察" },',
    '    { "timestamp": "00:20", "observation": "別の時刻における具体的な観察" },',
    '    { "timestamp": "00:45", "observation": "さらに別の時刻における具体的な観察" }',
    "  ],",
    '  "post_check": {',
    '    "knows_work": false,',
    '    "knows_award_history": false,',
    '    "award_badge_visible_in_video": false,',
    '    "post_check_note": "該当がある場合は簡潔に理由を記述（なければ空文字）"',
    "  }",
    "}",
    "```",
  ].join("\n");
}

function extractModelText(resp) {
  if (!resp || typeof resp !== "object") return "";
  // Interactions API v1beta shape: outputs[] or steps[]
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

  // Interactions API: input_tokens_by_modality: [{ modality: "text"|"video"|"audio", tokens: N }]
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

  // Direct flat fields fallback
  if (inputText === null && typeof u.input_text_tokens === "number") inputText = u.input_text_tokens;
  if (inputVideo === null && typeof u.input_video_tokens === "number") inputVideo = u.input_video_tokens;
  if (inputAudio === null && typeof u.input_audio_tokens === "number") inputAudio = u.input_audio_tokens;

  const totalInput = Number(
    u.total_input_tokens ?? u.promptTokenCount ?? u.prompt_token_count ??
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

  // Video tokens for suspect check: if video modality is reported directly use it;
  // note: some API responses combine video+audio under video or split them.
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

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const limitArgIdx = process.argv.indexOf("--limit-videos");
  const limitVideos = limitArgIdx !== -1 ? parseInt(process.argv[limitArgIdx + 1], 10) : null;

  dotenv.config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!dryRun && !apiKey) {
    throw new Error("GEMINI_API_KEY is missing in E:\\iketeru-eizou\\.env");
  }

  const cliExe = resolveCliPath();
  const cliVersion = execFileSync(cliExe, ["--version"], { encoding: "utf8" }).trim();

  const selData = JSON.parse(fs.readFileSync(SELECTED_PATH, "utf8"));
  const videos = limitVideos ? selData.selected.slice(0, limitVideos) : selData.selected;
  const promptText = buildYoutubeBlindPrompt();
  const promptSha256 = crypto.createHash("sha256").update(promptText, "utf8").digest("hex");

  const bodyObj = {
    generation_config: {
      thinking_level: THINKING_LEVEL,
    },
    store: false,
  };
  const bodyJson = JSON.stringify(bodyObj);

  if (dryRun) {
    const sampleUrl = videos[0].youtube_url;
    const out = execFileSync(
      cliExe,
      [
        "generate",
        promptText,
        "-m",
        MODEL,
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
    console.log("CLI VERSION:", cliVersion);
    console.log("PROMPT LENGTH (chars):", promptText.length, "SHA256:", promptSha256);
    console.log("DRY-RUN RESPONSE (redacted):");
    console.log(redactSecret(out, apiKey));
    return;
  }

  const runStamp = localTimestampStamp();
  const runDir = path.join(REPO_ROOT, "analysis", "pilot_gemini_api_url", `run_${runStamp}`);
  const callsDir = path.join(runDir, "calls");
  fs.mkdirSync(callsDir, { recursive: true });

  const runConfig = {
    run_id: `run_${runStamp}`,
    started_at: new Date().toISOString(),
    cli_version: cliVersion,
    model: MODEL,
    thinking_level: THINKING_LEVEL,
    store: false,
    stream: false,
    attempts_per_video: ATTEMPTS_PER_VIDEO,
    sleep_between_calls_ms: SLEEP_BETWEEN_CALLS_MS,
    pricing_usd_per_1m: {
      input: INPUT_USD_PER_M,
      output_and_thought: OUTPUT_THOUGHT_USD_PER_M,
    },
    stop_conditions: {
      stop_cost_usd: STOP_COST_USD,
      max_requests: MAX_REQUESTS,
      stop_http_codes: [402, 403, 429],
      max_consecutive_json_errors: 2,
      suspect_video_tokens_threshold: 1000,
    },
    prompt_sha256: promptSha256,
    prompt_text: promptText,
    selected_videos: videos.map((v) => ({
      video_id: v.video_id,
      youtube_url: v.youtube_url,
      calibrated_score: v.calibrated_score,
      calibrated_rank: v.calibrated_rank,
      band: v.band,
      route_raw: v.route_raw,
      route_group: v.route_group,
      knows_work: v.knows_work,
      duration_sec: v.duration_sec,
      sqlite_scenes_count: v.sqlite_scenes_count,
    })),
  };
  fs.writeFileSync(
    path.join(runDir, "run_config.json"),
    redactSecret(JSON.stringify(runConfig, null, 2) + "\n", apiKey),
    "utf8"
  );

  console.log(`=== Starting Gemini API URL Pilot: run_${runStamp} ===`);
  console.log(`Output dir: ${runDir}`);
  console.log(`Videos: ${videos.length}, Attempts/video: ${ATTEMPTS_PER_VIDEO}, Model: ${MODEL}, Thinking: ${THINKING_LEVEL}`);

  let requestCount = 0;
  let cumulativeCostUsd = 0;
  let consecutiveJsonErrors = 0;
  let stoppedEarly = false;
  let stopReason = null;
  const callSummaries = [];
  const logPath = path.join(runDir, "calls_log.jsonl");

  outer: for (let vIdx = 0; vIdx < videos.length; vIdx++) {
    const v = videos[vIdx];
    for (let attempt = 1; attempt <= ATTEMPTS_PER_VIDEO; attempt++) {
      // Pre-call stop checks
      if (cumulativeCostUsd > STOP_COST_USD) {
        stoppedEarly = true;
        stopReason = `cumulative_cost_exceeded_${STOP_COST_USD}_usd (${cumulativeCostUsd.toFixed(4)})`;
        console.error(`[STOP] ${stopReason}`);
        break outer;
      }
      if (requestCount >= MAX_REQUESTS) {
        stoppedEarly = true;
        stopReason = `max_requests_${MAX_REQUESTS}_reached`;
        console.error(`[STOP] ${stopReason}`);
        break outer;
      }

      if (requestCount > 0) {
        await sleep(SLEEP_BETWEEN_CALLS_MS);
      }

      requestCount++;
      const callIndexStr = String(requestCount).padStart(2, "0");
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
            v.youtube_url,
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

      if (exitCode !== 0 || !parsedRes.ok) {
        consecutiveJsonErrors++;
      } else {
        consecutiveJsonErrors = 0;
      }

      const callRecord = {
        call_index: requestCount,
        video_index: vIdx + 1,
        video_id: v.video_id,
        attempt,
        started_at: startedAt,
        finished_at: finishedAt,
        elapsed_sec: elapsedSec,
        request: {
          model: MODEL,
          thinking_level: THINKING_LEVEL,
          store: false,
          stream: false,
          youtube_url: v.youtube_url,
          prompt_sha256: promptSha256,
        },
        exit_code: exitCode,
        api_status: respObj?.status || null,
        interaction_id: respObj?.id || null,
        fatal_http_code: fatalCode,
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
            v.duration_sec > 0
              ? Math.round((usage.input_video_tokens / v.duration_sec) * 100) / 100
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

      const callFileName = `${callIndexStr}_${v.video_id}_r${attempt}.json`;
      fs.writeFileSync(
        path.join(callsDir, callFileName),
        redactSecret(JSON.stringify(callRecord, null, 2) + "\n", apiKey),
        "utf8"
      );

      const summaryLine = {
        call_index: requestCount,
        file: callFileName,
        video_id: v.video_id,
        attempt,
        baseline_score: v.calibrated_score,
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
      };
      callSummaries.push(summaryLine);
      fs.appendFileSync(logPath, redactSecret(JSON.stringify(summaryLine) + "\n", apiKey), "utf8");

      const flag = usage.suspect_video_not_processed ? " [SUSPECT_VIDEO_TOK<1000]" : "";
      console.log(
        `[${callIndexStr}/20] ${v.video_id} r${attempt} | base=${v.calibrated_score} api=${summaryLine.api_score ?? "ERR"} (${summaryLine.api_rank ?? "-"}) | kw=${summaryLine.api_knows_work} | in=${usage.total_input_tokens} (txt=${usage.input_text_tokens}, vid=${usage.input_video_tokens}, aud=${usage.input_audio_tokens}) out=${usage.total_output_tokens} th=${usage.total_thought_tokens} | $${cost.call_cost_usd.toFixed(4)} (cum $${cumulativeCostUsd.toFixed(4)}) | ${elapsedSec}s${flag}`
      );

      // Post-call stop checks
      if (fatalCode) {
        stoppedEarly = true;
        stopReason = `fatal_http_${fatalCode}_detected`;
        console.error(`[STOP] ${stopReason}`);
        break outer;
      }
      if (consecutiveJsonErrors >= 2) {
        stoppedEarly = true;
        stopReason = "2_consecutive_json_errors";
        console.error(`[STOP] ${stopReason}`);
        break outer;
      }
      if (cumulativeCostUsd > STOP_COST_USD) {
        stoppedEarly = true;
        stopReason = `cumulative_cost_exceeded_${STOP_COST_USD}_usd (${cumulativeCostUsd.toFixed(4)})`;
        console.error(`[STOP] ${stopReason}`);
        break outer;
      }
    }
  }

  const runSummary = {
    run_id: `run_${runStamp}`,
    run_dir: runDir,
    finished_at: new Date().toISOString(),
    total_requests: requestCount,
    completed_ok: callSummaries.filter((c) => c.parse_ok && c.exit_code === 0).length,
    stopped_early: stoppedEarly,
    stop_reason: stopReason,
    total_cost_usd: cumulativeCostUsd,
    suspect_video_calls: callSummaries.filter((c) => c.suspect_video_not_processed).length,
    calls: callSummaries,
  };

  fs.writeFileSync(
    path.join(runDir, "run_summary.json"),
    redactSecret(JSON.stringify(runSummary, null, 2) + "\n", apiKey),
    "utf8"
  );

  console.log("=== RUN FINISHED ===");
  console.log(
    JSON.stringify(
      {
        run_id: runSummary.run_id,
        total_requests: runSummary.total_requests,
        completed_ok: runSummary.completed_ok,
        stopped_early: runSummary.stopped_early,
        stop_reason: runSummary.stop_reason,
        total_cost_usd: runSummary.total_cost_usd,
        suspect_video_calls: runSummary.suspect_video_calls,
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
