import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Vook official-tag completion", () => {
  it("uses explicit Vook tags and only fills empty category fields", () => {
    const source = readFileSync(new URL("../scripts/complete-vook-explicit-tags.mjs", import.meta.url), "utf8");
    expect(source).toContain('"TV CM", "tv-cm"');
    expect(source).toContain('"実写", "live-action"');
    expect(source).toContain("if (existing.length > 0)");
    expect(source).toContain("official_vook_card_tags");
  });
});
