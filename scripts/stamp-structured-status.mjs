import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const REPO_ROOT = "E:\\iketeru-eizou";
const envText = fs.readFileSync(path.join(REPO_ROOT, ".env"), "utf8").replace(/^\uFEFF/, "");
const dbUrl = envText.match(/^DATABASE_URL=(.+)$/m)[1].trim();

const provList = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "analysis", "provisional_unwatched_list.json"), "utf8"));
const provIds = new Set(provList.items.map((x) => String(x.id)));

const logReport = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "analysis", "visual_log_verification.json"), "utf8"));
const logVerifiedIds = new Set(logReport.log_verified_ids.map(String));
const unverifiableIds = new Set(logReport.unverifiable_no_log_self_true_ids.map(String));

const redoList = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "analysis", "visual_redo_queue.json"), "utf8"));
const invalidatedIds = new Set(redoList.map((x) => String(x.video_id)));

const targetIds = Array.from(new Set([...provIds, ...logVerifiedIds, ...unverifiableIds, ...invalidatedIds]));

const conn = await mysql.createConnection({
  uri: dbUrl,
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});

let updated = 0;
const counts = { provisional: 0, log_verified: 0, unverifiable_no_log: 0, invalidated_no_visual: 0 };

for (let i = 0; i < targetIds.length; i += 200) {
  const slice = targetIds.slice(i, i + 200);
  const ph = slice.map(() => "?").join(",");
  const [rows] = await conn.query(`SELECT id, aiScoreBreakdown FROM videos WHERE id IN (${ph})`, slice);
  for (const r of rows) {
    const id = String(r.id);
    let bd = {};
    try { bd = r.aiScoreBreakdown ? JSON.parse(r.aiScoreBreakdown) : {}; } catch {}
    const isNeedsFull = bd.analysisVerdict === "needs_full_analysis";
    if (provIds.has(id) || isNeedsFull) {
      bd.analysisStatus = "provisional";
      bd.isProvisional = true;
      counts.provisional++;
    } else {
      bd.analysisStatus = "full_analysis";
      bd.isProvisional = false;
    }
    if (invalidatedIds.has(id)) {
      bd.visualVerificationStatus = "invalidated_no_visual";
      counts.invalidated_no_visual++;
    } else if (logVerifiedIds.has(id)) {
      bd.visualVerificationStatus = "log_verified";
      counts.log_verified++;
    } else if (unverifiableIds.has(id)) {
      bd.visualVerificationStatus = "unverifiable_no_log";
      counts.unverifiable_no_log++;
    }
    await conn.query("UPDATE videos SET aiScoreBreakdown = ? WHERE id = ?", [JSON.stringify(bd), id]);
    updated++;
  }
}

// Also migrate any remaining "analysisStatus":"verified" rows to "full_analysis"
const [verRows] = await conn.query(
  `SELECT id, aiScoreBreakdown FROM videos WHERE JSON_UNQUOTE(JSON_EXTRACT(aiScoreBreakdown, '$.analysisStatus')) = 'verified'`
);
let renamedVerifiedToFull = 0;
for (const r of verRows) {
  let bd = {};
  try { bd = r.aiScoreBreakdown ? JSON.parse(r.aiScoreBreakdown) : {}; } catch {}
  bd.analysisStatus = bd.analysisVerdict === "needs_full_analysis" ? "provisional" : "full_analysis";
  bd.isProvisional = bd.analysisStatus === "provisional";
  await conn.query("UPDATE videos SET aiScoreBreakdown = ? WHERE id = ?", [JSON.stringify(bd), r.id]);
  renamedVerifiedToFull++;
}

const [verify] = await conn.query(`
  SELECT
    SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(aiScoreBreakdown, '$.analysisStatus')) = 'provisional' THEN 1 ELSE 0 END) AS provisionalCount,
    SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(aiScoreBreakdown, '$.analysisStatus')) = 'full_analysis' THEN 1 ELSE 0 END) AS fullAnalysisCount,
    SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(aiScoreBreakdown, '$.analysisStatus')) = 'verified' THEN 1 ELSE 0 END) AS legacyVerifiedRemaining,
    SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(aiScoreBreakdown, '$.visualVerificationStatus')) = 'log_verified' THEN 1 ELSE 0 END) AS logVerifiedCount,
    SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(aiScoreBreakdown, '$.visualVerificationStatus')) = 'unverifiable_no_log' THEN 1 ELSE 0 END) AS unverifiableNoLogCount,
    SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(aiScoreBreakdown, '$.visualVerificationStatus')) = 'unverified_pending' THEN 1 ELSE 0 END) AS unverifiedPendingCount,
    SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(aiScoreBreakdown, '$.visualVerificationStatus')) = 'invalidated_no_visual' THEN 1 ELSE 0 END) AS invalidatedNoVisualCount
  FROM videos
`);

await conn.end();
console.log(JSON.stringify({ updated, renamedVerifiedToFull, counts, tidbVerify: verify[0] }, null, 2));
