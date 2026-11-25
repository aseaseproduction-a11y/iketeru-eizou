import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { auditTranscript, parseArgs, sha256File } from "./audit-blind-transcript.mjs";
import { generateBlindIdMap, saveBlindIdMap } from "./lib/blind-id-map.mjs";
import { renderCalibrationPrompt } from "./lib/calibration-prompt-template.mjs";

const PARENT_ID = "8eb1cf89-a4ac-4890-ac1b-c8e9300f8edc";
const RUN_ID = "run_20261122_190000";
const VIDEO_A = "vRBVWCs1KW4";
const VIDEO_B = "tvTRZJ-4EyI";
const BLIND_A = "a1b2c3d4e5f6";
const BLIND_B = "0987654321ab";
const SCRIPT_PATH = "E:\\iketeru-eizou\\scripts\\audit-blind-transcript.mjs";

const SAMPLE_BLIND_MAP = {
  run_id: RUN_ID,
  created_at: "2026-11-22T10:00:00.000Z",
  blind_id_format: "^[a-f0-9]{12}$",
  count: 2,
  video_to_blind: {
    [VIDEO_A]: BLIND_A,
    [VIDEO_B]: BLIND_B,
  },
  blind_to_video: {
    [BLIND_A]: VIDEO_A,
    [BLIND_B]: VIDEO_B,
  },
};

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "iketeru-audit-test-"));
}

function writeJsonl(filePath, lines) {
  fs.writeFileSync(filePath, lines.map(o => JSON.stringify(o)).join("\n") + "\n", "utf8");
}

function wrapSystemMessage(payload) {
  return `The following is a <SYSTEM_MESSAGE> not actually sent by the user.\n\n<SYSTEM_MESSAGE>\n[Message] timestamp=2026-11-22T10:00:00Z sender=${PARENT_ID} priority=MESSAGE_PRIORITY_HIGH content=${payload}\n</SYSTEM_MESSAGE>`;
}

function baseVideoSpec({ runId = RUN_ID, blindId = BLIND_A, assignedFiles, slowmo = false }) {
  return {
    version: "v1_baseline",
    runId,
    blindId,
    mode: "video",
    assignedFiles,
    metrics: {
      duration_sec: 120.5,
      scdet_threshold: 10,
      total_cuts: slowmo ? 42 : 12,
      avg_cut_interval_sec: slowmo ? 2.87 : 10.04,
      max_cuts_per_10s: slowmo ? 8 : 3,
      integrated_lufs: -14.2,
      slowmo_applied: slowmo,
      slowmo_factor: slowmo ? "2x" : null,
      slowmo_window_sec: slowmo ? [30, 40] : null,
    },
  };
}

/**
 * Helper to create real temp blind_id_map.json, staged dummy files (resolved via stagedFilePathResolver),
 * and matching run_manifest.json with genuine SHA-256 hashes.
 */
function setupManifestFixture(dir, { videoId = VIDEO_A, blindId = BLIND_A, mode = "video", assignedFiles, mapObj = SAMPLE_BLIND_MAP }) {
  const mapPath = path.join(dir, "blind_id_map.json");
  fs.writeFileSync(mapPath, JSON.stringify(mapObj, null, 2) + "\n", "utf8");
  const mapSha = sha256File(mapPath);

  const diskFiles = new Map();
  const stagedEntries = [];
  for (let i = 0; i < assignedFiles.length; i++) {
    const virtualPath = assignedFiles[i];
    const realFile = path.join(dir, `staged_${i}_${path.win32.basename(virtualPath)}`);
    fs.writeFileSync(realFile, `mock-binary-content-${videoId}-${blindId}-${i}`, "utf8");
    diskFiles.set(virtualPath, realFile);
    stagedEntries.push({
      path: virtualPath,
      sha256: sha256File(realFile),
      size_bytes: fs.statSync(realFile).size,
    });
  }

  const manifestObj = {
    run_id: mapObj.run_id,
    created_at: "2026-11-22T10:00:00.000Z",
    blind_id_map_sha256: mapSha,
    items: {
      [videoId]: {
        video_id: videoId,
        blind_id: blindId,
        source_sha256: crypto.createHash("sha256").update(`raw-source-${videoId}`).digest("hex"),
        staged_files: {
          [mode]: stagedEntries,
        },
      },
    },
  };
  const manifestPath = path.join(dir, "run_manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifestObj, null, 2) + "\n", "utf8");

  return {
    mapPath,
    manifestPath,
    manifestObj,
    diskFiles,
    stagedFilePathResolver: p => diskFiles.get(p) || p,
  };
}

test("1. Valid strict run (single video + opaque blind_id + exact frozen prompt + manifest SHA-256 + video/mp4 media)", () => {
  const dir = makeTempDir();
  try {
    const file1 = `E:\\iketeru_blind_eval\\${RUN_ID}\\video\\${BLIND_A}\\${BLIND_A}.mp4`;
    const spec = baseVideoSpec({ assignedFiles: [file1], slowmo: false });
    const prompt = renderCalibrationPrompt(spec);
    assert.ok(!prompt.includes(VIDEO_A), "original video ID must never appear in rendered prompt");
    const fx = setupManifestFixture(dir, { assignedFiles: [file1] });
    const tPath = path.join(dir, "transcript.jsonl");
    writeJsonl(tPath, [
      { step_index: 0, source: "SYSTEM", type: "SYSTEM_MESSAGE", status: "DONE", content: wrapSystemMessage(prompt) },
      { step_index: 1, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", model: "gemini-4-neon-high", input_tokens: 5000, output_tokens: 100, tool_calls: [{ name: "read_file", args: { Path: JSON.stringify(file1) } }] },
      { step_index: 2, source: "MODEL", type: "GENERIC", status: "DONE", content: "Showing binary file of type video/mp4", media: [{ mime_type: "video/mp4", uri: "file:///media/step_2_media_0.mp4" }] },
      { step_index: 3, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", model: "gemini-4-neon-high", input_tokens: 18420, output_tokens: 450, tool_calls: [{ name: "send_message", args: { Recipient: JSON.stringify(PARENT_ID), Message: JSON.stringify("{}") } }] },
    ]);

    const res = auditTranscript({
      transcriptPath: tPath,
      videoId: VIDEO_A,
      allowedFilesRaw: [file1],
      parentId: PARENT_ID,
      promptSpecObj: spec,
      blindMapPath: fx.mapPath,
      runManifestPath: fx.manifestPath,
      stagedFilePathResolver: fx.stagedFilePathResolver,
      strict: true,
    });
    assert.equal(res.valid, true);
    assert.equal(res.expected_blind_id, BLIND_A);
    assert.equal(res.verified_manifest_hashes.blind_id_map_sha256_verified, true);
    assert.ok(res.verified_manifest_hashes.staged_file_hashes_verified[file1.toLowerCase()]);
    assert.equal(res.token_usage.first_post_read_input_tokens, 18420);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("2. Valid strict multi-file run (main video + 2x slowmo, both paired with video/mp4 media and manifest hashes)", () => {
  const dir = makeTempDir();
  try {
    const file1 = `E:\\iketeru_blind_eval\\${RUN_ID}\\video\\${BLIND_A}\\${BLIND_A}.mp4`;
    const file2 = `E:\\iketeru_blind_eval\\${RUN_ID}\\video\\${BLIND_A}\\${BLIND_A}_slow.mp4`;
    const spec = baseVideoSpec({ assignedFiles: [file1, file2], slowmo: true });
    const prompt = renderCalibrationPrompt(spec);
    const fx = setupManifestFixture(dir, { assignedFiles: [file1, file2] });
    const tPath = path.join(dir, "transcript.jsonl");
    writeJsonl(tPath, [
      { step_index: 0, source: "SYSTEM", type: "SYSTEM_MESSAGE", status: "DONE", content: wrapSystemMessage(prompt) },
      {
        step_index: 1,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        input_tokens: 5200,
        output_tokens: 120,
        tool_calls: [
          { name: "read_file", args: { Path: JSON.stringify(file1) } },
          { name: "read_file", args: { Path: JSON.stringify(file2) } },
        ],
      },
      { step_index: 2, source: "MODEL", type: "GENERIC", status: "DONE", media: [{ mime_type: "video/mp4", uri: "file:///m0.mp4" }] },
      { step_index: 3, source: "MODEL", type: "GENERIC", status: "DONE", media: [{ mime_type: "video/mp4", uri: "file:///m1.mp4" }] },
      { step_index: 4, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", input_tokens: 22100, output_tokens: 500, tool_calls: [{ name: "send_message", args: { Recipient: JSON.stringify(PARENT_ID), Message: JSON.stringify("{}") } }] },
    ]);

    const res = auditTranscript({
      transcriptPath: tPath,
      videoId: VIDEO_A,
      allowedFilesRaw: [file1, file2],
      parentId: PARENT_ID,
      promptSpecObj: spec,
      blindMapPath: fx.mapPath,
      runManifestPath: fx.manifestPath,
      stagedFilePathResolver: fx.stagedFilePathResolver,
      strict: true,
    });
    assert.equal(res.valid, true);
    assert.deepEqual(res.missing_media_files, []);
    assert.equal(res.verified_media_by_file[file1.toLowerCase()], "video/mp4");
    assert.equal(res.verified_media_by_file[file2.toLowerCase()], "video/mp4");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("3. Injecting rank string + unlisted award name ('This is an S+ work (Palme d'Or)') fails BOTH exact-match AND defense-in-depth", () => {
  const dir = makeTempDir();
  try {
    const file1 = `E:\\iketeru_blind_eval\\${RUN_ID}\\video\\${BLIND_A}\\${BLIND_A}.mp4`;
    const spec = baseVideoSpec({ assignedFiles: [file1], slowmo: false });
    const fx = setupManifestFixture(dir, { assignedFiles: [file1] });
    const leakedPrompt = renderCalibrationPrompt(spec) + "\nThis is an S+ work (Palme d'Or)";
    const tPath = path.join(dir, "transcript.jsonl");
    writeJsonl(tPath, [
      { step_index: 0, source: "SYSTEM", type: "SYSTEM_MESSAGE", status: "DONE", content: wrapSystemMessage(leakedPrompt) },
      { step_index: 1, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "read_file", args: { Path: JSON.stringify(file1) } }] },
      { step_index: 2, source: "MODEL", type: "GENERIC", status: "DONE", media: [{ mime_type: "video/mp4", uri: "file:///m0.mp4" }] },
      { step_index: 3, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "send_message", args: { Recipient: JSON.stringify(PARENT_ID), Message: JSON.stringify("{}") } }] },
    ]);

    const resStrict = auditTranscript({
      transcriptPath: tPath,
      videoId: VIDEO_A,
      allowedFilesRaw: [file1],
      parentId: PARENT_ID,
      promptSpecObj: spec,
      blindMapPath: fx.mapPath,
      runManifestPath: fx.manifestPath,
      stagedFilePathResolver: fx.stagedFilePathResolver,
      strict: true,
    });
    assert.equal(resStrict.valid, false);
    assert.ok(resStrict.prompt_exact_match_violations.some(v => v.reason === "prompt_exact_match_mismatch"));

    const tRawPath = path.join(dir, "transcript_raw.jsonl");
    writeJsonl(tRawPath, [
      { step_index: 0, source: "SYSTEM", type: "SYSTEM_MESSAGE", status: "DONE", content: wrapSystemMessage("This is an S+ work (Palme d'Or)") },
      { step_index: 1, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "read_file", args: { Path: JSON.stringify(file1) } }] },
      { step_index: 2, source: "MODEL", type: "GENERIC", status: "DONE", media: [{ mime_type: "video/mp4", uri: "file:///m0.mp4" }] },
      { step_index: 3, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "send_message", args: { Recipient: JSON.stringify(PARENT_ID), Message: JSON.stringify("{}") } }] },
    ]);
    const resFallback = auditTranscript({
      transcriptPath: tRawPath,
      videoId: VIDEO_A,
      allowedFilesRaw: [file1],
      parentId: PARENT_ID,
      blindMapObj: SAMPLE_BLIND_MAP,
      strict: false,
    });
    assert.equal(resFallback.valid, false);
    assert.ok(resFallback.prompt_leak_violations.some(v => v.rule === "rank_plus_minus"));
    assert.ok(resFallback.prompt_leak_violations.some(v => v.rule === "award_keyword_en"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("4. Omitting --parent-id, --blind-map, or --run-manifest under --strict MUST fail (API + CLI exit code 1)", () => {
  const dir = makeTempDir();
  try {
    const file1 = `E:\\iketeru_blind_eval\\${RUN_ID}\\video\\${BLIND_A}\\${BLIND_A}.mp4`;
    const spec = baseVideoSpec({ assignedFiles: [file1], slowmo: false });
    const prompt = renderCalibrationPrompt(spec);
    const fx = setupManifestFixture(dir, { assignedFiles: [file1] });
    const tPath = path.join(dir, "transcript.jsonl");
    const specPath = path.join(dir, "spec.json");
    fs.writeFileSync(specPath, JSON.stringify(spec), "utf8");
    writeJsonl(tPath, [
      { step_index: 0, source: "SYSTEM", type: "SYSTEM_MESSAGE", status: "DONE", content: wrapSystemMessage(prompt) },
      { step_index: 1, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "read_file", args: { Path: JSON.stringify(file1) } }] },
      { step_index: 2, source: "MODEL", type: "GENERIC", status: "DONE", media: [{ mime_type: "video/mp4", uri: "file:///m0.mp4" }] },
      { step_index: 3, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "send_message", args: { Recipient: JSON.stringify("someone-else"), Message: JSON.stringify("{}") } }] },
    ]);

    let threw = false;
    try {
      execFileSync(process.execPath, [
        SCRIPT_PATH,
        "--transcript", tPath,
        "--video-id", VIDEO_A,
        "--allowed-files", file1,
        "--prompt-spec", specPath,
        "--blind-map", fx.mapPath,
        "--run-manifest", fx.manifestPath,
        "--strict",
      ], { encoding: "utf8" });
    } catch (err) {
      threw = true;
      assert.equal(err.status, 1);
      const parsed = JSON.parse(err.stdout);
      assert.equal(parsed.valid, false);
      assert.ok(parsed.config_violations.includes("strict_mode_requires_parent_id"));
    }
    assert.equal(threw, true);

    const resNoManifest = auditTranscript({
      transcriptPath: tPath,
      videoId: VIDEO_A,
      allowedFilesRaw: [file1],
      parentId: PARENT_ID,
      promptSpecObj: spec,
      blindMapPath: fx.mapPath,
      strict: true,
    });
    assert.equal(resNoManifest.valid, false);
    assert.ok(resNoManifest.config_violations.includes("strict_mode_requires_run_manifest"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("5. Multi-file assignment where only 1 of 2 files has media MUST fail", () => {
  const dir = makeTempDir();
  try {
    const file1 = `E:\\iketeru_blind_eval\\${RUN_ID}\\video\\${BLIND_A}\\${BLIND_A}.mp4`;
    const file2 = `E:\\iketeru_blind_eval\\${RUN_ID}\\video\\${BLIND_A}\\${BLIND_A}_slow.mp4`;
    const spec = baseVideoSpec({ assignedFiles: [file1, file2], slowmo: true });
    const prompt = renderCalibrationPrompt(spec);
    const fx = setupManifestFixture(dir, { assignedFiles: [file1, file2] });
    const tPath = path.join(dir, "transcript.jsonl");
    writeJsonl(tPath, [
      { step_index: 0, source: "SYSTEM", type: "SYSTEM_MESSAGE", status: "DONE", content: wrapSystemMessage(prompt) },
      {
        step_index: 1,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        tool_calls: [
          { name: "read_file", args: { Path: JSON.stringify(file1) } },
          { name: "read_file", args: { Path: JSON.stringify(file2) } },
        ],
      },
      { step_index: 2, source: "MODEL", type: "GENERIC", status: "DONE", media: [{ mime_type: "video/mp4", uri: "file:///m0.mp4" }] },
      { step_index: 3, source: "MODEL", type: "GENERIC", status: "ERROR", content: "File read error" },
      { step_index: 4, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "send_message", args: { Recipient: JSON.stringify(PARENT_ID), Message: JSON.stringify("{}") } }] },
    ]);

    const res = auditTranscript({
      transcriptPath: tPath,
      videoId: VIDEO_A,
      allowedFilesRaw: [file1, file2],
      parentId: PARENT_ID,
      promptSpecObj: spec,
      blindMapPath: fx.mapPath,
      runManifestPath: fx.manifestPath,
      stagedFilePathResolver: fx.stagedFilePathResolver,
      strict: true,
    });
    assert.equal(res.valid, false);
    assert.deepEqual(res.missing_media_files, [file2.toLowerCase()]);
    assert.equal(res.media_violations.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("6. Contact-sheet multi-file run verifies image/jpeg media per file and manifest hashes", () => {
  const dir = makeTempDir();
  try {
    const f1 = `E:\\iketeru_blind_eval\\${RUN_ID}\\contact_sheet\\${BLIND_A}\\${BLIND_A}_sheet_01.jpg`;
    const f2 = `E:\\iketeru_blind_eval\\${RUN_ID}\\contact_sheet\\${BLIND_A}\\${BLIND_A}_sheet_dense.jpg`;
    const spec = {
      version: "v1_baseline",
      runId: RUN_ID,
      blindId: BLIND_A,
      mode: "contact_sheet",
      assignedFiles: [f1, f2],
      metrics: {
        duration_sec: 90,
        scdet_threshold: 10,
        total_cuts: 30,
        avg_cut_interval_sec: 3.0,
        max_cuts_per_10s: 7,
        integrated_lufs: -15.0,
        slowmo_applied: true,
        slowmo_factor: "2x",
        slowmo_window_sec: [20, 30],
      },
    };
    const prompt = renderCalibrationPrompt(spec);
    const fx = setupManifestFixture(dir, { mode: "contact_sheet", assignedFiles: [f1, f2] });
    const tOk = path.join(dir, "ok.jsonl");
    writeJsonl(tOk, [
      { step_index: 0, source: "SYSTEM", type: "SYSTEM_MESSAGE", status: "DONE", content: wrapSystemMessage(prompt) },
      { step_index: 1, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "read_file", args: { Path: JSON.stringify(f1) } }] },
      { step_index: 2, source: "MODEL", type: "GENERIC", status: "DONE", media: [{ mime_type: "image/jpeg", uri: "file:///i1.jpg" }] },
      { step_index: 3, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "read_file", args: { Path: JSON.stringify(f2) } }] },
      { step_index: 4, source: "MODEL", type: "GENERIC", status: "DONE", media: [{ mime_type: "image/jpeg", uri: "file:///i2.jpg" }] },
      { step_index: 5, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "send_message", args: { Recipient: JSON.stringify(PARENT_ID), Message: JSON.stringify("{}") } }] },
    ]);
    const okRes = auditTranscript({
      transcriptPath: tOk,
      videoId: VIDEO_A,
      allowedFilesRaw: [f1, f2],
      parentId: PARENT_ID,
      promptSpecObj: spec,
      blindMapPath: fx.mapPath,
      runManifestPath: fx.manifestPath,
      stagedFilePathResolver: fx.stagedFilePathResolver,
      strict: true,
    });
    assert.equal(okRes.valid, true);
    assert.equal(okRes.verified_media_by_file[f1.toLowerCase()], "image/jpeg");
    assert.equal(okRes.verified_media_by_file[f2.toLowerCase()], "image/jpeg");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("7. Rank-containing run_id ('tier_S_plus_gold') is rejected by BOTH template renderer AND auditor", () => {
  const dir = makeTempDir();
  try {
    const badFile = `E:\\iketeru_blind_eval\\tier_S_plus_gold\\video\\${BLIND_A}\\${BLIND_A}.mp4`;
    const badSpec = baseVideoSpec({ runId: "tier_S_plus_gold", blindId: BLIND_A, assignedFiles: [badFile] });
    assert.throws(() => renderCalibrationPrompt(badSpec), /Invalid runId/);

    const tPath = path.join(dir, "bad_runid.jsonl");
    writeJsonl(tPath, [
      { step_index: 0, source: "SYSTEM", type: "SYSTEM_MESSAGE", status: "DONE", content: wrapSystemMessage("score file") },
      { step_index: 1, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "read_file", args: { Path: JSON.stringify(badFile) } }] },
      { step_index: 2, source: "MODEL", type: "GENERIC", status: "DONE", media: [{ mime_type: "video/mp4", uri: "file:///m0.mp4" }] },
      { step_index: 3, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "send_message", args: { Recipient: JSON.stringify(PARENT_ID), Message: JSON.stringify("{}") } }] },
    ]);
    const res = auditTranscript({
      transcriptPath: tPath,
      videoId: VIDEO_A,
      allowedFilesRaw: [badFile],
      parentId: PARENT_ID,
      promptSpecObj: badSpec,
      blindMapObj: SAMPLE_BLIND_MAP,
      strict: true,
    });
    assert.equal(res.valid, false);
    assert.ok(res.path_policy_violations.some(v => v.startsWith("path_violates_strict_mechanical_grammar:")));
    assert.ok(res.tool_violations.some(v => v.reason === "read_file_violates_strict_mechanical_grammar"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("8. Free-text filename ('top_tier_masterpiece.mp4') is rejected by BOTH template renderer AND auditor", () => {
  const dir = makeTempDir();
  try {
    const badFile = `E:\\iketeru_blind_eval\\${RUN_ID}\\video\\${BLIND_A}\\top_tier_masterpiece.mp4`;
    const badSpec = baseVideoSpec({ runId: RUN_ID, blindId: BLIND_A, assignedFiles: [badFile] });
    assert.throws(() => renderCalibrationPrompt(badSpec), /Invalid video filename/);

    const tPath = path.join(dir, "bad_fname.jsonl");
    writeJsonl(tPath, [
      { step_index: 0, source: "SYSTEM", type: "SYSTEM_MESSAGE", status: "DONE", content: wrapSystemMessage("score file") },
      { step_index: 1, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "read_file", args: { Path: JSON.stringify(badFile) } }] },
      { step_index: 2, source: "MODEL", type: "GENERIC", status: "DONE", media: [{ mime_type: "video/mp4", uri: "file:///m0.mp4" }] },
      { step_index: 3, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "send_message", args: { Recipient: JSON.stringify(PARENT_ID), Message: JSON.stringify("{}") } }] },
    ]);
    const res = auditTranscript({
      transcriptPath: tPath,
      videoId: VIDEO_A,
      allowedFilesRaw: [badFile],
      parentId: PARENT_ID,
      promptSpecObj: badSpec,
      blindMapObj: SAMPLE_BLIND_MAP,
      strict: true,
    });
    assert.equal(res.valid, false);
    assert.ok(res.path_policy_violations.some(v => v.startsWith("path_violates_strict_mechanical_grammar:")));
    assert.ok(res.tool_violations.some(v => v.reason === "read_file_violates_strict_mechanical_grammar"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("9. Different video's folder/file (auditing vRBVWCs1KW4 with tvTRZJ-4EyI's blind folder) MUST fail", () => {
  const dir = makeTempDir();
  try {
    const fileOfVideoB = `E:\\iketeru_blind_eval\\${RUN_ID}\\video\\${BLIND_B}\\${BLIND_B}.mp4`;
    const specForB = baseVideoSpec({ runId: RUN_ID, blindId: BLIND_B, assignedFiles: [fileOfVideoB] });
    const promptForB = renderCalibrationPrompt(specForB);
    const fx = setupManifestFixture(dir, { videoId: VIDEO_A, blindId: BLIND_A, assignedFiles: [`E:\\iketeru_blind_eval\\${RUN_ID}\\video\\${BLIND_A}\\${BLIND_A}.mp4`] });
    const tPath = path.join(dir, "wrong_video.jsonl");
    writeJsonl(tPath, [
      { step_index: 0, source: "SYSTEM", type: "SYSTEM_MESSAGE", status: "DONE", content: wrapSystemMessage(promptForB) },
      { step_index: 1, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "read_file", args: { Path: JSON.stringify(fileOfVideoB) } }] },
      { step_index: 2, source: "MODEL", type: "GENERIC", status: "DONE", media: [{ mime_type: "video/mp4", uri: "file:///m0.mp4" }] },
      { step_index: 3, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "send_message", args: { Recipient: JSON.stringify(PARENT_ID), Message: JSON.stringify("{}") } }] },
    ]);

    const res = auditTranscript({
      transcriptPath: tPath,
      videoId: VIDEO_A,
      allowedFilesRaw: [fileOfVideoB],
      parentId: PARENT_ID,
      promptSpecObj: specForB,
      blindMapPath: fx.mapPath,
      runManifestPath: fx.manifestPath,
      stagedFilePathResolver: fx.stagedFilePathResolver,
      strict: true,
    });
    assert.equal(res.valid, false);
    assert.ok(res.config_violations.some(v => v.startsWith("blind_id_mismatch_for_video_id:")));
    assert.ok(res.path_policy_violations.some(v => v.startsWith("path_blind_id_mismatch_for_video_id:")));
    assert.ok(res.tool_violations.some(v => v.reason === "read_file_blind_id_mismatch"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("10. Original YouTube/Vimeo video ID used directly as folder/filename MUST fail", () => {
  const dir = makeTempDir();
  try {
    const rawIdFile = `E:\\iketeru_blind_eval\\${RUN_ID}\\video\\${VIDEO_A}\\${VIDEO_A}.mp4`;
    const badSpec = baseVideoSpec({ runId: RUN_ID, blindId: VIDEO_A, assignedFiles: [rawIdFile] });
    assert.throws(() => renderCalibrationPrompt(badSpec), /Invalid blindId/);

    const tPath = path.join(dir, "raw_vid_id.jsonl");
    writeJsonl(tPath, [
      { step_index: 0, source: "SYSTEM", type: "SYSTEM_MESSAGE", status: "DONE", content: wrapSystemMessage(`score ${rawIdFile}`) },
      { step_index: 1, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "read_file", args: { Path: JSON.stringify(rawIdFile) } }] },
      { step_index: 2, source: "MODEL", type: "GENERIC", status: "DONE", media: [{ mime_type: "video/mp4", uri: "file:///m0.mp4" }] },
      { step_index: 3, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "send_message", args: { Recipient: JSON.stringify(PARENT_ID), Message: JSON.stringify("{}") } }] },
    ]);

    const res = auditTranscript({
      transcriptPath: tPath,
      videoId: VIDEO_A,
      allowedFilesRaw: [rawIdFile],
      parentId: PARENT_ID,
      promptSpecObj: badSpec,
      blindMapObj: SAMPLE_BLIND_MAP,
      strict: true,
    });
    assert.equal(res.valid, false);
    assert.ok(res.path_policy_violations.some(v => v.startsWith("original_video_id_in_path:")));
    assert.ok(res.tool_violations.some(v => v.reason === "read_file_contains_original_video_id"));
    assert.ok(res.prompt_leak_violations.some(v => v.rule.startsWith("original_video_id_in_prompt:")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("11. Swapping 2 videos' blind_ids inside blind_id_map.json AFTER manifest lock MUST fail (blind_map_sha256_mismatch)", () => {
  const dir = makeTempDir();
  try {
    const file1 = `E:\\iketeru_blind_eval\\${RUN_ID}\\video\\${BLIND_A}\\${BLIND_A}.mp4`;
    const fx = setupManifestFixture(dir, { videoId: VIDEO_A, blindId: BLIND_A, assignedFiles: [file1] });

    // Consistently swap VIDEO_A <-> VIDEO_B in blind_id_map.json on disk AFTER manifest was frozen
    const swappedMap = {
      ...SAMPLE_BLIND_MAP,
      video_to_blind: { [VIDEO_A]: BLIND_B, [VIDEO_B]: BLIND_A },
      blind_to_video: { [BLIND_B]: VIDEO_A, [BLIND_A]: VIDEO_B },
    };
    fs.writeFileSync(fx.mapPath, JSON.stringify(swappedMap, null, 2) + "\n", "utf8");

    const fileB = `E:\\iketeru_blind_eval\\${RUN_ID}\\video\\${BLIND_B}\\${BLIND_B}.mp4`;
    const specSwapped = baseVideoSpec({ runId: RUN_ID, blindId: BLIND_B, assignedFiles: [fileB] });
    const prompt = renderCalibrationPrompt(specSwapped);
    const tPath = path.join(dir, "swapped_map.jsonl");
    writeJsonl(tPath, [
      { step_index: 0, source: "SYSTEM", type: "SYSTEM_MESSAGE", status: "DONE", content: wrapSystemMessage(prompt) },
      { step_index: 1, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "read_file", args: { Path: JSON.stringify(fileB) } }] },
      { step_index: 2, source: "MODEL", type: "GENERIC", status: "DONE", media: [{ mime_type: "video/mp4", uri: "file:///m0.mp4" }] },
      { step_index: 3, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "send_message", args: { Recipient: JSON.stringify(PARENT_ID), Message: JSON.stringify("{}") } }] },
    ]);

    const res = auditTranscript({
      transcriptPath: tPath,
      videoId: VIDEO_A,
      allowedFilesRaw: [fileB],
      parentId: PARENT_ID,
      promptSpecObj: specSwapped,
      blindMapPath: fx.mapPath,
      runManifestPath: fx.manifestPath,
      stagedFilePathResolver: fx.stagedFilePathResolver,
      strict: true,
    });
    assert.equal(res.valid, false);
    assert.ok(res.manifest_violations.some(v => v.startsWith("blind_map_sha256_mismatch:")));
    assert.ok(res.manifest_violations.some(v => v.startsWith("manifest_blind_id_mismatch:")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("12. Tampering with a staged .mp4 file on disk AFTER manifest lock MUST fail (staged_file_sha256_mismatch)", () => {
  const dir = makeTempDir();
  try {
    const file1 = `E:\\iketeru_blind_eval\\${RUN_ID}\\video\\${BLIND_A}\\${BLIND_A}.mp4`;
    const spec = baseVideoSpec({ assignedFiles: [file1], slowmo: false });
    const prompt = renderCalibrationPrompt(spec);
    const fx = setupManifestFixture(dir, { assignedFiles: [file1] });

    // Tamper 1 byte in the staged file on disk (e.g. swapping mp4 content)
    const realStagedFile = fx.diskFiles.get(file1);
    fs.appendFileSync(realStagedFile, "X", "utf8");

    const tPath = path.join(dir, "tampered_mp4.jsonl");
    writeJsonl(tPath, [
      { step_index: 0, source: "SYSTEM", type: "SYSTEM_MESSAGE", status: "DONE", content: wrapSystemMessage(prompt) },
      { step_index: 1, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "read_file", args: { Path: JSON.stringify(file1) } }] },
      { step_index: 2, source: "MODEL", type: "GENERIC", status: "DONE", media: [{ mime_type: "video/mp4", uri: "file:///m0.mp4" }] },
      { step_index: 3, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "send_message", args: { Recipient: JSON.stringify(PARENT_ID), Message: JSON.stringify("{}") } }] },
    ]);

    const res = auditTranscript({
      transcriptPath: tPath,
      videoId: VIDEO_A,
      allowedFilesRaw: [file1],
      parentId: PARENT_ID,
      promptSpecObj: spec,
      blindMapPath: fx.mapPath,
      runManifestPath: fx.manifestPath,
      stagedFilePathResolver: fx.stagedFilePathResolver,
      strict: true,
    });
    assert.equal(res.valid, false);
    assert.ok(res.manifest_violations.some(v => v.startsWith("staged_file_sha256_mismatch:")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("13. Blind ID map generator enforces 12-char opaque IDs and rejects saving inside E:\\iketeru_blind_eval\\", () => {
  const map = generateBlindIdMap(RUN_ID, [VIDEO_A, VIDEO_B, "1032202784"]);
  assert.equal(map.count, 3);
  for (const [vid, bid] of Object.entries(map.video_to_blind)) {
    assert.match(bid, /^[a-f0-9]{12}$/);
    assert.notEqual(bid.toLowerCase(), vid.toLowerCase());
    assert.equal(map.blind_to_video[bid], vid);
  }
  assert.throws(() => saveBlindIdMap(`E:\\iketeru_blind_eval\\${RUN_ID}\\blind_id_map.json`, map), /Refusing to write blind_id_map/);
});

test("14. Frozen prompt renderer rejects path traversal and non-numeric metric injection", () => {
  assert.throws(() => {
    renderCalibrationPrompt({
      version: "v1_baseline",
      runId: RUN_ID,
      blindId: BLIND_A,
      mode: "video",
      assignedFiles: [`E:\\iketeru_blind_eval\\${RUN_ID}\\video\\..\\..\\iketeru-eizou\\analysis\\golden_benchmark.json`],
      metrics: baseVideoSpec({ assignedFiles: [] }).metrics,
    });
  });

  assert.throws(() => {
    renderCalibrationPrompt({
      version: "v1_baseline",
      runId: RUN_ID,
      blindId: BLIND_A,
      mode: "video",
      assignedFiles: [`E:\\iketeru_blind_eval\\${RUN_ID}\\video\\${BLIND_A}\\${BLIND_A}.mp4`],
      metrics: {
        ...baseVideoSpec({ assignedFiles: [] }).metrics,
        duration_sec: "120 (Palme d'Or S+)",
      },
    });
  });
});

test("15. Expected model pinning verifies every PLANNER_RESPONSE.model and rejects mismatches or missing model", () => {
  const dir = makeTempDir();
  try {
    const file1 = `E:\\iketeru_blind_eval\\${RUN_ID}\\video\\${BLIND_A}\\${BLIND_A}.mp4`;
    const spec = baseVideoSpec({ assignedFiles: [file1], slowmo: false });
    const prompt = renderCalibrationPrompt(spec);
    const fx = setupManifestFixture(dir, { assignedFiles: [file1] });

    // (a) Matching model passes
    const tOk = path.join(dir, "model_ok.jsonl");
    writeJsonl(tOk, [
      { step_index: 0, source: "SYSTEM", type: "SYSTEM_MESSAGE", status: "DONE", content: wrapSystemMessage(prompt) },
      { step_index: 1, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", model: "gemini-4-neon-high", tool_calls: [{ name: "read_file", args: { Path: JSON.stringify(file1) } }] },
      { step_index: 2, source: "MODEL", type: "GENERIC", status: "DONE", media: [{ mime_type: "video/mp4", uri: "file:///m0.mp4" }] },
      { step_index: 3, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", model: "gemini-4-neon-high", tool_calls: [{ name: "send_message", args: { Recipient: JSON.stringify(PARENT_ID), Message: JSON.stringify("{}") } }] },
    ]);
    const okRes = auditTranscript({
      transcriptPath: tOk,
      videoId: VIDEO_A,
      allowedFilesRaw: [file1],
      parentId: PARENT_ID,
      promptSpecObj: spec,
      blindMapPath: fx.mapPath,
      runManifestPath: fx.manifestPath,
      expectedModel: "gemini-4-neon-high",
      stagedFilePathResolver: fx.stagedFilePathResolver,
      strict: true,
    });
    assert.equal(okRes.valid, true);
    assert.equal(okRes.model_match, true);
    assert.deepEqual(okRes.models_observed, ["gemini-4-neon-high"]);
    assert.equal(okRes.model_violations.length, 0);

    // (b) Mismatched model on second step MUST fail
    const tBad = path.join(dir, "model_bad.jsonl");
    writeJsonl(tBad, [
      { step_index: 0, source: "SYSTEM", type: "SYSTEM_MESSAGE", status: "DONE", content: wrapSystemMessage(prompt) },
      { step_index: 1, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", model: "gemini-4-neon-high", tool_calls: [{ name: "read_file", args: { Path: JSON.stringify(file1) } }] },
      { step_index: 2, source: "MODEL", type: "GENERIC", status: "DONE", media: [{ mime_type: "video/mp4", uri: "file:///m0.mp4" }] },
      { step_index: 3, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", model: "gemini-3-flash", tool_calls: [{ name: "send_message", args: { Recipient: JSON.stringify(PARENT_ID), Message: JSON.stringify("{}") } }] },
    ]);
    const badRes = auditTranscript({
      transcriptPath: tBad,
      videoId: VIDEO_A,
      allowedFilesRaw: [file1],
      parentId: PARENT_ID,
      promptSpecObj: spec,
      blindMapPath: fx.mapPath,
      runManifestPath: fx.manifestPath,
      expectedModel: "gemini-4-neon-high",
      stagedFilePathResolver: fx.stagedFilePathResolver,
      strict: true,
    });
    assert.equal(badRes.valid, false);
    assert.equal(badRes.model_match, false);
    assert.ok(badRes.model_violations.some(v => v.reason === "planner_model_mismatch" && v.actual_model === "gemini-3-flash"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("16. parseArgs accepts '--'-prefixed video IDs (e.g. --41OGPMurU) and preserves normal args + --strict", () => {
  const args = parseArgs([
    "node",
    "audit-blind-transcript.mjs",
    "--transcript", "C:\\tmp\\transcript.jsonl",
    "--video-id", "--41OGPMurU",
    "--allowed-files", "E:\\iketeru_blind_eval\\run_20261125_070347\\video\\abcdef123456\\abcdef123456.mp4",
    "--parent-id", PARENT_ID,
    "--strict",
  ]);
  assert.equal(args["video-id"], "--41OGPMurU");
  assert.equal(args["transcript"], "C:\\tmp\\transcript.jsonl");
  assert.equal(args["parent-id"], PARENT_ID);
  assert.equal(args["strict"], true);

  const normal = parseArgs([
    "node",
    "audit-blind-transcript.mjs",
    "--transcript", "t.jsonl",
    "--video-id", VIDEO_A,
    "--allowed-files", "a.mp4",
  ]);
  assert.equal(normal["video-id"], VIDEO_A);
  assert.equal(normal["strict"], undefined);
});

test("17. parseArgs throws when VALUE_FLAGS omit their value", () => {
  assert.throws(
    () => parseArgs(["node", "audit-blind-transcript.mjs", "--transcript", "--video-id", VIDEO_A]),
    /Missing value for --transcript/
  );
  assert.throws(
    () => parseArgs(["node", "audit-blind-transcript.mjs", "--video-id", "--strict"]),
    /Missing value for --video-id/
  );
  assert.throws(
    () => parseArgs(["node", "audit-blind-transcript.mjs", "--video-id", "--parent-id", PARENT_ID]),
    /Missing value for --video-id/
  );
  assert.throws(
    () => parseArgs(["node", "audit-blind-transcript.mjs", "--video-id"]),
    /Missing value for --video-id/
  );
});
