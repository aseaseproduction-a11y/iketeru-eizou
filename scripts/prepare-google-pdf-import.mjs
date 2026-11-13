import { createConnection } from "mysql2/promise";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const inputPath = process.argv[2] || "/home/ubuntu/google-pdf-import/works_extracted.json";
const outputDir = process.argv[3] || "/home/ubuntu/google-pdf-import";
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) throw new Error("DATABASE_URL is required");

function canonicalVideoUrl(url, platform) {
  try {
    const parsed = new URL(url);
    if (platform === "youtube") {
      const id = parsed.hostname.includes("youtu.be")
        ? parsed.pathname.split("/").filter(Boolean).at(-1)
        : parsed.pathname.startsWith("/shorts/")
          ? parsed.pathname.split("/")[2]
          : parsed.searchParams.get("v");
      return id ? `youtube:${id}` : "";
    }
    if (platform === "vimeo") {
      const id = parsed.pathname.split("/").filter(Boolean).at(-1);
      return id ? `vimeo:${id}` : "";
    }
  } catch {
    return "";
  }
  return "";
}

function normalizeTitle(title) {
  return String(title || "")
    .replace(/&quot;/g, '"')
    .replace(/[\s　]+/g, " ")
    .trim()
    .toLocaleLowerCase("ja-JP");
}

const payload = JSON.parse(readFileSync(inputPath, "utf8"));
mkdirSync(outputDir, { recursive: true });

const connection = await createConnection(databaseUrl);
const [rows] = await connection.query("SELECT id, platform, title, videoUrl, source, sourceLabel FROM videos");
await connection.end();

const existingById = new Map(rows.map((row) => [`${row.platform}:${row.id}`, row]));
const existingByUrl = new Map(rows.map((row) => [canonicalVideoUrl(row.videoUrl, row.platform), row]));
const existingByTitle = new Map();
for (const row of rows) {
  const key = normalizeTitle(row.title);
  if (!existingByTitle.has(key)) existingByTitle.set(key, []);
  existingByTitle.get(key).push(row);
}

const works = payload.works.map((work) => {
  const videoKey = `${work.platform}:${work.videoId}`;
  const titleKey = normalizeTitle(work.title);
  const byId = existingById.get(videoKey);
  const byUrl = existingByUrl.get(canonicalVideoUrl(work.videoUrl, work.platform));
  const sameTitle = existingByTitle.get(titleKey) || [];
  const record = {
    ...work,
    source: "youtube_works_awards_2026",
    sourceLabel: "YouTube Works Awards Japan 2026 Case Study",
    existingVideoId: byId?.id || byUrl?.id || "",
    duplicateReason: byId ? "video_id" : byUrl ? "canonical_url" : sameTitle.length === 1 ? "title_only" : "",
    titleMatchIds: sameTitle.map((item) => item.id),
    importStatus: work.status !== "ready"
      ? "hold_metadata_unavailable"
      : byId || byUrl
        ? "duplicate"
        : sameTitle.length === 1
          ? "review_title_match"
          : "new",
  };
  return record;
});

const counts = works.reduce((acc, work) => {
  acc[work.importStatus] = (acc[work.importStatus] || 0) + 1;
  return acc;
}, {});
const plan = {
  sourcePdf: payload.sourcePdf,
  sourceLabel: payload.sourceLabel,
  preparedAt: new Date().toISOString(),
  counts,
  works,
};

writeFileSync(path.join(outputDir, "import_plan.json"), JSON.stringify(plan, null, 2));
const rowsMarkdown = works.map((work) => `| ${work.importStatus} | ${work.platform} | ${work.videoId} | ${work.title || "（要確認）"} | ${work.pdfPages.join(", ")} | ${work.existingVideoId || ""} | ${work.videoUrl} |`);
writeFileSync(
  path.join(outputDir, "import_plan.md"),
  `# PDF掲載作品の登録計画\n\n- 資料: ${plan.sourceLabel}\n- 作成日時: ${plan.preparedAt}\n- 件数: ${JSON.stringify(counts)}\n\n| Status | Platform | Video ID | Title | PDF page | Existing ID | URL |\n|---|---|---|---|---|---|---|\n${rowsMarkdown.join("\n")}\n`,
);

console.log(JSON.stringify(counts, null, 2));
