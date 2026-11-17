export const GENRE_OPTIONS = [
  { name: "TV CM", slug: "tv-cm" },
  { name: "Web CM", slug: "web-cm" },
  { name: "ブランデッドムービー", slug: "branded-movie" },
  { name: "YouTube / SNS / 縦型動画", slug: "youtube-sns" },
  { name: "MV", slug: "mv" },
  { name: "企業 / 商品VP / コンテスト作品", slug: "corporate" },
  { name: "映画 / ドラマ / ショートフィルム", slug: "film" },
  { name: "オープニング映像", slug: "opening" },
  { name: "メイキング / Behind The Scenes", slug: "making" },
  { name: "ドキュメンタリー", slug: "documentary" },
  { name: "ティザー / トレーラー / PV", slug: "teaser-trailer" },
  { name: "デモリール / ショーリール", slug: "showreel" },
  { name: "ライブ / イベント / 展示映像", slug: "event-live" },
  { name: "解説 / ハウツー / チュートリアル", slug: "how-to" },
  { name: "アート作品 / 自主制作 / 実験映像", slug: "concept-art" },
] as const;

export const PRODUCT_OPTIONS = [
  { name: "美容 / 化粧品", slug: "beauty" },
  { name: "ファッション / アパレル", slug: "fashion" },
  { name: "食品 / 飲料 / 飲食", slug: "food" },
  { name: "日用品 / 防犯 / 警備", slug: "daily" },
  { name: "自動車 / バイク", slug: "automotive" },
  { name: "ゲーム / アプリ / 玩具", slug: "gaming" },
  { name: "IT / 通信 / ネットサービス", slug: "it" },
  { name: "旅行 / 宿泊", slug: "travel" },
  { name: "医療 / 医薬", slug: "medical" },
  { name: "住宅 / 不動産 / 建設", slug: "real-estate" },
  { name: "交通 / 物流 / 産業素材", slug: "transport" },
  { name: "娯楽 / アミューズメント", slug: "entertainment" },
  { name: "精密機器 / 家具 / 電化製品", slug: "electronics" },
  { name: "スポーツ / 健康 / フィットネス", slug: "sports" },
  { name: "教育 / 出版 / メディア", slug: "education" },
  { name: "金融 / 保険 / フィンテック", slug: "finance" },
  { name: "音楽 / アーティスト", slug: "music-artist" },
  { name: "小売 / 百貨店 / EC", slug: "retail-ec" },
  { name: "官公庁 / 自治体 / 公共・観光インフラ", slug: "public-regional" },
  { name: "採用 / 人材 / 企業ブランド", slug: "recruiting" },
] as const;

export const DIRECTION_OPTIONS = [
  { name: "実写", slug: "live-action" },
  { name: "合成 / VFX / 3DCG", slug: "vfx-3dcg" },
  { name: "モーショングラフィックス", slug: "motion-graphics" },
  { name: "生成AI", slug: "generative-ai" },
  { name: "カメラワーク / ドローン・空撮", slug: "camera-work" },
  { name: "モーションコントロールカメラ", slug: "motion-control" },
  { name: "ストップモーション / タイムラプス", slug: "stop-motion" },
  { name: "ボリュメトリック / バーチャルプロダクション", slug: "virtual-production" },
  { name: "イラスト / アニメーション", slug: "illustration" },
  { name: "ワンカット / 長回し", slug: "one-take" },
  { name: "ダンス / コレオグラフィ", slug: "choreography" },
  { name: "リリック / タイポグラフィ", slug: "typography" },
  { name: "ミニチュア / 特撮 / アナログ造形", slug: "miniature-analog" },
  { name: "音ハメ / リズム編集", slug: "sound-sync" },
  { name: "ドラマ / ストーリーテリング", slug: "storytelling" },
] as const;

export const TONE_OPTIONS = [
  { name: "スタイリッシュ / クール", slug: "stylish" },
  { name: "コミカル / ユーモラス / カオス", slug: "comical" },
  { name: "エモーショナル / 感動的", slug: "emotional" },
  { name: "洗練 / ラグジュアリー", slug: "luxury" },
  { name: "ポップ / エネルギッシュ / 爽快", slug: "energetic" },
  { name: "ほっこり / 温かみ / 親しみやすい", slug: "warm" },
  { name: "ダーク / シリアス / ミステリアス", slug: "dark" },
  { name: "壮大 / エピック / シネマティック", slug: "epic" },
  { name: "レトロ / ノスタルジック / 昭和・平成", slug: "retro" },
  { name: "シュール / サイケデリック / アバンギャルド", slug: "surreal" },
  { name: "リアル / ドキュメンタリー調 / 素朴", slug: "documentary-raw" },
  { name: "近未来 / サイバー / テック", slug: "futuristic" },
] as const;

export function toCategoryNameMap(items: ReadonlyArray<{ slug: string; name: string }>): Record<string, string> {
  return Object.fromEntries(items.map((item) => [item.slug, item.name]));
}

export const PURPOSE_OPTIONS = [
  "MV", "ブランディングムービー", "プロモーション", "事業・サービス紹介", "OPED", "インタビュー", "ティザー", "アート", "企画系",
  "採用・リクルーティング", "ハウツー・解説", "イベント・空間演出", "その他",
] as const;

export const EXPRESSION_OPTIONS = [
  "2D", "3D", "アニメーション", "実写", "イラスト", "実写+アニメーション", "生成AI",
  "コマ撮り・ストップモーション", "タイポグラフィ・グラフィック",
] as const;

type AllowedOption = (typeof PURPOSE_OPTIONS)[number] | (typeof EXPRESSION_OPTIONS)[number];

const OPTION_ALIASES: Record<string, AllowedOption> = {
  "実写＋アニメーション": "実写+アニメーション",
  "実写+アニメ": "実写+アニメーション",
  "実写＋アニメ": "実写+アニメーション",
  "2d": "2D",
  "3d": "3D",
  "生成ai": "生成AI",
  "oped": "OPED",
};

export function restrictToAllowedOptions(values: string[], options: readonly string[]) {
  const allowed = new Set(options);
  const normalize = (raw: string) => {
    const value = raw.trim();
    const direct = OPTION_ALIASES[value] ?? OPTION_ALIASES[value.toLowerCase()] ?? value;
    if (allowed.has(direct)) return direct;
    if (allowed.has("ブランディングムービー") && /(?:商品|企業|ブランド).*ブランディング|ブランディング(?:動画|映像)?/i.test(value)) return "ブランディングムービー";
    if (allowed.has("プロモーション") && /キャンペーン|販促|プロモーション/i.test(value)) return "プロモーション";
    if (allowed.has("実写+アニメーション") && /実写.*(?:2d|3d|アニメーション|アニメ)|(?:2d|3d|アニメーション|アニメ).*実写/i.test(value)) return "実写+アニメーション";
    if (allowed.has("実写") && /^実写(?:コンポジット|合成|撮影)?$/i.test(value)) return "実写";
    return value;
  };
  return Array.from(new Set(values.map(normalize).filter((value) => allowed.has(value))));
}
