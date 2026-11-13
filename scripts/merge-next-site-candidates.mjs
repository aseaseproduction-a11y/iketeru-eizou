import { readFileSync, writeFileSync } from "node:fs";

const outputDir = "/home/ubuntu/iketeru-eizou/analysis/site_imports/next_sites";
const readRows = (name) => JSON.parse(readFileSync(`${outputDir}/${name}`, "utf8")).rows || [];
const unique = (items) => [...new Set(items.filter(Boolean))];
const candidates = [...readRows("official_video_candidates.json"), ...readRows("wordpress_video_candidates.json")];
const merged = new Map();
for (const row of candidates) {
  const key = `${row.platform}:${row.id}`;
  const current = merged.get(key);
  if (!current) merged.set(key, { ...row, sourceUrls: [row.sourceUrl] });
  else {
    current.sourceUrls = unique([...current.sourceUrls, row.sourceUrl]);
    current.sourceContext = unique([current.sourceContext, row.sourceContext]).join(" / ");
  }
}
const rows = [...merged.values()].sort((a, b) => a.source.localeCompare(b.source) || a.title.localeCompare(b.title, "ja"));
const summary = rows.reduce((acc, row) => ({ ...acc, [row.source]: (acc[row.source] || 0) + 1, [row.platform]: (acc[row.platform] || 0) + 1 }), { htmlAndWordPressRows: candidates.length, uniqueCandidates: rows.length });
writeFileSync(`${outputDir}/merged_official_video_candidates.json`, `${JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
