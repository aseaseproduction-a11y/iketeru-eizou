# 分析の版管理（`analysisVersion` / `videoAnalysisHistory`）設計書

- **作成日**: 2026-11-26（担当: `CHIBA-PC2`）
- **ブランチ**: `feature/analysis-version`（プレビュー確認用・本番 TiDB DDL 未実行・承認待ち）
- **整合元**:
  - `chibatmute` の v3 書き込みスクリプト定義
  - `G:\マイドライブ\iketeru_analysis_v3\_docs\PILOT_V3_REPORT.md` 第 5 章（パイロット検証 10 本：旧分析 0/30 → v3 9/10 合格・幻覚 0 件・時刻ずれ中央値 0.00 秒）
  - 正本格納先：`G:\マイドライブ\iketeru_analysis_v3\<video_id>\`（`analysis_v3.md`, `manifest.json`, `scdet.json`, `mechanical_check.json`, `audit.json`）

---

## 1. 背景

旧分析（`legacy`）の抜き取り 30 本点検では 30 本中 0 本しか合っておらず、約 60 秒ごとの機械的な区切りや映像にない内容（幻覚）が混入していた。一方、新方式 `v3`（手元 MP4 実視聴＋`ffmpeg scdet` 境界参照＋機械チェック＋独立再点検）では 9/10 本合格・重大 0 件・幻覚 0 件・時刻ずれ中央値 0.00 秒を達成したため、順次 `v3` への作り直しを進めている。

移行期間中は `legacy` と `v3` が混在するため、以下を実現する：
1. DB 上で各動画・各シーンの分析版とプロンプト SHA-256 を記録し、旧分析本文は `videoAnalysisHistory` に保全する。
2. 画面（動画カード・動画詳細レポート・シーン検索カード）に分析版を表示し、`legacy` には **`旧分析・時刻は目安`** の注意を出す。`v3` へ更新された動画からは自動で注意表示を消す。
3. シーン検索に **「旧分析を除く（v3 のみ表示）」** 絞り込みを追加する。

---

## 2. テーブル・カラム定義（`chibatmute` 書き込みスクリプトと完全一致）

移行ファイルは **`drizzle/add_analysis_version.sql`** に配置（**本番 TiDB への DDL 実行は承認後**）。

### 2-1. `videos` 追加カラム（3 列）

| カラム名 | 型・制約 | 用途・備考 |
|---|---|---|
| `analysisVersion` | `varchar(16) NOT NULL DEFAULT 'legacy'` | `'legacy'` または `'v3'`（既定 `'legacy'`）。`legacy_v1` / `v3.1` などの表記揺れは作らない。 |
| `analysisGeneratedAt` | `timestamp NULL DEFAULT NULL` | `v3` 等の分析生成完了日時（UTC）。`legacy` は `NULL`。 |
| `analysisPromptSha256` | `varchar(64) NULL DEFAULT NULL` | 生成に使用したプロンプトの SHA-256。**v3 と v3.1 等のプロンプト改訂差分はこの値で見分ける**。 |

### 2-2. `videoAnalysisHistory` 新設テーブル（9 列）

差し替え前の旧分析（`aiAnalysis`）を退避・保全する履歴テーブル。

| カラム名 | 型・制約 | 用途・備考 |
|---|---|---|
| `id` | `int AUTO_INCREMENT PRIMARY KEY` | サロゲート主キー |
| `videoId` | `varchar(64) NOT NULL` | 対象動画 ID（`videos.id` の論理参照） |
| `analysisVersion` | `varchar(16) NOT NULL` | 退避した分析の版（例：`'legacy'`, `'v3'`） |
| `aiAnalysis` | `mediumtext NOT NULL` | 退避した分析本文全文 |
| `contentSha256` | `varchar(64) NOT NULL` | `aiAnalysis` 本文の SHA-256（重複退避防止・改ざん検証） |
| `promptSha256` | `varchar(64) NULL DEFAULT NULL` | 退避した分析のプロンプト SHA-256（`legacy` は `NULL`） |
| `generatedAt` | `timestamp NULL DEFAULT NULL` | 退避した分析の生成日時（`legacy` は `NULL`） |
| `archivedAt` | `timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP` | 履歴テーブルへ退避した日時（UTC） |
| `archivedBy` | `varchar(64) NULL DEFAULT NULL` | 退避を実行したワーカー／スクリプト名（例：`chibatmute`） |

### 2-3. `videoScenes` カラム（`drizzle/create_video_scenes.sql` に統合済み）

| カラム名 | 型・制約 | 用途・備考 |
|---|---|---|
| `analysisVersion` | `varchar(16) NOT NULL DEFAULT 'legacy'` | `'legacy'` または `'v3'`。移行スクリプト（`scripts/sync-scenes-to-tidb.mjs`）は既存の SQLite シーンをすべて `'legacy'` として投入する。 |
| `analysisGeneratedAt` | `timestamp NULL DEFAULT NULL` | `v3` 生成完了日時（UTC）。`legacy` は `NULL`。 |

---

## 3. API 仕様と DDL 適用前の安全フォールバック

- **動画 API（`videos.list`, `videos.get`）**:
  - 返却オブジェクトに `analysisVersion` (`"legacy" | "v3"`)、`analysisGeneratedAt` (`string | null`)、`analysisPromptSha256` (`string | null`) を追加。
  - **DDL 未実行環境（プレビュー等）での安全動作**：本番 TiDB の `videos` にまだ上記 3 列が無い場合（`ER_BAD_FIELD_ERROR` / errno `1054`）、`server/db.ts` が自動検知して 3 列を含まないクエリへフォールバックし、全動画に `analysisVersion: "legacy"`, `analysisGeneratedAt: null`, `analysisPromptSha256: null` を付与して正常応答する（HTTP 500 にしない）。
- **シーン検索 API（`scenes.search`, `scenes.keywordStats`）**:
  - 入力に `excludeLegacyAnalysis?: boolean`（既定 `false`）を追加。`true` のときは `s.analysisVersion = 'v3'` で絞り込む。
  - 各返却シーンに `analysisVersion`・`analysisGeneratedAt` を含める。静的 `scenes_index.json` フォールバック時も `filterFallbackScenes` で同様にフィルタ・付与する。

---

## 4. UI 表示ルール（`PILOT_V3_REPORT.md` §5.2 準拠）

共通判定：`isLegacyAnalysisVersion(version) := version !== "v3"`

| 画面・コンポーネント | `legacy`（または未設定）時の表示 | `v3` 時の表示 |
|---|---|---|
| **動画一覧カード (`VideoCard.tsx`)** | 小型アンバーバッジ **`旧分析・時刻は目安`** を表示 | 注意バッジを自動で消し、控えめな緑系 **`分析 v3`** バッジを表示 |
| **動画詳細レポート (`AiAnalysisReport.tsx` / `VideoModal.tsx`)** | ヘッダーに **`旧分析・時刻は目安`** バッジ＋下部に 1 行の案内バーを表示。タイムスタンプ pill のツールチップにも「旧分析のため時刻は目安」を付記 | 注意バッジ・案内バーを自動で消し、**`分析 v3`** バッジ（ツールチップに生成日時・プロンプト SHA-256 先頭 8 桁）を表示 |
| **シーン検索カード (`SceneCard.tsx`)** | 時刻ピル付近に **`旧分析・時刻は目安`** バッジを常時表示。タイムラインバー `title` にも付記 | **`旧分析・時刻は目安`** バッジを自動で消し、精密時刻ピルのみをクリーンに表示 |
| **シーン検索フィルタ (`Home.tsx`)** | チェックボックス **「旧分析を除く（v3 のみ表示）」**（既定 OFF）を配置 | ON 時に `analysisVersion === "v3"` のシーンのみ表示 |

---

## 5. 本番反映までの承認ゲート
1. `chibatmute` の書き込みスクリプトと上記カラム名・型・既定値の最終突合。
2. ユーザー承認後、`_apply_lock.json` を取得して `drizzle/add_analysis_version.sql` を本番 TiDB に適用。
3. PR（`feature/analysis-version`）のマージ判断（`feature/scenes-tidb-api` マージ後）。
