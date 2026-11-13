// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Header from "./Header";

describe("Header の一覧件数表示", () => {
  afterEach(() => cleanup());

  it("初期取得中は0件ではなく読み込み状態を表示する", () => {
    render(
      <Header
        search=""
        onSearchChange={vi.fn()}
        filteredCount={0}
        totalCount={0}
        isLoading
        onToggleSidebar={vi.fn()}
        activeFilterCount={0}
      />
    );

    expect(screen.getByText("映像を読み込み中…")).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("読込完了後は実際の絞り込み件数と総数を表示する", () => {
    render(
      <Header
        search=""
        onSearchChange={vi.fn()}
        filteredCount={4382}
        totalCount={4825}
        onToggleSidebar={vi.fn()}
        activeFilterCount={0}
      />
    );

    expect(screen.getByText("4382")).toBeTruthy();
    expect(screen.getByText("4825")).toBeTruthy();
  });
});
