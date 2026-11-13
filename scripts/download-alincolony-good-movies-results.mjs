import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("/home/ubuntu/extract_alincolony_good_movies.json", "utf8"));
const targetDir = "/home/ubuntu/iketeru-eizou/analysis/alincolony_good_movies/monthly";
mkdirSync(targetDir, { recursive: true });

const downloaded = [];
for (let index = 0; index < manifest.results.length; index += 1) {
  const entry = manifest.results[index];
  const response = await fetch(entry.output.result_file);
  if (!response.ok) throw new Error(`Failed ${index + 1}: ${response.status}`);
  const raw = await response.text();
  let content;
  try {
    content = JSON.parse(raw);
  } catch {
    content = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
  }
  const file = `${targetDir}/${String(index + 1).padStart(2, "0")}.json`;
  writeFileSync(file, `${JSON.stringify({ sourcePage: entry.input, entries: content }, null, 2)}\n`);
  downloaded.push({ sourcePage: entry.input, file, count: Array.isArray(content) ? content.length : Array.isArray(content.entries) ? content.entries.length : entry.output.video_count });
}
writeFileSync("/home/ubuntu/iketeru-eizou/analysis/alincolony_good_movies/monthly_download_report.json", `${JSON.stringify({ downloadedAt: new Date().toISOString(), downloaded }, null, 2)}\n`);
console.log(JSON.stringify({ pages: downloaded.length, extracted: downloaded.reduce((total, item) => total + Number(item.count || 0), 0) }, null, 2));
