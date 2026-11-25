#!/usr/bin/env node
/**
 * Draft sync script: Local SQLite `scenes` -> TiDB `videoScenes` (Phase 1 scene search).
 *
 * Strict safety guarantees:
 *  - Defaults to --dry-run (strictly READ-ONLY against both SQLite and TiDB: ZERO DDL, ZERO writes).
 *  - NEVER alters, updates, or deletes the existing TiDB `videos` table.
 *  - --apply is blocked unless explicit --confirm-apply is passed AND _apply_lock.json is verified
 *    (Phase 1 approval gate).
 *
 * Usage:
 *   node scripts/sync-scenes-to-tidb.mjs --dry-run
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const require = createRequire(path.join(REPO_ROOT, "package.json"));
const dotenv = require("dotenv");
const mysql = require("mysql2/promise");

const DEFAULT_SQLITE_PATH = "E:\\iketeru-creative-studio\\data\\iketeru_knowledge.db";

export const VIDEO_SCENES_DDL = `CREATE TABLE IF NOT EXISTS videoScenes (
  id INT NOT NULL AUTO_INCREMENT,
  videoId VARCHAR(64) NOT NULL,
  shotIndex INT NOT NULL,
  startMmss VARCHAR(16) NOT NULL,
  endMmss VARCHAR(16) NOT NULL,
  startSec DECIMAL(8,2) NOT NULL,
  endSec DECIMAL(8,2) NOT NULL,
  durationSec DECIMAL(8,2) NOT NULL,
  shotTitle VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  keywordsJson TEXT NOT NULL,
  searchText TEXT NOT NULL,
  isUnwatched TINYINT NOT NULL DEFAULT 0,
  sceneSha256 VARCHAR(64) NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY video_scenes_video_shot_unique (videoId, shotIndex),
  KEY idx_video_scenes_video_time (videoId, startSec),
  KEY idx_video_scenes_unwatched (isUnwatched, videoId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`;

const STOP_WORDS = new Set([
  "画面", "映像", "動画", "場面", "シーン", "カット", "ショット", "カメラ", "フレーム",
  "全体", "一部", "連続", "同時", "中央", "背景", "手前", "開始", "終了", "演出", "表現",
]);

function extractShortKeywords(shotTitle, description) {
  const combined = `${shotTitle || ""} ${description || ""}`;
  const found = new Set();
  for (const m of combined.matchAll(/[ァ-ヶー]{3,14}/g)) {
    const w = m[0].replace(/^[・ー]+|[・]+$/g, "");
    if (w.length >= 3 && !STOP_WORDS.has(w)) found.add(w);
  }
  for (const m of combined.matchAll(/\b[A-Za-z][A-Za-z0-9+.\-]{2,18}\b/g)) {
    found.add(m[0]);
  }
  return Array.from(found).slice(0, 10);
}

function sha256Text(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

function parseArgs(argv) {
  const args = { dryRun: true, sqlitePath: DEFAULT_SQLITE_PATH, excludeUnwatched: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--apply") args.dryRun = false;
    else if (a === "--confirm-apply") args.confirmApply = true;
    else if (a === "--exclude-unwatched") args.excludeUnwatched = true;
    else if (a === "--sqlite-path" && argv[i + 1]) args.sqlitePath = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function loadSqliteScenesReadOnly(sqlitePath) {
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite DB not found: ${sqlitePath}`);
  }
  const pyCode = [
    "import sqlite3, json, sys",
    "conn = sqlite3.connect(f'file:{sys.argv[1]}?mode=ro', uri=True)",
    "conn.row_factory = sqlite3.Row",
    "cur = conn.cursor()",
    "cur.execute('''",
    "  SELECT s.video_id, s.shot_index, s.start_mmss, s.end_mmss, s.start_sec, s.end_sec,",
    "         s.duration_sec, s.shot_title, s.description,",
    "         CASE WHEN v.analysis_observation_scope IS NOT NULL THEN 1 ELSE 0 END AS is_unwatched",
    "  FROM scenes s",
    "  LEFT JOIN videos v ON v.id = s.video_id",
    "  ORDER BY s.video_id, s.shot_index",
    "''')",
    "rows = [dict(r) for r in cur.fetchall()]",
    "conn.close()",
    "print(json.dumps(rows, ensure_ascii=False))",
  ].join("\n");
  const out = execFileSync("python", ["-c", pyCode, sqlitePath], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  return JSON.parse(out);
}

async function openTidbReadOnlyConnection() {
  dotenv.config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing in .env");
  }
  const u = new URL(process.env.DATABASE_URL);
  return mysql.createConnection({
    host: u.hostname,
    port: Number(u.port || 4000),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
  });
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.dryRun) {
    throw new Error(
      "Refusing --apply: Phase 1 videoScenes DDL and TiDB write are NOT yet approved. Use --dry-run only."
    );
  }

  const rawScenes = loadSqliteScenesReadOnly(args.sqlitePath);
  const conn = await openTidbReadOnlyConnection();

  let tidbVideoIds;
  let videoScenesExists = false;
  let existingVideoScenesCount = 0;
  let tidbVideosCount = 0;
  let tidbVideosMaxUpdatedAt = null;
  try {
    const [vRows] = await conn.query("SELECT id FROM videos");
    tidbVideoIds = new Set(vRows.map((r) => String(r.id)));
    tidbVideosCount = tidbVideoIds.size;

    const [[vMeta]] = await conn.query("SELECT MAX(updatedAt) AS maxUpdatedAt FROM videos");
    tidbVideosMaxUpdatedAt = vMeta?.maxUpdatedAt ? new Date(vMeta.maxUpdatedAt).toISOString() : null;

    const [tRows] = await conn.query("SHOW TABLES LIKE 'videoScenes'");
    videoScenesExists = tRows.length > 0;
    if (videoScenesExists) {
      const [[cRow]] = await conn.query("SELECT COUNT(*) AS c FROM videoScenes");
      existingVideoScenesCount = Number(cRow?.c || 0);
    }
  } finally {
    await conn.end();
  }

  let matchedRows = 0;
  let orphanRows = 0;
  let watchedRows = 0;
  let unwatchedRows = 0;
  let truncatedTitleCount = 0;
  let totalPayloadBytes = 0;
  const distinctVideosAll = new Set();
  const distinctVideosWatched = new Set();
  const sampleRecords = [];

  for (const r of rawScenes) {
    const vid = String(r.video_id);
    if (!tidbVideoIds.has(vid)) {
      orphanRows++;
      continue;
    }
    const isUnwatched = Number(r.is_unwatched) === 1 ? 1 : 0;
    if (args.excludeUnwatched && isUnwatched) continue;

    matchedRows++;
    distinctVideosAll.add(vid);
    if (isUnwatched) unwatchedRows++;
    else {
      watchedRows++;
      distinctVideosWatched.add(vid);
    }

    const rawTitle = String(r.shot_title || "");
    if (rawTitle.length > 255) truncatedTitleCount++;
    const shotTitle = rawTitle.slice(0, 255);
    const description = String(r.description || "");
    const keywords = extractShortKeywords(shotTitle, description);
    const keywordsJson = JSON.stringify(keywords);
    const searchText = `${shotTitle} ${description} ${keywords.join(" ")}`.trim();
    const sceneSha256 = sha256Text(
      JSON.stringify([vid, r.shot_index, r.start_mmss, r.end_mmss, shotTitle, description, isUnwatched])
    );

    totalPayloadBytes +=
      Buffer.byteLength(shotTitle, "utf8") +
      Buffer.byteLength(description, "utf8") +
      Buffer.byteLength(keywordsJson, "utf8") +
      Buffer.byteLength(searchText, "utf8") +
      160; // fixed columns & index overhead estimate

    if (sampleRecords.length < 2) {
      sampleRecords.push({
        videoId: vid,
        shotIndex: Number(r.shot_index),
        startMmss: r.start_mmss,
        endMmss: r.end_mmss,
        startSec: Number(r.start_sec),
        endSec: Number(r.end_sec),
        durationSec: Number(r.duration_sec),
        shotTitle,
        keywords,
        isUnwatched,
        sceneSha256,
      });
    }
  }

  const report = {
    mode: "dry_run_read_only",
    tidb_ddl_executed: false,
    tidb_writes_executed: 0,
    existing_videos_table_touched: false,
    tidb_precheck: {
      videos_count: tidbVideosCount,
      videos_max_updated_at: tidbVideosMaxUpdatedAt,
      videoScenes_table_exists: videoScenesExists,
      existing_videoScenes_rows: existingVideoScenesCount,
    },
    sqlite_source: {
      path: args.sqlitePath,
      total_scenes_read: rawScenes.length,
    },
    planned_sync_summary: {
      rows_to_upsert: matchedRows,
      distinct_videos_total: distinctVideosAll.size,
      watched_rows: watchedRows,
      watched_distinct_videos: distinctVideosWatched.size,
      unwatched_rows_flagged: unwatchedRows,
      orphan_rows_not_in_tidb_videos: orphanRows,
      shot_title_truncated_gt_255: truncatedTitleCount,
      estimated_storage_mb: Math.round((totalPayloadBytes / (1024 * 1024)) * 100) / 100,
    },
    proposed_ddl: VIDEO_SCENES_DDL,
    sample_records: sampleRecords,
  };

  console.log(JSON.stringify(report, null, 2));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error("ERROR:", err?.message || err);
    process.exit(1);
  });
}
