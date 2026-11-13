import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("cross-source explicit tag completion", () => {
  it("uses deterministic tag equality and skips filled category fields", () => {
    const audit = readFileSync(new URL("../scripts/audit-cross-source-explicit-tags.mjs", import.meta.url), "utf8");
    const apply = readFileSync(new URL("../scripts/apply-cross-source-explicit-tags.mjs", import.meta.url), "utf8");
    expect(audit).toContain("mapping.get(tag)");
    expect(audit).toContain("if (existing.length) continue");
    expect(apply).toContain("if (existing.length)");
    expect(apply).toContain("official_explicit_tag_cross_source");
  });
});
