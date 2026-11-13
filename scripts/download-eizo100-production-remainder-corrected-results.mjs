import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("/home/ubuntu/research_remaining_production_credits_corrected.json", "utf8"));
const outputDir = "/home/ubuntu/iketeru-eizou/analysis/eizo100_all_years/production_research_remainder_corrected";
mkdirSync(outputDir, { recursive: true });
const downloaded = [];
for (const [index, entry] of manifest.results.entries()) {
  const response = await fetch(entry.output.result_file);
  if (!response.ok) throw new Error(`Group ${index + 1}: HTTP ${response.status}`);
  const target = `${outputDir}/group-${String(index + 1).padStart(2, "0")}.json`;
  writeFileSync(target, await response.text());
  downloaded.push(target);
}
writeFileSync(`${outputDir}/download_manifest.json`, `${JSON.stringify({ downloadedAt: new Date().toISOString(), downloaded }, null, 2)}\n`);
console.log(JSON.stringify({ downloaded: downloaded.length }, null, 2));
