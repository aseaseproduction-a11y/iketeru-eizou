import { writeFile } from "node:fs/promises";

const checkedSourceIds = [
  "bb_navi",
  "douganow",
  "takashi_ohashi",
  "shirotaeisuke",
  "takerushima",
  "sgasakura",
  "maxilla",
  "wachajack",
];

const youtube = (sourceId, sourceUrl, id, title, products = [], genres = ["CM"], purposes = []) => ({
  sourceId,
  sourceUrl,
  title,
  platform: "youtube",
  id,
  videoUrl: `https://www.youtube.com/watch?v=${id}`,
  articleVerified: true,
  genres,
  products,
  purposes,
});

const vimeo = (sourceId, sourceUrl, id, title, products = [], genres = [], purposes = []) => ({
  sourceId,
  sourceUrl,
  title,
  platform: "vimeo",
  id,
  videoUrl: `https://vimeo.com/${id}`,
  articleVerified: true,
  genres,
  products,
  purposes,
});

const candidates = [
  // 動画NOW!!: individual articles explicitly show each canonical YouTube URL.
  youtube("douganow", "https://douganow.jp/archives/20260924527219.html", "sGS4I_W0dJk", "YOMIURI GIANTS SEASON SEAT「いっしょに熱狂すれば、仲間だ。_先輩・後輩篇」", ["YOMIURI GIANTS SEASON SEAT"]),
  youtube("douganow", "https://douganow.jp/archives/20260924527206.html", "ik5mPZbIwI4", "【ジョージア】「100人がカフェウォーター ブラックを飲んでみた」篇 15秒 横 GEORGIA", ["日本コカコーラ ジョージア"]),
  youtube("douganow", "https://douganow.jp/archives/20260924527191.html", "OSmAT68IhoU", "プチッと鍋 実演篇　プチッと炒飯　瀬戸康史", ["エバラ プチッと鍋"]),
  youtube("douganow", "https://douganow.jp/archives/20260924527178.html", "2Pr8xQ7LSvo", "キャンメイクCM「花咲かなのかさん篇」15秒", ["井田ラボラトリーズ キャンメイク"]),
  youtube("douganow", "https://douganow.jp/archives/20260924527178.html", "Yk-14JZQjPo", "キャンメイクCM「花咲かなのかさん篇」30秒", ["井田ラボラトリーズ キャンメイク"]),
  youtube("douganow", "https://douganow.jp/archives/20260924527178.html", "gedRoZr3VcQ", "キャンメイクCM「花咲かなのかさん篇」メイキング", ["井田ラボラトリーズ キャンメイク"]),
  youtube("douganow", "https://douganow.jp/archives/20260924527165.html", "ufYC_mc_7F0", "31 CM動画 パパ篇 30秒", ["チューリッヒ生命"]),
  youtube("douganow", "https://douganow.jp/archives/20260924527165.html", "fpIAbzh5Ql0", "34 CM動画 ママ篇 30秒", ["チューリッヒ生命"]),
  youtube("douganow", "https://douganow.jp/archives/20260924527165.html", "6qqEluntB1M", "37 CM動画 祖母篇 30秒", ["チューリッヒ生命"]),
  youtube("douganow", "https://douganow.jp/archives/20260924527152.html", "Tr50MVHWlF8", "山田涼介さん メイベリン ニューヨーク シャインビースト", ["メイベリン ニューヨーク"]),
  youtube("douganow", "https://douganow.jp/archives/20260923527137.html", "lvMcYm2LIdQ", "眼鏡市場 |ストレスフリー遠近「見やすっ」篇 15ｓ", ["眼鏡市場 ストレスフリー遠近"]),
  youtube("douganow", "https://douganow.jp/archives/20260923527137.html", "cddePm1brLI", "BEHIND THE SCENES | ストレスフリー遠近", ["眼鏡市場 ストレスフリー遠近"]),
  youtube("douganow", "https://douganow.jp/archives/20260923527137.html", "E1EzaMG-3nE", "SPECIAL FITTING | 吉岡里帆 & 滝藤賢一", ["眼鏡市場 ストレスフリー遠近"]),
  youtube("douganow", "https://douganow.jp/archives/20260922527122.html", "CXSg3r3yqrc", "『TOYOTAHOMEstay「トヨタの家」』篇 30秒", ["トヨタホーム"]),
  youtube("douganow", "https://douganow.jp/archives/20260922527122.html", "ULiGgpTq16k", "『TOYOTAHOMEstay「トヨタの家」』篇 60秒", ["トヨタホーム"]),
  youtube("douganow", "https://douganow.jp/archives/20260922527122.html", "Z_zy3Pp-Ejc", "「TOYOTAHOMEstay」CMメイキングムービー", ["トヨタホーム"]),
  youtube("douganow", "https://douganow.jp/archives/20260922527122.html", "pXKI4jvlLp0", "「TOYOTAHOMEstay」出演者インタビュー", ["トヨタホーム"]),
  youtube("douganow", "https://douganow.jp/archives/20260921527109.html", "r2RowYi7kfA", "湖池屋 金のポテト「バンド」篇 相葉雅紀さん・藤﨑ゆみあさん出演CM", ["湖池屋 金のポテト"]),
  youtube("douganow", "https://douganow.jp/archives/20260921527109.html", "37cUjNWMWfY", "湖池屋 金のポテト「実感 ポテトといえば」篇 相葉雅紀さん・藤﨑ゆみあさん出演CM", ["湖池屋 金のポテト"]),
  youtube("douganow", "https://douganow.jp/archives/20260921527095.html", "kbbq935MKVI", "パブロンSゴールドW TVCM「葛藤する親心」篇 15秒", ["大正製薬 パブロンSゴールドW"]),
  youtube("douganow", "https://douganow.jp/archives/20260921527095.html", "w2yRyaW3wW8", "パブロンSゴールドW TVCM「葛藤する親心」篇 30秒（秋）", ["大正製薬 パブロンSゴールドW"]),

  // Eisuke Shirota: the Commercial cards explicitly embed the Vimeo works.
  vimeo("shirotaeisuke", "https://shirotaeisuke.com/", "1211577422", "クレカ乗車 “みんながつながる”", ["クレカ乗車"], [], ["プロモーション"]),
  vimeo("shirotaeisuke", "https://shirotaeisuke.com/", "1211580290", "HäagenDazs “ROCKY CRUNCHY!”", ["HäagenDazs", "ROCKY CRUNCHY!"], [], ["プロモーション"]),
  vimeo("shirotaeisuke", "https://shirotaeisuke.com/", "1120357423", "Marosh “好きを信じるんだ”", ["Marosh"], [], ["プロモーション"]),
  vimeo("shirotaeisuke", "https://shirotaeisuke.com/", "1025113137", "ポケモンカードゲーム “超電ブレイカー”", ["ポケモンカードゲーム", "超電ブレイカー"], [], ["プロモーション"]),
  vimeo("shirotaeisuke", "https://shirotaeisuke.com/", "785226636", "リクルート “出会いってすごくないですか。”", ["リクルート"], [], ["プロモーション"]),
  vimeo("shirotaeisuke", "https://shirotaeisuke.com/", "962002040", "Mt.RAINIER “やさニュー”", ["Mt.RAINIER", "やさニュー"], [], ["プロモーション"]),
  vimeo("shirotaeisuke", "https://shirotaeisuke.com/", "308535994", "T.M.R.風 黒ガムテ巻き方講座", ["T.M.R."], [], ["プロモーション"]),
  vimeo("shirotaeisuke", "https://shirotaeisuke.com/", "395637186", "ANESSA Product Movie", ["ANESSA"], [], ["プロモーション"]),
  vimeo("shirotaeisuke", "https://shirotaeisuke.com/", "946475628", "medialuxe liquid foundation", ["medialuxe liquid foundation"], [], ["プロモーション"]),
  vimeo("shirotaeisuke", "https://shirotaeisuke.com/", "924310433", "medialuxe powder foundation", ["medialuxe powder foundation"], [], ["プロモーション"]),
  vimeo("shirotaeisuke", "https://shirotaeisuke.com/", "728734191", "SUZURI", ["SUZURI"], [], ["プロモーション"]),
  vimeo("shirotaeisuke", "https://shirotaeisuke.com/", "1120360297", "ポケモン言えるかな？ＢＷ", ["ポケモン言えるかな？ＢＷ"], [], ["プロモーション"]),
  vimeo("shirotaeisuke", "https://shirotaeisuke.com/", "298202444", "COMPACT GUARD “いけいけマツモト”", ["COMPACT GUARD", "いけいけマツモト"], [], ["プロモーション"]),
  vimeo("shirotaeisuke", "https://shirotaeisuke.com/", "288767275", "kurashiru “も、クラシル”", ["kurashiru", "も、クラシル"], [], ["プロモーション"]),
  vimeo("shirotaeisuke", "https://shirotaeisuke.com/", "946480291", "TOKYO Beta “Tokyo Better Life”", ["TOKYO Beta", "Tokyo Better Life"], [], ["プロモーション"]),
  vimeo("shirotaeisuke", "https://shirotaeisuke.com/", "468107351", "Curel", ["Curel"], [], ["プロモーション"]),
  vimeo("shirotaeisuke", "https://shirotaeisuke.com/", "416877234", "JR Green Attendant", ["JR Green Attendant"], [], ["プロモーション"]),
  vimeo("shirotaeisuke", "https://shirotaeisuke.com/", "577065675", "17LIVE", ["17LIVE"], [], ["プロモーション"]),
  vimeo("shirotaeisuke", "https://shirotaeisuke.com/", "339967162", "micho", ["micho"], [], ["プロモーション"]),
  vimeo("shirotaeisuke", "https://shirotaeisuke.com/", "385956998", "JEJUair", ["JEJUair"], [], ["プロモーション"]),

  // Takerushima: each individual work page explicitly embeds the canonical YouTube video.
  youtube("takerushima", "https://takerushima.com/16a2cccd25c9e4", "X7slwzXNhwg", "ハイドライバーズ", [], [], ["MV"]),
  youtube("takerushima", "https://takerushima.com/tettor", "aMdnFM0oAqg", "TETTOR", ["TETTOR 60mm F1.4 クラフトレンズ"], [], ["プロモーション"]),
  youtube("takerushima", "https://takerushima.com/kashika-02", "4srsrJ2lbdU", "KASHIKA_02 BOUNCE DANCE", [], [], ["MV"]),
  youtube("takerushima", "https://takerushima.com/d", "7Y-irzSTH3Y", "dアニメストアCM", ["dアニメストア"], [], ["プロモーション"]),
  youtube("takerushima", "https://takerushima.com/knr-popup-store", "aIsc4pNiUT4", "KNR POP UP STORE", ["KNR POP UP STORE"], [], ["プロモーション"]),

  // maxilla: two IONIQ 5 N embeds failed public oEmbed verification and are intentionally omitted.
  youtube("maxilla", "https://maxilla.jp/works/works/paradox-live-the-animation-op", "pqEG4PgdNIw", "Paradox Live THE ANIMATION OP", [], ["Anime"], ["OPED"]),
  youtube("maxilla", "https://maxilla.jp/works/works/tohji-aglio-e-olio", "MIBqS9kcDg0", "Tohji - Aglio e olio", [], ["Music Video"], ["MV"]),
  youtube("maxilla", "https://maxilla.jp/works/works/yama-%E3%83%91%E3%83%AC%E3%83%83%E3%83%88%E3%81%AF%E9%80%8F%E6%98%8E", "O4yzPf1oC6k", "yama - パレットは透明", [], ["Music Video"], ["MV"]),
  youtube("maxilla", "https://maxilla.jp/works/works/lucky-kilimanjaro-%E7%84%A1%E9%99%90%E3%81%95", "JLWOejLxVUQ", "Lucky Kilimanjaro - 無限さ", [], ["Music Video"], ["MV"]),
  youtube("maxilla", "https://maxilla.jp/works/works/sony-inzone-buds-and-inzone-h5", "KLLqZQnMprI", "Sony - INZONE Buds and INZONE H5", ["INZONE Buds", "INZONE H5"], [], ["プロモーション"]),
  youtube("maxilla", "https://maxilla.jp/works/works/sony-inzone-buds-and-inzone-h5", "cmqphEIn8xs", "Sony - INZONE Buds and INZONE H5", ["INZONE Buds", "INZONE H5"], [], ["プロモーション"]),
  youtube("maxilla", "https://maxilla.jp/works/works/25ans-harry-winston-sparkling-holic-starring-yui-aragaki", "vWrzZ6Y5rpc", "25ans × Harry Winston - Sparkling Holic starring Yui Aragaki", ["Harry Winston"], [], ["プロモーション"]),
  youtube("maxilla", "https://maxilla.jp/works/works/valorant-game-changers-japan-2023", "2vGlDQiBLd4", "VALORANT Game Changers Japan 2023", ["VALORANT"], ["Game / e-Sports"], ["ティザー"]),
  youtube("maxilla", "https://maxilla.jp/works/works/valorant-game-changers-japan-2023", "anNntfCVkE4", "VALORANT Game Changers Japan 2023", ["VALORANT"], ["Game / e-Sports"], ["ティザー"]),
  youtube("maxilla", "https://maxilla.jp/works/works/ayumu-imazu-run-for-you", "pl72zalxnq0", "Ayumu Imazu - RUN FOR YOU", [], ["Music Video"], ["MV"]),
  youtube("maxilla", "https://maxilla.jp/works/%E3%83%9D%E3%83%AB%E3%82%AB%E3%83%89%E3%83%83%E3%83%88%E3%82%B9%E3%83%86%E3%82%A3%E3%83%B3%E3%82%B0%E3%83%AC%E3%82%A4-%E3%82%B4%E3%83%BC%E3%82%B9%E3%83%88%E3%83%80%E3%82%A4%E3%83%96", "Xq9VPMuK3JQ", "ポルカドットスティングレイ - ゴーストダイブ", [], ["Music Video"], ["MV"]),
  youtube("maxilla", "https://maxilla.jp/works/magic-the-gathering-%E3%82%A8%E3%83%AB%E3%83%89%E3%83%AC%E3%82%A4%E3%83%B3%E3%81%AE%E6%A3%AE-anime-trailer", "hDm0hwnKm-Q", "MAGIC THE GATHERING - エルドレインの森 Anime Trailer", ["MAGIC THE GATHERING", "エルドレインの森"], ["Anime"], ["ティザー"]),
  youtube("maxilla", "https://maxilla.jp/works/works/yoasobi%E3%82%A2%E3%82%A4%E3%83%89%E3%83%AB-official-music-video-hikakin-ver", "ZTl-7yhRhzw", "YOASOBI「アイドル」 Official Music Video HIKAKIN Ver.", [], ["Music Video"], ["MV"]),
  youtube("maxilla", "https://maxilla.jp/works/%E3%83%88%E3%82%A5%E3%83%BC%E3%83%9C%E3%82%A8-%E5%A4%A9%E6%99%B4%E3%82%8C%E4%B9%BE%E6%9D%AF", "P6MTnRIvMYI", "TOOBOE - 天晴れ乾杯", [], ["Music Video"], ["MV"]),
];

const allowedPurposes = new Set(["MV", "ブランディングムービー", "プロモーション", "事業・サービス紹介", "OPED", "インタビュー", "ティザー", "アート", "企画系", "その他"]);
const invalidPurposeValues = candidates.flatMap(candidate => candidate.purposes.filter(purpose => !allowedPurposes.has(purpose)));
if (invalidPurposeValues.length) throw new Error(`Unexpected purpose values: ${invalidPurposeValues.join(", ")}`);
if (new Set(candidates.map(candidate => candidate.id)).size !== candidates.length) throw new Error("Candidate IDs must be unique");

await writeFile("/tmp/weekly_collection_candidates_20260924.json", JSON.stringify({ checkedSourceIds, candidates }, null, 2));
console.log(JSON.stringify({ checkedSourceIds, candidateCount: candidates.length, candidateIds: candidates.map(candidate => candidate.id) }, null, 2));
