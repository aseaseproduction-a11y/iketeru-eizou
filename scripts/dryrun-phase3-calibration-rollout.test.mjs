import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyVideoForCalibration,
  buildRolloutDryRunPlan,
  MAX_BATCH_SIZE,
  LEGACY_PROTECTED_COLUMNS,
} from "./dryrun-phase3-calibration-rollout.mjs";

test("classifyVideoForCalibration preserves legacy protection and conservatively flags unverified genres", () => {
  // Unverified genre (opening) tagged with motion-graphics MUST remain unverified!
  const openingWithMotion = classifyVideoForCalibration({
    id: "v1",
    platform: "youtube",
    genres: JSON.stringify([{ slug: "opening", name: "オープニング映像" }]),
    directions: JSON.stringify([{ slug: "motion-graphics", name: "モーショングラフィックス" }]),
    expressions: JSON.stringify(["2D"]),
    privateRating: "",
    aiOverallScore: 84,
    aiOverallRating: "A",
    embedStatus: "available",
  });
  assert.equal(openingWithMotion.genre_verified, false);
  assert.equal(openingWithMotion.calibration_genre_bucket, "unverified:opening");
  assert.equal(openingWithMotion.target_status_after_calibration, "calibrated_unverified_genre");
  assert.equal(openingWithMotion.priority_tier, "P3_unverified_genres");
  assert.equal(openingWithMotion.initial_calibration_status, "legacy_uncalibrated");

  // Private-rated video in an unverified genre goes to P1, but STILL gets calibrated_unverified_genre!
  const privateRatedFilm = classifyVideoForCalibration({
    id: "v2",
    platform: "vimeo",
    genres: JSON.stringify([{ slug: "film", name: "映画 / ドラマ / ショートフィルム" }]),
    directions: JSON.stringify(["実写"]),
    expressions: JSON.stringify(["実写"]),
    privateRating: "S",
    aiOverallScore: null,
    aiOverallRating: "A+",
    embedStatus: "available",
  });
  assert.equal(privateRatedFilm.priority_tier, "P1_private_rating");
  assert.equal(privateRatedFilm.genre_verified, false);
  assert.equal(privateRatedFilm.target_status_after_calibration, "calibrated_unverified_genre");
  assert.equal(privateRatedFilm.initial_calibration_status, "legacy_uncalibrated");

  // Verified CM video without privateRating goes to P2 and calibrated_verified
  const verifiedCm = classifyVideoForCalibration({
    id: "v3",
    platform: "youtube",
    genres: JSON.stringify(["web-cm"]),
    directions: JSON.stringify(["live-action"]),
    expressions: JSON.stringify(["実写"]),
    privateRating: null,
    aiOverallScore: null,
    aiOverallRating: null,
    embedStatus: "available",
  });
  assert.equal(verifiedCm.priority_tier, "P2_verified_5_genres");
  assert.equal(verifiedCm.genre_verified, true);
  assert.equal(verifiedCm.calibration_genre_bucket, "CM");
  assert.equal(verifiedCm.target_status_after_calibration, "calibrated_verified");
  assert.equal(verifiedCm.initial_calibration_status, "unscored");

  // Pure branded-movie (no cm/corporate secondary tag) stays conservatively unverified
  const pureBranded = classifyVideoForCalibration({
    id: "v4",
    platform: "vimeo",
    genres: JSON.stringify(["branded-movie"]),
    directions: JSON.stringify(["live-action"]),
    expressions: JSON.stringify(["実写"]),
    privateRating: "",
    aiOverallScore: 80,
    aiOverallRating: "A-",
    embedStatus: "available",
  });
  assert.equal(pureBranded.genre_verified, false);
  assert.equal(pureBranded.calibration_genre_bucket, "unverified:branded-movie");
  assert.equal(pureBranded.priority_tier, "P3_unverified_genres");
});

test("buildRolloutDryRunPlan partitions rows with exact totals, zero legacy overwrite, and <=200 batch limit", () => {
  const sampleRows = [];
  for (let i = 0; i < 450; i++) {
    sampleRows.push({
      id: `p1_${i}`,
      platform: "vimeo",
      genres: JSON.stringify(["mv"]),
      directions: JSON.stringify(["live-action"]),
      expressions: JSON.stringify(["実写"]),
      privateRating: "A",
      aiOverallScore: 80,
      aiOverallRating: "A-",
      embedStatus: "available",
    });
  }
  for (let i = 0; i < 50; i++) {
    sampleRows.push({
      id: `p2_${i}`,
      platform: "youtube",
      genres: JSON.stringify(["corporate"]),
      directions: JSON.stringify(["motion-graphics"]),
      expressions: JSON.stringify(["2D"]),
      privateRating: "",
      aiOverallScore: null,
      aiOverallRating: "B+",
      embedStatus: "unknown",
    });
  }
  for (let i = 0; i < 20; i++) {
    sampleRows.push({
      id: `p3_${i}`,
      platform: "youtube",
      genres: JSON.stringify(["youtube-sns"]),
      directions: JSON.stringify([]),
      expressions: JSON.stringify([]),
      privateRating: "",
      aiOverallScore: null,
      aiOverallRating: "",
      embedStatus: "restricted",
    });
  }

  const plan = buildRolloutDryRunPlan(sampleRows);
  assert.equal(plan.totals_check.exact_match, true);
  assert.equal(plan.totals_check.total_rows, 520);
  assert.equal(plan.migration_d_tidb.legacy_protected_columns_overwritten, 0);
  assert.ok(LEGACY_PROTECTED_COLUMNS.includes("aiOverallScore"));
  assert.ok(LEGACY_PROTECTED_COLUMNS.includes("aiScoreBreakdown"));
  assert.equal(plan.migration_d_tidb.backfill_set_legacy_uncalibrated, 500);
  assert.equal(plan.migration_d_tidb.backfill_set_unscored, 20);
  assert.deepEqual(plan.rescore_c_priorities.P1_private_rating.batch_sizes, [200, 200, 50]);
  assert.ok(
    plan.rescore_c_priorities.P1_private_rating.batch_sizes.every((s) => s <= MAX_BATCH_SIZE)
  );
  assert.equal(plan.rescore_c_priorities.P2_verified_5_genres.by_calibration_genre_bucket["モーション"], 50);
  assert.equal(plan.rescore_c_priorities.P3_unverified_genres.likely_fetch_blocked_or_unsupported, 20);
});
