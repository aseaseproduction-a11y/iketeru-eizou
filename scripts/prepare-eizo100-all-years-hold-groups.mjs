import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const sources = [
  "/home/ubuntu/iketeru-eizou/analysis/eizo100_2026/final_reconciliation.json",
  "/home/ubuntu/iketeru-eizou/analysis/eizo100_previous_years/final_reconciliation.json",
];
const rows = sources.flatMap((path) => JSON.parse(readFileSync(path, "utf8")).rows)
  .filter((row) => row.finalResult === "hold")
  .map((row) => ({
    sourceYear: row.sourceYear,
    sourcePostId: row.sourcePostId,
    creatorName: row.creatorName,
    workTitle: row.workTitle,
    sourceUrl: row.sourceUrl,
    originalVideoUrl: row.videoUrl || row.normalizedUrl || "",
    originalReason: row.finalReason,
  }));
if (rows.length !== 262) throw new Error(`Expected 262 holds, received ${rows.length}`);
const groupCount = 20;
const groups = Array.from({ length: groupCount }, () => []);
rows.forEach((row, index) => groups[index % groupCount].push(row));
const outputDir = "/home/ubuntu/eizo100-all-years-hold-groups";
mkdirSync(outputDir, { recursive: true });
groups.forEach((group, index) => writeFileSync(`${outputDir}/group-${String(index + 1).padStart(2, "0")}.json`, `${JSON.stringify(group, null, 2)}\n`));
writeFileSync(`${outputDir}/manifest.json`, `${JSON.stringify({ total: rows.length, groupCount, groups: groups.map((group, index) => ({ group: index + 1, count: group.length, years: [...new Set(group.map((row) => row.sourceYear))].sort() })) }, null, 2)}\n`);
console.log(JSON.stringify({ total: rows.length, groupCount, groupSizes: groups.map((group) => group.length) }, null, 2));
