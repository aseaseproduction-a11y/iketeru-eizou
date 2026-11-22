import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const REPO_ROOT = "E:\\iketeru-eizou";
const envText = fs.readFileSync(path.join(REPO_ROOT, ".env"), "utf8").replace(/^\uFEFF/, "");
const dbUrl = envText.match(/^DATABASE_URL=(.+)$/m)[1].trim();

// Curated & externally verified benchmark specification
const SPECS = [
  // ========================
  // 1. CM (TV CM / Web CM / Branded Film)
  // ========================
  {
    id: "1154382470",
    genre_bucket: "CM",
    tier_bucket: "上位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "S+",
    objective_band: [97, 100],
    evidence_level: "tier1_global_grand_prix",
    awards: [
      { name: "Cannes Lions", year: "2025", category: "Entertainment Lions Grand Prix", sourceUrl: "https://www.canneslions.com/news/cannes-lions-announces-2025-winners-across-entertainment-and-craft-tracks" },
      { name: "Spikes Asia", year: "2025", category: "Film Grand Prix", sourceUrl: "https://www.spikes.asia/news/spikes-asia-announces-its-2025-winners" }
    ],
    rationale: "世界最高峰アワード最高賞（Cannes Lions Grand Prix / Spikes Asia Film Grand Prix）"
  },
  {
    id: "Z_lbVlhO9HE",
    genre_bucket: "CM",
    tier_bucket: "上位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "S+",
    objective_band: [97, 100],
    evidence_level: "tier1_global_grand_prix",
    awards: [
      { name: "D&AD Awards", year: "2025", category: "Black Pencil", sourceUrl: "https://www.dandad.org/work/annual" }
    ],
    rationale: "世界最高峰アワード最高賞（D&AD Black Pencil）"
  },
  {
    id: "5wEjV2ekSwE",
    genre_bucket: "CM",
    tier_bucket: "上位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "S",
    objective_band: [93, 96],
    evidence_level: "tier1_global_craft_gold",
    awards: [
      { name: "D&AD Awards", year: "2014", category: "Yellow Pencil (TV & Cinema Commercials / Animation)", sourceUrl: "https://www.dandad.org/awards/professional/2014/" },
      { name: "Cannes Lions", year: "2014", category: "Film Craft Silver Lion (Visual Effects / Sound Design)", sourceUrl: "https://www.canneslions.com/" },
      { name: "British Arrows", year: "2014", category: "Gold (Best Animation / Best Over 90s Cinema Commercial)", sourceUrl: "https://www.britisharrows.com/" }
    ],
    rationale: "国際クラフト賞金賞・Yellow Pencil受賞作（Honda 'Hands'）"
  },
  {
    id: "vpyeQeTDGFA",
    genre_bucket: "CM",
    tier_bucket: "上位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "S",
    objective_band: [93, 96],
    evidence_level: "tier1_global_craft_gold",
    awards: [
      { name: "Cannes Lions", year: "2016", category: "Design Gold Lion & Film Craft Silver Lion (Animation) / Bronze (Sound Design)", sourceUrl: "https://www.canneslions.com/" },
      { name: "The One Show", year: "2016", category: "Gold Pencil (Animation)", sourceUrl: "https://www.oneclub.org/awards/theoneshow/" },
      { name: "AICP Show", year: "2016", category: "Winner (Animation)", sourceUrl: "https://www.aicpshow.com/" },
      { name: "Clio Awards", year: "2016", category: "Gold (Film Technique - Animation)", sourceUrl: "https://clios.com/" },
      { name: "D&AD Awards", year: "2016", category: "Graphite Pencil (Film Advertising Crafts - Animation)", sourceUrl: "https://www.dandad.org/awards/professional/2016/" }
    ],
    rationale: "Cannes・One Show・AICP・Clio・D&ADの国際クラフト主要賞を総なめにしたストップモーションCM（Honda 'Paper' by PES）"
  },
  {
    id: "FNQ4vqB-waw",
    genre_bucket: "CM",
    tier_bucket: "上位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "S",
    objective_band: [93, 96],
    evidence_level: "tier1_global_craft_gold",
    awards: [
      { name: "Cannes Lions", year: "2023", category: "Film Craft Gold Lion (Production Design/Art Direction, Achievement in Production) & Bronze (VFX)", sourceUrl: "https://www.canneslions.com/" },
      { name: "Spikes Asia", year: "2024", category: "Film Craft Silver & Bronze", sourceUrl: "https://www.spikes.asia/" },
      { name: "ACC TOKYO CREATIVITY AWARDS", year: "2023", category: "Film Craft Gold", sourceUrl: "https://www.acc-awards.com/" }
    ],
    rationale: "Cannes Lions 2023 Film Craft Gold（美術・プロダクション達成）＆Spikes Asia・ACCクラフト受賞作（相鉄「父と娘の風景」）"
  },
  {
    id: "tdQCMuaJUQk",
    genre_bucket: "CM",
    tier_bucket: "上位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "S-",
    objective_band: [90, 92],
    evidence_level: "tier2_national_grand_prix",
    awards: [
      { name: "BOVA 宣伝会議", year: "2026", category: "グランプリ", sourceUrl: "https://awardg.sendenkaigi.com/bova/history/13th" }
    ],
    rationale: "国内主要アワード最高賞（BOVA 2026 グランプリ）"
  },
  {
    id: "DwIur8FBRxw",
    genre_bucket: "CM",
    tier_bucket: "上位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "S-",
    objective_band: [90, 92],
    evidence_level: "tier2_national_grand_prix",
    awards: [
      { name: "YouTube Works Awards Japan", year: "2024", category: "Grand Prix / Creative Effectiveness", sourceUrl: "https://business.google.com/jp/think/search-and-video/youtubeworks-2024-1/" }
    ],
    rationale: "国内主要アワード最高賞（YouTube Works Awards Japan 2024 グランプリ）"
  },
  // CM 中位
  {
    id: "iIL_CB_YjFk",
    genre_bucket: "CM",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "A+",
    objective_band: [86, 89],
    evidence_level: "tier2_global_craft_bronze",
    awards: [
      { name: "Cannes Lions", year: "2026", category: "Film Craft Bronze Lion (Animation)", sourceUrl: "https://www.canneslions.com/" },
      { name: "shots Awards Asia Pacific", year: "2026", category: "Gold (Animation - Stop-motion)", sourceUrl: "https://www.shotsawards.com/" }
    ],
    rationale: "Cannes Lions 2026 Film Craft Bronze（Animation）＆shots Awards APAC Gold受賞作（講談社 LIGHT HOLE）"
  },
  {
    id: "JFDm4p8T6_4",
    genre_bucket: "CM",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "A+",
    objective_band: [86, 89],
    evidence_level: "tier3_national_gold",
    awards: [
      { name: "BOVA 宣伝会議", year: "2025", category: "ゴールド", sourceUrl: "https://awardg.sendenkaigi.com/bova/history/12th" }
    ],
    rationale: "国内主要アワード金賞（第12回BOVAゴールド）"
  },
  {
    id: "wXD33Jx25oI",
    genre_bucket: "CM",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "A+",
    objective_band: [86, 89],
    evidence_level: "tier3_national_gold",
    awards: [
      { name: "BOVA 宣伝会議", year: "2026", category: "ゴールド", sourceUrl: "https://awardg.sendenkaigi.com/bova/history/13th" }
    ],
    rationale: "国内主要アワード金賞（第13回BOVAゴールド）"
  },
  {
    id: "dnCDa1spOG0",
    genre_bucket: "CM",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "shortlist_or_selection",
    objective_tier: "A",
    objective_band: [82, 85],
    evidence_level: "tier4_global_shortlist",
    awards: [
      { name: "Ciclope Asia Pacific", year: "2024", category: "Finalist (Shortlist)", sourceUrl: "https://www.ciclopefestival.com/" }
    ],
    rationale: "国際クラフト専門賞ファイナリスト（Ciclope Asia Pacific 2024 Finalist＝受賞の1ランク下）"
  },
  {
    id: "3oVZsslXScc",
    genre_bucket: "CM",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "shortlist_or_selection",
    objective_tier: "A",
    objective_band: [82, 85],
    evidence_level: "tier4_national_jury_selection",
    awards: [
      { name: "文化庁メディア芸術祭", year: "2017", category: "第20回 エンターテインメント部門 審査委員会推薦作品", sourceUrl: "https://archive.j-mediaarts.jp/" }
    ],
    rationale: "第20回文化庁メディア芸術祭 審査委員会推薦作品（受賞作の1ランク下・公式選出）"
  },
  {
    id: "FSqTqdjf2YQ",
    genre_bucket: "CM",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "A",
    objective_band: [82, 85],
    evidence_level: "tier4_national_silver",
    awards: [
      { name: "BOVA 宣伝会議", year: "2025", category: "シルバー", sourceUrl: "https://awardg.sendenkaigi.com/bova/history/12th" }
    ],
    rationale: "国内主要アワード銀賞（第12回BOVAシルバー）"
  },
  {
    id: "iXTuYbyH2Rc",
    genre_bucket: "CM",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "A",
    objective_band: [82, 85],
    evidence_level: "tier4_national_silver",
    awards: [
      { name: "BOVA 宣伝会議", year: "2026", category: "シルバー", sourceUrl: "https://awardg.sendenkaigi.com/bova/history/13th" }
    ],
    rationale: "国内主要アワード銀賞（第13回BOVAシルバー）"
  },
  {
    id: "-J7Oi1-EfG8",
    genre_bucket: "CM",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "A-",
    objective_band: [78, 81],
    evidence_level: "tier5_curated_or_merit",
    awards: [
      { name: "BOVA 宣伝会議", year: "2026", category: "協賛企業賞", sourceUrl: "https://awardg.sendenkaigi.com/bova/history/13th" }
    ],
    rationale: "国内広告動画コンテスト協賛企業賞（第13回BOVA）"
  },
  // CM 下位 (非受賞商用CM: B+ / B / B- / C+ / C / C-)
  {
    id: "-9ljRYIEWfU",
    genre_bucket: "CM",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "B+",
    objective_band: [73, 77],
    evidence_level: "baseline_commercial_high",
    awards: [],
    rationale: "非受賞・高品質商用TVCM（アサヒスーパードライ新CM）"
  },
  {
    id: "1FhTNSG_Ri4",
    genre_bucket: "CM",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "B+",
    objective_band: [73, 77],
    evidence_level: "baseline_commercial_high",
    awards: [],
    rationale: "非受賞・高品質商用Web CM（ANESSA）"
  },
  {
    id: "2KS4Q6Bjgq8",
    genre_bucket: "CM",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "B",
    objective_band: [68, 72],
    evidence_level: "baseline_commercial_standard",
    awards: [],
    rationale: "非受賞・標準商用TVCM（AOKI フレッシャーズ）"
  },
  {
    id: "_7lQGv4ZmBo",
    genre_bucket: "CM",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "B-",
    objective_band: [63, 67],
    evidence_level: "baseline_commercial_basic",
    awards: [],
    rationale: "非受賞・定型商用TVCM（ブックオフ最新CM 2025）"
  },
  {
    id: "6sB9ovZbSOQ",
    genre_bucket: "CM",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "B-",
    objective_band: [63, 67],
    evidence_level: "baseline_commercial_basic",
    awards: [],
    rationale: "非受賞・定型商品紹介Web CM（山崎製パン 中華まん）"
  },
  {
    id: "A-9c7OdQMFc",
    genre_bucket: "CM",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "C+",
    objective_band: [57, 62],
    evidence_level: "baseline_simple_commercial",
    awards: [],
    rationale: "非受賞・簡易ローカルWeb CM（夢・桃中軒牛右衛門）"
  },
  {
    id: "_9cGKFO4mm8",
    genre_bucket: "CM",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "C",
    objective_band: [51, 56],
    evidence_level: "baseline_amateur",
    awards: [],
    rationale: "非受賞・タレント告知クリップ型CM記事動画（チョコラBB）"
  },
  {
    id: "jhAx4_YDLIE",
    genre_bucket: "CM",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "C-",
    objective_band: [45, 50],
    evidence_level: "baseline_low_amateur",
    awards: [],
    rationale: "非受賞・レトロ簡易CMアーカイブ低解像度動画"
  },

  // ========================
  // 2. MV (Music Video)
  // ========================
  {
    id: "5URefVYaJrA",
    genre_bucket: "MV",
    tier_bucket: "上位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "S+",
    objective_band: [97, 100],
    evidence_level: "tier1_global_grand_prix",
    awards: [
      { name: "D&AD Awards", year: "2025", category: "Black Pencil (Music Videos)", sourceUrl: "https://www.dandad.org/work/annual" }
    ],
    rationale: "世界最高峰アワード最高賞（D&AD 2025 Black Pencil — A$AP Rocky 'Tailor Swif'）"
  },
  {
    id: "tvTRZJ-4EyI",
    genre_bucket: "MV",
    tier_bucket: "上位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "S",
    objective_band: [93, 96],
    evidence_level: "tier1_global_mv_winner",
    awards: [
      { name: "MTV Video Music Awards", year: "2017", category: "Video of the Year / Best Direction / Best Cinematography / Best Art Direction / Best Visual Effects", sourceUrl: "https://www.mtv.com/vma" },
      { name: "UK Music Video Awards", year: "2017", category: "Best Urban Video - International", sourceUrl: "https://www.ukmva.com/" },
      { name: "D&AD Awards", year: "2018", category: "Graphite Pencil (Music Videos)", sourceUrl: "https://www.dandad.org/awards/professional/2018/" }
    ],
    rationale: "MTV VMA 2017主要クラフト部門独占＆UKMVA・D&AD受賞の歴史的MV（Kendrick Lamar 'HUMBLE.'）"
  },
  {
    id: "ebzEEEdjHj0",
    genre_bucket: "MV",
    tier_bucket: "上位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "S-",
    objective_band: [90, 92],
    evidence_level: "tier1_global_mv_craft",
    awards: [
      { name: "UK Music Video Awards", year: "2017", category: "Best Director / Best Dance Video / Best Production Design", sourceUrl: "https://www.ukmva.com/" },
      { name: "D&AD Awards", year: "2017", category: "Wood Pencil (Production Design for Music Videos)", sourceUrl: "https://www.dandad.org/awards/professional/2017/" }
    ],
    rationale: "UKMVA 2017監督賞・美術賞ほか3冠＆D&AD Wood Pencil受賞MV（Bonobo 'No Reason'）"
  },
  // MV 中位
  {
    id: "5zj3aHgLFQE",
    genre_bucket: "MV",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "shortlist_or_selection",
    objective_tier: "A+",
    objective_band: [86, 89],
    evidence_level: "tier3_global_festival_selection",
    awards: [
      { name: "Annecy International Animation Film Festival", year: "2015", category: "Official Selection (Commissioned Films)", sourceUrl: "https://www.annecyfestival.com/" },
      { name: "文化庁メディア芸術祭", year: "2014", category: "第18回 アニメーション部門 審査委員会推薦作品", sourceUrl: "https://archive.j-mediaarts.jp/" }
    ],
    rationale: "アヌシー国際アニメーション映画祭2015公式選出＆文化庁メディア芸術祭推薦作品（トクマルシューゴ 'Poker'）"
  },
  {
    id: "3JtO1WMYb58",
    genre_bucket: "MV",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "shortlist_or_selection",
    objective_tier: "A",
    objective_band: [82, 85],
    evidence_level: "tier4_national_jury_selection",
    awards: [
      { name: "文化庁メディア芸術祭", year: "2019", category: "第22回 エンターテインメント部門 審査委員会推薦作品", sourceUrl: "https://archive.j-mediaarts.jp/" }
    ],
    rationale: "第22回文化庁メディア芸術祭 審査委員会推薦作品（Frasco 'Viewtiful'）"
  },
  {
    id: "QmLBz4FuVDA",
    genre_bucket: "MV",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "shortlist_or_selection",
    objective_tier: "A",
    objective_band: [82, 85],
    evidence_level: "tier4_national_jury_selection",
    awards: [
      { name: "文化庁メディア芸術祭", year: "2019", category: "第22回 エンターテインメント部門 審査委員会推薦作品", sourceUrl: "https://archive.j-mediaarts.jp/" }
    ],
    rationale: "第22回文化庁メディア芸術祭 審査委員会推薦作品（INNOSENT in FORMAL 'Footloose'）"
  },
  {
    id: "_2JRv0n6w4g",
    genre_bucket: "MV",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "shortlist_or_selection",
    objective_tier: "A-",
    objective_band: [78, 81],
    evidence_level: "tier5_eizo100_curated",
    awards: [
      { name: "映像作家100人", year: "2021", category: "2021選出作品", sourceUrl: "https://eizo100.jp/" }
    ],
    rationale: "国内プロキュレーション選出MV（映像作家100人 2021）"
  },
  {
    id: "_ESKiygZh9Y",
    genre_bucket: "MV",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "shortlist_or_selection",
    objective_tier: "A-",
    objective_band: [78, 81],
    evidence_level: "tier5_eizo100_curated",
    awards: [
      { name: "映像作家100人", year: "2023", category: "2023選出作品", sourceUrl: "https://eizo100.jp/" }
    ],
    rationale: "国内プロキュレーション選出MV（映像作家100人 2023）"
  },
  {
    id: "Ula15c4UN4s",
    genre_bucket: "MV",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "shortlist_or_selection",
    objective_tier: "A-",
    objective_band: [78, 81],
    evidence_level: "tier5_eizo100_curated",
    awards: [
      { name: "映像作家100人", year: "2018", category: "2018選出作品", sourceUrl: "https://eizo100.jp/video/6499" }
    ],
    rationale: "国内プロキュレーション選出MV（映像作家100人 2018 — Suchmos 'A.G.I.T.'）"
  },
  // MV 下位 (非受賞商用MV: B+ / B / B- / C+ / C / C-)
  {
    id: "-n1ljTOQK-s",
    genre_bucket: "MV",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "B+",
    objective_band: [73, 77],
    evidence_level: "baseline_commercial_high",
    awards: [],
    rationale: "非受賞・高品質商用アイドルMV（僕が見たかった青空）"
  },
  {
    id: "_C7k63knGz8",
    genre_bucket: "MV",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "B+",
    objective_band: [73, 77],
    evidence_level: "baseline_commercial_high",
    awards: [],
    rationale: "非受賞・高品質商用MV（XOX 'PINKY BABY'）"
  },
  {
    id: "-J3OnxCEzl0",
    genre_bucket: "MV",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "B",
    objective_band: [68, 72],
    evidence_level: "baseline_commercial_standard",
    awards: [],
    rationale: "非受賞・標準商用MV（上水流宇宙 'ZeroGravity'）"
  },
  {
    id: "_2lHuvAwhwk",
    genre_bucket: "MV",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "B",
    objective_band: [68, 72],
    evidence_level: "baseline_commercial_standard",
    awards: [],
    rationale: "非受賞・標準インディーズMV（R BANDIT X MR RIGHT）"
  },
  {
    id: "7ErE0YPc_PY",
    genre_bucket: "MV",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "B-",
    objective_band: [63, 67],
    evidence_level: "baseline_commercial_basic",
    awards: [],
    rationale: "非受賞・定型低予算MV（Lil Eazzyy 'IM GOOD'）"
  },
  {
    id: "C0RD172wK6c",
    genre_bucket: "MV",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "C+",
    objective_band: [57, 62],
    evidence_level: "baseline_simple_commercial",
    awards: [],
    rationale: "非受賞・簡易撮影MV（Marko Sosa 'The Truth'）"
  },
  {
    id: "Dhx2EIhYkc0",
    genre_bucket: "MV",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "C",
    objective_band: [51, 56],
    evidence_level: "baseline_amateur",
    awards: [],
    rationale: "非受賞・ワンロケ簡易アマチュアMV（ASIRA）"
  },
  {
    id: "DMowlj44nZc",
    genre_bucket: "MV",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "C-",
    objective_band: [45, 50],
    evidence_level: "baseline_low_amateur",
    awards: [],
    rationale: "非受賞・簡易静止画スライド寄りMV"
  },

  // ========================
  // 3. モーション (Motion Graphics / Title Design / Showreel)
  // ========================
  {
    id: "1119375393",
    genre_bucket: "モーション",
    tier_bucket: "上位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "S-",
    objective_band: [90, 92],
    evidence_level: "tier2_global_motion_curation",
    awards: [
      { name: "Stash Permanent Collection", year: "2025", category: "Permanent Collection Featured (OFFF MX 2025 Main Titles by XK Studio)", sourceUrl: "https://www.stashmedia.tv/" }
    ],
    rationale: "国際モーションデザイン祭典OFFF Mexico 2025公式メインタイトル＆Stash Permanent Collection収録作（XK Studio）"
  },
  {
    id: "1225708698",
    genre_bucket: "モーション",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "A+",
    objective_band: [86, 89],
    evidence_level: "tier3_vimeo_staff_pick",
    awards: [
      { name: "Vimeo Staff Picks", year: "2025", category: "Vimeo Staff Pick", sourceUrl: "https://vimeo.com/channels/staffpicks" },
      { name: "SXSW Film Festival", year: "2025", category: "Official Selection (Short Film)", sourceUrl: "https://www.sxsw.com/" }
    ],
    rationale: "Vimeo Staff Pick公式選出＋Sundance/SXSW選出（STAIRS）"
  },
  {
    id: "1231004615",
    genre_bucket: "モーション",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "A+",
    objective_band: [86, 89],
    evidence_level: "tier3_vimeo_staff_pick",
    awards: [
      { name: "Vimeo Staff Picks", year: "2025", category: "Vimeo Staff Pick", sourceUrl: "https://vimeo.com/channels/staffpicks" }
    ],
    rationale: "Vimeo Staff Pick公式選出（Paradise Man (ii) — 3D/GIF実験的モーション作品）"
  },
  {
    id: "_5XZMPbbJIk",
    genre_bucket: "モーション",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "shortlist_or_selection",
    objective_tier: "A-",
    objective_band: [78, 81],
    evidence_level: "tier5_eizo100_curated",
    awards: [
      { name: "映像作家100人", year: "2025", category: "2025選出作品", sourceUrl: "https://eizo100.jp/" }
    ],
    rationale: "国内プロキュレーション選出モーション作品（映像作家100人 2025）"
  },
  {
    id: "_H6zuJAtQqI",
    genre_bucket: "モーション",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "shortlist_or_selection",
    objective_tier: "A-",
    objective_band: [78, 81],
    evidence_level: "tier5_eizo100_curated",
    awards: [
      { name: "映像作家100人", year: "2022", category: "2022選出作品", sourceUrl: "https://eizo100.jp/" }
    ],
    rationale: "国内プロキュレーション選出タイポ・モーション作品（映像作家100人 2022）"
  },
  {
    id: "6BnK1seS024",
    genre_bucket: "モーション",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "shortlist_or_selection",
    objective_tier: "A-",
    objective_band: [78, 81],
    evidence_level: "tier5_eizo100_curated",
    awards: [
      { name: "映像作家100人", year: "2022", category: "掲載作品（Kaito Note「Sprechchor」）", sourceUrl: "https://eizo100.jp/" }
    ],
    rationale: "国内プロキュレーション掲載タイポグラフィ・モーション作品（Sprechchor）"
  },
  // モーション 下位 (非受賞: B+ / B / C+ / C / C-)
  {
    id: "bGcpESkGLzI",
    genre_bucket: "モーション",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "B+",
    objective_band: [73, 77],
    evidence_level: "baseline_commercial_high",
    awards: [],
    rationale: "非受賞・高品質モーショングラフィックス（空間響図学）"
  },
  {
    id: "3910Da5fk7k",
    genre_bucket: "モーション",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "B+",
    objective_band: [73, 77],
    evidence_level: "baseline_commercial_high",
    awards: [],
    rationale: "非受賞・高品質モーショングラフィックス（Voscot）"
  },
  {
    id: "1048567039",
    genre_bucket: "モーション",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "B",
    objective_band: [68, 72],
    evidence_level: "baseline_commercial_standard",
    awards: [],
    rationale: "非受賞・標準モーションデモリール（TAK 2024）"
  },
  {
    id: "CmCxoqpSAk8",
    genre_bucket: "モーション",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "B",
    objective_band: [68, 72],
    evidence_level: "baseline_commercial_standard",
    awards: [],
    rationale: "非受賞・標準モーショングラフィックス（Nihe - New icon）"
  },
  {
    id: "_q9xyoz4j0k",
    genre_bucket: "モーション",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "C+",
    objective_band: [57, 62],
    evidence_level: "baseline_simple_commercial",
    awards: [],
    rationale: "非受賞・テンプレート型イベント告知イントロ"
  },
  {
    id: "45N5d4IbeKo",
    genre_bucket: "モーション",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "C+",
    objective_band: [57, 62],
    evidence_level: "baseline_simple_commercial",
    awards: [],
    rationale: "非受賞・簡易モーショングラフィックス＆VFXリール"
  },
  {
    id: "eS3sTLZhd94",
    genre_bucket: "モーション",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "C",
    objective_band: [51, 56],
    evidence_level: "baseline_amateur",
    awards: [],
    rationale: "非受賞・基礎AEアニメチュートリアル"
  },
  {
    id: "253892735",
    genre_bucket: "モーション",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "C-",
    objective_band: [45, 50],
    evidence_level: "baseline_low_amateur",
    awards: [],
    rationale: "非受賞・単一ループ基礎モーション試作（Advance Backwards）"
  },

  // ========================
  // 4. 3DCG/アニメ (3DCG / Stop-motion / Short Animation)
  // ========================
  {
    id: "vRBVWCs1KW4",
    genre_bucket: "3DCG/アニメ",
    tier_bucket: "上位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "S+",
    objective_band: [97, 100],
    evidence_level: "tier1_global_grand_prix",
    awards: [
      { name: "Cannes Film Festival", year: "1955", category: "Short Film Palme d'Or", sourceUrl: "https://www.festival-cannes.com/" },
      { name: "BAFTA Awards", year: "1956", category: "Best Animated Film", sourceUrl: "https://www.bafta.org/" }
    ],
    rationale: "カンヌ国際映画祭短編パルムドール＆BAFTA最優秀アニメ賞受賞の歴史的傑作（Norman McLaren 'Blinkity Blank'）"
  },
  {
    id: "X0hyTmlsBUI",
    genre_bucket: "3DCG/アニメ",
    tier_bucket: "上位",
    craft_or_purpose: "craft_benchmark",
    award_level: "shortlist_or_selection",
    objective_tier: "S-",
    objective_band: [90, 92],
    evidence_level: "tier2_oscar_shortlist_and_student_win",
    awards: [
      { name: "Academy Awards (Oscars)", year: "2025", category: "97th Animated Short Film Shortlist", sourceUrl: "https://www.oscars.org/" },
      { name: "Student Academy Awards", year: "2024", category: "51st Silver Medal (Animation)", sourceUrl: "https://www.oscars.org/saa" }
    ],
    rationale: "第97回米国アカデミー賞短編アニメ部門ショートリスト＆日本人初・学生アカデミー賞銀賞（金森慧 'Origami'）"
  },
  {
    id: "35i4zTky9pI",
    genre_bucket: "3DCG/アニメ",
    tier_bucket: "上位",
    craft_or_purpose: "craft_benchmark",
    award_level: "shortlist_or_selection",
    objective_tier: "S-",
    objective_band: [90, 92],
    evidence_level: "tier2_oscar_shortlist",
    awards: [
      { name: "Academy Awards (Oscars)", year: "2019", category: "91st Animated Short Film Shortlist", sourceUrl: "https://www.oscars.org/" },
      { name: "AACTA Awards", year: "2018", category: "Best Short Animation", sourceUrl: "https://www.aacta.org/" }
    ],
    rationale: "第91回米国アカデミー賞短編アニメ部門ショートリスト＆AACTA最優秀短編アニメ賞（Lost & Found）"
  },
  {
    id: "vohpCZh-Qcw",
    genre_bucket: "3DCG/アニメ",
    tier_bucket: "上位",
    craft_or_purpose: "craft_benchmark",
    award_level: "shortlist_or_selection",
    objective_tier: "S-",
    objective_band: [90, 92],
    evidence_level: "tier2_annecy_official_competition",
    awards: [
      { name: "Annecy International Animation Film Festival", year: "2025", category: "Official Short Films Competition Selection", sourceUrl: "https://www.annecyfestival.com/" },
      { name: "Berlin International Film Festival", year: "2025", category: "Silver Bear Jury Prize (Short Film)", sourceUrl: "https://www.berlinale.de/" }
    ],
    rationale: "アヌシー2025公式短編コンペ選出＆ベルリン国際映画祭銀熊賞（普通の生活 Ordinary Life）"
  },
  // 3DCG/アニメ 中位
  {
    id: "1230811867",
    genre_bucket: "3DCG/アニメ",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "A+",
    objective_band: [86, 89],
    evidence_level: "tier3_vimeo_staff_pick",
    awards: [
      { name: "Vimeo Staff Picks", year: "2025", category: "Vimeo Staff Pick", sourceUrl: "https://vimeo.com/channels/staffpicks" }
    ],
    rationale: "Vimeo Staff Pick公式選出のストップモーション短編（Coeur Cerise）"
  },
  {
    id: "jvKtHf7kDYs",
    genre_bucket: "3DCG/アニメ",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "A+",
    objective_band: [86, 89],
    evidence_level: "tier3_intl_festival_winner",
    awards: [
      { name: "東京国際映画祭", year: "2021", category: "アジアの未来 作品賞", sourceUrl: "https://2021.tiff-jp.net/award_winners_ja/" }
    ],
    rationale: "国際映画祭部門作品賞（東京国際映画祭 アジアの未来 作品賞）"
  },
  {
    id: "_PTHdkmCLRs",
    genre_bucket: "3DCG/アニメ",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "shortlist_or_selection",
    objective_tier: "A-",
    objective_band: [78, 81],
    evidence_level: "tier5_eizo100_curated",
    awards: [
      { name: "映像作家100人", year: "2019", category: "2019選出作品", sourceUrl: "https://eizo100.jp/video/12085" }
    ],
    rationale: "国内プロキュレーション選出短編アニメ（映像作家100人 2019）"
  },
  {
    id: "g9dacS4c_D8",
    genre_bucket: "3DCG/アニメ",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "shortlist_or_selection",
    objective_tier: "A-",
    objective_band: [78, 81],
    evidence_level: "tier5_eizo100_curated",
    awards: [
      { name: "映像作家100人", year: "2026", category: "2026選出作品", sourceUrl: "https://eizo100.jp/video/124003" }
    ],
    rationale: "国内プロキュレーション選出3DCG/アニメ作品（映像作家100人 2026 — Builder）"
  },
  // 3DCG/アニメ 下位 (非受賞: B+ / B / B- / C+ / C)
  {
    id: "77esOPFEsR8",
    genre_bucket: "3DCG/アニメ",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "B+",
    objective_band: [73, 77],
    evidence_level: "baseline_commercial_high",
    awards: [],
    rationale: "非受賞・高品質Blender VFXブレイクダウン（Razer Edit）"
  },
  {
    id: "90Q6g57jnuU",
    genre_bucket: "3DCG/アニメ",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "B",
    objective_band: [68, 72],
    evidence_level: "baseline_commercial_standard",
    awards: [],
    rationale: "非受賞・標準商用アニメPV（子猫の配達員うーにゃん）"
  },
  {
    id: "bSWo5hiLRSU",
    genre_bucket: "3DCG/アニメ",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "B",
    objective_band: [68, 72],
    evidence_level: "baseline_commercial_standard",
    awards: [],
    rationale: "非受賞・標準自主制作Blender 3DCGアニメ"
  },
  {
    id: "5-0M0ZjSjGY",
    genre_bucket: "3DCG/アニメ",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "B-",
    objective_band: [63, 67],
    evidence_level: "baseline_commercial_basic",
    awards: [],
    rationale: "非受賞・定型教育アニメーション（うみとりくのからだのはなし）"
  },
  {
    id: "5SW_6FQJuF0",
    genre_bucket: "3DCG/アニメ",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "C+",
    objective_band: [57, 62],
    evidence_level: "baseline_simple_commercial",
    awards: [],
    rationale: "非受賞・簡易3D 360 VRファンアニメ"
  },
  {
    id: "XYqHFXGwbRo",
    genre_bucket: "3DCG/アニメ",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "C",
    objective_band: [51, 56],
    evidence_level: "baseline_amateur",
    awards: [],
    rationale: "非受賞・簡易イラストアニメ制作進捗ショート"
  },

  // ========================
  // 5. 企業映像 (Corporate / Brand Film / Tourism / Recruiting)
  // ========================
  {
    id: "UvGwIFVUK7M",
    genre_bucket: "企業映像",
    tier_bucket: "上位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "S+",
    objective_band: [97, 100],
    evidence_level: "tier1_global_grand_prix",
    awards: [
      { name: "Spikes Asia", year: "2025", category: "Film Craft Grand Prix", sourceUrl: "https://www.spikes.asia/news/spikes-asia-announces-its-2025-winners" }
    ],
    rationale: "アジア最高峰クラフト最高賞（Spikes Asia 2025 Film Craft Grand Prix — Jindal Steel）"
  },
  {
    id: "CWhNI_x9W6c",
    genre_bucket: "企業映像",
    tier_bucket: "上位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "S-",
    objective_band: [90, 92],
    evidence_level: "tier2_national_grand_prix",
    awards: [
      { name: "映文連アワード", year: "2025", category: "経済産業大臣賞", sourceUrl: "https://www.eibunren.or.jp/?p=7067" }
    ],
    rationale: "国内企業映像アワード最高賞（映文連アワード 2025 経済産業大臣賞 — MAZDA RX-7）"
  },
  // パーパス・社会派部門（別枠・参考扱い）
  {
    id: "D_vdPkCz23g",
    genre_bucket: "企業映像",
    tier_bucket: "上位",
    craft_or_purpose: "purpose_reference_only",
    award_level: "winner",
    objective_tier: "S+",
    objective_band: [97, 100],
    evidence_level: "purpose_social_impact_reference",
    awards: [
      { name: "Cannes Lions", year: "2018", category: "Sustainable Development Goals (SDG) Grand Prix / Titanium Grand Prix / Direct Grand Prix", sourceUrl: "https://www.canneslions.com/" }
    ],
    rationale: "【別枠・参考扱い】Cannes Lions 2018 SDG/Titanium/Direct Grand Prix（企画・社会派インパクト評価であり、クラフト基準群からは分離）"
  },
  // 企業映像 中位
  {
    id: "0eM8v5LY96g",
    genre_bucket: "企業映像",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "A+",
    objective_band: [86, 89],
    evidence_level: "tier3_global_corporate_silver",
    awards: [
      { name: "Cannes Corporate Media & TV Awards", year: "2025", category: "Silver Dolphin (Tourism Films - Destinations - Regions)", sourceUrl: "https://www.cannescorporate.com/" }
    ],
    rationale: "Cannes Corporate Media & TV Awards 銀賞（Another Side of Japan — Kumano Brush）"
  },
  {
    id: "dXqgTG6Jzp4",
    genre_bucket: "企業映像",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "A+",
    objective_band: [86, 89],
    evidence_level: "tier3_global_corporate_silver",
    awards: [
      { name: "Cannes Corporate Media & TV Awards", year: "2025", category: "Silver Dolphin (Tourism Films - Destinations - Regions)", sourceUrl: "https://www.cannescorporate.com/" }
    ],
    rationale: "Cannes Corporate Media & TV Awards 銀賞（Another Side of Japan — KAGAWA）"
  },
  {
    id: "jXol8vcOwyk",
    genre_bucket: "企業映像",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "A+",
    objective_band: [86, 89],
    evidence_level: "tier3_global_corporate_silver",
    awards: [
      { name: "Cannes Corporate Media & TV Awards", year: "2025", category: "Silver Dolphin (Tourism Films - Destinations - Regions)", sourceUrl: "https://www.cannescorporate.com/" }
    ],
    rationale: "Cannes Corporate Media & TV Awards 銀賞（Another Side of Japan — OKAYAMA）"
  },
  {
    id: "1S-KU2F7wc0",
    genre_bucket: "企業映像",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "A+",
    objective_band: [86, 89],
    evidence_level: "tier3_national_gold",
    awards: [
      { name: "日本国際観光映像祭", year: "2025", category: "ジャパングランプリ / 部門別最優秀賞", sourceUrl: "https://prtimes.jp/main/html/rd/p/000000013.000081094.html" }
    ],
    rationale: "日本国際観光映像祭 2025 ジャパングランプリ（南阿蘇温泉郷）"
  },
  {
    id: "8pOOxOo7YYo",
    genre_bucket: "企業映像",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "A+",
    objective_band: [86, 89],
    evidence_level: "tier3_national_gold",
    awards: [
      { name: "日本国際観光映像祭", year: "2026", category: "グランプリ（日本部門）", sourceUrl: "https://www.town.horonobe.lg.jp/www4/section/sangyo/le009f000001xivg.html" }
    ],
    rationale: "日本国際観光映像祭 2026 日本部門グランプリ（利尻礼文サロベツ国立公園）"
  },
  {
    id: "uCDUpZV3f8A",
    genre_bucket: "企業映像",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "A",
    objective_band: [82, 85],
    evidence_level: "tier4_regional_commendation",
    awards: [
      { name: "ADFEST", year: "2016", category: "Fabulous Four Commendation Certificate (New Director Lotus)", sourceUrl: "https://www.adfest.com/" }
    ],
    rationale: "ADFEST 2016 Fabulous Four Commendation Certificate受賞（Brushing Up）"
  },
  {
    id: "9NzQ3G6rY5M",
    genre_bucket: "企業映像",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "A",
    objective_band: [82, 85],
    evidence_level: "tier4_national_silver",
    awards: [
      { name: "日本国際観光映像祭", year: "2025", category: "日本部門 City Promotion 優秀賞", sourceUrl: "https://jwtff.world/" }
    ],
    rationale: "日本国際観光映像祭 2025 部門優秀賞（熊本県和水町）"
  },
  {
    id: "V6XHz7tqGVM",
    genre_bucket: "企業映像",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "shortlist_or_selection",
    objective_tier: "A-",
    objective_band: [78, 81],
    evidence_level: "tier5_regional_official_selection",
    awards: [
      { name: "ADFEST", year: "2016", category: "Fabulous Four Official Selection (New Director Lotus)", sourceUrl: "https://www.adfest.com/" }
    ],
    rationale: "ADFEST 2016 Fabulous Four公式選出（受賞の1ランク下 — Beautiful Lie）"
  },
  {
    id: "9waEFmHUNdk",
    genre_bucket: "企業映像",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    objective_tier: "A-",
    objective_band: [78, 81],
    evidence_level: "tier5_curated_or_merit",
    awards: [
      { name: "日本国際観光映像祭", year: "2025", category: "観客賞", sourceUrl: "https://jwtff.world/" }
    ],
    rationale: "日本国際観光映像祭 2025 観客賞（大分県豊後大野市）"
  },
  // 企業映像 下位 (非受賞商用企業映像: B+ / B / B- / C+ / C / C-)
  {
    id: "-PXeNWSj3Y0",
    genre_bucket: "企業映像",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "B+",
    objective_band: [73, 77],
    evidence_level: "baseline_commercial_high",
    awards: [],
    rationale: "非受賞・高品質企業PRムービー（神戸鈑金工業）"
  },
  {
    id: "-nr56fLZ11o",
    genre_bucket: "企業映像",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "B+",
    objective_band: [73, 77],
    evidence_level: "baseline_commercial_high",
    awards: [],
    rationale: "非受賞・高品質企業実験ブランデッド映像（Kezuru実験）"
  },
  {
    id: "-BVWPusea_A",
    genre_bucket: "企業映像",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "B",
    objective_band: [68, 72],
    evidence_level: "baseline_commercial_standard",
    awards: [],
    rationale: "非受賞・標準企業採用動画（通信会社・営業社員PV）"
  },
  {
    id: "-5fhRq5PV2o",
    genre_bucket: "企業映像",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "B",
    objective_band: [68, 72],
    evidence_level: "baseline_commercial_standard",
    awards: [],
    rationale: "非受賞・標準サービス紹介動画（finbee）"
  },
  {
    id: "4PojHU4ckSk",
    genre_bucket: "企業映像",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "B-",
    objective_band: [63, 67],
    evidence_level: "baseline_commercial_basic",
    awards: [],
    rationale: "非受賞・定型企業OEM事業紹介動画（ティー・シー・ピー）"
  },
  {
    id: "2NOefVvwLIM",
    genre_bucket: "企業映像",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "B-",
    objective_band: [63, 67],
    evidence_level: "baseline_commercial_basic",
    awards: [],
    rationale: "非受賞・定型採用OP動画（タスク整体院グループ）"
  },
  {
    id: "0oioI53EGU0",
    genre_bucket: "企業映像",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "C+",
    objective_band: [57, 62],
    evidence_level: "baseline_simple_commercial",
    awards: [],
    rationale: "非受賞・簡易企業サービス紹介動画（Ascent Business Consulting）"
  },
  {
    id: "7jCvHsi6mLQ",
    genre_bucket: "企業映像",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "C+",
    objective_band: [57, 62],
    evidence_level: "baseline_simple_commercial",
    awards: [],
    rationale: "非受賞・簡易社長メッセージ採用動画（斉藤木工所）"
  },
  {
    id: "hJqVpUoNVqE",
    genre_bucket: "企業映像",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "C",
    objective_band: [51, 56],
    evidence_level: "baseline_amateur",
    awards: [],
    rationale: "非受賞・簡易Vlog風社員密着動画"
  },
  {
    id: "Z-nPJFF1PYY",
    genre_bucket: "企業映像",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "C-",
    objective_band: [45, 50],
    evidence_level: "baseline_low_amateur",
    awards: [],
    rationale: "非受賞・スライド読み上げ型採用ピッチ動画（メドコム）"
  },
  // 極下限アンカー (D+ / D / D- — 15段階全帯域カバー用)
  {
    id: "efxhgspLRIQ",
    genre_bucket: "CM",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "D+",
    objective_band: [30, 44],
    evidence_level: "baseline_minimal",
    awards: [],
    rationale: "極下限アンカー（映像演出意図なし・簡易SNSクリップ）"
  },
  {
    id: "V_yyk2lQRFA",
    genre_bucket: "MV",
    tier_bucket: "下位",
    craft_or_purpose: "non_award_baseline",
    award_level: "non_awarded",
    objective_tier: "D-",
    objective_band: [0, 19],
    evidence_level: "baseline_meme",
    awards: [],
    rationale: "極下限アンカー（ミーム動画・演出/クラフト基準外）"
  }
];

const conn = await mysql.createConnection({
  uri: dbUrl,
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});

const ids = SPECS.map(s => s.id);
const dupCheck = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dupCheck.length) {
  throw new Error("Duplicate IDs found: " + dupCheck.join(", "));
}

const placeholders = ids.map(() => "?").join(",");
const [rows] = await conn.query(
  `SELECT id, platform, title, videoUrl, aiOverallRating, aiOverallScore, embedStatus,
          JSON_UNQUOTE(JSON_EXTRACT(aiScoreBreakdown, '$.analysisStatus')) AS analysisStatus
     FROM videos
    WHERE id IN (${placeholders})`,
  ids
);
await conn.end();

const byId = new Map(rows.map(r => [r.id, r]));
const missing = ids.filter(id => !byId.has(id));
if (missing.length) {
  throw new Error("Missing IDs in TiDB: " + missing.join(", "));
}

const out = SPECS.map(spec => {
  const row = byId.get(spec.id);
  return {
    id: row.id,
    title: row.title,
    platform: row.platform,
    videoUrl: row.videoUrl,
    genre_bucket: spec.genre_bucket,
    tier_bucket: spec.tier_bucket,
    craft_or_purpose: spec.craft_or_purpose,
    award_level: spec.award_level,
    current_db_rating: row.aiOverallRating,
    current_db_score: row.aiOverallScore,
    current_db_analysis_status: row.analysisStatus || "full_analysis",
    awards: spec.awards,
    objective_tier: spec.objective_tier,
    objective_band: spec.objective_band,
    evidence_level: spec.evidence_level,
    rationale: spec.rationale,
  };
});

fs.writeFileSync(
  path.join(REPO_ROOT, "analysis", "golden_benchmark_50.json"),
  JSON.stringify(out, null, 2) + "\n",
  "utf8"
);

// Print exact summary & Genre x Tier matrix
const genres = ["CM", "MV", "モーション", "3DCG/アニメ", "企業映像"];
const tiers = ["上位", "中位", "下位"];
console.log(`Wrote ${out.length} verified entries to analysis/golden_benchmark_50.json`);
console.log("\n=== Genre x Tier Matrix ===");
for (const g of genres) {
  const counts = tiers.map(t => out.filter(x => x.genre_bucket === g && x.tier_bucket === t).length);
  const total = counts.reduce((a, b) => a + b, 0);
  console.log(`${g.padEnd(10)} | 上位:${counts[0]} | 中位:${counts[1]} | 下位:${counts[2]} | 計:${total}`);
}
console.log("\n=== By craft_or_purpose ===");
for (const k of ["craft_benchmark", "purpose_reference_only", "non_award_baseline"]) {
  console.log(`${k}: ${out.filter(x => x.craft_or_purpose === k).length}`);
}
console.log("\n=== By award_level ===");
for (const k of ["winner", "shortlist_or_selection", "non_awarded"]) {
  console.log(`${k}: ${out.filter(x => x.award_level === k).length}`);
}
console.log("\n=== By objective_tier ===");
const tierOrder = ["S+","S","S-","A+","A","A-","B+","B","B-","C+","C","C-","D+","D","D-"];
for (const t of tierOrder) {
  const c = out.filter(x => x.objective_tier === t).length;
  if (c > 0) console.log(`${t.padEnd(3)}: ${c}`);
}
const prov = out.filter(x => x.current_db_analysis_status === "provisional");
console.log(`\nProvisional in DB: ${prov.length} (${prov.map(x => x.id).join(", ")})`);
const noUrl = out.filter(x => x.awards.some(a => !a.sourceUrl));
console.log(`Awards missing sourceUrl: ${noUrl.length}`);
