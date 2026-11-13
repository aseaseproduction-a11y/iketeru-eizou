import fs from "node:fs";
import path from "node:path";

const planPath = "/home/ubuntu/award-winners-import/db_import_plan.json";
const outputDir = "/home/ubuntu/award-hold-groups";
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
const holds = plan.hold;

if (!Array.isArray(holds) || holds.length !== 316) {
  throw new Error(`Expected exactly 316 hold candidates, received ${holds?.length ?? "unknown"}`);
}

fs.mkdirSync(outputDir, { recursive: true });

const groups = Map.groupBy(holds, (item) => item.awardName || "未分類");
const manifest = [];
for (const [awardName, candidates] of groups) {
  const safeName = awardName.normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 96) || "uncategorized";
  const filePath = path.join(outputDir, `${safeName}.json`);
  fs.writeFileSync(filePath, JSON.stringify({ awardName, candidateCount: candidates.length, candidates }, null, 2));
  manifest.push({ awardName, candidateCount: candidates.length, filePath });
}

manifest.sort((a, b) => a.awardName.localeCompare(b.awardName, "ja"));
const manifestPath = path.join(outputDir, "manifest.json");
fs.writeFileSync(manifestPath, JSON.stringify({ totalCandidates: holds.length, groups: manifest }, null, 2));
console.log(JSON.stringify({ totalCandidates: holds.length, groupCount: manifest.length, manifestPath, groups: manifest }, null, 2));
