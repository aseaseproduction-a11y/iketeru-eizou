import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const REPO_ROOT = "E:\\iketeru-eizou";
const envText = fs.readFileSync(path.join(REPO_ROOT, ".env"), "utf8").replace(/^\uFEFF/, "");
const dbUrl = envText.match(/^DATABASE_URL=(.+)$/m)[1].trim();

const redoList = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "analysis", "visual_redo_queue.json"), "utf8"));
const redoIds = redoList.map((x) => String(x.video_id));

const conn = await mysql.createConnection({
  uri: dbUrl,
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});

let invalidatedOnDb = 0;
let ch11RemovedCount = 0;
let scoresNulledCount = 0;

const ch11Regex = /(?:\r?\n)*## 11\. 実映像ビジュアル監査・実測補正[\s\S]*?(?=\r?\n## |\s*$)/;

for (let i = 0; i < redoIds.length; i += 100) {
  const slice = redoIds.slice(i, i + 100);
  const placeholders = slice.map(() => "?").join(",");
  const [rows] = await conn.query(
    `SELECT id, aiOverallScore, aiDirectionScore, aiTechniqueScore, aiScoreBreakdown, aiAnalysis FROM videos WHERE id IN (${placeholders})`,
    slice
  );
  for (const r of rows) {
    const bd = {
      version: 2,
      source: "invalidated_no_visual",
      visualChecked: false,
      invalidatedNoVisual: true,
      status: "invalidated_no_visual_redo_required",
      note: "静止画未確認（0枚）のためスコアおよび第11章を無効化しました。再実施が必要です。",
    };
    let nextAnalysis = r.aiAnalysis || "";
    if (ch11Regex.test(nextAnalysis)) {
      nextAnalysis = nextAnalysis.replace(ch11Regex, "").trimEnd();
      ch11RemovedCount++;
    }
    if (r.aiOverallScore !== null || r.aiDirectionScore !== null || r.aiTechniqueScore !== null) {
      scoresNulledCount++;
    }
    await conn.query(
      `UPDATE videos
         SET aiOverallScore = NULL,
             aiDirectionScore = NULL,
             aiTechniqueScore = NULL,
             aiScoreBreakdown = ?,
             aiAnalysis = ?
       WHERE id = ?`,
      [JSON.stringify(bd), nextAnalysis, r.id]
    );
    invalidatedOnDb++;
  }
}

// Verify on TiDB Cloud
const [verifyRows] = await conn.query(
  `SELECT
     COUNT(*) AS totalMatched,
     SUM(CASE WHEN aiOverallScore IS NOT NULL OR aiDirectionScore IS NOT NULL OR aiTechniqueScore IS NOT NULL THEN 1 ELSE 0 END) AS stillHasScore,
     SUM(CASE WHEN aiAnalysis LIKE '%## 11.%' THEN 1 ELSE 0 END) AS stillHasCh11
   FROM videos
   WHERE id IN (${redoIds.map(() => "?").join(",")})`,
  redoIds
);

await conn.end();
console.log(JSON.stringify({
  redoQueueCount: redoIds.length,
  invalidatedOnDb,
  scoresNulledCount,
  ch11RemovedCount,
  tidbVerify: verifyRows[0],
}, null, 2));
