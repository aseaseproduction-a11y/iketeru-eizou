import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const planPath = process.argv[2] || "/home/ubuntu/eizo100-2026-import/import_plan.json";
const plan = JSON.parse(readFileSync(planPath, "utf8"));
const db = await mysql.createConnection(process.env.DATABASE_URL);
const ids = plan.imports.map((item) => item.id);
const placeholders = ids.map(() => "?").join(",");
const [rows] = await db.execute(`SELECT id, title, videoUrl, awards, curationNote FROM videos WHERE id IN (${placeholders})`, ids);
await db.end();
const rowsById = new Map(rows.map((row) => [row.id, row]));

const results = plan.imports.map((item) => {
  const row = rowsById.get(item.id);
  let awards = [];
  let note = null;
  try { awards = row?.awards ? JSON.parse(row.awards) : []; } catch { awards = []; }
  try { note = row?.curationNote ? JSON.parse(row.curationNote) : null; } catch { note = null; }
  const tripleMatch = Boolean(row && row.title === item.title && row.videoUrl === item.videoUrl);
  const awardSourceMatch = item.awards.every((award) => awards.some((entry) => entry.name === award.name && entry.year === award.year && entry.category === award.category && entry.sourceUrl === award.sourceUrl));
  const noteSourceMatch = item.awards.every((award) => Boolean(note?.sourceUrls?.includes(award.sourceUrl)));
  return { id: item.id, title: item.title, sourcePostIds: item.awards.map((award) => award.sourceUrl), tripleMatch, awardSourceMatch, noteSourceMatch, result: tripleMatch && awardSourceMatch && noteSourceMatch ? "verified" : "mismatch" };
});
const summary = results.reduce((accumulator, item) => ({ ...accumulator, [item.result]: (accumulator[item.result] || 0) + 1 }), { total: results.length });
writeFileSync(path.join(path.dirname(planPath), "registration_audit.json"), `${JSON.stringify({ auditedAt: new Date().toISOString(), summary, results }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
