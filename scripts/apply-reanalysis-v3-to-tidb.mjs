#!/usr/bin/env node
/**
 * Apply Verified Analysis v3 (D-026) from Canonical Store (iketeru_analysis_v3) to TiDB & Local SQLite Scenes.
 *
 * Guarantees:
 *  - Reads canonical store (`D:\マイドライブ\iketeru_analysis_v3` or `--v3-store-dir`).
 *  - ONLY accepts videos whose `manifest.json` SHA-256 matches `analysis_v3.md` & `mechanical_check.json`,
 *    AND whose `mechanical_check.json` passed (`mechanical.all_passed === true`, `transcript_audit.ok === true`).
 *  - On real `--apply`:
 *      * REQUIRES active lock in `analysis/claims/_apply_lock.json` matching `(worker, run_id)`.
 *      * REQUIRES DDL columns (`videos.analysisVersion`, `analysisGeneratedAt`, `analysisPromptSha256`) and
 *        table `videoAnalysisHistory` to exist (never executes DDL automatically!).
 *      * Takes fresh local backups of TiDB `videos` and local SQLite before writing.
 *      * Per-video atomic transaction on TiDB:
 *          1. INSERT old `aiAnalysis` snapshot into `videoAnalysisHistory`
 *          2. UPDATE `videos` (`aiAnalysis`, `analysisVersion='v3'`, `analysisGeneratedAt`, `analysisPromptSha256`,
 *             preserving `updatedAt = updatedAt`)
 *      * Per-video SQLite `scenes` & `scenes_fts` replacement for ONLY that `video_id`
 *        (`videoScenes` in TiDB will be handled after CHIBA-PC2 finishes its implementation).
 *      * Post-flight Pre-D 40-column audit allowing `aiAnalysis` diffs ONLY when SHA-256 matches the verified
 *        v3 canonical manifest (plus any approved D-024 overrides); any other diff fails closed.
 *  - On `--dry-run`: ZERO writes to TiDB or SQLite; inspects live TiDB, checks DDL readiness, previews all row/column
 *    changes & SQLite scene replacement counts, and runs simulated post-apply Pre-D 40-column audit + negative controls.
 *
 * Usage:
 *   node scripts/apply-reanalysis-v3-to-tidb.mjs --dry-run [--list <json> | --limit 20 | --ids id1,id2] [--v3-store-dir <dir>]
 *   node scripts/apply-reanalysis-v3-to-tidb.mjs --apply --run-id <id> --worker <w> [--list <json> | --limit 20 | --ids ...]
 *   node scripts/apply-reanalysis-v3-to-tidb.mjs --print-ddl
 */

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_APPROVED_OVERRIDES_PATH,
  DEFAULT_V3_STORE_DIR,
  auditOriginalColumnsAgainstPreD,
  loadApprovedTidbOverrides,
  loadV3CanonicalManifestMap,
  serializeTidbCellValue,
  sha256TidbCellValue,
} from "./approved-tidb-overrides.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const BACKUP_MANIFEST_PATH = path.join(REPO_ROOT, "analysis", "phase3_pre_d_backup_manifest.json");
const APPLY_LOCK_PATH = path.join(REPO_ROOT, "analysis", "claims", "_apply_lock.json");
const DDL_PATH = path.join(REPO_ROOT, "docs", "sql", "proposed_v3_analysis_ddl.sql");

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

const SCENE_LINE_RE = /^[-*]\s*#(\d+)\s*[【\[]\s*(\d{1,2}:\d{2})\s*[-–—~～]\s*(\d{1,2}:\d{2})\s*[】\]]\s*([^:：\n]+?)(?:[:：]\s*(.+))?$/;

export function parseMmssToSec(mmss) {
  const m = String(mmss || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function parseV3ScenesFromMarkdown(mdText) {
  const scenes = [];
  for (const rawLine of String(mdText || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    const m = line.match(SCENE_LINE_RE);
    if (!m) continue;
    const shotIndex = parseInt(m[1], 10);
    const startMmss = m[2];
    const endMmss = m[3];
    const startSec = parseMmssToSec(startMmss);
    const endSec = parseMmssToSec(endMmss);
    scenes.push({
      shot_index: shotIndex,
      start_mmss: startMmss,
      end_mmss: endMmss,
      start_sec: startSec,
      end_sec: endSec,
      duration_sec: Math.max(0, endSec - startSec),
      shot_title: String(m[4] || "").trim(),
      description: String(m[5] || "").trim(),
    });
  }
  return scenes;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        args[a.slice(2, eq)] = a.slice(eq + 1);
        continue;
      }
      const k = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) args[k] = true;
      else {
        args[k] = next;
        i++;
      }
    }
  }
  return args;
}

function loadDotenv() {
  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  require("dotenv").config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
}

function resolveWorkerName(argWorker) {
  loadDotenv();
  const name = String(argWorker || process.env.IKETERU_WORKER_NAME || "").trim();
  if (!name) {
    throw new Error("Worker name is required: pass --worker <name> or set IKETERU_WORKER_NAME.");
  }
  return name;
}

function loadApplyLock() {
  if (!fs.existsSync(APPLY_LOCK_PATH)) {
    return { schema_version: 1, status: "unlocked", worker: null, run_id: null, started_at: null };
  }
  return JSON.parse(fs.readFileSync(APPLY_LOCK_PATH, "utf8"));
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

function toMysqlTimestamp(isoStr) {
  if (!isoStr) return null;
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function localTimestampStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function loadPreDBackupMap(backupJsonlPath) {
  const lines = fs.readFileSync(backupJsonlPath, "utf8").split(/\r?\n/).filter(Boolean);
  const map = new Map();
  let originalColumns = null;
  for (const line of lines) {
    const obj = JSON.parse(line);
    if (!originalColumns) originalColumns = Object.keys(obj);
    map.set(String(obj.id), obj);
  }
  return { backupMap: map, originalColumns: originalColumns || [] };
}

function querySqliteSceneCounts(sqlitePath, videoIds) {
  const py = [
    "import json, sqlite3, sys",
    "db = sys.argv[1]",
    "ids = json.loads(sys.argv[2])",
    "con = sqlite3.connect(f'file:{db}?mode=ro', uri=True)",
    "out = {}",
    "for vid in ids:",
    "    cnt = con.execute('SELECT COUNT(*) FROM scenes WHERE video_id = ?', (vid,)).fetchone()[0]",
    "    row = con.execute('SELECT title FROM videos WHERE id = ?', (vid,)).fetchone()",
    "    out[vid] = {'old_scenes_count': cnt, 'sqlite_video_exists': bool(row), 'title': row[0] if row else ''}",
    "con.close()",
    "print(json.dumps(out, ensure_ascii=False))",
  ].join("\n");
  const stdout = execFileSync("python", ["-c", py, sqlitePath.replace(/\\/g, "/"), JSON.stringify(videoIds)], {
    encoding: "utf8",
    env: { ...process.env, PYTHONUTF8: "1" },
  });
  return JSON.parse(stdout);
}

function replaceSqliteScenesForVideo(sqlitePath, videoId, scenes) {
  const py = [
    "import json, sqlite3, sys",
    "db, vid, scenes = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])",
    "con = sqlite3.connect(db)",
    "try:",
    "    con.execute('BEGIN IMMEDIATE')",
    "    vrow = con.execute('SELECT title FROM videos WHERE id = ?', (vid,)).fetchone()",
    "    vtitle = vrow[0] if vrow else ''",
    "    old_cnt = con.execute('SELECT COUNT(*) FROM scenes WHERE video_id = ?', (vid,)).fetchone()[0]",
    "    con.execute('DELETE FROM scenes WHERE video_id = ?', (vid,))",
    "    con.execute('DELETE FROM scenes_fts WHERE video_id = ?', (vid,))",
    "    for s in scenes:",
    "        con.execute('INSERT INTO scenes (video_id, shot_index, start_mmss, end_mmss, start_sec, end_sec, duration_sec, shot_title, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', (vid, s['shot_index'], s['start_mmss'], s['end_mmss'], s['start_sec'], s['end_sec'], s['duration_sec'], s['shot_title'], s['description']))",
    "        con.execute('INSERT INTO scenes_fts (video_id, shot_index, video_title, shot_title, description) VALUES (?, ?, ?, ?, ?)', (vid, s['shot_index'], vtitle, s['shot_title'], s['description']))",
    "    con.commit()",
    "    new_cnt = con.execute('SELECT COUNT(*) FROM scenes WHERE video_id = ?', (vid,)).fetchone()[0]",
    "    print(json.dumps({'video_id': vid, 'old_scenes_count': old_cnt, 'new_scenes_count': new_cnt}))",
    "except Exception:",
    "    con.rollback()",
    "    raise",
    "finally:",
    "    con.close()",
  ].join("\n");
  const stdout = execFileSync("python", ["-c", py, sqlitePath.replace(/\\/g, "/"), videoId, JSON.stringify(scenes)], {
    encoding: "utf8",
    env: { ...process.env, PYTHONUTF8: "1" },
  });
  return JSON.parse(stdout);
}

async function checkTidbDdlReadiness(conn) {
  const [vidCols] = await conn.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'videos' AND COLUMN_NAME IN ('analysisVersion', 'analysisGeneratedAt', 'analysisPromptSha256')"
  );
  const existingVideoCols = new Set(vidCols.map((r) => String(r.COLUMN_NAME)));
  const requiredVideoCols = ["analysisVersion", "analysisGeneratedAt", "analysisPromptSha256"];
  const missingVideoCols = requiredVideoCols.filter((c) => !existingVideoCols.has(c));

  const [tables] = await conn.query(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('videoAnalysisHistory', 'videoScenes')"
  );
  const existingTables = new Set(tables.map((r) => String(r.TABLE_NAME)));

  return {
    videos_v3_columns_present: missingVideoCols.length === 0,
    missing_video_columns: missingVideoCols,
    videoAnalysisHistory_table_exists: existingTables.has("videoAnalysisHistory"),
    videoScenes_table_exists: existingTables.has("videoScenes"),
    ready_for_apply: missingVideoCols.length === 0 && existingTables.has("videoAnalysisHistory"),
  };
}

async function dumpFreshTidbBackup(conn, runId, backupRoot) {
  const stamp = localTimestampStamp();
  const dir = path.join(backupRoot, `v3_pre_apply_${runId}_${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, "tidb_videos_pre_apply.jsonl");
  const [rows] = await conn.query("SELECT * FROM videos ORDER BY id ASC");
  const fd = fs.openSync(outPath, "w");
  try {
    for (const row of rows) {
      const obj = {};
      for (const [k, v] of Object.entries(row)) obj[k] = serializeTidbCellValue(v);
      fs.writeSync(fd, JSON.stringify(obj) + "\n", null, "utf8");
    }
  } finally {
    fs.closeSync(fd);
  }
  return { path: outPath, rows: rows.length, sha256: sha256File(outPath) };
}

export function loadPinnedV3ApplyList(listPath) {
  const absPath = path.isAbsolute(listPath) ? listPath : path.resolve(REPO_ROOT, listPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Pinned v3 apply list not found: ${absPath}`);
  }
  const raw = fs.readFileSync(absPath);
  const listSha256 = crypto.createHash("sha256").update(raw).digest("hex");
  const doc = JSON.parse(raw.toString("utf8"));
  const entries = Array.isArray(doc.entries) ? doc.entries : Array.isArray(doc.videos) ? doc.videos : null;
  if (!entries || entries.length === 0) {
    throw new Error(`Pinned v3 apply list has no entries: ${absPath}`);
  }
  const seen = new Set();
  const normalized = [];
  for (let i = 0; i < entries.length; i++) {
    const item = entries[i];
    if (!item || typeof item !== "object") {
      throw new Error(`Pinned v3 apply list entry[${i}] is not an object`);
    }
    const vid = String(item.video_id || "").trim();
    const promptVersion = String(item.prompt_version || "").trim();
    const promptTemplateSha256 = String(item.prompt_template_sha256 || "").trim().toLowerCase();
    const analysisV3Sha256 = String(item.analysis_v3_sha256 || "").trim().toLowerCase();
    if (!vid) throw new Error(`Pinned v3 apply list entry[${i}] missing video_id`);
    if (seen.has(vid)) throw new Error(`Pinned v3 apply list has duplicate video_id "${vid}"`);
    seen.add(vid);
    if (!promptVersion) throw new Error(`Pinned v3 apply list entry "${vid}" missing prompt_version`);
    if (!/^[0-9a-f]{64}$/.test(promptTemplateSha256)) {
      throw new Error(`Pinned v3 apply list entry "${vid}" has invalid prompt_template_sha256 "${promptTemplateSha256}"`);
    }
    if (!/^[0-9a-f]{64}$/.test(analysisV3Sha256)) {
      throw new Error(`Pinned v3 apply list entry "${vid}" has invalid analysis_v3_sha256 "${analysisV3Sha256}"`);
    }
    normalized.push({
      video_id: vid,
      prompt_version: promptVersion,
      prompt_template_sha256: promptTemplateSha256,
      analysis_v3_sha256: analysisV3Sha256,
    });
  }
  return {
    path: absPath,
    sha256: listSha256,
    list_id: doc.list_id || path.basename(absPath),
    status: doc.status || null,
    entries: normalized,
  };
}

export function selectV3Entries({ v3Loaded, listPath = null, explicitIds = null, limit = 20, storeDir = "" }) {
  if (listPath && explicitIds && explicitIds.length > 0) {
    throw new Error("Cannot combine --list with --ids; specify only one.");
  }
  if (listPath) {
    const pinned = loadPinnedV3ApplyList(listPath);
    const selectedEntries = [];
    for (const req of pinned.entries) {
      if (!v3Loaded.valid_map.has(req.video_id)) {
        throw new Error(
          `Pinned video_id "${req.video_id}" from ${pinned.path} is not a verified passing v3 entry in ${storeDir || v3Loaded.store_dir}`
        );
      }
      const actual = v3Loaded.valid_map.get(req.video_id);
      const actualFileSha = String(actual.analysis_file_sha256 || "").toLowerCase();
      if (actualFileSha !== req.analysis_v3_sha256) {
        throw new Error(
          `Pinned analysis_v3.md SHA-256 mismatch for "${req.video_id}": pinned=${req.analysis_v3_sha256}, actual=${actualFileSha}`
        );
      }
      const actualPromptSha = String(actual.prompt_template_sha256 || "").toLowerCase();
      if (actualPromptSha !== req.prompt_template_sha256) {
        throw new Error(
          `Pinned prompt_template_sha256 mismatch for "${req.video_id}": pinned=${req.prompt_template_sha256}, actual=${actualPromptSha}`
        );
      }
      const actualPromptVersion = String(actual.prompt_version || actual.manifest_analysis_version || "").trim();
      if (actualPromptVersion !== req.prompt_version) {
        throw new Error(
          `Pinned prompt_version mismatch for "${req.video_id}": pinned=${req.prompt_version}, actual=${actualPromptVersion}`
        );
      }
      selectedEntries.push(actual);
    }
    return { selectedEntries, pinned };
  }

  let selectedEntries = [];
  if (explicitIds && explicitIds.length > 0) {
    for (const vid of explicitIds) {
      if (!v3Loaded.valid_map.has(vid)) {
        throw new Error(`Requested video_id "${vid}" is not a verified passing v3 entry in ${storeDir || v3Loaded.store_dir}`);
      }
      selectedEntries.push(v3Loaded.valid_map.get(vid));
    }
  } else {
    selectedEntries = Array.from(v3Loaded.valid_map.values()).slice(0, limit);
  }
  return { selectedEntries, pinned: null };
}

export async function runReanalysisV3Apply(opts) {
  const dryRun = Boolean(opts.dryRun);
  const storeDir = opts.storeDir || DEFAULT_V3_STORE_DIR;
  const limit = Number(opts.limit || 20);
  const explicitIds = opts.ids ? opts.ids.map(String) : null;
  const listPath = opts.listPath || null;
  const runId = opts.runId || `v3_apply_${localTimestampStamp()}`;

  const v3Loaded = loadV3CanonicalManifestMap(storeDir);
  if (!v3Loaded.exists) {
    throw new Error(`v3 canonical store directory not found: ${storeDir}`);
  }

  const { selectedEntries, pinned } = selectV3Entries({
    v3Loaded,
    listPath,
    explicitIds,
    limit,
    storeDir,
  });

  if (selectedEntries.length === 0) {
    throw new Error(`No verified passing v3 entries found in ${storeDir}`);
  }

  // Parse scenes for every selected entry & fail closed if 0 scenes parsed
  const parsedByVid = new Map();
  for (const e of selectedEntries) {
    const scenes = parseV3ScenesFromMarkdown(e.analysis_text);
    if (scenes.length === 0) {
      throw new Error(`Video "${e.video_id}" parsed 0 scenes from Ch.3 in analysis_v3.md`);
    }
    parsedByVid.set(e.video_id, scenes);
  }

  // Verify Pre-D baseline backup SHA-256
  const backupManifest = JSON.parse(fs.readFileSync(BACKUP_MANIFEST_PATH, "utf8"));
  const backupJsonlPath = opts.preDBackup || process.env.IKETERU_PRE_D_BACKUP_PATH || backupManifest.tidb.jsonl_path;
  if (!fs.existsSync(backupJsonlPath)) {
    throw new Error(`Pre-D backup not found: ${backupJsonlPath}`);
  }
  const actualBackupSha = sha256File(backupJsonlPath);
  if (actualBackupSha !== backupManifest.tidb.jsonl_sha256) {
    throw new Error(`Pre-D backup SHA-256 mismatch: expected=${backupManifest.tidb.jsonl_sha256}, actual=${actualBackupSha}`);
  }
  const { backupMap, originalColumns } = loadPreDBackupMap(backupJsonlPath);

  const approvedOverrides = loadApprovedTidbOverrides(opts.approvedOverridesPath || DEFAULT_APPROVED_OVERRIDES_PATH);
  const sqlitePath = opts.sqlitePath || process.env.IKETERU_SQLITE_PATH || backupManifest.sqlite.source_path;
  const sqliteExists = fs.existsSync(sqlitePath);
  const sqliteCounts = sqliteExists
    ? querySqliteSceneCounts(
        sqlitePath,
        selectedEntries.map((e) => e.video_id)
      )
    : {};

  const lock = loadApplyLock();
  const worker = dryRun ? opts.worker || process.env.IKETERU_WORKER_NAME || "dry_run" : resolveWorkerName(opts.worker);
  const lockMatches = lock.status === "locked" && lock.run_id === runId && lock.worker === worker;
  if (!dryRun && !lockMatches) {
    throw new Error(
      `Refusing to write to TiDB without active write lock in analysis/claims/_apply_lock.json! ` +
        `Expected status="locked", worker="${worker}", run_id="${runId}", found=${JSON.stringify(lock)}`
    );
  }

  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  const mysql = require("mysql2/promise");
  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });

  try {
    const ddlStatus = await checkTidbDdlReadiness(conn);
    const [liveRows] = await conn.query("SELECT * FROM videos ORDER BY id ASC");
    const liveById = new Map(liveRows.map((r) => [String(r.id), r]));

    // Ensure every target exists in live TiDB
    const missingInTidb = selectedEntries.filter((e) => !liveById.has(e.video_id)).map((e) => e.video_id);
    if (missingInTidb.length > 0) {
      throw new Error(`Target v3 video_id(s) not found in live TiDB videos: ${JSON.stringify(missingInTidb)}`);
    }

    const plannedChanges = selectedEntries.map((e) => {
      const cur = liveById.get(e.video_id);
      const oldAna = serializeTidbCellValue(cur.aiAnalysis);
      const newScenes = parsedByVid.get(e.video_id);
      const sqInfo = sqliteCounts[e.video_id] || {};
      return {
        video_id: e.video_id,
        title: String(cur.title || "").slice(0, 60),
        tidb_videos_columns_updated: ["aiAnalysis", "analysisVersion", "analysisGeneratedAt", "analysisPromptSha256"],
        old_analysis_version: cur.analysisVersion || "legacy",
        new_analysis_version: "v3",
        prompt_version: e.prompt_version || e.manifest_analysis_version || "v3",
        audit_performed: Boolean(e.audit_performed),
        audit_verdict: e.audit_verdict ?? null,
        created_by_pc: e.created_by_pc || null,
        old_aiAnalysis_chars: oldAna ? String(oldAna).length : 0,
        new_aiAnalysis_chars: e.analysis_text.length,
        old_aiAnalysis_sha256: sha256TidbCellValue(oldAna),
        new_aiAnalysis_sha256: e.analysis_content_sha256,
        analysisGeneratedAt_utc: toMysqlTimestamp(e.created_at),
        analysisPromptSha256: e.prompt_template_sha256,
        videoAnalysisHistory_insert: true,
        sqlite_scenes_old: sqInfo.old_scenes_count ?? null,
        sqlite_scenes_new: newScenes.length,
      };
    });

    if (dryRun) {
      // Simulate post-apply liveRows in memory (ZERO DB writes)
      const selectedMap = new Map(selectedEntries.map((e) => [e.video_id, e]));
      const simulatedRows = liveRows.map((r) => {
        const vid = String(r.id);
        if (!selectedMap.has(vid)) return r;
        return { ...r, aiAnalysis: selectedMap.get(vid).analysis_text };
      });

      const auditWithV3 = auditOriginalColumnsAgainstPreD({
        liveRows: simulatedRows,
        backupMap,
        originalColumns,
        legacyScoreColumns: LEGACY_SCORE_COLUMNS,
        approvedOverrideMap: approvedOverrides.active_map,
        v3ManifestMap: v3Loaded.valid_map,
      });

      const auditWithoutV3Control = auditOriginalColumnsAgainstPreD({
        liveRows: simulatedRows,
        backupMap,
        originalColumns,
        legacyScoreColumns: LEGACY_SCORE_COLUMNS,
        approvedOverrideMap: approvedOverrides.active_map,
        v3ManifestMap: new Map(),
      });

      // Negative control: tamper 1 character on first target's aiAnalysis
      const tamperedFirstVid = selectedEntries[0].video_id;
      const tamperedRows = simulatedRows.map((r) =>
        String(r.id) === tamperedFirstVid ? { ...r, aiAnalysis: `${r.aiAnalysis} ` } : r
      );
      const auditTamperedControl = auditOriginalColumnsAgainstPreD({
        liveRows: tamperedRows,
        backupMap,
        originalColumns,
        legacyScoreColumns: LEGACY_SCORE_COLUMNS,
        approvedOverrideMap: approvedOverrides.active_map,
        v3ManifestMap: v3Loaded.valid_map,
      });

      return {
        mode: "dry_run",
        tidb_writes_performed: 0,
        sqlite_writes_performed: 0,
        v3_store_dir: storeDir,
        v3_store_verified_count: v3Loaded.valid_map.size,
        v3_store_rejected_count: v3Loaded.rejected.length,
        v3_store_rejected_sample: v3Loaded.rejected.slice(0, 5),
        selected_count: selectedEntries.length,
        pinned_list_path: pinned ? pinned.path : null,
        pinned_list_id: pinned ? pinned.list_id : null,
        pinned_list_sha256: pinned ? pinned.sha256 : null,
        pinned_list_verified_count: pinned ? selectedEntries.length : null,
        apply_lock_status: lock.status,
        pre_d_backup_sha256_verified: actualBackupSha,
        ddl_readiness: ddlStatus,
        ddl_proposal_path: DDL_PATH,
        planned_tables_touched: ["videoAnalysisHistory (INSERT)", "videos (UPDATE 4 cols)", "sqlite:scenes & scenes_fts (REPLACE per video)"],
        planned_changes: plannedChanges,
        simulated_pre_d_audit: {
          with_v3_manifest: {
            passed: auditWithV3.passed,
            rows_compared: auditWithV3.rows_compared,
            total_cells_compared: auditWithV3.total_cells_compared,
            v3_manifest_matched_count: auditWithV3.v3_manifest_matched_count,
            approved_overrides_matched_count: auditWithV3.approved_overrides_matched_count,
            all_40_original_columns_mismatches: auditWithV3.all_40_original_columns_mismatches,
            legacy_8_score_columns_mismatches: auditWithV3.legacy_8_score_columns_mismatches,
          },
          control_without_v3_manifest: {
            passed: auditWithoutV3Control.passed,
            all_40_original_columns_mismatches: auditWithoutV3Control.all_40_original_columns_mismatches,
          },
          control_tampered_sha256: {
            passed: auditTamperedControl.passed,
            all_40_original_columns_mismatches: auditTamperedControl.all_40_original_columns_mismatches,
            sample_mismatch: auditTamperedControl.sample_mismatches[0] || null,
          },
        },
      };
    }

    // Real --apply path (fails closed if DDL not yet applied)
    if (!ddlStatus.ready_for_apply) {
      throw new Error(
        `TiDB DDL not ready for --apply! Missing: ${JSON.stringify(ddlStatus)}. ` +
          `Review & apply ${DDL_PATH} after explicit user approval first.`
      );
    }

    const backupRoot = opts.backupDir || process.env.IKETERU_BACKUP_ROOT || path.dirname(backupManifest.backup_dir);
    const tidbBackup = await dumpFreshTidbBackup(conn, runId, backupRoot);
    let sqliteBackupPath = null;
    if (sqliteExists) {
      const sqDir = path.join(backupRoot, `sqlite_pre_v3_apply_${runId}_${localTimestampStamp()}`);
      fs.mkdirSync(sqDir, { recursive: true });
      sqliteBackupPath = path.join(sqDir, path.basename(sqlitePath));
      fs.copyFileSync(sqlitePath, sqliteBackupPath);
    }

    const applied = [];
    for (const e of selectedEntries) {
      const cur = liveById.get(e.video_id);
      const oldAna = serializeTidbCellValue(cur.aiAnalysis);
      const oldVer = String(cur.analysisVersion || "legacy");
      const oldPromptSha = cur.analysisPromptSha256 ? String(cur.analysisPromptSha256) : null;
      const oldGenAt = cur.analysisGeneratedAt ? toMysqlTimestamp(serializeTidbCellValue(cur.analysisGeneratedAt)) : null;
      const newGenAt = toMysqlTimestamp(e.created_at);

      await conn.beginTransaction();
      try {
        await conn.execute(
          "INSERT INTO videoAnalysisHistory (videoId, analysisVersion, aiAnalysis, contentSha256, promptSha256, generatedAt, archivedAt, archivedBy) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), ?)",
          [e.video_id, oldVer, oldAna, sha256TidbCellValue(oldAna), oldPromptSha, oldGenAt, worker]
        );
        await conn.execute(
          "UPDATE videos SET aiAnalysis = ?, analysisVersion = 'v3', analysisGeneratedAt = ?, analysisPromptSha256 = ?, updatedAt = updatedAt WHERE id = ?",
          [e.analysis_text, newGenAt, e.prompt_template_sha256, e.video_id]
        );
        await conn.commit();
      } catch (txErr) {
        await conn.rollback();
        throw new Error(`TiDB transaction failed for ${e.video_id}: ${txErr.message}`);
      }

      let sqliteRes = null;
      if (sqliteExists) {
        sqliteRes = replaceSqliteScenesForVideo(sqlitePath, e.video_id, parsedByVid.get(e.video_id));
      }
      applied.push({
        video_id: e.video_id,
        tidb_updated: true,
        history_archived: true,
        sqlite_scenes: sqliteRes,
      });
    }

    const [postRows] = await conn.query("SELECT * FROM videos ORDER BY id ASC");
    const postAudit = auditOriginalColumnsAgainstPreD({
      liveRows: postRows,
      backupMap,
      originalColumns,
      legacyScoreColumns: LEGACY_SCORE_COLUMNS,
      approvedOverrideMap: approvedOverrides.active_map,
      v3ManifestMap: v3Loaded.valid_map,
    });
    if (!postAudit.passed) {
      throw new Error(`Post-flight Pre-D audit FAILED: ${JSON.stringify(postAudit.sample_mismatches)}`);
    }

    return {
      mode: "apply",
      run_id: runId,
      worker,
      pinned_list_path: pinned ? pinned.path : null,
      pinned_list_id: pinned ? pinned.list_id : null,
      pinned_list_sha256: pinned ? pinned.sha256 : null,
      applied_count: applied.length,
      tidb_backup: tidbBackup,
      sqlite_backup: sqliteBackupPath,
      applied,
      post_flight_audit: {
        passed: postAudit.passed,
        rows_compared: postAudit.rows_compared,
        v3_manifest_matched_count: postAudit.v3_manifest_matched_count,
        approved_overrides_matched_count: postAudit.approved_overrides_matched_count,
        all_40_original_columns_mismatches: postAudit.all_40_original_columns_mismatches,
      },
    };
  } finally {
    await conn.end();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  (async () => {
    loadDotenv();
    const args = parseArgs(process.argv);
    if (args["print-ddl"]) {
      process.stdout.write(fs.readFileSync(DDL_PATH, "utf8"));
      return;
    }
    const dryRun = Boolean(args["dry-run"]) || !args.apply;
    const ids = args.ids
      ? String(args.ids)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : null;
    const res = await runReanalysisV3Apply({
      dryRun,
      limit: args.limit ? Number(args.limit) : 20,
      ids,
      listPath: args.list || args["target-list"] || null,
      storeDir: args["v3-store-dir"] || DEFAULT_V3_STORE_DIR,
      worker: args.worker || null,
      runId: args["run-id"] || null,
      preDBackup: args["pre-d-backup"] || null,
      sqlitePath: args.sqlite || null,
      backupDir: args["backup-dir"] || null,
      approvedOverridesPath: args["approved-overrides"] || null,
    });
    console.log(JSON.stringify(res, null, 2));
  })().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
