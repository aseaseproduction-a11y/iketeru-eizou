import { readFileSync, writeFileSync } from "node:fs";

const inputDir = "/home/ubuntu/iketeru-eizou/analysis/eizo100_all_years/official_source_rechecks";
const latestYearBySourceUrl = new Map(JSON.parse(readFileSync("/home/ubuntu/iketeru-eizou/analysis/eizo100_2026/final_reconciliation.json", "utf8")).rows.map((row) => [row.sourceUrl, 2026]));
const extractRows = (value) => {
  if (Array.isArray(value)) return value.flatMap(extractRows);
  if (!value || typeof value !== "object") return [];
  if (value.source_post_id || value.sourcePostId) return [value];
  return Object.values(value).flatMap(extractRows);
};
const normalize = (row) => ({
  sourcePostId: Number(row.source_post_id ?? row.sourcePostId),
  sourceYear: Number(row.source_year ?? row.sourceYear) || 2026,
  creatorName: row.creator_name ?? row.creatorName ?? "",
  workTitle: row.work_title ?? row.workTitle ?? "",
  sourceUrl: row.source_url ?? row.sourceUrl ?? "",
  result: row.result ?? "hold",
  videoId: row.video_id ?? row.videoId ?? "",
  platform: row.platform ?? "",
  videoUrl: row.video_url ?? row.videoUrl ?? "",
  videoTitle: row.video_title ?? row.videoTitle ?? "",
  officialSourceUrls: row.official_source_urls ?? row.officialSourceUrls ?? [],
  verificationReason: row.verification_reason ?? row.verificationReason ?? "",
});
const rows = Array.from({ length: 20 }, (_, index) => index + 1).flatMap((group) => {
  const suffix = String(group).padStart(2, "0");
  const expected = JSON.parse(readFileSync(`/home/ubuntu/eizo100-all-years-hold-groups/group-${suffix}.json`, "utf8"));
  const observed = extractRows(JSON.parse(readFileSync(`${inputDir}/group-${suffix}.json`, "utf8"))).map(normalize);
  return expected.map((item) => {
    const matched = observed.find((row) => row.sourcePostId === Number(item.sourcePostId) && row.sourceUrl === item.sourceUrl);
    if (!matched) {
      return normalize({
        sourcePostId: item.sourcePostId,
        sourceYear: item.sourceYear,
        creatorName: item.creatorName,
        workTitle: item.workTitle,
        sourceUrl: item.sourceUrl,
        result: "hold",
        officialSourceUrls: [item.sourceUrl],
        verificationReason: "recheck_result_source_post_mismatch",
      });
    }
    return {
      ...matched,
      sourcePostId: Number(item.sourcePostId),
      sourceYear: Number(item.sourceYear) || latestYearBySourceUrl.get(item.sourceUrl) || matched.sourceYear || 2026,
      creatorName: item.creatorName || matched.creatorName,
      workTitle: item.workTitle || matched.workTitle,
      sourceUrl: item.sourceUrl,
    };
  });
});
const entryKey = (row) => `${row.sourceYear}:${row.sourcePostId}`;
const unique = new Map(rows.map((row) => [entryKey(row), row]));
const invalid = rows.filter((row) => !Number.isFinite(row.sourcePostId));
const duplicates = Array.from(unique.entries()).flatMap(([key]) => rows.filter((row) => entryKey(row) === key).slice(1).map((row) => ({ sourceYear: row.sourceYear, sourcePostId: row.sourcePostId, workTitle: row.workTitle, sourceUrl: row.sourceUrl })));
writeFileSync(`${inputDir}/aggregation_diagnostics.json`, `${JSON.stringify({ totalRows: rows.length, uniqueRows: unique.size, invalid, duplicates }, null, 2)}\n`);
if (rows.length !== 262 || invalid.length || duplicates.length) throw new Error(`Expected 262 valid unique rows; got rows=${rows.length}, invalid=${invalid.length}, duplicate=${duplicates.length}`);
const output = Array.from(unique.values()).sort((a, b) => a.sourcePostId - b.sourcePostId);
const summary = output.reduce((accumulator, row) => ({ ...accumulator, [row.result]: (accumulator[row.result] || 0) + 1 }), { total: output.length });
writeFileSync(`${inputDir}/aggregated_results.json`, `${JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows: output }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
