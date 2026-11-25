#!/usr/bin/env node
/**
 * Deterministic stratified selection of 10 already-calibrated YouTube videos
 * for the Gemini API direct YouTube URL scoring pilot (read-only on TiDB & SQLite).
 *
 * Strictly read-only: NEVER writes to TiDB, SQLite, or production runs.
 * NEVER reads or outputs GEMINI_API_KEY, titles, channel names, or genres.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const require = createRequire(path.join(REPO_ROOT, "package.json"));
const dotenv = require("dotenv");
const mysql = require("mysql2/promise");

dotenv.config({ path: path.join(REPO_ROOT, ".env"), quiet: true });

const SEED_STRING = "iketeru-gemini-api-url-pilot-20261125-v1";
const MAX_DURATION_SEC = 360; // Cap at 6 min to stay comfortably within $4 stop / $5 budget for 20 calls

function seedFromString(str) {
  const hash = crypto.createHash("sha256").update(str).digest();
  return hash.readUInt32BE(0);
}

// Mulberry32 deterministic PRNG
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deterministicShuffle(items, rng) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function scoreToBand(score) {
  if (score >= 83) return ">=83";
  if (score >= 63) return "63-82";
  return "<63";
}

function routeCategory(calibratedRoute) {
  return calibratedRoute === "contact_sheet" ? "contact_sheet" : "video";
}

async function checkYoutubeOembedAvailable(videoId) {
  const ytUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(ytUrl)}&format=json`;
  try {
    const res = await fetch(oembedUrl, {
      method: "GET",
      signal: AbortSignal.timeout(8000),
    });
    return { available: res.status === 200, http_status: res.status };
  } catch (err) {
    return { available: false, http_status: 0, error: String(err?.message || err) };
  }
}

function loadSqliteSceneCounts() {
  // Optional helper file exported from read-only SQLite if present, otherwise query via python
  const scratchPath = path.join(
    REPO_ROOT,
    "analysis",
    "pilot_gemini_api_url",
    "_sqlite_scene_counts_cache.json"
  );
  if (fs.existsSync(scratchPath)) {
    return JSON.parse(fs.readFileSync(scratchPath, "utf8"));
  }
  return null;
}

async function main() {
  const seedInt = seedFromString(SEED_STRING);
  const rng = mulberry32(seedInt);

  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });

  let rows;
  try {
    const [res] = await conn.query(`
      SELECT
        id,
        videoUrl,
        platform,
        calibrationStatus,
        calibratedScore,
        calibratedRank,
        calibratedTierBand,
        calibratedRoute,
        calibratedRunId,
        calibratedBreakdown,
        embedStatus
      FROM videos
      WHERE calibratedScore IS NOT NULL
      ORDER BY id ASC
    `);
    rows = res;
  } finally {
    await conn.end();
  }

  // Filter to calibrated YouTube videos with valid metrics & duration cap
  const pool = [];
  for (const r of rows) {
    const isYt =
      (r.platform && /^youtube$/i.test(r.platform)) ||
      (r.videoUrl && /(youtube\.com|youtu\.be)/i.test(r.videoUrl));
    if (!isYt) continue;

    let bd = null;
    try {
      bd =
        typeof r.calibratedBreakdown === "string"
          ? JSON.parse(r.calibratedBreakdown)
          : r.calibratedBreakdown;
    } catch {
      continue;
    }
    const durationSec = bd?.metrics?.duration_sec;
    if (typeof durationSec !== "number" || !Number.isFinite(durationSec) || durationSec <= 0) {
      continue;
    }
    if (durationSec > MAX_DURATION_SEC) continue;

    const score = Number(r.calibratedScore);
    const knowsWork = bd?.postCheck?.knowsWork ?? bd?.post_check?.knows_work;
    if (typeof knowsWork !== "boolean") continue;

    const routeRaw = r.calibratedRoute || bd?.route || null;
    if (!routeRaw) continue;

    pool.push({
      video_id: r.id,
      youtube_url: `https://www.youtube.com/watch?v=${r.id}`,
      calibrated_score: score,
      calibrated_rank: r.calibratedRank,
      band: scoreToBand(score),
      calibrated_tier_band: r.calibratedTierBand,
      route_raw: routeRaw,
      route_group: routeCategory(routeRaw),
      knows_work: knowsWork,
      duration_sec: Math.round(durationSec * 10) / 10,
      calibration_status: r.calibrationStatus,
      calibrated_run_id: r.calibratedRunId,
      embed_status: r.embedStatus,
      metrics: bd.metrics,
      baseline_raw_scores: bd.rawScores || null,
      baseline_dimensions: bd.dimensions || null,
    });
  }

  // Deterministic stratified buckets
  // 1) >=83 (3 videos): aim for mix of knows_work true/false and route (include 1 contact_sheet if available)
  // 2) 63-82 (4 videos):
  //    - 1 near 63 boundary (63.0 <= score <= 66.0)
  //    - 1 near 83 boundary (80.0 <= score < 83.0)
  //    - 2 interior (66.0 < score < 80.0), including at least 1 contact_sheet
  // 3) <63 (2 videos): 1 contact_sheet + 1 video
  // 4) Free slot (1 video): from remaining pool (prefer knows_work=true or balanced representation)

  const used = new Set();
  const picked = [];

  async function pickFirstAvailable(candidates, slotLabel) {
    const shuffled = deterministicShuffle(candidates, rng);
    for (const c of shuffled) {
      if (used.has(c.video_id)) continue;
      const oembed = await checkYoutubeOembedAvailable(c.video_id);
      if (!oembed.available) continue;
      used.add(c.video_id);
      picked.push({
        slot: slotLabel,
        ...c,
        oembed_http_status: oembed.http_status,
      });
      return true;
    }
    throw new Error(`No available YouTube video found for slot: ${slotLabel}`);
  }

  // Slot 1-3: >=83 (3 videos: 1 contact_sheet, 1 video knows_work=true, 1 video knows_work=false)
  await pickFirstAvailable(
    pool.filter((x) => x.calibrated_score >= 83 && x.route_group === "contact_sheet"),
    ">=83 (1/3: contact_sheet)"
  );
  await pickFirstAvailable(
    pool.filter((x) => x.calibrated_score >= 83 && x.route_group === "video" && x.knows_work === true),
    ">=83 (2/3: video, knows_work=true)"
  );
  await pickFirstAvailable(
    pool.filter((x) => x.calibrated_score >= 83 && x.route_group === "video" && x.knows_work === false),
    ">=83 (3/3: video, knows_work=false)"
  );

  // Slot 4-7: 63-82 (4 videos, 2 within ±3 of 63 or 83)
  await pickFirstAvailable(
    pool.filter((x) => x.calibrated_score >= 63 && x.calibrated_score <= 66),
    "63-82 (1/4: boundary 63 +0..3)"
  );
  await pickFirstAvailable(
    pool.filter((x) => x.calibrated_score >= 80 && x.calibrated_score < 83 && x.knows_work === true),
    "63-82 (2/4: boundary 83 -3..-0.01)"
  );
  await pickFirstAvailable(
    pool.filter(
      (x) =>
        x.calibrated_score > 66 &&
        x.calibrated_score < 80 &&
        x.route_group === "contact_sheet"
    ),
    "63-82 (3/4: interior, contact_sheet)"
  );
  await pickFirstAvailable(
    pool.filter(
      (x) =>
        x.calibrated_score > 66 &&
        x.calibrated_score < 80 &&
        x.route_group === "video" &&
        x.knows_work === false
    ),
    "63-82 (4/4: interior, video)"
  );

  // Slot 8-9: <63 (2 videos: 1 contact_sheet, 1 video)
  await pickFirstAvailable(
    pool.filter((x) => x.calibrated_score < 63 && x.route_group === "contact_sheet"),
    "<63 (1/2: contact_sheet)"
  );
  await pickFirstAvailable(
    pool.filter((x) => x.calibrated_score < 63 && x.route_group === "video"),
    "<63 (2/2: video)"
  );

  // Slot 10: Free slot (1 video: knows_work=true from remaining pool to give solid knows_work=true sample size)
  await pickFirstAvailable(
    pool.filter((x) => x.knows_work === true),
    "free (1/1: knows_work=true)"
  );

  // Optionally attach SQLite scene counts if cache exists
  const sceneCounts = loadSqliteSceneCounts();
  for (const item of picked) {
    if (sceneCounts) {
      item.sqlite_scenes_count = sceneCounts[item.video_id] || 0;
    }
  }

  // Sort for clean display (by score descending)
  const sorted = [...picked].sort((a, b) => b.calibrated_score - a.calibrated_score);

  const summary = {
    generated_at: new Date().toISOString(),
    selection_method: {
      algorithm: "deterministic stratified sampling with Mulberry32 PRNG seeded from SHA-256(seed_string)",
      seed_string: SEED_STRING,
      seed_uint32: seedInt,
      pool_filter: `calibratedScore IS NOT NULL AND platform='youtube' AND duration_sec <= ${MAX_DURATION_SEC} AND oEmbed HTTP 200`,
      eligible_pool_size: pool.length,
    },
    counts: {
      total: sorted.length,
      by_band: {
        ">=83": sorted.filter((x) => x.band === ">=83").length,
        "63-82": sorted.filter((x) => x.band === "63-82").length,
        "<63": sorted.filter((x) => x.band === "<63").length,
      },
      mid_boundary_within_3pt: sorted.filter(
        (x) =>
          x.band === "63-82" &&
          (Math.abs(x.calibrated_score - 63) <= 3 || Math.abs(x.calibrated_score - 83) <= 3)
      ).length,
      by_route_group: {
        video: sorted.filter((x) => x.route_group === "video").length,
        contact_sheet: sorted.filter((x) => x.route_group === "contact_sheet").length,
      },
      by_knows_work: {
        true: sorted.filter((x) => x.knows_work === true).length,
        false: sorted.filter((x) => x.knows_work === false).length,
      },
      total_duration_sec: Math.round(sorted.reduce((a, x) => a + x.duration_sec, 0) * 10) / 10,
      avg_duration_sec: Math.round((sorted.reduce((a, x) => a + x.duration_sec, 0) / sorted.length) * 10) / 10,
      estimated_20_calls_cost_usd_rough:
        Math.round(
          sorted.reduce((a, x) => {
            // Based on probe HRJr0tAASjI (287.2s -> 29,001 video tokens ≈ 101 tok/s + ~2,200 text + ~2,800 out/thought)
            const inTok = x.duration_sec * 101 + 2200;
            const outTok = 2800;
            const callCost = (inTok / 1e6) * 3 + (outTok / 1e6) * 15;
            return a + callCost * 2;
          }, 0) * 100
        ) / 100,
    },
    selected: sorted,
  };

  const outDir = path.join(REPO_ROOT, "analysis", "pilot_gemini_api_url");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "selected_10_videos.json");
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2) + "\n", "utf8");

  console.log(`Saved selection to: ${outPath}`);
  console.log(JSON.stringify({ selection_method: summary.selection_method, counts: summary.counts }, null, 2));
  console.log("\nSELECTED 10 VIDEOS:");
  for (const [idx, x] of sorted.entries()) {
    console.log(
      `${idx + 1}. id=${x.video_id} | score=${x.calibrated_score} (${x.calibrated_rank}) | band=${x.band} | route=${x.route_raw} (${x.route_group}) | knows_work=${x.knows_work} | duration=${x.duration_sec}s | slot=${x.slot}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
