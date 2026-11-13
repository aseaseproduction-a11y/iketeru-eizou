import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

const uploadDir = "/home/ubuntu/upload";
const outputDir = "/home/ubuntu/iketeru-eizou/analysis/site_imports";
const outputPath = `${outputDir}/favvid_detail_video_candidates.json`;
mkdirSync(outputDir, { recursive: true });
const clean = (value = "") => value.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const uniq = (items) => [...new Set(items.filter(Boolean))];
const getVideo = (raw) => {
  try {
    const url = new URL(raw.replaceAll("\\/", "/"));
    if (/youtu\.be|youtube\.com/i.test(url.hostname)) {
      const id = url.hostname.includes("youtu.be") ? url.pathname.split("/").filter(Boolean).at(-1) : url.searchParams.get("v") || url.pathname.match(/\/(?:embed|shorts)\/([^/?]+)/)?.[1];
      return id ? { id, platform: "youtube", videoUrl: `https://www.youtube.com/watch?v=${id}` } : null;
    }
    if (/vimeo\.com/i.test(url.hostname)) {
      const id = url.pathname.match(/\/(?:video\/)?(\d+)/)?.[1];
      return id ? { id, platform: "vimeo", videoUrl: `https://vimeo.com/${id}` } : null;
    }
  } catch { /* invalid URL */ }
  return null;
};
const sourceUrl = "https://to7mg.notion.site/FAVVID-773335a7959c4a26b6bd933ea4f40249";
const cards = new Map();
for (const filename of readdirSync(uploadDir).filter((file) => file.startsWith("to7mg.notion.site_FAVVID-") && file.endsWith(".html"))) {
  const html = readFileSync(`${uploadDir}/${filename}`, "utf8");
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[1];
    const title = clean(match[2]);
    if (/^\/[A-Za-z0-9_-]+-[a-f0-9]{32}\?pvs=25$/i.test(href) && title.length >= 5) cards.set(href, title);
  }
}
const entries = [...cards].slice(0, Number(process.env.FAVVID_DETAIL_LIMIT || 300));
const fetchPage = async ([path, title]) => {
  const detailUrl = new URL(path, "https://to7mg.notion.site").toString();
  try {
    const response = await fetch(detailUrl, { signal: AbortSignal.timeout(20_000), headers: { "user-agent": "Mozilla/5.0 (compatible; IketeruEizouCollector/1.0)" } });
    if (!response.ok) return { detailUrl, title, status: response.status, videos: [] };
    const html = await response.text();
    const rawUrls = uniq([...html.matchAll(/https?:\\?\/\\?\/[^"'\s<>]*(?:youtube\.com|youtu\.be|vimeo\.com)[^"'\s<>]*/gi)].map((match) => match[0].replaceAll("\\/", "/")));
    const videos = rawUrls.map(getVideo).filter(Boolean);
    return { detailUrl, title, status: response.status, videos };
  } catch (error) { return { detailUrl, title, status: 0, error: error instanceof Error ? error.message : String(error), videos: [] }; }
};
const pages = [];
for (let index = 0; index < entries.length; index += 6) pages.push(...await Promise.all(entries.slice(index, index + 6).map(fetchPage)));
const rows = pages.flatMap((page) => page.videos.map((video) => ({ ...video, title: page.title, source: "favvid", sourceLabel: "FAVVID", sourceUrl: page.detailUrl, sourceUrls: [sourceUrl, page.detailUrl], productionName: "", sourceContext: "FAVVID公開Notionデータベースの個別ページに外部動画URLとして掲載" })));
const report = { generatedAt: new Date().toISOString(), cards: cards.size, detailPages: pages.length, detailPagesWithVideo: pages.filter((page) => page.videos.length).length, rows, pages };
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ cards: report.cards, detailPagesWithVideo: report.detailPagesWithVideo, candidateRows: rows.length }, null, 2));
