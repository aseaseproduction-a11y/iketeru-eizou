import { mkdirSync, writeFileSync } from "node:fs";

const outputDir = "/home/ubuntu/iketeru-eizou/analysis/site_imports/next_sites";
const outputPath = `${outputDir}/wordpress_video_candidates.json`;
mkdirSync(outputDir, { recursive: true });
const sites = [
  ["pics", "https://www.pics.tokyo", "P.I.C.S. 公式制作実績", "P.I.C.S."], ["naname", "https://nanameinc.jp", "naname 公式制作実績", "naname"], ["liki", "https://www.likiinc.com", "Liki 公式制作実績", "Liki"], ["wachajack", "https://wachajack.com", "ワチャジャック 公式制作実績", "ワチャジャック"], ["flapper3", "https://www.flapper3.co.jp", "フラッパー3 公式制作実績", "フラッパー3"], ["tyo", "https://tyo.co.jp", "TYO 公式制作実績", "TYO"], ["geekpictures", "https://geekpictures.co.jp/jp", "GEEK PICTURES 公式制作実績", "GEEK PICTURES"],
];
const unique = (items) => [...new Set(items.filter(Boolean))];
const text = (value) => typeof value === "string" ? value : JSON.stringify(value ?? "");
const getVideo = (raw) => {
  try {
    const url = new URL(raw.replaceAll("\\/", "/"));
    if (/youtu\.be|youtube\.com/i.test(url.hostname)) { const id = url.hostname.includes("youtu.be") ? url.pathname.split("/").filter(Boolean).at(-1) : url.searchParams.get("v") || url.pathname.match(/\/(?:embed|shorts)\/([^/?]+)/)?.[1]; return id ? { id, platform: "youtube", videoUrl: `https://www.youtube.com/watch?v=${id}` } : null; }
    if (/vimeo\.com/i.test(url.hostname)) { const id = url.pathname.match(/\/(?:video\/)?(\d+)/)?.[1]; return id ? { id, platform: "vimeo", videoUrl: `https://vimeo.com/${id}` } : null; }
  } catch { /* invalid URL */ }
  return null;
};
const urlsFromText = (value) => unique([...text(value).matchAll(/https?:\\?\/\\?\/[^"'\s<>]*(?:youtube\.com|youtu\.be|vimeo\.com)[^"'\s<>]*/gi)].map((match) => match[0].replaceAll("\\/", "/")));
const json = async (url) => { try { const response = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { "user-agent": "Mozilla/5.0 (compatible; IketeruEizouCollector/1.0)" } }); return response.ok ? await response.json() : null; } catch { return null; } };
const collectSite = async ([source, baseUrl, sourceLabel, productionName]) => {
  const types = await json(`${baseUrl}/wp-json/wp/v2/types`);
  const typeEntries = Object.values(types || {}).filter((type) => type && typeof type === "object" && typeof type.rest_base === "string" && !["posts", "pages", "media", "attachment", "wp_block", "wp_template"].includes(type.rest_base));
  const rows = [];
  const audits = [];
  for (const type of typeEntries) {
    const endpoint = `${baseUrl}/wp-json/wp/v2/${type.rest_base}?per_page=100&_embed=1`;
    const data = await json(endpoint);
    if (!Array.isArray(data)) { audits.push({ type: type.slug, status: "unavailable" }); continue; }
    audits.push({ type: type.slug, status: "ok", count: data.length });
    for (const item of data) {
      const title = String(item.title?.rendered || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      const sources = urlsFromText({ content: item.content, acf: item.acf, meta: item.meta, excerpt: item.excerpt });
      for (const raw of sources) {
        const video = getVideo(raw);
        if (video && title) rows.push({ ...video, title, source, sourceLabel, sourceUrl: item.link || endpoint, productionName, sourceContext: `${sourceLabel}の公開WordPress APIに作品と動画URLを明示` });
      }
    }
  }
  return { source, audits, rows };
};
const results = [];
for (let index = 0; index < sites.length; index += 3) results.push(...await Promise.all(sites.slice(index, index + 3).map(collectSite)));
const rows = unique(results.flatMap((result) => result.rows).map((row) => JSON.stringify(row))).map((row) => JSON.parse(row));
writeFileSync(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), results, rows }, null, 2)}\n`);
console.log(JSON.stringify({ sites: results.length, rows: rows.length, bySource: rows.reduce((acc, row) => ({ ...acc, [row.source]: (acc[row.source] || 0) + 1 }), {}) }, null, 2));
