# イケ動（iketeru-eizou）サイト検索・表示 統合設計書：シーン検索 API 化 / Twelve Labs 風カット検索 / クラフトレシピ表示

- **作成日**: 2026-11-25（`CHIBA-PC2`・`CHIBA-PC` 共同設計を統合）
- **最終更新**: 2026-11-26（`CHIBA-PC2`・両ブランチ設計書の無欠損統合、D-024 `shared/expressivePurposeVocab.json` 9 値統一、`search_phrases`/`keywords` 設計追記、ベクトル検索「案 B（ログイン限定）」確定、校正済み点数絞り込み修正、容量見積もり 37.98 MB vs 28.75 MB 差分説明、分け直しで消えたシーンの `--prune-stale` 設計を反映）
- **ステータス**: **方針確定・段階 1 実装済み（`feature/scenes-tidb-api`）／本番 TiDB への DDL・書き込みは未実施・ユーザー承認待ち**
- **ブランチ役割分離**:
  - `docs/site-cut-search-design`：**設計書のみ**（本ファイル `docs/SITE_SCENES_RECIPES_DESIGN.md` のみ配置。重複していた `scripts/sync-scenes-to-tidb.mjs` は `feature/scenes-tidb-api` 側へ一本化し本ブランチから除外済み）
  - `feature/scenes-tidb-api`：段階 1 実装（`drizzle/create_video_scenes.sql`、`scripts/sync-scenes-to-tidb.mjs`、tRPC `scenes` API、UI フィルタ・校正済み点数絞り込み修正・stale シーン検出/削除設計）
  - `feature/analysis-version`：分析の版（`analysis_version` / `videoAnalysisHistory`）の移行 DDL 案・API・UI 表示・「旧分析を除く」フィルタ
- **関連文書**:
  - `docs/STATUS_OVERVIEW_20261125.md`（現状ギャップ・フットプリント実測）
  - `docs/DECISIONS.md`（D-006 反映ロック、D-015 孤立行整理、D-021〜D-024 レシピ優先・A-以上基準・2段階API運用・`expressive_purpose` 単一語彙）
  - `shared/expressivePurposeVocab.json`（D-024 統制語彙の単一正本・`origin/main` 配置済み）
  - `docs/MULTI_PC_WORKFLOW.md`（複数 PC 運用・`_apply_lock.json` 排他制御）
  - `docs/API_CRAFT_RECIPE_DESIGN.md`（API 生成テキスト版 v2 レシピ仕様・provenance 設計）
  - `docs/CRAFT_RECIPE_DISTRIBUTION_DESIGN.md`（`chibatmute` 作成・`9c8fb60` 反映済み。レシピ正本を Google ドライブ `マイドライブ\iketeru_craft_recipes\<video_id>\` に置く方針および `craftRecipes` テーブル案 §5-2 と完全整合）
  - `docs/ANALYSIS_VERSION_DESIGN.md`（`feature/analysis-version` 側で詳細定義：分析の版・`videoAnalysisHistory`・`chibatmute` 書き込み手順との整合）

---

## 0. ユーザー決定事項・前提方針（2026-11-25〜26 確定）

| 項目 | 決定内容 |
|---|---|
| **シーンのテーブル (`videoScenes`)** | **進める**。投入対象は **SQLite の全 4,555 本（35,768 シーン）**。見ずに作られた動画（`analysisObservationScope IS NOT NULL`、現在 16 本・128 シーン）は **既定で除外し、UI の切り替えで警告バッジ付き表示できる**ようにする。 |
| **点数での絞り込み** | **校正済みの点数（`calibratedScore`）のみを使用**する（旧仕様の `COALESCE(calibratedScore, aiOverallScore)` による未校正点数の混入バグを修正）。未校正の動画は「未校正」として分けて扱うか、点数帯絞り込み（78 点以上 / 83 点以上 等）から除外する。 |
| **分け直しで消えたシーンの扱い** | 通常の upsert だけでは再分析で減った旧シーンが TiDB に残るため、`--dry-run` で動画ごとの残存（stale）シーン一覧・件数を報告し、明示的な `--prune-stale` 指定時のみ動画単位で事前バックアップを取得したうえで削除する（今回は未実行）。 |
| **目的 (`expressive_purpose`) の語彙統一（D-024）** | 正本は **`shared/expressivePurposeVocab.json`**。`narrative_role` は **固定 9 値**（`掴み` / `世界観提示` / `転換` / `情報提示` / `盛り上げ` / `感情強調` / `緩急の抜き` / `ブランド回収` / `締め`）に統一（旧案の 8 値から確定）。検索には `search_phrases` を使い、カードのタグ表示には `keywords` を使う。 |
| **ベクトル検索の公開範囲（段階 3）** | **案 B（ログイン済みユーザー限定）で進める**（設計のみ確定・今回は未実装）。未ログイン公開ユーザーには段階 1〜2 のキーワード／語彙検索（`$0`）を提供する。 |
| **レシピのテーブル (`craftRecipes`)** | **`chibatmute` の作業（381 本の修復 ＋ `docs/CRAFT_RECIPE_DISTRIBUTION_DESIGN.md`）が完了してから投入する**。`v1` レシピは **旧形式であることが分かる表示**（`旧形式 (v1)` バッジ＋注記）にする。MCP 検索から外されている **16 本（`provisional` 4 本 ＋ `invalidated_no_visual` 12 本）は見直しが終わるまでサイトに表示しない**。 |
| **「レシピあり」の表示範囲** | **まず動画詳細画面だけ**に表示する（一覧カードへのバッジ追加・一覧フィルタは後続フェーズ）。 |

---

## 1. 現行サイト検索・DB の現状と課題（コード・DB 実測ベース）

### 1-1. 全体構成（すべてクライアント側処理・サーバー検索なし）

| 項目 | 現行 Web サイト (`iketeru-eizou.vercel.app`) | 本番 TiDB / ローカル SQLite 実測 | 課題 |
|---|---|---|---|
| **本番 TiDB 環境** | リージョン：`ap-northeast-1.prod.aws.tidbcloud.com`（東京）<br>バージョン：`8.0.11-TiDB-v8.5.3-serverless` | 既存 9 テーブル：`videos`, `users`, `favoriteProfiles`, `profileVideoFavorites`, `profileCreatorFavorites`, `dailyCollectionSources`, `dailyCollectionRuns`, `aiMetadataCompletionJobs`, `aiMetadataCompletionRuns`。<br>`videos` 5,653 行（data `1.85 MB` + index `0.17 MB` = 約 `2.02 MB` / 無料枠 `5 GiB`） | `videos` 以外のデータ層（`videoScenes` / `craftRecipes` / `videoAnalysisHistory`）が未配置 |
| **サイト公開・認証状態** | `client/src/App.tsx`（L11–18）・`server/routers.ts`（L204–284）・`server/_core/vercelHandler.ts`（L41–43） | 閲覧および全読み取り API（`videos.list`, `videos.get`, `videos.count` 等）は**ログイン不要の完全公開（`publicProcedure` + `Cache-Control: public`）**。書き込み操作のみ `server/_core/trpc.ts`（L44–67）の **`writeProtectedProcedure`**（`admin` または `@atsu-maru.co.jp` ログイン、あるいは `ADMIN_API_KEY` 必須） | 外部ボットから読める公開 API で有償 Embedding API を無制限に呼ぶと課金暴走リスクがあるため、段階 3 は案 B（ログイン限定）を採用 |
| **シーン検索** | `client/public/scenes_index.json` および `client/src/lib/scenes_index.json`（**2026-11-19 時点・342 本 / 5,288 シーン・約 3.17〜3.32 MB**） | SQLite `scenes`: **4,555 本 / 35,768 シーン**（実視聴 `watched` 4,539 本 / 35,640 件、未視聴分析由来 16 本 / 128 件、`shot_title + description` 合計 `9.34〜9.79 MB`、平均 `195 bytes/件`、最大長 `start_mmss=5`, `shot_title=184`, `description=242`） | ① DB の約 **6〜7.5%**（342 本）しか検索できない。<br>② `client/src/lib/scenes_index.json` の静的 import により Vite 初回 JS バンドル **`3,614.15 kB`（gzip `735.84 kB`）の 87.7%** を占有。全 35,768 件を静的 JSON 化すると 21 MB 超で初回表示が破綻する。 |
| **クラフトレシピ** | 未表示・API なし | SQLite `craft_recipes`: 2026-11-25 初期実測 **439 本 / 1,036 カット**（`recipe_json` 合計 `8.11 MB`、最大 `11.3 KB/カット`、画像・GIF `5,486 ファイル / 4.06 GB`）。現在 `chibatmute` で v2 + `expressive_purpose` 化を進行中 | Web 上でレシピの有無・内容を確認できない。4.06 GB の画像・GIF を Git / Vercel / TiDB に載せるのは非現実的。 |

### 1-2. 現行の 2 つの検索モードと該当コード

| 検索モード | 該当ファイル・コード箇所 | 検索対象 | 検索方式 | 出力単位・UI |
|---|---|---|---|---|
| **動画一覧モード（標準検索）** | `client/src/hooks/useVideos.ts`（`parseSearchQuery` L224–249, `getVideoSearchText` L251–274, `applyVideoFilters` L276–361）<br>`client/src/pages/Home.tsx`（L343–351）<br>`server/db.ts`（`getAllVideoListItems` L133–160） | タイトル、`channelTitle`、`allTags`、`purposes`、`expressions`、`toneEmotions`、`toneVisuals`、`toneTechniques`、`productions`、`productionCredits`（役割）、各評価、`curationNote` 4 項目（`aiAnalysis`・シーン・レシピは SQL レベルで除外） | ブラウザ内の結合文字列に対する `String.prototype.includes()` **AND 部分一致**（`-語` / `-source:` 除外可、関連度順なし） | **動画単位**（`VideoCard.tsx`） |
| **シーン・秒数検索モード（プロトタイプ）** | `client/src/lib/sceneSearch.ts`（`loadSceneIndex` L328–374, `SYNONYM_MAP` L377–412, `searchScenes` L446–536, `getSceneKeywordCategories` L617–664）<br>`client/src/lib/scenes_index.json`（＋`client/public/scenes_index.json`）<br>`client/src/components/SceneCard.tsx`（L23–305）<br>`client/src/pages/Home.tsx`（L135–176, L213–262, L511–820） | 静的 JSON **`scenes_index.json`（5,288 シーン / 342 本のみ）** の `visual`, `keywords`, `audio`, `videoTitle` | ブラウザ内で空白分割 → 手動 35 語の `SYNONYM_MAP` 展開 → `includes()` **AND 部分一致**＋固定重み加算（`visual:15 / keywords:10 / audio:8 / title:5`） | **シーン単位**（`SceneCard.tsx`：時間帯バッジ、タイムラインバー、YouTube iframe ホバー区間再生、説明文、`#キーワード` 4 個、クリックで該当秒から `VideoModal` 再生） |

### 1-3. 現行「シーン・秒数検索」の 4 つの課題
1. **342 本（全体の約 6〜7.5%）しか検索対象になっていない**: `loadSceneIndex` は新規動画の `v.aiAnalysis` から動的抽出する処理を持つが、`videos.list` が SQL で `aiAnalysis` を除外しているため機能せず、SQLite 上の **4,555 本 / 35,768 シーン** の大半が検索に出ない。
2. **自然文クエリに弱い**: 空白区切り AND 部分一致のため、自然な日本語文を入れると 1 塊扱いになり 0 件になりやすい。
3. **既存フィルタと分断**: シーンモードでは左サイドバーが非表示（`Home.tsx` の `viewMode === "videos"` 条件）で、用途・表現・トンマナ・校正点数による絞り込みが連携していない。
4. **クラフトレシピ・`expressive_purpose` 未連携**: カットごとの制作意図（`intent_summary` / `search_phrases` / `keywords`）や技法・プラグイン情報と結びついていない。

---

## 2. TiDB 東京リージョン公式制約と 3 段階検索アーキテクチャ

### 2-1. 一次資料による TiDB Cloud リージョン制約の確認

PingCAP 公式ドキュメントリポジトリ（`pingcap/docs` `master`）の一次資料を確認した結果：

1. **TiDB ネイティブ全文検索（Full-Text Search / `WITH PARSER MULTILINGUAL`）**:
   - 公式 URL: `https://docs.pingcap.com/tidbcloud/vector-search-full-text-search-sql/`（`ai/guides/vector-search-full-text-search-sql.md` L29–31）および `https://docs.pingcap.com/tidbcloud/vector-search-hybrid-search/`（L22–24）
   - 原文引用：
     > "Currently, full-text search is only available on Starter and Essential in the following regions:
     > - TiDB Cloud Serverless: `Frankfurt (eu-central-1)` and `Singapore (ap-southeast-1)`"
   - **結論**: **本番 TiDB の東京リージョン（`ap-northeast-1`）では、公式仕様上 TiDB ネイティブ全文検索は利用不可**。
   - **本番 TiDB に触れずに最新対応状況を確認したい場合**: 本番クラスタ上で DDL テストは絶対に行わず、TiDB Cloud コンソール上で **本番とは完全に別の検証用無料 Starter クラスタを `ap-northeast-1` に一時作成** して `CREATE TABLE fts_probe (id INT, body TEXT, FULLTEXT INDEX (body) WITH PARSER MULTILINGUAL);` の成否を確認した後に削除する（または PingCAP サポートへ問い合わせ）。
2. **TiDB ベクトル検索（Vector Search / `VECTOR(dim)` + HNSW）**:
   - 公式 URL: `https://docs.pingcap.com/tidbcloud/vector-search-overview/`（L14）および `https://docs.pingcap.com/tidbcloud/vector-search-limitations/`（L14）
   - 原文引用：
     > "The vector search feature is available on TiDB Self-Managed, Starter, Essential, and TiDB Cloud Dedicated. For TiDB Self-Managed and TiDB Cloud Dedicated, the TiDB version must be v8.4.0 or later (v8.5.0 or later is recommended)."
   - **結論**: **TiDB ベクトル検索にはリージョン制限がなく、東京リージョン（`ap-northeast-1`）の `v8.5.3-serverless` で利用可能**（本番への DDL 実行は承認後）。

### 2-2. 東京リージョン（`ap-northeast-1`）で使える検索方式 4 案の比較

現行 `videoScenes` 35,768 件 ＋ 将来 `craftRecipes` 9,000 カット＝計 約 4.5 万行規模を想定した比較：

| 評価軸 | 案 1：標準 SQL（`LIKE`＋類義語展開＋軽量キーワード索引） | 案 2：自前 2-gram（n-gram）転置表を TiDB に持つ | 案 3：ベクトル検索先行（TiDB HNSW のみ） | **案 4（採用）：3 段階ハイブリッド移行**<br>段階 1＝案 1（標準 SQL＋軽量索引）<br>→ 段階 2＝レシピ＆`expressive_purpose` 統合<br>→ 段階 3＝TiDB ベクトル検索（HNSW）＋RRF 統合 |
|---|---|---|---|---|
| **東京 TiDB でそのまま動くか** | **◎ 確実**（標準 SQL / B-Tree のみ） | **◎ 確実** | **◎ 確実**（HNSW は東京対応） | **◎ 確実**（追加 DB・リージョン移転不要） |
| **費用** | **\$0**（無料枠 5 GiB 内） | **\$0**（ただし 250〜300 万行・150〜250 MB 消費、再同期 RU が重い） | 初回埋め込み `\$0.72〜\$1.43`、検索 1 万回 `\$0.06`、TiFlash 約 137 MB（無料枠 2.7%） | 段階 1・2 は **\$0**。段階 3 追加時のみ初回 `\$0.72〜\$1.43`＋検索 1 万回 `\$0.06` |
| **実装・運用の手間** | **低**：同期時に抽出済み短い語（`keywords`・タグ・プラグイン名）と結合テキストを保持し、スペース区切り語は `LIKE`＋同義語展開＋タグ絞込 | **中〜高**：自前 2-gram 分割・ストップワード・巨大転置表の保守が重い | **中**：同期時埋め込み生成＋Vercel 側クエリ埋め込み鍵・レート制限・障害時対策が必要 | **中（段階分散）**：段階 1 で全 35,768 シーン検索を先に本番化し、段階 2 で `search_phrases` / `keywords` 統合、段階 3 でログイン限定ベクトル検索（`VECTOR(768)`）を重ねて RRF 統合。障害時は自動で段階 1〜2 へフォールバック |
| **検索の質（自然文 vs 固有名詞）** | 固有名詞・プラグイン・短語一致は **○〜◎**。長い自然文の言い換えには **△** | ノイズ一致が多く自然文の意図理解には **△** | 自然文の意図検索は **◎** だが、レアなプラグイン名・厳密一致は **△** | **◎（最高）**：自然文は HNSW（`search_phrases` 込み）、固有名詞・プラグイン・タグ・`keywords` はキーワード索引が補完。将来東京 FTS 開放時は段階 1 部分のみ置換可能 |

### 2-3. 採用ロードマップ（案 4）
- **段階 1（シーン検索の本番化・`\$0`）**：TiDB `videoScenes` テーブル（35,768 件）＋ tRPC `scenes` API ＋ 類義語展開 AND 検索 ＋ 校正済み点数絞り込み ＋ 未視聴除外トグルで、342 本止まりの静的 JSON から脱却する（静的 JSON はテーブル稼働確認後に別 PR で撤去）。
- **段階 2（クラフトレシピ＆`expressive_purpose` 統合・`\$0`）**：`craftRecipes` テーブル（動画詳細画面先行表示 → カット統合検索へ拡張）を追加し、`expressive_purpose.search_phrases` を検索対象、`expressive_purpose.keywords` をカードのタグ（チップ）表示として統合する。
- **段階 3（Twelve Labs 風の本命：TiDB ベクトル検索追加・案 B ログイン限定）**：東京対応済みの `VECTOR(768)` + HNSW を追加し、`gemini-embedding-2`（Standard `\$0.20/1M` / Batch `\$0.10/1M`）で埋め込みを生成。ログイン済みユーザー限定で RRF ハイブリッド検索を提供（**今回は設計のみ・未実装**）。

---

## 3. 段階 1 詳細設計：シーン検索 API 化（TiDB `videoScenes` テーブル ＋ tRPC API）

### 3-1. テーブル構造（DDL：`drizzle/create_video_scenes.sql`）

既存の `videos` テーブル（5,653 行・旧 40 列保護対象）には一切手を加えず、独立テーブル **`videoScenes`** を新規追加する。

```sql
CREATE TABLE IF NOT EXISTS `videoScenes` (
  `id` int AUTO_INCREMENT NOT NULL,
  `videoId` varchar(64) NOT NULL,
  `shotIndex` int NOT NULL,
  `startMmss` varchar(16) NOT NULL,
  `endMmss` varchar(16) NOT NULL,
  `startSec` decimal(8,2) NOT NULL DEFAULT 0.00,
  `endSec` decimal(8,2) NOT NULL DEFAULT 0.00,
  `durationSec` decimal(8,2) NOT NULL DEFAULT 0.00,
  `shotTitle` varchar(255) NOT NULL DEFAULT '',
  `description` text NOT NULL,
  `audioText` text,
  `keywordsJson` text NOT NULL,
  `searchText` text NOT NULL,
  `sceneSha256` varchar(64) DEFAULT NULL,
  `sourceUpdatedAt` timestamp NULL DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `video_scenes_video_shot_unique` (`videoId`, `shotIndex`),
  KEY `video_scenes_video_id_idx` (`videoId`),
  KEY `video_scenes_video_time_idx` (`videoId`, `startSec`)
);
```

- **SQLite `scenes` との対応**:
  - SQLite 側の列（`video_id`, `shot_index`, `start_mmss`, `end_mmss`, `start_sec`, `end_sec`, `duration_sec`, `shot_title`, `description`）を 1:1 で収容しつつ、`audioText`（現行 `SceneCard` 表示用）、`keywordsJson`（事前抽出した短いキーワード配列）、`searchText`（`shotTitle + description + audioText + keywords + videoTitle` を小文字化・正規化した検索用結合テキスト）、`sceneSha256`（内容変化検出・冪等差分同期用ハッシュ）を保持する。
  - 未視聴フラグ（`analysisObservationScope`）および校正スコア（`calibratedScore` / `calibratedRank`）は、親テーブル `videos` を `JOIN` して常に最新の正本値を参照する（二重管理による不整合を防ぐため、`videoScenes` 側に `isUnwatched` を複製せず `videos.analysisObservationScope` を単一正本とする）。
- **外部キーを張らない理由**:
  - 本番 `videos` テーブルへのロック波及や既存削除・移行スクリプトとの予期せぬ制約衝突を避けるため、`profileVideoFavorites` と同様に論理参照（`videoId` インデックス＋同期スクリプト側での fail-closed 整合チェック）とする。
- **将来拡張（段階 3）**:
  - 段階 3 でベクトル検索を追加する際は、`videoScenes` へ `embedding VECTOR(768) NULL` + `embeddingTextSha256 VARCHAR(64) NULL` + HNSW 索引を追加するか、別表 `sceneEmbeddings` へ外出しする。既存 `videos` テーブルには触れない。

#### 容量見積もり `37.98 MB` と `28.75 MB` の違いの理由（両スクリプト統合時の比較記録）

ブランチ整理前、`feature/scenes-tidb-api`（`37.98 MB`）と `docs/site-cut-search-design`（`28.75 MB`）の 2 つの `scripts/sync-scenes-to-tidb.mjs` で同じ 35,768 行に対する見積もりが **9.23 MB** 食い違っていた。原因は以下の 3 点（計算式の違いであり、実データ数の違いではない）：

| 要因 | `feature/scenes-tidb-api` 側（`37.98 MB`） | `docs/site-cut-search-design` 側（`28.75 MB`） | 差分への寄与 |
|---|---|---|---|
| **1. `searchText` に含める項目** | `shotTitle + description + audioText + keywords + videoTitle`（**動画タイトルを毎回連結**） | `shotTitle + description + keywords`（`videoTitle`・`audioText` を含めない） | 35,768 行 × 平均動画タイトル約 50〜70 bytes ≒ **約 +2.0〜2.5 MB** |
| **2. キーワード抽出件数と方式** | `#ハッシュタグ` + カタカナ + 90 語超の `SEED_WORDS` 一致（最大 14 語） | カタカナ + 英単語のみ（最大 10 語） | `keywordsJson` ＋ `searchText` 重複分で **約 +1.0〜1.5 MB** |
| **3. 行・インデックスオーバーヘッド係数** | 全列 UTF-8 バイト＋64B に **データ領域 `1.15x` 係数** を掛け、さらに **インデックス分 `140 B/行`（約 `4.78 MB`）を別加算** | テキスト 4 列＋`160 B/行` の単純合算のみ（`1.15x` 係数なし・インデックス別加算なし） | 係数 1.15x（約 +4.2 MB）＋インデックス加算（約 +4.8 MB）− 固定 96 B 差（−3.3 MB）≒ **約 +5.5〜6.0 MB** |

- **結論**: TiDB 実格納サイズとしては、`1.15x` ＋ インデックス見積もりを含む **`feature/scenes-tidb-api` 側の保守的見積もり（約 38 MB、無料枠 5 GiB の約 0.74%）** を上限目安として採用する（将来 5,653 本・約 45,000 行に増えても約 48 MB ≒ 無料枠の 0.94% で十分に余裕がある）。なお、一本化後のスクリプトでは英単語抽出（`docs` 側）も取り込みつつ `rawTextBytes` / `estimatedDataMb` / `estimatedIndexMb` / `estimatedTotalMb` の内訳を明示出力する。

### 3-2. 移行・継続更新・分け直しで消えたシーン（stale scenes）の扱い

1. **本番 DB 安全手順（`docs/MULTI_PC_WORKFLOW.md` / D-006 準拠）**:
   - スクリプトは **`scripts/sync-scenes-to-tidb.mjs`**（`feature/scenes-tidb-api` に一本化）。
   - 既定モードは **`--dry-run`**（SQLite `?mode=ro`・TiDB `SELECT` / `SHOW TABLES` のみ。DDL 0・書き込み 0・`existing_videos_table_touched: false`）。
   - `--apply` はユーザー承認後、`_apply_lock.json`（`run_id: "sync_video_scenes_to_tidb"`）取得＆push → 事前確認（`videos` の `COUNT(*)` / `MAX(updatedAt)` 記録）→ バッチ 500 行 `INSERT ... ON DUPLICATE KEY UPDATE` → 事後監査（`videos` 5,653 行無変更＋`videoScenes` 件数一致）→ ロック解放＆push の順で実行。
   - 冒頭で TiDB `SELECT id FROM videos` と突き合わせ、SQLite 側に未存在 ID が 1 件でもあれば即停止（fail-closed）。
2. **分け直し（再分析・カット境界再分割）で消えたシーン（stale scenes）の検出と削除設計**:
   - 通常の `INSERT ... ON DUPLICATE KEY UPDATE`（キー `(videoId, shotIndex)`）だけでは、ある動画のシーン数が再分析で 12 件 → 8 件に減った場合に旧 `shotIndex = 9..12` が TiDB に残存する。
   - **`--dry-run` 時の検出**: TiDB に `videoScenes` テーブルが存在する場合、TiDB 側の `(videoId, shotIndex)` 集合と SQLite 側の集合を比較し、**動画ごとに「TiDB にはあるが元データ（SQLite）にはないシーン」の一覧（`shotIndex`・`startMmss`–`endMmss`・`shotTitle`）と件数（`staleVideosCount`, `staleScenesCount`, `staleByVideo[]`）** を出力する（テーブル未作成時は `tableExists: false`, `staleScenesCount: 0` と明示）。
   - **削除（`--prune-stale` 明示時のみ・今回は未実行）**:
     - `--apply` 単体では stale シーンを削除しない（追加・更新のみ）。
     - `--apply --prune-stale` を明示した場合のみ、**削除対象の `videoId` ごとに事前バックアップ（`E:\iketeru_backups\video_scenes_pre_prune_<timestamp>\<videoId>.jsonl` または指定ディレクトリ）と SHA-256 を保存し、バックアップ検証後に当該 `videoId` の stale `shotIndex` のみを `DELETE FROM videoScenes WHERE videoId = ? AND shotIndex IN (...)` で削除**する（全表 `TRUNCATE` や一括 `DELETE` は禁止）。

### 3-3. 検索 API の設計（tRPC `scenes` ルーター）

`server/routers.ts` に `scenes` サブルーターを追加する（すべて `publicProcedure` の読み取り専用）。

| エンドポイント | 入力 | 出力 | キャッシュ方針 |
|---|---|---|---|
| `scenes.search` | `{ query: string, limit?: number (既定 40, 最大 80), offset?: number (既定 0), excludeUnwatched?: boolean (既定 true), scoreFilter?: "all" \| "calibrated_only" \| "score_78_plus" \| "score_83_plus" \| "uncalibrated_only" (既定 "all"), excludeLegacyAnalysis?: boolean (既定 false ※`feature/analysis-version` で追加) }` | `{ available: boolean, source: "tidb" \| "table_unavailable", items: SceneSearchItem[], total: number, hasMore: boolean, totalIndexedScenes: number, totalIndexedVideos: number }` | `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`（GET 時） |
| `scenes.keywordStats` | `{ excludeUnwatched?: boolean (既定 true), scoreFilter?: SceneScoreFilter, excludeLegacyAnalysis?: boolean }` | `{ available: boolean, totalScenes: number, totalVideos: number, categories: KeywordCategory[] }` | `Cache-Control: public, s-maxage=300, stale-while-revalidate=600` |
| `scenes.byVideoId` | `{ videoId: string }` | `{ available: boolean, scenes: SceneItem[] }` | 動画詳細モーダル内タイムスタンプ一覧用 |

- **テーブル未作成時の安全フォールバック**:
  - 本番 TiDB に `videoScenes` テーブルがまだ存在しない場合（`ER_NO_SUCH_TABLE` / errno `1146`）、API は 500 にせず `available: false, source: "table_unavailable"` を返す。
  - フロントエンドは `available === false` を検知した場合、自動的に現行の静的ファイル（`scenes_index.json`）へフォールバックして動作を継続する。静的 JSON 2 ファイルの完全撤去は、本番 TiDB 稼働・プレビュー確認後の別 PR で実施する。
- **点数絞り込み（修正後・確定仕様）**:
  - **原則**：点数による絞り込みは **校正済みの点数（`v.calibratedScore`）のみ** を使う。未校正の動画（`v.calibratedScore IS NULL`）に昔の `v.aiOverallScore` をフォールバックして混入させてはならない（旧実装の `COALESCE(v.calibratedScore, v.aiOverallScore, -1) >= 78` により 78 点以上が 25,316 件と校正済み 3,174 件を超過していた不具合を修正）。
  - `scoreFilter = "all"`：すべての動画（校正済み＋未校正）
  - `scoreFilter = "calibrated_only"`：`v.calibratedScore IS NOT NULL`（校正済みのみ）
  - `scoreFilter = "score_78_plus"`：`v.calibratedScore IS NOT NULL AND v.calibratedScore >= 78`（校正済み 78 点 / A- 以上のみ）
  - `scoreFilter = "score_83_plus"`：`v.calibratedScore IS NOT NULL AND v.calibratedScore >= 83`（校正済み 83 点 / 受賞水準以上のみ）
  - `scoreFilter = "uncalibrated_only"`：`v.calibratedScore IS NULL`（未校正のみを分離表示）
  - **件数整合不変条件**：任意の同一母集団において、`calibrated_only` ＝ `(score >= 83)` ＋ `(78 <= score < 83)` ＋ `(score < 78)` が常に厳密一致し、`calibrated_only` ＋ `uncalibrated_only` ＝ `all` となること。
- **検索ロジック（日本語対応）**:
  - `shared/sceneSearchMeta.ts` に `SYNONYM_MAP` / `SCENE_CATEGORY_DEFINITIONS` / `parseQueryWords` / `getSynonymsForWord` を共通化。
  - 検索語を空白分割（最大 5 語）→ 各語を類義語配列へ展開 → SQL プリペアドステートメントで `(s.searchText LIKE ? OR ...)` を `AND` 結合。
  - 削除・非公開動画（`v.embedReason IN ('unavailable_deleted', 'unavailable_private')`）は通常一覧と同様既定除外。
  - 並び順：タイトル・キーワード・説明文の一致重みスコア順 ＋ `COALESCE(v.calibratedScore, -1) DESC`（校正済み優先）＋ `s.id DESC`。
  - P95 レイテンシが 500 ms 超となる場合の第 2 手として、事前展開キーワード転置テーブル `videoSceneKeywords(keyword, sceneId)` を用意できる設計とする。

### 3-4. 画面変更・表示の速さ・本番 DB 影響・ロールバック

| ファイル | 変更内容（段階 1） |
|---|---|
| `shared/sceneSearchMeta.ts` | `SYNONYM_MAP`, `SCENE_CATEGORY_DEFINITIONS`, `parseQueryWords`, `getSynonymsForWord`, `SceneScoreFilter` を共通化 |
| `drizzle/create_video_scenes.sql` / `drizzle/schema.ts` | `videoScenes` テーブル定義を追加（既存 `videos` テーブル無変更） |
| `scripts/sync-scenes-to-tidb.mjs` (+ `.test.mjs`) | SQLite `scenes` → TiDB `videoScenes` 差分同期、校正済み点数内訳照合、stale シーン dry-run 検出 ＆ `--prune-stale`（動画単位バックアップ付き） |
| `server/db.ts` / `server/routers.ts` / `server/_core/vercelHandler.ts` | `scenes.search` / `scenes.keywordStats` / `scenes.byVideoId`、`ER_NO_SUCH_TABLE` 安全フォールバック、Cache-Control |
| `client/src/pages/Home.tsx` | シーン検索タブで `trpc.scenes.search.useQuery`（デバウンス）を利用。点数絞り込み（校正済みのみ / 校正 78 点以上 / 校正 83 点以上 / 未校正のみ）・未視聴除外トグル・ページングを接続。後続で左サイドバーの用途・表現・トンマナ絞り込みも連動 |
| `client/src/components/SceneCard.tsx` | `calibratedScore` / 未校正バッジ、`analysisObservationScope` 警告バッジ、`keywords` 短い語チップを表示（プレビューは現行 YouTube 区間再生を維持） |
| `client/src/lib/scenes_index.json` / `client/public/scenes_index.json` | 本番 `videoScenes` 稼働確認後に別 PR で完全削除（約 3.17〜3.32 MB × 2 撤去 → 初回 JS バンドル約 `3,614 kB` → 約 `450 kB`〔約 -87%〕） |

- **本番 DB への影響**: 新規独立テーブル `videoScenes` の追加のみ（既存 9 テーブル無変更、容量約 38 MB ≒ 無料枠 5 GiB の 0.74%）。
- **ロールバック**: ① PR の `git revert` で 1〜2 分で即時復旧、② 必要時のみ `_apply_lock.json` 取得後に `DROP TABLE IF EXISTS videoScenes;` で完全原状復帰。

---

## 4. カット単位検索カード ＆ 目的（`expressive_purpose`）語彙統一設計（D-024 準拠・設計のみ）

### 4-1. Twelve Labs 風カット単位検索結果カード（`CutResultCard` 仮称）

既存の `SceneCard.tsx` を土台に、`craftRecipes` の `expressive_purpose` 情報と `videoScenes` を統合表示するカット単位カードを設計する（実装は段階 2）。

```text
+-------------------------------------------------------+
| [01:12 - 01:16]              [レシピ v2] [94% Match]   |
|                                                       |
|          YouTube サムネイル（段階 1〜2 は現行踏襲）      |
|          ホバー時: YouTube iframe 該当区間ミュート再生   |
|          （※カット固有静止画・GIF配信は後の段階・要検討） |
|                                                       |
| ======[====]========================================= |  <- 動画全体尺上の位置バー
+-------------------------------------------------------+
| 動画名: TVアニメ『呪術廻戦』第3期 OP ...     [S 94.5]  |
| 狙い : 4人の新キャラを0.5秒刻みの矩形コラージュで      |  <- expressive_purpose.intent_summary (1〜2文)
|        連続提示し、情報密度と高揚感を一気に引き上げる   |
| 役割 : [転換]  効果: [高揚感] [疾走感]                 |  <- narrative_role (9値) / viewer_effect (30語)
| タグ : [#矩形コラージュ] [#高速切替] [#枠線構成] [+2]   |  <- expressive_purpose.keywords (短い語 5〜10個)
| ツール: After Effects (Motion 4, Flow)                |  <- craftRecipes 由来時のみ表示
+-------------------------------------------------------+
```

| 要素 | 表示元（`craftRecipes` 由来） | フォールバック（`videoScenes` のみ） | 扱い・UI 動作 |
|---|---|---|---|
| **サムネイル・プレビュー** | **段階 1〜2 は現行 YouTube 区間再生（iframe ミュート区間プレビュー＋`hqdefault.jpg` 等）を維持** | 同左 | カット固有の静止画（`mid_png`）・GIF の Web 配信は「後の段階・要検討」（オブジェクトストレージ／CDN 費用、および第三者映像の切出し画像・GIF を Web 配信する権利上の確認が必要なため）。 |
| **カット時間帯** | `startMmss - endMmss`（`startSec`, `endSec`）＋タイムライン位置バー | `videoScenes.startMmss - endMmss` | クリックで `VideoModal` を `startSec` から直接再生 |
| **動画名・スコア** | `videos.title` ＋ `calibratedRank` / `calibratedScore`（未校正は「未校正」表示） | 同左 | クリックで `VideoModal` を開き該当カット位置へ移動 |
| **狙いの 1〜2 文** | `expressive_purpose.intent_summary` | `videoScenes.shotTitle` ＋ `description` の冒頭要約 | 詳細展開時に `evidence` / `avoid_when` を確認可 |
| **キーワードタグ表示（`keywords`）** | **`expressive_purpose.keywords`（短い語 2〜10 文字・5〜10 個）のみをタグ（チップ）として表示**（カード上は上位 4〜6 個＋`+N` 展開） | `videoScenes.keywordsJson`（短い語のみ） | 一致語をハイライト。クリックで検索条件へ追加絞り込み。**`keywords` は「表示用タグ＋キーワード検索」の両方に使う** |
| **自然文検索フレーズ（`search_phrases`）** | **`expressive_purpose.search_phrases`（自然文の言い換え 3〜6 個）は UI に表示せず、検索インデックス（`searchText` および段階 3 の埋め込みベクトル生成入力）にのみ使用** | なし（`shotTitle` + `description` が代替） | ユーザーが「テンポよく新キャラを並べて見せる演出」「画面を割ってスピード感を出す」のような自然文で検索した際に、`search_phrases` と部分一致／ベクトル一致させてヒットさせる（**設計のみ・実装は段階 2〜3**） |

### 4-2. D-024 単一語彙ファイル（`shared/expressivePurposeVocab.json`）への完全準拠

すべての絞り込み語彙・バリデーション・同期スクリプト・レシピ生成は、すでに `origin/main` へ配置済みの **`shared/expressivePurposeVocab.json`**（単一正本）を参照する。

| `expressive_purpose` 項目 | 絞り込み・表示上の位置づけ | `shared/expressivePurposeVocab.json` 確定語彙 |
|---|---|---|
| **`narrative_role`**（構成上の役割） | カット検索専用の固定ピル（**固定 9 値** ※旧案の 8 値から 9 値へ統一） | **`掴み` / `世界観提示` / `転換` / `情報提示` / `盛り上げ` / `感情強調` / `緩急の抜き` / `ブランド回収` / `締め`** |
| **`viewer_effect`**（視聴者への効果・2〜4 語） | 既存「感情トンマナ（`toneEmotions`）」と横断絞り込み可能な共通語彙（計 30 語） | 既存感情 24 語（`疾走感`, `高揚感`, `緊張感`, `爽快感`, `洗練`, `重厚`, `静謐`, `温もり`, `切なさ`, `ノスタルジー`, `不穏`, `シュール`, `ユーモア`, `遊び心`, `カオス`, `中毒性`, `浮遊感`, `幻想的`, `透明感`, `カタルシス`, `信頼感`, `知性`, `祝祭感`, `躍動感`）＋ 新規認知効果 6 語（`没入感`, `視線誘導`, `視認性向上`, `記憶定着`, `期待感`, `余韻`） |
| **`best_for`**（向いている案件・各 1〜3 語） | 既存サイドバー絞り込みと統一 | `purposes`（13 語・下節参照）、`genres`（15 語）、`industries`（20 語）、`media_formats`（6 語）、`duration_fit`（5 語：`6s`/`15s`/`30s`/`60s`/`90s+`） |
| **`avoid_when`**（1〜3 件） | カード詳細・モーダルの注意ラベル | 自由文（「向かない場面」表示・AI 提案ガード用） |
| **`search_phrases`**（3〜6 個） | **検索専用（UI 非表示）** | 自然文検索用の言い換え文。段階 2 では `craftRecipes.purposeSearchText` へ結合してキーワード検索対象にし、段階 3 では埋め込みベクトル生成テキストへ含める |
| **`keywords`**（5〜10 個・2〜10 文字） | **タグ（チップ）表示＋キーワード検索** | カード上に `#タグ` チップとして表示・クリック絞り込み・一致ハイライトに使用 |
| **`evidence`**（1 件以上） | 根拠タイムスタンプ表示 | `timestamp_sec` がカット `[start_sec, end_sec]` 内であることを G8 ゲートで機械検証済み |
| **`provenance`** | 由来バッジ | `video_observed` / `text_derived` / `api_interpreted` |

### 4-3. `PURPOSE_OPTIONS`（13 語）と TiDB 実測（10 語）のずれ整理
- `shared/metadataOptions.ts`（13 語）および `shared/expressivePurposeVocab.json` の `best_for.purposes`（13 語）と TiDB `videos.purposes` 実測（10 語）の差は、`採用・リクルーティング`・`ハウツー・解説`・`イベント・空間演出` の 3 語（現状 TiDB 0 件）。
- **採用方針（案 1）**: **`shared/expressivePurposeVocab.json` / `PURPOSE_OPTIONS` の 13 語をそのまま正準リストとして維持**し、UI サイドバー上で件数 0（`count === 0`）の 3 語は折りたたみ／グレー表示とする（既存コード・テスト非破壊、今後の採用・展示・解説レシピに対応）。

---

## 5. 段階 2 詳細設計：クラフトレシピ表示 ＆ カット統合検索

### 5-1. 正本（Google ドライブ）と Web 表示用ミラー（TiDB）の役割分離

`docs/CRAFT_RECIPE_DISTRIBUTION_DESIGN.md`（`9c8fb60`）および D-022 / D-023 / D-024 と完全整合するよう、正本と表示キャッシュの責務を分離する：

```text
[正本 (Master): Google ドライブ マイドライブ\iketeru_craft_recipes\<video_id>\]
  ├── recipe.json (テキスト仕様 + テレメトリ + provenance + expressive_purpose)
  └── メディア実体 (GIF / PNG / 3x2 JPG ストリップ: 4.06 GB+)
        │
        ├──▶ 各 PC ローカル SQLite (iketeru-creative-studio MCP 動画生成用)
        │
        └──▶ (片道同期・テキストのみ抽出) ──▶ [TiDB `craftRecipes` (Web 閲覧用リードミラー)]
                                                    │
                                                    ▼
                                             [Web サイト詳細モーダル (Phase 2A)]
                                             → [カット統合検索 (Phase 2B)]
```

- **絶対原則**:
  1. **TiDB `craftRecipes` は正本にしない**（Web からの編集・書き込み機能は作らない）。常に正本（または正本同期済み SQLite）からの片道 upsert のみ。
  2. **Phase 2A では画像を扱わない**：ローカル相対パス（`gif_path`, `strip_path`, `start_png` 等）はサニタイズしブラウザへ露出しない。
  3. **入力アダプタ分離**：`scripts/sync-craft-recipes-to-tidb.mjs` は `--source-dir <Googleドライブ正本フォルダ>` と `--sqlite-path <SQLiteパス>` の 2 系統を受け取れる構造にする。

### 5-2. テーブル構造（DDL：`docs/CRAFT_RECIPE_DISTRIBUTION_DESIGN.md` §5-2 ＋ D-024 `expressive_purpose` 列拡張案）

```sql
CREATE TABLE IF NOT EXISTS `craftRecipes` (
  `id` int AUTO_INCREMENT NOT NULL,
  `videoId` varchar(64) NOT NULL,
  `cutIndex` int NOT NULL,
  `title` varchar(255) NOT NULL,
  `category` varchar(64) NOT NULL,
  `startMmss` varchar(16) NOT NULL,
  `endMmss` varchar(16) NOT NULL,
  `startSec` decimal(8,3) NOT NULL,
  `endSec` decimal(8,3) NOT NULL,
  `durationSec` decimal(8,3) NOT NULL,
  `primaryTool` varchar(64) NOT NULL,
  `softwareJson` text NOT NULL,
  `pluginsJson` text NOT NULL,
  `paletteJson` text NOT NULL,
  `easingJson` text,
  `recipeJson` mediumtext NOT NULL,
  `isV2` int NOT NULL DEFAULT 0,
  `hasExpressivePurpose` int NOT NULL DEFAULT 0,
  `narrativeRole` varchar(32) DEFAULT NULL,
  `viewerEffectsJson` text DEFAULT NULL,
  `purposeKeywordsJson` text DEFAULT NULL,
  `purposeSearchText` text DEFAULT NULL,
  `needsRecut` int NOT NULL DEFAULT 0,
  `credibilityScore` int DEFAULT NULL,
  `provenanceSource` varchar(64) DEFAULT NULL,
  `hasLocalMedia` int NOT NULL DEFAULT 0,
  `mediaUrlManifestJson` text DEFAULT NULL,
  `recipeSha256` varchar(64) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `craft_recipes_video_cut_unique` (`videoId`, `cutIndex`),
  KEY `craft_recipes_category_idx` (`category`),
  KEY `craft_recipes_is_v2_idx` (`isV2`),
  KEY `craft_recipes_narrative_role_idx` (`narrativeRole`)
);
```

- **検索用列の役割（D-024 準拠）**:
  - `purposeKeywordsJson`：`expressive_purpose.keywords`（短い語 5〜10 個）の JSON 配列 → カード上のタグ（チップ）表示＋タグクリック絞り込みに使用。
  - `purposeSearchText`：`intent_summary` ＋ `search_phrases[]` ＋ `keywords[]` ＋ `viewer_effect[]` ＋ `narrative_role` ＋ `title` ＋ `plugins` を正規化・小文字化結合したテキスト → 段階 2 のキーワード／言い換え検索対象（`search_phrases` はこの列のみに入れ UI には出さない）。
- **容量見込み**: 現行 513 本 / 約 1,300 カットで **約 7〜10 MB**、将来 A- 以上 3,000 本（約 8,000 カット）でも **約 45〜55 MB**（無料枠 `5 GiB` の約 1%）。
- **`videoScenes` との関係（疎結合・重複集約）**:
  - 両テーブルとも `videos.id` を親とする並列の子テーブル（1:1 の外部キーで縛らない）。
  - 区間オーバーラップ条件 `c.videoId = s.videoId AND c.startSec < s.endSec AND c.endSec > s.startSec`（例：`IoU >= 0.4`）で相互参照し、統合検索時は **「レシピ優先＋シーン補完」** で同一動画・重複時間帯を `craftRecipes` カード 1 枚に集約する。

### 5-3. 品質ガード・API・詳細画面 UI（Phase 2A）

- **投入開始前提条件（確定方針）**：`chibatmute` による 381 本修復と `CRAFT_RECIPE_DISTRIBUTION_DESIGN.md` 運用完了後に投入する。
- **自動ガード（fail-closed）**：
  - 未視聴動画（`videos.analysisObservationScope IS NOT NULL`）の拒否。
  - MCP 検索除外中の 16 本（`provisional` 4 本 ＋ `invalidated_no_visual` 12 本）の非表示ガード（同期時除外＋`recipes.byVideoId` 側でも `aiScoreBreakdown` を検証する二重防御）。
  - ローカルパス漏洩ガード（Windows 絶対パス・`data/craft_recipes/` が含まれていれば拒否）＋秘密情報スキャン 0 件。
  - 再カットで減った旧 `cutIndex` は当該 `videoId` のみ事前バックアップ後にクリーンアップ（全表 `TRUNCATE` 禁止）。
- **API**：`recipes.byVideoId`（`publicProcedure`、PK 先頭一致 `<20 ms`、動画詳細モーダル展開時のみオンデマンド呼出で一覧ロードへの影響ゼロ）。
- **詳細画面 UI（`CraftRecipeSection.tsx` を `VideoModal.tsx` に配置・一覧カードへのバッジは Phase 2A では付けない）**：
  1. セクションヘッダー：カット数、`v2準拠`（緑）または **`旧形式 (v1)`（アンバー＋未収録注記）**、出どころ（`手元実測` / `API下書き`）、信頼性スコア、テキスト先行表示の注記。
  2. カット切替タブ（`Cut #1`, `Cut #2`, ...）：タイムコード、カテゴリ、主ツール、YouTube 秒数ジャンプ連携、`expressive_purpose` の `intent_summary`・`narrative_role`・`viewer_effect`・`keywords` タグ（`search_phrases` は非表示）。
  3. 制作スタック＆ 60-30-10 カラーパレット（HEX コピー付）＆イージング／タイミング（`verified/inferred` 表示）。
  4. 折りたたみアコーディオン：`recreation_flow`、`layer_stack`、`effect_chain`、`frame_timeline`、`anti_ai_slop_notes`、`audio_sync_cues`、`transition_bridge`、`avoid_when`。
  5. コピーボタン：1 カット分の構造化 JSON / Markdown コピー。

---

## 6. 段階 3 詳細設計：TiDB ベクトル検索 ＆ API キー安全管理（案 B ログイン限定・未実装）

> **決定事項（2026-11-26 確定）**: 段階 3 のベクトル検索は **「案 B（ログイン済みユーザー限定）」** で進める。本ドキュメントでは設計のみ確定し、**実装・API キー発行・Vercel 環境変数設定・DDL 実行は今回行わない**。

### 6-1. 公開範囲と案 B の動作仕様
- **未ログイン公開ユーザー**：段階 1〜2 のキーワード／類義語／語彙タグ検索（`videoScenes.searchText` ＋ `craftRecipes.purposeSearchText`、`\$0`）をそのまま利用可能。Embedding API は一切呼ばない。
- **ログイン済みユーザー（`@atsu-maru.co.jp` ログイン済み＝`isAllowedEditorUser` 相当）**：自然文検索時に TiDB HNSW ベクトル検索（`VECTOR(768)`、`gemini-embedding-2`）を実行し、段階 1〜2 のキーワード検索結果とアプリ側 RRF（Reciprocal Rank Fusion）で統合して返却する。
- **埋め込み生成テキストに含める項目**：`shotTitle` / `title` ＋ `description` ＋ `expressive_purpose.intent_summary` ＋ **`expressive_purpose.search_phrases`（言い換え文すべて）** ＋ `expressive_purpose.keywords` ＋ `narrative_role` ＋ `viewer_effect`。

### 6-2. 鍵の配置・権限分離・レート制限・予算管理設計

| 管理項目 | 設計方針（案 B 確定仕様） |
|---|---|
| **1. 鍵の置き場所** | **Vercel のサーバー側環境変数のみ**（例：`GEMINI_SEARCH_EMBED_API_KEY`、Production / Preview のサーバーランタイム限定）。`VITE_` プレフィックスは絶対に使わず、ブラウザ JS・API レスポンス・エラー文・ログへ一切出力しない。 |
| **2. 権限を絞った専用の別鍵** | 採点・レシピ生成用 `GEMINI_API_KEY` とは**完全に別の API キー**を発行する（API 制限を Generative Language API のみに絞り、名称 `iketeru-site-search-embed-only` として用途分離）。検索側の制限や上限停止がバッチ処理に波及しない。 |
| **3. 呼び出し制御（案 B＋多層防御）** | ・**認証ゲート（案 B）**：サーバー側でログインセッション（`@atsu-maru.co.jp` / `admin`）を検証し、未ログイン時は自動的に段階 1〜2（キーワード検索）へ分岐。<br>・**不要呼出の抑制**：クライアント 500ms デバウンス ＋ 短語（1 語・2 文字以下やタグクリックのみ）は段階 1〜2 で処理 ＋ クエリ正規化キャッシュ（TiDB `searchQueryEmbeddingCache`、TTL 7〜30 日）。<br>・**レート制限**：ユーザー／IP 単位（10 回/分・60 回/時）＆サーバー全体（60 回/分）。 |
| **4. 障害・超過時の縮退動作** | 未ログイン・レート超過・月間上限到達・API タイムアウト（2 秒）・鍵未設定のいずれでも **HTTP 500 にせず、自動で段階 1〜2（キーワード検索）へ透過フォールバック** し、UI に控えめな注記を出す。 |
| **5. 月間上限額と台帳記録** | ・**月間ハード上限（サーバー側）**: **`\$2.00 / 月`**（1 万検索 ≒ `\$0.06` のため通常利用で 30 万検索超に相当し、異常連打時も `\$2.00` で自動遮断）。<br>・**GCP 安全策**: 自動チャージ OFF 維持 ＋ Billing Budget Alert（`\$2` / `\$5`）＋ GCP Quotas 設定。<br>・**台帳記録**: TiDB に日次集計テーブル `searchEmbeddingUsageDaily (usageDate, apiCalls, cacheHits, inputTokens, estimatedCostUsd)` を記録し、`analysis/api_url_budget_ledger.json`（`purpose: "site_search_query_embedding"`）へ反映して月間全体枠と一元管理する。 |

---

## 7. 作業量見積もりと本番変更前の承認ゲート

### 7-1. 作業量の見積もり

| 作業項目 | 主な内容・対象ブランチ | 見積もり作業量 | 状態 |
|---|---|---|---|
| **C. Vercel 自動デプロイ制御** | `vercel.json` の `ignoreCommand`（`chore/vercel-ignore-docs` / PR #2） | 約 15〜30 分 | **実装・プレビュー確認済（マージ待ち）** |
| **A. 段階 1：シーン検索 API 化** | `videoScenes` DDL・`sync-scenes-to-tidb.mjs`（dry-run / stale 検出 / `--prune-stale`）・tRPC `scenes` API・校正済み点数絞り込み修正・UI（`feature/scenes-tidb-api`） | 約 1.0〜1.5 日 | **コード実装・dry-run 済（PR マージ・DB `--apply` 承認待ち）** |
| **A'. 分析の版管理・表示** | `analysis_version` / `videoAnalysisHistory` 移行 DDL 案・API・動画/シーン UI 表示・旧分析除外フィルタ（`feature/analysis-version`） | 約 0.5〜1.0 日 | **プレビュー実装中（DDL 実行・マージ承認待ち）** |
| **B. 段階 2：クラフトレシピ表示＆カット統合検索** | `craftRecipes` DDL・同期スクリプト・`recipes.byVideoId`・`CraftRecipeSection.tsx`・`search_phrases`/`keywords` カット検索統合 | 約 1.0〜1.5 日 | `chibatmute` 381 本修復完了後に着手 |
| **D. 段階 3：ベクトル検索（案 B ログイン限定）** | TiDB `VECTOR(768)` + HNSW・専用 API キー・RRF 統合・日次コスト台帳 | 約 1.0 日 | 設計確定済み・段階 2 完了後に承認取得して着手 |

### 7-2. 本番 DB・本番サイト変更前にユーザー承認が必要な実行ゲート
1. **PR マージ承認**：PR #1（`feature/unwatched-warning`）、PR #2（`chore/vercel-ignore-docs`）、`feature/scenes-tidb-api`、`docs/site-cut-search-design`、`feature/analysis-version`。
2. **`videoScenes` テーブル作成 ＆ 初期投入（`--apply`）の実行承認**：`node scripts/sync-scenes-to-tidb.mjs --dry-run` の実測出力（DDL、投入予定 35,768 行 / 4,555 本、校正済み点数帯内訳、stale 検出、容量見積もり約 38 MB、既存 `videos` 無変更）を確認後に `_apply_lock.json` 経由で実施。
3. **`analysis_version` 列追加 ＆ `videoAnalysisHistory` テーブル作成 DDL の実行承認**：`chibatmute` の v3.1 書き込み手順と項目名を最終突合したうえで実施。
4. **静的 `scenes_index.json`（3.17〜3.32 MB × 2）の最終削除タイミング**：`videoScenes` 本番稼働と検索確認が済んだ後、別 PR で撤去。
5. **`craftRecipes` テーブル作成 ＆ 初期投入、および段階 3 専用鍵発行・ベクトル検索 DDL**：それぞれの段階着手前に別途承認を取得。
