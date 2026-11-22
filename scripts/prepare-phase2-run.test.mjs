import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { validateSplitGuard, isBotCheckError, loadSplitItems } from "./prepare-phase2-run.mjs";

test("validateSplitGuard enforces git-committed frozen-config and real frozen_commit for holdout", () => {
  assert.doesNotThrow(() => validateSplitGuard({ splitName: "dev" }));
  assert.throws(
    () => validateSplitGuard({ splitName: "holdout", confirmFrozenHoldout: false }),
    /BLOCKED/
  );
  assert.throws(
    () => validateSplitGuard({ splitName: "holdout", confirmFrozenHoldout: true, frozenConfigPath: "Z:\\nonexistent.json" }),
    /BLOCKED/
  );

  // Create an isolated temporary git repository to test all git-lock conditions
  const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "p2_holdout_lock_test_"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: tmpRepo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

  try {
    git("init");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test User");
    git("config", "core.autocrlf", "false");

    const seedPath = path.join(tmpRepo, "seed.txt");
    fs.writeFileSync(seedPath, "seed\n", "utf8");
    git("add", "seed.txt");
    git("commit", "-m", "initial commit");
    const realCommit = git("rev-parse", "HEAD");

    const cfgPath = path.join(tmpRepo, "frozen_config.json");

    // 1. Uncommitted file -> BLOCKED
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({ t_award: 79, t_low: 62, frozen_commit: realCommit, expected_model: "gemini-4-neon-high" }) + "\n",
      "utf8"
    );
    assert.throws(
      () => validateSplitGuard({ splitName: "holdout", confirmFrozenHoldout: true, frozenConfigPath: cfgPath, repoRoot: tmpRepo }),
      /BLOCKED:.*not committed/
    );

    // 2. Committed file with non-existent frozen_commit -> BLOCKED
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({ t_award: 79, t_low: 62, frozen_commit: "deadbeef1234", expected_model: "gemini-4-neon-high" }) + "\n",
      "utf8"
    );
    git("add", "frozen_config.json");
    git("commit", "-m", "bad commit ref");
    assert.throws(
      () => validateSplitGuard({ splitName: "holdout", confirmFrozenHoldout: true, frozenConfigPath: cfgPath, repoRoot: tmpRepo }),
      /BLOCKED:.*does not exist/
    );

    // 3. Committed file with real frozen_commit -> PASSES
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({ t_award: 79, t_low: 62, frozen_commit: realCommit, expected_model: "gemini-4-neon-high" }) + "\n",
      "utf8"
    );
    git("add", "frozen_config.json");
    git("commit", "-m", "valid frozen config");
    const verified = validateSplitGuard({
      splitName: "holdout",
      confirmFrozenHoldout: true,
      frozenConfigPath: cfgPath,
      repoRoot: tmpRepo,
    });
    assert.equal(verified.t_award, 79);
    assert.equal(verified._verified_frozen_commit_full, realCommit);

    // 4. Dirty working tree edit after commit -> BLOCKED
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({ t_award: 80, t_low: 62, frozen_commit: realCommit, expected_model: "gemini-4-neon-high" }) + "\n",
      "utf8"
    );
    assert.throws(
      () => validateSplitGuard({ splitName: "holdout", confirmFrozenHoldout: true, frozenConfigPath: cfgPath, repoRoot: tmpRepo }),
      /BLOCKED:.*differ from git HEAD/
    );
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
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
