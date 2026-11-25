#!/usr/bin/env node
/**
 * Deterministic stratified selection & preregistration of 50 main + 8 reserve
 * already-calibrated YouTube videos for the Gemini API URL bias-correction validation.
 *
 * Strictly read-only on TiDB & SQLite.
 * NEVER accesses YouTube directly (0 network calls to YouTube).
 * NEVER reads or outputs GEMINI_API_KEY, titles, channel names, or genres.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const require = createRequire(path.join(REPO_ROOT, "package.json"));
const dotenv = require("dotenv");
const mysql = require("mysql2/promise");

dotenv.config({ path: path.join(REPO_ROOT, ".env"), quiet: true });

const SEED_STRING = "iketeru-gemini-api-url-validation-20261125-v1";
const MAX_DURATION_SEC = 900;
const PREV_10_PATH = path.join(REPO_ROOT, "analysis", "pilot_gemini_api_url", "selected_10_videos.json");
const PREV_RUN_CONFIG_PATH = path.join(
  REPO_ROOT,
  "analysis",
  "pilot_gemini_api_url",
  "run_20261125_125425",
  "run_config.json"
);
const OUT_PATH = path.join(REPO_ROOT, "analysis", "pilot_gemini_api_url", "validation_preregistration.json");

function seedFromString(str) {
  return crypto.createHash("sha256").update(str).digest().readUInt32BE(0);
}

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

function durToBin(dur) {
  if (dur <= 60) return "<=60";
  if (dur <= 180) return "60-180";
  if (dur <= 360) return "180-360";
  return "360-900";
}

function loadSqliteSceneCounts() {
  const pyCode = [
    "import sqlite3, json",
    "conn = sqlite3.connect('file:E:/iketeru-creative-studio/data/iketeru_knowledge.db?mode=ro', uri=True)",
    "cur = conn.cursor()",
    "cur.execute('SELECT video_id, COUNT(*) FROM scenes GROUP BY video_id')",
    "print(json.dumps(dict(cur.fetchall())))",
    "conn.close()",
  ].join("\n");
  const out = execFileSync("python", ["-c", pyCode], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(out);
}

function round(n, d = 2) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function summarizeGroup(items) {
  const countBy = (fn) => {
    const m = {};
    for (const x of items) {
      const k = fn(x);
      m[k] = (m[k] || 0) + 1;
    }
    return m;
  };
  const avgScore = round(items.reduce((a, x) => a + x.calibrated_score, 0) / items.length, 2);
  const avgDur = round(items.reduce((a, x) => a + x.duration_sec, 0) / items.length, 1);
  const totalDur = round(items.reduce((a, x) => a + x.duration_sec, 0), 1);
  // Previous pilot formula: 2 calls ≈ $0.0946 + $0.000627 * D
  const est2CallsCost = round(
    items.reduce((a, x) => a + (0.0946 + 0.000627 * x.duration_sec), 0),
    2
  );
  return {
    count: items.length,
    avg_calibrated_score: avgScore,
    avg_duration_sec: avgDur,
    total_duration_sec: totalDur,
    est_2calls_cost_usd: est2CallsCost,
    by_band: countBy((x) => x.band),
    near_83_pm3: items.filter((x) => x.near_83_pm3).length,
    near_63_pm3: items.filter((x) => x.near_63_pm3).length,
    by_duration_bin: countBy((x) => x.duration_bin),
    by_route: countBy((x) => x.route_raw),
    knows_work_true: items.filter((x) => x.knows_work).length,
    knows_work_false: items.filter((x) => !x.knows_work).length,
    with_sqlite_scenes: items.filter((x) => x.sqlite_scenes_count > 0).length,
  };
}

async function main() {
  const prevSel = JSON.parse(fs.readFileSync(PREV_10_PATH, "utf8"));
  const prevIds = new Set(prevSel.selected.map((x) => x.video_id));
  const prevRunCfg = JSON.parse(fs.readFileSync(PREV_RUN_CONFIG_PATH, "utf8"));
  const sceneCounts = loadSqliteSceneCounts();

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

  const pool = [];
  let excludedPrev10 = 0;
  let excludedGt900 = 0;
  for (const r of rows) {
    const isYt =
      (r.platform && /^youtube$/i.test(r.platform)) ||
      (r.videoUrl && /(youtube\.com|youtu\.be)/i.test(r.videoUrl));
    if (!isYt) continue;
    if (prevIds.has(r.id)) {
      excludedPrev10++;
      continue;
    }
    let bd = null;
    try {
      bd = typeof r.calibratedBreakdown === "string" ? JSON.parse(r.calibratedBreakdown) : r.calibratedBreakdown;
    } catch {
      continue;
    }
    const dur = bd?.metrics?.duration_sec;
    if (typeof dur !== "number" || !Number.isFinite(dur) || dur <= 0) continue;
    if (dur > MAX_DURATION_SEC) {
      excludedGt900++;
      continue;
    }
    const kw = bd?.postCheck?.knowsWork ?? bd?.post_check?.knows_work;
    if (typeof kw !== "boolean") continue;
    const routeRaw = r.calibratedRoute || bd?.route || null;
    if (!routeRaw) continue;
    const score = Number(r.calibratedScore);
    pool.push({
      video_id: r.id,
      youtube_url: `https://www.youtube.com/watch?v=${r.id}`,
      calibrated_score: score,
      calibrated_rank: r.calibratedRank,
      band: scoreToBand(score),
      calibrated_tier_band: r.calibratedTierBand,
      near_83_pm3: Math.abs(score - 83) <= 3,
      near_63_pm3: Math.abs(score - 63) <= 3,
      duration_sec: round(dur, 1),
      duration_bin: durToBin(dur),
      route_raw: routeRaw,
      route_group: routeRaw === "contact_sheet" ? "contact_sheet" : "video",
      knows_work: kw,
      calibration_status: r.calibrationStatus,
      calibrated_run_id: r.calibratedRunId,
      embed_status: r.embedStatus,
      sqlite_scenes_count: sceneCounts[r.id] || 0,
      baseline_raw_scores: bd.rawScores || null,
      baseline_dimensions: bd.dimensions || null,
    });
  }

  const seedInt = seedFromString(SEED_STRING);
  const rng = mulberry32(seedInt);

  const used = new Set();
  const picked = [];

  function pickN(candidates, n, slotLabel) {
    const avail = candidates.filter((x) => !used.has(x.video_id));
    const shuffled = deterministicShuffle(avail, rng);
    if (shuffled.length < n) {
      throw new Error(`Not enough candidates for "${slotLabel}": need ${n}, have ${shuffled.length}`);
    }
    const chosen = shuffled.slice(0, n);
    for (const c of chosen) {
      used.add(c.video_id);
      picked.push({ selection_slot: slotLabel, ...c });
    }
    return chosen;
  }

  // --- Stratified deterministic selection for 50 main videos ---
  // Note on pool constraint:
  //   Eligible pool (n=372) has only 5 videos with score < 63.
  //   We include ALL 5 (<63), 14 (>=83), and 31 (63-82, enriched near 63 & 83 boundaries).
  //   Duration 360-900s is fixed at EXACTLY 6 videos (matching user specification).

  // 1) All 5 eligible <63 videos (includes 1 video in 360-900s: _PO5O3QAaVM, 1 contact_sheet, 1 knows_work=true, 3 near_63_pm3)
  pickN(pool.filter((x) => x.band === "<63"), 5, "band_<63_all_5");

  // 2) Remaining 5 videos in 360-900s (total 360-900s = 6: 1 from <63 + 2 from >=83 + 3 from 63-82)
  //    Pick 2 >=83 (include contact_sheet if available) and 3 63-82 (include 1 near_63 and 1 contact_sheet)
  pickN(pool.filter((x) => x.duration_bin === "360-900" && x.band === ">=83" && x.route_raw === "contact_sheet"), 1, "dur_360_900_ge83_cs");
  pickN(pool.filter((x) => x.duration_bin === "360-900" && x.band === ">=83" && x.route_raw !== "contact_sheet"), 1, "dur_360_900_ge83_vid");
  pickN(pool.filter((x) => x.duration_bin === "360-900" && x.band === "63-82" && x.near_63_pm3), 1, "dur_360_900_mid_near63");
  pickN(pool.filter((x) => x.duration_bin === "360-900" && x.band === "63-82" && x.route_raw === "contact_sheet"), 1, "dur_360_900_mid_cs");
  pickN(pool.filter((x) => x.duration_bin === "360-900" && x.band === "63-82"), 1, "dur_360_900_mid_other");

  // From here on, exclude 360-900s so total 360-900s stays EXACTLY 6!
  const poolLt360 = () => pool.filter((x) => !used.has(x.video_id) && x.duration_bin !== "360-900");

  // 3) 63 boundary (63.0..66.0): we already have 3 (<63) + 1 (360-900s) = 4 near_63.
  //    Add 8 more from 63-82 near_63 -> total near_63 = 12 (>= 8 target!)
  pickN(poolLt360().filter((x) => x.band === "63-82" && x.near_63_pm3 && x.route_raw === "video_h2_escalated"), 2, "mid_near63_h2");
  pickN(poolLt360().filter((x) => x.band === "63-82" && x.near_63_pm3), 6, "mid_near63_other");

  // 4) 83 boundary (80.0..86.0): pick 8 from 63-82 (80..82.99) + 6 from >=83 (83..86) -> total near_83 >= 14 (>= 12 target!)
  pickN(poolLt360().filter((x) => x.band === "63-82" && x.near_83_pm3 && x.duration_bin === "<=60"), 2, "mid_near83_le60");
  pickN(poolLt360().filter((x) => x.band === "63-82" && x.near_83_pm3 && x.duration_bin === "60-180"), 3, "mid_near83_60_180");
  pickN(poolLt360().filter((x) => x.band === "63-82" && x.near_83_pm3 && x.duration_bin === "180-360"), 3, "mid_near83_180_360");

  pickN(poolLt360().filter((x) => x.band === ">=83" && x.near_83_pm3 && x.duration_bin === "<=60"), 2, "ge83_near83_le60");
  pickN(poolLt360().filter((x) => x.band === ">=83" && x.near_83_pm3 && x.duration_bin === "60-180"), 2, "ge83_near83_60_180");
  pickN(poolLt360().filter((x) => x.band === ">=83" && x.near_83_pm3 && x.duration_bin === "180-360"), 2, "ge83_near83_180_360");

  // 5) Remaining >=83 (need 14 total; currently 2 from 360-900 + 6 from near83 = 8 -> add 6 high >=86.5)
  pickN(poolLt360().filter((x) => x.band === ">=83" && !x.near_83_pm3 && x.route_raw === "contact_sheet"), 2, "ge83_high_cs");
  pickN(poolLt360().filter((x) => x.band === ">=83" && !x.near_83_pm3 && x.duration_bin === "<=60"), 2, "ge83_high_le60");
  pickN(poolLt360().filter((x) => x.band === ">=83" && !x.near_83_pm3 && x.duration_bin === "60-180"), 2, "ge83_high_60_180");

  // 6) Remaining 63-82 interior (66.5..79.5): currently 3 (360-900) + 8 (near63) + 8 (near83) = 19 -> add 12 more (total 63-82 = 31, grand total = 50)
  //    Balance contact_sheet, video_h2_escalated, <=60, 60-180, 180-360
  pickN(poolLt360().filter((x) => x.band === "63-82" && !x.near_63_pm3 && !x.near_83_pm3 && x.route_raw === "contact_sheet" && x.duration_bin === "<=60"), 3, "mid_int_cs_le60");
  pickN(poolLt360().filter((x) => x.band === "63-82" && !x.near_63_pm3 && !x.near_83_pm3 && x.route_raw === "contact_sheet" && x.duration_bin === "60-180"), 3, "mid_int_cs_60_180");
  pickN(poolLt360().filter((x) => x.band === "63-82" && !x.near_63_pm3 && !x.near_83_pm3 && x.route_raw === "video_h2_escalated"), 2, "mid_int_h2");
  pickN(poolLt360().filter((x) => x.band === "63-82" && !x.near_63_pm3 && !x.near_83_pm3 && x.duration_bin === "<=60"), 2, "mid_int_le60");
  pickN(poolLt360().filter((x) => x.band === "63-82" && !x.near_63_pm3 && !x.near_83_pm3 && x.duration_bin === "60-180"), 2, "mid_int_60_180");

  if (picked.length !== 50) {
    throw new Error(`Expected 50 main videos, got ${picked.length}`);
  }

  // --- Stratified matched-pair split into fit (25) and validation (25) ---
  // Sort deterministically by (band, duration_bin === "360-900", route_group, near_boundary, calibrated_score, video_id)
  // so every adjacent pair (2k, 2k+1) has nearly identical band/length/route/score, then randomly assign (fit, val) or (val, fit).
  const bandRank = { "<63": 0, "63-82": 1, ">=83": 2 };
  const durRank = { "<=60": 0, "60-180": 1, "180-360": 2, "360-900": 3 };
  const routeRank = { contact_sheet: 0, video_h2_escalated: 1, video_h1: 2 };

  const orderedForSplit = [...picked].sort((a, b) => {
    if (bandRank[a.band] !== bandRank[b.band]) return bandRank[a.band] - bandRank[b.band];
    const aLong = a.duration_bin === "360-900" ? 1 : 0;
    const bLong = b.duration_bin === "360-900" ? 1 : 0;
    if (aLong !== bLong) return bLong - aLong;
    if (routeRank[a.route_raw] !== routeRank[b.route_raw]) return routeRank[a.route_raw] - routeRank[b.route_raw];
    if (durRank[a.duration_bin] !== durRank[b.duration_bin]) return durRank[a.duration_bin] - durRank[b.duration_bin];
    if (a.calibrated_score !== b.calibrated_score) return a.calibrated_score - b.calibrated_score;
    return a.video_id.localeCompare(b.video_id);
  });

  const splitRng = mulberry32(seedFromString(`${SEED_STRING}::split`));
  const main50 = [];
  for (let i = 0; i < orderedForSplit.length; i += 2) {
    const a = orderedForSplit[i];
    const b = orderedForSplit[i + 1];
    const flip = splitRng() < 0.5;
    main50.push({ ...a, split: flip ? "fit" : "validation", split_pair_index: i / 2 + 1 });
    main50.push({ ...b, split: flip ? "validation" : "fit", split_pair_index: i / 2 + 1 });
  }

  // Sort final display by split ("fit" then "validation") and score descending
  main50.sort((a, b) => {
    if (a.split !== b.split) return a.split === "fit" ? -1 : 1;
    if (b.calibrated_score !== a.calibrated_score) return b.calibrated_score - a.calibrated_score;
    return a.video_id.localeCompare(b.video_id);
  });

  // --- Select 8 reserve videos (for replacement if API cannot read a video) ---
  const reserve = [];
  function pickReserve(candidates, n, label) {
    const avail = candidates.filter((x) => !used.has(x.video_id));
    const shuffled = deterministicShuffle(avail, rng);
    if (shuffled.length < n) {
      throw new Error(`Not enough reserve candidates for "${label}": need ${n}, have ${shuffled.length}`);
    }
    for (const c of shuffled.slice(0, n)) {
      used.add(c.video_id);
      reserve.push({ reserve_slot: label, ...c });
    }
  }
  pickReserve(pool.filter((x) => x.duration_bin === "360-900"), 1, "reserve_dur_360_900");
  pickReserve(pool.filter((x) => x.band === "63-82" && x.near_63_pm3 && x.duration_bin !== "360-900"), 1, "reserve_mid_near63");
  pickReserve(pool.filter((x) => x.band === "63-82" && x.calibrated_score <= 72 && x.duration_bin !== "360-900"), 1, "reserve_mid_low_66_72");
  pickReserve(pool.filter((x) => x.band === ">=83" && x.near_83_pm3 && x.duration_bin !== "360-900"), 2, "reserve_ge83_near83");
  pickReserve(pool.filter((x) => x.band === "63-82" && x.route_raw === "contact_sheet" && x.duration_bin !== "360-900"), 2, "reserve_mid_cs");
  pickReserve(pool.filter((x) => x.band === "63-82" && x.route_raw === "video_h2_escalated" && x.duration_bin !== "360-900"), 1, "reserve_mid_h2");

  const fit25 = main50.filter((x) => x.split === "fit");
  const val25 = main50.filter((x) => x.split === "validation");

  const prereg = {
    schema_version: 1,
    preregistered_at: new Date().toISOString(),
    study_title: "Gemini API Direct YouTube URL Bias-Correction Validation (N=50: fit=25, validation=25)",
    selection_method: {
      algorithm: "Deterministic stratified sampling with Mulberry32 PRNG seeded from SHA-256(seed_string); TiDB read-only ORDER BY id ASC; 0 direct YouTube network calls",
      seed_string: SEED_STRING,
      seed_uint32: seedInt,
      split_seed_string: `${SEED_STRING}::split`,
      split_method: "Matched-pair stratified random assignment (pairs formed after sorting by band, 360-900s flag, route_raw, duration_bin, calibrated_score, video_id; each pair randomly assigned 1 to fit and 1 to validation)",
      pool_filter: `calibratedScore IS NOT NULL AND platform='youtube' AND id NOT IN prev_10 AND duration_sec <= ${MAX_DURATION_SEC}`,
      eligible_pool_size: pool.length,
      excluded_prev_10_count: excludedPrev10,
      excluded_gt_900s_count: excludedGt900,
      pool_constraints_note: "In the eligible TiDB pool (n=372), only 5 videos have calibratedScore < 63 (vs. guideline target of 12). All 5 eligible <63 videos are included (split 3 fit / 2 validation or 2 fit / 3 validation), and the remaining 7 slots are allocated to 63-82 (enriched near the 63 boundary) and >=83 so that both boundary regions (near 63: 12 videos >= 8 target; near 83: >=14 videos >= 12 target) and all 4 duration bins (360-900s: exact 6 videos, 3 fit / 3 validation) are strongly represented.",
    },
    execution_protocol: {
      identical_to_pilot_run: "run_20261125_125425",
      model: prevRunCfg.model,
      thinking_level: prevRunCfg.thinking_level,
      store: prevRunCfg.store,
      stream: prevRunCfg.stream,
      service_tier: "standard",
      prompt_sha256: prevRunCfg.prompt_sha256,
      ensemble_rule: "2 independent calls per video; if |r1 - r2| >= 5, run 3rd independent call and take median of 3; otherwise take mean of 2",
      budget_usd_max: 15.0,
      budget_stop_usd: 13.0,
      max_requests_including_retries: 130,
      stop_conditions: [
        "cumulative_cost_usd > 13.0 (stop before next call)",
        "total_requests >= 130",
        "HTTP/API error 402, 403, or 429",
        "2 consecutive malformed/invalid JSON outputs",
        "input_video_tokens < 1000 (suspect video not processed)",
        "timestamped observations clearly inconsistent with actual video / SQLite scenes",
      ],
      replacement_policy: "If Gemini API fails to process/read a specific video URL (e.g. private/unavailable on Google side without triggering global 402/403/429 stop), replace from reserve_8 matching band/duration/route as closely as possible and report the substitution.",
    },
    correction_and_decision_rules: {
      fit_set_size: 25,
      validation_set_size: 25,
      methods: {
        uncorrected: {
          name: "補正なし (uncorrected)",
          formula: "y_hat = api_score",
        },
        method_A_constant_offset: {
          name: "(A) 定数オフセット補正",
          fit_estimation: "delta_fit = mean(api_score - calibrated_score) over fit (n=25)",
          formula: "y_hat_A = api_score - delta_fit",
        },
        method_B_linear_ols: {
          name: "(B) 1次式線形補正 (OLS)",
          fit_estimation: "Minimize sum((calibrated_score - (a + b * api_score))^2) over fit (n=25)",
          formula: "y_hat_B = a + b * api_score",
        },
      },
      tier_bands: {
        award_tier: ">= 83",
        pro_band: ">= 63 and < 83",
        low_band: "< 63",
      },
      boundary_definition: "videos with |calibrated_score - 83| <= 3 or |calibrated_score - 63| <= 3",
      pass_fail_criteria_on_validation_25: {
        mae_max: 4.0,
        abs_bias_max: 1.0,
        band_match_rate_min_pct: 85.0,
        selection_rule: "Among methods (A) and (B) (and checking uncorrected for reference) that satisfy all 3 pass criteria on validation (n=25), recommend the one with the lowest validation MAE. If none satisfies all 3 criteria, declare FAIL (不合格).",
      },
    },
    summaries: {
      main_50: summarizeGroup(main50),
      fit_25: summarizeGroup(fit25),
      validation_25: summarizeGroup(val25),
      reserve_8: summarizeGroup(reserve),
    },
    main_50: main50,
    reserve_8: reserve,
  };

  const jsonStr = JSON.stringify(prereg, null, 2) + "\n";
  fs.writeFileSync(OUT_PATH, jsonStr, "utf8");
  const sha256 = crypto.createHash("sha256").update(jsonStr, "utf8").digest("hex");

  console.log(`Wrote preregistration to: ${OUT_PATH}`);
  console.log(`PREREGISTRATION_SHA256=${sha256}`);
  console.log(JSON.stringify(prereg.summaries, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
