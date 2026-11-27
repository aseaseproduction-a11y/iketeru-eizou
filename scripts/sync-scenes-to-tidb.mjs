#!/usr/bin/env node
/**
 * Sync timestamped scenes from local SQLite (`scenes` table) -> TiDB (`videoScenes` table).
 *
 * Unified single-source sync script (merged from feature/scenes-tidb-api & docs/site-cut-search-design).
 *
 * Safety & Idempotency Guarantees:
 *  - Default mode (`--dry-run` or omitting `--apply`): STRICTLY READ-ONLY (`SELECT` / `SHOW TABLES` only).
 *    NEVER creates tables, writes rows, or deletes rows in TiDB.
 *  - Calibrated-only score breakdown: strictly uses `calibratedScore` (NEVER mixes legacy `aiOverallScore`
 *    into 78+ / 83+ bands), and reconciles band totals against calibrated total.
 *  - Stale scene detection (re-segmented videos):
 *      - In `--dry-run`: computes per-video list & counts of scenes present in TiDB `videoScenes`
 *        that no longer exist in SQLite `scenes`.
 *      - Deletion NEVER happens during plain `--apply`. It happens ONLY when `--apply --prune-stale`
 *        is explicitly passed AND active lock is verified, and ALWAYS takes a per-video JSONL backup
 *        with SHA-256 verification BEFORE deleting that video's stale shotIndex rows.
 *  - Existing scenes are inserted with `analysisVersion = 'legacy'`, `analysisGeneratedAt = NULL`
 *    (matching chibatmute's v3 write schema).
 *  - NEVER alters, updates, or deletes the existing TiDB `videos` table.
 *
 * Usage:
 *   node scripts/sync-scenes-to-tidb.mjs --dry-run [--worker <name>] [--sqlite-path <path>] [--report-out <path>]
 *   node scripts/sync-scenes-to-tidb.mjs --apply --worker <name> [--prune-stale] [--backup-dir <dir>]
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..");
export const DDL_SQL_PATH = path.join(REPO_ROOT, "drizzle", "create_video_scenes.sql");
export const APPLY_LOCK_PATH = path.join(REPO_ROOT, "analysis", "claims", "_apply_lock.json");
export const DEFAULT_SQLITE_PATH = "E:\\iketeru-creative-studio\\data\\iketeru_knowledge.db";
export const DEFAULT_BACKUP_ROOT = "E:\\iketeru_backups";
export const LOCK_RUN_ID = "sync_video_scenes_to_tidb";
export const DEFAULT_CHUNK_SIZE = 500;
const TIDB_FREE_TIER_BYTES = 5 * 1024 * 1024 * 1024; // 5 GiB

const STOP_WORDS = new Set([
  "視覚", "聴覚", "制約", "事実", "演出上", "意図", "確認上", "観察", "記録", "範囲",
  "年前", "下部", "上部", "左部", "右部", "中央", "左右", "上下", "前後", "周囲", "背後",
  "画面", "映像", "動画", "場面", "シーン", "パート", "セクション", "カット", "ショット",
  "カメラ", "フレーム", "レンズ", "アングル", "サイズ", "状態", "様子", "瞬間", "動き",
  "変化", "効果", "印象", "構成", "展開", "導入", "突入", "開始", "終了", "直後", "直前",
  "全体", "一部", "複数", "連続", "同時", "交互", "再提示", "再利用", "象徴的", "特徴的",
  "効果的", "圧倒的", "徹底的", "規則的", "直線的", "立体的", "視覚的", "聴覚的", "構造的",
  "空間", "時間", "速度", "方向", "位置", "配置", "登場", "出現", "表示", "強調", "表現",
  "撮影", "編集", "演出", "処理", "設定", "使用", "活用", "採用", "維持", "形成", "移行",
  "転換", "接続", "連動", "同期", "対比", "詳細", "明確", "鮮明", "完全", "最後", "最初",
  "冒頭", "中盤", "終盤", "後半", "前半", "背景", "前景", "手前", "奥側", "内側", "外側",
  "アスペクト比", "画面比率", "シネマスコープ", "推測", "概要欄", "記載", "スタート",
]);

const SEED_WORDS = [
  "空", "青空", "夜", "夜景", "街", "都会", "ストリート", "路地裏", "部屋", "室内",
  "海", "海岸", "砂浜", "水面", "雨", "水滴", "雲", "星空", "宇宙", "自然",
  "森", "夕日", "夕暮れ", "スタジアム", "屋上", "トンネル", "駅", "電車", "階段",
  "マッチカット", "ジャンプカット", "ワンカット", "スピードランプ", "音ハメ",
  "ストップモーション", "メタモルフォーゼ", "ロトスコープ", "カットアウト", "セルルック",
  "キネティックタイポグラフィ", "モーショングラフィックス", "コラージュ", "3DCG", "VFX",
  "コンポジット", "画面分割", "トラッキング", "ドリー", "手持ち", "ズーム",
  "ローアングル", "俯瞰", "クローズアップ", "フォーカス送り", "被写界深度",
  "スローモーション", "タイムラプス", "グリッチ", "色収差", "ワイプ",
  "プロジェクション", "手描き", "ミニチュア", "シルエット", "逆光", "ストロボ",
  "光", "フラッシュ", "アニメーション", "ドローイング", "文字", "タイポグラフィ", "ノイズ",
  "ピント", "ドローン", "万華鏡", "スプリットスクリーン", "アイソメトリック", "実写",
  "ダンス", "群舞", "ステップ", "車", "クラシックカー", "ドライブ", "走行", "走る", "疾走",
  "女性", "少女", "男性", "目", "瞳", "指先", "炎", "火花", "花火", "煙", "スモーク",
  "花", "桜", "植物", "紙吹雪", "風船", "昆虫", "バグ", "自転車",
  "ポップ", "パステル", "可愛い", "静寂", "ミニマル", "エモーショナル", "祝祭", "多幸感",
  "レトロ", "シネマティック", "ダーク", "狂気", "不気味", "サイバーパンク", "幻想的", "ノスタルジー",
  "ビート", "キック", "ギター", "ピアノ", "アコースティック", "ラップ", "初音ミク",
  "合唱", "ウィスパーボイス", "フューチャーベース", "ベースミュージック", "ボカロ", "VTuber",
];

function sha256Text(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

function sanitizeFilename(videoId) {
  return String(videoId).replace(/[^A-Za-z0-9._-]/g, "_");
}

export function parseArgs(argv) {
  const opts = {
    apply: false,
    dryRun: true,
    pruneStale: false,
    excludeUnwatched: false,
    worker: null,
    sqlitePath: DEFAULT_SQLITE_PATH,
    backupDir: null,
    chunkSize: DEFAULT_CHUNK_SIZE,
    reportOut: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") {
      opts.apply = true;
      opts.dryRun = false;
    } else if (a === "--dry-run") {
      opts.dryRun = true;
      opts.apply = false;
    } else if (a === "--prune-stale") {
      opts.pruneStale = true;
    } else if (a === "--exclude-unwatched") {
      opts.excludeUnwatched = true;
    } else if (a === "--worker") {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error("--worker requires a value");
      opts.worker = argv[++i];
    } else if (a === "--sqlite-path") {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error("--sqlite-path requires a value");
      opts.sqlitePath = argv[++i];
    } else if (a === "--backup-dir") {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error("--backup-dir requires a value");
      opts.backupDir = argv[++i];
    } else if (a === "--chunk-size") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1 || n > 2000) throw new Error("--chunk-size must be an integer 1..2000");
      opts.chunkSize = n;
    } else if (a === "--report-out") {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error("--report-out requires a value");
      opts.reportOut = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return opts;
}

export function extractKeywords(shotTitle, description, audioText = "") {
  const combined = `${shotTitle || ""} ${description || ""} ${audioText || ""}`.trim();
  if (!combined) return [];
  const lower = combined.toLowerCase();
  const matched = new Set();

  const kwRegex = /#([\w\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fffー]+)/g;
  let m;
  while ((m = kwRegex.exec(combined)) !== null) {
    const val = m[1].trim();
    if (val.length >= 2 && !STOP_WORDS.has(val)) matched.add(val);
  }
  const kataRegex = /[ァ-ヶー]{3,14}/g;
  while ((m = kataRegex.exec(`${shotTitle || ""} ${description || ""}`)) !== null) {
    const val = m[0].replace(/^[・ー]+|[・]+$/g, "");
    if (val.length >= 3 && !STOP_WORDS.has(val)) matched.add(val);
  }
  const engRegex = /\b[A-Za-z][A-Za-z0-9+.\-]{2,18}\b/g;
  while ((m = engRegex.exec(`${shotTitle || ""} ${description || ""}`)) !== null) {
    const val = m[0].trim();
    if (val.length >= 3 && !STOP_WORDS.has(val)) matched.add(val);
  }
  for (const seed of SEED_WORDS) {
    if (lower.includes(seed.toLowerCase())) matched.add(seed);
  }
  return Array.from(matched).slice(0, 14);
}

export function normalizeSceneRecord(raw, videoTitle = "", options = {}) {
  const rawTitle = String(raw.shot_title || "").trim();
  const titleTruncated = rawTitle.length > 255;
  const shotTitle = rawTitle.slice(0, 255);
  const description = String(raw.description || "").trim();
  const audioText = raw.audio_text ? String(raw.audio_text).trim() : null;
  const keywords = extractKeywords(shotTitle, description, audioText || "");
  const keywordsJson = JSON.stringify(keywords);
  const searchText = [shotTitle, description, audioText || "", ...keywords, videoTitle || ""]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const startSec = Number.isFinite(Number(raw.start_sec)) ? Number(Number(raw.start_sec).toFixed(2)) : 0;
  const endSec = Number.isFinite(Number(raw.end_sec)) ? Number(Number(raw.end_sec).toFixed(2)) : 0;
  const durationSec = Number.isFinite(Number(raw.duration_sec))
    ? Number(Number(raw.duration_sec).toFixed(2))
    : Math.max(0, Number((endSec - startSec).toFixed(2)));
  const startMmss = String(raw.start_mmss || "00:00").slice(0, 16);
  const endMmss = String(raw.end_mmss || "00:00").slice(0, 16);
  const analysisVersion = options.analysisVersion === "v3" ? "v3" : "legacy";
  const analysisGeneratedAt = options.analysisGeneratedAt ?? null;
  const sceneSha256 = sha256Text(
    JSON.stringify([
      String(raw.video_id),
      Number(raw.shot_index),
      startMmss,
      endMmss,
      shotTitle,
      description,
      audioText,
      analysisVersion,
    ]),
  );

  return {
    videoId: String(raw.video_id),
    shotIndex: Number(raw.shot_index),
    startMmss,
    endMmss,
    startSec,
    endSec,
    durationSec,
    shotTitle,
    description,
    audioText,
    keywordsJson,
    searchText,
    sceneSha256,
    analysisVersion,
    analysisGeneratedAt,
    _titleTruncated: titleTruncated,
  };
}

/**
 * Strictly classify scene score counts using calibratedScore ONLY (never mixes legacy aiOverallScore).
 * Verifies that mutually exclusive calibrated bands sum exactly to calibratedTotal,
 * and calibratedTotal + uncalibratedTotal === totalScenes.
 */
export function buildScoreBreakdownAndReconcile(recordsWithVideoMeta) {
  let unwatchedScopeScenes = 0;
  const unwatchedVideoIds = new Set();

  let calibratedScore83PlusScenes = 0;
  let calibratedScore78To82Scenes = 0;
  let calibratedScoreBelow78Scenes = 0;
  let uncalibratedScenes = 0;

  // Diagnostic: how many uncalibrated scenes had legacy aiOverallScore >= 78 / 83 (previously leaked!)
  let legacyUncalibrated78PlusExcluded = 0;
  let legacyUncalibrated83PlusExcluded = 0;

  for (const item of recordsWithVideoMeta) {
    const vid = String(item.videoId);
    if (item.analysisObservationScope) {
      unwatchedVideoIds.add(vid);
      unwatchedScopeScenes++;
    }
    const cal = item.calibratedScore != null && Number.isFinite(Number(item.calibratedScore))
      ? Number(item.calibratedScore)
      : null;
    const legacy = item.aiOverallScore != null && Number.isFinite(Number(item.aiOverallScore))
      ? Number(item.aiOverallScore)
      : null;

    if (cal === null) {
      uncalibratedScenes++;
      if (legacy !== null && legacy >= 78) legacyUncalibrated78PlusExcluded++;
      if (legacy !== null && legacy >= 83) legacyUncalibrated83PlusExcluded++;
    } else if (cal >= 83) {
      calibratedScore83PlusScenes++;
    } else if (cal >= 78) {
      calibratedScore78To82Scenes++;
    } else {
      calibratedScoreBelow78Scenes++;
    }
  }

  const totalScenes = recordsWithVideoMeta.length;
  const calibratedVideoScenes =
    calibratedScore83PlusScenes + calibratedScore78To82Scenes + calibratedScoreBelow78Scenes;
  const score78PlusCalibratedScenes = calibratedScore83PlusScenes + calibratedScore78To82Scenes;
  const score83PlusCalibratedScenes = calibratedScore83PlusScenes;

  return {
    unwatchedScopeVideos: unwatchedVideoIds.size,
    unwatchedScopeScenes,
    watchedScenesDefaultVisible: totalScenes - unwatchedScopeScenes,
    calibratedVideoScenes,
    calibratedBands: {
      score83Plus: calibratedScore83PlusScenes,
      score78To82: calibratedScore78To82Scenes,
      scoreBelow78: calibratedScoreBelow78Scenes,
    },
    score78PlusScenes: score78PlusCalibratedScenes,
    score83PlusScenes: score83PlusCalibratedScenes,
    uncalibratedScenes,
    legacyUncalibratedExcludedFromScoreFilters: {
      legacy78PlusExcluded: legacyUncalibrated78PlusExcluded,
      legacy83PlusExcluded: legacyUncalibrated83PlusExcluded,
    },
    scoreBandReconciliation: {
      calibratedTotal: calibratedVideoScenes,
      sumOfCalibratedBands:
        calibratedScore83PlusScenes + calibratedScore78To82Scenes + calibratedScoreBelow78Scenes,
      calibratedBandsMatch:
        calibratedScore83PlusScenes + calibratedScore78To82Scenes + calibratedScoreBelow78Scenes ===
        calibratedVideoScenes,
      score78PlusLeqCalibrated: score78PlusCalibratedScenes <= calibratedVideoScenes,
      calibratedPlusUncalibrated: calibratedVideoScenes + uncalibratedScenes,
      totalScenes,
      allScenesMatch: calibratedVideoScenes + uncalibratedScenes === totalScenes,
    },
  };
}

/**
 * Detect scenes that exist in TiDB `videoScenes` but no longer exist in the source SQLite dataset
 * (e.g. after re-segmentation reduced a video's shot count or replaced its shot indices).
 */
export function computeStaleScenes(tidbSceneRows, sourceSceneRows) {
  const sourceKeys = new Set();
  for (const s of sourceSceneRows) {
    const vid = String(s.videoId ?? s.video_id);
    const idx = Number(s.shotIndex ?? s.shot_index);
    sourceKeys.add(`${vid}\u0000${idx}`);
  }

  const byVideo = new Map();
  let staleScenesCount = 0;

  for (const row of tidbSceneRows) {
    const vid = String(row.videoId ?? row.video_id);
    const idx = Number(row.shotIndex ?? row.shot_index);
    if (!sourceKeys.has(`${vid}\u0000${idx}`)) {
      staleScenesCount++;
      let entry = byVideo.get(vid);
      if (!entry) {
        entry = { videoId: vid, staleCount: 0, staleShotIndices: [], scenes: [] };
        byVideo.set(vid, entry);
      }
      entry.staleCount++;
      entry.staleShotIndices.push(idx);
      entry.scenes.push({
        shotIndex: idx,
        startMmss: String(row.startMmss ?? row.start_mmss ?? ""),
        endMmss: String(row.endMmss ?? row.end_mmss ?? ""),
        shotTitle: String(row.shotTitle ?? row.shot_title ?? ""),
      });
    }
  }

  const staleByVideo = Array.from(byVideo.values())
    .map((entry) => ({
      ...entry,
      staleShotIndices: entry.staleShotIndices.sort((a, b) => a - b),
      scenes: entry.scenes.sort((a, b) => a.shotIndex - b.shotIndex),
    }))
    .sort((a, b) => a.videoId.localeCompare(b.videoId));

  return {
    staleVideosCount: staleByVideo.length,
    staleScenesCount,
    staleByVideo,
  };
}

/**
 * Safely prune stale scenes one video at a time AFTER writing & verifying a per-video JSONL backup.
 * NEVER runs unless `--apply --prune-stale` is explicitly specified.
 */
export async function pruneStaleScenesPerVideo({ conn, staleByVideo, backupDir }) {
  if (!staleByVideo || staleByVideo.length === 0) {
    return {
      prunedVideosCount: 0,
      prunedScenesCount: 0,
      backupDir: null,
      manifestPath: null,
      videos: [],
    };
  }
  if (!backupDir) {
    throw new Error("backupDir is required before pruning stale scenes");
  }

  fs.mkdirSync(backupDir, { recursive: true });
  const results = [];
  let totalDeleted = 0;

  for (const entry of staleByVideo) {
    const videoId = String(entry.videoId);
    const staleIndices = Array.from(
      new Set(entry.staleShotIndices.map((n) => Number(n)).filter((n) => Number.isInteger(n))),
    ).sort((a, b) => a - b);
    if (staleIndices.length === 0) continue;

    // 1. Read ALL current TiDB rows for this video and write per-video JSONL backup first
    const [currentRows] = await conn.query(
      "SELECT * FROM `videoScenes` WHERE `videoId` = ? ORDER BY `shotIndex` ASC",
      [videoId],
    );
    const backupContent = currentRows.map((r) => JSON.stringify(r)).join("\n") + (currentRows.length ? "\n" : "");
    const backupFile = path.join(backupDir, `${sanitizeFilename(videoId)}.jsonl`);
    fs.writeFileSync(backupFile, backupContent, "utf8");

    // 2. Verify backup file was persisted and matches SHA-256 before any DELETE
    const readBack = fs.readFileSync(backupFile, "utf8");
    const backupSha256 = sha256Text(readBack);
    if (readBack !== backupContent || (currentRows.length > 0 && readBack.length === 0)) {
      throw new Error(`Backup verification failed for videoId=${videoId}; aborting prune before DELETE`);
    }

    // 3. Delete ONLY this video's stale shotIndices
    const placeholders = staleIndices.map(() => "?").join(", ");
    const [delResult] = await conn.query(
      `DELETE FROM \`videoScenes\` WHERE \`videoId\` = ? AND \`shotIndex\` IN (${placeholders})`,
      [videoId, ...staleIndices],
    );
    const affectedRows = Number(delResult?.affectedRows ?? staleIndices.length);
    totalDeleted += affectedRows;

    results.push({
      videoId,
      backedUpRowCount: currentRows.length,
      backupFile,
      backupSha256,
      deletedShotIndices: staleIndices,
      affectedRows,
    });
  }

  const manifestPath = path.join(backupDir, "manifest.json");
  const manifest = {
    createdAtUtc: new Date().toISOString(),
    prunedVideosCount: results.length,
    prunedScenesCount: totalDeleted,
    videos: results,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  return {
    prunedVideosCount: results.length,
    prunedScenesCount: totalDeleted,
    backupDir,
    manifestPath,
    videos: results,
  };
}

export function chunkArray(items, chunkSize = DEFAULT_CHUNK_SIZE) {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error("chunkSize must be a positive integer");
  }
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

export function buildUpsertBatchSql(rows) {
  if (!rows.length) throw new Error("Cannot build upsert SQL for empty batch");
  const placeholders = rows
    .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .join(",\n");
  const sql = `
INSERT INTO \`videoScenes\` (
  \`videoId\`, \`shotIndex\`, \`startMmss\`, \`endMmss\`,
  \`startSec\`, \`endSec\`, \`durationSec\`,
  \`shotTitle\`, \`description\`, \`audioText\`,
  \`keywordsJson\`, \`searchText\`, \`sceneSha256\`,
  \`analysisVersion\`, \`analysisGeneratedAt\`, \`sourceUpdatedAt\`
) VALUES
${placeholders}
ON DUPLICATE KEY UPDATE
  \`startMmss\` = VALUES(\`startMmss\`),
  \`endMmss\` = VALUES(\`endMmss\`),
  \`startSec\` = VALUES(\`startSec\`),
  \`endSec\` = VALUES(\`endSec\`),
  \`durationSec\` = VALUES(\`durationSec\`),
  \`shotTitle\` = VALUES(\`shotTitle\`),
  \`description\` = VALUES(\`description\`),
  \`audioText\` = VALUES(\`audioText\`),
  \`keywordsJson\` = VALUES(\`keywordsJson\`),
  \`searchText\` = VALUES(\`searchText\`),
  \`sceneSha256\` = VALUES(\`sceneSha256\`),
  \`analysisVersion\` = VALUES(\`analysisVersion\`),
  \`analysisGeneratedAt\` = VALUES(\`analysisGeneratedAt\`),
  \`sourceUpdatedAt\` = VALUES(\`sourceUpdatedAt\`)
`.trim();
  const now = new Date();
  const params = [];
  for (const r of rows) {
    params.push(
      r.videoId,
      r.shotIndex,
      r.startMmss,
      r.endMmss,
      r.startSec,
      r.endSec,
      r.durationSec,
      r.shotTitle,
      r.description,
      r.audioText,
      r.keywordsJson,
      r.searchText,
      r.sceneSha256 ?? null,
      r.analysisVersion ?? "legacy",
      r.analysisGeneratedAt ?? null,
      now,
    );
  }
  return { sql, params };
}

export function verifyApplyLock(lockObj, expectedWorker, expectedRunId = LOCK_RUN_ID) {
  if (!expectedWorker || !String(expectedWorker).trim()) {
    throw new Error(
      "Worker name is required: pass --worker <name> or set IKETERU_WORKER_NAME. (OS hostname fallback is disabled.)",
    );
  }
  const ok =
    lockObj &&
    lockObj.status === "locked" &&
    lockObj.run_id === expectedRunId &&
    lockObj.worker === expectedWorker;
  if (!ok) {
    throw new Error(
      `Refusing to write to TiDB without active write lock! Expected status="locked", worker="${expectedWorker}", run_id="${expectedRunId}", ` +
        `found=${JSON.stringify({ status: lockObj?.status ?? null, worker: lockObj?.worker ?? null, run_id: lockObj?.run_id ?? null })}. ` +
        `Acquire and push lock first: node scripts/claim-phase3-batch.mjs --acquire-apply-lock ${expectedRunId} --worker ${expectedWorker}`,
    );
  }
  return true;
}

export function estimateStorageBytes(normalizedRows) {
  let rawTextBytes = 0;
  for (const r of normalizedRows) {
    rawTextBytes +=
      Buffer.byteLength(r.videoId, "utf8") +
      Buffer.byteLength(r.startMmss, "utf8") +
      Buffer.byteLength(r.endMmss, "utf8") +
      Buffer.byteLength(r.shotTitle, "utf8") +
      Buffer.byteLength(r.description, "utf8") +
      Buffer.byteLength(r.audioText || "", "utf8") +
      Buffer.byteLength(r.keywordsJson, "utf8") +
      Buffer.byteLength(r.searchText, "utf8") +
      Buffer.byteLength(r.sceneSha256 || "", "utf8") +
      Buffer.byteLength(r.analysisVersion || "legacy", "utf8") +
      64; // fixed numeric/timestamp/row overhead
  }
  // TiDB row + 3 secondary/unique indexes overhead factor
  const estimatedDataBytes = Math.round(rawTextBytes * 1.15);
  const estimatedIndexBytes = Math.round(normalizedRows.length * 160);
  const estimatedTotalBytes = estimatedDataBytes + estimatedIndexBytes;
  return {
    rawTextBytes,
    estimatedDataMb: Number((estimatedDataBytes / (1024 * 1024)).toFixed(2)),
    estimatedIndexMb: Number((estimatedIndexBytes / (1024 * 1024)).toFixed(2)),
    estimatedTotalMb: Number((estimatedTotalBytes / (1024 * 1024)).toFixed(2)),
    pctOfFreeTier5GiB: Number(((estimatedTotalBytes / TIDB_FREE_TIER_BYTES) * 100).toFixed(3)),
  };
}

function readSqliteScenesReadOnly(sqlitePath) {
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite database not found: ${sqlitePath}`);
  }
  const py = `
import json, sqlite3, sys
db_path = sys.argv[1]
con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
con.row_factory = sqlite3.Row
rows = con.execute("""
    SELECT video_id, shot_index, start_mmss, end_mmss, start_sec, end_sec, duration_sec, shot_title, description
    FROM scenes
    ORDER BY video_id ASC, shot_index ASC
""").fetchall()
for r in rows:
    print(json.dumps(dict(r), ensure_ascii=False))
con.close()
`;
  const res = spawnSync("python", ["-c", py, sqlitePath], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`SQLite read failed (exit ${res.status}): ${res.stderr}`);
  }
  const out = [];
  for (const line of res.stdout.split(/\r?\n/)) {
    if (line.trim()) out.push(JSON.parse(line));
  }
  return out;
}

function loadApplyLock() {
  if (!fs.existsSync(APPLY_LOCK_PATH)) {
    return { schema_version: 1, status: "unlocked", worker: null, run_id: null, started_at: null };
  }
  return JSON.parse(fs.readFileSync(APPLY_LOCK_PATH, "utf8"));
}

function formatUtcTimestampCompact(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "_");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  require("dotenv").config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
  const mysql = require("mysql2/promise");

  const worker = String(opts.worker || process.env.IKETERU_WORKER_NAME || "").trim();
  if (!opts.dryRun) {
    const lock = loadApplyLock();
    verifyApplyLock(lock, worker, LOCK_RUN_ID);
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set in .env");
  }
  const ddlSql = fs.readFileSync(DDL_SQL_PATH, "utf8").trim();

  // 1. Read SQLite scenes read-only
  const rawScenes = readSqliteScenesReadOnly(opts.sqlitePath);

  // 2. Connect to TiDB
  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
  });

  try {
    const [preMetaRows] = await conn.query("SELECT COUNT(*) AS cnt, MAX(updatedAt) AS max_upd FROM videos");
    const tidbVideosPre = {
      count: Number(preMetaRows[0].cnt),
      maxUpdatedAt:
        preMetaRows[0].max_upd instanceof Date
          ? preMetaRows[0].max_upd.toISOString()
          : String(preMetaRows[0].max_upd),
    };

    const [tableCheck] = await conn.query("SHOW TABLES LIKE 'videoScenes'");
    const tableExists = tableCheck.length > 0;
    let existingSceneCount = 0;
    let existingTidbSceneRows = [];
    if (tableExists) {
      const [cntRows] = await conn.query("SELECT COUNT(*) AS cnt FROM videoScenes");
      existingSceneCount = Number(cntRows[0].cnt);
      const [tidbRows] = await conn.query(
        "SELECT videoId, shotIndex, startMmss, endMmss, shotTitle FROM videoScenes ORDER BY videoId ASC, shotIndex ASC",
      );
      existingTidbSceneRows = tidbRows;
    }

    const [tidbVideoRows] = await conn.query(`
      SELECT id, title, platform, analysisObservationScope, calibratedScore, aiOverallScore
      FROM videos
    `);
    const videoById = new Map();
    for (const v of tidbVideoRows) videoById.set(String(v.id), v);

    // Check referential integrity (fail-closed)
    const missingVideoIds = new Set();
    const normalizedRows = [];
    const metaForBreakdown = [];
    const distinctVideoIds = new Set();
    let shotTitleTruncatedGt255 = 0;

    for (const raw of rawScenes) {
      const vid = String(raw.video_id);
      const v = videoById.get(vid);
      if (!v) {
        missingVideoIds.add(vid);
        continue;
      }
      if (opts.excludeUnwatched && v.analysisObservationScope) {
        continue;
      }
      distinctVideoIds.add(vid);
      metaForBreakdown.push({
        videoId: vid,
        analysisObservationScope: v.analysisObservationScope ?? null,
        calibratedScore: v.calibratedScore != null ? Number(v.calibratedScore) : null,
        aiOverallScore: v.aiOverallScore != null ? Number(v.aiOverallScore) : null,
      });

      const normalized = normalizeSceneRecord(raw, v.title || "", {
        analysisVersion: "legacy",
        analysisGeneratedAt: null,
      });
      if (normalized._titleTruncated) shotTitleTruncatedGt255++;
      normalizedRows.push(normalized);
    }

    if (missingVideoIds.size > 0) {
      throw new Error(
        `Integrity failure: ${missingVideoIds.size} SQLite scene video_ids do not exist in TiDB videos: ${Array.from(missingVideoIds).slice(0, 10).join(", ")}`,
      );
    }

    const breakdown = buildScoreBreakdownAndReconcile(metaForBreakdown);
    const staleAnalysis = tableExists
      ? { tableExists: true, ...computeStaleScenes(existingTidbSceneRows, normalizedRows) }
      : { tableExists: false, staleVideosCount: 0, staleScenesCount: 0, staleByVideo: [] };

    const chunks = chunkArray(normalizedRows, opts.chunkSize);
    const sizeEstimate = estimateStorageBytes(normalizedRows);
    const sampleRecords = normalizedRows.slice(0, 2).map(({ _titleTruncated, ...rest }) => rest);

    const report = {
      generatedAtUtc: new Date().toISOString(),
      mode: opts.dryRun ? "dry_run" : "apply",
      pruneStaleRequested: opts.pruneStale,
      excludeUnwatched: opts.excludeUnwatched,
      worker: worker || null,
      lockRunId: LOCK_RUN_ID,
      sqlitePath: opts.sqlitePath,
      tidbDdlExecuted: false,
      tidbWritesExecuted: 0,
      existingVideosTableTouched: false,
      plannedTable: {
        tableName: "videoScenes",
        ddlPath: path.relative(REPO_ROOT, DDL_SQL_PATH).replace(/\\/g, "/"),
        currentlyExistsInTiDB: tableExists,
        existingRowCountInTiDB: existingSceneCount,
        ddlPreview: ddlSql,
      },
      migrationPlan: {
        totalScenesToUpsert: normalizedRows.length,
        distinctVideosToUpsert: distinctVideoIds.size,
        missingVideoIdsInTiDB: missingVideoIds.size,
        shotTitleTruncatedGt255,
        defaultAnalysisVersion: "legacy",
        chunkSize: opts.chunkSize,
        totalBatches: chunks.length,
        idempotentStrategy: "INSERT INTO videoScenes ... ON DUPLICATE KEY UPDATE (keyed by UNIQUE(videoId, shotIndex))",
        breakdown,
        sizeEstimate,
        sampleRecords,
      },
      staleScenesAnalysis: staleAnalysis,
      tidbVideosIntegrity: {
        pre: tidbVideosPre,
        post: null,
        unchanged: null,
      },
    };

    if (opts.dryRun) {
      const [postMetaRows] = await conn.query("SELECT COUNT(*) AS cnt, MAX(updatedAt) AS max_upd FROM videos");
      report.tidbVideosIntegrity.post = {
        count: Number(postMetaRows[0].cnt),
        maxUpdatedAt:
          postMetaRows[0].max_upd instanceof Date
            ? postMetaRows[0].max_upd.toISOString()
            : String(postMetaRows[0].max_upd),
      };
      report.tidbVideosIntegrity.unchanged =
        report.tidbVideosIntegrity.pre.count === report.tidbVideosIntegrity.post.count &&
        report.tidbVideosIntegrity.pre.maxUpdatedAt === report.tidbVideosIntegrity.post.maxUpdatedAt;

      if (opts.reportOut) {
        fs.mkdirSync(path.dirname(opts.reportOut), { recursive: true });
        fs.writeFileSync(opts.reportOut, JSON.stringify(report, null, 2) + "\n", "utf8");
      }
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    // --apply mode (requires active lock verified above)
    await conn.query(ddlSql);
    report.tidbDdlExecuted = true;

    let batchesExecuted = 0;
    for (const batch of chunks) {
      const { sql, params } = buildUpsertBatchSql(batch);
      await conn.query(sql, params);
      batchesExecuted++;
    }
    report.tidbWritesExecuted = normalizedRows.length;

    let pruneResult = null;
    if (opts.pruneStale && staleAnalysis.staleScenesCount > 0) {
      const backupDir =
        opts.backupDir ||
        path.join(DEFAULT_BACKUP_ROOT, `video_scenes_pre_prune_${formatUtcTimestampCompact()}`);
      pruneResult = await pruneStaleScenesPerVideo({
        conn,
        staleByVideo: staleAnalysis.staleByVideo,
        backupDir,
      });
    }

    const [postScenesRows] = await conn.query(
      "SELECT COUNT(*) AS cnt, COUNT(DISTINCT videoId) AS vcnt FROM videoScenes",
    );
    const [postMetaRows] = await conn.query("SELECT COUNT(*) AS cnt, MAX(updatedAt) AS max_upd FROM videos");
    report.tidbVideosIntegrity.post = {
      count: Number(postMetaRows[0].cnt),
      maxUpdatedAt:
        postMetaRows[0].max_upd instanceof Date
          ? postMetaRows[0].max_upd.toISOString()
          : String(postMetaRows[0].max_upd),
    };
    report.tidbVideosIntegrity.unchanged =
      report.tidbVideosIntegrity.pre.count === report.tidbVideosIntegrity.post.count &&
      report.tidbVideosIntegrity.pre.maxUpdatedAt === report.tidbVideosIntegrity.post.maxUpdatedAt;
    report.applyResult = {
      batchesExecuted,
      pruneResult,
      postVideoScenesCount: Number(postScenesRows[0].cnt),
      postDistinctVideoCount: Number(postScenesRows[0].vcnt),
      countsMatchExpected:
        Number(postScenesRows[0].cnt) === normalizedRows.length &&
        Number(postScenesRows[0].vcnt) === distinctVideoIds.size,
    };

    if (opts.reportOut) {
      fs.mkdirSync(path.dirname(opts.reportOut), { recursive: true });
      fs.writeFileSync(opts.reportOut, JSON.stringify(report, null, 2) + "\n", "utf8");
    }
    console.log(JSON.stringify(report, null, 2));

    if (!report.tidbVideosIntegrity.unchanged || !report.applyResult.countsMatchExpected) {
      process.exit(1);
    }
  } finally {
    await conn.end();
  }
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
