import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const REPO_ROOT = "E:\\iketeru-eizou";
const envText = fs.readFileSync(path.join(REPO_ROOT, ".env"), "utf8").replace(/^\uFEFF/, "");
const m = envText.match(/^DATABASE_URL=(.+)$/m);
if (!m) throw new Error("DATABASE_URL not found in .env");
const dbUrl = m[1].trim();

const progPath = path.join(REPO_ROOT, "analysis", "full_audit_progress.jsonl");
const progLines = fs.readFileSync(progPath, "utf8").trim().split(/\r?\n/).filter(Boolean);
const progMap = new Map();
for (const line of progLines) {
  const d = JSON.parse(line);
  progMap.set(d.video_id, d);
}
const allIds = [...progMap.keys()];
const logReportPath = path.join(REPO_ROOT, "analysis", "visual_log_verification.json");
const logReport = fs.existsSync(logReportPath) ? JSON.parse(fs.readFileSync(logReportPath, "utf8")) : null;
const logVerifiedSet = new Set((logReport?.log_verified_ids || []).map(String));
const unverifiableSet = new Set((logReport?.unverifiable_no_log_self_true_ids || []).map(String));

const validVisualIds = allIds.filter((id) => progMap.get(id)?.visual_checked === true);
const invalidatedNoVisualIds = allIds.filter((id) => progMap.get(id)?.visual_checked !== true);
const ids = validVisualIds;

const conn = await mysql.createConnection({
  uri: dbUrl,
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});

const BATCH = 200;
const rows = [];
for (let i = 0; i < ids.length; i += BATCH) {
  const slice = ids.slice(i, i + BATCH);
  const placeholders = slice.map(() => "?").join(",");
  const [batchRows] = await conn.query(
    `SELECT id, title, aiOverallRating, aiOverallScore, aiDirectionScore, aiTechniqueScore, aiScoreBreakdown,
            genres, products, directions, tones, purposes, expressions, productions, productionCredits,
            curationNote, embedStatus,
            (aiAnalysis LIKE "%## 11.%") AS hasCh11,
            CHAR_LENGTH(aiAnalysis) AS analysisLen
     FROM videos WHERE id IN (${placeholders})`,
    slice
  );
  rows.push(...batchRows);
}
await conn.end();

const isEmptyArr = (v) => {
  if (!v) return true;
  if (Array.isArray(v)) return v.length === 0;
  try {
    const p = JSON.parse(v);
    return !Array.isArray(p) || p.length === 0;
  } catch {
    return true;
  }
};

const BANDS = {
  "S+": [97, 100], S: [93, 96], "S-": [90, 92],
  "A+": [86, 89], A: [82, 85], "A-": [78, 81],
  "B+": [73, 77], B: [68, 72], "B-": [63, 67],
  "C+": [57, 62], C: [51, 56], "C-": [45, 50],
  "D+": [35, 44], D: [20, 34], "D-": [0, 19],
};

const issues = {
  missingCh11: [],
  shortAnalysis: [],
  missingScore: [],
  outOfBand: [],
  rubricSumMismatch: [],
  emptyGenres: [],
  emptyProducts: [],
  emptyDirections: [],
  emptyTones: [],
  emptyPurposes: [],
  emptyExpressions: [],
  emptyClientPitch: [],
  emptyCreditsAndProd: [],
};

for (const r of rows) {
  if (!r.hasCh11) issues.missingCh11.push(r.id);
  if (!r.analysisLen || r.analysisLen < 500) {
    issues.shortAnalysis.push({ id: r.id, len: r.analysisLen, title: r.title });
  }
  if (r.aiOverallScore == null || r.aiDirectionScore == null || r.aiTechniqueScore == null) {
    issues.missingScore.push(r.id);
  } else if (BANDS[r.aiOverallRating]) {
    const [lo, hi] = BANDS[r.aiOverallRating];
    if (r.aiOverallScore < lo || r.aiOverallScore > hi) {
      issues.outOfBand.push({ id: r.id, rating: r.aiOverallRating, score: r.aiOverallScore });
    }
  }
  if (r.aiScoreBreakdown) {
    try {
      const bd = typeof r.aiScoreBreakdown === "string" ? JSON.parse(r.aiScoreBreakdown) : r.aiScoreBreakdown;
      const ds = Object.values(bd.direction || {}).reduce((a, b) => a + Number(b || 0), 0);
      const ts = Object.values(bd.technique || {}).reduce((a, b) => a + Number(b || 0), 0);
      if (ds !== r.aiDirectionScore || ts !== r.aiTechniqueScore) {
        issues.rubricSumMismatch.push({ id: r.id, ds, d: r.aiDirectionScore, ts, t: r.aiTechniqueScore });
      }
    } catch {
      issues.rubricSumMismatch.push({ id: r.id, err: "invalid_json" });
    }
  }
  if (isEmptyArr(r.genres)) issues.emptyGenres.push({ id: r.id, title: r.title });
  if (isEmptyArr(r.products)) issues.emptyProducts.push({ id: r.id, title: r.title });
  if (isEmptyArr(r.directions)) issues.emptyDirections.push({ id: r.id, title: r.title });
  if (isEmptyArr(r.tones)) issues.emptyTones.push({ id: r.id, title: r.title });
  if (isEmptyArr(r.purposes)) issues.emptyPurposes.push({ id: r.id, title: r.title });
  if (isEmptyArr(r.expressions)) issues.emptyExpressions.push({ id: r.id, title: r.title });
  let cn = r.curationNote;
  if (typeof cn === "string") {
    try { cn = JSON.parse(cn); } catch { cn = null; }
  }
  if (!cn || !cn.clientPitch || !String(cn.clientPitch).trim()) {
    issues.emptyClientPitch.push({ id: r.id, title: r.title });
  }
  if (isEmptyArr(r.productions) && (!r.productionCredits || !String(r.productionCredits).trim())) {
    issues.emptyCreditsAndProd.push({ id: r.id, title: r.title });
  }
}

const logVerifiedInRows = rows.filter((r) => logVerifiedSet.has(String(r.id))).length;
const unverifiableInRows = rows.filter((r) => unverifiableSet.has(String(r.id))).length;
console.log(
  `Checked ${rows.length} / ${ids.length} audited videos on TiDB Cloud ` +
  `(log_verified: ${logVerifiedInRows}, unverifiable_no_log: ${unverifiableInRows}, excluded invalidated_no_visual: ${invalidatedNoVisualIds.length}):`
);
for (const [k, v] of Object.entries(issues)) {
  console.log(`  ${k}: ${v.length}`, v.length > 0 && v.length <= 20 ? JSON.stringify(v) : "");
}
