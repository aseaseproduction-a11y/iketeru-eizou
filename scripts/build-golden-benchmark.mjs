import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const REPO_ROOT = "E:\\iketeru-eizou";
const envText = fs.readFileSync(path.join(REPO_ROOT, ".env"), "utf8").replace(/^\uFEFF/, "");
const dbUrl = envText.match(/^DATABASE_URL=(.+)$/m)[1].trim();

// Verified yt-dlp real download proof recorded in analysis/restricted_ytdlp_check.json
const YTDLP_VERIFIED_RESTRICTED = new Set([
  "tdQCMuaJUQk",
  "JFDm4p8T6_4",
  "wXD33Jx25oI",
  "FSqTqdjf2YQ",
  "iXTuYbyH2Rc",
  "-J7Oi1-EfG8",
  "_H6zuJAtQqI",
]);

// Curated & strictly verified benchmark specification (v5)
// - All 7 eizo100 entries excluded (no per-work yearly selection statement in body text)
// - p4eAR2Gw5RU corrected to 日本部門2025（入選）= A- matching official jwtff.world page
// - Motion & MV replenished with strictly verified primary-source awards (SXSW, Media Arts, New Chitose, UKMVA)
const SPECS = [
  // ========================
  // 1. CM (TV CM / Web CM / Branded Film)
  // ========================
  {
    id: "FNQ4vqB-waw",
    genre_bucket: "CM",
    tier_bucket: "上位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    era_bucket: "modern_10y",
    objective_tier: "S",
    objective_band: [93, 96],
    evidence_level: "tier1_global_craft_gold",
    awards: [
      {
        name: "Cannes Lions",
        year: "2023",
        category: "Film Craft Gold Lion x2 (Production Design/Art Direction, Achievement in Production)",
        sourceUrl: "https://www.hakuhodo-global.com/news/hakuhodo-group-wins-9-lions-at-cannes-lions-2023-including-4-gold.html"
      }
    ],
    rationale: "Cannes Lions 2023 Film Craft Gold 2冠（相鉄「父と娘の風景」／A Train of Memories）"
  },
  {
    id: "5wEjV2ekSwE",
    genre_bucket: "CM",
    tier_bucket: "上位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    era_bucket: "classic_archive",
    objective_tier: "S-",
    objective_band: [90, 92],
    evidence_level: "tier1_global_craft_silver",
    awards: [
      {
        name: "Cannes Lions",
        year: "2014",
        category: "Film Craft Silver Lion (Visual Effects / Sound Design)",
        sourceUrl: "https://www.marklives.com/2014/06/cannes-lions-2014-final-awards-cannes-2014/"
      }
    ],
    rationale: "Cannes Lions 2014 Film Craft Silver（Honda 'Hands'、2014年作のため classic_archive 区分）"
  },
  {
    id: "vpyeQeTDGFA",
    genre_bucket: "CM",
    tier_bucket: "上位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    era_bucket: "modern_10y",
    objective_tier: "S-",
    objective_band: [90, 92],
    evidence_level: "tier1_global_craft_silver",
    awards: [
      {
        name: "D&AD Awards",
        year: "2016",
        category: "Graphite Pencil (Film Advertising Crafts - Animation)",
        sourceUrl: "https://pesfilm.com/pages/awards-honors"
      }
    ],
    rationale: "D&AD 2016 Graphite Pencil（Animation）受賞作（Honda 'Paper' by PES）"
  },
  // CM 参考扱い（非クラフト部門）
  {
    id: "Z_lbVlhO9HE",
    genre_bucket: "CM",
    tier_bucket: "参考枠",
    craft_or_purpose: "non_craft_award_reference",
    award_level: "winner",
    era_bucket: "modern_10y",
    objective_tier: null,
    objective_band: null,
    evidence_level: "non_craft_category_reference",
    awards: [
      {
        name: "D&AD Awards",
        year: "2025",
        category: "Black Pencil (Digital Marketing)",
        sourceUrl: "https://www.creativebloq.com/creative-inspiration/d-and-ad-announces-2025-winners-including-3-coveted-black-pencils"
      }
    ],
    rationale: "【参考扱い】D&AD 2025 Black Pencil は Digital Marketing 部門（映像クラフト部門外のため較正群から分離）"
  },
  {
    id: "DwIur8FBRxw",
    genre_bucket: "CM",
    tier_bucket: "参考枠",
    craft_or_purpose: "non_craft_award_reference",
    award_level: "winner",
    era_bucket: "modern_10y",
    objective_tier: null,
    objective_band: null,
    evidence_level: "non_craft_category_reference",
    awards: [
      {
        name: "YouTube Works Awards Japan",
        year: "2024",
        category: "Grand Prix / Creative Effectiveness",
        sourceUrl: "https://business.google.com/jp/think/search-and-video/youtubeworks-2024-1/"
      }
    ],
    rationale: "【参考扱い】Creative Effectiveness（成果・マーケティング効果評価）主体のためクラフト較正群から分離"
  },
  // CM 中位
  {
    id: "iIL_CB_YjFk",
    genre_bucket: "CM",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    era_bucket: "modern_10y",
    objective_tier: "A+",
    objective_band: [86, 89],
    evidence_level: "tier2_global_craft_bronze",
    awards: [
      {
        name: "Cannes Lions",
        year: "2026",
        category: "Film Craft Bronze Lion (Animation)",
        sourceUrl: "https://prtimes.jp/main/html/rd/p/000000332.000046517.html"
      },
      {
        name: "shots Awards Asia Pacific",
        year: "2026",
        category: "Gold (Animation - Stop-motion)",
        sourceUrl: "https://geekpictures.co.jp/en/topics/shots-awards-asia-pacific-2026/"
      }
    ],
    rationale: "Cannes Lions 2026 Film Craft Bronze（Animation）＆shots Awards APAC 2026 Gold受賞作（講談社 LIGHT HOLE）"
  },
  {
    id: "tdQCMuaJUQk",
    genre_bucket: "CM",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    era_bucket: "modern_10y",
    objective_tier: "A+",
    objective_band: [86, 89],
    evidence_level: "tier3_national_contest_gp",
    awards: [
      {
        name: "BOVA 宣伝会議",
        year: "2026",
        category: "グランプリ",
        sourceUrl: "https://awardg.sendenkaigi.com/bova/history/13th"
      }
    ],
    rationale: "第13回BOVAグランプリ"
  },
  {
    id: "JFDm4p8T6_4",
    genre_bucket: "CM",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    era_bucket: "modern_10y",
    objective_tier: "A",
    objective_band: [82, 85],
    evidence_level: "tier4_national_contest_gold",
    awards: [
      {
        name: "BOVA 宣伝会議",
        year: "2025",
        category: "ゴールド",
        sourceUrl: "https://awardg.sendenkaigi.com/bova/history/12th"
      }
    ],
    rationale: "第12回BOVAゴールド"
  },
  {
    id: "wXD33Jx25oI",
    genre_bucket: "CM",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    era_bucket: "modern_10y",
    objective_tier: "A",
    objective_band: [82, 85],
    evidence_level: "tier4_national_contest_gold",
    awards: [
      {
        name: "BOVA 宣伝会議",
        year: "2026",
        category: "ゴールド",
        sourceUrl: "https://awardg.sendenkaigi.com/bova/history/13th"
      }
    ],
    rationale: "第13回BOVAゴールド"
  },
  {
    id: "FSqTqdjf2YQ",
    genre_bucket: "CM",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    era_bucket: "modern_10y",
    objective_tier: "A-",
    objective_band: [78, 81],
    evidence_level: "tier5_national_contest_silver",
    awards: [
      {
        name: "BOVA 宣伝会議",
        year: "2025",
        category: "シルバー",
        sourceUrl: "https://awardg.sendenkaigi.com/bova/history/12th"
      }
    ],
    rationale: "第12回BOVAシルバー"
  },
  {
    id: "iXTuYbyH2Rc",
    genre_bucket: "CM",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    era_bucket: "modern_10y",
    objective_tier: "A-",
    objective_band: [78, 81],
    evidence_level: "tier5_national_contest_silver",
    awards: [
      {
        name: "BOVA 宣伝会議",
        year: "2026",
        category: "シルバー",
        sourceUrl: "https://awardg.sendenkaigi.com/bova/history/13th"
      }
    ],
    rationale: "第13回BOVAシルバー"
  },
  {
    id: "-J7Oi1-EfG8",
    genre_bucket: "CM",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    era_bucket: "modern_10y",
    objective_tier: "B+",
    objective_band: [73, 77],
    evidence_level: "tier6_contest_sponsor_award",
    awards: [
      {
        name: "BOVA 宣伝会議",
        year: "2026",
        category: "協賛企業賞",
        sourceUrl: "https://awardg.sendenkaigi.com/bova/history/13th"
      }
    ],
    rationale: "第13回BOVA協賛企業賞（※B+のためPairwise順位正解率比較からは除外）"
  },
  // CM 下位 (非受賞の通常商用CM)
  { id: "6Rm136Ngwjg", genre_bucket: "CM", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・通常商用TVCM（大塚製薬 オロナイン 2025）" },
  { id: "7rP-633ApUI", genre_bucket: "CM", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・通常商用15秒TVCM（ガセリ）" },
  { id: "1FhTNSG_Ri4", genre_bucket: "CM", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・通常商用Web CM（ANESSA）" },
  { id: "37tJ-AWEW5U", genre_bucket: "CM", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・通常商用TVCM（2026年ジョーシンCM）" },
  { id: "2KS4Q6Bjgq8", genre_bucket: "CM", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・通常商用TVCM（AOKI フレッシャーズ）" },
  { id: "_7lQGv4ZmBo", genre_bucket: "CM", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・通常商用TVCM（ブックオフ 2025）" },
  { id: "AF-K7EV4BJw", genre_bucket: "CM", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・通常商用Web CM（三菱UFJ銀行公式）" },
  { id: "A-9c7OdQMFc", genre_bucket: "CM", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・ローカル商用Web CM（夢・桃中軒牛右衛門）" },

  // ========================
  // 2. MV (Music Video)
  // ========================
  {
    id: "5URefVYaJrA",
    genre_bucket: "MV",
    tier_bucket: "上位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    era_bucket: "modern_10y",
    objective_tier: "S+",
    objective_band: [97, 100],
    evidence_level: "tier1_global_grand_prix",
    awards: [
      {
        name: "D&AD Awards",
        year: "2025",
        category: "Black Pencil (Music Videos)",
        sourceUrl: "https://www.creativebloq.com/creative-inspiration/d-and-ad-announces-2025-winners-including-3-coveted-black-pencils"
      }
    ],
    rationale: "世界最高峰アワード最高賞（D&AD 2025 Black Pencil — A$AP Rocky 'Tailor Swif'）"
  },
  {
    id: "tvTRZJ-4EyI",
    genre_bucket: "MV",
    tier_bucket: "上位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    era_bucket: "modern_10y",
    objective_tier: "S",
    objective_band: [93, 96],
    evidence_level: "tier1_global_mv_winner",
    awards: [
      {
        name: "MTV Video Music Awards",
        year: "2017",
        category: "Video of the Year / Best Direction / Best Cinematography / Best Art Direction / Best Visual Effects",
        sourceUrl: "https://www.cbc.ca/news/entertainment/lamar-wins-six-mtv-vmas-1.4264675"
      }
    ],
    rationale: "MTV VMA 2017 Video of the Year＋監督・撮影・美術・VFXクラフト部門受賞（Kendrick Lamar 'HUMBLE.'）"
  },
  {
    id: "ebzEEEdjHj0",
    genre_bucket: "MV",
    tier_bucket: "上位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    era_bucket: "modern_10y",
    objective_tier: "S-",
    objective_band: [90, 92],
    evidence_level: "tier1_global_mv_craft",
    awards: [
      {
        name: "UK Music Video Awards",
        year: "2017",
        category: "Best Dance Video - UK / Best Production Design",
        sourceUrl: "https://www.promonews.tv/news/2017/10/26/uk-music-video-awards-2017-all-winners/50227"
      }
    ],
    rationale: "UKMVA 2017 Best Dance Video - UK & Best Production Design受賞MV（Bonobo 'No Reason'）"
  },
  {
    id: "153159513",
    genre_bucket: "MV",
    tier_bucket: "上位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    era_bucket: "modern_10y",
    objective_tier: "S-",
    objective_band: [90, 92],
    evidence_level: "tier1_global_mv_craft",
    awards: [
      {
        name: "UK Music Video Awards",
        year: "2016",
        category: "Best Dance Video - International",
        sourceUrl: "https://www.ukmva.com/42-2016"
      }
    ],
    rationale: "UKMVA 2016 Best Dance Video - International受賞MV（Valentino Khan 'Deep Down Low'）"
  },
  // MV 中位
  {
    id: "5zj3aHgLFQE",
    genre_bucket: "MV",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "shortlist_or_selection",
    era_bucket: "classic_archive",
    objective_tier: "A",
    objective_band: [82, 85],
    evidence_level: "tier4_national_jury_selection",
    awards: [
      {
        name: "文化庁メディア芸術祭",
        year: "2014",
        category: "第18回 アニメーション部門 審査委員会推薦作品",
        sourceUrl: "https://www.bunka.go.jp/j-mediaarts-festival/award/single/poker/index.html"
      }
    ],
    rationale: "第18回文化庁メディア芸術祭 アニメーション部門 審査委員会推薦作品（トクマルシューゴ 'Poker'）"
  },
  {
    id: "3JtO1WMYb58",
    genre_bucket: "MV",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "shortlist_or_selection",
    era_bucket: "modern_10y",
    objective_tier: "A",
    objective_band: [82, 85],
    evidence_level: "tier4_national_jury_selection",
    awards: [
      {
        name: "文化庁メディア芸術祭",
        year: "2019",
        category: "第22回 エンターテインメント部門 審査委員会推薦作品",
        sourceUrl: "https://www.bunka.go.jp/j-mediaarts-festival/award/single/frasco-viewtiful/index.html"
      }
    ],
    rationale: "第22回文化庁メディア芸術祭 エンターテインメント部門 審査委員会推薦作品（Frasco 'Viewtiful'）"
  },
  {
    id: "QmLBz4FuVDA",
    genre_bucket: "MV",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "shortlist_or_selection",
    era_bucket: "modern_10y",
    objective_tier: "A",
    objective_band: [82, 85],
    evidence_level: "tier4_national_jury_selection",
    awards: [
      {
        name: "文化庁メディア芸術祭",
        year: "2019",
        category: "第22回 エンターテインメント部門 審査委員会推薦作品",
        sourceUrl: "https://www.bunka.go.jp/j-mediaarts-festival/award/single/innosent-in-formal-footloose/index.html"
      }
    ],
    rationale: "第22回文化庁メディア芸術祭 エンターテインメント部門 審査委員会推薦作品（INNOSENT in FORMAL 'Footloose'）"
  },
  // MV 下位 (非受賞の通常商用MV)
  { id: "-n1ljTOQK-s", genre_bucket: "MV", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・通常商用MV（僕が見たかった青空）" },
  { id: "_C7k63knGz8", genre_bucket: "MV", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・通常商用MV（XOX 'PINKY BABY'）" },
  { id: "-J3OnxCEzl0", genre_bucket: "MV", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・通常商用MV（上水流宇宙 'ZeroGravity'）" },
  { id: "_2lHuvAwhwk", genre_bucket: "MV", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・インディーズMV（R BANDIT X MR RIGHT）" },
  { id: "7ErE0YPc_PY", genre_bucket: "MV", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・通常ヒップホップMV（Lil Eazzyy 'IM GOOD'）" },
  { id: "C0RD172wK6c", genre_bucket: "MV", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・インディーズMV（Marko Sosa 'The Truth'）" },
  { id: "Dhx2EIhYkc0", genre_bucket: "MV", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・インディーズMV（ASIRA）" },

  // ========================
  // 3. モーション (Motion Graphics / Title Design / Kinetic / Hybrid Motion)
  // ========================
  {
    id: "313084145",
    genre_bucket: "モーション",
    tier_bucket: "上位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    era_bucket: "modern_10y",
    objective_tier: "S-",
    objective_band: [90, 92],
    evidence_level: "tier2_sxsw_jury_recognition",
    awards: [
      {
        name: "SXSW Film Festival",
        year: "2020",
        category: "Special Jury Recognition for Animation",
        sourceUrl: "https://www.thewrap.com/sxsw-film-festival-jury-special-awards-cancellation-coronavirus/"
      }
    ],
    rationale: "SXSW 2020 Special Jury Recognition for Animation受賞（Mitski 'A Pearl' — 3D＋1,480枚手描きモーション作品）"
  },
  {
    id: "49367868",
    genre_bucket: "モーション",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    era_bucket: "classic_archive",
    objective_tier: "A+",
    objective_band: [86, 89],
    evidence_level: "tier3_media_arts_new_face",
    awards: [
      {
        name: "文化庁メディア芸術祭",
        year: "2012",
        category: "第16回 エンターテインメント部門 新人賞",
        sourceUrl: "https://www.bunka.go.jp/j-mediaarts-festival/award/single/haisuinonasa/index.html"
      }
    ],
    rationale: "第16回文化庁メディア芸術祭 新人賞（大西景太 / ハイスイノナサ「地下鉄の動態」— 音同期幾何学モーショングラフィックス）"
  },
  {
    id: "246660563",
    genre_bucket: "モーション",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    era_bucket: "modern_10y",
    objective_tier: "A",
    objective_band: [82, 85],
    evidence_level: "tier4_intl_anim_fest_award",
    awards: [
      {
        name: "新千歳空港国際アニメーション映画祭",
        year: "2018",
        category: "観客賞 (Audience Award)",
        sourceUrl: "https://archives.airport-anifes.jp/site2018/film/fes2018-imai_fly/"
      }
    ],
    rationale: "新千歳空港国際アニメーション映画祭2018観客賞（橋本麦 / imai 'Fly' — モーショントラッカー併用ストップモーション）"
  },
  {
    id: "134832670",
    genre_bucket: "モーション",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "shortlist_or_selection",
    era_bucket: "classic_archive",
    objective_tier: "A",
    objective_band: [82, 85],
    evidence_level: "tier4_national_jury_selection",
    awards: [
      {
        name: "文化庁メディア芸術祭",
        year: "2017",
        category: "第20回 アニメーション部門 審査委員会推薦作品 (Jury Selection)",
        sourceUrl: "https://www.bunka.go.jp/j-mediaarts-festival/en/award/single/loeil-du-cyclone/index-2.html"
      }
    ],
    rationale: "第20回文化庁メディア芸術祭 アニメーション部門 審査委員会推薦作品（平岡政展 / EZ3kiel 'L'Œil du Cyclone'）"
  },
  // モーション 下位 (非受賞の通常モーション・リール)
  { id: "bGcpESkGLzI", genre_bucket: "モーション", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・モーショングラフィックス作品（空間響図学）" },
  { id: "3910Da5fk7k", genre_bucket: "モーション", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・モーショングラフィックス作品（Voscot）" },
  { id: "1048567039", genre_bucket: "モーション", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・モーションデモリール（TAK 2024）" },
  { id: "6vJ5VwO8hnI", genre_bucket: "モーション", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・VFX & モーションショーリール（hasenpanzer）" },
  { id: "CmCxoqpSAk8", genre_bucket: "モーション", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・モーショングラフィックス（Nihe - New icon）" },
  { id: "eJpop_rbbRA", genre_bucket: "モーション", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・モーショングラフィックス（Nihe - HNY）" },
  { id: "bJ4LFnk785g", genre_bucket: "モーション", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・商用ゲームオープニングムービー（プライマルハーツ2）" },
  { id: "_q9xyoz4j0k", genre_bucket: "モーション", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・イベント告知イントロモーショングラフィックス" },
  { id: "MBLq5K_WXi8", genre_bucket: "モーション", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・3Dテキストモーショングラフィックス" },

  // ========================
  // 4. 3DCG/アニメ (3DCG / Stop-motion / Short Animation)
  // ========================
  {
    id: "vRBVWCs1KW4",
    genre_bucket: "3DCG/アニメ",
    tier_bucket: "上位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    era_bucket: "classic_archive",
    objective_tier: "S+",
    objective_band: [97, 100],
    evidence_level: "tier1_global_grand_prix",
    awards: [
      {
        name: "Cannes Film Festival",
        year: "1955",
        category: "Short Film Palme d'Or",
        sourceUrl: "https://en.wikipedia.org/wiki/Blinkity_Blank"
      }
    ],
    rationale: "カンヌ国際映画祭短編パルムドール受賞作（Norman McLaren 'Blinkity Blank'、1955年作のため classic_archive 区分）"
  },
  {
    id: "X0hyTmlsBUI",
    genre_bucket: "3DCG/アニメ",
    tier_bucket: "上位",
    craft_or_purpose: "craft_benchmark",
    award_level: "shortlist_or_selection",
    era_bucket: "modern_10y",
    objective_tier: "S-",
    objective_band: [90, 92],
    evidence_level: "tier2_oscar_shortlist",
    awards: [
      {
        name: "Academy Awards (Oscars)",
        year: "2025",
        category: "97th Animated Short Film Shortlist",
        sourceUrl: "https://prtimes.jp/main/html/rd/p/000002470.000000496.html"
      }
    ],
    rationale: "第97回米国アカデミー賞短編アニメ部門ショートリスト選出（金森慧 'Origami'）"
  },
  {
    id: "35i4zTky9pI",
    genre_bucket: "3DCG/アニメ",
    tier_bucket: "上位",
    craft_or_purpose: "craft_benchmark",
    award_level: "shortlist_or_selection",
    era_bucket: "modern_10y",
    objective_tier: "S-",
    objective_band: [90, 92],
    evidence_level: "tier2_oscar_shortlist",
    awards: [
      {
        name: "Academy Awards (Oscars)",
        year: "2019",
        category: "91st Animated Short Film Shortlist",
        sourceUrl: "https://www.oscars.org/oscars/91st-oscars-shortlists"
      }
    ],
    rationale: "第91回米国アカデミー賞短編アニメ部門ショートリスト選出（Lost & Found）"
  },
  {
    id: "vohpCZh-Qcw",
    genre_bucket: "3DCG/アニメ",
    tier_bucket: "上位",
    craft_or_purpose: "craft_benchmark",
    award_level: "shortlist_or_selection",
    era_bucket: "modern_10y",
    objective_tier: "S-",
    objective_band: [90, 92],
    evidence_level: "tier2_annecy_official_competition",
    awards: [
      {
        name: "Annecy International Animation Film Festival",
        year: "2025",
        category: "Official Short Films Competition Selection",
        sourceUrl: "https://unijapan.org/english/news/awards/festivals/annecy_international_animation_film_festival_2025.html"
      }
    ],
    rationale: "アヌシー2025公式短編コンペ選出（水尻自子『普通の生活 Ordinary Life』）"
  },
  // 3DCG/アニメ 中位
  {
    id: "jvKtHf7kDYs",
    genre_bucket: "3DCG/アニメ",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    era_bucket: "modern_10y",
    objective_tier: "A+",
    objective_band: [86, 89],
    evidence_level: "tier3_intl_festival_winner",
    awards: [
      {
        name: "東京国際映画祭",
        year: "2021",
        category: "アジアの未来 作品賞",
        sourceUrl: "https://2021.tiff-jp.net/award_winners_ja/"
      }
    ],
    rationale: "第34回東京国際映画祭 アジアの未来 作品賞"
  },
  // 3DCG/アニメ 下位 (非受賞の通常アニメPV・短編・3DCG)
  { id: "O1U55m7pTCk", genre_bucket: "3DCG/アニメ", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・短編アニメーション（Vanished in Vibration）" },
  { id: "OhHYTXfg9nQ", genre_bucket: "3DCG/アニメ", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・卒業制作アニメーション（Relocation）" },
  { id: "chcrZR8SclA", genre_bucket: "3DCG/アニメ", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・商用アニメ御礼PV（薫る花は凛と咲く）" },
  { id: "8XpGThBki3Y", genre_bucket: "3DCG/アニメ", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・商用アニメ10周年記念PV（このすば）" },
  { id: "90Q6g57jnuU", genre_bucket: "3DCG/アニメ", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・商用アニメPV（子猫の配達員うーにゃん）" },
  { id: "KOh3qsUh_9E", genre_bucket: "3DCG/アニメ", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・アニメーションMV合作（生命）" },
  { id: "bSWo5hiLRSU", genre_bucket: "3DCG/アニメ", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・自主制作Blender 3DCGアニメ" },
  { id: "GvkbAp9YZCo", genre_bucket: "3DCG/アニメ", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・自主制作短編アニメ（愛の形）" },
  { id: "T9DRgYuS1K0", genre_bucket: "3DCG/アニメ", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・360度VRアニメーション（ZOOJAZOO）" },
  { id: "5SW_6FQJuF0", genre_bucket: "3DCG/アニメ", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・自主制作3D 360 VRアニメ" },

  // ========================
  // 5. 企業映像 (Corporate / Brand Film / Tourism / Recruiting)
  // ========================
  {
    id: "UvGwIFVUK7M",
    genre_bucket: "企業映像",
    tier_bucket: "上位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    era_bucket: "modern_10y",
    objective_tier: "S+",
    objective_band: [97, 100],
    evidence_level: "tier1_global_grand_prix",
    awards: [
      {
        name: "Spikes Asia",
        year: "2025",
        category: "Film Craft Grand Prix",
        sourceUrl: "https://www.spikes.asia/news/spikes-asia-announces-its-2025-winners"
      }
    ],
    rationale: "アジア最高峰クラフト最高賞（Spikes Asia 2025 Film Craft Grand Prix — Jindal Steel）"
  },
  {
    id: "CWhNI_x9W6c",
    genre_bucket: "企業映像",
    tier_bucket: "上位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    era_bucket: "modern_10y",
    objective_tier: "S-",
    objective_band: [90, 92],
    evidence_level: "tier2_national_grand_prix",
    awards: [
      {
        name: "映文連アワード",
        year: "2025",
        category: "経済産業大臣賞",
        sourceUrl: "https://www.eibunren.or.jp/?p=7067"
      }
    ],
    rationale: "国内企業映像アワード最高賞（映文連アワード 2025 経済産業大臣賞 — MAZDA RX-7）"
  },
  // 企業映像 参考扱い（パーパス・社会派部門）
  {
    id: "D_vdPkCz23g",
    genre_bucket: "企業映像",
    tier_bucket: "参考枠",
    craft_or_purpose: "purpose_reference_only",
    award_level: "winner",
    era_bucket: "modern_10y",
    objective_tier: null,
    objective_band: null,
    evidence_level: "purpose_social_impact_reference",
    awards: [
      {
        name: "Cannes Lions",
        year: "2018",
        category: "Sustainable Development Goals (SDG) Grand Prix / Titanium Grand Prix / Direct Grand Prix",
        sourceUrl: "https://www.canneslions.com/news/creativity-can-change-the-world"
      }
    ],
    rationale: "【別枠・参考扱い】Cannes Lions 2018 SDG/Titanium/Direct GP（企画・社会派インパクト評価でありクラフト較正群から分離）"
  },
  // 企業映像 中位
  {
    id: "1S-KU2F7wc0",
    genre_bucket: "企業映像",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    era_bucket: "modern_10y",
    objective_tier: "A+",
    objective_band: [86, 89],
    evidence_level: "tier3_national_gold",
    awards: [
      {
        name: "日本国際観光映像祭",
        year: "2025",
        category: "ジャパングランプリ / 部門別最優秀賞",
        sourceUrl: "https://prtimes.jp/main/html/rd/p/000000013.000081094.html"
      }
    ],
    rationale: "日本国際観光映像祭 2025 ジャパングランプリ（南阿蘇温泉郷）"
  },
  {
    id: "8pOOxOo7YYo",
    genre_bucket: "企業映像",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    era_bucket: "modern_10y",
    objective_tier: "A+",
    objective_band: [86, 89],
    evidence_level: "tier3_national_gold",
    awards: [
      {
        name: "日本国際観光映像祭",
        year: "2026",
        category: "グランプリ（日本部門）",
        sourceUrl: "https://www.town.horonobe.lg.jp/www4/section/sangyo/le009f000001xivg.html"
      }
    ],
    rationale: "日本国際観光映像祭 2026 日本部門グランプリ（利尻礼文サロベツ国立公園）"
  },
  {
    id: "uCDUpZV3f8A",
    genre_bucket: "企業映像",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    era_bucket: "modern_10y",
    objective_tier: "A",
    objective_band: [82, 85],
    evidence_level: "tier4_regional_commendation",
    awards: [
      {
        name: "ADFEST",
        year: "2016",
        category: "Fabulous Four Commendation Certificate (New Director Lotus)",
        sourceUrl: "https://www.brandinginasia.com/adfest-fabulous-four/"
      }
    ],
    rationale: "ADFEST 2016 Fabulous Four Commendation Certificate受賞（Brushing Up）"
  },
  {
    id: "9NzQ3G6rY5M",
    genre_bucket: "企業映像",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    era_bucket: "modern_10y",
    objective_tier: "A",
    objective_band: [82, 85],
    evidence_level: "tier4_national_silver",
    awards: [
      {
        name: "日本国際観光映像祭",
        year: "2025",
        category: "日本部門 City Promotion 優秀賞",
        sourceUrl: "https://prtimes.jp/main/html/rd/p/000000007.000144033.html"
      }
    ],
    rationale: "日本国際観光映像祭 2025 部門優秀賞（熊本県和水町）"
  },
  {
    id: "p4eAR2Gw5RU",
    genre_bucket: "企業映像",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "shortlist_or_selection",
    era_bucket: "modern_10y",
    objective_tier: "A-",
    objective_band: [78, 81],
    evidence_level: "tier5_national_official_selection",
    awards: [
      {
        name: "日本国際観光映像祭",
        year: "2025",
        category: "日本部門2025（入選）",
        sourceUrl: "https://jwtff.world/aiovg_videos/2025_japan_045"
      }
    ],
    rationale: "日本国際観光映像祭 2025 日本部門入選（公式ページ記載の「入選」に合わせてA-へ下方修正）"
  },
  {
    id: "V6XHz7tqGVM",
    genre_bucket: "企業映像",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "shortlist_or_selection",
    era_bucket: "modern_10y",
    objective_tier: "A-",
    objective_band: [78, 81],
    evidence_level: "tier5_regional_official_selection",
    awards: [
      {
        name: "ADFEST",
        year: "2016",
        category: "Fabulous Four Official Selection (New Director Lotus)",
        sourceUrl: "https://adfest.com/Home/News/detail.html?id=12075"
      }
    ],
    rationale: "ADFEST 2016 Fabulous Four公式選出（受賞の1ランク下 — Beautiful Lie）"
  },
  {
    id: "9waEFmHUNdk",
    genre_bucket: "企業映像",
    tier_bucket: "中位",
    craft_or_purpose: "craft_benchmark",
    award_level: "winner",
    era_bucket: "modern_10y",
    objective_tier: "A-",
    objective_band: [78, 81],
    evidence_level: "tier5_curated_or_merit",
    awards: [
      {
        name: "日本国際観光映像祭",
        year: "2025",
        category: "観客賞",
        sourceUrl: "https://prtimes.jp/main/html/rd/p/000000187.000017308.html"
      }
    ],
    rationale: "日本国際観光映像祭 2025 観客賞（大分県豊後大野市）"
  },
  // 企業映像 下位 (非受賞の通常商用企業映像)
  { id: "-PXeNWSj3Y0", genre_bucket: "企業映像", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・通常企業PRムービー（神戸鈑金工業）" },
  { id: "-nr56fLZ11o", genre_bucket: "企業映像", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・通常企業ブランデッド映像（Kezuru実験）" },
  { id: "-BVWPusea_A", genre_bucket: "企業映像", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・通常企業採用動画（通信会社・営業社員PV）" },
  { id: "-5fhRq5PV2o", genre_bucket: "企業映像", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・通常サービス紹介動画（finbee）" },
  { id: "4PojHU4ckSk", genre_bucket: "企業映像", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・通常企業OEM事業紹介動画（ティー・シー・ピー）" },
  { id: "2NOefVvwLIM", genre_bucket: "企業映像", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・通常採用OP動画（タスク整体院グループ）" },
  { id: "0oioI53EGU0", genre_bucket: "企業映像", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・通常企業サービス紹介動画（Ascent Business Consulting）" },
  { id: "7jCvHsi6mLQ", genre_bucket: "企業映像", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・通常社長メッセージ採用動画（斉藤木工所）" },
  { id: "hJqVpUoNVqE", genre_bucket: "企業映像", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・通常社員密着採用動画" },
  { id: "Z-nPJFF1PYY", genre_bucket: "企業映像", tier_bucket: "下位", craft_or_purpose: "non_award_baseline", award_level: "non_awarded", era_bucket: "modern_10y", objective_tier: null, objective_band: null, evidence_level: "baseline_non_awarded_commercial", awards: [], rationale: "非受賞・採用ピッチ動画（メドコム）" },
];

const conn = await mysql.createConnection({
  uri: dbUrl,
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});

const ids = SPECS.map(s => s.id);
const dupCheck = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dupCheck.length) throw new Error("Duplicate IDs found: " + dupCheck.join(", "));

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
if (missing.length) throw new Error("Missing IDs in TiDB: " + missing.join(", "));

const out = SPECS.map(spec => {
  const row = byId.get(spec.id);
  const status = row.analysisStatus || "full_analysis";
  if (status === "provisional") throw new Error(`Provisional video forbidden: ${row.id}`);
  if (spec.craft_or_purpose === "non_award_baseline" && spec.objective_tier !== null) {
    throw new Error(`non_award_baseline must have objective_tier=null: ${row.id}`);
  }
  for (const a of spec.awards) {
    if (!a.sourceUrl) throw new Error(`Missing sourceUrl on ${row.id}`);
    const u = new URL(a.sourceUrl);
    if ((u.pathname === "/" || u.pathname === "") && !u.search) {
      throw new Error(`Homepage-only sourceUrl forbidden on ${row.id}: ${a.sourceUrl}`);
    }
  }
  const embedStatus = row.embedStatus || "available";
  const playableViaYtdlp = embedStatus !== "restricted" ? true : YTDLP_VERIFIED_RESTRICTED.has(row.id);
  return {
    id: row.id,
    title: row.title,
    platform: row.platform,
    videoUrl: row.videoUrl,
    embed_status: embedStatus,
    playable_via_ytdlp: playableViaYtdlp,
    genre_bucket: spec.genre_bucket,
    tier_bucket: spec.tier_bucket,
    craft_or_purpose: spec.craft_or_purpose,
    award_level: spec.award_level,
    era_bucket: spec.era_bucket,
    current_db_rating: row.aiOverallRating,
    current_db_score: row.aiOverallScore,
    current_db_analysis_status: status,
    awards: spec.awards,
    objective_tier: spec.objective_tier,
    objective_band: spec.objective_band,
    evidence_level: spec.evidence_level,
    rationale: spec.rationale,
  };
});

fs.writeFileSync(
  path.join(REPO_ROOT, "analysis", "golden_benchmark.json"),
  JSON.stringify(out, null, 2) + "\n",
  "utf8"
);

const genres = ["CM", "MV", "モーション", "3DCG/アニメ", "企業映像"];
const tiers = ["上位", "中位", "下位", "参考枠"];
console.log(`Wrote ${out.length} verified entries to analysis/golden_benchmark.json`);
console.log("\n=== Genre x Tier Matrix ===");
for (const g of genres) {
  const c = tiers.map(t => out.filter(x => x.genre_bucket === g && x.tier_bucket === t).length);
  const tot = c.reduce((a, b) => a + b, 0);
  console.log(`${g.padEnd(10)} | 上位:${c[0]} | 中位:${c[1]} | 下位:${c[2]} | 参考枠:${c[3]} | 計:${tot}`);
}
console.log("\n=== By craft_or_purpose ===");
for (const k of ["craft_benchmark", "non_craft_award_reference", "purpose_reference_only", "non_award_baseline"]) {
  console.log(`${k}: ${out.filter(x => x.craft_or_purpose === k).length}`);
}
console.log("\n=== By objective_tier (craft_benchmark only) ===");
for (const t of ["S+","S","S-","A+","A","A-","B+"]) {
  const c = out.filter(x => x.objective_tier === t).length;
  if (c > 0) console.log(`${t.padEnd(3)}: ${c}`);
}
console.log(`null (non_award_baseline + reference): ${out.filter(x => x.objective_tier === null).length}`);
console.log(`embed_status=restricted: ${out.filter(x => x.embed_status === "restricted").length}`);
console.log(`provisional_count: ${out.filter(x => x.current_db_analysis_status === "provisional").length}`);
console.log(`era_bucket=classic_archive: ${out.filter(x => x.era_bucket === "classic_archive").map(x => x.id).join(", ")}`);
