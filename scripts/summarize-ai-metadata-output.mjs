import { readFileSync } from "node:fs";

const outputPath = process.env.AI_ANALYSIS_OUTPUT || "/home/ubuntu/iketeru-eizou/analysis/ai_metadata_completion/pilot_output_v2_enriched.jsonl";
const rows = readFileSync(outputPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
for (const row of rows) {
  const input = JSON.parse(row.input);
  const candidate = row.output ? JSON.parse(row.output) : null;
  console.log(JSON.stringify({
    id: input.id,
    title: input.title,
    proposed: candidate ? {
      genres: candidate.genres, products: candidate.products, directions: candidate.directions, tones: candidate.tones,
      purposes: candidate.purposes, expressions: candidate.expressions,
    } : null,
    confidence: candidate?.confidence ?? null,
    evidence: candidate?.evidence ?? null,
    error: row.error,
  }, null, 2));
}
