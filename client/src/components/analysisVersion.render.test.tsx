import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AiAnalysisReport, { splitAiAnalysisByTab } from "./AiAnalysisReport";
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

  it("hides legacy ratings on VideoCard when calibrated and shows 旧評価 when uncalibrated", () => {
    const calibratedHtml = renderToStaticMarkup(
      <VideoCard
        video={{
          ...baseVideo,
          calibratedScore: 88,
          calibratedRank: "A+",
          calibrationStatus: "calibrated_verified",
          aiOverallRating: "S-",
          aiDirectionRating: "A+",
          aiTechniqueRating: "A+",
        }}
        index={0}
        onClick={() => {}}
      />,
    );
    expect(calibratedHtml).toContain("校正済");
    expect(calibratedHtml).toContain("88");
    expect(calibratedHtml).not.toContain('data-testid="video-legacy-score-badge"');
    expect(calibratedHtml).not.toContain("旧総");
    expect(calibratedHtml).not.toContain("AI 総");

    const legacyHtml = renderToStaticMarkup(
      <VideoCard
        video={{
          ...baseVideo,
          calibratedScore: null,
          aiOverallRating: "A",
          aiDirectionRating: "A-",
          aiTechniqueRating: "A+",
        }}
        index={0}
        onClick={() => {}}
      />,
    );
    expect(legacyHtml).toContain('data-testid="video-legacy-score-badge"');
    expect(legacyHtml).toContain("旧評価");
    expect(legacyHtml).toContain("AI 総");
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

  it("routes v3 chapters ## 0. .. ## 10. strictly by chapter number regardless of heading wording", () => {
    const v3Sample = [
      "## 0. 映像構造と演出力・技術力評価の総括",
      "総括テキスト",
      "## 1. ジャンル・商品カテゴリ・トーンの解説",
      "ジャンルテキスト",
      "## 2. コンセプト・企画意図・ターゲット分析",
      "コンセプトテキスト",
      "## 3. 時系列ビジュアル・タイムスタンプ詳細（重要シーン抜粋）",
      "- #01 【00:00-00:18】 イントロ",
      "## 4. 演出構成（カメラワーク・ライティング・カラー設計・構図・美術）",
      "演出テキスト",
      "## 5. 編集・モーショングラフィックス・VFX技術解析",
      "編集テキスト",
      "## 6. サウンド・リズム・テンポ設計（オーディオ/BGM/SE）",
      "音テキスト",
      "## 7. 実制作の再現性・制作体制・推定リソース",
      "制作体制テキスト",
      "## 8. 制作現場でそのまま使える応用・参考ポイント（改善点/注意点）",
      "応用テキスト",
      "## 9. セールス・ビジネス活用タグと企画提案フック",
      "タグテキスト",
      "### クライアント説明用・企画意図3行まとめ",
      "3行まとめテキスト",
      "## 10. 高技術カット完全再現レシピ（Motion / Design / Grading Flow）",
      "1. 再現レシピテキスト",
    ].join("\n");

    const sections = splitAiAnalysisByTab(v3Sample);
    expect(sections.map((s) => [s.heading.slice(0, 3).trim(), s.tab])).toEqual([
      ["0.", "planning"],
      ["1.", "planning"],
      ["2.", "planning"],
      ["3.", "direction"],
      ["4.", "direction"],
      ["5.", "technical"],
      ["6.", "sound"],
      ["7.", "sound"],
      ["8.", "sound"],
      ["9.", "planning"],
      ["10.", "technical"],
    ]);
    expect(sections.find((s) => s.heading.startsWith("9."))?.content).toContain("3行まとめテキスト");

    const v3Html = renderToStaticMarkup(
      <AiAnalysisReport analysis={v3Sample} analysisVersion="v3" />,
    );
    expect(v3Html).toContain("分析 v3");
    expect(v3Html).toContain("映像構造と演出力・技術力評価の総括");
    expect(v3Html).not.toContain("旧分析・時刻は目安");
  });
});
