#!/usr/bin/env node
/**
 * Backfill `videos.publishedAt` (DATETIME NULL, UTC) and inspect YouTube privacyStatus/uploadStatus.
 *
 * Strictly NO yt-dlp and NO cookies. Uses ONLY official public APIs:
 *  - Vimeo:   https://vimeo.com/api/oembed.json?url=... (<= 1 req/sec, no API key needed)
 *  - YouTube: https://www.googleapis.com/youtube/v3/videos?part=snippet,status&id=<up to 50 IDs>
 *             (requires YOUTUBE_API_KEY in .env; NEVER prints or logs the key)
 *
 * Safety & Idempotency Guarantees:
 *  - Default mode (`--dry-run` or omitting `--apply`): STRICTLY READ-ONLY on TiDB.
 *    Works even BEFORE `videos.publishedAt` DDL has been applied.
 *  - `--apply`:
 *      * Requires active `analysis/claims/_apply_lock.json` (`status === "locked"`, matching worker & run_id).
 *      * Requires `videos.publishedAt` column to exist.
 *      * Updates ONLY `publishedAt` WHERE `publishedAt IS NULL`, preserving `updatedAt = updatedAt`.
 *      * Never modifies `embedStatus`, `embedReason`, or any of the 40 Pre-D original columns.
 *  - YouTube download queue exclusion:
 *      * NEVER edits CHIBA-PC's `queue_main.json` directly.
 *      * Optionally writes a candidate JSON file (e.g. to `G:\マイドライブ\iketeru_multi_pc_progress\`)
 *        via `--write-exclude-list <path>` for CHIBA-PC to consume.
 *
 * Usage:
 *   node scripts/backfill-published-at.mjs --source vimeo --dry-run [--interval-ms 1050] [--cache-file <jsonl>] [--limit <N>]
 *   node scripts/backfill-published-at.mjs --source youtube --dry-run [--uncached-only] [--queue-file <path>] [--limit 50] [--write-exclude-list <path>]
 *   node scripts/backfill-published-at.mjs --source vimeo|youtube --apply --worker CHIBA-PC2 --lock-run-id <id>
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..");
export const APPLY_LOCK_PATH = path.join(REPO_ROOT, "analysis", "claims", "_apply_lock.json");
export const DEFAULT_DRIVE_VIDEO_CACHE = "G:\\マイドライブ\\iketeru_videos";
export const DEFAULT_MIN_VIMEO_INTERVAL_MS = 1050;
export const YOUTUBE_BATCH_SIZE = 50;

export const PUBLISHED_AT_UPDATE_SQL =
  "UPDATE `videos` SET `publishedAt` = ?, `updatedAt` = `updatedAt` WHERE `id` = ? AND `publishedAt` IS NULL";

/**
 * Normalize ISO-8601 (`2024-08-26T21:42:00Z`) or Vimeo (`2024-08-26 21:42:00`) timestamp
 * into MySQL/TiDB DATETIME UTC string `YYYY-MM-DD HH:MM:SS`.
 */
export function normalizeToMysqlDatetimeUtc(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Vimeo oEmbed format: "YYYY-MM-DD HH:MM:SS" (already UTC/EST-like date string)
  const mysqlMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/);
  if (mysqlMatch) {
    const dt = new Date(`${mysqlMatch[1]}T${mysqlMatch[2]}Z`);
    if (!Number.isNaN(dt.getTime())) {
      return `${mysqlMatch[1]} ${mysqlMatch[2]}`;
    }
    return null;
  }

  // ISO-8601 (e.g. YouTube snippet.publishedAt: "2024-10-11T01:03:05Z")
  const dt = new Date(trimmed);
  if (Number.isNaN(dt.getTime())) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())} ` +
    `${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:${pad(dt.getUTCSeconds())}`
  );
}

/**
 * Classify a YouTube Data API v3 `videos.list(part=snippet,status)` batch response
 * against the requested list of up to 50 video IDs.
 *
 * Note: YouTube Data API omits deleted, private (without owner OAuth), or non-existent
 * videos from `items[]`. Any requested ID absent from `items[]` is classified as
 * `private_or_deleted_not_returned`.
 */
export function classifyYouTubeApiBatch(requestedIds, apiItems) {
  const byId = new Map();
  for (const item of Array.isArray(apiItems) ? apiItems : []) {
    if (item && item.id) byId.set(String(item.id), item);
  }

  const results = [];
  for (const rawId of requestedIds) {
    const id = String(rawId);
    const item = byId.get(id);
    if (!item) {
      results.push({
        id,
        category: "private_or_deleted_not_returned",
        privacyStatus: null,
        uploadStatus: null,
        embeddable: null,
        publishedAt: null,
        shouldExcludeFromDownloadQueue: true,
        excludeReason: "not_returned_by_youtube_api_private_or_deleted",
      });
      continue;
    }

    const privacyStatus = item.status?.privacyStatus ?? null;
    const uploadStatus = item.status?.uploadStatus ?? null;
    const embeddable = typeof item.status?.embeddable === "boolean" ? item.status.embeddable : null;
    const publishedAt = normalizeToMysqlDatetimeUtc(item.snippet?.publishedAt ?? null);

    let category = "other";
    let shouldExclude = false;
    let excludeReason = null;

    if (uploadStatus === "deleted" || uploadStatus === "rejected" || uploadStatus === "failed") {
      category = `upload_${uploadStatus}`;
      shouldExclude = true;
      excludeReason = `upload_status_${uploadStatus}`;
    } else if (privacyStatus === "private") {
      category = "private";
      shouldExclude = true;
      excludeReason = "privacy_status_private";
    } else if (privacyStatus === "public") {
      category = "public";
    } else if (privacyStatus === "unlisted") {
      category = "unlisted";
    }

    results.push({
      id,
      category,
      privacyStatus,
      uploadStatus,
      embeddable,
      publishedAt,
      shouldExcludeFromDownloadQueue: shouldExclude,
      excludeReason,
    });
  }
  return results;
}

export function buildDownloadExcludeListPayload({ results, sourceDescription, generatedAtUtc = new Date().toISOString() }) {
  const excluded = results.filter((r) => r.shouldExcludeFromDownloadQueue);
  const countsByCategory = {};
  for (const r of results) {
    countsByCategory[r.category] = (countsByCategory[r.category] || 0) + 1;
  }
  return {
    schema_version: 1,
    generated_at_utc: generatedAtUtc,
    generated_by: "CHIBA-PC2",
    source: sourceDescription,
    method: "youtube_data_api_v3_videos_list_snippet_status",
    note: "Candidate list for CHIBA-PC to exclude private/deleted videos from E:\\iketeru_downloader\\queue_main.json. CHIBA-PC2 does not edit queue_main.json directly.",
    total_checked: results.length,
    counts_by_category: countsByCategory,
    exclude_count: excluded.length,
    exclude_entries: excluded.map((r) => ({
      video_id: r.id,
      category: r.category,
      privacy_status: r.privacyStatus,
      upload_status: r.uploadStatus,
      reason: r.excludeReason,
    })),
  };
}

export function verifyApplyLockState(lockObj, expectedWorker, expectedRunId) {
  if (!expectedWorker || !String(expectedWorker).trim()) {
    throw new Error("--worker is required for --apply");
  }
  if (!expectedRunId || !String(expectedRunId).trim()) {
    throw new Error("--lock-run-id is required for --apply");
  }
  const ok =
    lockObj &&
    lockObj.status === "locked" &&
    lockObj.worker === expectedWorker &&
    lockObj.run_id === expectedRunId;
  if (!ok) {
    throw new Error(
      `Refusing to write to TiDB without active write lock! Expected status="locked", worker="${expectedWorker}", run_id="${expectedRunId}", found=${JSON.stringify({
        status: lockObj?.status ?? null,
        worker: lockObj?.worker ?? null,
        run_id: lockObj?.run_id ?? null,
      })}`
    );
  }
  return true;
}

export function parseArgs(argv) {
  const opts = {
    source: null, // "vimeo" | "youtube"
    dryRun: true,
    apply: false,
    limit: null,
    intervalMs: DEFAULT_MIN_VIMEO_INTERVAL_MS,
    uncachedOnly: false,
    queueFile: null,
    videoCacheDir: DEFAULT_DRIVE_VIDEO_CACHE,
    cacheFile: null,
    writeExcludeList: null,
    worker: null,
    lockRunId: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--source") {
      opts.source = argv[++i];
    } else if (a === "--dry-run") {
      opts.dryRun = true;
      opts.apply = false;
    } else if (a === "--apply") {
      opts.apply = true;
      opts.dryRun = false;
    } else if (a === "--limit") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1) throw new Error("--limit must be a positive integer");
      opts.limit = n;
    } else if (a === "--interval-ms") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 1000) {
        throw new Error("--interval-ms must be >= 1000 (strictly <= 1 req/sec for Vimeo oEmbed)");
      }
      opts.intervalMs = Math.round(n);
    } else if (a === "--uncached-only") {
      opts.uncachedOnly = true;
    } else if (a === "--queue-file") {
      opts.queueFile = argv[++i];
    } else if (a === "--video-cache-dir") {
      opts.videoCacheDir = argv[++i];
    } else if (a === "--cache-file") {
      opts.cacheFile = argv[++i];
    } else if (a === "--write-exclude-list") {
      opts.writeExcludeList = argv[++i];
    } else if (a === "--worker") {
      opts.worker = argv[++i];
    } else if (a === "--lock-run-id") {
      opts.lockRunId = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  if (opts.source !== "vimeo" && opts.source !== "youtube") {
    throw new Error("--source must be 'vimeo' or 'youtube'");
  }
  return opts;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadQueueVideoIds(queuePath) {
  const raw = JSON.parse(fs.readFileSync(queuePath, "utf8").replace(/^\uFEFF/, ""));
  const list = Array.isArray(raw) ? raw : Array.isArray(raw.items) ? raw.items : Array.isArray(raw.queue) ? raw.queue : [];
  const ids = [];
  for (const item of list) {
    const vid = typeof item === "string" ? item : item?.video_id || item?.id || item?.videoId;
    if (vid) ids.push(String(vid));
  }
  return ids;
}

async function runVimeo(conn, opts, hasPublishedAtCol) {
  const whereCol = opts.apply && hasPublishedAtCol ? "AND publishedAt IS NULL" : "";
  const [rows] = await conn.query(
    `SELECT id, title, videoUrl, embedStatus, embedReason FROM videos WHERE platform = 'vimeo' ${whereCol} ORDER BY id ASC`
  );
  const targets = opts.limit ? rows.slice(0, opts.limit) : rows;

  const cached = new Map();
  if (opts.cacheFile && fs.existsSync(opts.cacheFile)) {
    for (const line of fs.readFileSync(opts.cacheFile, "utf8").split(/\r?\n/).filter(Boolean)) {
      try {
        const obj = JSON.parse(line);
        cached.set(String(obj.id), obj);
      } catch {}
    }
  }

  let lastReqAt = 0;
  const results = [];
  for (const row of targets) {
    const id = String(row.id);
    if (cached.has(id)) {
      results.push(cached.get(id));
      continue;
    }
    const wait = opts.intervalMs - (Date.now() - lastReqAt);
    if (wait > 0) await sleep(wait);
    lastReqAt = Date.now();

    const targetUrl = row.videoUrl || `https://vimeo.com/${id}`;
    const oembedUrl = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(targetUrl)}`;
    let entry;
    try {
      const res = await fetch(oembedUrl, {
        signal: AbortSignal.timeout(12000),
        headers: { "User-Agent": "iketeru-eizou-metadata-audit/1.0" },
      });
      if (res.ok) {
        const data = await res.json();
        const publishedAt = normalizeToMysqlDatetimeUtc(data.upload_date ?? null);
        entry = {
          id,
          title: String(row.title || "").slice(0, 60),
          ok: Boolean(publishedAt),
          httpStatus: res.status,
          upload_date: data.upload_date ?? null,
          publishedAt,
          error: publishedAt ? null : "missing_or_invalid_upload_date",
        };
      } else {
        entry = {
          id,
          title: String(row.title || "").slice(0, 60),
          ok: false,
          httpStatus: res.status,
          upload_date: null,
          publishedAt: null,
          error: `http_${res.status}`,
        };
      }
    } catch (err) {
      entry = {
        id,
        title: String(row.title || "").slice(0, 60),
        ok: false,
        httpStatus: null,
        upload_date: null,
        publishedAt: null,
        error: String(err?.name || err?.message || err),
      };
    }

    if (opts.cacheFile) {
      fs.mkdirSync(path.dirname(opts.cacheFile), { recursive: true });
      fs.appendFileSync(opts.cacheFile, JSON.stringify(entry) + "\n", "utf8");
    }
    results.push(entry);
  }

  let updatedRows = 0;
  if (opts.apply) {
    const ready = results.filter((r) => r.ok && r.publishedAt);
    for (let i = 0; i < ready.length; i += 100) {
      const slice = ready.slice(i, i + 100);
      await conn.beginTransaction();
      try {
        for (const item of slice) {
          const [res] = await conn.execute(PUBLISHED_AT_UPDATE_SQL, [item.publishedAt, item.id]);
          updatedRows += Number(res.affectedRows || 0);
        }
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      }
    }
  }

  const okRows = results.filter((r) => r.ok);
  const failRows = results.filter((r) => !r.ok);
  const failedByReason = {};
  for (const f of failRows) failedByReason[f.error || "unknown"] = (failedByReason[f.error || "unknown"] || 0) + 1;

  return {
    source: "vimeo",
    mode: opts.dryRun ? "dry_run" : "apply",
    publishedAt_column_exists: hasPublishedAtCol,
    interval_ms: opts.intervalMs,
    total_targets: targets.length,
    fetched_count: okRows.length,
    failed_count: failRows.length,
    failed_by_reason: failedByReason,
    updated_rows: updatedRows,
    samples_10: okRows.slice(0, 10),
    failed_samples_10: failRows.slice(0, 10),
  };
}

async function runYouTube(conn, opts, hasPublishedAtCol) {
  const apiKey = (process.env.YOUTUBE_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("YOUTUBE_API_KEY is not set in .env (never commit or log API keys).");
  }

  let targetRows = [];
  let sourceDescription = "tidb_youtube_all";
  if (opts.queueFile && fs.existsSync(opts.queueFile)) {
    const queueIds = loadQueueVideoIds(opts.queueFile);
    targetRows = queueIds.map((id) => ({ id, title: "" }));
    sourceDescription = `queue_file:${opts.queueFile}`;
  } else {
    const whereCol = opts.apply && hasPublishedAtCol ? "AND publishedAt IS NULL" : "";
    const [rows] = await conn.query(
      `SELECT id, title, embedStatus, embedReason FROM videos WHERE platform = 'youtube' ${whereCol} ORDER BY id ASC`
    );
    if (opts.uncachedOnly) {
      const cachedSet = fs.existsSync(opts.videoCacheDir)
        ? new Set(
            fs.readdirSync(opts.videoCacheDir)
              .filter((f) => f.endsWith(".mp4"))
              .map((f) => f.slice(0, -4))
          )
        : new Set();
      targetRows = rows.filter((r) => !cachedSet.has(String(r.id)));
      sourceDescription = `tidb_youtube_missing_from_${opts.videoCacheDir}`;
    } else {
      targetRows = rows;
    }
  }

  const targets = opts.limit ? targetRows.slice(0, opts.limit) : targetRows;
  const titleById = new Map(targets.map((r) => [String(r.id), String(r.title || "").slice(0, 60)]));

  const allClassified = [];
  let apiRequests = 0;
  for (let i = 0; i < targets.length; i += YOUTUBE_BATCH_SIZE) {
    const batchIds = targets.slice(i, i + YOUTUBE_BATCH_SIZE).map((r) => String(r.id));
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "snippet,status");
    url.searchParams.set("id", batchIds.join(","));
    url.searchParams.set("key", apiKey);

    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    apiRequests++;
    if (!res.ok) {
      // Never include URL/key in error message
      throw new Error(`YouTube Data API v3 request failed with HTTP ${res.status} on batch ${apiRequests}`);
    }
    const body = await res.json();
    const classified = classifyYouTubeApiBatch(batchIds, body.items || []).map((r) => ({
      ...r,
      title: titleById.get(r.id) || "",
    }));
    allClassified.push(...classified);
  }

  let updatedRows = 0;
  if (opts.apply) {
    const ready = allClassified.filter((r) => Boolean(r.publishedAt));
    for (let i = 0; i < ready.length; i += 100) {
      const slice = ready.slice(i, i + 100);
      await conn.beginTransaction();
      try {
        for (const item of slice) {
          const [res] = await conn.execute(PUBLISHED_AT_UPDATE_SQL, [item.publishedAt, item.id]);
          updatedRows += Number(res.affectedRows || 0);
        }
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      }
    }
  }

  const countsByCategory = {};
  for (const r of allClassified) countsByCategory[r.category] = (countsByCategory[r.category] || 0) + 1;
  const withPublishedAt = allClassified.filter((r) => Boolean(r.publishedAt));
  const excludeCandidates = allClassified.filter((r) => r.shouldExcludeFromDownloadQueue);

  let excludeListWritten = null;
  if (opts.writeExcludeList) {
    const payload = buildDownloadExcludeListPayload({
      results: allClassified,
      sourceDescription,
    });
    fs.mkdirSync(path.dirname(opts.writeExcludeList), { recursive: true });
    fs.writeFileSync(opts.writeExcludeList, JSON.stringify(payload, null, 2) + "\n", "utf8");
    excludeListWritten = opts.writeExcludeList;
  }

  return {
    source: "youtube",
    mode: opts.dryRun ? "dry_run" : "apply",
    publishedAt_column_exists: hasPublishedAtCol,
    target_source: sourceDescription,
    total_targets: targets.length,
    api_requests_50_per_batch: apiRequests,
    counts_by_category: countsByCategory,
    published_at_fetched_count: withPublishedAt.length,
    published_at_missing_count: allClassified.length - withPublishedAt.length,
    exclude_candidates_count: excludeCandidates.length,
    exclude_list_written: excludeListWritten,
    updated_rows: updatedRows,
    samples_10: withPublishedAt.slice(0, 10),
    exclude_samples_10: excludeCandidates.slice(0, 10),
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  require("dotenv").config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
  const mysql = require("mysql2/promise");

  if (opts.apply) {
    const lockObj = JSON.parse(fs.readFileSync(APPLY_LOCK_PATH, "utf8").replace(/^\uFEFF/, ""));
    verifyApplyLockState(lockObj, opts.worker, opts.lockRunId);
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
    const [colCheck] = await conn.query("SHOW COLUMNS FROM `videos` LIKE 'publishedAt'");
    const hasPublishedAtCol = colCheck.length > 0;
    if (opts.apply && !hasPublishedAtCol) {
      throw new Error("videos.publishedAt column does not exist yet. Execute drizzle/add_published_at.sql first after approval.");
    }

    const report =
      opts.source === "vimeo"
        ? await runVimeo(conn, opts, hasPublishedAtCol)
        : await runYouTube(conn, opts, hasPublishedAtCol);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await conn.end();
  }
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error(`[backfill-published-at] ERROR:`, err?.message || err);
    process.exit(1);
  });
}
