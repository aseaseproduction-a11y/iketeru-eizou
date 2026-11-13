import { readFileSync, writeFileSync } from "node:fs";

function extractJsonArray(value) {
  const start = value.indexOf("[");
  if (start < 0) throw new Error("Result does not contain a JSON array");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) return JSON.parse(value.slice(start, index + 1));
    }
  }
  throw new Error("Unclosed JSON array in result");
}

const reconciliation = JSON.parse(readFileSync("/home/ubuntu/iketeru-eizou/analysis/eizo100_2026/reconciliation.json", "utf8"));
const raw = JSON.parse(readFileSync("/home/ubuntu/recheck_eizo100_2026_holds.json", "utf8"));
const holds = reconciliation.rows.filter((row) => row.result === "hold");
const sourceByPostId = new Map(holds.map((row) => [row.sourcePostId, row]));
const rechecks = raw.results.flatMap((group) => extractJsonArray(group.output.results_json));
if (rechecks.length !== holds.length) throw new Error(`Expected ${holds.length} recheck results, found ${rechecks.length}`);
const seen = new Set();
const rows = rechecks.map((recheck) => {
  const source = sourceByPostId.get(recheck.source_post_id);
  if (!source) throw new Error(`Unknown source post ${recheck.source_post_id}`);
  if (seen.has(source.sourcePostId)) throw new Error(`Duplicate recheck result ${source.sourcePostId}`);
  seen.add(source.sourcePostId);
  const platform = recheck.platform;
  const idValid = platform === "youtube" ? /^[A-Za-z0-9_-]{11}$/.test(recheck.video_id || "") : platform === "vimeo" ? /^\d+$/.test(recheck.video_id || "") : false;
  const normalizedVideoUrl = platform === "youtube" ? `https://www.youtube.com/watch?v=${recheck.video_id}` : platform === "vimeo" ? `https://vimeo.com/${recheck.video_id}` : "";
  const candidate = recheck.result === "verified" && idValid ? {
    ...source,
    platform,
    videoId: recheck.video_id,
    normalizedUrl: normalizedVideoUrl,
    originalVideoUrl: normalizedVideoUrl,
    providerTitle: recheck.provider_title || "",
    officialEvidenceUrl: recheck.official_evidence_url || source.sourceUrl,
    recheckReason: recheck.reason || "",
  } : null;
  return { sourcePostId: source.sourcePostId, workTitle: source.workTitle, creatorName: source.creatorName, proposedResult: recheck.result, reason: recheck.reason || "", candidate };
});
const candidates = rows.filter((row) => row.candidate).map((row) => row.candidate);
const summary = { total: rows.length, recheckVerified: candidates.length, hold: rows.length - candidates.length };
writeFileSync("/home/ubuntu/iketeru-eizou/analysis/eizo100_2026/hold_recheck_aggregate.json", `${JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows, candidates }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
