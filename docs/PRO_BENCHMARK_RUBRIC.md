# 客観的プロ評価基準・国際ベンチマーク設計書（v5）

外部の厳格な国際・国内専門審査機関および公式アワード受賞・ショートリスト実績に基づき、AIの自己参照バイアスや現行ランク据え置き（`clamp_band`）を排した**客観的な映像評価基準**を定義する。

---

## 1. 厳格運用ルール（v5 改訂）

1. **出典URLの必須要件（個別ページ＋本文近接照合）**:
   - DB内のAI分析本文に書かれた賞名はそのまま信用しない。
   - すべての受賞・選出記録に対し、**「その作品自体の受賞・選出・賞の格（グランプリ／金賞／優秀賞／入選／ショートリスト等）が明記されている個別ページ・公式受賞リスト等のURL（`sourceUrl`）」**を必須とする。
   - 賞のトップページURLのみの記載は不可とする。
   - 機械検証（`scripts/verify-benchmark-sources.mjs`）では、**ヘッダー・ナビ・フッター・サイドバーを除去した本文**に対して、**サイト名と同名の語を除外した賞の格キーワード**と**作品名キーワード**が**近接位置（500文字以内）**に共起することを必須条件とする。確認できない候補（例：作品ごとの年度選出記載がないポートフォリオ一覧ページ等）は `unverified` として基準セットから除外する。
2. **映像・クラフト以外の部門は参考扱い（`non_craft_award_reference` / `purpose_reference_only`）**:
   - Cannes Lions や D&AD などの国際主要賞であっても、**映像演出・技術を主評価軸としない部門**（`Digital Marketing`, `Direct`, `Media`, `PR`, `Creative Effectiveness`, `Sustainable Development Goals (SDG)`, `Grand Prix for Good`, `Titanium` 等）の受賞作は、クラフト基準群（`craft_benchmark`）から外し、**参考扱い**として分離する。
3. **複数受賞の扱い（最高格採用ルール）**:
   - 1作品が複数のクラフト関連賞を受賞している場合は、**最も高い格の賞（`max_tier`）**を採用して `objective_tier` を決定する。
4. **年代の扱い（過去10年優先ルール）**:
   - 現代の映像技術・演出水準と整合させるため、**過去10年以内（2016年〜2026年）**の受賞・選出作を `era_bucket: "modern_10y"` として優先採用する。
   - 10年以上前の歴史的傑作・アーカイブ作は `era_bucket: "classic_archive"` と明記し、較正時は現代作のみ・全体双方で集計可能とする。
5. **非受賞作品（`non_award_baseline`）の評価方法（循環比較の禁止）**:
   - 非受賞の商用映像には **`objective_tier: null` / `objective_band: null`** を設定し、**現行DBのAIランクを正解ラベルとしてコピーしない**（AI自身との循環比較を防止）。
   - **Spearman $\rho$ / Kendall's $\tau_b$ / MAE** は、外部受賞・選出が確認された **`craft_benchmark` 作品のみ**で算出する。
   - **`non_award_baseline`** は、**順位の正解率（Pairwise Ranking Accuracy / ROC-AUC）**＝「（**`A-` 以上の受賞・選出作**のAI点数 ＞ 非受賞商用作品のAI点数）となる組み合わせの割合」のみで評価する（全体およびジャンル別）。※`B+` 相当の小規模協賛企業賞等はプロ商用作品より上とは限らないため比較対象から除外する。
6. **暫定評価・埋め込み制限の扱い**:
   - DB上で `analysisStatus = provisional` の作品は基準セットに含めない。
   - YouTube の `embedStatus = restricted`（iframe埋め込み無効）作品は、`yt-dlp` による実ダウンロード可否を実測し（証跡：`analysis/restricted_ytdlp_check.json`）、`embed_status` と `playable_via_ytdlp` を明記する。

---

## 2. 参照する公式プロ審査基準（クラフト評価優先）

### 2.1 Cannes Lions — Film Craft Lions
- **最上位原則**: *Execution is King*（アイデア単体ではなく、映像としての実行・クラフトが物語や感情を劇的に引き上げているか）
- **4大評価軸**: Direction / Cinematography / Editing / Sound Design
- **減点・失格傾向**: 物語に寄与しない技術の見せびらかし、定型的・量産的ショートカット（*purpose-driven craft* の欠如）

### 2.2 D&AD Awards — Film Advertising Crafts（Pencil Hierarchy）
- **Black Pencil（最高賞・世界年間数本）** ＞ **Yellow Pencil（金賞相当）** ＞ **Graphite Pencil（銀賞相当）** ＞ **Wood Pencil（銅賞相当）** ＞ **Shortlist**

### 2.3 ACC TOKYO CREATIVITY AWARDS（フィルム部門 / フィルムクラフト部門）
- **総務大臣賞／ACCグランプリ** ＞ **ACCゴールド** ＞ **ACCシルバー** ＞ **ACCブロンズ** ＞ **ファイナリスト**

---

## 3. 賞の格 × 15段階ランク対応表（クラフト部門優先・ショートリスト含む）

ショートリスト／ファイナリスト／オフィシャルセレクション／審査委員会推薦作品／入選は、**同賞の受賞（Winner）の1ランク下**として配置する。

| ランク | 100点帯 | ティア区分 | 広告・CM（クラフト優先） | MV | モーション | 3DCG / アニメ | 企業映像・メタランキング |
|---|---|---|---|---|---|---|---|
| **`S+`** | 97–100 | **上位** | **Cannes Film Craft GP** / **D&AD Black Pencil (Film Craft)** / **One Show Best of Discipline (Craft)** / **ADC Black Cube** / **AICP Best in Show** / **Ciclope GP** / **Spikes Asia Film Craft GP** | **UKMVA Video of the Year** / **D&AD Black Pencil (MV)** | **SXSW Title Design Grand Jury** / **Motion Awards Grand Prize** | **Annecy Cristal（GP）** / **Cannes Short Film Palme d'Or** / **Prix Ars Electronica Golden Nica** / **SIGGRAPH CAF Best in Show** | **Cannes Corporate Grand Prix（White Dolphin）** / **WARC Creative 100 Top 10（クラフト併載）** |
| **`S`** | 93–96 | **上位** | **Cannes Film Craft Gold** / **D&AD Yellow Pencil (Craft)** / **One Show Gold (Craft)** / **ADC Gold** / **AICP Winner** / **Ciclope Gold** / **British Arrows Gold** / **Clio Gold (Craft)** / **LIA Gold (Production)** / **ACC総務大臣賞・GP** | **MTV VMA Video of the Year＋クラフト複数冠** / **UKMVA Best Director・主要部門Winner** / **SPACE SHOWER VIDEO OF THE YEAR** | **SXSW Title Design Winner** / **Motion Awards Winner** / **Vimeo Staff Pick of the Year** | **Annecy Jury Award / Best Direction** / **文化庁メディア芸術祭 大賞** / **SIGGRAPH CAF Jury's Choice** / **Prix Ars Electronica Award of Distinction** | **Cannes Corporate Gold Dolphin** / **WARC Creative 100（クラフト系）** |
| **`S-`** | 90–92 | **上位** | **Cannes Film Craft Silver** / **D&AD Graphite Pencil (Craft)** / **One Show Silver** / **ADC Silver** / **Ciclope Silver** / **British Arrows Silver** / **Clio Silver** / **LIA Silver** / **Spikes Asia / ADFEST Film Craft Gold** / **ACCゴールド** / **TCCグランプリ** / **ギャラクシー賞CM大賞** | **UKMVA クラフト・部門Winner** / **D&AD Graphite / Wood Pencil (MV)** / **MTV VMAJ 最優秀ビデオ賞** / **SPACE SHOWER BEST VIDEO** / **Berlin MVA Best Video** | **SXSW Special Jury Recognition (Animation/Title)** / **Motionographer Award Winner** / **SXSW Title Design Finalist** | **Academy Awards（Oscar）短編アニメ Shortlist** / **Annecy Official Competition Selection** / **文化庁メディア芸術祭 優秀賞** / **SIGGRAPH CAF Electronic Theater 入選** / **Prix Ars Electronica Honorary Mention** | **映文連アワード 経済産業大臣賞** / **Cannes Corporate Silver Dolphin** |
| **`A+`** | 86–89 | **中位（上位寄）** | **Cannes Film Craft Bronze** / **D&AD Wood Pencil (Craft)** / **One Show Bronze** / **ADC Bronze** / **Ciclope Bronze** / **British Arrows Bronze** / **Clio Bronze** / **LIA Bronze** / **Spikes Asia / ADFEST Film Craft Silver** / **ACCシルバー** / **TCC賞** / **ギャラクシー賞CM優秀賞** / **BOVAグランプリ** | **MTV VMA / UKMVA Craft部門 Nominee（Shortlist）** / **MTV VMAJ 部門賞** / **Berlin MVA 部門Winner** / **Annecy Commissioned Selection（MV）** | **文化庁メディア芸術祭 新人賞（モーション系）** / **Vimeo Staff Pick Best of the Month** / **Motion Awards Shortlist** | **Annecy Commissioned / Graduation Selection** / **文化庁メディア芸術祭 新人賞** / **国際映画祭部門作品賞** | **日本国際観光映像祭 グランプリ** / **TOYOTA DIRECTORSCUT 最優秀賞** |
| **`A`** | 82–85 | **中位** | **Cannes Film Craft Shortlist** / **D&AD Shortlist (Craft)** / **One Show Merit** / **Ciclope Finalist（Shortlist）** / **Spikes Asia / ADFEST Film Craft Bronze・Finalist** / **ACCブロンズ** / **ギャラクシー賞CM選奨** / **BOVAゴールド** | **SPACE SHOWER / VMAJ ノミネート** / **Berlin MVA Nominee** / **文化庁メディア芸術祭 審査委員会推薦作品（MV）** | **国際アニメ映画祭 部門賞・観客賞（新千歳等）** / **国内主要モーション賞入賞** | **文化庁メディア芸術祭 審査委員会推薦作品（アニメ）** / **国際アニメ映画祭ショートリスト** | **ADFEST Fabulous Four Commendation** / **映文連アワード 部門優秀賞** / **日本国際観光映像祭 優秀賞** |
| **`A-`** | 78–81 | **中位（下位寄）** | **ACCファイナリスト** / **BOVAシルバー** | 国内インディーズMVアワード入選 | **Vimeo Staff Pick（通常選出・出典確認済）** / **文化庁メディア芸術祭 海外展開公式選出** | **国際アニメ映画祭 公式入選** / **学生CGコンテスト入選** | **ADFEST Fabulous Four Official Selection** / **日本国際観光映像祭 入選・観客賞** / **Cannes Corporate Finalist** |
| **`B+`** | 73–77 | **中位下限** | **BOVA協賛企業賞・学生部門賞** | 国内インディーズ小規模賞入選 | 国内小規模企画入選 | 小規模コンテスト入選 | 地域・企業小規模コンテスト入選 |
| **非受賞（`null`）** | — | **下位（ベースライン）** | 非受賞の通常商用TVCM / Web CM（※`objective_tier: null`、Pairwise順位正解率のみで評価） | 非受賞の通常商用MV | 非受賞の通常モーション・リール | 非受賞の通常3DCG・短編アニメ・アニメPV | 非受賞の通常企業VP・採用動画・自治体PR |

---

## 4. キャリブレーション手順・統計的評価指標（v5 改訂）

1. **基準セットファイル**: `analysis/golden_benchmark.json`
2. **ブラインド採点**: 既存DBランクおよび受賞名を完全に伏せた状態（`scripts/blind_redact.py` v4 + 2+1アンサンブル方式）でAI採点を実行する。
3. **2系統の独立評価指標と統計定義**:
   - **指標A（`craft_benchmark` 群のみ）**:
     - **順位相関（同点補正＋95%信頼区間）**: 同一ランクの作品が多いため、**平均順位法（midrank）による同点補正付き Spearman $\rho$**（目標 $\rho \ge 0.85$）と **Kendall's $\tau_b$（同点補正あり）** を併用し、**ブートストラップ法（$B=2,000$回、パーセンタイル法）による 95%信頼区間**を併記する。
     - **MAE の定義（帯域外距離 / Band-distance MAE）**: 各作品の客観正解ランク帯を $[L_i, U_i]$、AI予測点数を $\hat{y}_i$ とするとき、1本あたりの誤差を
       $$e_i = \begin{cases} 0 & (L_i \le \hat{y}_i \le U_i) \\ L_i - \hat{y}_i & (\hat{y}_i < L_i) \\ \hat{y}_i - U_i & (\hat{y}_i > U_i) \end{cases}$$
       （正解ランク帯の中なら `0`、外なら最も近い端までの点差）と定義し、その平均 $\text{MAE} = \frac{1}{N}\sum_{i=1}^N e_i$（目標 $\le 4.0$点）を算出する。
     - **ランク帯ごとの正解率**: `S+`〜`B+` の各ランク帯ごとに、完全一致率および ±1ランク以内一致率を併記する。
     - **年代別集計**: 現代作（`era_bucket: "modern_10y"`）単体と全体双方を出力する。
   - **指標B（`A-` 以上の `craft_benchmark` vs `non_award_baseline`）**:
     - **Pairwise 順位正解率（ROC-AUC ＋ ブートストラップ95%信頼区間）**: **`A-` 以上の受賞・選出作**の点数が非受賞商用作品の点数を上回る組み合わせ割合（目標 $\ge 0.85$）を算出し、ブートストラップ法（$B=2,000$回）による **95%信頼区間** を併記する。`B+` の受賞作（協賛企業賞等）はプロ商用作品より上とは限らないため比較から除外する。
   - **ジャンル別集計と小標本の扱い**:
     - 5ジャンル（CM / MV / モーション / 3DCG/アニメ / 企業映像）ごとの数値を出力するが、**評価対象本数が少ないジャンル（合計10本未満、または `craft_benchmark` / `non_award_baseline` のいずれかが5本未満のジャンル）は統計的検出力が不十分なため参考値（`sample_size_warning: true`）**として扱い、合否判定は全体指標を主基準とする。
   - **参考出力**: `non_craft_award_reference` / `purpose_reference_only` は別枠でスコアと乖離のみ参考表示する。
