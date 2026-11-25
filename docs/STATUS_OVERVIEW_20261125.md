# イケ動（iketeru-eizou）全体現状整理：動画生成への活用可能性

- **調査日時**: `2026-11-25 15:35 JST`（`chibatmute`・読み取り専用調査）
- **参照ソース**:
  - 本番 TiDB `iketeru_eizou.videos`（**5,653 本**、実測 `SELECT`）および自動化テーブル 4 種
  - ローカル SQLite `E:\iketeru-creative-studio\data\iketeru_knowledge.db`（**5,653 本**・読み取り専用 `?mode=ro`）
  - ローカル動画キャッシュ `D:\マイドライブ\iketeru_videos`
  - リポジトリコード・ドキュメント（`E:\iketeru-eizou` / `E:\iketeru-creative-studio`）
  - ※ `docs/API_URL_SCORING_DESIGN.md` は現在 `CHIBA-PC` で作成中（D-018）のため本機 `docs/` に未配置。Gemini API YouTube URL 方式の前提は `docs/DECISIONS.md`（D-017・D-018）および `analysis/pilot_gemini_api_url/anchor_12_summary.json` の実測値を参照。

---

## 1. 動画ごとの分析状況（TiDB 5,653 本 × SQLite × キャッシュ実測）

### 1-1. 各層の充足状況

| 層 | 定義・参照元 | 該当本数 | 全体比（/ 5,653） | 備考 |
|---|---|---:|---:|---|
| **詳細分析 (`aiAnalysis`)** | TiDB `CHAR_LENGTH(TRIM(aiAnalysis)) > 0` | **5,471** | 96.8% | うち 500 文字以上 `5,442` / 500 文字未満 `29` / 空 **`182`**。SQLite で `>=2,000` 文字（`has_full_analysis=1`）は **`4,590`** 本 |
| **実視聴済み詳細分析** | `aiAnalysis` あり かつ `analysisObservationScope IS NULL` | **5,197** | 91.9% | 未視聴タグ付き `274` 本を除外した実視聴分析 |
| **未視聴・要確認タグ** | TiDB `analysisObservationScope IS NOT NULL` | **274** | 4.8% | すべて `aiAnalysis` 本文あり（詳細は 1-3） |
| **シーン分解 (`scenes`)** | SQLite `scenes` テーブルに 1 行以上あり | **4,555** | 80.6% | 総シーン数 **35,768 件**（未生成 `1,098` 本） |
| **クラフトレシピ (`craft_recipes`)** | SQLite `craft_recipes` テーブルに 1 行以上あり | **439** | 7.8% | 総レシピ数 **1,036 件**（うち v2 準拠〔`frame_timeline` + `effect_chain` + `primary_tool`〕は **120 本 / 241 件**） |
| **旧来スコア（数値）** | TiDB `aiOverallScore IS NOT NULL` | **4,566** | 80.8% | 旧ランクのみ（数値なし）`686` 本。旧来スコア／ランク計 **5,252 本** |
| **Phase 3 校正済み点数** | TiDB `calibratedScore IS NOT NULL` | **939** | 16.6% | `calibrated_verified`: **556** / `calibrated_unverified_genre`: **383** / `legacy_uncalibrated`: `4,314` / `unscored`: `400`（※直近 `CHIBA-PC` 反映 27 本を含む。`chibatmute` SQLite は未同期のため `912` 件） |
| **私的評価 (`privateRating`)** | TiDB `privateRating IS NOT NULL` | **492** | 8.7% | — |
| **ローカル動画キャッシュ** | `D:\マイドライブ\iketeru_videos` に 0B 超ファイルあり | **1,013** | 17.9% | 未キャッシュ `4,640` 本 |

- **Phase 3 校正済み 939 本の run 内訳**: `run_20261123_192500` (200), `run_20261123_221100` (193), `run_20261124_080300` (184), `run_20261124_151553` (200), `run_20261125_070347` (135), `run_20261125_113036` (14), `run_20261125_113041` (13)。

### 1-2. どの層まで済んでいるかの組み合わせ表（計 5,653 本）

| 詳細分析の状態 | `scenes` | `craft_recipes` | 合計本数 | うち校正済み (`Cal`) | うち旧数値スコアのみ (`LegacyOnly`) | うち数値スコアなし (`NoScore`) | 動画生成への活用度 |
|---|---|---|---:|---:|---:|---:|---|
| **実視聴分析あり** (`watched_A`) | **あり** | **あり** | **381** | 319 | 61 | 1 | **即戦力（全層あり）** |
| **実視聴分析あり** (`watched_A`) | なし | **あり** | **58** | 58 | 0 | 0 | レシピありだが `has_full_analysis=0`（500〜650 字の短縮版）でシーン欠損 |
| **実視聴分析あり** (`watched_A`) | **あり** | なし | **4,158** | 138 | 3,890 | 130 | 参考検索・シーン検索・ペーシング分析に利用可（レシピ未作成） |
| **実視聴分析あり** (`watched_A`) | なし | なし | **600** | 415 | 102 | 83 | テキスト検索のみ可（Ch.3 形式不一致／2,000 字未満でシーン欠損） |
| **未視聴分析** (`unwatched_A`) | あり | なし | **16** | 0 | 15 | 1 | `triage_unverified_short`（要白黒確認・手本除外対象） |
| **未視聴分析** (`unwatched_A`) | なし | なし | **258** | 8 | 7 | 243 | 動画未視聴のため手本不可（うち 8 本は直近ブラインド採点済みだが分析本文は未視聴版のまま） |
| **詳細分析なし** (`no_A`) | なし | なし | **182** | 1 | 15 | 166 | メタデータのみ（うち 1 本 `_F6oRAbEoLY` のみ校正済み） |
| **合計** | — | — | **5,653** | **939** | **4,090** | **624** | — |

> **補足（`watched_A` で `scenes` が無い 658 本＝600+58 の原因）**: 658 本のうち **620 本**には本文中に `## 3.` 見出しが存在するが、**585 本**は SQLite 側で `has_full_analysis = 0`（`aiAnalysis` が 2,000 文字未満の短縮版）、あるいは Ch.3 の `- #NN 【MM:SS-MM:SS】` 形式と一致しないため `parse_scenes()` が 0 件になっている。

### 1-3. 未視聴・要確認タグ（`analysisObservationScope` 274 本）の内訳

| 区分 (`analysisObservationScope`) | 合計 | YouTube | Vimeo | キャッシュあり | キャッシュなし | 層の状態 |
|---|---:|---:|---:|---:|---:|---|
| `metadata_only_unwatched`（メタデータのみ） | **249** | 12 | 237 | 8（すべて Vimeo） | 241（Vimeo 229 / YT 12） | `scenes`: 0 / `craft`: 0 / 校正済み: **8**（キャッシュ済 Vimeo） |
| `triage_boilerplate_unwatched`（定型速報のみ） | **8** | 8 | 0 | 0 | 8 | `scenes`: 0 / `craft`: 0 / 校正済み: 0 |
| `triage_unverified_short`（短文速報・実測なし） | **17** | 17 | 0 | 0 | 17 | `scenes`: **16** / `craft`: 0 / 校正済み: 0 |
| `missing_video_unwatched`（動画未取得明記） | **0** | 0 | 0 | 0 | 0 | （旧 SQLite 孤立 2 本は D-015 で削除済み） |
| **合計** | **274** | **37** | **237** | **8** | **266** | `craft_recipes` との重複は **0 本** |

### 1-4. 配信サイト × ローカルキャッシュの有無（計 5,653 本）

| 配信サイト (`platform`) | 合計本数 | 構成比 | キャッシュあり | キャッシュなし | 備考 |
|---|---:|---:|---:|---:|---|
| `youtube` | **4,718** | 83.5% | 390 | 4,328 | 直接アクセス保留中（D-016）。Gemini API URL 方式の対象 |
| `vimeo` | **927** | 16.4% | 617 | 310 | 未キャッシュ 310 本は未認証取得不可（D-014・`_vimeo_login_required_list.json`） |
| `external` | **5** | 0.1% | 5 | 0 | すべてキャッシュあり |
| `instagram` | **3** | 0.1% | 1 | 2 | 未キャッシュ 2 本も `_vimeo_login_required_list.json` に記録済み |
| **合計** | **5,653** | **100.0%** | **1,013** | **4,640** | — |

- なお TiDB の `embedStatus` 全体内訳は `available`: **4,004** / `unknown`: **1,076** / `restricted`: **573**。

### 1-5. 登録日（`addedDate`）ごとの分布と直近 1 か月（`2026-10-26` 〜 `2026-11-25`）

※ `createdAt` は Manus → TiDB 移行時（2026-11）の一括投入日時のため全 5,653 本が直近 30 日扱いとなる。実際の登録時期は `addedDate` を基準に集計。

| 期間 (`addedDate`) | 登録本数 | 実視聴分析 (`watched_A`) | 未視聴分析 (`unwatched_A`) | 分析なし (`no_A`) | `scenes` あり | `craft` あり | 旧数値スコア | 校正済み (`Cal`) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 2017〜2022年計 | 395 | 346 | 43 | 6 | 221 | 17 | 212 | 133 |
| 2023年計 | 390 | 372 | 15 | 3 | 346 | 6 | 343 | 30 |
| 2024年計 | 427 | 416 | 10 | 1 | 381 | 10 | 379 | 28 |
| 2025年計 | 1,305 | 1,275 | 11 | 19 | 1,174 | 129 | 1,201 | 160 |
| 2026-01〜03 | 130 | 127 | 2 | 1 | 121 | 3 | 119 | 7 |
| 2026-04〜06 | 417 | 388 | 9 | 20 | 377 | 22 | 369 | 39 |
| 2026-07 | 625 | 529 | 55 | 41 | 498 | 30 | 486 | 70 |
| 2026-08 | 1,080 | 959 | 89 | 32 | 696 | 163 | 688 | 392 |
| 2026-09 | 261 | 249 | 3 | 9 | 248 | 21 | 243 | 26 |
| 2026-10 | 279 | 258 | 0 | 21 | 252 | 18 | 250 | 22 |
| 2026-11 | 344 | 278 | 37 | 29 | 241 | 20 | 276 | 32 |
| **直近 1 か月 (`>= 2026-10-26`)** | **574** | **487 (84.8%)** | **37 (6.4%)** | **50 (8.7%)** | **444 (77.3%)** | **36 (6.3%)** | **477 (83.1%)** | **51 (8.9%)** |

- **直近 1 か月（574 本）の内訳**: YouTube `508` / Vimeo `64` / Instagram `2`（キャッシュあり `51` 本）。主な登録元は `manual` (139), `サイト: 映像作家100人` (127), `トレンド: YouTube (公式MV)` (54), `manual_sheet` (39), `トレンド: YouTube (モーショングラフィックス)` (33), `vook_iketeru` (20) 等。
- **直近 1 か月の層到達**: 「実視聴分析＋シーン＋レシピ」まで完了しているのは **36 本（6.3%）**（うち校正済み 28 / 旧スコア 7 / スコアなし 1）。一方、`scenes` 止まり（レシピ未作成）が **405 本（70.6%）**、詳細分析なしが **50 本（8.7%）**、未視聴タグ付きが **37 本（6.4%）** 残っている。

---

## 2. 新しく入ってくる動画の流れ（現状と詰まっている箇所）

### 2-1. 入口〜サイト表示・動画生成までの実態

| 工程 | 仕組み・コード | 自動 / 手動 | 現状の稼働状態 |
|---|---|---|---|
| **① 候補収集（Web・採用系）** | `.github/workflows/daily-recruit-crawler.yml`（毎日 04:00 JST）＋ `scripts/gas/corporate_recruit_collector.gs`（GAS） | **一部自動**（シート追記のみ） | Playwright / GAS が **Google スプレッドシート（「動画リスト」）へ追記するだけ**で、TiDB には直接入らない。 |
| **② サーバー側定期収集・メタ自動補完** | `server/dailyCollection.ts` / `server/aiMetadataCompletion.ts` | 設計上は自動（Cron / 常駐） | **未稼働（停止）**。TiDB の `dailyCollectionSources` / `dailyCollectionRuns` / `aiMetadataCompletionJobs` / `aiMetadataCompletionRuns` は **すべて 0 行**。`vercel.json` にも `crons` 設定がなく、`startPersistentAiMetadataWorker` は Vercel Serverless では動作しない。さらに `aiMetadataCompletion.ts` は仕様上 `aiAnalysis` と評価を常に空文字にする。 |
| **③ 動画取得・詳細分析・TiDB 登録** | ローカル実行 `scripts/analyze_new_videos_workflow.py`（`yt-dlp` → 4×4 コンタクトシート＋`ffmpeg scdet` → 並列分析 → `upsert-new-videos.mjs`）や個別収集スクリプト群 | **完全手動** | **実質ブロック中**。YouTube はボット確認により直接取得を保留（D-016）、未キャッシュ Vimeo はログイン必須で取得中止（D-014）。 |
| **④ 校正済み採点（Phase 3）** | `scripts/claim-phase3-batch.mjs` → `prepare-phase3-batch.mjs` → サブエージェント採点 → `apply-phase3-batch-to-tidb.mjs` | **完全手動**（複数 PC 協調） | キャッシュ済み非 YouTube の消化が進行中（現在 TiDB 939 件）。未キャッシュ YouTube 向けは Gemini API URL 方式（D-017・D-018）の設計書承認待ち。 |
| **⑤ TiDB → Web サイト反映** | Vercel Serverless (`server/db.ts` → `videos.list` / `videos.get`) | **自動（即時参照）** | TiDB に書いた `videos` 行（メタデータ・`aiAnalysis`・`calibratedScore` 等）はサイトに即反映。ただしサイト側 `scenes_index.json` は静的ファイルで **2026-11-19 時点（342 本 / 5,288 シーン）のまま停止**。 |
| **⑥ TiDB → ローカル SQLite 同期 & `scenes` 生成** | `scripts/sync-tidb-to-sqlite-mirror.mjs`（校正列＋未視聴列のみ）／ MCP `sync_database` + `hydrate_missing_analyses`（カタログ＋`aiAnalysis` 全文＋`parse_scenes`） | **完全手動**（各 PC ごと） | 同期遅れが発生中（`chibatmute` SQLite は TiDB 939 件に対し 912 件で 27 件遅れ、`aiAnalysis` も 1 本未同期）。また `aiAnalysis` が 2,000 文字未満または Ch.3 記法不一致の 658 本は `scenes` が生成されない。 |
| **⑦ `craft_recipes` 生成** | `iketeru-creative-studio`（`craft_recipes.py` の `ingest_batch_craft` 等、実動画から ffmpeg で GIF/PNG 切り出し＋JSON 作成） | **完全手動**（1 台のレシピ担当機のみ） | **最大のボトルネック**。439 本（全体の 7.8%）、うち v2 準拠は 120 本（2.1%）にとどまり、TiDB にも未格納（ローカル SQLite + `data/craft_recipes/` 依存）。 |

### 2-2. 流れが止まっている・詰まっている箇所まとめ
1. **入口と DB の断絶**: GAS／GitHub Actions がスプレッドシートに積んでも、TiDB 投入・詳細分析は完全手動（TiDB 内の自動収集・自動補完ジョブテーブルも全 4 テーブル 0 行）。
2. **動画実体の取得ブロック**: YouTube 直接アクセス保留（D-016）と Vimeo ログイン必須（D-014）により、未キャッシュ 4,640 本のローカル取得ルートが止まっている。
3. **SQLite 同期の二重構造と遅れ**: `sync-tidb-to-sqlite-mirror.mjs` は校正列・未視聴列の安全な片道同期のみで、新規動画の全文分析・`scenes` 再パースは別途 `sync_database` / `hydrate` を手動実行する必要がある。
4. **`scenes` 抽出の取りこぼし**: `aiAnalysis` がある実視聴動画のうち 658 本が、`has_full_analysis=0`（2,000 文字未満）や Ch.3 記法ズレで `scenes` 0 件になっている。
5. **`craft_recipes` の量産不足とローカル閉鎖**: 動画生成（`plan_craft_sequence`）の直接素材になる `craft_recipes` が 439 本（v2 は 120 本）しかなく、実動画ファイル依存・1 台手動バッチ運用のため新規流入に追いついていない。
6. **Web サイトの静的シーン索引の陳腐化**: `client/public/scenes_index.json` が 2026-11-19 の 342 本（5,288 シーン）で止まっており、DB/SQLite 側の 4,555 本（35,768 シーン）と大きく乖離。

---

## 3. 動画生成（`iketeru-creative-studio` MCP）で使われているデータ層と点数

`E:\iketeru-creative-studio\iketeru_studio\`（`mcp_server.py`, `indexer.py`, `macro_planner.py`, `craft_recipes.py`）のコード実測結果：

### 3-1. MCP ツールごとの参照層とフィルタ条件

| MCP ツール | 参照テーブル／層 | `has_full_analysis=1` 必須 | `exclude_unwatched` 既定値 | 動画生成での役割 |
|---|---|---:|---:|---|
| `search_references` | `videos` + `videos_fts`（タグ・クレジット・`client_pitch`・`ai_analysis`） | いいえ | `False`（バッジ付き表示） | 企画段階のリファレンス探索 |
| `search_scenes` | `scenes` + `scenes_fts` + `videos` | **はい**（4,590 本が母数） | `False`（バッジ付き表示） | カット単位・タイムスタンプ付き参考検索 |
| `get_video_playbook` | `videos.sections_json`（Ch.0〜9 + `clientPitch`）＋ `scenes` ＋ `craft_recipes` | いいえ（未取得時はライブ取得） | なし（バッジ返却） | 個別作品の演出分解書読み出し |
| `get_pacing_benchmarks` | `videos`（タグ・制作規模）＋ `scenes`（ブロック尺・冒頭フック尺） | **はい** | **`True`** | 目標ジャンルのテンポ基準値算出 |
| `get_anti_patterns` | `videos.sections_json`（Ch.8/Ch.7 失敗要因） | **はい** | **`True`** | 低評価作からの失敗回避ルール抽出 |
| `search_craft_recipes` | `craft_recipes` + `craft_recipes_fts` + `videos`（**439 本 / 1,036 件が母数**） | いいえ（`technique_score >= A-` 既定） | **`True`** | AE/Blender/コード再現用のカットレシピ検索 |
| `get_craft_recipe` | `craft_recipes` + `videos` | いいえ | **`True`** | 1 作品の再現フロー・パレット・GIF/PNG 取得 |
| `plan_craft_sequence` | **`craft_recipes`（主軸）**＋`videos`（タグ・Ch.8 アンチパターン）＋`scenes`（`get_pacing_benchmarks`）＋ローカル資産（フォント） | 間接的に参照（ベンチマーク／アンチパターン） | **`True`** | **動画生成用マクロ設計図（カット構成・パレット・遷移・AE/コード設計）の生成** |

### 3-2. 校正済み点数（`calibrated_score`）の検索・並び順での使われ方

コード実測上、**既定値（`calibration_filter = "all"`）のままでは、ほとんどの検索ツールで校正済み点数は並び順に使われていない**：

1. **`search_references` / `search_scenes` / `get_pacing_benchmarks`**:
   - `calibration_filter = "all"`（既定）: **旧 `overall_score`（15 段階ランク）降順のみ**。`calibrated_score` は結果 JSON に表示されるだけで、ソートにも `min_rating` フィルタにも使われない。
   - `calibration_filter = "calibrated_only"` / `"calibrated_verified_only"` を明示指定した時だけ、SQL の `ORDER BY` が `COALESCE(v.calibrated_score, -1) DESC` に切り替わる（ただし `min_rating` フィルタ自体は依然として旧 `overall_score` を参照）。
2. **`get_anti_patterns`**:
   - 常に旧 `overall_score ASC, overall_score_100 ASC` 固定。`calibrated_score` はフィルタ（`calibration_filter`）と返却フィールドのみで、並び順には未使用。
3. **`search_craft_recipes`**:
   - 抽出条件の `min_technique_rating="A-"` は旧 `c.technique_score` を参照。`calibrated_score` は `calibration_filter != "all"` の時だけソートキー（タイブレーカー）に入る。
4. **`plan_craft_sequence`（唯一 `all` でも `calibrated_score` が効く）**:
   - `macro_planner.py` L518–545 にて、`calibrated_score` があるレシピには IDF 関連度スコアへ品質乗数 `quality_mult` を掛ける（`calibration_filter="all"` 時は `0.85 + 0.30 × (score/100)`、`calibrated_*` 時は `0.65 + 0.65 × (score/100)`。未校正は `1.0`）。さらに同点時のタイブレーカーにも `calibrated_score DESC` を使用。

---

## 4. 全体まとめ・ギャップ整理・YouTube URL 詳細分析の見積もり

### 4-1. 動画生成に使える状態の本数
- **厳密なフル完備（実視聴 `aiAnalysis` ＋ `scenes` ＋ `craft_recipes`）**: **381 本**（全体の **6.7%**）
  - うち Phase 3 校正済み: **319 本** ／ 未校正: **62 本**
- **レシピありだが `scenes` 欠損（短縮分析のため `has_full_analysis=0`）**: **58 本**（レシピ保有総数は **439 本**、うち v2 準拠は **120 本**）
- **企画・構成・シーン検索まで使える状態（実視聴 `aiAnalysis` ＋ `scenes`、レシピ未作成）**: **4,158 本**（全体の **73.6%**）

### 4-2. 足りない層ごとの本数（優先して埋めるべき順）

| 優先順 | 足りない層・課題 | 対象本数 | 理由（動画生成へのインパクト） |
|---:|---|---:|---|
| **1** | **実視聴分析あり＋`scenes` ありだが `craft_recipes` がない動画**（とくに校正済み上位／高技術作） | **4,158 本**（うち校正済み **138 本**、さらに `no_S & C` の 58 本の `scenes` 補完も軽量） | `plan_craft_sequence` が直接引く母数が現状 439 本（v2 は 120 本）しかなく、表現バリエーションの最大ボトルネック。 |
| **2** | **SQLite ミラーの最新化 & `scenes` 欠損の復旧** | 校正遅れ **27 本**、SQLite `aiAnalysis` 未同期 **1 本**、実視聴分析あり `scenes` 欠損 **658 本**（うち 58 本はレシピあり） | 低コスト（API 消費なしまたは少数再生成）で既存の `search_scenes` / `get_pacing_benchmarks` 母数を底上げできる。 |
| **3** | **詳細分析が空 (`no_A`) ＋ 未視聴タグ (`unwatched_A`) のうち YouTube 分** | **157 本**（分析なし `120` ＋ 未視聴 `37`） | 未分析の穴と「未視聴推測」を埋められる（YouTube のため Gemini API URL 方式で社内回線を使わず処理可能）。 |
| **4** | **Phase 3 校正済み点数の拡充（および MCP 既定ソートの切替検討）** | 未校正計 **4,714 本**（`legacy_uncalibrated: 4,314` + `unscored: 400`） | 校正済みが 16.6%（939 本）にとどまり、MCP の既定 `calibration_filter="all"` では `plan_craft_sequence` 以外の並び順に校正スコアが効いていない。 |
| **5** | **未視聴 Vimeo（キャッシュ済み 8 本のローカル再分析／未キャッシュ 229 本＋分析なし非 YouTube 62 本）** | キャッシュ済 **8 本**（即時可）／ 未キャッシュ非 YT **291 本**（保留） | キャッシュ済み 8 本はローカル再分析可能。未キャッシュ Vimeo/Instagram はログイン必須（D-014）かつ Gemini API URL 非対応のため現状手段なし。 |

### 4-3. Web サイト表示内容と DB（TiDB / SQLite）内容との差

| 項目 | 本番 TiDB / ローカル SQLite | Web サイト（`server/db.ts` + `client/src`） | ギャップの影響 |
|---|---|---|---|
| **校正済みスコア (`calibratedScore` 等)** | TiDB **939 件**（SQLite は未同期で 912 件） | **表示・フィルタ・ソート対応済み**（`VideoCard.tsx`, `VideoModal.tsx`, `Home.tsx`） | サイトは TiDB 直参照のため最新 939 件が即表示される（SQLite 側が 27 件遅れ）。 |
| **未視聴タグ (`analysisObservationScope`)** | TiDB・SQLite ともに **274 件**付与済み | **`drizzle/schema.ts` / `server/db.ts` / UI すべて未実装** | サイト上では未視聴・メタデータのみの 274 本に警告が出ず、通常分析と区別できない。 |
| **シーン検索 (`scenes`)** | SQLite に **4,555 本 / 35,768 シーン** | `client/public/scenes_index.json` の静的ファイル（**342 本 / 5,288 シーン**、2026-11-19 更新） | サイトのシーン検索は DB 全体の **7.5%（342/4,555 本）** しか検索できない。 |
| **クラフトレシピ (`craft_recipes`)** | SQLite に **439 本 / 1,036 件** | **未対応（非表示・API なし）** | Web UI からはクラフトレシピの有無・中身を確認できない（MCP 専用）。 |
| **未視聴本文 × 校正済みスコアの混在** | `metadata_only_unwatched` のうち **8 本**が直近で実動画ブラインド採点済み | `calibratedScore` と未視聴 `aiAnalysis` が並んで表示される | 点数は実視聴ベースだが、詳細分析テキストは未視聴メタデータ版のまま残っている。 |

### 4-4. Gemini API（YouTube URL 直接渡し）を「詳細分析の作成」に使う場合の対象本数見積もり

- **前提（D-017・D-018 および `analysis/pilot_gemini_api_url/anchor_12_summary.json` より）**:
  - Gemini API が URL を直接取得できるのは **YouTube のみ**（Google サーバー側取得のため社内回線から YouTube へアクセスしない）。
  - 採点パイロット（10 本×2 回 = `$1.72`）では 1 呼び出し平均約 **`$0.086`**（Standard）、Flex（半額想定）で約 **`$0.043`/呼び出し**。詳細分析は出力トークンが採点 JSON より長いため、実単価は出力長次第で上振れする点に留意が必要。

| 対象スコープ（YouTube 全 4,718 本のうち） | 総本数 | うち `embedStatus != restricted`（優先有効母数） | うち `embedStatus = restricted`（取得失敗リスク高） | 備考 |
|---|---:|---:|---:|---|
| **① 詳細分析が空 (`no_A`) の YouTube** | **120 本** | **61 本** | 59 本 | キャッシュあり 1 / なし 119 |
| **② 未視聴タグ (`unwatched_A`) の YouTube** | **37 本** | **29 本** | 8 本 | `metadata_only`: 12, `triage_boilerplate`: 8, `triage_unverified_short`: 17（全 37 本未キャッシュ） |
| **小計（①＋②：新規作成・やり直し必須の YouTube）** | **157 本** | **90 本** | **67 本** | まず最優先で詳細分析を作るべき対象 |
| **③ 実視聴分析ありだが `scenes` 欠損 (`watched_A & no_S`) の YouTube** | **97 本** | **69 本** | 28 本 | 2,000 字未満・Ch.3 形式不一致の復旧対象 |
| **合計（①＋②＋③：分析〜`scenes` 層を揃える YouTube）** | **254 本** | **159 本** | **95 本** | `scenes` 抽出まで含めた詳細分析整備の上限規模 |
| *参考：④ 分析・シーンはあるが `craft_recipes` なしの YouTube* | *4,149 本* | — | — | テキスト仕様は生成できても、GIF/PNG キーフレーム切り出しは実動画ファイルが別途必要 |
| *対象外：YouTube 以外（Vimeo / Instagram）* | *分析なし 62 本 ＋ 未視聴 237 本 = 299 本* | — | — | Gemini API URL 直接渡し不可（うちキャッシュ済み未視聴 Vimeo 8 本のみローカル処理可） |

---

## 5. サイトのシーン検索更新・未視聴警告・クラフトレシピ表示の見積もり（追記）

### 5-1. `client/public/scenes_index.json` を SQLite 最新（4,555 本・35,768 シーン）から作り直す場合

#### 現行構造と実測サイズ
- 現行の `client/public/scenes_index.json`（342 本・5,288 シーン）は **3.17 MB**（gzip **0.45 MB**、1 シーン平均 `628.1 bytes`）。
- **重大な注意点（表示速度への影響）**: `client/src/lib/sceneSearch.ts` L7 が `import fallbackScenes from "./scenes_index.json";` で同内容の **`client/src/lib/scenes_index.json`（3.17 MB）を Vite の JS バンドルに静的同梱**している。シーン検索を使わない通常トップ閲覧でも初回ロードに 3.17 MB が乗っている状態。

#### 35,768 シーン全量でそのまま作り直した場合の実測見積もり

| 形式 | 非圧縮サイズ | gzip 転送サイズ | 評価 |
|---|---:|---:|---|
| 現行 `SceneItem` 形式そのまま（`keywords` 空） | **20.74 MB** | **5.07 MB** | 単一 JSON として過大 |
| 現行と同密度の `keywords` 付き推計 | **約 21.43 MB** | **約 5.2〜5.5 MB** | 静的同梱すると初回表示が破綻 |
| 配列タプル圧縮形式（`[vid, idx, start, end, title, desc]`） | **10.38 MB** | **4.02 MB** | 転送は軽くなるが初回パース負荷は残る |

- **サイト表示速度への影響**:
  1. 現行どおり `client/src/lib/scenes_index.json` を更新すると **初回 JS バンドルが 21 MB 超に膨張**し、初回表示・メモリ消費（特にモバイル）が致命的に悪化する。
  2. 静的 `import` を撤去して `/scenes_index.json` の遅延 fetch に変更しても、シーン検索初回に **gzip 5 MB 転送＋21 MB JSON パース＋35,768 件の JS メインスレッド全件走査**が発生し、検索のたびに数百 ms〜数秒の UI ブロックが起きる。

#### 推奨手順とアーキテクチャ比較

| 案 | 方式 | メリット | デメリット | 必要作業量 |
|---|---|---|---|---|
| **案 A（推奨）** | **TiDB に `scenes` テーブルを追加し、tRPC API でサーバー検索・ページング返却** | ・35,768 行は約 15〜20 MB（TiDB 無料枠 5 GiB の 0.4% 未満）<br>・`public/scenes_index.json` と `src/lib/scenes_index.json` を**完全撤去でき、初期バンドルが逆に 3.17 MB 軽量化**<br>・新着動画のシーン反映も DB 一元化で自動化可能 | ・初回検索時に API 往復（100〜300 ms）が発生<br>・TiDB 側へテーブル追加 DDL＋初期投入が必要 | **約 0.5〜1 日**（`drizzle/schema.ts` 追加、SQLite→TiDB 投入スクリプト、tRPC `scenes.search`、`sceneSearch.ts` 置換） |
| **案 B（折衷）** | **静的 JSON をジャンル別シャード分割＋`src/lib/scenes_index.json` の静的同梱撤去** | ・DB 変更不要、Vercel CDN キャッシュが効く<br>・`web-cm` (3,511件) / `tv-cm` (2,445件) 等は 1〜2 MB 程度 | ・最大ジャンル `mv` が **15,955 シーン**（約 9.3 MB / gzip 2.3 MB）あるため `mv` のみ年代・評価で再分割が必要<br>・ジャンル横断検索時に複数チャンク取得が必要で、更新のたび再ビルド・デプロイが必要 | **約 0.5 日**（分割生成スクリプト＋遅延ローダ改修） |

### 5-2. 未視聴警告（`analysisObservationScope`）と `craft_recipes` をサイトに追加する見積もり

#### ① 未視聴動画（274 本）の警告表示（費用対効果・最優先）
TiDB に `analysisObservationScope` 列は既に存在するため DDL 不要。

| 変更対象ファイル | 変更内容 |
|---|---|
| `drizzle/schema.ts` | `videos` テーブル定義に `analysisObservationScope: varchar("analysisObservationScope", { length: 40 })` 追加 |
| `server/db.ts` | `getAllVideos()` の select 項目と `parseVideoRow()` に `analysisObservationScope` を追加 |
| `client/src/lib/types.ts` | `Video` 型に `analysisObservationScope?: string \| null` を追加 |
| `client/src/components/VideoCard.tsx` | `analysisObservationScope` があるカードに警告バッジ（`[未視聴・メタデータのみ]` 等）を表示 |
| `client/src/components/VideoModal.tsx` | 詳細モーダル上部および `AiAnalysisReport` 直上に未視聴注意バナーを表示 |
| `client/src/hooks/useVideos.ts` / `client/src/pages/Home.tsx` | （任意）「未視聴を除外」フィルタ切替を追加 |
| `server/db.test.ts` / `client/src/hooks/useVideos.test.ts` | フィールド透過・フィルタのテスト追加 |

- **見積もり作業量**: **約 2〜3 時間**（計 6〜8 ファイル）。

#### ② `craft_recipes`（439 本 / 1,036 件）のサイト表示
- **実測フットプリント（重要な前提）**:
  - レシピ JSON 本文のみ（SQLite `craft_recipes.recipe_json` 全 1,036 件）: **5.71 MB**（TiDB 格納は十分可能）。
  - 付随ローカルメディア（`E:\iketeru-creative-studio\data\craft_recipes\`）: **5,486 ファイル / 4,061.11 MB（約 4.06 GB）**
    - `.gif`: 1,042 本・**2,772.27 MB**
    - `.png`（start/mid/end）: 3,078 本・**1,178.67 MB**
    - `.jpg`（3×2 モーションストリップ）: 1,042 本・**103.68 MB**
    - `.json`: 324 本・6.49 MB
  - → GIF/PNG をそのまま Git や Vercel に置くことは不可。段階導入が現実的。

| 段階 | 内容 | 主な変更ファイル | 見積もり作業量 |
|---|---|---|---|
| **Phase A（テキスト仕様のみ表示・推奨）** | TiDB に `craftRecipes` テーブル（5.71 MB）を追加し SQLite から同期 → モーダルに「再現レシピ」セクション（ソフト・プラグイン・60-30-10 パレット HEX・手順・フレームタイムライン）表示＋カードに「レシピあり」バッジ | `drizzle/schema.ts`, `server/db.ts`, `server/routers.ts`, 同期スクリプト 1 本, `client/src/lib/types.ts`, `VideoCard.tsx`, `VideoModal.tsx`, テスト | **約 1〜1.5 日** |
| **Phase B（ビジュアルプレビュー付き）** | `server/storage.ts`（S3/R2）経由でまず軽量の **3×2 ストリップ `.jpg`（全量でも 103.68 MB）** をアップロード・配信（GIF 2.77 GB は必要時のみ WebM/MP4 化またはオンデマンド） | アップロードスクリプト, `craftRecipes` メディア URL 列, `VideoModal.tsx` プレビュー UI | **追加 約 1〜2 日** |

---

## 6. 手元キャッシュでレシピを作れる本数と 3 台分担の見積もり（追記）

### 6-1. 手元キャッシュにある「レシピ未作成」動画の本数（実測）

※ `chibatmute` の `D:\マイドライブ\iketeru_videos` と `CHIBA-PC` / `CHIBA-PC2` の `G:\マイドライブ\iketeru_videos` は**同一の共有 Google ドライブフォルダ**（キャッシュ済み全 `1,013` 本を 3 台共通で参照可能）。

#### ① レシピのない `4,158` 本（`watched_A | scenes あり | craft なし`）のうちキャッシュがある本数

| 配信サイト (`platform`) | 4,158 本中のキャッシュあり | うち技術ランク `A-` 以上（現行 `is_craft_eligible` 該当） | 4,158 本中のキャッシュなし |
|---|---:|---:|---:|
| `youtube` | **132** | 93 | 4,017 |
| `vimeo` | **4** | 0 | 3 |
| `external` | **1** | 1 | 0 |
| `instagram` | **1** | 1 | 0 |
| **合計** | **138 本** | **95 本** | **4,020 本** |

- この 138 本は **全 138 本が Phase 3 校正済み**（うち `calibratedScore >= 78`〔A- 相当以上〕は **74 本**）。

#### ② 参考：全「レシピなし」5,214 本まで広げたキャッシュ保有数（計 **636 本**）

| 層 | キャッシュあり合計 | `youtube` | `vimeo` | `external` | `instagram` | 備考 |
|---|---:|---:|---:|---:|---:|---|
| `watched_A \| scenes あり`（上記 ①） | **138** | 132 | 4 | 1 | 1 | すぐレシピ作成に着手可（A- 以上 95 本） |
| **`watched_A \| scenes なし`** | **489** | 2 | **483** | 4 | 0 | **手元に実動画がある最大プール**（短縮分析のため `scenes` 欠損しているだけ。実動画から直接レシピ化可能） |
| `unwatched_A \| scenes なし` | **8** | 0 | 8 | 0 | 0 | まず実視聴再分析（R2 先行 8 本）が必要 |
| `no_A \| scenes なし` | **1** | 1 | 0 | 0 | 0 | まず詳細分析が必要 |
| **レシピなし＋キャッシュあり 合計** | **636 本** | **135** | **495** | **5** | **1** | うち `aiTechniqueRating >= A-` は **471 本** |

※ 既にレシピがある 439 本のうちキャッシュ保有は 377 本（YouTube 255 / Vimeo 122）。

### 6-2. 今の `craft_recipes` 作成手順・1 本あたり時間・3 台分担の日数見積もり

#### 現行の作成手順（`E:\iketeru-creative-studio\iketeru_studio\craft_recipes.py`）
1. **適格判定（`is_craft_eligible`）**: `aiTechniqueRating` が `A-`〜`S+` かつ `analysisObservationScope IS NULL`（未視聴ハードゲート）かつ `visual_checked != False`。
2. **視覚解析・カットレシピ JSON 作成（LLM 作業＝主たる所要時間）**: ローカル MP4／コンタクトシートを観察し、重要 2〜3 カット（v2 基準は 15 秒以下の技法粒度）の `craftCuts`（`frame_timeline`, `effect_chain`, `primary_tool`, `layer_stack`, `recreation_flow`, `plugins_used`, `color_palette_hex`）を `batch_part*.json` として作成。
3. **機械処理・SQLite 登録（`ingest_batch_craft`）**: `ffprobe` FPS 計測 → `ffmpeg` で各カットの start/mid/end PNG・3×2 ストリップ JPG・2-pass GIF 切り出し（`capture_cut_visuals`）＋光学フロー／輝度／HEX パレット自動計測（`measure_cut_telemetry`）→ `normalize_cut_dict` → `data/craft_recipes/<id>/recipe.json` 保存 → SQLite `upsert_craft_recipe`。

#### 1 本あたりの所要時間
- **機械処理（`ingest_batch_craft`）**: SQLite `updated_at` 履歴および ffmpeg 処理規模から 1 本（2〜4 カット）あたり **約 5〜15 秒**（高速）。
- **LLM による v2 レシピ JSON 作成＋検査**: 1 本（2〜3 カット）あたり **約 1.5〜3 分**（サブエージェント 4〜6 並列で実効 **20〜35 本/時間**）。ただし Antigravity の 5 時間リセット枠を考慮すると、1 台あたりの無理のない日次スループットは **約 40〜60 本/日**（Gemini API 併用ならクォータ上限なし）。

#### 3 台（`chibatmute` / `CHIBA-PC` / `CHIBA-PC2`）分担時の日数見積もり
※ 複数 PC 運用原則（`docs/MULTI_PC_WORKFLOW.md`）に従い、3 台では **動画 ID リストを重複ゼロで分割してレシピ JSON 生成までを並列実行**し、SQLite `craft_recipes` への最終 `upsert` はレシピ担当機 1 台に集約する。

| 対象スコープ | 対象本数 | 1 台あたり担当本数 | 3 台並列の所要日数目安（Antigravity クォータ運用：計 150 本/日想定） |
|---|---:|---:|---|
| **フェーズ 1（最優先）**: `4,158` 本中キャッシュ済・技術 `A-` 以上 | **95 本** | 約 32 本 | **約 0.5〜1 日**（実稼働 1.5〜2 時間） |
| **フェーズ 1 拡張**: `4,158` 本中キャッシュ済すべて | **138 本** | 46 本 | **約 1 日**（実稼働 2〜3 時間） |
| **フェーズ 2（キャッシュ全量・A- 以上）**: `watched_A` キャッシュ済 627 本のうち A- 以上 | **471 本** | 約 157 本 | **約 3〜4 日** |
| **フェーズ 2 拡張**: `watched_A` キャッシュ済すべて（Vimeo 487 本含む） | **627 本** | 209 本 | **約 4〜5 日** |
| *参考：キャッシュ外 YouTube（4,017 本）* | *4,017 本* | — | *ローカル動画なしのため GIF/PNG 切り出し不可。Gemini API（YouTube URL）でテキスト版 v2 レシピのみ作る方式なら別途設計が必要* |

---

## 7. 新しく入ってくる動画の流れ：詰まり箇所ごとの自動化案と作業量（追記）

| 詰まり箇所 | 現状のボトルネック | 自動化案 | 必要作業量 | 備考・前提 |
|---|---|---|---|---|
| **① 候補収集（GAS / Playwright）→ TiDB 登録** | GAS・GitHub Actions がスプレッドシートに追記するのみで TiDB に未投入。TiDB 側 `dailyCollection*` 4 テーブルは 0 行 | GAS（`corporate_recruit_collector.gs`）や Playwright クローラから Vercel API（`ADMIN_API_KEY` 認証の新規 `/api/admin/ingest-candidates` 等）へ直接 POST し、重複除外して TiDB に登録（YouTube メタ取得は公式 YouTube Data API v3 無料枠または GitHub Actions 側で実施し、社内回線から YouTube へ直接アクセスしない） | **約 0.5〜1 日** | スプレッドシートは閲覧・手動追記の補助に降格し、正本を TiDB へ一本化 |
| **② 新着動画の詳細分析 (`aiAnalysis`) 生成** | ローカル `analyze_new_videos_workflow.py` 手動実行のみ。YouTube 直接取得保留（D-016）・未キャッシュ Vimeo ログイン必須（D-014） | **YouTube 新着**: D-017/D-018 の **Gemini API（YouTube URL 直接渡し・Flex）** を詳細分析（Ch.0〜Ch.9＋`clientPitch`＋Ch.3 厳格形式）生成にも適用。日次バッチ（GitHub Actions またはローカル定時スクリプト）で `aiAnalysis` 空の YouTube を自動分析し、バリデーション通過分のみ TiDB 反映 | **約 1.5〜2 日**（設計承認後） | 非 YouTube（Vimeo 等）は Gemini API URL 非対応のため別キュー（キャッシュ済みのみローカル処理、未キャッシュは保留） |
| **③ `scenes` 抽出と Web サイト反映** | SQLite 側のみで Ch.3 をパース。サイトは 2026-11-19 の静的 JSON（342 本）のまま停止 | 5-1 案 A と統合：TiDB に `scenes` テーブルを設け、② の TiDB 登録時に Ch.3（`- #NN 【MM:SS-MM:SS】`）を自動パースして同時 upsert。サイトは tRPC API で TiDB `scenes` を直接検索（静的 `scenes_index.json` 撤去） | **約 1 日**（5-1 案 A と共通） | 詳細分析が入った瞬間にサイトのシーン検索にも自動反映 |
| **④ TiDB → 各 PC SQLite ミラー同期** | `sync-tidb-to-sqlite-mirror.mjs`（校正列・未視聴列のみ）と MCP `sync_database`（本文＋`scenes`）の 2 系統を手動実行 | `sync-tidb-to-sqlite-mirror.mjs` に `--include-new-videos` / `--sync-scenes` オプション（既存の `zeroDeletions` 設計と旧列保護は維持）を追加し、1 コマンド化＋各 PC のタスクスケジューラで日次自動同期 | **約 0.5〜1 日** | 他 PC が追加・採点した結果を翌朝には全 PC の MCP へ自動反映 |
| **⑤ `craft_recipes` の継続生成** | 1 台のレシピ担当機で実動画ファイルから手動バッチ作成（439 本止まり） | **2 段階分離**：(a) 高技術／高評価の YouTube 新着は Gemini API（YouTube URL）で「テキスト版 v2 レシピ（`frame_timeline`/`effect_chain`/AE 手順）」を自動生成し TiDB `craftRecipes` へ格納、(b) ローカルキャッシュがある厳選作だけ ffmpeg で 3×2 ストリップ JPG・テレメトリを後付け補完 | **約 2〜3 日** | YouTube 動画ダウンロード禁止（D-016）下でも、`plan_craft_sequence` が引くレシピ母数を増やし続けられる |
| **⑥ Phase 3 校正済み採点** | 手動バッチ予約・採点・ロック反映 | `docs/API_URL_SCORING_DESIGN.md`（D-018）承認後、YouTube 新着に対して Flex API＋アンカー混在バッチを自動実行（補正・TiDB 反映の承認ゲートは維持） | D-018 設計書承認後に確定 | 30 本アンカー蓄積＋ユーザー承認までは TiDB 未反映 |

- **合計作業量の見通し（段階導入の優先順）**:
  1. **即効パック（約 1〜1.5 日）**: 未視聴警告のサイト表示（2〜3h）＋ TiDB `scenes` テーブル化＆静的 `scenes_index.json` 撤去（0.5〜1 日）＋ SQLite 同期 1 コマンド化（0.5 日）
  2. **レシピ母数ブースト（3 台並列 1〜4 日、コード改修ほぼ不要）**: 共有キャッシュ済み未レシピ動画（`4,158` 中の A- 以上 **95 本** → 拡張して `watched_A` キャッシュ済 A- 以上 **471 本**）を 3 台分担でレシピ化
  3. **新着パイプライン自動化（約 4〜6 日、D-018 設計承認と連動）**: 入口直接登録（0.5〜1 日）＋ Gemini API URL 詳細分析自動化（1.5〜2 日）＋ テキスト版 v2 レシピ自動生成＆サイト表示（2〜3 日）

---

## 8. 381 本の品質点検（動画生成ブラッシュアップ監査・実測）

対象：第 1 章で「動画生成に使える状態（実視聴 `aiAnalysis` ＋ `scenes` ＋ `craft_recipes` 完備）」と分類した **381 本（計 962 カット）** を、TiDB・SQLite（読み取り専用）・ローカル動画キャッシュ（`ffprobe` 319 本実測・エラー 0）・`data/craft_recipes/` 実ファイル・`iketeru-creative-studio` ソースコードに基づき 7 観点で全数点検した。

### 8-1. 全体サマリ（問題なし本数と項目別要修正本数）

- **全 7 観点＋v2＋校正済みで完全無欠（指摘 0 件）**: **1 本** / 381 本
- **構造破損・時刻異常・ファイル欠損なし（v1 形式・未校正を許容した場合）**: **196 本** / 381 本（51.4%）
- **総評**: 時刻の破綻（尺超過 **0**・時計誤認 **0**・真の逆転 **0**）、PC 依存パス（**0**）、381 本内重複（**0**）はいずれも極めて健全。一方、**レシピ v1→v2 未対応（358 本）**、**15 秒超の粗いカット（196 本）**、**`provisional`/`invalidated_no_visual` による MCP 自動除外（16 本）**、**未校正（62 本・全件未キャッシュ）**、**欠損 PNG（43 本）／`recipe.json` 未出力（115 本）** がブラッシュアップ対象として明確になった。

| 点検項目 | 結果（問題なし / 要対応） | 要対応の内訳（実測） |
|---|---|---|
| **1. レシピ形式（v2 準拠）** | 完全 v2 かつ ≤15s: **23 本** / 要拡充: **358 本** | v1 のみ: **261 本**、一部 v2 混在: **97 本**（計 721/962 カットに `frame_timeline`・`effect_chain`・`ae_blueprint.layers` 欠損）。15 秒超 (`needs_recut`): **196 本**、テレメトリ欠損: **53 本**、イージング推測値 (`inferred`): **91 本** |
| **2. 校正済み点数** | 校正済み: **319 本** / 未校正: **62 本** | 未校正 62 本のキャッシュ保有は **0 本**（YouTube 未キャッシュ 58 本＋`_skip_list` 2 本＋Vimeo 未キャッシュ 2 本）。費用ゼロのローカルブラインド採点対象は **0 本** |
| **3. シーン時刻の妥当性** | 尺超過・重複・時計誤認: **0 本** / 軽微注意: **45 本** | `end_sec > 動画長+2s`: **0 本**（実測 319 本中）、重複: **0 本**、時計誤認（`_ESKiygZh9Y` 型）: **0 本**（※ `_ESKiygZh9Y` はレシピなしのため 381 本外）。`start==end` の 0 秒丸めシーン: **6 本**、密度が極端に疎（平均 >60s 等）: **39 本**、密すぎ: **0 本** |
| **4. レシピとシーンの整合** | 時刻矛盾・孤立カット: **0 本** / 過大区間: **106 本** | 動画尺超過: **0 本**、シーン範囲超過: **0 本**、シーン非重複: **0 本**、SQLite/`recipe.json` ズレ: **0 本**。1 カットで 3 シーン以上を跨ぐ過大区間: **106 本**（項目 1 の `>15s` と重複） |
| **5. 分析の出どころ** | `log_verified`: **48 本** / 旧仕組み・未記録: **333 本** | モデル別：`antigravity-visual-audit` **223**、`flash` **6**、`contact-sheet` **1**、DB 未記録 **151**（`backfill_from_analysis` v1.0: 139 + `invalidated_no_visual` v2: 12）。**★ 重大：`provisional` 4 本＋`invalidated_no_visual` 12 本＝計 16 本が MCP 既定 `exclude_provisional=True` で自動除外されている** |
| **6. ファイル欠け・PC 依存パス** | PC 依存パス: **0 本** / 欠損あり: **158 件相当（重複含む）** | PC 依存絶対パス: SQLite・`recipe.json` とも **0 本**（全件相対パス化済み）。個別メディア欠損（主に `cut_02_end.png` 1 枚欠け）: **43 本**、`data/craft_recipes/<id>/recipe.json` 未出力: **115 本** |
| **7. 重複** | 381 本内の重複: **0 本** / 外部同タイトル: **1 本** | URL 重複: **0 本**、381 本同士のタイトル重複・類似重複: **0 本**。381 本外との同一タイトル: **1 本**（`tk9mbNFEKZw`） |

---

### 8-2. 観点 1 のコード検証：v1 のままだと動画生成の何が弱くなるか

`iketeru_studio/indexer.py`（L1817–1859, L2071–2166）・`macro_planner.py`（L540–729）・`ae_builder.py`・`code_video_builder.py` の実測確認：
1. **`search_craft_recipes` / `plan_craft_sequence` での直接利用**:
   - 両ツールとも **`needs_recut`（`dur > 15s`）なし・`is_v2`（`frame_timeline` + `effect_chain` + `primary_tool`）あり** を検索ソートの上位タイブレーカーに使い、`v2_only=True` 指定時は v1 や 15 秒超を完全除外する（現状 94% の 358 本が弾かれる）。
   - `plan_craft_sequence` は選択レシピの **`ae_blueprint`** と **`transition_bridge`** を出力カット設計図へ直接組み込む。
2. **v1 のままだと弱くなる点（3 点）**:
   - **① カット粒度が粗すぎる（196 本）**: 20〜100 秒の長いセクション単位のままのため、AE/コードで「どの 1 技法を何秒で再現するか」が曖昧になり、15 秒構成の 1 カットへ転用しづらい。
   - **② フレーム数値・エフェクト実数値の欠如（358 本 / 721 カット）**: `frame_timeline`（例：`f+0`→`f+4` のスケール／位置変化）、`effect_chain`（AE `match_name` と実数パラメータ）、`ae_blueprint.layers` が空のため、後段の `get_craft_recipe` → `.jsx` / Remotion / p5.js 生成時に AI が毎回パラメータを推測補完する必要があり、再現の一貫性・精度が落ちる。
   - **③ 実測テレメトリ／イージング根拠の不足（53 本／91 本）**: 光学フロー・輝度実測が欠けたり、イージングが固定テンプレート推測値（`inferred`）のまま残っている。

---

### 8-3. 項目別の問題例（実測・各 2〜3 本）

1. **v1 レシピ（`frame_timeline` / `effect_chain` / `ae_blueprint.layers` 欠損：358 本）**:
   - `-8Er6Uw3Xs0`（`ライトEP「Fearless」 | ゼンレスゾーンゼロ`）：2 カットとも v1（`v2_cuts=0`）、最大カット尺 100.0 秒。
   - `0S43IwBF0uM`（`The Chemical Brothers - Star Guitar`）：4 カット中 v2 は 2 カットのみ、残り 2 カットが v1 混在。
   - `0ci4J1GpRDw`（`月極駐車場管理システムCarParking One`）：2 カットとも v1、最大カット尺 61.9 秒。
2. **15 秒超の過大カット（`needs_recut`：196 本／3 シーン以上跨ぎ：106 本）**:
   - `-8Er6Uw3Xs0`：2 カットとも `needs_recut`（最大 **100.0 秒**）。
   - `0rNCwi8MEfo`（`APOGEE「アヒル」Music Video`）：2 カットとも `needs_recut`（最大 **85.0 秒**）。
   - `0zVssDpHo3w`（`Snowy Island`）：2 カットとも `needs_recut`（最大 **44.0 秒**）。
3. **未校正（62 本・全件未キャッシュ）**:
   - `1230811867`（`Coeur Cerise`、Vimeo・未キャッシュ・`embedStatus=unknown`）：ログイン必須のため現状手段なし。
   - `1237757917`（`What We Leave Behind`、Vimeo・未キャッシュ・`embedStatus=unknown`）：同上。
   - `2nGPUtId7vM`（`KDDIブランドメッセージ`、YouTube・未キャッシュ・`embedStatus=restricted`）：他 YouTube 58 本と合わせ Gemini API URL 方式での検証対象（うち `available`: 27 / `unknown`: 5 / `restricted`: 28）。
4. **シーン時刻の 0 秒丸め（6 本）と疎すぎるシーン密度（39 本）**:
   - 0 秒丸め：`1lG3spbvbqI`（`2026年 日本郵船グループ新CM 15秒`：`shot#2 00:04-00:04`, `shot#3 00:05-00:05`）、`Rh-s5CtbASw`（`iPhone | Ceramic Shield`：`shot#4 00:06-00:06`, `shot#5 00:07-00:07`）、`dsXcE8jvESw`（`昭和建設 2026年CM`：`shot#4 00:06-00:06`）。※いずれも 15 秒 CM の 1 秒未満カットの丸め誤差。
   - 密度が疎：`1237757917`（653.0 秒に 4 シーン＝平均 **163.2 秒**）、`113637004`（`"Crushed Pleats"`：220.5 秒に 3 シーン＝平均 **73.5 秒**）、`123085463`（`UGUISU`：212.3 秒に 3 シーン＝平均 **70.8 秒**）。
5. **MCP で自動除外されている `provisional` / `invalidated_no_visual`（16 本）**:
   - `1018644295`（`Odd`）：Phase 3 校正 **89.00 点**だが `analysisStatus="provisional"` のため MCP 検索から除外中。
   - `403212163`（`HBO Watchmen`）：Phase 3 校正 **84.00 点**だが `analysisStatus="provisional"` のため除外中。
   - `5Duje_sZko8`（`Imagine Dragons - Take Me To The Beach (feat. Ado)`）：Phase 3 校正 **82.00 点**だが `visualVerificationStatus="invalidated_no_visual"` のため除外中。
6. **メディア欠損（43 本）および `recipe.json` 未出力（115 本）**:
   - メディア欠損：`0ScUM-7ivK4`、`0ci4J1GpRDw`、`123085463`（いずれも `cut_02_end.png` のみディスク欠損。キャッシュ MP4 あり）。
   - `recipe.json` 未出力：`170717140`（`WOW 20th Anniversary Movie Logo 'W20W'`、SQLite 2 カット）、`197075256`（同 `Hadoken`、SQLite 3 カット）、`3TUhE6RLwzE`（SQLite 4 カット）。
7. **重複（外部同タイトル 1 本）**:
   - `tk9mbNFEKZw`（`採用動画制作サービス｜動画制作・映像制作のLOCUS`）：381 本外に同一タイトルの別動画 ID `_KZm0JQSYt8`・`1cTRPePbNB4` が存在（同シリーズ別バージョンか重複か目視確認対象）。

---

### 8-4. 直す方法ごとの見積もりと優先順位

| 優先順 | 対策内容 | 対象本数 | 方法区分 | コスト・作業量見積もり | 動画生成への効果 |
|---:|---|---:|---|---|---|
| **1** | **`recipe.json` 115 本の一括再出力 ＋ 欠損 `end.png` 43 本の `ffmpeg` 再生成 ＋ 欠損テレメトリ 53 本の再計測** | 115 / 43 / 53 本 | **費用ゼロ（ローカル機械処理のみ）** | **約 1〜2 時間**（スクリプト 1 本＋自動検証。AI 枠消費ゼロ） | ファイル整合性・テレメトリ完備率を一気に 100% 近くへ引き上げ |
| **2** | **`provisional` / `invalidated_no_visual` 16 本の棚卸し**（うち Phase 3 実動画校正済みの高評価作のフラグ見直し／必要分のみ再分析） | **16 本** | **費用ゼロ（ルール判断＋確認）**＋必要分のみ再分析 | **約 1〜2 時間**（16 本の目視確認と判定。実動画校正済みの良作が即 MCP に復活） | 校正 80 点台後半の主力レシピ（`Odd` 89 点、`Watchmen` 84 点等）が即戦力に復帰 |
| **3** | **既存レシピ 358 本の v2 化 ＆ 15 秒超 196 本の細分化再カット**（ローカルキャッシュあり 319 本を最優先） | キャッシュ有 **~300 本**（全体 **358 本**） | **費用ゼロ（ローカルキャッシュ＋Antigravity 3 台分担）** ※未キャッシュ 60 本は API 併用可 | 3 台並列（計 100〜150 本/日）で **約 2.5〜3.5 日**（まず 15 秒超 196 本に絞れば **約 1.5〜2 日**） | **動画生成への効果最大**。`frame_timeline`・`effect_chain`・`ae_blueprint.layers` が揃い AE/コード生成の再現精度が劇的に向上 |
| **4** | **未校正 62 本のうち YouTube 58 本の校正済み採点**（`_skip_list` 2 本・Vimeo 2 本除く） | **58 本**（有効見込み 32 本前後＋`restricted` 28 本） | **Gemini API（YouTube URL・Flex）**（D-018 設計書承認後） | API 費用 **約 \$2.5〜\$5**（58 本×2 回×Flex \$0.043 目安）／実行 **1〜2 時間** | 381 本の校正カバー率を 83.7% → 最大 **98.9%**（377/381 本）へ引き上げ |
| **5** | **シーン密度が疎な 39 本・0 秒丸め 6 本の Ch.3 再分解**＋重複候補 1 本の確認 | **45 本＋1 本** | キャッシュ有は **費用ゼロ（ローカル再分解）**／重複 1 本は **手作業 5 分** | 約 **0.5 日**（`search_scenes` とペーシング基準の精度底上げ） | `search_scenes` と `get_pacing_benchmarks` の細かさ・正確さを改善 |
