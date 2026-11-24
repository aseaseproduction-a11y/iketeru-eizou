# 既存 `craft_recipes`（1,036件）の「推定（未検証）」表示・区別設計案（提案のみ・DB 書き込みなし）

- **作成日**: 2026-11-25
- **ステータス**: **設計案のみ（本番 DB・MCP への反映はユーザー承認待ち）**
- **根拠データ**: [holdout_fair_ab_eval.json](file:///E:/iketeru-eizou/analysis/craft_calibration_pilot/holdout_fair_ab_eval.json)
- **非接触保証**: Phase 2 凍結採点ルールおよび既存 `craft_recipes` 本文データの上書き・削除は一切行わない。

---

## 1. 背景（なぜ「推定（未検証）」の明示が必要か）

新規 10 組のホールドアウト二重盲検テストにより、**完成映像だけを見た AI が挙げる「隠れ工程・制作手順」の約 3 分の 2 は公式 BTS（メイキング）では裏付けられない（適合率：改訂前 33.3% / 改訂後 34.0%）**ことが実証されました。

- 既存ローカル SQLite の `craft_recipes` **1,036 件**は、大半が本編映像のみからの AI 視覚推定で生成されています（一部に BTS・制作記事・公開プロジェクト由来が混在し得る）。
- これを「確定した制作事実」のように検索結果・手本プランへ出すと、現場の撮影設計や再現手順で誤認（例：スタジオ建て込みを屋外ロケと誤解、実写マスクを 3DCG と誤解、未確認のワークフローを前提化）を招くリスクがあります。
- 一方で、既存レシピの具体的な再現手順（AE/Blender/Resolve での実現アプローチ）自体は創作のたたき台として有用であり、**既存テキストを消さずに「根拠の由来（プロベナンス：事実確認済みか、映像からの視覚推定か）」をメタデータと表示バッジで明確に区別する**のが最善です。

---

## 2. 根拠レベル（`craft_provenance`）の 4 段階定義

`craft_recipes` の各レコード（および必要に応じ `recipe_json` 内の各カット）に、以下の 4 段階の由来ステータス（`craft_provenance`）を定義します：

| `craft_provenance` 値 | 日本語表示ラベル | 定義・対象 | 既存 1,036 件への初期扱い |
|---|---|---|---|
| `inferred_from_video` | **推定（未検証）** | 完成映像（MP4／コンタクトシート）のみを観察して AI が逆推定した制作手順・隠れ工程。再現のたたき台としては使えるが、実際の舞台裏工程とは異なる可能性がある | **既定値（既存 1,036 件は原則ここへ初期分類）** |
| `confirmed_by_bts` | **BTS確認済** | 公式メイキング動画・VFX ブレイクダウン・監督/制作会社インタビュー等の一次資料で裏付けられた工程を含む | 将来 BTS ペア照合済みの該当項目のみ昇格 |
| `confirmed_by_source_file` | **編集データ確認済** | 公開 `.blend` / `.aep` / MIT コード映像ソース等から機械抽出した真値に基づくレシピ | 将来オープン編集データ由来のみ昇格 |
| `unverified_unwatched` | **未視聴・使用禁止** | 動画未視聴レコード由来（ルール 2 ハードゲートにより新規生成は全面禁止。万一混入を検出した場合の隔離用） | 既存 1,036 件は監査済みで未視聴重複 **0 件** |

※既存の `craft_recipes` テーブル／JSON に `craft_provenance` が未設定（`NULL` またはキー欠落）の場合、読み取り側（インデクサ／MCP）で自動的に **`inferred_from_video`（推定・未検証）** としてフォールバック解釈する設計にすれば、**DB への破壊的変更ゼロ**で即座に安全側へ倒せます。

---

## 3. DB スキーマ＆JSON 拡張案（後方互換・既存データ非破壊）

### 3-1. SQLite `craft_recipes` テーブル（任意・追加専用カラム）
- 既存カラム・既存 `recipe_json` 本文は一切書き換えない。
- 必要になった段階で、追加専用（append-only）の軽量メタ列を 2 列だけ追加する案：
  - `craft_provenance TEXT NOT NULL DEFAULT 'inferred_from_video'`
  - `provenance_note TEXT`（例：`"本編映像の視覚観察に基づくAI推定（BTS未照合）"`、または BTS 確認済みなら参照先 `bts_video_id` を記録）

### 3-2. `recipe_json` 内のフィールド区別（新規生成・更新時）
既存レシピのテキストを壊さず、将来生成されるレシピでは以下のように「観察事実」と「推定工程」を分けて持てる構造にする：
```json
{
  "craft_provenance": "inferred_from_video",
  "provenance_badge": "[推定・未検証]",
  "observed_visual_facts": [
    "画面上で直接確認できた視覚事実（カット尺・配色HEX・動きの種類・画面上の演出要素）"
  ],
  "inferred_recreation_steps": [
    "手元ソフト（AE/Blender/Resolve）で再現するための推定手順（元作品の舞台裏を断定しない）"
  ],
  "non_visual_unknowns": [
    "映像だけでは断定できない項目（ライト灯数・HDRI判別・コンポジット有無・厳密係数・ロケ/スタジオ境界など）"
  ]
}
```

---

## 4. MCP 検索結果・手本プランでの表示案（ユーザー・生成AIに必ず伝わる設計）

`E:\iketeru-creative-studio\iketeru_studio\mcp_server.py` および `macro_planner.py` の出力を以下のように拡張する案です（既存の未視聴バッジ実装と同じ設計思想）：

1. **`search_craft_recipes`（レシピ検索）**:
   - 各ヒット項目に `craft_provenance`（既定 `"inferred_from_video"`）と `provenance_badge`（`"[推定・未検証]"` / `"[BTS確認済]"` / `"[編集データ確認済]"`）を必ず付与する。
   - タイトル／サマリー先頭にバッジを明示表示（例：`[推定・未検証] 00:12-00:15 タイトル出現トランジション`）。
   - 任意フィルタ `provenance_filter`（`"all"` 既定 / `"confirmed_only"`）を用意し、事実裏付け済みのみ絞りたい用途にも対応する。
2. **`get_craft_recipe`（個別レシピ詳細）**:
   - JSON 返却のトップレベルに以下 2 項目を常時含める：
     - `"craft_provenance": "inferred_from_video"`
     - `"provenance_disclaimer": "このレシピの制作工程・使用ソフト推定は完成映像からの視覚推定（未検証）です。元作品の実際の撮影・制作手順とは異なる場合があるため、手元ソフトでの再現たたき台として参照してください。"`
   - `confirmed_by_bts` / `confirmed_by_source_file` の場合のみ、その参照 ID・出典 URL を `provenance_evidence` として併記する。
3. **`plan_craft_sequence`（手本シーケンス構成）**:
   - 採用した各カット候補に `craft_provenance` と `provenance_badge` を継承表示し、プラン全体のメタデータに `inferred_cuts_count` / `confirmed_cuts_count` の内訳を明記する。
   - これにより、後段の `.jsx` / `.py` 生成エージェントや人間ディレクターが「これは BTS 裏付け済みか、映像からの推定たたき台か」を常に一目で識別できる。
4. **`get_index_stats`（統計表示）**:
   - `craft_recipes_by_provenance`: `{"inferred_from_video": 1036, "confirmed_by_bts": 0, "confirmed_by_source_file": 0}` のように内訳を可視化する。

---

## 5. 実装ステップ（ご承認後に実施する場合）

1. **Step 1（読み取り専用フォールバック表示・DB 無変更）**: `indexer.py` / `mcp_server.py` / `macro_planner.py` に既定 `inferred_from_video` のバッジ・免責注記表示を追加し、単体テスト＋MCP JSON-RPC 検証（既存 DB へは 1 バイトも書き込まない）。
2. **Step 2（必要時のみ SQLite append-only 列追加）**: BTS 確認済み・編集データ確認済みのレシピを登録・昇格させる運用が始まった段階で、SQLite 事前バックアップ取得後に `craft_provenance` 列を追加する。
