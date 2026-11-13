import { readFileSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const canonical = (rawUrl = "") => {
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
  } catch { /* invalid URL */ }
  return "";
};
const candidates = JSON.parse(readFileSync("/home/ubuntu/iketeru-eizou/analysis/eizo100_all_years/production_research/aggregated_candidates.json", "utf8")).rows.filter((row) => row.result === "verified");
const db = await mysql.createConnection(process.env.DATABASE_URL);
const report = { updated: [], held: [] };
try {
  for (const candidate of candidates) {
    const [rows] = await db.execute("SELECT id, videoUrl, productions FROM videos WHERE id = ?", [candidate.id]);
    const row = rows.find((entry) => canonical(entry.videoUrl) === canonical(candidate.videoUrl));
    if (!row) { report.held.push({ id: candidate.id, reason: "id_url_triple_check_mismatch" }); continue; }
    const isEmpty = !row.productions || row.productions === "[]";
    if (!isEmpty) { report.held.push({ id: candidate.id, reason: "production_already_present" }); continue; }
    const [result] = await db.execute("UPDATE videos SET productions = ? WHERE id = ? AND videoUrl = ? AND (productions IS NULL OR productions = '' OR productions = '[]')", [JSON.stringify(candidate.productionValues), row.id, row.videoUrl]);
    if (result.affectedRows === 1) report.updated.push({ id: candidate.id, title: candidate.title, productions: candidate.productionValues, officialCreditUrls: candidate.officialCreditUrls });
    else report.held.push({ id: candidate.id, reason: "concurrent_or_condition_mismatch" });
  }
} finally {
  await db.end();
}
writeFileSync("/home/ubuntu/iketeru-eizou/analysis/eizo100_all_years/production_research/apply_report.json", `${JSON.stringify({ appliedAt: new Date().toISOString(), ...report }, null, 2)}\n`);
console.log(JSON.stringify({ candidates: candidates.length, updated: report.updated.length, held: report.held.length }, null, 2));
