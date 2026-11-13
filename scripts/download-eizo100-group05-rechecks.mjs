import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("/home/ubuntu/recheck_eizo100_group05_official_sources.json", "utf8"));
const outputDir = "/home/ubuntu/iketeru-eizou/analysis/eizo100_all_years/official_source_rechecks/group-05-individual";
mkdirSync(outputDir, { recursive: true });
const results = [];
for (const entry of manifest.results) {
  const response = await fetch(entry.output.result_file);
  if (!response.ok) throw new Error(`Failed ${entry.input}: HTTP ${response.status}`);
  const result = JSON.parse(await response.text());
  writeFileSync(`${outputDir}/${entry.input}.json`, `${JSON.stringify(result, null, 2)}\n`);
  results.push(result);
}
writeFileSync("/home/ubuntu/iketeru-eizou/analysis/eizo100_all_years/official_source_rechecks/group-05.json", `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify({ downloaded: results.length, verified: results.filter((item) => item.result === "verified").length }, null, 2));
