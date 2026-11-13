import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const candidatePath = process.argv[2];
if (!candidatePath) throw new Error("Usage: node scripts/mark-metadata-classification-reviewed.mjs <candidates.json>");
const outputDir = "/home/ubuntu/iketeru-eizou/analysis/metadata_classification";
const ledgerPath = `${outputDir}/reviewed_ids.json`;
mkdirSync(outputDir, { recursive: true });
const report = JSON.parse(readFileSync(candidatePath, "utf8"));
const existing = new Set(existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : []);
// A completed report means every input batch received a valid structured AI response.
// Inputs without a candidate are intentionally left unclassified, but must not be retried forever.
const respondedIds = new Set((report.inputs || []).map((item) => item.id));
for (const id of respondedIds) existing.add(id);
writeFileSync(ledgerPath, `${JSON.stringify([...existing].sort(), null, 2)}\n`);
console.log(JSON.stringify({ newlyReviewed: respondedIds.size, totalReviewed: existing.size }, null, 2));
