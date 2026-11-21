/**
 * Apply visual audit findings & real cut pacing telemetry for the CURRENT WAVE ONLY.
 *
 * Safeguards (Review #8):
 *   1. Requires `--from-jsonl=<wave_progress.jsonl>` (fail-closed: never replays historical full_audit_progress.jsonl).
 *   2. Deduplicates by video_id keeping ONLY the latest entry BEFORE checking visual_checked.
 *   3. Patches ONLY rows whose TiDB `aiScoreBreakdown.visualVerificationStatus === "log_verified"`.
 *   4. Verifies `base_analysis_sha256` against TiDB's current base body (excluding audit Ch.11) before patching.
 *   5. Replaces ONLY the `## 11. 実映像ビジュアル監査・実測補正` section (preserving any other sections).
 *
 * Usage:
 *   DATABASE_URL=... node scripts/apply-audit-patches.mjs --from-jsonl=<path> [--apply]
 */
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import mysql from "mysql2/promise";

const apply = process.argv.includes("--apply");
const fromArg = process.argv.find((a) => a.startsWith("--from-jsonl="))?.slice("--from-jsonl=".length)?.trim();
if (!fromArg) {
  throw new Error("FAIL-CLOSED: --from-jsonl=<wave_progress.jsonl> is required. Replaying historical full_audit_progress.jsonl is forbidden.");
}
if (!existsSync(fromArg)) {
  throw new Error(`Not found: ${fromArg}`);
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required.");
}

const MARKER = "## 11. 実映像ビジュアル監査・実測補正";
const AUDIT_CH11_RE = /(?:\r?\n)*## 11\. 実映像ビジュアル監査・実測補正[\s\S]*?(?=\r?\n## |\s*$)/;

function stripAuditCh11(text) {
  return String(text || "").replace(AUDIT_CH11_RE, "").trim();
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

const redoIds = new Set(
  existsSync("analysis/visual_redo_queue.json")
    ? JSON.parse(readFileSync("analysis/visual_redo_queue.json", "utf8")).map((x) => String(x.video_id))
    : []
);

// 1. Deduplicate by video_id FIRST (latest entry wins), THEN filter visual_checked & non-redo
const latestById = new Map();
for (const line of readFileSync(fromArg, "utf8").split(/\r?\n/)) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  if (r.video_id) latestById.set(String(r.video_id), r);
}

const eligibleById = new Map();
for (const [vid, r] of latestById.entries()) {
  if (r.visual_checked === true && !redoIds.has(vid)) {
    eligibleById.set(vid, r);
  }
}

const ids = Array.from(eligibleById.keys());
if (ids.length === 0) {
  console.log(JSON.stringify({ ok: true, patched: 0, skippedNotLogVerified: 0, skippedHashMismatch: 0 }));
  process.exit(0);
}

function buildAuditSection(r) {
  const rc = r.real_cuts && typeof r.real_cuts === "object" && r.real_cuts.cut_count
    ? `実カット数: ${r.real_cuts.cut_count}カット / 実平均カット尺: ${r.real_cuts.avg_cut_sec}秒 / 中央値: ${r.real_cuts.median_cut_sec}秒（${r.real_cuts.cuts_per_minute}カット/分）`
    : "実カット計測: メディア取得制限により未計測";
  const lines = [
    MARKER,
    `- **監査判定**: \`${r.analysis_verdict}\`（静止画コンタクトシート確認: ログ照合済）`,
    `- **実映像カット実測値（ffmpeg scdet）**: ${rc}`,
    `- **100点ルーブリック確定スコア**: 総合/演出/技術 = \`${r.scores100}\`（ランク \`${r.ratings}\`）`,
    `- **監査・補正メモ**: ${r.audit_findings}`,
  ];
  if (r.grade_change_reason) {
    lines.push(`- **ランク変更理由**: ${r.grade_change_reason}`);
  }
  return lines.join("\n");
}

const needsTls = /tidbcloud\.com|psdb\.cloud|aivencloud\.com/i.test(process.env.DATABASE_URL);
const db = await mysql.createConnection({
  uri: process.env.DATABASE_URL,
  ...(needsTls ? { ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true } } : {}),
});

let patched = 0;
let skippedNotLogVerified = 0;
let skippedMissingHash = 0;
let skippedHashMismatch = 0;
const missingHashIds = [];
const hashMismatchIds = [];

try {
  const [rows] = await db.query("SELECT id, aiAnalysis, aiScoreBreakdown FROM videos WHERE id IN (?)", [ids]);
  for (const row of rows) {
    const vid = String(row.id);
    const r = eligibleById.get(vid);
    if (!r) continue;

    let bd = {};
    try { bd = row.aiScoreBreakdown ? JSON.parse(row.aiScoreBreakdown) : {}; } catch {}
    if (bd.visualVerificationStatus !== "log_verified") {
      skippedNotLogVerified++;
      continue;
    }

    if (!r.base_analysis_sha256) {
      skippedMissingHash++;
      missingHashIds.push(vid);
      continue;
    }

    const currentFull = String(row.aiAnalysis || "");
    const baseWithoutAudit = stripAuditCh11(currentFull);
    const currentHash = sha256Hex(baseWithoutAudit);
    if (currentHash !== r.base_analysis_sha256) {
      skippedHashMismatch++;
      hashMismatchIds.push(vid);
      continue;
    }

    const section = buildAuditSection(r);
    let next;
    if (AUDIT_CH11_RE.test(currentFull)) {
      next = currentFull.replace(AUDIT_CH11_RE, `\n\n${section}`).trim();
    } else {
      next = baseWithoutAudit ? `${baseWithoutAudit}\n\n${section}` : section;
    }

    if (next !== currentFull) {
      if (apply) {
        await db.execute("UPDATE videos SET aiAnalysis = ? WHERE id = ?", [next, vid]);
      }
      patched += 1;
    }
  }
} finally {
  await db.end();
}

console.log(JSON.stringify({
  ok: true,
  apply,
  waveEligible: ids.length,
  patched,
  skippedNotLogVerified,
  skippedMissingHash,
  skippedHashMismatch,
  missingHashIds,
  hashMismatchIds,
}));
