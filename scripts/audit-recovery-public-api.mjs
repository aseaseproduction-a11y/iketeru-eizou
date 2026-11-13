import { readFile, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const snapshotPath = args.find((arg) => !arg.startsWith("--")) || "/home/ubuntu/iketeru-eizou/analysis/analysis_targets.json";
const count = Number(args.find((arg) => arg.startsWith("--count="))?.slice(8) || 300);
const ids = new Set((args.find((arg) => arg.startsWith("--ids="))?.slice(6) || "").split(",").map((id) => id.trim()).filter(Boolean));
const apiUrl = args.find((arg) => arg.startsWith("--api="))?.slice(6) || "http://localhost:3000/api/trpc/videos.list?input=%7B%22json%22%3Anull%7D";
const reportPath = args.find((arg) => arg.startsWith("--report="))?.slice(9) || "/home/ubuntu/iketeru-eizou/analysis/recovery_public_api_audit.json";

const fields = ["genres", "products", "directions", "tones", "allTags", "purposes", "expressions", "toneEmotions", "toneVisuals", "toneTechniques", "productions"];
const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
const targets = ids.size
  ? snapshot.targets.filter((target) => ids.has(String(target.id)))
  : snapshot.targets.slice(0, count);

const response = await fetch(apiUrl);
if (!response.ok) throw new Error(`videos.list failed: ${response.status}`);
const payload = await response.json();
const videos = payload?.result?.data?.json;
if (!Array.isArray(videos)) throw new Error("Unexpected videos.list response");
const byId = new Map(videos.map((video) => [String(video.id), video]));
const report = { apiUrl, targets: targets.length, matched: 0, missing: [], mismatches: [], unexpectedAiAnalysis: [] };

for (const target of targets) {
  const video = byId.get(String(target.id));
  if (!video) {
    report.missing.push(target.id);
    continue;
  }
  const metadata = target.existingMetadata || {};
  const mismatchedFields = fields.filter((field) => JSON.stringify(video[field] || []) !== String(metadata[field] || "[]"));
  if (video.title !== target.title || video.videoUrl !== target.videoUrl || mismatchedFields.length > 0) {
    report.mismatches.push({ id: target.id, title: target.title, titleMatches: video.title === target.title, urlMatches: video.videoUrl === target.videoUrl, mismatchedFields });
    continue;
  }
  if (target.source !== "notion" && (video.aiAnalysis || video.aiOverallRating || video.aiDirectionRating || video.aiTechniqueRating)) {
    report.unexpectedAiAnalysis.push(target.id);
    continue;
  }
  report.matched += 1;
}

await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify({ ...report, reportPath }, null, 2));
if (report.missing.length || report.mismatches.length || report.unexpectedAiAnalysis.length) process.exitCode = 2;
