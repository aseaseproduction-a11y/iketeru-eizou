import fs from "node:fs";
import path from "node:path";
import { renderCalibrationPrompt } from "./lib/calibration-prompt-template.mjs";

const REPO_ROOT = "E:\\iketeru-eizou";
const runId = process.argv[2];
const modeFilter = process.argv[3] || "both"; // video | contact_sheet | both
const startIdx = parseInt(process.argv[4] || "0", 10);
const count = parseInt(process.argv[5] || "5", 10);

const runDir = path.join(REPO_ROOT, "analysis", "runs", runId);
const manifest = JSON.parse(fs.readFileSync(path.join(runDir, "run_manifest.json"), "utf8"));
const allIds = Object.keys(manifest.items);
const slice = allIds.slice(startIdx, startIdx + count);
const modes = modeFilter === "both" ? ["video", "contact_sheet"] : [modeFilter];

for (const vid of slice) {
  for (const mode of modes) {
    const spec = JSON.parse(fs.readFileSync(path.join(runDir, "specs", `${vid}_${mode}.json`), "utf8"));
    console.log(`<<<ITEM vid=${vid} blind=${spec.blindId} mode=${mode}>>>`);
    console.log(renderCalibrationPrompt(spec));
    console.log(`<<<END vid=${vid} mode=${mode}>>>`);
  }
}
