#!/usr/bin/env node
/**
 * Phase 3 Pre-D Full Backup Script (TiDB Source of Truth + Local SQLite Mirror).
 *
 * Strictly READ-ONLY against production TiDB and source SQLite!
 * Saves full backups OUTSIDE git repo under E:\iketeru_backups\phase3_pre_d_<timestamp>\
 * and records row counts, MAX(updatedAt), byte sizes, SHA-256 hashes, and integrity checks.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const BACKUP_ROOT = "E:\\iketeru_backups";
const SOURCE_SQLITE_PATH = "E:\\iketeru-creative-studio\\data\\iketeru_knowledge.db";
const REPO_MANIFEST_PATH = path.join(REPO_ROOT, "analysis", "phase3_pre_d_backup_manifest.json");

function pad2(n) {
  return String(n).padStart(2, "0");
}

function makeStamp(d = new Date()) {
  return (
    d.getFullYear() +
    pad2(d.getMonth() + 1) +
    pad2(d.getDate()) +
    "_" +
    pad2(d.getHours()) +
    pad2(d.getMinutes()) +
    pad2(d.getSeconds())
  );
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

function serializeValue(v) {
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return v.toString("utf8");
  return v;
}

async function main() {
  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  require("dotenv").config({ path: path.join(REPO_ROOT, ".env") });
  const mysql = require("mysql2/promise");

  const stamp = makeStamp();
  const backupDir = path.join(BACKUP_ROOT, `phase3_pre_d_${stamp}`);
  fs.mkdirSync(backupDir, { recursive: true });

  const tidbJsonlPath = path.join(backupDir, "tidb_videos_backup.jsonl");
  const tidbSchemaPath = path.join(backupDir, "tidb_videos_schema.sql");
  const sqliteBackupPath = path.join(backupDir, "iketeru_knowledge_backup.db");
  const localManifestPath = path.join(backupDir, "backup_manifest.json");

  // 1. TiDB full read-only export
  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });

  let tidbManifest;
  try {
    const [createRows] = await conn.query("SHOW CREATE TABLE videos");
    const createSql = String(createRows[0]["Create Table"] || "").replace(/\r\n/g, "\n") + "\n";
    fs.writeFileSync(tidbSchemaPath, createSql, "utf8");

    const [colRows] = await conn.query("DESCRIBE videos");
    const columns = colRows.map((c) => c.Field);

    const [metaRows] = await conn.query(
      "SELECT COUNT(*) AS cnt, MAX(updatedAt) AS max_upd FROM videos"
    );
    const expectedCount = Number(metaRows[0].cnt);
    const maxUpdatedAt =
      metaRows[0].max_upd instanceof Date
        ? metaRows[0].max_upd.toISOString()
        : String(metaRows[0].max_upd);

    const [rows] = await conn.query("SELECT * FROM videos ORDER BY id ASC");
    if (rows.length !== expectedCount) {
      throw new Error(`Row count mismatch during export: got ${rows.length}, expected ${expectedCount}`);
    }

    const outFd = fs.openSync(tidbJsonlPath, "w");
    try {
      for (const row of rows) {
        const clean = {};
        for (const col of columns) {
          clean[col] = serializeValue(row[col]);
        }
        fs.writeSync(outFd, JSON.stringify(clean) + "\n", null, "utf8");
      }
    } finally {
      fs.closeSync(outFd);
    }

    // Read-back parse verification
    const lines = fs.readFileSync(tidbJsonlPath, "utf8").split("\n").filter(Boolean);
    if (lines.length !== expectedCount) {
      throw new Error(`Read-back line count mismatch: ${lines.length} vs ${expectedCount}`);
    }
    for (let i = 0; i < lines.length; i++) {
      const obj = JSON.parse(lines[i]);
      if (!obj || typeof obj.id !== "string" || obj.id.length === 0) {
        throw new Error(`Invalid row at line ${i + 1}`);
      }
    }

    const jsonlStat = fs.statSync(tidbJsonlPath);
    const schemaStat = fs.statSync(tidbSchemaPath);
    tidbManifest = {
      table: "videos",
      row_count: expectedCount,
      column_count: columns.length,
      columns,
      max_updated_at: maxUpdatedAt,
      jsonl_path: tidbJsonlPath,
      jsonl_bytes: jsonlStat.size,
      jsonl_sha256: sha256File(tidbJsonlPath),
      schema_path: tidbSchemaPath,
      schema_bytes: schemaStat.size,
      schema_sha256: sha256File(tidbSchemaPath),
      readback_parse_verified: true,
    };
  } finally {
    await conn.end();
  }

  // 2. SQLite full read-only snapshot via sqlite3.Connection.backup()
  const pyCode = `
import sqlite3, hashlib, json, os

src_path = r'''${SOURCE_SQLITE_PATH}'''
dst_path = r'''${sqliteBackupPath}'''

def sha256_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

src_sha = sha256_file(src_path)
src_bytes = os.stat(src_path).st_size

src = sqlite3.connect(f'file:{src_path}?mode=ro', uri=True)
dst = sqlite3.connect(dst_path)
try:
    src.backup(dst)
finally:
    src.close()
    dst.close()

chk = sqlite3.connect(f'file:{dst_path}?mode=ro', uri=True)
try:
    integrity = chk.execute('PRAGMA integrity_check').fetchone()[0]
    videos_cnt = chk.execute('SELECT COUNT(*) FROM videos').fetchone()[0]
    cols = [r[1] for r in chk.execute('PRAGMA table_info(videos)').fetchall()]
finally:
    chk.close()

dst_sha = sha256_file(dst_path)
dst_bytes = os.stat(dst_path).st_size
src_sha_after = sha256_file(src_path)

print(json.dumps({
    'source_path': src_path,
    'source_bytes': src_bytes,
    'source_sha256': src_sha,
    'source_unchanged_verified': (src_sha == src_sha_after),
    'backup_path': dst_path,
    'backup_bytes': dst_bytes,
    'backup_sha256': dst_sha,
    'videos_row_count': videos_cnt,
    'column_count': len(cols),
    'integrity_check': integrity,
}, ensure_ascii=False))
`;
  const sqliteManifest = JSON.parse(execFileSync("python", ["-c", pyCode], { encoding: "utf8" }).trim());
  if (sqliteManifest.integrity_check !== "ok" || !sqliteManifest.source_unchanged_verified) {
    throw new Error(`SQLite backup verification failed: ${JSON.stringify(sqliteManifest)}`);
  }

  const manifest = {
    created_at: new Date().toISOString(),
    purpose: "Phase 3 Pre-D full backup (TiDB source of truth + SQLite mirror)",
    backup_dir: backupDir,
    tidb: tidbManifest,
    sqlite: sqliteManifest,
  };

  const jsonText = JSON.stringify(manifest, null, 2).replace(/\r\n/g, "\n") + "\n";
  fs.writeFileSync(localManifestPath, jsonText, "utf8");
  fs.writeFileSync(REPO_MANIFEST_PATH, jsonText, "utf8");

  console.log("BACKUP COMPLETED & VERIFIED:");
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
