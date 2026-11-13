import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const baseDir = "/home/ubuntu/iketeru-eizou/analysis/site_imports/next_sites";
const audit = JSON.parse(readFileSync(`${baseDir}/initial_html_audit.json`, "utf8"));
const outputPath = `${baseDir}/official_video_candidates.json`;
mkdirSync(baseDir, { recursive: true });
const labels = {
  oddfellows: "oddfellows. 公式サイト", pics: "P.I.C.S. 公式制作実績", naname: "naname 公式制作実績", edp: "EDP 公式制作実績", liki: "Liki 公式制作実績", takerushima: "竹留 公式ポートフォリオ", shujihirai: "平井秀司 公式ポートフォリオ", rainy_melody_notion: "公式Notionデータベース", sgasakura: "佐倉 公式ポートフォリオ", maxilla: "maxilla 公式制作実績", wachajack: "ワチャジャック 公式制作実績", signif: "SIGNIF 公式制作実績", flapper3: "フラッパー3 公式制作実績", taiyokikaku: "太陽企画 公式制作実績", pyramidfilm: "ピラミッドフィルム 公式制作実績", babel_pro: "BABEL LABEL 公式制作実績", ukmva: "UK Music Video Awards 公式アーカイブ", aoi_pro: "AOI Pro. 公式制作実績", tyo: "TYO 公式制作実績", geekpictures: "GEEK PICTURES 公式制作実績", stinkstudios: "Stink Studios 公式制作実績", d_walker: "D-Walker 公式制作実績",
};
const productionNames = { pics: "P.I.C.S.", naname: "naname", edp: "EDP", liki: "Liki", maxilla: "maxilla", wachajack: "ワチャジャック", signif: "SIGNIF", flapper3: "フラッパー3", taiyokikaku: "太陽企画", pyramidfilm: "ピラミッドフィルム", babel_pro: "BABEL LABEL", aoi_pro: "AOI Pro.", tyo: "TYO", geekpictures: "GEEK PICTURES", stinkstudios: "Stink Studios", d_walker: "D-Walker" };
const unique = (items) => [...new Set(items.filter(Boolean))];
const clean = (value = "") => value.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const titleFromHtml = (html) => clean(html.match(/<meta[^>]+(?:property|name)=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:title["']/i)?.[1] || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
const parseVideo = (raw) => {
  try {
    const url = new URL(raw.replaceAll("\\/", "/"));
    if (/youtu\.be|youtube\.com/i.test(url.hostname)) { const id = url.hostname.includes("youtu.be") ? url.pathname.split("/").filter(Boolean).at(-1) : url.searchParams.get("v") || url.pathname.match(/\/(?:embed|shorts)\/([^/?]+)/)?.[1]; return id ? { id, platform: "youtube", videoUrl: `https://www.youtube.com/watch?v=${id}` } : null; }
    if (/vimeo\.com/i.test(url.hostname)) { const id = url.pathname.match(/\/(?:video\/)?(\d+)/)?.[1]; return id ? { id, platform: "vimeo", videoUrl: `https://vimeo.com/${id}` } : null; }
  } catch { /* malformed */ }
  return null;
};
const getVideoUrls = (html) => unique([...html.matchAll(/(?:href|src)=["']([^"']+(?:youtube\.com|youtu\.be|vimeo\.com)[^"']*)["']/gi)].map((match) => match[1].replaceAll("\\/", "/")).concat([...html.matchAll(/https?:\\?\/\\?\/[^"'\s<>]*(?:youtube\.com|youtu\.be|vimeo\.com)[^"'\s<>]*/gi)].map((match) => match[0].replaceAll("\\/", "/"))));
const fetchPage = async ({ site, sourceUrl }) => {
  try {
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(20_000), headers: { "user-agent": "Mozilla/5.0 (compatible; IketeruEizouCollector/1.0)" } });
    if (!response.ok) return [];
    const html = await response.text();
    const title = titleFromHtml(html);
    if (!title || title.length < 3) return [];
    return getVideoUrls(html).map(parseVideo).filter(Boolean).map((video) => ({ ...video, title, source: site, sourceLabel: labels[site] || `${site} 公式サイト`, sourceUrl, productionName: productionNames[site] || "", sourceContext: `${labels[site] || site}の公式掲載ページに動画URLを明示` }));
  } catch { return []; }
};
const sourcePages = audit.results.flatMap((result) => result.workPages.map((sourceUrl) => ({ site: result.site, sourceUrl }))).filter((item) => item.sourceUrl.startsWith("http"));
const pageRows = [];
for (let index = 0; index < sourcePages.length; index += 8) pageRows.push(...await Promise.all(sourcePages.slice(index, index + 8).map(fetchPage)));
const rows = unique(pageRows.flat().map((row) => JSON.stringify(row))).map((row) => JSON.parse(row));
const summary = rows.reduce((result, row) => ({ ...result, [row.source]: (result[row.source] || 0) + 1, [row.platform]: (result[row.platform] || 0) + 1 }), { workPagesFetched: sourcePages.length, candidateRows: rows.length });
writeFileSync(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
