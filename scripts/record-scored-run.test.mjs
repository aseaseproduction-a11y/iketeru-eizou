import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./record-scored-run.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, "record-scored-run.mjs");

test("parseArgs accepts YouTube video IDs starting with '--' (e.g., --41OGPMurU)", () => {
  const args = parseArgs([
    "node",
    "record-scored-run.mjs",
    "--run-id", "run_20261125_070347",
    "--video-id", "--41OGPMurU",
    "--mode", "video",
    "--attempt", "1",
    "--subagent-id", "a3c04f94-6e6a-4cf0-9d6f-17aee79454dd",
    "--parent-id", "8eb1cf89-a4ac-4890-ac1b-c8e9300f8edc",
  ]);
  assert.equal(args["video-id"], "--41OGPMurU");
  assert.equal(args["run-id"], "run_20261125_070347");
  assert.equal(args["mode"], "video");
  assert.equal(args["attempt"], "1");
  assert.equal(args["subagent-id"], "a3c04f94-6e6a-4cf0-9d6f-17aee79454dd");
  assert.equal(args["parent-id"], "8eb1cf89-a4ac-4890-ac1b-c8e9300f8edc");
});

test("parseArgs preserves standard argument behavior (normal IDs and boolean flags)", () => {
  const args = parseArgs([
    "node",
    "record-scored-run.mjs",
    "--run-id", "run_20261125_070347",
    "--video-id", "abc123XYZ",
    "--mode", "contact_sheet",
    "--attempt", "2",
    "--subagent-id", "sub-1",
    "--parent-id", "parent-1",
    "--dry-run",
  ]);
  assert.equal(args["run-id"], "run_20261125_070347");
  assert.equal(args["video-id"], "abc123XYZ");
  assert.equal(args["mode"], "contact_sheet");
  assert.equal(args["attempt"], "2");
  assert.equal(args["subagent-id"], "sub-1");
  assert.equal(args["parent-id"], "parent-1");
  assert.equal(args["dry-run"], true);
});

test("parseArgs throws when a VALUE_FLAGS option is missing its value", () => {
  // Missing value before next flag
  assert.throws(
    () => parseArgs(["node", "record-scored-run.mjs", "--mode", "--attempt", "1"]),
    /Missing value for --mode/
  );
  // Missing value for --video-id when followed by another known flag
  assert.throws(
    () => parseArgs(["node", "record-scored-run.mjs", "--video-id", "--mode", "video"]),
    /Missing value for --video-id/
  );
  // Missing value at end of argv
  assert.throws(
    () => parseArgs(["node", "record-scored-run.mjs", "--run-id", "run_20261125_070347", "--video-id"]),
    /Missing value for --video-id/
  );
  // Empty string value
  assert.throws(
    () => parseArgs(["node", "record-scored-run.mjs", "--run-id", ""]),
    /Missing value for --run-id/
  );
});

test("CLI exits non-zero when a VALUE_FLAGS option is missing its value", () => {
  let failed = false;
  let stderr = "";
  try {
    execFileSync(
      process.execPath,
      [SCRIPT_PATH, "--run-id", "run_20261125_070347", "--mode", "--attempt", "1"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch (err) {
    failed = true;
    stderr = String(err.stderr || "");
    assert.notEqual(err.status, 0);
  }
  assert.equal(failed, true);
  assert.match(stderr, /Missing value for --mode/);
});
