import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const planPath = process.argv[2] || "/home/ubuntu/alincolony-good-movies-import/import_plan.json";
const apply = process.argv.includes("--apply");
const outputDir = path.dirname(planPath);
mkdirSync(outputDir, { recursive: true });
const plan = JSON.parse(readFileSync(planPath, "utf8"));
const canonical = (url = "") => {
  try {
    const parsed = new URL(url);
    if (/youtu\.be|youtube\.com/i.test(parsed.hostname)) {
      const id = parsed.hostname.includes("youtu.be") ? parsed.pathname.split("/").filter(Boolean).at(-1) : parsed.searchParams.get("v") || parsed.pathname.split("/").filter(Boolean).at(-1);
      return id ? `youtube:${id}` : "";
    }
    if (/vimeo\.com/i.test(parsed.hostname)) return `vimeo:${parsed.pathname.split("/").filter(Boolean).at(-1)}`;
  } catch { /* invalid URL */ }
  return "";
};
const db = await mysql.createConnection(process.env.DATABASE_URL);
const [existingRows] = await db.execute("SELECT id, videoUrl FROM videos");
const existingIds = new Set(existingRows.map((row) => String(row.id)));
const existingUrls = new Set(existingRows.map((row) => canonical(String(row.videoUrl))).filter(Boolean));
const insertable = [];
const skipped = [];
for (const item of plan.imports || []) {
  if (existingIds.has(item.id) || existingUrls.has(canonical(item.videoUrl))) {
    skipped.push({ id: item.id, title: item.title, reason: "duplicate_id_or_url" });
  } else {
    insertable.push(item);
    existingIds.add(item.id);
    existingUrls.add(canonical(item.videoUrl));
  }
}
const inserted = [];
try {
  if (apply) {
    for (let offset = 0; offset < insertable.length; offset += 50) {
      const batch = insertable.slice(offset, offset + 50);
      const placeholders = batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",");
      const values = batch.flatMap((item) => [
        item.id, item.platform, item.title, item.thumbnail || null, item.videoUrl, item.embedUrl, item.source, item.sourceLabel, item.channelTitle || null,
        "[]", "[]", "[]", "[]", JSON.stringify(item.allTags || []), "[]", "[]", "[]", "[]", "[]", "[]", JSON.stringify(item.awards || []), JSON.stringify(item.curationNote), item.addedDate, "unknown",
      ]);
      await db.execute(`INSERT INTO videos (id, platform, title, thumbnail, videoUrl, embedUrl, source, sourceLabel, channelTitle, genres, products, directions, tones, allTags, purposes, expressions, toneEmotions, toneVisuals, toneTechniques, productions, awards, curationNote, addedDate, embedStatus) VALUES ${placeholders}`, values);
      inserted.push(...batch.map((item) => ({ id: item.id, title: item.title, platform: item.platform, videoUrl: item.videoUrl })));
    }
  }
} finally {
  await db.end();
}
const report = { mode: apply ? "apply" : "dry-run", completedAt: new Date().toISOString(), counts: { planned: plan.imports?.length || 0, insertable: insertable.length, inserted: inserted.length, skipped: skipped.length }, inserted, skipped };
writeFileSync(path.join(outputDir, `import_result_${apply ? "apply" : "dry_run"}.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.counts, null, 2));
