import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createVerifiedSiteImports } from "./lib/siteImportMetadata.mjs";

const inputPath = process.env.VERIFICATION_INPUT_PATH || "/home/ubuntu/iketeru-eizou/analysis/site_imports/official_video_verification.json";
const outputDir = process.env.IMPORT_OUTPUT_DIR || "/home/ubuntu/iketeru-eizou/analysis/site_imports";
const input = JSON.parse(readFileSync(inputPath, "utf8"));
mkdirSync(outputDir, { recursive: true });
const imports = createVerifiedSiteImports(input.rows);
const plan = { generatedAt: new Date().toISOString(), source: "指定サイト公式掲載動画", counts: { verifiedCandidates: imports.length }, imports };
writeFileSync(`${outputDir}/official_video_import_plan.json`, `${JSON.stringify(plan, null, 2)}\n`);
console.log(JSON.stringify(plan.counts, null, 2));
