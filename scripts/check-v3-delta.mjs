#!/usr/bin/env node
/**
 * Read-only check of verified canonical v3 analyses against live TiDB `videos`.
 *
 * Optionally writes a pinned delta apply list (`--list-out <path>`) containing
 * only unapplied videos (`analysisVersion !== 'v3'`). Never writes to TiDB.
 *
 * Usage:
 *   node scripts/check-v3-delta.mjs [--list-id <id>] [--list-out <path>] [--v3-store-dir <dir>] [--worker <name>]
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = process.env.IKETERU_REPO_ROOT || path.resolve(__dirname, "..");
const {
  DEFAULT_V3_STORE_DIR,
  loadV3CanonicalManifestMap,
  sha256TidbCellValue,
} = await import(pathToFileURL(path.join(REPO_ROOT, "scripts", "approved-tidb-overrides.mjs")).href);

export function resolveV3StoreDir(explicitDir = null) {
  if (explicitDir) return explicitDir;
  for (const candidate of [
    process.env.IKETERU_V3_STORE_DIR,
    DEFAULT_V3_STORE_DIR,
    "G:\\マイドライブ\\iketeru_analysis_v3",
    "D:\\マイドライブ\\iketeru_analysis_v3",
  ]) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return DEFAULT_V3_STORE_DIR;
}

export function parseArgs(argv) {
  const opts = {
    listId: `v3_apply_delta_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
    listOut: null,
    v3StoreDir: null,
    worker: process.env.IKETERU_WORKER_NAME || "chibatmute",
    maxDelta: 200,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--list-id") opts.listId = argv[++i];
    else if (a === "--list-out") opts.listOut = argv[++i];
    else if (a === "--v3-store-dir") opts.v3StoreDir = argv[++i];
    else if (a === "--worker") opts.worker = argv[++i];
    else if (a === "--max-delta") opts.maxDelta = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  require("dotenv").config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
  const mysql = require("mysql2/promise");

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set in environment or .env");
  }

  const storeDir = resolveV3StoreDir(opts.v3StoreDir);
  const loaded = loadV3CanonicalManifestMap(storeDir);

  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
    connectTimeout: 30000,
  });

  let rows;
  let histCnt;
  try {
    [rows] = await conn.query(
      "SELECT id, analysisVersion, aiAnalysis, analysisPromptSha256 FROM videos"
    );
    [[histCnt]] = await conn.query("SELECT COUNT(*) AS cnt FROM videoAnalysisHistory");
  } finally {
    await conn.end();
  }

  const liveById = new Map(rows.map((r) => [String(r.id), r]));
  const alreadyIdentical = [];
  const alreadyChanged = [];
  const unapplied = [];
  const missingInTidb = [];
  const byPromptVer = {};
  let underscoreNew = 0;
  let underscoreTotal = 0;

  for (const [vid, e] of loaded.valid_map.entries()) {
    if (vid.startsWith("_")) underscoreTotal++;
    const pv = e.prompt_version || e.manifest_analysis_version || "v3";
    byPromptVer[pv] = (byPromptVer[pv] || 0) + 1;
    const cur = liveById.get(vid);
    if (!cur) {
      missingInTidb.push(vid);
      continue;
    }
    const curSha = sha256TidbCellValue(cur.aiAnalysis);
    if (cur.analysisVersion === "v3" && curSha === e.analysis_content_sha256) {
      alreadyIdentical.push(vid);
    } else if (cur.analysisVersion === "v3") {
      alreadyChanged.push(vid);
    } else {
      unapplied.push(e);
      if (vid.startsWith("_")) underscoreNew++;
    }
  }

  const listDoc = {
    schema_version: 1,
    list_id: opts.listId,
    decision_id: "D-026",
    status: "approved",
    created_at: new Date().toISOString(),
    created_by_pc: opts.worker,
    total_verified_in_store: loaded.valid_map.size,
    already_v3_identical_count: alreadyIdentical.length,
    newly_applying_count: unapplied.length,
    entries: unapplied.map((e) => ({
      video_id: e.video_id,
      prompt_version: e.prompt_version || e.manifest_analysis_version || "v3",
      prompt_template_sha256: e.prompt_template_sha256,
      analysis_v3_sha256: e.analysis_file_sha256,
    })),
  };

  let listSha256 = null;
  if (opts.listOut) {
    fs.mkdirSync(path.dirname(opts.listOut), { recursive: true });
    const listBytes = Buffer.from(JSON.stringify(listDoc, null, 2) + "\n", "utf8");
    fs.writeFileSync(opts.listOut, listBytes);
    listSha256 = crypto.createHash("sha256").update(listBytes).digest("hex");
  }

  console.log(
    JSON.stringify(
      {
        v3_store_dir: storeDir,
        v3_store_verified_count: loaded.valid_map.size,
        v3_store_rejected_count: loaded.rejected.length,
        v3_store_rejected_sample: loaded.rejected.slice(0, 5),
        underscore_total: underscoreTotal,
        underscore_new: underscoreNew,
        prompt_version_breakdown: byPromptVer,
        tidb_total_videos: rows.length,
        tidb_existing_history_rows: Number(histCnt.cnt),
        already_v3_identical_count: alreadyIdentical.length,
        already_v3_changed_count: alreadyChanged.length,
        newly_applying_count: unapplied.length,
        newly_applying_ids_sample: unapplied.slice(0, 10).map((e) => e.video_id),
        over_max_delta_limit: unapplied.length > opts.maxDelta,
        max_delta_limit: opts.maxDelta,
        expected_post_apply_v3_total: alreadyIdentical.length + unapplied.length,
        expected_post_apply_history_total: Number(histCnt.cnt) + unapplied.length,
        missing_in_tidb: missingInTidb,
        list_path: opts.listOut,
        list_sha256: listSha256,
      },
      null,
      2
    )
  );
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error(`[check-v3-delta] ERROR:`, err?.message || err);
    process.exit(1);
  });
}
