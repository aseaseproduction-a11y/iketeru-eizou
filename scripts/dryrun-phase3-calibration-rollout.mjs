#!/usr/bin/env node
/**
 * Phase 3 (D+C) Calibration Rollout — Strictly READ-ONLY Dry-Run Planner.
 *
 * Guarantees:
 *   - ZERO writes to production TiDB (SELECT / DESCRIBE only).
 *   - ZERO writes to local SQLite mirror (opened with ?mode=ro).
 *   - Produces exact row counts for:
 *       (D) Legacy score tagging migration & backfill (without overwriting any legacy column)
 *       (C) Priority 1 / 2 / 3 re-scoring queues split into batches of <= 200 videos
 *   - Writes JSON report to analysis/phase3_rollout_dryrun_report.json (LF).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_SQLITE_PATH = "E:\\iketeru-creative-studio\\data\\iketeru_knowledge.db";
const DEFAULT_FROZEN_CONFIG_PATH = path.join(REPO_ROOT, "analysis", "phase2_frozen_config_v1.json");
const DEFAULT_REPORT_PATH = path.join(REPO_ROOT, "analysis", "phase3_rollout_dryrun_report.json");

export const MAX_BATCH_SIZE = 200;

export const LEGACY_PROTECTED_COLUMNS = Object.freeze([
  "aiOverallScore",
  "aiDirectionScore",
  "aiTechniqueScore",
  "aiScoreBreakdown",
  "aiOverallRating",
  "aiDirectionRating",
  "aiTechniqueRating",
  "aiAnalysis",
]);

export const NEW_TIDB_COLUMNS = Object.freeze([
  { name: "calibrationStatus", sql: "varchar(32) DEFAULT NULL" },
  { name: "calibratedScore", sql: "decimal(5,2) DEFAULT NULL" },
  { name: "calibratedRank", sql: "varchar(8) DEFAULT NULL" },
  { name: "calibratedTierBand", sql: "varchar(24) DEFAULT NULL" },
  { name: "calibratedBreakdown", sql: "mediumtext DEFAULT NULL" },
  { name: "calibrationVersion", sql: "varchar(32) DEFAULT NULL" },
  { name: "calibratedAt", sql: "timestamp NULL DEFAULT NULL" },
  { name: "calibratedRoute", sql: "varchar(32) DEFAULT NULL" },
  { name: "calibratedRunId", sql: "varchar(64) DEFAULT NULL" },
  { name: "calibrationGenreBucket", sql: "varchar(64) DEFAULT NULL" },
]);

export const NEW_SQLITE_COLUMNS = Object.freeze([
  { name: "calibration_status", sql: "TEXT DEFAULT NULL" },
  { name: "calibrated_score", sql: "REAL DEFAULT NULL" },
  { name: "calibrated_rank", sql: "TEXT DEFAULT NULL" },
  { name: "calibrated_tier_band", sql: "TEXT DEFAULT NULL" },
  { name: "calibrated_breakdown_json", sql: "TEXT DEFAULT ''" },
  { name: "calibration_version", sql: "TEXT DEFAULT NULL" },
  { name: "calibrated_at", sql: "INTEGER DEFAULT NULL" },
  { name: "calibrated_route", sql: "TEXT DEFAULT NULL" },
  { name: "calibrated_run_id", sql: "TEXT DEFAULT NULL" },
  { name: "calibration_genre_bucket", sql: "TEXT DEFAULT NULL" },
]);

function parseTagArray(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map((x) => (typeof x === "string" ? x : x?.slug || x?.name || ""))
      .map((s) => String(s).trim())
      .filter(Boolean);
  }
  if (!raw || typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => (typeof x === "string" ? x : x?.slug || x?.name || ""))
      .map((s) => String(s).trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function normalizePrimaryGenreToken(rawToken) {
  const s = String(rawToken || "").trim().toLowerCase();
  if (!s) return "empty";
  if (["mv", "ミュージックビデオ"].includes(s)) return "mv";
  if (["tv-cm", "tv cm", "tvcm", "web-cm", "web cm", "cm", "cm・プロモーション", "web cm・sns", "promotion"].includes(s)) {
    return "cm";
  }
  if (["corporate", "企業 / 商品vp / コンテスト作品", "企業紹介・採用・コーポレート", "product-demo"].includes(s)) {
    return "corporate";
  }
  if (["branded-movie", "ブランデッドムービー", "branding", "ブランディング"].includes(s)) {
    return "branded-movie";
  }
  if (["cg", "cg-art"].includes(s)) return "cg-anime";
  if (["infographic"].includes(s)) return "motion";
  if (["youtube-sns", "youtube / sns / 縦型動画", "youtube / snsショート"].includes(s)) return "youtube-sns";
  if (["film", "映画 / ドラマ / ショートフィルム", "ショートフィルム / 映画", "short-film"].includes(s)) return "film";
  if (["concept-art", "アート作品 / 自主制作 / 実験映像", "コンセプト映像 / アート / 実験映像"].includes(s)) return "concept-art";
  if (["opening", "オープニング映像", "オープニング / タイトルバック", "ending"].includes(s)) return "opening";
  if (["teaser-trailer", "ティザー / トレーラー / pv"].includes(s)) return "teaser-trailer";
  if (["documentary", "ドキュメンタリー", "ドキュメンタリー・インタビュー"].includes(s)) return "documentary";
  if (["making", "メイキング / behind the scenes"].includes(s)) return "making";
  if (["how-to", "解説 / ハウツー / チュートリアル"].includes(s)) return "how-to";
  if (["event-live", "ライブ / イベント / 展示映像"].includes(s)) return "event-live";
  if (["showreel", "デモリール / ショーリール"].includes(s)) return "showreel";
  return s;
}

/**
 * Conservatively classify a DB video row for Phase 2 v1 calibration.
 *
 * Rules (strictly honors Phase 2 verified 5 genres vs unverified genres):
 *   - Primary genre = first genre token in `genres`.
 *   - Unverified genres (youtube-sns, film, concept-art, opening, teaser-trailer,
 *     documentary, making, how-to, event-live, showreel, empty, pure branded-movie)
 *     ALWAYS stay unverified (`genreVerified = false`), even if tagged with motion-graphics/3D.
 *   - Verified genres:
 *       * mv -> "MV" (H1 video)
 *       * cm (or branded-movie + secondary cm) -> "モーション" if pure motion-graphics (no live-action), else "CM"
 *       * corporate (or branded-movie + secondary corporate) -> "モーション" if pure motion-graphics (no live-action), else "企業映像"
 *       * cg-anime -> "3DCG/アニメ"
 *       * motion -> "モーション"
 */
export function classifyVideoForCalibration(row) {
  const genres = parseTagArray(row.genres);
  const directions = parseTagArray(row.directions).map((x) => x.toLowerCase());
  const expressions = parseTagArray(row.expressions).map((x) => x.toLowerCase());
  const normGenres = genres.map(normalizePrimaryGenreToken);
  const primary = normGenres[0] || "empty";
  const secondarySet = new Set(normGenres.slice(1));

  const hasLiveAction =
    directions.some((d) => d === "live-action" || d.includes("実写")) ||
    expressions.some((e) => e.includes("実写"));
  const hasMotionOnlyCue =
    !hasLiveAction &&
    (directions.some((d) => d === "motion-graphics" || d.includes("モーション")) ||
      expressions.some((e) => e.includes("タイポグラフィ")));
  const has3dcgAnimeOnlyCue =
    !hasLiveAction &&
    (directions.some((d) => d === "vfx-3dcg" || d.includes("3dcg") || d.includes("アニメ") || d === "illustration") ||
      expressions.some((e) => e === "3d" || e === "アニメーション"));

  let genreVerified = false;
  let calibrationGenreBucket = `unverified:${primary}`;
  let routingGenre = calibrationGenreBucket;

  if (primary === "mv") {
    genreVerified = true;
    calibrationGenreBucket = "MV";
    routingGenre = "MV";
  } else if (primary === "cm" || (primary === "branded-movie" && secondarySet.has("cm"))) {
    genreVerified = true;
    calibrationGenreBucket = hasMotionOnlyCue ? "モーション" : "CM";
    routingGenre = calibrationGenreBucket;
  } else if (primary === "corporate" || (primary === "branded-movie" && secondarySet.has("corporate"))) {
    genreVerified = true;
    calibrationGenreBucket = hasMotionOnlyCue ? "モーション" : "企業映像";
    routingGenre = calibrationGenreBucket;
  } else if (primary === "cg-anime") {
    genreVerified = true;
    calibrationGenreBucket = "3DCG/アニメ";
    routingGenre = "3DCG/アニメ";
  } else if (primary === "motion") {
    genreVerified = true;
    calibrationGenreBucket = "モーション";
    routingGenre = "モーション";
  } else {
    genreVerified = false;
    calibrationGenreBucket = `unverified:${primary}`;
    // Even for unverified genres, if user explicitly calibrates in Priority 1,
    // H1 routing still safely routes motion-only pieces to video if desired, or keeps unverified bucket.
    routingGenre = hasMotionOnlyCue ? "モーション" : calibrationGenreBucket;
  }

  const hasPrivateRating = Boolean(String(row.privateRating || "").trim());
  const hasLegacyScore = row.aiOverallScore !== null && row.aiOverallScore !== undefined;
  const hasLegacyRating = Boolean(String(row.aiOverallRating || "").trim());
  const initialCalibrationStatus = hasLegacyScore || hasLegacyRating ? "legacy_uncalibrated" : "unscored";
  const targetStatusAfterCalibration = genreVerified ? "calibrated_verified" : "calibrated_unverified_genre";

  let priorityTier;
  if (hasPrivateRating) {
    priorityTier = "P1_private_rating";
  } else if (genreVerified) {
    priorityTier = "P2_verified_5_genres";
  } else {
    priorityTier = "P3_unverified_genres";
  }

  const platform = String(row.platform || "unknown").toLowerCase();
  const embedStatus = String(row.embedStatus || "unknown").toLowerCase();
  const fetchablePlatform = platform === "youtube" || platform === "vimeo";
  const likelyFetchBlocked = !fetchablePlatform || embedStatus === "restricted";

  return {
    id: String(row.id),
    platform,
    embedStatus,
    primary_genre_norm: primary,
    genre_verified: genreVerified,
    calibration_genre_bucket: calibrationGenreBucket,
    routing_genre: routingGenre,
    has_motion_only_cue: hasMotionOnlyCue,
    has_3dcg_anime_only_cue: has3dcgAnimeOnlyCue,
    has_private_rating: hasPrivateRating,
    has_legacy_score: hasLegacyScore,
    has_legacy_rating: hasLegacyRating,
    initial_calibration_status: initialCalibrationStatus,
    target_status_after_calibration: targetStatusAfterCalibration,
    priority_tier: priorityTier,
    fetchable_platform: fetchablePlatform,
    likely_fetch_blocked: likelyFetchBlocked,
  };
}

export function splitIntoBatches(items, maxBatchSize = MAX_BATCH_SIZE) {
  const batches = [];
  for (let i = 0; i < items.length; i += maxBatchSize) {
    batches.push(items.slice(i, i + maxBatchSize));
  }
  return batches;
}

function inc(obj, key) {
  obj[key] = (obj[key] || 0) + 1;
}

export function buildRolloutDryRunPlan(rows, { maxBatchSize = MAX_BATCH_SIZE } = {}) {
  const classified = rows.map(classifyVideoForCalibration);

  const migrationD = {
    total_rows: classified.length,
    legacy_protected_columns_overwritten: 0,
    legacy_protected_columns: [...LEGACY_PROTECTED_COLUMNS],
    new_columns_to_add_count: NEW_TIDB_COLUMNS.length,
    backfill_set_legacy_uncalibrated: 0,
    backfill_set_legacy_uncalibrated_with_100pt: 0,
    backfill_set_legacy_uncalibrated_rating_only: 0,
    backfill_set_unscored: 0,
    calibrated_columns_initialized_null: classified.length,
  };

  const buckets = {
    P1_private_rating: [],
    P2_verified_5_genres: [],
    P3_unverified_genres: [],
  };

  for (const c of classified) {
    if (c.initial_calibration_status === "legacy_uncalibrated") {
      migrationD.backfill_set_legacy_uncalibrated++;
      if (c.has_legacy_score) migrationD.backfill_set_legacy_uncalibrated_with_100pt++;
      else migrationD.backfill_set_legacy_uncalibrated_rating_only++;
    } else {
      migrationD.backfill_set_unscored++;
    }
    buckets[c.priority_tier].push(c);
  }

  function summarizeTier(list) {
    const byBucket = {};
    const byPlatform = {};
    const byEmbed = {};
    const byTargetStatus = {};
    let fetchableImmediate = 0;
    let likelyBlocked = 0;
    for (const x of list) {
      inc(byBucket, x.calibration_genre_bucket);
      inc(byPlatform, x.platform);
      inc(byEmbed, x.embedStatus);
      inc(byTargetStatus, x.target_status_after_calibration);
      if (x.likely_fetch_blocked) likelyBlocked++;
      else fetchableImmediate++;
    }
    const batches = splitIntoBatches(list, maxBatchSize);
    return {
      total: list.length,
      fetchable_without_known_block: fetchableImmediate,
      likely_fetch_blocked_or_unsupported: likelyBlocked,
      batch_count_max_200: batches.length,
      batch_sizes: batches.map((b) => b.length),
      by_calibration_genre_bucket: Object.fromEntries(
        Object.entries(byBucket).sort((a, b) => b[1] - a[1])
      ),
      by_target_status: byTargetStatus,
      by_platform: byPlatform,
      by_embed_status: byEmbed,
    };
  }

  return {
    migration_d_tidb: migrationD,
    rescore_c_priorities: {
      P1_private_rating: summarizeTier(buckets.P1_private_rating),
      P2_verified_5_genres: summarizeTier(buckets.P2_verified_5_genres),
      P3_unverified_genres: summarizeTier(buckets.P3_unverified_genres),
    },
    totals_check: {
      sum_priorities:
        buckets.P1_private_rating.length +
        buckets.P2_verified_5_genres.length +
        buckets.P3_unverified_genres.length,
      total_rows: classified.length,
      exact_match:
        buckets.P1_private_rating.length +
          buckets.P2_verified_5_genres.length +
          buckets.P3_unverified_genres.length ===
        classified.length,
    },
  };
}

function inspectSqliteReadOnly(sqlitePath) {
  if (!fs.existsSync(sqlitePath)) {
    return { exists: false, path: sqlitePath };
  }
  const pyCode = `
import sqlite3, hashlib, json, os
p = r'''${sqlitePath}'''
st = os.stat(p)
h = hashlib.sha256()
with open(p, 'rb') as f:
    for chunk in iter(lambda: f.read(1024 * 1024), b''):
        h.update(chunk)
con = sqlite3.connect(f'file:{p}?mode=ro', uri=True)
cols = [r[1] for r in con.execute('PRAGMA table_info(videos)').fetchall()]
total = con.execute('SELECT COUNT(*) FROM videos').fetchone()[0]
has_score = con.execute('SELECT COUNT(*) FROM videos WHERE overall_score_100 IS NOT NULL').fetchone()[0]
has_rating_only = con.execute("SELECT COUNT(*) FROM videos WHERE overall_score_100 IS NULL AND overall_rating IS NOT NULL AND TRIM(overall_rating) != ''").fetchone()[0]
unscored = con.execute("SELECT COUNT(*) FROM videos WHERE overall_score_100 IS NULL AND (overall_rating IS NULL OR TRIM(overall_rating) = '')").fetchone()[0]
ids = [str(r[0]) for r in con.execute('SELECT id FROM videos').fetchall()]
con.close()
print(json.dumps({
    'exists': True,
    'path': p,
    'bytes': st.st_size,
    'sha256': h.hexdigest(),
    'videos_count': total,
    'existing_columns_count': len(cols),
    'already_has_calibration_cols': [c for c in cols if c.startswith('calibrat')],
    'backfill_legacy_uncalibrated': has_score + has_rating_only,
    'backfill_legacy_with_100pt': has_score,
    'backfill_legacy_rating_only': has_rating_only,
    'backfill_unscored': unscored,
    'ids': ids
}, ensure_ascii=False))
`;
  const out = execFileSync("python", ["-c", pyCode], { encoding: "utf8" });
  return JSON.parse(out.trim());
}

async function main() {
  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  require("dotenv").config({ path: path.join(REPO_ROOT, ".env") });
  const mysql = require("mysql2/promise");

  const frozenConfig = JSON.parse(fs.readFileSync(DEFAULT_FROZEN_CONFIG_PATH, "utf8"));

  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });

  try {
    const [colRows] = await conn.query("DESCRIBE videos");
    const existingTidbCols = colRows.map((c) => c.Field);
    const [metaRows] = await conn.query(
      "SELECT COUNT(*) AS cnt, MAX(updatedAt) AS max_upd FROM videos"
    );
    const [videoRows] = await conn.query(`
      SELECT id, platform, genres, purposes, expressions, directions,
             privateRating, aiOverallScore, aiOverallRating, embedStatus
      FROM videos
      ORDER BY id ASC
    `);

    const plan = buildRolloutDryRunPlan(videoRows, { maxBatchSize: MAX_BATCH_SIZE });
    const sqliteInfo = inspectSqliteReadOnly(DEFAULT_SQLITE_PATH);

    let tidbSqliteSyncDiff = null;
    if (sqliteInfo.exists) {
      const tidbIdSet = new Set(videoRows.map((r) => String(r.id)));
      const sqliteIdSet = new Set(sqliteInfo.ids);
      let inBoth = 0;
      let tidbOnly = 0;
      let sqliteOnly = 0;
      for (const id of tidbIdSet) {
        if (sqliteIdSet.has(id)) inBoth++;
        else tidbOnly++;
      }
      for (const id of sqliteIdSet) {
        if (!tidbIdSet.has(id)) sqliteOnly++;
      }
      tidbSqliteSyncDiff = {
        tidb_rows: tidbIdSet.size,
        sqlite_rows: sqliteIdSet.size,
        in_both: inBoth,
        tidb_only: tidbOnly,
        sqlite_only: sqliteOnly,
      };
      delete sqliteInfo.ids;
    }

    const report = {
      generated_at: new Date().toISOString(),
      mode: "READ_ONLY_DRY_RUN",
      production_db_written: false,
      sqlite_written: false,
      frozen_calibration_settings: {
        config_path: "analysis/phase2_frozen_config_v1.json",
        calibration_version: "phase2_v1",
        t_award: frozenConfig.t_award,
        t_low: frozenConfig.t_low,
        expected_model: frozenConfig.expected_model,
        prompt_version: frozenConfig.prompt_version,
        hybrid_router_version: frozenConfig.hybrid_router_version,
        frozen_commit: frozenConfig.frozen_commit,
      },
      tidb_snapshot_before: {
        row_count: Number(metaRows[0].cnt),
        max_updated_at:
          metaRows[0].max_upd instanceof Date
            ? metaRows[0].max_upd.toISOString()
            : String(metaRows[0].max_upd),
        existing_columns_count: existingTidbCols.length,
        already_has_calibration_cols: existingTidbCols.filter((c) => c.toLowerCase().includes("calibrat")),
      },
      sqlite_snapshot_before: sqliteInfo,
      tidb_sqlite_id_diff: tidbSqliteSyncDiff,
      new_tidb_columns: NEW_TIDB_COLUMNS,
      new_sqlite_columns: NEW_SQLITE_COLUMNS,
      ...plan,
    };

    const jsonText = JSON.stringify(report, null, 2).replace(/\r\n/g, "\n") + "\n";
    fs.writeFileSync(DEFAULT_REPORT_PATH, jsonText, "utf8");

    console.log("Wrote READ-ONLY dry-run report:", DEFAULT_REPORT_PATH);
    console.log("TiDB snapshot:", JSON.stringify(report.tidb_snapshot_before));
    console.log("SQLite snapshot:", JSON.stringify(report.sqlite_snapshot_before));
    console.log("TiDB vs SQLite diff:", JSON.stringify(report.tidb_sqlite_id_diff));
    console.log("Migration D (TiDB):", JSON.stringify(report.migration_d_tidb, null, 2));
    console.log("Rescore C priorities:", JSON.stringify(report.rescore_c_priorities, null, 2));
    console.log("Totals check:", JSON.stringify(report.totals_check));
  } finally {
    await conn.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
