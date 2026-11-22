import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { sha256File } from "./audit-blind-transcript.mjs";
import {
  generateBlindIdMap,
  generateRunId,
  RUN_ID_REGEX,
  saveBlindIdMap,
} from "./lib/blind-id-map.mjs";
import { renderCalibrationPrompt } from "./lib/calibration-prompt-template.mjs";

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
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function ffprobeInfo(filePath) {
  const { stdout } = await execFileAsync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration,size:format_tags:stream=codec_type,codec_name,width,height:stream_tags", "-of", "json", filePath],
    { timeout: 30000 }
  );
  return JSON.parse(stdout);
}

async function measureScdetAndLufs(srcPath, hasAudio) {
  // 1. scdet=threshold=10:sc_pass=0
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

  // 2. ebur128 integrated LUFS
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
    // Strict > ensures earliest start time wins all ties
    if (c > bestCount) {
      bestCount = c;
      bestStart = t;
    }
  }
  return { count: Math.max(0, bestCount), start: bestStart, end: Math.min(Math.round(duration * 10) / 10, bestStart + W) };
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
    await remuxStripMetadata(srcPath, outPath);
    return;
  }
  const tmpEnc = path.join(tmpDir, `enc_${path.basename(outPath)}`);
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
      { timeout: 180000 }
    );
    await remuxStripMetadata(tmpEnc, outPath);
  } finally {
    if (fs.existsSync(tmpEnc)) fs.unlinkSync(tmpEnc);
  }
}

async function generateSlowMoMp4(srcPath, startSec, segLenSec, factorNum, outPath, tmpDir) {
  const tmpSlow = path.join(tmpDir, `slow_${path.basename(outPath)}`);
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
  const fTags = info.format?.tags || {};
  const badTags = [];
  for (const [k, v] of Object.entries(fTags)) {
    if (/creation_time|encoder|title|comment|artist|copyright/i.test(k)) {
      badTags.push(`format.${k}=${v}`);
    }
  }
  for (const s of (info.streams || [])) {
    const sTags = s.tags || {};
    for (const [k, v] of Object.entries(sTags)) {
      if (/creation_time|encoder|title|comment/i.test(k)) {
        badTags.push(`stream.${k}=${v}`);
      }
    }
  }
  return badTags;
}

async function downloadToTemp(item, tmpDir) {
  const outFile = path.join(tmpDir, `${item.id}.mp4`);
  const url = item.platform === "vimeo"
    ? `https://player.vimeo.com/video/${item.id}`
    : `https://www.youtube.com/watch?v=${item.id}`;
  const extraArgs = item.platform === "vimeo" ? ["--referer", "https://iketeru-eizou.vercel.app/"] : [];

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await execFileAsync(
        "yt-dlp",
        [...extraArgs, "-f", "18/best[height<=480][ext=mp4]/worst[ext=mp4]/best", "--no-warnings", "-o", outFile, url],
        { timeout: 180000 }
      );
      if (fs.existsSync(outFile) && fs.statSync(outFile).size > 0) return outFile;
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw new Error(`yt-dlp failed for ${item.id}`);
}

async function main() {
  const args = parseArgs(process.argv);
  const splitName = args["split"] || "dev";
  const promptVersion = args["prompt-version"] || "v1_baseline";
  const runId = args["run-id"] || generateRunId();
  const concurrency = parseInt(args["concurrency"] || "3", 10);
  const resume = Boolean(args["resume"]);

  if (!RUN_ID_REGEX.test(runId)) {
    throw new Error(`Invalid --run-id (expected ^run_\\d{8}_\\d{6}$): ${runId}`);
  }
  if (splitName !== "dev" && splitName !== "holdout") {
    throw new Error(`Invalid --split (expected dev or holdout): ${splitName}`);
  }

  const bench = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "analysis", "golden_benchmark.json"), "utf8"));
  const split = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "analysis", "benchmark_split.json"), "utf8"));
  const benchById = new Map(bench.map(x => [x.id, x]));

  const targetIds = splitName === "dev"
    ? [...split.dev_craft_ids, ...split.dev_non_award_ids]
    : [...split.holdout_craft_ids, ...split.holdout_non_award_ids];

  const runRepoDir = path.join(REPO_ROOT, "analysis", "runs", runId);
  const specsDir = path.join(runRepoDir, "specs");
  fs.mkdirSync(specsDir, { recursive: true });

  // 1. Load existing (if --resume) or generate and save blind_id_map.json OUTSIDE E:\iketeru_blind_eval\
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

  const pendingIds = targetIds.filter(id => !itemsManifest[id]);
  console.log(`Preparing run_id=${runId} split=${splitName} total=${targetIds.length} pending=${pendingIds.length} concurrency=${concurrency}`);
  console.log(`Using blind_id_map.json sha256=${blindMapSha256}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `iketeru-prep-${runId}-`));
  const runtimeFailures = [];
  let nextIdx = 0;

  async function processOne(videoId, idxNum) {
    const meta = benchById.get(videoId);
    const blindId = blindMap.video_to_blind[videoId];
    let tempDownloaded = null;

    try {
      // Acquire source file (cache first, else yt-dlp to OS temp dir)
      const cached = findCachedFile(videoId);
      let srcPath;
      let sourceMethod;
      if (cached) {
        srcPath = cached;
        sourceMethod = "local_cache";
      } else {
        tempDownloaded = await downloadToTemp(meta, tmpDir);
        srcPath = tempDownloaded;
        sourceMethod = "ytdlp_download";
      }

      const sourceSha256 = sha256File(srcPath);
      const srcInfo = await ffprobeInfo(srcPath);
      const durationSec = Math.round(parseFloat(srcInfo.format.duration) * 10) / 10;
      const vStream = (srcInfo.streams || []).find(s => s.codec_type === "video") || {};
      const aStream = (srcInfo.streams || []).find(s => s.codec_type === "audio") || null;
      const hasAudio = Boolean(aStream);
      const canStreamCopy =
        srcPath.toLowerCase().endsWith(".mp4") &&
        vStream.codec_name === "h264" &&
        (!aStream || aStream.codec_name === "aac");

      // Measure scdet & LUFS on ORIGINAL source
      const { cuts, integratedLufs } = await measureScdetAndLufs(srcPath, hasAudio);
      const totalCuts = cuts.length;
      const avgCutIntervalSec = totalCuts > 0
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
      } else if (meta.genre_bucket === "モーション") {
        const st = Math.max(0, Math.floor((durationSec - 10) / 2));
        const en = Math.min(durationSec, st + 10);
        slowmoApplied = true;
        slowmoFactor = "2x";
        slowmoWindowSec = [st, en];
      }

      // Stage isolated video files (metadata stripped!)
      const videoBlindDir = path.join(BLIND_ROOT, runId, "video", blindId);
      fs.mkdirSync(videoBlindDir, { recursive: true });
      const stagedVideoMain = path.join(videoBlindDir, `${blindId}.mp4`);
      await stageCleanMp4(srcPath, stagedVideoMain, canStreamCopy, tmpDir);
      const leakedTagsMain = await verifyMetadataStripped(stagedVideoMain);
      if (leakedTagsMain.length > 0) {
        throw new Error(`Metadata strip incomplete on ${stagedVideoMain}: ${leakedTagsMain.join(", ")}`);
      }

      const stagedVideoFiles = [
        {
          path: stagedVideoMain,
          sha256: sha256File(stagedVideoMain),
          size_bytes: fs.statSync(stagedVideoMain).size,
        },
      ];

      if (slowmoApplied) {
        const stagedVideoSlow = path.join(videoBlindDir, `${blindId}_slow.mp4`);
        const factorNum = slowmoFactor === "4x" ? 4 : 2;
        await generateSlowMoMp4(
          srcPath,
          slowmoWindowSec[0],
          Math.max(0.5, slowmoWindowSec[1] - slowmoWindowSec[0]),
          factorNum,
          stagedVideoSlow,
          tmpDir
        );
        const leakedTagsSlow = await verifyMetadataStripped(stagedVideoSlow);
        if (leakedTagsSlow.length > 0) {
          throw new Error(`Metadata strip incomplete on ${stagedVideoSlow}: ${leakedTagsSlow.join(", ")}`);
        }
        stagedVideoFiles.push({
          path: stagedVideoSlow,
          sha256: sha256File(stagedVideoSlow),
          size_bytes: fs.statSync(stagedVideoSlow).size,
        });
      }

      // Stage isolated contact-sheet files (metadata stripped!)
      const csBlindDir = path.join(BLIND_ROOT, runId, "contact_sheet", blindId);
      fs.mkdirSync(csBlindDir, { recursive: true });
      const numSheets = durationSec <= 120 ? 1 : (durationSec <= 300 ? 2 : 3);
      const stagedCsFiles = [];
      for (let s = 0; s < numSheets; s++) {
        const segStart = (s * durationSec) / numSheets;
        const segLen = durationSec / numSheets;
        const sheetName = `${blindId}_sheet_${String(s + 1).padStart(2, "0")}.jpg`;
        const outJpg = path.join(csBlindDir, sheetName);
        await generateContactSheet(srcPath, segStart, segLen, outJpg);
        stagedCsFiles.push({
          path: outJpg,
          sha256: sha256File(outJpg),
          size_bytes: fs.statSync(outJpg).size,
        });
      }
      if (slowmoApplied) {
        const denseJpg = path.join(csBlindDir, `${blindId}_sheet_dense.jpg`);
        await generateContactSheet(
          srcPath,
          slowmoWindowSec[0],
          Math.max(0.5, slowmoWindowSec[1] - slowmoWindowSec[0]),
          denseJpg
        );
        stagedCsFiles.push({
          path: denseJpg,
          sha256: sha256File(denseJpg),
          size_bytes: fs.statSync(denseJpg).size,
        });
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

      // Build and validate prompt specs for BOTH modes
      const videoSpec = {
        version: promptVersion,
        runId,
        blindId,
        mode: "video",
        assignedFiles: stagedVideoFiles.map(x => x.path),
        metrics,
      };
      const csSpec = {
        version: promptVersion,
        runId,
        blindId,
        mode: "contact_sheet",
        assignedFiles: stagedCsFiles.map(x => x.path),
        metrics,
      };
      // Render-check both immediately to guarantee template compliance
      renderCalibrationPrompt(videoSpec);
      renderCalibrationPrompt(csSpec);

      fs.writeFileSync(path.join(specsDir, `${videoId}_video.json`), JSON.stringify(videoSpec, null, 2) + "\n", "utf8");
      fs.writeFileSync(path.join(specsDir, `${videoId}_contact_sheet.json`), JSON.stringify(csSpec, null, 2) + "\n", "utf8");

      itemsManifest[videoId] = {
        video_id: videoId,
        blind_id: blindId,
        split_role: split.dev_craft_ids.includes(videoId)
          ? "dev_craft"
          : split.dev_non_award_ids.includes(videoId)
            ? "dev_non_award"
            : split.holdout_craft_ids.includes(videoId)
              ? "holdout_craft"
              : "holdout_non_award",
        genre_bucket: meta.genre_bucket,
        source_method: sourceMethod,
        source_sha256: sourceSha256,
        metadata_stripped_verified: true,
        metrics,
        staged_files: {
          video: stagedVideoFiles,
          contact_sheet: stagedCsFiles,
        },
      };

      console.log(
        `[${String(idxNum + 1).padStart(2, "0")}/${targetIds.length}] ${videoId.padEnd(13)} -> ${blindId} | dur=${String(durationSec).padEnd(6)}s | cuts=${String(totalCuts).padEnd(3)} | max10=${String(maxCutsPer10s).padEnd(2)} | slow=${slowmoApplied ? slowmoFactor : "no"} | lufs=${integratedLufs ?? "NA"} | cs=${stagedCsFiles.length}`
      );
    } catch (e) {
      const msg = (e.stderr || e.message || String(e)).replace(/\s+/g, " ").trim().slice(0, 220);
      console.error(`[FAIL] ${videoId}: ${msg}`);
      runtimeFailures.push({ video_id: videoId, blind_id: blindId, error: msg });
    } finally {
      if (tempDownloaded && fs.existsSync(tempDownloaded)) {
        fs.unlinkSync(tempDownloaded);
      }
    }
  }

  async function worker() {
    while (true) {
      const i = nextIdx++;
      if (i >= pendingIds.length) break;
      await processOne(pendingIds[i], i);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const expectedModel = args["expected-model"] || split.frozen_scoring_config?.model || "gemini-4-neon-high";

  const manifest = {
    run_id: runId,
    split: splitName,
    prompt_version: promptVersion,
    expected_model: expectedModel,
    created_at: new Date().toISOString(),
    blind_id_map_path: blindMapPath,
    blind_id_map_sha256: blindMapSha256,
    target_count: targetIds.length,
    prepared_count: Object.keys(itemsManifest).length,
    runtime_failures: runtimeFailures,
    items: itemsManifest,
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`\nWrote ${manifestPath}`);
  console.log(`Summary: prepared=${manifest.prepared_count}/${manifest.target_count}, failures=${runtimeFailures.length}`);
  if (runtimeFailures.length > 0) process.exit(1);
}

main();
