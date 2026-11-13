import { describe, expect, it } from "vitest";
import { matchesAnalysisIdentity } from "../scripts/analysis-identity.mjs";

const target = {
  id: "video-001",
  title: "正しい映像タイトル",
  videoUrl: "https://www.youtube.com/watch?v=abcdefghijk",
};

describe("分析結果の三重照合", () => {
  it("動画ID・URL・タイトルがすべて一致する場合だけ反映を許可する", () => {
    expect(matchesAnalysisIdentity({
      target,
      existing: { ...target },
      output: { video_title: target.title, video_url: target.videoUrl },
    })).toBe(true);
  });

  it("別動画のタイトルまたはURLを返した分析結果を拒否する", () => {
    expect(matchesAnalysisIdentity({
      target,
      existing: { ...target },
      output: { video_title: "別動画", video_url: "https://www.youtube.com/watch?v=zzzzzzzzzzz" },
    })).toBe(false);
  });

  it("分析結果が動画IDだけを返してURL・タイトルがない旧形式を拒否する", () => {
    expect(matchesAnalysisIdentity({
      target,
      existing: { ...target },
      output: { id: target.id },
    })).toBe(false);
  });
});
