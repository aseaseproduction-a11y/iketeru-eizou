import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const years = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
const inputDir = "/home/ubuntu/iketeru-eizou/analysis/eizo100_previous_years";
const verified = years.flatMap((year) => {
  const result = JSON.parse(readFileSync(`${inputDir}/oembed_verification_${year}.json`, "utf8"));
  return result.results.filter((item) => item.status === "triple_verified");
});
const entries = verified.map((item) => ({
  id: item.videoId,
  platform: item.platform,
  title: item.workTitle,
  thumbnail: item.platform === "youtube" ? `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg` : null,
  videoUrl: item.normalizedUrl,
  embedUrl: item.platform === "youtube" ? `https://www.youtube.com/embed/${item.videoId}` : `https://player.vimeo.com/video/${item.videoId}`,
  source: "eizo100",
  sourceLabel: `映像作家100人 ${item.sourceYear}`,
  channelTitle: item.creatorName,
  genres: [], products: [], directions: [], tones: [],
  allTags: ["映像作家100人", `${item.sourceYear}選出`, ...item.sourceGenres],
  purposes: [], expressions: [], toneEmotions: [], toneVisuals: [], toneTechniques: [], productions: [],
  awards: [{ name: "映像作家100人", year: item.sourceYear, category: `${item.sourceYear}選出作品`, sourceUrl: item.sourceUrl }],
  curationNote: {
    purpose: `「映像作家100人 ${item.sourceYear}」の選出作品として、${item.workTitle}を作品アーカイブで紹介する。`,
    background: item.description || item.credits || "公式掲載ページに作品情報が記載されている。",
    evaluation: `「映像作家100人 ${item.sourceYear}」の掲載作品として公式アーカイブに選出されている。掲載カテゴリ: ${(item.sourceGenres || []).join("、") || "未分類"}。`,
    sourceUrls: [item.sourceUrl, item.normalizedUrl],
  },
  addedDate: item.sourcePublishedAt?.slice(0, 10) || `${item.sourceYear}-01-01`,
  embedStatus: "unknown",
  verification: { sourcePostId: item.sourcePostId, providerTitle: item.providerTitle, providerAuthor: item.providerAuthor, reason: item.reason },
}));
const mergedById = new Map();
for (const entry of entries) {
  const current = mergedById.get(entry.id);
  if (!current) {
    mergedById.set(entry.id, entry);
    continue;
  }
  current.awards.push(...entry.awards);
  current.allTags = [...new Set([...current.allTags, ...entry.allTags])];
  current.sourceLabel = [...new Set([current.sourceLabel, entry.sourceLabel])].join(" / ");
  current.curationNote.sourceUrls = [...new Set([...current.curationNote.sourceUrls, ...entry.curationNote.sourceUrls])];
  current.curationNote.evaluation = `${current.curationNote.evaluation}\n加えて「映像作家100人 ${entry.awards[0].year}」にも選出されている。`;
}
const imports = Array.from(mergedById.values());
const summary = {
  selectionEntries: entries.length,
  uniqueVideos: imports.length,
  duplicateSelectionEntries: entries.length - imports.length,
  byYear: entries.reduce((counts, item) => ({ ...counts, [item.awards[0].year]: (counts[item.awards[0].year] || 0) + 1 }), {}),
};
const outputDir = "/home/ubuntu/eizo100-previous-years-import";
mkdirSync(outputDir, { recursive: true });
writeFileSync(`${outputDir}/import_plan.json`, `${JSON.stringify({ source: "映像作家100人 2018-2025", imports }, null, 2)}\n`);
writeFileSync(`${outputDir}/import_plan_summary.json`, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
