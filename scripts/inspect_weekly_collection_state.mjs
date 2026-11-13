import mysql from "mysql2/promise";

const connection = await mysql.createConnection(process.env.DATABASE_URL);

try {
  const [sources] = await connection.execute(
    "SELECT id, label, url, enabled, lastCheckedAt, updatedAt FROM dailyCollectionSources WHERE enabled = 1 ORDER BY id",
  );
  const [recentRuns] = await connection.execute(
    "SELECT id, taskUid, status, candidateCount, insertedCount, updatedCount, skippedCount, startedAt, completedAt FROM dailyCollectionRuns ORDER BY id DESC LIMIT 10",
  );
  const [videoCountRows] = await connection.execute("SELECT COUNT(*) AS totalVideoCount FROM videos");

  console.log(JSON.stringify({ sources, recentRuns, totalVideoCount: videoCountRows[0]?.totalVideoCount ?? 0 }, null, 2));
} finally {
  await connection.end();
}
