/**
 * Shared scene search metadata, synonyms, categories, and normalization helpers.
 * Used by server tRPC API, client fallback search, and TiDB sync scripts.
 */

export type SceneScoreFilter =
  | "all"
  | "calibrated_only"
  | "score_78_plus"
  | "score_83_plus";

export interface KeywordCategory {
  id: string;
  name: string;
  icon: string;
  keywords: { text: string; count: number }[];
}

export interface CategoryDefinition {
  id: string;
  name: string;
  icon: string;
  seedWords: string[];
}

export const SCENE_STOP_WORDS = new Set([
  "視覚", "聴覚", "制約", "事実", "演出上", "意図", "確認上", "観察", "記録", "範囲",
  "年前", "下部", "上部", "左部", "右部", "中央", "左右", "上下", "前後", "周囲", "背後",
  "画面", "映像", "動画", "場面", "シーン", "パート", "セクション", "カット", "ショット",
  "カメラ", "フレーム", "レンズ", "アングル", "サイズ", "状態", "様子", "瞬間", "動き",
  "変化", "効果", "印象", "構成", "展開", "導入", "突入", "開始", "終了", "直後", "直前",
  "全体", "一部", "複数", "連続", "同時", "交互", "再提示", "再利用", "象徴的", "特徴的",
  "効果的", "圧倒的", "徹底的", "規則的", "直線的", "立体的", "視覚的", "聴覚的", "構造的",
  "空間", "時間", "速度", "方向", "位置", "配置", "登場", "出現", "表示", "強調", "表現",
  "撮影", "編集", "演出", "処理", "設定", "使用", "活用", "採用", "維持", "形成", "移行",
  "転換", "接続", "連動", "同期", "対比", "詳細", "明確", "鮮明", "完全", "最後", "最初",
  "冒頭", "中盤", "終盤", "後半", "前半", "背景", "前景", "手前", "奥側", "内側", "外側",
  "アスペクト比", "画面比率", "シネマスコープ", "推測", "概要欄", "記載", "スタート",
]);

export const SCENE_SYNONYM_MAP: Record<string, string[]> = {
  "夕日": ["夕日", "夕陽", "夕焼け", "日没", "マジックアワー", "黄昏", "サンセット", "sunset", "オレンジ", "茜色"],
  "夕陽": ["夕日", "夕陽", "夕焼け", "日没", "マジックアワー", "黄昏", "サンセット", "sunset", "オレンジ"],
  "海": ["海", "海岸", "砂浜", "ビーチ", "波", "水着", "ocean", "beach", "sea", "水面", "波打ち際"],
  "雨": ["雨", "豪雨", "雨滴", "水滴", "傘", "レイン", "rain", "雨降り", "土砂降り", "台風"],
  "夜": ["夜", "夜景", "深夜", "暗闇", "ネオン", "ナイト", "night", "照明", "街灯"],
  "車": ["車", "自動車", "スポーツカー", "ドライブ", "カースタント", "走行", "car", "ヘッドライト"],
  "走る": ["走る", "疾走", "ランニング", "ダッシュ", "逃げる", "駆け抜ける", "スピード"],
  "踊る": ["踊る", "ダンス", "ステップ", "振付", "コレオ", "dance", "ダンサー", "群舞"],
  "光": ["光", "発光", "ストロボ", "閃光", "レンズフレア", "グロー", "逆光", "ライト", "light"],
  "街": ["街", "都市", "ビル", "東京", "ストリート", "路地裏", "交差点", "city", "street"],
  "煙": ["煙", "スモーク", "フォグ", "湯気", "爆発", "火花", "smoke", "fog"],
  "花": ["花", "桜", "花びら", "植物", "自然", "flower"],
  "空": ["空", "青空", "雲", "星空", "宇宙", "sky", "クラウド"],
  "美しい": ["美しい", "エモーショナル", "綺麗", "幻想的", "シネマティック", "絶景", "美麗"],
  "狂気": ["狂気", "ホラー", "不気味", "恐怖", "怪作", "カルト", "暴走"],
  "笑い": ["笑い", "笑顔", "コミカル", "ユーモア", "爆笑", "微笑み", "スマイル"],
  "マッチカット": ["マッチカット", "match cut", "グラフィックマッチ", "形状一致"],
  "ストップモーション": ["ストップモーション", "コマ撮り", "stop motion", "クレイアニメ", "人形アニメ"],
  "メタモルフォーゼ": ["メタモルフォーゼ", "モーフ", "モーフィング", "変身", "形態変化"],
  "ワンカット": ["ワンカット", "長回し", "one take", "シームレス"],
  "音ハメ": ["音ハメ", "ビートシンク", "リズム編集", "ビートに合わせ", "シンクロ"],
  "キネティックタイポグラフィ": ["キネティックタイポグラフィ", "タイポグラフィ", "モーショングラフィックス"],
  "トラッキング": ["トラッキング", "カメラトラック", "追従", "tracking"],
  "ドリー": ["ドリー", "プッシュイン", "トラックイン", "ドリーアウト", "dolly"],
  "手持ち": ["手持ち", "ハンディ", "ハンディカメラ", "handheld"],
  "フォーカス送り": ["フォーカス送り", "ラックフォーカス", "ピント移動", "ピント送り"],
  "画面分割": ["画面分割", "スプリットスクリーン", "マルチ画面", "split screen"],
  "vfx": ["vfx", "コンポジット", "合成", "cg合成", "視覚効果"],
  "グリッチ": ["グリッチ", "データモッシュ", "デジタルノイズ", "走査線", "glitch"],
  "ロトスコープ": ["ロトスコープ", "rotoscope", "トレース"],
  "タイムラプス": ["タイムラプス", "ハイパーラプス", "timelapse"],
  "ジャンプカット": ["ジャンプカット", "カット割り", "jump cut"],
  "ズーム": ["ズーム", "ズームイン", "ズームアウト", "zoom"],
  "スピードランプ": ["スピードランプ", "緩急", "speed ramp", "スローモーション"],
};

export const SCENE_CATEGORY_DEFINITIONS: CategoryDefinition[] = [
  {
    id: "situation",
    name: "シチュエーション",
    icon: "📍",
    seedWords: [
      "空", "青空", "夜", "夜景", "街", "都会", "ストリート", "路地裏", "部屋", "室内",
      "海", "海岸", "砂浜", "水面", "雨", "水滴", "雲", "星空", "宇宙", "自然",
      "森", "夕日", "夕暮れ", "スタジアム", "屋上", "トンネル", "駅", "電車", "階段",
    ],
  },
  {
    id: "technique",
    name: "演出技法・編集",
    icon: "🎬",
    seedWords: [
      "マッチカット", "ジャンプカット", "ワンカット", "スピードランプ", "音ハメ",
      "ストップモーション", "メタモルフォーゼ", "ロトスコープ", "カットアウト", "セルルック",
      "キネティックタイポグラフィ", "モーショングラフィックス", "コラージュ", "3DCG", "VFX",
      "コンポジット", "画面分割", "トラッキング", "ドリー", "手持ち", "ズーム",
      "ローアングル", "俯瞰", "クローズアップ", "フォーカス送り", "被写界深度",
      "スローモーション", "タイムラプス", "グリッチ", "色収差", "ワイプ",
      "プロジェクション", "手描き", "ミニチュア", "シルエット", "逆光", "ストロボ",
    ],
  },
  {
    id: "visual",
    name: "演出・カメラ・VFX",
    icon: "🎥",
    seedWords: [
      "光", "逆光", "ストロボ", "フラッシュ", "アニメーション", "手描き", "ドローイング",
      "文字", "タイポグラフィ", "モーショングラフィックス", "グリッチ", "ノイズ", "色収差",
      "3DCG", "セルルック", "シルエット", "被写界深度", "ピント", "スローモーション",
      "俯瞰", "ドローン", "万華鏡", "画面分割", "スプリットスクリーン", "コラージュ", "アイソメトリック", "実写",
    ],
  },
  {
    id: "action",
    name: "アクション・被写体",
    icon: "⚡",
    seedWords: [
      "ダンス", "群舞", "ステップ", "車", "クラシックカー", "ドライブ", "走行", "走る", "疾走",
      "女性", "少女", "男性", "目", "瞳", "指先", "炎", "火花", "花火", "煙", "スモーク",
      "花", "桜", "植物", "紙吹雪", "風船", "昆虫", "バグ", "自転車",
    ],
  },
  {
    id: "mood",
    name: "ムード・世界観",
    icon: "🎨",
    seedWords: [
      "ポップ", "パステル", "可愛い", "静寂", "ミニマル", "エモーショナル", "祝祭", "多幸感",
      "レトロ", "シネマティック", "ダーク", "狂気", "不気味", "サイバーパンク", "幻想的", "ノスタルジー",
    ],
  },
  {
    id: "music",
    name: "音楽・サウンド",
    icon: "🎵",
    seedWords: [
      "ビート", "キック", "ギター", "ピアノ", "アコースティック", "ラップ", "初音ミク",
      "合唱", "ウィスパーボイス", "フューチャーベース", "ベースミュージック", "ボカロ", "VTuber",
    ],
  },
];

export function parseQueryWords(query: string): string[] {
  if (!query) return [];
  return query
    .trim()
    .split(/[\s,、。!！?？#+＋]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
}

export function getSynonymsForWord(word: string): string[] {
  const normalized = word.trim().toLowerCase();
  if (!normalized) return [];
  const set = new Set<string>([normalized]);
  for (const [key, syns] of Object.entries(SCENE_SYNONYM_MAP)) {
    const keyLower = key.toLowerCase();
    if (normalized.includes(keyLower) || keyLower.includes(normalized)) {
      syns.forEach((s) => set.add(s.toLowerCase()));
    }
  }
  return Array.from(set);
}

export function extractSceneKeywords(
  shotTitle: string,
  description: string,
  audioText: string = "",
): string[] {
  const combined = `${shotTitle} ${description} ${audioText}`.trim();
  if (!combined) return [];
  const combinedLower = combined.toLowerCase();
  const matched = new Set<string>();

  const kwRegex = /#([\w\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fffー]+)/g;
  let km: RegExpExecArray | null;
  while ((km = kwRegex.exec(combined)) !== null) {
    const val = km[1].trim();
    if (val.length >= 2 && !SCENE_STOP_WORDS.has(val)) matched.add(val);
  }

  const kataRegex = /[ァ-ヶー]{3,14}/g;
  let ktm: RegExpExecArray | null;
  while ((ktm = kataRegex.exec(`${shotTitle} ${description}`)) !== null) {
    const val = ktm[0].replace(/^[・ー]+|[・]+$/g, "");
    if (val.length >= 3 && !SCENE_STOP_WORDS.has(val)) matched.add(val);
  }

  for (const cat of SCENE_CATEGORY_DEFINITIONS) {
    for (const seed of cat.seedWords) {
      if (combinedLower.includes(seed.toLowerCase())) {
        matched.add(seed);
      }
    }
  }

  return Array.from(matched).slice(0, 14);
}

export function buildSceneSearchText(fields: {
  shotTitle?: string;
  description?: string;
  audioText?: string;
  keywords?: string[];
  videoTitle?: string;
}): string {
  return [
    fields.shotTitle || "",
    fields.description || "",
    fields.audioText || "",
    ...(fields.keywords || []),
    fields.videoTitle || "",
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
