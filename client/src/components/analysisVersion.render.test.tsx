import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AiAnalysisReport from "./AiAnalysisReport";
import SceneCard from "./SceneCard";
import VideoCard from "./VideoCard";
import type { SceneItem } from "@/lib/sceneSearch";
import type { Video } from "@/lib/types";

const baseVideo: Video = {
  id: "RgkoXU4BlOE",
  platform: "youtube",
  title: "Test Video",
  thumbnail: "",
  videoUrl: "https://www.youtube.com/watch?v=RgkoXU4BlOE",
  embedUrl: "",
  genres: [],
  products: [],
  directions: [],
  tones: [],
  allTags: [],
  purposes: [],
  expressions: [],
  toneEmotions: [],
  toneVisuals: [],
  toneTechniques: [],
  productions: [],
  privateRating: "",
  aiOverallRating: "A",
  aiDirectionRating: "A",
  aiTechniqueRating: "A",
  aiAnalysis: "# 第1章 概要\n【00:00-00:10】テスト描写\n\n# 第9章 まとめ\n追加テキスト",
  embedStatus: "available",
  embedCheckedAt: "",
  addedDate: "2026-11-26",
};

const baseScene: SceneItem = {
  id: "RgkoXU4BlOE_s01",
  videoId: "RgkoXU4BlOE",
  videoTitle: "Test Video",
  platform: "youtube",
  sceneNumber: 1,
  startSeconds: 0,
  endSeconds: 10,
  timeRange: "00:00 - 00:10",
  visual: "オープニングカット",
  audio: "イントロ",
  keywords: ["イントロ"],
  thumbnailUrl: "https://img.youtube.com/vi/RgkoXU4BlOE/hqdefault.jpg",
};

describe("analysisVersion UI rendering (legacy vs v3)", () => {
  it("renders '旧分析・時刻は目安' on AiAnalysisReport for legacy and removes it automatically for v3", () => {
    const legacyHtml = renderToStaticMarkup(
      <AiAnalysisReport analysis={baseVideo.aiAnalysis} analysisVersion="legacy" />,
    );
    expect(legacyHtml).toContain('data-testid="analysis-legacy-badge"');
    expect(legacyHtml).toContain("旧分析・時刻は目安");
    expect(legacyHtml).toContain('data-testid="analysis-legacy-notice"');
    expect(legacyHtml).not.toContain('data-testid="analysis-v3-badge"');

    const v3Html = renderToStaticMarkup(
      <AiAnalysisReport
        analysis={baseVideo.aiAnalysis}
        analysisVersion="v3"
        analysisGeneratedAt="2026-11-26T05:29:37.000Z"
        analysisPromptSha256="a53083e103d3114e"
      />,
    );
    expect(v3Html).not.toContain('data-testid="analysis-legacy-badge"');
    expect(v3Html).not.toContain("旧分析・時刻は目安");
    expect(v3Html).not.toContain('data-testid="analysis-legacy-notice"');
    expect(v3Html).toContain('data-testid="analysis-v3-badge"');
    expect(v3Html).toContain("分析 v3");
  });

  it("renders '旧分析・時刻は目安' on VideoCard for legacy and hides it for v3", () => {
    const legacyHtml = renderToStaticMarkup(
      <VideoCard video={{ ...baseVideo, analysisVersion: "legacy" }} index={0} onClick={() => {}} />,
    );
    expect(legacyHtml).toContain('data-testid="video-legacy-analysis-badge"');
    expect(legacyHtml).toContain("旧分析・時刻は目安");
    expect(legacyHtml).not.toContain('data-testid="video-v3-analysis-badge"');

    const v3Html = renderToStaticMarkup(
      <VideoCard
        video={{ ...baseVideo, analysisVersion: "v3", analysisGeneratedAt: "2026-11-26T05:29:37.000Z" }}
        index={0}
        onClick={() => {}}
      />,
    );
    expect(v3Html).not.toContain('data-testid="video-legacy-analysis-badge"');
    expect(v3Html).not.toContain("旧分析・時刻は目安");
    expect(v3Html).toContain('data-testid="video-v3-analysis-badge"');
    expect(v3Html).toContain("分析 v3");
  });

  it("renders '旧分析・時刻は目安' on SceneCard for legacy and removes it automatically for v3", () => {
    const legacyHtml = renderToStaticMarkup(
      <SceneCard scene={{ ...baseScene, analysisVersion: "legacy" }} index={0} />,
    );
    expect(legacyHtml).toContain('data-testid="scene-legacy-analysis-badge"');
    expect(legacyHtml).toContain("旧分析・時刻は目安");

    const v3Html = renderToStaticMarkup(
      <SceneCard scene={{ ...baseScene, analysisVersion: "v3" }} index={0} />,
    );
    expect(v3Html).not.toContain('data-testid="scene-legacy-analysis-badge"');
    expect(v3Html).not.toContain("旧分析・時刻は目安");
  });
});
