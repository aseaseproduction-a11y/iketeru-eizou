import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const inputCandidates = "/home/ubuntu/iketeru-eizou/analysis/eizo100_2026/candidates.json";
const inputVerification = "/home/ubuntu/iketeru-eizou/analysis/eizo100_2026/oembed_verification.json";
const outputPath = "/home/ubuntu/eizo100-2026-import/import_plan.json";
const { candidates } = JSON.parse(readFileSync(inputCandidates, "utf8"));
const { verified } = JSON.parse(readFileSync(inputVerification, "utf8"));
const candidatesBySourcePostId = new Map(candidates.map((candidate) => [candidate.sourcePostId, candidate]));

const imports = verified
  .filter((item) => item.verified && item.verificationStatus === "triple_verified")
  .map((item) => {
    const source = candidatesBySourcePostId.get(item.sourcePostId);
    if (!source) throw new Error(`Missing source record for post ${item.sourcePostId}`);
    const sourceUrl = source.sourceUrl;
    const purpose = `「映像作家100人 2026」の選出作品として、${source.workTitle}を作品アーカイブで紹介する。`;
    const background = source.description || "映像作家100人の掲載ページでは、制作背景の詳細を確認できない。";
    const evaluation = `「映像作家100人 2026」の掲載作品として公式アーカイブに選出されている。掲載カテゴリ: ${source.sourceGenres.join("、") || "未分類"}。`;
    return {
      id: source.videoId,
      platform: source.platform,
      title: source.workTitle,
      thumbnail: source.platform === "youtube" ? `https://i.ytimg.com/vi/${source.videoId}/hqdefault.jpg` : null,
      videoUrl: source.normalizedUrl,
      embedUrl: source.platform === "youtube" ? `https://www.youtube.com/embed/${source.videoId}` : `https://player.vimeo.com/video/${source.videoId}`,
      source: "eizo100_2026",
      sourceLabel: "映像作家100人 2026",
      channelTitle: source.creatorName,
      allTags: [...new Set(["映像作家100人", "2026選出", ...source.sourceGenres])],
      awards: [{ name: "映像作家100人", year: 2026, category: "2026選出作品", sourceUrl }],
      curationNote: { purpose, background, evaluation, sourceUrls: [sourceUrl, source.normalizedUrl] },
      addedDate: source.sourcePublishedAt?.slice(0, 10) || "2026-08-18",
      verification: { sourcePostId: source.sourcePostId, sourceUrl, providerTitle: item.providerTitle, providerAuthor: item.providerAuthor },
    };
  });

mkdirSync("/home/ubuntu/eizo100-2026-import", { recursive: true });
writeFileSync(outputPath, `${JSON.stringify({ source: "映像作家100人 2026", generatedAt: new Date().toISOString(), imports }, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, imports: imports.length }, null, 2));
