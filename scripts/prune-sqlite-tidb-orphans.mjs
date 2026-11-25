#!/usr/bin/env node
/**
 * Prune SQLite-only orphan rows (rows previously deleted from production TiDB)
 * from local iketeru_knowledge.db in a single transaction, with mandatory safety gates.
 *
 * Guarantees:
 *  - Strictly READ-ONLY against TiDB (SELECT only; verifies TiDB COUNT(*) & MAX(updatedAt) unchanged).
 *  - Does NOT modify sync-tidb-to-sqlite-mirror.mjs (regular sync stays zeroDeletions).
 *  - --dry-run (default): opens SQLite read-only, lists all TiDB-absent IDs, counts
 *    associated `scenes` rows and `craft_recipes` references. Exits non-zero if
 *    `craft_recipes` references >= 1 orphan ID.
 *  - --apply:
 *      1. Fails closed if `craft_recipes` references >= 1 orphan ID.
 *      2. Takes a full pre-prune SQLite backup (with SHA-256) before any write.
 *      3. Deletes orphan IDs from `videos_fts`, `scenes_fts`, `scenes`, and `videos`
 *         inside a SINGLE SQLite transaction (`BEGIN IMMEDIATE ... COMMIT`).
 *      4. Verifies post-prune SQLite `videos` count === TiDB `videos` count (0 orphans left),
 *         `craft_recipes` count unchanged, and TiDB unchanged.
 *
 * Usage:
 *   node scripts/prune-sqlite-tidb-orphans.mjs --dry-run [--sqlite-path <path>] [--tidb-ids-file <json>]
 *   node scripts/prune-sqlite-tidb-orphans.mjs --apply [--sqlite-path <path>] [--backup-path <path> | --backup-dir <dir>] [--tidb-ids-file <json>]
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
const DEFAULT_BACKUP_ROOT = "E:\\iketeru_backups";

const VALUE_FLAGS = new Set([
  "sqlite-path",
  "backup-path",
  "backup-dir",
  "tidb-ids-file",
  "report-out",
]);

export function parseArgs(argv) {
  const opts = {
    dryRun: true,
    apply: false,
    sqlitePath: DEFAULT_SQLITE_PATH,
    backupPath: null,
    backupDir: null,
    tidbIdsFile: null,
    reportOut: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") {
      opts.dryRun = true;
      opts.apply = false;
    } else if (a === "--apply") {
      opts.apply = true;
      opts.dryRun = false;
    } else if (a.startsWith("--") && VALUE_FLAGS.has(a.slice(2))) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`Missing value for --${k}`);
      }
      if (k === "sqlite-path") opts.sqlitePath = next;
      else if (k === "backup-path") opts.backupPath = next;
      else if (k === "backup-dir") opts.backupDir = next;
      else if (k === "tidb-ids-file") opts.tidbIdsFile = next;
      else if (k === "report-out") opts.reportOut = next;
      i++;
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return opts;
}

export function sha256File(filePath) {
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

function localTimestampStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const PYTHON_PRUNE_SCRIPT = `
import json, pathlib, sqlite3, sys

sqlite_path = sys.argv[1]
tidb_ids_path = sys.argv[2]
apply_mode = sys.argv[3] == "1"

tidb_ids = set(str(x) for x in json.loads(pathlib.Path(tidb_ids_path).read_text(encoding="utf-8")))

if not apply_mode:
    uri = pathlib.Path(sqlite_path).resolve().as_uri() + "?mode=ro"
    con = sqlite3.connect(uri, uri=True)
else:
    con = sqlite3.connect(sqlite_path, isolation_level=None)

con.row_factory = sqlite3.Row
cur = con.cursor()

tables = {r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
has_videos_fts = "videos_fts" in tables
has_scenes = "scenes" in tables
has_scenes_fts = "scenes_fts" in tables
has_craft_recipes = "craft_recipes" in tables

video_cols = {r[1] for r in cur.execute("PRAGMA table_info(videos)").fetchall()}
has_obs_col = "analysis_observation_scope" in video_cols

select_obs = "analysis_observation_scope" if has_obs_col else "NULL AS analysis_observation_scope"
all_videos = cur.execute(
    f"SELECT id, platform, title, source, source_label, added_date, {select_obs} FROM videos ORDER BY id ASC"
).fetchall()

sqlite_pre_count = len(all_videos)
craft_pre_count = cur.execute("SELECT COUNT(*) FROM craft_recipes").fetchone()[0] if has_craft_recipes else 0
scenes_pre_count = cur.execute("SELECT COUNT(*) FROM scenes").fetchone()[0] if has_scenes else 0

orphans = [dict(r) for r in all_videos if str(r["id"]) not in tidb_ids]
orphan_ids = [str(r["id"]) for r in orphans]

scenes_by_vid = {}
scenes_to_delete = 0
if has_scenes and orphan_ids:
    ph = ",".join(["?"] * len(orphan_ids))
    for r in cur.execute(f"SELECT video_id, COUNT(*) AS cnt FROM scenes WHERE video_id IN ({ph}) GROUP BY video_id", orphan_ids).fetchall():
        scenes_by_vid[str(r["video_id"])] = int(r["cnt"])
        scenes_to_delete += int(r["cnt"])

craft_refs = []
if has_craft_recipes and orphan_ids:
    ph = ",".join(["?"] * len(orphan_ids))
    for r in cur.execute(f"SELECT video_id, COUNT(*) AS cnt FROM craft_recipes WHERE video_id IN ({ph}) GROUP BY video_id ORDER BY video_id ASC", orphan_ids).fetchall():
        craft_refs.append({"video_id": str(r["video_id"]), "recipe_count": int(r["cnt"])})

for o in orphans:
    o["scenes_count"] = scenes_by_vid.get(str(o["id"]), 0)

safe_to_prune = len(craft_refs) == 0

report = {
    "mode": "apply" if apply_mode else "dry_run",
    "sqlite_path": sqlite_path,
    "tidb_count": len(tidb_ids),
    "sqlite_pre_count": sqlite_pre_count,
    "scenes_pre_count": scenes_pre_count,
    "craft_recipes_pre_count": craft_pre_count,
    "orphan_count": len(orphan_ids),
    "scenes_rows_to_delete": scenes_to_delete,
    "orphan_videos_with_scenes_count": len(scenes_by_vid),
    "craft_recipes_references_count": sum(x["recipe_count"] for x in craft_refs),
    "craft_recipes_referenced_videos": craft_refs,
    "safe_to_prune": safe_to_prune,
    "orphan_ids": orphan_ids,
    "orphan_details": orphans,
}

if not safe_to_prune:
    report["aborted_reason"] = "craft_recipes_references_detected"
    con.close()
    print(json.dumps(report, ensure_ascii=False, indent=2))
    sys.exit(1)

if apply_mode:
    deleted = {"videos_fts": 0, "scenes_fts": 0, "scenes": 0, "videos": 0}
    try:
        cur.execute("BEGIN IMMEDIATE")
        if orphan_ids:
            ph = ",".join(["?"] * len(orphan_ids))
            if has_videos_fts:
                cur.execute(f"DELETE FROM videos_fts WHERE video_id IN ({ph})", orphan_ids)
                deleted["videos_fts"] = cur.rowcount
            if has_scenes_fts:
                cur.execute(f"DELETE FROM scenes_fts WHERE video_id IN ({ph})", orphan_ids)
                deleted["scenes_fts"] = cur.rowcount
            if has_scenes:
                cur.execute(f"DELETE FROM scenes WHERE video_id IN ({ph})", orphan_ids)
                deleted["scenes"] = cur.rowcount
            cur.execute(f"DELETE FROM videos WHERE id IN ({ph})", orphan_ids)
            deleted["videos"] = cur.rowcount
        cur.execute("COMMIT")
    except Exception:
        cur.execute("ROLLBACK")
        con.close()
        raise

    post_videos_count = cur.execute("SELECT COUNT(*) FROM videos").fetchone()[0]
    post_scenes_count = cur.execute("SELECT COUNT(*) FROM scenes").fetchone()[0] if has_scenes else 0
    post_craft_count = cur.execute("SELECT COUNT(*) FROM craft_recipes").fetchone()[0] if has_craft_recipes else 0
    post_ids = {str(r[0]) for r in cur.execute("SELECT id FROM videos").fetchall()}
    remaining_orphans = sorted(post_ids - tidb_ids)
    missing_tidb_ids = sorted(tidb_ids - post_ids)

    obs_after = {}
    if has_obs_col:
        for r in cur.execute("SELECT COALESCE(analysis_observation_scope, '(NULL)') AS s, COUNT(*) AS c FROM videos GROUP BY s").fetchall():
            obs_after[str(r["s"])] = int(r["c"])

    report["apply"] = {
        "deleted_rows": deleted,
        "sqlite_post_count": post_videos_count,
        "scenes_post_count": post_scenes_count,
        "craft_recipes_post_count": post_craft_count,
        "remaining_orphan_count": len(remaining_orphans),
        "missing_tidb_ids_count": len(missing_tidb_ids),
        "matches_tidb_count": post_videos_count == len(tidb_ids),
        "craft_recipes_unchanged": post_craft_count == craft_pre_count,
        "observation_scope_counts_after": obs_after,
    }
    con.close()
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if not (post_videos_count == len(tidb_ids) and len(remaining_orphans) == 0 and post_craft_count == craft_pre_count):
        sys.exit(1)
else:
    con.close()
    print(json.dumps(report, ensure_ascii=False, indent=2))
`;

async function fetchTidbState() {
  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  require("dotenv").config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
  const mysql = require("mysql2/promise");
  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });
  try {
    const [metaRows] = await conn.query("SELECT COUNT(*) AS cnt, MAX(updatedAt) AS max_upd FROM videos");
    const [idRows] = await conn.query("SELECT id FROM videos ORDER BY id ASC");
    const maxUpd =
      metaRows[0].max_upd instanceof Date
        ? metaRows[0].max_upd.toISOString()
        : String(metaRows[0].max_upd);
    return {
      count: Number(metaRows[0].cnt),
      maxUpdatedAt: maxUpd,
      ids: idRows.map((r) => String(r.id)),
    };
  } finally {
    await conn.end();
  }
}

export async function runPrune(opts) {
  if (!fs.existsSync(opts.sqlitePath)) {
    throw new Error(`SQLite database not found: ${opts.sqlitePath}`);
  }

  let tidbPre;
  let tidbIds;
  if (opts.tidbIdsFile) {
    const raw = JSON.parse(fs.readFileSync(opts.tidbIdsFile, "utf8"));
    tidbIds = (Array.isArray(raw) ? raw : raw.ids || raw.video_ids || []).map(String);
    tidbPre = { source: "file", path: opts.tidbIdsFile, count: tidbIds.length, maxUpdatedAt: null };
  } else {
    const state = await fetchTidbState();
    tidbIds = state.ids;
    tidbPre = { source: "tidb", count: state.count, maxUpdatedAt: state.maxUpdatedAt };
  }

  let backupInfo = null;
  if (opts.apply) {
    const targetBackupPath =
      opts.backupPath ||
      path.join(
        opts.backupDir || process.env.IKETERU_BACKUP_ROOT || DEFAULT_BACKUP_ROOT,
        `sqlite_pre_prune_orphans_${localTimestampStamp()}`,
        path.basename(opts.sqlitePath)
      );
    fs.mkdirSync(path.dirname(targetBackupPath), { recursive: true });
    fs.copyFileSync(opts.sqlitePath, targetBackupPath);
    const bakSha = sha256File(targetBackupPath);
    const srcSha = sha256File(opts.sqlitePath);
    if (bakSha !== srcSha) {
      throw new Error(`Pre-prune SQLite backup SHA-256 mismatch: ${bakSha} !== ${srcSha}`);
    }
    backupInfo = {
      path: targetBackupPath,
      bytes: fs.statSync(targetBackupPath).size,
      sha256: bakSha,
    };
  }

  const tmpIdsPath = path.join(os.tmpdir(), `tidb_ids_prune_${Date.now()}_${process.pid}.json`);
  try {
    fs.writeFileSync(tmpIdsPath, JSON.stringify(tidbIds), "utf8");
    const pyRes = spawnSync(
      "python",
      ["-c", PYTHON_PRUNE_SCRIPT, opts.sqlitePath, tmpIdsPath, opts.apply ? "1" : "0"],
      {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
      }
    );
    if (pyRes.error) throw pyRes.error;
    if (!pyRes.stdout || !pyRes.stdout.trim()) {
      throw new Error(`Python prune worker produced no output. stderr:\n${pyRes.stderr}`);
    }
    const report = JSON.parse(pyRes.stdout.trim());

    let tidbUnchanged = true;
    let tidbPost = tidbPre;
    if (!opts.tidbIdsFile) {
      const post = await fetchTidbState();
      tidbPost = { source: "tidb", count: post.count, maxUpdatedAt: post.maxUpdatedAt };
      tidbUnchanged =
        tidbPre.count === tidbPost.count && tidbPre.maxUpdatedAt === tidbPost.maxUpdatedAt;
    }

    const fullReport = {
      generated_at_utc: new Date().toISOString(),
      tidb: { pre: tidbPre, post: tidbPost, unchanged: tidbUnchanged },
      pre_prune_backup: backupInfo,
      ...report,
    };

    if (opts.reportOut) {
      fs.mkdirSync(path.dirname(opts.reportOut), { recursive: true });
      fs.writeFileSync(opts.reportOut, JSON.stringify(fullReport, null, 2) + "\n", "utf8");
    }

    return {
      exitCode: pyRes.status === 0 && tidbUnchanged ? 0 : 1,
      report: fullReport,
    };
  } finally {
    if (fs.existsSync(tmpIdsPath)) fs.unlinkSync(tmpIdsPath);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runPrune(parseArgs(process.argv))
    .then(({ exitCode, report }) => {
      console.log(JSON.stringify(report, null, 2));
      process.exit(exitCode);
    })
    .catch((err) => {
      console.error(err.message || err);
      process.exit(2);
    });
}
