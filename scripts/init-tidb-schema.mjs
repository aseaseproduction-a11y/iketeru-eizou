/**
 * Idempotently initialize all iketeru-eizou tables (including 100pt scoring columns)
 * on a fresh TiDB Cloud Serverless or MySQL 8 database.
 *
 * Usage:
 *   DATABASE_URL="mysql://..." node scripts/init-tidb-schema.mjs
 */
import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required (e.g. TiDB Cloud Serverless connection URI).");
}

const needsTls = /tidbcloud\.com|psdb\.cloud|aivencloud\.com/i.test(databaseUrl) || process.env.MYSQL_SSL === "true";

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS \`users\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`openId\` varchar(64) NOT NULL,
    \`name\` text,
    \`email\` varchar(320),
    \`loginMethod\` varchar(64),
    \`role\` enum('user','admin') NOT NULL DEFAULT 'user',
    \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    \`lastSignedIn\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`users_openId_unique\` (\`openId\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`videos\` (
    \`id\` varchar(64) NOT NULL,
    \`platform\` varchar(16) NOT NULL,
    \`title\` text NOT NULL,
    \`thumbnail\` text,
    \`videoUrl\` text NOT NULL,
    \`embedUrl\` text,
    \`source\` varchar(64),
    \`sourceLabel\` text,
    \`channelId\` varchar(64),
    \`channelTitle\` text,
    \`genres\` text NOT NULL,
    \`products\` text NOT NULL,
    \`directions\` text NOT NULL,
    \`tones\` text NOT NULL,
    \`allTags\` text NOT NULL,
    \`purposes\` text,
    \`expressions\` text,
    \`toneEmotions\` text,
    \`toneVisuals\` text,
    \`toneTechniques\` text,
    \`productions\` text,
    \`productionCredits\` mediumtext,
    \`awards\` text,
    \`curationNote\` mediumtext,
    \`metadataClassificationAudit\` mediumtext,
    \`privateRating\` varchar(16),
    \`aiOverallRating\` varchar(16),
    \`aiDirectionRating\` varchar(16),
    \`aiTechniqueRating\` varchar(16),
    \`aiOverallScore\` int,
    \`aiDirectionScore\` int,
    \`aiTechniqueScore\` int,
    \`aiScoreBreakdown\` mediumtext,
    \`aiAnalysis\` mediumtext,
    \`embedStatus\` varchar(16) NOT NULL DEFAULT 'unknown',
    \`embedReason\` varchar(128),
    \`embedCheckedAt\` timestamp NULL,
    \`addedDate\` varchar(16),
    \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`favoriteProfiles\` (
    \`id\` varchar(64) NOT NULL,
    \`displayName\` varchar(80) NOT NULL,
    \`normalizedName\` varchar(160) NOT NULL,
    \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`favorite_profiles_normalized_name_unique\` (\`normalizedName\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`profileVideoFavorites\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`profileId\` varchar(64) NOT NULL,
    \`videoId\` varchar(64) NOT NULL,
    \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`profile_video_favorites_profile_video_unique\` (\`profileId\`, \`videoId\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`profileCreatorFavorites\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`profileId\` varchar(64) NOT NULL,
    \`creatorName\` varchar(160) NOT NULL,
    \`normalizedCreatorName\` varchar(240) NOT NULL,
    \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`profile_creator_favorites_profile_creator_unique\` (\`profileId\`, \`normalizedCreatorName\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`dailyCollectionSources\` (
    \`id\` varchar(64) NOT NULL,
    \`label\` varchar(128) NOT NULL,
    \`url\` text NOT NULL,
    \`enabled\` int NOT NULL DEFAULT 1,
    \`scheduleCronTaskUid\` varchar(65),
    \`lastCheckedAt\` timestamp NULL,
    \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`dailyCollectionRuns\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`taskUid\` varchar(65),
    \`startedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`completedAt\` timestamp NULL,
    \`status\` varchar(32) NOT NULL,
    \`candidateCount\` int NOT NULL DEFAULT 0,
    \`insertedCount\` int NOT NULL DEFAULT 0,
    \`updatedCount\` int NOT NULL DEFAULT 0,
    \`skippedCount\` int NOT NULL DEFAULT 0,
    \`details\` mediumtext,
    PRIMARY KEY (\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`aiMetadataCompletionJobs\` (
    \`id\` varchar(64) NOT NULL,
    \`scheduleCronTaskUid\` varchar(65),
    \`backupScheduleCronTaskUid\` varchar(65),
    \`enabled\` int NOT NULL DEFAULT 1,
    \`batchSize\` int NOT NULL DEFAULT 5,
    \`consecutiveModelFailureCount\` int NOT NULL DEFAULT 0,
    \`retryAfter\` timestamp NULL,
    \`lastRunAt\` timestamp NULL,
    \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`aiMetadataCompletionRuns\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`taskUid\` varchar(65),
    \`startedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`completedAt\` timestamp NULL,
    \`status\` varchar(32) NOT NULL,
    \`selectedCount\` int NOT NULL DEFAULT 0,
    \`analyzedCount\` int NOT NULL DEFAULT 0,
    \`auditedCount\` int NOT NULL DEFAULT 0,
    \`savedValueCount\` int NOT NULL DEFAULT 0,
    \`skippedCount\` int NOT NULL DEFAULT 0,
    \`details\` mediumtext,
    PRIMARY KEY (\`id\`)
  )`,
];

const db = await mysql.createConnection({
  uri: databaseUrl,
  ...(needsTls ? { ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true } } : {}),
});

try {
  for (const stmt of STATEMENTS) {
    await db.query(stmt);
  }
  const [tables] = await db.query("SHOW TABLES");
  console.log(JSON.stringify({ ok: true, tablesCount: tables.length }, null, 2));
} finally {
  await db.end();
}
