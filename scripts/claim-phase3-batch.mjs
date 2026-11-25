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
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { classifyVideoForCalibration } from "./dryrun-phase3-calibration-rollout.mjs";
import { isBotCheckError } from "./prepare-phase2-run.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CLAIMS_DIR = path.join(REPO_ROOT, "analysis", "claims");
const SKIP_LIST_PATH = path.join(CLAIMS_DIR, "_skip_list.json");
const APPLY_LOCK_PATH = path.join(CLAIMS_DIR, "_apply_lock.json");
const PRIMARY_WORKER = "chibatmute";
const DEFAULT_RETRY_COOLDOWN_DAYS = 7;
const DEFAULT_CACHE_DIR = "D:\\マイドライブ\\iketeru_videos";
const MAX_BATCH_SIZE = 200;

export const VALID_PRIORITIES = Object.freeze([
  "P0_craft_recipes",
  "P1_private_rating",
  "P2_verified_5_genres",
  "P3_unverified_genres",
  "ALL",
]);

export function validatePriority(priority) {
  const p = String(priority || "");
  if (!VALID_PRIORITIES.includes(p)) {
    throw new Error(
      `Invalid --priority "${p}". Allowed values: ${VALID_PRIORITIES.join(", ")}.`
    );
  }
  return p;
}

let _dotenvLoaded = false;
function loadEnvOnce() {
  if (_dotenvLoaded) return;
  _dotenvLoaded = true;
  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  require("dotenv").config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
}

function resolveWorkerName(argWorker) {
  loadEnvOnce();
  const name = String(argWorker || process.env.IKETERU_WORKER_NAME || "").trim();
  if (!name) {
    throw new Error(
      "Worker name is required: pass --worker <name> or set IKETERU_WORKER_NAME in .env / environment. " +
        "(OS hostname fallback is disabled because multiple PCs share hostname 'CHIBA-PC'.)"
    );
  }
  return name;
}

function loadApplyLock() {
  if (!fs.existsSync(APPLY_LOCK_PATH)) {
    return {
      schema_version: 1,
      status: "unlocked",
      worker: null,
      run_id: null,
      started_at: null,
    };
  }
  return JSON.parse(fs.readFileSync(APPLY_LOCK_PATH, "utf8"));
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
  const files = fs
    .readdirSync(CLAIMS_DIR)
    .filter((f) => f.endsWith(".json") && !f.endsWith("_ids.json") && !f.startsWith("_"))
    .sort();
  return files.map((f) => {
    const full = path.join(CLAIMS_DIR, f);
    const data = JSON.parse(fs.readFileSync(full, "utf8"));
    return { file: f, path: full, data };
  });
}

function loadSkipList(nowMs = Date.now()) {
  const empty = { schema_version: 1, updated_at: null, entries: [] };
  const doc = fs.existsSync(SKIP_LIST_PATH)
    ? JSON.parse(fs.readFileSync(SKIP_LIST_PATH, "utf8"))
    : empty;
  const entries = Array.isArray(doc.entries) ? doc.entries : [];
  const permanentIds = new Set();
  const waitingRetryIds = new Set();
  const retryableNowIds = new Set();
  const needsReviewIds = new Set();

  for (const e of entries) {
    const vid = String(e.video_id || "");
    if (!vid) continue;
    const retryPolicy = e.retry_policy || "permanent";
    const retryCount = Number(e.retry_count || 0);
    if (retryPolicy === "needs_review") {
      // Do NOT exclude from available pools until manually approved as "permanent"
      needsReviewIds.add(vid);
    } else if (retryPolicy === "permanent" || retryCount >= 1) {
      permanentIds.add(vid);
    } else if (retryPolicy === "retry_once") {
      const retryAfterMs = e.retry_after ? Date.parse(e.retry_after) : NaN;
      if (Number.isFinite(retryAfterMs) && nowMs < retryAfterMs) {
        waitingRetryIds.add(vid);
      } else {
        retryableNowIds.add(vid);
      }
    } else {
      permanentIds.add(vid);
    }
  }

  const activeSkippedIds = new Set([...permanentIds, ...waitingRetryIds]);
  return { doc, entries, permanentIds, waitingRetryIds, retryableNowIds, needsReviewIds, activeSkippedIds };
}

function classifyFailureReason(errorMsg) {
  const s = String(errorMsg || "");
  if (isBotCheckError(s) || /BOT_CHECK_ABORT/i.test(s)) {
    return { category: "bot_check", retry_policy: "do_not_skip" };
  }
  if (/^skipped_likely_blocked/i.test(s)) {
    return { category: "likely_blocked", retry_policy: "needs_review" };
  }
  if (/requested format is not available/i.test(s)) {
    return { category: "format_unavailable", retry_policy: "retry_once" };
  }
  if (/this video is not available|video unavailable|private video|removed/i.test(s)) {
    return { category: "unavailable", retry_policy: "permanent" };
  }
  if (/invalid nal unit|missing picture|metadata strip|ffmpeg|h264|decode/i.test(s)) {
    return { category: "decode_corrupted", retry_policy: "permanent" };
  }
  return { category: "other_error", retry_policy: "retry_once" };
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
      SELECT id, platform, videoUrl, genres, purposes, expressions, directions,
             privateRating, aiOverallScore, aiOverallRating, embedStatus,
             calibratedScore, calibrationStatus
      FROM videos
      ORDER BY id ASC
    `);
    return rows;
  } finally {
    await conn.end();
  }
}

export function isYoutubeRow(row) {
  if (String(row.platform || "").toLowerCase() === "youtube") return true;
  const u = row.videoUrl || "";
  return typeof u === "string" && (u.includes("youtube.com") || u.includes("youtu.be"));
}

export function selectClaimCandidates({
  rows,
  priority,
  ownerById = new Map(),
  excludedSkipIds = new Set(),
  nonYoutube = false,
  p0TargetIds = null,
  passesCacheFilter = () => true,
}) {
  const validPriority = validatePriority(priority);
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const candidates = [];
  const matchesPlatform = (r) => (nonYoutube ? !isYoutubeRow(r) : isYoutubeRow(r));

  if (validPriority === "P0_craft_recipes") {
    const ids = (p0TargetIds || []).map(String);
    for (const vid of ids) {
      const r = byId.get(vid);
      if (!r || r.calibratedScore != null || ownerById.has(vid) || excludedSkipIds.has(vid)) continue;
      if (!matchesPlatform(r)) continue;
      if (!passesCacheFilter(vid)) continue;
      candidates.push(vid);
    }
  } else if (validPriority === "P1_private_rating") {
    for (const r of rows) {
      const vid = String(r.id);
      if (r.privateRating == null || r.calibratedScore != null || ownerById.has(vid) || excludedSkipIds.has(vid)) continue;
      if (!matchesPlatform(r)) continue;
      if (!passesCacheFilter(vid)) continue;
      candidates.push(vid);
    }
  } else if (validPriority === "P2_verified_5_genres" || validPriority === "P3_unverified_genres") {
    for (const r of rows) {
      const vid = String(r.id);
      if (r.calibratedScore != null || ownerById.has(vid) || excludedSkipIds.has(vid)) continue;
      if (!matchesPlatform(r)) continue;
      const cls = classifyVideoForCalibration(r);
      if (cls.priority_tier !== validPriority) continue;
      if (!passesCacheFilter(vid)) continue;
      candidates.push(vid);
    }
  } else if (validPriority === "ALL") {
    for (const r of rows) {
      const vid = String(r.id);
      if (r.calibratedScore != null || ownerById.has(vid) || excludedSkipIds.has(vid)) continue;
      if (!matchesPlatform(r)) continue;
      if (!passesCacheFilter(vid)) continue;
      candidates.push(vid);
    }
  }

  return candidates;
}

async function main() {
  const args = parseArgs(process.argv);
  fs.mkdirSync(CLAIMS_DIR, { recursive: true });

  // 0. Serialized TiDB write lock commands (analysis/claims/_apply_lock.json)
  if (args["apply-lock-status"]) {
    const lock = loadApplyLock();
    console.log(
      JSON.stringify(
        {
          lock_file: path.relative(REPO_ROOT, APPLY_LOCK_PATH).replace(/\\/g, "/"),
          ...lock,
        },
        null,
        2
      )
    );
    return;
  }

  if (args["acquire-apply-lock"]) {
    const runId = typeof args["acquire-apply-lock"] === "string"
      ? args["acquire-apply-lock"]
      : String(args["run-id"] || "");
    if (!runId) {
      throw new Error("Usage: node scripts/claim-phase3-batch.mjs --acquire-apply-lock <run_id> [--worker <name>]");
    }
    const worker = resolveWorkerName(args["worker"]);
    const existing = loadApplyLock();
    if (existing.status === "locked" && (existing.worker !== worker || existing.run_id !== runId)) {
      throw new Error(
        `TiDB apply lock is already held by worker='${existing.worker}' for run_id='${existing.run_id}' since ${existing.started_at}. ` +
          `Wait until that PC finishes and pushes the lock release before acquiring.`
      );
    }
    const nowIso = new Date().toISOString();
    const lockDoc = {
      schema_version: 1,
      status: "locked",
      worker,
      run_id: runId,
      started_at: existing.status === "locked" && existing.started_at ? existing.started_at : nowIso,
      updated_at: nowIso,
    };
    fs.writeFileSync(APPLY_LOCK_PATH, JSON.stringify(lockDoc, null, 2) + "\n", "utf8");
    console.log(
      JSON.stringify(
        {
          action: "acquired",
          lock_file: path.relative(REPO_ROOT, APPLY_LOCK_PATH).replace(/\\/g, "/"),
          ...lockDoc,
          next_steps: [
            "git add analysis/claims/_apply_lock.json",
            `git commit -m "Lock TiDB apply for ${runId} (${worker})"`,
            "git push   # MUST succeed before running apply-phase3-batch-to-tidb.mjs --apply",
          ],
        },
        null,
        2
      )
    );
    return;
  }

  if (args["release-apply-lock"]) {
    const runId = typeof args["release-apply-lock"] === "string"
      ? args["release-apply-lock"]
      : String(args["run-id"] || "");
    if (!runId) {
      throw new Error("Usage: node scripts/claim-phase3-batch.mjs --release-apply-lock <run_id> [--worker <name>]");
    }
    const worker = resolveWorkerName(args["worker"]);
    const force = Boolean(args["force"]);
    const existing = loadApplyLock();
    if (existing.status !== "locked") {
      console.log(
        JSON.stringify(
          {
            action: "already_unlocked",
            lock_file: path.relative(REPO_ROOT, APPLY_LOCK_PATH).replace(/\\/g, "/"),
            ...existing,
          },
          null,
          2
        )
      );
      return;
    }
    if (!force && (existing.worker !== worker || existing.run_id !== runId)) {
      throw new Error(
        `Refusing to release lock owned by worker='${existing.worker}' run_id='${existing.run_id}' ` +
          `(requested by worker='${worker}' run_id='${runId}').`
      );
    }
    const nowIso = new Date().toISOString();
    const unlockedDoc = {
      schema_version: 1,
      status: "unlocked",
      worker: null,
      run_id: null,
      started_at: null,
      last_worker: existing.worker,
      last_run_id: existing.run_id,
      last_started_at: existing.started_at,
      released_at: nowIso,
      released_by: worker,
    };
    fs.writeFileSync(APPLY_LOCK_PATH, JSON.stringify(unlockedDoc, null, 2) + "\n", "utf8");
    console.log(
      JSON.stringify(
        {
          action: "released",
          lock_file: path.relative(REPO_ROOT, APPLY_LOCK_PATH).replace(/\\/g, "/"),
          ...unlockedDoc,
          next_steps: [
            "git add analysis/claims/_apply_lock.json",
            `git commit -m "Release TiDB apply lock after ${runId} (${worker})"`,
            "git push",
          ],
        },
        null,
        2
      )
    );
    return;
  }

  // 1. Register an existing active run directory as a claim
  if (args["register-run"]) {
    const runId = String(args["register-run"]);
    const worker = resolveWorkerName(args["worker"]);
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

  // 2c. Register failed videos from a run_manifest.json into _skip_list.json (primary worker recommended)
  if (args["add-skip-from-run"]) {
    const runId = String(args["add-skip-from-run"]);
    const worker = resolveWorkerName(args["worker"]);
    const includeFormatFailures = Boolean(args["include-format-failures"]);
    const cooldownDays = Math.max(1, parseInt(args["cooldown-days"] || String(DEFAULT_RETRY_COOLDOWN_DAYS), 10));

    if (worker.toLowerCase() !== PRIMARY_WORKER) {
      console.warn(
        `[WARNING] --add-skip-from-run is being run with worker '${worker}' instead of primary worker '${PRIMARY_WORKER}'. ` +
          `Confirm ownership before committing analysis/claims/_skip_list.json.`
      );
    }

    const manifestPath = path.join(REPO_ROOT, "analysis", "runs", runId, "run_manifest.json");
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`run_manifest.json not found: ${manifestPath}`);
    }
    const rm = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const abortedByBotCheck = Boolean(rm.aborted_by_bot_check);
    if (abortedByBotCheck) {
      console.warn(
        `[WARNING] Run '${runId}' has aborted_by_bot_check=true. Bot-check / rate-limit errors will NOT be added to _skip_list.json; review remaining failures carefully.`
      );
    }

    const failures = Array.isArray(rm.runtime_failures) ? rm.runtime_failures : [];
    const nowIso = new Date().toISOString();
    const retryAfterIso = new Date(Date.now() + cooldownDays * 24 * 60 * 60 * 1000).toISOString();

    const skipInfo = loadSkipList();
    const byId = new Map(skipInfo.entries.map((e) => [String(e.video_id), { ...e }]));
    let added = 0;
    let upgradedToPermanent = 0;
    let deferredFormatCount = 0;
    let skippedBotCheckCount = 0;

    for (const f of failures) {
      const vid = String(f.video_id || f.id || "");
      if (!vid) continue;
      const reason = String(f.error || f.reason || "unknown_error");
      const { category, retry_policy } = classifyFailureReason(reason);

      if (retry_policy === "do_not_skip") {
        skippedBotCheckCount++;
        continue;
      }
      if (category === "format_unavailable" && !includeFormatFailures) {
        deferredFormatCount++;
        continue;
      }

      const existing = byId.get(vid);
      if (existing) {
        const nextRetryCount = Number(existing.retry_count || 0) + 1;
        existing.category = category;
        existing.reason = reason;
        existing.checked_at = nowIso;
        existing.checked_by = worker;
        existing.source_run_id = runId;
        existing.retry_count = nextRetryCount;
        if (existing.retry_policy === "retry_once" && nextRetryCount >= 1) {
          existing.retry_policy = "permanent";
          existing.retry_after = null;
          upgradedToPermanent++;
        }
        byId.set(vid, existing);
      } else {
        byId.set(vid, {
          video_id: vid,
          category,
          reason,
          checked_at: nowIso,
          checked_by: worker,
          source_run_id: runId,
          retry_policy,
          retry_count: 0,
          retry_after: retry_policy === "retry_once" ? retryAfterIso : null,
        });
        added++;
      }
    }

    const sortedEntries = [...byId.values()].sort((a, b) => String(a.video_id).localeCompare(String(b.video_id)));
    const nextDoc = {
      schema_version: 1,
      updated_at: nowIso,
      entries: sortedEntries,
    };
    fs.writeFileSync(SKIP_LIST_PATH, JSON.stringify(nextDoc, null, 2) + "\n", "utf8");
    console.log(
      JSON.stringify(
        {
          skip_list_path: path.relative(REPO_ROOT, SKIP_LIST_PATH).replace(/\\/g, "/"),
          source_run_id: runId,
          worker,
          aborted_by_bot_check: abortedByBotCheck,
          added,
          upgraded_to_permanent: upgradedToPermanent,
          skipped_bot_check: skippedBotCheckCount,
          deferred_format_unavailable: deferredFormatCount,
          note:
            deferredFormatCount > 0
              ? "format_unavailable failures were deferred so they can be retried after the prepare DASH fix; pass --include-format-failures to register remaining failures as retry_once."
              : null,
          total_skip_entries: sortedEntries.length,
        },
        null,
        2
      )
    );
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

  // 4. Status across TiDB + active claims + skip list
  if (args["status"]) {
    const claims = loadAllClaims();
    const check = verifyActiveClaims(claims);
    const skip = loadSkipList();
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
        if (!r || r.calibratedScore != null || check.ownerById.has(vid) || skip.activeSkippedIds.has(vid)) continue;
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
      if (check.ownerById.has(vid) || skip.activeSkippedIds.has(vid)) continue;
      const yt = isYoutubeRow(r);
      if (yt) totalUncalYt++;
      if (r.privateRating != null) {
        if (yt) p1UnclaimedYt++;
        else p1UnclaimedOther++;
      }
    }

    console.log(JSON.stringify({
      apply_lock: loadApplyLock(),
      active_claims: claims.filter((c) => c.data.status === "active").map((c) => ({
        run_id: c.data.run_id,
        worker: c.data.worker,
        priority: c.data.priority,
        locked_ids: (c.data.video_ids || []).length,
      })),
      overlaps_count: check.overlaps.length,
      skip_list: {
        total_entries: skip.entries.length,
        permanent: skip.permanentIds.size,
        waiting_retry: skip.waitingRetryIds.size,
        retryable_now: skip.retryableNowIds.size,
        needs_review: skip.needsReviewIds.size,
      },
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
    const worker = resolveWorkerName(args["worker"]);
    const priority = validatePriority(args["priority"] || "P1_private_rating");
    const batchSize = Math.max(1, Math.min(MAX_BATCH_SIZE, parseInt(args["batch-size"] || "200", 10)));
    const batchIndex = args["batch-index"] ? parseInt(args["batch-index"], 10) : null;
    const runId = String(args["run-id"] || generateRunId());
    const idListPath = args["id-list"] ? path.resolve(REPO_ROOT, String(args["id-list"])) : null;
    const nonYoutube = Boolean(args["non-youtube"]);
    const cachedOnly = Boolean(args["cached-only"]);
    const verifyMedia = Boolean(args["verify-media"]);
    const includeRetryable = Boolean(args["include-retryable"]);
    const dryRun = Boolean(args["dry-run"]);
    const cacheDir = getCacheDir();

    const claims = loadAllClaims();
    const check = verifyActiveClaims(claims);
    if (check.overlaps.length > 0) {
      throw new Error(`Existing active claims have overlaps! Fix first: ${JSON.stringify(check.overlaps.slice(0, 5))}`);
    }
    const skip = loadSkipList();
    const excludedSkipIds = includeRetryable ? skip.permanentIds : skip.activeSkippedIds;

    let p0TargetIds = null;
    if (priority === "P0_craft_recipes") {
      const targetPath = idListPath || path.join(REPO_ROOT, "analysis", "phase3_craft_recipes_target_ids.json");
      const doc = JSON.parse(fs.readFileSync(targetPath, "utf8"));
      p0TargetIds = (Array.isArray(doc) ? doc : doc.video_ids || []).map(String);
    }

    const rows = await fetchTidbVideos();
    const byId = new Map(rows.map((r) => [String(r.id), r]));
    const unreadableSkipped = [];
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

    const candidates = selectClaimCandidates({
      rows,
      priority,
      ownerById: check.ownerById,
      excludedSkipIds,
      nonYoutube,
      p0TargetIds,
      passesCacheFilter,
    });

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
  node scripts/claim-phase3-batch.mjs --apply-lock-status
  node scripts/claim-phase3-batch.mjs --acquire-apply-lock <run_id> [--worker <name>]
  node scripts/claim-phase3-batch.mjs --release-apply-lock <run_id> [--worker <name>]
  node scripts/claim-phase3-batch.mjs --register-run <run_id> [--worker <name>]
  node scripts/claim-phase3-batch.mjs --claim --worker <name> --priority <P0_craft_recipes|P1_private_rating|P2_verified_5_genres|P3_unverified_genres|ALL> [--batch-size 200] [--batch-index <N>] [--non-youtube] [--cached-only] [--verify-media] [--include-retryable] [--dry-run]
  node scripts/claim-phase3-batch.mjs --complete <run_id>
  node scripts/claim-phase3-batch.mjs --release --run-id <run_id> [--reason <text>]
  node scripts/claim-phase3-batch.mjs --add-skip-from-run <run_id> [--worker <name>] [--include-format-failures] [--cooldown-days 7]`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
