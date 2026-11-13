import { createConnection } from "mysql2/promise";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const planPath = process.argv[2] || "/home/ubuntu/google-pdf-import/import_plan.json";
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

const plan = JSON.parse(readFileSync(planPath, "utf8"));
const connection = await createConnection(databaseUrl);
const [allRows] = await connection.query("SELECT id, platform, title, videoUrl, source FROM videos");
await connection.end();

const imported = allRows.filter((row) => row.source === "youtube_works_awards_2026");
const originalRows = allRows.filter((row) => row.source !== "youtube_works_awards_2026");
const originalById = new Map(originalRows.map((row) => [`${row.platform}:${row.id}`, row]));
const originalByUrl = new Map(originalRows.map((row) => [canonicalVideoUrl(row.videoUrl, row.platform), row]));
const originalByTitle = new Map();
for (const row of originalRows) {
  const key = normalizeTitle(row.title);
  if (!originalByTitle.has(key)) originalByTitle.set(key, []);
  originalByTitle.get(key).push(row);
}

const duplicateAudit = imported.map((row) => {
  const idMatch = originalById.get(`${row.platform}:${row.id}`);
  const urlMatch = originalByUrl.get(canonicalVideoUrl(row.videoUrl, row.platform));
  const titleMatches = originalByTitle.get(normalizeTitle(row.title)) || [];
  return {
    id: row.id,
    title: row.title,
    videoUrl: row.videoUrl,
    idMatch: idMatch ? { id: idMatch.id, title: idMatch.title } : null,
    urlMatch: urlMatch ? { id: urlMatch.id, title: urlMatch.title } : null,
    titleMatches: titleMatches.map((item) => ({ id: item.id, title: item.title })),
  };
});

const unresolved = plan.works
  .filter((work) => work.status !== "ready")
  .map((work) => ({
    platform: work.platform,
    videoId: work.videoId,
    videoUrl: work.videoUrl,
    pdfPages: work.pdfPages,
    status: work.status,
    reason: "動画メタデータ（oEmbed）を取得できなかったため、タイトルの正確性を担保できず未登録",
  }));

const counts = {
  imported: imported.length,
  idDuplicatesAgainstExistingDb: duplicateAudit.filter((item) => item.idMatch).length,
  canonicalUrlDuplicatesAgainstExistingDb: duplicateAudit.filter((item) => item.urlMatch).length,
  normalizedTitleMatchesAgainstExistingDb: duplicateAudit.filter((item) => item.titleMatches.length > 0).length,
  unresolved: unresolved.length,
};

const report = {
  sourcePdf: plan.sourcePdf,
  sourceLabel: plan.sourceLabel,
  auditedAt: new Date().toISOString(),
  counts,
  duplicateAudit,
  unresolved,
};

mkdirSync(outputDir, { recursive: true });
writeFileSync(path.join(outputDir, "final_audit.json"), JSON.stringify(report, null, 2));
const unresolvedRows = unresolved.map((work) => `| ${work.platform} | ${work.videoId} | ${work.pdfPages.join(", ")} | ${work.status} | ${work.reason} | ${work.videoUrl} |`);
const titleMatchRows = duplicateAudit.filter((item) => item.titleMatches.length > 0).map((item) => `| ${item.id} | ${item.title} | ${item.titleMatches.map((match) => `${match.id}: ${match.title}`).join("<br>")} |`);
writeFileSync(
  path.join(outputDir, "final_audit.md"),
  `# Google資料掲載作品の最終監査\n\n- 資料: ${report.sourceLabel}\n- 監査日時: ${report.auditedAt}\n- 登録済み: ${counts.imported}\n- 既存DBとの動画ID重複: ${counts.idDuplicatesAgainstExistingDb}\n- 既存DBとの正規化URL重複: ${counts.canonicalUrlDuplicatesAgainstExistingDb}\n- 既存DBとの正規化タイトル一致: ${counts.normalizedTitleMatchesAgainstExistingDb}\n- URL未確認・未登録: ${counts.unresolved}\n\n## URL未確認・保留作品\n\n| Platform | Video ID | PDF page | 取得状態 | 保留理由 | URL |\n|---|---|---|---|---|---|\n${unresolvedRows.join("\n")}\n\n## 既存DBとのタイトル一致（要確認）\n\n| Imported ID | Imported title | Existing title match |\n|---|---|---|\n${titleMatchRows.join("\n") || "| なし | なし | なし |"}\n`,
);
console.log(JSON.stringify(counts, null, 2));
process.exit(0);
