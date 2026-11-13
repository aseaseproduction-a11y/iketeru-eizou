import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const input = JSON.parse(readFileSync("/home/ubuntu/iketeru-eizou/analysis/eizo100_2026/hold_recheck_oembed.json", "utf8"));
const imports = input.eligible.map((item) => ({
  id: item.videoId,
  platform: item.platform,
  title: item.workTitle,
  thumbnail: item.platform === "youtube" ? `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg` : null,
  videoUrl: item.normalizedUrl,
  embedUrl: item.platform === "youtube" ? `https://www.youtube.com/embed/${item.videoId}` : `https://player.vimeo.com/video/${item.videoId}`,
  source: "eizo100_2026",
  sourceLabel: "映像作家100人 2026",
  channelTitle: item.creatorName,
  genres: [],
  products: [],
  directions: [],
  tones: [],
  allTags: ["映像作家100人", "2026選出", ...item.sourceGenres],
  purposes: [],
  expressions: [],
  toneEmotions: [],
  toneVisuals: [],
  toneTechniques: [],
  productions: [],
  awards: [{ name: "映像作家100人", year: 2026, category: "2026選出作品", sourceUrl: item.sourceUrl }],
  curationNote: {
    purpose: `「映像作家100人 2026」の選出作品として、${item.workTitle}を作品アーカイブで紹介する。`,
    background: item.description || item.credits || "公式掲載ページに作品情報が記載されている。",
    evaluation: `「映像作家100人 2026」の掲載作品として公式アーカイブに選出されている。掲載カテゴリ: ${(item.sourceGenres || []).join("、") || "未分類"}。`,
    sourceUrls: [item.sourceUrl, item.normalizedUrl],
  },
  addedDate: item.sourcePublishedAt?.slice(0, 10) || "2026-01-01",
  embedStatus: "unknown",
  verification: {
    sourcePostId: item.sourcePostId,
    officialEvidenceUrl: item.officialEvidenceUrl,
    oembedTitle: item.oembedTitle,
    oembedAuthor: item.oembedAuthor,
    reason: item.recheckReason,
  },
}));
const ids = new Set(imports.map((item) => item.id));
if (imports.length !== 79 || ids.size !== imports.length) throw new Error(`Expected 79 unique oEmbed-verified imports, received ${imports.length} with ${ids.size} IDs`);
const outputDir = "/home/ubuntu/eizo100-2026-recheck-import";
mkdirSync(outputDir, { recursive: true });
writeFileSync(`${outputDir}/import_plan.json`, `${JSON.stringify({ source: "映像作家100人 2026 recheck", imports }, null, 2)}\n`);
console.log(JSON.stringify({ imports: imports.length, output: `${outputDir}/import_plan.json` }, null, 2));
