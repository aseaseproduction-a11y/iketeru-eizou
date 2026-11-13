import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const research = JSON.parse(readFileSync("/home/ubuntu/research_existing_video_curation_notes_batch_3.json", "utf8"));
const outputPath = "/home/ubuntu/iketeru-eizou/analysis/curation_note_updates_existing_videos_batch3.sql";

const expected = new Map([
  ["ToqKNyZi2NQ", ["熱異常 / 25時、ナイトコードで。 × KAITO", "https://www.youtube.com/watch?v=ToqKNyZi2NQ"]],
  ["9y6MPi2tpFg", ["PLAY! MUSEUMどうぶつ展　アニメーション", "https://www.youtube.com/watch?v=9y6MPi2tpFg"]],
  ["40hxb3yJdUg", ["『LAZARUS ラザロ』Opening Movie(Short)｜「Vortex」Kamasi Washington", "https://www.youtube.com/watch?v=40hxb3yJdUg"]],
  ["DuMoY3ebBYY", ["折坂悠太 - ハチス (Official Music Video)", "https://www.youtube.com/watch?v=DuMoY3ebBYY"]],
  ["IniiUUdmXBU", ["TVアニメ「君は冥土様。」EDノンクレジット映像｜2024年10月5日（土）より好評放送中", "https://www.youtube.com/watch?v=IniiUUdmXBU"]],
  ["UxoqXIo82Xo", ["TVアニメ「小市民シリーズ」ノンクレジットED映像｜ammo「意解けない」", "https://www.youtube.com/watch?v=UxoqXIo82Xo"]],
  ["ope4Cvd7-u8", ["maya ongaku - Maybe Psychic (Official Music Video)", "https://www.youtube.com/watch?v=ope4Cvd7-u8"]],
  ["nKO8cTM9jrI", ["初星学園 「見て」Official Music Video (HATSUBOSHI GAKUEN - Face Me )", "https://www.youtube.com/watch?v=nKO8cTM9jrI"]],
  ["SJcnSAK-pak", ["OPENER（Prod. by YACA IN DA HOUSE） / KMNZ [Official Music Video]", "https://www.youtube.com/watch?v=SJcnSAK-pak"]],
  ["lq1oVyqSWec", ["How Many Boogie - Fuma no KTR × SKRYU × WAZGOGG (Cover) / KMNZ", "https://www.youtube.com/watch?v=lq1oVyqSWec"]],
  ["weThJ2lcLIo", ["どON - RIP SLYME (Cover) / KMNZ", "https://www.youtube.com/watch?v=weThJ2lcLIo&list=RDweThJ2lcLIo&start_radio=1"]],
  ["6tm60ECODsY", ["「ゲンバの星」コンセプトムービー60秒字幕付き", "https://www.youtube.com/watch?v=6tm60ECODsY"]],
  ["qiOna02AViI", ["２０２４ CM『Detail of レバテックフリーランス「言いづらい取引」』篇（４０秒 WEB CM ver.）字幕あり / レバテック", "https://www.youtube.com/watch?v=qiOna02AViI"]],
  ["vXldsUMNsq8", ["「ゲンバの星」作業風景ムービー3分", "https://www.youtube.com/watch?v=vXldsUMNsq8"]],
  ["fRsjv-JKyf8", ["『ホロライブ・オルタナティブ』 2ndティザーPV", "https://youtu.be/fRsjv-JKyf8?si=c9QqpfXr8R4DBtuz"]],
  ["Iy765B4fkmQ", ["オトノケ (Otonoke) / Creepy Nuts (covered by 矢車りね)【歌ってみた】", "https://www.youtube.com/watch?v=Iy765B4fkmQ"]],
]);

const officialHosts = new Set([
  "www.youtube.com", "youtube.com", "youtu.be", "pjsekai.sega.jp", "play2020.jp", "www.aniplex.co.jp",
  "shoshimin-anime.com", "gurugurubrain.space", "gakuen-label.idolmaster-official.jp", "x.com",
  "www.keiyogas.co.jp", "keiyogas.co.jp", "levtech.co.jp", "hololive.hololivepro.com",
]);
const overrides = {
  DuMoY3ebBYY: {
    purpose: "折坂悠太「ハチス」の公式ミュージックビデオを公開し、楽曲の世界観を視覚とともに届ける。",
    background: "公式YouTube動画以外の一次情報では、制作背景の詳細を本調査で確認できない。",
    evaluation: "公式の受賞歴や評価理由は本調査で確認できない。",
  },
};
const sqlEscape = (value) => String(value).replaceAll("\\", "\\\\").replaceAll("'", "\\'");

const updates = research.results.map(({ output }) => {
  if (!output?.verified || !expected.has(output.video_id)) return null;
  const [title, videoUrl] = expected.get(output.video_id);
  const sourceUrls = JSON.parse(output.source_urls_json).filter((url) => {
    try {
      return officialHosts.has(new URL(url).hostname);
    } catch {
      return false;
    }
  });
  if (!sourceUrls.length) throw new Error(`No official source URLs for ${output.video_id}`);
  const note = { ...(overrides[output.video_id] ?? output), sourceUrls };
  const curationNote = JSON.stringify({ purpose: note.purpose, background: note.background, evaluation: note.evaluation, sourceUrls: note.sourceUrls });
  return `UPDATE videos SET curationNote = '${sqlEscape(curationNote)}' WHERE id = '${sqlEscape(output.video_id)}' AND title = '${sqlEscape(title)}' AND videoUrl = '${sqlEscape(videoUrl)}';`;
}).filter(Boolean);

if (updates.length !== expected.size) throw new Error(`Expected ${expected.size} updates, received ${updates.length}`);
mkdirSync("/home/ubuntu/iketeru-eizou/analysis", { recursive: true });
writeFileSync(outputPath, `${updates.join("\n")}\n`);
console.log(JSON.stringify({ outputPath, updates: updates.length }, null, 2));
