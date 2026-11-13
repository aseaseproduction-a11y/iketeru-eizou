import { readFileSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const inputPath = process.argv[2] || "/home/ubuntu/iketeru-eizou/analysis/eizo100_all_years/production_research_remainder_corrected_verified/verification.json";
const canonical = (rawUrl = "") => {
  try {
    const url = new URL(rawUrl);
    if (/youtu\.be|youtube\.com/i.test(url.hostname)) {
      const id = url.hostname.includes("youtu.be") ? url.pathname.split("/").filter(Boolean).at(-1) : url.pathname.startsWith("/shorts/") ? url.pathname.split("/")[2] : url.searchParams.get("v");
      return id ? `youtube:${id}` : "";
    }
    if (/vimeo\.com/i.test(url.hostname)) return `vimeo:${url.pathname.split("/").filter(Boolean).at(-1) || ""}`;
  } catch { /* invalid URL */ }
  return "";
};
const verification = JSON.parse(readFileSync(inputPath, "utf8"));
const candidates = verification.verifiedEntries || [];
const db = await mysql.createConnection(process.env.DATABASE_URL);
const report = { updated: [], held: [] };
try {
  await db.beginTransaction();
  for (const candidate of candidates) {
    const [rows] = await db.execute("SELECT id, title, videoUrl, productions FROM videos WHERE id = ?", [candidate.videoId]);
    const row = rows.find((entry) => entry.title === candidate.title && canonical(entry.videoUrl) === canonical(candidate.videoUrl));
    if (!row) { report.held.push({ id: candidate.videoId, title: candidate.title, reason: "id_url_title_triple_check_mismatch" }); continue; }
    if (row.productions && row.productions !== "[]") { report.held.push({ id: candidate.videoId, title: candidate.title, reason: "production_already_present" }); continue; }
    const [result] = await db.execute(
      "UPDATE videos SET productions = ? WHERE id = ? AND title = ? AND videoUrl = ? AND (productions IS NULL OR productions = '' OR productions = '[]')",
      [JSON.stringify(candidate.productionValues), row.id, row.title, row.videoUrl]
    );
    if (result.affectedRows === 1) report.updated.push({ id: row.id, title: row.title, productions: candidate.productionValues, officialCreditUrls: candidate.sourceUrls });
    else report.held.push({ id: candidate.videoId, title: candidate.title, reason: "concurrent_or_condition_mismatch" });
  }
  await db.commit();
} catch (error) {
  await db.rollback();
  throw error;
} finally {
  await db.end();
}
const output = "/home/ubuntu/iketeru-eizou/analysis/eizo100_all_years/production_research_remainder_corrected_verified/apply_report.json";
writeFileSync(output, `${JSON.stringify({ appliedAt: new Date().toISOString(), inputPath, ...report }, null, 2)}\n`);
console.log(JSON.stringify({ candidates: candidates.length, updated: report.updated.length, held: report.held.length, output }, null, 2));
