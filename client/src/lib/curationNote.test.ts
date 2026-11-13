import { describe, expect, it } from "vitest";
import { extractClientPitch, upsertClientPitchInAnalysis } from "./curationNote";

describe("curationNote clientPitch helpers", () => {
  it("prefers explicit curationNote.clientPitch and falls back to aiAnalysis section", () => {
    expect(
      extractClientPitch({
        curationNote: { purpose: "", background: "", evaluation: "", clientPitch: "直接保存フレーズ", sourceUrls: [] },
        aiAnalysis: "### クライアント説明用・企画意図3行まとめ\n分析内フレーズ",
      })
    ).toBe("直接保存フレーズ");

    expect(
      extractClientPitch({
        curationNote: { purpose: "", background: "", evaluation: "", sourceUrls: [] },
        aiAnalysis: "## 9. 実務提案\n- 通常項目\n\n### クライアント説明用・企画意図3行まとめ\n1. 行1\n2. 行2\n3. 行3",
      })
    ).toBe("1. 行1\n2. 行2\n3. 行3");
  });

  it("upserts and updates the section in aiAnalysis cleanly", () => {
    const initial = "## 9. 実務提案\n- 本文";
    const inserted = upsertClientPitchInAnalysis(initial, "1. A\n2. B\n3. C");
    expect(inserted).toContain("### クライアント説明用・企画意図3行まとめ\n1. A\n2. B\n3. C");

    const updated = upsertClientPitchInAnalysis(inserted, "1. X\n2. Y\n3. Z");
    expect(updated).not.toContain("1. A");
    expect(updated).toContain("1. X\n2. Y\n3. Z");
  });
});
