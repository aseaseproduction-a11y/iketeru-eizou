# 客観的プロ評価基準・国際ベンチマーク設計書（v2）

外部の厳格な国際・国内専門審査機関および公式アワード受賞・ショートリスト実績に基づき、AIの自己参照バイアスや現行ランク据え置き（`clamp_band`）を排した**客観的な映像評価基準**を定義する。

> **重要原則**: DB内のAI分析本文に書かれた賞名はそのまま信用せず、**公式アワード・ショートリストページ等の一次情報で実際の受賞・選出を確認できた作品のみ**をベンチマークへ採用し、出典URL（`sourceUrl`）を必須とする。

---

## 1. 参照する公式プロ審査基準（クラフト評価優先）

### 1.1 Cannes Lions — Film Craft Lions
- **最上位原則**: *Execution is King*（アイデア単体ではなく、映像としての実行・クラフトが物語や感情を劇的に引き上げているか）
- **4大評価軸**:
  1. **Direction**: ブリーフの映像翻訳力、演技・美術・音・撮影の全要素を一貫したビジョンへ統率する力、感情リズムの制御
  2. **Cinematography**: 物語を深める独自の視覚言語、動機あるカメラワーク（ギミック偏重の排除）、光・影・色彩による空気感と奥行き
  3. **Editing**: 緩急（見せるべきカットで溜め、緊張で切る）、物語の明瞭さと流れ、標準的な繋ぎを超えた独創的トランジション
  4. **Sound Design**: フォーリー・環境音・静寂を含む音響世界の構築、感情ピークの増幅、クリアなミキシングと空間設計
- **減点・失格傾向**: 物語に寄与しない技術の見せびらかし、定型的・量産的ショートカット（*purpose-driven craft* の欠如）

### 1.2 D&AD Awards — Film Advertising Crafts（Pencil Hierarchy）
D&ADは「該当作なし」を辞さない世界で最も厳格な審査体系として知られる。
- **Black Pencil（最高賞・世界年間数本）**: 業界の常識を塗り替える歴史的・画期的到達点（*genuinely ground-breaking*）
- **Yellow Pencil（金賞相当）**: 世界基準（*global benchmark*）となる卓越したクリエイティブ達成
- **Graphite Pencil（銀賞相当）**: 独創的で刺激的なアイデア × 隙のない実行 × ブリーフへの的確な適合
- **Wood Pencil（銅賞相当）**: その年のトップクラスであり、美しく実行された年鑑掲載水準
- **Shortlist**: 本選審査通過・年鑑候補（Wood Pencil の1段階下）

### 1.3 ACC TOKYO CREATIVITY AWARDS（フィルム部門 / フィルムクラフト部門）
- **フィルム部門**: 第一線クリエイターの生理的な「気持ち良さ」「心の揺さぶり」、時代性・商品との自然な合致、尺に対する冗長さのなさ
- **フィルムクラフト部門**: 純粋な映像美、創造的で革新的な表現、撮影・照明・美術・編集・VFX・音楽の職人技
- **階層**: 総務大臣賞／ACCグランプリ ＞ ACCゴールド ＞ ACCシルバー ＞ ACCブロンズ ＞ ファイナリスト

---

## 2. 賞の格 × 15段階ランク対応表（クラフト部門優先・ショートリスト含む）

ショートリスト／ファイナリスト／オフィシャルセレクション／審査委員会推薦作品は、**同賞の受賞（Winner）の1ランク下**として配置する。

| ランク | 100点帯 | ティア区分 | 広告・CM（クラフト優先） | MV | モーション | 3DCG / アニメ | 企業映像・メタランキング |
|---|---|---|---|---|---|---|---|
| **`S+`** | 97–100 | **上位** | **Cannes Lions Film Craft GP** / **D&AD Black Pencil** / **The One Show Best of Discipline (Film Craft)** / **ADC Black Cube** / **AICP Show Best in Show** / **Ciclope Grand Prix** / **Spikes Asia Film Craft GP** | **UKMVA Video of the Year** / **D&AD Black Pencil (MV)** | **SXSW Title Design Grand Jury Winner** / **Motion Awards Grand Prize** | **Annecy Cristal（グランプリ）** / **Cannes Short Film Palme d'Or** / **Prix Ars Electronica Golden Nica** / **SIGGRAPH CAF Best in Show** | **WARC Creative 100 Top 10（クラフト評価併載作）** / **Cannes Corporate Grand Prix（White Dolphin）** |
| **`S`** | 93–96 | **上位** | **Cannes Film Craft Gold** / **D&AD Yellow Pencil** / **One Show Gold** / **ADC Gold** / **AICP Show Winner** / **Ciclope Gold** / **British Arrows Gold** / **Clio Gold (Film Craft)** / **LIA Gold (Production & Post)** / **ACC総務大臣賞・グランプリ** | **MTV VMA Video of the Year / Best Direction・Craft系複数冠** / **UKMVA Best Director / 主要部門Winner** / **SPACE SHOWER VIDEO OF THE YEAR** | **SXSW Title Design Winner** / **Motion Awards Winner** / **Vimeo Staff Pick of the Year** | **Annecy Jury Award / Best Direction** / **文化庁メディア芸術祭 大賞** / **SIGGRAPH CAF Jury's Choice** / **Prix Ars Electronica Award of Distinction** | **Cannes Corporate Gold Dolphin** / **WARC Creative 100 ランクイン（クラフト系）** |
| **`S-`** | 90–92 | **上位** | **Cannes Film Craft Silver** / **D&AD Graphite Pencil** / **One Show Silver** / **ADC Silver** / **Ciclope Silver** / **British Arrows Silver** / **Clio Silver** / **LIA Silver** / **Spikes Asia Film Craft Gold** / **ADFEST Film Craft Gold** / **ACCゴールド** / **TCCグランプリ** / **ギャラクシー賞CM部門 大賞** / **BOVAグランプリ** / **YouTube Works GP** | **UKMVA Craft部門Winner** / **D&AD Graphite / Wood Pencil (MV)** / **MTV VMAJ 最優秀ビデオ賞** / **SPACE SHOWER BEST VIDEO** / **Berlin MVA Best Video** | **Vimeo Staff Pick Best of the Month** / **Motionographer Feature / Award Winner** / **SXSW Title Design Finalist** | **Academy Awards（Oscar）短編アニメ Shortlist** / **Annecy Official Competition Selection** / **文化庁メディア芸術祭 優秀賞** / **SIGGRAPH CAF Electronic Theater 入選** / **Prix Ars Electronica Honorary Mention** | **映文連アワード 経済産業大臣賞** / **Cannes Corporate Silver Dolphin（最上位系）** |
| **`A+`** | 86–89 | **中位（上位寄）** | **Cannes Film Craft Bronze** / **D&AD Wood Pencil** / **One Show Bronze** / **ADC Bronze** / **Ciclope Bronze** / **British Arrows Bronze** / **Clio Bronze** / **LIA Bronze** / **Spikes Asia Film Craft Silver・Bronze** / **ADFEST Film Craft Silver** / **ACCシルバー** / **TCC賞** / **ギャラクシー賞CM部門 優秀賞** / **BOVAゴールド** | **MTV VMA / UKMVA Craft部門 Nominee（Shortlist）** / **MTV VMAJ 部門賞** / **Berlin MVA 部門Winner** / **Annecy Commissioned Films Selection（MV）** | **Vimeo Staff Pick（公式選出）** / **Stash Permanent Collection / 国際フェス公式タイトル（OFFF等）** / **Motion Awards Shortlist** | **Annecy Commissioned / Graduation Official Selection** / **文化庁メディア芸術祭 新人賞** | **Cannes Corporate Silver Dolphin** / **日本国際観光映像祭 グランプリ** / **TOYOTA DIRECTORSCUT 最優秀賞** |
| **`A`** | 82–85 | **中位** | **Cannes Film Craft Shortlist** / **D&AD Shortlist** / **One Show Merit** / **Ciclope Finalist（Shortlist）** / **Spikes Asia / ADFEST Film Craft Bronze・Finalist** / **ACCブロンズ** / **ギャラクシー賞CM部門 選奨** / **BOVAシルバー** / **YouTube Works 部門賞** | **SPACE SHOWER / VMAJ ノミネート** / **Berlin MVA Nominee（Shortlist）** / **文化庁メディア芸術祭 審査委員会推薦作品（MV）** | **Vimeo Staff Pick 候補級 / 映像作家100人上位（モーション系）** | **文化庁メディア芸術祭 審査委員会推薦作品（アニメ・エンタメ）** / **国際アニメ映画祭ショートリスト** | **ADFEST Fabulous Four Commendation** / **映文連アワード 部門優秀賞** / **日本国際観光映像祭 優秀賞** |
| **`A-`** | 78–81 | **中位（下位寄）** | **ACCファイナリスト** / **BOVA協賛企業賞・学生部門賞** / **地域・テーマ系アワード入賞** | **映像作家100人選出（MV）** / **国内インディーズMVアワード入選** | **映像作家100人選出（モーション）** / **国内モーション企画入選** | **映像作家100人選出（3DCG・アニメ）** / **学生CGコンテスト入選** | **ADFEST Fabulous Four Official Selection** / **日本国際観光映像祭 観客賞** / **Cannes Corporate Finalist** |
| **`B+`** | 73–77 | **下位（商用上位）** | 非受賞・高品質商用TVCM/Web CM（企画・撮影・編集の完成度が高くクライアント提案に使える水準） | 非受賞・高品質メジャー/インディーズMV | 非受賞・高品質モーションデモリール/自主制作 | 非受賞・高品質3DCG/アニメPV・ブレイクダウン | 非受賞・高品質企業PRムービー・採用OP |
| **`B`** | 68–72 | **下位（商用標準）** | 非受賞・標準商用TVCM/Web CM（堅実な実務クオリティ） | 非受賞・標準商用MV | 非受賞・標準モーショングラフィックス | 非受賞・標準3DCG/アニメPV | 非受賞・標準企業紹介・採用動画・サービス紹介 |
| **`B-`** | 63–67 | **下位（商用基礎）** | 非受賞・定型商用CM（情報伝達は成立するが画作り・演出が平凡） | 非受賞・定型/低予算MV | 非受賞・定型モーション/テンプレ寄り | 非受賞・簡易3DCG/アニメ告知動画 | 非受賞・定型企業OEM紹介・採用OP |
| **`C+`** | 57–62 | **下位（簡易上位）** | 非受賞・簡易Web CM・イベント告知（テンプレート依存・単調構成） | 非受賞・簡易撮影MV・単調カット割り | 非受賞・テンプレート型イベントイントロ/簡易リール | 非受賞・簡易3D/VR実験・アマチュア中位 | 非受賞・簡易社長メッセージ採用動画・固定インタビュー |
| **`C`** | 51–56 | **下位（簡易標準）** | 非受賞・タレント告知/簡易CM切り抜き・構成未整理 | 非受賞・低予算ワンロケアマチュアMV | 非受賞・簡易チュートリアル/基礎アニメ | 非受賞・簡易アニメクリップ/制作途中PV | 非受賞・密着社員Vlog風企業動画（簡易編集） |
| **`C-`** | 45–50 | **下位（簡易下位）** | 非受賞・レトロ簡易CMアーカイブ/低解像度 | 非受賞・静止画スライド寄りMV・アマチュア初級 | 非受賞・単一ループ基礎モーション | 非受賞・簡易ファンアニメ/ループ試作 | 非受賞・スライド読み上げ型採用ピッチ動画 |
| **`D+`〜`D-`** | 0–44 | **下位（基準外）** | 映像演出意図なし・ミーム・単発スマホ録画・明確な技術破綻 | 同左 | 同左 | 同左 | 同左 |

---

## 3. 企画・社会派・パーパス部門の別枠扱い（`purpose_reference_only`）

以下の部門は**アイデア・社会的インパクト・事業成果**を主評価軸としており、映像技術・演出クラフトの到達点とは必ずしも一致しない。

- **該当部門の例**:
  - Cannes Lions **Grand Prix for Good** / **Sustainable Development Goals (SDG) Lions** / **Glass: The Lion for Change** / **Titanium Lions** / **Direct Lions**
  - YouTube Works **Creative Effectiveness**（成果特化型で映像クラフト主体でないケース）
- **ベンチマーク上の運用ルール**:
  1. `craft_or_purpose: "purpose_reference_only"` を明示し、**クラフト基準（`craft_benchmark`）とは別枠で管理**する。
  2. AI採点のキャリブレーション（Spearman $\rho$ や MAE 計測）では、クラフト基準群とは**分離して集計**する（企画・社会的意義の参考アンカーとしてのみ保持）。
  3. 例：`D_vdPkCz23g`（Palau Pledge — Cannes Lions 2018 SDG Grand Prix / Titanium GP / Direct GP）は `purpose_reference_only` として収録。

---

## 4. ジャンル × ティア（上位・中位・下位）バランス設計

`analysis/golden_benchmark_50.json` は国内賞偏重を解消し、以下の5ジャンルすべてで **上位（`S+`〜`S-`）・中位（`A+`〜`A-`）・下位（`B+`〜`C-`の非受賞商用映像中心）** を揃える設計とする。

1. **CM**（TV CM / Web CM / ブランデッドフィルム）
2. **MV**（Music Video）
3. **モーション**（Motion Graphics / Title Design / Showreel）
4. **3DCG/アニメ**（3DCG / ストップモーション / 短編アニメ）
5. **企業映像**（企業VP / 採用動画 / 自治体・観光PR / コーポレートフィルム）

---

## 5. キャリブレーション手順（全件展開前の必須ゲート）

1. **ランク据え置き（`clamp_band`）を廃止**し、既存DBランク・受賞名を完全に伏せたブラインド採点（`scripts/blind_redact.py` v4 + 2+1アンサンブル方式）でベンチマークセットを採点する。
2. `craft_benchmark` + `non_award_baseline` を対象に、客観アンカーとの **Spearman順位相関係数（目標 $\rho \ge 0.85$）** および **平均絶対誤差（目標 MAE $\le 4.0$点）** をジャンル別・ティア別に計測する（`purpose_reference_only` は別枠で参照出力）。
3. 基準を満たしたプロンプト・ルーブリックのみ本番DBの再評価へ適用する。
