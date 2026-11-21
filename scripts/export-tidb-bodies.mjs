import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const REPO_ROOT = "E:\\iketeru-eizou";
const envText = fs.readFileSync(path.join(REPO_ROOT, ".env"), "utf8").replace(/^\uFEFF/, "");
const dbUrl = envText.match(/^DATABASE_URL=(.+)$/m)[1].trim();

const conn = await mysql.createConnection({
  uri: dbUrl,
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});

const [rows] = await conn.query(
  `SELECT id, aiOverallRating, aiAnalysis, createdAt, updatedAt,
          JSON_UNQUOTE(JSON_EXTRACT(aiScoreBreakdown, '$.analysisStatus')) AS analysisStatus
     FROM videos`
);
await conn.end();

const out = rows.map((r) => ({
  id: String(r.id),
  rating: r.aiOverallRating || "",
  analysis: r.aiAnalysis || "",
  createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : "",
  updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : "",
  analysisStatus: r.analysisStatus || "",
}));

fs.writeFileSync(path.join(REPO_ROOT, "analysis", "_tidb_all_bodies.json"), JSON.stringify(out), "utf8");
console.log("Exported TiDB bodies:", out.length);
