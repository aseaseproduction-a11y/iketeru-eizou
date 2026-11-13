// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Sidebar from "./Sidebar";
import { applyVideoFilters, MISSING_FILTER_VALUE } from "@/hooks/useVideos";
import type { FilterState, Video } from "@/lib/types";

const filters: FilterState = {
  search: "", genre: null, product: null, direction: null, tone: null,
  purpose: null, expression: null, toneEmotion: null, toneVisual: null, toneTechnique: null,
  production: null, privateRating: null, aiOverallRating: null, aiDirectionRating: null, aiTechniqueRating: null,
  eizo100Only: false, eizo100Year: null, showUnavailable: false, showLowAiOverall: false, sort: "newest", favoritesOnly: false,
};

function renderSidebar(overrides: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  const callbacks = {
    onGenreChange: vi.fn(), onProductChange: vi.fn(), onDirectionChange: vi.fn(), onToneChange: vi.fn(),
    onPurposeChange: vi.fn(), onExpressionChange: vi.fn(), onToneEmotionChange: vi.fn(), onToneVisualChange: vi.fn(),
    onToneTechniqueChange: vi.fn(), onProductionChange: vi.fn(), onProductionRoleChange: vi.fn(), onPrivateRatingChange: vi.fn(),
    onAiOverallRatingChange: vi.fn(), onAiDirectionRatingChange: vi.fn(), onAiTechniqueRatingChange: vi.fn(), onEizo100Change: vi.fn(), onEizo100YearChange: vi.fn(), onShowUnavailableChange: vi.fn(), onClearAll: vi.fn(),
  };
  render(<Sidebar
    filters={filters}
    categoryCounts={{ __missing_genre__: 3, "film": 2, __missing_product__: 4, __missing_direction__: 5, __missing_tone__: 6 }}
    totalCount={10}
    filteredCount={10}
    eizo100Count={4}
    eizo100YearCounts={{ 2026: 2, 2025: 2 }}
    metadataFilterOptions={{
      purpose: [{ value: MISSING_FILTER_VALUE, label: "未入力", count: 7 }], expression: [{ value: MISSING_FILTER_VALUE, label: "未入力", count: 6 }],
      toneEmotion: [{ value: MISSING_FILTER_VALUE, label: "未入力", count: 5 }], toneVisual: [{ value: MISSING_FILTER_VALUE, label: "未入力", count: 5 }],
      toneTechnique: [{ value: MISSING_FILTER_VALUE, label: "未入力", count: 5 }], production: [{ value: MISSING_FILTER_VALUE, label: "未入力", count: 5 }],
      privateRating: [{ value: MISSING_FILTER_VALUE, label: "未入力", count: 5 }], aiOverallRating: [{ value: MISSING_FILTER_VALUE, label: "未入力", count: 5 }],
      aiDirectionRating: [{ value: MISSING_FILTER_VALUE, label: "未入力", count: 5 }], aiTechniqueRating: [{ value: MISSING_FILTER_VALUE, label: "未入力", count: 5 }],
    }}
    activeFilterCount={0}
    {...callbacks}
    {...overrides}
  />);
  return callbacks;
}

const harnessVideos: Video[] = [
  { id: "empty-film", platform: "youtube", title: "空欄を含む映画", thumbnail: "", videoUrl: "https://example.com/empty", embedUrl: "", genres: [{ name: "映画 / ドラマ / ショートフィルム", slug: "film" }], products: [], directions: [], tones: [], allTags: [], purposes: [], expressions: [], toneEmotions: [], toneVisuals: [], toneTechniques: [], productions: [], awards: [{ name: "映像作家100人", year: "2026", category: "選出", sourceUrl: "https://eizo100.jp/video/example" }], privateRating: "", aiOverallRating: "", aiDirectionRating: "", aiTechniqueRating: "", aiAnalysis: "", embedStatus: "unknown", embedCheckedAt: "", addedDate: "2026-01-01" },
  { id: "filled-film", platform: "youtube", title: "入力済み映画", thumbnail: "", videoUrl: "https://example.com/filled", embedUrl: "", genres: [{ name: "映画 / ドラマ / ショートフィルム", slug: "film" }], products: [], directions: [], tones: [], allTags: [], purposes: ["MV"], expressions: [], toneEmotions: [], toneVisuals: [], toneTechniques: [], productions: [], privateRating: "", aiOverallRating: "", aiDirectionRating: "", aiTechniqueRating: "", aiAnalysis: "", embedStatus: "unknown", embedCheckedAt: "", addedDate: "2026-01-01" },
  { id: "no-genre", platform: "youtube", title: "ジャンル未入力", thumbnail: "", videoUrl: "https://example.com/no-genre", embedUrl: "", genres: [], products: [], directions: [], tones: [], allTags: [], purposes: [], expressions: [], toneEmotions: [], toneVisuals: [], toneTechniques: [], productions: [], privateRating: "", aiOverallRating: "", aiDirectionRating: "", aiTechniqueRating: "", aiAnalysis: "", embedStatus: "unknown", embedCheckedAt: "", addedDate: "2026-01-01" },
];

function FilterHarness() {
  const [activeFilters, setActiveFilters] = React.useState<FilterState>(filters);
  const results = applyVideoFilters(harnessVideos, activeFilters);
  const setFilter = (key: keyof FilterState, value: FilterState[keyof FilterState]) => setActiveFilters((previous) => ({ ...previous, [key]: value }));
  const activeCount = Object.entries(activeFilters).filter(([key, value]) => !["sort", "favoritesOnly"].includes(key) && Boolean(value)).length;
  const metadataFilterOptions = {
    purpose: [{ value: MISSING_FILTER_VALUE, label: "未入力", count: 2 }], expression: [{ value: MISSING_FILTER_VALUE, label: "未入力", count: 3 }],
    toneEmotion: [{ value: MISSING_FILTER_VALUE, label: "未入力", count: 3 }], toneVisual: [{ value: MISSING_FILTER_VALUE, label: "未入力", count: 3 }],
    toneTechnique: [{ value: MISSING_FILTER_VALUE, label: "未入力", count: 3 }], production: [{ value: MISSING_FILTER_VALUE, label: "未入力", count: 3 }],
    privateRating: [{ value: MISSING_FILTER_VALUE, label: "未入力", count: 3 }], aiOverallRating: [{ value: MISSING_FILTER_VALUE, label: "未入力", count: 3 }],
    aiDirectionRating: [{ value: MISSING_FILTER_VALUE, label: "未入力", count: 3 }], aiTechniqueRating: [{ value: MISSING_FILTER_VALUE, label: "未入力", count: 3 }],
  };
  return <>
    <input aria-label="検索" value={activeFilters.search} onChange={(event) => setFilter("search", event.target.value)} />
    <Sidebar
      filters={activeFilters}
      categoryCounts={{ film: 2, __missing_genre__: 1, __missing_product__: 3, __missing_direction__: 3, __missing_tone__: 3 }}
      totalCount={harnessVideos.length}
      filteredCount={results.length}
      metadataFilterOptions={metadataFilterOptions}
      onGenreChange={(value) => setFilter("genre", value)} onProductChange={(value) => setFilter("product", value)} onDirectionChange={(value) => setFilter("direction", value)} onToneChange={(value) => setFilter("tone", value)}
      onPurposeChange={(value) => setFilter("purpose", value)} onExpressionChange={(value) => setFilter("expression", value)} onToneEmotionChange={(value) => setFilter("toneEmotion", value)} onToneVisualChange={(value) => setFilter("toneVisual", value)} onToneTechniqueChange={(value) => setFilter("toneTechnique", value)} onProductionChange={(value) => setFilter("production", value)}
      onPrivateRatingChange={(value) => setFilter("privateRating", value)} onAiOverallRatingChange={(value) => setFilter("aiOverallRating", value)} onAiDirectionRatingChange={(value) => setFilter("aiDirectionRating", value)} onAiTechniqueRatingChange={(value) => setFilter("aiTechniqueRating", value)}
      eizo100Count={1} eizo100YearCounts={{ 2026: 1 }} onEizo100Change={(value) => setActiveFilters((previous) => ({ ...previous, eizo100Only: value, eizo100Year: value ? previous.eizo100Year : null }))} onEizo100YearChange={(value) => setActiveFilters((previous) => ({ ...previous, eizo100Only: value !== null ? true : previous.eizo100Only, eizo100Year: value }))}
      activeFilterCount={activeCount}
      onClearAll={() => setActiveFilters(filters)}
    />
    <output aria-label="絞り込み結果">{results.map((video) => video.id).join(",")}</output>
  </>;
}

describe("Sidebar 未入力フィルター", () => {
  afterEach(() => cleanup());

  it("ジャンルの未入力を選択すると未入力用のフィルター値を発火する", () => {
    const callbacks = renderSidebar();
    fireEvent.click(screen.getAllByText("未入力")[0]);
    expect(callbacks.onGenreChange).toHaveBeenCalledWith(MISSING_FILTER_VALUE);
  });

  it("未入力が選択済みの場合は同じ操作でフィルターを解除する", () => {
    const callbacks = renderSidebar({ filters: { ...filters, genre: MISSING_FILTER_VALUE } });
    fireEvent.click(screen.getAllByText("未入力")[0]);
    expect(callbacks.onGenreChange).toHaveBeenCalledWith(null);
  });

  it("UI操作で検索・既存カテゴリ・用途の未入力を併用し、クリアで一覧に復帰する", () => {
    render(<FilterHarness />);

    fireEvent.change(screen.getByLabelText("検索"), { target: { value: "空欄" } });
    fireEvent.click(screen.getByText("映画 / ドラマ / ショートフィルム"));
    fireEvent.click(screen.getByText("用途"));
    fireEvent.click(screen.getAllByText("未入力")[4]);
    expect(screen.getByLabelText("絞り込み結果").textContent).toBe("empty-film");

    fireEvent.click(screen.getByText("フィルターをクリア"));
    expect((screen.getByLabelText("検索") as HTMLInputElement).value).toBe("");
    expect(screen.getByLabelText("絞り込み結果").textContent).toBe("empty-film,filled-film,no-genre");
  });

  it("映像作家100人の出典を選択すると、選出作品だけへ絞り込む", () => {
    render(<FilterHarness />);
    fireEvent.click(screen.getByText("映像作家100人"));
    expect(screen.getByLabelText("絞り込み結果").textContent).toBe("empty-film");
  });

  it("映像作家100人を選択後に年度を押すと、年度別フィルター値を発火する", () => {
    const callbacks = renderSidebar({ filters: { ...filters, eizo100Only: true }, eizo100YearCounts: { 2026: 2 } });
    fireEvent.click(screen.getByText("2026").closest("button")!);
    expect(callbacks.onEizo100YearChange).toHaveBeenCalledWith(2026);
  });

  it("削除・非公開動画のみ表示する一括切替を操作できる", () => {
    const callbacks = renderSidebar({ unavailableCount: 2 });
    fireEvent.click(screen.getByText("削除・非公開の動画"));
    expect(callbacks.onShowUnavailableChange).toHaveBeenCalledWith(true);
  });

  it("役割の選択では人物・会社候補を切り替え、人物・会社の選択で絞り込み操作を発火する", () => {
    const callbacks = renderSidebar({
      filters: { ...filters, productionRole: "監督" },
      productionFilterOptions: {
        roles: [{ value: "監督", count: 2 }],
        entities: [{ value: "代田栄介", count: 2 }],
      },
    });

    fireEvent.click(screen.getByText("役割"));
    fireEvent.click(screen.getByText("監督"));
    expect(callbacks.onProductionRoleChange).toHaveBeenCalledWith(null);
    expect(callbacks.onProductionChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("「監督」の人物・会社"));
    fireEvent.click(screen.getByText("さ").closest("button")!);
    fireEvent.click(screen.getByText("代田栄介"));
    expect(callbacks.onProductionChange).toHaveBeenCalledWith("代田栄介");
  });

  it("初期取得中は全件数を0件として表示せず、読み込み状態を表示する", () => {
    renderSidebar({ totalCount: 0, isLoading: true });
    expect(screen.getByText("(読み込み中…)")).toBeTruthy();
  });
});
