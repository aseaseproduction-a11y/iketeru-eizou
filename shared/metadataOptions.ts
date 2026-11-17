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
  "MV", "ブランディングムービー", "プロモーション", "事業・サービス紹介", "OPED", "インタビュー", "ティザー", "アート", "企画系", "その他",
] as const;

export const EXPRESSION_OPTIONS = [
  "2D", "3D", "アニメーション", "実写", "イラスト", "実写+アニメーション", "生成AI",
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
