import { readFileSync, writeFileSync } from "node:fs";

const inputPath = "/home/ubuntu/iketeru-eizou/analysis/reanalysis/the-cook-videos-list-api.json";
const outputPath = "/home/ubuntu/iketeru-eizou/analysis/reanalysis/the-cook-public-api-verification.json";
const payload = JSON.parse(readFileSync(inputPath, "utf8"));
const videos = payload?.result?.data?.json ?? payload?.[0]?.result?.data?.json;

if (!Array.isArray(videos)) throw new Error("videos.list API response does not contain a video array");

const expected = {
  id: "lJXaNYTVjrQ",
  title: "THE COOK | Award-Winning Short Film",
  videoUrl: "https://www.youtube.com/watch?v=lJXaNYTVjrQ",
};
const video = videos.find((candidate) => candidate.id === expected.id);
if (!video) throw new Error("THE COOK is absent from videos.list API response");
if (video.title !== expected.title || video.videoUrl !== expected.videoUrl) throw new Error("THE COOK triple verification failed in public API response");
if (!video.aiAnalysis || !video.curationNote?.purpose || !video.curationNote?.background || !video.curationNote?.evaluation || !video.curationNote?.sourceUrls?.length) {
  throw new Error("THE COOK metadata is incomplete in public API response");
}

const report = {
  checkedAt: new Date().toISOString(),
  status: "verified",
  expected,
  aiAnalysisLength: video.aiAnalysis.length,
  curationSourceCount: video.curationNote.sourceUrls.length,
  ratings: {
    overall: video.aiOverallRating,
    direction: video.aiDirectionRating,
    technique: video.aiTechniqueRating,
  },
};
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
