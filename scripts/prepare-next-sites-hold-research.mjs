import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const baseDir = "/home/ubuntu/iketeru-eizou/analysis/site_imports/next_sites";
const input = JSON.parse(readFileSync(`${baseDir}/merged_official_video_verification.json`, "utf8"));
const rows = (input.rows || []).filter((row) => row.result === "hold").map((row) => ({
  id: row.id,
  platform: row.platform,
  videoUrl: row.videoUrl,
  source: row.source,
  sourceLabel: row.sourceLabel,
  sourceUrl: row.sourceUrl,
  officialTitle: row.title,
  retrievedTitle: row.retrievedTitle || "",
  verificationReason: row.verificationReason,
  researchQuery: `${row.title} ${row.sourceLabel} 制作会社`,
}));
mkdirSync(`${baseDir}/hold_research`, { recursive: true });
writeFileSync(`${baseDir}/hold_research/hold_targets.json`, `${JSON.stringify({ generatedAt: new Date().toISOString(), total: rows.length, rows }, null, 2)}\n`);
console.log(JSON.stringify({ total: rows.length, bySource: rows.reduce((counts, row) => ({ ...counts, [row.source]: (counts[row.source] || 0) + 1 }), {}) }, null, 2));
