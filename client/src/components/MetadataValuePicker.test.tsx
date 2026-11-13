// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MetadataValuePicker from "./MetadataValuePicker";

describe("MetadataValuePicker", () => {
  afterEach(cleanup);

  it("登録済み候補を複数選択として追加する", () => {
    const onChange = vi.fn();
    render(<MetadataValuePicker label="ジャンル" values={["Web CM"]} suggestions={["Web CM", "MV"]} onChange={onChange} placeholder="例：ショートフィルム" />);

    fireEvent.change(screen.getByLabelText("ジャンルの既存値を選択"), { target: { value: "MV" } });

    expect(onChange).toHaveBeenCalledWith(["Web CM", "MV"]);
  });

  it("候補外の値は手入力で追加できる", () => {
    const onChange = vi.fn();
    render(<MetadataValuePicker label="商材" values={[]} suggestions={["食品 / 飲料 / 飲食"]} onChange={onChange} placeholder="例：教育 / 出版" />);

    fireEvent.change(screen.getByLabelText("商材を手入力"), { target: { value: "教育 / 出版" } });
    fireEvent.click(screen.getByRole("button", { name: "追加" }));

    expect(onChange).toHaveBeenCalledWith(["教育 / 出版"]);
  });

  it("用途・表現は候補外の手入力欄を表示しない", () => {
    render(<MetadataValuePicker label="用途" values={[]} suggestions={["MV", "プロモーション"]} onChange={vi.fn()} placeholder="" allowCustom={false} />);

    expect(screen.queryByLabelText("用途を手入力")).toBeNull();
    expect(screen.getByLabelText("用途の既存値を選択")).toBeTruthy();
  });
});
