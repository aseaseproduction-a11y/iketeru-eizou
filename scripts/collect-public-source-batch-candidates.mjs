import { readFile, mkdir, writeFile } from "node:fs/promises";

const audit = JSON.parse(await readFile(new URL("../analysis/site_imports/public_sources_batch_20260819/initial_html_audit.json", import.meta.url), "utf8"));
const idOf = (url) => {
  const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([\w-]{11})/);
  if (yt) return { platform: "youtube", id: yt[1], url: `https://www.youtube.com/watch?v=${yt[1]}` };
  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo) return { platform: "vimeo", id: vimeo[1], url: `https://vimeo.com/${vimeo[1]}` };
  return null;
};

const sourceMeta = {
  bova: { sourceLabel: "BOVA", productionName: null },
  video_refs: { sourceLabel: "Video Refs", productionName: null },
  shirotaeisuke: { sourceLabel: "Eisuke Shirota 公式ポートフォリオ", productionName: "Eisuke Shirota" },
};

const seen = new Map();
for (const entry of audit.findings) {
  const meta = sourceMeta[entry.source];
  if (!meta) continue;
  for (const rawUrl of entry.videoUrls) {
    const parsed = idOf(rawUrl);
    if (!parsed) continue;
    const key = `${parsed.platform}:${parsed.id}`;
    const current = seen.get(key) || { ...parsed, source: entry.source, sourceLabel: meta.sourceLabel, productionName: meta.productionName, sourceUrls: [], sourceContext: [] };
    current.sourceUrls.push(entry.url);
    current.sourceContext.push({ source: entry.source, sourceUrl: entry.url, sourceLabel: meta.sourceLabel, productionName: meta.productionName });
    seen.set(key, current);
  }
}

const candidates = [...seen.values()].map((candidate) => ({ ...candidate, videoUrl: candidate.url, sourceUrl: candidate.sourceUrls[0] }));
const dir = new URL("../analysis/site_imports/public_sources_batch_20260819/", import.meta.url);
await mkdir(dir, { recursive: true });
await writeFile(new URL("official_video_candidates.json", dir), JSON.stringify({ generatedAt: new Date().toISOString(), rows: candidates, candidates }, null, 2));
console.log(JSON.stringify({ candidates: candidates.length, bySource: Object.fromEntries(Object.entries(candidates.reduce((acc, row) => { acc[row.source] = (acc[row.source] || 0) + 1; return acc; }, {})).sort()) }, null, 2));
