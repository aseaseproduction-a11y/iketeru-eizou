import { readFileSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const plan = JSON.parse(readFileSync("/home/ubuntu/eizo100-2026-recheck-import/import_plan.json", "utf8"));
const dryRun = JSON.parse(readFileSync("/home/ubuntu/eizo100-2026-recheck-import/import_result_dry_run.json", "utf8"));
const skippedIds = new Set(dryRun.skipped.map((item) => item.id));
const updates = plan.imports.filter((item) => skippedIds.has(item.id));
if (updates.length !== 10) throw new Error(`Expected 10 existing candidates, received ${updates.length}`);

const db = await mysql.createConnection(process.env.DATABASE_URL);
const report = [];
for (const item of updates) {
  const [rows] = await db.execute("SELECT id, title, videoUrl, sourceLabel, awards, curationNote FROM videos WHERE id = ? AND videoUrl = ?", [item.id, item.videoUrl]);
  if (rows.length !== 1) throw new Error(`ID/URL double-check failed for ${item.id}`);
  const row = rows[0];
  const awards = JSON.parse(row.awards || "[]");
  const award = item.awards[0];
  if (!awards.some((entry) => entry.name === award.name && entry.year === award.year && entry.category === award.category && entry.sourceUrl === award.sourceUrl)) awards.push(award);
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
  labels.add("映像作家100人 2026");
  const [result] = await db.execute("UPDATE videos SET title = ?, sourceLabel = ?, awards = ?, curationNote = ? WHERE id = ? AND videoUrl = ?", [item.title, Array.from(labels).join(" / "), JSON.stringify(awards), JSON.stringify(note), item.id, item.videoUrl]);
  if (result.affectedRows !== 1) throw new Error(`Expected one update for ${item.id}`);
  report.push({ id: item.id, existingTitle: row.title, sourceUrl: award.sourceUrl });
}
await db.end();
writeFileSync("/home/ubuntu/eizo100-2026-recheck-import/existing_update_result.json", `${JSON.stringify({ updatedAt: new Date().toISOString(), count: report.length, report }, null, 2)}\n`);
console.log(JSON.stringify({ updated: report.length }, null, 2));
