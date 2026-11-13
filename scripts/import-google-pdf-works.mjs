import { createConnection } from "mysql2/promise";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const planPath = process.argv[2] || "/home/ubuntu/google-pdf-import/import_plan.json";
const outputDir = process.argv[3] || "/home/ubuntu/google-pdf-import";
const shouldApply = process.argv.includes("--apply");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) throw new Error("DATABASE_URL is required");

const plan = JSON.parse(readFileSync(planPath, "utf8"));
const candidates = plan.works.filter((work) => work.importStatus === "new");
const connection = await createConnection(databaseUrl);
const [existingRows] = await connection.query("SELECT id FROM videos WHERE id IN (?)", [candidates.map((work) => work.videoId)]);
const existingIds = new Set(existingRows.map((row) => row.id));
const toInsert = candidates.filter((work) => !existingIds.has(work.videoId));

const result = {
  sourcePdf: plan.sourcePdf,
  sourceLabel: plan.sourceLabel,
  executedAt: new Date().toISOString(),
  dryRun: !shouldApply,
  counts: {
    candidates: candidates.length,
    skippedExistingOnApply: existingIds.size,
    toInsert: toInsert.length,
    inserted: 0,
  },
  insertedWorks: [],
};

if (shouldApply && toInsert.length > 0) {
  const now = new Date();
  const addedDate = now.toISOString().slice(0, 10);
  await connection.beginTransaction();
  try {
    for (const work of toInsert) {
      const embedUrl = work.platform === "youtube"
        ? `https://www.youtube.com/embed/${work.videoId}`
        : `https://player.vimeo.com/video/${work.videoId}`;
      const provenanceTags = [
        "YouTube Works Awards Japan 2026",
        "PDF資料掲載",
        ...work.pdfPages.map((page) => `資料p.${page}`),
      ];
      await connection.query(
        `INSERT INTO videos (
          id, platform, title, thumbnail, videoUrl, embedUrl, source, sourceLabel,
          channelTitle, genres, products, directions, tones, allTags,
          purposes, expressions, toneEmotions, toneVisuals, toneTechniques, productions,
          embedStatus, addedDate
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          work.videoId,
          work.platform,
          work.title,
          work.thumbnail || "",
          work.videoUrl,
          embedUrl,
          work.source,
          work.sourceLabel,
          work.channelTitle || "",
          "[]", "[]", "[]", "[]", JSON.stringify(provenanceTags),
          "[]", "[]", "[]", "[]", "[]", "[]",
          "unknown",
          addedDate,
        ],
      );
      result.insertedWorks.push({
        id: work.videoId,
        platform: work.platform,
        title: work.title,
        videoUrl: work.videoUrl,
        pdfPages: work.pdfPages,
      });
    }
    await connection.commit();
    result.counts.inserted = result.insertedWorks.length;
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

await connection.end();
mkdirSync(outputDir, { recursive: true });
writeFileSync(path.join(outputDir, "import_result.json"), JSON.stringify(result, null, 2));
const markdownRows = (shouldApply ? result.insertedWorks : toInsert).map((work) => `| ${work.platform} | ${work.id || work.videoId} | ${work.title} | ${(work.pdfPages || []).join(", ")} | ${work.videoUrl} |`);
writeFileSync(
  path.join(outputDir, "import_result.md"),
  `# PDF掲載作品の登録結果\n\n- 資料: ${result.sourceLabel}\n- 実行日時: ${result.executedAt}\n- 実行モード: ${result.dryRun ? "dry-run" : "apply"}\n- 件数: ${JSON.stringify(result.counts)}\n\n| Platform | Video ID | Title | PDF page | URL |\n|---|---|---|---|---|\n${markdownRows.join("\n")}\n`,
);
console.log(JSON.stringify(result.counts, null, 2));
process.exit(0);
