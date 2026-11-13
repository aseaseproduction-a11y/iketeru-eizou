import { readFileSync, writeFileSync } from "node:fs";

const base = JSON.parse(readFileSync("/home/ubuntu/iketeru-eizou/analysis/eizo100_2026/reconciliation.json", "utf8"));
const oembed = JSON.parse(readFileSync("/home/ubuntu/iketeru-eizou/analysis/eizo100_2026/hold_recheck_oembed.json", "utf8"));
const dryRun = JSON.parse(readFileSync("/home/ubuntu/eizo100-2026-recheck-import/import_result_dry_run.json", "utf8"));
const skippedIds = new Set(dryRun.skipped.map((item) => item.id));
const recheckByPostId = new Map(oembed.verified.map((item) => [item.sourcePostId, item]));
const rows = base.rows.map((row) => {
  if (row.result !== "hold") return { ...row, finalResult: row.result, finalReason: row.reason };
  const candidate = recheckByPostId.get(row.sourcePostId);
  if (!candidate || candidate.oembedStatus !== "verified") return { ...row, finalResult: "hold", finalReason: candidate?.oembedError || row.reason };
  return {
    ...row,
    platform: candidate.platform,
    videoId: candidate.videoId,
    normalizedUrl: candidate.normalizedUrl,
    providerTitle: candidate.oembedTitle,
    finalResult: skippedIds.has(candidate.videoId) ? "existing_updated" : "registered",
    finalReason: "variant_recheck_triple_verified",
  };
});
const summary = rows.reduce((accumulator, row) => ({ ...accumulator, [row.finalResult]: (accumulator[row.finalResult] || 0) + 1 }), { total: rows.length });
const selectedEntries = rows.filter((row) => ["registered", "existing_updated"].includes(row.finalResult));
const selectedIds = new Set(selectedEntries.map((row) => row.videoId));
if (summary.total !== 191 || summary.registered !== 130 || summary.existing_updated !== 14 || summary.hold !== 47 || selectedEntries.length !== 144 || selectedIds.size !== 143) throw new Error(`Unexpected final reconciliation: ${JSON.stringify(summary)} / selected entries ${selectedEntries.length} / unique videos ${selectedIds.size}`);
const output = { generatedAt: new Date().toISOString(), summary: { ...summary, selectedEntries: selectedEntries.length, uniqueVideos: selectedIds.size, duplicateSelectionEntries: selectedEntries.length - selectedIds.size }, rows };
const outputDir = "/home/ubuntu/iketeru-eizou/analysis/eizo100_2026";
writeFileSync(`${outputDir}/final_reconciliation.json`, `${JSON.stringify(output, null, 2)}\n`);
writeFileSync(`${outputDir}/final_reconciliation.csv`, [
  "source_post_id,result,reason,creator_name,work_title,platform,video_id,video_url,source_url,provider_title",
  ...rows.map((row) => [row.sourcePostId, row.finalResult, row.finalReason, row.creatorName, row.workTitle, row.platform, row.videoId, row.normalizedUrl, row.sourceUrl, row.providerTitle].map((value) => `"${String(value || "").replaceAll('"', '""')}"`).join(",")),
].join("\n"));
console.log(JSON.stringify(output.summary, null, 2));
