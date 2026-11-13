import { readFileSync, writeFileSync } from "node:fs";

const researchDir = "/home/ubuntu/iketeru-eizou/analysis/eizo100_all_years/production_research";
const targetsDir = "/home/ubuntu/eizo100-production-research-groups";
const normalized = (url = "") => String(url).replace(/\/$/, "");
const rows = [];
for (let group = 1; group <= 20; group += 1) {
  const suffix = String(group).padStart(2, "0");
  const expected = JSON.parse(readFileSync(`${targetsDir}/group-${suffix}.json`, "utf8"));
  const response = JSON.parse(readFileSync(`${researchDir}/group-${suffix}.json`, "utf8"));
  const observed = Array.isArray(response) ? response : response.results || [];
  for (const item of expected) {
    const result = observed.find((candidate) => String(candidate.id) === String(item.id) && normalized(candidate.video_url) === normalized(item.videoUrl));
    const values = Array.isArray(result?.production_values) ? [...new Set(result.production_values.map((value) => String(value).trim()).filter((value) => value.length > 1 && value.length <= 160 && !/^https?:/i.test(value)))] : [];
    const sources = Array.isArray(result?.official_credit_urls) ? [...new Set(result.official_credit_urls.filter((url) => /^https?:\/\//i.test(url)))] : [];
    const hasExpectedSource = item.sourceUrls.some((source) => sources.includes(source));
    const verified = result?.result === "verified" && values.length > 0 && sources.length >= 2 && hasExpectedSource;
    rows.push({
      id: item.id,
      title: item.title,
      videoUrl: item.videoUrl,
      result: verified ? "verified" : "hold",
      productionValues: verified ? values : [],
      officialCreditUrls: verified ? sources : [],
      verificationReason: verified ? result.verification_reason || "official_credit_research" : result?.verification_reason || "insufficient_official_credit_evidence",
    });
  }
}
const unique = new Map(rows.map((row) => [`${row.id}:${normalized(row.videoUrl)}`, row]));
if (rows.length !== 743 || unique.size !== 743) throw new Error(`Expected 743 unique rows; got rows=${rows.length}, unique=${unique.size}`);
const output = Array.from(unique.values());
const summary = output.reduce((accumulator, row) => ({ ...accumulator, [row.result]: (accumulator[row.result] || 0) + 1 }), { total: output.length });
writeFileSync(`${researchDir}/aggregated_candidates.json`, `${JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows: output }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
