import fs from "node:fs";
import { renderCalibrationPrompt } from "./lib/calibration-prompt-template.mjs";

const specPath = process.argv[2];
if (!specPath) {
  console.error("Usage: node scripts/render-prompt-from-spec.mjs <spec.json>");
  process.exit(2);
}
const spec = JSON.parse(fs.readFileSync(specPath, "utf8").replace(/^\uFEFF/, ""));
process.stdout.write(renderCalibrationPrompt(spec));
