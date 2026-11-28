#!/usr/bin/env node
/**
 * Unified v3 delta apply pipeline (runs inside caller's active `_apply_lock.json`):
 *   1. Validates pinned delta list count (1..200 by default).
 *   2. Runs `scripts/apply-reanalysis-v3-to-tidb.mjs --dry-run --list <list>`
 *      and verifies DDL readiness + Pre-D 40-column audit PASS.
 *   3. Runs `scripts/apply-reanalysis-v3-to-tidb.mjs --apply` (full TiDB backup
 *      + SHA-256 + SQLite backup + 1 tx/video + post-flight 40-column audit).
 *   4. Inside the SAME TiDB write lock, runs `scripts/sync-v3-video-scenes.mjs --apply`
 *      (per-video scene backups + upsert + stale prune + 40-column audit).
 *   5. Independently verifies live TiDB counts (`videos` v3 === `videoAnalysisHistory`
 *      === `videoScenes` distinct v3 videoIds) and writes a JSON verification report.
 *
 * Caller MUST acquire `_apply_lock.json` before invoking and release it after.
 * All database credentials are read strictly from environment / `.env` (`DATABASE_URL`).
 *
 * Usage:
 *   node scripts/run-v3-delta-pipeline.mjs --run-id <id> --list <path> [--worker <name>] [--out-dir <dir>] [--max-delta 200]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = process.env.IKETERU_REPO_ROOT || path.resolve(__dirname, "..");

export function parseArgs(argv) {
  const opts = {
    runId: null,
    listPath: null,
    worker: process.env.IKETERU_WORKER_NAME || "chibatmute",
    outDir: process.env.IKETERU_TMP_DIR || os.tmpdir(),
    maxDelta: 200,
    skipVideoScenes: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    const key = eq !== -1 ? a.slice(2, eq) : a.slice(2);
    const nextVal = () => (eq !== -1 ? a.slice(eq + 1) : argv[++i]);
    if (key === "run-id") opts.runId = nextVal();
    else if (key === "list") opts.listPath = nextVal();
    else if (key === "worker") opts.worker = nextVal();
    else if (key === "out-dir") opts.outDir = nextVal();
    else if (key === "max-delta") opts.maxDelta = Number(nextVal());
    else if (key === "skip-video-scenes") opts.skipVideoScenes = true;
    else throw new Error(`Unknown argument: --${key}`);
  }
  return opts;
}

export function assertDeltaBounds(deltaCount, maxDelta = 200) {
  if (!Number.isInteger(deltaCount) || deltaCount < 1 || deltaCount > maxDelta) {
    throw new Error(`Delta count ${deltaCount} out of auto-apply bounds (1..${maxDelta}). Stopping.`);
  }
}

export function extractJsonFromStdout(stdout) {
  const start = stdout.indexOf("{");
  if (start < 0) throw new Error("No JSON object found in child script stdout");
  return stdout.slice(start);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.runId || !opts.listPath) {
    throw new Error("Required: --run-id <id> --list <path>");
  }

  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  require("dotenv").config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
  const mysql = require("mysql2/promise");

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set in environment or .env");
  }

  fs.mkdirSync(opts.outDir, { recursive: true });
  const listDoc = JSON.parse(fs.readFileSync(opts.listPath, "utf8"));
  const deltaCount = Array.isArray(listDoc.entries) ? listDoc.entries.length : 0;
  assertDeltaBounds(deltaCount, opts.maxDelta);

  // 1. Dry-run apply-reanalysis-v3-to-tidb.mjs
  const dryStdout = execFileSync(
    process.execPath,
    [path.join(REPO_ROOT, "scripts/apply-reanalysis-v3-to-tidb.mjs"), "--dry-run", "--list", opts.listPath],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }
  );
  const dryJsonStr = extractJsonFromStdout(dryStdout);
  fs.writeFileSync(path.join(opts.outDir, `v3_tidb_dryrun_${opts.runId}.json`), dryJsonStr, "utf8");
  const dryRes = JSON.parse(dryJsonStr);

  if (!dryRes.ddl_readiness?.ready_for_apply) {
    throw new Error(`Dry-run DDL not ready: ${JSON.stringify(dryRes.ddl_readiness)}`);
  }
  if (!dryRes.simulated_pre_d_audit?.with_v3_manifest?.passed) {
    throw new Error(`Dry-run 40-col Pre-D audit FAILED: ${JSON.stringify(dryRes.simulated_pre_d_audit)}`);
  }
  if (dryRes.selected_count !== deltaCount) {
    throw new Error(`Dry-run selected_count ${dryRes.selected_count} != ${deltaCount}`);
  }
  console.error(
    `DRY_RUN_PASSED: run=${opts.runId}, delta=${deltaCount}, pre_d_audit=PASS, v3_matched=${dryRes.simulated_pre_d_audit.with_v3_manifest.v3_manifest_matched_count}`
  );

  // 2. Apply to TiDB videos + videoAnalysisHistory + SQLite scenes (inside active lock)
  const applyStdout = execFileSync(
    process.execPath,
    [
      path.join(REPO_ROOT, "scripts/apply-reanalysis-v3-to-tidb.mjs"),
      "--apply",
      "--worker",
      opts.worker,
      "--run-id",
      opts.runId,
      "--list",
      opts.listPath,
    ],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }
  );
  const applyJsonStr = extractJsonFromStdout(applyStdout);
  fs.writeFileSync(path.join(opts.outDir, `v3_tidb_apply_${opts.runId}_result.json`), applyJsonStr, "utf8");
  const applyRes = JSON.parse(applyJsonStr);

  // 3. Sync TiDB videoScenes inside the SAME TiDB write lock
  let scenesSyncRes = null;
  if (!opts.skipVideoScenes) {
    const scenesStdout = execFileSync(
      process.execPath,
      [
        path.join(REPO_ROOT, "scripts/sync-v3-video-scenes.mjs"),
        "--apply",
        "--worker",
        opts.worker,
        "--lock-run-id",
        opts.runId,
      ],
      { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }
    );
    const scenesJsonStr = extractJsonFromStdout(scenesStdout);
    fs.writeFileSync(path.join(opts.outDir, `v3_tidb_scenes_sync_${opts.runId}_result.json`), scenesJsonStr, "utf8");
    scenesSyncRes = JSON.parse(scenesJsonStr);
    if (!scenesSyncRes.after?.allPassed) {
      throw new Error(`videoScenes sync verification FAILED: ${JSON.stringify(scenesSyncRes.after)}`);
    }
  }

  // 4. Independent read-only TiDB count verification
  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
    connectTimeout: 30000,
  });

  let totalCnt;
  let v3Cnt;
  let legacyCnt;
  let histCnt;
  let shaRows;
  let sceneVerRows;
  try {
    [[totalCnt]] = await conn.query("SELECT COUNT(*) AS cnt FROM videos");
    [[v3Cnt]] = await conn.query("SELECT COUNT(*) AS cnt FROM videos WHERE analysisVersion = 'v3'");
    [[legacyCnt]] = await conn.query("SELECT COUNT(*) AS cnt FROM videos WHERE analysisVersion = 'legacy'");
    [[histCnt]] = await conn.query("SELECT COUNT(*) AS cnt FROM videoAnalysisHistory");
    [shaRows] = await conn.query(
      "SELECT LEFT(analysisPromptSha256, 8) AS sha8, COUNT(*) AS cnt FROM videos WHERE analysisVersion = 'v3' GROUP BY LEFT(analysisPromptSha256, 8)"
    );
    [sceneVerRows] = await conn.query(
      "SELECT analysisVersion, COUNT(*) AS rows_cnt, COUNT(DISTINCT videoId) AS vids_cnt FROM videoScenes GROUP BY analysisVersion"
    );
  } finally {
    await conn.end();
  }

  const shaBreakdown = {};
  for (const r of shaRows) shaBreakdown[String(r.sha8)] = Number(r.cnt);
  const v3SceneRow = sceneVerRows.find((r) => r.analysisVersion === "v3");
  const tidbV3ScenesRows = Number(v3SceneRow?.rows_cnt ?? 0);
  const tidbV3ScenesVids = Number(v3SceneRow?.vids_cnt ?? 0);

  const verify = {
    run_id: opts.runId,
    worker: opts.worker,
    dry_run_summary: {
      selected_count: dryRes.selected_count,
      pre_d_audit_with_v3: dryRes.simulated_pre_d_audit.with_v3_manifest,
      pre_d_audit_without_v3_mismatches: dryRes.simulated_pre_d_audit.control_without_v3_manifest.all_40_original_columns_mismatches,
      pre_d_audit_tampered_mismatches: dryRes.simulated_pre_d_audit.control_tampered_sha256.all_40_original_columns_mismatches,
    },
    apply_summary: {
      applied_count: applyRes.applied_count,
      tidb_backup: applyRes.tidb_backup,
      sqlite_backup: applyRes.sqlite_backup,
      post_flight_audit: applyRes.post_flight_audit,
      sqlite_scenes_updated_count: applyRes.applied.filter((x) => x.sqlite_scenes).length,
      tidb_video_scenes_sync: scenesSyncRes
        ? {
            target_v3_videos_count: scenesSyncRes.plan?.targetV3VideosCount ?? 0,
            upserted_scenes: scenesSyncRes.applyResult?.upsertedScenes ?? 0,
            pruned_scenes: scenesSyncRes.applyResult?.pruneResult?.prunedScenesCount ?? 0,
            v3_scenes_total: scenesSyncRes.after?.v3Scenes ?? null,
            v3_distinct_videos: scenesSyncRes.after?.v3DistinctVideos ?? null,
            total_video_scenes: scenesSyncRes.after?.totalVideoScenes ?? null,
            backup_manifest_sha256: scenesSyncRes.backup?.manifestSha256 ?? null,
            all_passed: scenesSyncRes.after?.allPassed === true,
          }
        : null,
    },
    independent_tidb_check: {
      total_videos: Number(totalCnt.cnt),
      videos_analysisVersion_v3_count: Number(v3Cnt.cnt),
      videos_analysisVersion_legacy_count: Number(legacyCnt.cnt),
      videoAnalysisHistory_row_count: Number(histCnt.cnt),
      history_matches_v3_total: Number(histCnt.cnt) === Number(v3Cnt.cnt),
      videoScenes_by_version: sceneVerRows,
      videoScenes_v3_rows: tidbV3ScenesRows,
      videoScenes_v3_distinct_videos: tidbV3ScenesVids,
      videoScenes_v3_videos_matches_v3_total: opts.skipVideoScenes ? null : tidbV3ScenesVids === Number(v3Cnt.cnt),
      prompt_sha_breakdown: shaBreakdown,
    },
  };

  const verifyPath = path.join(opts.outDir, `v3_tidb_apply_${opts.runId}_verify.json`);
  fs.writeFileSync(verifyPath, JSON.stringify(verify, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(verify, null, 2));

  if (!verify.independent_tidb_check.history_matches_v3_total) {
    throw new Error("Post-apply videoAnalysisHistory count does not match videos(analysisVersion='v3')!");
  }
  if (!opts.skipVideoScenes && !verify.independent_tidb_check.videoScenes_v3_videos_matches_v3_total) {
    throw new Error("Post-apply videoScenes(v3) distinct video count does not match videos(analysisVersion='v3')!");
  }
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error(`[run-v3-delta-pipeline] ERROR:`, err?.message || err);
    if (err?.stderr) console.error("STDERR:", err.stderr.toString());
    process.exit(1);
  });
}
