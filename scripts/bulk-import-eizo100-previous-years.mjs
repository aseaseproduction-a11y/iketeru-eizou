import { readFileSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const normalize = (value = "") => value.toLowerCase().normalize("NFKC").replace(/[\s\-‐‑–—_・:：!！?？()（）\[\]【】]/g, "");
const canonicalVideo = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    if (/youtu\.be|youtube\.com/i.test(url.hostname)) {
      const id = url.hostname.includes("youtu.be") ? url.pathname.split("/").filter(Boolean).at(-1) : url.pathname.startsWith("/shorts/") ? url.pathname.split("/")[2] : url.searchParams.get("v");
      return id ? `youtube:${id}` : "";
    }
    if (/vimeo\.com/i.test(url.hostname)) {
      const id = url.pathname.split("/").filter(Boolean).at(-1);
      return id ? `vimeo:${id}` : "";
    }
  } catch { /* treated as no canonical URL */ }
  return "";
};
const plan = JSON.parse(readFileSync("/home/ubuntu/eizo100-previous-years-import/import_plan.json", "utf8"));
const db = await mysql.createConnection(process.env.DATABASE_URL);
try {
  const [rows] = await db.execute("SELECT id, title, videoUrl FROM videos");
  const ids = new Set(rows.map((row) => String(row.id)));
  const urls = new Set(rows.map((row) => canonicalVideo(String(row.videoUrl))).filter(Boolean));
  const titles = new Set(rows.map((row) => normalize(String(row.title))).filter(Boolean));
  const pending = plan.imports.filter((item) => !ids.has(item.id) && !urls.has(canonicalVideo(item.videoUrl)) && !titles.has(normalize(item.title)));
  const skipped = plan.imports.length - pending.length;
  const columns = "id, platform, title, thumbnail, videoUrl, embedUrl, source, sourceLabel, channelTitle, genres, products, directions, tones, allTags, purposes, expressions, toneEmotions, toneVisuals, toneTechniques, productions, awards, curationNote, addedDate, embedStatus";
  const inserted = [];
  for (let start = 0; start < pending.length; start += 50) {
    const batch = pending.slice(start, start + 50);
    const placeholders = batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    const values = batch.flatMap((item) => [
      item.id, item.platform, item.title, item.thumbnail || null, item.videoUrl, item.embedUrl, item.source, item.sourceLabel, item.channelTitle || null,
      "[]", "[]", "[]", "[]", JSON.stringify(item.allTags || []), "[]", "[]", "[]", "[]", "[]", "[]", JSON.stringify(item.awards || []), JSON.stringify(item.curationNote), item.addedDate, "unknown",
    ]);
    await db.execute(`INSERT INTO videos (${columns}) VALUES ${placeholders}`, values);
    inserted.push(...batch.map((item) => ({ id: item.id, title: item.title })));
    console.log(`inserted ${inserted.length}/${pending.length}`);
  }
  writeFileSync("/home/ubuntu/eizo100-previous-years-import/bulk_resume_result.json", `${JSON.stringify({ completedAt: new Date().toISOString(), planned: plan.imports.length, existingOrPreviouslyInserted: skipped, insertedNow: inserted.length, inserted }, null, 2)}\n`);
  console.log(JSON.stringify({ planned: plan.imports.length, existingOrPreviouslyInserted: skipped, insertedNow: inserted.length }, null, 2));
} finally {
  await db.end();
}
