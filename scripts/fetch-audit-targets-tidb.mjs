import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const REPO_ROOT = "E:\\iketeru-eizou";
const envText = fs.readFileSync(path.join(REPO_ROOT, ".env"), "utf8").replace(/^\uFEFF/, "");
const dbUrl = process.env.DATABASE_URL || envText.match(/^DATABASE_URL=(.+)$/m)[1].trim();

const videoIdArg = process.argv.find((a) => a.startsWith("--video-id="))?.slice("--video-id=".length)?.trim() || "";
const videoIdsArg = process.argv.find((a) => a.startsWith("--video-ids="))?.slice("--video-ids=".length)?.trim() || "";
const ratingsArg = process.argv.find((a) => a.startsWith("--ratings="))?.slice("--ratings=".length)?.trim() || "";

const conn = await mysql.createConnection({
  uri: dbUrl,
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});

let rows;
if (videoIdsArg) {
  const idList = videoIdsArg.split(",").map((s) => s.trim()).filter(Boolean);
  const [res] = await conn.query(
    `SELECT id, platform, title, videoUrl AS video_url,
            aiOverallRating AS overall_rating,
            aiDirectionRating AS direction_rating,
            aiTechniqueRating AS technique_rating,
            aiAnalysis AS ai_analysis
       FROM videos
      WHERE id IN (?)`,
    [idList]
  );
  const byId = new Map(res.map((r) => [String(r.id), r]));
  rows = idList.map((id) => byId.get(id)).filter(Boolean);
} else if (videoIdArg) {
  const [res] = await conn.query(
    `SELECT id, platform, title, videoUrl AS video_url,
            aiOverallRating AS overall_rating,
            aiDirectionRating AS direction_rating,
            aiTechniqueRating AS technique_rating,
            aiAnalysis AS ai_analysis
       FROM videos
      WHERE id = ?
      LIMIT 1`,
    [videoIdArg]
  );
  rows = res;
} else if (ratingsArg) {
  const ratings = ratingsArg.split(",").map((s) => s.trim()).filter(Boolean);
  const ph = ratings.map(() => "?").join(",");
  const [res] = await conn.query(
    `SELECT id, platform, title, videoUrl AS video_url,
            aiOverallRating AS overall_rating,
            aiDirectionRating AS direction_rating,
            aiTechniqueRating AS technique_rating,
            aiAnalysis AS ai_analysis
       FROM videos
      WHERE aiOverallRating IN (${ph})
      ORDER BY FIELD(aiOverallRating,'S+','S','S-','A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-'), id ASC`,
    ratings
  );
  rows = res;
} else {
  const [res] = await conn.query(
    `SELECT id, platform, title, videoUrl AS video_url,
            aiOverallRating AS overall_rating,
            aiDirectionRating AS direction_rating,
            aiTechniqueRating AS technique_rating,
            aiAnalysis AS ai_analysis
       FROM videos
      ORDER BY FIELD(aiOverallRating,'S+','S','S-','A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-'), id ASC`
  );
  rows = res;
}

await conn.end();
process.stdout.write(JSON.stringify(rows));
