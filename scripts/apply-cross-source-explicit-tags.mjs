import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq } from "drizzle-orm";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { videos } from "../drizzle/schema.ts";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error("DATABASE_URL is required");

const auditPath = resolve("analysis/metadata_completion/cross_source_explicit_tag_audit.json");
const audit = JSON.parse(readFileSync(auditPath, "utf8"));
const dryRun = process.argv.includes("--dry-run");
const pool = await mysql.createPool(dbUrl);
const db = drizzle(pool);
const results = [];

for (const candidate of audit.candidates) {
  const [current] = await db.select().from(videos).where(eq(videos.id, candidate.id)).limit(1);
  if (!current) {
    results.push({ id: candidate.id, status: "hold", reason: "video_missing" });
    continue;
  }

  const existing = JSON.parse(current[candidate.field] || "[]");
  if (existing.length) {
    results.push({ id: candidate.id, status: "skip", reason: "field_already_filled" });
    continue;
  }

  const metadataClassificationAudit = (() => {
    try { return JSON.parse(current.metadataClassificationAudit || "{}"); }
    catch { return {}; }
  })();
  const completion = {
    source: "official_explicit_tag_cross_source",
    sourceType: "official_or_user_curated_tag",
    field: candidate.field,
    tags: candidate.tags,
    values: candidate.values,
    verifiedAt: new Date().toISOString(),
  };
  metadataClassificationAudit.explicitTagCompletion = [
    ...(metadataClassificationAudit.explicitTagCompletion || []),
    completion,
  ];

  if (!dryRun) {
    await db.update(videos).set({
      [candidate.field]: JSON.stringify(candidate.values),
      metadataClassificationAudit: JSON.stringify(metadataClassificationAudit),
    }).where(eq(videos.id, candidate.id));
  }
  results.push({ id: candidate.id, status: dryRun ? "verified" : "updated", field: candidate.field, values: candidate.values });
}

const summary = {
  dryRun,
  generatedAt: new Date().toISOString(),
  total: results.length,
  updated: results.filter(item => item.status === "updated").length,
  verified: results.filter(item => item.status === "verified").length,
  skipped: results.filter(item => item.status === "skip").length,
  held: results.filter(item => item.status === "hold").length,
  results,
};
writeFileSync(resolve("analysis/metadata_completion/cross_source_explicit_tag_apply_audit.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await pool.end();
