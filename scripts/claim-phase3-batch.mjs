#!/usr/bin/env node
/**
 * Multi-machine claim/lease manager for Phase 3 C calibration batches.
 *
 * Allows N machines to run calibration batches concurrently with ZERO video-ID overlap:
 *  - Active claims live in `analysis/claims/<run_id>.json` (tracked in Git).
 *  - Before starting a new batch on ANY machine:
 *      1. `git pull`
 *      2. `node scripts/claim-phase3-batch.mjs --worker <machine_name> --priority <tier> --batch-size <N> [--id-list <path>]`
 *      3. `git add analysis/claims/<run_id>* && git commit -m "..." && git push`
 *         (If another machine pushed concurrently, `git pull --rebase` + `--verify` detects any conflict immediately.)
 *      4. Pass `--id-list analysis/claims/<run_id>_ids.json` to `prepare-phase3-batch.mjs`.
 *  - After TiDB apply finishes:
 *      `node scripts/claim-phase3-batch.mjs --complete <run_id>` and push.
 *
 * Does NOT modify any frozen Phase 2 scoring/calibration files.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CLAIMS_DIR = path.join(REPO_ROOT, "analysis", "claims");
const DEFAULT_CACHE_DIR = "D:\\マイドライブ\\iketeru_videos";
const MAX_BATCH_SIZE = 200;

let _dotenvLoaded = false;
function loadEnvOnce() {
  if (_dotenvLoaded) return;
  _dotenvLoaded = true;
  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  require("dotenv").config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
}

function getCacheDir() {
  loadEnvOnce();
  return process.env.IKETERU_VIDEO_CACHE_DIR || DEFAULT_CACHE_DIR;
}

function findCachedFile(id) {
  const cacheDir = getCacheDir();
  if (!fs.existsSync(cacheDir)) return null;
  for (const ext of [".mp4", ".mov", ".mkv", ".webm", ".m4v"]) {
    const p = path.join(cacheDir, `${id}${ext}`);
    if (fs.existsSync(p) && fs.statSync(p).size > 0) return p;
  }
  return null;
}

function isMediaReadable(filePath) {
  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "json", filePath],
      { encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "ignore"] }
    );
    const parsed = JSON.parse(out);
    const dur = parseFloat(parsed?.format?.duration);
    return Number.isFinite(dur) && dur > 0;
  } catch {
    return false;
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

function generateRunId() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `run_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function loadAllClaims() {
  if (!fs.existsSync(CLAIMS_DIR)) return [];
  const files = fs.readdirSync(CLAIMS_DIR).filter((f) => f.endsWith(".json") && !f.endsWith("_ids.json")).sort();
  return files.map((f) => {
    const full = path.join(CLAIMS_DIR, f);
    const data = JSON.parse(fs.readFileSync(full, "utf8"));
    return { file: f, path: full, data };
  });
}

function verifyActiveClaims(claims) {
  const active = claims.filter((c) => c.data.status === "active");
  const ownerById = new Map();
  const overlaps = [];
  for (const c of active) {
    for (const vid of c.data.video_ids || []) {
      const id = String(vid);
      if (ownerById.has(id)) {
        overlaps.push({ video_id: id, run_a: ownerById.get(id), run_b: c.data.run_id });
      } else {
        ownerById.set(id, c.data.run_id);
      }
    }
  }
  return { activeCount: active.length, totalLockedIds: ownerById.size, ownerById, overlaps };
}

async function fetchTidbVideos() {
  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  require("dotenv").config({ path: path.join(REPO_ROOT, ".env") });
  const mysql = require("mysql2/promise");
  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });
  try {
    const [rows] = await conn.query(`
      SELECT id, platform, videoUrl, genres, privateRating, calibratedScore, calibrationStatus
      FROM videos
      ORDER BY id ASC
    `);
    return rows;
  } finally {
    await conn.end();
  }
}

function isYoutubeRow(row) {
  if (String(row.platform || "").toLowerCase() === "youtube") return true;
  const u = row.videoUrl || "";
  return typeof u === "string" && (u.includes("youtube.com") || u.includes("youtu.be"));
}

async function main() {
  const args = parseArgs(process.argv);
  fs.mkdirSync(CLAIMS_DIR, { recursive: true });

  // 1. Register an existing active run directory as a claim
  if (args["register-run"]) {
    const runId = String(args["register-run"]);
    const worker = String(args["worker"] || os.hostname());
    const manifestPath = path.join(REPO_ROOT, "analysis", "runs", runId, "run_manifest.json");
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`run_manifest.json not found: ${manifestPath}`);
    }
    const rm = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const prepared = Array.isArray(rm.items) ? rm.items.map((x) => String(x.video_id)) : Object.keys(rm.items || {});
    const failed = (rm.runtime_failures || []).map((x) => String(x.video_id || x.id));
    const allIds = [...new Set([...prepared, ...failed])].sort();

    const claim = {
      schema_version: 1,
      run_id: runId,
      worker,
      priority: rm.priority || "P0_craft_recipes",
      batch_index: rm.batch_index || null,
      status: "active",
      claimed_at: rm.created_at || new Date().toISOString(),
      prepared_count: prepared.length,
      failed_count: failed.length,
      video_ids: allIds,
    };
    const outPath = path.join(CLAIMS_DIR, `${runId}.json`);
    fs.writeFileSync(outPath, JSON.stringify(claim, null, 2) + "\n", "utf8");

    const check = verifyActiveClaims(loadAllClaims());
    if (check.overlaps.length > 0) {
      throw new Error(`Overlap detected after registering ${runId}: ${JSON.stringify(check.overlaps.slice(0, 5))}`);
    }
    console.log(JSON.stringify({ registered: runId, worker, locked_ids: allIds.length, active_claims: check.activeCount, overlaps: 0 }, null, 2));
    return;
  }

  // 2. Complete/release an active claim
  if (args["complete"]) {
    const runId = String(args["complete"]);
    const claimPath = path.join(CLAIMS_DIR, `${runId}.json`);
    if (!fs.existsSync(claimPath)) {
      throw new Error(`Claim not found: ${claimPath}`);
    }
    const claim = JSON.parse(fs.readFileSync(claimPath, "utf8"));
    claim.status = "completed";
    claim.completed_at = new Date().toISOString();
    fs.writeFileSync(claimPath, JSON.stringify(claim, null, 2) + "\n", "utf8");
    console.log(JSON.stringify({ completed: runId, status: claim.status, completed_at: claim.completed_at }, null, 2));
    return;
  }

  // 2b. Release/cancel an active claim without completing it
  if (args["release"]) {
    const runId = typeof args["release"] === "string" ? args["release"] : String(args["run-id"] || "");
    if (!runId) {
      throw new Error("Usage: node scripts/claim-phase3-batch.mjs --release --run-id <run_id> [--reason <text>]");
    }
    const claimPath = path.join(CLAIMS_DIR, `${runId}.json`);
    if (!fs.existsSync(claimPath)) {
      throw new Error(`Claim not found: ${claimPath}`);
    }
    const claim = JSON.parse(fs.readFileSync(claimPath, "utf8"));
    const prevStatus = claim.status;
    claim.status = "released";
    claim.released_at = new Date().toISOString();
    claim.release_reason = String(args["reason"] || "manual_release");
    fs.writeFileSync(claimPath, JSON.stringify(claim, null, 2) + "\n", "utf8");
    console.log(JSON.stringify({
      released: runId,
      previous_status: prevStatus,
      status: claim.status,
      released_at: claim.released_at,
      release_reason: claim.release_reason,
      released_ids_count: (claim.video_ids || []).length,
    }, null, 2));
    return;
  }

  // 3. Verify all active claims have zero pairwise overlap
  if (args["verify"]) {
    const claims = loadAllClaims();
    const check = verifyActiveClaims(claims);
    console.log(JSON.stringify({
      total_claim_files: claims.length,
      active_claims: check.activeCount,
      total_locked_ids: check.totalLockedIds,
      overlaps_count: check.overlaps.length,
      overlaps_sample: check.overlaps.slice(0, 10),
    }, null, 2));
    if (check.overlaps.length > 0) process.exit(1);
    return;
  }

  // 4. Status across TiDB + active claims
  if (args["status"]) {
    const claims = loadAllClaims();
    const check = verifyActiveClaims(claims);
    const rows = await fetchTidbVideos();
    const byId = new Map(rows.map((r) => [String(r.id), r]));

    const craftPath = path.join(REPO_ROOT, "analysis", "phase3_craft_recipes_target_ids.json");
    let craftUnclaimedYt = 0;
    let craftUnclaimedOther = 0;
    if (fs.existsSync(craftPath)) {
      const doc = JSON.parse(fs.readFileSync(craftPath, "utf8"));
      const ids = (Array.isArray(doc) ? doc : doc.video_ids || []).map(String);
      for (const vid of ids) {
        const r = byId.get(vid);
        if (!r || r.calibratedScore != null || check.ownerById.has(vid)) continue;
        if (isYoutubeRow(r)) craftUnclaimedYt++;
        else craftUnclaimedOther++;
      }
    }

    let p1UnclaimedYt = 0;
    let p1UnclaimedOther = 0;
    let totalUncalYt = 0;
    for (const r of rows) {
      if (r.calibratedScore != null) continue;
      const vid = String(r.id);
      if (check.ownerById.has(vid)) continue;
      const yt = isYoutubeRow(r);
      if (yt) totalUncalYt++;
      if (r.privateRating != null) {
        if (yt) p1UnclaimedYt++;
        else p1UnclaimedOther++;
      }
    }

    console.log(JSON.stringify({
      active_claims: claims.filter((c) => c.data.status === "active").map((c) => ({
        run_id: c.data.run_id,
        worker: c.data.worker,
        priority: c.data.priority,
        locked_ids: (c.data.video_ids || []).length,
      })),
      overlaps_count: check.overlaps.length,
      available_unclaimed_pools: {
        P0_craft_recipes_youtube: craftUnclaimedYt,
        P0_craft_recipes_non_youtube: craftUnclaimedOther,
        P1_private_rating_youtube: p1UnclaimedYt,
        P1_private_rating_non_youtube: p1UnclaimedOther,
        all_remaining_uncalibrated_youtube: totalUncalYt,
      },
    }, null, 2));
    return;
  }

  // 5. Create a new disjoint claim for a machine
  if (args["claim"]) {
    const worker = String(args["worker"] || os.hostname());
    const priority = String(args["priority"] || "P1_private_rating");
    const batchSize = Math.max(1, Math.min(MAX_BATCH_SIZE, parseInt(args["batch-size"] || "200", 10)));
    const batchIndex = args["batch-index"] ? parseInt(args["batch-index"], 10) : null;
    const runId = String(args["run-id"] || generateRunId());
    const idListPath = args["id-list"] ? path.resolve(REPO_ROOT, String(args["id-list"])) : null;
    const nonYoutube = Boolean(args["non-youtube"]);
    const cachedOnly = Boolean(args["cached-only"]);
    const verifyMedia = Boolean(args["verify-media"]);
    const dryRun = Boolean(args["dry-run"]);
    const cacheDir = getCacheDir();

    const claims = loadAllClaims();
    const check = verifyActiveClaims(claims);
    if (check.overlaps.length > 0) {
      throw new Error(`Existing active claims have overlaps! Fix first: ${JSON.stringify(check.overlaps.slice(0, 5))}`);
    }

    const rows = await fetchTidbVideos();
    const byId = new Map(rows.map((r) => [String(r.id), r]));
    const candidates = [];
    const unreadableSkipped = [];
    const matchesPlatform = (r) => (nonYoutube ? !isYoutubeRow(r) : isYoutubeRow(r));
    const passesCacheFilter = (vid) => {
      if (!cachedOnly) return true;
      const p = findCachedFile(vid);
      if (!p) return false;
      if (verifyMedia && !isMediaReadable(p)) {
        unreadableSkipped.push(vid);
        return false;
      }
      return true;
    };

    if (priority === "P0_craft_recipes") {
      const targetPath = idListPath || path.join(REPO_ROOT, "analysis", "phase3_craft_recipes_target_ids.json");
      const doc = JSON.parse(fs.readFileSync(targetPath, "utf8"));
      const ids = (Array.isArray(doc) ? doc : doc.video_ids || []).map(String);
      for (const vid of ids) {
        const r = byId.get(vid);
        if (!r || r.calibratedScore != null || check.ownerById.has(vid)) continue;
        if (!matchesPlatform(r)) continue;
        if (!passesCacheFilter(vid)) continue;
        candidates.push(vid);
      }
    } else if (priority === "P1_private_rating") {
      for (const r of rows) {
        const vid = String(r.id);
        if (r.privateRating == null || r.calibratedScore != null || check.ownerById.has(vid)) continue;
        if (!matchesPlatform(r)) continue;
        if (!passesCacheFilter(vid)) continue;
        candidates.push(vid);
      }
    } else {
      for (const r of rows) {
        const vid = String(r.id);
        if (r.calibratedScore != null || check.ownerById.has(vid)) continue;
        if (!matchesPlatform(r)) continue;
        if (!passesCacheFilter(vid)) continue;
        candidates.push(vid);
      }
    }

    const chosen = candidates.slice(0, batchSize);
    if (chosen.length === 0) {
      console.log(JSON.stringify({ message: "No matching unclaimed uncalibrated videos available for this priority/filter.", priority, non_youtube: nonYoutube, cached_only: cachedOnly, verify_media: verifyMedia, cache_dir: cacheDir, active_locked: check.totalLockedIds }, null, 2));
      return;
    }

    let youtubeCount = 0;
    let nonYoutubeCount = 0;
    let cachedMatchCount = 0;
    const platformBreakdown = {};
    for (const vid of chosen) {
      const r = byId.get(vid);
      if (isYoutubeRow(r)) youtubeCount++;
      else nonYoutubeCount++;
      if (findCachedFile(vid)) cachedMatchCount++;
      const pKey = String(r?.platform || "unknown").toLowerCase();
      platformBreakdown[pKey] = (platformBreakdown[pKey] || 0) + 1;
    }

    const claim = {
      schema_version: 1,
      run_id: runId,
      worker,
      priority,
      batch_index: batchIndex,
      filters: { non_youtube: nonYoutube, cached_only: cachedOnly, verify_media: verifyMedia },
      status: "active",
      claimed_at: new Date().toISOString(),
      video_ids: chosen,
    };

    if (!dryRun) {
      fs.writeFileSync(path.join(CLAIMS_DIR, `${runId}.json`), JSON.stringify(claim, null, 2) + "\n", "utf8");
      fs.writeFileSync(
        path.join(CLAIMS_DIR, `${runId}_ids.json`),
        JSON.stringify({ run_id: runId, worker, priority, batch_index: batchIndex, video_ids: chosen }, null, 2) + "\n",
        "utf8"
      );
    }

    const effectiveBatch = batchIndex ?? 1;
    const noDlFlag = cachedOnly ? " --no-download" : "";
    console.log(JSON.stringify({
      dry_run: dryRun,
      run_id: runId,
      worker,
      priority,
      batch_index: batchIndex,
      cache_dir: cacheDir,
      filters: { non_youtube: nonYoutube, cached_only: cachedOnly, verify_media: verifyMedia },
      claimed_count: chosen.length,
      youtube_count: youtubeCount,
      non_youtube_count: nonYoutubeCount,
      cached_match_count: cachedMatchCount,
      unreadable_skipped_count: unreadableSkipped.length,
      platform_breakdown: platformBreakdown,
      remaining_unclaimed_in_pool: candidates.length - chosen.length,
      claim_file: `analysis/claims/${runId}.json`,
      id_list_file: `analysis/claims/${runId}_ids.json`,
      next_prepare_cmd: `node scripts/prepare-phase3-batch.mjs --priority ${priority} --id-list analysis/claims/${runId}_ids.json --batch ${effectiveBatch} --batch-size ${chosen.length} --uncalibrated-head --run-id ${runId} --frozen-config analysis/phase2_frozen_config_v1.json${noDlFlag}`,
    }, null, 2));
    return;
  }

  console.log(`Usage:
  node scripts/claim-phase3-batch.mjs --status
  node scripts/claim-phase3-batch.mjs --verify
  node scripts/claim-phase3-batch.mjs --register-run <run_id> [--worker <name>]
  node scripts/claim-phase3-batch.mjs --claim --worker <name> --priority <P0_craft_recipes|P1_private_rating|ALL> [--batch-size 200] [--batch-index <N>] [--non-youtube] [--cached-only] [--verify-media] [--dry-run]
  node scripts/claim-phase3-batch.mjs --complete <run_id>
  node scripts/claim-phase3-batch.mjs --release --run-id <run_id> [--reason <text>]`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
