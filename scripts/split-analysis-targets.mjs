import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const sourcePath = process.argv[2] || "/home/ubuntu/iketeru-eizou/analysis/analysis_targets.json";
const outputDir = process.argv[3] || "/home/ubuntu/iketeru-eizou/analysis/targets";
const payload = JSON.parse(await readFile(sourcePath, "utf8"));
const targets = Array.isArray(payload.targets) ? payload.targets : [];

await mkdir(outputDir, { recursive: true });
for (let index = 0; index < targets.length; index += 1) {
  const target = targets[index];
  const fileName = `${index + 1}.json`;
  await writeFile(
    path.join(outputDir, fileName),
    JSON.stringify({ index: index + 1, total: targets.length, target }, null, 2)
  );
}

console.log(JSON.stringify({ sourcePath, outputDir, targetCount: targets.length }));
process.exit(0);
