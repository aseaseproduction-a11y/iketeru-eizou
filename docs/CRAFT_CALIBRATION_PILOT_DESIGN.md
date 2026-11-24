# 再現手順（craft recipes）校正 小実験 設計書（ダウンロード前・設計のみ）

- **作成日 / ライセンス確認日**: 2026-11-24
- **目的**: 「完成映像だけを見て AI が推測した再現手順（イージング・エフェクトの重ね順・カメラ・カット点など）」が、実際の編集データや制作舞台裏（メイキング）の**正解とどれだけズレるか**を定量測定し、Iketeru の映像分析と技法辞典の精度を引き上げる。
- **前提ルール**:
  - 本書は**設計のみ**であり、外部ファイルのダウンロード・購入は未実施。
  - 販売テンプレート（Envato / Motion Array 等）は利用規約で機械解析・リバースエンジニアリングが禁止されているため対象外とする（「テンプレっぽさ・脱平均化」の判定基準は、別途「低〜中位帯の校正済み動画の共通パターン＋既存 Ch.8 アンチパターン」から構築する）。
  - リポジトリには**集計値と自分の言葉による要約・誤差レポートのみ**を格納し、他者の編集データ本体・素材ファイルは一切入れない。

---

## 用語のやさしい説明
- **MIT ライセンス / CC0 / CC-BY**: 作者が「使ってよい範囲」をあらかじめ示した公開ルール。`CC0` は著作権放棄（表記不要で自由）、`MIT` と `CC-BY` は作者名・出典を書けば分析や商用利用も自由にできる緩やかなルール。
- **イージング（easing）**: 動きの加速・減速のカーブ（例：最初はゆっくり動き出し、途中で速くなり、最後にふわっと止まる等）。
- **焦点距離（focal length）**: カメラレンズの画角を決める数値（mm）。数字が小さいほど広角（空間が広く歪みやすい）、大きいほど望遠（背景がボケて圧縮感が出る）。
- **ノード構成（node graph）**: Blender や DaVinci Resolve で、色補正・ぼかし・合成などの処理ブロックを線でつないだ処理の順番。
- **BTS（Behind The Scenes）**: 撮影現場や VFX 合成の舞台裏を紹介するメイキング映像。

---

## 第1優先：オープン編集データ（コード映像＋無料 `.blend`）による「推測 vs 真値」校正実験

### 1-1. 使う候補作品とライセンス一覧（2026-11-24 確認済み）

#### A. GitHub コード映像作品（4候補：カット点・イージング・モーショングラフィックスの真値）
すべて GitHub API にてライセンス `SPDX: MIT` を 2026-11-24 に確認済み。テキストコードから**フレーム単位のカット点・イージング関数・色・配置**を 100% 正確に抽出できる。

| # | リポジトリ / 作品群 | 形式 | ライセンス（確認URL・確認日） | 想定サイズ | 主に測れる正解データ |
|---|---|---|---|---|---|
| 1 | **`motion-canvas/examples`**<br>https://github.com/motion-canvas/examples | TypeScript (Motion Canvas) | **MIT**<br>https://api.github.com/licenses/mit<br>（確認日: 2026-11-24） | 数MB | キーフレーム時刻・イージング関数（`easeInOutCubic` 等）・カメラズーム／パン・シーン遷移タイミング |
| 2 | **`ManimCommunity/manim`**（公式 Example Gallery）<br>https://github.com/ManimCommunity/manim | Python (Manim CE) | **MIT**<br>https://api.github.com/licenses/mit<br>（確認日: 2026-11-24） | 数十MB（抜粋なら数KB） | 幾何学変形・3Dカメラ軌道（`phi`/`theta`/`focal_distance`）・`rate_func`（イージング曲線）・カット尺 |
| 3 | **`satelllte/remotion-template`**<br>https://github.com/satelllte/remotion-template | React / TypeScript (Remotion) | **MIT**<br>https://api.github.com/licenses/mit<br>（確認日: 2026-11-24） | 数MB | フレーム厳密な `<Sequence>` カット点、`spring()`（バネ物理パラメータ: `damping`/`stiffness`）、`interpolate()` 範囲 |
| 4 | **`kgolid/p5ycho`**（または **`tetunori/GenerativeArtWithMath-p5.js`**）<br>https://github.com/kgolid/p5ycho<br>https://github.com/tetunori/GenerativeArtWithMath-p5.js | JavaScript (p5.js) | **MIT**<br>https://api.github.com/licenses/mit<br>（確認日: 2026-11-24） | 数MB | ジェネラティブ図形・ノイズ周期・配色パレット・反復構造の数式パラメータ |

> ※補足：`reactvideoeditor/remotion-templates` は GitHub API 上で `license: null`（ライセンスファイル未検出）だったため、安全のため採用を見送り、明示的に `MIT` が確認できた上記 4 リポジトリを選定した。

#### B. `blender.org` 無料公式デモ `.blend`（3候補：3Dカメラ・ライティング・コンポジットノードの真値）
すべて Blender 公式デモページ（https://www.blender.org/download/demo-files/）配布物。Blender の Python（`bpy`）でカメラ焦点距離・被写界深度・ライト数／色温度・コンポジットノード順を自動抽出できる。

| # | 作品名 | 作者 / 出典 | ライセンス（確認URL・確認日） | 想定サイズ | 主に測れる正解データ |
|---|---|---|---|---|---|
| 1 | **Classroom** (`classroom.zip`) | Christophe Seux / Blender Demo Files | **CC0**（パブリックドメイン）<br>https://www.blender.org/download/demo-files/<br>https://creativecommons.org/publicdomain/zero/1.0/<br>（確認日: 2026-11-24） | 約 66 MB | 室内自然光の窓ライト設計、カメラ焦点距離（mm）、F値（ボケ量）、カラーマネジメント（Filmic/AgX 等） |
| 2 | **The Junk Shop** (`thejunkshopsplashscreen`) | Alex Treviño / Blender 2.81 Splash | **CC0**（パブリックドメイン）<br>https://www.blender.org/download/demo-files/<br>https://creativecommons.org/publicdomain/zero/1.0/<br>（確認日: 2026-11-24） | 約 412.5 MB | 多灯ライティング（キー／フィル／リム比率）、複雑なシェーダー／コンポジットノードの重ね順、カメラ構図 |
| 3 | **Monster Under the Bed** (`monster_under_the_bed_sss_demo`) | Metin Seven / Blender Demo Files | **CC-BY**（クレジット表記要）<br>https://www.blender.org/download/demo-files/<br>https://creativecommons.org/licenses/by/4.0/<br>（確認日: 2026-11-24） | 約 72 MB | スタイライズド質感（SSS：肌の透け表現）、陰影コントラスト、コンポジット仕上げ（グレア・ビネット等） |

> ※アニメーション付きの動きまで `.blend` 側で測りたい場合は、同じく CC-BY 4.0 で公開されている Blender 公式オープンムービー *Charge* 等の単発ショット `.blend` を 1本だけ追加する（ダウンロード前にサイズと個別ライセンス表記を同梱 `README` で再確認する）。

---

### 1-2. ズレの測り方（ブラインド比較プロトコル）

1. **正解データ（真値 JSON）の機械抽出**：
   - コード映像：ソースコードから「各カット開始／終了フレーム」「イージング種別（リニア／イーズインアウト／バネ等）」「エフェクト・重ね順」「配色・カメラ移動」を自動抽出。
   - `.blend`：レンダリング結果（静止画または短尺カメラターン）と別に、`bpy` スクリプトで「カメラ焦点距離（mm）・センサー幅・F値」「ライト一覧と配置方向」「コンポジットノードの接続順」「キーフレーム補間種別（BEZIER/LINEAR/CONSTANT）」を真値 JSON として保存。
2. **完成映像のみから推測（ブラインド生成）**：
   - AI に**ソースコードや `.blend` を一切見せず**、完成動画（またはレンダー画像）だけを渡して Iketeru の現行 `craft_recipes` 形式で再現手順を出力させる。
3. **突き合わせ採点（誤差の定量化）**：
   - 以下の 5 項目で「推測 vs 真値」を自動／半自動比較し、ズレの傾向（例：「カメラを広角寄りに誤認しやすい」「グレアとブルームの順序を逆に書きがち」等）を一覧化する。

| 測る項目 | 具体的な指標（どう数値化するか） | 成功の目安（校正完了ライン） |
|---|---|---|
| **① カット点・尺の精度** | 真値カット時刻と推測カット時刻の平均絶対誤差（MAE：秒）およびカット検出再現率 | **MAE ≤ 0.25秒**（7〜8フレーム以内）、カット再現率 **≥ 90%** |
| **② イージング分類の一致** | 4大分類（`linear` / `ease_out` / `ease_in_out` / `spring_overshoot`）の一致率 | 一致率 **≥ 75%**（特にバネ・跳ね返りと通常減速を混同しない） |
| **③ カメラ焦点距離・画角** | 広角（≤28mm）／標準（29〜55mm）／望遠（≥56mm）の3区分一致率、数値誤差 | 3区分一致率 **≥ 80%**、数値の中央値誤差 **≤ 15mm** |
| **④ エフェクト／ノード重ね順** | 主要エフェクト・ノード集合の F1 スコア（漏れと幻覚のバランス）＋順序一致率（Kendall's τ 相当） | 主要要素の再現率 **≥ 70%**、**存在しないエフェクトの誤記載（幻覚率）≤ 20%** |
| **⑤ 再現手順の実行可能性** | 推測レシピどおりに組んだとき、元映像の視覚印象と破綻なく一致するか（3段階評価：○再現可／△要微調整／×別物） | **○＋△ が 80% 以上**、× が 0〜1件以下 |

---

## 第2優先：Iketeru 既存 DB（メイキング／BTS 125本）× 本編動画ペア比較

### 2-1. 既存 DB から抽出した「メイキング ↔ 本編」確度高ペア一覧（全28組・読み取り専用確認）

ローカル DB（`iketeru_knowledge.db`、総動画 5,701本）内のメイキング／BTS 関連 **125本** を全件照合し、誤一致（別作品・別CM）を除外して**同一作品の対と確認できた 28組**を整理しました（追加ダウンロード不要、既存 DB 上の公開動画メタデータ参照のみ）。

| # | カテゴリ | メイキング / BTS 動画（DB ID・タイトル） | 対になる本編動画（DB ID・タイトル） | 小実験おすすめ度 |
|---|---|---|---|---|
| 1 | ミニチュア・特撮 | `EAtYC9fkjGA` Honda Power Products「Hakoniwa」Making | `hyfcLfbD-VU` Honda Power Products「Hakoniwa」本編 | **◎ 実験対象候補**（実物ミニチュア vs CG誤認の検証に最適） |
| 2 | VFX ブレイクダウン | `w9Mx7pjeIpk` LE SSERAFIM×ILLIT×KATSEYE 'ICONIC BY MISTAKE' VFX Breakdown | `27C4pfRsf9g` 同曲 Official MV | **◎ 実験対象候補**（実写と合成レイヤー境界の正解合わせ） |
| 3 | 実写・大規模特機 | `_EZk4P5tl94` ポカリスエット「POCARI HUMAN CHALLENGE」BTS | `4y9q0_TktCA` ポカリスエット同CM 90秒本編 | **◎ 実験対象候補**（実写セット・ワンカット演出の真値） |
| 4 | 海外ストップモーション／実写 | `1067426859` Britbox 'See it Differently' BTS (Nicos Livesey) | `1069311388` Britbox 'See it Differently' 本編 | **◎ 実験対象候補**（Vimeo・物理クラフト技法の正解） |
| 5 | 合成 / VFX / 3DCG MV | `XwUhFsrkuNY` Mrs. GREEN APPLE「クスシキ」BTS | `RCaTLn4qoz4` Mrs. GREEN APPLE「クスシキ」Official MV | **◎ 実験対象候補**（国内大型 VFX MV の撮影・合成検証） |
| 6 | 実写・シネマティック（iPhone） | `E48UThkyWvI` Apple「ラストシーンの舞台裏」BTS | `1nP45TNIIKM` 是枝裕和監督「ラストシーン」本編 | **◎ 実験対象候補**（実機カメラ・照明・リグ構成の答え合わせ） |
| 7 | アニメ・2D 制作 | `CQdeuG6Uy14` Google Chrome「がんばれ！くろーむ」メイキング | `nMF3nLV-m24` Google Chrome アニメ #3 本編 | **◎ 実験対象候補**（2Dアニメのコンテ〜撮影処理検証） |
| 8 | 実写 MV（演出・撮影） | `rtDCbL1Nh-E` サカナクション「怪獣」MV BTS | `a8dgNdJVluc` サカナクション「怪獣」Official MV | **◎ 実験対象候補**（実写撮影・ライティング・カット設計） |
| 9 | 実写 MV | `MsQaIXSMDSU` 宇多田ヒカル「Mine or Yours」BTS | `n9Nrl9qXxow` 宇多田ヒカル「Mine or Yours」Official MV | ○ |
| 10 | 海外 MV | `ApCHvzvzlYw` CAPAREZZA 'A COMIC BOOK SAVED MY LIFE' Making Of | `RZPOe63cjgY` 同曲 Official Video | ○ |
| 11 | 海外 MV | `mlnB13VUEUw` The Weeknd 'Echoes of Silence' BTS | `bHFc5ZfEdBQ` The Weeknd 'Echoes of Silence' 本編 | ○ |
| 12 | 実写 MV（ダンス・照明） | `iu_9z0IHRTw` きゃりーぱみゅぱみゅ「Focus Focus」BTS | `fgQ_NH-hvGI` 同曲 Official MV | ○ |
| 13 | 実写 MV | `w4RVYzflU_E` Motoki Ohmori「催し」MV BTS | `fR7RPEW6YE0` 同曲 Official MV | ○ |
| 14 | 実写 MV | `Q2ZAXEzAFw0` あいみょん「RING DING」MAKING MOVIE | `xeYiCU7W9as` 同曲 Official MV | ○ |
| 15 | 2D アニメ MV（コンテ比較） | `Pa-bsONhIBI` ずっと真夜中でいいのに。「お勉強しといてよ」メイキング | `67IuhtTzqGg` 同曲 STORYBOARDS（絵コンテ版） | ○（絵コンテと制作過程の比較） |
| 16 | アニメ映画（ビデオコンテ比較） | `xUHK7xuX5jU` アニメ『秒速5センチメートル』ビデオコンテ比較 | `ZhMakZuBU-o` 同作 主題歌映像 | ○ |
| 17 | 実写＋VFX CM | `BAScFIEfrOc` Uber TVCM「第六感篇」メイキング | `M9mqT8NE6iQ` Uber 同CM本編 | ○ |
| 18 | 企業 CM | `j9bUL2x-n-k` 大同特殊鋼「すごい未来、特殊鋼と行こう！」メイキング | `x7C6f7-aAOs` 同CM 航空宇宙篇 | ○ |
| 19 | 企業 CM | `6UoR65lOf64` NURO「感動を止めるな。」独白篇 メイキング | `8oS-Y_f45yk` NURO 同CM 30秒本編 | ○ |
| 20 | 実写 CM | `GCYnNQ1yZyI` 住友生命 Vitality「踊っているだけの生田」メイキング | `D9oZ2s4Biyw` 同CM 30秒本編 | ○ |
| 21 | 実写 CM | `bMexOIiJR5Y` 住友生命 Vitality「救Q隊Cube」メイキング | `ZlamAEvYOvc` 同CM 30秒本編 | ○ |
| 22 | 実写 CM | `S8zH-K87gzU` 小松菜奈「暮らすほどに、幸せが見つかる。」インタビュー | `hq5wUopaBKM` 同スペシャルムービー本編 | △（インタビュー中心） |
| 23 | 実写 CM | `-E2nOUXBwhU` ロケットナウ ゼロ配刑事編 メイキング | `4k5zlZyKsew` 同CM 30秒本編 | ○ |
| 24 | 実写 CM | `WOLRmQyFGiI` 東武鉄道×FRUITS ZIPPER コラボCM・MV メイキング | `ZVSq0Q9qxp0` 同CM本編 | ○ |
| 25 | 海外ブランデッド | `J6034KSc6Uk` The Making of Oura's Wear Your Best Life | `szmzlH_AaFU` Oura 'Wear Your Best Life' 本編 | ○ |
| 26 | 実写 CM（複数本） | `dD7bCJBjdLM` / `G4WS-Vm_ipg` クラシエ葛根湯 メイキング＆インタビュー | `lxTIajblmv0` 同CM 30秒本編 | ○ |
| 27 | 実写 CM（その他確度高） | `gedRoZr3VcQ`（キャンメイク）/ `WlwRWYWB61Q`（サントリー生ビール）/ `g-Npu15LuVY`（ランドリン）/ `XbuRfdBErro`（吉野家）/ `K7kzy1DhAHw`（ガツン、と）/ `Z_zy3Pp-Ejc`（トヨタホーム）/ `cddePm1brLI`（眼鏡市場）/ `8A6F10zDt2Y`（午後の紅茶）/ `ahfEYpERcTM`（カロリーメイト）/ `Qa3umsxcb1Y`（太平洋セメント）/ `tBjMJP6Bz5M`（100年の物語）/ `1202090291`（Airalo Vimeo） | 各対応本編（`Yk-14JZQjPo`, `-Nsrg3eVBBw`, `FEHDuTuhGFw`, `I6SqNnSiA8c`, `HTbFt-GeuuU`, `ULiGgpTq16k`, `lvMcYm2LIdQ`, `lJJ2MJlIazI`, `antN5hIQAHg`, `VtYnVHyU7kE`, `mrO-E5JAqGQ`, `1198718318`） | ○（まずは上位8組で検証後、必要に応じ拡張） |
| 28 | 生成AI / バーチャル制作 | `AusVvo_NU2o` Your Way Out BTS / `gWbtdecjzRM` LIGHT HOUSE BTS | `0V4CCxskN_0` Your Way Out 本編 / `iIL_CB_YjFk` LIGHT HOUSE 本編 | ○（AI・VP 領域の誤認検証に有用） |

### 2-2. 本編推測 vs メイキング真値の比較方法（上記 ◎ の代表 8組で小実験）

1. **ブラインド推測（本編のみ）**：
   - AI に本編動画だけを見せ、特に誤認が起きやすい 4 観点で制作手法を推測させる：
     1. **撮影手法の切り分け**：実写セット／ミニチュア／グリーンバック合成／フル 3DCG／2D 作画のどれか？
     2. **カメラ・特機**：手持ち／ステディカム／ドリー／クレーン／モーションコントロール／固定＋デジタルズームのどれか？
     3. **照明・環境**：自然光／大型ソフトライト／LED ボリューム／実物スモーク・実炎 vs ポスト VFX のどれか？
     4. **編集・つなぎ**：本当にワンカットか、隠しカット（ウィップパン・暗転・柱通過）の疑似ワンカットか？
2. **メイキングからの正解シート抽出**：
   - 対になる BTS 動画（既存 DB 内の解説・映像）から、実際に使われた機材・セット・VFX レイヤー・実物ギミックを箇条書きの正解シートにする。
3. **誤差カテゴリ分類と改善反映**：
   - 不一致を「① 実物ギミックを CG と誤認（最重要）」「② CG/合成を実写と誤認」「③ 特機・カメラワークの誤認」「④ 照明・ポスト処理の過大推測」に分類。
   - 誤認パターンを `craft_recipes` 生成プロンプトのチェック項目（「実物ミニチュア／物理セットの可能性を必ず検討する」「確信が持てない機材・ソフト名は推測と明記する」等）へ反映する。

### 2-3. 第2優先の成功の目安
- **手法カテゴリ（実写／ミニチュア／VFX合成／3DCG／2D）の一致率**: 改善前ベースラインを計測した上で、改善後に **≥ 85%**（特に「実物ミニチュアや実写セットを安易に CG と断定する誤認」を **半減以下** にする）。
- **「不明・推測」の正直な自己申告**: メイキングで初めて判明する非可視情報（例：使用レンズ銘柄や裏の合成ソフト名）を断定せず、`confidence: low / inferred` と正しく分類できる割合 **≥ 90%**。
- **リポジトリ保管ルール**: 保存するのは「比較評価表 JSON／Markdown と、自分の言葉で整理した分析改善ルールのみ」（元動画・プロジェクトファイル本体は一切コミットしない）。
