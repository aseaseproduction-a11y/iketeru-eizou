import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const REPO_ROOT = "E:\\iketeru-eizou";
const INITIAL_MIGRATION = process.argv.includes("--initial-migration");
const ALIGN_UNAUDITED = process.argv.includes("--align-unaudited");

const envText = fs.readFileSync(path.join(REPO_ROOT, ".env"), "utf8").replace(/^\uFEFF/, "");
const dbUrl = envText.match(/^DATABASE_URL=(.+)$/m)[1].trim();

const provList = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "analysis", "provisional_unwatched_list.json"), "utf8"));
const provIds = new Set(provList.items.map((x) => String(x.id)));

const logReport = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "analysis", "visual_log_verification.json"), "utf8"));
const logVerifiedIds = new Set(logReport.log_verified_ids.map(String));
const unverifiableIds = new Set(logReport.unverifiable_no_log_self_true_ids.map(String));

const redoList = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "analysis", "visual_redo_queue.json"), "utf8"));
const invalidatedIds = new Set(redoList.map((x) => String(x.video_id)));

const conn = await mysql.createConnection({
  uri: dbUrl,
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});

const [allRows] = await conn.query("SELECT id, aiScoreBreakdown FROM videos");

let updated = 0;
let preservedReanalyzed = 0;

for (const r of allRows) {
  const id = String(r.id);
  let bd = {};
  try { bd = r.aiScoreBreakdown ? JSON.parse(r.aiScoreBreakdown) : {}; } catch {}
  const before = JSON.stringify(bd);

  const isLatestReanalysis = bd.source === "rubric_unclamped";
  const isNeedsFull = bd.analysisVerdict === "needs_full_analysis";

  // 1. analysisStatus: latest rubric_unclamped always wins over static migration lists
  if (isLatestReanalysis) {
    bd.analysisStatus = isNeedsFull ? "provisional" : "full_analysis";
    bd.isProvisional = bd.analysisStatus === "provisional";
    if (provIds.has(id) && !isNeedsFull) preservedReanalyzed++;
  } else if (INITIAL_MIGRATION || !bd.analysisStatus || bd.analysisStatus === "verified") {
    if (provIds.has(id) || isNeedsFull) {
      bd.analysisStatus = "provisional";
      bd.isProvisional = true;
    } else {
      bd.analysisStatus = "full_analysis";
      bd.isProvisional = false;
    }
  }

  // 2. visualVerificationStatus: log_verified from verify_visual_logs.py always wins & never downgrades
  if (logVerifiedIds.has(id)) {
    bd.visualVerificationStatus = "log_verified";
  } else if (bd.visualVerificationStatus !== "log_verified") {
    if (isLatestReanalysis && bd.visualChecked === true) {
      if (!bd.visualVerificationStatus) bd.visualVerificationStatus = "unverified_pending";
    } else if (INITIAL_MIGRATION || !bd.visualVerificationStatus) {
      if (invalidatedIds.has(id)) {
        bd.visualVerificationStatus = "invalidated_no_visual";
      } else if (unverifiableIds.has(id)) {
        bd.visualVerificationStatus = "unverifiable_no_log";
      } else if (ALIGN_UNAUDITED) {
        bd.visualVerificationStatus = "not_audited";
      }
    }
  }

  const after = JSON.stringify(bd);
  if (after !== before) {
    await conn.query("UPDATE videos SET aiScoreBreakdown = ? WHERE id = ?", [after, id]);
    updated++;
  }
}

const [verify] = await conn.query(`
  SELECT
    COUNT(*) AS totalVideos,
    SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(aiScoreBreakdown, '$.analysisStatus')) = 'provisional' THEN 1 ELSE 0 END) AS provisionalCount,
    SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(aiScoreBreakdown, '$.analysisStatus')) = 'full_analysis' THEN 1 ELSE 0 END) AS fullAnalysisCount,
    SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(aiScoreBreakdown, '$.visualVerificationStatus')) = 'log_verified' THEN 1 ELSE 0 END) AS logVerifiedCount,
    SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(aiScoreBreakdown, '$.visualVerificationStatus')) = 'unverifiable_no_log' THEN 1 ELSE 0 END) AS unverifiableNoLogCount,
    SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(aiScoreBreakdown, '$.visualVerificationStatus')) = 'unverified_pending' THEN 1 ELSE 0 END) AS unverifiedPendingCount,
    SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(aiScoreBreakdown, '$.visualVerificationStatus')) = 'invalidated_no_visual' THEN 1 ELSE 0 END) AS invalidatedNoVisualCount,
    SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(aiScoreBreakdown, '$.visualVerificationStatus')) = 'not_audited' THEN 1 ELSE 0 END) AS notAuditedCount,
    SUM(CASE WHEN JSON_EXTRACT(aiScoreBreakdown, '$.visualVerificationStatus') IS NULL THEN 1 ELSE 0 END) AS nullVvsCount
  FROM videos
`);

await conn.end();
console.log(JSON.stringify({
  mode: { INITIAL_MIGRATION, ALIGN_UNAUDITED },
  updated,
  preservedReanalyzed,
  tidbVerify: verify[0],
}, null, 2));
