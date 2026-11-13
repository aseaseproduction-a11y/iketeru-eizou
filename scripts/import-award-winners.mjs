import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const planPath = process.argv[2] || "/home/ubuntu/award-winners-import/db_import_plan.json";
const apply = process.argv.includes("--apply");
const outputDir = path.dirname(planPath);
mkdirSync(outputDir, { recursive: true });

function normalize(value = "") {
  return value.toLowerCase().normalize("NFKC").replace(/[\s\-‐‑–—_・:：!！?？()（）\[\]【】]/g, "");
}

function canonicalVideo(url) {
  try {
    const parsed = new URL(url);
    if (/youtu\.be|youtube\.com/i.test(parsed.hostname)) {
      const id = parsed.hostname.includes("youtu.be")
        ? parsed.pathname.split("/").filter(Boolean).at(-1)
        : parsed.pathname.startsWith("/shorts/") ? parsed.pathname.split("/")[2] : parsed.searchParams.get("v");
      return id ? `youtube:${id}` : "";
    }
    if (/vimeo\.com/i.test(parsed.hostname)) {
      const id = parsed.pathname.split("/").filter(Boolean).at(-1);
      return id ? `vimeo:${id}` : "";
    }
  } catch {
    return "";
  }
  return "";
}

function hasCompleteCurationNote(note) {
  return Boolean(
    note &&
    typeof note.purpose === "string" && note.purpose.trim() &&
    typeof note.background === "string" && note.background.trim() &&
    typeof note.evaluation === "string" && note.evaluation.trim() &&
    Array.isArray(note.sourceUrls) && note.sourceUrls.length,
  );
}

const plan = JSON.parse(readFileSync(planPath, "utf8"));
const db = await mysql.createConnection(process.env.DATABASE_URL);
const [existingRows] = await db.execute("SELECT id, title, videoUrl FROM videos");
const existingById = new Map(existingRows.map((row) => [String(row.id), row]));
const existingByUrl = new Map(existingRows.map((row) => [canonicalVideo(String(row.videoUrl)), row]).filter(([key]) => key));
const existingByTitle = new Map(existingRows.map((row) => [normalize(String(row.title)), row]).filter(([key]) => key));

const inserted = [];
const skipped = [];
for (const item of plan.imports || []) {
  const duplicate = existingById.get(item.id) || existingByUrl.get(canonicalVideo(item.videoUrl)) || existingByTitle.get(normalize(item.title));
  if (duplicate) {
    skipped.push({ id: item.id, title: item.title, existingId: duplicate.id, reason: "duplicate_at_import" });
    continue;
  }
  if (apply && !hasCompleteCurationNote(item.curationNote)) {
    skipped.push({ id: item.id, title: item.title, reason: "missing_complete_curation_note" });
    continue;
  }
  if (apply) {
    await db.execute(
      `INSERT INTO videos (
        id, platform, title, thumbnail, videoUrl, embedUrl, source, sourceLabel, channelTitle,
        genres, products, directions, tones, allTags, purposes, expressions, toneEmotions,
        toneVisuals, toneTechniques, productions, awards, curationNote, addedDate, embedStatus
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.id, item.platform, item.title, item.thumbnail || null, item.videoUrl, item.embedUrl,
        item.source, item.sourceLabel, item.channelTitle || null,
        "[]", "[]", "[]", "[]", JSON.stringify(item.allTags || []), "[]", "[]", "[]", "[]", "[]", "[]",
        JSON.stringify(item.awards || []), JSON.stringify(item.curationNote), item.addedDate, "unknown",
      ],
    );
  }
  inserted.push({ id: item.id, title: item.title, platform: item.platform, videoUrl: item.videoUrl, awards: item.awards });
  existingById.set(item.id, item);
  existingByUrl.set(canonicalVideo(item.videoUrl), item);
  existingByTitle.set(normalize(item.title), item);
}
await db.end();

const report = { mode: apply ? "apply" : "dry-run", completedAt: new Date().toISOString(), inserted, skipped, counts: { planned: plan.imports?.length || 0, inserted: inserted.length, skipped: skipped.length } };
writeFileSync(path.join(outputDir, `import_result_${apply ? "apply" : "dry_run"}.json`), JSON.stringify(report, null, 2));
writeFileSync(path.join(outputDir, `import_result_${apply ? "apply" : "dry_run"}.md`), `# アワード受賞作登録結果\n\n- モード: ${report.mode}\n- 完了日時: ${report.completedAt}\n- 件数: ${JSON.stringify(report.counts)}\n\n## 登録対象\n\n| Title | ID | Platform | Awards | URL |\n|---|---|---|---|---|\n${inserted.map((item) => `| ${item.title} | ${item.id} | ${item.platform} | ${item.awards.map((award) => `${award.name} ${award.year} ${award.category}`).join("<br>")} | ${item.videoUrl} |`).join("\n")}\n`);
console.log(JSON.stringify(report.counts, null, 2));
