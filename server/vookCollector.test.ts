import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Vook official card collector", () => {
  it("requires the Vook card ID, external video URL, title, and official tags", () => {
    const source = readFileSync(new URL("../scripts/collect-vook-iketeru-candidates.mjs", import.meta.url), "utf8");
    expect(source).toContain('id="iketeru_');
    expect(source).toContain("item-title");
    expect(source).toContain("item-tags-tag");
    expect(source).toContain('source: "vook_iketeru"');
  });
});
