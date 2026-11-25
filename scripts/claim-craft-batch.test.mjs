import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  VALID_CRAFT_POOLS,
  VALID_CRAFT_TASK_TYPES,
  defaultTaskTypeForPool,
  loadCraftClaims,
  selectCraftCandidates,
  validateCraftPool,
  validateCraftTaskType,
  verifyActiveCraftClaims,
} from "./claim-craft-batch.mjs";

test("claim-craft-batch validates task types, pools, and default task_type mapping", () => {
  assert.deepEqual(VALID_CRAFT_TASK_TYPES, ["craft_recipe_v2_upgrade", "craft_recipe_new", "craft_purpose_backfill"]);
  assert.deepEqual(VALID_CRAFT_POOLS, ["381_gt15s_ge78", "381_le15s_ge78", "new_138_ge78", "v2_ge78_missing_purpose", "custom"]);
  assert.equal(validateCraftTaskType("craft_recipe_v2_upgrade"), "craft_recipe_v2_upgrade");
  assert.equal(validateCraftTaskType("craft_purpose_backfill"), "craft_purpose_backfill");
  assert.equal(validateCraftPool("381_gt15s_ge78"), "381_gt15s_ge78");
  assert.equal(validateCraftPool("v2_ge78_missing_purpose"), "v2_ge78_missing_purpose");
  assert.equal(defaultTaskTypeForPool("new_138_ge78"), "craft_recipe_new");
  assert.equal(defaultTaskTypeForPool("v2_ge78_missing_purpose"), "craft_purpose_backfill");
  assert.equal(defaultTaskTypeForPool("381_gt15s_ge78"), "craft_recipe_v2_upgrade");
  assert.throws(() => validateCraftTaskType("unknown_type"));
  assert.throws(() => validateCraftPool("unknown_pool"));
});

test("claim-craft-batch isolates from phase3_calibration claims and detects overlaps across craft claims", () => {
  const td = fs.mkdtempSync(path.join(os.tmpdir(), "craft-claim-test-"));
  try {
    // Phase 3 claim without task_type -> must be ignored by loadCraftClaims
    fs.writeFileSync(
      path.join(td, "run_20261125_000001.json"),
      JSON.stringify({ run_id: "run_20261125_000001", status: "active", video_ids: ["v1", "v2"] }),
      "utf8"
    );
    // Two craft claims sharing v2 -> must detect overlap
    fs.writeFileSync(
      path.join(td, "craft_upg_20261125_000001.json"),
      JSON.stringify({ run_id: "craft_upg_20261125_000001", task_type: "craft_recipe_v2_upgrade", status: "active", video_ids: ["v1", "v2"] }),
      "utf8"
    );
    fs.writeFileSync(
      path.join(td, "craft_new_20261125_000002.json"),
      JSON.stringify({ run_id: "craft_new_20261125_000002", task_type: "craft_recipe_new", status: "active", video_ids: ["v2", "v3"] }),
      "utf8"
    );
    // Completed craft claim -> must NOT lock IDs
    fs.writeFileSync(
      path.join(td, "craft_upg_20261125_000003.json"),
      JSON.stringify({ run_id: "craft_upg_20261125_000003", task_type: "craft_recipe_v2_upgrade", status: "completed", video_ids: ["v1"] }),
      "utf8"
    );

    const claims = loadCraftClaims(td);
    assert.equal(claims.length, 3);
    const ver = verifyActiveCraftClaims(claims);
    assert.equal(ver.activeCount, 2);
    assert.equal(ver.overlaps.length, 1);
    assert.equal(ver.overlaps[0].video_id, "v2");
  } finally {
    fs.rmSync(td, { recursive: true, force: true });
  }
});

test("selectCraftCandidates excludes locked IDs and supports deterministic seeded ordering", () => {
  const cands = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];
  const owner = new Map([["b", "craft_upg_1"]]);
  const s1 = selectCraftCandidates({ candidates: cands, ownerById: owner, batchSize: 3, seed: "pilot_seed" });
  const s2 = selectCraftCandidates({ candidates: cands, ownerById: owner, batchSize: 3, seed: "pilot_seed" });
  assert.deepEqual(s1, s2);
  assert.equal(s1.length, 3);
  assert.ok(!s1.some((x) => x.id === "b"));
});
