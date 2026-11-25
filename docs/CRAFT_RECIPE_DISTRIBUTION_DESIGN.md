# クラフトレシピ正本配置・3 台並列分担・DB 同期 設計書

- **作成日**: 2026-11-25（`chibatmute`）
- **ステータス**: **設計完了・実装未着手**（ユーザー承認後に実装・移行・3 台分担を実行）
- **関連文書**: `docs/DECISIONS.md`（D-006, D-015, D-016, D-019, D-021, D-022）、`docs/MULTI_PC_WORKFLOW.md`、`docs/STATUS_OVERVIEW_20261125.md`、`docs/API_CRAFT_RECIPE_DESIGN.md`

---

## 1. 目的と基本原則（正本の分離）

現在 `craft_recipes`（439 本 / 1,036 カット / 約 4.06 GB）は `chibatmute` ローカルの `E:\iketeru-creative-studio\data\craft_recipes\` とローカル SQLite に閉じており、3 台（`chibatmute` / `CHIBA-PC` / `CHIBA-PC2`）での並列作成・共有・サイト表示ができない。
本設計では、競合コピーや SQLite 破損を起こさずに 3 台で並列作成・共有・Web 表示まで一気通貫させるため、責務を以下の 4 層に分離する。

| データ種別 | 正本（Source of Truth） | 書き込みルール | 他 PC への反映 |
|---|---|---|---|
| **レシピ実体ファイル**<br>（`recipe.json`, `.gif`, `.png`, `.jpg`, テレメトリ） | **Google ドライブ共有フォルダ**<br>（`<Drive>\マイドライブ\iketeru_craft_recipes\<video_id>\`） | **予約（claim）した 1 台だけ**が対象 `<video_id>` フォルダに書き込む。全 PC 共通の目次ファイルは一切置かない。 | Google Drive for Desktop が自動同期（各 PC は環境変数 `IKETERU_RECIPE_STORE_DIR` で参照） |
| **作業予約（claim）・設計書・コード** | **GitHub**（`iketeru-eizou` / `iketeru-creative-studio`） | `git pull --rebase` → 予約／完了 → 個別 `git add` → `commit` → `push` | 全 PC で `git pull` |
| **ローカル検索 DB**<br>（`iketeru_knowledge.db`） | **各 PC ローカル専有**（Google ドライブに置かない） | TiDB → `videos` 片道同期、Google ドライブ → `craft_recipes` 片道再構築 | 各 PC が手元で再構築スクリプトを実行 |
| **Web サイト表示用テキスト仕様** | **TiDB Cloud**（新規 `craftRecipes` テーブル） | 反映ロック（`_apply_lock.json`）により **1 台ずつ直列反映**（`--dry-run` → 承認 → `--apply`） | Web サイト（Vercel）が即時参照（※画像配信方法は別途決定） |

---

## 2. ファイル正本の配置設計とドライブ文字吸収

### 2-1. ディレクトリ構造（目次ファイル禁止）

```text
<IKETERU_RECIPE_STORE_DIR>/
  <video_id>/
    recipe.json          # カット定義・v2項目・telemetry・provenance・style_profile（最後に配置）
    cut_01.gif           # 2-pass ループGIF（最大4s）
    cut_01_strip.jpg     # 3x2 モーションストリップ
    cut_01_start.png     # 開始キーフレーム
    cut_01_mid.png       # 中間キーフレーム
    cut_01_end.png       # 終了キーフレーム（EOF クランプ済み）
    cut_02...
    _folder_manifest.json  # 任意：この <video_id> 単体のファイル一覧・バイト数・SHA-256・worker・run_id
```

- **厳守ルール（競合コピー防止）**:
  - ルート直下（`iketeru_craft_recipes/`）に、全 PC が書き換える目次・索引・ロックファイル（例：`index.json`, `catalog.json`, `lock.json` 等）を **一切置かない**。
  - 1 つの `<video_id>` フォルダは、Git claim でその ID を予約している 1 台だけが作成・更新する。
  - `_folder_manifest.json` を置く場合も `<video_id>/` 配下に閉じ込め、他動画と競合しない設計とする。

### 2-2. PC ごとのドライブ文字差分の吸収

各 PC の `.env`（またはユーザー環境変数、`mcp_config.json`）に **`IKETERU_RECIPE_STORE_DIR`** を設定する。

| PC（`IKETERU_WORKER_NAME`） | 既存動画キャッシュ（`IKETERU_VIDEO_CACHE_DIR`） | レシピ正本（`IKETERU_RECIPE_STORE_DIR`） |
|---|---|---|
| `chibatmute` | `D:\マイドライブ\iketeru_videos` | `D:\マイドライブ\iketeru_craft_recipes` |
| `CHIBA-PC` | `G:\マイドライブ\iketeru_videos` | `G:\マイドライブ\iketeru_craft_recipes` |
| `CHIBA-PC2` | `G:\マイドライブ\iketeru_videos` | `G:\マイドライブ\iketeru_craft_recipes` |

- **コード側のパス解決規則（`iketeru-creative-studio`）**:
  - `craft_recipes.py` の `get_craft_store_dir()` を新設し、優先順を `明示引数 craft_dir` → `環境変数 IKETERU_RECIPE_STORE_DIR` → 従来既定 `STUDIO_ROOT / "data" / "craft_recipes"` とする。
  - `recipe.json` および SQLite に保存するメディアパスは従来どおり **PC 非依存の相対パス**（`data/craft_recipes/<video_id>/cut_01.gif`）を維持する。
  - `resolve_studio_path()` は `data/craft_recipes/` プレフィックスを剥がした `<video_id>/<filename>` を、まず `get_craft_store_dir()` 配下で解決し、未存在時のみローカル `STUDIO_ROOT/data/craft_recipes/` にフォールバックする。これにより既存 439 本の相対パス形式を一切壊さず、3 台どのドライブ文字でも透過的に画像・GIF を開ける。

### 2-3. 安全な書き込みプロトコル（ローカル完成 → 一括移送）

Google Drive File Stream 上で `ffmpeg` や JSON 書き出しを直接行うと、途中状態のファイルが同期されたりロック競合を起こすおそれがある。必ず以下の 2 段階で行う：

1. **ローカル一時フォルダで完結生成**:
   - 各 PC のローカル一時ディレクトリ（例：`E:\iketeru_tmp\craft_staging\<run_id>\<video_id>\`）で全画像・GIF・テレメトリ・`recipe.json` を生成する。
   - 生成後に自動検証ゲート（後述 §6-4）をすべて通し、ファイル一覧・バイト数・SHA-256 を確定させる。
2. **検証済みフォルダの移送と事後照合**:
   - `<IKETERU_RECIPE_STORE_DIR>\<video_id>\` が既に存在する場合（v1→v2 格上げ等）：
     - 先に自 PC ローカルの退避先（`E:\iketeru_backups\craft_pre_upgrade_<run_id>\<video_id>\`）へ既存フォルダをバックアップする。
     - 旧カット数のほうが多かった場合のゴミファイル残留を防ぐため、新しいメディアファイル群（`.png`, `.jpg`, `.gif`）をコピーしてサイズ・SHA-256 を確認し、**最後に `recipe.json` と `_folder_manifest.json` を配置**し、不要になった旧カット番号のファイルのみ削除する。
   - 新規動画の場合：
     - `<IKETERU_RECIPE_STORE_DIR>\<video_id>\` を作成し、メディアファイル群をコピー → 最後に `recipe.json` / `_folder_manifest.json` を配置する。
   - 配置後、ドライブ側から読み戻して全ファイルのサイズ・SHA-256 がローカル一時フォルダと 100% 一致することを確認し、一致後に一時フォルダを削除する。

---

## 3. Git ベースの予約管理（claim の拡張）

Google ドライブは予約管理に使わず、既存の `analysis/claims/` と同じ Git ベース予約方式を採用する。

### 3-1. `task_type` の導入と名前空間分離

既存の Phase 3 採点予約と衝突しないよう、予約 JSON に `task_type` を追加する：

| `task_type` | 用途 | ファイル名規則 |
|---|---|---|
| `phase3_calibration`（既存・未指定時の既定） | Phase 3 点数付け | `analysis/claims/run_<YYYYMMDD_HHMMSS>.json` |
| `craft_recipe_v2_upgrade` | 既存 381 本（A- 以上・キャッシュ有）の v2 格上げ／再カット | `analysis/claims/craft_upg_<YYYYMMDD_HHMMSS>.json` |
| `craft_recipe_new` | 未レシピ（A- 以上・キャッシュ有）の新規 v2 作成 | `analysis/claims/craft_new_<YYYYMMDD_HHMMSS>.json` |

### 3-2. 予約 JSON スキーマ案

```json
{
  "schema_version": 2,
  "task_type": "craft_recipe_v2_upgrade",
  "run_id": "craft_upg_20261126_090000",
  "worker": "chibatmute",
  "status": "active",
  "target_pool": "381_gt15s_ge78",
  "min_calibrated_score": 78,
  "require_local_cache": true,
  "batch_size": 25,
  "video_ids": ["..."],
  "claimed_at": "2026-11-26T00:00:00.000Z",
  "completed_at": null,
  "released_at": null,
  "release_reason": null
}
```

### 3-3. 競合防止ルール

- `--verify` は **同じ `task_type` グループ（`craft_recipe_*` 全体で 1 グループ）内の `status === "active"` 間で `video_ids` 重複が 0 件であること** を検証し、1 件でも重複があれば終了コード 1 で即停止する（`phase3_calibration` とは別グループとして独立チェック）。
- 予約手順は既存 `MULTI_PC_WORKFLOW.md` と完全同一：
  1. `git pull --rebase --autostash origin main`
  2. `node scripts/claim-craft-batch.mjs --claim --worker <PC名> --pool <対象プール> --batch-size 25`
  3. `node scripts/claim-craft-batch.mjs --verify`
  4. `git add analysis/claims/<run_id>.json analysis/claims/<run_id>_ids.json` → `git commit` → `git pull --rebase --autostash origin main` → `git push`
  5. 競合して push が弾かれたら pull して `--verify` し、重複があれば自分の予約ファイルを消して再予約する。
- 作業完了後は `--complete <run_id>`（中断時は `--release --run-id <run_id> --reason ...`）を実行し、push する。

---

## 4. ローカル SQLite の扱いと片道再構築スクリプト

### 4-1. 基本方針

- **SQLite（`iketeru_knowledge.db`）は絶対に Google ドライブに置かない**（SQLite の WAL/ロック機構とドライブ同期が衝突すると DB が破損し、競合コピーが発生するため）。
- 各 PC はローカルの `E:\iketeru-creative-studio\data\iketeru_knowledge.db` を維持し、以下の **2 本の独立した片道同期** で最新化する：
  1. **動画メタデータ・校正点数**: `TiDB → ローカル SQLite`（既存 `scripts/sync-tidb-to-sqlite-mirror.mjs`）
  2. **クラフトレシピ**: `Google ドライブ（IKETERU_RECIPE_STORE_DIR） → ローカル SQLite`（新設 `scripts/sync-craft-recipes-to-sqlite.mjs` または `iketeru_studio` CLI）

### 4-2. 片道再構築スクリプト仕様（`sync-craft-recipes-to-sqlite`）

- **入力**: `IKETERU_RECIPE_STORE_DIR` 配下の全 `<video_id>/recipe.json`（読み取り専用）
- **出力**: ローカル SQLite の `craft_recipes` および `craft_recipes_fts` テーブルのみ更新（`videos` / `scenes` テーブルは一切変更しない）
- **安全機構**:
  1. `--dry-run` モード：読み込み予定動画数・カット数・v2 件数・破損 JSON 件数・ローカル SQLite との差分（追加／更新／削除候補）のみ表示し、DB は開くだけ（書き込み 0）。
  2. **fail-closed 検証**：1 件でも `recipe.json` の JSON パース失敗・必須キー欠損・Google ドキュメント形式混入（`.gdoc` 検出）・`video_id` 不一致があれば、SQLite を一切書き換えずに終了コード 1 で停止する。
  3. **事前バックアップ**：`--apply` 実行前にローカル SQLite を `E:\iketeru_backups\sqlite_pre_craft_sync_<timestamp>\iketeru_knowledge.db` へ自動保存し、SHA-256 と `PRAGMA integrity_check` を記録する。
  4. **単一トランザクション置換**：`BEGIN IMMEDIATE` 内で `craft_recipes` と `craft_recipes_fts` を一括再構築（または `video_id` 単位のハッシュ比較による増分更新＋`--full-rebuild` で完全再構築）し、完了後に件数・FTS 件数一致・`videos` / `scenes` 行数不変を検証して `COMMIT`。
  5. **未視聴ハードゲート維持**：対象 `video_id` がローカル SQLite `videos` で `analysis_observation_scope IS NOT NULL` の場合はエラーまたはスキップ警告（D-021 / ルール 2 厳守）。

---

## 5. TiDB へのレシピ文章格納（Web サイト表示向け）

画像・GIF の Web 配信方法（Cloudflare R2 / S3 等）は別途決定とし、本設計では **サイトにレシピ文章（ソフト・プラグイン・パレット HEX・フレームタイムライン・手順・エフェクトチェーン等）を表示するための TiDB スキーマと同期手順** を定義する。

### 5-1. 容量見積もり

- 既存 439 本（1,036 カット）の `recipe_json` テキスト合計：**5.71 MB**（実測値）
- 対象 1＋2 の 263 本 v2 化後（約 513 本 / 1,350 カット想定）：**約 8〜10 MB**
- TiDB 無料枠（5 GiB）に対して **0.2% 未満** であり、テキスト仕様の全量格納は完全に許容範囲内。

### 5-2. TiDB 新規テーブル案（`drizzle/schema.ts`）

既存の `videos` テーブル（旧 40 列＋校正 10 列＋`analysisObservationScope`）には一切手を入れず、独立テーブル **`craftRecipes`**（1 行 = 1 カット）を追加する。

```ts
export const craftRecipes = mysqlTable("craftRecipes", {
  id: int("id").autoincrement().primaryKey(),
  videoId: varchar("videoId", { length: 64 }).notNull(),
  cutIndex: int("cutIndex").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  category: varchar("category", { length: 64 }).notNull(),
  startMmss: varchar("startMmss", { length: 16 }).notNull(),
  endMmss: varchar("endMmss", { length: 16 }).notNull(),
  startSec: decimal("startSec", { precision: 8, scale: 3 }).notNull(),
  endSec: decimal("endSec", { precision: 8, scale: 3 }).notNull(),
  durationSec: decimal("durationSec", { precision: 8, scale: 3 }).notNull(),
  primaryTool: varchar("primaryTool", { length: 64 }).notNull(),
  softwareJson: text("softwareJson").notNull(),           // JSON array
  pluginsJson: text("pluginsJson").notNull(),             // JSON array
  paletteJson: text("paletteJson").notNull(),             // JSON object {base, primary, accent}
  easingJson: text("easingJson"),                         // JSON object
  recipeJson: mediumtext("recipeJson").notNull(),         // カット完全JSON（frame_timeline, effect_chain, ae_blueprint, recreation_flow等）
  isV2: int("isV2").notNull().default(0),                 // 1 = frame_timeline + effect_chain + primary_tool 完備
  needsRecut: int("needsRecut").notNull().default(0),     // 1 = durationSec > 15.0
  credibilityScore: int("credibilityScore"),              // 0-100
  provenanceSource: varchar("provenanceSource", { length: 64 }), // antigravity_local_v2 | legacy_local_v1 | gemini_api_url_v1 等
  hasLocalMedia: int("hasLocalMedia").notNull().default(0),      // 正本ドライブにメディア実体あり=1
  mediaUrlManifestJson: text("mediaUrlManifestJson"),     // 将来用（R2/S3等の公開URL格納枠・初期はNULL）
  recipeSha256: varchar("recipeSha256", { length: 64 }).notNull(), // 差分検知・照合用
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("craft_recipes_video_cut_unique").on(table.videoId, table.cutIndex),
]);
```

- **この構造の利点**:
  - `videos` テーブル無変更（既存の Pre-D 旧 40 列ゼロ差分監査と 100% 干渉しない）。
  - サイト側は `SELECT videoId, COUNT(*) AS cutCount, MAX(isV2) AS hasV2 FROM craftRecipes GROUP BY videoId` でカード用バッジを軽量取得し、モーダルを開いたときだけ `WHERE videoId = ? ORDER BY cutIndex ASC` で本文を取得できる（トップ一覧の転送量を肥大化させない）。
  - 将来メディア配信先が決まったら `mediaUrlManifestJson` に URL を埋めるだけで UI 側をそのまま拡張できる。

### 5-3. TiDB 反映手順（安全ガード付き）

1. **DDL 適用（初回のみ）**: 事前に TiDB スナップショット取得 → ユーザー承認 → `CREATE TABLE IF NOT EXISTS craftRecipes ...` 実行 → `SHOW CREATE TABLE craftRecipes` 確認。
2. **データ反映（都度）**:
   - `node scripts/sync-craft-recipes-to-tidb.mjs --dry-run --worker <PC名>`（`IKETERU_RECIPE_STORE_DIR` から読み込み、`recipeSha256` で差分件数〔追加・更新・削除〕と合計サイズを表示）
   - **ユーザー承認**
   - 既存 `analysis/claims/_apply_lock.json` で反映ロック取得 → `commit & push`
   - `node scripts/sync-craft-recipes-to-tidb.mjs --apply --worker <PC名>`（`videos` テーブル不変確認＋投入行数・SHA-256 照合）
   - ロック解放 → `commit & push`

---

## 6. 既存 439 本（約 4.06 GB）の Google ドライブ移行と検証手順

### 6-1. 移行対象の現状フットプリント（2026-11-25 `chibatmute`・Step 2 修復後実測）

- フォルダ数：**439 フォルダ**
- 総ファイル数：**5,633 ファイル**（総バイト数：`4,266,958,223` bytes / **4,069.29 MB ≈ 4.07 GB**）
  - `.gif`: 1,042 ファイル / 2,772.27 MB
  - `.png`: 3,110 ファイル / 1,182.41 MB（欠損 `end.png` のうちキャッシュ有 32 枚を修復済み）
  - `.jpg`: 1,042 ファイル / 103.68 MB
  - `.json`: 439 ファイル / 10.94 MB（未出力 115 本を再出力し全 439 フォルダ完備）
- 今後の増分見込み：対象 1＋2（263 本）の v2 化・新規作成で **約 +1.5〜2.5 GB**（総計 **約 6〜7 GB**）。

### 6-2. 移行前の環境確認（空き容量・同期モード・変換防止）

移行実行前に全 3 台で以下を確認する：

1. **Google ドライブ（クラウド側）の空き容量確認**:
   - ブラウザで Google ドライブ左メニュー「保存容量」を開き、**空き容量が最低 20 GB 以上**あることを確認する（移行 4.1 GB ＋ 今後増分 2.5 GB ＋ 安全マージン）。
2. **各 PC のローカル空き容量と同期モード（ストリーミング vs ミラー）の確認**:
   - **コマンド確認（PowerShell）**:
     ```powershell
     # 1. Google Drive for Desktop の稼働確認
     Get-Process -Name "*GoogleDrive*" | Select-Object ProcessName, Path
     # 2. 各ドライブの空き容量確認（chibatmute 実測: D: 表示空き 235.23 GB / C: 265.87 GB / E: 4,468.37 GB）
     Get-PSDrive C, D, E, G -ErrorAction SilentlyContinue | Select-Object Name, Root, @{N='FreeGB';E={[math]::Round($_.Free/1GB,2)}}
     ```
   - **同期モードの確認方法（Google Drive for Desktop GUI）**:
     - タスクトレイの Google ドライブアイコン → 歯車「設定」→「Google ドライブ」タブを開く。
     - **「ファイルをストリーミングする」（仮想ドライブ `D:\マイドライブ` / `G:\マイドライブ`）** か **「ファイルをミラーリングする」** かを確認する。
     - **推奨設定**: **ストリーミングモード**（現行の `chibatmute` `D:\` / `CHIBA-PC` `G:\` / `CHIBA-PC2` `G:\` と統一）。さらに `iketeru_craft_recipes` は SQLite 再構築で 439 フォルダの `recipe.json` を一括走査するため、ローカル `C:` のキャッシュ空き容量が **30 GB 以上** あることを確認する（ネットワーク遅延を抑えたい場合のみ、`iketeru_craft_recipes` フォルダを右クリック →「オフラインアクセス」→「オフラインで利用可能にする」を選択可。ただしローカル容量を約 6〜7 GB 消費する）。
3. **Google ドキュメント形式へ変換されないことの確認ルール（D-019 準拠）**:
   - **ブラウザのドラッグ＆ドロップアップロードは絶対に使わない**（`.json` や `.md` が Google ドキュメントに変換されるおそれがあるため）。
   - 必ず Windows の **ローカルファイル操作（`robocopy` または検証スクリプトによるファイルコピー）** で `D:\マイドライブ\iketeru_craft_recipes\` へ配置する。
   - Google Drive Web 設定の「アップロードしたファイルを Google ドキュメント エディタ形式に変換する」が **オフ** であることも事前確認する。

### 6-3. 移行手順と前後検証（ファイル数・サイズ・SHA-256・形式検査）

1. **Step A（移行前マニフェスト生成・`chibatmute`）**:
   - `E:\iketeru-creative-studio\data\craft_recipes\` 内の全ファイルについて相対パス・バイト数・SHA-256 を算出し、`E:\iketeru_backups\craft_migration_pre_manifest.json` に保存する。
2. **Step B（コピー実行・`chibatmute`）**:
   - `D:\マイドライブ\iketeru_craft_recipes\` を作成し、`robocopy "E:\iketeru-creative-studio\data\craft_recipes" "D:\マイドライブ\iketeru_craft_recipes" /E /COPY:DAT /R:2 /W:3 /MT:4` でコピー（元フォルダは削除せず、全 3 台の検証完了までローカルバックアップとして保全する）。
   - Google Drive for Desktop のタスクトレイでアップロード完了（「最新の状態です」）を確認する。
3. **Step C（移行後検証・`chibatmute`）**:
   - 検証スクリプトで `D:\マイドライブ\iketeru_craft_recipes\` を全件スキャンし、以下 4 項目が 100% 合格することを確認：
     1. **フォルダ数・ファイル数・総バイト数** が移行前マニフェストと完全一致。
     2. **全ファイルの SHA-256** が移行前マニフェストと 100% 一致（不一致 0 件、欠損 0 件、余剰ファイル 0 件）。
     3. **Google ドキュメント変換ゼロ**：`.gdoc` / `.gsheet` / `.gslides` / 競合コピー名（`* (1).*`）が **0 件**。
     4. **全 `recipe.json` 妥当性**：全 439 本の `recipe.json` が UTF-8 で `json.loads()` 成功し、`video_id` が親フォルダ名と一致。
4. **Step D（他 PC からの読み取り検証・`CHIBA-PC` / `CHIBA-PC2`）**:
   - 各 PC の `G:\マイドライブ\iketeru_craft_recipes\` に対し、同一の検証スクリプト（`--verify-manifest` またはファイル数・総サイズ＋全 `recipe.json` SHA-256＋メディア抜き取り 30 件 SHA-256）を実行し、一致を確認する。
   - その後、各 PC でローカル SQLite 片道再構築スクリプト（`--dry-run` → `--apply`）を実行し、3 台の SQLite で `craft_recipes` 件数と内容が一致することを確認する。

---

## 7. キャッシュ済み動画の 3 台分担レシピ作業計画（D-022 準拠）

### 7-1. 対象本数の実測結果（2026-11-25 TiDB 1,012 件校正済み × SQLite × 共有キャッシュ）

D-022 方針（**手元動画キャッシュありは Antigravity 利用枠で処理、点数 A-〔78 点〕以上のみ対象**）に基づき、TiDB の最新校正点数（1,012 件）と `D:\マイドライブ\iketeru_videos` を突き合わせた実測本数は以下の通り。

| 対象区分 | 全体母数 | うちキャッシュ有 | うち校正済み | **D-022 対象（`calibratedScore >= 78`）** | 対象外（`< 78`） | 備考 |
|---|---:|---:|---:|---:|---:|---|
| **対象 1A（最優先）**：381 本中、非 v2 かつ **15 秒超カットあり** (`needs_recut`) | 196 | 163 | 163（100%） | **99 本** | 64 本 | 粗い長尺カットを 15 秒以下の技法粒度へ再カット＋v2 化 |
| **対象 1B（次優先）**：381 本中、15 秒以下だが v2 項目不足 | 162 | 136 | 136（100%） | **90 本** | 46 本 | `frame_timeline` / `effect_chain` / `ae_blueprint.layers` を補完 |
| *対象 1 小計（381 本中のキャッシュ有・非 v2）* | *358* | *299* | *299（100%）* | ***189 本*** | *110 本* | 未校正 0 本（全 299 本が校正済み） |
| **対象 2**：レシピなし・実視聴分析＋シーンあり 4,158 本中、キャッシュ有 | 138 | 138 | 138（100%） | **74 本** | 64 本 | 新規 v2 レシピ作成（※うち 7 本は旧 `aiTechniqueRating < A-`、下記注記参照） |
| **フェーズ 1 合計（対象 1 ＋ 対象 2）** | **496** | **437** | **437（100%）** | **263 本** | **174 本** | **3 台均等割で 1 台あたり約 88 本** |

> **参考（フェーズ 2 以降のキャッシュ有プール・すべて校正済み／D-022 `>= 78` 実測）**:
> - `craft_recipes` あり・`scenes` なし 58 本（全 58 本キャッシュ有）のうち非 v2 かつ `calibratedScore >= 78`: **38 本**
> - `watched_A`・`scenes` なし・`craft_recipes` なし（キャッシュ有 488 本、大半は Vimeo）のうち `calibratedScore >= 78`: **338 本**（未校正 1 本）
> - これらはフェーズ 1（263 本）完了後に、必要に応じてフェーズ 2 として着手できる。

> **重要注意点（対象 2 の 7 本における旧技術ランクとの整合）**:
> 対象 2 の `calibratedScore >= 78` **74 本** のうち、旧 `aiTechniqueRating >= A-` を満たすのは **67 本**、旧 `aiTechniqueRating <= B+` が **7 本** ある。現行の `iketeru_studio/indexer.py`（`search_craft_recipes` / `list_craft_recipes_for_ranking`）および `is_craft_eligible()` は旧 `technique_rating >= A-` をフィルタに使っているため、**D-022 に合わせて「`calibrated_score >= 78` なら適格（旧 `technique_rating` より校正点数を優先）」へ条件を拡張するか、あるいは 67 本に絞るか** を実装前に決める必要がある（§9 決定事項）。

### 7-2. 1 本あたりの所要時間と 3 台での所要日数見積もり

| 工程 | 1 本あたり実測／見積もり時間 | 備考 |
|---|---:|---|
| 動画プローブ＋`scdet` カット点検出＋ステージング | 約 5〜10 秒 | ローカル機械処理（`ffprobe` / `ffmpeg`） |
| Antigravity サブエージェントによる動画観察・v2 JSON 生成 | 約 2〜3 分 | `gemini-4-neon-high`、1 本 2〜4 カット（4〜6 並列で約 20〜30 本/時間） |
| `ffmpeg` GIF/PNG/JPG 切り出し＋テレメトリ計測＋自動 7 観点検証＋ドライブ移送照合 | 約 10〜20 秒 | ローカル機械処理 |
| **1 本あたり合計（実効）** | **約 2.5〜3.5 分** | 並列実行時の実効スループット：**約 20〜25 本/時間/台** |

Antigravity の 5 時間リセット利用枠を踏まえ、1 台あたりの無理のない日次処理量を **40〜50 本/日**（3 台合計 **120〜150 本/日**）とした場合の日数目安：

| ステップ | 対象本数 | 1 台あたり本数 | 3 台並列の所要日数目安 | 推奨バッチサイズ |
|---|---:|---:|---|---:|
| **Wave 1：対象 1A（15 秒超の再カット＋v2 化）** | **99 本** | 33 本 | **約 0.7〜1 日**（実稼働 1.5〜2 時間/台） | 15〜20 本/バッチ |
| **Wave 2：対象 1B（15 秒以下の v2 項目補完）** | **90 本** | 30 本 | **約 0.7〜1 日**（実稼働 1.5 時間/台） | 15〜20 本/バッチ |
| **Wave 3：対象 2（未レシピ 74 本の新規 v2 作成）** | **74 本** | 約 25 本 | **約 0.5〜1 日**（実稼働 1〜1.5 時間/台） | 15〜20 本/バッチ |
| **合計（フェーズ 1 完了）** | **263 本** | **約 88 本** | **約 2〜3 日** | 計 12〜15 バッチ |

### 7-3. 作業手順（Antigravity 担当役への割り当て・出力検証）

Phase 3 採点（D-010・D-012・D-019）で確立した厳格な運用をクラフトレシピ生成へそのまま展開する：

1. **予約（claim）と push**:
   - 各 PC は `git pull --rebase --autostash origin main` → `claim-craft-batch.mjs --claim --worker <PC名> --pool <381_gt15s_ge78|381_le15s_ge78|new_138_ge78> --batch-size 20` → `--verify` → commit & push。
2. **ローカル素材準備（`prepare-craft-batch`）**:
   - 共有キャッシュ（`IKETERU_VIDEO_CACHE_DIR`）から対象 MP4 を確認（100 MiB 超の場合は D-004 と同様に一時リサイズ／2-pass 再エンコードし `staging_deviation` を記録）。
   - `ffprobe` で厳密な動画尺・FPS を取得し、`ffmpeg scdet`（`detect_real_cuts`）で実測カット境界一覧を作成。
   - 対象 1（v2 格上げ）の場合は既存レシピと `scenes` を参考情報として同梱し、対象 2（新規）の場合は動画メタデータ・`scenes` を同梱した固定プロンプトをテンプレート関数から機械生成する。
3. **Antigravity サブエージェント割り当て＋即時プロンプト照合**:
   - モデルは **`gemini-4-neon-high`** 固定。1 サブエージェントにつき 1 本（または 2 本まで）を担当させ、最大 4〜6 並列で割り当てる。
   - 割り当て直後に `verify-dispatched-craft-prompt`（D-010 相当）でプロンプト完全一致を照合し、不一致なら結果を使わず即再割り当てする。
   - 会話が長くなったら引き継ぎメモを作って新しい会話へ切り替える（D-012）。
4. **出力 JSON の自動 7 観点検証ゲート（ローカル一時フォルダ）**:
   - **G1（スキーマ＆v2 必須）**: JSON パース成功、全カットに `frame_timeline`（2 要素以上）、`effect_chain`（1 要素以上）、`primary_tool`、`ae_blueprint.layers`（1 層以上）。
   - **G2（尺・フレーム整合）**: 全カット `0.067s <= duration <= 15.0s`（`needs_recut == False`）、`0 <= start_sec < end_sec <= ffprobe_duration + 0.1s`、実測 FPS 基準のフレーム番号整合。
   - **G3（信頼性スコア）**: `score_recipe_credibility() >= 90`（目標 100）。
   - **G4（制作基準ハードチェック）**: `validate_production_compliance()` 合格（生成 AI 動画語 0・画像テロップ語 0・BGM/SE 独立トラック明示）。
   - **G5（メディア＆テレメトリ完備）**: ローカル MP4 から `capture_cut_visuals()`（`end_t` を `min(end_t, dur - 0.15)` へ EOF クランプ済み）＋ `measure_cut_telemetry()` を実行し、全カットの `.gif` / `_strip.jpg` / `_start.png` / `_mid.png` / `_end.png` が実在かつサイズ > 0、`telemetry.available == True`。
   - **G6（パス衛生・出どころ）**: PC 依存絶対パス 0 件（相対パス `data/craft_recipes/<id>/...` 統一）、`provenance`（`source: "antigravity_local_v2"`, `worker`, `run_id`, `model`, `verified_at`）記録。
   - **G7（未視聴除外・D-022 適合）**: `analysis_observation_scope IS NULL` かつ `calibrated_score >= 78`。
   - 不合格のカットは失敗理由を添えてサブエージェントへ 1 回差し戻し（2 回失敗時はスキップ記録し次へ進む）。
5. **ドライブ移送・完了・同期**:
   - 検証合格した `<video_id>` フォルダを §2-3 の手順で `IKETERU_RECIPE_STORE_DIR\<video_id>\` へ配置し SHA-256 照合。
   - バッチ全本完了後、`claim-craft-batch.mjs --complete <run_id>` → `commit & push`。
   - 各 PC で `sync-craft-recipes-to-sqlite` を実行して手元 SQLite を最新化。区切りごとに TiDB `craftRecipes` へロック付きで反映する。

---

## 8. 実装に必要な変更ファイル・新規作成ファイル一覧

### 8-1. `iketeru-eizou` リポジトリ

| 区分 | ファイルパス | 役割・変更内容 |
|---|---|---|
| **新規** | `scripts/claim-craft-batch.mjs` | レシピ作業専用の Git claim 管理（`task_type: craft_recipe_v2_upgrade / craft_recipe_new`、`--status` / `--claim` / `--verify` / `--complete` / `--release`、D-022 `calibratedScore >= 78` ＆キャッシュ有フィルタ）。 |
| **新規** | `scripts/claim-craft-batch.test.mjs` | `claim-craft-batch.mjs` の重複検出・プール抽出・既存 Phase 3 claim との非干渉テスト。 |
| **新規** | `scripts/migrate-craft-recipes-to-drive.mjs` | 既存 439 本の移行前マニフェスト生成・コピー・移行後全件 SHA-256 検証・`.gdoc`／競合コピー検出・他 PC 検証モード。 |
| **新規** | `scripts/sync-craft-recipes-to-sqlite.mjs` | `IKETERU_RECIPE_STORE_DIR` → ローカル SQLite `craft_recipes` / `craft_recipes_fts` の片道再構築（`--dry-run`・事前バックアップ・fail-closed・単一トランザクション）。 |
| **新規** | `scripts/sync-craft-recipes-to-sqlite.test.mjs` | 片道再構築スクリプトの単体テスト（破損 JSON 拒否・`.gdoc` 拒否・`videos`/`scenes` 不変確認）。 |
| **新規** | `scripts/sync-craft-recipes-to-tidb.mjs` | `IKETERU_RECIPE_STORE_DIR` → TiDB `craftRecipes` テーブルへのロック付き同期（`--dry-run` → 承認 → `_apply_lock.json` → `--apply` → 検証）。 |
| **新規** | `scripts/prepare-craft-batch.mjs` | 予約 ID のキャッシュ MP4 確認・`ffprobe` / `scdet` 抽出・固定プロンプト生成・ローカルステージング準備。 |
| **新規** | `scripts/validate-and-publish-craft-batch.mjs` | 7 観点自動検証ゲート（G1〜G7）＋ `ffmpeg` 切り出し＋テレメトリ計測＋`IKETERU_RECIPE_STORE_DIR` への検証付き移送。 |
| **変更** | `scripts/claim-phase3-batch.mjs` | `loadAllClaims()` / `verifyActiveClaims()` で `craft_*`（別 `task_type`）を誤って Phase 3 予約として読まないよう `task_type` フィルタを追加（既存テスト全件維持）。 |
| **変更** | `drizzle/schema.ts` | `craftRecipes` テーブル定義を追加（既存 `videos` テーブルは無変更）。 |
| **変更** | `server/db.ts` / `server/routers.ts` | （サイト表示実装時）`craftRecipes` 取得クエリと tRPC エンドポイント追加。 |
| **変更** | `docs/MULTI_PC_WORKFLOW.md` | `IKETERU_RECIPE_STORE_DIR` 設定、レシピ予約・移送・SQLite 再構築・TiDB 同期の手順章を追記。 |

### 8-2. `iketeru-creative-studio` リポジトリ

| 区分 | ファイルパス | 役割・変更内容 |
|---|---|---|
| **変更** | `iketeru_studio/craft_recipes.py` | ① `get_craft_store_dir()` 追加（`IKETERU_RECIPE_STORE_DIR` 優先、未設定時は `data/craft_recipes`）、② `resolve_studio_path()` でストア優先解決、③ `capture_cut_visuals()` に `ffprobe` 尺取得＋`end_t` の EOF クランプ（`min(end_t, dur - 0.15)`）を追加し `end.png` 欠損バグを根絶。 |
| **変更** | `iketeru_studio/indexer.py` | ① `get_craft_recipe` / `search_craft_recipes` で `get_craft_store_dir()` を参照、② （承認時）D-022 に合わせて `calibrated_score >= 78` の動画を `technique_score >= A-` フィルタで弾かないよう条件調整。 |
| **変更** | `tests/test_studio.py` | `IKETERU_RECIPE_STORE_DIR` 解決テスト、EOF 付近 `end_png` クランプテスト、D-022 適格条件テストを追加。 |

---

## 9. 実装・移行前にユーザーが決める必要があること

1. **共有フォルダ名と同期設定の確定**:
   - Google ドライブ共有フォルダの配置先を **`マイドライブ\iketeru_craft_recipes\`**（環境変数 `IKETERU_RECIPE_STORE_DIR`）としてよいか。
   - 3 台の Google ドライブ空き容量（クラウド空き 20 GB 以上）と同期モード（ストリーミング推奨）を確認のうえ、既存 439 本（約 4.06 GB）の移行へ進んでよいか。
2. **D-022「A-（78 点）以上」と旧 `aiTechniqueRating` フィルタの整合（対象 2 の 7 本）**:
   - 対象 2（74 本）のうち、校正総合点 `calibratedScore >= 78` だが旧技術ランク `aiTechniqueRating <= B+` の **7 本** について：
     - **案 A（推奨）**: D-022 に従い `calibratedScore >= 78` を正として全 **74 本** を作成し、`indexer.py` / `is_craft_eligible()` も「校正済みなら `calibrated_score >= 78` で適格（未校正のみ旧 `technique_rating >= A-`）」に合わせる。
     - **案 B**: 現行 `indexer.py` を変えず、旧 `aiTechniqueRating >= A-` も満たす **67 本** に絞る。
3. **TiDB `craftRecipes` テーブルの追加タイミング**:
   - 先に Google ドライブ正本化＋3 台並列レシピ作成（ファイル＆ローカル SQLite 再構築）を先行し、TiDB `craftRecipes` テーブル追加・Web UI 表示はその後にするか、同時に実装するか。
4. **フェーズ 2 候補（`scenes` なしのキャッシュ済み動画）の扱い**:
   - フェーズ 1（対象 1＋2＝**263 本**）完了後、`scenes` なしのキャッシュ済み `>= 78` 動画（既存レシピ 58 本中の非 v2 **38 本** ＋ 未レシピ **338 本**）をフェーズ 2 として続けるか。
