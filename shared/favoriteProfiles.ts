/** 名前付きお気に入りプロフィールの入力制約。 */
export const FAVORITE_PROFILE_NAME_MAX_LENGTH = 80;

/**
 * 表示名は入力時の大文字・小文字を維持し、重複判定だけ正規化して行う。
 * 全半角・連続空白の差を吸収し、日本語・英字混在の共有端末でも同一名を作らない。
 */
export function normalizeFavoriteProfileName(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ja-JP");
}

/** 制作者名のお気に入りの重複判定用。表示名はDBへ原文の整形済み表記を保存する。 */
export function normalizeFavoriteCreatorName(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ja-JP");
}

export function cleanFavoriteDisplayName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}
