# サイト検索（Twelve Labs 風カット・シーン検索）および `videoScenes` / `craftRecipes` 連携 設計書

- **作成日**: 2026-11-25（`CHIBA-PC`）
- **最終改訂**: 2026-11-25（TiDB 東京リージョン公式制約の訂正・代替検索方式比較、D-024 単一語彙・9 値 `narrative_role`、`PURPOSE_OPTIONS` 13 語 vs TiDB 10 語整理、`keywords`/`search_phrases` 分離、段階 1 変更範囲・`videoScenes` 定義、段階 3 鍵設計を反映）
- **ステータス**: **設計案（未実装・TiDB DDL/書込未実行・承認待ち）**
- **ブランチ**: `docs/site-cut-search-design`（`main` へは未マージ・未 push）
- **関連文書**: `docs/CRAFT_RECIPE_DISTRIBUTION_DESIGN.md`（`9c8fb60`）、`docs/API_CRAFT_RECIPE_DESIGN.md`（`c81a1b5`）、`docs/DECISIONS.md`（D-022〜D-024 予定）
- **語彙・項目名に関する前提**: すべての語彙定義は `chibatmute` が **D-024** で `iketeru-eizou/shared/` 配下に設置する予定の**単一の語彙ファイル**を正本として読み込む前提とする（フロント・サーバー・同期スクリプト・レシピ生成のすべてが同一ファイルを参照）。`expressive_purpose` 配下の項目名（`intent_summary` / `viewer_effect` / `narrative_role` / `best_for` / `avoid_when` / `keywords` / `search_phrases` / `evidence`）は `chibatmute` の確定仕様に合わせて最終統一する。

---

## 1. 現行サイト検索の現状（コード・DB 実測）

### 1-1. 全体構成（すべてクライアント側処理・サーバー検索なし）
- **サーバー側（TiDB / tRPC）**:
  - `server/routers.ts`（L270–284）の `videos.list` が `server/db.ts`（L133–160）の `getAllVideoListItems()` を呼び、TiDB `videos` テーブル全 **5,653 本**の一覧メタデータ（`aiAnalysis` 本文・スコア内訳・分類監査は SQL レベルで除外）を一括返却するのみ。
  - 検索クエリを受けるサーバー側 API・TiDB 全文検索・TiDB ベクトル検索は現在存在しない。
- **現在のサイト公開・認証状態（コード実測）**:
  - `client/src/App.tsx`（L11–18）・`server/routers.ts`（L204–284）・`server/_core/vercelHandler.ts`（L41–43）: **サイト閲覧および全読み取り API（`videos.list`, `videos.get`, `videos.count` 等）はログイン不要の完全公開（`publicProcedure` + `Cache-Control: public`）**。
  - 書き込み操作（`create`, `update`, `delete`, お気に入り変更等）のみ `server/_core/trpc.ts`（L44–67）の **`writeProtectedProcedure`**（`admin` または `@atsu-maru.co.jp` ログイン、あるいは `ADMIN_API_KEY` 必須）で保護されている。
- **現在の TiDB 環境（読み取り専用実測）**:
  - リージョン: `ap-northeast-1.prod.aws.tidbcloud.com`（東京）
  - バージョン: `8.0.11-TiDB-v8.5.3-serverless`
  - 既存テーブル（9 個）: `videos`, `users`, `favoriteProfiles`, `profileVideoFavorites`, `profileCreatorFavorites`, `dailyCollectionSources`, `dailyCollectionRuns`, `aiMetadataCompletionJobs`, `aiMetadataCompletionRuns`（`videoScenes` / `craftRecipes` は未作成）

### 1-2. 現行の 2 つの検索モードと該当コード

| 検索モード | 該当ファイル・コード箇所 | 検索対象 | 検索方式 | 出力単位・UI |
|---|---|---|---|---|
| **動画一覧モード（標準検索）** | `client/src/hooks/useVideos.ts`（`parseSearchQuery` L224–249, `getVideoSearchText` L251–274, `applyVideoFilters` L276–361）<br>`client/src/pages/Home.tsx`（L343–351） | タイトル、`channelTitle`、`allTags`、`purposes`、`expressions`、`toneEmotions`、`toneVisuals`、`toneTechniques`、`productions`、`productionCredits`（役割）、各評価、`curationNote` 4 項目（`aiAnalysis`・シーン・レシピは対象外） | ブラウザ内の結合文字列に対する `String.prototype.includes()` **AND 部分一致**（`-語` / `-source:` 除外可、関連度順なし） | **動画単位**（`VideoCard.tsx`） |
| **シーン・秒数検索モード（Twelve Labs 風プロトタイプ）** | `client/src/lib/sceneSearch.ts`（`loadSceneIndex` L328–374, `SYNONYM_MAP` L377–412, `searchScenes` L446–536, `getSceneKeywordCategories` L617–664）<br>`client/src/lib/scenes_index.json`（＋`client/public/scenes_index.json`、3.32 MB）<br>`client/src/components/SceneCard.tsx`（L23–305）<br>`client/src/pages/Home.tsx`（L135–176, L213–262, L511–820） | 静的 JSON **`scenes_index.json`（5,288 シーン / 342 本のみ）** の `visual`, `keywords`, `audio`, `videoTitle` | ブラウザ内で空白分割 → 手動 35 語の `SYNONYM_MAP` 展開 → `includes()` **AND 部分一致**＋固定重み加算（`visual:15 / keywords:10 / audio:8 / title:5`） | **シーン単位**（`SceneCard.tsx`：時間帯バッジ、タイムラインバー、YouTube iframe ホバー区間再生、説明文、`#キーワード` 4 個、クリックで該当秒から `VideoModal` 再生） |

### 1-3. 現行「シーン・秒数検索」の 4 つの課題
1. **342 本（全体の約 6%）しか検索対象になっていない**: `loadSceneIndex`（`sceneSearch.ts` L362）は新規動画の `v.aiAnalysis` から動的抽出する処理を持つが、`videos.list` が SQL で `aiAnalysis` を除外しているため機能せず、SQLite 上の **4,555 本 / 35,768 シーン** の大半が検索に出ない。
2. **自然文クエリに弱い**: 空白区切り AND 部分一致のため、自然な日本語文を入れると 1 塊扱いになり 0 件になりやすい。
3. **既存フィルタと分断**: シーンモードでは左サイドバーが非表示（`Home.tsx` L355 `viewMode === "videos"`）で、用途・表現・トンマナ・校正点数による絞り込みができない。
4. **クラフトレシピ・`expressive_purpose` 未連携**: カットごとの制作意図や技法・プラグイン情報と結びついていない。

---

## 2. カット単位の検索結果カード設計（Twelve Labs 風）

既存の `SceneCard.tsx` を土台に、`expressive_purpose` とレシピ情報を表示する **カット単位カード（`CutResultCard` 仮称）** を設計する。

### 2-1. カード表示項目と段階別メディア方針

```text
+-------------------------------------------------------+
| [01:12 - 01:16]              [レシピ v2] [94% Match]   |
|                                                       |
|          YouTube サムネイル（段階 1 は現行踏襲）         |
|          ホバー時: YouTube iframe 該当区間ミュート再生   |
|          （※カット固有静止画・GIF配信は後の段階・要検討） |
|                                                       |
| ======[====]========================================= |  <- 動画全体尺上の位置バー
+-------------------------------------------------------+
| 動画名: TVアニメ『呪術廻戦』第3期 OP ...     [S 94.5]  |
| 狙い : 4人の新キャラを0.5秒刻みの矩形コラージュで      |  <- expressive_purpose.intent_summary (1文)
|        連続提示し、情報密度と高揚感を一気に引き上げる   |
| 役割 : [転換]  効果: [高揚感] [疾走感]                 |  <- narrative_role (9値) / viewer_effect
| 語句 : [#矩形コラージュ] [#高速切替] [#枠線構成] [+2]   |  <- keywords（短い語 5〜10個から上位表示）
| ツール: After Effects (Motion 4, Flow)                |  <- craftRecipes 由来時のみ表示
+-------------------------------------------------------+
```

| 要素 | 表示元（`craftRecipes` 由来） | フォールバック（`videoScenes` のみ） | 扱い・UI 動作 |
|---|---|---|---|
| **サムネイル・プレビュー** | **段階 1〜2 は現行 YouTube 区間再生（`SceneCard.tsx` の iframe ミュート区間プレビュー＋`hqdefault.jpg` / `hq1..3` フォールバック）をそのまま維持** | 同左 | **カット固有の静止画（`mid_png`）・GIF の Web 配信は「後の段階・要検討」**とする（オブジェクトストレージ／CDN 費用、および他社・第三者映像から切り出した静止画・GIF を Web 公開・配信して権利上問題ないかの確認が必要なため）。 |
| **カット時間帯** | `startMmss - endMmss`（`startSec`, `endSec`）＋タイムライン位置バー | `videoScenes.startMmss - endMmss` | クリックで `VideoModal` を `startSec` から直接再生 |
| **動画名・スコア** | `videos.title` ＋ `calibratedRank` / `calibratedScore` | 同左 | クリックで `VideoModal` を開き該当カット位置へ移動 |
| **狙いの 1 文** | `expressive_purpose.intent_summary`（1〜2 行目安） | `videoScenes.shotTitle` ＋ `description` の冒頭要約 | 詳細展開時に `evidence` / `avoid_when` を確認可 |
| **キーワードチップ** | **`expressive_purpose.keywords`（短い語・5〜10 個）のみを表示**（カード上は上位 4〜6 個＋展開可） | `videoScenes.keywordsJson`（短い語のみ） | 一致語をハイライト。クリックで検索条件へ追加絞り込み。**`expressive_purpose.search_phrases`（長い言い換え文）は UI チップには出さず、検索インデックス（キーワード／ベクトル）にのみ使用する** |

---

## 3. 絞り込み語彙の統一設計（D-024 単一語彙ファイル前提）

すべての絞り込み語彙は、`chibatmute` が **D-024** で **`iketeru-eizou/shared/` に新設する単一の語彙ファイル**（例：`shared/craftVocabulary.ts` 仮称）から読み込む前提とする（フロント UI・tRPC バリデータ・同期スクリプト・レシピ生成プロンプトが同じ正本を参照し、表記ゆれを防ぐ）。

### 3-1. `narrative_role` / `viewer_effect` / `best_for` のマッピング

| `expressive_purpose` 項目 | 絞り込み上の位置づけ | 語彙定義（D-024 単一語彙ファイル参照） |
|---|---|---|
| **`narrative_role`**（構成上の役割） | カット検索専用の固定 9 値ピル | **`chibatmute` の 9 値に完全準拠**：<br>`掴み` / `世界観提示` / `転換` / `情報提示` / `盛り上げ` / `感情強調` / `緩急の抜き` / `ブランド回収` / `締め` |
| **`viewer_effect`**（視聴者への効果） | 既存「感情トンマナ（`toneEmotions` / `TONE_OPTIONS`）」と語彙を揃える | D-024 単一語彙ファイルで既存 `TONE_OPTIONS` および頻出 `toneEmotions`（`疾走感`, `高揚感`, `緊張感`, `爽快`, `洗練`, `不穏`, `静謐`, `多幸感` 等）と共通語彙化。サイドバーの感情・効果フィルタで動画検索とカット検索を横断可能にする |
| **`best_for`**（向いている案件・用途） | 既存「用途（`purposes`）」フィルタと完全統一 | 下節 §3-2 の方針で正準化した用途語彙を D-024 単一語彙ファイルから参照 |
| **`avoid_when`**（避ける条件） | 自由文の注意ラベル（詳細展開・AI 提案ガード用） | 固定チップにはせず、カード詳細・モーダルに「向かない場面」として表示 |
| **`keywords`** vs **`search_phrases`** | 役割を明確分離 | **`keywords`（短い語・5〜10 個）**：カード上のキーワードチップ表示＋クリック絞り込み＋キーワード検索対象。<br>**`search_phrases`（長い言い換え文）**：UI 非表示、検索用テキストおよび埋め込みベクトル生成にのみ使用 |

### 3-2. `PURPOSE_OPTIONS`（13 語）と TiDB 実測（10 語）のずれ整理と統一案

`shared/metadataOptions.ts`（L79–82）と TiDB `videos.purposes` の実測値を照合したところ、以下の **3 語のずれ** が確認された：

- **`PURPOSE_OPTIONS`（13 語）**: `MV`, `ブランディングムービー`, `プロモーション`, `事業・サービス紹介`, `OPED`, `インタビュー`, `ティザー`, `アート`, `企画系`, **`採用・リクルーティング`**, **`ハウツー・解説`**, **`イベント・空間演出`**, `その他`
- **TiDB `videos.purposes` 実測（10 語）**: `プロモーション(2638)`, `MV(2354)`, `アート(1591)`, `ブランディングムービー(1524)`, `企画系(506)`, `ティザー(490)`, `OPED(486)`, `事業・サービス紹介(445)`, `その他(208)`, `インタビュー(187)`
- **TiDB 上で現在 0 件の 3 語**: `採用・リクルーティング`、`ハウツー・解説`、`イベント・空間演出`（これら 3 軸は現状 `products`/`genres` 側に分類されており、`purposes` 列にまだ値が入っていない状態）。

**揃え方の比較と推奨案**:
- **案 1（推奨）：`PURPOSE_OPTIONS` の 13 語をそのまま D-024 単一語彙ファイルの正準リストとする**。
  - 理由：`採用・リクルーティング`・`ハウツー・解説`・`イベント・空間演出` は制作案件の用途として実務頻度が高く、レシピの `best_for` でも非常に有用。既存コード（`restrictToAllowedOptions`・テスト）を壊さず、UI のサイドバー上は現在 0 件の 3 語を「件数 0（`count === 0`）は折りたたみ／グレー表示」にすれば利用者の混乱も起きない。
- **案 2：TiDB 実測の 10 語へ縮退する**。
  - 理由：現在の動画 DB 実態には一致するが、今後の採用動画・展示映像・解説動画の `best_for` 表現力が落ち、`metadataOptions.ts` からの削除と回帰テスト修正も必要になる。

---

## 4. TiDB 東京リージョンの公式仕様確認と検索方式の比較

### 4-1. 一次資料による TiDB Cloud リージョン制約の確認（前回報告の訂正）

PingCAP 公式ドキュメントリポジトリ（`pingcap/docs` `master`）の一次資料を確認した結果、以下が判明した：

1. **TiDB ネイティブ全文検索（Full-Text Search / `WITH PARSER MULTILINGUAL`）**:
   - 公式 URL: `https://docs.pingcap.com/tidbcloud/vector-search-full-text-search-sql/`（`ai/guides/vector-search-full-text-search-sql.md` L29–31）および `https://docs.pingcap.com/tidbcloud/vector-search-hybrid-search/`（`ai/guides/vector-search-hybrid-search.md` L22–24）
   - 原文引用：
     > "Currently, full-text search is only available on Starter and Essential in the following regions:
     > - TiDB Cloud Serverless: `Frankfurt (eu-central-1)` and `Singapore (ap-southeast-1)`"
   - **結論**: **本番 TiDB の東京リージョン（`ap-northeast-1`）では、公式仕様上 TiDB ネイティブ全文検索は利用不可**（前回の「東京で使える」という記載は検索要約の誤認であり、ここで訂正する）。
   - **本番 TiDB に一切触れずに最新対応状況を確かめる方法（案）**:
     - 本番クラスタ上で `CREATE TABLE` / `ALTER TABLE` 等の DDL テストは絶対に行わない。
     - 確認したい場合は、TiDB Cloud コンソール（`tidbcloud.com`）上で **本番とは完全に別の検証用無料 Starter クラスタを `ap-northeast-1` に一時作成**し、そこで `CREATE TABLE fts_probe (id INT, body TEXT, FULLTEXT INDEX (body) WITH PARSER MULTILINGUAL);` の成否を確認した後に削除する（または PingCAP サポートへ `ap-northeast-1` の FTS 開放予定を問い合わせる）。
2. **TiDB ベクトル検索（Vector Search / `VECTOR(dim)` + HNSW）**:
   - 公式 URL: `https://docs.pingcap.com/tidbcloud/vector-search-overview/`（`ai/concepts/vector-search-overview.md` L14）および `https://docs.pingcap.com/tidbcloud/vector-search-limitations/`（L14）
   - 原文引用：
     > "The vector search feature is available on TiDB Self-Managed, Starter, Essential, and TiDB Cloud Dedicated. For TiDB Self-Managed and TiDB Cloud Dedicated, the TiDB version must be v8.4.0 or later (v8.5.0 or later is recommended)."
   - **結論**: **TiDB ベクトル検索にはリージョン制限がなく、東京リージョン（`ap-northeast-1`）の `v8.5.3-serverless` で利用可能**（本番への DDL 実行は承認後）。

### 4-2. 東京リージョン（`ap-northeast-1`）で使える検索方式の比較

TiDB ネイティブ全文検索が東京で使えない前提で、東京クラスタのまま実現できる **4 つの方式** を比較する（現行 `videoScenes` 35,768 件 ＋ 将来 `craftRecipes` 9,000 カット＝計 約 4.5 万行規模を想定）。

| 評価軸 | 案 1：TiDB 標準 B-Tree キーワード転置表＋`LIKE`（自前軽量索引） | 案 2：自前 2-gram（n-gram）転置表を TiDB に持つ | 案 3：ベクトル検索先行（TiDB HNSW のみ） | **案 4（おすすめ）：段階導入ハイブリッド**<br>段階 1＝案 1（標準 SQL＋軽量キーワード索引）<br>→ 段階 3＝TiDB ベクトル検索（HNSW）追加＋RRF 統合 |
|---|---|---|---|---|
| **東京 TiDB でそのまま動くか** | **◎ 確実**（標準 SQL / B-Tree のみ） | **◎ 確実**（標準 SQL / B-Tree のみ） | **◎ 確実**（HNSW は東京対応） | **◎ 確実**（追加 DB・リージョン移転不要） |
| **費用** | **\$0**（TiDB 無料枠内、キーワード表 約 25 MB） | **\$0**（ただし 2-gram 表は 約 250〜300 万行・150〜250 MB 消費、再同期 RU が重い） | 初回埋め込み `\$0.72〜\$1.43`、検索 1 万回 `\$0.06`、TiFlash 約 137 MB（無料枠 5 GiB の 2.7%） | 段階 1 は **\$0**。段階 3 追加時のみ初回 `\$0.72〜\$1.43`＋検索 1 万回 `\$0.06` |
| **実装・運用の手間** | **低**：同期時に抽出済み短い語（`keywords`・タグ・プラグイン名）を補助表へ入れ、スペース区切り語は `LIKE`＋同義語展開＋タグ絞込 | **中〜高**：自前 2-gram 分割・ストップワード調整・巨大転置表の差分更新・自前スコア計算の保守が重い | **中**：同期時埋め込み生成＋Vercel 側クエリ埋め込み鍵・レート制限・障害時対策が必要 | **中（段階分散）**：段階 1 を先に本番化して全 35,768 シーン検索を実現し、段階 3 でベクトル列（`VECTOR(768)`）を重ねて RRF 統合。API 障害／レート超過時は自動で段階 1 へフォールバック |
| **検索の質（自然文 vs 固有名詞）** | 固有名詞・プラグイン・短語一致は **○〜◎**。長い自然文の言い換えには **△** | 任意部分文字列には強いが、ノイズ一致が多く自然文の意図理解には **△** | 自然文の意図検索は **◎** だが、レアなプラグイン名・厳密一致は **△** | **◎（最高）**：自然文は HNSW ベクトル検索、固有名詞・プラグイン・タグ・`keywords` は段階 1 の軽量索引が補い合い、将来 PingCAP が東京 FTS を開放したら段階 1 部分だけ置換可能 |

### 4-3. おすすめ方式（1 つ）と段階ロードマップ
- **おすすめ：案 4（東京 TiDB 単一クラスタでの 3 段階ハイブリッド移行）**
  - **段階 1（シーン検索の本番化・`\$0`）**: `videoScenes` テーブル（35,768 件）＋軽量キーワード補助（`keywordsJson` / 単語分割 `LIKE`＋既存左サイドバー絞込＋サーバー側 tRPC API）で、342 本止まりの `scenes_index.json` から脱却する。
  - **段階 2（レシピ＆`expressive_purpose` 統合・`\$0`）**: `craftRecipes` テーブル（`keywords`, `search_phrases`, `intent_summary`, `narrative_role`, `viewer_effect`, `best_for` 込み）を追加し、`videoScenes` と統合検索（レシピ優先・重複集約）。
  - **段階 3（Twelve Labs 風の本命：TiDB ベクトル検索追加）**: 東京対応済みの `VECTOR(768)` + HNSW を追加し、`gemini-embedding-2`（テキスト Standard `\$0.20/1M` / Batch `\$0.10/1M`、初回全量 `\$0.72〜\$1.43`）で埋め込みを生成。段階 1 のキーワード検索とアプリ側 RRF でハイブリッド統合し、API 障害時・レート超過時・短語時は段階 1 へ自動フォールバックする。

---

## 5. 段階 1（シーン検索の本番化）の計画と変更範囲

### 5-1. `videoScenes` テーブル定義案（TiDB・`videos` テーブルは一切変更しない）

SQLite `scenes` 全 **35,768 件 / 4,555 本**（うち実視聴 `watched` 35,640 件 / 4,539 本、未視聴分析由来 128 件 / 16 本、テキスト合計 9.34 MB、最大長 `start_mmss=5`, `shot_title=184`, `description=242`）の実測値にもとづく定義案：

```sql
CREATE TABLE IF NOT EXISTS videoScenes (
  id INT NOT NULL AUTO_INCREMENT,
  videoId VARCHAR(64) NOT NULL,
  shotIndex INT NOT NULL,
  startMmss VARCHAR(16) NOT NULL,
  endMmss VARCHAR(16) NOT NULL,
  startSec DECIMAL(8,2) NOT NULL,
  endSec DECIMAL(8,2) NOT NULL,
  durationSec DECIMAL(8,2) NOT NULL,
  shotTitle VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  keywordsJson TEXT NOT NULL,           -- 短い語 5〜10個の JSON 配列（カード表示＆検索用）
  searchText TEXT NOT NULL,             -- shotTitle + description + keywords 結合（段階1検索対象）
  isUnwatched TINYINT NOT NULL DEFAULT 0, -- 親動画の analysis_observation_scope IS NOT NULL なら 1（既定検索除外）
  sceneSha256 VARCHAR(64) NOT NULL,     -- 差分同期・冪等更新用ハッシュ
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY video_scenes_video_shot_unique (videoId, shotIndex),
  KEY idx_video_scenes_video_time (videoId, startSec),
  KEY idx_video_scenes_unwatched (isUnwatched, videoId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

※ 将来の段階 3（ベクトル検索追加）時は、同じ `videoScenes` テーブルへ `embedding VECTOR(768) NULL` と `embeddingTextSha256 VARCHAR(64) NULL` ＋ HNSW 索引を追加（または別表 `sceneEmbeddings` へ外出し）するだけ。既存の `videos` テーブルには一切触れない。

### 5-2. `videoScenes` と、後で作る `craftRecipes` 表との関係
- 両テーブルとも **`videos.id` を親とする並列の子テーブル（疎結合）** とし、1 対 1 の外部キーで縛らない（`videoScenes` は全 4,555 本・5〜15 秒ストーリー単位、`craftRecipes` は A- 以上・0.5〜15 秒テクニック単位で境界と更新経路が異なるため）。
- 必要時は `c.videoId = s.videoId AND c.startSec < s.endSec AND c.endSec > s.startSec`（区間オーバーラップ）で相互参照する。
- 統合検索時の既定は **「レシピ優先＋シーン補完」** とし、同一動画・重複時間帯（例：`IoU >= 0.4`）に両方がヒットした場合は `expressive_purpose` を持つ **`craftRecipes` カードへ 1 枚に集約**する。

### 5-3. SQLite → TiDB 同期スクリプト案（`scripts/sync-scenes-to-tidb.mjs`）
- 既定モードは **`--dry-run`（TiDB 読み取り専用・DDL/書込 0）**。
- `--dry-run` 時にローカル SQLite（`?mode=ro`）の `scenes` 全 35,768 件を読み込み、TiDB `videos` の ID 集合と照合して孤立行 0 件・件数・本数・未視聴除外件数・予定 DDL・`existing_videos_table_touched: false` を検証報告する。
- 本番投入（`--apply`）はユーザー承認＋反映ロック（`_apply_lock.json`）取得後のみ許可し、`sceneSha256` 差分によるバッチ `INSERT ... ON DUPLICATE KEY UPDATE` で冪等反映する（`videos` テーブルへの書き込み処理はコード上存在しない）。

### 5-4. 段階 1 のコード変更範囲（ファイル単位・実装はまだ行わない）

| 対象ファイル | 区分 | 変更内容（段階 1 のみ） |
|---|---|---|
| `drizzle/schema.ts` | 変更 | `videoScenes` テーブル定義を追加（既存 `videos` テーブル無変更） |
| `scripts/sync-scenes-to-tidb.mjs` | 新規（案作成済み） | SQLite `scenes` → TiDB `videoScenes` 差分同期スクリプト（`--dry-run` / `--apply` ロックガード付き） |
| `server/db.ts` | 変更 | `searchVideoScenes({ query, filters, limit, offset })` クエリ関数を追加（`videoScenes` と `videos` を `JOIN` し、`isUnwatched = 0`・削除非公開除外・既存タグ絞込・単語分割 AND 検索・関連度順返却） |
| `server/routers.ts` | 変更 | `scenes.search`（`publicProcedure`、Zod バリデーション、クエリ長上限・件数上限 80）および `scenes.stats` を追加 |
| `client/src/pages/Home.tsx` | 変更 | ① `viewMode === "scenes"` でも左サイドバー（`Sidebar`）を表示・連動させる（L355 の `viewMode === "videos"` 条件解除）、② `searchScenes` のローカル呼び出しを `trpc.scenes.search.useQuery`（デバウンス 400ms 付き）へ切替、③ アクティブフィルタ・件数表示をシーン検索結果へ接続 |
| `client/src/components/SceneCard.tsx` | 変更 | `SceneItem` 型に校正ランク・スコア・`keywords`（短い語チップ）対応を追加（プレビューは現行 YouTube 区間再生を維持） |
| `client/src/lib/sceneSearch.ts` | 変更 | サーバー検索移行に伴い、静的 `scenes_index.json` 読み込みをフォールバックまたは廃止準備（段階 1 プレビュー検証後に 3.32 MB の静的 JSON を削除） |
| `server/db.test.ts` / `client/src/components/SceneCard.test.tsx` | 変更 | `scenes.search` のクエリ構築・未視聴除外・サイドバーフィルタ連動の単体テスト追加 |

---

## 6. 段階 3（ベクトル検索）の API キー設計・安全管理（未作成・未設定）

### 6-1. 現状の公開範囲とリスク
- 前述（§1-1）のとおり、**現在のサイト（`/` および読み取り系 tRPC）はログイン不要の公開サイト**である。
- 公開検索のままクエリごとにサーバーから Gemini Embedding API を呼ぶと、外部ボットや自動巡回による連続リクエストで API クレジットが意図せず消費されるリスクがある。

### 6-2. 鍵の配置・権限分離・レート制限・予算管理設計

| 管理項目 | 設計方針 |
|---|---|
| **1. 鍵の置き場所** | **Vercel のサーバー側環境変数のみ**（例：`GEMINI_SEARCH_EMBED_API_KEY`、Production / Preview のサーバーランタイム限定）。`VITE_` プレフィックスは絶対に使わず、ブラウザの JS バンドル・API レスポンス・エラー文・ログへ一切出力しない。 |
| **2. 権限を絞った専用の別鍵** | CHIBA-PC の採点・レシピ生成用 `GEMINI_API_KEY` とは**完全に別の API キー**を発行する（可能なら Google Cloud で検索専用プロジェクトを分けるか、同一プロジェクト内でも API 制限を Generative Language API のみに絞り、名称を `iketeru-site-search-embed-only` として用途分離）。万一検索側がレート制限や上限停止しても、CHIBA-PC のバッチ処理は影響を受けない。 |
| **3. 呼び出し制御・ログイン要件の選択肢** | ・**案 A（公開検索維持＋多層防御）**: クライアント 500ms デバウンス ＋ 短語（1 語・2 文字以下や既存タグクリックのみ）は段階 1 キーワード検索で処理し Embedding を呼ばない ＋ クエリ正規化キャッシュ（TiDB `searchQueryEmbeddingCache`、TTL 7〜30 日）で同一クエリ再課金を防止 ＋ **IP 単位レート制限（10 回/分・60 回/時）＆サーバー全体レート制限（60 回/分）**。<br>・**案 B（ログイン限定ベクトル検索・最も安全）**: 未ログイン公開ユーザーは段階 1（キーワード検索・`\$0`）のみ、自然文ベクトル検索は **`@atsu-maru.co.jp` ログイン済みユーザー（`isAllowedEditorUser`）限定**にする。社内ツール利用が主なら案 B がコスト暴走リスク最小。 |
| **4. 障害・超過時の縮退動作** | レート制限超過・月間上限到達・API タイムアウト（2 秒）・鍵未設定のいずれでも **HTTP 500 にせず、自動で段階 1（キーワード検索）へ透過フォールバック** し、UI に「キーワード検索で表示中」と控えめに注記する。 |
| **5. 月間上限額と台帳への記録方法** | ・**月間ハード上限（サーバー側）**: **`\$2.00 / 月`**（1 万検索 ≒ `\$0.06` のため通常利用で 30 万検索超に相当し、異常連打時も被害を `\$2.00` で自動遮断）。<br>・**GCP 側安全策**: 自動チャージ OFF 維持 ＋ Billing Budget Alert（`\$2` / `\$5`） ＋ GCP Quotas で Embedding RPM / 日次トークン上限を設定。<br>・**台帳記録**: TiDB に日次集計テーブル `searchEmbeddingUsageDaily (usageDate, apiCalls, cacheHits, inputTokens, estimatedCostUsd)` を記録し、月次またはバッチ同期スクリプトで `analysis/api_url_budget_ledger.json`（`purpose: "site_search_query_embedding"`）へ反映して月間 `\$38` 全体枠と一元管理する。 |

---

## 7. 承認待ち事項（実装・DDL・鍵作成前に確定すること）

1. **東京リージョン前提の 3 段階検索構成（案 4）の承認**: 段階 1（`videoScenes`＋軽量キーワード検索＋左サイドバー有効化、`\$0`）→ 段階 2（`craftRecipes`＋`expressive_purpose` 統合）→ 段階 3（東京対応済み TiDB HNSW ベクトル検索追加）の順で進めてよいか。
2. **用途語彙（`PURPOSE_OPTIONS` 13 語 vs TiDB 実測 10 語）の統一先**: 案 1（13 語を D-024 単一語彙ファイルの正本とし、0 件の 3 語は UI 上で件数 0 扱い）でよいか。
3. **段階 1 の TiDB `videoScenes` DDL 適用および `sync-scenes-to-tidb.mjs --apply` の実施可否**（dry-run 結果確認後・反映ロック経由）。
4. **段階 3（ベクトル検索）の公開範囲と鍵方針**: 公開＋レート制限（案 A）とするか、`@atsu-maru.co.jp` ログイン限定（案 B）とするか。専用鍵の発行・Vercel 設定は段階 3 着手時に改めて承認を得る。
