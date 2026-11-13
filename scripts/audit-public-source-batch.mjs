import { mkdir, writeFile } from "node:fs/promises";

const sites = [
  ["bb_navi", "https://www.bb-navi.com/cm-douga/index-news.html"],
  ["bova", "https://awardg.sendenkaigi.com/bova"],
  ["karekitsune_vimeo", "https://vimeo.com/karekitsune/likes"],
  ["creshore", "https://creshore.jp/home#/"],
  ["video_refs", "https://video-refs.com/"],
  ["douganow", "https://douganow.jp/"],
  ["one_media", "https://www.onemedia.jp/"],
  ...["s21cf", "stwNM", "5floC", "WoA4q", "XZP5b", "ZBmfR", "q7U1A", "yB7jA", "kov7h", "3UQCi", "eSrYD", "pC5a6", "cfFvX"].map((id) => [`reclike_${id}`, `https://reclike.com/l/${id}`]),
  ["taker_vimeo", "https://vimeo.com/taker/likes"],
  ["user10086421_vimeo", "https://vimeo.com/user10086421/likes"],
  ["shirotaeisuke", "https://shirotaeisuke.com/"],
  ["shirotaeisuke_vimeo", "https://vimeo.com/shirotaeisuke/likes"],
  ["cubezeero_vimeo", "https://vimeo.com/cubezeero/likes"],
  ["tkmk_vimeo", "https://vimeo.com/tkmk/likes"],
];

const URL_RE = /https?:\\?\/\\?[^"'\s<>\\]+|https?:\/\/[^"'\s<>]+/gi;
const decode = (value) => value.replaceAll("\\/", "/").replaceAll("&amp;", "&").replaceAll("\\u0026", "&");
const externalVideos = (html) => [...new Set((html.match(URL_RE) || []).map(decode).filter((url) => /(?:youtu\.be\/|youtube\.com\/(?:watch|embed)|vimeo\.com\/(?:\d+|video\/\d+))/.test(url)))];
const titleOf = (html) => (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1] || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim();

const findings = [];
for (const [source, url] of sites) {
  const started = Date.now();
  try {
    const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; iketeru-eizou/1.0)" }, signal: AbortSignal.timeout(20_000) });
    const html = await response.text();
    const videos = externalVideos(html);
    findings.push({ source, url, status: response.status, title: titleOf(html), htmlBytes: html.length, videoUrls: videos, loginHint: /login|ログイン|sign in/i.test(html), elapsedMs: Date.now() - started });
  } catch (error) {
    findings.push({ source, url, status: null, title: "", htmlBytes: 0, videoUrls: [], loginHint: false, error: String(error), elapsedMs: Date.now() - started });
  }
}

const dir = new URL("../analysis/site_imports/public_sources_batch_20260819/", import.meta.url);
await mkdir(dir, { recursive: true });
await writeFile(new URL("initial_html_audit.json", dir), JSON.stringify({ generatedAt: new Date().toISOString(), total: findings.length, findings }, null, 2));
console.log(JSON.stringify({ total: findings.length, reachable: findings.filter((entry) => entry.status && entry.status < 400).length, directVideoUrls: findings.reduce((total, entry) => total + entry.videoUrls.length, 0) }, null, 2));
