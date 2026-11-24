# 「未視聴」印付け設計・ドライラン報告 ＆ 分析し直し計画

- **作成日時**: 2026-11-24（担当: `chibatmute`）
- **現在の状態**: **設計・ドライラン完了（本番 TiDB / ローカル SQLite への書き込みはゼロ）**。ユーザー承認後に本番反映（`--apply`）へ進みます。
- **関連データ**:
  - 未視聴監査レポート: `analysis/craft_calibration_pilot/unwatched_analysis_audit.md` / `.json`
  - 本番 TiDB 印付けスクリプト: `scripts/tag-unwatched-analysis-scope.mjs`
  - TiDB ドライラン結果（読み取り専用 `SELECT` のみ）: `analysis/craft_calibration_pilot/unwatched_tag_dryrun.json`
  - 共有 YouTube 再試行リスト（103本に更新済み）: `analysis/claims/_youtube_retry_list.json`
  - 改訂版プロンプト案（3ルール＋8組検証計画）: `docs/CRAFT_RECIPES_PROMPT_REVISION_PROPOSAL.md`

---

## 1. 「未視聴」印付けの設計（`analysisObservationScope` 列）とドライラン結果

### 1-1. 列の設計方針（既存の列と完全分離・非破壊）
本番 TiDB の `videos` テーブルに、既存の校正状態（`calibrationStatus`）とは**独立した専用列**を 1 列だけ追加します。

- **追加 DDL（列追加のみ）**:
  ```sql
  ALTER TABLE `videos`
    ADD COLUMN `analysisObservationScope` VARCHAR(40) NULL DEFAULT NULL
    AFTER `calibrationGenreBucket`
  ```
- **格納する値（4 区分 ＋ `NULL`）**:

| 値（`analysisObservationScope`） | 監査区分 | 意味 | TiDB 予定件数 | SQLite 予定件数 |
|---|---|---|---:|---:|
| `metadata_only_unwatched` | `B1` | 動画未視聴のまま、公式メタデータ・クレジット・サムネURLのみで作成された一次評価テンプレート（Britbox `1069311388` 等） | **249**（Vimeo 237 / YT 12） | **249**（Vimeo 237 / YT 12） |
| `missing_video_unwatched` | `B2` | 本文に「動画未取得・コンタクトシート未生成」と明記された未視聴記録 | **0** | **2**（YT `G4FxpJVuIfc`, `JVlAJlvaT0Y`） |
| `triage_boilerplate_unwatched` | `B3` | 映像実測値（fps/解像度/dB 等）が一切なく、定型テンプレート文のみの 1 次速報診断 | **8**（YT 8） | **8**（YT 8） |
| `triage_unverified_short` | 要確認 `C` | 固有の短文メモはあるが実測値記載がなく、実視聴か推測かを本文だけでは断定できない 1 次速報（まず再分析で白黒確認） | **17**（YT 17） | **21**（YT 21、うち 4 本は SQLite のみ） |
| `NULL`（既定値） | 実視聴済み / 未分析 | 実映像を視聴した分析、または未分析（`aiAnalysis` 空）のレコード | 5,379 | 5,421 |
| **印付け対象 合計** | **B1+B2+B3+C** | — | **274** | **280** |

### 1-2. 非破壊保証（絶対に変更しないもの）
1. **既存の `aiAnalysis`・旧スコア 8 列・旧 40 列全体**: **1 文字も上書きしません**。`--apply` 実行後、Phase 3 開始前バックアップ（`tidb_videos_backup.jsonl`, SHA-256 照合済み）と本番 TiDB 全 `5,653行 × 旧40列` を全量照合し、**差分 0** を自動検証します。
2. **Phase 3 校正列 10 列（`calibrationStatus` / `calibratedScore` 等）**: **一切変更しません**（そもそも今回対象 274 本と Phase 3 校正済み行との重複は **0 本** です）。
3. **更新日時（`updatedAt`）**: `SET analysisObservationScope = ?, updatedAt = updatedAt` で明示固定し、既存の更新日時も維持します。
4. **他 PC の `apply-phase3-batch-to-tidb.mjs` との完全互換**: 他 PC 側の旧 40 列照合はバックアップの `backupManifest.tidb.columns`（旧 40 列名リスト）を明示指定して `SELECT` するため、末尾に 1 列増えても他 PC のバッチ反映・照合を一切妨げません。

### 1-3. ドライラン実行結果 ＆ ロック安全確認（実測済み）
- **ドライラン実行コマンド（読み取り専用 `SELECT` のみ・書き込みゼロ）**:
  ```powershell
  node scripts/tag-unwatched-analysis-scope.mjs --dry-run --worker chibatmute
  ```
- **ドライラン実測値**（`analysis/craft_calibration_pilot/unwatched_tag_dryrun.json`）:
  - 実行日時: `2026-11-24T12:18:23Z`（JST 21:18）
  - Phase 3 開始前バックアップ SHA-256: `17856f0338c760b2f88d415543eb6d48a7977c06e76a5c04476b0d5943446a3b`（一致確認済み）
  - TiDB 総行数: **`5,653行`**
  - `analysisObservationScope` 列の存在: **`false`**（未追加）
  - 印付け予定件数: **`274件`**（`metadata_only_unwatched: 249`, `triage_boilerplate_unwatched: 8`, `triage_unverified_short: 17` / Vimeo `237`, YouTube `37`）
  - Phase 3 校正済み行との重複: **`0件`**（現時点の TiDB 校正状況: `calibrated_verified=204`, `calibrated_unverified_genre=189`, `legacy_uncalibrated=4,859`, `unscored=401`）
  - `craft_recipes` 元動画 439 本との重複: **`0件`**
- **書き込みロック未取得時の即停止テスト（実測済み）**:
  - ロック未取得のまま `node scripts/tag-unwatched-analysis-scope.mjs --apply --worker chibatmute` を実行し、`Refusing to write to TiDB without active write lock` で **終了コード 1・DB 書き込みゼロ** で停止することを確認済みです。

### 1-4. ユーザー承認後の本番反映（`--apply`）手順
承認いただいた後、以下の安全手順で実行します（**所要時間: 約 30〜60 秒 / AI 利用枠消費: 0**）：
1. `git pull --rebase --autostash origin main` で最新を取得し、他 PC が `_apply_lock.json` を掴んでいないことを確認。
2. `node scripts/claim-phase3-batch.mjs --acquire-apply-lock tag_unwatched_analysis_scope --worker chibatmute` → `git commit` & `git push` で本番書き込みロックを取得。
3. `node scripts/tag-unwatched-analysis-scope.mjs --apply --worker chibatmute` を実行：
   - 実行直前に**自 PC のローカル最新バックアップ**を `E:\iketeru_backups\pre_apply_unwatched_scope_<timestamp>\` に自動取得。
   - 列追加（`ALTER TABLE`）＋ 274 件の `analysisObservationScope` 更新のみ実施（`updatedAt = updatedAt`）。
   - 実行直後に `5,653行 × 旧40列` の全量差分 0 と、`counts_by_scope` 完全一致を自動検証し、証跡 JSON を保存。
4. `node scripts/claim-phase3-batch.mjs --release-apply-lock tag_unwatched_analysis_scope --worker chibatmute` → `git commit` & `git push` でロックを即解除。

---

## 2. ローカル SQLite 一方向同期 ＆ MCP 検索表示・手本除外の計画

### 2-1. SQLite への一方向同期（TiDB → ローカル SQLite ミラー）
本番 TiDB を唯一の正（Source of Truth）とし、既存の厳格一方向同期パイプラインをそのまま拡張します（SQLite → TiDB への逆流は一切なし）：

1. **スキーマ追加（`E:\iketeru-creative-studio\iketeru_studio\indexer.py`）**:
   - `CALIBRATION_COLUMNS` の直後に `OBSERVATION_SCOPE_COLUMNS = (("analysis_observation_scope", "TEXT DEFAULT NULL"),)` を追加し、`_init_schema()` の append-only マイグレーション（既存列・データ無変更）で自動付与。
   - `upsert_video()` で `analysisObservationScope` を受け取り保存できるように対応。
2. **一方向同期スクリプト拡張（`E:\iketeru-eizou\scripts\sync-tidb-to-sqlite-mirror.mjs`）**:
   - TiDB の `SELECT` クエリに `analysisObservationScope` を追加（読み取り専用）。
   - 共有行（5,587 行）は既存の 34 列を 1 バイトも変えず、校正 10 列＋`analysis_observation_scope` のみ更新。
   - **ローカル SQLite のみに存在する 48 行**は削除せず、そのうち今回の監査で該当した 6 行（`B2`: `G4FxpJVuIfc`, `JVlAJlvaT0Y` の 2 本、`C`: `ISrRQs87DnI`, `XPm7zy-X_fI`, `noFwvq8FHoI`, `qeddzEzDnic` の 4 本）について、TiDB 側と同一の厳密正規表現ルールで `analysis_observation_scope` を補完（SQLite 側合計 **280 件**）。
   - 同期後検証で `tidb_rows` 全 5,653 件の `analysis_observation_scope` 完全一致＋既存 34 列差分 0 を自動チェック。

### 2-2. MCP 検索結果への「未視聴」表示 ＆ 手本選びからの除外
対象ファイル: `E:\iketeru-creative-studio\iketeru_studio\indexer.py` および `mcp_server.py`

| MCP ツール | 変更内容 | 狙い |
|---|---|---|
| `search_references` / `search_scenes` | ・返却 JSON に `analysis_observation_scope`、`is_unwatched_analysis`（bool）、`observation_warning`（例: **`[未視聴・メタデータのみ]`** / **`[未視聴・定型速報]`** / **`[要確認・実測値なし]`**）を常時付与。<br>・引数 `exclude_unwatched: bool = False`（既定は警告付き表示、呼び出し側が `true` を渡せば検索除外も可能）を追加。 | 参考検索で見つかったときに「これは動画を見ずに書かれた記録だ」と人間・AI の双方が一目で判別でき、誤信を防げる。 |
| `search_craft_recipes` | ・既存の `exclude_provisional: bool = True` の直後に **`exclude_unwatched: bool = True`** を既定 ON で追加。<br>・SQL の `WHERE` 句に `v.analysis_observation_scope IS NULL` を自動挿入。 | 制作レシピ検索から未視聴・要確認動画を**既定で完全除外**する（現在 439 本との重複は 0 本だが、将来の混入を構造的にブロック）。 |
| `plan_craft_sequence` | ・内部で呼ぶ `search_craft_recipes(..., exclude_unwatched=True)` に加え、引数 `reference_video_ids` で明示指定された動画に `analysis_observation_scope IS NOT NULL` が含まれる場合は**手本採用を自動スキップし `excluded_unwatched_videos` 警告リストへ退避**する。 | 企画・コンテ・AE/Premiere 自動設計の手本選びに「未視聴推測」が紛れ込む事故をゼロにする。 |
| `get_craft_recipe` / `get_index_stats` | ・`get_craft_recipe` にも `analysis_observation_scope` と警告バッジを返却。<br>・`get_index_stats` に `unwatched_analysis_counts`（区分別件数）を追加。 | 全体の健全性（未視聴残数）をいつでもワンコールで把握できる。 |

---

## 3. 分析し直し（再分析）の計画

### 3-1. 共通ルール（厳守事項）
- **使用するプロンプト**: 改訂版プロンプト（`docs/CRAFT_RECIPES_PROMPT_REVISION_PROPOSAL.md` の 3 ルール：①実写/CG 断定禁止・両ルート併記、②未視聴時の手法・Tier 推定禁止、③リグ/裏方/合成マーカー等の隠れ工程チェック）。**凍結済み Phase 2 採点ルール（13 ファイル）には一切触れません**。
- **ダウンロード規約**: ログイン・Cookie・ボット確認回避は**一切使用しません**。未認証のまま 1 本ずつ間隔を空けて取得し、429 やボット確認が出た時点で即停止します。
- **DB への反映方針**: 実動画からコンタクトシート＋プローブ実測値（fps/解像度/音量）を生成して実視聴再分析が完了した行だけ、書き込みロック取得のうえ `aiAnalysis` を更新し `analysisObservationScope = NULL` に解除します（旧スコア列は凍結ポリシーに従い自動上書きしません）。

### 3-2. 3 段階の実行計画（ローカルキャッシュ実測反映済み）

ローカル動画キャッシュ（`D:\マイドライブ\iketeru_videos`）を全 280 本について照合した結果：
- **Vimeo（237 本）**: **8 本は既にキャッシュ済み**、**229 本が未取得**。
- **YouTube（43 本＝確定未視聴 22 本＋要確認 C 21 本）**: **0 本キャッシュ済み（全 43 本未取得）**。既存の YouTube 再試行リスト 60 本との重複は **0 本**。

この実測に基づき、以下の 3 段階で進めます：

#### Phase R1（最優先・白黒確認）：要確認 `C`（SQLite 21 本／うち TiDB 17 本・すべて YouTube）
- **目的**: 固有の短文メモはあるが実測値がない 21 本について、実映像を見て再分析し「実視聴だったのか／未視聴推測だったのか」の白黒を先につける。
- **リスト登録**: `analysis/claims/_youtube_retry_list.json` に `reanalysis_priority: "first_verify_black_or_white"` として登録済み（実行はユーザー指示待ち）。
- **手順**: 未認証 `yt-dlp` で 1 本ずつ **15〜20 秒間隔** で取得（ボット確認が出たら即停止）→ 取得成功分を ffmpeg でコンタクトシート化＋プローブ計測 → 改訂版プロンプトで再分析。
- **所要時間見込み**: ダウンロード約 10〜15 分 ＋ 再分析約 15〜25 分 ＝ **計 30〜40 分**。
- **AI 利用枠（クォータ）見込み**: **約 21 呼び出し**（Antigravity の 1 リセット枠の約 1/4〜1/3 程度で収まる軽い規模）。

#### Phase R2（本丸）：確定未視聴・Vimeo 237 本（`B1: metadata_only_unwatched`）
- **手順**:
  1. **先行 8 本（ローカルキャッシュ済み）**: ダウンロード不要。すぐコンタクトシート化＋改訂版プロンプトで再分析可能（所要約 10 分）。
  2. **残り 229 本（未取得）**: 未認証 `yt-dlp` で 1 本ずつ **10〜15 秒間隔**（失敗時は指数バックオフ、429/ボット制限時は即停止）で取得。
     - ※非公開・パスワード保護・ドメイン埋め込み制限により未認証では取得できない Vimeo 動画は、回避策を使わず「未認証取得不可（恒久未視聴維持）」として一覧に記録し、MCP では `[未視聴]` 警告・手本除外のまま安全運用します。
  3. **再分析**: 取得できた動画を **20〜25 本／Wave** の小バッチに分け、改訂版プロンプトで実映像再分析。
- **所要時間見込み**:
  - ダウンロード: 229 本 ×（取得＋10〜15 秒待機）≒ **約 1.5〜2.5 時間**（非公開・制限動画のスキップ割合により短縮）。
  - 再分析: 1 Wave（20〜25 本）あたり約 15〜20 分 × 最大 10 Wave ≒ **実稼働 2.5〜3.5 時間**。
- **AI 利用枠（クォータ）見込み**: 最大 **237 呼び出し**。Antigravity の個別枠リセット（約 5 時間ごと）を **3〜4 枠（2〜3 日間）** に分散して実行し、他作業の枠を圧迫しないようにします。

#### Phase R3（YouTube 再試行バッチ統合）：確定未視聴・YouTube 22 本（`B1` 12 + `B2` 2 + `B3` 8）＋ Phase 3 取得失敗 60 本
- **リスト統合済み**: `analysis/claims/_youtube_retry_list.json` を **全 103 本**（重複 0 件）に更新済みです：
  - **再試行可: 101 本**
    - Phase 3 取得失敗分: **58 本**（`bot_check` 44 / `format_unavailable` 14）
    - 未視聴・要確認の再分析分: **43 本**（`要確認 C` 21 / `B1` 12 / `B2` 2 / `B3` 8）
  - **恒久除外候補: 2 本**（`unavailable_or_private` 1 / `decode_corrupted` 1）
- **手順・所要時間・クォータ見込み**:
  - 明日以降にユーザーの実行指示が出てから、1 日あたり **15〜20 本上限・1 本 15〜30 秒間隔・未認証** で少しずつ再試行（ボット確認が出たら当日分を即終了）。
  - 確定未視聴 YouTube 22 本のみの再分析負荷は **約 22 呼び出し**（所要約 20〜30 分）。

---

## 4. 全体の優先順位 ＆ 利用枠（クォータ）食い合い防止ルール

| 優先順位 | 作業トラック | AI 利用枠消費 | 実行タイミング・競合防止ルール |
|---:|---|---|---|
| **1（最優先）** | **Track A：Batch 2（`run_20261124_080300`）完走**（残り 59 本／116 ジョブ） | **高**（最優先で確保） | クォータ回復（00:35 JST 目安）後、最優先で全枠を投入して完走 → ドライラン報告 → 承認後に TiDB 反映。 |
| **2（ゼロ枠・即時可）** | **本計画の「未視聴印付け」（TiDB `--apply` ＋ SQLite 一方向同期 ＋ MCP 表示/除外改修）** | **ゼロ（0）** | **AI 利用枠を一切消費しない**ため、Batch 2 のクォータ回復待ち中であっても、ユーザー承認があり次第いつでも先行実行可能。TiDB 書き込み時のみ `_apply_lock.json` で他 PC と排他制御。 |
| **3（中優先・軽量）** | **Track C の検証**（第 1 優先 7 作品のブラインド比較 ＋ 第 2 優先 8 組の改訂前後 Before/After 比較） | **低**（計 15〜25 呼び出し） | Batch 2 完走後に優先実施。改訂版プロンプトの精度改善（誤認率低下）を数値確認してから、大規模な再分析へ進むためのゲートとする。 |
| **4（分散実行）** | **未視聴レコードの再分析**（Phase R1 要確認 C 21 本 → Phase R2 Vimeo 237 本 → Phase R3 YouTube 22 本） | **中〜高**（複数日に分散） | Track C 検証合格後に着手。1 枠あたり 20〜25 本で止め、Phase 3 本番採点バッチと同一枠で同時実行しない。ダウンロード処理（AI 枠 0）だけは待機時間に先行実施可。 |
