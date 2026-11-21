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
  `SELECT id, aiOverallRating, aiDirectionRating, aiTechniqueRating,
          aiOverallScore, aiDirectionScore, aiTechniqueScore
     FROM videos`
);
await conn.end();
fs.writeFileSync(path.join(REPO_ROOT, "analysis", "_tidb_snapshot_ratings.json"), JSON.stringify(rows), "utf8");
console.log("Exported TiDB snapshot:", rows.length);
