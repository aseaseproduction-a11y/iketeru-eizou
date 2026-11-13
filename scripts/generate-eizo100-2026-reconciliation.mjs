import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const outputDir = "/home/ubuntu/iketeru-eizou/analysis/eizo100_2026";
const { candidates } = JSON.parse(readFileSync(`${outputDir}/candidates.json`, "utf8"));
const { verified } = JSON.parse(readFileSync(`${outputDir}/oembed_verification.json`, "utf8"));
const applied = JSON.parse(readFileSync("/home/ubuntu/eizo100-2026-import/import_result_apply.json", "utf8"));
const exceptions = JSON.parse(readFileSync("/home/ubuntu/eizo100-2026-import/exception_plan.json", "utf8"));
const verifiedBySourcePostId = new Map(verified.map((item) => [item.sourcePostId, item]));
const appliedIds = new Set(applied.inserted.map((item) => item.id));
const updatedIds = new Set(exceptions.existingUpdates.map((item) => item.videoId));
const collisionId = exceptions.collision.videoId;

const rows = candidates.map((candidate) => {
  const verification = verifiedBySourcePostId.get(candidate.sourcePostId);
  if (verification?.verified) {
    const status = updatedIds.has(candidate.videoId) ? "existing_updated" : "registered";
    return { ...candidate, providerTitle: verification.providerTitle, result: status, reason: candidate.videoId === collisionId ? "same_title_different_platform_video" : "id_url_title_triple_verified" };
  }
  return { ...candidate, providerTitle: verification?.providerTitle || "", result: "hold", reason: verification?.verificationStatus || candidate.status };
});
const summary = rows.reduce((accumulator, row) => {
  accumulator[row.result] = (accumulator[row.result] || 0) + 1;
  accumulator[`reason:${row.reason}`] = (accumulator[`reason:${row.reason}`] || 0) + 1;
  return accumulator;
}, { total: rows.length });
if (summary.total !== 191 || (summary.registered || 0) !== 61 || (summary.existing_updated || 0) !== 4 || (summary.hold || 0) !== 126) {
  throw new Error(`Unexpected reconciliation counts: ${JSON.stringify(summary)}`);
}
mkdirSync(outputDir, { recursive: true });
writeFileSync(`${outputDir}/reconciliation.json`, `${JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows }, null, 2)}\n`);
writeFileSync(`${outputDir}/reconciliation.csv`, [
  "result,reason,creator_name,work_title,platform,video_id,video_url,source_url,provider_title",
  ...rows.map((row) => [row.result, row.reason, row.creatorName, row.workTitle, row.platform, row.videoId, row.normalizedUrl, row.sourceUrl, row.providerTitle].map((value) => `"${String(value || "").replaceAll('"', '""')}"`).join(",")),
].join("\n"));
console.log(JSON.stringify(summary, null, 2));
