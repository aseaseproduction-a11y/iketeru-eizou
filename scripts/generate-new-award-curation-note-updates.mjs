import { readFileSync, writeFileSync } from "node:fs";

const planPath = "/home/ubuntu/award-winners-import/recheck_verified_import_plan.json";
const globalPlanPath = "/home/ubuntu/award-winners-import/additional_global_awards_import_plan.json";
const researchPath = "/home/ubuntu/research_new_award_curation_notes.json";
const outputPath = "/home/ubuntu/award-winners-import/new_award_curation_note_updates.sql";

const plan = JSON.parse(readFileSync(planPath, "utf8"));
const globalPlan = JSON.parse(readFileSync(globalPlanPath, "utf8"));
const research = JSON.parse(readFileSync(researchPath, "utf8"));
const expected = new Map([...plan.imports, ...globalPlan.imports].map((item) => [item.id, item]));

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const statements = [];
const appliedIds = new Set();

for (const result of research.results) {
  if (result.error) throw new Error(`Research output error: ${result.error}`);
  const note = result.output;
  const item = expected.get(note.video_id);
  if (!item) throw new Error(`Unexpected video ID in research output: ${note.video_id}`);
  if (appliedIds.has(item.id)) throw new Error(`Duplicate research result: ${item.id}`);
  if (![note.purpose, note.background, note.evaluation].every((value) => typeof value === "string" && value.trim())) {
    throw new Error(`Incomplete curation note: ${item.id}`);
  }

  // 公式受賞出典だけを採用し、第三者記事などは保存しない。
  const sourceUrls = [...new Set(item.awards.map((award) => award.sourceUrl).filter(Boolean))];
  if (!sourceUrls.length) throw new Error(`Missing official award source: ${item.id}`);

  const curationNote = JSON.stringify({
    purpose: note.purpose.trim(),
    background: note.background.trim(),
    evaluation: note.evaluation.trim(),
    sourceUrls,
  });

  statements.push(
    `UPDATE videos SET curationNote = ${sqlLiteral(curationNote)} WHERE id = ${sqlLiteral(item.id)} AND title = ${sqlLiteral(item.title)} AND videoUrl = ${sqlLiteral(item.videoUrl)};`,
  );
  appliedIds.add(item.id);
}

if (appliedIds.size !== expected.size) {
  const missing = [...expected.keys()].filter((id) => !appliedIds.has(id));
  throw new Error(`Missing research results for: ${missing.join(", ")}`);
}

writeFileSync(outputPath, `${statements.join("\n")}\n`);
console.log(JSON.stringify({ outputPath, updateCount: statements.length, ids: [...appliedIds] }, null, 2));
