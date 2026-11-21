import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const REPO_ROOT = "E:\\iketeru-eizou";
const envText = fs.readFileSync(path.join(REPO_ROOT, ".env"), "utf8").replace(/^\uFEFF/, "");
const dbUrl = envText.match(/^DATABASE_URL=(.+)$/m)[1].trim();

const diff = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "analysis", "db_sync_diff.json"), "utf8"));
const mismatchIds = diff.rating_diffs.map((x) => String(x.id));

const conn = await mysql.createConnection({
  uri: dbUrl,
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});

const tidbMeta = {};
for (let i = 0; i < mismatchIds.length; i += 200) {
  const slice = mismatchIds.slice(i, i + 200);
  const ph = slice.map(() => "?").join(",");
  const [rows] = await conn.query(
    `SELECT id, platform, source, sourceLabel, aiOverallRating, aiDirectionRating, aiTechniqueRating,
            aiOverallScore, createdAt, updatedAt,
            JSON_UNQUOTE(JSON_EXTRACT(aiScoreBreakdown, '$.source')) AS bdSource,
            JSON_UNQUOTE(JSON_EXTRACT(aiScoreBreakdown, '$.analysisStatus')) AS analysisStatus,
            JSON_UNQUOTE(JSON_EXTRACT(aiScoreBreakdown, '$.visualVerificationStatus')) AS vvs,
            CHAR_LENGTH(aiAnalysis) AS analysisLen
       FROM videos WHERE id IN (${ph})`,
    slice
  );
  for (const r of rows) {
    tidbMeta[String(r.id)] = r;
  }
}

// Also inspect only_in_tidb (66)
const [allTidbIds] = await conn.query(`SELECT id, platform, source, sourceLabel, aiOverallRating, createdAt FROM videos`);
await conn.end();

fs.writeFileSync(
  path.join(REPO_ROOT, "analysis", "_tidb_mismatch_meta.json"),
  JSON.stringify({ tidbMeta, allTidbMeta: Object.fromEntries(allTidbIds.map((r) => [String(r.id), r])) }),
  "utf8"
);
console.log("Exported TiDB mismatch meta:", Object.keys(tidbMeta).length);
