# Gemini API（YouTube URL 直接渡し）によるクラフトレシピ v2 下書き生成 設計書

- **作成日**: 2026-11-25（`CHIBA-PC`）
- **位置づけ**: `docs/STATUS_OVERVIEW_20261125.md`（`ceff855`）で特定された最大ボトルネック「分析・シーンはあるがクラフトレシピがない **4,158 本**（うち YouTube **4,149 本**、未キャッシュ **4,017 本**）」を、社内回線から YouTube へ直接アクセスせず（D-016 遵守）解消するための設計書およびパイロット試験計画書。
- **ステータス**: **設計・試験準備（事前登録）完了・API 未実行**（ユーザー承認後にパイロット 5 本 × 2 回を実施）。
- **関連文書**: `docs/DECISIONS.md`（D-016〜D-021）、`docs/API_URL_SCORING_DESIGN.md`、`docs/STATUS_OVERVIEW_20261125.md`、`analysis/pilot_api_craft_recipe/preregistration.json`

---

## 1. 現行クラフトレシピの仕組み（コード・DB 実測）

`E:\iketeru-creative-studio` の実装（`craft_recipes.py`, `indexer.py`, `macro_planner.py`, `mcp_server.py`, `project_scaffold.py`, `media_ingest.py`, `craft_verifier.py`）およびローカル SQLite `iketeru_knowledge.db`（5,653 本、うち `craft_recipes` 439 本 / 1,036 カット、v2 準拠 120 本 / 241 カット）を読み取り専用で実測した結果を整理する。

### 1-1. レシピ v2 の形式と検証ルール

- **格納構造**:
  - オンディスク JSON: `data/craft_recipes/<video_id>/recipe.json`（トップレベル: `video_id`, `technique_rating`, `title`, `cuts[]`, `style_profile`）。
  - SQLite `craft_recipes` テーブル（`PRIMARY KEY (video_id, cut_index)`）: `title`, `category`, `start_mmss`, `end_mmss`, `start_sec`, `end_sec`, `technique_rating`, `technique_score`, `software_json`, `plugins_json`, `palette_json`, `easing_json`, `recipe_json`（カット全量 JSON）, `gif_path`, `strip_path`, `keyframes_json`, `updated_at`＋全文検索仮想テーブル `craft_recipes_fts`（trigram）。
- **v2 判定条件**（`indexer.py` L1819 / L2073）:
  - `is_v2 = bool(frame_timeline and effect_chain and (primary_tool or tool_decision.primary_tool))`
  - かつ `search_craft_recipes(..., v2_only=True)` では `not needs_recut`（`duration_sec <= 15.0`）も要求される。
- **カット粒度ルール**（`compute_frame_timing()`、`craft_recipes.py` L644–681）:
  - `micro_transition`: `<= 24 frames`（0.067〜0.8s）
  - `technique_unit`: `<= 8.0s`
  - `complex_composite`: `<= 15.0s`
  - `> 15.0s` は `oversized_section_needs_recut`（`needs_recut = True`、信頼性スコア `-22`〜`-35` 減点）。
- **信頼性スコア（`score_recipe_credibility()`, 0〜100 点、`craft_recipes.py` L777–849）**:
  1. カット精度（最大 -35）: `>30s` で -35、`>15s` で -22
  2. フレーム再現性（最大 -22）: `frame_timeline`（2 要素以上）欠損 -12、`effect_chain`（1 要素以上）欠損 -10
  3. 具体ブループリント（-10）: `ae_blueprint.layers` 空で -10
  4. ツール選定＆スキーマ衛生（最大 -15）: 非標準 `category` -5、`software_stack >= 4` -5、環境外ソフト（C4D/Nuke 等）混入 -5
  5. 制作基準違反（最大 -22）: 生成 AI 動画語（Runway/Kling/Veo/Sora 等）検出 -12、画像テロップ語検出 -10
  - **重要**: `score_recipe_credibility()` は **`media`（GIF/PNG/telemetry）の有無を一切減点しない**。
- **制作基準ハードチェック**（`project_scaffold.py` L221–283 `validate_production_compliance()`）:
  - `ae_builder.py` / `timeline_builder.py` 呼び出し時に、`layers` / `tracks` 内の焼き込み生成 AI 動画・画像テロップ・BGM/SE 同一トラック混在を `ValueError` で拒否。

### 1-2. 実在 v2 準拠レシピ 3 件の観察結果（120 本 / 241 件から抽出）

| 動画 ID | ジャンル / 尺 | v2 カット数 | 構成・特徴（実測） |
|---|---|---:|---|
| **`3TUhE6RLwzE`**（ゴー！ビッパ団 cover MV） | `mv` / 236s | 4/4 | `ui_motion` / `kinetic_typography` / `motion_graphics` / `transition`。オンディスク版は `verification_tier: "vision_verified_handcrafted"`、`ae_blueprint.layers` 5 層（`solid_wipe`, `shape_repeater`, `motion_card`, `kinetic_typo_animator`）、`effect_chain` 3 段（`ADBE Tint`, `ADBE Mosaic`, `ADBE Posterize Time`）、`frame_timeline` 5 点、`credibility_score = 100`。 |
| **`EiR_7n7bmjI`**（Amex ビジネスカード Web CM） | `web-cm` / 22s | 3/3 | Cut #1 `[00:02-00:10]`（8s `technique_unit`）, Cut #2 `[00:10-00:21]`（11s `complex_composite`）, Cut #3 `[00:11-00:12]`（0.5s / 15f `micro_transition`）。全カット `primary_tool: After Effects`, `credibility_score = 100`, `frame_timeline` 3〜4 点, `ae_blueprint.layers` 2〜3 層。 |
| **`Nw_XzGZ35As`**（ダンダダン OP） | `opening` / 90s | 3/4 | Cut #1 `[00:13-00:17]`（4s, `Blender`, `Deep Glow`/`Optical Flares`/`Motion 4`）, Cut #2 `[00:22-00:26]`（4s, `After Effects`, `kinetic_typography`）が v2 100 点。Cut #3 `[00:59-01:02]`（`DaVinci Resolve`）は `frame_timeline`/`effect_chain` 欠損のため 63 点。 |

### 1-3. 各ツール・品質ガードがレシピのどの項目を使うか

1. **`plan_craft_sequence`（`macro_planner.py` `build_macro_sequence_plan()`）**:
   - **母数抽出（`indexer.list_craft_recipes_for_ranking()`）**: `c.technique_score >= A-`、`v.analysis_observation_scope IS NULL`（既定 `exclude_unwatched=True`）、provisional 除外。
   - **関連度・IDF 検索（L425–532）**: `cut_title`, `video_title`, `video_tags`, `plugins_used`, `recreation_flow`＋動画メタデータ（`video_genres`, `video_directions`, `video_tones`, `calibrated_score`）。
   - **ソート順（L534–546）**: `(_relevance_score, matched_concepts数, title_hit数, calibrated_score, not needs_recut, is_v2, credibility_score, technique_rating)` の降順。
   - **パレット固定（L608–624）**: 上位 1 件の `media.telemetry.palette_hex` を優先し、**存在しなければ `color_palette_hex` に自動フォールバック**。
   - **カット割当・出力（L639–742）**: `category`（ロール親和性）、`transition_bridge`, `alternative_paths`, `plugins_used`, `ae_blueprint`, `recommended_code_tools`, `gif_path`, `strip_path` を返却し、`extract_style_profile(recipes)` でスタイルプロファイルを生成。
2. **`search_craft_recipes`（`indexer.py` L1943–2168）**:
   - `craft_recipes_fts`（`title`, `category`, `software_text`, `plugins_text`, `flow_text`）＋`duration_sec <= max_duration_sec`＋`v2_only`（`is_v2 and not needs_recut`）＋`technique_score >= A-`＋`exclude_unwatched=True`。
3. **ルール 2（未視聴除外、`d046752`・`d1beb3d`）**:
   - `craft_recipes.py` `is_craft_eligible()`（L173–185）: `visual_checked is False` または `observation_scope in UNWATCHED_OBSERVATION_SCOPES` を拒否し、`technique_rating in {S+, S, S-, A+, A, A-}` を要求。
   - `indexer.py` / `macro_planner.py` / `mcp_server.py`: `videos.analysis_observation_scope IS NULL` を `search_craft_recipes` / `get_craft_recipe` / `plan_craft_sequence` の既定値（`exclude_unwatched=True`）として強制。
4. **既存の出どころ（provenance）管理の現状**:
   - `craft_recipes.py` L1188–1197: `easing_and_timing` に `verified: bool` と `source: "observed" | "inferred"` を自動付与（`media.telemetry.available` が真かつテンプレ曲線でない場合のみ `observed`）。
   - `synthesize_ae_blueprint()`（L926）: 自動補完時は `ae_blueprint.source = "inferred"`。
   - `synthesize_transition_bridge()`（L949, L995）: 明示記述時は `"observed"`、自動補完時は `"inferred"`。
   - オンディスク v2 手作りレシピの一部: `credibility.verification_tier = "vision_verified_handcrafted"`。
   - `media_ingest.py` L254 `detect_real_cuts()`: `ffmpeg scdet` で実動画から実測カット点を取る別コマンド（現状 `craft_recipes` テーブル列には未保存）。
   - **不足点**: レシピ全体（トップレベル / カット単位）に「手元動画実測か・Gemini API URL 視聴下書きか」を識別する統一フィールド（`source` / `field_provenance`）はまだ存在しない。

---

## 2. レシピ v2 全項目の (A)(B)(C) 分類と `plan_craft_sequence` 稼働判定

### 2-1. レシピ v2 全項目の 3 分類表

- **(A) API の出力だけで埋められる項目**: 動画視聴＋既存メタデータから意味的・技術的に直接生成できる項目。
- **(B) API でも埋められるが推定値になる項目**: 動画視聴で妥当な値を出せるが、1 fps サンプリングや圧縮映像の制約によりピクセル実測・厳密フレーム実測ではない項目。
- **(C) 手元の動画ファイルがないと作れない項目**: ローカル MP4 に対する `ffmpeg` / `ffprobe` / `numpy` 実行が物理的に必須な項目。

| 項目名（JSON パス） | 用途 | `plan_craft_sequence` 必須度 | 分類 | 分けた理由 |
|---|---|---|:---:|---|
| `video_id`, `title`（動画）, `technique_rating` | 動画識別・適格判定・FTS/ランキング | **必須** | **(A)** | SQLite `videos` 既存メタデータから厳密注入可能。 |
| `cut_index`, `title`（カット名） | カット識別・IDF 関連度（4.0 倍重み） | **必須** | **(A)** | API が動画を見て具体技法名を生成可能。 |
| `category`（10 種の正規カテゴリ） | ロール親和性・カテゴリ絞り込み | **必須** | **(A)** | 10 種の固定列挙から API が分類し、`normalize_category()` で正規化可能。 |
| `primary_tool`, `software_stack`, `tool_selection_rationale` | 最善ソフト選定・v2 判定条件 | **必須**（v2 条件） | **(A)** | 編集可能 10 ソフト＋環境外置換ルールをプロンプトと `select_optimal_tool_stack()` で保証可能。 |
| `plugins_used` | 導入済みプラグイン検索・IDF・AE 構成 | **必須**（検索対象） | **(A)** | `LOCAL_AE_PLUGIN_CATALOG` をプロンプトに明示して選択可能。 |
| `layer_stack` | コンポ階層設計・BGM/SE 独立トラック明示 | 推奨（FTS 対象） | **(A)** | 画面構造と音声分離原則を動画視聴から記述可能。 |
| `recreation_flow` | 再現手順・IDF 関連度・FTS 検索 | **必須**（検索対象） | **(A)** | 動画視聴＋制作基準からステップ手順を生成可能。 |
| `anti_ai_slop_notes`, `audio_sync_cues` | AI 臭回避指針・音ハメ指針・FTS | 推奨 | **(A)** | 映像＋音声トラックの同時視聴で記述可能。 |
| `effect_chain`（`order`, `tool`, `plugin`, `match_name`, `fallback_match_name`, `params`） | エフェクト適用順・v2 判定・信頼性 +10 | **必須**（v2 条件） | **(A)**（※パラメータ数値・`keyframed_frames` は **(B)**） | 適用順と `match_name` は (A) で設計可能だが、細かな数値・キーフレーム位置は視覚推定 (B)。 |
| `ae_blueprint.layers`（構造・種別・テキスト・役割） | AE 自動生成用レイヤー定義・信頼性 +10 | 推奨（v2 品質） | **(A)**（※座標・尺・イージング数値は **(B)**） | レイヤー構成と編集可能テキストは (A)、フレーム数と数値イージングは推定 (B)。 |
| `transition_bridge`（入出力ベクトル・マッチキュー・SE 提案） | カット間の連続性設計 | **必須**（未指定時は自動推論） | **(A)** | 前後カットの視覚遷移から記述可能（空でも `synthesize_transition_bridge()` が補完）。 |
| `recommended_code_tools`, `alternative_paths` | コード動画・ハイブリッド代替案 | 任意（自動合成） | **(A)** | `normalize_cut_dict()` が決定論的に自動生成（API 出力不要）。 |
| `start_mmss`, `end_mmss`, `start_sec`, `end_sec` | カット位置・尺（`<=15s` 検証・`needs_recut`） | **必須** | **(B)** | 1 fps サンプリングでは ±0.5〜1.0 秒程度の丸め誤差が生じる（実測カット点ではない）。 |
| `fps`, `start_frame`, `end_frame`, `duration_frames`, `start_tc`, `end_tc`, `frame_timing` | フレーム単位時刻・粒度分類 | **必須**（`compute_frame_timing()` が算出） | **(B)** | 元動画の厳密 FPS（23.976 / 29.97 / 60 等）は `ffprobe` なしでは推定値になる。 |
| `frame_timeline`（`frame`, `time_offset_sec`, `event`, `params`） | 主要フレーム変化表・v2 判定・信頼性 +12 | **必須**（v2 条件） | **(B)** | 1 fps では 0.5s 未満の微細変化（15f 遷移等）の厳密フレーム位置は推定になる（高 fps 拡大で改善可）。 |
| `color_palette_hex`（`base`, `primary`, `accent`） | 60-30-10 パレット固定（`telemetry` 不在時の正本） | **必須**（フォールバック先） | **(B)** | 視覚から近い HEX を出力できるが、ピクセル量子化実測値ではなく推定値。 |
| `easing_and_timing`（`bpm`, `ease_curve`, `hold_frames`, `posterize_fps`） | モーション曲線・ホールド設計 | 推奨 | **(B)** | 動画の印象から推定可能（`verified: false`, `source: "api_estimated"` として明示）。 |
| `ae_blueprint.easing`, `curve_style`, `hold_frames`, `onset_offset_sec`, `peak_offset_sec` | AE キーフレーム補間・タイミング | 任意（自動合成可） | **(B)** | `telemetry` 不在時は推定値または粒度ベース既定値が入る。 |
| `media.gif_path`, `media.strip_path`, `media.start_png`, `media.mid_png`, `media.end_png` | ループ GIF・3×2 ストリップ・静止画キーフレーム | **不要**（空文字可） | **(C)** | ローカル動画に対する `ffmpeg` 切り出しが必須（`capture_cut_visuals()`）。 |
| `media.telemetry`（`luminance`, `palette_hex`, `motion_profile`〔`mean_motion`, `peak_motion`, `hold_ratio`, `curve_8bins`, `flow_dx/dy`, `parallax_spread`〕） | 実測輝度・実測 HEX・実測モーション速度曲線 | **不要**（不在時はフォールバック） | **(C)** | `ffmpeg rawvideo` + `numpy` のピクセル計算が必須（`measure_cut_telemetry()`）。 |
| `media.fps`（`ffprobe` 実測 FPS）・`detect_real_cuts`（`scdet` 実測カット点） | 厳密フレームレート・全編実測カット点 | **不要** | **(C)** | ローカル動画に対する `ffprobe` / `ffmpeg scdet` 実行が必須。 |

### 2-2. `(A) + (B)` のみで `plan_craft_sequence` が動作するかのコード判定

**結論: コード上、`plan_craft_sequence`（および `search_craft_recipes` / `get_craft_recipe` / `extract_style_profile`）は `(C)` が完全に欠けていてもエラーなく動作し、v2 準拠（`is_v2 = True`, `credibility_score = 100`）としてそのまま採用可能である。**

コード上の根拠と具体的な挙動：
1. **空にする項目（`(C)` の扱い）**:
   - `media` は `{}`（または `{"available": false, "status": "missing_requires_local_video", "telemetry": {"available": false}}`）とする。
   - `indexer.upsert_craft_recipe()`（L1603–1670）は `gif_path = ""`, `strip_path = ""`, `keyframes_json = "[]"` として正常登録し、`resolve_studio_path("")` は `""` を返すため例外にならない。
2. **`plan_craft_sequence` のランキング・重みへの影響**:
   - `macro_planner.py` L534–546 のソートキーは `_relevance_score`, `_matched_concepts`, `_title_hit_count`, `calibrated_score`, `needs_recut`, `is_v2`, `credibility_score`, `technique_rating` であり、**`(C)` の有無による直接の減点はゼロ**。
   - したがって `(A)+(B)` が v2 基準を満たせば、`is_v2 = True`, `needs_recut = False`, `credibility_score = 100` となり、既存のローカル v2 レシピと同等に検索・選出される（必要なら将来、ローカル実測レシピを同点時タイブレーカーで 1 段だけ優先する軽い調整を任意追加できる）。
3. **パレット・スタイルプロファイルへのフォールバック**:
   - `macro_planner.py` L617–624: `tel_pal = ((c0.get("media") or {}).get("telemetry") or {}).get("palette_hex")` が `None` の場合、**`c0.get("color_palette_hex")`（項目 B）へ自動フォールバック**する。
   - `craft_recipes.py` `extract_style_profile()`（L1089–1121）: `telemetry.available` が偽でも、`ae_blueprint.palette_hex` / `color_palette_hex` と `ae_blueprint.curve_style` からスタイルプロファイルを組み立て、`avg_hold_ratio = 0.32`, `avg_luma = 78.0` の安全な既定値で正常終了する。
4. **制約が残る下流機能（明示が必要）**:
   - `verify_craft_recreation`（`craft_verifier.py` L229–250）は参照側の `ref_mid_png` / `ref_strip_jpg` / `ref_tel` を使って並列比較画像を生成するため、`(C)` が無いレシピに対しては **ビジュアル比較検証（`verify_craft_recreation`）のみ実行不可**。
   - 人間やエージェントが視覚的に動きを確認する際の `gif_path` / `strip_path` は空となるため、必要時は YouTube の `&t=XXs` ディープリンクで補う。

---

## 3. API 生成レシピの扱い（設計・品質ルール・高 fps 活用・将来格上げ）

### 3-1. 出どころ（Provenance）の記録設計

API で生成したレシピは手元実測レシピと明確に区別できるよう、トップレベルと各カットに次のメタデータを必須付与する（`normalize_cut_dict()` は未知キーを保持する `dict(cut)` 設計のため既存コード破壊なし）：

```json
"provenance": {
  "source": "gemini_api_url_v1",
  "model": "gemini-4-neon",
  "thinking_level": "high",
  "service_tier": "flex",
  "video_processing": { "type": "static", "fps": 1.0, "resolution": "low" },
  "visual_observation_basis": "youtube_url_video_stream",
  "input_video_tokens": 15640,
  "media_telemetry_status": "missing_requires_local_video",
  "field_provenance": {
    "semantic_craft_fields": "api_observed",
    "timestamps_and_duration": "api_estimated_1fps",
    "fps_and_frames": "api_estimated",
    "color_palette_hex": "api_estimated",
    "easing_and_timing": "api_estimated",
    "media_and_telemetry": "missing"
  }
}
```
- 既存の `easing_and_timing` には `"source": "api_estimated", "verified": false`、`ae_blueprint` と `transition_bridge` にも `"source": "api_estimated"` を入れ、手元実測（`"observed"`, `verified: true`）と自動識別可能にする。
- `credibility.verification_tier` は `"api_url_draft_v1"` とし、手元確認済み（`"vision_verified_handcrafted"`）と混同しない。

### 3-2. ルール 2（未視聴除外）等との整合性

- **結論**: Gemini API（YouTube URL 直接渡し）で生成したレシピは、以下の **客観的実視聴ゲート** をすべて満たす限り、ルール 2 の「実際に動画を見て分析したもの（watched）」として整合的に扱える（`analysis_observation_scope` を未視聴タグにせず、`is_craft_eligible` と衝突しない）。
- **実視聴と認定する 3 つの根拠**:
  1. **トークン実測ゲート（必須）**: `input_video_tokens >= max(1000, floor(ref_duration_sec * 90))`（D-017・D-018 および Flex 5×2 事前検証の全 34 呼び出しで、全動画が約 101〜103 video tokens/秒で動画フレームを取り込んでいることを実測済み）。
  2. **時刻つき視覚根拠（必須）**: 全カットに `observed_timestamps` を出力させ、すべて `[0, ref_duration_sec + 5s]` の範囲内かつ既存 `scenes` / 分析内容と矛盾しないことを自動＋抜粋照合する（D-017 で 12/12 本すべて `scenes` と一致確認済み）。
  3. **既存 `is_craft_eligible` との整合**: 本タスクの主対象 4,149 本はそもそも既に `watched_A`（`analysis_observation_scope IS NULL`）であり、さらに `technique_rating >= A-`（2,735 本）を優先すれば、既存の `is_craft_eligible`（L173）および `list_craft_recipes_for_ranking()`（`c.technique_score >= A-`）と 100% 整合する。
- **重要注意点（`B+` 以下の扱い）**: `list_craft_recipes_for_ranking()` と `search_craft_recipes()` の既定フィルタは **`technique_score >= A-`** である。したがって 4,149 本のうち `technique_rating` が `B+` 以下の 1,414 本にレシピを作っても、現行コードのままでは `plan_craft_sequence` の既定呼び出しに載らない。まずは **`technique_rating >= A-`（2,735 本、うち非制限 2,541 本）** または **`calibrated_score >= 78`（A- 相当以上）** を優先対象にするのが合理的である。

### 3-3. 公式ドキュメント確認：YouTube URL での高 fps・区間切り出し設定

Gemini API 公式ドキュメント（`gemini-api-guides/video-understanding.md`, `gemini-api-reference/interactions-api.md#Resource:VideoContent`, `gemini-api-guides/tokens.md`）および `gemini-api` CLI v0.5.0 の `--dry-run` 検証結果：

1. **Interactions API（`gemini-api` CLI）で利用可能な設定**:
   - `VideoContent.processing` に `"type": "static"` を指定し、以下を組み合わせられる：
     - **`fps`**: `(0, 24]` の任意数値（既定 `1.0`）。トークン数は設定した `fps` に比例して増加する。
     - **`start_offset` / `end_offset`**: 秒文字列（例 `"10.5s"`, `"30s"`）。**切り出した区間と選択レイヤーのみ課金**される（`end_offset` が動画長を超えると末尾にクランプ、`start_offset` が動画長を超えると `400 INVALID_ARGUMENT`）。
     - **`content_layers`**: `["frames", "audio", "transcript"]` の任意組合せ（既定 `["frames", "audio"]`）。
     - **`resolution`**: `"low"`（既定・約 100 tok/秒 @ 1 fps）/ `"medium"` / `"high"`（約 300 tok/秒 @ 1 fps）/ `"ultra_high"`。
     - **`processing: "agentic"`**: `gemini-4-neon` 対応だが、公式ガイドは「5 分未満の短尺や全編のフレーム精度が要るタスクでは `static` の方が思考トークンとツール往復を抑えられ適切」と明記。
   - **CLI `--dry-run` 実測確認済み**: `gemini-api generate -m gemini-4-neon --stream=false --body '{"service_tier":"flex","input":[{"type":"text",...},{"type":"video","uri":"https://www.youtube.com/watch?v=...","processing":{"type":"static","start_offset":"2s","end_offset":"10s","fps":4}}]}' --dry-run` が終了コード 0 で正規 Interactions API リクエストを生成することを確認済み（実 API 呼び出しは未実施。YouTube URL に対するサーバー側の `processing` 受理はパイロット試験で実地検証する）。
2. **高速カット動画での精度改善案（2 パス・クリップ拡大方式）**:
   - **Pass 1（全編 1 fps）**: 動画全体を 1 fps で視聴し、v2 レシピ下書き＋注目カット 2〜4 区間を抽出。
   - **Pass 2（注目カットのみ `start_offset`/`end_offset` + `4 fps`, `content_layers: ["frames"]`）**: テンポが速い動画（`overall_cut_pace == "fast"` や `micro_transition` 候補あり）のみ、前後 1 秒マージン付きで計約 15 秒分だけ `4 fps` で再観察し、`start_sec`/`end_sec` と `frame_timeline` を精密化。
   - 全編を 4 fps にすると入力トークンが 4 倍（平均 173 秒動画で 1 本あたり +\$0.08〜\$0.10）に跳ね上がるが、**2 パス・クリップ拡大なら 1 本あたり約 +\$0.031** で同等以上のフレーム精度が得られる。

### 3-4. 将来の `(C)` 後埋め・格上げフロー（ローカル動画入手時）

将来 YouTube ダウンロード再開（D-016 解除）や手元キャッシュ追加で MP4 が入手できた際、API 生成レシピを捨てずに次の 4 ステップでローカル実測版へ非破壊格上げする：
1. **実動画プローブ & 実測カットスナップ**: `ffprobe` で厳密 `fps` を取得し、API 推定の `[start_sec, end_sec]` 前後 ±1.5s に `detect_real_cuts()`（`ffmpeg scdet`）を当てて厳密なカット境界へスナップ（`start_frame`/`end_frame`/`duration_frames` を再計算）。
2. **ビジュアル＆テレメトリ実測（`(C)` 補完）**: `capture_cut_visuals()` を実行し、GIF・3×2 ストリップ JPG・start/mid/end PNG と `measure_cut_telemetry()`（実測輝度・実測 HEX パレット・モーション速度曲線）を `media` に格納。
3. **数値の差し替えと履歴保持**: `color_palette_hex` に実測パレットを反映（API 推定値は `api_draft_backup` に保全）、`easing_and_timing.verified = true, source = "observed"` へ更新、`provenance.source = "gemini_api_url_v1_upgraded_local"`、`credibility.verification_tier = "local_media_upgraded"` に格上げ。
4. **再正規化・SQLite 再登録**: `normalize_cut_dict()` → `save_craft_recipe_json()` → `upsert_craft_recipe()` で上書き更新（レシピ担当機 1 台に集約）。

---

## 4. パイロット試験の準備（事前登録・プロンプト・評価基準）

- **事前登録ファイル**: `analysis/pilot_api_craft_recipe/preregistration.json`
- **事前登録ファイル SHA-256（LF 正規化）**: `e01cc0097d1995e2ae84ec850275132445d5d58d458c2130c345c29d5a45be94`
- **プロンプト SHA-256**: `1c088bb9ff08365d4054dc682f2e5134857181f517c7be1fade208fd8213b0d3`
- **実行条件**: `gemini-4-neon`, `thinking_level: "high"`, `service_tier: "flex"`, `store: false`, 5 本 × 2 回 = 10 呼び出し、予算上限 **\$1.20**、503/429 制御は `scripts/run-api-url-batch.mjs` の後回しキュールール（2 回連続で後回し、3 本連続後回しで停止、一巡後 1〜2 分間隔で 1 回再試行、402/403 即停止）をそのまま流用。全文ログは `E:\iketeru_api_url_logs\pilot_craft_recipe_<run_id>\calls\`（Git 外）に保存。

### 4-1. 固定シードによる 5 本選定（再現可能・層化抽出）

- **適格プール（47 本）**: SQLite `craft_recipes` のうち `platform='youtube'`, `embed_status='available'`, `analysis_observation_scope IS NULL`, `_skip_list.json` 非該当、既存 v2 カット 2 件以上（全カット `credibility_score=100`, `ae_blueprint.layers` あり, `telemetry.available=True` >= 2）、尺 `<=300s`。
- **選定規則**: 5 層それぞれで `SHA-256("iketeru_craft_pilot_v1_20261125:" + video_id)` 昇順の先頭 1 本を重複なしで機械選定。

| # | 層（母数） | Video ID | 尺 | ジャンル | 既存 v2 カット（ツール / 粒度） | 選定の狙い |
|---:|---|---|---:|---|---|---|
| 1 | 短尺 CM `<=30s`（4 本） | `FcIFvzP8-mg` | 14s | `web-cm`, `teaser-trailer` | 2/2（Blender 4s + AE 9s） | 短尺 Apple CM・Blender/AE 複合判定の検証 |
| 2 | 高速カット・グリッチ `<=90s`（2 本） | `jsEVOjI690Y` | 15s | `opening`, `teaser-trailer`, `concept-art` | 3/4（AE, **15f 0.5s `micro_transition` + `micro_fx_glitch` 含む**, peak_motion 0.394） | **高速カット・極短遷移の 1 fps 限界と時刻誤差を実測** |
| 3 | 中尺 OP/CM/ブランド `61-120s`（11 本） | `Xr032EhUDPw` | 90s | `opening`, `mv` | 2/4（Blender 4s + AE 15f 0.5s `micro_transition`） | アニメ OP（呪術廻戦）・高速カット＋ロゴ演出 |
| 4 | 標準尺 MV `121-200s`（5 本） | `I0jHbsidh1g` | 156s | `mv` | 4/4（AE 4s×3 + 15f 0.5s `micro_transition`, peak_motion 0.463） | 2D 作画＋3×3 グリッド転換の多カット抽出検証 |
| 5 | 長尺・多カット MV `201-300s`（8 本） | `kqj7b59D85Y` | 208s | `mv`, `youtube-sns` | 3/3（AE 3.5s×2 + 15f 0.5s `micro_transition`, peak_motion 0.577） | 長尺・BPM135 コマ打ち高速 MV の長距離探索検証 |

### 4-2. 比較方法と合格ライン（7 指標）

| ID | 評価指標 | 合格ライン | 必須ゲート | 検証方法 |
|---|---|---|:---:|---|
| **M1** | 形式検証・制作基準チェック通過率 | **100%（10/10 回）** | 必須 | JSON パース、全必須 v2 項目、全カット `<=15.0s`、`normalize_cut_dict()`、`score_recipe_credibility() >= 90`、`validate_production_compliance()`（生成 AI 動画 0・画像テロップ 0・音声分離）。 |
| **M2** | 実視聴トークン検証（ルール 2 根拠） | **100%（10/10 回）** | 必須 | `input_video_tokens >= max(1000, floor(dur * 90))` かつ全 `observed_timestamps` が `[0, dur + 5s]` 内。 |
| **M3** | 既存 v2 レシピ技法の再現率（Recall） | **70% 以上** | 必須 | 既存 v2 の `technique_unit`/`complex_composite` カットのうち、API 下書きが主要技法・カテゴリ・視覚モチーフを拾えた割合（0.5s `micro_transition` は別集計して 1 fps の限界も把握）。 |
| **M4** | API 独自抽出技法の実在確認率（作り話検査） | **90% 以上** | 必須 | API だけが挙げたカット・技法について、SQLite の既存 `scenes` および `ai_analysis`（＋必要時スポット確認）と照合して動画内実在を確認できた割合。 |
| **M5** | 主要カット時刻誤差の中央値（項目 B） | **1.0 秒以内** | 必須 | 既存 v2 と対応した主要カットにおける開始・終了時刻誤差の中央値（0.5s `micro_transition` は別集計し、Pass 2 の 4 fps 拡大が必要かを判断）。 |
| **M6** | `plan_craft_sequence` 読み込み・稼働検証 | **100%（5/5 本）** | 必須 | **本番 DB には一切書き込まず、ローカル SQLite の一時コピーに対して** `upsert_craft_recipe()` → `search_craft_recipes(v2_only=True)` → `get_craft_recipe()` → `build_macro_sequence_plan()` → `extract_style_profile()` を実行し、例外ゼロ・パレット/ブループリント正常返却を確認。 |
| **M7** | r1 / r2 間の安定性（参考） | 報告（目安 75% 以上） | 参考 | 同一動画 2 回実行間の `primary_tool`・`category` 一致率およびカット時間区間の重なり（IoU）。 |

---

## 5. 費用の見積もり（実測トークン単価ベース）

### 5-1. 1 本・1 呼び出しあたりの費用式

- **料金単価（`gemini-4-neon`, Flex = Standard の半額）**: 入力 **\$1.50 / 1M tok**、出力＋思考 **\$7.50 / 1M tok**。
- **入力トークン**: プロンプト＋メタデータ約 `2,500 tok` ＋ 動画ストリーム `105 × d × fps` tok（パイロット 34 回実測 101〜103 video tok/秒＋小幅オーバーヘッド、`d` = 動画尺〔秒〕）。
- **出力＋思考トークン（`T_out_th`）**: v2 レシピ 2〜4 カット JSON（出力約 3,000 tok）＋ `thinking_level: high`（思考約 4,000 tok）＝ **基準 7,000 tok**（下限 5,000 tok〜上限 10,000 tok のレンジで見積もり）。
- **1 呼び出しあたり費用式（Flex, `1 fps`）**:
  $$\text{Cost}_{\text{Flex}}(d) = \frac{2{,}500 + 105 \cdot d \cdot \text{fps}}{10^6} \times 1.50 + \frac{T_{\text{out+th}}}{10^6} \times 7.50$$
  基準値（`fps = 1`, `T_out_th = 7,000`）を代入すると：
  $$\text{Cost}_{\text{Flex,base}}(d) = \$0.05625 + \$0.0001575 \cdot d$$
  （例：15 秒 CM = **\$0.059**、90 秒 OP = **\$0.070**、180 秒 MV = **\$0.085**、300 秒 MV = **\$0.104**）

### 5-2. パイロット試験（5 本 × 2 回 = 10 呼び出し、合計尺 483 秒）

| 条件（Flex） | 出力＋思考想定 | 5 本 × 1 回 | **5 本 × 2 回（10 呼び出し）** | 参考：Standard 2 回 |
|---|---:|---:|---:|---:|
| 下限ケース（`1 fps`） | 5,000 tok | \$0.28 | **\$0.56** | \$1.13 |
| **基準ケース（`1 fps`）** | **7,000 tok** | **\$0.36** | **\$0.71** | **\$1.43** |
| 上限ケース（`1 fps`） | 10,000 tok | \$0.47 | **\$0.94** | \$1.88 |
| 全編 `2 fps`（基準） | 7,000 tok | \$0.43 | **\$0.87** | \$1.73 |
| 全編 `4 fps`（基準） | 7,000 tok | \$0.59 | **\$1.17** | \$2.34 |
| 2 パス拡大（1 fps 全編＋4 fps×15s 抜粋） | 7,000 + 2,500 tok | \$0.51 | **\$1.03** | \$2.05 |

→ パイロット試験（`1 fps`, 5 本 × 2 回）の推奨予算上限は **\$1.20**（現在 11 月残クレジット約 \$35.44 / \$38 上限に対して十分余裕あり）。

### 5-3. レシピなし 4,158 本のうち YouTube 全 4,149 本の処理費用と所要月数

SQLite 実測（`watched_A + scenes あり + craft_recipes なし` = **4,158 本**、うち YouTube **4,149 本**、Vimeo 7、External 1、Instagram 1）の正確な合計尺にもとづく試算（Flex・本番 1 本 1 回生成＋バリデーション失敗時のみ再試行前提、月間クレジット **\$40/月**〔安全上限 **\$38/月**〕）：

| 対象スコープ（4,149 本の内訳） | 本数 | 平均尺 | **1 fps（1 回/本）基準**〔レンジ〕 | 月 \$40 所要月数（\$38 上限） | 全編 `2 fps`（1 回/本） | 全編 `4 fps`（1 回/本） | 2 パス拡大 `4 fps×15s`（全本適用時） |
|---|---:|---:|---:|---:|---:|---:|---:|
| **YouTube 全量（4,149 本）** | 4,149 | 212.1s | **\$371.95**〔\$309.71–\$465.30〕 | **9.3 か月**（9.8 か月） | \$510.52（12.8 か月） | \$787.65（19.7 か月） | \$501.40（12.5 か月） |
| うち 15 分以下（`<=900s`） | 4,044 | 165.8s | **\$333.08**〔\$272.42–\$424.07〕 | **8.3 か月**（8.8 か月） | \$438.69（11.0 か月） | \$649.91（16.2 か月） | \$459.26（11.5 か月） |
| うち非制限（`embed != restricted`） | 3,714 | 222.7s | **\$339.19**〔\$283.48–\$422.75〕 | **8.5 か月**（8.9 か月） | \$469.46（11.7 か月） | \$730.02（18.3 か月） | \$455.07（11.4 か月） |
| うち非制限かつ `<=900s` | 3,614 | 173.1s | **\$301.80**〔\$247.59–\$383.11〕 | **7.5 か月**（7.9 か月） | \$400.31（10.0 か月） | \$597.33（14.9 か月） | \$414.56（10.4 か月） |
| **`is_craft_eligible`（技術 `A-` 以上）** | **2,735** | 188.1s | **\$234.88**〔\$193.85–\$296.42〕 | **5.9 か月**（6.2 か月） | \$315.91（7.9 か月） | \$477.98（11.9 か月） | \$320.21（8.0 か月） |
| **推奨優先母数：技術 `A-` 以上・非制限** | **2,541** | 192.1s | **\$219.83**〔\$181.71–\$277.00〕 | **5.5 か月**（5.8 か月） | \$296.72（7.4 か月） | \$450.52（11.3 か月） | \$299.11（7.5 か月） |
| 推奨優先母数の `<=900s`（先攻分） | 2,506 | 171.5s | **\$208.67**〔\$171.08–\$265.05〕 | **5.2 か月**（5.5 か月） | \$276.37（6.9 か月） | \$411.79（10.3 か月） | \$286.86（7.2 か月） |

- **ポイント**:
  1. 本番を **1 本 2 回** 実行する場合は上記表の **ちょうど 2 倍**（4,149 本で **\$743.90 / 18.6 か月**、技術 `A-` 以上・非制限 2,541 本で **\$439.66 / 11.0 か月**）。点数付けと異なりクラフトレシピは構造化テキスト下書きのため、パイロット 5 本 × 2 回で安定性（M7）を確認できれば、本番は **1 本 1 回＋自動検証失敗時のみ再試行** での運用を推奨する。
  2. 15 分超の 105 本（全 4,149 本の 2.5%）だけで動画総秒数の 23.8%（約 \$39）を占めるため、点数付け設計と同様に **`<=900s` 先攻・`>900s` 後回し** が効率的。
  3. 共有キャッシュ済み 132 本（うち `A-` 以上 93 本）は手元動画から完全版（`(C)` 付き）を無料で作成できるため、API は未キャッシュ YouTube に集中できる。
  4. 2 パス拡大（`4 fps × 15s`）を**高速カット動画（全体の約 25% 想定）だけに限定適用**すれば、2,541 本全体で **+\$19.8（+9%）** に抑えられる。

---

## 6. パイロット試験の実行前にユーザーが決めること

1. **パイロット 5 本 × 2 回（Flex, `1 fps`, 予算上限 \$1.20）の実行可否**: 上記の固定シード 5 本・プロンプト・合格ライン（`preregistration.json`）で実行してよいか。
2. **高速カット枠での `4 fps` クリップ拡大（Pass 2）を初回パイロットに含めるか**:
   - 案 A（推奨）: まず `1 fps` のみ（10 呼び出し・約 \$0.71）で実測し、高速カット動画（`jsEVOjI690Y`, `Xr032EhUDPw`）の時刻誤差が 1.0 秒を超えた場合のみ追加で Pass 2（`start_offset`/`end_offset` + `4 fps`、約 +\$0.15）を試す。
   - 案 B: 最初から 2 本だけ `4 fps` 比較を同時実行する（合計上限 \$1.50）。
3. **プロンプトへ既存 `scenes`（Ch.3 の大まかなタイムスタンプ一覧）を渡すか**:
   - 今回の事前登録プロンプトでは **タイトル・ジャンル・尺など軽量メタデータのみ渡し、`scenes` 本文は渡さない**（M4 の作り話検査で既存 `scenes` を独立した答え合わせに使えるようにするため）。この方針でよいか。
4. **本番展開時の対象優先順位と 1 本あたり呼び出し回数**（パイロット合格後に最終決定）:
   - `technique_rating >= A-`・非制限・未キャッシュ・`<=900s`（約 2,413 本、1 回/本で約 \$201・約 5 か月）を第 1 優先とするか、4,149 本全量を対象とするか。
   - 同時期に `docs/STATUS_OVERVIEW_20261125.md` の共有キャッシュ済み 95〜471 本（無料・完全版）の 3 台並列レシピ化とどう並行するか。
