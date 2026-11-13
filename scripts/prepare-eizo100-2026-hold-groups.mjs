import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const sourcePath = "/home/ubuntu/iketeru-eizou/analysis/eizo100_2026/reconciliation.json";
const outputDir = "/home/ubuntu/iketeru-eizou/analysis/eizo100_2026/hold_recheck_groups";
const { rows } = JSON.parse(readFileSync(sourcePath, "utf8"));
const holds = rows.filter((row) => row.result === "hold");
if (holds.length !== 126) throw new Error(`Expected 126 holds, received ${holds.length}`);
rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
const groups = Array.from({ length: 18 }, () => []);
holds.forEach((item, index) => groups[index % groups.length].push(item));
const files = groups.map((items, index) => {
  const filePath = `${outputDir}/group_${String(index + 1).padStart(2, "0")}.json`;
  writeFileSync(filePath, `${JSON.stringify({ group: index + 1, source: "映像作家100人 2026", items }, null, 2)}\n`);
  return filePath;
});
writeFileSync(`${outputDir}/manifest.json`, `${JSON.stringify({ total: holds.length, groups: files }, null, 2)}\n`);
console.log(JSON.stringify({ total: holds.length, groups: files.length, files }, null, 2));
