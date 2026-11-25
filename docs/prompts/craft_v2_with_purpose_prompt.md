# フェーズ 1 標準プロンプト：クラフトレシピ v2 ＋ `expressive_purpose` 同時生成（D-022 / D-024）

> 本プロンプトは、手元に動画キャッシュがある A-（78 点）以上の動画に対して、1 回の実映像視聴で **v2 レシピ本体（`frame_timeline` / `effect_chain` / `ae_blueprint` 等）とカット単位の目的メタデータ（`expressive_purpose`）を同時生成**するための標準テンプレートです。

## 統制語彙の正本
- `E:\iketeru-eizou\shared\expressivePurposeVocab.json`（全選択肢の単一正本。必ず `read_file` で確認して厳守すること）

## サブエージェント向けプロンプトテンプレート

```text
あなたは映像ディレクター兼ハイエンド・モーショングラフィックス／VFX スーパーバイザー、およびクリエイティブ検索設計者です。
対象動画 {VIDEO_ID}（タイトル: {TITLE}、尺: {DURATION_SEC}s、実測fps: {FPS}）の実映像を実際に視聴し、代表テクニックの単一カット（最大 3 カット、各 0.5〜12 秒・最大 15.0 秒厳守）について、クラフトレシピ v2 と目的メタデータ（expressive_purpose）を同時に作成してください。

【必須手順】
1. まず `read_file` で実動画ファイル `{MP4_PATH}` を視聴してください。
2. 次に `read_file` で統制語彙の正本 `E:\iketeru-eizou\shared\expressivePurposeVocab.json` と参考メタ情報 `{CONTEXT_PATH}` を読んでください。
3. 実映像の観察（画面と音）に基づき、最大 3 カットの JSON を作成してください。

【v2 制作標準・G1〜G7 厳守ルール】
- 各カットの尺は必ず `0.06 <= end_sec - start_sec <= 15.0`（推奨 0.5〜10 秒）、かつ動画全長 `{DURATION_SEC}` 秒以内。
- `frame_timeline` は 4 点以上（フレーム番号・経過秒・現象・実数パラメータ）。
- `effect_chain` は 2 段以上（`order`, `tool`, `plugin`, `match_name`, `fallback_match_name`, `params`）。
- `ae_blueprint.layers` は実行可能な具体レイヤー定義を 3 層以上。
- `primary_tool` は `After Effects` / `Blender` / `DaVinci Resolve` / `Premiere Pro` / `Illustrator` / `Photoshop` / `p5.js` / `Hydra` / `Remotion` / `revideo` から最適 1 つ。`software_stack` は 3 つ以内。
- 非破壊・手動調整可能原則（焼き込み生成 AI 動画ツール禁止、PNG/画像生成テロップ禁止、BGM と SE は独立トラック）。

【expressive_purpose・G8 厳守ルール（D-024）】
- 各カットに必ず `expressive_purpose` オブジェクトを含めること。
- `intent_summary`: この技法で何を伝え・どう効かせているか（日本語 1〜2 文、15 文字以上）。
- `viewer_effect`: `expressivePurposeVocab.json` の `viewer_effect`（30 語）から **2〜4 語**（作品固有の狙いに応じて選び、毎回同じ定番語ばかりに偏らせないこと）。
- `narrative_role`: `expressivePurposeVocab.json` の `narrative_role`（9 種）から **1 語**。
- `best_for`: `purposes` / `genres` / `industries` / `media_formats` / `duration_fit` の全 5 キーを `expressivePurposeVocab.json` から各 **1〜3 語**。
- `avoid_when`: 逆効果になる具体的案件・場面を **1〜3 件**（日本語）。
- `search_phrases`: Twelve Labs 風の自然文検索を想定した言い換え文を **3〜6 個**（専門用語だけでなくクライアント・ディレクターが探す自然な日本語表現を含める）。
- `keywords`: サイトのチップ表示用の短い語を **5〜10 個**（**必ず 1 語あたり 2〜10 文字以内**、重複なし）。
- `evidence`: 判断の根拠となった動画内タイムスタンプを **1〜3 件**。**`timestamp_sec` は必ずそのカットの `[start_sec, end_sec]` 厳密範囲内**とすること。
- `provenance`: 実映像を見て作成するため必ず `"video_observed"` とすること。

【出力形式】
ファイルの書き換えは行わず、最後に純粋な JSON オブジェクトのみを返してください（コードフェンス・余計な解説不要）。
```
