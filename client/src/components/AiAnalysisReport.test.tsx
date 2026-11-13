// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AiAnalysisReport, { getAnalysisScale, splitAiAnalysisByTab } from "./AiAnalysisReport";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const analysis = `# キュレーション要約
**企画の核**を短い導入で明確にする。

## 第0章 タイムライン観察記録
【00:12–00:18】 カットの転換で視線を誘導する。

## 第3章 演出・構図
- 余白を広く取り、人物を際立たせる
- **赤い光**を反復して記憶に残す

## 第5章 技術解剖
\`After Effects\` のパラメータを調整する。

\`\`\`javascript
const easing = "cubic-bezier(0.23, 1, 0.32, 1)";
\`\`\`

## 第7章 音響演出・サウンドデザイン
音の抜き差しで緊張を制御する。

## 第8章 明日からのアクションプラン
1. 参考フレームを3枚収集する
2. 15秒のテストを作る`;

describe("AiAnalysisReport", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("章見出しを制作向けの4カテゴリへ仕分ける", () => {
    const sections = splitAiAnalysisByTab(analysis);

    expect(sections.find((section) => section.heading.includes("キュレーション"))?.tab).toBe("planning");
    expect(sections.find((section) => section.heading.includes("第0章"))?.tab).toBe("direction");
    expect(sections.find((section) => section.heading.includes("第5章"))?.tab).toBe("technical");
    expect(sections.find((section) => section.heading.includes("第7章"))?.tab).toBe("sound");
  });

  it("第を付けない数字始まりの第7章・第8章を音響・実践へ分類し末尾本文も保持する", () => {
    const sections = splitAiAnalysisByTab([
      "## 7 音響演出・サウンドデザイン",
      "第7章の本文です。",
      "",
      "## 8 明日からのアクションプラン",
      "第8章の本文1です。",
      "第8章の本文2です。",
    ].join("\n"));

    const chapter7 = sections.find((section) => section.heading.startsWith("7 "));
    const chapter8 = sections.find((section) => section.heading.startsWith("8 "));
    expect(chapter7?.tab).toBe("sound");
    expect(chapter7?.content).toContain("第7章の本文です。");
    expect(chapter8?.tab).toBe("sound");
    expect(chapter8?.content).toBe("第8章の本文1です。\n第8章の本文2です。");
    expect(sections.some((section) => section.heading === "第7章の本文です。")).toBe(false);
  });

  it("本文量または明示Scaleから制作規模バッジを決定する", () => {
    expect(getAnalysisScale("Scale 2\n短い分析")).toBe(2);
    expect(getAnalysisScale("分析".repeat(3500))).toBe(3);
    expect(getAnalysisScale("短い分析")).toBe(1);
  });

  it("コードブロック内の#記法を章見出しとして分割しない", () => {
    const sections = splitAiAnalysisByTab("## 第5章 技術解剖\n```javascript\n# renderer setting\nconst value = 1;\n```");

    expect(sections).toHaveLength(1);
    expect(sections[0]?.tab).toBe("technical");
    expect(sections[0]?.content).toContain("# renderer setting");
  });

  it("タブ、リッチMarkdown、全文コピーとコードコピーを提供する", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<AiAnalysisReport analysis={`${analysis}\n${"補足".repeat(3500)}`} />);

    expect(screen.getByText("AI ANALYSIS REPORT")).toBeTruthy();
    expect(screen.getByText("Scale 3")).toBeTruthy();
    expect(screen.getByText("企画の核")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "レポート全文をコピー" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("第5章 技術解剖")));

    const directionTab = screen.getByRole("tab", { name: /演出・撮影/ });
    fireEvent.mouseDown(directionTab, { button: 0, ctrlKey: false });
    await waitFor(() => expect(directionTab.getAttribute("data-state")).toBe("active"));
    expect(screen.getByText("00:12–00:18")).toBeTruthy();

    const technicalTab = screen.getByRole("tab", { name: /技術解剖/ });
    fireEvent.mouseDown(technicalTab, { button: 0, ctrlKey: false });
    await waitFor(() => expect(technicalTab.getAttribute("data-state")).toBe("active"));
    expect(screen.getByText("After Effects")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "コードをコピー" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('const easing = "cubic-bezier(0.23, 1, 0.32, 1)";'));

    const allTab = screen.getByRole("tab", { name: /全編表示/ });
    fireEvent.mouseDown(allTab, { button: 0, ctrlKey: false });
    await waitFor(() => expect(allTab.getAttribute("data-state")).toBe("active"));
    expect(screen.getByText(/明日からのアクションプラン/)).toBeTruthy();
  });
});
