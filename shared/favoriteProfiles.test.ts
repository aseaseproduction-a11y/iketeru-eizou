import { describe, expect, it } from "vitest";
import { cleanFavoriteDisplayName, normalizeFavoriteCreatorName, normalizeFavoriteProfileName } from "./favoriteProfiles";

describe("名前付きお気に入りプロフィール", () => {
  it("表示名は全半角と連続空白を整えて保持する", () => {
    expect(cleanFavoriteDisplayName("  千葉　 太郎  ")).toBe("千葉 太郎");
  });

  it("プロフィール名の重複判定では全半角・大文字小文字・空白を吸収する", () => {
    expect(normalizeFavoriteProfileName("  CHIBA　Studio ")).toBe(normalizeFavoriteProfileName("chiba studio"));
  });

  it("制作者のお気に入りも表記差を吸収して重複を防ぐ", () => {
    expect(normalizeFavoriteCreatorName(" LIGHT  THE  WAY Inc. ")).toBe(normalizeFavoriteCreatorName("light the way inc."));
  });
});
