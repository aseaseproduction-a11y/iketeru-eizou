import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderCalibrationPrompt } from "./lib/calibration-prompt-template.mjs";
import { parseArgs, verifyDispatchedPrompt } from "./verify-dispatched-prompt.mjs";

const SAMPLE_SPEC = {
  version: "v1_baseline",
  runId: "run_20261125_070347",
  blindId: "00fe3cedf610",
  mode: "video",
  assignedFiles: [
    "E:\\iketeru_blind_eval\\run_20261125_070347\\video\\00fe3cedf610\\00fe3cedf610.mp4",
  ],
  metrics: {
    duration_sec: 30.0,
    scdet_threshold: 10,
    total_cuts: 10,
    avg_cut_interval_sec: 3.0,
    max_cuts_per_10s: 4,
    integrated_lufs: -14.0,
    slowmo_applied: false,
    slowmo_factor: null,
    slowmo_window_sec: null,
  },
};

function makeWrappedStep(promptBody) {
  return JSON.stringify({
    step_index: 0,
    source: "SYSTEM",
    type: "SYSTEM_MESSAGE",
    status: "DONE",
    content:
      "The following is a <SYSTEM_MESSAGE>\n\n<SYSTEM_MESSAGE>\n" +
      `[Message] timestamp=2026-11-25T00:00:00Z sender=parent priority=MESSAGE_PRIORITY_HIGH content=${promptBody}\n` +
      "</SYSTEM_MESSAGE>",
  });
}

test("verifyDispatchedPrompt passes on exact match without waiting for scoring completion", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vdp-ok-"));
  try {
    const tp = path.join(tmpDir, "transcript.jsonl");
    const exactPrompt = renderCalibrationPrompt(SAMPLE_SPEC);
    // Only step 0 exists (subagent just started, has not finished scoring)
    fs.writeFileSync(tp, makeWrappedStep(exactPrompt) + "\n", "utf8");

    const res = verifyDispatchedPrompt({ spec: SAMPLE_SPEC, transcriptPath: tp });
    assert.equal(res.ok, true);
    assert.equal(res.reason, null);
    assert.equal(res.first_diff_index, null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("verifyDispatchedPrompt immediately catches 1-char missing blank line after header", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vdp-bad-"));
  try {
    const tp = path.join(tmpDir, "transcript.jsonl");
    const exactPrompt = renderCalibrationPrompt(SAMPLE_SPEC);
    const brokenPrompt = exactPrompt.replace("]\n\nあなたは", "]\nあなたは");
    assert.notEqual(brokenPrompt, exactPrompt);
    fs.writeFileSync(tp, makeWrappedStep(brokenPrompt) + "\n", "utf8");

    const res = verifyDispatchedPrompt({ spec: SAMPLE_SPEC, transcriptPath: tp });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "prompt_exact_match_mismatch");
    assert.equal(res.expected_length - res.actual_length, 1);
    assert.equal(typeof res.first_diff_index, "number");
    assert.ok(res.actual_snippet.includes("]\nあなたは"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("verifyDispatchedPrompt parseArgs supports --video-id starting with '--' and rejects missing values", () => {
  const ok = parseArgs([
    "node", "verify-dispatched-prompt.mjs",
    "--run-id", "run_20261125_070347",
    "--video-id", "--41OGPMurU",
    "--mode", "video",
    "--subagent-id", "sub-1",
  ]);
  assert.equal(ok["video-id"], "--41OGPMurU");

  assert.throws(
    () => parseArgs(["node", "verify-dispatched-prompt.mjs", "--run-id", "--mode", "video"]),
    /Missing value for --run-id/
  );
});
