# 映像の分析・分解と編集データ自動生成の設計メモ（最終的な姿・2026-11-23）

- **文書ステータス**: 設計メモ（方針整理のみ・**実装は未着手**）
- **着手予定時期**: **Phase 2（較正テスト）の完了後**
- **関連文書**:
  - [IMOUTOID_VISUAL_PRINCIPLES.md](IMOUTOID_VISUAL_PRINCIPLES.md)（原則 (c)「自動化の出力は、あとから編集できる形にする」）
  - [how-it-works.md](how-it-works.md)（処理の見える化）
  - [glossary.md](glossary.md)（用語集）
  - 制作標準スキル `iketeru-production-standards`（フォルダ構成・非破壊ルール・クラフトレシピ v2 基準）

---

## 1. 目指す最終的な姿（ユーザー方針）

本プロジェクトのゴールは、単に参考動画に点数をつけて並べることではなく、**「優れた映像を『再現できる部品』に分解して蓄積し、自分の作品を作るときにそのまま開いて編集できるデータとして自動生成できる仕組み」**を作ることである。

### 1.1 分析の方針（対象を広げて「再現可能な単位」に分解する）
参考映像を **「どのソフトの・どんな処理で・どんな設定値にすれば再現できるか」** という具体的な単位に分解して記録する。対象は After Effects や Blender に限定せず、映像制作の現場で使われる幅広い道具と実写撮影技術を含める。

| 領域 | 対象となるソフト・道具・技術 | 分解して記録する主な内容 |
|---|---|---|
| **Adobe 系全般** | After Effects、Premiere Pro、Illustrator、Photoshop、Audition 等 | レイヤー構造、エフェクト連鎖と実数値、エクスプレッション（数式で動きを制御する式）、イージング（動きの緩急カーブ）、ベクターパス、レイヤースタイル、音声エフェクト |
| **3DCG / 統合編集** | Blender、DaVinci Resolve（Edit / Color / Fusion / Fairlight） | Geometry Nodes（ノードをつないで形や動きを作る仕組み）、シェーダ／マテリアル、カメラ設定、照明リグ、Resolve 8ノードカラー構成、Fusion ノードツリー、Fairlight 整音 |
| **オープンソース・プログラミング道具** | p5.js / Processing、GLSL シェーダ（GPU でリアルタイムに絵を描くプログラム）、ffmpeg（動画変換・加工ツール）、Remotion（コードで動画を作る仕組み）、TouchDesigner 等 | アルゴリズム種別（ノイズ場・再帰・セルオートマトン等）、再現用コードとパラメータ、解像度・fps、シード値（乱数を再現する番号）<br>※**商用利用・配布時のライセンスや利用条件はツール・ライブラリごとに個別確認する** |
| **実写の撮影技術** | カメラ・レンズ・照明・現場演出 | ライティング（光源の向き・硬さ・色温度・逆光/サイド光）、構図（三分割・シンメトリー・被写界深度）、レンズと焦点距離（広角/標準/望遠の目安）、カメラの動き（フィックス、ドリー、手持ち、ジンバル、パン/チルト）、色の作り方（Log 撮影〜ルック設計） |

### 1.2 生成の方針（実写とそれ以外で明確にルールを分ける）
生成フェーズでは、**「実写以外」と「実写」を明確に分けて扱う**。

| 対象領域 | 生成の基本方針 | 出力する形 |
|---|---|---|
| **実写以外**（モーション、3DCG、アニメ、タイポグラフィ、図形・UI演出など） | **編集できるデータ（編集プロジェクト）を自動生成する**。焼き込みの完成動画（`.mp4` だけ）で終わらせない。 | AE スクリプト（`.jsx`）・エクスプレッション、Blender スクリプト（`.py`）・ノード構成、Resolve Python / PowerGrade / Fusion マクロ、Premiere/Resolve 用タイムライン（`.xml` / `.otio`）、Illustrator/Photoshop 編集可能素材、p5.js / GLSL / Remotion コードなど |
| **実写の部分** | **生成AI（動画生成・画像生成）を使ってよい**。 | 生成した実写クリップを **独立した素材ファイル（`02_DL素材` 等）** としてタイムラインに配置する。実写生成素材を使う場合でも、**カラー調整・編集可能テロップ（`.srt` / テキストレイヤー）・BGMとSEのトラック分離は非破壊（あとから直せる状態）を厳守**する。 |

> **音楽制作との方針の違い（重要）**：
> 音楽側（`sc-av-studio`）では「完成オーディオの焼き込み生成を避け、MIDI や DAW プロジェクトなど編集可能な形を中心にする」方針だが、**映像側では「実写の撮影代替パートに限って生成AIを使ってよい」**という明確な違いを置く。一方で、実写以外のモーション・3DCG・アニメ・タイポグラフィは引き続き「編集データ自動生成」を徹底する。

---

## 2. `IMOUTOID_VISUAL_PRINCIPLES.md` との接続

[IMOUTOID_VISUAL_PRINCIPLES.md](IMOUTOID_VISUAL_PRINCIPLES.md) の4原則、とくに **原則 (c)「自動化の出力は、あとから編集できる形にする」** および **原則 (b)「手でできないことこそ自動化し、良し悪しは『目』で判断する」** と、本方針は以下のように直結する。

1. **原則 (c) との接続（編集可能性の担保）**：
   - モーション・3DCG・アニメ・タイポグラフィを「編集データ」で出力することで、AI が作った土台をユーザーが After Effects / Blender / DaVinci Resolve / コード環境で開いて、**タイミング・色・動きのカーブを自分の手で追い込める**。
   - 実写パートに生成AIを使う場合も、合成・グレーディング・テロップ・音響を焼き込まずにプロジェクト上で分離配置するため、全体の編集可能性は失われない。
2. **原則 (b) との接続（適材適所の自動化＋人間の目による仕上げ）**：
   - フレーム単位の音ハメ、複雑なパーティクルや数学的アニメーション、複数ソフト間のプロジェクト骨格づくりは自動化し、最終的な「気持ちよさ・面白さ」はユーザーが編集画面を開いて目で確認・調整する。
3. **原則 (d) との接続（自作道具と多様な処理系の適材適所）**：
   - 1つのソフトに無理やり押し込まず、「図形や文字の細かい動きは AE」「3Dや物理は Blender」「数学的増殖やリアルタイム視覚実験は p5.js / GLSL / TouchDesigner」「色と音は Resolve」のように、表現に最も合う道具を選ぶ。

---

## 3. 共通の中間書式（Universal Visual Decomposition IR）案

参考映像を分析するとき、最初から「AE 専用のメモ」や「Blender 専用のメモ」として別々に書いてしまうと、あとで別のソフトへ展開しにくくなる。そこで、**どのソフトにも変換しやすい「中間の記録形式（共通の書式）」**を間に置く設計とする。

```text
[参考映像]
    │  (分解・分析)
    ▼
[共通の中間書式（Visual Decomposition IR / JSON）]
  ・いつ（フレーム／秒）
  ・何が（対象・実写か非実写か）
  ・どんな表現・数値か（動き・色・カメラ・音同期・撮影条件）
  ・どの道具が最適か（主ツール・代替ツール・ライセンス確認欄）
    │
    ├──▶ After Effects 変換器（.jsx / エクスプレッション / 制御ヌル）
    ├──▶ Blender 変換器（.py / Geometry Nodes / カメラ・ライト）
    ├──▶ DaVinci Resolve 変換器（.py / 8ノードカラー / Fusion / .otio）
    ├──▶ Adobe 連携（Premiere .xml / Illustrator・Photoshop .jsx / Audition）
    ├──▶ コード映像変換器（p5.js / GLSL / Remotion / ffmpeg / TouchDesigner）
    └──▶ 実写・生成AIブリーフ（撮影指示書 または 実写生成AI用プロンプト＋非破壊合成設計）
```

### 3.1 中間書式（JSON）の最小骨格案

```json
{
  "schema_version": "visual_ir_v1_draft",
  "source_video_id": "参考動画ID",
  "unit_id": "unit_001",
  "granularity": "technique_unit",
  "time_range": {
    "fps": 24,
    "start_frame": 120,
    "end_frame": 216,
    "start_tc": "00:05:00",
    "end_tc": "00:09:00"
  },
  "domain_type": "non_live_action",
  "generation_policy": "editable_project_required",
  "intent_summary": "ビートに合わせて文字が拡大しながら色収差で一瞬ズレる見出し演出",
  "layers_and_elements": [
    {
      "element_id": "el_title",
      "kind": "typography",
      "editable_requirement": "native_text_layer",
      "motion_curve": {
        "property": "scale",
        "keyframes": [
          { "offset_frame": 0, "value": 85, "easing": "cubic-bezier(0.16, 1, 0.3, 1)" },
          { "offset_frame": 8, "value": 102, "easing": "linear" },
          { "offset_frame": 14, "value": 100, "easing": "ease-out" }
        ]
      }
    }
  ],
  "visual_effects": [
    {
      "effect_concept": "chromatic_aberration_pulse",
      "peak_offset_frame": 4,
      "intensity_0_to_1": 0.45,
      "duration_frames": 4
    }
  ],
  "live_action_capture": null,
  "audio_sync": {
    "trigger": "kick_onset",
    "offset_frames": -1,
    "sfx_role": "impact_accent_separate_track"
  },
  "tool_mapping": {
    "primary_tool": "After Effects",
    "supporting_tools": ["Illustrator", "DaVinci Resolve"],
    "alternative_tools": ["Remotion", "GLSL", "TouchDesigner"],
    "license_check_note": "標準機能のみ（外部OSS・有償プラグイン使用時はライセンス条件を個別記載）",
    "tool_specific_hints": {
      "after_effects": { "match_names": ["ADBE Shift Channels", "ADBE Transform"] },
      "glsl": { "shader_concept": "radial_rgb_split_uv_offset" }
    }
  }
}
```

- **実写カットの場合**は `domain_type: "live_action"`、`generation_policy: "generative_ai_allowed_with_nondestructive_timeline"` とし、`live_action_capture` ブロックに以下を記録する：
  - `lighting`（キーライト方向、コントラスト比、色温度、逆光／ハレーション有無）
  - `composition`（構図、被写体サイズ、被写界深度）
  - `lens_and_camera`（焦点距離の目安［広角/標準/望遠］、カメラワーク［フィックス/ドリー/手持ち等］）
  - `color_look`（ベースコントラスト、シャドウ/ハイライトの色味、Resolve 8ノード構成への対応）

---

## 4. 既存の `craft recipe`・レシピ v2 との関係整理

本プロジェクトには、すでに既存のクラフトレシピの仕組みが存在する。新しい共通中間書式は、既存資産を捨てて作り直すのではなく、**段階的に上位互換として統合する**。

| 世代 | 現在の位置づけ | 強み | 課題・拡張する点 |
|---|---|---|---|
| **既存 `craft_recipes`（v1）** | `iketeru-eizou` DB / MCP ツール（`search_craft_recipes`, `get_craft_recipe`, `plan_craft_sequence`）に保存されている既存レシピ | 検索・一覧・構成プランニングの仕組みがすでに動く | 説明が文章中心だったり、AE 寄りの記述・長めの区間が混在しやすい |
| **クラフトレシピ v2**（`iketeru-production-standards` 第5章） | 制作標準で定めた最新基準（`micro_transition` 2〜24f / `technique_unit` 0.5〜8s / `complex_composite` 1〜12s、`frame_timeline`・`effect_chain`・`primary_tool` 必須） | フレーム単位の精度と、最善ソフト選定ルールがすでに明文化されている | ソフト固有の `match_name` に寄るため、複数ソフト（Adobe全般・Resolve・OSSコード・実写撮影）を横断変換する抽象層がまだ薄い |
| **共通中間書式（本設計メモ：IR 層）** | レシピ v2 の中身を「ソフト非依存の抽象表現（`visual_ir`）」と「ソフト別変換ヒント（`tool_mapping`）」にきれいに分離した拡張仕様 | 1つの分析記録から AE / Blender / Resolve / p5.js / GLSL / Remotion / 実写撮影・生成AIブリーフのすべてへ展開可能 | **Phase 2 較正テスト完了後に**、既存レシピ v1/v2 からの変換ルールとスキーマを正式設計・実装する |

### 今後の進め方（Phase 2 完了後のロードマップ案）
1. **Phase 2 完了まで**：本設計メモの維持のみ（DB スキーマ変更・実装は行わない）。
2. **Phase 3-1（スキーマ確定）**：共通中間書式（`visual_ir_v1`）の正式仕様を確定し、既存 `craft_recipes` テーブルとの互換・格納方法を決める。
3. **Phase 3-2（分解プロトタイプ）**：Phase 1/2 の受賞作から 5〜10本の代表カットを選び、実写・モーション・3DCG・タイポ・コード映像それぞれで中間書式への分解を試行する。
4. **Phase 3-3（自動生成ジェネレータ接続）**：中間書式から AE `.jsx` / Blender `.py` / Resolve `.py` / Remotion・p5.js・GLSL コードを吐き出し、実際に各ソフトで開いて編集できることを検証する。
