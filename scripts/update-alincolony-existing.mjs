import { readFileSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const planPath = process.argv[2] || "/home/ubuntu/alincolony-good-movies-import/import_plan.json";
const normalize = (value = "") => String(value).toLowerCase().normalize("NFKC").replace(/[\s\p{P}\p{S}_]+/gu, "");
const canonical = (url = "") => {
  const parsed = new URL(url);
  if (/youtu\.be|youtube\.com/i.test(parsed.hostname)) return `youtube:${parsed.hostname.includes("youtu.be") ? parsed.pathname.split("/").filter(Boolean).at(-1) : parsed.searchParams.get("v") || parsed.pathname.split("/").filter(Boolean).at(-1)}`;
  if (/vimeo\.com/i.test(parsed.hostname)) return `vimeo:${parsed.pathname.split("/").filter(Boolean).at(-1)}`;
  return "";
};
const titleMatches = (left, right) => {
  const a = normalize(left); const b = normalize(right);
  return a === b || (Math.min(a.length, b.length) >= 12 && (a.includes(b) || b.includes(a)));
};
const plan = JSON.parse(readFileSync(planPath, "utf8"));
const db = await mysql.createConnection(process.env.DATABASE_URL);
const report = { updated: [], held: [] };
try {
  for (const item of plan.imports || []) {
    const [rows] = await db.execute("SELECT id, title, videoUrl, sourceLabel, allTags, curationNote FROM videos WHERE id = ?", [item.id]);
    if (!rows.length) continue;
    const row = rows[0];
    if (canonical(row.videoUrl) !== canonical(item.videoUrl) || !titleMatches(row.title, item.title)) {
      report.held.push({ id: item.id, title: item.title, existingTitle: row.title, reason: "triple_check_mismatch" });
      continue;
    }
    let note;
    try { note = JSON.parse(row.curationNote || "{}"); } catch { note = {}; }
    const sourceUrls = [...new Set([...(Array.isArray(note.sourceUrls) ? note.sourceUrls : []), ...item.curationNote.sourceUrls])];
    const mergedNote = {
      purpose: note.purpose || item.curationNote.purpose,
      background: note.background || item.curationNote.background,
      evaluation: note.evaluation || item.curationNote.evaluation,
      sourceUrls,
    };
    let tags;
    try { tags = JSON.parse(row.allTags || "[]"); } catch { tags = []; }
    tags = [...new Set([...(Array.isArray(tags) ? tags : []), "ALINCOLONY", "よかった映像まとめ"])];
    const label = String(row.sourceLabel || "");
    const sourceLabel = label.includes("ALINCOLONY") ? label : `${label || "既存登録"} / ALINCOLONY よかった映像`;
    const [result] = await db.execute("UPDATE videos SET sourceLabel = ?, allTags = ?, curationNote = ? WHERE id = ? AND videoUrl = ?", [sourceLabel, JSON.stringify(tags), JSON.stringify(mergedNote), row.id, row.videoUrl]);
    if (result.affectedRows === 1) report.updated.push({ id: row.id, title: row.title });
    else report.held.push({ id: item.id, title: item.title, reason: "update_condition_mismatch" });
  }
} finally {
  await db.end();
}
writeFileSync("/home/ubuntu/alincolony-good-movies-import/existing_update_result.json", `${JSON.stringify({ completedAt: new Date().toISOString(), ...report }, null, 2)}\n`);
console.log(JSON.stringify({ updated: report.updated.length, held: report.held.length }, null, 2));
