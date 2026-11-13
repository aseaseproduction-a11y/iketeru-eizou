import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const candidates = JSON.parse(readFileSync("/home/ubuntu/iketeru-eizou/analysis/eizo100_2026/candidates.json", "utf8")).candidates;
const verification = JSON.parse(readFileSync("/home/ubuntu/iketeru-eizou/analysis/eizo100_2026/oembed_verification.json", "utf8")).verified;
const candidateById = new Map(candidates.map((candidate) => [candidate.videoId, candidate]));
const verificationById = new Map(verification.map((item) => [item.videoId, item]));
const outputDir = "/home/ubuntu/eizo100-2026-import";
const sourceName = "映像作家100人";
const sourceYear = 2026;
const sourceCategory = "2026選出作品";

const existingTargets = [
  { id: "Zn-lceyLDpM", currentTitle: "MV  実写   no.9 orchestra / The moment" },
  { id: "ope4Cvd7-u8", currentTitle: "maya ongaku - Maybe Psychic (Official Music Video)" },
  { id: "evtoG-4dLM4", currentTitle: "MV  イラスト / アニメーション   YOASOBI「Watch me!」Official Music Video" },
  { id: "-xH_wmyWi5w", currentTitle: "MV  合成 / VFX / 3DCG   星野源 - Glitch [Official Video]" },
];
const collisionVideoId = "1056762918";
const sqlEscape = (value) => String(value).replaceAll("\\", "\\\\").replaceAll("'", "\\'");

function entryFor(videoId) {
  const candidate = candidates.find((item) => item.videoId === videoId && verification.find((verified) => verified.sourcePostId === item.sourcePostId && verified.verified));
  const provider = candidate ? verification.find((verified) => verified.sourcePostId === candidate.sourcePostId) : null;
  if (!candidate || !provider?.verified) throw new Error(`Unverified official candidate: ${videoId}`);
  const sourceUrl = candidate.sourceUrl;
  return {
    ...candidate,
    providerTitle: provider.providerTitle,
    award: { name: sourceName, year: sourceYear, category: sourceCategory, sourceUrl },
    curationNote: {
      purpose: `「映像作家100人 2026」の選出作品として、${candidate.workTitle}を作品アーカイブで紹介する。`,
      background: candidate.description || "映像作家100人の掲載ページでは、制作背景の詳細を確認できない。",
      evaluation: `「映像作家100人 2026」の掲載作品として公式アーカイブに選出されている。掲載カテゴリ: ${candidate.sourceGenres.join("、") || "未分類"}。`,
      sourceUrls: [sourceUrl, candidate.normalizedUrl],
    },
  };
}

const existingUpdates = existingTargets.map(({ id, currentTitle }) => ({ id, currentTitle, ...entryFor(id) }));
const collision = entryFor(collisionVideoId);
const updatesSql = existingUpdates.map((item) => {
  const award = JSON.stringify([item.award]);
  const note = JSON.stringify(item.curationNote);
  return `UPDATE videos SET title = '${sqlEscape(item.workTitle)}', awards = '${sqlEscape(award)}', curationNote = COALESCE(curationNote, '${sqlEscape(note)}'), sourceLabel = CONCAT(COALESCE(sourceLabel, ''), CASE WHEN COALESCE(sourceLabel, '') = '' THEN '映像作家100人 2026' ELSE ' / 映像作家100人 2026' END) WHERE id = '${sqlEscape(item.id)}' AND title = '${sqlEscape(item.currentTitle)}' AND videoUrl = '${sqlEscape(item.normalizedUrl)}';`;
}).join("\n");

const collisionInsertSql = `INSERT INTO videos (id, platform, title, thumbnail, videoUrl, embedUrl, source, sourceLabel, channelTitle, genres, products, directions, tones, allTags, purposes, expressions, toneEmotions, toneVisuals, toneTechniques, productions, awards, curationNote, addedDate, embedStatus) VALUES ('${sqlEscape(collision.videoId)}', '${sqlEscape(collision.platform)}', '${sqlEscape(collision.workTitle)}', NULL, '${sqlEscape(collision.normalizedUrl)}', '${sqlEscape(collision.platform === "youtube" ? `https://www.youtube.com/embed/${collision.videoId}` : `https://player.vimeo.com/video/${collision.videoId}`)}', 'eizo100_2026', '映像作家100人 2026', '${sqlEscape(collision.creatorName)}', '[]', '[]', '[]', '[]', '${sqlEscape(JSON.stringify(["映像作家100人", "2026選出", ...collision.sourceGenres]))}', '[]', '[]', '[]', '[]', '[]', '[]', '${sqlEscape(JSON.stringify([collision.award]))}', '${sqlEscape(JSON.stringify(collision.curationNote))}', '${sqlEscape(collision.sourcePublishedAt.slice(0, 10))}', 'unknown');`;

mkdirSync(outputDir, { recursive: true });
writeFileSync(`${outputDir}/exception_plan.json`, `${JSON.stringify({ existingUpdates, collision }, null, 2)}\n`);
writeFileSync(`${outputDir}/exception_updates.sql`, `${updatesSql}\n${collisionInsertSql}\n`);
console.log(JSON.stringify({ existingUpdates: existingUpdates.length, collision: { id: collision.videoId, title: collision.workTitle } }, null, 2));
