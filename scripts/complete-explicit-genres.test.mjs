import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("explicit genre completion", () => {
  it("recognizes an explicit MV marker before AI analysis", () => {
    const source = readFileSync(new URL("./complete-explicit-genres.mjs", import.meta.url), "utf8");
    expect(source).toContain("Music\\s*Video");
    expect(source).toContain("slug: \"mv\"");
    expect(source).toContain("explicit_title_or_official_tag");
  });
});
