# 映像技法辞典 マスター索引（全5冊統合・逆引きガイド）

- **作成日**: 2026-11-23
- **目的（厳守）**:
  - 本ディレクトリ（`docs/technique_dictionary/`）の 5 冊は、映像作品を **「どのツールの、どの機能・撮影の工夫で再現できるか」へ分解するための技法リファレンス** です。
  - **映像の良し悪しの採点基準（Phase 2 校正済みスコア）には一切使用しません。**
  - すべての元 PDF は画像のみ（文字データなし）のため、ローカル Windows 標準日本語 OCR（250 DPI・完全オフライン）で読み取り、**生 OCR データはリポジトリ外（`E:\技術書_index\ocr_private\`）のみに保管** しています。リポジトリ内には **自分の言葉の要約＋ページ番号＋ツール別再現方法の補足** のみを収録し、全冊とも数値自動照合スクリプト（`scripts/verify-technique-dictionary-numbers.py --strict`）・実物画像確認・丸写しチェック 0 件を通過しています。

---

## 1. 全5冊 辞典一覧（冊ごとの項目数・対象バージョン・OCR品質）

| 順 | 書籍タイトル | 対象バージョン / 刊行 | 総ページ | OCR 有効文字率 / 本文読取率 | 収録項目数 | 技法 ID 体系 | ファイル |
|---|---|---|---|---|---|---|---|
| ① | 『カラーコレクションハンドブック 第2版』 | 汎用（DaVinci / AE / Blender 対応） | 630p | **99.47%** / 98.25%（619/630p） | **30項目**（Ch.1–10＋Appendix A） | `COLOR-001`〜`COLOR-030` | [color_correction_handbook_2nd.md](color_correction_handbook_2nd.md) / [JSON](color_correction_handbook_2nd.json) |
| ② | 『After Effects モーションデザイン すぐに使える実用アイデア見本帳』 | After Effects（2024年10月初版） | 273p | **98.83%** / 97.07%（265/273p） | **34項目**（全55レシピ＋Appendix 9選） | `AE-001`〜`AE-034` | [aftereffects_motion_design.md](aftereffects_motion_design.md) / [JSON](aftereffects_motion_design.json) |
| ③ | 『プロフェッショナル Blender』 | **Blender 4.2**（一部 3.6/4.0 混在・現行版補足付き） | 536p | **99.48%** / 98.13%（526/536p） | **30項目**（全6部50章） | `BL-001`〜`BL-030` | [professional_blender.md](professional_blender.md) / [JSON](professional_blender.json) |
| ④ | 『職種と用途で探せる Blender アドオン事典』（逆引き索引） | **Blender 3.6〜4.3**（2025年2月確認＋2026-11-23 公式Extensions照会） | 439p | **99.12%** / 96.13%（422/439p）※全188カード目視確認 | **219アドオン索引**（Part 1: 188本＋Part 2: 31本）＋補足2項目 | `ADDON-001`〜`ADDON-002`（＋全219本一覧） | [blender_addon_encyclopedia.md](blender_addon_encyclopedia.md) / [JSON](blender_addon_encyclopedia.json) |
| ⑤ | 『映像制作 D.I.Y.』（作家制作事例集） | 2011年刊行（現行ツール再現補足付き） | 207p | **99.51%** / 93.72%（194/207p） | **20項目**（作家19組＋公開発信編） | `DIY-001`〜`DIY-020` | [video_production_diy.md](video_production_diy.md) / [JSON](video_production_diy.json) |
| **合計** | **全5冊（計 2,085ページ）** | — | **2,085p** | 平均 **99.28%** | **技法 116項目 ＋ アドオン 219本索引** | `COLOR` / `AE` / `BL` / `ADDON` / `DIY` | [index.json](index.json) |

---

## 2. クロスブック技法 ID 対応表（目的・表現からの横断逆引き）

映像を分解したとき、どの冊子のどの技法 ID とアドオンを組み合わせれば再現できるかを制作工程別に横断マッピングしています。

| 制作領域・やりたい表現 | ① カラー (`COLOR`) | ② AEモーション (`AE`) | ③ Blender (`BL`) | ④ Blender アドオン（抜粋） | ⑤ 制作事例・撮影DIY (`DIY`) |
|---|---|---|---|---|---|
| **基本設計・色基準・モニター・規格適合** | `COLOR-001`, `COLOR-002`, `COLOR-003`, `COLOR-008`, `COLOR-029` | `AE-034` | `BL-001`, `BL-002`, `BL-005` | `Matalogue`, `Copy Attributes Menu`, `Modifier List`, `3D Viewport Pie Menus` | `DIY-014`, `DIY-015`, `DIY-020` |
| **明暗・コントラスト・Log・露出救済・色温度** | `COLOR-004`, `COLOR-005`, `COLOR-006`, `COLOR-007`, `COLOR-009`, `COLOR-010`, `COLOR-011`, `COLOR-012`, `COLOR-013` | — | `BL-005`（AgX・Cycles/EEVEE） | `Photographer 5`, `Colorista`, `Colorist Pro`, `Final LUT`, `Denoiser Comp` | `DIY-014`（配信照明調整） |
| **特定色抽出・肌・空・緑・ルック設計・ショット統一** | `COLOR-014`〜`COLOR-028`, `COLOR-030` | `AE-031`, `AE-033` | `BL-003`, `BL-013`, `BL-014` | `Dynamic Sky`, `Real Sky`, `True-Sky`, `Physical Starlight`, `Alt Tab Easy Fog 2`, `Blendshop` | `DIY-007`, `DIY-012`, `DIY-015`, `DIY-017` |
| **テキスト・ロゴ・モーショングラフィックス** | — | `AE-001`〜`AE-010`, `AE-012`, `AE-013`, `AE-017`, `AE-018` | `BL-001`, `BL-006` | `ANIMAX`, `TraceGenius Pro`, `Geo Primitive` | `DIY-005`, `DIY-006`, `DIY-011`, `DIY-016` |
| **トランジション・シーン切替・スピード表現** | `COLOR-023` | `AE-023`〜`AE-030` | `BL-005` | `Dolly Zoom`, `Camera Shakify`, `Cinepack`, `FALCON CAM`, `SMEAR` | `DIY-005`, `DIY-006`, `DIY-009` |
| **グリッチ・アナログ質感・手描き・水彩・切り絵・NPR** | `COLOR-030` | `AE-008`, `AE-016`, `AE-031`, `AE-032`, `AE-033` | `BL-006`, `BL-009`, `BL-010`, `BL-012` | `Pencil+ 4 Line`, `NijiGPen`, `Brushstroke Tools`, `Deep Paint`, `GP Animator Desk`, `Pixel`, `Komikaze`, `InkTool`, `Clay Doh` | `DIY-002`, `DIY-003`, `DIY-007`, `DIY-009`, `DIY-012`, `DIY-013` |
| **キャラクター・表情・リギング・ウェイト・モーフィング** | `COLOR-024`, `COLOR-025` | `AE-019`, `AE-020`, `AE-021`, `AE-022` | `BL-004`, `BL-030` | `Auto-Rig Pro`, `Faceit`, `Mio3 Copy Weight`, `EasyWeight`, `Voxel Heat Diffuse Skinning`, `Mio3 ShapeKey`, `Wiggle 2`, `VRM format`, `AnimAll` | `DIY-001`, `DIY-004`, `DIY-008`, `DIY-010` |
| **3Dモデリング・スカルプト・リトポ・UV・Substance連携** | — | — | `BL-016`〜`BL-023` | `Bool Tool`, `LoopTools`, `F2`, `EdgeFlow`, `PolyQuilt`, `Quad Remesher`, `Boxcutter`, `Hardops`, `Mio3 UV`, `UniV`, `TexTools`, `Zen UV`, `UVPackmaster 3`, `Ucupaint`, `SimpleBake`, `GrabDoc`, `ACT` | `DIY-011`, `DIY-012` |
| **自然・流体・炎・破壊・スキャッターFX** | `COLOR-020`, `COLOR-026`, `COLOR-027` | `AE-011`, `AE-014`, `AE-015` | `BL-011`, `BL-015` | `BagaPie`, `Geo-Scatter`, `Cell Fracture`, `RBDLab`, `KaFire`, `VDBLab`, `FLIP Fluids`, `Quick Fluid Kit`, `Geodroplets Plus`, `Real Snow`, `Baga Rain Generator` | `DIY-005`, `DIY-016` |
| **実写撮影・トラッキング・3D合成・カメラ連携** | `COLOR-019`, `COLOR-021`, `COLOR-022` | `AE-024`, `AE-034` | `BL-005`, `BL-012` | `Export: Adobe After Effects (.jsx)`, `GeoTracker`, `Refine Tracking Solution`, `Perspective Plotter`, `fSpy`, `Omniscient Importer`, `VirtuCamera`, `Camera Plane` | `DIY-003`, `DIY-009`, `DIY-016`, `DIY-017` |
| **スクリプト自動化・バッチ出力・音同期プログラミング** | — | `AE-005`, `AE-017`, `AE-028` | `BL-024`〜`BL-029` | `Serpens`, `Customize Menu Editor`, `Shot Manager`, `Per-Camera Resolution`, `Auto Reload`, `Powermanage` | `DIY-001`, `DIY-018`, `DIY-019` |

---

## 3. 検証・メンテナンス手順（全5冊共通）

全 5 冊の辞典は以下のコマンドで数値の OCR 整合性（および画像目視確認リスト）を一括検証できます（生 OCR フォルダ `E:\技術書_index\ocr_private\` はリポジトリ外に固定）。

```powershell
python scripts/verify-technique-dictionary-numbers.py --dict docs/technique_dictionary/color_correction_handbook_2nd.md --ocr E:\技術書_index\ocr_private\color_correction_handbook_2nd_ocr.jsonl --strict
python scripts/verify-technique-dictionary-numbers.py --dict docs/technique_dictionary/aftereffects_motion_design.md --ocr E:\技術書_index\ocr_private\aftereffects_motion_design_ocr.jsonl --strict
python scripts/verify-technique-dictionary-numbers.py --dict docs/technique_dictionary/professional_blender.md --ocr E:\技術書_index\ocr_private\professional_blender_ocr.jsonl --strict
python scripts/verify-technique-dictionary-numbers.py --dict docs/technique_dictionary/blender_addon_encyclopedia.md --ocr E:\技術書_index\ocr_private\blender_addon_encyclopedia_ocr.jsonl --strict
python scripts/verify-technique-dictionary-numbers.py --dict docs/technique_dictionary/video_production_diy.md --ocr E:\技術書_index\ocr_private\video_production_diy_ocr.jsonl --strict
```
