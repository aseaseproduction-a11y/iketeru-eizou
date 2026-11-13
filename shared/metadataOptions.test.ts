import { describe, expect, it } from "vitest";
import { EXPRESSION_OPTIONS, PURPOSE_OPTIONS, restrictToAllowedOptions } from "./metadataOptions";

describe("用途・表現の選択肢制約", () => {
  it("用途は指定された選択肢だけを重複なく保存対象にする", () => {
    expect(restrictToAllowedOptions(["プロモーション", "独自用途", "MV", "プロモーション"], PURPOSE_OPTIONS)).toEqual(["プロモーション", "MV"]);
  });

  it("表現は許容値に限定し、実写＋アニメーションの表記ゆれを正規化する", () => {
    expect(restrictToAllowedOptions(["実写＋アニメーション", "3d", "VFX", "生成ai"], EXPRESSION_OPTIONS)).toEqual(["実写+アニメーション", "3D", "生成AI"]);
  });

  it("既存の明確な近接表現を許容選択肢へ縮約し、意味が不明確な独自値は除外する", () => {
    expect(restrictToAllowedOptions(["商品ブランディング", "夏季キャンペーン", "物語体験の提供"], PURPOSE_OPTIONS)).toEqual(["ブランディングムービー", "プロモーション"]);
    expect(restrictToAllowedOptions(["実写+2Dアニメーション", "実写コンポジット", "MV文法"], EXPRESSION_OPTIONS)).toEqual(["実写+アニメーション", "実写"]);
  });
});
