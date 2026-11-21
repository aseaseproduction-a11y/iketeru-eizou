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

// Restore exact original BEFORE values for the 3 test videos
const restores = [
  {
    id: "1154382470",
    aiOverallRating: "S-",
    aiDirectionRating: "S-",
    aiTechniqueRating: "A+",
    aiOverallScore: 90,
    aiDirectionScore: 90,
    aiTechniqueScore: 86,
    aiScoreBreakdown: JSON.stringify({
      version: 2,
      source: "rubric",
      analysisStatus: "provisional",
      isProvisional: true,
      note: "テスト手動昇格を取り消し、元の暫定評価（S-/S-/A+, 90/90/86）へ復元しました。",
    }),
  },
  {
    id: "UvGwIFVUK7M",
    aiOverallRating: "A",
    aiDirectionRating: "A",
    aiTechniqueRating: "A",
    aiOverallScore: 83,
    aiDirectionScore: 83,
    aiTechniqueScore: 83,
    aiScoreBreakdown: JSON.stringify({
      version: 2,
      source: "backfill_from_analysis",
      analysisStatus: "verified",
      isProvisional: false,
      note: "テスト手動昇格を取り消し、元の評価（A/A/A, 83/83/83）へ復元しました。",
    }),
  },
  {
    id: "Z_lbVlhO9HE",
    aiOverallRating: "A+",
    aiDirectionRating: "A+",
    aiTechniqueRating: "A",
    aiOverallScore: 87,
    aiDirectionScore: 88,
    aiTechniqueScore: 84,
    aiScoreBreakdown: JSON.stringify({
      version: 2,
      source: "rubric",
      analysisStatus: "verified",
      isProvisional: false,
      note: "テスト手動昇格を取り消し、元の評価（A+/A+/A, 87/88/84）へ復元しました。",
    }),
  },
];

for (const r of restores) {
  await conn.query(
    `UPDATE videos
        SET aiOverallRating = ?, aiDirectionRating = ?, aiTechniqueRating = ?,
            aiOverallScore = ?, aiDirectionScore = ?, aiTechniqueScore = ?,
            aiScoreBreakdown = ?
      WHERE id = ?`,
    [
      r.aiOverallRating,
      r.aiDirectionRating,
      r.aiTechniqueRating,
      r.aiOverallScore,
      r.aiDirectionScore,
      r.aiTechniqueScore,
      r.aiScoreBreakdown,
      r.id,
    ]
  );
}

const [rows] = await conn.query(
  `SELECT id, aiOverallRating, aiDirectionRating, aiTechniqueRating,
          aiOverallScore, aiDirectionScore, aiTechniqueScore,
          JSON_EXTRACT(aiScoreBreakdown, '$.source') AS bdSource,
          JSON_EXTRACT(aiScoreBreakdown, '$.analysisStatus') AS analysisStatus
     FROM videos WHERE id IN ('1154382470','UvGwIFVUK7M','Z_lbVlhO9HE') ORDER BY id`
);
await conn.end();
console.log("=== TIDB RESTORED ===");
console.log(JSON.stringify(rows, null, 2));
