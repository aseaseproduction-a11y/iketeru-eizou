import mysql from "mysql2/promise";
import { readFile, writeFile } from "node:fs/promises";

const targetListPath = process.argv.slice(2).find((arg) => !arg.startsWith("--"))
  || "/home/ubuntu/iketeru-eizou/analysis/analysis_targets.json";
const count = Number(process.argv.find((arg) => arg.startsWith("--count="))?.slice(8) || 300);
const idFilter = new Set(
  (process.argv.find((arg) => arg.startsWith("--ids="))?.slice(6) || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
);
const apply = process.argv.includes("--apply");
const reportPath = process.argv.find((arg) => arg.startsWith("--report="))?.slice(9)
  || "/home/ubuntu/iketeru-eizou/analysis/recovery_report.json";

const payload = JSON.parse(await readFile(targetListPath, "utf8"));
const allTargets = Array.isArray(payload.targets) ? payload.targets : [];
const targets = idFilter.size > 0
  ? allTargets.filter((target) => idFilter.has(String(target.id)))
  : allTargets.slice(0, count);
const connection = await mysql.createConnection(process.env.DATABASE_URL);
const report = { targetListPath, count, requestedIds: idFilter.size, apply, restored: 0, missing: [], mismatches: [], errors: [] };

try {
  for (const target of targets) {
    const [rows] = await connection.execute(
      `SELECT id, title, videoUrl FROM videos WHERE id = ? LIMIT 1`,
      [target.id]
    );
    const current = rows[0];
    if (!current) {
      report.missing.push(target.id);
      continue;
    }
    if (String(current.title || "") !== String(target.title || "") || String(current.videoUrl || "") !== String(target.videoUrl || "")) {
      report.mismatches.push({ id: target.id, currentTitle: current.title, snapshotTitle: target.title });
      continue;
    }

    if (apply) {
      const metadata = target.existingMetadata || {};
      await connection.execute(
        `UPDATE videos SET genres = ?, products = ?, directions = ?, tones = ?, allTags = ?,
           purposes = ?, expressions = ?, toneEmotions = ?, toneVisuals = ?, toneTechniques = ?, productions = ?,
           privateRating = NULL, aiOverallRating = NULL, aiDirectionRating = NULL, aiTechniqueRating = NULL, aiAnalysis = NULL,
           updatedAt = NOW()
         WHERE id = ?`,
        [
          metadata.genres || "[]", metadata.products || "[]", metadata.directions || "[]", metadata.tones || "[]",
          metadata.allTags || "[]", metadata.purposes || "[]", metadata.expressions || "[]",
          metadata.toneEmotions || "[]", metadata.toneVisuals || "[]", metadata.toneTechniques || "[]", metadata.productions || "[]",
          target.id,
        ]
      );
    }
    report.restored += 1;
  }
} catch (error) {
  report.errors.push(error instanceof Error ? error.message : String(error));
  throw error;
} finally {
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  await connection.end();
}

console.log(JSON.stringify(report));
process.exit(0);
