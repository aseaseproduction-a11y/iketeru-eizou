import { mkdirSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";
import { EXPRESSION_OPTIONS, PURPOSE_OPTIONS, restrictToAllowedOptions } from "../shared/metadataOptions.ts";

const outputDir = "/home/ubuntu/iketeru-eizou/analysis/metadata_normalization";
const apply = process.argv.includes("--apply");
mkdirSync(outputDir, { recursive: true });
const parse = (raw) => { try { const value = JSON.parse(raw || "[]"); return Array.isArray(value) ? value.filter((item) => typeof item === "string") : []; } catch { return []; } };
const same = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);
const db = await mysql.createConnection(process.env.DATABASE_URL);
try {
  const [rows] = await db.execute("SELECT id, title, purposes, expressions FROM videos");
  const changes = [];
  for (const row of rows) {
    const purposesBefore = parse(row.purposes);
    const expressionsBefore = parse(row.expressions);
    const purposesAfter = restrictToAllowedOptions(purposesBefore, PURPOSE_OPTIONS);
    const expressionsAfter = restrictToAllowedOptions(expressionsBefore, EXPRESSION_OPTIONS);
    if (!same(purposesBefore, purposesAfter) || !same(expressionsBefore, expressionsAfter)) {
      changes.push({ id: String(row.id), title: String(row.title), purposesBefore, purposesAfter, expressionsBefore, expressionsAfter, removedPurposes: purposesBefore.filter((item) => !purposesAfter.includes(item)), removedExpressions: expressionsBefore.filter((item) => !expressionsAfter.includes(item)) });
    }
  }
  if (apply) {
    for (let offset = 0; offset < changes.length; offset += 100) {
      for (const change of changes.slice(offset, offset + 100)) await db.execute("UPDATE videos SET purposes = ?, expressions = ? WHERE id = ?", [JSON.stringify(change.purposesAfter), JSON.stringify(change.expressionsAfter), change.id]);
    }
  }
  const report = { mode: apply ? "apply" : "dry-run", generatedAt: new Date().toISOString(), totalVideos: rows.length, changedVideos: changes.length, unchangedVideos: rows.length - changes.length, changes };
  writeFileSync(`${outputDir}/purpose_expression_${apply ? "apply" : "dry_run"}.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ mode: report.mode, totalVideos: report.totalVideos, changedVideos: report.changedVideos, unchangedVideos: report.unchangedVideos }, null, 2));
} finally {
  await db.end();
}
process.exit(0);
