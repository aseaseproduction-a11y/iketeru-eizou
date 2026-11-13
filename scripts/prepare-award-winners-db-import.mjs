import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const candidatesPath = process.argv[2] || "/home/ubuntu/award-winners-import/candidates.json";
const outputDir = process.argv[3] || "/home/ubuntu/award-winners-import";
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

const source = JSON.parse(readFileSync(candidatesPath, "utf8"));
const db = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await db.execute("SELECT id, platform, title, videoUrl FROM videos");
const byId = new Map(rows.map((row) => [String(row.id), row]));
const byUrl = new Map(rows.map((row) => [canonicalVideo(String(row.videoUrl)), row]).filter(([key]) => key));
const byTitle = new Map(rows.map((row) => [normalize(String(row.title)), row]).filter(([key]) => key));

const imports = [];
const duplicates = [];
const review = [];
for (const candidate of source.candidates || []) {
  const existingById = byId.get(candidate.video.id);
  const existingByUrl = byUrl.get(canonicalVideo(candidate.video.url));
  const existingByTitle = byTitle.get(normalize(candidate.title));
  const duplicate = existingById || existingByUrl;
  if (duplicate) {
    duplicates.push({ candidate, existingId: duplicate.id, reason: existingById ? "video_id" : "canonical_url" });
    continue;
  }
  if (existingByTitle) {
    review.push({ candidate, existingId: existingByTitle.id, reason: "normalized_title" });
    continue;
  }
  imports.push({
    id: candidate.video.id,
    platform: candidate.video.platform,
    title: candidate.title,
    thumbnail: candidate.thumbnail,
    videoUrl: candidate.video.url,
    embedUrl: candidate.video.platform === "youtube" ? `https://www.youtube.com/embed/${candidate.video.id}` : `https://player.vimeo.com/video/${candidate.video.id}`,
    source: "award_winners",
    sourceLabel: "公式アワード受賞作",
    channelTitle: candidate.channelTitle,
    awards: candidate.awards,
    allTags: Array.from(new Set(["受賞作", ...candidate.awards.flatMap((award) => [award.name, award.year, award.category])])),
    addedDate: new Date().toISOString().slice(0, 10),
  });
}
await db.end();

const plan = {
  preparedAt: new Date().toISOString(),
  counts: { candidates: source.candidates?.length || 0, imports: imports.length, duplicates: duplicates.length, review: review.length, hold: source.hold?.length || 0 },
  imports,
  duplicates,
  review,
  hold: source.hold || [],
};
writeFileSync(path.join(outputDir, "db_import_plan.json"), JSON.stringify(plan, null, 2));
const rowsMarkdown = imports.map((item) => `| ${item.awards.map((award) => award.name).join(" / ")} | ${item.title} | ${item.platform}:${item.id} | ${item.videoUrl} |`).join("\n");
writeFileSync(path.join(outputDir, "db_import_plan.md"), `# アワード受賞作のDB登録計画\n\n- 作成日時: ${plan.preparedAt}\n- 件数: ${JSON.stringify(plan.counts)}\n\n## 新規登録\n\n| Award | Video title | ID | URL |\n|---|---|---|---|\n${rowsMarkdown}\n`);
console.log(JSON.stringify(plan.counts, null, 2));
