# 映像技法辞典 ④：『職種と用途で探せる Blender アドオン事典』逆引き索引（Part 1 全188本＋Part 2 追加31本＝計219本）

- **出典書籍**: 3D人 著（寄稿：ますく・藤田将・Liryc / OBF TOKYO・Fujimoto Takashi・Nakamura Saaya・りょーちも・涌井嶺・zen／監修：ますく）『職種と用途で探せる Blender アドオン事典』（株式会社ボーンデジタル、2025年3月25日初版第1刷）
- **対象 Blender バージョン（本書記載）**: **Blender 3.6〜4.3**（執筆時 2025年2月時点確認、Blender 4.2 以降の公式 Extensions および従来の ZIP インストール双方を解説。本書 p.5 / PDF p.25・p.10–18）
- **作成日 / 配布状況確認日**: 2026-11-23
- **位置づけ（厳守）**:
  - 本ファイルは **逆引き索引（リファレンス）専用** です。技法辞典 ①〜③（特に `BL-001`〜`BL-030`・`AE-xxx`・`COLOR-xxx`）で分解した表現・工程に対し「どのアドオンで高速再現できるか」を即座に引くために整理しています。
  - **映像の良し悪しの採点基準には一切使用しません。**
  - 著作権保護のため本文の転記は一切行わず、**自分の言葉による 1 行要約＋出典ページ番号＋区分** のみで構成しています（ローカル OCR 生データはリポジトリ外 `E:\技術書_index\ocr_private\` のみに保管）。
- **本書記載情報と現時点の状況の分離ルール**:
  - アドオンの価格・無料/有料区分・配布形態は変更されやすいため、表では **「本書記載（2025年2月時点）」** と **「現行版 Blender 4.2+ 入手状況（2026-11-23 公式確認）」** を明確に別列へ分けて記載しています。
  - ネット確認は公式拡張機能プラットフォーム（`extensions.blender.org`）等のみを参照し、個別に公式確認していない有料・外部配布アドオンは推測せず「未確認」と明記しています。
- **ページ表記ルール**: 本書は前付け（ローマ数字）や途中の重複ページ等の都合で `PDFページ − 本書ページ` が前半 `+20`（本書 p.6–77）、後半 `+24`（本書 p.79–405）とズレるため、全項目に **本書 p.XX（PDF p.YY）** を併記しています。

---

## OCR 品質レポート（ローカル Windows 日本語 OCR・250 DPI・完全オフライン）

| 項目 | 実測値 |
|---|---|
| 対象 PDF | `E:\技術書\映像\blenderアドオン事典.pdf`（全 **439ページ**・埋め込み文字 0文字） |
| 使用エンジン | Windows 標準日本語 OCR（`Windows.Media.Ocr.OcrEngine`, `ja`・ローカルオフライン） |
| 読み取れた文字の割合（有効文字率） | **99.12%**（全 205,216文字中 203,406文字が有効な日本語・英数字・記号／平均 **467.5文字/ページ**） |
| 本文テキスト読取ページ（50文字以上） | **422 / 439ページ（96.13%）** |
| 文字が少ないページ（1〜49文字） | **11ページ**（PDF p.22, 321, 332, 336, 343, 355, 358, 392, 402, 415, 430 — 扉・大図版主体ページ） |
| 0文字のページ（読めなかったページ） | **6ページ**（PDF p.98, 302, 326, 408, 412, 439 — 白紙・裏表紙・図版のみページ） |
| 補足確認方法 | Part 1 全188本の「無料/有料」「入手先（Extensions/標準搭載等）」バッジは小文字で OCR 誤読が出やすかったため、**全188本すべてのヘッダー帯を画像抽出して目視確認** 済み。 |
| 生 OCR 保存先（リポジトリ外） | `E:\技術書_index\ocr_private\blender_addon_encyclopedia_ocr.jsonl` |

---

## 1. 技法辞典 ID（`BL-xxx` / `AE-xxx` / `COLOR-xxx`）→ アドオン逆引き索引

他の技法辞典で分解した表現・工程から「Blender で再現・時短するためのアドオン」を逆引きする対応表です。

| 対応する技法辞典 ID | 目的・再現したい表現／工程 | 対応アドオン（本書掲載） |
|---|---|---|
| `BL-001 / BL-019` | モデリング・ブーリアン・ハードサーフェス・リトポ効率化 | Bool Tool, BoltFactory, LoopTools, F2, EdgeFlow, PolyQuilt, Quad Remesher, Boxcutter, Hardops, Fluent, MESHmachine, DECALmachine, Kit Ops 3, Modifier List, Copy Attributes Menu, MACHIN3tools |
| `BL-002 / BL-029` | データブロック・アセット・大量アドオン＆UI管理 | Matalogue, Poly Haven Asset Browser, Instant Asset, Sanctus Library, Auto Reload, Material Utilities, N Panel Sub Tabs, Powermanage, Clean Panels, 3D Viewport Pie Menus, Serpens |
| `BL-004 / BL-030` | キャラのリギング・スキニング・ウェイト・表情管理 | Auto-Rig Pro, Voxel Heat Diffuse Skinning, Mio3 Copy Weight, EasyWeight, smoothWeights, Handy Weight Edit, Lazy Weight Tool, Faceit, Mio3 ShapeKey, Wiggle 2, VRM format |
| `BL-005 / BL-027` | ライティング・物理カメラ・レンダリング最適化＆バッチ | Photographer 5, Gaffer, Light Wrangler, Tri-lighting, Easy HDRI, HDRI Maker, Per-Camera Resolution, Shot Manager, Turbo Tools, Memsaver, RenderBoost, Simplify+ |
| `BL-006 / BL-007` | シェーダーノード・プロシージャル質感高速化 | Node Wrangler, Node Preview, Node Pie, Fluent : Materializer, Grungit, Sanctus Library, Real Water, Alt Tab Ocean & Water, Woolly Tools & Shaders |
| `BL-008 / BL-017` | テクスチャベイク・デカール＆トリムシート素材生成 | SimpleBake, GrabDoc, TexTools, Ucupaint, VDM Brush Baker, Real Time Cycles, OpenVAT |
| `BL-011 / BL-015` | 炎・煙・爆発・流体・破壊・群衆・スキャッターFX | BagaPie, Geo-Scatter, Cell Fracture, RBDLab, Kaboom, KaFire, VDBLab, True-VDB, FLIP Fluids, FluidLab, Quick Fluid Kit, Geodroplets Plus, Baga Rain Generator, Procedural Crowds, GEO-SWARM |
| `BL-018 / BL-020` | スカルプト造形・細部ダメージ・リメッシュ | Blob Fusion, VDM Brush Baker, Quad Remesher, QRemeshify, SoftWrap, OCD, Wear N' Tear, Cracker, BBrush, GoB / 3D-Coat Applink |
| `BL-021 / BL-022 / BL-023` | メッシュ検査・UV展開・パッキング・外部ペイント／エンジン連携 | Mio3 UV, UniV, TexTools, Texel Density Checker, Zen UV, Zen UV Checker, UVPackmaster 3 PRO, UV-Packer, Mesh Repair Tools, Analyze Mesh, CheckToolBox, Ucupaint, More Colors!, ACT, Better FBX |
| `COLOR-004 / COLOR-007 / COLOR-030` | Blender内カラーグレーディング・LUT・レイヤー合成 | Colorista, Colorist Pro, Final LUT, Blendshop |
| `COLOR-020 / COLOR-026` | 空・大気・雲・霧による奥行き演出 | Dynamic Sky, Real Sky, True-Sky, Physical Starlight And Atmosphere, Alt Tab Easy Fog 2, Volumetric Clouds Generator, Real Cloud, Fluffy Clouds Planes |
| `COLOR-022 / AE-024 / AE-034` | 実写トラッキング・パース一致・カメラワーク・AE連携 | Export: Adobe After Effects (.jsx), GeoTracker for Blender, Refine Tracking Solution, Perspective Plotter, fSpy, Omniscient Importer, Camera Shakify, Dolly Zoom, Cinepack, VirtuCamera, FALCON CAM, Camera Plane |
| `AE-002 / AE-018 / AE-031 / AE-032` | モーショングラフィックス・スミア・NPR線画・手描き調仕上げ | ANIMAX, SMEAR, Pencil+ 4 Line for Blender, NijiGPen, Brushstroke Tools, Deep Paint, GP Animator Desk, Pixel, Komikaze, InkTool, Clay Doh, AnimAll |

---

## 2. Part 1 収録アドオン全188本 逆引き一覧（本書記載 vs 2026-11-23 現行版入手状況）

> **列の見方**
> - **本書記載（無料/有料・入手先）**: 2025年2月時点の本書カード記載（全188本を実物ヘッダー画像で目視確認済み）。価格自体は変動するため区分のみ記載。
> - **現行版 Blender 4.2+ 入手状況（2026-11-23 確認・補足）**: 公式 `extensions.blender.org` で本日確認できたものは「公式Extensions確認済」、本体同梱は「本体同梱コア確認済」、個別未確認の外部配布は「未確認」と明記（いずれも現行版では `プリファレンス > エクステンションを入手` または右上メニュー `ディスクからインストール` で導入）。

| # | アドオン名 | 何ができるか（1行要約） | ページ（本書 / PDF） | 本書記載（区分・入手先） | 現行版 4.2+ 入手状況（2026-11-23） | 関連技法 ID |
|---|---|---|---|---|---|---|
| 001 | **BoltFactory** | ボルト・ナット・ネジをパラメータ指定で即座に生成する。 | 本書 p.6（PDF p.26） | 無料（標準搭載・Extensions） | 公式Extensions確認済 (2026-11-23) | `BL-001, BL-019` |
| 002 | **Bool Tool** | ショートカットで非破壊／自動ブーリアン演算（差・和・交差・スライス）を高速実行する。 | 本書 p.7（PDF p.27） | 無料（標準搭載・Extensions） | 公式Extensions確認済 (2026-11-23) | `BL-001, BL-019, BL-029` |
| 003 | **QBlocker** | 作業平面やグリッド上へ直感的なドラッグ操作で基本プリミティブを配置生成する。 | 本書 p.8（PDF p.28） | 無料・有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-001, BL-018` |
| 004 | **F2** | 1頂点・1辺の選択からFキー一発で四角面を張り、リトポや穴埋めを高速化する。 | 本書 p.9（PDF p.29） | 無料（標準搭載・Extensions） | 公式Extensions確認済 (2026-11-23) | `BL-019, BL-020` |
| 005 | **LoopTools** | 円形化・リラックス・ブリッジ・平坦化などトポロジー整形ツール群を追加する。 | 本書 p.10（PDF p.30） | 無料（標準搭載・Extensions） | 公式Extensions確認済 (2026-11-23) | `BL-019, BL-020` |
| 006 | **EdgeFlow** | 周囲の曲面曲率に合わせて選択エッジの流れと間隔を滑らかに整列させる。 | 本書 p.11（PDF p.31） | 無料（Extensions・GitHub） | 公式Extensions確認済 (2026-11-23) | `BL-019, BL-020` |
| 007 | **Bezier Mesh Shaper** | ベジェカーブのハンドル操作でメッシュ頂点群の形状を滑らかに変形する。 | 本書 p.12（PDF p.32） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-019` |
| 008 | **SimpleDeformHelper** | シンプル変形モディファイアに視覚ギズモを追加し曲げ・ねじり軸を直感操作する。 | 本書 p.13（PDF p.33） | 無料（Extensions・GitHub） | 本書Extensions記載 / 2026-11-23個別未確認 | `BL-001, AE-003` |
| 009 | **Half Knife** | 画面上のドラッグ操作だけで素早くメッシュを直線カット・分割する軽量ナイフ。 | 本書 p.14（PDF p.34） | 無料（Extensions・GitHub・Gumroad） | 本書Extensions記載 / 2026-11-23個別未確認 | `BL-019, BL-020` |
| 010 | **Hard Bevel** | エッジ同士が重なりにくい滑らかなベベルを多角形（Nゴン）交差部にも適用する。 | 本書 p.15（PDF p.35） | 有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-019` |
| 011 | **Grid Modeler** | メッシュ面上に一時グリッドを描き、2D図形からそのまま押し出しやブーリアンを行う。 | 本書 p.16（PDF p.36） | 有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-019` |
| 012 | **Construction Lines** | ガイド線・スナップ・寸法入力によるCAD風の精密作図と面生成をビューポート上で行う。 | 本書 p.17（PDF p.37） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-001, BL-019` |
| 013 | **PolyQuilt** | クリック・ドラッグ・ホールド主体で面張り・ループカット・リトポを直感操作する。 | 本書 p.19（PDF p.39） | 無料（Extensions・GitHub） | 公式Extensions確認済 (2026-11-23 / fork版) | `BL-019, BL-020` |
| 014 | **Quad Maker** | MayaのQuad Draw風にスカルプト表面へ四角ポリゴンを軽快に張り直す。 | 本書 p.20（PDF p.40） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-019, BL-020` |
| 015 | **nSolve** | 手動モデリング・トポロジー整理を補助する多機能ツールとプリセット管理を提供する。 | 本書 p.21（PDF p.41） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-019` |
| 016 | **Quad Remesher** | スカルプトやスキャンモデルを高精度な自動四角形メッシュへ再構成するリメッシャー。 | 本書 p.22（PDF p.42） | 有料（公式サイト） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-018, BL-019` |
| 017 | **QRemeshify** | エッジ流れや対称性を考慮した四角形リメッシュを無料ベースで実行する。 | 本書 p.23（PDF p.43） | 無料・有料（GitHub・Gumroad・Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-018, BL-019` |
| 018 | **SoftWrap** | 既存トポロジーをソフトボディ変形で別スカルプト表面へ吸着させ再利用する。 | 本書 p.24（PDF p.44） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-019, BL-020` |
| 019 | **Step Loop Select** | 頂点・辺・面を一定間隔飛ばしで連続ループ選択する。 | 本書 p.25（PDF p.45） | 無料（BOOTH・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-019` |
| 020 | **Transparent Select** | ショートカット併用のドラッグだけで透過（裏側込み）ボックス選択を切り替える。 | 本書 p.26（PDF p.46） | 無料・有料（BOOTH・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-019` |
| 021 | **X-Ray Selection Tools** | ボックス・サークル・ラッソ選択時の透過選択挙動を細かくカスタマイズする。 | 本書 p.27（PDF p.47） | 無料（GitHub・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-019` |
| 022 | **NGon Loop Select** | Nゴンを含むメッシュでもエッジループをワンクリックで連続選択する。 | 本書 p.28（PDF p.48） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-019` |
| 023 | **Select Polygons By Angle** | 隣接する面の法線角度しきい値に基づきポリゴン領域を一括選択する。 | 本書 p.29（PDF p.49） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-019, BL-022` |
| 024 | **Conform Object** | 装飾パーツ等を別メッシュの曲面へ自然な法線転写付きで投影フィットさせる。 | 本書 p.30（PDF p.50） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-019, BL-020` |
| 025 | **Orient and Origin to Selected** | 選択した要素の向きに合わせてローカル軸やオブジェクト原点を素早く移動する。 | 本書 p.31（PDF p.51） | 無料・有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-001, BL-024` |
| 026 | **Maxivz's Interactive Tools** | ピボット・整列・スマート選択などモデリング頻出補助機能を1パネルに集約する。 | 本書 p.32（PDF p.52） | 無料（GitHub・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-001, BL-019` |
| 027 | **More Colors!** | 頂点カラーのプレビュー・グラデーション・IDマップ用塗り分けを簡単にする。 | 本書 p.34（PDF p.54） | 無料（Extensions・GitHub） | 本書Extensions記載 / 2026-11-23個別未確認 | `BL-013, BL-022` |
| 028 | **TraceGenius Pro** | 2Dロゴやイラスト画像をドラッグ＆ドロップで輪郭抽出し3Dメッシュ化する。 | 本書 p.35（PDF p.55） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-001, AE-001` |
| 029 | **Transfer the vertex order** | 同一トポロジーを持つ2メッシュ間で頂点番号順序やUV・要素を転送整合させる。 | 本書 p.36（PDF p.56） | 無料・有料（Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-004, BL-021` |
| 030 | **Mio3 ShapeKey** | 複数オブジェクト間で表情・モーフ用のシェイプキーを同期・一括管理する。 | 本書 p.37（PDF p.57） | 無料（GitHub） | 外部配布確認済・非Extensions (2026-11-23) | `BL-004, AE-019, AE-022` |
| 031 | **Mesh Repair Tools** | 穴・非多様体・重複面など3Dプリントやベイク前に問題となるメッシュを修復する。 | 本書 p.38（PDF p.58） | 無料・有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-021` |
| 032 | **Analyze Mesh** | 選択メッシュの三角・四角・Nゴン比率やトポロジー情報を即座に可視化確認する。 | 本書 p.40（PDF p.60） | 無料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-021` |
| 033 | **CheckToolBox** | Nゴン・非多様体・ポール等のエラー箇所を色分けハイライトでリアルタイム検査する。 | 本書 p.41（PDF p.61） | 無料・有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-021` |
| 034 | **OCD** | 選択メッシュの角や表面にワンクリックで欠け・傷のダメージ形状を非破壊追加する。 | 本書 p.42（PDF p.62） | 有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-018, BL-020` |
| 035 | **Wear N' Tear** | 建物や構造物モデルへひび割れ・剥離などの風化ダメージ形状を非破壊追加する。 | 本書 p.43（PDF p.63） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-018, BL-020` |
| 036 | **Curve Basher** | プリセットのケーブル・パイプ・ワイヤーをメッシュ表面間へ直感配置する。 | 本書 p.44（PDF p.64） | 有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-019` |
| 037 | **VRM format** | VRM形式アバターの入出力・Humanoidボーン・MToon・表情設定に対応する。 | 本書 p.46（PDF p.66） | 無料（Extensions・GitHub） | 公式Extensions確認済 (2026-11-23) | `BL-004, BL-023` |
| 038 | **VDM Brush Baker** | オーバーハング表現も彫れるベクターディスプレイスメント（VDM）ブラシをベイク作成する。 | 本書 p.47（PDF p.67） | 無料・有料（標準搭載・Extensions・Gumroad） | 本書Extensions記載 / 2026-11-23個別未確認 | `BL-017, BL-020` |
| 039 | **Blob Fusion** | プリミティブをメタボールのように滑らか融合させスカルプト用ベース形状を作る。 | 本書 p.48（PDF p.68） | 有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-018` |
| 040 | **Woolly Tools & Shaders** | フェルトや羊毛・手芸風のモフモフした毛羽立ち質感とシェーダーを一括追加する。 | 本書 p.49（PDF p.69） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-010` |
| 041 | **3D Hair Brush** | 専用グルーミングブラシとプリセットでリアルな毛髪・ファーを造形する。 | 本書 p.50（PDF p.70） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-004` |
| 042 | **Hair Tool** | ジオメトリノードとカーブからゲーム向けヘアカードやUV付き髪束をプロシージャル生成する。 | 本書 p.51（PDF p.71） | 有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-004, BL-021` |
| 043 | **Simply Cloth** | プリセットと簡易操作で衣装モデリングや布シミュレーションを手軽に行う。 | 本書 p.53（PDF p.73） | 有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-010` |
| 044 | **Random Flow** | パネル分割・押し出し・配管などSFハードサーフェスのランダム細部を自動生成する。 | 本書 p.55（PDF p.75） | 有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-019, BL-020` |
| 045 | **DECALmachine** | UVやトポロジーを汚さず視差法線デカールをメッシュ表面へ非破壊で貼り付ける。 | 本書 p.56（PDF p.76） | 有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-017, BL-023` |
| 046 | **MESHmachine** | ベベル修正・フィレット・法線転写・プラグ配置などハードサーフェス編集を大幅強化する。 | 本書 p.58（PDF p.78） | 有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-019, BL-022` |
| 047 | **Kit Ops 3** | 差し込みパーツ（INSERT）でブーリアンや装飾を素早く組み込むキットバッシングツール。 | 本書 p.60（PDF p.80） | 無料・有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-019` |
| 048 | **Boxcutter** | ビューポート上での自由な図形描画から即座に非破壊ブーリアンカット・スライスを行う。 | 本書 p.62（PDF p.82） | 有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-019` |
| 049 | **Hardops** | Qキーの統一メニューからモディファイア・ベベル・ミラー等ハードサーフェス工程を一貫制御する。 | 本書 p.63（PDF p.83） | 有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-001, BL-019` |
| 050 | **Fluent** | 専用グリッドと独自HUDで非破壊ハードサーフェス造形や配管・布生成を行う。 | 本書 p.64（PDF p.84） | 有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-019` |
| 051 | **True TERRAIN 5** | レイヤー構成と侵食シミュレーションで大規模な自然地形・植生シェーダーを構築する。 | 本書 p.67（PDF p.87） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-006, BL-015` |
| 052 | **Texel Density Checker** | モデル間のテクセル密度（UV解像度比率）を計算しワンクリックで均一化する。 | 本書 p.69（PDF p.89） | 無料・有料（Extensions・GitHub・Gumroad） | 公式Extensions確認済 (2026-11-23) | `BL-021` |
| 053 | **Zen UV Checker** | 既存マテリアルを壊さず1クリックでチェッカーマップを表示しUV歪みを確認する。 | 本書 p.70（PDF p.90） | 無料（Extensions・Gumroad） | 本書Extensions記載 / 2026-11-23個別未確認 | `BL-021` |
| 054 | **TexTools** | UV整列・短冊化・歪み検査から各種テクスチャベイクまで網羅する定番無料ツール群。 | 本書 p.71（PDF p.91） | 無料（GitHub） | 外部配布確認済・非Extensions (2026-11-23) | `BL-008, BL-021` |
| 055 | **UniV** | 軽量かつシンプルな操作感でUV展開・整列・チェッカー確認を効率化する。 | 本書 p.73（PDF p.93） | 無料・有料（Extensions・GitHub・Gumroad・Superhive） | 公式Extensions確認済 (2026-11-23) | `BL-021` |
| 056 | **Mio3 UV** | キャラ制作に強い格子整形・直線化・UDIM・シーム補助を備えた高機能無料UVツール。 | 本書 p.74（PDF p.94） | 無料（Extensions・GitHub） | 公式Extensions確認済 (2026-11-23) | `BL-021` |
| 057 | **DreamUV** | トリムシート活用向けに3Dビューポート上で直接UVの移動・回転・拡縮を行う。 | 本書 p.75（PDF p.95） | 無料（GitHub） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-021` |
| 058 | **UV-Packer for Blender** | 外部高速エンジンと連携しUVアイランドを余白最小で自動パッキングする。 | 本書 p.76（PDF p.96） | 無料（公式サイト） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-021` |
| 059 | **UVPackmaster 3 PRO** | CPU/GPU併用で高速・高密度パッキングとUDIM・グルーピング配置を行う。 | 本書 p.77（PDF p.97） | 有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-021` |
| 060 | **Zen UV** | 3Dビュー上の直感UV操作・トリムシート・スタック管理を備えた総合UVツールセット。 | 本書 p.79（PDF p.103） | 有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-021` |
| 061 | **Ucupaint** | Blender内でPhotoshop風のレイヤーベースPBRテクスチャペイントとベイクを行う。 | 本書 p.81（PDF p.105） | 無料（Extensions・GitHub） | 公式Extensions確認済 (2026-11-23) | `BL-008, BL-013, BL-023` |
| 062 | **Philogix PBR Painter** | スマートマテリアルやレイヤーUIでBlender単体のPBRテクスチャリングを実現する。 | 本書 p.82（PDF p.106） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-003, BL-023` |
| 063 | **Flow Map Painter** | 水流や髪の毛並みの方向データ（フローマップ）をブラシで直接ペイント作成する。 | 本書 p.83（PDF p.107） | 無料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-006, BL-011` |
| 064 | **Node Wrangler** | ノードの単独プレビュー・自動接続・PBRテクスチャ一括読み込みをショートカット化する必須拡張。 | 本書 p.84（PDF p.108） | 無料（標準搭載・Extensions） | 本体同梱コア確認済 (2026-11-23) | `BL-006, BL-007` |
| 065 | **Node Preview** | 各シェーダーノードの上に計算結果サムネイルをリアルタイム表示する。 | 本書 p.85（PDF p.109） | 有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-006, BL-007` |
| 066 | **Grungit** | エッジ摩耗や汚れのグランジ質感をEEVEE対応ノードでワンクリック追加する。 | 本書 p.86（PDF p.110） | 無料・有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-006, BL-013` |
| 067 | **Fluent : Materializer** | 豊富なプロシージャルノード群とデカール・ベイク機能で複雑マテリアルを高速構築する。 | 本書 p.87（PDF p.111） | 有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-006, BL-008` |
| 068 | **Portal Projection** | Blender 4.2のRay Portal BSDFを使い異空間ポータル表現をワンクリック設定する。 | 本書 p.88（PDF p.112） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-003, BL-005` |
| 069 | **GrabDoc** | 平面上の立体パーツからノーマルやAO等のトリムシート・デカール画像を即時ベイクする。 | 本書 p.89（PDF p.113） | 無料・有料（Superhive・Gumroad） | 外部配布確認済・非Extensions (2026-11-23) | `BL-008, BL-017` |
| 070 | **SimpleBake** | Cyclesの煩雑なPBR複数チャンネル一括ベイクとハイ→ロー転写を簡略化する。 | 本書 p.90（PDF p.114） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-008, BL-022` |
| 071 | **Instant Impostors** | 遠景用3Dメッシュを多方向テクスチャ板（インポスター）へ変換しEEVEE描画を軽量化する。 | 本書 p.92（PDF p.116） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-005, BL-008` |
| 072 | **Deep Paint** | Grease Pencilや頂点カラーペイントを組み合わせ立体絵画風3Dイラストを制作する。 | 本書 p.93（PDF p.117） | 有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-006, AE-032` |
| 073 | **NijiGPen** | Grease Pencilに2Dブーリアン・オフセット・メッシュ変換などイラスト向け機能を追加する。 | 本書 p.94（PDF p.118） | 無料（GitHub・Gumroad） | 外部配布確認済・非Extensions (2026-11-23) | `AE-016, AE-032` |
| 074 | **Brushstroke Tools** | ジオメトリノードを活用し3D表面へ手描き風の筆跡ストロークを立体配置する。 | 本書 p.95（PDF p.119） | 無料（Extensions） | 本書Extensions記載 / 2026-11-23個別未確認 | `BL-006, AE-032` |
| 075 | **Pencil+ 4 Line for Blender** | 商業アニメ現場実績のある高品質なセル調輪郭線・交差線を描画する（別途描画アプリ要）。 | 本書 p.96（PDF p.120） | 無料・有料（GitHub・公式サイト（Render App有料）） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `AE-032` |
| 076 | **Mio3 Copy Weight** | 別オブジェクト間の選択頂点同士でスキンウェイトを直感的にコピーする。 | 本書 p.97（PDF p.121） | 無料（Extensions・GitHub） | 公式Extensions確認済 (2026-11-23) | `BL-004, BL-030` |
| 077 | **EasyWeight** | アーマチュア未選択でもウェイトペイント移行やゼロウェイト自動整理を行う。 | 本書 p.98（PDF p.122） | 無料（標準搭載・Extensions） | 本書Extensions記載 / 2026-11-23個別未確認 | `BL-004, BL-030` |
| 078 | **Voxel Heat Diffuse Skinning** | 複雑パーツや分離メッシュにも破綻しにくいボクセル熱拡散ベースで自動スキニングする。 | 本書 p.99（PDF p.123） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-004, BL-030` |
| 079 | **smoothWeights** | メッシュ境界を越えて高速・滑らかにスキンウェイトをぼかす専用ブラシを提供する。 | 本書 p.100（PDF p.124） | 有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-004` |
| 080 | **Handy Weight Edit** | 編集モードの頂点選択から左右ミラーコピーやしきい値削除など手動ウェイト調整を支援する。 | 本書 p.101（PDF p.125） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-004, BL-030` |
| 081 | **Lazy Weight Tool** | 数値テーブル表示や別オブジェクト間コピーで精密なウェイト調整を効率化する。 | 本書 p.102（PDF p.126） | 有料（BOOTH・Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-004, BL-030` |
| 082 | **cvELD_QuickRig** | ポーズモードのままボーン生成・整列・簡易メッシュ生成を行えるリギング補助ツール。 | 本書 p.103（PDF p.127） | 有料（BOOTH・Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-004` |
| 083 | **Auto-Rig Pro** | 人型・動物キャラの自動リギング、モーションリターゲット、ゲーム向けFBX/GLTF出力を網羅する。 | 本書 p.105（PDF p.129） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-004, BL-023` |
| 084 | **X-Muscle System** | リグの動きに連動して皮膚下の筋肉の膨張・揺れを物理シミュレートする。 | 本書 p.107（PDF p.131） | 有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-004` |
| 085 | **Faceit** | ARKit対応フェイシャルリグとシェイプキー構築・リアルタイム表情キャプチャを行う。 | 本書 p.109（PDF p.133） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-004, AE-019` |
| 086 | **RBC** | サスペンションやタイヤ回転を含む物理ベース車両リグを対話的にセットアップする。 | 本書 p.110（PDF p.134） | 無料・有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-004` |
| 087 | **RIGICAR** | ボーン手組み不要で数ステップでリアルな車体挙動・傾斜アニメーションを作る。 | 本書 p.111（PDF p.135） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-004` |
| 088 | **Launch Control** | 自動車両リギングとリアルタイム物理操作・複数車両の同時アニメーション制御を行う。 | 本書 p.112（PDF p.136） | 有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-004` |
| 089 | **AbraTools** | モーションパス管理やグラフ表示補助などアニメーター向け細部ツールを集約する。 | 本書 p.113（PDF p.137） | 無料（GitHub） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-004, AE-021` |
| 090 | **Animation Layers** | NLAエディタを直感的なアニメーションレイヤー方式で非破壊管理・加算合成する。 | 本書 p.114（PDF p.138） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-004, AE-021` |
| 091 | **Wiggle 2** | 髪・尻尾・装飾ボーンに物理ベースの自然な揺れ・追従アニメーションを自動付与する。 | 本書 p.115（PDF p.139） | 無料（GitHub） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-004, AE-020` |
| 092 | **SMEAR** | 3Dアニメーションへ手描きアニメ風の残像・引き伸ばし（スミアフレーム）を加える。 | 本書 p.116（PDF p.140） | 無料（Extensions・GitHub） | 本書Extensions記載 / 2026-11-23個別未確認 | `AE-003, AE-021` |
| 093 | **ANIMAX** | 複数インスタンスや文字・破片をプロシージャルに時間差アニメーションさせる。 | 本書 p.117（PDF p.141） | 有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `AE-002, AE-008, AE-018` |
| 094 | **GP Animator Desk** | Grease Pencil作画用のオニオンスキン・ナビゲーション・描画支援UIを追加する。 | 本書 p.118（PDF p.142） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `AE-019, AE-032` |
| 095 | **Simplify+** | 重いモディファイアを一括無効化しアニメーション確認時のビューポート再生を高速化する。 | 本書 p.119（PDF p.143） | 無料・有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-001, BL-005` |
| 096 | **Gaffer** | シーン内全ライトとHDRI環境マップの強度・色・オンオフを1パネルで集中管理する。 | 本書 p.120（PDF p.144） | 無料・有料（GitHub・Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-005, COLOR-021` |
| 097 | **Tri-lighting** | 被写体に対して定番の3点照明（キー・フィル・バックライト）をワンクリック配置する。 | 本書 p.121（PDF p.145） | 無料（標準搭載・Extensions） | 本書Extensions記載 / 2026-11-23個別未確認 | `BL-005` |
| 098 | **Light Wrangler** | 反射位置の直接ドラッグ配置やゴボ（影投影）・HDRI内蔵で直感的に照明設計する。 | 本書 p.122（PDF p.146） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-005, COLOR-021` |
| 099 | **Real Time Cycles** | Cyclesの光影をワンクリックでライトマップへ自動ベイクしリアルタイム表示へ渡す。 | 本書 p.124（PDF p.148） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-005, BL-008` |
| 100 | **Photographer 5** | ISO・シャッター速度・絞り・色温度・物理ライトミキサーなど実写カメラ挙動を統合する。 | 本書 p.125（PDF p.149） | 有料（Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-005, COLOR-009, COLOR-010` |
| 101 | **Easy HDRI** | 手元のHDRIフォルダをサムネイル一覧化し回転・露出を素早く切り替える。 | 本書 p.127（PDF p.151） | 無料（公式サイト） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-005, BL-012` |
| 102 | **HDRI Maker** | HDRIを立体ドーム化して接地影や背景を自然に合成する環境ライブラリ付きツール。 | 本書 p.128（PDF p.152） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-005, BL-012` |
| 103 | **Dynamic Sky** | 軽量なプロシージャルの青空と太陽光を数クリックでワールドへ生成する。 | 本書 p.130（PDF p.154） | 無料（標準搭載・Extensions） | 公式Extensions確認済 (2026-11-23) | `BL-005, COLOR-026` |
| 104 | **Real Sky** | 緯度・日時指定で物理的な太陽位置とリアルな空ライティングをワンクリック設定する。 | 本書 p.131（PDF p.155） | 無料（GitLab） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-005, COLOR-026` |
| 105 | **True-Sky** | 物理ベースの空・時間変化・ボリューム雲・夜景をボタン操作で構築する。 | 本書 p.132（PDF p.156） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-005, COLOR-026` |
| 106 | **Physical Starlight And Atmosphere** | EEVEE/Cycles両対応で太陽光・星・大気散乱・霧を物理シミュレーションする。 | 本書 p.133（PDF p.157） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-005, COLOR-026` |
| 107 | **Per-Camera Resolution** | シーン内の複数カメラごとに異なる縦横比・解像度を個別保存し切替レンダリングする。 | 本書 p.134（PDF p.158） | 無料（Extensions） | 本書Extensions記載 / 2026-11-23個別未確認 | `BL-005, BL-027` |
| 108 | **Omniscient Importer** | iOSアプリの3Dトラッキング＆LiDARスキャン結果を実寸スケールでBlenderへ取り込む。 | 本書 p.135（PDF p.159） | 無料・有料（公式サイト・GitHub） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `AE-024` |
| 109 | **Perspective Plotter** | 背景写真の消失点ガイド線を合わせてカメラ画角・位置をリアルタイムにパース一致させる。 | 本書 p.136（PDF p.160） | 有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-005` |
| 110 | **GeoTracker for Blender** | 実写映像内の剛体オブジェクトへ3Dモデルを高精度に3Dマッチムーブ追従させる。 | 本書 p.137（PDF p.161） | 有料（公式サイト） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `COLOR-022` |
| 111 | **Colorista** | ビューポートやコンポジット上で手軽にカラーグレーディングとプリセット管理を行う。 | 本書 p.138（PDF p.162） | 無料（Extensions・GitHub） | 本書Extensions記載 / 2026-11-23個別未確認 | `COLOR-004, COLOR-011, COLOR-030` |
| 112 | **Colorist Pro** | LUT適用・ACES切替・プロ向けカラーホイール調整をビューポート上でリアルタイム操作する。 | 本書 p.139（PDF p.163） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `COLOR-004, COLOR-011, COLOR-030` |
| 113 | **Final LUT** | .cube等のLUTファイルをAgX/Filmic等と組み合わせてビューポートでリアルタイム確認する。 | 本書 p.140（PDF p.164） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `COLOR-007, COLOR-030` |
| 114 | **Blendshop** | ノード操作に不慣れでもPhotoshop風のレイヤー構造でコンポジット・色調補正を行える。 | 本書 p.141（PDF p.165） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `COLOR-030, AE-033` |
| 115 | **Pixel** | ワンクリックで3Dシーンをアイソメトリック風ドット絵・ピクセルアート表現へ変換する。 | 本書 p.142（PDF p.166） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `AE-031, AE-032` |
| 116 | **Real Snow** | 選択メッシュの上面へワンクリックで積雪メッシュと雪マテリアルを生成する。 | 本書 p.143（PDF p.167） | 無料（標準搭載・Extensions） | 本書Extensions記載 / 2026-11-23個別未確認 | `BL-006` |
| 117 | **Fluffy Clouds Planes** | 軽量な2D板ポリゴンベースでカメラ追従するリアルな雲をシーンへ配置する。 | 本書 p.144（PDF p.168） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `COLOR-026` |
| 118 | **Volumetric Clouds Generator** | Cycles/EEVEE両対応の立体ボリューム雲をパラメータ調整付きで手軽に追加する。 | 本書 p.145（PDF p.169） | 無料・有料（GitHub・標準搭載・Extensions） | 本書Extensions記載 / 2026-11-23個別未確認 | `COLOR-026` |
| 119 | **Real Cloud** | 任意メッシュの雲化と大量のVDB雲アセットライブラリを提供する。 | 本書 p.146（PDF p.170） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `COLOR-026` |
| 120 | **Baga Rain Generator** | ジオメトリノードで雨粒・スプラッシュ・地面の濡れ質感をプロシージャル追加する。 | 本書 p.147（PDF p.171） | 有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-015` |
| 121 | **Alt Tab Ocean & Water** | 海洋・波・水面シェーダーとプリセットを素早く構築する。 | 本書 p.148（PDF p.172） | 無料・有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-006` |
| 122 | **Real Water** | Cycles/EEVEE両対応のリアル水面シェーダーをドラッグ＆ドロップで追加する。 | 本書 p.149（PDF p.173） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-006` |
| 123 | **Alt Tab Easy Fog 2** | ボリューム霧・スモーク表現をプリセット選択だけでシーンへ加え奥行きを演出する。 | 本書 p.150（PDF p.174） | 無料・有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `COLOR-020` |
| 124 | **GEO-SWARM** | ジオメトリノードで鳥・魚・虫などの生物群衆の飛行・回避シミュレーションを作る。 | 本書 p.151（PDF p.175） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-015` |
| 125 | **Procedural Crowds** | 歩行・観戦・カーブ沿い移動など大量の人物群衆シーンをプロシージャル配置する。 | 本書 p.152（PDF p.176） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-015` |
| 126 | **Cell Fracture** | オブジェクトを破片パーツへ自動分割し、剛体物理と組んだ破壊表現の基礎を作る。 | 本書 p.153（PDF p.177） | 無料（標準搭載・Extensions） | 公式Extensions確認済 (2026-11-23) | `BL-001` |
| 127 | **Cracker** | メッシュ表面へ任意の割れ目・亀裂形状を非破壊かつ直感的に生成する。 | 本書 p.154（PDF p.178） | 有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-018, BL-020` |
| 128 | **Kaboom** | 破片分割から動的破壊アニメーション・VDB煙追加までを一貫サポートする。 | 本書 p.155（PDF p.179） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-001` |
| 129 | **KaFire** | エミッター設定とプリセット調整で炎・煙・爆発シミュレーションを手軽に組む。 | 本書 p.156（PDF p.180） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-011` |
| 130 | **RBDLab** | 金属の曲げや粉砕・破片飛び散りを含む高度な剛体破壊VFXを構築する。 | 本書 p.157（PDF p.181） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-001` |
| 131 | **VDBLab** | VDBベースの高度な炎・煙・爆発シミュレーションと制御フローを提供する。 | 本書 p.158（PDF p.182） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-011` |
| 132 | **True-VDB** | 高品質な煙・炎・雲のシミュレーション済みVDBアセットを即座に配置する。 | 本書 p.159（PDF p.183） | 無料・有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-011` |
| 133 | **Molecular +** | 粒子同士の結合・反発を計算し砂・雪・ゼリー等の分子物理挙動をシミュレートする。 | 本書 p.161（PDF p.185） | 無料（GitHub） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-001` |
| 134 | **Fluid Painter** | メッシュ表面をペンでなぞった軌道に沿ってソース・シロップ等の流体メッシュを描く。 | 本書 p.162（PDF p.186） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `AE-014` |
| 135 | **Geodroplets Plus** | 商品カットやボトル表面へリアルな結露・流れる水滴をジオメトリノードで追加する。 | 本書 p.163（PDF p.187） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `AE-014` |
| 136 | **Quick Fluid Kit** | 計算済みの高品質な流体アニメーションアセット（Alembic等）を即座にシーン配置する。 | 本書 p.164（PDF p.188） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `AE-014` |
| 137 | **Cell Fluids** | ジオメトリノードで軽量動作する2.5D水面・流体シミュレーションとフローマップ出力を行う。 | 本書 p.166（PDF p.190） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-005` |
| 138 | **FluidLab** | ドメイン不要のSPH粒子法で水・粘性体・スライムなど中規模流体を手軽に計算する。 | 本書 p.167（PDF p.191） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-001` |
| 139 | **FLIP Fluids** | 泡・飛沫・高粘性・高解像度メッシュ対応の本格FLIP流体シミュレーター。 | 本書 p.169（PDF p.193） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-001` |
| 140 | **Context Pie** | 作業モードに応じた右クリックメニューをシンプルで使いやすいPieメニューへ置き換える。 | 本書 p.171（PDF p.195） | 無料（Extensions） | 本書Extensions記載 / 2026-11-23個別未確認 | `BL-001` |
| 141 | **3D Viewport Pie Menus** | 視点・シェーディング・整列・編集モード切替の包括的なPieメニュー群を追加する。 | 本書 p.172（PDF p.196） | 無料（標準搭載・Extensions） | 公式Extensions確認済 (2026-11-23) | `BL-001` |
| 142 | **Node Pie** | シェーダー／コンポジット／ジオメトリノードで種類別Pieメニューから素早くノード追加する。 | 本書 p.174（PDF p.198） | 無料（Extensions・GitHub） | 本書Extensions記載 / 2026-11-23個別未確認 | `BL-006, BL-007` |
| 143 | **MACHIN3tools** | 最適化されたPieメニュー・整列・スマートフェース・アセット管理で操作全般を高速化する。 | 本書 p.176（PDF p.200） | 有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-001, BL-019` |
| 144 | **Matalogue** | シーン内のマテリアル・ジオメトリ・コンポジットノードツリーをサイドバーから一覧切替する。 | 本書 p.179（PDF p.203） | 無料（Extensions・GitHub） | 本書Extensions記載 / 2026-11-23個別未確認 | `BL-002, BL-006` |
| 145 | **Mouse-look Navigation** | ZBrush風やFPSゲーム風のビューポート視点ナビゲーション操作を追加する。 | 本書 p.180（PDF p.204） | 無料・有料（Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-001` |
| 146 | **Right Mouse Navigation** | 右クリック長押し＋WASDキーでUnreal/Unity風のFPS視点移動を実現する。 | 本書 p.181（PDF p.205） | 無料（Extensions・GitHub） | 本書Extensions記載 / 2026-11-23個別未確認 | `BL-001` |
| 147 | **OmniStep** | 物理衝突付きの一人称ウォークスルー操作とカメラモーション記録を行う。 | 本書 p.182（PDF p.206） | 有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-001` |
| 148 | **Saved Views** | カメラオブジェクトを作らずにビューポート視点位置をサムネイル付きで保存・復元する。 | 本書 p.183（PDF p.207） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-001` |
| 149 | **Sync \| Lock Viewport** | 複数に分割した3Dビューポートの視点移動をリアルタイム同期・ロックする。 | 本書 p.184（PDF p.208） | 無料（Extensions・Gumroad） | 本書Extensions記載 / 2026-11-23個別未確認 | `BL-001, BL-006` |
| 150 | **Dolly Zoom** | 焦点距離とカメラ距離を連動させ映画的なドリーズーム（めまい効果）を簡単に作る。 | 本書 p.185（PDF p.209） | 無料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `AE-034` |
| 151 | **Camera Shakify** | 実写計測ベースの手ブレ・揺れプリセットをカメラへ非破壊レイヤー追加する。 | 本書 p.186（PDF p.210） | 無料（Extensions・GitHub） | 公式Extensions確認済 (2026-11-23) | `AE-034` |
| 152 | **Cinepack** | 映画的カメラワークのアニメーションプリセットをワンクリックでシーンへ適用する。 | 本書 p.187（PDF p.211） | 有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `AE-034` |
| 153 | **VirtuCamera for Blender Addon** | スマホアプリと連携し手持ちの実時間カメラワークをBlenderへ直接収録する。 | 本書 p.189（PDF p.213） | 無料（公式サイト・GitHub） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `AE-034` |
| 154 | **Shot Manager** | 複数カット・カメラ切替・出力パス・バッチレンダリングを一元管理する。 | 本書 p.190（PDF p.214） | 無料・有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-027` |
| 155 | **Camera Plane** | カメラ画角へぴったりフィットする画像・動画プレーンを親子付け配置する。 | 本書 p.191（PDF p.215） | 無料（Extensions・GitHub） | 本書Extensions記載 / 2026-11-23個別未確認 | `AE-024` |
| 156 | **Copy Attributes Menu** | Ctrl+Cメニューを拡張し位置・モディファイア・コンストレイント等を複数オブジェクトへ一括コピーする。 | 本書 p.192（PDF p.216） | 無料（標準搭載・Extensions） | 公式Extensions確認済 (2026-11-23) | `BL-001, BL-002` |
| 157 | **Modifier List** | 3ds Max風のコンパクトな一覧リスト＆お気に入りUIでモディファイアを管理する。 | 本書 p.193（PDF p.217） | 無料（Extensions・GitHub） | 公式Extensions確認済 (2026-11-23 / fork版) | `BL-001` |
| 158 | **Auto-Highlight in Outliner** | 3Dビューで選択したオブジェクトをアウトライナー上で自動展開・ハイライト表示する。 | 本書 p.194（PDF p.218） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-001` |
| 159 | **Simply Fast** | 頻出操作をワンボタン化したコンパクトなショートカットNパネルを提供する。 | 本書 p.195（PDF p.219） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-001` |
| 160 | **Sakura UX Enhancer** | ダブルクリック表示や画像エディタ検索などBlender全体の細かな使い勝手を底上げする。 | 本書 p.196（PDF p.220） | 有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-001, BL-006` |
| 161 | **Drop It** | 選択オブジェクトを下の地面やメッシュ表面の法線へ合わせてワンキー接地させる。 | 本書 p.198（PDF p.222） | 無料（Gumroad） | 外部配布確認済・非Extensions (2026-11-23) | `BL-001` |
| 162 | **POPOTI Align Helper** | PhotoshopやPowerPointのように複数オブジェクトを等間隔・端揃えで直感整列させる。 | 本書 p.199（PDF p.223） | 無料（Extensions・GitHub） | 本書Extensions記載 / 2026-11-23個別未確認 | `BL-001` |
| 163 | **Physics Dropper** | 物理シミュレーションで小物を自然に落下・堆積させてリアルなランダム配置を作る。 | 本書 p.200（PDF p.224） | 無料・有料（GitHub・Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-001` |
| 164 | **BagaPie** | ジオメトリノードによるスキャッター・配列・建築パラメトリック生成を統合する多機能拡張。 | 本書 p.201（PDF p.225） | 無料・有料（Extensions・Superhive・Gumroad） | 公式Extensions確認済 (2026-11-23 / 本体無料) | `BL-015, BL-019` |
| 165 | **Geo-Scatter** | 植生・バイオーム・カメラカリング対応の本格ジオメトリノード散布システム。 | 本書 p.202（PDF p.226） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-015` |
| 166 | **Alpha Trees** | 軽量なビルボード木カードを使って広大な森林シーンを省メモリ・高速レンダリングする。 | 本書 p.203（PDF p.227） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-005, BL-015` |
| 167 | **Instant Asset** | 選択オブジェクトやコレクションを手軽にアセットブラウザ用ライブラリへ書き出す。 | 本書 p.204（PDF p.228） | 無料（Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-002` |
| 168 | **Sanctus Library** | 高品質なプロシージャルマテリアル群・ジオメトリノード生成器・簡易ベイク機能を提供する。 | 本書 p.205（PDF p.229） | 無料・有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-006, BL-008` |
| 169 | **Poly Haven Asset Browser** | CC0のHDRI・3Dモデル・PBRテクスチャをアセットブラウザ上から直接取り込む。 | 本書 p.206（PDF p.230） | 無料・有料（GitHub・Superhive・Patreon） | 外部配布確認済・非Extensions (2026-11-23) | `BL-002, BL-005` |
| 170 | **The Plant Library** | 無料利用可能な自然植物3Dアセット群をアセットブラウザ経由で即座に配置する。 | 本書 p.208（PDF p.232） | 無料（公式サイト） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-015` |
| 171 | **BlenderGIS** | 衛星地図・標高データ（DEM）・建物データをBlender内へ直接インポートし地形化する。 | 本書 p.210（PDF p.234） | 無料（GitHub） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-001` |
| 172 | **Blosm for Blender** | OpenStreetMapや3D都市・地形データを取り込み街並みを高速構築する。 | 本書 p.211（PDF p.235） | 無料・有料（Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-001` |
| 173 | **Auto Reload** | 外部ペイントソフト等で更新した画像テクスチャやライブラリを自動再読み込みする。 | 本書 p.212（PDF p.236） | 無料（Extensions・GitHub） | 公式Extensions確認済 (2026-11-23) | `BL-002, BL-023` |
| 174 | **ACT** | Unity/Unreal/Godot向けの一括FBX/GLTF書き出し・原点調整・リネーム等を統合する。 | 本書 p.213（PDF p.237） | 無料（Extensions・GitHub・Gumroad） | 本書Extensions記載 / 2026-11-23個別未確認 | `BL-022, BL-023` |
| 175 | **Better FBX Importer & Exporter** | 標準FBXの互換性課題を補い、他DCCやゲームエンジンとのリグ・アニメ入出力精度を高める。 | 本書 p.214（PDF p.238） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-022, BL-028` |
| 176 | **3DGS Render by KIRI Engine** | 3D Gaussian Splatting（3DGS）スキャンデータをEEVEE上で高速描画・合成する。 | 本書 p.215（PDF p.239） | 無料（GitHub・Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-005` |
| 177 | **OpenVAT** | シミュレーションや複雑な変形をゲームエンジン向け頂点アニメーションテクスチャ（VAT）へ出力する。 | 本書 p.216（PDF p.240） | 無料（Extensions・GitHub） | 本書Extensions記載 / 2026-11-23個別未確認 | `BL-008, BL-023` |
| 178 | **Memsaver** | カメラ距離に応じてテクスチャ解像度を自動最適化しレンダリング時のVRAM消費を抑える。 | 本書 p.217（PDF p.241） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-005, BL-008` |
| 179 | **Turbo Tools** | Cyclesのサンプル数・デノイズ・キャッシュを最適化し画質維持のままレンダリングを高速化する。 | 本書 p.219（PDF p.243） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-005` |
| 180 | **RenderBoost** | 機械学習によるフレーム補間で実レンダリング枚数を減らし動画出力時間を短縮する。 | 本書 p.221（PDF p.245） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-005, BL-027` |
| 181 | **N Panel Sub Tabs** | 増えすぎたサイドバー（Nパネル）のアドオンタブをカテゴリ別サブタブへ整理する。 | 本書 p.222（PDF p.246） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-029` |
| 182 | **Powermanage** | 用途別プリセットで大量アドオンの有効／無効と設定バックアップを一括切替する。 | 本書 p.223（PDF p.247） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-029` |
| 183 | **Clean Panels** | ワークスペース別フィルタやドロップダウン・Pie化でNパネルをすっきり整理する。 | 本書 p.224（PDF p.248） | 有料（Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-029` |
| 184 | **Ttranslation** | ショートカット一発でBlenderのUI言語（英語⇔日本語等）を瞬時に切り替える。 | 本書 p.226（PDF p.250） | 無料（ArtStation） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-001` |
| 185 | **User Translate** | 英語オンリーの外部アドオンUIをCSV辞書で自分好みに日本語化する。 | 本書 p.227（PDF p.251） | 無料・有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-001, BL-029` |
| 186 | **Screencast Keys** | 操作中のキーボード入力とマウスクリックをビューポート画面上へリアルタイム表示する。 | 本書 p.228（PDF p.252） | 無料・有料（Extensions・GitHub・Superhive） | 本書Extensions記載 / 2026-11-23個別未確認 | `BL-001` |
| 187 | **Customize Menu Editor** | 自分専用のカスタムメニューやマクロボタンをGUI上で組み、アドオンとして書き出す。 | 本書 p.229（PDF p.253） | 有料（BOOTH・Superhive） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-029` |
| 188 | **Serpens** | Pythonコードを手書きせずビジュアルノードの組み合わせでBlenderアドオンを開発する。 | 本書 p.230（PDF p.254） | 有料（Superhive・Gumroad） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-024, BL-029` |

---

## 3. Part 2「クリエイターが選ぶ推しアドオン」追加登場分（Part 1 未掲載 31本）

Part 2（本書 p.232–405 / PDF p.256–429）の職種別ワークフロー（キャラクターモデラー・背景アーティスト・CGアーティスト・アニメーター・VFXアーティスト）で追加紹介されているアドオン一覧です。

| # | アドオン名 | 何ができるか（1行要約） | ページ（本書 / PDF） | 本書記載（区分・掲載節） | 現行版 4.2+ 入手状況（2026-11-23） | 関連技法 ID |
|---|---|---|---|---|---|---|
| P2-01 | **Wireframe Color Tools** | オブジェクト別にワイヤーフレーム表示色を変えて重なったメッシュを見分けやすくする。 | 本書 p.237（PDF p.261） | 未記載（外部）（Part 2 キャラモデラー編） | 外部配布 / 2026-11-23未確認 | `BL-001` |
| P2-02 | **Synchronize Workspaces** | ワークスペース切替時に3Dビューの視点や状態を同期維持する。 | 本書 p.238（PDF p.262） | 未記載（外部）（Part 2 キャラモデラー編） | 外部配布 / 2026-11-23未確認 | `BL-001` |
| P2-03 | **Hdr Rotation 3D** | 3Dビュー上でHDRI環境の回転を直感的に操作する。 | 本書 p.239（PDF p.263） | 未記載（外部）（Part 2 キャラモデラー編） | 外部配布 / 2026-11-23未確認 | `BL-005` |
| P2-04 | **Material Utilities** | マテリアルの一括割り当て・選択・クリーンアップを専用メニューから素早く行う。 | 本書 p.239（PDF p.263） | 無料（標準搭載・Extensions） | 公式Extensions確認済 (2026-11-23) | `BL-002, BL-003` |
| P2-05 | **RM_SubdivisionSurface** | サブディビジョンサーフェスのレベル切替やクリース設定を素早く操作する。 | 本書 p.242（PDF p.266） | 未記載（外部）（Part 2 キャラモデラー編） | 外部配布 / 2026-11-23未確認 | `BL-001, BL-019` |
| P2-06 | **Restore Symmetry** | わずかに崩れたメッシュの左右対称性を復元する。 | 本書 p.242（PDF p.266） | 未記載（外部）（Part 2 キャラモデラー編） | 外部配布 / 2026-11-23未確認 | `BL-004, BL-019` |
| P2-07 | **BBrush** | ZBrush風の操作感でBlenderのスカルプト作業を行えるようにする。 | 本書 p.246（PDF p.270） | 未記載（外部）（Part 2 キャラモデラー編） | 外部配布 / 2026-11-23未確認 | `BL-018, BL-020` |
| P2-08 | **Anime Hair Maker** | アニメ調キャラクターの房状ヘアスタイルを効率よく生成・調整する。 | 本書 p.249（PDF p.273） | 未記載（外部）（Part 2 キャラモデラー編） | 外部配布 / 2026-11-23未確認 | `BL-004` |
| P2-09 | **Symmetrize UV Util** | 左右対称メッシュのUVレイアウトを対称化・整列させる。 | 本書 p.251（PDF p.275） | 未記載（外部）（Part 2 キャラモデラー編） | 外部配布 / 2026-11-23未確認 | `BL-021` |
| P2-10 | **SK Keeper** | シェイプキーを持つメッシュでもモディファイア適用を保持したまま実行する。 | 本書 p.255（PDF p.279） | 未記載（外部）（Part 2 キャラモデラー編） | 外部配布 / 2026-11-23未確認 | `BL-001, BL-004` |
| P2-11 | **ShapeKeySwapper** | シェイプキーの並び替えや差し替え整理を効率化する。 | 本書 p.255（PDF p.279） | 未記載（外部）（Part 2 キャラモデラー編） | 外部配布 / 2026-11-23未確認 | `BL-004, AE-019` |
| P2-12 | **Clay Doh** | クレイアニメ調の指紋・粘土質感をプロシージャルシェーダーで付与する。 | 本書 p.260（PDF p.284） | 未記載（外部）（Part 2 キャラモデラー編） | 外部配布 / 2026-11-23未確認 | `BL-006` |
| P2-13 | **Komikaze** | コミック・アニメ風のトゥーンシェーダー群を手軽に適用する。 | 本書 p.261（PDF p.285） | 未記載（外部）（Part 2 キャラモデラー編） | 外部配布 / 2026-11-23未確認 | `BL-006, AE-031` |
| P2-14 | **InkTool** | 手描きインク風のアウトラインや陰影表現を構築する。 | 本書 p.261（PDF p.285） | 未記載（外部）（Part 2 キャラモデラー編） | 外部配布 / 2026-11-23未確認 | `AE-032` |
| P2-15 | **GoB / 3D-Coat Applink** | ZBrushや3D-CoatとBlender間でモデル・テクスチャをワンクリック往復連携する。 | 本書 p.263（PDF p.287） | 未記載（外部）（Part 2 キャラモデラー編） | 外部配布 / 2026-11-23未確認 | `BL-016, BL-018` |
| P2-16 | **Cats Blender Plugin** | VRChat/MMD向けアバターモデルのボーン修正・最適化・リップシンク設定を補助する。 | 本書 p.268（PDF p.292） | 未記載（外部）（Part 2 キャラモデラー編） | 外部配布 / 2026-11-23未確認 | `BL-004` |
| P2-17 | **TRIToon** | リアルタイム用途向けのアニメ調トゥーンシェーダー表現を構築する。 | 本書 p.268（PDF p.292） | 未記載（外部）（Part 2 キャラモデラー編） | 外部配布 / 2026-11-23未確認 | `BL-006` |
| P2-18 | **Pie Menu Editor** | 任意のコマンドやパネルを自在に組み合わせた自作Pieメニュー・ポップアップを作る。 | 本書 p.287（PDF p.311） | 未記載（有料系）（Part 2 背景アーティスト編） | 外部配布 / 2026-11-23未確認 | `BL-029` |
| P2-19 | **Tools for me (TFM)** | 背景制作向けのトランスフォーム補助・時短パネル群を提供する。 | 本書 p.292（PDF p.316） | 未記載（外部）（Part 2 背景アーティスト編） | 外部配布 / 2026-11-23未確認 | `BL-001` |
| P2-20 | **Material Organizer** | 大量のマテリアルを整理・一括管理し背景シーンの見通しを良くする。 | 本書 p.296（PDF p.320） | 未記載（外部）（Part 2 背景アーティスト編） | 外部配布 / 2026-11-23未確認 | `BL-002, BL-006` |
| P2-21 | **Geo Primitive** | カーブやアニメ付きパラメトリック幾何学オブジェクトを手早く生成する。 | 本書 p.304（PDF p.328） | 未記載（外部）（Part 2 CGアーティスト編） | 外部配布 / 2026-11-23未確認 | `BL-001, AE-029` |
| P2-22 | **Quick Lighting Kit** | スタジオ照明・背景ライトの配置と色・強度調整を素早くセットアップする。 | 本書 p.310（PDF p.334） | 未記載（外部）（Part 2 CGアーティスト編） | 外部配布 / 2026-11-23未確認 | `BL-005` |
| P2-23 | **Chain Generator** | カーブに沿った鎖・チェーン形状を自動生成・レイアウトする。 | 本書 p.315（PDF p.339） | 未記載（外部）（Part 2 CGアーティスト編） | 外部配布 / 2026-11-23未確認 | `BL-001` |
| P2-24 | **FALCON CAM** | 軌道・被写界深度・フォーカス・ターゲット管理を統合した映像向けカメラツール。 | 本書 p.323（PDF p.347） | 未記載（外部）（Part 2 CGアーティスト編） | 外部配布 / 2026-11-23未確認 | `AE-034` |
| P2-25 | **Freebird XR** | VR空間内でコントローラーを使って直感的にBlenderの造形・アニメ作業を行う。 | 本書 p.336（PDF p.360） | 未記載（外部）（Part 2 アニメーター編） | 外部配布 / 2026-11-23未確認 | `BL-001` |
| P2-26 | **fSpy** | 静止画・イラストからカメラ画角と消失点パースを抽出しBlenderカメラへ復元する。 | 本書 p.366（PDF p.390） | 無料（オープンソース）（Part 2 アニメーター編） | 外部配布 (ZIP導入) / 2026-11-23未確認 | `BL-005` |
| P2-27 | **AnimAll** | メッシュ頂点・UV・頂点カラーなど通常キーを打てない要素へ直接キーフレームを打つ。 | 本書 p.374（PDF p.398） | 無料（標準搭載・Extensions） | 公式Extensions確認済 (2026-11-23) | `AE-022` |
| P2-28 | **Refine Tracking Solution** | カメラトラッキングのソルブ誤差が大きいマーカーを自動整理し精度を改善する。 | 本書 p.386（PDF p.410） | 無料（Extensions） | 公式Extensions確認済 (2026-11-23) | `COLOR-022` |
| P2-29 | **Align and Distribute** | 複数オブジェクトを規則的に整列・等間隔配置し物理シミュレーション準備を助ける。 | 本書 p.392（PDF p.416） | 未記載（外部）（Part 2 VFXアーティスト編） | 外部配布 / 2026-11-23未確認 | `BL-001` |
| P2-30 | **Denoiser Comp** | コンポジット段階のデノイズ設定を素早く組み込んでノイズを抑える。 | 本書 p.399（PDF p.423） | 未記載（外部）（Part 2 VFXアーティスト編） | 外部配布 / 2026-11-23未確認 | `COLOR-009, BL-005` |
| P2-31 | **Export: Adobe After Effects (.jsx)** | Blenderの3Dカメラ・ライト・ヌル座標をAfter Effects用ExtendScript（.jsx）として書き出す。 | 本書 p.401（PDF p.425） | 無料（標準搭載・Extensions） | 公式Extensions確認済 (2026-11-23) | `AE-024, AE-034, BL-027` |

---

## 4. カテゴリ別・他ツール対応の補足（Gemini による再現方法の補足）

本書の対象はすべて **Blender** 用アドオンですが、映像分解時に他ツール（**After Effects / DaVinci Resolve**）へ置き換える場合の対応方針をカテゴリ別に整理します（本書に記載のない他ツール移植の補足）。

### `ADDON-001` モデリング・リトポ・ハードサーフェス・UV・ベイク系アドオン群
- **出典**: 『職種と用途で探せる Blender アドオン事典』Part 1（本書 p.6–96 / PDF p.26–120）

#### 本書の記述（要約）
モデリング・リトポ・UV展開・PBRペイント・ベイクの各工程を専用アドオン（`Bool Tool`・`LoopTools`・`F2`・`PolyQuilt`・`Boxcutter`・`Hardops`・`Mio3 UV`・`UniV`・`Ucupaint`・`Node Wrangler`・`SimpleBake` 等）で高速化する構成が体系化されている。

#### Gemini による再現方法の補足（本書に記載のない他ツール移植・運用指針を含む）
- **Blender**: 現行版（Blender 4.2 以降）では旧標準バンドルだった `BoltFactory`・`Bool Tool`・`LoopTools`・`F2` 等が公式 `extensions.blender.org` へ移行済みのため、まず「エクステンションを入手」から無料定番一式を導入する。
- **After Effects**: 3D造形・UV・ベイク機能自体は持たないため、Blender＋これらアドオンで軽量化した完成モデル（GLB/OBJ）を受け取り「アドバンス 3D」上でライティング・タイトル合成する役割分担となる。
- **DaVinci Resolve**: Fusion 3D は合成・仕上げ特化のため、造形・UV・ベイク済みモデルを FBX / USD 形式で Blender から受け取り、カメラ合成・ルック調整へ接続する。

### `ADDON-002` リギング・アニメーション・カメラワーク・VFX・ルック系アドオン群
- **出典**: 『職種と用途で探せる Blender アドオン事典』Part 1–2（本書 p.97–230, 303–405 / PDF p.121–254, 327–429）

#### 本書の記述（要約）
スキニング（`Auto-Rig Pro`・`Mio3 Copy Weight`・`Wiggle 2`）、照明・空（`Photographer 5`・`Gaffer`・`Dynamic Sky`）、トラッキング・破壊・流体（`GeoTracker`・`Refine Tracking Solution`・`Cell Fracture`・`RBDLab`・`FLIP Fluids`）、カメラ演出（`Camera Shakify`・`Dolly Zoom`・`Shot Manager`）、および After Effects へのカメラ書き出し（`Export: Adobe After Effects (.jsx)`）まで映像制作全般を網羅する。

#### Gemini による再現方法の補足（本書に記載のない他ツール移植・運用指針を含む）
- **Blender**: 映像制作パイプラインでは特に `Camera Shakify`・`Dynamic Sky`・`Cell Fracture`・`Refine Tracking Solution`・`Export: Adobe After Effects (.jsx)` が公式 Extensions で無料入手でき、即戦力として組み込める。
- **After Effects**: Blender 側で組んだ 3D カメラ・ライト・ヌル座標を `Export: Adobe After Effects (.jsx)` で書き出して AE へ読み込めば、3D 空間と 2D モーショングラフィックス（辞典 ② `AE-xxx`）を完全一致で合成できる。
- **DaVinci Resolve**: ルック・カラー（`Colorista` / `Final LUT` 相当）やコンポジット（`Blendshop` 相当）は Resolve のカラーページ（辞典 ① `COLOR-xxx`）および Fusion 側で直接行う方が高精度かつ非破壊管理しやすい。
