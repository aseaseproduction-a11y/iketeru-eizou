import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const outputDir = process.env.IMPORT_OUTPUT_DIR || "/home/ubuntu/iketeru-eizou/analysis/site_imports";
const planPath = process.env.IMPORT_PLAN_PATH || `${outputDir}/official_video_import_plan.json`;
const apply = process.argv.includes("--apply");
mkdirSync(outputDir, { recursive: true });
const plan = JSON.parse(readFileSync(planPath, "utf8"));
const normalize = (value = "") => String(value).toLowerCase().replace(/[\s\p{P}\p{S}_]+/gu, "");
const canonical = (url = "") => {
  try {
    const parsed = new URL(url);
    if (/youtu\.be|youtube\.com/i.test(parsed.hostname)) {
      const id = parsed.hostname.includes("youtu.be") ? parsed.pathname.split("/").filter(Boolean).at(-1) : parsed.searchParams.get("v") || parsed.pathname.match(/\/(?:embed|shorts)\/([^/?]+)/)?.[1];
      return id ? `youtube:${id}` : "";
    }
    if (/vimeo\.com/i.test(parsed.hostname)) {
      const id = parsed.pathname.match(/\/(?:video\/)?(\d+)/)?.[1];
      return id ? `vimeo:${id}` : "";
    }
  } catch { /* invalid URL */ }
  return "";
};
const db = await mysql.createConnection(process.env.DATABASE_URL);
const [existingRows] = await db.execute("SELECT id, videoUrl, title FROM videos");
const ids = new Set(existingRows.map((row) => String(row.id)));
const urls = new Set(existingRows.map((row) => canonical(String(row.videoUrl))).filter(Boolean));
const titles = new Set(existingRows.map((row) => normalize(row.title)).filter(Boolean));
const insertable = [];
const skipped = [];
for (const item of plan.imports || []) {
  const titleKey = normalize(item.title);
  const collision = ids.has(item.id) ? "duplicate_id" : urls.has(canonical(item.videoUrl)) ? "duplicate_url" : titles.has(titleKey) ? "duplicate_normalized_title" : "";
  if (collision) skipped.push({ id: item.id, title: item.title, reason: collision });
  else {
    insertable.push(item);
    ids.add(item.id);
    urls.add(canonical(item.videoUrl));
    titles.add(titleKey);
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
        "[]", "[]", "[]", "[]", JSON.stringify(item.allTags || []), "[]", "[]", "[]", "[]", "[]", JSON.stringify(item.productions || []), JSON.stringify(item.awards || []), JSON.stringify(item.curationNote), item.addedDate, "unknown",
      ]);
      await db.execute(`INSERT INTO videos (id, platform, title, thumbnail, videoUrl, embedUrl, source, sourceLabel, channelTitle, genres, products, directions, tones, allTags, purposes, expressions, toneEmotions, toneVisuals, toneTechniques, productions, awards, curationNote, addedDate, embedStatus) VALUES ${placeholders}`, values);
      inserted.push(...batch.map((item) => ({ id: item.id, title: item.title, source: item.source, videoUrl: item.videoUrl })));
    }
  }
} finally {
  await db.end();
}
const report = { mode: apply ? "apply" : "dry-run", completedAt: new Date().toISOString(), counts: { planned: plan.imports?.length || 0, insertable: insertable.length, inserted: inserted.length, skipped: skipped.length }, inserted, skipped };
writeFileSync(`${outputDir}/official_video_import_${apply ? "apply" : "dry_run"}.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.counts, null, 2));
process.exit(0);
