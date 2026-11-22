# 客観的プロ評価基準・国際ベンチマーク設計書（v9・Holdout 凍結版）

外部の厳格な国際・国内専門審査機関および公式アワード受賞・ショートリスト実績に基づき、AIの自己参照バイアスや現行ランク据え置き（`clamp_band`）を排した**客観的な映像評価基準**を定義する。

---

## 1. 厳格運用ルール（v9 改訂・凍結）

1. **出典URLの必須要件（個別ページ＋ブロック単位近接照合 v4）**:
   - DB内のAI分析本文に書かれた賞名はそのまま信用しない。
   - すべての受賞・選出記録に対し、**「その作品自体の受賞・選出・賞の格（Gold／Silver／Winner／グランプリ／入選／ショートリスト等）が明記されている個別ページ・公式受賞リスト等のURL（`sourceUrl`）」**を必須とする。
   - 賞のトップページURLのみの記載は不可とする。
   - 機械検証（`scripts/verify-benchmark-sources.mjs` v4）では、以下の5条件をすべて満たすことを必須とする：
     1. **ヘッダー・ナビ・フッター・サイドバーを除去した本文**のみを対象とする。
     2. **サイト名と同名の語**および**部門名のみの語（`Film Craft`, `Animation Division`, `Animated Short`, `Digital Marketing`, `Competition` 等）を禁止**し、**純粋な賞の格・選出語のみ**で照合する。
     3. **HTML表（`<table>`）は行（`<tr>`）単位、本文も意味的なまとまり（`<li>`, `<p>`, `<header class="bv-movie-header">`, 見出し＋直後ブロック等）単位**で独立判定する。
     4. 作品名キーワードと賞の格キーワードが**150文字以内に近接共起**すること。
     5. **作品名と賞の格のあいだに別作品・別等級の境界語**（`Title:`, `Advertiser:`, `Agency:`, `Client:`, 異なるメダル見出し等）が挟まる一致は**不合格**とする。
   - 確認できない候補は `unverified` として基準セットから除外する。
2. **映像・クラフト以外の部門、目的・伝達力総合賞、および観客賞の参考扱い**:
   - **非クラフト部門・目的伝達力総合賞（`non_craft_award_reference` / `purpose_reference_only`）**: 国際主要賞であっても映像演出・技術を主評価軸としない部門（`Digital Marketing`, `Direct`, `Media`, `PR`, `Creative Effectiveness`, `SDG`, `Grand Prix for Good`, `Titanium` 等）、および産業・企業広報・観光PR等の目的別コミュニケーションを総合評価する賞——すなわち **映文連アワード**（産業・文化短編映像祭のコーポレート・コミュニケーション部門等の賞であり、一次・二次審査員がプロデューサー・ディレクター・広告関係者等で構成される総合賞：`eibunren.or.jp/?p=7067`）および **日本国際観光映像祭（JWTFF）**（観光誘客・シティプロモーション・移住促進等の部門構成、応募必須項目「作品の目的／目標」、および観光・マーケティング・コミュニケーション等の専門家を含む審査員構成：`jwtff.world/regulation_2027_japan`）——は、クラフト基準群から外し**参考扱い（`objective_tier: null`）**とする。
   - **BOVA（宣伝会議 Brain Online Video Award）の扱い（主判定維持＋案C感度分析）**：BOVA は「課題発見・課題解決の“鋭さ”」「人の心に深く刺さる“鋭さ”」「今までの常識を突き破る“鋭さ”」を公式審査基準とし協賛企業賞は協賛企業が審査する広告企画コンテストであり（`awardg.sendenkaigi.com/bova/about`）、ルール 1.2 の理論的一貫性だけを見れば除外する案Cが上回る。ただし案Cでは確認用（Holdout）が 10本（A帯が `A=1, A-=1` のみ）へ減少し判定が不安定になるため、**Holdout 本数（13本）と A帯の確保のため主判定（案B）に残し、BOVA 除外（案C・Holdout 10本）を同一実行結果からの事前登録感度分析として必ず併記する**。
   - **観客賞（`audience_award_reference`）**: 新千歳空港国際アニメーション映画祭 観客賞、日本国際観光映像祭 観客賞などの一般観客投票による賞は、専門審査員による技術・演出評価ではないため、`craft_benchmark` から外し**参考扱い（`objective_tier: null`）**とする（専門審査員による受賞・選出が併載されている場合のみ審査員賞の格を採用する）。
3. **複数受賞の扱い（最高格採用ルール）**:
   - 1作品が複数の審査員クラフト賞を受賞している場合は、**最も高い格の賞（`max_tier`）**を採用して `objective_tier` を決定する。
4. **年代の扱い（過去10年優先ルール）**:
   - 現代の映像技術・演出水準と整合させるため、**過去10年以内（2016年〜2026年）**の受賞・選出作を `era_bucket: "modern_10y"` として優先採用する。
   - 10年以上前の歴史的傑作・アーカイブ作は `era_bucket: "classic_archive"` と明記し、較正時は現代作のみ・全体双方で集計可能とする。
5. **非受賞作品（`non_award_baseline`）の評価方法（循環比較の禁止）**:
   - 非受賞の商用映像には **`objective_tier: null` / `objective_band: null`** を設定し、**現行DBのAIランクを正解ラベルとしてコピーしない**。
   - **Spearman $\rho$ / Kendall's $\tau_b$ / MAE** は、外部審査員賞が確認された **`craft_benchmark` 作品のみ**で算出する。
   - **`non_award_baseline`** は、**順位の正解率（Pairwise Ranking Accuracy / ROC-AUC）**＝「（**`A-` 以上の審査員受賞・選出作**のAI点数 ＞ 非受賞商用作品のAI点数）となる組み合わせの割合」のみで評価する（`B+` 相当の小規模協賛企業賞等はプロ商用作品より上とは限らないため除外）。
6. **暫定評価・埋め込み制限の扱い**:
   - DB上で `analysisStatus = provisional` の作品は基準セットに含めない。
   - YouTube の `embedStatus = restricted` 作品は `yt-dlp` 実ダウンロード可否を実測し（証跡：`analysis/restricted_ytdlp_check.json`）、`embed_status` と `playable_via_ytdlp` を明記する。
7. **ジャンル定義の厳格化（モーションの現状扱い）**:
   - MVや短編アニメーションをモーションへ混入させず、**モーションは純粋なモーショングラフィックス／タイトルデザイン作品のみ**とする。
   - 現状、DB内で厳格出典検証を通過した純モーション／タイトルデザイン基準作は1本（`1032202784`：Node Fest 2024 Opening Titles — The Motion Awards 2025 Category Winner、`A+`）のみであるため、**モーション単体のジャンル別較正は対象外（全体集計のみ算入）**として運用する。
8. **収録映像＝受賞対象作品本編ルール（v8 新設・全83本統一適用）**:
   - クラフト基準群（`craft_benchmark`）に算入するには、**DBに収録されている映像そのものが受賞・選出の対象となった本編作品であること**を必須とする。
   - 長編映画・短編映画の本編受賞に対する**予告編（Trailer）・映画祭紹介映像・受賞告知映像・ダイジェスト映像**は、評価対象映像と受賞対象作品が一致しないため、クラフト基準群から外し**参考枠（`trailer_or_intro_reference`, `objective_tier: null`）**へ移す（例：`vohpCZh-Qcw` 42秒Trailer、`jvKtHf7kDYs` 映画祭紹介映像）。

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

### 2.4 Cannes Corporate Media & TV Awards（公式部門構成とルール1.2対応）
公式部門一覧（`https://www.cannescorporate.com/en/categories.php`）は、**「何を伝えるか（Thematic Categories：目的・テーマ別部門）」** と **「映像をどう作ったか（Production Arts & Craft：映像クラフト専門審査員部門・Black Dolphin）」** を明確に分離している。ルール1.2（映文連アワード・JWTFF と同一基準）を適用し、以下の対応表のとおり区分する。

| 区分（公式ページ記載） | 該当部門・賞 | ルール1.2上の扱い | 根拠（公式URL） |
|---|---|---|---|
| **クラフト部門（Tier 2 対象）**<br>Production Arts & Craft（Black Dolphin・Production Arts & Craft 専門審査員団） | **51. Best Directing** / **52. Best Cinematography** / **53. Best Editing** / **55. Best Sound Design** / **56. Best Animation, Graphics and Visual Effects** / **57. Best Production Design** / **61. Best Use of Drones** / **63. Best Original Music/Score**（※過去年の `D.42`〜`D.57` 等の Category D クラフト賞を含む） | **`Tier 2` 対象（`A+`）** | `https://www.cannescorporate.com/en/categories.php`<br>（`Judged by the Production Arts & Craft jury; winners receive the Black Dolphin.`） |
| **感性・訴求寄り（参考枠）**<br>Production Arts & Craft 内の一部部門 | 54. Best Storytelling / 58. Best Cast / 59. Best Emotional Appeal / 60. Best Use of Humor / 62. Best Use of AI | **参考枠（`purpose_reference_only`, `null`）** | 物語訴求・感情喚起・出演者魅力など映像技術クラフト以外の要素が主軸のため除外 |
| **目的・テーマ別部門および総合賞（参考枠）**<br>Thematic Categories（A / B / C 部門・Gold / Silver Dolphin・Grand Prix） | A. Corporate Films and Videos（`A.1 Corporate Image`, `A.2 Marketing B2B/B2C`, `A.7 CSR`, `A.8 Environment/SDGs`, `A.15.c Tourism Films` 等）／B. Corporate Online Media（`B.23 Branded Content Videos` 等）／C. Documentaries and Reports／`Grand Prix（White Dolphin）` | **参考枠（`purpose_reference_only`, `null`）** | `https://www.cannescorporate.com/en/categories.php`<br>（目的・テーマ別の伝達力評価であり映文連・JWTFFと同性質。ただし同一作品が別途 Category D の Black Dolphin を受賞している場合は、その Category D 受賞のみを根拠として採用可） |

---

## 3. 賞の格 × 15段階ランク対応表（クラフト審査員賞優先・ショートリスト含む）

ショートリスト／ファイナリスト／オフィシャルセレクション／審査委員会推薦作品／入選は、**同賞の受賞（Winner）の1ランク下**として配置する。

> **格付け補足（v9改訂・Holdout 凍結版）**:
> - **映文連アワードおよび日本国際観光映像祭（JWTFF）→ 参考枠（`purpose_reference_only`, `null`）**：映文連アワードは「わが国唯一の産業・文化短編映像祭」（`eibunren.or.jp/award2026/index.html`）としてコーポレート・コミュニケーション／ソーシャル・コミュニケーション／パーソナル・コミュニケーションの目的別3部門を設け（`award2026/about/index.html`）、プロデューサー・ディレクター・広告関係者・映画監督・映像評論家等で審査する賞であり（`?p=7067`）、JWTFF も観光誘客・シティプロモーション・移住促進等の部門構成・必須記入項目「作品の目的／目標」・観光やマーケティング専門家を含む審査員構成を持つ観光PR総合賞である（`jwtff.world/regulation_2027_japan`）。よって国際目的系賞（Cannes SDG/Direct/Titanium・YouTube Works Creative Effectiveness等）と同一基準で双方とも**参考枠（`null`）**へ統一移動した。
> - **BOVA（宣伝会議）の主判定維持と感度分析併記**：公式審査基準（`awardg.sendenkaigi.com/bova/about`）は課題発見・課題解決の“鋭さ”等を問う広告企画コンテストでありルール一貫性では除外（案C）が上回るが、Holdout の母数（13本）と A帯確保のため主判定（案B）に残し、BOVA 除外（案C・Holdout 10本）を事前登録感度分析として必ず併記する。
> - **The Motion Awards（Motionographer主催）の規模・審査体制に基づく格下げ**：約15分野・約40部門と細分化されており、プロ審査員による多段階審査に加えて一般コミュニティ投票（The Pulse）も併用される専門領域アワードであるため、数万点規模の厳格審査員賞である Cannes Lions Film Craft Gold / D&AD Yellow Pencil（`S`）と同格は過大と判断し、**Grand Prize → `S-`、Category Winner → `A+`、Nominee/Shortlist → `A-`** へ引き下げた（Node Fest 2024 は D&AD アーカイブ掲載があるものの Pencil 受賞の一次確認が取れていないため、Motion Awards Category Winner として `A+` に配置）。
> - **Emmy Awards — Outstanding Main Title Design（米国テレビ芸術科学アカデミー）の格付け（Phase 2 追記）**：同アカデミーの Title Design 専門部会（Peer Group）による審査員クラフト賞であり、年間1作のみの **Winner → `S`**（SXSW Title Design Winner / D&AD Yellow Pencil と同格）、年間わずか5〜6作のみの **Nominee → `A+`**（The Motion Awards Category Winner / D&AD Wood Pencil / Art of the Title 掲載作と同格、`A-` 以上で Tier 2 対象）として配置する。一般ルール（候補選出＝受賞の1段下）より1段厳しめに `A+`（Winner `S` から2段下）へ置いたのは、テレビ番組タイトル単独の候補選出は総合クラフト国際賞の銀賞帯（`S-`）より対象領域が狭く、併載される `Art of the Title`（`A+`）および The Motion Awards 部門賞（`A+`）の格と揃えるためである。
> - **Cannes Corporate Media & TV Awards の目的系部門除外（Phase 2 改訂・ルール1.2整合）**：公式部門一覧（`cannescorporate.com/en/categories.php`）に基づき、目的・テーマ別部門（A: Corporate Films［CSR・観光・企業イメージ等］／B: Online Media［Branded Content等］／C: Documentaries、および総合賞 Grand Prix）は映文連アワード・JWTFF と同じく**参考枠（`purpose_reference_only`, `null`）**へ移動し、**Production Arts & Craft 専門審査員による映像クラフト中核部門（Black Dolphin：`Best Directing / Cinematography / Editing / Sound Design / Animation & VFX / Production Design / Drones / Original Music`）のみ**を `A+`（Tier 2 対象）として扱う。
> - **SXSW Film Festival — Special Jury Recognition（MV / Animation）→ `S-`**：国際主要映画祭の専門審査員による特別賞であり、部門グランプリ（Grand Jury Winner=`S`）の1ランク下・国際銀賞／Oscarショートリスト／Annecyコンペ選出／ベルリン国際映画祭短編銀熊賞（審査員賞）と同格に配置する。
> - **新千歳空港国際アニメーション映画祭**：国際コンペ審査員グランプリ／部門審査員賞は審査員賞として評価対象（`A+`〜`A`）とするが、**観客賞（Audience Award）**は一般観客投票のため `audience_award_reference`（参考扱い、`objective_tier: null`）とする。

| ランク | 100点帯 | ティア区分 | 広告・CM（クラフト優先） | MV | モーション（純モーション／タイトル） | 3DCG / アニメ | 企業映像・メタランキング |
|---|---|---|---|---|---|---|---|
| **`S+`** | 97–100 | **上位** | **Cannes Film Craft GP** / **D&AD Black Pencil (Film Craft)** / **One Show Best of Discipline (Craft)** / **ADC Black Cube** / **AICP Best in Show** / **Ciclope GP** / **Spikes Asia Film Craft GP** | **UKMVA Video of the Year** / **D&AD Black Pencil (MV)** | **SXSW Title Design Grand Jury** / **D&AD Black Pencil (Motion/Title)** | **Annecy Cristal（GP）** / **Cannes Short Film Palme d'Or** / **Prix Ars Electronica Golden Nica** / **SIGGRAPH CAF Best in Show** | **Cannes Film Craft / D&AD Craft 最高賞のブランド・企業フィルム** / **WARC Creative 100 Top 10（クラフト併載）** |
| **`S`** | 93–96 | **上位** | **Cannes Film Craft Gold** / **D&AD Yellow Pencil (Craft)** / **One Show Gold (Craft)** / **ADC Gold** / **AICP Winner** / **Ciclope Gold** / **British Arrows Gold** / **Clio Gold (Craft)** / **LIA Gold (Production)** / **ACC総務大臣賞・GP** | **MTV VMA Video of the Year＋クラフト複数冠** / **UKMVA Best Director・主要部門Winner** / **SXSW MV Grand Jury Winner** / **SPACE SHOWER VIDEO OF THE YEAR** | **Emmy Outstanding Main Title Design Winner** / **SXSW Title Design Winner** / **D&AD Yellow Pencil (Motion/Title)** / **Vimeo Staff Pick of the Year** | **Annecy Jury Award / Best Direction** / **文化庁メディア芸術祭 大賞** / **SIGGRAPH CAF Jury's Choice** / **Prix Ars Electronica Award of Distinction** | **Cannes Film Craft Gold / D&AD Yellow Pencil の企業・ブランドフィルム** / **WARC Creative 100（クラフト系）** |
| **`S-`** | 90–92 | **上位** | **Cannes Film Craft Silver** / **D&AD Graphite Pencil (Craft)** / **One Show Silver** / **ADC Silver** / **Ciclope Silver** / **British Arrows Silver** / **Clio Silver** / **LIA Silver** / **Spikes Asia / ADFEST Film Craft Gold** / **ACCゴールド** / **TCCグランプリ** / **ギャラクシー賞CM大賞** | **UKMVA クラフト・部門Winner** / **SXSW Special Jury Recognition (MV/Animation)** / **D&AD Graphite・Wood Pencil (MV)** / **MTV VMAJ 最優秀ビデオ賞** / **SPACE SHOWER BEST VIDEO** / **Berlin MVA Best Video** | **SXSW Title Design Finalist** / **The Motion Awards Grand Prize** / **D&AD Graphite Pencil (Motion/Title)** | **Academy Awards（Oscar）短編アニメ Shortlist** / **ベルリン国際映画祭 短編銀熊賞（審査員賞）** / **Annecy Official Competition Selection** / **SXSW Special Jury Recognition (Animation)** / **文化庁メディア芸術祭 優秀賞** / **SIGGRAPH CAF Electronic Theater 入選** / **Prix Ars Electronica Honorary Mention** | **Cannes Film Craft Silver / D&AD Graphite Pencil の企業・ブランドフィルム** / **NY Festivals Craft Gold（企業映像）** |
| **`A+`** | 86–89 | **中位（上位寄）** | **Cannes Film Craft Bronze** / **D&AD Wood Pencil (Craft)** / **One Show Bronze** / **ADC Bronze** / **Ciclope Bronze** / **British Arrows Bronze** / **Clio Bronze** / **LIA Bronze** / **Spikes Asia / ADFEST Film Craft Silver** / **ACCシルバー** / **TCC賞** / **ギャラクシー賞CM優秀賞** / **BOVAグランプリ（※案C感度分析対象）** | **文化庁メディア芸術祭 新人賞（MV）** / **MTV VMA・UKMVA Nominee** / **MTV VMAJ 部門賞** / **Berlin MVA 部門Winner** / **Annecy Commissioned Selection（MV）** | **Emmy Outstanding Main Title Design Nominee** / **The Motion Awards Category Winner** / **D&AD Wood Pencil (Motion/Title)** / **Vimeo Staff Pick Best of the Month** / **Art of the Title 掲載作** | **Annecy Commissioned / Graduation Selection** / **文化庁メディア芸術祭 新人賞** / **国際映画祭部門作品賞（東京国際映画祭・新千歳グランプリ等※本編のみ）** | **Cannes Corporate Production Arts & Craft（Black Dolphin：Directing / Cinematography / Editing / Sound / Animation・VFX / Production Design 等）** / **TOYOTA DIRECTORSCUT 最優秀賞** |
| **`A`** | 82–85 | **中位** | **Cannes Film Craft Shortlist** / **D&AD Shortlist (Craft)** / **One Show Merit** / **Ciclope Finalist（Shortlist）** / **Spikes Asia / ADFEST Film Craft Bronze・Finalist** / **ACCブロンズ** / **ギャラクシー賞CM選奨** / **BOVAゴールド（※案C感度分析対象）** | **SPACE SHOWER / VMAJ ノミネート** / **Berlin MVA Nominee** / **文化庁メディア芸術祭 審査委員会推薦作品（MV）** | **D&AD Shortlist (Motion/Title)** / **国内主要モーション審査員賞** | **文化庁メディア芸術祭 審査委員会推薦作品（アニメ）** / **国際アニメ映画祭 審査員部門賞・ショートリスト（新千歳審査員賞等）** | **ADFEST Fabulous Four Commendation** |
| **`A-`** | 78–81 | **中位（下位寄）** | **ACCファイナリスト** / **BOVAシルバー（※案C感度分析対象）** | 国内インディーズMV審査員入選 | **The Motion Awards Nominee / Shortlist** / **Vimeo Staff Pick（通常選出・出典確認済）** | **国際アニメ映画祭 公式入選** / **学生CGコンテスト入選** | **ADFEST Fabulous Four Official Selection** / **Cannes Corporate Production Arts & Craft Shortlist** |
| **`B+`** | 73–77 | **中位下限** | **BOVA協賛企業賞・学生部門賞（※案C感度分析対象）** | 国内インディーズ小規模賞入選 | 国内小規模企画入選 | 小規模コンテスト入選 | 地域・企業小規模コンテスト入選 |
| **参考枠（`null`）** | — | **較正対象外** | 非クラフト部門（Digital Marketing / Creative Effectiveness等）、**予告編・受賞告知映像** | **観客賞（新千歳観客賞等）**、予告編・告知映像 | 非審査キュレーション | **観客賞**、**予告編（Trailer）・映画祭紹介映像** | 社会派・パーパス・目的伝達力総合賞（Cannes SDG/Direct/Titanium、**Cannes Corporate 目的・テーマ別部門 A/B/C および総合賞 Grand Prix**、**映文連アワード**、**日本国際観光映像祭 JWTFF**）、**観客賞** |
| **非受賞（`null`）** | — | **下位（ベースライン）** | 非受賞の通常商用TVCM / Web CM（※Pairwise順位正解率のみで評価） | 非受賞の通常商用MV | 非受賞の通常モーション・リール | 非受賞の通常3DCG・短編アニメ・アニメPV | 非受賞の通常企業VP・採用動画・自治体PR |

---

## 4. キャリブレーション手順・統計的評価指標（v9）

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
     - **Pairwise 順位正解率（ROC-AUC ＋ ブートストラップ95%信頼区間）**: **`A-` 以上の審査員受賞・選出作**の点数が非受賞商用作品の点数を上回る組み合わせ割合（目標 $\ge 0.85$）を算出し、ブートストラップ法（$B=2,000$回）による **95%信頼区間** を併記する。`B+` の受賞作（協賛企業賞等）はプロ商用作品より上とは限らないため比較から除外する。
   - **ジャンル別集計と小標本の扱い**:
     - 5ジャンル（CM / MV / モーション / 3DCG/アニメ / 企業映像）のうち、**評価対象本数が少ないジャンル（合計10本未満、または `craft_benchmark` / `non_award_baseline` のいずれかが5本未満のジャンル）は統計的検出力が不十分なため参考値扱い（モーションは基準作1本のみのためジャンル別較正対象外）**とし、合否判定は全体指標を主基準とする。
   - **参考出力**: `non_craft_award_reference` / `purpose_reference_only` / `audience_award_reference` は別枠でスコアと乖離のみ参考表示する。
