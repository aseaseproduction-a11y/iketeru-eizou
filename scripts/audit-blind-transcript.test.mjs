import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { auditTranscript } from "./audit-blind-transcript.mjs";
import { renderCalibrationPrompt } from "./lib/calibration-prompt-template.mjs";

const PARENT_ID = "8eb1cf89-a4ac-4890-ac1b-c8e9300f8edc";
const VIDEO_ID = "8pOOxOo7YYo";
const SCRIPT_PATH = "E:\\iketeru-eizou\\scripts\\audit-blind-transcript.mjs";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "iketeru-audit-test-"));
}

function writeJsonl(filePath, lines) {
  fs.writeFileSync(filePath, lines.map(o => JSON.stringify(o)).join("\n") + "\n", "utf8");
}

function wrapSystemMessage(payload) {
  return `The following is a <SYSTEM_MESSAGE> not actually sent by the user.\n\n<SYSTEM_MESSAGE>\n[Message] timestamp=2026-11-22T10:00:00Z sender=${PARENT_ID} priority=MESSAGE_PRIORITY_HIGH content=${payload}\n</SYSTEM_MESSAGE>`;
}

function baseVideoSpec(assignedFiles, slowmo = false) {
  return {
    version: "v1_baseline",
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

test("1. Valid strict run (single video + exact frozen prompt + video/mp4 media + parent send_message)", () => {
  const dir = makeTempDir();
  try {
    const file1 = `E:\\iketeru_blind_eval\\run01\\video\\${VIDEO_ID}\\${VIDEO_ID}.mp4`;
    const spec = baseVideoSpec([file1], false);
    const prompt = renderCalibrationPrompt(spec);
    const tPath = path.join(dir, "transcript.jsonl");
    writeJsonl(tPath, [
      { step_index: 0, source: "SYSTEM", type: "SYSTEM_MESSAGE", status: "DONE", content: wrapSystemMessage(prompt) },
      { step_index: 1, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", model: "gemini-4-neon-high", input_tokens: 5000, output_tokens: 100, tool_calls: [{ name: "read_file", args: { Path: JSON.stringify(file1) } }] },
      { step_index: 2, source: "MODEL", type: "GENERIC", status: "DONE", content: "Showing binary file of type video/mp4", media: [{ mime_type: "video/mp4", uri: "file:///media/step_2_media_0.mp4" }] },
      { step_index: 3, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", model: "gemini-4-neon-high", input_tokens: 18420, output_tokens: 450, tool_calls: [{ name: "send_message", args: { Recipient: JSON.stringify(PARENT_ID), Message: JSON.stringify("{}") } }] },
    ]);

    const res = auditTranscript({
      transcriptPath: tPath,
      videoId: VIDEO_ID,
      allowedFilesRaw: [file1],
      parentId: PARENT_ID,
      promptSpecObj: spec,
      strict: true,
    });
    assert.equal(res.valid, true);
    assert.equal(res.prompt_exact_match_checked, true);
    assert.equal(res.verified_media_by_file[file1.toLowerCase()], "video/mp4");
    assert.equal(res.token_usage.first_post_read_input_tokens, 18420);
    assert.equal(res.token_usage.max_input_tokens, 18420);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("2. Valid strict multi-file run (main video + 2x slowmo, both paired with video/mp4 media)", () => {
  const dir = makeTempDir();
  try {
    const file1 = `E:\\iketeru_blind_eval\\run01\\video\\${VIDEO_ID}\\${VIDEO_ID}.mp4`;
    const file2 = `E:\\iketeru_blind_eval\\run01\\video\\${VIDEO_ID}\\${VIDEO_ID}_slow.mp4`;
    const spec = baseVideoSpec([file1, file2], true);
    const prompt = renderCalibrationPrompt(spec);
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
      videoId: VIDEO_ID,
      allowedFilesRaw: [file1, file2],
      parentId: PARENT_ID,
      promptSpecObj: spec,
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
    const file1 = `E:\\iketeru_blind_eval\\run01\\video\\${VIDEO_ID}\\${VIDEO_ID}.mp4`;
    const spec = baseVideoSpec([file1], false);
    const leakedPrompt = renderCalibrationPrompt(spec) + "\nThis is an S+ work (Palme d'Or)";
    const tPath = path.join(dir, "transcript.jsonl");
    writeJsonl(tPath, [
      { step_index: 0, source: "SYSTEM", type: "SYSTEM_MESSAGE", status: "DONE", content: wrapSystemMessage(leakedPrompt) },
      { step_index: 1, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "read_file", args: { Path: JSON.stringify(file1) } }] },
      { step_index: 2, source: "MODEL", type: "GENERIC", status: "DONE", media: [{ mime_type: "video/mp4", uri: "file:///m0.mp4" }] },
      { step_index: 3, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "send_message", args: { Recipient: JSON.stringify(PARENT_ID), Message: JSON.stringify("{}") } }] },
    ]);

    // (a) With strict exact-match prompt spec -> invalid due to prompt_exact_match_mismatch
    const resStrict = auditTranscript({
      transcriptPath: tPath,
      videoId: VIDEO_ID,
      allowedFilesRaw: [file1],
      parentId: PARENT_ID,
      promptSpecObj: spec,
      strict: true,
    });
    assert.equal(resStrict.valid, false);
    assert.ok(resStrict.prompt_exact_match_violations.some(v => v.reason === "prompt_exact_match_mismatch"));

    // (b) Without prompt spec (standalone fallback regex check on raw leaked message) -> invalid due to rank_plus_minus AND award_keyword_en
    const tRawPath = path.join(dir, "transcript_raw.jsonl");
    writeJsonl(tRawPath, [
      { step_index: 0, source: "SYSTEM", type: "SYSTEM_MESSAGE", status: "DONE", content: wrapSystemMessage("This is an S+ work (Palme d'Or)") },
      { step_index: 1, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "read_file", args: { Path: JSON.stringify(file1) } }] },
      { step_index: 2, source: "MODEL", type: "GENERIC", status: "DONE", media: [{ mime_type: "video/mp4", uri: "file:///m0.mp4" }] },
      { step_index: 3, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "send_message", args: { Recipient: JSON.stringify(PARENT_ID), Message: JSON.stringify("{}") } }] },
    ]);
    const resFallback = auditTranscript({
      transcriptPath: tRawPath,
      videoId: VIDEO_ID,
      allowedFilesRaw: [file1],
      parentId: PARENT_ID,
      strict: false,
    });
    assert.equal(resFallback.valid, false);
    assert.ok(resFallback.prompt_leak_violations.some(v => v.rule === "rank_plus_minus"));
    assert.ok(resFallback.prompt_leak_violations.some(v => v.rule === "award_keyword_en"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("4. Omitting --parent-id under --strict MUST fail (both API and CLI exit non-zero)", () => {
  const dir = makeTempDir();
  try {
    const file1 = `E:\\iketeru_blind_eval\\run01\\video\\${VIDEO_ID}\\${VIDEO_ID}.mp4`;
    const spec = baseVideoSpec([file1], false);
    const prompt = renderCalibrationPrompt(spec);
    const tPath = path.join(dir, "transcript.jsonl");
    const specPath = path.join(dir, "spec.json");
    fs.writeFileSync(specPath, JSON.stringify(spec), "utf8");
    writeJsonl(tPath, [
      { step_index: 0, source: "SYSTEM", type: "SYSTEM_MESSAGE", status: "DONE", content: wrapSystemMessage(prompt) },
      { step_index: 1, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "read_file", args: { Path: JSON.stringify(file1) } }] },
      { step_index: 2, source: "MODEL", type: "GENERIC", status: "DONE", media: [{ mime_type: "video/mp4", uri: "file:///m0.mp4" }] },
      { step_index: 3, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "send_message", args: { Recipient: JSON.stringify("someone-else"), Message: JSON.stringify("{}") } }] },
    ]);

    const res = auditTranscript({
      transcriptPath: tPath,
      videoId: VIDEO_ID,
      allowedFilesRaw: [file1],
      parentId: null,
      promptSpecObj: spec,
      strict: true,
    });
    assert.equal(res.valid, false);
    assert.ok(res.config_violations.includes("strict_mode_requires_parent_id"));
    assert.ok(res.tool_violations.some(v => v.reason === "send_message_parent_id_not_configured"));

    // Verify CLI also exits non-zero when --parent-id is omitted with --strict
    let threw = false;
    try {
      execFileSync(process.execPath, [
        SCRIPT_PATH,
        "--transcript", tPath,
        "--video-id", VIDEO_ID,
        "--allowed-files", file1,
        "--prompt-spec", specPath,
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
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("5. Multi-file assignment where only 1 of 2 files has media (2nd file missing media) MUST fail", () => {
  const dir = makeTempDir();
  try {
    const file1 = `E:\\iketeru_blind_eval\\run01\\video\\${VIDEO_ID}\\${VIDEO_ID}.mp4`;
    const file2 = `E:\\iketeru_blind_eval\\run01\\video\\${VIDEO_ID}\\${VIDEO_ID}_slow.mp4`;
    const spec = baseVideoSpec([file1, file2], true);
    const prompt = renderCalibrationPrompt(spec);
    const tPath = path.join(dir, "transcript.jsonl");
    // Both read_file called, but 2nd response has NO media (e.g. error/truncated/missing)
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
      videoId: VIDEO_ID,
      allowedFilesRaw: [file1, file2],
      parentId: PARENT_ID,
      promptSpecObj: spec,
      strict: true,
    });
    assert.equal(res.valid, false);
    assert.deepEqual(res.missing_media_files, [file2.toLowerCase()]);
    assert.equal(res.media_violations.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("6. Contact-sheet multi-file run verifies image/* media per file and rejects wrong MIME", () => {
  const dir = makeTempDir();
  try {
    const f1 = `E:\\iketeru_blind_eval\\run01\\contact_sheet\\${VIDEO_ID}\\${VIDEO_ID}_sheet_01.jpg`;
    const f2 = `E:\\iketeru_blind_eval\\run01\\contact_sheet\\${VIDEO_ID}\\${VIDEO_ID}_sheet_dense.jpg`;
    const spec = {
      version: "v1_baseline",
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
      videoId: VIDEO_ID,
      allowedFilesRaw: [f1, f2],
      parentId: PARENT_ID,
      promptSpecObj: spec,
      strict: true,
    });
    assert.equal(okRes.valid, true);
    assert.equal(okRes.verified_media_by_file[f1.toLowerCase()], "image/jpeg");
    assert.equal(okRes.verified_media_by_file[f2.toLowerCase()], "image/jpeg");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("7. Frozen prompt renderer rejects path traversal and non-numeric metric injection", () => {
  assert.throws(() => {
    renderCalibrationPrompt({
      version: "v1_baseline",
      mode: "video",
      assignedFiles: ["E:\\iketeru_blind_eval\\run01\\video\\..\\..\\iketeru-eizou\\analysis\\golden_benchmark.json"],
      metrics: baseVideoSpec(["E:\\iketeru_blind_eval\\run01\\video\\a\\a.mp4"]).metrics,
    });
  });

  assert.throws(() => {
    renderCalibrationPrompt({
      version: "v1_baseline",
      mode: "video",
      assignedFiles: [`E:\\iketeru_blind_eval\\run01\\video\\${VIDEO_ID}\\${VIDEO_ID}.mp4`],
      metrics: {
        ...baseVideoSpec([`E:\\iketeru_blind_eval\\run01\\video\\${VIDEO_ID}\\${VIDEO_ID}.mp4`]).metrics,
        duration_sec: "120 (Palme d'Or S+)",
      },
    });
  });
});

test("8. Multi-file assignment where subagent only reads 1 file + Japanese award leak ('金賞'/'シルバー') both fail", () => {
  const dir = makeTempDir();
  try {
    const file1 = `E:\\iketeru_blind_eval\\run01\\video\\${VIDEO_ID}\\${VIDEO_ID}.mp4`;
    const file2 = `E:\\iketeru_blind_eval\\run01\\video\\${VIDEO_ID}\\${VIDEO_ID}_slow.mp4`;
    const spec = baseVideoSpec([file1, file2], true);
    const prompt = renderCalibrationPrompt(spec);

    // (a) Subagent only calls read_file on file1 (skips file2)
    const tSkip = path.join(dir, "skip.jsonl");
    writeJsonl(tSkip, [
      { step_index: 0, source: "SYSTEM", type: "SYSTEM_MESSAGE", status: "DONE", content: wrapSystemMessage(prompt) },
      { step_index: 1, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "read_file", args: { Path: JSON.stringify(file1) } }] },
      { step_index: 2, source: "MODEL", type: "GENERIC", status: "DONE", media: [{ mime_type: "video/mp4", uri: "file:///m0.mp4" }] },
      { step_index: 3, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "send_message", args: { Recipient: JSON.stringify(PARENT_ID), Message: JSON.stringify("{}") } }] },
    ]);
    const resSkip = auditTranscript({
      transcriptPath: tSkip,
      videoId: VIDEO_ID,
      allowedFilesRaw: [file1, file2],
      parentId: PARENT_ID,
      promptSpecObj: spec,
      strict: true,
    });
    assert.equal(resSkip.valid, false);
    assert.deepEqual(resSkip.missing_file_reads, [file2.toLowerCase()]);
    assert.deepEqual(resSkip.missing_media_files, [file2.toLowerCase()]);

    // (b) Standalone fallback catches Japanese award words ('金賞' / 'シルバー') and unlisted Western awards ('Emmy', 'Webby')
    const tJa = path.join(dir, "ja_leak.jsonl");
    writeJsonl(tJa, [
      { step_index: 0, source: "SYSTEM", type: "SYSTEM_MESSAGE", status: "DONE", content: wrapSystemMessage("この作品は金賞・Emmy候補です") },
      { step_index: 1, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "read_file", args: { Path: JSON.stringify(file1) } }] },
      { step_index: 2, source: "MODEL", type: "GENERIC", status: "DONE", media: [{ mime_type: "video/mp4", uri: "file:///m0.mp4" }] },
      { step_index: 3, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", tool_calls: [{ name: "send_message", args: { Recipient: JSON.stringify(PARENT_ID), Message: JSON.stringify("{}") } }] },
    ]);
    const resJa = auditTranscript({
      transcriptPath: tJa,
      videoId: VIDEO_ID,
      allowedFilesRaw: [file1],
      parentId: PARENT_ID,
      strict: false,
    });
    assert.equal(resJa.valid, false);
    assert.ok(resJa.prompt_leak_violations.some(v => v.rule === "award_keyword_ja"));
    assert.ok(resJa.prompt_leak_violations.some(v => v.rule === "award_keyword_en"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
