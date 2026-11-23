# Phase 3 既存DB 5,653本への校正済み評価（D＋C）導入設計書・ドライラン結果

作成日: 2026-11-23  
対象リポジトリ: `E:\iketeru-eizou`（本番 TiDB＝**正本**）および `E:\iketeru-creative-studio`（ローカル SQLite＝**TiDB からの同期ミラー**）  
ステータス: **条件付きGO受領 → D（完全バックアップ＋TiDBマイグレーション＋初期印付け＋UI区別）実行対象（C第1バッチ前で停止）**

---

## 1. 方針（D＋C）・正本決定・絶対条件

Phase 2 凍結 Holdout v1（74本・1回限り検証）で **GO**（`P-1 ROC-AUC = 0.9750`, `P-2 = 91.67% (22/24)`, `P-3 = 88.00% (22/25)`, `P-4 = 0`, `S-1 = 0`, `S-2 = 1.0000`）を達成したことを受け、既存DB 5,653本に対して **D＋C 方式** で移行する。

### 1.1 正本（基準DB）とミラー同期方針（条件1）
- **正本（Source of Truth）**: **本番 TiDB（`videos` テーブル）** を唯一の正本とする。
- **ミラー（読み取り用キャッシュ）**: `E:\iketeru-creative-studio\data\iketeru_knowledge.db`（ローカル SQLite）は、**TiDB から同期するミラー** として位置づける。
- **二重書き込みの禁止**: C（段階的再採点）の結果書き込みは **TiDB（正本）のみ** に行い、SQLite へは同期スクリプト（または `indexer.py::sync_catalog`）経由で一方向反映する。TiDB と SQLite へ別々に書き込む運用は行わない。
- **既存 ID 差分（TiDBのみ 66件／SQLiteのみ 48件）の扱い（削除なし）**:
  - **SQLite のみ 48件**: **削除しない**。既存のローカル分析アーカイブとして SQLite 側にそのまま保全し、TiDB 側へ逆流もさせない。
  - **TiDB のみ 66件**: 同期実行時に TiDB から SQLite へ `UPSERT` で取り込む（削除は一切行わない）。

### 1.2 D＋C の役割分担
- **D（旧点数の明示保護＋新規登録分への適用）**:
  - 既存の旧スコアには「旧基準・未校正」の印を付け、値を一切消さず・上書きせず保全する。
  - 今後新規登録される動画は、Phase 2 凍結設定（新しい物差し）で採点し、新設カラムへ記録する。
- **C（優先順の段階的再採点）**:
  - 既存 5,653本を優先順 ①→②→③ で **1回最大 200本** ごとに区切って再採点し、区切りごとに報告して停止する。
  - **純 `branded-movie` の扱い（条件5・確定）**: `tv-cm`/`web-cm`/`corporate` の副タグを持たない純 `branded-movie`（優先① 13本・優先③ 122本）は、保守的に **「未検証ジャンル（`unverified:branded-movie`）」** 扱いとする。
  - **優先①（492本）の報告付記（条件4）**: 優先①の報告には、ユーザーの `privateRating` と校正済み点数の対応表（一致・ずれの多いジャンル別集計）を必ず添付する。ただしこれは **参考情報のみ** であり、物差しの良し悪しの判定基準や閾値変更には使わない。

### 絶対条件（すべて設計・スクリプトに組み込み済み）
1. **旧点数カラムの完全保全**: `aiOverallScore` / `aiDirectionScore` / `aiTechniqueScore` / `aiScoreBreakdown`（および `aiOverallRating` / `aiDirectionRating` / `aiTechniqueRating` / `aiAnalysis`）は **1バイトも削除・上書きしない**。新点数は完全に別のカラム群に格納し、画面でも「旧基準（未校正）」と「校正済み（Phase 2 v1）」を明確に区別表示する。
2. **書き込み前の完全バックアップ**: 本番 TiDB に書き込む前に `videos` テーブル全件をリポジトリ外（`E:\iketeru_backups\`）へエクスポートし、**行数と SHA-256** を記録する。ローカル SQLite ミラー（`E:\iketeru-creative-studio\data\iketeru_knowledge.db`）もファイル丸ごとバックアップし、**行数と SHA-256** を記録する。
3. **Phase 2 凍結設定の不変固定**: 再採点には [phase2_frozen_config_v1.json](../analysis/phase2_frozen_config_v1.json) の設定をそのまま固定使用する（`T_award = 83`, `T_low = 63`, `expected_model = gemini-4-neon-high`, `prompt_version = v1_baseline`, `hybrid_router_version = phase2_hybrid_v1`, 2+1アンサンブル＋差5点以上で3回目タイブレーカー）。
4. **安全取得・ボット確認即中断**: 動画取得は **Cookie なし・ログインなし・回避処理なし**。待機間隔 15〜30秒、YouTube/Vimeo のボット確認・429 を検知した瞬間に即中断する。1バッチ最大 200本で必ず停止し報告する。

---

## 2. DB スキーマ変更設計（マイグレーション手順）

### 2.1 追加カラム一覧（全10カラム・すべて追記のみ）

既存カラム（保護対象8カラム）は一切変更しない。2+1平均の `.5` 点（例：`82.5` と `83.0` の境界差）を丸め誤差なく保持するため、`calibratedScore` は TiDB で `decimal(5,2)`、SQLite で `REAL` を採用する。

| # | TiDB カラム名 | TiDB 型 | SQLite カラム名 | SQLite 型 | 初期値 | 説明 |
|---:|---|---|---|---|---|---|
| 1 | `calibrationStatus` | `varchar(32) DEFAULT NULL` | `calibration_status` | `TEXT DEFAULT NULL` | 初期印付け後は `legacy_uncalibrated` または `unscored` | 評価状態フラグ（4値、§3参照） |
| 2 | `calibratedScore` | `decimal(5,2) DEFAULT NULL` | `calibrated_score` | `REAL DEFAULT NULL` | `NULL` | 校正済み総合点（0.00〜100.00、`.5` 保持） |
| 3 | `calibratedRank` | `varchar(8) DEFAULT NULL` | `calibrated_rank` | `TEXT DEFAULT NULL` | `NULL` | 校正済みスコア対応ランク（`S+`〜`D`） |
| 4 | `calibratedTierBand` | `varchar(24) DEFAULT NULL` | `calibrated_tier_band` | `TEXT DEFAULT NULL` | `NULL` | 凍結境界区分：`award_tier`（`>=83`）/ `pro_band`（`63〜82.99`）/ `low_band`（`<63`） |
| 5 | `calibratedBreakdown` | `mediumtext DEFAULT NULL` | `calibrated_breakdown_json` | `TEXT DEFAULT ''` | `NULL` / `''` | JSON：2+1各回点数・5観点内訳・`brief_rationale`・`post_check`・モデル・トークン・監査合格・境界値（`tAward=83, tLow=63`） |
| 6 | `calibrationVersion` | `varchar(32) DEFAULT NULL` | `calibration_version` | `TEXT DEFAULT NULL` | `NULL` | 校正バージョン（固定 `'phase2_v1'`） |
| 7 | `calibratedAt` | `timestamp NULL DEFAULT NULL` | `calibrated_at` | `INTEGER DEFAULT NULL` | `NULL` | 校正完了日時（TiDB: UTC timestamp / SQLite: epoch秒） |
| 8 | `calibratedRoute` | `varchar(32) DEFAULT NULL` | `calibrated_route` | `TEXT DEFAULT NULL` | `NULL` | 実行ルート：`'video_h1'` / `'video_h2_escalated'` / `'contact_sheet'` |
| 9 | `calibratedRunId` | `varchar(64) DEFAULT NULL` | `calibrated_run_id` | `TEXT DEFAULT NULL` | `NULL` | 監査証跡ランID（`analysis/runs/<run_id>/` と1対1対応、バッチロールバックキー） |
| 10 | `calibrationGenreBucket` | `varchar(64) DEFAULT NULL` | `calibration_genre_bucket` | `TEXT DEFAULT NULL` | `NULL` | 判定ジャンル枠（検証済み5枠 `CM`/`MV`/`モーション`/`3DCG/アニメ`/`企業映像` または `unverified:<slug>`） |

### 2.2 TiDB マイグレーション SQL（案：`drizzle/0020_phase2_calibrated_scores.sql`）

※ユーザー GO 後に作成・適用する。適用前に必ず §5 のバックアップを完了させる。

```sql
-- Step 1: 追記のみの DDL（既存40カラム・全5,653行のデータは一切無変更）
ALTER TABLE `videos` ADD `calibrationStatus` varchar(32) DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `videos` ADD `calibratedScore` decimal(5,2) DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `videos` ADD `calibratedRank` varchar(8) DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `videos` ADD `calibratedTierBand` varchar(24) DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `videos` ADD `calibratedBreakdown` mediumtext DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `videos` ADD `calibrationVersion` varchar(32) DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `videos` ADD `calibratedAt` timestamp NULL DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `videos` ADD `calibratedRoute` varchar(32) DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `videos` ADD `calibratedRunId` varchar(64) DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `videos` ADD `calibrationGenreBucket` varchar(64) DEFAULT NULL;
--> statement-breakpoint
CREATE INDEX `idx_videos_calibration_status` ON `videos` (`calibrationStatus`);
--> statement-breakpoint
CREATE INDEX `idx_videos_calibrated_run_id` ON `videos` (`calibratedRunId`);
```

### 2.3 D 初期印付け SQL（既存行に「旧基準・未校正」または「未採点」を付与）

`updatedAt = updatedAt` を明示することで、既存の最終更新日時（`MAX(updatedAt) = 2026-11-21T17:57:26Z`）を汚染せず、かつ保護対象カラムには一切触れない。

```sql
-- Step 2 (D): 既存行の初期ステータス付与（旧点数カラムは一切触らない）
UPDATE `videos`
SET
  `calibrationStatus` = CASE
    WHEN `aiOverallScore` IS NOT NULL
      OR (`aiOverallRating` IS NOT NULL AND TRIM(`aiOverallRating`) != '')
    THEN 'legacy_uncalibrated'
    ELSE 'unscored'
  END,
  `updatedAt` = `updatedAt`
WHERE `calibrationStatus` IS NULL;
```

### 2.4 SQLite ミラー側・MCP サーバー・`creative-studio` `indexer` の参照DB確認と拡張計画（条件2・今回は計画のみ／未実装）

#### 現在の参照DB確認結果
- **`iketeru-eizou` MCP サーバー**（`E:\iketeru-creative-studio\iketeru_studio\mcp_server.py` の `search_references` / `search_scenes` / `get_video_playbook` / `get_anti_patterns` / `get_pacing_benchmarks`）:
  - すべて `KnowledgeIndex` を経由して **ローカル SQLite ミラー（`E:\iketeru-creative-studio\data\iketeru_knowledge.db`）のみ** を読み取る。TiDB へ直接クエリは行わない。
- **`creative-studio` の `indexer.py`**（`E:\iketeru-creative-studio\iketeru_studio\indexer.py`）:
  - `sync_catalog()` が本番 Web API（`https://iketeru-eizou.vercel.app/api/trpc/videos.list` → 裏側の **本番 TiDB**）からカタログを取得し、ローカル SQLite へ `UPSERT` する。
  - `hydrate_missing_analyses()` が `videos.get`（本番 TiDB）から詳細解析を取得し、ローカル SQLite へ反映する。

#### 校正済み欄を読めるようにする拡張計画（次フェーズで実装予定・D段階ではSQLite未変更）
1. **TiDB 側 API 公開（今回 D で先行対応）**: `server/db.ts` の `getAllVideos()`（`videos.list`）と `getVideoById()`（`videos.get`）の返却オブジェクトに、新設10カラム（`calibrationStatus`〜`calibrationGenreBucket`）を含める。
2. **SQLite スキーマ拡張（`indexer.py::_init_schema`）**: 既存の非破壊 `ALTER TABLE videos ADD COLUMN ...` 方式で §2.1 の10カラム（`calibration_status`〜`calibration_genre_bucket`）を追加する。既存の SQLite 単独48行は削除せず保持する。
3. **一方向同期スクリプト / `upsert_video` 更新（`indexer.py`）**:
   - TiDB（正本）から `videos.list` API または読み取り専用 TiDB 接続で新10カラムを読み取り、SQLite ミラーへ `UPSERT` 反映する（TiDBのみ 66件は自然に取り込まれ、SQLiteのみ 48件は削除せず `calibration_status = 'legacy_uncalibrated'` 等でそのまま保全）。
   - C の各バッチ完了後にこの一方向同期を実行する運用とし、SQLite への直接の二重書き込みは行わない。
4. **MCP ツール返却拡張（`mcp_server.py`）**:
   - `search_references` / `get_video_playbook` / `get_pacing_benchmarks` / `get_anti_patterns` の返却JSONに `calibration_status` / `calibrated_score` / `calibrated_rank` / `calibrated_tier_band` / `calibration_genre_bucket` を併記する。
   - オプション引数 `calibration_filter`（`"all" | "calibrated_only" | "calibrated_verified_only"`、既定 `"all"`）を追加し、旧基準スコアのみの動画には `"legacy_uncalibrated"`、未検証ジャンルの校正済み動画には `"calibrated_unverified_genre"` を明示返却して、下流の制作AIが旧基準と校正済みを取り違えないようにする。

---

## 3. 印の付け方と画面（UI）での区別仕様

### 3.1 `calibrationStatus` の4値定義

| `calibrationStatus` 値 | 意味 | 主な条件 | 画面バッジ表記 |
|---|---|---|---|
| `legacy_uncalibrated` | 旧基準・未校正 | 旧点数/旧ランクのみあり、`calibratedScore IS NULL` | 灰色バッジ：`旧基準（未校正）` |
| `unscored` | 未採点 | 旧点数も校正済み点数もなし | バッジなし（または `未採点`） |
| `calibrated_verified` | 校正済み（検証済み5ジャンル） | `calibratedScore IS NOT NULL` かつ検証済み5ジャンル（`CM` / `MV` / `モーション` / `3DCG/アニメ` / `企業映像`） | 緑/エメラルドバッジ：`校正済 v1`（+ 区分 `受賞水準(>=83)` / `商業標準` / `低品質域`） |
| `calibrated_unverified_genre` | 校正済み（未検証ジャンル） | `calibratedScore IS NOT NULL` かつ未検証ジャンル（SNS縦型・映画・アート・ドキュメンタリー・オープニング等） | 琥珀色バッジ：`校正済 v1（このジャンルは未検証）` |

### 3.2 画面（`VideoCard.tsx` / `VideoModal.tsx` / `Home.tsx`）の表示設計（ユーザーGO後に実装）

1. **一覧カード（`VideoCard.tsx`）**:
   - `calibratedScore` がある場合：校正済みスコア（例：`校正済 88.5 / A+`）を主バッジ表示し、未検証ジャンルなら直横に **`このジャンルは未検証`** 注意バッジを併記する。旧点数はツールチップまたは控えめな副表示（例：`旧: A 84`）で確認可能にする。
   - `calibratedScore` が `NULL` で `legacy_uncalibrated` の場合：従来の `AI 総/演/技` バッジを維持しつつ、明示的に **`旧基準・未校正`** タグを付記して新基準と混同しないようにする。
2. **詳細モーダル（`VideoModal.tsx`）**:
   - **「校正済み評価（Phase 2 v1）」セクション**（新設）：`calibratedScore`、`calibratedRank`、`calibratedTierBand`、`calibratedRoute`、`calibratedAt`、`calibratedRunId`、5観点内訳、および未検証ジャンル警告文（「※このジャンルは Phase 2 検証対象外のため参考値です」）を表示。
   - **「旧基準AI評価（未校正・参考保持）」セクション**（既存欄をリネーム）：既存の `aiOverallScore` / `aiDirectionScore` / `aiTechniqueScore` / `aiScoreBreakdown` / `aiAnalysis` をそのまま表示・保全。
3. **絞り込み・並び替え（`Home.tsx` / `useVideos.ts`）**:
   - フィルター追加：`すべて` / `校正済みのみ` / `校正済み（検証済みジャンルのみ）` / `旧基準・未校正のみ`
   - 並び替え追加：`校正済みスコア 高い順`（既存の `AI総合 高い順` は `旧基準AI総合 高い順` と明示して混在ソートを防ぐ）。

---

## 4. 新規登録分の運用設計（D の後半）

- 今後新しく DB へ登録される動画は、従来の未校正採点（`aiOverallScore` への自動書き込み）ではなく、Phase 2 凍結設定（`T_award=83, T_low=63, gemini-4-neon-high, v1_baseline, phase2_hybrid_v1`）によるブラインド採点パイプラインで採点する。
- 結果は `calibratedScore` 等の新カラム群へ書き込み、`calibrationVersion = 'phase2_v1'`、`calibrationStatus = 'calibrated_verified'`（または未検証ジャンルなら `'calibrated_unverified_genre'`）を設定する。旧点数カラム群は `NULL` のまま保つ。
- なお、既存の `server/aiMetadataCompletion.ts`（メタデータ自動補完ワーカー）はプロンプト上で評価欄を常に空文字にしているため、旧評価の意図しない上書きは起きないことを確認済み。

---

## 5. 本番書き込み前の完全バックアップ手順（必須ゲート）

本番 TiDB または SQLite へ **1行でも書き込む前** に、専用バックアップスクリプト（GO後に作成）で以下をリポジトリ外の **`E:\iketeru_backups\<YYYYMMDD_HHMMSS>\`** に作成・検証する。

1. **本番 TiDB `videos` テーブル完全バックアップ**:
   - `SELECT * FROM videos ORDER BY id ASC` を全40カラム・全5,653行そのまま JSONL 出力（`tidb_videos_backup.jsonl`）。
   - `SHOW CREATE TABLE videos` を `tidb_videos_schema.sql` に保存。
   - 行数（`5,653`）、`MAX(updatedAt)`（`2026-11-21T17:57:26.000Z`）、および `tidb_videos_backup.jsonl` の **SHA-256** を `backup_manifest.json` に記録。
2. **ローカル SQLite ミラー完全バックアップ**:
   - SQLite の `sqlite3.Connection.backup()` API（WAL 状態でも整合したスナップショットを取得）で `iketeru_knowledge_backup.db` へ完全複製。
   - `videos` テーブル行数（`5,635`）、ファイルサイズ、**SHA-256** を `backup_manifest.json` に記録。
3. **復元テスト（読み込み検算）**:
   - バックアップ直後に JSONL の全行パース検算と SQLite の `PRAGMA integrity_check` を自動実行し、エラー0件を確認してからでないとマイグレーションに進めない。

---

## 6. ロールバック（戻し方）手順

すべての変更が「追記カラムのみ」かつ「バッチ単位の `calibratedRunId` 紐付け」であるため、段階ごとに安全に元へ戻せる。

### ケース A：C の特定バッチ（最大200本）だけ取り消したい場合
```sql
-- 例: ランID 'prod_20261124_p1_b01' の書き込みだけを取り消し、初期状態へ戻す
UPDATE `videos`
SET
  `calibratedScore` = NULL,
  `calibratedRank` = NULL,
  `calibratedTierBand` = NULL,
  `calibratedBreakdown` = NULL,
  `calibrationVersion` = NULL,
  `calibratedAt` = NULL,
  `calibratedRoute` = NULL,
  `calibratedRunId` = NULL,
  `calibrationGenreBucket` = NULL,
  `calibrationStatus` = CASE
    WHEN `aiOverallScore` IS NOT NULL
      OR (`aiOverallRating` IS NOT NULL AND TRIM(`aiOverallRating`) != '')
    THEN 'legacy_uncalibrated'
    ELSE 'unscored'
  END
WHERE `calibratedRunId` = 'prod_20261124_p1_b01';
```
（SQLite 側も同一 `WHERE calibrated_run_id = '...'` で戻す。旧点数カラムは最初から触れていないため、データ欠損ゼロで即復元できる。）

### ケース B：D の初期印付けだけ取り消したい場合
```sql
UPDATE `videos`
SET `calibrationStatus` = NULL, `updatedAt` = `updatedAt`
WHERE `calibratedScore` IS NULL;
```

### ケース C：マイグレーション自体（10カラム追加）を完全撤回したい場合
```sql
DROP INDEX `idx_videos_calibration_status` ON `videos`;
DROP INDEX `idx_videos_calibrated_run_id` ON `videos`;
ALTER TABLE `videos`
  DROP COLUMN `calibrationStatus`,
  DROP COLUMN `calibratedScore`,
  DROP COLUMN `calibratedRank`,
  DROP COLUMN `calibratedTierBand`,
  DROP COLUMN `calibratedBreakdown`,
  DROP COLUMN `calibrationVersion`,
  DROP COLUMN `calibratedAt`,
  DROP COLUMN `calibratedRoute`,
  DROP COLUMN `calibratedRunId`,
  DROP COLUMN `calibrationGenreBucket`;
```
SQLite は `iketeru_knowledge_backup.db`（SHA-256 検証済み）をそのまま戻すだけで数秒で完全復元可能。万一 TiDB 側で予期せぬ障害が起きた場合も、`tidb_videos_backup.jsonl`（SHA-256 検証済み）から全行復元可能。

---

## 7. 読み取り専用ドライラン実測結果（2026-11-23 実行・DB無変更）

実行コマンド：`node scripts/dryrun-phase3-calibration-rollout.mjs`  
出力ファイル：[phase3_rollout_dryrun_report.json](../analysis/phase3_rollout_dryrun_report.json)

### 7.1 現在のスナップショット（書き込み前）
- **本番 TiDB `videos`**: **5,653行** / 既存40カラム / 校正カラム0個 / `MAX(updatedAt) = 2026-11-21T17:57:26.000Z`
- **ローカル SQLite `iketeru_knowledge.db`**: **5,635行** / 既存34カラム / 校正カラム0個 / `1,449,013,248` bytes（約1.35 GB） / SHA-256: `f25c464f7a5a8531843205f9e940ee0cc880d7e7e1985c5fdb83c33319064cc3`
- **TiDB vs SQLite ID差分**: 共通 `5,587`件 / TiDBのみ `66`件 / SQLiteのみ `48`件
- **Phase 2 Dev/Holdout との重複**: `0`件（既存5,653本と完全分離）

### 7.2 D（マイグレーション＋初期印付け）の書き込み対象件数

| 対象DB | 総行数 | 旧点数カラム上書き件数 | `legacy_uncalibrated` 付与 | `unscored` 付与 | 新規 `calibrated*` 欄 |
|---|---:|---:|---:|---:|---:|
| **本番 TiDB** | 5,653 | **0（完全保護）** | **5,252**（100点あり 4,566＋文字評価のみ 686） | **401** | 全5,653行 `NULL` 初期化 |
| **ローカル SQLite** | 5,635 | **0（完全保護）** | **5,495**（100点あり 1,062＋文字評価のみ 4,433） | **140** | 全5,635行 `NULL` 初期化 |

### 7.3 C（優先順の再採点）の対象件数・バッチ計画（1回最大200本）

ジャンル判定は **保守的規則** を採用（第一ジャンル `genres[0]` が未検証ジャンル `opening` / `concept-art` / `youtube-sns` / `film` / `teaser-trailer` / `documentary` / `making` / `how-to` / `event-live` / `showreel` / `empty` / 純`branded-movie` の場合は、`directions` にモーションや3Dが付いていても **未検証扱い** として過剰な検証済み認定を防ぐ）。

| 優先順 | 対象条件 | 総本数 | 取得可能見込み | 取得制限/非対応見込み | バッチ数（最大200本） | 付与予定ステータス |
|---|---|---:|---:|---:|---:|---|
| **① 最優先** | `privateRating` あり（ユーザー自己評価済み） | **492** | 485 | 7（`external` 4＋`restricted` 3） | **3バッチ**（`200 + 200 + 92`） | 検証済5枠 `251` / **未検証印** `241` |
| **② 第2優先** | 検証済み5ジャンル（①除く） | **3,420** | 3,024 | 396（`restricted` 396） | **18バッチ**（`200×17 + 20`） | 全3,420本 `calibrated_verified` |
| **③ 第3優先** | 未検証ジャンル（①②除く・小規模検証後） | **1,741** | 1,563 | 178（`restricted` 174＋`IG` 3＋`ext` 1） | **9バッチ**（`200×8 + 141`） | 検証前は全1,741本 **`calibrated_unverified_genre`** |
| **合計** | **全件一致検算済み** | **5,653** | **5,072** | **581** | **30バッチ** | — |

#### 優先①（492本）の詳細内訳
- **プラットフォーム**: Vimeo `469`（95.3%） / YouTube `19` / external `4`（Vimeo 中心のため YouTube ボット確認リスクが極めて低い）
- **ジャンル枠内訳**:
  - 検証済み5枠（`251本` → `calibrated_verified`）: モーション `89` / CM `72` / MV `72` / 企業映像 `17` / 3DCG・アニメ `1`
  - 未検証枠（`241本` → `calibrated_unverified_genre`「このジャンルは未検証」印）: `opening` 88 / `concept-art` 72 / `teaser-trailer` 22 / `film` 21 / `documentary` 13 / `branded-movie` 13 / `youtube-sns` 12

#### 優先②（3,420本）の詳細内訳
- **プラットフォーム**: YouTube `3,302` / Vimeo `118`
- **ジャンル枠内訳**: `MV` 2,081 / `CM` 756 / `モーション` 309 / `企業映像` 272 / `3DCG/アニメ` 2
  - ※既存DBの `genres` 列は用途分類（MV/CM/企業等）であり、3DCG/アニメ作品は各用途ジャンル＋`directions/expressions` タグで管理されているため、単体ジャンルとしての `3DCG/アニメ` は2本となる。

#### 優先③（1,741本）のジャンル別内訳と小規模検証計画
- `opening`（288）/ `empty（ジャンル未付与）`（251）/ `youtube-sns`（221）/ `concept-art`（220）/ `film`（190）/ `teaser-trailer`（166）/ `branded-movie（純ブランデッド）`（122）/ `making`（78）/ `documentary`（71）/ `how-to`（50）/ `event-live`（50）/ `showreel`（33）/ `web`（1）
- **運用規則**: 各ジャンルでまず 15〜20本程度の小規模検証を行い、Phase 2 v1 の物差し（`T_award=83, T_low=63`）が妥当に機能するかを確かめてから「未検証」印を外す。確かめる前に採点した動画（優先①の241本を含む）は、必ず `calibrationStatus = 'calibrated_unverified_genre'` を付与する。

#### 動画取得の安全運用ルール（C 全バッチ共通）
- **Cookie なし・ログインなし・回避処理なし**（`yt-dlp` 公開アクセスのみ）
- **リクエスト間隔**: 15〜30秒のランダム待機
- **ボット確認・429 検知時**: その場で即中断し、完了分までの途中経過を報告（リトライ回避・プロキシ切替等は禁止）
- **バッチ上限**: 1回最大 **200本**。1バッチ完了（取得→ブラインド採点→厳格監査100%→バックアップ済みDBへ反映）ごとに必ず報告して停止し、ユーザー確認後に次バッチへ進む。

---

## 8. Phase 2 v2 改善検討メモ（記録のみ・今回は凍結ルールを変更しない）

> **注意**: 本セクションは将来の `phase2_v2` 検討用メモであり、現在の `phase2_v1` 凍結設定（[phase2_frozen_config_v1.json](../analysis/phase2_frozen_config_v1.json)）には**一切適用しない**。

- **観測事象（Holdout v1 にて確認）**:
  - Cannes Corporate 2024「D.47 Best Sound Design（音響デザイン賞）」受賞作 `LgvVJkTeWBw`（Michelin, a matter of substance, 294.7秒）は、平均カット間隔 12.8秒（`H2-b` の静的長尺条件 `>= 15.0秒` にわずかに未達）のため `contact_sheet`（静止画・音声非聴取）ルートで採点された。
  - 静止画スコアが `79.0点`（`79/79`）となり、`H2-a` 境界条件（`83 ± 3 = 80〜86`）を 1点下回ったため動画ルートへ昇格せず、音響デザイン賞作品でありながら一度も音声を聴かれないまま Tier 2 見逃しとなった。
- **v2 ルール候補（要・新規 Dev/Holdout v2 検証）**:
  - **H1-d 候補（音響重視作品の動画ルート直行）**: 受賞部門に音響・音楽系（Best Sound Design / Best Music / Sound & Music 等）が含まれる作品、またはメタデータ／解析タグ上で音響設計が主評価軸となる作品（例：音ハメ・ASMR・サウンドデザイン特化）を、静止画ではなく最初から `video` ルートへ振り分ける規則を検討する。
  - **H2-b 候補（長尺作品の閾値見直し）**: 3分超の長尺映像（例：`duration_sec >= 180`）では平均カット間隔 `12秒` 程度でも静止画16〜32枚の情報落ちが大きい可能性があるため、`v2` 設計時に H2-b の尺×カット間隔条件を再評価する。
