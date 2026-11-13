import { readFileSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const canonicalVideo = (rawUrl = "") => {
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
  } catch { /* invalid URL is not eligible */ }
  return "";
};
const plan = JSON.parse(readFileSync("/home/ubuntu/eizo100-previous-years-import/import_plan.json", "utf8"));
const dryRun = JSON.parse(readFileSync("/home/ubuntu/eizo100-previous-years-import/import_result_dry_run.json", "utf8"));
const skippedIds = new Set(dryRun.skipped.map((item) => item.id));
const updates = plan.imports.filter((item) => skippedIds.has(item.id));
if (updates.length !== 48) throw new Error(`Expected 48 existing candidates, received ${updates.length}`);
const db = await mysql.createConnection(process.env.DATABASE_URL);
const report = [];
const held = [];
for (const item of updates) {
  const [rows] = await db.execute("SELECT id, title, videoUrl, sourceLabel, awards, curationNote FROM videos WHERE id = ? OR title = ?", [item.id, item.title]);
  const row = rows.find((candidate) => String(candidate.id) === item.id && canonicalVideo(String(candidate.videoUrl)) === canonicalVideo(item.videoUrl));
  if (!row) {
    held.push({ id: item.id, title: item.title, reason: "id_url_triple_check_mismatch" });
    continue;
  }
  const awards = JSON.parse(row.awards || "[]");
  for (const award of item.awards) {
    if (!awards.some((entry) => entry.name === award.name && entry.year === award.year && entry.category === award.category && entry.sourceUrl === award.sourceUrl)) awards.push(award);
  }
  let note;
  try { note = JSON.parse(row.curationNote || ""); } catch { note = null; }
  if (!note || typeof note !== "object") note = item.curationNote;
  else {
    note = {
      purpose: note.purpose?.trim() || item.curationNote.purpose,
      background: note.background?.trim() || item.curationNote.background,
      evaluation: note.evaluation?.trim() || item.curationNote.evaluation,
      sourceUrls: [...new Set([...(Array.isArray(note.sourceUrls) ? note.sourceUrls : []), ...item.curationNote.sourceUrls])],
    };
  }
  const labels = new Set(String(row.sourceLabel || "").split(" / ").filter(Boolean));
  for (const label of item.sourceLabel.split(" / ")) labels.add(label);
  const [result] = await db.execute("UPDATE videos SET title = ?, sourceLabel = ?, awards = ?, curationNote = ? WHERE id = ? AND videoUrl = ?", [item.title, Array.from(labels).join(" / "), JSON.stringify(awards), JSON.stringify(note), row.id, row.videoUrl]);
  if (result.affectedRows !== 1) throw new Error(`Expected one update for ${item.id}`);
  report.push({ id: item.id, title: item.title, awardCount: item.awards.length });
}
await db.end();
writeFileSync("/home/ubuntu/eizo100-previous-years-import/existing_update_result.json", `${JSON.stringify({ updatedAt: new Date().toISOString(), count: report.length, heldCount: held.length, report, held }, null, 2)}\n`);
console.log(JSON.stringify({ updated: report.length, held: held.length }, null, 2));
