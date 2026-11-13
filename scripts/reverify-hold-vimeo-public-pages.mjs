import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const baseDir = "/home/ubuntu/iketeru-eizou/analysis/site_imports/next_sites/hold_research";
const targets = JSON.parse(readFileSync(`${baseDir}/hold_targets.json`, "utf8")).rows;
const text = (value) => value.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&(?:amp|nbsp);/gi, " ").replace(/\s+/g, " ").trim();
const normalize = (value) => value.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "");
const fetchText = async (url) => { try { const response = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { "user-agent": "Mozilla/5.0 (compatible; IketeruEizouResearch/1.0)" } }); return response.ok ? await response.text() : ""; } catch { return ""; } };
const h1 = (html) => text(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");
const title = (html) => text(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s*\|\s*Vimeo.*$/i, "");
const results = [];
for (const target of targets.filter((row) => row.platform === "vimeo")) {
  const [sourceHtml, videoHtml] = await Promise.all([fetchText(target.sourceUrl), fetchText(target.videoUrl)]);
  const officialWorkTitle = h1(sourceHtml);
  const vimeoTitle = title(videoHtml);
  const officialIdMatch = Boolean(sourceHtml && new RegExp(`(?:vimeo\\.com|player\\.vimeo\\.com)[^"'\\s<]*${target.id}`).test(sourceHtml));
  const sourceName = normalize(officialWorkTitle);
  const videoName = normalize(vimeoTitle);
  const titleMatch = sourceName.length >= 4 && videoName.length >= 4 && (sourceName === videoName || sourceName.includes(videoName) || videoName.includes(sourceName));
  const verified = officialIdMatch && titleMatch;
  results.push({ ...target, title: officialWorkTitle || target.officialTitle, retrievedTitle: vimeoTitle, officialWorkTitle, vimeoTitle, officialIdMatch, titleMatch, result: verified ? "verified" : "hold", verificationReason: verified ? "official_portfolio_vimeo_page_id_url_title_match" : officialIdMatch ? "official_source_and_id_but_title_mismatch" : "official_source_video_id_not_found" });
}
mkdirSync(baseDir, { recursive: true });
const summary = results.reduce((acc, result) => ({ ...acc, [result.result]: (acc[result.result] || 0) + 1 }), {});
writeFileSync(`${baseDir}/vimeo_public_page_reverification.json`, `${JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows: results }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
