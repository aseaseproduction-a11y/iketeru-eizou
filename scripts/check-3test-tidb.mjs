import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const REPO_ROOT = "E:\\iketeru-eizou";
const envText = fs.readFileSync(path.join(REPO_ROOT, ".env"), "utf8").replace(/^\uFEFF/, "");
const dbUrl = envText.match(/^DATABASE_URL=(.+)$/m)[1].trim();

const testIds = ["1154382470", "Z_lbVlhO9HE", "UvGwIFVUK7M"];
const conn = await mysql.createConnection({
  uri: dbUrl,
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});
const [rows] = await conn.query(
  `SELECT id, title, aiOverallRating, aiDirectionRating, aiTechniqueRating, aiOverallScore, aiDirectionScore, aiTechniqueScore,
          JSON_EXTRACT(aiScoreBreakdown, '$.source') AS bdSource
   FROM videos WHERE id IN (?, ?, ?) ORDER BY id`,
  testIds
);
await conn.end();
console.log(JSON.stringify(rows, null, 2));
