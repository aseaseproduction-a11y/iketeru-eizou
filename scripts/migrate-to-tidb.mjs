/**
 * Migrate all iketeru-eizou videos into TiDB Cloud Serverless (or any MySQL 8 DB).
 *
 * Supports two source modes:
 *   Mode A (Full DB clone): Set SOURCE_DATABASE_URL (Manus MySQL) -> copies all tables directly.
 *   Mode B (No Manus DB credentials needed): Fetches complete metadata from live public API
 *     (https://iketeru-eizou.vercel.app/api/trpc/videos.list) and merges full aiAnalysis
 *     from local SQLite (E:/iketeru-creative-studio/data/iketeru_knowledge.db).
 *
 * Usage:
 *   DATABASE_URL="mysql://..." node scripts/migrate-to-tidb.mjs                      # dry-run
 *   DATABASE_URL="mysql://..." node scripts/migrate-to-tidb.mjs --apply              # execute write
 *   DATABASE_URL="mysql://..." node scripts/migrate-to-tidb.mjs --apply --sqlite="E:/iketeru-creative-studio/data/iketeru_knowledge.db"
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import mysql from "mysql2/promise";

const apply = process.argv.includes("--apply");
const sqliteArg = process.argv.find((a) => a.startsWith("--sqlite="));
const sqlitePath = sqliteArg ? sqliteArg.slice(9) : "E:/iketeru-creative-studio/data/iketeru_knowledge.db";
const inputJsonArg = process.argv.find((a) => a.startsWith("--input-json="));
const inputJsonPath = inputJsonArg ? inputJsonArg.slice(13) : null;
const apiBaseArg = process.argv.find((a) => a.startsWith("--api-base="));
const apiBase = (apiBaseArg ? apiBaseArg.slice(11) : "https://iketeru-eizou.vercel.app").replace(/\/$/, "");
const targetUrl = process.env.DATABASE_URL;
const sourceUrl = process.env.SOURCE_DATABASE_URL;

if (!targetUrl) {
  throw new Error("DATABASE_URL (target TiDB Cloud / MySQL URI) is required.");
}

function connectMysql(uri) {
  const needsTls = /tidbcloud\.com|psdb\.cloud|aivencloud\.com/i.test(uri) || process.env.MYSQL_SSL === "true";
  return mysql.createConnection({
    uri,
    ...(needsTls ? { ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true } } : {}),
  });
}

function loadSqliteAnalysisMap(dbFile) {
  if (!dbFile || !existsSync(dbFile)) return new Map();
  const py = `
import json, sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
rows = conn.execute("SELECT id, ai_analysis FROM videos WHERE ai_analysis IS NOT NULL AND ai_analysis != ''").fetchall()
conn.close()
for vid, txt in rows:
    print(json.dumps({"id": vid, "aiAnalysis": txt}, ensure_ascii=False))
`;
  const stdout = execFileSync("python", ["-c", py, dbFile], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 512,
  });
  const map = new Map();
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const obj = JSON.parse(line);
    map.set(String(obj.id), String(obj.aiAnalysis));
  }
  return map;
}

async function fetchPublicVideoList(baseUrl) {
  const url = `${baseUrl}/api/trpc/videos.list?batch=1&input=${encodeURIComponent(JSON.stringify({ "0": { json: null } }))}`;
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) throw new Error(`Failed to fetch videos.list (${resp.status}): ${url}`);
  const payload = await resp.json();
  const list = payload?.[0]?.result?.data?.json;
  if (!Array.isArray(list)) throw new Error("Unexpected videos.list response shape");
  return list;
}

const targetDb = await connectMysql(targetUrl);

try {
  if (sourceUrl) {
    // Mode A: Direct MySQL-to-MySQL full copy
    const sourceDb = await connectMysql(sourceUrl);
    const tables = [
      "users",
      "videos",
      "favoriteProfiles",
      "profileVideoFavorites",
      "profileCreatorFavorites",
      "dailyCollectionSources",
    ];
    const report = { mode: "mysql-to-mysql", apply, tables: {} };
    try {
      for (const table of tables) {
        const [rows] = await sourceDb.query(`SELECT * FROM \`${table}\``);
        report.tables[table] = { sourceCount: rows.length, inserted: 0 };
        if (!apply || rows.length === 0) continue;
        const cols = Object.keys(rows[0]);
        const colSql = cols.map((c) => `\`${c}\``).join(", ");
        const placeholders = `(${cols.map(() => "?").join(", ")})`;
        const updateSql = cols.filter((c) => c !== "id").map((c) => `\`${c}\`=VALUES(\`${c}\`)`).join(", ");
        const chunkSize = table === "videos" ? 25 : 200;
        for (let i = 0; i < rows.length; i += chunkSize) {
          const chunk = rows.slice(i, i + chunkSize);
          const vals = chunk.flatMap((r) => cols.map((c) => r[c]));
          const sql = `INSERT INTO \`${table}\` (${colSql}) VALUES ${chunk.map(() => placeholders).join(", ")} ON DUPLICATE KEY UPDATE ${updateSql}`;
          await targetDb.query(sql, vals);
          report.tables[table].inserted += chunk.length;
        }
      }
    } finally {
      await sourceDb.end();
    }
    console.log(JSON.stringify(report, null, 2));
  } else {
    // Mode B: Public API (or pre-fetched JSON snapshot) metadata + local SQLite full aiAnalysis
    const list = inputJsonPath && existsSync(inputJsonPath)
      ? JSON.parse(readFileSync(inputJsonPath, "utf8"))
      : await fetchPublicVideoList(apiBase);
    const analysisMap = loadSqliteAnalysisMap(sqlitePath);
    let withAnalysis = 0;
    const rows = list.map((v) => {
      const fullAnalysis = (v.aiAnalysis && v.aiAnalysis.trim()) || analysisMap.get(String(v.id)) || null;
      if (fullAnalysis) withAnalysis += 1;
      return {
        id: String(v.id),
        platform: String(v.platform || "youtube"),
        title: String(v.title || ""),
        thumbnail: v.thumbnail || null,
        videoUrl: String(v.videoUrl || ""),
        embedUrl: v.embedUrl || null,
        source: v.source || null,
        sourceLabel: v.sourceLabel || null,
        channelId: v.channelId || null,
        channelTitle: v.channelTitle || null,
        genres: JSON.stringify(v.genres || []),
        products: JSON.stringify(v.products || []),
        directions: JSON.stringify(v.directions || []),
        tones: JSON.stringify(v.tones || []),
        allTags: JSON.stringify(v.allTags || []),
        purposes: JSON.stringify(v.purposes || []),
        expressions: JSON.stringify(v.expressions || []),
        toneEmotions: JSON.stringify(v.toneEmotions || []),
        toneVisuals: JSON.stringify(v.toneVisuals || []),
        toneTechniques: JSON.stringify(v.toneTechniques || []),
        productions: JSON.stringify(v.productions || []),
        productionCredits: JSON.stringify(v.productionCredits || []),
        awards: JSON.stringify(v.awards || []),
        curationNote: JSON.stringify(v.curationNote || { purpose: "", background: "", evaluation: "", sourceUrls: [] }),
        privateRating: v.privateRating || null,
        aiOverallRating: v.aiOverallRating || null,
        aiDirectionRating: v.aiDirectionRating || null,
        aiTechniqueRating: v.aiTechniqueRating || null,
        aiOverallScore: typeof v.aiOverallScore === "number" ? v.aiOverallScore : null,
        aiDirectionScore: typeof v.aiDirectionScore === "number" ? v.aiDirectionScore : null,
        aiTechniqueScore: typeof v.aiTechniqueScore === "number" ? v.aiTechniqueScore : null,
        aiScoreBreakdown: v.aiScoreBreakdown ? JSON.stringify(v.aiScoreBreakdown) : null,
        aiAnalysis: fullAnalysis,
        embedStatus: String(v.embedStatus || "unknown"),
        embedReason: v.embedReason || null,
        embedCheckedAt: v.embedCheckedAt ? new Date(v.embedCheckedAt) : null,
        addedDate: v.addedDate || null,
      };
    });

    let written = 0;
    if (apply && rows.length > 0) {
      const cols = Object.keys(rows[0]);
      const colSql = cols.map((c) => `\`${c}\``).join(", ");
      const placeholders = `(${cols.map(() => "?").join(", ")})`;
      const updateSql = cols.filter((c) => c !== "id").map((c) => `\`${c}\`=VALUES(\`${c}\`)`).join(", ");
      const chunkSize = 20;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const vals = chunk.flatMap((r) => cols.map((c) => r[c]));
        const sql = `INSERT INTO \`videos\` (${colSql}) VALUES ${chunk.map(() => placeholders).join(", ")} ON DUPLICATE KEY UPDATE ${updateSql}`;
        await targetDb.query(sql, vals);
        written += chunk.length;
        if (written % 500 === 0 || written === rows.length) {
          console.error(`[migrate] ${written}/${rows.length} videos upserted...`);
        }
      }
    }

    console.log(
      JSON.stringify(
        {
          mode: "api-plus-sqlite",
          apply,
          apiBase,
          sqlitePath,
          totalVideos: rows.length,
          withFullAnalysis: withAnalysis,
          written,
        },
        null,
        2,
      ),
    );
  }
} finally {
  await targetDb.end();
}
