import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const REPO_ROOT = "E:\\iketeru-eizou";
const envText = fs.readFileSync(path.join(REPO_ROOT, ".env"), "utf8").replace(/^\uFEFF/, "");
const dbUrl = envText.match(/^DATABASE_URL=(.+)$/m)[1].trim();

const analysisPath = path.join(REPO_ROOT, "analysis", "db_sync_cause_analysis.json");
const analysis = JSON.parse(fs.readFileSync(analysisPath, "utf8"));

// Collect sample IDs from every category
const sampleIds = new Set();
for (const list of Object.values(analysis.samples || {})) {
  for (const s of list) sampleIds.add(String(s.id));
}
for (const id of (analysis.only_in_tidb_sample || []).slice(0, 3)) sampleIds.add(String(id));

const conn = await mysql.createConnection({
  uri: dbUrl,
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});

const idsArr = Array.from(sampleIds);
const [rows] = await conn.query(
  `SELECT id, platform, source, sourceLabel, aiOverallRating, aiDirectionRating, aiTechniqueRating,
          aiOverallScore, createdAt, updatedAt, addedDate,
          LEFT(aiAnalysis, 220) AS analysisHead,
          aiScoreBreakdown
     FROM videos WHERE id IN (${idsArr.map(() => "?").join(",")})`,
  idsArr
);
await conn.end();

const tidbDetail = Object.fromEntries(rows.map((r) => [String(r.id), r]));
fs.writeFileSync(path.join(REPO_ROOT, "analysis", "_sample_tidb_detail.json"), JSON.stringify(tidbDetail, null, 2), "utf8");
console.log("Fetched TiDB history for sample IDs:", rows.length);
