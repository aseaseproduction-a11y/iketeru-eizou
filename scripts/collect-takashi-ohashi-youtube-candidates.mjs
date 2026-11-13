import { mkdirSync, writeFileSync } from "node:fs";

const outputDir = "/home/ubuntu/iketeru-eizou/analysis/site_imports";
mkdirSync(outputDir, { recursive: true });
const outputPath = `${outputDir}/takashi_ohashi_youtube_candidates.json`;
const sourceUrl = "https://takashiohashi.com/";
const titles = [
  "機動戦士Gundam GQuuuuuuX - OPアニメーション",
  "吉田秀雄記念財団 コンセプトムービー",
  "よそ見トラベル - タイトルアニメーション",
  "詩のプラネタリウム",
  "DeNAxAI Day | DeNA TechCon2025 UTILIZATION",
  "MILLENNIUM PARADE - GOLDENWEEK & M4D LUV",
  "ストリートファイター × au コラボコンセプトムービー",
  "ポケモン feat. 初音ミク PROJECT VOLTAGE HIGEロゴモーション",
  "DeNA TechCon 2024 POLYPHONY",
  "見ることと気配、その間",
  "Postmates - This Is Your Brain on Food",
  "機動戦士ガンダム 水星の魔女 - エンディングアニメーション season2",
  "機動戦士ガンダム 水星の魔女 - エンディングアニメーション season1",
  "DeNA TechCon 2023 ACCELERATION",
  "in the blue shirt - Park with a Pond",
  "NHKみんなのうた - 月の踊り子",
  "映画 ハケンアニメ",
  "名取さな - モンダイナイトリッパー!",
  "Nike Juku",
  "DeNA TechCon 2022 Unlimited Expansion",
  "ChroNoiR × vaultroom",
  "SONY PARK - ONE DAY, 2050 / Sci-Fi Prototyping - 君か君か",
  "長谷川白紙 - ニュー園",
  "THE NORTH FACE Window",
  "あはれ！名作くん 6期ED",
  "最果タヒ展 - われわれはこの距離を守るべく生まれた 夜のために在る6等星なのです。",
  "リリシニウム・ビブリオラ",
  "DAOKO - ぼく",
  "長谷川白紙 -VJ",
  "花譜 - メルの黄昏(Live)",
  "花譜 - 戸惑いテレパシー(柊キライRemix)",
  "GIBIATE PROJECT LUMICA",
  "SPACE SHOWER TV STATION ID - Shapeshifter",
  "最果タヒ - 千年前の女性たちへとつながる言葉",
  "NHKみんなのうた - かむかもしかもにどもかも！",
  "フレデリック - フレデリズム2 全曲トレーラー",
  "BURNOUT SYNDROMES - 文學少女",
  "daisuke tanabe - cat step",
  "あはれ！名作くん 3期ED",
  "さよならポニーテール - 摩天楼と臨界点",
  "竹達彩奈 - OH MY シュガーフィーリング!!",
  "リポビタンD × banvox",
  "MTV IDENT",
  "西尾維新大辞展 - バトルシーン",
  "米津玄師 - 春雷 東京・国際フォーラム",
  "NHK土曜ドラマ - 4号警備",
  "妄想キャリブレーション - 激ヤバ∞ボッカーン！！",
  "Rez Infinite - Launch trailer",
  "Arts Council Tokyo - Zoning Tokyo",
  "BRDG022 - nakaniwa",
];
const normalize = (value = "") => String(value).toLowerCase().replace(/[\s\p{P}\p{S}_]+/gu, "");
const resembles = (left, right) => {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const shortest = a.length <= b.length ? a : b;
  return shortest.length >= 10 && (a.includes(shortest.slice(0, 14)) || b.includes(shortest.slice(0, 14)));
};
const key = process.env.YOUTUBE_API_KEY || "";
if (!key) throw new Error("YOUTUBE_API_KEY is required");
const rows = [];
for (const title of titles) {
  try {
    const endpoint = new URL("https://www.googleapis.com/youtube/v3/search");
    endpoint.searchParams.set("part", "snippet");
    endpoint.searchParams.set("type", "video");
    endpoint.searchParams.set("maxResults", "3");
    endpoint.searchParams.set("q", title);
    endpoint.searchParams.set("key", key);
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(15_000) });
    const data = response.ok ? await response.json() : { items: [] };
    const matched = (data.items || []).find((item) => item?.id?.videoId && resembles(title, item?.snippet?.title || ""));
    if (matched) rows.push({
      id: matched.id.videoId,
      platform: "youtube",
      videoUrl: `https://www.youtube.com/watch?v=${matched.id.videoId}`,
      title,
      source: "takashi_ohashi",
      sourceLabel: "Takashi Ohashi 公式ポートフォリオ",
      sourceUrl,
      sourceUrls: [sourceUrl],
      productionName: "Takashi Ohashi（Motion Designer / Movie Director）",
      sourceContext: "Takashi Ohashi公式ポートフォリオに掲載",
      searchTitle: matched.snippet.title,
    });
  } catch { /* hold: no query result is written only in summary */ }
}
writeFileSync(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), counts: { portfolioTitles: titles.length, matchedCandidates: rows.length }, rows }, null, 2)}\n`);
console.log(JSON.stringify({ portfolioTitles: titles.length, matchedCandidates: rows.length }, null, 2));
