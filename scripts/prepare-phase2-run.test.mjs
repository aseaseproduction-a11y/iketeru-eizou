import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { validateSplitGuard, isBotCheckError, loadSplitItems } from "./prepare-phase2-run.mjs";

test("validateSplitGuard blocks holdout without explicit freeze confirmation and valid config", () => {
  assert.doesNotThrow(() => validateSplitGuard({ splitName: "dev" }));
  assert.throws(
    () => validateSplitGuard({ splitName: "holdout", confirmFrozenHoldout: false }),
    /BLOCKED/
  );
  assert.throws(
    () => validateSplitGuard({ splitName: "holdout", confirmFrozenHoldout: true, frozenConfigPath: "Z:\\nonexistent.json" }),
    /BLOCKED/
  );

  const tmpCfg = path.join(os.tmpdir(), `p2_cfg_${Date.now()}.json`);
  fs.writeFileSync(
    tmpCfg,
    JSON.stringify({ t_award: 78.0, t_low: 63.0, frozen_commit: "abc1234", expected_model: "gemini-4-neon-high" }),
    "utf8"
  );
  try {
    const cfg = validateSplitGuard({ splitName: "holdout", confirmFrozenHoldout: true, frozenConfigPath: tmpCfg });
    assert.equal(cfg.t_award, 78.0);
  } finally {
    fs.unlinkSync(tmpCfg);
  }
});

test("isBotCheckError detects YouTube bot check and 429 cleanly", () => {
  assert.equal(isBotCheckError("ERROR: Sign in to confirm you're not a bot"), true);
  assert.equal(isBotCheckError("HTTP Error 429: Too Many Requests"), true);
  assert.equal(isBotCheckError("Normal download succeeded"), false);
});

test("CLI --split dev --dry-run loads ONLY 31 Dev additions without touching Holdout", () => {
  const { items } = loadSplitItems("dev");
  assert.equal(items.length, 31);
  const out = execFileSync(
    process.execPath,
    ["scripts/prepare-phase2-run.mjs", "--split", "dev", "--dry-run", "--run-id", "run_20261123_080000"],
    { cwd: "E:\\iketeru-eizou", encoding: "utf8" }
  );
  assert.match(out, /total=31/);
  assert.match(out, /DRY-RUN/);
});
