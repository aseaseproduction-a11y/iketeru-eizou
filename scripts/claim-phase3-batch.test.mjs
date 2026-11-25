import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  VALID_PRIORITIES,
  validatePriority,
  selectClaimCandidates,
} from "./claim-phase3-batch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, "claim-phase3-batch.mjs");

const SAMPLE_ROWS = [
  // P1 YouTube (also in P0 list)
  {
    id: "yt_p1_mv",
    platform: "youtube",
    videoUrl: "https://www.youtube.com/watch?v=yt_p1_mv",
    genres: JSON.stringify([{ slug: "mv", name: "MV" }]),
    directions: JSON.stringify(["live-action"]),
    expressions: JSON.stringify([]),
    privateRating: "A",
    calibratedScore: null,
  },
  // P2 YouTube (verified 5 genres: CM, no privateRating)
  {
    id: "yt_p2_cm",
    platform: "youtube",
    videoUrl: "https://www.youtube.com/watch?v=yt_p2_cm",
    genres: JSON.stringify([{ slug: "web-cm", name: "Web CM" }]),
    directions: JSON.stringify(["live-action"]),
    expressions: JSON.stringify([]),
    privateRating: null,
    calibratedScore: null,
  },
  // P2 YouTube (branded-movie + secondary corporate -> verified)
  {
    id: "yt_p2_branded_corp",
    platform: "youtube",
    videoUrl: "https://www.youtube.com/watch?v=yt_p2_branded_corp",
    genres: JSON.stringify([{ slug: "branded-movie" }, { slug: "corporate" }]),
    directions: JSON.stringify(["motion-graphics"]),
    expressions: JSON.stringify([]),
    privateRating: null,
    calibratedScore: null,
  },
  // P3 YouTube (unverified genre: opening, no privateRating)
  {
    id: "yt_p3_opening",
    platform: "youtube",
    videoUrl: "https://www.youtube.com/watch?v=yt_p3_opening",
    genres: JSON.stringify([{ slug: "opening" }, { slug: "mv" }]),
    directions: JSON.stringify(["motion-graphics"]),
    expressions: JSON.stringify([]),
    privateRating: null,
    calibratedScore: null,
  },
  // P3 YouTube (pure branded-movie -> unverified)
  {
    id: "yt_p3_branded_pure",
    platform: "youtube",
    videoUrl: "https://www.youtube.com/watch?v=yt_p3_branded_pure",
    genres: JSON.stringify([{ slug: "branded-movie" }]),
    directions: JSON.stringify(["live-action"]),
    expressions: JSON.stringify([]),
    privateRating: null,
    calibratedScore: null,
  },
  // Already calibrated YouTube (must always be excluded)
  {
    id: "yt_already_cal",
    platform: "youtube",
    videoUrl: "https://www.youtube.com/watch?v=yt_already_cal",
    genres: JSON.stringify([{ slug: "mv" }]),
    directions: JSON.stringify([]),
    expressions: JSON.stringify([]),
    privateRating: null,
    calibratedScore: 78.5,
  },
  // Non-YouTube (Vimeo) P2
  {
    id: "vimeo_p2_mv",
    platform: "vimeo",
    videoUrl: "https://vimeo.com/123456",
    genres: JSON.stringify([{ slug: "mv" }]),
    directions: JSON.stringify([]),
    expressions: JSON.stringify([]),
    privateRating: null,
    calibratedScore: null,
  },
  // Non-YouTube (Vimeo) P3
  {
    id: "vimeo_p3_doc",
    platform: "vimeo",
    videoUrl: "https://vimeo.com/789012",
    genres: JSON.stringify([{ slug: "documentary" }]),
    directions: JSON.stringify([]),
    expressions: JSON.stringify([]),
    privateRating: null,
    calibratedScore: null,
  },
];

test("VALID_PRIORITIES contains exactly the 5 supported priority values", () => {
  assert.deepEqual(VALID_PRIORITIES, [
    "P0_craft_recipes",
    "P1_private_rating",
    "P2_verified_5_genres",
    "P3_unverified_genres",
    "ALL",
  ]);
  for (const p of VALID_PRIORITIES) {
    assert.equal(validatePriority(p), p);
  }
});

test("validatePriority rejects unknown or typo priority names", () => {
  for (const bad of ["P2_remaining", "P3_remaining", "P3_unverified_genre", "P4_other", ""]) {
    assert.throws(() => validatePriority(bad), /Invalid --priority/);
  }
});

test("P0_craft_recipes preserves target ID list order and filtering", () => {
  const got = selectClaimCandidates({
    rows: SAMPLE_ROWS,
    priority: "P0_craft_recipes",
    p0TargetIds: ["yt_p3_opening", "yt_p1_mv", "yt_already_cal", "vimeo_p2_mv"],
  });
  assert.deepEqual(got, ["yt_p3_opening", "yt_p1_mv"]);
});

test("P1_private_rating returns only rows with privateRating != null", () => {
  const got = selectClaimCandidates({
    rows: SAMPLE_ROWS,
    priority: "P1_private_rating",
  });
  assert.deepEqual(got, ["yt_p1_mv"]);
});

test("P2_verified_5_genres filters strictly by classifyVideoForCalibration priority_tier", () => {
  const gotYt = selectClaimCandidates({
    rows: SAMPLE_ROWS,
    priority: "P2_verified_5_genres",
  });
  assert.deepEqual(gotYt, ["yt_p2_cm", "yt_p2_branded_corp"]);

  const gotNonYt = selectClaimCandidates({
    rows: SAMPLE_ROWS,
    priority: "P2_verified_5_genres",
    nonYoutube: true,
  });
  assert.deepEqual(gotNonYt, ["vimeo_p2_mv"]);
});

test("P3_unverified_genres filters strictly by classifyVideoForCalibration priority_tier", () => {
  const gotYt = selectClaimCandidates({
    rows: SAMPLE_ROWS,
    priority: "P3_unverified_genres",
  });
  assert.deepEqual(gotYt, ["yt_p3_opening", "yt_p3_branded_pure"]);

  const gotNonYt = selectClaimCandidates({
    rows: SAMPLE_ROWS,
    priority: "P3_unverified_genres",
    nonYoutube: true,
  });
  assert.deepEqual(gotNonYt, ["vimeo_p3_doc"]);
});

test("ALL preserves unfiltered behavior across P1, P2, and P3", () => {
  const gotYt = selectClaimCandidates({
    rows: SAMPLE_ROWS,
    priority: "ALL",
  });
  assert.deepEqual(gotYt, [
    "yt_p1_mv",
    "yt_p2_cm",
    "yt_p2_branded_corp",
    "yt_p3_opening",
    "yt_p3_branded_pure",
  ]);

  const gotNonYt = selectClaimCandidates({
    rows: SAMPLE_ROWS,
    priority: "ALL",
    nonYoutube: true,
  });
  assert.deepEqual(gotNonYt, ["vimeo_p2_mv", "vimeo_p3_doc"]);
});

test("ownerById and excludedSkipIds exclude locked/skipped rows across priorities", () => {
  const got = selectClaimCandidates({
    rows: SAMPLE_ROWS,
    priority: "P2_verified_5_genres",
    ownerById: new Map([["yt_p2_cm", "run_other"]]),
  });
  assert.deepEqual(got, ["yt_p2_branded_corp"]);
});

test("CLI --claim rejects unknown priority names with non-zero exit code", () => {
  for (const bad of ["P2_remaining", "P3_remaining", "P3_unverified_genre"]) {
    let failed = false;
    let stderr = "";
    try {
      execFileSync(
        process.execPath,
        [SCRIPT_PATH, "--claim", "--worker", "test_worker", "--priority", bad, "--dry-run"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
      );
    } catch (err) {
      failed = true;
      stderr = String(err.stderr || "");
      assert.notEqual(err.status, 0);
    }
    assert.equal(failed, true, `Expected CLI to fail for --priority ${bad}`);
    assert.match(stderr, /Invalid --priority/);
  }
});
