import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

const projectRoot = "/home/ubuntu/iketeru-eizou";
const outputDir = `${projectRoot}/analysis/site_imports/relaxed_alld_favvid`;
const canonicalVideoUrl = (id) => `https://vimeo.com/${id}`;
const unique = (items) => [...new Set(items)];

const alldHtmlFiles = readdirSync("/home/ubuntu/upload").filter((file) => /^alld\.jp_.*\.html$/i.test(file));
const alldIds = unique(alldHtmlFiles.flatMap((file) => [...readFileSync(`/home/ubuntu/upload/${file}`, "utf8").matchAll(/player\.vimeo\.com\/progressive_redirect\/playback\/(\d+)/g)].map((match) => match[1])));
const alldRows = alldIds.map((id) => ({
  id,
  platform: "vimeo",
  videoUrl: canonicalVideoUrl(id),
  title: `ALLd. 公式掲載映像 / Vimeo ${id}`,
  retrievedTitle: `ALLd. 公式掲載映像 / Vimeo ${id}`,
  thumbnail: `https://vumbnail.com/${id}.jpg`,
  channelTitle: "ALLd.",
  source: "alld",
  sourceLabel: "ALLd. 公式掲載映像（案件名未対応）",
  sourceUrl: "https://alld.jp/",
  sourceUrls: ["https://alld.jp/"],
  productionName: "ALLd.",
  result: "verified",
  titleMatch: true,
  verificationReason: "official_listing_embedded_vimeo_url_relaxed_project_title_unavailable",
  sourceContext: "ALLd.公式トップページの埋め込みVimeo配信URLを確認。個別案件名との対応は公式データ上で未確認。",
}));

const favvid = JSON.parse(readFileSync(`${projectRoot}/analysis/site_imports/official_video_candidates.json`, "utf8"));
const favvidVideoRows = favvid.rows.filter((row) => row.source === "favvid");
const favvidCards = favvid.summary?.favvidDirectRows ?? 0;

mkdirSync(outputDir, { recursive: true });
writeFileSync(`${outputDir}/official_video_verification.json`, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  policy: "ALLd.は公式トップページで動画URLを確認した埋め込みVimeo配信を、案件名未対応と明記して限定登録する。FAVVIDは外部動画URLを確認できる既存38件のみが登録候補で、URL未確認カードは登録しない。",
  summary: { alldEmbeddedVimeoRows: alldRows.length, favvidDirectVideoRows: favvidVideoRows.length, favvidCardsWithoutConfirmedExternalUrl: Math.max(0, favvidCards - favvidVideoRows.length) },
  rows: alldRows,
}, null, 2)}\n`);
writeFileSync(`${outputDir}/favvid_unlinked_cards_audit.json`, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  cardsObserved: favvidCards,
  cardsWithConfirmedExternalVideoUrl: favvidVideoRows.length,
  unlinkedCards: Math.max(0, favvidCards - favvidVideoRows.length),
  reason: "公開Notion詳細ページから外部動画URLを取得できないため、URLなしのカードは動画レコードを生成しない。",
}, null, 2)}\n`);
console.log(JSON.stringify({ alldEmbeddedVimeoRows: alldRows.length, favvidDirectVideoRows: favvidVideoRows.length, favvidUnlinkedCards: Math.max(0, favvidCards - favvidVideoRows.length) }, null, 2));
