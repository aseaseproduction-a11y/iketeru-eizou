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
  redactTextForSecrets,
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
    Buffer.from([0x89, 0x50, 0x4e, 0x47])
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
    Buffer.from([0xff, 0xd8, 0xff])
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

  assert.ok(!zipPaths.some(p => p.includes("screenshot.png")));
  assert.ok(!zipPaths.some(p => p.includes("frame.jpg")));
  assert.ok(!zipPaths.some(p => p.includes("scratch")));
  assert.ok(!zipPaths.some(p => p.includes("chunks")));
});

test("secret scanner & redactor catch API keys, mysql:// creds, password vars, and .env values", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "secret-scan-test-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const envPath = path.join(tmpDir, ".env");
  fs.writeFileSync(
    envPath,
    [
      "IKETERU_WORKER_NAME=chibatmute",
      "DATABASE_URL=mysql://tidb_user_abc:SuperSecretPass9876@gateway01.prod.tidbcloud.com:4000/iketeru",
      "CUSTOM_SECRET_TOKEN=tok_live_9876543210abcdef",
    ].join("\n"),
    "utf8"
  );

  const { entries } = extractEnvSecretValues([envPath]);
  assert.ok(entries.some(e => e.label === "env_value:DATABASE_URL"));
  assert.ok(entries.some(e => e.label === "env_value:DATABASE_URL.password"));
  assert.ok(entries.some(e => e.label === "env_value:DATABASE_URL.username"));
  assert.ok(entries.some(e => e.label === "env_value:DATABASE_URL.hostname"));
  assert.ok(!entries.some(e => e.key === "IKETERU_WORKER_NAME"));

  assert.equal(scanTextForSecrets("worker=chibatmute score=82", "run/a.json", entries).length, 0);

  const sampleLog = [
    'DATABASE_URL=mysql://tidb_user_abc:...@gateway01.prod.tidbcloud.com:4000/iketeru',
    '$user = "tidb_user_abc"; $pass = "OldRotatedPass99"; $host = "gateway01.prod.tidbcloud.com"',
    'key=AIzaSyA12345678901234567890123456789012',
    'direct mysql://admin:myrealpass123@db.prod.internal:4000/app',
  ].join("\n");

  const { redactedText, totalReplacements, countsByType } = redactTextForSecrets(sampleLog, entries);
  assert.ok(totalReplacements >= 6);
  assert.ok(countsByType.database_url_assignment >= 1);
  assert.ok(countsByType.password_var_assignment >= 1);
  assert.ok(countsByType.google_api_key >= 1);
  assert.ok(countsByType.mysql_connection_url >= 1);

  // None of the sensitive values remain after redaction
  assert.ok(!redactedText.includes("tidb_user_abc"));
  assert.ok(!redactedText.includes("gateway01.prod.tidbcloud.com"));
  assert.ok(!redactedText.includes("OldRotatedPass99"));
  assert.ok(!redactedText.includes("AIzaSyA12345678901234567890123456789012"));
  assert.ok(!redactedText.includes("myrealpass123"));
  assert.ok(redactedText.includes("DATABASE_URL=[REDACTED:database_url_assignment]"));
  assert.ok(redactedText.includes('[REDACTED:password_var_assignment]'));
  assert.ok(redactedText.includes('[REDACTED:google_api_key]'));

  // Post-redaction scan finds 0 secrets
  assert.equal(scanTextForSecrets(redactedText, "parent.jsonl", entries).length, 0);
});

test("archiveRunEvidence redacts ONLY parent transcript, keeps subagent & run untouched, and records original/redacted SHA-256 in manifest", (t) => {
  const secretMysql = "mysql://tidb_prod_user:MySecretPwd1234@gateway01.ap.tidbcloud.com:4000/iketeru_eizou";
  const secretApiKey = "AIzaSyB12345678901234567890123456789012";
  const oldPass = "OldPassValue9876";

  const { repoRoot, brainRoot, outDir, runId, runDir } = makeFixture(t, {
    parentTranscriptExtra:
      JSON.stringify({
        step_index: 1,
        content: `env DATABASE_URL=${secretMysql} key=${secretApiKey} $pass = "${oldPass}"`,
      }) + "\n",
    envContent: `IKETERU_WORKER_NAME=chibatmute\nDATABASE_URL=${secretMysql}\n`,
  });

  const parentTranscriptDiskPath = path.join(brainRoot, PARENT_UUID, ".system_generated", "logs", "transcript.jsonl");
  const sub1TranscriptDiskPath = path.join(brainRoot, SUB1_UUID, ".system_generated", "logs", "transcript.jsonl");
  const rawScoresDiskPath = path.join(runDir, "raw_scores.jsonl");

  const origParentSha = sha256File(parentTranscriptDiskPath);
  const origSub1Sha = sha256File(sub1TranscriptDiskPath);
  const origRawScoresSha = sha256File(rawScoresDiskPath);

  // 1. Dry-run reports redaction counts & post-redaction secret_scan.passed === true, saves nothing
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
  assert.equal(dry.secret_scan.findings_count, 0);
  assert.equal(dry.redaction.redacted_files_count, 1);
  assert.equal(dry.redaction.total_replacements, 3);
  assert.equal(fs.existsSync(dry.dest_zip_path), false);

  // 2. Archive mode writes verified zip
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
  assert.equal(res.secret_scan.passed, true);
  assert.equal(res.zip_sha256, sha256File(res.dest_zip_path));

  // Original parent file on disk MUST remain completely untouched
  assert.equal(sha256File(parentTranscriptDiskPath), origParentSha);

  // Inspect ZIP contents & manifest
  const zipEntries = readZipEntries(res.dest_zip_path);
  const manifestText = zipEntries.get("manifest.json").toString("utf8");
  // Manifest MUST NOT contain any raw secret values
  assert.ok(!manifestText.includes("tidb_prod_user"));
  assert.ok(!manifestText.includes("MySecretPwd1234"));
  assert.ok(!manifestText.includes(secretApiKey));
  assert.ok(!manifestText.includes(oldPass));

  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.run_id, runId);
  assert.equal(manifest.worker, "chibatmute");
  assert.equal(manifest.redaction.total_replacements, 3);

  const parentZipPath = `transcripts/parent/${PARENT_UUID}/transcript.jsonl`;
  const parentArchivedContent = zipEntries.get(parentZipPath).toString("utf8");
  // Redacted JSONL lines remain valid JSON
  for (const line of parentArchivedContent.split(/\r?\n/).filter(Boolean)) {
    assert.doesNotThrow(() => JSON.parse(line));
  }
  assert.ok(!parentArchivedContent.includes("tidb_prod_user"));
  assert.ok(!parentArchivedContent.includes("MySecretPwd1234"));
  assert.ok(!parentArchivedContent.includes(secretApiKey));
  assert.ok(!parentArchivedContent.includes(oldPass));
  assert.ok(parentArchivedContent.includes("DATABASE_URL=[REDACTED:database_url_assignment]"));
  assert.ok(parentArchivedContent.includes("[REDACTED:google_api_key]"));
  assert.ok(parentArchivedContent.includes("[REDACTED:password_var_assignment]"));

  const parentMf = manifest.files.find(f => f.zip_path === parentZipPath);
  const actualRedactedParentSha = crypto.createHash("sha256").update(zipEntries.get(parentZipPath)).digest("hex");
  assert.equal(parentMf.redacted, true);
  assert.equal(parentMf.original_sha256, origParentSha);
  assert.equal(parentMf.redacted_sha256, actualRedactedParentSha);
  assert.equal(parentMf.sha256, actualRedactedParentSha);
  assert.notEqual(parentMf.original_sha256, parentMf.redacted_sha256);
  assert.equal(parentMf.redaction_count, 3);
  assert.deepEqual(parentMf.redaction_counts_by_type, {
    database_url_assignment: 1,
    google_api_key: 1,
    password_var_assignment: 1,
  });

  // Subagent transcript and run folder MUST be byte-for-byte unchanged
  const sub1ZipPath = `transcripts/subagent/${SUB1_UUID}/transcript.jsonl`;
  const sub1Mf = manifest.files.find(f => f.zip_path === sub1ZipPath);
  const sub1ArchivedSha = crypto.createHash("sha256").update(zipEntries.get(sub1ZipPath)).digest("hex");
  assert.equal(sub1Mf.redacted, false);
  assert.equal(sub1ArchivedSha, origSub1Sha);

  const rawScoresMf = manifest.files.find(f => f.zip_path === "run/raw_scores.jsonl");
  const rawScoresArchivedSha = crypto.createHash("sha256").update(zipEntries.get("run/raw_scores.jsonl")).digest("hex");
  assert.equal(rawScoresMf.redacted, false);
  assert.equal(rawScoresArchivedSha, origRawScoresSha);
});

test("archiveRunEvidence DOES NOT redact subagent transcripts and aborts without saving if secret is in subagent log", (t) => {
  const { repoRoot, brainRoot, outDir, runId } = makeFixture(t, {
    sub1TranscriptExtra:
      JSON.stringify({ step_index: 2, content: "leaked in subagent AIzaSyC12345678901234567890123456789012" }) + "\n",
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
  assert.equal(res.redaction.total_replacements, 0);
  assert.ok(res.secret_scan.findings.some(f => f.file.includes(SUB1_UUID)));
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
    maxSizeMb: 0.0001,
    envFiles: [path.join(repoRoot, ".env")],
  });
  assert.equal(res.saved, false);
  assert.match(res.blocked_reason, /zip_exceeds_max_size_mb/);
  assert.equal(fs.existsSync(res.dest_zip_path), false);
});
