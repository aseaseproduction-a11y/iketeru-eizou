import { describe, expect, it } from "vitest";
import { toggleStoredFavorite } from "./useCreatorTools";

describe("制作者のお気に入り", () => {
  it("制作者名を重複なく追加し、同じ名前の再操作で解除する", () => {
    const added = toggleStoredFavorite(["WOW inc."], "土岐 彩乃");
    expect(added).toEqual(["WOW inc.", "土岐 彩乃"]);
    expect(toggleStoredFavorite(added, "WOW inc.")).toEqual(["土岐 彩乃"]);
  });
});
