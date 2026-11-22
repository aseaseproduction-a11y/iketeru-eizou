import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import mysql from "mysql2/promise";

const REPO_ROOT = "E:\\iketeru-eizou";
const APPLY = process.argv.includes("--apply");
const BACKUP_PATH = path.join(REPO_ROOT, "analysis", "backup_537_option_c_before.json");
const REAUDIT_QUEUE_PATH = path.join(REPO_ROOT, "analysis", "reaudit_queue_537.json");

const envText = fs.readFileSync(path.join(REPO_ROOT, ".env"), "utf8").replace(/^\uFEFF/, "");
const dbUrl = envText.match(/^DATABASE_URL=(.+)$/m)[1].trim();

const AUDIT_CH11_RE = /(?:\r?\n)*## 11\. 実映像ビジュアル監査・実測補正[\s\S]*?(?=\r?\n## |\s*$)/;
const GENERIC_CH11_RE = /(?:\r?\n)*## 11\.[\s\S]*$/;
const MARKER = "## 11. 実映像ビジュアル監査・実測補正";

function sha256(s) {
  return crypto.createHash("sha256").update(String(s || ""), "utf8").digest("hex");
}

function normBase(text) {
  return String(text || "").replace(GENERIC_CH11_RE, "").replace(/\s+/g, " ").trim();
}

// 1. Load SQLite base bodies via small Python helper
const sqOut = execFileSync(
  "python",
  [
    "-c",
    "import json, sqlite3; con=sqlite3.connect(r'E:\\iketeru-creative-studio\\data\\iketeru_knowledge.db'); print(json.dumps({str(r[0]): r[1] or '' for r in con.execute('SELECT id, ai_analysis FROM videos').fetchall()}, ensure_ascii=False))",
  ],
  { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }
);
const sqBodies = JSON.parse(sqOut);

const conn = await mysql.createConnection({
  uri: dbUrl,
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});

const [allRows] = await conn.query(
  `SELECT id, title, platform, aiOverallRating, aiDirectionRating, aiTechniqueRating,
          aiOverallScore, aiDirectionScore, aiTechniqueScore, aiScoreBreakdown, aiAnalysis
     FROM videos`
);

// Record pre-execution hashes for ALL videos on TiDB
const preHashes = new Map();
for (const r of allRows) {
  preHashes.set(String(r.id), sha256(r.aiAnalysis || ""));
}

// Identify the exact 537 targets (common with SQLite, TiDB has ## 11., stripped base body differs from SQLite)
const targets = [];
for (const r of allRows) {
  const id = String(r.id);
  if (!(id in sqBodies)) continue;
  const tFull = String(r.aiAnalysis || "");
  if (!tFull.includes("## 11.")) continue;
  if (normBase(tFull) !== normBase(sqBodies[id])) {
    targets.push(r);
  }
}

const targetIdSet = new Set(targets.map((r) => String(r.id)));

// Classify scdet line availability
let hasScdetLine = 0;
let noScdetLine = 0;
const plans = [];

for (const r of targets) {
  const full = String(r.aiAnalysis || "");
  const m = full.match(AUDIT_CH11_RE);
  const sectionText = m ? m[0] : "";
  const scdetMatch = sectionText.match(/^- \*\*実映像カット実測値（ffmpeg scdet）\*\*:.*$/m);
  const scdetLine = scdetMatch ? scdetMatch[0].trim() : null;
  const hasRealScdet = Boolean(scdetLine && !scdetLine.includes("未計測"));

  if (scdetLine) hasScdetLine++;
  else noScdetLine++;

  let nextAnalysis;
  if (m) {
    if (scdetLine) {
      const replacement = `\n\n${MARKER}\n${scdetLine}`;
      nextAnalysis = full.replace(AUDIT_CH11_RE, replacement).trim();
    } else {
      nextAnalysis = full.replace(AUDIT_CH11_RE, "").trim();
    }
  } else {
    nextAnalysis = full;
  }

  let bd = {};
  try { bd = r.aiScoreBreakdown ? JSON.parse(r.aiScoreBreakdown) : {}; } catch {}
  bd.analysisStatus = "provisional";
  bd.isProvisional = true;
  bd.optionCApplied = true;
  bd.optionCNote = "旧SQLite別本文に基づく監査判定・点数・訂正メモを削除し、ffmpeg scdet実測値のみ保持。再監査対象へ移動。";
  delete bd.direction;
  delete bd.technique;
  delete bd.auditFindings;
  delete bd.rationale;

  plans.push({
    id: String(r.id),
    title: r.title,
    platform: r.platform,
    hasScdetLine: Boolean(scdetLine),
    hasRealScdet,
    nextAnalysis,
    nextBreakdown: JSON.stringify(bd),
  });
}

if (!APPLY) {
  await conn.end();
  console.log(JSON.stringify({
    mode: "dry-run",
    targetCount: targets.length,
    hasScdetLineCount: hasScdetLine,
    noScdetLineCount: noScdetLine,
    hasMeasuredScdetCount: plans.filter((p) => p.hasRealScdet).length,
    unmeasuredScdetLineCount: plans.filter((p) => p.hasScdetLine && !p.hasRealScdet).length,
    sampleBeforeAfter: plans.slice(0, 2).map((p) => ({
      id: p.id,
      hasScdetLine: p.hasScdetLine,
      nextCh11Tail: p.nextAnalysis.slice(p.nextAnalysis.indexOf(MARKER)),
    })),
  }, null, 2));
  process.exit(0);
}

// Step (1): Save full backup BEFORE any DB write!
const backupPayload = {
  createdAt: new Date().toISOString(),
  count: targets.length,
  records: targets.map((r) => ({
    id: String(r.id),
    title: r.title,
    aiOverallRating: r.aiOverallRating,
    aiDirectionRating: r.aiDirectionRating,
    aiTechniqueRating: r.aiTechniqueRating,
    aiOverallScore: r.aiOverallScore,
    aiDirectionScore: r.aiDirectionScore,
    aiTechniqueScore: r.aiTechniqueScore,
    aiScoreBreakdown: r.aiScoreBreakdown,
    aiAnalysis: r.aiAnalysis,
  })),
};
fs.writeFileSync(BACKUP_PATH, JSON.stringify(backupPayload, null, 2), "utf8");

// Step (3): Apply to TiDB Cloud
let updated = 0;
for (const p of plans) {
  await conn.query(
    `UPDATE videos
        SET aiOverallScore = NULL,
            aiDirectionScore = NULL,
            aiTechniqueScore = NULL,
            aiScoreBreakdown = ?,
            aiAnalysis = ?
      WHERE id = ?`,
    [p.nextBreakdown, p.nextAnalysis, p.id]
  );
  updated++;
}

// Save 537 IDs to re-audit queue (do NOT execute re-audit yet!)
fs.writeFileSync(
  REAUDIT_QUEUE_PATH,
  JSON.stringify(
    plans.map((p) => ({
      id: p.id,
      title: p.title,
      platform: p.platform,
      reason: "option_c_body_mismatch_537_reaudit_pending",
    })),
    null,
    2
  ),
  "utf8"
);

// Step (4): Post-execution verification across ALL 5,653 rows on TiDB Cloud
const [postRows] = await conn.query(
  `SELECT id, aiOverallScore, aiDirectionScore, aiTechniqueScore, aiScoreBreakdown, aiAnalysis FROM videos`
);
await conn.end();

let targetHasForbiddenLines = 0;
let targetHasScdetLine = 0;
let targetScoresNull = 0;
let targetProvisional = 0;
let nonTargetBodyChanged = 0;

for (const r of postRows) {
  const id = String(r.id);
  const ana = String(r.aiAnalysis || "");
  if (targetIdSet.has(id)) {
    const m = ana.match(AUDIT_CH11_RE);
    const sec = m ? m[0] : "";
    if (
      sec.includes("監査判定") ||
      sec.includes("100点ルーブリック確定スコア") ||
      sec.includes("監査・補正メモ") ||
      sec.includes("ランク変更理由") ||
      sec.includes("ランク乖離メモ")
    ) {
      targetHasForbiddenLines++;
    }
    if (sec.includes("実映像カット実測値（ffmpeg scdet）")) {
      targetHasScdetLine++;
    }
    if (r.aiOverallScore === null && r.aiDirectionScore === null && r.aiTechniqueScore === null) {
      targetScoresNull++;
    }
    let bd = {};
    try { bd = r.aiScoreBreakdown ? JSON.parse(r.aiScoreBreakdown) : {}; } catch {}
    if (bd.analysisStatus === "provisional") {
      targetProvisional++;
    }
  } else {
    if (sha256(ana) !== preHashes.get(id)) {
      nonTargetBodyChanged++;
    }
  }
}

console.log(JSON.stringify({
  mode: "apply",
  backupPath: BACKUP_PATH,
  reauditQueuePath: REAUDIT_QUEUE_PATH,
  updatedOnTidb: updated,
  verification: {
    targetCount: targets.length,
    targetWithForbiddenLinesCount: targetHasForbiddenLines,
    targetWithScdetLineRetainedCount: targetHasScdetLine,
    targetWithAllScoresNullCount: targetScoresNull,
    targetWithProvisionalStatusCount: targetProvisional,
    nonTargetVideosChecked: postRows.length - targets.length,
    nonTargetBodyHashChangedCount: nonTargetBodyChanged,
  },
}, null, 2));
