import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const readRows = (path, fallbackYear) => JSON.parse(readFileSync(path, "utf8")).rows.map((row) => ({ ...row, sourceYear: Number(row.sourceYear) || fallbackYear }));
const master = [
  ...readRows("/home/ubuntu/iketeru-eizou/analysis/eizo100_2026/final_reconciliation.json", 2026),
  ...readRows("/home/ubuntu/iketeru-eizou/analysis/eizo100_previous_years/final_reconciliation.json", 0),
];
const masterByKey = new Map(master.map((row) => [`${row.sourceYear}:${row.sourcePostId}`, row]));
const verification = JSON.parse(readFileSync("/home/ubuntu/iketeru-eizou/analysis/eizo100_all_years/official_source_rechecks/oembed_verification.json", "utf8"));
const imports = verification.results.filter((row) => row.result === "triple_verified").map((row) => {
  const original = masterByKey.get(`${row.sourceYear}:${row.sourcePostId}`);
  if (!original) throw new Error(`Missing original entry: ${row.sourceYear}:${row.sourcePostId}`);
  const genres = original.sourceGenres || [];
  const sourceUrls = [...new Set([row.sourceUrl, row.canonicalVideoUrl, ...row.officialSourceUrls])];
  return {
    id: row.videoId,
    platform: row.platform,
    title: row.workTitle,
    thumbnail: "",
    videoUrl: row.canonicalVideoUrl,
    embedUrl: row.platform === "youtube" ? `https://www.youtube.com/embed/${row.videoId}` : `https://player.vimeo.com/video/${row.videoId}`,
    source: `eizo100_${row.sourceYear}_official_recheck`,
    sourceLabel: `映像作家100人 ${row.sourceYear}`,
    channelTitle: row.creatorName || "",
    allTags: [...new Set(["映像作家100人", `${row.sourceYear}選出`, ...genres])],
    addedDate: String(original.sourcePublishedAt || "").slice(0, 10) || `${row.sourceYear}-01-01`,
    awards: [{ name: "映像作家100人", year: row.sourceYear, category: `${row.sourceYear}選出作品`, sourceUrl: row.sourceUrl }],
    curationNote: {
      purpose: `「映像作家100人 ${row.sourceYear}」の選出作品として、${row.workTitle}を公式アーカイブで紹介する。`,
      background: String(original.description || original.credits || "公式掲載ページおよび制作者・権利者の公式出典を再照合し、公開動画を確認した。"),
      evaluation: `「映像作家100人 ${row.sourceYear}」の掲載作品として公式アーカイブに選出されている。${genres.length ? `掲載カテゴリ: ${genres.join("、")}。` : ""}`,
      sourceUrls,
    },
    verification: {
      sourcePostId: row.sourcePostId,
      sourceUrl: row.sourceUrl,
      videoTitle: row.oembedTitle,
      officialSourceUrls: row.officialSourceUrls,
      reason: row.verificationReason,
    },
  };
});
if (imports.length !== 17) throw new Error(`Expected 17 imports, received ${imports.length}`);
const outputDir = "/home/ubuntu/eizo100-official-source-recheck-import";
mkdirSync(outputDir, { recursive: true });
writeFileSync(`${outputDir}/import_plan.json`, `${JSON.stringify({ imports }, null, 2)}\n`);
console.log(JSON.stringify({ imports: imports.length }, null, 2));
