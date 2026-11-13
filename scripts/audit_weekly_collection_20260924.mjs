import { readFile, writeFile } from "node:fs/promises";
import mysql from "mysql2/promise";

const input = JSON.parse(await readFile("/tmp/weekly_collection_candidates_20260924.json", "utf8"));
const apply = JSON.parse(await readFile("/tmp/weekly_collection_apply_20260924.json", "utf8"));
const connection = await mysql.createConnection(process.env.DATABASE_URL);

try {
  const candidateById = new Map(input.candidates.map(candidate => [candidate.id, candidate]));
  const [runRows] = await connection.execute(
    "SELECT id, taskUid, status, candidateCount, insertedCount, updatedCount, skippedCount, startedAt, completedAt, details FROM dailyCollectionRuns WHERE id = ?",
    [apply.runId],
  );
  const run = runRows[0];
  const details = JSON.parse(run.details || "[]");
  const checkedSourceIds = input.checkedSourceIds;
  const placeholders = checkedSourceIds.map(() => "?").join(", ");
  const [sources] = await connection.execute(
    `SELECT id, label, lastCheckedAt FROM dailyCollectionSources WHERE id IN (${placeholders}) ORDER BY id`,
    checkedSourceIds,
  );
  const insertedIds = details.filter(detail => detail.reason === "inserted").map(detail => detail.id);
  const updatedIds = details.filter(detail => detail.reason === "updated_existing_public_metadata").map(detail => detail.id);
  const skipped = details.filter(detail => detail.reason !== "inserted" && detail.reason !== "updated_existing_public_metadata");
  const statusBySource = Object.fromEntries(checkedSourceIds.map(sourceId => [sourceId, {
    candidates: input.candidates.filter(candidate => candidate.sourceId === sourceId).length,
    inserted: insertedIds.filter(id => candidateById.get(id)?.sourceId === sourceId).length,
    updated: updatedIds.filter(id => candidateById.get(id)?.sourceId === sourceId).length,
    skipped: skipped.filter(detail => candidateById.get(detail.id)?.sourceId === sourceId).length,
  }]));
  const videoIds = [...new Set([...insertedIds, ...updatedIds])];
  const [videoRows] = videoIds.length
    ? await connection.execute(`SELECT id, title, source, sourceLabel, videoUrl FROM videos WHERE id IN (${videoIds.map(() => "?").join(", ")}) ORDER BY id`, videoIds)
    : [[]];
  const result = {
    run: { ...run, details },
    sources,
    sourceStatus: statusBySource,
    insertedIds,
    updatedIds,
    skipped,
    savedVideos: videoRows,
  };
  await writeFile("/tmp/weekly_collection_audit_20260924.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await connection.end();
}
