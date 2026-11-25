import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";

import {
  archiveRunEvidence,
  collectConversationIds,
  collectEvidenceFiles,
  extractEnvSecretValues,
  parseArgs,
  scanTextForSecrets,
  sha256File,
} from "./archive-run-evidence.mjs";

const PARENT_UUID = "11111111-1111-4111-8111-111111111111";
const SUB1_UUID = "22222222-2222-4222-8222-222222222222";
const SUB2_UUID = "33333333-3333-4333-8333-333333333333";

function makeFixture(t, { parentTranscriptExtra = "", sub1TranscriptExtra = "", envContent = "" } = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "archive-evidence-test-"));
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  const repoRoot = path.join(tmpRoot, "repo");
  const brainRoot = path.join(tmpRoot, "brain");
  const outDir = path.join(tmpRoot, "archive_out");
  const runId = "run_20261125_000001";
  const runDir = path.join(repoRoot, "analysis", "runs", runId);

  fs.mkdirSync(path.join(runDir, "specs"), { recursive: true });
  fs.mkdirSync(path.join(brainRoot, PARENT_UUID, ".system_generated", "logs", "media"), { recursive: true });
  fs.mkdirSync(path.join(brainRoot, PARENT_UUID, "scratch"), { recursive: true });
  fs.mkdirSync(path.join(brainRoot, SUB1_UUID, ".system_generated", "logs", "chunks"), { recursive: true });
  fs.mkdirSync(path.join(brainRoot, SUB1_UUID, ".system_generated", "logs", "media"), { recursive: true });
  fs.mkdirSync(path.join(brainRoot, SUB2_UUID, ".system_generated", "logs"), { recursive: true });

  if (envContent) {
    fs.writeFileSync(path.join(repoRoot, ".env"), envContent, "utf8");
  }

  fs.writeFileSync(
    path.join(runDir, "dispatch_log.jsonl"),
    [
      JSON.stringify({ video_id: "vidA", mode: "video", attempt: 1, subagent_id: SUB1_UUID }),
      JSON.stringify({ video_id: "vidB", mode: "contact_sheet", attempt: 1, subagent_id: SUB2_UUID }),
    ].join("\n") + "\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "raw_scores.jsonl"),
    [
      JSON.stringify({ run_id: runId, video_id: "vidA", subagent_id: SUB1_UUID, total_score: 80 }),
      JSON.stringify({ run_id: runId, video_id: "vidB", subagent_id: SUB2_UUID, total_score: 75 }),
    ].join("\n") + "\n",
    "utf8"
  );
  fs.writeFileSync(path.join(runDir, "specs", "vidA_video.json"), JSON.stringify({ runId, videoId: "vidA" }), "utf8");

  // Parent logs + excluded files (media screenshot + scratch file)
  fs.writeFileSync(
    path.join(brainRoot, PARENT_UUID, ".system_generated", "logs", "transcript.jsonl"),
    JSON.stringify({ step_index: 0, content: "Parent conversation log" }) + "\n" + parentTranscriptExtra,
    "utf8"
  );
  fs.writeFileSync(
    path.join(brainRoot, PARENT_UUID, ".system_generated", "logs", "transcript_full.jsonl"),
    JSON.stringify({ step_index: 0, content: "Parent full conversation log" }) + "\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(brainRoot, PARENT_UUID, ".system_generated", "logs", "media", "screenshot.png"),
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  );
  fs.writeFileSync(
    path.join(brainRoot, PARENT_UUID, "scratch", "helper.mjs"),
    "console.log('should not be archived');\n",
    "utf8"
  );

  // Subagent 1 logs (references parent via sender=<uuid>) + excluded media/chunks
  fs.writeFileSync(
    path.join(brainRoot, SUB1_UUID, ".system_generated", "logs", "transcript.jsonl"),
    JSON.stringify({
      step_index: 0,
      content: `[Message] timestamp=2026-11-25T00:00:00Z sender=${PARENT_UUID} content=score this`,
    }) + "\n" + sub1TranscriptExtra,
    "utf8"
  );
  fs.writeFileSync(
    path.join(brainRoot, SUB1_UUID, ".system_generated", "logs", "transcript_full.jsonl"),
    JSON.stringify({ step_index: 0, content: "sub1 full" }) + "\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(brainRoot, SUB1_UUID, ".system_generated", "logs", "media", "frame.jpg"),
    Buffer.from([0xff, 0xd8, 0xff]),
  );
  fs.writeFileSync(
    path.join(brainRoot, SUB1_UUID, ".system_generated", "logs", "chunks", "chunk0.txt"),
    "chunk data",
    "utf8"
  );

  // Subagent 2 logs (references parent via send_message Recipient)
  fs.writeFileSync(
    path.join(brainRoot, SUB2_UUID, ".system_generated", "logs", "transcript.jsonl"),
    JSON.stringify({
      step_index: 5,
      tool: "send_message",
      args: { Recipient: PARENT_UUID, Message: "{}" },
    }) + "\n",
    "utf8"
  );

  return { tmpRoot, repoRoot, brainRoot, outDir, runId, runDir };
}

/** Minimal ZIP reader for verifying written archives without external tools. */
function readZipEntries(zipPath) {
  const buf = fs.readFileSync(zipPath);
  // Locate End of Central Directory (0x06054b50)
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  assert.notEqual(eocdOffset, -1, "EOCD signature not found");
  const entryCount = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  const entries = new Map();
  let ptr = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    assert.equal(buf.readUInt32LE(ptr), 0x02014b50, "Central directory signature mismatch");
    const method = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const uncompressedSize = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localHeaderOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf8");
    ptr += 46 + nameLen + extraLen + commentLen;

    assert.equal(buf.readUInt32LE(localHeaderOffset), 0x04034b50, "Local header signature mismatch");
    const lhNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const lhExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + lhNameLen + lhExtraLen;
    const rawSlice = buf.subarray(dataStart, dataStart + compressedSize);
    const content = method === 8 ? zlib.inflateRawSync(rawSlice) : rawSlice;
    assert.equal(content.length, uncompressedSize, `Size mismatch for ${name}`);
    entries.set(name, content);
  }
  return entries;
}

test("parseArgs validates required values and flags", () => {
  const parsed = parseArgs([
    "node",
    "archive-run-evidence.mjs",
    "run_20261125_070347",
    "--dry-run",
    "--worker",
    "chibatmute",
    "--max-size-mb",
    "150",
  ]);
  assert.equal(parsed.runId, "run_20261125_070347");
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.worker, "chibatmute");
  assert.equal(parsed.maxSizeMb, 150);

  assert.throws(() => parseArgs(["node", "s.mjs", "run_1", "--worker"]), /Missing value/);
  assert.throws(() => parseArgs(["node", "s.mjs", "run_1", "--max-size-mb", "0"]), /Invalid --max-size-mb/);
  assert.throws(() => parseArgs(["node", "s.mjs", "run_1", "--unknown"]), /Unknown flag/);
});

test("collectConversationIds and collectEvidenceFiles include only transcripts and exclude media/scratch/chunks", (t) => {
  const { runDir, brainRoot } = makeFixture(t);
  const ids = collectConversationIds(runDir, brainRoot);
  assert.deepEqual(ids.parentIds, [PARENT_UUID]);
  assert.deepEqual(ids.subagentIds, [SUB1_UUID, SUB2_UUID]);

  const { files, missingInBrain } = collectEvidenceFiles(runDir, brainRoot, ids);
  assert.deepEqual(missingInBrain, []);
  const zipPaths = files.map(f => f.zipPath);

  assert.ok(zipPaths.includes("run/dispatch_log.jsonl"));
  assert.ok(zipPaths.includes("run/raw_scores.jsonl"));
  assert.ok(zipPaths.includes("run/specs/vidA_video.json"));
  assert.ok(zipPaths.includes(`transcripts/parent/${PARENT_UUID}/transcript.jsonl`));
  assert.ok(zipPaths.includes(`transcripts/parent/${PARENT_UUID}/transcript_full.jsonl`));
  assert.ok(zipPaths.includes(`transcripts/subagent/${SUB1_UUID}/transcript.jsonl`));
  assert.ok(zipPaths.includes(`transcripts/subagent/${SUB1_UUID}/transcript_full.jsonl`));
  assert.ok(zipPaths.includes(`transcripts/subagent/${SUB2_UUID}/transcript.jsonl`));

  // Strictly excluded
  assert.ok(!zipPaths.some(p => p.includes("screenshot.png")));
  assert.ok(!zipPaths.some(p => p.includes("frame.jpg")));
  assert.ok(!zipPaths.some(p => p.includes("scratch")));
  assert.ok(!zipPaths.some(p => p.includes("chunks")));
});

test("secret scanner catches API keys, mysql:// creds, and .env values while allowing harmless config", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "secret-scan-test-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const envPath = path.join(tmpDir, ".env");
  fs.writeFileSync(
    envPath,
    [
      "IKETERU_WORKER_NAME=chibatmute",
      "DATABASE_URL=mysql://tidb_user_abc:SuperSecretPass9876@gateway01.tidbcloud.com:4000/iketeru",
      "CUSTOM_SECRET_TOKEN=tok_live_9876543210abcdef",
    ].join("\n"),
    "utf8"
  );

  const { entries } = extractEnvSecretValues([envPath]);
  assert.ok(entries.some(e => e.label === "env_value:DATABASE_URL"));
  assert.ok(entries.some(e => e.label === "env_value:DATABASE_URL.password"));
  assert.ok(!entries.some(e => e.key === "IKETERU_WORKER_NAME"));

  // Clean text mentioning worker name passes
  assert.equal(scanTextForSecrets("worker=chibatmute score=82", "run/a.json", entries).length, 0);

  // Detects leaked password fragment from .env DATABASE_URL
  const pwHits = scanTextForSecrets("debug output: SuperSecretPass9876", "t.jsonl", entries);
  assert.ok(pwHits.some(h => h.rule === "env_value:DATABASE_URL.password"));
  assert.ok(!pwHits[0].sample.includes("SuperSecretPass9876"));

  // Detects Google API key & mysql URL
  const apiHits = scanTextForSecrets("AIzaSyA123456789012345678901234567890123", "t.jsonl", []);
  assert.ok(apiHits.some(h => h.rule === "google_api_key"));

  const mysqlHits = scanTextForSecrets("mysql://admin:myrealpass123@db.prod.internal:4000/app", "t.jsonl", []);
  assert.ok(mysqlHits.some(h => h.rule === "mysql_connection_url"));
});

test("archiveRunEvidence dry-run does not save zip, and write mode produces verified zip with manifest SHA-256", (t) => {
  const { repoRoot, brainRoot, outDir, runId } = makeFixture(t, {
    envContent: "IKETERU_WORKER_NAME=chibatmute\nDATABASE_URL=mysql://u:MySecretPwd1234@tidb.example.net:4000/db\n",
  });

  const dry = archiveRunEvidence({
    runId,
    repoRoot,
    brainRoot,
    outDir,
    worker: "chibatmute",
    dryRun: true,
    envFiles: [path.join(repoRoot, ".env")],
  });
  assert.equal(dry.mode, "dry_run");
  assert.equal(dry.saved, false);
  assert.equal(dry.secret_scan.passed, true);
  assert.equal(dry.counts.total_evidence_files, 8);
  assert.equal(fs.existsSync(dry.dest_zip_path), false);

  const res = archiveRunEvidence({
    runId,
    repoRoot,
    brainRoot,
    outDir,
    worker: "chibatmute",
    dryRun: false,
    envFiles: [path.join(repoRoot, ".env")],
  });
  assert.equal(res.saved, true);
  assert.equal(res.blocked_reason, null);
  assert.equal(res.zip_sha256, sha256File(res.dest_zip_path));

  const zipEntries = readZipEntries(res.dest_zip_path);
  assert.ok(zipEntries.has("manifest.json"));
  const manifest = JSON.parse(zipEntries.get("manifest.json").toString("utf8"));
  assert.equal(manifest.run_id, runId);
  assert.equal(manifest.worker, "chibatmute");
  assert.deepEqual(manifest.conversation_ids.parent, [PARENT_UUID]);
  assert.deepEqual(manifest.conversation_ids.subagent, [SUB1_UUID, SUB2_UUID]);
  assert.equal(manifest.files.length, 8);

  // Verify every file's content hash in the zip matches manifest.json
  for (const mf of manifest.files) {
    assert.ok(zipEntries.has(mf.zip_path), `Missing ${mf.zip_path} in zip`);
    const actualSha = crypto.createHash("sha256").update(zipEntries.get(mf.zip_path)).digest("hex");
    assert.equal(actualSha, mf.sha256, `SHA-256 mismatch for ${mf.zip_path}`);
  }
});

test("archiveRunEvidence aborts without saving when secret is found", (t) => {
  const { repoRoot, brainRoot, outDir, runId } = makeFixture(t, {
    parentTranscriptExtra: JSON.stringify({ step_index: 1, content: "leaked key AIzaSyB123456789012345678901234567890123" }) + "\n",
    envContent: "IKETERU_WORKER_NAME=chibatmute\n",
  });

  const res = archiveRunEvidence({
    runId,
    repoRoot,
    brainRoot,
    outDir,
    worker: "chibatmute",
    dryRun: false,
    envFiles: [path.join(repoRoot, ".env")],
  });
  assert.equal(res.saved, false);
  assert.equal(res.blocked_reason, "secret_detected");
  assert.equal(res.secret_scan.passed, false);
  assert.ok(res.secret_scan.findings_count >= 1);
  assert.equal(fs.existsSync(res.dest_zip_path), false);
});

test("archiveRunEvidence aborts without saving when zip exceeds maxSizeMb", (t) => {
  const { repoRoot, brainRoot, outDir, runId } = makeFixture(t, {
    envContent: "IKETERU_WORKER_NAME=chibatmute\n",
  });

  const res = archiveRunEvidence({
    runId,
    repoRoot,
    brainRoot,
    outDir,
    worker: "chibatmute",
    dryRun: false,
    maxSizeMb: 0.0001, // ~100 bytes
    envFiles: [path.join(repoRoot, ".env")],
  });
  assert.equal(res.saved, false);
  assert.match(res.blocked_reason, /zip_exceeds_max_size_mb/);
  assert.equal(fs.existsSync(res.dest_zip_path), false);
});
