import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyVideoMetadata, selectSafeMetadataUpdates, type AutoClassificationInput } from "./metadataAutoClassification";

const input: AutoClassificationInput = {
  id: "demo-001", title: "公式タイトル", videoUrl: "https://www.youtube.com/watch?v=demo-001",
  source: "manual", sourceLabel: "手動追加", channelTitle: "公式チャンネル", allTags: ["ブランドムービー"],
  curationNote: { purpose: "新商品の認知", sourceUrls: ["https://brand.example.com/campaign"] },
  genres: [], products: [], directions: [{ name: "実写", slug: "live-action" }], tones: [], purposes: [], expressions: [],
};

afterEach(() => vi.unstubAllGlobals());

describe("登録時の根拠付き自動分類", () => {
  it("信頼度と根拠を満たす場合だけ、未入力の分類を補完する", () => {
    const updates = selectSafeMetadataUpdates(input, {
      genres: ["branded-movie"], products: ["beauty"], directions: ["motion-graphics"], tones: ["stylish"], purposes: ["ブランディングムービー"], expressions: ["実写＋アニメーション", "自由記述"], confidence: 0.9, evidence: "タイトルと公式キャンペーン出典にブランドムービーと美容商品の記載がある",
    });
    expect(updates.genres).toEqual([{ name: "ブランデッドムービー", slug: "branded-movie" }]);
    expect(updates.products).toEqual([{ name: "美容 / 化粧品", slug: "beauty" }]);
    expect(updates.directions).toBeUndefined();
    expect(updates.tones).toEqual([{ name: "スタイリッシュ / クール", slug: "stylish" }]);
    expect(updates.purposes).toEqual(["ブランディングムービー"]);
    expect(updates.expressions).toEqual(["実写+アニメーション"]);
  });

  it("根拠または信頼度が不十分な候補は保存対象にしない", () => {
    expect(selectSafeMetadataUpdates(input, {
      genres: ["branded-movie"], products: [], directions: [], tones: [], purposes: [], expressions: [], confidence: 0.5, evidence: "不明",
    })).toEqual({});
  });

  it("分類APIの有効な応答から未入力項目だけを補完候補として返す", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      genres: ["branded-movie"], products: ["beauty"], directions: [], tones: ["stylish"], purposes: ["プロモーション"], expressions: ["2D"], confidence: 0.91, evidence: "公式キャンペーンのタイトルと出典に美容ブランドのブランデッドムービーと明記されている",
    }) } }] }), { status: 200 })));
    const result = await classifyVideoMetadata(input);
    expect(result.status).toBe("updated");
    expect(result.updates).toMatchObject({
      genres: [{ slug: "branded-movie" }], products: [{ slug: "beauty" }], tones: [{ slug: "stylish" }],
      purposes: ["プロモーション"], expressions: ["2D"],
    });
    expect(result.updates.directions).toBeUndefined();
  });

  it("分類APIが失敗しても失敗理由を返し、動画登録処理を中断しない", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));
    const result = await classifyVideoMetadata(input);
    expect(result).toMatchObject({ status: "failed", updates: {}, reason: "network unavailable" });
  });

  it("拡張された演出・トーンスラッグも安全に補完対象へマッピングできる", () => {
    const emptyDirectionsInput: AutoClassificationInput = { ...input, directions: [], tones: [] };
    const updates = selectSafeMetadataUpdates(emptyDirectionsInput, {
      genres: [], products: [], directions: ["one-take", "choreography"], tones: ["retro", "energetic"], purposes: [], expressions: [], confidence: 0.92, evidence: "ワンカット撮影のダンスMVでレトロかつ爽快な演出が明記されている",
    });
    expect(updates.directions).toEqual([
      { name: "ワンカット / 長回し", slug: "one-take" },
      { name: "ダンス / コレオグラフィ", slug: "choreography" },
    ]);
    expect(updates.tones).toEqual([
      { name: "レトロ / ノスタルジック / 昭和・平成", slug: "retro" },
      { name: "ポップ / エネルギッシュ / 爽快", slug: "energetic" },
    ]);
  });
});
