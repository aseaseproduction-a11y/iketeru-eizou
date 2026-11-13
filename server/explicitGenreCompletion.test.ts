import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("explicit genre completion script", () => {
  it("maps an explicit MV marker to the MV genre with an auditable evidence type", () => {
    const source = readFileSync(new URL("../scripts/complete-explicit-genres.mjs", import.meta.url), "utf8");
    expect(source).toContain('slug: "mv"');
    expect(source).toContain("Music\\s*Video");
    expect(source).toContain("explicit_title_or_official_tag");
  });
});
