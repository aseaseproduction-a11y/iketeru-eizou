import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const verification = JSON.parse(readFileSync("/home/ubuntu/iketeru-eizou/analysis/alincolony_good_movies/verification.json", "utf8"));
const verified = verification.rows.filter((row) => row.result === "verified" && ["youtube", "vimeo"].includes(row.platform));
const byVideo = new Map();
for (const row of verified) {
  const key = `${row.platform}:${row.id}`;
  const current = byVideo.get(key) || { ...row, sourceUrls: [], contexts: [] };
  current.sourceUrls = [...new Set([...(current.sourceUrls || []), ...(row.sourceUrls || [])])];
  current.contexts = [...new Set([...(current.contexts || []), ...(row.contexts || [])])];
  byVideo.set(key, current);
}
const imports = Array.from(byVideo.values()).map((row) => {
  const firstSource = row.sourceUrls[0] || "";
  const addedDate = firstSource.match(/\/blog\/(\d{4}-\d{2}-\d{2})-/)?.[1] || "2026-08-18";
  const context = (row.contexts || []).join(" / ").slice(0, 4000);
  return {
    id: row.id,
    platform: row.platform,
    title: row.retrievedTitle,
    thumbnail: row.thumbnail,
    videoUrl: row.videoUrl,
    embedUrl: row.platform === "youtube" ? `https://www.youtube.com/embed/${row.id}` : `https://player.vimeo.com/video/${row.id}`,
    source: "alincolony",
    sourceLabel: "ALINCOLONY よかった映像",
    channelTitle: row.channelTitle || "",
    allTags: ["ALINCOLONY", "よかった映像まとめ", row.platform === "youtube" ? "YouTube" : "Vimeo"],
    curationNote: {
      purpose: "映像表現のリファレンス収集",
      background: `ALINCOLONY「よかった映像まとめ」に掲載された作品。${context ? `掲載者メモ: ${context}` : ""}`,
      evaluation: context ? `掲載者コメントに基づく注目点: ${context}` : "ALINCOLONYの映像リファレンスとして掲載。",
      sourceUrls: row.sourceUrls,
    },
    awards: [],
    addedDate,
  };
});
const platformCounts = imports.reduce((result, item) => ({ ...result, [item.platform]: (result[item.platform] || 0) + 1 }), {});
const plan = { source: "ALINCOLONY よかった映像まとめ", generatedAt: new Date().toISOString(), counts: { verifiedRows: verified.length, uniqueVideos: imports.length, ...platformCounts }, imports };
const outputDir = "/home/ubuntu/alincolony-good-movies-import";
mkdirSync(outputDir, { recursive: true });
writeFileSync(`${outputDir}/import_plan.json`, `${JSON.stringify(plan, null, 2)}\n`);
console.log(JSON.stringify(plan.counts, null, 2));
