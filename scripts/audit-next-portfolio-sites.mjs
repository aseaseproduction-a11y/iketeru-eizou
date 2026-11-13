import { mkdirSync, writeFileSync } from "node:fs";

const sites = [
  ["oddfellows", "https://oddfellows.tv/"], ["pics", "https://www.pics.tokyo/"], ["naname", "https://nanameinc.jp/"],
  ["edp", "https://www.edp.jp/"], ["liki", "https://www.likiinc.com/"], ["takerushima", "https://takerushima.com/"],
  ["shujihirai", "https://shujihirai.com/"], ["rainy_melody_notion", "https://rainy-melody-094.notion.site/15421c8856f046b182fa9cc6f17f16ca?v=4f2dea56fff143f5a6235147173c779f"],
  ["sgasakura", "https://www.sgasakura.com/"], ["maxilla", "https://maxilla.jp/"], ["wachajack", "https://wachajack.com/"],
  ["signif", "https://signif.jp/"], ["flapper3", "https://www.flapper3.co.jp/"], ["taiyokikaku", "https://www.taiyokikaku.com/"],
  ["pyramidfilm", "https://www.pyramidfilm.co.jp/"], ["babel_pro", "https://babel-pro.com/"], ["ukmva", "https://www.ukmva.com/"],
  ["aoi_pro", "https://www.aoi-pro.com/jp/"], ["tyo", "https://tyo.co.jp/"], ["geekpictures", "https://geekpictures.co.jp/jp/"],
  ["stinkstudios", "https://www.stinkstudios.com/"], ["d_walker", "https://www.d-walker.com/"],
];
const outputDir = "/home/ubuntu/iketeru-eizou/analysis/site_imports/next_sites";
mkdirSync(outputDir, { recursive: true });
const findAll = (pattern, html) => [...html.matchAll(pattern)].map((match) => match[0]);
const absoluteLinks = (html, base) => [...html.matchAll(/(?:href|src)=["']([^"']+)["']/gi)]
  .map((match) => { try { return new URL(match[1], base).toString(); } catch { return ""; } })
  .filter(Boolean);
const inspect = async ([site, url]) => {
  try {
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000), headers: { "user-agent": "Mozilla/5.0 (compatible; IketeruEizouResearch/1.0)" } });
    const html = await response.text();
    const links = [...new Set(absoluteLinks(html, response.url))];
    const videoUrls = [...new Set([...findAll(/https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|vimeo\.com\/\d+)/gi, html), ...links.filter((item) => /(?:youtube\.com\/watch\?v=|youtu\.be\/|vimeo\.com\/\d+)/i.test(item))])];
    const workPages = links.filter((item) => /\/(?:works?|projects?|portfolio|cases?|archives?|movies?|films?)(?:\/|\?|$)/i.test(item)).slice(0, 100);
    const cmsHints = links.filter((item) => /wp-json|api\/|graphql|sitemap|rss/i.test(item)).slice(0, 30);
    return { site, requestedUrl: url, finalUrl: response.url, status: response.status, htmlLength: html.length, videoUrls, workPages, cmsHints, title: (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim() };
  } catch (error) {
    return { site, requestedUrl: url, status: 0, error: error instanceof Error ? error.message : String(error), videoUrls: [], workPages: [], cmsHints: [] };
  }
};
const results = [];
for (let index = 0; index < sites.length; index += 4) results.push(...await Promise.all(sites.slice(index, index + 4).map(inspect)));
const report = { generatedAt: new Date().toISOString(), siteCount: sites.length, results };
writeFileSync(`${outputDir}/initial_html_audit.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(results.map((result) => ({ site: result.site, status: result.status, videos: result.videoUrls.length, workPages: result.workPages.length, cmsHints: result.cmsHints.length })), null, 2));
