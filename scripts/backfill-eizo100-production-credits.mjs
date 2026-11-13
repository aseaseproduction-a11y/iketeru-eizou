import { writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const patterns = [
  /^(?:制作会社|制作|企画制作|映像制作|Production|プロダクション)\s*[：:]?\s*(.+)$/im,
  /^(?:監督|ディレクター|Director|アニメーション|Animation)\s*[：:]?\s*(.+)$/im,
];
const normalizeCredit = (value) => value.replace(/[\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim().replace(/[。．]$/, "");
const db = await mysql.createConnection(process.env.DATABASE_URL);
const report = { updated: [], held: [] };
try {
  const [rows] = await db.execute("SELECT id, videoUrl, curationNote FROM videos WHERE awards LIKE '%映像作家100人%' AND (productions IS NULL OR productions = '' OR productions = '[]')");
  for (const row of rows) {
    let note;
    try { note = JSON.parse(row.curationNote || ""); } catch { note = null; }
    const text = [note?.background, note?.evaluation].filter(Boolean).join("\n");
    const credits = [...new Set(patterns.map((pattern) => text.match(pattern)?.[1]).filter(Boolean).map(normalizeCredit).filter((credit) => credit.length > 1 && credit.length <= 160 && !/^https?:/i.test(credit)))];
    if (!credits.length) { report.held.push({ id: row.id, reason: "no_explicit_credit_line" }); continue; }
    const [result] = await db.execute("UPDATE videos SET productions = ? WHERE id = ? AND videoUrl = ? AND (productions IS NULL OR productions = '' OR productions = '[]')", [JSON.stringify(credits), row.id, row.videoUrl]);
    if (result.affectedRows === 1) report.updated.push({ id: row.id, productions: credits });
  }
} finally {
  await db.end();
}
writeFileSync("/home/ubuntu/iketeru-eizou/analysis/eizo100_all_years/production_credit_backfill.json", `${JSON.stringify({ completedAt: new Date().toISOString(), ...report }, null, 2)}\n`);
console.log(JSON.stringify({ updated: report.updated.length, held: report.held.length }, null, 2));
