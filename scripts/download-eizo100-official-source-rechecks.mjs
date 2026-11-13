import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("/home/ubuntu/recheck_eizo100_all_years_official_sources.json", "utf8"));
const outputDir = "/home/ubuntu/iketeru-eizou/analysis/eizo100_all_years/official_source_rechecks";
mkdirSync(outputDir, { recursive: true });
const downloaded = [];
const unavailable = [];
for (const [index, entry] of manifest.results.entries()) {
  const source = entry.output.result_file;
  const target = `${outputDir}/group-${String(index + 1).padStart(2, "0")}.json`;
  try {
    if (source.startsWith("http")) {
      const response = await fetch(source);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      writeFileSync(target, await response.text());
    } else if (existsSync(source)) {
      writeFileSync(target, readFileSync(source));
    } else {
      throw new Error("result file is not available in this sandbox");
    }
    downloaded.push({ group: index + 1, source, target });
  } catch (error) {
    unavailable.push({ group: index + 1, source, error: error.message });
  }
}
writeFileSync(`${outputDir}/download_manifest.json`, `${JSON.stringify({ downloaded, unavailable }, null, 2)}\n`);
console.log(JSON.stringify({ downloaded: downloaded.length, unavailable }, null, 2));
