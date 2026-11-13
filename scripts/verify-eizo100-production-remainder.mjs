import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

const inputDir = "/home/ubuntu/iketeru-eizou/analysis/eizo100_all_years/production_research_remainder_corrected";
const outputDir = "/home/ubuntu/iketeru-eizou/analysis/eizo100_all_years/production_research_remainder_corrected_verified";
mkdirSync(outputDir, { recursive: true });
const roleOnly = /^(director|producer|planner|designer|editor|animator|animation|sound|compositor|cinematographer|technical director|motion graphics designer|cgi artist|effect animator|3d animator|storyboard artist|cg director)$/i;
const normalize = (value) => String(value).normalize("NFKC").toLowerCase().replace(/[\s　,，・/／:：()（）\[\]【】]/g, "");
const cleanValue = (value) => {
  const trimmed = String(value ?? "").trim();
  if (trimmed.length < 2 || /^\d{1,4}(:\d{2})?$/.test(trimmed) || roleOnly.test(trimmed) || /制作しました|企画・開発・演出/.test(trimmed)) return "";
  return trimmed;
};
const stripHtml = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
const fetchText = async (url) => {
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return normalize(stripHtml(await response.text()));
};
const files = readdirSync(inputDir).filter((name) => /^group-\d+\.json$/.test(name)).sort();
const entries = files.flatMap((file) => JSON.parse(readFileSync(`${inputDir}/${file}`, "utf8")));
const verified = [];
const held = [];
const verifyEntry = async (entry) => {
  if (entry.status !== "verified" || !entry.sourceUrls?.length) { held.push({ ...entry, verificationReason: "not_verified_or_no_official_source" }); return; }
  try {
    const sourceText = (await Promise.all(entry.sourceUrls.map(fetchText))).join(" ");
    const values = [...new Set((entry.productionValues || []).map(cleanValue).filter(Boolean).filter((value) => sourceText.includes(normalize(value))))];
    if (values.length) verified.push({ ...entry, productionValues: values, verifiedAt: new Date().toISOString() });
    else held.push({ ...entry, verificationReason: "no_clean_value_found_in_official_page_text" });
  } catch (error) {
    held.push({ ...entry, verificationReason: error instanceof Error ? error.message : "official_page_fetch_failed" });
  }
};
let cursor = 0;
const worker = async () => {
  while (cursor < entries.length) {
    const entry = entries[cursor++];
    await verifyEntry(entry);
  }
};
await Promise.all(Array.from({ length: 12 }, worker));
const output = { createdAt: new Date().toISOString(), total: entries.length, verified: verified.length, held: held.length, verifiedEntries: verified, heldEntries: held };
writeFileSync(`${outputDir}/verification.json`, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ total: output.total, verified: output.verified, held: output.held, output: `${outputDir}/verification.json` }, null, 2));
