import { readFileSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const plan = JSON.parse(readFileSync("/home/ubuntu/alincolony-good-movies-import/import_plan.json", "utf8"));
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
const asBase64Sql = (value) => `FROM_BASE64('${Buffer.from(String(value), "utf8").toString("base64")}')`;

const db = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await db.execute("SELECT id, title, videoUrl, sourceLabel, allTags, curationNote FROM videos");
await db.end();
const existingById = new Map(rows.map((row) => [String(row.id), row]));
const updates = [];
const held = [];
for (const item of plan.imports || []) {
  const row = existingById.get(item.id);
  if (!row || row.sourceLabel?.includes("ALINCOLONY")) continue;
  if (canonical(row.videoUrl) !== canonical(item.videoUrl) || !titleMatches(row.title, item.title)) {
    held.push({ id: item.id, title: item.title, existingTitle: row.title, reason: "triple_check_mismatch" });
    continue;
  }
  let tags; let note;
  try { tags = JSON.parse(row.allTags || "[]"); } catch { tags = []; }
  try { note = JSON.parse(row.curationNote || "{}"); } catch { note = {}; }
  const nextTags = [...new Set([...(Array.isArray(tags) ? tags : []), "ALINCOLONY", "よかった映像まとめ"])];
  const nextNote = { purpose: note.purpose || item.curationNote.purpose, background: note.background || item.curationNote.background, evaluation: note.evaluation || item.curationNote.evaluation, sourceUrls: [...new Set([...(Array.isArray(note.sourceUrls) ? note.sourceUrls : []), ...item.curationNote.sourceUrls])] };
  const nextLabel = `${row.sourceLabel || "既存登録"} / ALINCOLONY よかった映像`;
  updates.push({ id: row.id, title: row.title, sql: `UPDATE videos SET sourceLabel = ${asBase64Sql(nextLabel)}, allTags = ${asBase64Sql(JSON.stringify(nextTags))}, curationNote = ${asBase64Sql(JSON.stringify(nextNote))} WHERE id = ${asBase64Sql(row.id)} AND videoUrl = ${asBase64Sql(row.videoUrl)} AND sourceLabel NOT LIKE '%ALINCOLONY%';` });
}
writeFileSync("/home/ubuntu/alincolony-good-movies-import/existing_updates.sql", `${updates.map((item) => item.sql).join("\n")}\n`);
writeFileSync("/home/ubuntu/alincolony-good-movies-import/existing_updates_plan.json", `${JSON.stringify({ generatedAt: new Date().toISOString(), updates: updates.map(({ id, title }) => ({ id, title })), held }, null, 2)}\n`);
console.log(JSON.stringify({ updates: updates.length, held: held.length }, null, 2));
