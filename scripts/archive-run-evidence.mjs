#!/usr/bin/env node
/**
 * Archive audit evidence for a completed Phase 3 calibration run into a verified ZIP file.
 *
 * Implements DECISIONS.md D-019:
 *  - Collects parent and scorer subagent conversation IDs from
 *    `analysis/runs/<run_id>/dispatch_log.jsonl` and `raw_scores.jsonl`
 *    (and resolves parent IDs referenced in subagent transcripts when not stored inline).
 *  - Collects ONLY `.system_generated/logs/transcript*.jsonl` from each conversation's
 *    Antigravity brain folder (strictly excluding media/screenshots/chunks/scratch).
 *  - Bundles those transcripts together with `analysis/runs/<run_id>/` and a `manifest.json`
 *    (file list + SHA-256, conversation IDs, created_at, worker PC).
 *  - Scans EVERY collected file for secrets (API keys, DATABASE_URL, mysql:// credentials,
 *    private keys, .env secret values) BEFORE writing any archive; aborts without saving
 *    if even a single secret is detected.
 *  - Enforces max archive size guard (default 200 MB); aborts without saving if exceeded.
 *
 * Does NOT modify any frozen Phase 2 files or run files.
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..");
export const DEFAULT_ARCHIVE_DIR = "D:\\マイドライブ\\iketeru_evidence_archive";
export const DEFAULT_MAX_SIZE_MB = 200;

export const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRANSCRIPT_FILENAME_RE = /^transcript(?:_[A-Za-z0-9_-]+)?\.jsonl$/i;

// Non-secret config keys in .env that legitimately appear in logs/paths
const NON_SECRET_ENV_KEYS = new Set([
  "IKETERU_WORKER_NAME",
  "IKETERU_VIDEO_CACHE_DIR",
  "IKETERU_BLIND_ROOT",
  "IKETERU_BACKUP_ROOT",
  "IKETERU_PRE_D_BACKUP_PATH",
  "IKETERU_EVIDENCE_ARCHIVE_DIR",
  "ANTIGRAVITY_BRAIN_ROOT",
  "PYTHONUTF8",
  "PYTHONIOENCODING",
  "NODE_ENV",
  "PORT",
  "HOST",
  "TZ",
  "LANG",
  "LC_ALL",
]);

const PLACEHOLDER_VALUE_RE = /^(?:<[^>]+>|REDACTED|YOUR_[A-Z0-9_]+|CHANGE_ME|REPLACE_ME|DUMMY|EXAMPLE|TEST_KEY|xxx+|\*{4,}|\.{3,})$/i;

export const SECRET_PATTERNS = Object.freeze([
  {
    name: "mysql_connection_url",
    re: /mysql2?:\/\/[^:\s"'`<>\\]+:[^@\s"'`<>\\]+@[^\s"'`<>\\]+/gi,
  },
  {
    name: "db_connection_url_with_creds",
    re: /(?:postgres(?:ql)?|mongodb(?:\+srv)?|rediss?):\/\/[^:\s"'`<>\\]+:[^@\s"'`<>\\]+@[^\s"'`<>\\]+/gi,
  },
  {
    name: "database_url_assignment",
    re: /\b(?:DATABASE_URL|TIDB_URL)\s*[:=]\s*["']?(?:mysql2?|postgres(?:ql)?|mongodb(?:\+srv)?):\/\/[^\s"'`<>\\]+/gi,
  },
  {
    name: "google_api_key",
    re: /\bAIza[0-9A-Za-z_-]{33,}\b/g,
  },
  {
    name: "openai_api_key",
    re: /\bsk-(?:proj-|live-|test-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    name: "anthropic_api_key",
    re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    name: "github_token",
    re: /\b(?:ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}|ghu_[A-Za-z0-9]{36}|ghs_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,})\b/g,
  },
  {
    name: "aws_access_key_id",
    re: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    name: "slack_token",
    re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g,
  },
  {
    name: "private_key_block",
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
  {
    name: "auth_header_token",
    re: /(?:Authorization\s*:\s*Bearer|x-goog-api-key\s*:)\s+[A-Za-z0-9._-]{20,}/gi,
  },
  {
    name: "secret_env_assignment",
    re: /\b(?:GEMINI_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|TIDB_PASSWORD|DB_PASSWORD|AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN|GCLI_ACCESS_TOKEN|GOOGLE_API_KEY)\s*=\s*["']?([A-Za-z0-9_./+:@-]{12,})["']?/g,
  },
]);

export const VALUE_FLAGS = Object.freeze(
  new Set([
    "run-id",
    "out-dir",
    "brain-root",
    "repo-root",
    "worker",
    "max-size-mb",
    "parent-id",
    "env-file",
  ])
);

const BOOL_FLAGS = Object.freeze(new Set(["dry-run", "overwrite", "help"]));

export function parseArgs(argv) {
  const args = {
    runId: null,
    dryRun: false,
    overwrite: false,
    help: false,
    outDir: null,
    brainRoot: null,
    repoRoot: null,
    worker: null,
    maxSizeMb: DEFAULT_MAX_SIZE_MB,
    parentIds: [],
    envFiles: [],
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") {
      args.help = true;
      continue;
    }
    if (a.startsWith("--")) {
      const k = a.slice(2);
      if (BOOL_FLAGS.has(k)) {
        if (k === "dry-run") args.dryRun = true;
        if (k === "overwrite") args.overwrite = true;
        if (k === "help") args.help = true;
        continue;
      }
      if (!VALUE_FLAGS.has(k)) {
        throw new Error(`Unknown flag: ${a}`);
      }
      const next = argv[i + 1];
      if (next === undefined || next === "" || next.startsWith("--")) {
        throw new Error(`Missing value for --${k}`);
      }
      i++;
      switch (k) {
        case "run-id":
          args.runId = next;
          break;
        case "out-dir":
          args.outDir = next;
          break;
        case "brain-root":
          args.brainRoot = next;
          break;
        case "repo-root":
          args.repoRoot = next;
          break;
        case "worker":
          args.worker = next;
          break;
        case "max-size-mb": {
          const parsed = Number(next);
          if (!Number.isFinite(parsed) || parsed <= 0) {
            throw new Error(`Invalid --max-size-mb "${next}" (must be a positive number)`);
          }
          args.maxSizeMb = parsed;
          break;
        }
        case "parent-id":
          for (const id of next.split(",").map(s => s.trim()).filter(Boolean)) {
            args.parentIds.push(id);
          }
          break;
        case "env-file":
          args.envFiles.push(next);
          break;
      }
    } else if (!args.runId) {
      args.runId = a;
    } else {
      throw new Error(`Unexpected positional argument: ${a}`);
    }
  }
  return args;
}

function loadDotenv(repoRoot) {
  const envPath = path.join(repoRoot, ".env");
  if (!fs.existsSync(envPath)) return;
  try {
    const require = createRequire(path.join(DEFAULT_REPO_ROOT, "package.json"));
    require("dotenv").config({ path: envPath, quiet: true });
  } catch {
    // Fallback minimal parser if dotenv cannot be resolved from temp test dirs
    const parsed = parseEnvFile(envPath);
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
  }
}

export function parseEnvFile(envPath) {
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).replace(/^export\s+/, "").trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
    ) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

export function extractEnvSecretValues(envPaths) {
  const entries = [];
  const seenVal = new Set();
  const checkedFiles = [];

  for (const envPath of envPaths) {
    if (!envPath || !fs.existsSync(envPath)) continue;
    checkedFiles.push(envPath);
    const parsed = parseEnvFile(envPath);
    for (const [key, val] of Object.entries(parsed)) {
      if (!val || NON_SECRET_ENV_KEYS.has(key)) continue;
      if (PLACEHOLDER_VALUE_RE.test(val)) continue;
      if (val.length >= 8 && !seenVal.has(val)) {
        seenVal.add(val);
        entries.push({ key, label: `env_value:${key}`, value: val });
      }
      // If the env value is a connection URL with credentials, also watch its password and user:pass
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(val)) {
        try {
          const u = new URL(val);
          const candidates = [];
          if (u.password && u.password.length >= 8) {
            candidates.push({ suffix: "password", value: u.password });
            try {
              const decoded = decodeURIComponent(u.password);
              if (decoded !== u.password && decoded.length >= 8) {
                candidates.push({ suffix: "password_decoded", value: decoded });
              }
            } catch {
              // ignore malformed percent encoding
            }
          }
          if (u.username && u.password && u.password.length >= 4) {
            candidates.push({ suffix: "userinfo", value: `${u.username}:${u.password}` });
          }
          for (const c of candidates) {
            if (!PLACEHOLDER_VALUE_RE.test(c.value) && !seenVal.has(c.value)) {
              seenVal.add(c.value);
              entries.push({ key, label: `env_value:${key}.${c.suffix}`, value: c.value });
            }
          }
        } catch {
          // ignore non-standard URLs
        }
      }
    }
  }
  return { entries, checkedFiles };
}

export function redactMatch(str) {
  const s = String(str || "");
  if (s.length <= 8) return `<redacted len=${s.length}>`;
  return `${s.slice(0, 4)}...${s.slice(-2)} (len=${s.length})`;
}

export function scanTextForSecrets(text, zipPath, envSecretEntries = []) {
  const findings = [];
  const lines = text.split(/\r?\n/);

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (!line) continue;
    const lineNum = idx + 1;

    for (const pat of SECRET_PATTERNS) {
      pat.re.lastIndex = 0;
      let match;
      while ((match = pat.re.exec(line)) !== null) {
        const matchedStr = match[0];
        const capturedVal = match[1] || matchedStr;
        if (PLACEHOLDER_VALUE_RE.test(capturedVal)) continue;
        // Skip obvious documentation placeholders like mysql://user:pass@host
        if (
          (pat.name === "mysql_connection_url" || pat.name === "db_connection_url_with_creds") &&
          /:\/\/(?:user|username|root|<[^>]+>):(?:pass|password|<[^>]+>)@(?:host|localhost|127\.0\.0\.1|example\.com)\b/i.test(matchedStr)
        ) {
          continue;
        }
        findings.push({
          file: zipPath,
          line: lineNum,
          rule: pat.name,
          sample: redactMatch(matchedStr),
        });
        if (findings.length >= 50) return findings;
      }
    }

    for (const secret of envSecretEntries) {
      if (line.includes(secret.value)) {
        findings.push({
          file: zipPath,
          line: lineNum,
          rule: secret.label,
          sample: redactMatch(secret.value),
        });
        if (findings.length >= 50) return findings;
      }
    }
  }
  return findings;
}

export function scanFilesForSecrets(files, envSecretEntries = []) {
  const allFindings = [];
  for (const f of files) {
    const content = fs.readFileSync(f.sourcePath, "utf8");
    const hits = scanTextForSecrets(content, f.zipPath, envSecretEntries);
    for (const h of hits) {
      allFindings.push(h);
      if (allFindings.length >= 100) {
        return { passed: false, findings: allFindings, truncated: true };
      }
    }
  }
  return { passed: allFindings.length === 0, findings: allFindings, truncated: false };
}

function readJsonlRecords(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    out.push(JSON.parse(trimmed));
  }
  return out;
}

export function extractParentIdsFromTranscript(transcriptPath, ownSubagentId = null) {
  const found = new Set();
  if (!fs.existsSync(transcriptPath)) return found;
  const raw = fs.readFileSync(transcriptPath, "utf8");
  for (const m of raw.matchAll(/\bsender=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi)) {
    const id = m[1].toLowerCase();
    if (!ownSubagentId || id !== ownSubagentId.toLowerCase()) found.add(id);
  }
  for (const m of raw.matchAll(/"Recipient"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/gi)) {
    const id = m[1].toLowerCase();
    if (!ownSubagentId || id !== ownSubagentId.toLowerCase()) found.add(id);
  }
  return found;
}

export function collectConversationIds(runDir, brainRoot, extraParentIds = []) {
  const dispatchPath = path.join(runDir, "dispatch_log.jsonl");
  const rawScoresPath = path.join(runDir, "raw_scores.jsonl");

  const dispatchRecords = readJsonlRecords(dispatchPath);
  const rawScoreRecords = readJsonlRecords(rawScoresPath);

  const subagentSet = new Set();
  const parentSet = new Set();

  for (const pid of extraParentIds) {
    if (UUID_RE.test(pid)) parentSet.add(pid.toLowerCase());
  }

  for (const rec of [...dispatchRecords, ...rawScoreRecords]) {
    for (const candidate of [rec.subagent_id, rec.worker_conversation_id]) {
      if (typeof candidate === "string" && UUID_RE.test(candidate.trim())) {
        subagentSet.add(candidate.trim().toLowerCase());
      }
    }
    for (const candidate of [rec.parent_id, rec.parent_conversation_id, rec.parentId]) {
      if (typeof candidate === "string" && UUID_RE.test(candidate.trim())) {
        parentSet.add(candidate.trim().toLowerCase());
      }
    }
  }

  // Resolve parent conversation IDs from subagent transcripts if not already recorded inline
  for (const sid of subagentSet) {
    const tPath = path.join(brainRoot, sid, ".system_generated", "logs", "transcript.jsonl");
    for (const pid of extractParentIdsFromTranscript(tPath, sid)) {
      if (!subagentSet.has(pid)) parentSet.add(pid);
    }
  }

  return {
    parentIds: [...parentSet].sort(),
    subagentIds: [...subagentSet].sort(),
    dispatchCount: dispatchRecords.length,
    rawScoresCount: rawScoreRecords.length,
  };
}

function walkRunDirectory(baseDir, currentDir, out) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      walkRunDirectory(baseDir, fullPath, out);
    } else if (entry.isFile()) {
      const rel = path.relative(baseDir, fullPath).split(path.sep).join("/");
      const stat = fs.statSync(fullPath);
      out.push({
        sourcePath: fullPath,
        zipPath: `run/${rel}`,
        category: "run_folder",
        sizeBytes: stat.size,
      });
    }
  }
}

export function collectTranscriptFilesForConversation(brainRoot, convId, role) {
  const logsDir = path.join(brainRoot, convId, ".system_generated", "logs");
  if (!fs.existsSync(logsDir) || !fs.statSync(logsDir).isDirectory()) {
    return { files: [], missing: true };
  }
  const files = [];
  const entries = fs.readdirSync(logsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    if (!TRANSCRIPT_FILENAME_RE.test(entry.name)) continue;
    const fullPath = path.join(logsDir, entry.name);
    const stat = fs.statSync(fullPath);
    files.push({
      sourcePath: fullPath,
      zipPath: `transcripts/${role}/${convId}/${entry.name}`,
      category: role === "parent" ? "parent_transcript" : "subagent_transcript",
      conversationId: convId,
      sizeBytes: stat.size,
    });
  }
  return { files, missing: files.length === 0 };
}

export function collectEvidenceFiles(runDir, brainRoot, { parentIds, subagentIds }) {
  const files = [];
  walkRunDirectory(runDir, runDir, files);

  const missingInBrain = [];
  for (const pid of parentIds) {
    const res = collectTranscriptFilesForConversation(brainRoot, pid, "parent");
    if (res.missing) missingInBrain.push({ role: "parent", conversation_id: pid });
    files.push(...res.files);
  }
  for (const sid of subagentIds) {
    const res = collectTranscriptFilesForConversation(brainRoot, sid, "subagent");
    if (res.missing) missingInBrain.push({ role: "subagent", conversation_id: sid });
    files.push(...res.files);
  }

  return { files, missingInBrain };
}

export function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

// --- Pure Node.js standard ZIP writer (DEFLATE + CRC32 + UTF-8 filenames) ---

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function toDosTimeDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  const year = Math.max(1980, Math.min(2107, d.getUTCFullYear()));
  const dosDate = ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  const dosTime = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2);
  return { dosTime, dosDate };
}

/**
 * Write entries to a ZIP file on disk without keeping all file buffers in RAM.
 * Each entry: { zipPath: string, sourcePath?: string, buffer?: Buffer, mtime?: Date }
 */
export function writeZipFile(destPath, entries) {
  const fd = fs.openSync(destPath, "w");
  const centralRecords = [];
  let offset = 0;

  try {
    for (const entry of entries) {
      const nameBuf = Buffer.from(entry.zipPath.replace(/\\/g, "/"), "utf8");
      const rawBuf = entry.buffer !== undefined ? entry.buffer : fs.readFileSync(entry.sourcePath);
      const mtime = entry.mtime || (entry.sourcePath ? fs.statSync(entry.sourcePath).mtime : new Date());
      const { dosTime, dosDate } = toDosTimeDate(mtime);
      const crc = crc32(rawBuf);
      const compressed = zlib.deflateRawSync(rawBuf, { level: 6 });

      // Use DEFLATE if smaller, otherwise STORE
      const useDeflate = compressed.length < rawBuf.length;
      const payload = useDeflate ? compressed : rawBuf;
      const method = useDeflate ? 8 : 0;

      // Local File Header (30 bytes + filename)
      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(0x04034b50, 0); // signature
      localHeader.writeUInt16LE(20, 4); // version needed to extract (2.0)
      localHeader.writeUInt16LE(0x0800, 6); // general purpose bit flag: UTF-8
      localHeader.writeUInt16LE(method, 8); // compression method
      localHeader.writeUInt16LE(dosTime, 10);
      localHeader.writeUInt16LE(dosDate, 12);
      localHeader.writeUInt32LE(crc, 14);
      localHeader.writeUInt32LE(payload.length, 18);
      localHeader.writeUInt32LE(rawBuf.length, 22);
      localHeader.writeUInt16LE(nameBuf.length, 26);
      localHeader.writeUInt16LE(0, 28); // extra field length

      const localHeaderOffset = offset;
      fs.writeSync(fd, localHeader);
      fs.writeSync(fd, nameBuf);
      fs.writeSync(fd, payload);
      offset += localHeader.length + nameBuf.length + payload.length;

      centralRecords.push({
        nameBuf,
        method,
        dosTime,
        dosDate,
        crc,
        compressedSize: payload.length,
        uncompressedSize: rawBuf.length,
        localHeaderOffset,
      });
    }

    const centralDirOffset = offset;
    let centralDirSize = 0;

    for (const rec of centralRecords) {
      const cdHeader = Buffer.alloc(46);
      cdHeader.writeUInt32LE(0x02014b50, 0); // central file header signature
      cdHeader.writeUInt16LE(20, 4); // version made by
      cdHeader.writeUInt16LE(20, 6); // version needed
      cdHeader.writeUInt16LE(0x0800, 8); // UTF-8 flag
      cdHeader.writeUInt16LE(rec.method, 10);
      cdHeader.writeUInt16LE(rec.dosTime, 12);
      cdHeader.writeUInt16LE(rec.dosDate, 14);
      cdHeader.writeUInt32LE(rec.crc, 16);
      cdHeader.writeUInt32LE(rec.compressedSize, 20);
      cdHeader.writeUInt32LE(rec.uncompressedSize, 24);
      cdHeader.writeUInt16LE(rec.nameBuf.length, 28);
      cdHeader.writeUInt16LE(0, 30); // extra length
      cdHeader.writeUInt16LE(0, 32); // comment length
      cdHeader.writeUInt16LE(0, 34); // disk number start
      cdHeader.writeUInt16LE(0, 36); // internal file attributes
      cdHeader.writeUInt32LE(0, 38); // external file attributes
      cdHeader.writeUInt32LE(rec.localHeaderOffset, 42);

      fs.writeSync(fd, cdHeader);
      fs.writeSync(fd, rec.nameBuf);
      centralDirSize += cdHeader.length + rec.nameBuf.length;
    }

    // End of Central Directory Record (22 bytes)
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4); // disk number
    eocd.writeUInt16LE(0, 6); // disk with start of central dir
    eocd.writeUInt16LE(centralRecords.length, 8);
    eocd.writeUInt16LE(centralRecords.length, 10);
    eocd.writeUInt32LE(centralDirSize, 12);
    eocd.writeUInt32LE(centralDirOffset, 16);
    eocd.writeUInt16LE(0, 20); // comment length

    fs.writeSync(fd, eocd);
  } finally {
    fs.closeSync(fd);
  }
}

function getRepoHead(repoRoot) {
  try {
    return execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function resolveWorkerName(argWorker, repoRoot) {
  loadDotenv(repoRoot);
  const name = String(argWorker || process.env.IKETERU_WORKER_NAME || "").trim();
  if (!name) {
    throw new Error(
      "Worker name is required: pass --worker <name> or set IKETERU_WORKER_NAME in .env / environment. " +
        "(OS hostname fallback is disabled.)"
    );
  }
  return name;
}

export function archiveRunEvidence(options) {
  const repoRoot = path.resolve(options.repoRoot || DEFAULT_REPO_ROOT);
  const runId = String(options.runId || "").trim();
  if (!runId || !RUN_ID_RE.test(runId)) {
    throw new Error(`Invalid run_id "${runId}". Expected pattern ${RUN_ID_RE}`);
  }

  const worker = resolveWorkerName(options.worker, repoRoot);
  const brainRoot = path.resolve(
    options.brainRoot ||
      process.env.ANTIGRAVITY_BRAIN_ROOT ||
      path.join(os.homedir(), ".gemini", "antigravity", "brain")
  );
  const outDir = path.resolve(
    options.outDir || process.env.IKETERU_EVIDENCE_ARCHIVE_DIR || DEFAULT_ARCHIVE_DIR
  );
  const maxSizeMb = Number(options.maxSizeMb ?? DEFAULT_MAX_SIZE_MB);
  const maxSizeBytes = Math.floor(maxSizeMb * 1024 * 1024);
  const dryRun = Boolean(options.dryRun);
  const overwrite = Boolean(options.overwrite);

  const runDir = path.join(repoRoot, "analysis", "runs", runId);
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    throw new Error(`Run directory not found: ${runDir}`);
  }

  // Resolve .env files to scan against
  const defaultEnvFiles = [
    path.join(repoRoot, ".env"),
    "E:\\iketeru-creative-studio\\.env",
  ];
  const envFilesToCheck = [
    ...new Set(
      (options.envFiles && options.envFiles.length > 0 ? options.envFiles : defaultEnvFiles).map(p =>
        path.resolve(p)
      )
    ),
  ];
  const { entries: envSecretEntries, checkedFiles: envFilesChecked } =
    extractEnvSecretValues(envFilesToCheck);

  // 1. Collect conversation IDs
  const convInfo = collectConversationIds(runDir, brainRoot, options.parentIds || []);

  // 2. Collect run files + transcript-only files
  const { files, missingInBrain } = collectEvidenceFiles(runDir, brainRoot, convInfo);

  const runFolderFiles = files.filter(f => f.category === "run_folder");
  const parentTranscriptFiles = files.filter(f => f.category === "parent_transcript");
  const subagentTranscriptFiles = files.filter(f => f.category === "subagent_transcript");
  const totalUncompressedBytes = files.reduce((acc, f) => acc + f.sizeBytes, 0);

  // 3. Secret scan (ALWAYS runs in both dry-run and write mode)
  const secretScan = scanFilesForSecrets(files, envSecretEntries);

  const destZipPath = path.join(outDir, `${runId}.zip`);
  const baseSummary = {
    mode: dryRun ? "dry_run" : "archive",
    run_id: runId,
    worker,
    dest_zip_path: destZipPath,
    max_size_mb: maxSizeMb,
    conversation_ids: {
      parent: convInfo.parentIds,
      subagent_count: convInfo.subagentIds.length,
      missing_in_brain: missingInBrain,
    },
    counts: {
      total_evidence_files: files.length,
      total_zip_entries_with_manifest: files.length + 1,
      run_folder_files: runFolderFiles.length,
      parent_transcript_files: parentTranscriptFiles.length,
      subagent_transcript_files: subagentTranscriptFiles.length,
    },
    total_uncompressed_bytes: totalUncompressedBytes,
    total_uncompressed_mb: Number((totalUncompressedBytes / (1024 * 1024)).toFixed(2)),
    uncompressed_exceeds_max_size: totalUncompressedBytes > maxSizeBytes,
    secret_scan: {
      passed: secretScan.passed,
      findings_count: secretScan.findings.length,
      truncated: secretScan.truncated,
      env_files_checked: envFilesChecked,
      env_secret_values_loaded: envSecretEntries.length,
      findings: secretScan.findings,
    },
  };

  if (dryRun) {
    return {
      ...baseSummary,
      saved: false,
      blocked_reason: !secretScan.passed ? "secret_detected" : null,
    };
  }

  // Fail closed on secrets BEFORE creating any archive
  if (!secretScan.passed) {
    return {
      ...baseSummary,
      saved: false,
      blocked_reason: "secret_detected",
    };
  }

  if (fs.existsSync(destZipPath) && !overwrite) {
    throw new Error(`Destination zip already exists (use --overwrite to replace): ${destZipPath}`);
  }

  // 4. Build manifest.json with per-file SHA-256
  const createdAt = new Date().toISOString();
  const manifestFiles = files.map(f => ({
    zip_path: f.zipPath,
    category: f.category,
    size_bytes: f.sizeBytes,
    sha256: sha256File(f.sourcePath),
  }));

  const manifest = {
    schema_version: 1,
    run_id: runId,
    created_at: createdAt,
    worker,
    repo_head: getRepoHead(repoRoot),
    conversation_ids: {
      parent: convInfo.parentIds,
      subagent: convInfo.subagentIds,
      missing_in_brain: missingInBrain,
    },
    summary: {
      file_count: manifestFiles.length,
      run_folder_files: runFolderFiles.length,
      parent_transcript_files: parentTranscriptFiles.length,
      subagent_transcript_files: subagentTranscriptFiles.length,
      total_uncompressed_bytes: totalUncompressedBytes,
    },
    secret_scan: {
      passed: true,
      findings_count: 0,
      env_files_checked: envFilesChecked.map(p => path.basename(p)),
      patterns_checked: SECRET_PATTERNS.map(p => p.name),
    },
    files: manifestFiles,
  };

  const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8");

  // 5. Write zip to a local temp file first, verify size <= maxSizeBytes, then move atomically
  const tmpZipPath = path.join(
    os.tmpdir(),
    `iketeru_evidence_${runId}_${process.pid}_${crypto.randomBytes(4).toString("hex")}.zip`
  );

  try {
    const zipEntries = [
      { zipPath: "manifest.json", buffer: manifestBuf, mtime: new Date(createdAt) },
      ...files.map(f => ({ zipPath: f.zipPath, sourcePath: f.sourcePath })),
    ];
    writeZipFile(tmpZipPath, zipEntries);

    const zipSizeBytes = fs.statSync(tmpZipPath).size;
    const zipSizeMb = Number((zipSizeBytes / (1024 * 1024)).toFixed(2));
    if (zipSizeBytes > maxSizeBytes) {
      return {
        ...baseSummary,
        saved: false,
        blocked_reason: `zip_exceeds_max_size_mb (${zipSizeMb} MB > ${maxSizeMb} MB)`,
        zip_size_bytes: zipSizeBytes,
        zip_size_mb: zipSizeMb,
      };
    }

    const zipSha256 = sha256File(tmpZipPath);

    fs.mkdirSync(outDir, { recursive: true });
    const partPath = `${destZipPath}.part.${process.pid}`;
    try {
      fs.copyFileSync(tmpZipPath, partPath);
      const copiedSha256 = sha256File(partPath);
      if (copiedSha256 !== zipSha256) {
        throw new Error(`Post-copy SHA-256 mismatch: expected ${zipSha256}, got ${copiedSha256}`);
      }
      fs.renameSync(partPath, destZipPath);
    } catch (err) {
      if (fs.existsSync(partPath)) {
        try {
          fs.unlinkSync(partPath);
        } catch {
          // ignore cleanup failure
        }
      }
      throw err;
    }

    return {
      ...baseSummary,
      saved: true,
      blocked_reason: null,
      created_at: createdAt,
      zip_size_bytes: zipSizeBytes,
      zip_size_mb: zipSizeMb,
      zip_sha256: zipSha256,
    };
  } finally {
    if (fs.existsSync(tmpZipPath)) {
      try {
        fs.unlinkSync(tmpZipPath);
      } catch {
        // ignore cleanup failure
      }
    }
  }
}

function printUsage() {
  console.log(`Usage:
  node scripts/archive-run-evidence.mjs <run_id> [--dry-run] [--worker <name>] [--out-dir <path>] [--max-size-mb 200] [--overwrite]

Options:
  --run-id <id>       Run ID (alternatively pass as first positional argument)
  --dry-run           Inspect files, sizes, and secret scan without writing the zip
  --worker <name>     Worker PC name (defaults to IKETERU_WORKER_NAME in .env / env)
  --out-dir <path>    Destination folder (default: ${DEFAULT_ARCHIVE_DIR})
  --brain-root <path> Antigravity brain root (default: ~/.gemini/antigravity/brain)
  --repo-root <path>  Repository root (default: E:\\iketeru-eizou)
  --parent-id <id>    Additional parent conversation ID(s), comma-separated
  --max-size-mb <N>   Abort without saving if zip exceeds N MB (default: ${DEFAULT_MAX_SIZE_MB})
  --overwrite         Overwrite existing <run_id>.zip in destination folder
`);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.runId) {
    printUsage();
    process.exit(args.help ? 0 : 2);
  }
  const result = archiveRunEvidence(args);
  console.log(JSON.stringify(result, null, 2));
  if (result.blocked_reason) {
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(`[archive-run-evidence] ERROR: ${err.message}`);
    process.exit(1);
  }
}
