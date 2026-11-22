import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REPO_ROOT = "E:\\iketeru-eizou";
const CACHE_DIR = "D:\\マイドライブ\\iketeru_videos";

const bench = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "analysis", "golden_benchmark.json"), "utf8"));
const split = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "analysis", "benchmark_split.json"), "utf8"));

const splitRoleMap = new Map();
for (const id of split.dev_craft_ids) splitRoleMap.set(id, "dev_craft");
for (const id of split.holdout_craft_ids) splitRoleMap.set(id, "holdout_craft");
for (const id of split.dev_non_award_ids) splitRoleMap.set(id, "dev_non_award");
for (const id of split.holdout_non_award_ids) splitRoleMap.set(id, "holdout_non_award");
for (const id of split.reference_only_ids) splitRoleMap.set(id, "reference_only");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "iketeru-prefetch-83-"));

function findCachedFile(id) {
  if (!fs.existsSync(CACHE_DIR)) return null;
  for (const ext of [".mp4", ".mov", ".mkv", ".webm", ".m4v"]) {
    const p = path.join(CACHE_DIR, `${id}${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function ffprobeFile(filePath) {
  const { stdout } = await execFileAsync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration,size:stream=width,height,codec_type", "-of", "json", filePath],
    { timeout: 20000 }
  );
  const data = JSON.parse(stdout);
  const vStream = (data.streams || []).find(s => s.codec_type === "video") || {};
  return {
    duration_sec: data.format?.duration ? Math.round(parseFloat(data.format.duration) * 10) / 10 : null,
    file_size_bytes: data.format?.size ? parseInt(data.format.size, 10) : fs.statSync(filePath).size,
    width: vStream.width || null,
    height: vStream.height || null,
  };
}

async function checkOne(item) {
  const rec = {
    id: item.id,
    title: item.title,
    platform: item.platform,
    videoUrl: item.videoUrl,
    genre_bucket: item.genre_bucket,
    craft_or_purpose: item.craft_or_purpose,
    split_role: splitRoleMap.get(item.id) || "unknown",
    embed_status: item.embed_status,
    source_method: null,
    fetchable: false,
    actual_download_verified: false,
    duration_sec: null,
    file_size_bytes: null,
    width: null,
    height: null,
    error: null,
  };

  // 1. Check local cache first
  const cached = findCachedFile(item.id);
  if (cached) {
    try {
      const info = await ffprobeFile(cached);
      rec.source_method = "local_cache";
      rec.fetchable = info.file_size_bytes > 0;
      rec.actual_download_verified = true;
      rec.duration_sec = info.duration_sec;
      rec.file_size_bytes = info.file_size_bytes;
      rec.width = info.width;
      rec.height = info.height;
      return rec;
    } catch (e) {
      rec.error = `Cache ffprobe failed: ${e.message}`;
    }
  }

  // 2. For embedStatus = restricted, ALWAYS perform an actual full download via yt-dlp & ffprobe
  const url = item.platform === "vimeo"
    ? `https://player.vimeo.com/video/${item.id}`
    : `https://www.youtube.com/watch?v=${item.id}`;
  const extraArgs = item.platform === "vimeo" ? ["--referer", "https://iketeru-eizou.vercel.app/"] : [];

  if (item.embed_status === "restricted") {
    const outFile = path.join(tmpDir, `${item.id}.mp4`);
    try {
      await execFileAsync(
        "yt-dlp",
        [...extraArgs, "-f", "18/best[height<=480][ext=mp4]/worst[ext=mp4]/best", "--no-warnings", "-o", outFile, url],
        { timeout: 90000 }
      );
      if (fs.existsSync(outFile)) {
        const info = await ffprobeFile(outFile);
        rec.source_method = "ytdlp_actual_download";
        rec.fetchable = info.file_size_bytes > 0;
        rec.actual_download_verified = true;
        rec.duration_sec = info.duration_sec;
        rec.file_size_bytes = info.file_size_bytes;
        rec.width = info.width;
        rec.height = info.height;
        fs.unlinkSync(outFile);
        return rec;
      }
      rec.error = "Actual download finished but file missing";
      return rec;
    } catch (e) {
      rec.source_method = "ytdlp_actual_download";
      rec.error = (e.stderr || e.message || "").toString().replace(/\s+/g, " ").trim().slice(0, 220);
      return rec;
    }
  }

  // 3. For non-restricted non-cached videos, run yt-dlp --simulate to verify fetchability + exact duration/size/res for format 18/<=480p
  try {
    const { stdout } = await execFileAsync(
      "yt-dlp",
      [
        ...extraArgs,
        "-f", "18/best[height<=480][ext=mp4]/worst[ext=mp4]/best",
        "--simulate",
        "--no-warnings",
        "--print", "%(duration)s|%(filesize,filesize_approx)s|%(width)s|%(height)s",
        url,
      ],
      { timeout: 45000 }
    );
    const line = stdout.trim().split(/\r?\n/).pop() || "";
    const [durStr, sizeStr, wStr, hStr] = line.split("|");
    rec.source_method = "ytdlp_simulate";
    rec.fetchable = true;
    rec.actual_download_verified = false;
    rec.duration_sec = durStr && durStr !== "NA" ? Math.round(parseFloat(durStr) * 10) / 10 : null;
    rec.file_size_bytes = sizeStr && sizeStr !== "NA" ? parseInt(sizeStr, 10) : null;
    rec.width = wStr && wStr !== "NA" ? parseInt(wStr, 10) : null;
    rec.height = hStr && hStr !== "NA" ? parseInt(hStr, 10) : null;
    return rec;
  } catch (e) {
    rec.source_method = "ytdlp_simulate";
    rec.error = (e.stderr || e.message || "").toString().replace(/\s+/g, " ").trim().slice(0, 220);
    return rec;
  }
}

// Run with concurrency 4
const CONCURRENCY = 4;
const results = new Array(bench.length);
let nextIdx = 0;

async function worker() {
  while (true) {
    const i = nextIdx++;
    if (i >= bench.length) break;
    const item = bench[i];
    const r = await checkOne(item);
    results[i] = r;
    const mb = r.file_size_bytes ? `${(r.file_size_bytes / (1024 * 1024)).toFixed(2)}MB` : "NA";
    console.log(`[${String(i + 1).padStart(2, "0")}/${bench.length}] ${r.id.padEnd(13)} | ${r.split_role.padEnd(17)} | ok=${String(r.fetchable).padEnd(5)} | ${String(r.source_method).padEnd(21)} | dur=${String(r.duration_sec).padEnd(6)}s | size=${mb.padEnd(8)} | ${r.error || ""}`);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
fs.rmSync(tmpDir, { recursive: true, force: true });

const fetchableList = results.filter(r => r.fetchable);
const unfetchableList = results.filter(r => !r.fetchable);
const restrictedList = results.filter(r => r.embed_status === "restricted");
const over15mb = results.filter(r => (r.file_size_bytes || 0) > 15 * 1024 * 1024);

const out = {
  checked_at: new Date().toISOString(),
  total_checked: results.length,
  fetchable_count: fetchableList.length,
  unfetchable_count: unfetchableList.length,
  restricted_total: restrictedList.length,
  restricted_actual_download_verified: restrictedList.filter(r => r.fetchable && r.actual_download_verified).length,
  over_15mb_count: over15mb.length,
  over_15mb_ids: over15mb.map(r => ({ id: r.id, size_mb: +(r.file_size_bytes / (1024 * 1024)).toFixed(2), duration_sec: r.duration_sec })),
  excluded_from_both_modes: unfetchableList.map(r => ({
    id: r.id,
    title: r.title,
    split_role: r.split_role,
    genre_bucket: r.genre_bucket,
    reason: r.error || "Unfetchable via local cache or yt-dlp",
  })),
  results,
};

fs.writeFileSync(
  path.join(REPO_ROOT, "analysis", "benchmark_prefetch_check.json"),
  JSON.stringify(out, null, 2) + "\n",
  "utf8"
);

console.log("\n=== PREFETCH SUMMARY ===");
console.log(JSON.stringify({
  total_checked: out.total_checked,
  fetchable_count: out.fetchable_count,
  unfetchable_count: out.unfetchable_count,
  restricted_total: out.restricted_total,
  restricted_actual_download_verified: out.restricted_actual_download_verified,
  over_15mb_count: out.over_15mb_count,
  excluded_from_both_modes: out.excluded_from_both_modes,
}, null, 2));
