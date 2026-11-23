#!/usr/bin/env node
/**
 * Phase 3 §2.4 — Strict One-Way Sync: TiDB (Source of Truth) -> Local SQLite Mirror.
 *
 * Guarantees:
 *  - Strictly READ-ONLY against TiDB (`SELECT` only; NEVER writes to TiDB)
 *  - SQLite schema migration is append-only (adds ONLY the 10 calibration_* columns via KnowledgeIndex._init_schema)
 *  - ZERO deletions on SQLite: all SQLite-only rows (48) are preserved untouched in all 34 existing columns
 *    and tagged with calibration_status ('legacy_uncalibrated' or 'unscored') if NULL
 *  - Shared rows (5,587): updates ONLY the 10 new calibration_* columns — all 34 existing columns remain
 *    byte-for-byte identical to the pre-sync SQLite DB
 *  - TiDB-only rows (66): inserted into SQLite via KnowledgeIndex.upsert_video (including FTS & scenes)
 *  - Exhaustive post-sync verification:
 *      * 100% field-by-field match across all 10 calibration columns for ALL 5,653 TiDB rows (and all calibrated rows)
 *      * 0 deletions (all SQLite-only IDs preserved)
 *      * Optional full 34-column x all-pre-existing-rows diff against pre-sync SQLite backup
 *      * TiDB COUNT(*) and MAX(updatedAt) unchanged
 *
 * Usage:
 *   node scripts/sync-tidb-to-sqlite-mirror.mjs [--dry-run] [--sqlite-path <path>] [--backup-path <path>] [--report-out <path>]
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_SQLITE_PATH = "E:\\iketeru-creative-studio\\data\\iketeru_knowledge.db";
const DEFAULT_STUDIO_ROOT = "E:\\iketeru-creative-studio";

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    sqlitePath: DEFAULT_SQLITE_PATH,
    studioRoot: DEFAULT_STUDIO_ROOT,
    backupPath: null,
    reportOut: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") {
      opts.dryRun = true;
    } else if (a === "--sqlite-path" && argv[i + 1]) {
      opts.sqlitePath = argv[++i];
    } else if (a === "--studio-root" && argv[i + 1]) {
      opts.studioRoot = argv[++i];
    } else if (a === "--backup-path" && argv[i + 1]) {
      opts.backupPath = argv[++i];
    } else if (a === "--report-out" && argv[i + 1]) {
      opts.reportOut = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return opts;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(1024 * 1024);
  try {
    while (true) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      hash.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function safeJsonParse(raw, fallback) {
  if (raw == null || raw === "") return fallback;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

function normalizeTidbRow(row) {
  const calScore =
    row.calibratedScore == null || row.calibratedScore === ""
      ? null
      : Number(row.calibratedScore);
  const calAtEpoch =
    row.calibratedAtEpoch == null || row.calibratedAtEpoch === ""
      ? null
      : Math.round(Number(row.calibratedAtEpoch));
  const calBreakdownRaw =
    row.calibratedBreakdown == null
      ? ""
      : typeof row.calibratedBreakdown === "string"
        ? row.calibratedBreakdown
        : JSON.stringify(row.calibratedBreakdown);

  return {
    id: String(row.id),
    platform: String(row.platform || ""),
    title: String(row.title || ""),
    videoUrl: String(row.videoUrl || ""),
    source: String(row.source || ""),
    sourceLabel: String(row.sourceLabel || ""),
    channelTitle: String(row.channelTitle || ""),
    addedDate: String(row.addedDate || ""),
    aiOverallRating: row.aiOverallRating ?? "",
    aiDirectionRating: row.aiDirectionRating ?? "",
    aiTechniqueRating: row.aiTechniqueRating ?? "",
    aiOverallScore: row.aiOverallScore == null ? null : Number(row.aiOverallScore),
    aiDirectionScore: row.aiDirectionScore == null ? null : Number(row.aiDirectionScore),
    aiTechniqueScore: row.aiTechniqueScore == null ? null : Number(row.aiTechniqueScore),
    aiScoreBreakdown: safeJsonParse(row.aiScoreBreakdown, row.aiScoreBreakdown || ""),
    genres: safeJsonParse(row.genres, []),
    products: safeJsonParse(row.products, []),
    directions: safeJsonParse(row.directions, []),
    tones: safeJsonParse(row.tones, []),
    purposes: safeJsonParse(row.purposes, []),
    expressions: safeJsonParse(row.expressions, []),
    allTags: safeJsonParse(row.allTags, []),
    productionCredits: safeJsonParse(row.productionCredits, []),
    curationNote: safeJsonParse(row.curationNote, {}),
    aiAnalysis: String(row.aiAnalysis || ""),
    embedStatus: String(row.embedStatus || "unknown"),
    calibrationStatus: row.calibrationStatus ?? null,
    calibratedScore: Number.isFinite(calScore) ? calScore : null,
    calibratedRank: row.calibratedRank ?? null,
    calibratedTierBand: row.calibratedTierBand ?? null,
    calibratedBreakdown: calBreakdownRaw,
    calibrationVersion: row.calibrationVersion ?? null,
    calibratedAt: Number.isFinite(calAtEpoch) ? calAtEpoch : null,
    calibratedRoute: row.calibratedRoute ?? null,
    calibratedRunId: row.calibratedRunId ?? null,
    calibrationGenreBucket: row.calibrationGenreBucket ?? null,
  };
}

const PYTHON_SYNC_SCRIPT = String.raw`
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone

studio_root = sys.argv[1]
sqlite_path = sys.argv[2]
tidb_jsonl_path = sys.argv[3]
dry_run = sys.argv[4] == "1"
backup_path = sys.argv[5] if len(sys.argv) > 5 and sys.argv[5] else None

sys.path.insert(0, studio_root)
from iketeru_studio.indexer import CALIBRATION_COLUMNS, KnowledgeIndex

tidb_rows = []
tidb_by_id = {}
with open(tidb_jsonl_path, "r", encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        rec = json.loads(line)
        tidb_rows.append(rec)
        tidb_by_id[rec["id"]] = rec

def read_sqlite_snapshot(db_path):
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    cols = [r[1] for r in con.execute("PRAGMA table_info(videos)").fetchall()]
    ids = {r[0] for r in con.execute("SELECT id FROM videos").fetchall()}
    counts = {
        "videos": con.execute("SELECT COUNT(*) FROM videos").fetchone()[0],
        "scenes": con.execute("SELECT COUNT(*) FROM scenes").fetchone()[0],
        "craft_recipes": con.execute("SELECT COUNT(*) FROM craft_recipes").fetchone()[0],
    }
    con.close()
    return cols, ids, counts

pre_cols, pre_ids, pre_counts = read_sqlite_snapshot(sqlite_path)
tidb_ids = set(tidb_by_id.keys())
shared_ids = sorted(tidb_ids & pre_ids)
tidb_only_ids = sorted(tidb_ids - pre_ids)
sqlite_only_ids = sorted(pre_ids - tidb_ids)

cal_col_names = [c[0] for c in CALIBRATION_COLUMNS]
missing_cal_cols = [c for c in cal_col_names if c not in pre_cols]

tidb_cal_status_counts = {}
tidb_calibrated_ids = []
for r in tidb_rows:
    st = r.get("calibrationStatus") or "null"
    tidb_cal_status_counts[st] = tidb_cal_status_counts.get(st, 0) + 1
    if r.get("calibratedScore") is not None:
        tidb_calibrated_ids.append(r["id"])

result = {
    "mode": "dry_run" if dry_run else "apply",
    "sqlitePath": sqlite_path,
    "preSync": {
        "columnsCount": len(pre_cols),
        "missingCalibrationColumns": missing_cal_cols,
        "counts": pre_counts,
    },
    "idDiff": {
        "tidbTotal": len(tidb_ids),
        "sqlitePreTotal": len(pre_ids),
        "sharedCount": len(shared_ids),
        "tidbOnlyCount": len(tidb_only_ids),
        "sqliteOnlyCount": len(sqlite_only_ids),
        "expectedSqlitePostTotal": len(pre_ids) + len(tidb_only_ids),
        "tidbCalibratedCount": len(tidb_calibrated_ids),
        "tidbCalibrationStatusCounts": tidb_cal_status_counts,
    },
}

if dry_run:
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0)

# Apply strictly one-way TiDB -> SQLite mirror sync
idx = KnowledgeIndex(db_path=sqlite_path)
sync_ts_iso = datetime.now(timezone.utc).isoformat()

with idx._session() as con:
    # 1. Shared rows: update ONLY the 10 new calibration_* columns (0 mutations to existing 34 columns)
    shared_updates = []
    for vid in shared_ids:
        r = tidb_by_id[vid]
        shared_updates.append(
            (
                r.get("calibrationStatus"),
                r.get("calibratedScore"),
                r.get("calibratedRank"),
                r.get("calibratedTierBand"),
                r.get("calibratedBreakdown") or "",
                r.get("calibrationVersion"),
                r.get("calibratedAt"),
                r.get("calibratedRoute"),
                r.get("calibratedRunId"),
                r.get("calibrationGenreBucket"),
                vid,
            )
        )
    con.executemany(
        """
        UPDATE videos
        SET calibration_status = ?,
            calibrated_score = ?,
            calibrated_rank = ?,
            calibrated_tier_band = ?,
            calibrated_breakdown_json = ?,
            calibration_version = ?,
            calibrated_at = ?,
            calibrated_route = ?,
            calibrated_run_id = ?,
            calibration_genre_bucket = ?
        WHERE id = ?
        """,
        shared_updates,
    )

    # 2. TiDB-only rows: insert cleanly via KnowledgeIndex.upsert_video (preserves all 10 calibration columns + FTS + scenes)
    for vid in tidb_only_ids:
        idx.upsert_video(tidb_by_id[vid], con=con)

    # 3. SQLite-only rows: DO NOT delete! Set calibration_status only if NULL, without touching any of the 34 existing columns
    sqlite_only_tagged = 0
    for vid in sqlite_only_ids:
        cur = con.execute(
            """
            UPDATE videos
            SET calibration_status = CASE
                WHEN overall_score_100 IS NOT NULL OR TRIM(COALESCE(overall_rating, '')) != ''
                THEN 'legacy_uncalibrated'
                ELSE 'unscored'
            END
            WHERE id = ? AND calibration_status IS NULL
            """,
            (vid,),
        )
        sqlite_only_tagged += cur.rowcount

    con.execute(
        "INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_tidb_calibration_sync', ?)",
        (sync_ts_iso,),
    )
    con.commit()

# Exhaustive post-sync verification
post_cols, post_ids, post_counts = read_sqlite_snapshot(sqlite_path)
missing_sqlite_only = sorted(set(sqlite_only_ids) - post_ids)
missing_tidb_only = sorted(set(tidb_only_ids) - post_ids)

con = sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True)
con.row_factory = sqlite3.Row

def norm_json_obj(s):
    if s is None or s == "":
        return None
    try:
        return json.loads(s)
    except Exception:
        return s

cal_mismatches_all = []
cal_mismatches_200 = []
checked_all = 0
checked_calibrated = 0

rows_by_id = {}
for row in con.execute(
    """
    SELECT id, calibration_status, calibrated_score, calibrated_rank, calibrated_tier_band,
           calibrated_breakdown_json, calibration_version, calibrated_at,
           calibrated_route, calibrated_run_id, calibration_genre_bucket
    FROM videos
    """
).fetchall():
    rows_by_id[row["id"]] = dict(row)

for vid, t in tidb_by_id.items():
    checked_all += 1
    s = rows_by_id.get(vid)
    if s is None:
        err = {"id": vid, "field": "_row_missing"}
        cal_mismatches_all.append(err)
        if t.get("calibratedScore") is not None:
            cal_mismatches_200.append(err)
        continue

    is_cal = t.get("calibratedScore") is not None
    if is_cal:
        checked_calibrated += 1

    diffs = []
    pairs = [
        ("calibration_status", t.get("calibrationStatus"), s["calibration_status"]),
        ("calibrated_rank", t.get("calibratedRank"), s["calibrated_rank"]),
        ("calibrated_tier_band", t.get("calibratedTierBand"), s["calibrated_tier_band"]),
        ("calibration_version", t.get("calibrationVersion"), s["calibration_version"]),
        ("calibrated_at", t.get("calibratedAt"), s["calibrated_at"]),
        ("calibrated_route", t.get("calibratedRoute"), s["calibrated_route"]),
        ("calibrated_run_id", t.get("calibratedRunId"), s["calibrated_run_id"]),
        ("calibration_genre_bucket", t.get("calibrationGenreBucket"), s["calibration_genre_bucket"]),
    ]
    for fname, tv, sv in pairs:
        if tv != sv:
            diffs.append({"field": fname, "tidb": tv, "sqlite": sv})

    # Float comparison for calibrated_score
    ts = t.get("calibratedScore")
    ss = s["calibrated_score"]
    if (ts is None) != (ss is None) or (ts is not None and abs(float(ts) - float(ss)) > 1e-6):
        diffs.append({"field": "calibrated_score", "tidb": ts, "sqlite": ss})

    # Deep JSON comparison for calibrated_breakdown_json
    tb = norm_json_obj(t.get("calibratedBreakdown") or "")
    sb = norm_json_obj(s["calibrated_breakdown_json"] or "")
    if tb != sb:
        diffs.append({"field": "calibrated_breakdown_json", "tidb_type": type(tb).__name__, "sqlite_type": type(sb).__name__})

    if diffs:
        entry = {"id": vid, "diffs": diffs}
        cal_mismatches_all.append(entry)
        if is_cal:
            cal_mismatches_200.append(entry)

post_cal_status_counts = {}
for r in con.execute(
    "SELECT COALESCE(calibration_status, 'null') AS st, COUNT(*) AS cnt FROM videos GROUP BY COALESCE(calibration_status, 'null')"
).fetchall():
    post_cal_status_counts[str(r["st"])] = int(r["cnt"])

sqlite_only_cal_status_counts = {}
if sqlite_only_ids:
    ph = ",".join("?" for _ in sqlite_only_ids)
    for r in con.execute(
        f"SELECT COALESCE(calibration_status, 'null') AS st, COUNT(*) AS cnt FROM videos WHERE id IN ({ph}) GROUP BY COALESCE(calibration_status, 'null')",
        sqlite_only_ids,
    ).fetchall():
        sqlite_only_cal_status_counts[str(r["st"])] = int(r["cnt"])

# Optional exhaustive comparison of ALL 34 pre-existing columns against pre-sync SQLite backup
legacy_col_diff_summary = None
if backup_path and os.path.exists(backup_path):
    bak = sqlite3.connect(f"file:{backup_path}?mode=ro", uri=True)
    bak.row_factory = sqlite3.Row
    bak_cols = [r[1] for r in bak.execute("PRAGMA table_info(videos)").fetchall()]
    cols_sql = ", ".join(f'"{c}"' for c in bak_cols)
    cur_bak = bak.execute(f"SELECT {cols_sql} FROM videos ORDER BY id ASC")
    cur_now = con.execute(f"SELECT {cols_sql} FROM videos WHERE id IN ({','.join('?' for _ in pre_ids)}) ORDER BY id ASC", sorted(pre_ids))
    bak_rows_checked = 0
    legacy_diffs = []
    for br, nr in zip(cur_bak, cur_now):
        bak_rows_checked += 1
        if br["id"] != nr["id"]:
            legacy_diffs.append({"id_mismatch": [br["id"], nr["id"]]})
            if len(legacy_diffs) >= 10:
                break
            continue
        for c in bak_cols:
            if br[c] != nr[c]:
                legacy_diffs.append({"id": br["id"], "column": c})
                if len(legacy_diffs) >= 10:
                    break
        if len(legacy_diffs) >= 10:
            break
    bak.close()
    legacy_col_diff_summary = {
        "backupPath": backup_path,
        "existingColumnsChecked": len(bak_cols),
        "preExistingRowsChecked": bak_rows_checked,
        "diffCount": len(legacy_diffs),
        "sampleDiffs": legacy_diffs,
    }

con.close()

result["apply"] = {
    "syncTimestampUtc": sync_ts_iso,
    "sharedRowsUpdated": len(shared_updates),
    "tidbOnlyRowsInserted": len(tidb_only_ids),
    "sqliteOnlyRowsPreserved": len(sqlite_only_ids),
    "sqliteOnlyRowsTagged": sqlite_only_tagged,
}
result["postSync"] = {
    "columnsCount": len(post_cols),
    "addedColumns": [c for c in post_cols if c not in pre_cols],
    "counts": post_counts,
    "calibrationStatusCounts": post_cal_status_counts,
    "sqliteOnlyCalibrationStatusCounts": sqlite_only_cal_status_counts,
}
result["verification"] = {
    "zeroDeletions": len(missing_sqlite_only) == 0 and post_counts["videos"] == len(pre_ids) + len(tidb_only_ids),
    "missingSqliteOnlyIds": missing_sqlite_only,
    "missingTidbOnlyIds": missing_tidb_only,
    "scenesNonRegressing": post_counts["scenes"] >= pre_counts["scenes"],
    "craftRecipesUnchanged": post_counts["craft_recipes"] == pre_counts["craft_recipes"],
    "tidbAllRowsChecked": checked_all,
    "tidbAllRowsMismatchCount": len(cal_mismatches_all),
    "tidbAllRowsSampleMismatches": cal_mismatches_all[:5],
    "calibratedRowsChecked": checked_calibrated,
    "calibratedRowsMismatchCount": len(cal_mismatches_200),
    "calibratedRowsSampleMismatches": cal_mismatches_200[:5],
    "existingColumnsDiffAgainstBackup": legacy_col_diff_summary,
}

all_ok = (
    result["verification"]["zeroDeletions"]
    and len(missing_tidb_only) == 0
    and result["verification"]["scenesNonRegressing"]
    and result["verification"]["craftRecipesUnchanged"]
    and result["verification"]["tidbAllRowsMismatchCount"] == 0
    and result["verification"]["calibratedRowsMismatchCount"] == 0
    and (legacy_col_diff_summary is None or legacy_col_diff_summary["diffCount"] == 0)
)
result["verification"]["allPassed"] = all_ok

print(json.dumps(result, ensure_ascii=False))
sys.exit(0 if all_ok else 1)
`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  require("dotenv").config({ path: path.join(REPO_ROOT, ".env") });
  const mysql = require("mysql2/promise");

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set in E:\\iketeru-eizou\\.env");
  }
  if (!fs.existsSync(opts.sqlitePath)) {
    throw new Error(`SQLite database not found: ${opts.sqlitePath}`);
  }

  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });

  let tidbPreMeta;
  let tidbPostMeta;
  const tmpFile = path.join(os.tmpdir(), `tidb_mirror_export_${Date.now()}.jsonl`);

  try {
    // Strictly READ-ONLY queries against TiDB
    const [preRows] = await conn.query("SELECT COUNT(*) AS cnt, MAX(updatedAt) AS max_upd FROM videos");
    tidbPreMeta = {
      count: Number(preRows[0].cnt),
      maxUpdatedAt:
        preRows[0].max_upd instanceof Date
          ? preRows[0].max_upd.toISOString()
          : String(preRows[0].max_upd),
    };

    const [rows] = await conn.query(`
      SELECT
        id, platform, title, videoUrl, source, sourceLabel, channelTitle, addedDate,
        aiOverallRating, aiDirectionRating, aiTechniqueRating,
        aiOverallScore, aiDirectionScore, aiTechniqueScore, aiScoreBreakdown,
        genres, products, directions, tones, purposes, expressions, allTags,
        productionCredits, curationNote, aiAnalysis, embedStatus,
        calibrationStatus, calibratedScore, calibratedRank, calibratedTierBand,
        calibratedBreakdown, calibrationVersion,
        UNIX_TIMESTAMP(calibratedAt) AS calibratedAtEpoch,
        calibratedRoute, calibratedRunId, calibrationGenreBucket
      FROM videos
      ORDER BY id ASC
    `);

    if (rows.length !== tidbPreMeta.count) {
      throw new Error(`TiDB row count mismatch during SELECT: ${rows.length} vs ${tidbPreMeta.count}`);
    }

    const fd = fs.openSync(tmpFile, "w");
    try {
      for (const row of rows) {
        fs.writeSync(fd, JSON.stringify(normalizeTidbRow(row)) + "\n", null, "utf8");
      }
    } finally {
      fs.closeSync(fd);
    }

    const pyArgs = [
      "-c",
      PYTHON_SYNC_SCRIPT,
      opts.studioRoot,
      opts.sqlitePath,
      tmpFile,
      opts.dryRun ? "1" : "0",
      opts.backupPath || "",
    ];
    const pyRes = spawnSync("python", pyArgs, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
    });

    if (pyRes.error) {
      throw pyRes.error;
    }
    if (!pyRes.stdout || !pyRes.stdout.trim()) {
      throw new Error(`Python sync worker produced no stdout. stderr:\n${pyRes.stderr}`);
    }

    const pyReport = JSON.parse(pyRes.stdout.trim());

    // Post-sync TiDB read-only check to prove TiDB was completely untouched
    const [postRows] = await conn.query("SELECT COUNT(*) AS cnt, MAX(updatedAt) AS max_upd FROM videos");
    tidbPostMeta = {
      count: Number(postRows[0].cnt),
      maxUpdatedAt:
        postRows[0].max_upd instanceof Date
          ? postRows[0].max_upd.toISOString()
          : String(postRows[0].max_upd),
    };

    const tidbUnchanged =
      tidbPreMeta.count === tidbPostMeta.count &&
      tidbPreMeta.maxUpdatedAt === tidbPostMeta.maxUpdatedAt;

    const fullReport = {
      generatedAtUtc: new Date().toISOString(),
      direction: "TiDB (read-only) -> SQLite mirror (one-way)",
      tidb: {
        pre: tidbPreMeta,
        post: tidbPostMeta,
        unchanged: tidbUnchanged,
      },
      ...pyReport,
    };

    if (!opts.dryRun) {
      fullReport.postSync.sqliteFileBytes = fs.statSync(opts.sqlitePath).size;
      fullReport.postSync.sqliteSha256 = sha256File(opts.sqlitePath);
      fullReport.verification.tidbUnchanged = tidbUnchanged;
      fullReport.verification.allPassed = Boolean(fullReport.verification.allPassed && tidbUnchanged);
    }

    if (opts.reportOut) {
      fs.mkdirSync(path.dirname(opts.reportOut), { recursive: true });
      fs.writeFileSync(opts.reportOut, JSON.stringify(fullReport, null, 2) + "\n", "utf8");
    }

    console.log(JSON.stringify(fullReport, null, 2));

    if (pyRes.status !== 0 || !tidbUnchanged) {
      if (pyRes.stderr) console.error(pyRes.stderr);
      process.exit(1);
    }
  } finally {
    await conn.end();
    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
