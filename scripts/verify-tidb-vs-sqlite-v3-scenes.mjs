#!/usr/bin/env node
/**
 * Read-only parity verifier: compares TiDB `videos (v3)` & `videoScenes (v3)`
 * against local SQLite `videos (v3)` & `scenes (v3)` (video count, scene row
 * count, per-video `shotIndex`, `startSec`, `endSec`, and SQLite integrity).
 *
 * Credentials are read strictly from environment / `.env` (`DATABASE_URL`).
 * SQLite path is resolved from `--sqlite-path`, `IKETERU_SQLITE_PATH`,
 * `SQLITE_DB_PATH`, or sibling `../iketeru-creative-studio/data/iketeru_knowledge.db`.
 *
 * Usage:
 *   node scripts/verify-tidb-vs-sqlite-v3-scenes.mjs [--sqlite-path <path>] [--out <path>]
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = process.env.IKETERU_REPO_ROOT || path.resolve(__dirname, "..");

export function resolveSqlitePath(explicitPath = null) {
  if (explicitPath) return explicitPath;
  for (const candidate of [
    process.env.IKETERU_SQLITE_PATH,
    process.env.SQLITE_DB_PATH,
    path.resolve(REPO_ROOT, "..", "iketeru-creative-studio", "data", "iketeru_knowledge.db"),
  ]) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    "SQLite DB path not found. Pass --sqlite-path or set IKETERU_SQLITE_PATH."
  );
}

export function parseArgs(argv) {
  const opts = { sqlitePath: null, outPath: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--sqlite-path") opts.sqlitePath = argv[++i];
    else if (argv[i] === "--out") opts.outPath = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return opts;
}

function readSqliteV3State(sqlitePath) {
  const pyCode = `
import json, sqlite3, sys
db_path = sys.argv[1]
con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
rows = con.execute("""
  SELECT s.video_id, s.shot_index, s.start_sec, s.end_sec
  FROM scenes s
  INNER JOIN videos v ON v.id = s.video_id AND v.analysis_version = 'v3'
  ORDER BY s.video_id ASC, s.shot_index ASC
""").fetchall()
total_videos = con.execute("SELECT COUNT(*) FROM videos").fetchone()[0]
v3_cnt = con.execute("SELECT COUNT(*) FROM videos WHERE analysis_version = 'v3'").fetchone()[0]
legacy_cnt = con.execute("SELECT COUNT(*) FROM videos WHERE analysis_version = 'legacy'").fetchone()[0]
null_cnt = con.execute("SELECT COUNT(*) FROM videos WHERE analysis_version IS NULL").fetchone()[0]
underscore_v3 = con.execute("SELECT COUNT(*) FROM videos WHERE analysis_version = 'v3' AND substr(id, 1, 1) = '_'").fetchone()[0]
prompt_sha = dict(con.execute(
  "SELECT substr(analysis_prompt_sha256, 1, 8), COUNT(*) FROM videos WHERE analysis_version = 'v3' GROUP BY substr(analysis_prompt_sha256, 1, 8)"
).fetchall())
total_scenes = con.execute("SELECT COUNT(*) FROM scenes").fetchone()[0]
integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
con.close()
by_vid = {}
for vid, idx, st, en in rows:
    by_vid.setdefault(str(vid), []).append([int(idx), round(float(st), 3), round(float(en), 3)])
print(json.dumps({
  "total_videos": total_videos,
  "v3_cnt": v3_cnt,
  "legacy_cnt": legacy_cnt,
  "null_cnt": null_cnt,
  "underscore_v3": underscore_v3,
  "prompt_sha": prompt_sha,
  "total_scenes": total_scenes,
  "v3_scene_rows": len(rows),
  "integrity": integrity,
  "by_vid": by_vid
}))
`;
  const sqliteOut = execFileSync("python", ["-c", pyCode, sqlitePath], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(sqliteOut);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const sqlitePath = resolveSqlitePath(opts.sqlitePath);

  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  require("dotenv").config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
  const mysql = require("mysql2/promise");

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set in environment or .env");
  }

  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
    connectTimeout: 30000,
  });

  let v3VidRows;
  let tidbSceneRows;
  let overallScenes;
  let histRow;
  try {
    [v3VidRows] = await conn.query(
      "SELECT id FROM videos WHERE analysisVersion = 'v3' ORDER BY id ASC"
    );
    [tidbSceneRows] = await conn.query(`
      SELECT s.videoId, s.shotIndex, s.startSec, s.endSec, s.analysisVersion
      FROM videoScenes s
      INNER JOIN videos v ON v.id = s.videoId AND v.analysisVersion = 'v3'
      ORDER BY s.videoId ASC, s.shotIndex ASC
    `);
    [overallScenes] = await conn.query(
      "SELECT analysisVersion, COUNT(*) AS rows_cnt, COUNT(DISTINCT videoId) AS vids_cnt FROM videoScenes GROUP BY analysisVersion"
    );
    [[histRow]] = await conn.query("SELECT COUNT(*) AS cnt FROM videoAnalysisHistory");
  } finally {
    await conn.end();
  }

  const v3Ids = v3VidRows.map((r) => String(r.id));
  const tidbByVid = new Map();
  let tidbNonV3ForV3Vids = 0;
  for (const r of tidbSceneRows) {
    const vid = String(r.videoId);
    if (r.analysisVersion !== "v3") tidbNonV3ForV3Vids++;
    if (!tidbByVid.has(vid)) tidbByVid.set(vid, []);
    tidbByVid.get(vid).push({
      shotIndex: Number(r.shotIndex),
      startSec: Number(r.startSec),
      endSec: Number(r.endSec),
    });
  }

  const sq = readSqliteV3State(sqlitePath);
  const tidbTotalScenes = overallScenes.reduce((acc, r) => acc + Number(r.rows_cnt), 0);

  let matchedVideos = 0;
  const countMismatches = [];
  const timeMismatches = [];

  for (const vid of v3Ids) {
    const tList = tidbByVid.get(vid) || [];
    const sList = sq.by_vid[vid] || [];
    if (tList.length !== sList.length) {
      countMismatches.push({ video_id: vid, tidb_count: tList.length, sqlite_count: sList.length });
      continue;
    }
    let ok = true;
    for (let i = 0; i < tList.length; i++) {
      const t = tList[i];
      const s = sList[i];
      if (t.shotIndex !== s[0] || Math.abs(t.startSec - s[1]) > 0.01 || Math.abs(t.endSec - s[2]) > 0.01) {
        ok = false;
        timeMismatches.push({ video_id: vid, shotIndex: t.shotIndex, tidb: t, sqlite: s });
        break;
      }
    }
    if (ok) matchedVideos++;
  }

  const result = {
    sqlite_path: sqlitePath,
    tidb_v3_videos: v3Ids.length,
    tidb_videoAnalysisHistory_rows: Number(histRow.cnt),
    sqlite_total_videos: sq.total_videos,
    sqlite_v3_videos: sq.v3_cnt,
    sqlite_legacy_videos: sq.legacy_cnt,
    sqlite_null_version_videos: sq.null_cnt,
    sqlite_underscore_v3_videos: sq.underscore_v3,
    sqlite_prompt_sha_breakdown: sq.prompt_sha,
    sqlite_integrity: sq.integrity,
    tidb_v3_scene_rows: tidbSceneRows.length,
    sqlite_v3_scene_rows: sq.v3_scene_rows,
    tidb_non_v3_rows_under_v3_videos: tidbNonV3ForV3Vids,
    overall_tidb_videoScenes_by_version: overallScenes,
    tidb_total_scenes: tidbTotalScenes,
    sqlite_total_scenes: sq.total_scenes,
    exact_match_v3_videos: matchedVideos,
    count_mismatches_count: countMismatches.length,
    time_mismatches_count: timeMismatches.length,
    count_mismatches_sample: countMismatches.slice(0, 10),
    time_mismatches_sample: timeMismatches.slice(0, 10),
    all_matched:
      v3Ids.length === sq.v3_cnt &&
      v3Ids.length === Number(histRow.cnt) &&
      tidbSceneRows.length === sq.v3_scene_rows &&
      tidbNonV3ForV3Vids === 0 &&
      countMismatches.length === 0 &&
      timeMismatches.length === 0 &&
      sq.integrity === "ok",
  };

  if (opts.outPath) {
    fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });
    fs.writeFileSync(opts.outPath, JSON.stringify(result, null, 2) + "\n", "utf8");
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.all_matched) process.exit(1);
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error(`[verify-tidb-vs-sqlite-v3-scenes] ERROR:`, err?.message || err);
    process.exit(1);
  });
}
