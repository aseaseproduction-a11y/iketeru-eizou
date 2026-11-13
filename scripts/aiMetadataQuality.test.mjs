import { describe, expect, it } from "vitest";
import { assessAiCandidate, evidenceIsGrounded, identityMatches, valuesHaveDirectCues } from "./aiMetadataQuality.mjs";

const input = {
  id: "t5jPgM_VKZo",
  title: "みみめめMIMI「Mr. Darling」MV",
  videoUrl: "https://www.youtube.com/watch?v=t5jPgM_VKZo",
  source: "notion",
  sourceLabel: "Notion事例集",
  channelTitle: "みみめめMIMI",
  tags: ["MV", "音楽"],
  publicMetadata: { description: "MVの公式動画です", channelTitle: "みみめめMIMI", tags: ["Music Video"] },
  curationNote: {},
};

describe("AI metadata quality gate", () => {
  it("accepts only an identity-matched, high-confidence value with a verbatim input quote", () => {
    const candidate = {
      identity: { videoId: input.id, videoUrl: input.videoUrl, title: input.title },
      genres: ["mv"],
      products: [], directions: [], tones: [], purposes: ["MV"], expressions: [],
      privateRating: "", aiOverallRating: "", aiDirectionRating: "", aiTechniqueRating: "", aiAnalysis: "",
      confidence: { genres: 0.95, products: 0, directions: 0, tones: 0, purposes: 0.95, expressions: 0, ratings: 0, analysis: 0 },
      evidence: { genres: ["MV"], products: [], directions: [], tones: [], purposes: ["MV"], expressions: [], privateRating: [], aiOverallRating: [], aiDirectionRating: [], aiTechniqueRating: [], aiAnalysis: [] },
    };
    expect(identityMatches(candidate, input)).toBe(true);
    expect(assessAiCandidate(candidate, input).eligible).toEqual(["genres", "purposes"]);
  });

  it("rejects a candidate when the model returns a mismatched identity", () => {
    const candidate = { identity: { videoId: "wrong", videoUrl: input.videoUrl, title: input.title } };
    expect(identityMatches(candidate, input)).toBe(false);
    expect(assessAiCandidate(candidate, input).rejected.genres).toBe("identity_mismatch");
  });

  it("rejects unsupported evidence even when the score is high", () => {
    expect(evidenceIsGrounded(["動画には高精細なVFXがある"], input)).toBe(false);
  });

  it("accepts a verbatim quote from official public metadata as evidence", () => {
    expect(evidenceIsGrounded(["MVの公式動画です"], input)).toBe(true);
  });

  it("rejects broad genre labels inferred only from CM-style wording", () => {
    expect(valuesHaveDirectCues("genres", ["web-cm"], ["CM風"])).toBe(false);
  });

  it("accepts a food category only when the evidence names food or beverage directly", () => {
    expect(valuesHaveDirectCues("products", ["food"], ["アポロチョコ"])).toBe(true);
  });

  it("rejects tone labels without an explicit category-to-evidence rule", () => {
    expect(valuesHaveDirectCues("tones", ["emotional"], ["哀愁を描いた"])).toBe(false);
  });
});
