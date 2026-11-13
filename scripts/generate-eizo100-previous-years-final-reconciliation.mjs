import { readFileSync, writeFileSync } from "node:fs";

const years = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
const inputDir = "/home/ubuntu/iketeru-eizou/analysis/eizo100_previous_years";
const candidates = JSON.parse(readFileSync(`${inputDir}/candidates.json`, "utf8")).candidates;
const oembedByPostId = new Map(years.flatMap((year) => JSON.parse(readFileSync(`${inputDir}/oembed_verification_${year}.json`, "utf8")).results).map((item) => [item.sourcePostId, item]));
const audit = JSON.parse(readFileSync("/home/ubuntu/eizo100-previous-years-import/registration_audit.json", "utf8"));
const auditById = new Map(audit.results.map((item) => [item.id, item]));
const dryRun = JSON.parse(readFileSync("/home/ubuntu/eizo100-previous-years-import/import_result_dry_run.json", "utf8"));
const existingIds = new Set(dryRun.skipped.map((item) => item.id));
const rows = candidates.map((candidate) => {
  const oembed = oembedByPostId.get(candidate.sourcePostId);
  if (!oembed || oembed.status !== "triple_verified") return { ...candidate, finalResult: "hold", finalReason: oembed?.reason || candidate.status };
  const auditResult = auditById.get(candidate.videoId);
  if (auditResult?.result !== "verified") return { ...candidate, providerTitle: oembed.providerTitle, finalResult: "hold", finalReason: "database_triple_check_mismatch" };
  return { ...candidate, providerTitle: oembed.providerTitle, finalResult: existingIds.has(candidate.videoId) ? "existing_updated" : "registered", finalReason: oembed.reason };
});
const summary = rows.reduce((counts, row) => ({ ...counts, [row.finalResult]: (counts[row.finalResult] || 0) + 1 }), { total: rows.length });
if (summary.total !== 1094 || summary.registered + summary.existing_updated !== 879 || summary.hold !== 215) throw new Error(`Unexpected reconciliation: ${JSON.stringify(summary)}`);
const output = { generatedAt: new Date().toISOString(), summary, rows };
writeFileSync(`${inputDir}/final_reconciliation.json`, `${JSON.stringify(output, null, 2)}\n`);
writeFileSync(`${inputDir}/final_reconciliation.csv`, [
  "year,source_post_id,result,reason,creator_name,work_title,platform,video_id,video_url,source_url,provider_title",
  ...rows.map((row) => [row.sourceYear, row.sourcePostId, row.finalResult, row.finalReason, row.creatorName, row.workTitle, row.platform, row.videoId, row.normalizedUrl, row.sourceUrl, row.providerTitle].map((value) => `"${String(value || "").replaceAll('"', '""')}"`).join(",")),
].join("\n"));
console.log(JSON.stringify(summary, null, 2));
