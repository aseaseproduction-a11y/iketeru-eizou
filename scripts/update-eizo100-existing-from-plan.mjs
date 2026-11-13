import { readFileSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

const [planPath, resultPath] = process.argv.slice(2);
if (!planPath || !resultPath) throw new Error("Usage: node update-eizo100-existing-from-plan.mjs <plan.json> <dry-run-result.json>");
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
  } catch { /* not eligible */ }
  return "";
};
const plan = JSON.parse(readFileSync(planPath, "utf8"));
const dryRun = JSON.parse(readFileSync(resultPath, "utf8"));
const skippedIds = new Set(dryRun.skipped.map((item) => item.id));
const candidates = plan.imports.filter((item) => skippedIds.has(item.id));
const db = await mysql.createConnection(process.env.DATABASE_URL);
const updated = [];
const held = [];
try {
  for (const item of candidates) {
    const [rows] = await db.execute("SELECT id, title, videoUrl, sourceLabel, awards, curationNote FROM videos WHERE id = ? OR title = ?", [item.id, item.title]);
    const row = rows.find((candidate) => String(candidate.id) === item.id && canonical(candidate.videoUrl) === canonical(item.videoUrl));
    if (!row) { held.push({ id: item.id, title: item.title, reason: "id_url_triple_check_mismatch" }); continue; }
    let awards = [];
    let note = null;
    try { awards = JSON.parse(row.awards || "[]"); } catch { awards = []; }
    try { note = JSON.parse(row.curationNote || ""); } catch { note = null; }
    for (const award of item.awards) if (!awards.some((entry) => entry.name === award.name && entry.year === award.year && entry.category === award.category && entry.sourceUrl === award.sourceUrl)) awards.push(award);
    note = note && typeof note === "object" ? {
      purpose: note.purpose?.trim() || item.curationNote.purpose,
      background: note.background?.trim() || item.curationNote.background,
      evaluation: note.evaluation?.trim() || item.curationNote.evaluation,
      sourceUrls: [...new Set([...(Array.isArray(note.sourceUrls) ? note.sourceUrls : []), ...item.curationNote.sourceUrls])],
    } : item.curationNote;
    const labels = new Set(String(row.sourceLabel || "").split(" / ").filter(Boolean));
    for (const label of item.sourceLabel.split(" / ")) labels.add(label);
    const [result] = await db.execute("UPDATE videos SET title = ?, sourceLabel = ?, awards = ?, curationNote = ? WHERE id = ? AND videoUrl = ?", [item.title, [...labels].join(" / "), JSON.stringify(awards), JSON.stringify(note), row.id, row.videoUrl]);
    if (result.affectedRows !== 1) throw new Error(`Update failed: ${item.id}`);
    updated.push({ id: item.id, title: item.title });
  }
} finally {
  await db.end();
}
const outputPath = resultPath.replace(/\.json$/, "_existing_updates.json");
writeFileSync(outputPath, `${JSON.stringify({ updatedAt: new Date().toISOString(), updated, held }, null, 2)}\n`);
console.log(JSON.stringify({ updated: updated.length, held: held.length, outputPath }, null, 2));
