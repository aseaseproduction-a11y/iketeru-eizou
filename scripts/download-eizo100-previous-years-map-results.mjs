import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const mapResults = JSON.parse(readFileSync("/home/ubuntu/verify_eizo100_previous_years.json", "utf8"));
const outputDir = "/home/ubuntu/iketeru-eizou/analysis/eizo100_previous_years/map_results";
mkdirSync(outputDir, { recursive: true });
for (const item of mapResults.results) {
  const year = item.output.year;
  const response = await fetch(item.output.results_file, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${year}: HTTP ${response.status}`);
  const text = await response.text();
  JSON.parse(text);
  writeFileSync(`${outputDir}/${year}.json`, `${text.trim()}\n`);
  console.log(`${year}: ${text.length} bytes`);
}
