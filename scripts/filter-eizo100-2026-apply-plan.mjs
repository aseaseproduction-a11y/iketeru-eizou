import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const planPath = "/home/ubuntu/eizo100-2026-import/import_plan.json";
const dryRunPath = "/home/ubuntu/eizo100-2026-import/import_result_dry_run.json";
const outputPath = "/home/ubuntu/eizo100-2026-import/import_plan_id_url_verified.json";
const plan = JSON.parse(readFileSync(planPath, "utf8"));
const dryRun = JSON.parse(readFileSync(dryRunPath, "utf8"));
const approvedIds = new Set(dryRun.inserted.map((item) => item.id));
const imports = plan.imports.filter((item) => approvedIds.has(item.id));

if (imports.length !== 60 || new Set(imports.map((item) => item.id)).size !== imports.length) {
  throw new Error(`Expected 60 unique ID/URL-safe imports, received ${imports.length}`);
}
mkdirSync("/home/ubuntu/eizo100-2026-import", { recursive: true });
writeFileSync(outputPath, `${JSON.stringify({ ...plan, imports, filtering: { basis: "dry-run ID/normalized URL non-duplicate", excludedForManualReview: plan.imports.length - imports.length } }, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, imports: imports.length, excluded: plan.imports.length - imports.length }, null, 2));
