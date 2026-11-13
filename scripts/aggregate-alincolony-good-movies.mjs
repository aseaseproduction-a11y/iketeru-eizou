import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const inputDir = "/home/ubuntu/iketeru-eizou/analysis/alincolony_good_movies/monthly";
const canonical = (value = "") => String(value).replace(/^http:\/\//i, "https://").replace(/^https:\/\/www\./i, "https://").replace(/\/$/, "");
const getPlatform = (videoUrl) => {
  const url = new URL(videoUrl);
  const host = url.hostname.toLowerCase();
  if (host.includes("youtu.be") || host.includes("youtube.com")) return "youtube";
  if (host.includes("vimeo.com")) return "vimeo";
  if (host.includes("twitter.com") || host.includes("x.com")) return "x";
  if (host.includes("tiktok.com")) return "tiktok";
  if (host.includes("instagram.com")) return "instagram";
  return "external";
};
const getId = (videoUrl, platform) => {
  const url = new URL(videoUrl);
  if (platform === "youtube") return url.hostname.includes("youtu.be") ? url.pathname.split("/").filter(Boolean).at(-1) : url.searchParams.get("v") || url.pathname.split("/").filter(Boolean).at(-1);
  if (platform === "vimeo") return url.pathname.split("/").filter(Boolean).at(-1);
  if (platform === "x") return `x-${url.pathname.match(/status\/(\d+)/)?.[1] || url.pathname.split("/").filter(Boolean).at(-1)}`;
  if (platform === "tiktok") return `tiktok-${url.pathname.match(/video\/(\d+)/)?.[1] || url.pathname.split("/").filter(Boolean).at(-1)}`;
  if (platform === "instagram") return `instagram-${url.pathname.split("/").filter(Boolean).at(-1)}`;
  return `url-${Buffer.from(canonical(videoUrl)).toString("base64url").slice(0, 52)}`;
};

const byUrl = new Map();
for (const filename of readdirSync(inputDir).filter((file) => file.endsWith(".json")).sort()) {
  const file = JSON.parse(readFileSync(`${inputDir}/${filename}`, "utf8"));
  const entries = Array.isArray(file.entries) ? file.entries : Array.isArray(file.entries?.entries) ? file.entries.entries : Array.isArray(file.entries?.videos) ? file.entries.videos : Array.isArray(file.entries?.items) ? file.entries.items : [];
  if (entries.length === 0) throw new Error(`No supported entry array in ${filename}`);
  for (const entry of entries) {
    if (!entry.video_url?.startsWith("http")) continue;
    const url = canonical(entry.video_url);
    const platform = getPlatform(url);
    const existing = byUrl.get(url);
    const row = existing || {
      id: getId(url, platform), platform, videoUrl: url, sourcePages: [], titles: [], contexts: [], source: "ALINCOLONY よかった映像まとめ",
    };
    if (!row.sourcePages.includes(entry.source_page_url)) row.sourcePages.push(entry.source_page_url);
    if (entry.title && !row.titles.includes(entry.title)) row.titles.push(entry.title);
    if (entry.context && !row.contexts.includes(entry.context)) row.contexts.push(entry.context);
    byUrl.set(url, row);
  }
}
const rows = Array.from(byUrl.values()).map((row) => ({ ...row, title: row.titles[0] || row.videoUrl, sourceUrls: row.sourcePages }));
const summary = rows.reduce((accumulator, row) => ({ ...accumulator, [row.platform]: (accumulator[row.platform] || 0) + 1 }), { total: rows.length });
writeFileSync("/home/ubuntu/iketeru-eizou/analysis/alincolony_good_movies/candidates.json", `${JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
