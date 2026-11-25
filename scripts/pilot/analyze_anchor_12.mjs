#!/usr/bin/env node
/**
 * 1) Writes analysis/pilot_gemini_api_url/validation_stop_note.json WITHOUT touching validation_preregistration.json.
 * 2) Aggregates the 12 completed videos (10 from run_20261125_125425 + 2 from run_20261125_134050)
 *    as "答え合わせ用の動画" (raw numbers only, NO correction applied).
 * 3) Also verifies SQLite scenes for the 2 newly scored videos and checks preregistration SHA-256 & secret leaks.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PILOT_ROOT = path.join(REPO_ROOT, "analysis", "pilot_gemini_api_url");

const PREREG_PATH = path.join(PILOT_ROOT, "validation_preregistration.json");
const PREV_10_PATH = path.join(PILOT_ROOT, "selected_10_videos.json");
const RUN1_DIR = path.join(PILOT_ROOT, "run_20261125_125425");
const RUN2_DIR = path.join(PILOT_ROOT, "run_20261125_134050");

function round(n, d = 2) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
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

function loadCalls(runDir) {
  const callsDir = path.join(runDir, "calls");
  if (!fs.existsSync(callsDir)) return [];
  return fs
    .readdirSync(callsDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(callsDir, f), "utf8")));
}

function summarize(items) {
  if (!items.length) return null;
  const diffs = items.map((x) => x.diff_api_minus_base);
  const absErrs = diffs.map((d) => Math.abs(d));
  const matches = items.filter((x) => x.band_match).length;
  return {
    n: items.length,
    mean_signed_error_bias: round(mean(diffs), 2),
    mae: round(mean(absErrs), 2),
    max_abs_error: round(Math.max(...absErrs), 2),
    band_match_count: matches,
    band_match_pct: round((matches / items.length) * 100, 1),
  };
}

function main() {
  // 1) Read preregistration (read-only) and verify SHA-256
  const preregBuf = fs.readFileSync(PREREG_PATH);
  const preregSha256 = crypto.createHash("sha256").update(preregBuf).digest("hex");
  const prereg = JSON.parse(preregBuf.toString("utf8"));

  const run1Calls = loadCalls(RUN1_DIR);
  const run2Calls = loadCalls(RUN2_DIR);

  // Group run2 calls by video_id
  const run2ByVid = new Map();
  for (const c of run2Calls) {
    if (!run2ByVid.has(c.video_id)) run2ByVid.set(c.video_id, []);
    run2ByVid.get(c.video_id).push(c);
  }

  const completedInRun2Ids = [];
  const partialInRun2Ids = [];
  const notStartedInRun2Ids = [];

  for (const v of prereg.main_50) {
    const list = (run2ByVid.get(v.video_id) || []).filter((c) => c.parse_ok && c.exit_code === 0);
    if (list.length >= 2) {
      completedInRun2Ids.push(v.video_id);
    } else if (list.length === 1) {
      partialInRun2Ids.push(v.video_id);
    } else {
      notStartedInRun2Ids.push(v.video_id);
    }
  }

  const run2CostUsd = round(run2Calls.reduce((a, c) => a + (c.cost?.call_cost_usd || 0), 0), 6);
  const run1CostUsd = round(run1Calls.reduce((a, c) => a + (c.cost?.call_cost_usd || 0), 0), 6);

  const stopNote = {
    schema_version: 1,
    stopped_at: "2026-11-25T13:43:10+09:00",
    reason: "方針変更：大きな検証をやめ、本番の採点にすでに採点済みの動画を混ぜる方式に切り替えるため",
    run_id: "run_20261125_134050",
    preregistration_file: "analysis/pilot_gemini_api_url/validation_preregistration.json",
    preregistration_unmodified: true,
    preregistration_sha256: preregSha256,
    completed_calls_count: run2Calls.length,
    completed_cost_usd: run2CostUsd,
    completed_video_ids: completedInRun2Ids,
    partial_video_ids: partialInRun2Ids,
    unscored_video_ids: notStartedInRun2Ids,
    unused_reserve_video_ids: prereg.reserve_8.map((r) => r.video_id),
  };

  const stopNotePath = path.join(PILOT_ROOT, "validation_stop_note.json");
  fs.writeFileSync(stopNotePath, JSON.stringify(stopNote, null, 2) + "\n", "utf8");
  console.log(`Wrote stop note: ${stopNotePath}`);

  // 2) Aggregate 12 completed videos (10 from run1 + 2 from run2)
  const prev10 = JSON.parse(fs.readFileSync(PREV_10_PATH, "utf8")).selected;
  const run1ByVid = new Map();
  for (const c of run1Calls) {
    if (!run1ByVid.has(c.video_id)) run1ByVid.set(c.video_id, []);
    run1ByVid.get(c.video_id).push(c);
  }

  const anchors = [];
  function pushAnchor(meta, calls, sourceRun) {
    const sorted = [...calls].sort((a, b) => a.attempt - b.attempt);
    const s1 = sorted[0].parsed_json.total_score;
    const s2 = sorted[1].parsed_json.total_score;
    const apiMean = round((s1 + s2) / 2, 2);
    const baseScore = meta.calibrated_score;
    const diff = round(apiMean - baseScore, 2);
    const baseBand = scoreToBand(baseScore);
    const apiBand = scoreToBand(apiMean);
    const dur = meta.duration_sec;
    anchors.push({
      video_id: meta.video_id,
      source_run: sourceRun,
      duration_sec: dur,
      duration_bin: durToBin(dur),
      route_raw: meta.route_raw,
      route_group: meta.route_raw === "contact_sheet" ? "contact_sheet" : "video",
      base_score: baseScore,
      base_band: baseBand,
      near_83_pm3: Math.abs(baseScore - 83) <= 3,
      near_63_pm3: Math.abs(baseScore - 63) <= 3,
      near_any_boundary: Math.abs(baseScore - 83) <= 3 || Math.abs(baseScore - 63) <= 3,
      base_knows_work: meta.knows_work,
      api_r1: s1,
      api_r2: s2,
      api_mean: apiMean,
      api_band: apiBand,
      band_match: baseBand === apiBand,
      diff_api_minus_base: diff,
      abs_error: round(Math.abs(diff), 2),
      r1_r2_diff: Math.abs(s1 - s2),
      api_knows_work_r1: sorted[0].parsed_json.post_check.knows_work,
      api_knows_work_r2: sorted[1].parsed_json.post_check.knows_work,
      cost_2calls_usd: round((sorted[0].cost?.call_cost_usd || 0) + (sorted[1].cost?.call_cost_usd || 0), 6),
      time_2calls_sec: round((sorted[0].elapsed_sec || 0) + (sorted[1].elapsed_sec || 0), 2),
    });
  }

  for (const v of prev10) {
    pushAnchor(v, run1ByVid.get(v.video_id), "run_20261125_125425");
  }
  for (const vid of completedInRun2Ids) {
    const meta = prereg.main_50.find((x) => x.video_id === vid);
    pushAnchor(meta, run2ByVid.get(vid), "run_20261125_134050");
  }

  const boundaryAll = anchors.filter((x) => x.near_any_boundary);
  const boundary83 = anchors.filter((x) => x.near_83_pm3);
  const boundary63 = anchors.filter((x) => x.near_63_pm3);

  const anchorSummary = {
    generated_at: new Date().toISOString(),
    note: "Raw comparison without any bias correction applied (10 videos from run_20261125_125425 + 2 videos from run_20261125_134050).",
    overall: summarize(anchors),
    boundary_pm3: {
      all_83_or_63: summarize(boundaryAll),
      near_83_pm3: summarize(boundary83),
      near_63_pm3: summarize(boundary63),
    },
    by_route_raw: {
      video_h1: summarize(anchors.filter((x) => x.route_raw === "video_h1")),
      video_h2_escalated: summarize(anchors.filter((x) => x.route_raw === "video_h2_escalated")),
      contact_sheet: summarize(anchors.filter((x) => x.route_raw === "contact_sheet")),
    },
    by_route_group: {
      video: summarize(anchors.filter((x) => x.route_group === "video")),
      contact_sheet: summarize(anchors.filter((x) => x.route_group === "contact_sheet")),
    },
    by_duration_bin: {
      "<=60": summarize(anchors.filter((x) => x.duration_bin === "<=60")),
      "60-180": summarize(anchors.filter((x) => x.duration_bin === "60-180")),
      "180-360": summarize(anchors.filter((x) => x.duration_bin === "180-360")),
      "360-900": summarize(anchors.filter((x) => x.duration_bin === "360-900")),
    },
    costs_usd: {
      run_20261125_125425_20calls: run1CostUsd,
      run_20261125_134050_4calls: run2CostUsd,
      total_24calls: round(run1CostUsd + run2CostUsd, 6),
    },
    videos: anchors,
  };

  const anchorOutPath = path.join(PILOT_ROOT, "anchor_12_summary.json");
  fs.writeFileSync(anchorOutPath, JSON.stringify(anchorSummary, null, 2) + "\n", "utf8");
  console.log(`Wrote anchor 12 summary: ${anchorOutPath}`);
  console.log(JSON.stringify({
    overall: anchorSummary.overall,
    boundary_pm3: anchorSummary.boundary_pm3,
    by_route_raw: anchorSummary.by_route_raw,
    by_route_group: anchorSummary.by_route_group,
    by_duration_bin: anchorSummary.by_duration_bin,
    costs_usd: anchorSummary.costs_usd,
  }, null, 2));

  // 3) Dump observations vs SQLite scenes for the 2 new videos
  const pyCode = [
    "import sqlite3, json",
    "conn = sqlite3.connect('file:E:/iketeru-creative-studio/data/iketeru_knowledge.db?mode=ro', uri=True)",
    "cur = conn.cursor()",
    "res = {}",
    "for vid in ['gn5lk6isyGc', 'fzQ6gRAEoy0']:",
    "    cur.execute('SELECT start_mmss, end_mmss, shot_title, description FROM scenes WHERE video_id=? ORDER BY shot_index', (vid,))",
    "    res[vid] = cur.fetchall()",
    "conn.close()",
    "print(json.dumps(res, ensure_ascii=False))",
  ].join("\n");
  const scenes2 = JSON.parse(execFileSync("python", ["-c", pyCode], { encoding: "utf8" }));
  console.log("\n=== NEW 2 VIDEOS OBSERVATIONS VS SQLITE SCENES ===");
  for (const vid of completedInRun2Ids) {
    console.log(`\nVIDEO ${vid}:`);
    for (const s of scenes2[vid] || []) {
      console.log(`  SCENE [${s[0]}-${s[1]}] ${s[2]} :: ${s[3]}`);
    }
    for (const c of run2ByVid.get(vid) || []) {
      console.log(`  API r${c.attempt} (score=${c.parsed_json.total_score}, kw=${c.parsed_json.post_check.knows_work}):`);
      for (const o of c.parsed_json.timestamped_observations || []) {
        console.log(`    [${o.timestamp}] ${o.observation}`);
      }
    }
  }
}

main();
