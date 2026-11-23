#!/usr/bin/env node
/**
 * Phase 3 Step C — Production Blind Staging & Preparation Pipeline (Max 200 videos / batch).
 *
 * Strictly reuses frozen Phase 2 v1 rules:
 *  - Verifies analysis/phase2_frozen_config_v1.json against git HEAD via validateSplitGuard
 *  - Selects target batch deterministically from TiDB (source of truth, ORDER BY id ASC)
 *    using classifyVideoForCalibration() from dryrun-phase3-calibration-rollout.mjs
 *  - Unauthenticated yt-dlp download only if missing from local cache (1-by-1, 15-30s random wait,
 *    NO cookies/login/bypass, immediate abort on bot-check / HTTP 429)
 *  - Local ffmpeg staging (scdet + ebur128 + clean mp4 metadata strip + slowmo + 4x4 contact sheets)
 *    with opaque 12-hex blind IDs and SHA-256 manifest compatible with audit-blind-transcript.mjs
 *
 * Usage:
 *   node scripts/prepare-phase3-batch.mjs \
 *     --priority P1_private_rating --batch 1 --batch-size 200 \
 *     --frozen-config analysis/phase2_frozen_config_v1.json \
 *     [--run-id run_YYYYMMDD_HHMMSS] [--resume] [--concurrency 4] [--dry-run]
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { sha256File } from "./audit-blind-transcript.mjs";
import { classifyVideoForCalibration, MAX_BATCH_SIZE } from "./dryrun-phase3-calibration-rollout.mjs";
import {
  generateBlindIdMap,
  generateRunId,
  RUN_ID_REGEX,
  saveBlindIdMap,
} from "./lib/blind-id-map.mjs";
import { renderCalibrationPrompt } from "./lib/calibration-prompt-template.mjs";
import { decidePhase1Route } from "./phase2-hybrid-router.mjs";
import { isBotCheckError, validateSplitGuard } from "./prepare-phase2-run.mjs";

const execFileAsync = promisify(execFile);
const REPO_ROOT = "E:\\iketeru-eizou";
const CACHE_DIR = "D:\\マイドライブ\\iketeru_videos";
const BLIND_ROOT = "E:\\iketeru_blind_eval";

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

function findCachedFile(id) {
  if (!fs.existsSync(CACHE_DIR)) return null;
  for (const ext of [".mp4", ".mov", ".mkv", ".webm", ".m4v"]) {
    const p = path.join(CACHE_DIR, `${id}${ext}`);
    if (fs.existsSync(p) && fs.statSync(p).size > 0) return p;
  }
  return null;
}

async function ffprobeInfo(filePath) {
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v", "error",
      "-show_entries", "format=duration,size:format_tags:stream=codec_type,codec_name,width,height:stream_tags",
      "-of", "json",
      filePath,
    ],
    { timeout: 30000 }
  );
  return JSON.parse(stdout);
}

async function measureScdetAndLufs(srcPath, hasAudio) {
  const scRes = await execFileAsync(
    "ffmpeg",
    ["-hide_banner", "-i", srcPath, "-vf", "scdet=threshold=10:sc_pass=0", "-f", "null", "-"],
    { timeout: 180000, maxBuffer: 20 * 1024 * 1024 }
  );
  const scText = (scRes.stderr || "") + "\n" + (scRes.stdout || "");
  const cuts = [];
  const lineRe = /lavfi\.scd\.score:\s*([0-9.]+),\s*lavfi\.scd\.time:\s*([0-9.]+)/g;
  let m;
  while ((m = lineRe.exec(scText)) !== null) {
    const score = parseFloat(m[1]);
    const t = parseFloat(m[2]);
    if (Number.isFinite(score) && Number.isFinite(t) && score >= 10.0 && t > 0.05) {
      cuts.push(t);
    }
  }
  cuts.sort((a, b) => a - b);

  let integratedLufs = null;
  if (hasAudio) {
    try {
      const luRes = await execFileAsync(
        "ffmpeg",
        ["-hide_banner", "-i", srcPath, "-vn", "-filter_complex", "ebur128=framelog=quiet", "-f", "null", "-"],
        { timeout: 180000, maxBuffer: 10 * 1024 * 1024 }
      );
      const luText = (luRes.stderr || "") + "\n" + (luRes.stdout || "");
      const sm = luText.match(/Summary:[\s\S]*?\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS/);
      if (sm) {
        const val = parseFloat(sm[1]);
        if (Number.isFinite(val)) integratedLufs = Math.round(val * 10) / 10;
      }
    } catch {
      integratedLufs = null;
    }
  }
  return { cuts, integratedLufs };
}

function findMaxCutWindow(cuts, duration, W) {
  if (duration <= W) {
    return { count: cuts.length, start: 0, end: Math.round(duration * 10) / 10 };
  }
  const maxStart = Math.max(0, Math.floor(duration - W));
  let bestCount = -1;
  let bestStart = 0;
  for (let t = 0; t <= maxStart; t += 1) {
    const tEnd = t + W;
    let c = 0;
    for (let i = 0; i < cuts.length; i++) {
      if (cuts[i] >= t && cuts[i] < tEnd) c++;
    }
    if (c > bestCount) {
      bestCount = c;
      bestStart = t;
    }
  }
  return {
    count: Math.max(0, bestCount),
    start: bestStart,
    end: Math.min(Math.round(duration * 10) / 10, bestStart + W),
  };
}

async function generateContactSheet(srcPath, startSec, segLenSec, outJpgPath) {
  const safeLen = Math.max(segLenSec, 0.5);
  const fpsExpr = (16 / safeLen).toFixed(6);
  const vf = `fps=${fpsExpr},scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2:color=black,tile=4x4:nb_frames=16:padding=2:margin=2`;
  await execFileAsync(
    "ffmpeg",
    [
      "-y", "-hide_banner", "-loglevel", "error",
      "-ss", String(startSec),
      "-t", String(safeLen),
      "-i", srcPath,
      "-vf", vf,
      "-frames:v", "1",
      "-map_metadata", "-1",
      "-q:v", "3",
      outJpgPath,
    ],
    { timeout: 120000 }
  );
}

async function remuxStripMetadata(inPath, outPath) {
  await execFileAsync(
    "ffmpeg",
    [
      "-y", "-hide_banner", "-loglevel", "error",
      "-i", inPath,
      "-map", "0:v:0", "-map", "0:a?",
      "-map_metadata", "-1",
      "-map_metadata:s:v", "-1",
      "-map_metadata:s:a", "-1",
      "-map_chapters", "-1",
      "-fflags", "+bitexact", "-flags:v", "+bitexact", "-flags:a", "+bitexact",
      "-c", "copy",
      "-movflags", "+faststart",
      outPath,
    ],
    { timeout: 120000 }
  );
}

async function stageCleanMp4(srcPath, outPath, canStreamCopy, tmpDir) {
  if (canStreamCopy) {
    try {
      await remuxStripMetadata(srcPath, outPath);
      const leaked = await verifyMetadataStripped(outPath);
      if (leaked.length === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
        return;
      }
    } catch {
      // Fall back to clean re-encode
    }
  }
  const tmpEnc = path.join(tmpDir, `enc_${Date.now()}_${Math.random().toString(16).slice(2)}_${path.basename(outPath)}`);
  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-y", "-hide_banner", "-loglevel", "error",
        "-i", srcPath,
        "-map", "0:v:0", "-map", "0:a?",
        "-map_metadata", "-1", "-map_chapters", "-1",
        "-fflags", "+bitexact", "-flags:v", "+bitexact", "-flags:a", "+bitexact",
        "-c:v", "libx264", "-crf", "22", "-preset", "fast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        tmpEnc,
      ],
      { timeout: 240000 }
    );
    await remuxStripMetadata(tmpEnc, outPath);
  } finally {
    if (fs.existsSync(tmpEnc)) fs.unlinkSync(tmpEnc);
  }
}

async function generateSlowMoMp4(srcPath, startSec, segLenSec, factorNum, outPath, tmpDir) {
  const tmpSlow = path.join(tmpDir, `slow_${Date.now()}_${Math.random().toString(16).slice(2)}_${path.basename(outPath)}`);
  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-y", "-hide_banner", "-loglevel", "error",
        "-ss", String(startSec),
        "-t", String(segLenSec),
        "-i", srcPath,
        "-vf", `setpts=${factorNum}.0*PTS`,
        "-an",
        "-map_metadata", "-1", "-map_chapters", "-1",
        "-fflags", "+bitexact", "-flags:v", "+bitexact",
        "-c:v", "libx264", "-crf", "22", "-preset", "fast", "-pix_fmt", "yuv420p",
        tmpSlow,
      ],
      { timeout: 180000 }
    );
    await remuxStripMetadata(tmpSlow, outPath);
  } finally {
    if (fs.existsSync(tmpSlow)) fs.unlinkSync(tmpSlow);
  }
}

async function verifyMetadataStripped(mp4Path) {
  const info = await ffprobeInfo(mp4Path);
  const badTags = [];
  for (const [k, v] of Object.entries(info.format?.tags || {})) {
    if (/creation_time|encoder|title|comment|artist|copyright/i.test(k)) {
      badTags.push(`format.${k}=${v}`);
    }
  }
  for (const s of info.streams || []) {
    for (const [k, v] of Object.entries(s.tags || {})) {
      if (/creation_time|encoder|title|comment|artist|copyright/i.test(k)) {
        badTags.push(`stream.${k}=${v}`);
      }
    }
  }
  return badTags;
}

async function downloadToCacheGently(item) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const outFile = path.join(CACHE_DIR, `${item.video_id}.mp4`);
  const url = item.video_url;
  if (!url) throw new Error(`Missing video_url for ${item.video_id}`);
  try {
    // Strictly unauthenticated, NO cookies, NO login, NO bot-check bypass
    await execFileAsync(
      "yt-dlp",
      [
        "-f", "18/best[height<=480][ext=mp4]/worst[ext=mp4]/best",
        "--no-warnings",
        "--no-playlist",
        "-o", outFile,
        url,
      ],
      { timeout: 180000 }
    );
    if (fs.existsSync(outFile) && fs.statSync(outFile).size > 0) return outFile;
    throw new Error(`yt-dlp produced empty file for ${item.video_id}`);
  } catch (e) {
    const combined = `${e.stderr || ""}\n${e.stdout || ""}\n${e.message || ""}`;
    if (isBotCheckError(combined)) {
      const err = new Error(`BOT_CHECK_ABORT: ${combined.replace(/\s+/g, " ").trim().slice(0, 220)}`);
      err.isBotCheck = true;
      throw err;
    }
    throw e;
  }
}

async function fetchBatchFromTidb({ priority, batchIndex, batchSize }) {
  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  require("dotenv").config({ path: path.join(REPO_ROOT, ".env") });
  const mysql = require("mysql2/promise");

  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });
  try {
    const [rows] = await conn.query(`
      SELECT id, platform, title, videoUrl, genres, purposes, expressions, directions,
             privateRating, aiOverallScore, aiOverallRating, embedStatus,
             calibrationStatus, calibratedScore, calibratedRunId
      FROM videos
      ORDER BY id ASC
    `);
    const classified = rows.map((r) => ({
      row: r,
      cls: classifyVideoForCalibration(r),
    }));
    const tierRows = classified.filter((x) => x.cls.priority_tier === priority);
    const start = (batchIndex - 1) * batchSize;
    const end = start + batchSize;
    const slice = tierRows.slice(start, end);
    return {
      totalInTier: tierRows.length,
      start,
      end: Math.min(end, tierRows.length),
      items: slice.map(({ row, cls }) => ({
        video_id: String(row.id),
        platform: cls.platform,
        title: row.title || "",
        video_url: row.videoUrl || "",
        private_rating: String(row.privateRating || "").trim() || null,
        legacy_overall_score: row.aiOverallScore ?? null,
        legacy_overall_rating: row.aiOverallRating || null,
        embed_status: cls.embedStatus,
        primary_genre_norm: cls.primary_genre_norm,
        genre_verified: cls.genre_verified,
        calibration_genre_bucket: cls.calibration_genre_bucket,
        routing_genre: cls.routing_genre,
        target_status_after_calibration: cls.target_status_after_calibration,
        likely_fetch_blocked: cls.likely_fetch_blocked,
      })),
    };
  } finally {
    await conn.end();
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const priority = args["priority"] || "P1_private_rating";
  const batchIndex = parseInt(args["batch"] || "1", 10);
  const batchSize = Math.min(MAX_BATCH_SIZE, parseInt(args["batch-size"] || String(MAX_BATCH_SIZE), 10));
  const frozenConfigPath = path.resolve(REPO_ROOT, args["frozen-config"] || "analysis/phase2_frozen_config_v1.json");
  const runId = args["run-id"] || generateRunId();
  const resume = Boolean(args["resume"]);
  const dryRun = Boolean(args["dry-run"]);
  const minWaitSec = Number(args["min-wait-sec"] || 15);
  const maxWaitSec = Number(args["max-wait-sec"] || 30);
  const concurrency = Math.max(1, Math.min(8, parseInt(args["concurrency"] || "4", 10)));

  if (!RUN_ID_REGEX.test(runId)) {
    throw new Error(`Invalid --run-id (expected ^run_\\d{8}_\\d{6}$): ${runId}`);
  }
  if (!["P1_private_rating", "P2_verified_5_genres", "P3_unverified_genres"].includes(priority)) {
    throw new Error(`Invalid --priority: ${priority}`);
  }
  if (!Number.isInteger(batchIndex) || batchIndex < 1) {
    throw new Error(`Invalid --batch: ${batchIndex}`);
  }

  // Verify frozen Phase 2 v1 config against git HEAD (exact same integrity gate as Holdout v1)
  const frozenCfg = validateSplitGuard({
    splitName: "holdout",
    confirmFrozenHoldout: true,
    frozenConfigPath,
    repoRoot: REPO_ROOT,
  });

  const promptVersion = frozenCfg.prompt_version || "v1_baseline";
  const expectedModel = frozenCfg.expected_model || "gemini-4-neon-high";

  const runRepoDir = path.join(REPO_ROOT, "analysis", "runs", runId);
  const selectionPath = path.join(runRepoDir, "batch_selection.json");

  let selection;
  if (resume && fs.existsSync(selectionPath)) {
    selection = JSON.parse(fs.readFileSync(selectionPath, "utf8"));
  } else {
    const fetched = await fetchBatchFromTidb({ priority, batchIndex, batchSize });
    selection = {
      phase: "phase3_c",
      priority,
      batch_index: batchIndex,
      batch_size: batchSize,
      total_in_tier: fetched.totalInTier,
      slice_range: [fetched.start, fetched.end],
      selected_count: fetched.items.length,
      selected_at: new Date().toISOString(),
      frozen_config_rel_path: frozenCfg._verified_rel_path,
      frozen_config_sha256: frozenCfg._verified_head_sha256,
      items: fetched.items,
    };
  }

  const items = selection.items;
  const targetIds = items.map((x) => x.video_id);
  const itemById = new Map(items.map((x) => [x.video_id, x]));
  const cachedCount = targetIds.filter((id) => Boolean(findCachedFile(id))).length;

  console.log(
    `[Phase 3 C Prepare] priority=${priority} batch=${batchIndex} total=${targetIds.length} cached=${cachedCount} missing=${targetIds.length - cachedCount} run_id=${runId} concurrency=${concurrency}`
  );

  if (dryRun) {
    console.log("[DRY-RUN] Verified frozen config & TiDB selection. Zero files written, zero downloads.");
    return;
  }

  const specsDir = path.join(runRepoDir, "specs");
  fs.mkdirSync(specsDir, { recursive: true });
  if (!fs.existsSync(selectionPath)) {
    fs.writeFileSync(selectionPath, JSON.stringify(selection, null, 2).replace(/\r\n/g, "\n") + "\n", "utf8");
  }

  const blindMapPath = path.join(runRepoDir, "blind_id_map.json");
  const manifestPath = path.join(runRepoDir, "run_manifest.json");
  let blindMap;
  let itemsManifest = {};
  if (resume && fs.existsSync(blindMapPath) && fs.existsSync(manifestPath)) {
    blindMap = JSON.parse(fs.readFileSync(blindMapPath, "utf8"));
    const prevManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    itemsManifest = prevManifest.items || {};
  } else {
    blindMap = generateBlindIdMap(runId, targetIds);
    saveBlindIdMap(blindMapPath, blindMap);
  }
  const blindMapSha256 = sha256File(blindMapPath);
  const selectionSha256 = sha256File(selectionPath);

  const pendingIds = targetIds.filter((id) => !itemsManifest[id]);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `iketeru-p3-${runId}-`));
  const runtimeFailures = [];
  let abortedByBotCheck = false;
  let downloadsDone = 0;

  function saveManifest() {
    const manifest = {
      phase: "phase3_c",
      run_id: runId,
      split: `${priority}_batch_${String(batchIndex).padStart(2, "0")}`,
      priority,
      batch_index: batchIndex,
      dataset_file: path.relative(REPO_ROOT, selectionPath).replace(/\\/g, "/"),
      dataset_sha256: selectionSha256,
      prompt_version: promptVersion,
      expected_model: expectedModel,
      frozen_config: frozenCfg,
      created_at: new Date().toISOString(),
      blind_id_map_path: blindMapPath,
      blind_id_map_sha256: blindMapSha256,
      target_count: targetIds.length,
      prepared_count: Object.keys(itemsManifest).length,
      aborted_by_bot_check: abortedByBotCheck,
      runtime_failures: runtimeFailures,
      items: itemsManifest,
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2).replace(/\r\n/g, "\n") + "\n", "utf8");
  }

  // Step A: Download any uncached files strictly sequentially with 15-30s random wait
  const uncachedIds = pendingIds.filter((id) => !findCachedFile(id));
  for (const videoId of uncachedIds) {
    const meta = itemById.get(videoId);
    const blindId = blindMap.video_to_blind[videoId];
    if (meta.likely_fetch_blocked) {
      runtimeFailures.push({ video_id: videoId, blind_id: blindId, error: `skipped_likely_blocked:${meta.platform}:${meta.embed_status}` });
      continue;
    }
    try {
      if (downloadsDone > 0) {
        const waitSec = Math.round(minWaitSec + Math.random() * Math.max(0, maxWaitSec - minWaitSec));
        console.log(`  [gentle-wait] waiting ${waitSec}s before next unauthenticated download...`);
        await new Promise((r) => setTimeout(r, waitSec * 1000));
      }
      await downloadToCacheGently(meta);
      downloadsDone++;
    } catch (e) {
      const msg = (e.stderr || e.message || String(e)).replace(/\s+/g, " ").trim().slice(0, 220);
      console.error(`[DOWNLOAD FAIL] ${videoId}: ${msg}`);
      runtimeFailures.push({ video_id: videoId, blind_id: blindId, error: msg });
      if (e.isBotCheck || isBotCheckError(msg)) {
        abortedByBotCheck = true;
        saveManifest();
        console.error("[ABORT] Bot-check / rate-limit detected. Stopping immediately (no bypass).");
        process.exit(2);
      }
    }
  }

  // Step B: Locally process & stage all available cached files with bounded CPU concurrency
  const readyIds = pendingIds.filter((id) => Boolean(findCachedFile(id)));
  let nextIdx = 0;

  async function processOne(videoId) {
    const meta = itemById.get(videoId);
    const blindId = blindMap.video_to_blind[videoId];
    const srcPath = findCachedFile(videoId);
    const sourceMethod = uncachedIds.includes(videoId) ? "ytdlp_unauthenticated_gentle_cache" : "local_cache";

    try {
      const sourceSha256 = sha256File(srcPath);
      const srcInfo = await ffprobeInfo(srcPath);
      const durationSec = Math.round(parseFloat(srcInfo.format.duration) * 10) / 10;
      const vStream = (srcInfo.streams || []).find((s) => s.codec_type === "video") || {};
      const aStream = (srcInfo.streams || []).find((s) => s.codec_type === "audio") || null;
      const hasAudio = Boolean(aStream);
      const canStreamCopy =
        srcPath.toLowerCase().endsWith(".mp4") &&
        vStream.codec_name === "h264" &&
        (!aStream || aStream.codec_name === "aac");

      const { cuts, integratedLufs } = await measureScdetAndLufs(srcPath, hasAudio);
      const totalCuts = cuts.length;
      const avgCutIntervalSec =
        totalCuts > 0
          ? Math.round((durationSec / totalCuts) * 100) / 100
          : Math.round(durationSec * 100) / 100;
      const w10 = findMaxCutWindow(cuts, durationSec, 10);
      const maxCutsPer10s = w10.count;

      let slowmoApplied = false;
      let slowmoFactor = null;
      let slowmoWindowSec = null;
      if (maxCutsPer10s >= 12) {
        const w5 = findMaxCutWindow(cuts, durationSec, 5);
        slowmoApplied = true;
        slowmoFactor = "4x";
        slowmoWindowSec = [w5.start, w5.end];
      } else if (maxCutsPer10s >= 6) {
        slowmoApplied = true;
        slowmoFactor = "2x";
        slowmoWindowSec = [w10.start, w10.end];
      } else if (meta.routing_genre === "モーション") {
        const st = Math.max(0, Math.floor((durationSec - 10) / 2));
        const en = Math.min(durationSec, st + 10);
        if (en > st) {
          slowmoApplied = true;
          slowmoFactor = "2x";
          slowmoWindowSec = [st, en];
        }
      }

      const videoBlindDir = path.join(BLIND_ROOT, runId, "video", blindId);
      fs.mkdirSync(videoBlindDir, { recursive: true });
      const stagedVideoMain = path.join(videoBlindDir, `${blindId}.mp4`);
      await stageCleanMp4(srcPath, stagedVideoMain, canStreamCopy, tmpDir);
      const leakedMain = await verifyMetadataStripped(stagedVideoMain);
      if (leakedMain.length > 0) {
        throw new Error(`Metadata strip incomplete on ${stagedVideoMain}: ${leakedMain.join(", ")}`);
      }
      const stagedVideoFiles = [
        { path: stagedVideoMain, sha256: sha256File(stagedVideoMain), size_bytes: fs.statSync(stagedVideoMain).size },
      ];
      if (slowmoApplied) {
        const stagedVideoSlow = path.join(videoBlindDir, `${blindId}_slow.mp4`);
        await generateSlowMoMp4(
          srcPath,
          slowmoWindowSec[0],
          Math.max(0.5, slowmoWindowSec[1] - slowmoWindowSec[0]),
          slowmoFactor === "4x" ? 4 : 2,
          stagedVideoSlow,
          tmpDir
        );
        const leakedSlow = await verifyMetadataStripped(stagedVideoSlow);
        if (leakedSlow.length > 0) {
          throw new Error(`Metadata strip incomplete on ${stagedVideoSlow}: ${leakedSlow.join(", ")}`);
        }
        stagedVideoFiles.push({
          path: stagedVideoSlow,
          sha256: sha256File(stagedVideoSlow),
          size_bytes: fs.statSync(stagedVideoSlow).size,
        });
      }

      const csBlindDir = path.join(BLIND_ROOT, runId, "contact_sheet", blindId);
      fs.mkdirSync(csBlindDir, { recursive: true });
      const numSheets = durationSec <= 120 ? 1 : durationSec <= 300 ? 2 : 3;
      const stagedCsFiles = [];
      for (let s = 0; s < numSheets; s++) {
        const segStart = (s * durationSec) / numSheets;
        const segLen = durationSec / numSheets;
        const outJpg = path.join(csBlindDir, `${blindId}_sheet_${String(s + 1).padStart(2, "0")}.jpg`);
        await generateContactSheet(srcPath, segStart, segLen, outJpg);
        stagedCsFiles.push({ path: outJpg, sha256: sha256File(outJpg), size_bytes: fs.statSync(outJpg).size });
      }
      if (slowmoApplied) {
        const denseJpg = path.join(csBlindDir, `${blindId}_sheet_dense.jpg`);
        await generateContactSheet(
          srcPath,
          slowmoWindowSec[0],
          Math.max(0.5, slowmoWindowSec[1] - slowmoWindowSec[0]),
          denseJpg
        );
        stagedCsFiles.push({ path: denseJpg, sha256: sha256File(denseJpg), size_bytes: fs.statSync(denseJpg).size });
      }

      const metrics = {
        duration_sec: durationSec,
        scdet_threshold: 10,
        total_cuts: totalCuts,
        avg_cut_interval_sec: avgCutIntervalSec,
        max_cuts_per_10s: maxCutsPer10s,
        integrated_lufs: integratedLufs,
        slowmo_applied: slowmoApplied,
        slowmo_factor: slowmoFactor,
        slowmo_window_sec: slowmoWindowSec,
      };

      const h1Decision = decidePhase1Route({ genre: meta.routing_genre, ...metrics });

      const videoSpec = {
        version: promptVersion,
        runId,
        blindId,
        mode: "video",
        assignedFiles: stagedVideoFiles.map((x) => x.path),
        metrics,
      };
      const csSpec = {
        version: promptVersion,
        runId,
        blindId,
        mode: "contact_sheet",
        assignedFiles: stagedCsFiles.map((x) => x.path),
        metrics,
      };
      renderCalibrationPrompt(videoSpec);
      renderCalibrationPrompt(csSpec);

      fs.writeFileSync(path.join(specsDir, `${videoId}_video.json`), JSON.stringify(videoSpec, null, 2) + "\n", "utf8");
      fs.writeFileSync(
        path.join(specsDir, `${videoId}_contact_sheet.json`),
        JSON.stringify(csSpec, null, 2) + "\n",
        "utf8"
      );

      itemsManifest[videoId] = {
        video_id: videoId,
        blind_id: blindId,
        genre_bucket: meta.calibration_genre_bucket,
        routing_genre: meta.routing_genre,
        genre_verified: meta.genre_verified,
        target_status_after_calibration: meta.target_status_after_calibration,
        source_method: sourceMethod,
        source_sha256: sourceSha256,
        metadata_stripped_verified: true,
        h1_pre_route: h1Decision,
        metrics,
        staged_files: {
          video: stagedVideoFiles,
          contact_sheet: stagedCsFiles,
        },
      };

      const done = Object.keys(itemsManifest).length;
      if (done % 10 === 0 || done === targetIds.length) {
        saveManifest();
      }
      console.log(
        `[${String(done).padStart(3, "0")}/${targetIds.length}] ${videoId} -> ${blindId} | ${meta.calibration_genre_bucket} | h1=${h1Decision.route} | dur=${durationSec}s | cuts=${totalCuts} | max10=${maxCutsPer10s} | lufs=${integratedLufs ?? "NA"}`
      );
    } catch (e) {
      const msg = (e.stderr || e.message || String(e)).replace(/\s+/g, " ").trim().slice(0, 220);
      console.error(`[STAGE FAIL] ${videoId}: ${msg}`);
      runtimeFailures.push({ video_id: videoId, blind_id: blindId, error: msg });
    }
  }

  try {
    const workers = Array.from({ length: concurrency }, async () => {
      while (nextIdx < readyIds.length) {
        const myIdx = nextIdx++;
        await processOne(readyIds[myIdx]);
      }
    });
    await Promise.all(workers);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    saveManifest();
  }

  const h1VideoCount = Object.values(itemsManifest).filter((x) => x.h1_pre_route?.route === "video").length;
  const h1CsCount = Object.values(itemsManifest).length - h1VideoCount;
  console.log(`\nWrote ${manifestPath}`);
  console.log(
    `Summary: run_id=${runId} prepared=${Object.keys(itemsManifest).length}/${targetIds.length} (h1_video=${h1VideoCount}, h1_contact_sheet=${h1CsCount}), failures=${runtimeFailures.length}`
  );
  if (runtimeFailures.length > 0) process.exit(1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
