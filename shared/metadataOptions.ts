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
