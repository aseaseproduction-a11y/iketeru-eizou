#!/usr/bin/env node
/**
 * Sync TiDB `videoScenes` from TiDB `videos.aiAnalysis` for videos with `analysisVersion = 'v3'`.
 *
 * Designed to run BOTH standalone (e.g. CHIBA-PC2) AND inside `chibatmute`'s existing TiDB write lock
 * immediately after applying a v3 delta batch to `videos`:
 *  - NEVER acquires, modifies, or releases `analysis/claims/_apply_lock.json` itself.
 *  - `--apply` REQUIRES the caller to already hold an active lock (`--worker <w> --lock-run-id <id>`).
 *  - Default targeting (`--pending-only`, ON by default): selects ONLY TiDB `videos` where
 *    `analysisVersion = 'v3'` AND `videoScenes` does NOT yet have `v3` scenes (0 rows or any non-v3 row).
 *    Pass `--all-v3` to re-sync all `analysisVersion = 'v3'` videos regardless of current `videoScenes` state.
 *  - Default mode (`--dry-run` or omitting `--apply`): STRICTLY READ-ONLY (`SELECT` only, zero writes).
 *  - Before writing or pruning in `--apply`:
 *      1. Fails closed if ANY target video parses 0 scenes or has duplicate `shotIndex`.
 *      2. Writes per-video JSONL backups + SHA-256 manifest of all existing `videoScenes` rows for target videos.
 *      3. Upserts all parsed v3 scenes in 500-row chunks (`analysisVersion = 'v3'`, `analysisGeneratedAt`).
 *      4. Prunes stale excess `shotIndex` rows per video (with per-video JSONL backup + SHA-256 via `pruneStaleScenesPerVideo`).
 *      5. Verifies post-apply counts, zero remaining stale rows, `videos` row count & `MAX(updatedAt)` unchanged,
 *         and (unless `--skip-40col-audit`) full Pre-D 40-column audit with parallel v3 manifest verification.
 *
 * Usage:
 *   node scripts/sync-v3-video-scenes.mjs --dry-run [--all-v3] [--ids id1,id2]
 *   node scripts/sync-v3-video-scenes.mjs --apply --worker <name> --lock-run-id <run_id> [--lock-git-ref <ref>] [--backup-dir <dir>]
 */

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseV3ScenesFromMarkdown } from "./apply-reanalysis-v3-to-tidb.mjs";
import {
  DEFAULT_BACKUP_ROOT,
  DEFAULT_CHUNK_SIZE,
  buildUpsertBatchSql,
  chunkArray,
  computeStaleScenes,
  estimateStorageBytes,
  normalizeSceneRecord,
  pruneStaleScenesPerVideo,
} from "./sync-scenes-to-tidb.mjs";
import {
  DEFAULT_APPROVED_OVERRIDES_PATH,
  DEFAULT_V3_STORE_DIR,
  auditOriginalColumnsAgainstPreD,
  loadApprovedTidbOverrides,
  sha256TidbCellValue,
} from "./approved-tidb-overrides.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..");
export const APPLY_LOCK_PATH = path.join(REPO_ROOT, "analysis", "claims", "_apply_lock.json");
const BACKUP_MANIFEST_PATH = path.join(REPO_ROOT, "analysis", "phase3_pre_d_backup_manifest.json");

const LEGACY_SCORE_COLUMNS = new Set([
  "aiOverallScore",
  "aiDirectionScore",
  "aiTechniqueScore",
  "aiScoreBreakdown",
  "aiOverallRating",
  "aiDirectionRating",
  "aiTechniqueRating",
  "aiAnalysis",
]);

function sha256Text(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

function sanitizeFilename(videoId) {
  return String(videoId).replace(/[^A-Za-z0-9._-]/g, "_");
}

function compactStamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "_");
}

function formatMysqlDatetime(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 19).replace("T", " ");
  return String(val);
}

export function parseArgs(argv) {
  const opts = {
    apply: false,
    dryRun: true,
    pendingOnly: true,
    ids: null,
    worker: null,
    lockRunId: null,
    lockGitRef: null,
    backupDir: null,
    chunkSize: DEFAULT_CHUNK_SIZE,
    v3StoreDir: null,
    skip40ColAudit: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") {
      opts.apply = true;
      opts.dryRun = false;
    } else if (a === "--dry-run") {
      opts.dryRun = true;
      opts.apply = false;
    } else if (a === "--pending-only") {
      opts.pendingOnly = true;
    } else if (a === "--all-v3") {
      opts.pendingOnly = false;
    } else if (a === "--ids") {
      const val = argv[++i];
      if (!val || val.startsWith("--")) throw new Error("--ids requires a comma-separated list");
      opts.ids = val.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a === "--worker") {
      const val = argv[++i];
      if (!val || val.startsWith("--")) throw new Error("--worker requires a value");
      opts.worker = val;
    } else if (a === "--lock-run-id") {
      const val = argv[++i];
      if (!val || val.startsWith("--")) throw new Error("--lock-run-id requires a value");
      opts.lockRunId = val;
    } else if (a === "--lock-git-ref") {
      const val = argv[++i];
      if (!val || val.startsWith("--")) throw new Error("--lock-git-ref requires a value");
      opts.lockGitRef = val;
    } else if (a === "--backup-dir") {
      const val = argv[++i];
      if (!val || val.startsWith("--")) throw new Error("--backup-dir requires a value");
      opts.backupDir = val;
    } else if (a === "--v3-store-dir") {
      const val = argv[++i];
      if (!val || val.startsWith("--")) throw new Error("--v3-store-dir requires a value");
      opts.v3StoreDir = val;
    } else if (a === "--chunk-size") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1 || n > 2000) throw new Error("--chunk-size must be 1..2000");
      opts.chunkSize = n;
    } else if (a === "--skip-40col-audit") {
      opts.skip40ColAudit = true;
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return opts;
}

/**
 * Verify that the caller already holds the active TiDB apply lock.
 * This script NEVER acquires or releases `_apply_lock.json` on its own.
 */
export function verifyApplyLockState(lockObj, expectedWorker, expectedRunId) {
  if (!expectedWorker || !String(expectedWorker).trim()) {
    throw new Error("--worker is required for --apply (caller must hold active lock)");
  }
  if (!expectedRunId || !String(expectedRunId).trim()) {
    throw new Error("--lock-run-id is required for --apply (must match caller's active lock run_id)");
  }
  const ok =
    lockObj &&
    lockObj.status === "locked" &&
    lockObj.worker === expectedWorker &&
    lockObj.run_id === expectedRunId;
  if (!ok) {
    throw new Error(
      `Refusing to write to TiDB without caller's active write lock! ` +
        `Expected status="locked", worker="${expectedWorker}", run_id="${expectedRunId}", ` +
        `found=${JSON.stringify({
          status: lockObj?.status ?? null,
          worker: lockObj?.worker ?? null,
          run_id: lockObj?.run_id ?? null,
        })}`
    );
  }
  return true;
}

/**
 * Select which v3 videos need `videoScenes` sync.
 * A v3 video is considered pending when:
 *  - it has 0 rows in `videoScenes`, OR
 *  - any of its existing `videoScenes` rows has `analysisVersion !== 'v3'`
 */
export function selectPendingV3VideoIds(v3VideoIds, sceneStatusByVideoId) {
  const pending = [];
  const alreadySynced = [];
  for (const rawId of v3VideoIds) {
    const vid = String(rawId);
    const stat = sceneStatusByVideoId.get(vid);
    if (!stat || stat.totalCount === 0 || stat.nonV3Count > 0) {
      pending.push(vid);
    } else {
      alreadySynced.push(vid);
    }
  }
  return { pending, alreadySynced };
}

/**
 * Parse and normalize all scenes for the target v3 videos, failing closed on
 * any video that yields 0 parsed scenes or duplicate `shotIndex`.
 */
export function planV3ScenesSync(targetVideos, existingSceneRows) {
  const normalizedRows = [];
  const zeroSceneVideos = [];
  const duplicateShotIndexVideos = [];
  const existingByVid = new Map();
  for (const r of existingSceneRows) {
    const vid = String(r.videoId);
    if (!existingByVid.has(vid)) existingByVid.set(vid, []);
    existingByVid.get(vid).push(r);
  }

  let videosReplacingLegacy = 0;
  let videosNewlyAdding = 0;
  let videosAlreadyV3 = 0;
  let shotTitleTruncatedGt255 = 0;

  for (const v of targetVideos) {
    const vid = String(v.id);
    const parsed = parseV3ScenesFromMarkdown(v.aiAnalysis || "");
    if (parsed.length === 0) {
      zeroSceneVideos.push({ id: vid, title: v.title || "", aiAnalysisLen: String(v.aiAnalysis || "").length });
      continue;
    }

    const seenShots = new Set();
    let hasDup = false;
    for (const s of parsed) {
      if (seenShots.has(s.shot_index)) hasDup = true;
      seenShots.add(s.shot_index);
    }
    if (hasDup) {
      duplicateShotIndexVideos.push({ id: vid, title: v.title || "", parsedCount: parsed.length, uniqueShots: seenShots.size });
      continue;
    }

    const prev = existingByVid.get(vid) || [];
    if (prev.length === 0) videosNewlyAdding++;
    else if (prev.every((r) => r.analysisVersion === "v3")) videosAlreadyV3++;
    else videosReplacingLegacy++;

    const generatedAt = formatMysqlDatetime(v.analysisGeneratedAt);
    for (const s of parsed) {
      const norm = normalizeSceneRecord({ video_id: vid, ...s }, v.title || "", {
        analysisVersion: "v3",
        analysisGeneratedAt: generatedAt,
      });
      if (norm._titleTruncated) shotTitleTruncatedGt255++;
      normalizedRows.push(norm);
    }
  }

  const stale = computeStaleScenes(existingSceneRows, normalizedRows);
  return {
    normalizedRows,
    zeroSceneVideos,
    duplicateShotIndexVideos,
    videosReplacingLegacy,
    videosNewlyAdding,
    videosAlreadyV3,
    shotTitleTruncatedGt255,
    existingByVid,
    stale,
  };
}

function loadApplyLock(lockGitRef = null) {
  if (lockGitRef) {
    const raw = execFileSync("git", ["show", `${lockGitRef}:analysis/claims/_apply_lock.json`], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
  }
  if (!fs.existsSync(APPLY_LOCK_PATH)) {
    return { schema_version: 1, status: "unlocked", worker: null, run_id: null, started_at: null };
  }
  return JSON.parse(fs.readFileSync(APPLY_LOCK_PATH, "utf8").replace(/^\uFEFF/, ""));
}

function resolveV3StoreDir(explicitDir) {
  if (explicitDir) return explicitDir;
  for (const candidate of [
    process.env.IKETERU_V3_STORE_DIR,
    "G:\\マイドライブ\\iketeru_analysis_v3",
    "D:\\マイドライブ\\iketeru_analysis_v3",
    DEFAULT_V3_STORE_DIR,
  ]) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function loadV3ManifestsParallel(storeDir, videoIds, concurrency = 8) {
  const validMap = new Map();
  if (!storeDir || !fs.existsSync(storeDir)) return validMap;
  let idx = 0;
  async function worker() {
    while (idx < videoIds.length) {
      const vid = videoIds[idx++];
      const dir = path.join(storeDir, vid);
      try {
        const [mStr, aBuf, cStr] = await Promise.all([
          fsp.readFile(path.join(dir, "manifest.json"), "utf8"),
          fsp.readFile(path.join(dir, "analysis_v3.md")),
          fsp.readFile(path.join(dir, "mechanical_check.json"), "utf8"),
        ]);
        const manifest = JSON.parse(mStr);
        const check = JSON.parse(cStr);
        if (String(manifest.video_id || "") !== vid) continue;
        const actualSha = crypto.createHash("sha256").update(aBuf).digest("hex");
        const expectedSha = String(manifest.files?.["analysis_v3.md"]?.sha256 || "").toLowerCase();
        if (!expectedSha || actualSha !== expectedSha) continue;
        const mechOk = check?.mechanical?.all_passed === true;
        const transcriptOk = check?.transcript_audit?.ok === true || check?.transcript_audit === undefined;
        if (!mechOk || !transcriptOk) continue;
        validMap.set(vid, {
          video_id: vid,
          mechanical_passed: true,
          analysis_content_sha256: sha256TidbCellValue(aBuf.toString("utf8")),
          analysis_file_sha256: actualSha,
          prompt_template_sha256: String(manifest.prompt_template_sha256 || "") || null,
        });
      } catch {}
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, videoIds.length)) }, () => worker()));
  return validMap;
}

async function runPreD40ColumnAudit(conn, v3StoreDir) {
  const preDManifest = JSON.parse(fs.readFileSync(BACKUP_MANIFEST_PATH, "utf8"));
  const preDBackupPath = process.env.IKETERU_PRE_D_BACKUP_PATH || preDManifest.tidb.jsonl_path;
  const backupMap = new Map();
  let originalColumns = [];
  for (const line of fs.readFileSync(preDBackupPath, "utf8").split(/\r?\n/).filter(Boolean)) {
    const obj = JSON.parse(line);
    if (originalColumns.length === 0) originalColumns = Object.keys(obj);
    backupMap.set(String(obj.id), obj);
  }
  const origColsSql = originalColumns.map((c) => `\`${c}\``).join(", ");
  const [liveRows] = await conn.query(`SELECT ${origColsSql}, \`analysisVersion\` FROM videos ORDER BY id ASC`);
  const liveV3Ids = liveRows.filter((r) => String(r.analysisVersion || "") === "v3").map((r) => String(r.id));
  const v3ManifestMap = await loadV3ManifestsParallel(v3StoreDir, liveV3Ids, 8);
  const approvedOverrides = loadApprovedTidbOverrides(DEFAULT_APPROVED_OVERRIDES_PATH);
  return auditOriginalColumnsAgainstPreD({
    liveRows,
    backupMap,
    originalColumns,
    legacyScoreColumns: LEGACY_SCORE_COLUMNS,
    approvedOverrides,
    v3ManifestMap,
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  require("dotenv").config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
  const mysql = require("mysql2/promise");

  const worker = String(opts.worker || process.env.IKETERU_WORKER_NAME || "").trim();
  if (opts.apply) {
    const lockObj = loadApplyLock(opts.lockGitRef);
    verifyApplyLockState(lockObj, worker, opts.lockRunId);
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set in .env");
  }
  const dbUrl = new URL(process.env.DATABASE_URL);
  const conn = await mysql.createConnection({
    host: dbUrl.hostname,
    port: Number(dbUrl.port || 4000),
    user: decodeURIComponent(dbUrl.username),
    password: decodeURIComponent(dbUrl.password),
    database: dbUrl.pathname.replace(/^\//, ""),
    ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
  });

  try {
    const [preVideosMeta] = await conn.query("SELECT COUNT(*) AS cnt, MAX(updatedAt) AS max_upd FROM videos");
    const preVideosCount = Number(preVideosMeta[0].cnt);
    const preMaxUpdatedAt =
      preVideosMeta[0].max_upd instanceof Date
        ? preVideosMeta[0].max_upd.toISOString()
        : String(preVideosMeta[0].max_upd);

    const [preSceneVer] = await conn.query(
      "SELECT analysisVersion, COUNT(*) AS cnt, COUNT(DISTINCT videoId) AS vids FROM videoScenes GROUP BY analysisVersion"
    );
    const preTotalScenes = preSceneVer.reduce((a, r) => a + Number(r.cnt), 0);

    // 1. Identify all TiDB v3 videos
    const [allV3IdRows] = await conn.query("SELECT id FROM videos WHERE analysisVersion = 'v3' ORDER BY id ASC");
    const allV3Ids = allV3IdRows.map((r) => String(r.id));

    // 2. Check current videoScenes version status per v3 video
    const sceneStatusByVid = new Map();
    if (allV3Ids.length > 0) {
      const [statusRows] = await conn.query(`
        SELECT s.videoId,
               COUNT(*) AS total_cnt,
               SUM(CASE WHEN s.analysisVersion = 'v3' THEN 1 ELSE 0 END) AS v3_cnt,
               SUM(CASE WHEN s.analysisVersion != 'v3' THEN 1 ELSE 0 END) AS non_v3_cnt
        FROM videoScenes s
        INNER JOIN videos v ON v.id = s.videoId AND v.analysisVersion = 'v3'
        GROUP BY s.videoId
      `);
      for (const r of statusRows) {
        sceneStatusByVid.set(String(r.videoId), {
          totalCount: Number(r.total_cnt),
          v3Count: Number(r.v3_cnt),
          nonV3Count: Number(r.non_v3_cnt),
        });
      }
    }

    const { pending, alreadySynced } = selectPendingV3VideoIds(allV3Ids, sceneStatusByVid);
    let targetIds;
    if (opts.ids && opts.ids.length > 0) {
      const v3Set = new Set(allV3Ids);
      const invalid = opts.ids.filter((id) => !v3Set.has(id));
      if (invalid.length > 0) {
        throw new Error(`Requested --ids not marked analysisVersion='v3' in TiDB: ${invalid.join(", ")}`);
      }
      targetIds = opts.ids;
    } else {
      targetIds = opts.pendingOnly ? pending : allV3Ids;
    }

    if (targetIds.length === 0) {
      console.log(
        JSON.stringify(
          {
            mode: opts.dryRun ? "dry_run" : "apply",
            pendingOnly: opts.pendingOnly,
            tidbWritesExecuted: 0,
            totalV3VideosInTidb: allV3Ids.length,
            alreadySyncedV3Videos: alreadySynced.length,
            targetV3VideosCount: 0,
            currentVideoScenesByVersion: preSceneVer,
            totalVideoScenes: preTotalScenes,
            message: "No pending v3 videos require videoScenes sync.",
          },
          null,
          2
        )
      );
      return;
    }

    // 3. Load full target video rows & existing videoScenes rows
    const targetVideos = [];
    const existingRows = [];
    for (let i = 0; i < targetIds.length; i += 200) {
      const chunk = targetIds.slice(i, i + 200);
      const ph = chunk.map(() => "?").join(",");
      const [vRows] = await conn.query(
        `SELECT id, title, analysisVersion, analysisGeneratedAt, analysisPromptSha256, aiAnalysis
         FROM videos WHERE id IN (${ph}) ORDER BY id ASC`,
        chunk
      );
      targetVideos.push(...vRows);
      const [sRows] = await conn.query(
        `SELECT * FROM videoScenes WHERE videoId IN (${ph}) ORDER BY videoId ASC, shotIndex ASC`,
        chunk
      );
      existingRows.push(...sRows);
    }

    const plan = planV3ScenesSync(targetVideos, existingRows);
    if (plan.zeroSceneVideos.length > 0 || plan.duplicateShotIndexVideos.length > 0) {
      throw new Error(
        `Fail-closed parse error: zeroSceneVideos=${JSON.stringify(plan.zeroSceneVideos.slice(0, 5))}, ` +
          `duplicateShotIndexVideos=${JSON.stringify(plan.duplicateShotIndexVideos.slice(0, 5))}`
      );
    }

    const existingLegacyRowsForTarget = existingRows.filter((r) => r.analysisVersion !== "v3").length;
    const projectedTotalAfter = preTotalScenes - existingRows.length + plan.normalizedRows.length;
    const preV3Count = Number(preSceneVer.find((r) => r.analysisVersion === "v3")?.cnt ?? 0);
    const existingV3RowsForTarget = existingRows.filter((r) => r.analysisVersion === "v3").length;
    const projectedV3After = preV3Count - existingV3RowsForTarget + plan.normalizedRows.length;
    const preLegacyCount = Number(preSceneVer.find((r) => r.analysisVersion === "legacy")?.cnt ?? 0);
    const projectedLegacyAfter = preLegacyCount - existingLegacyRowsForTarget;

    const report = {
      generatedAtUtc: new Date().toISOString(),
      mode: opts.dryRun ? "dry_run" : "apply",
      pendingOnly: opts.pendingOnly,
      worker: worker || null,
      lockRunId: opts.lockRunId || null,
      tidbWritesExecuted: 0,
      before: {
        totalVideos: preVideosCount,
        maxUpdatedAt: preMaxUpdatedAt,
        totalV3VideosInTidb: allV3Ids.length,
        alreadySyncedV3Videos: alreadySynced.length,
        pendingV3Videos: pending.length,
        videoScenesByVersion: preSceneVer,
        totalVideoScenes: preTotalScenes,
      },
      plan: {
        targetV3VideosCount: targetVideos.length,
        videosReplacingLegacyScenes: plan.videosReplacingLegacy,
        videosNewlyAddingScenes: plan.videosNewlyAdding,
        videosAlreadyV3InScenes: plan.videosAlreadyV3,
        existingSceneRowsForTargets: existingRows.length,
        newV3ScenesToUpsert: plan.normalizedRows.length,
        staleScenesToPrune: plan.stale.staleScenesCount,
        staleVideosToPrune: plan.stale.staleVideosCount,
        staleByVideo: plan.stale.staleByVideo,
        shotTitleTruncatedGt255: plan.shotTitleTruncatedGt255,
        projectedTotalVideoScenesAfter: projectedTotalAfter,
        projectedV3ScenesAfter: projectedV3After,
        projectedLegacyScenesAfter: projectedLegacyAfter,
        sizeEstimate: estimateStorageBytes(plan.normalizedRows),
      },
    };

    if (opts.dryRun) {
      report.sampleV3Scenes = plan.normalizedRows.slice(0, 3).map(({ _titleTruncated, ...rest }) => rest);
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    // 4. --apply: write per-video JSONL backup + SHA-256 manifest BEFORE any write or delete
    const stamp = compactStamp();
    const backupDir = opts.backupDir || path.join(DEFAULT_BACKUP_ROOT, `v3_video_scenes_sync_${stamp}`);
    fs.mkdirSync(backupDir, { recursive: true });
    const backupFiles = [];
    for (const [vid, rows] of plan.existingByVid.entries()) {
      const fname = `${sanitizeFilename(vid)}.jsonl`;
      const fpath = path.join(backupDir, fname);
      const content = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
      fs.writeFileSync(fpath, content, "utf8");
      backupFiles.push({ videoId: vid, file: fname, rowCount: rows.length, sha256: sha256Text(content) });
    }
    const manifestJson =
      JSON.stringify(
        {
          createdAtUtc: new Date().toISOString(),
          worker,
          lockRunId: opts.lockRunId,
          targetVideosCount: targetVideos.length,
          backedUpVideosWithExistingRows: backupFiles.length,
          backedUpRows: existingRows.length,
          files: backupFiles,
        },
        null,
        2
      ) + "\n";
    const backupManifestPath = path.join(backupDir, "backup_manifest.json");
    fs.writeFileSync(backupManifestPath, manifestJson, "utf8");
    const backupManifestSha256 = sha256Text(manifestJson);

    // 5. Upsert v3 scenes in batches
    const chunks = chunkArray(plan.normalizedRows, opts.chunkSize);
    let batchesExecuted = 0;
    for (const batch of chunks) {
      const { sql, params } = buildUpsertBatchSql(batch);
      await conn.query(sql, params);
      batchesExecuted++;
    }
    report.tidbWritesExecuted = plan.normalizedRows.length;

    // 6. Prune stale excess rows per video (with per-video JSONL backup + SHA-256)
    let pruneResult = { prunedVideosCount: 0, prunedScenesCount: 0, backups: [] };
    if (plan.stale.staleScenesCount > 0) {
      pruneResult = await pruneStaleScenesPerVideo({
        conn,
        staleByVideo: plan.stale.staleByVideo,
        backupDir: path.join(backupDir, "pruned_stale"),
      });
    }

    // 7. Post-apply verification
    const [postSceneVer] = await conn.query(
      "SELECT analysisVersion, COUNT(*) AS cnt, COUNT(DISTINCT videoId) AS vids FROM videoScenes GROUP BY analysisVersion"
    );
    const postTotalScenes = postSceneVer.reduce((a, r) => a + Number(r.cnt), 0);
    const postV3Row = postSceneVer.find((r) => r.analysisVersion === "v3");
    const postV3Scenes = Number(postV3Row?.cnt ?? 0);
    const postV3Vids = Number(postV3Row?.vids ?? 0);

    let staleRemaining = 0;
    for (const entry of plan.stale.staleByVideo) {
      const ph = entry.staleShotIndices.map(() => "?").join(",");
      const [rem] = await conn.query(
        `SELECT COUNT(*) AS cnt FROM videoScenes WHERE videoId = ? AND shotIndex IN (${ph})`,
        [entry.videoId, ...entry.staleShotIndices]
      );
      staleRemaining += Number(rem[0].cnt);
    }

    const [postVideosMeta] = await conn.query("SELECT COUNT(*) AS cnt, MAX(updatedAt) AS max_upd FROM videos");
    const postVideosCount = Number(postVideosMeta[0].cnt);
    const postMaxUpdatedAt =
      postVideosMeta[0].max_upd instanceof Date
        ? postVideosMeta[0].max_upd.toISOString()
        : String(postVideosMeta[0].max_upd);

    let audit40 = null;
    if (!opts.skip40ColAudit) {
      const v3StoreDir = resolveV3StoreDir(opts.v3StoreDir);
      const a = await runPreD40ColumnAudit(conn, v3StoreDir);
      audit40 = {
        passed: a.passed,
        rows_compared: a.rows_compared,
        columns_compared_per_row: a.columns_compared_per_row,
        total_cells_compared: a.total_cells_compared,
        all_40_original_columns_mismatches: a.all_40_original_columns_mismatches,
        legacy_8_score_columns_mismatches: a.legacy_8_score_columns_mismatches,
        updated_at_row_mismatches: a.updated_at_row_mismatches,
        v3_manifest_matched_count: a.v3_manifest_matched_count,
      };
    }

    const allPassed =
      postV3Scenes === projectedV3After &&
      postTotalScenes === projectedTotalAfter &&
      staleRemaining === 0 &&
      postVideosCount === preVideosCount &&
      postMaxUpdatedAt === preMaxUpdatedAt &&
      (audit40 === null || (audit40.passed === true && audit40.all_40_original_columns_mismatches === 0 && audit40.updated_at_row_mismatches === 0));

    report.backup = {
      dir: backupDir,
      backedUpVideos: backupFiles.length,
      backedUpRows: existingRows.length,
      manifestPath: backupManifestPath,
      manifestSha256: backupManifestSha256,
    };
    report.applyResult = {
      batchesExecuted,
      upsertedScenes: plan.normalizedRows.length,
      pruneResult,
    };
    report.after = {
      videoScenesByVersion: postSceneVer,
      v3Scenes: postV3Scenes,
      v3DistinctVideos: postV3Vids,
      totalVideoScenes: postTotalScenes,
      staleRowsRemaining: staleRemaining,
      videosCountUnchanged: postVideosCount === preVideosCount,
      videosMaxUpdatedAt: postMaxUpdatedAt,
      videosMaxUpdatedAtUnchanged: postMaxUpdatedAt === preMaxUpdatedAt,
      preD40ColAudit: audit40,
      allPassed,
    };

    console.log(JSON.stringify(report, null, 2));
    if (!allPassed) process.exit(1);
  } finally {
    await conn.end();
  }
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error(`[sync-v3-video-scenes] ERROR:`, err?.message || err);
    process.exit(1);
  });
}
