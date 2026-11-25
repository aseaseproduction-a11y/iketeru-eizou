# 複数台PC 並列運用ガイド（iketeru-eizou / iketeru-creative-studio）

2台・3台以上の複数PC（Windows / Mac 混在可）で同時に開発・再採点・MV試作を進めても、**データ破損・二重採点・上書き衝突を起こさないための運用規約とツール手順**です。

---

## 1. 複数台運用の4原則（正本の分離）

| データ種別 | 唯一の正本（マスター） | 複数台での扱い |
|---|---|---|
| **コード・設計書・採点バッチログ・ID予約** | **GitHub**（`iketeru-eizou` / `iketeru-creative-studio` プライベートリポ） | 作業開始前に `git pull`、区切りごとに `git push`（大きな機能開発はPC別ブランチ推奨） |
| **動画の校正点数・状態（Phase 3）** | **TiDB（クラウド）** | 動画IDは予約（claim）で完全分離しつつ、**本番 TiDB への書き込み（`--apply`）は `analysis/claims/_apply_lock.json` により同時に1台だけ直列実行**する |
| **ローカルSQLite（`iketeru_knowledge.db`）** | **TiDBからの片道ミラー（参照専用）** | 各PCで必要に応じて `sync-tidb-to-sqlite-mirror.mjs` を叩き、他PCが反映した最新点数をプルする。`craft_recipes` テーブルへのローカル追記は1台（レシピ担当機）に集約する |
| **Antigravity 会話DB（`conversations/*.db`）** | **各PCローカル専用（統合不可）** | **同じ会話IDを複数台で同時に進めない**。別PCで作業するときは新しいチャットを立て、引き継ぎ状態は Git（`analysis/claims/`, `analysis/runs/`）と TiDB を参照する |

---

## 2. 複数台で Phase 3 C 再採点を並列実行する手順

動画IDの二重採点を防ぐため、`analysis/claims/<run_id>.json` に**Git管理の予約ファイル（claim）**を置いてから作業します。

### ステップ1: 最新状態を取得し、空きプールを確認（必須ルール）
**作業開始前・予約（`--claim`）前・`git push` 前に、必ず `git pull` してから `--verify` と `--status` を確認します。**（`pull` 前の古い状態から予約すると二重予約や不整合の原因になります。）
```powershell
cd C:\iketeru\iketeru-eizou   # 元PC・3台目PCは E:\iketeru-eizou
git pull --ff-only
node scripts/claim-phase3-batch.mjs --verify
node scripts/claim-phase3-batch.mjs --status
```

> **同一ホスト名PCの区別ルール（必須）**: 現在、OS ホスト名が同じ `CHIBA-PC` のマシンが2台存在します（3台目: ユーザー `n _chiba` / `E:\iketeru-eizou` → ワーカー名 **`CHIBA-PC`**、2台目: ユーザー `n_chiba` / `C:\iketeru\iketeru-eizou` → ワーカー名 **`CHIBA-PC2`**）。誤認を防ぐため、スクリプトから **`os.hostname()` フォールバックを完全撤去**しました。各PCの `.env`（Git管理外）に **`IKETERU_WORKER_NAME=<ワーカー名>` を必ず設定**し、CLI でも `--worker <ワーカー名>` を明示してください（どちらも未指定だと即エラー停止します）。

### ステップ2: このPC専用の動画ID枠を予約（claim）して即 push
```powershell
# 例: 残り craft_recipes（YouTube）を予約する場合
node scripts/claim-phase3-batch.mjs --claim --worker <このPC名> --priority P0_craft_recipes --batch-size 200

# 例: Priority 1（privateRating付き YouTube）を予約する場合
node scripts/claim-phase3-batch.mjs --claim --worker <このPC名> --priority P1_private_rating --batch-size 200

# 例: ローカルキャッシュ済みの非YouTube（Vimeo等）のみをダウンロード無しで予約する場合
# （キャッシュ先は環境変数 IKETERU_VIDEO_CACHE_DIR または .env で指定可。未設定時は D:\マイドライブ\iketeru_videos）
node scripts/claim-phase3-batch.mjs --claim --worker <このPC名> --priority P1_private_rating --batch-index 2 --batch-size 200 --non-youtube --cached-only --dry-run

# 例: 残りの未校正 YouTube 全体から200本予約する場合
node scripts/claim-phase3-batch.mjs --claim --worker <このPC名> --priority ALL --batch-size 200
```

#### 追加オプション一覧（すべて任意・未指定時は従来動作のまま）
- `IKETERU_WORKER_NAME`（環境変数または `.env`、**必須**）: `--worker` 省略時のワーカー名（`os.hostname()` フォールバックは撤去済み）。同一ホスト名PCの混同防止のため、`.env` に必ず設定しつつ CLI でも `--worker` を明示する。
- `IKETERU_PRE_D_BACKUP_PATH`（環境変数または `.env`、任意）: Phase 3 開始前バックアップ（`tidb_videos_backup.jsonl`、旧40列全行照合用）のローカルパス（未設定時は `analysis/phase3_pre_d_backup_manifest.json` のパス）。毎回 SHA-256（`17856f0338c760b2f88d415543eb6d48a7977c06e76a5c04476b0d5943446a3b`）で同一性を厳密検証する。
- `IKETERU_BACKUP_ROOT`（環境変数または `.env`、任意）: 各 `--apply` 直前に自動取得する「最新ローカルバックアップ」の保存親フォルダ（未設定時は `E:\iketeru_backups`）。
- `IKETERU_VIDEO_CACHE_DIR`（環境変数または `.env`）: 動画キャッシュディレクトリの上書き（未設定時は `D:\マイドライブ\iketeru_videos`）。`claim-phase3-batch.mjs` と `prepare-phase3-batch.mjs` の両方で参照。
- `IKETERU_BLIND_ROOT`（環境変数または `.env`、または `--blind-root` 引数）: **凍結ファイル `scripts/lib/calibration-prompt-template.mjs` が `E:\iketeru_blind_eval` を固定要求するため、それ以外のパスを指定すると `prepare` の先頭（`--dry-run` 含む）で即停止します**。`E:` ドライブが無いPCでは、通常ユーザー権限で **`subst E: C:\iketeru`** のように仮想ドライブ `E:` を割り当て、`IKETERU_BLIND_ROOT=E:\iketeru_blind_eval`（または未設定）のまま、以後のコマンドも `E:\iketeru-eizou` から実行してください。
  - **重要（`subst` 運用時の毎回確認）**: `subst` は再起動・サインアウトで解除され、管理者権限プロセスからは見えません。`prepare` や採点を始める前に毎回 **`Test-Path E:\iketeru_blind_eval`** を確認し、`False` なら再度 `subst E: C:\iketeru` を実行してください。
  - **2台目PC（`CHIBA-PC2` / `subst E: C:\iketeru` 利用）の `.env` 設定例**:
    ```env
    IKETERU_WORKER_NAME=CHIBA-PC2
    IKETERU_VIDEO_CACHE_DIR=G:\マイドライブ\iketeru_videos
    IKETERU_BLIND_ROOT=E:\iketeru_blind_eval
    ```
- `claim-phase3-batch.mjs`:
  - `--priority <値>`: 指定できる優先度名は **`P0_craft_recipes`、`P1_private_rating`、`P2_verified_5_genres`、`P3_unverified_genres`、`ALL`** の 5 つのみ（それ以外の名称はエラーで即停止）。**P3 の正式名は複数形の `P3_unverified_genres`**（単数形 `P3_unverified_genre` はエラー）。
  - `--cached-only`: キャッシュに存在する動画のみ候補にする。
  - `--non-youtube`: YouTube 以外（Vimeo 等）のみ候補にする。
  - `--verify-media`: `--cached-only` 時に `ffprobe` で実際に読めるファイルか検証する（未指定時はサイズ > 0 判定のみ）。
  - `--batch-index <N>`: claim JSON の `batch_index` と推奨コマンドの `--batch <N>` を明示一致させる。
  - `--release --run-id <id> [--reason <text>]`: 未完了の予約を正規解除（`status: "released"` に変更しロック対象外へ戻す）。
  - `--add-skip-from-run <run_id> [--worker <name>] [--include-format-failures] [--cooldown-days 7]`: 失敗動画を `analysis/claims/_skip_list.json` へ登録（詳細はステップ3.5）。
- `prepare-phase3-batch.mjs`:
  - `--no-download`: 未キャッシュ動画が 1 本でもあれば `yt-dlp` を一切呼ばず即停止する。
  - `--limit-stage <N>`: 先頭 `N` 本だけ試験ステージングし、問題なければ `--resume` で残りを続行する。
  - `--blind-root <path>`: `IKETERU_BLIND_ROOT` の CLI 上書き。
  - **`yt-dlp` 形式フォールバック**: 第1候補は従来どおり progressive `18`（高さ上限 `<=480` 厳守・無制限 `/best` なし）。`18` が取れないときのみ `--js-runtimes node`＋`<=480p` DASH 結合（`mp4`）へフォールバックし、各動画の `run_manifest.json` に `download_format_id` と `download_is_dash` を記録する（※ `--js-runtimes node` はボット確認の回避策ではなく、ボット確認・429 検知時は従来どおり即停止する）。
生成された予約ファイルを **採点開始前に必ず commit & push** します：
```powershell
node scripts/claim-phase3-batch.mjs --verify
git add analysis/claims/<run_id>.json analysis/claims/<run_id>_ids.json
git commit -m "Claim Phase 3 batch <run_id> for <このPC名>"
git push
```
> **衝突時の安全装置**: 別PCとほぼ同時に push して競合した場合は `git pull --rebase` のあと `node scripts/claim-phase3-batch.mjs --verify` を実行してください。重複が1件でもあれば終了コード1で即停止します（その場合は自分の予約ファイルを消してステップ2をやり直せばOK）。

### ステップ3: 予約したIDリストで動画準備〜採点〜TiDB反映（書き込みロック必須）
`--claim` が出力する `next_prepare_cmd` を使って `prepare-phase3-batch.mjs` を実行します（凍結設定は不変・YouTubeログイン不要・ボット確認で即停止）。

#### 採点割り当て直後のプロンプト完全一致チェック（必須運用）
1. **会話履歴の自動要約（compaction）後**: 採点用プロンプトを記憶から組み立て直さず、必ず `renderCalibrationPrompt(spec)` の出力（例: `node scripts/verify-dispatched-prompt.mjs --run-id <run_id> --video-id <id> --mode <video|contact_sheet> --print-prompt` または一括書き出しファイル）を読み直してから転記する。
2. **割り当て直後の即時照合（完了待ち不要）**: `invoke_subagent` で採点役を割り当てて `dispatch_log.jsonl` に追記した**直後**に、採点完了を待たず `verify-dispatched-prompt.mjs` で各採点役の会話ログ先頭プロンプトを `renderCalibrationPrompt(spec)` と完全一致照合する：
```powershell
# 直近 N 件の割り当てを即時照合（単体指定は --video-id / --mode / --subagent-id）
node scripts/verify-dispatched-prompt.mjs --run-id <run_id> --from-dispatch-log --last 24
```
3. **不一致時の対応**: `failed > 0` が出た採点役の結果は使わず（完了を待たず）、`renderCalibrationPrompt(spec)` の出力を読み直して**すぐ割り当て直す**。

本番 TiDB への書き込みは **同時に1台だけ** に制限するため、Git 管理の書き込みロック **`analysis/claims/_apply_lock.json`** を使用します（ロック未取得のまま `--apply` を実行すると `apply-phase3-batch-to-tidb.mjs` が即停止します）。

1. **旧40列照合用の Phase 3 開始前バックアップを自PCに用意（初回のみ）**
   - 共有 Google ドライブの `iketeru_multi_pc_progress/shared_pre_d_baseline/tidb_videos_backup.jsonl`（中身は TiDB `videos` テーブルの旧40列動画メタデータのみ・認証情報や非公開データなし）を自PCローカル（例：`E:\iketeru_backups\phase3_pre_d_20261123_153343\tidb_videos_backup.jsonl`）にコピーし、SHA-256 が `17856f0338c760b2f88d415543eb6d48a7977c06e76a5c04476b0d5943446a3b` と完全一致することを確認してください（別パスに置く場合は `.env` の `IKETERU_PRE_D_BACKUP_PATH` または `--pre-d-backup` で指定）。
2. **最新取得＆書き込みロック取得（`git push` 成功まで `--apply` しない）**
```powershell
git pull --rebase --autostash origin main
node scripts/claim-phase3-batch.mjs --apply-lock-status
# status が "locked"（他PCが書き込み中）なら解除されるまで待機！

# ロック取得して即 push（他PCと競合したら push が弾かれるので pull して待機）
node scripts/claim-phase3-batch.mjs --acquire-apply-lock <run_id> --worker <このPC名>
git add analysis/claims/_apply_lock.json
git commit -m "Lock TiDB apply for <run_id> (<このPC名>)"
git push
```
3. **ドライラン → 本番反映（反映直前に自動で自PC最新バックアップを取得）**
```powershell
node scripts/apply-phase3-batch-to-tidb.mjs <run_id> --dry-run --worker <このPC名>
node scripts/apply-phase3-batch-to-tidb.mjs <run_id> --apply --worker <このPC名>
```
   - 書き込み後の確認は **自分の `run_id` の行数（`tidb_rows_with_run_id === payload_count`）と旧40列の差分 0** を中心に行い、全体の校正済み件数（`tidb_calibration_status_counts`）は「他PCの反映分を含む累計」として記録します。
4. **ロック解除・予約完了・結果 push**
```powershell
node scripts/claim-phase3-batch.mjs --release-apply-lock <run_id> --worker <このPC名>
node scripts/claim-phase3-batch.mjs --complete <run_id>
git pull --rebase --autostash origin main
git add analysis/claims/_apply_lock.json analysis/claims/<run_id>.json analysis/runs/<run_id>/
git commit -m "Complete Phase 3 batch <run_id> and release TiDB apply lock (<このPC名>)"
git push
```

### ステップ3.8: 共有進捗フォルダ（Google ドライブ）と情報管理ルール
- 共有フォルダ（`iketeru_multi_pc_progress/`）では、**各PCは自分の `status_<ワーカー名>.md` / `.json` のみ更新**し、他PCのファイル（`README.md` 含む）は閲覧のみ（編集禁止）とします。
- 他PCの進捗に不備・注意点を見つけた場合は、他PCのファイルを直接直さず、**自PCの `status_<ワーカー名>.md` に「他PC向けのお知らせ」として記載**してください（コード修正は Git で行い、`push` 前に `git pull --rebase` を実行）。
- **厳禁事項**: 共有の Google ドライブには、**技法辞典の OCR 生データ（`E:\技術書_index\ocr_private`）や社外秘ファイルを一切置かないこと**。

### ステップ3.5: 取得不可動画の除外リスト（`analysis/claims/_skip_list.json`）運用
バッチ完了後に未校正のまま残る取得失敗動画が別PCで繰り返し再予約されるのを防ぐため、`analysis/claims/_skip_list.json` で除外管理します（`--status`・`--claim` の空きプール計算から自動除外）。

- **分類と再試行ポリシー**:
  - **ボット確認・回数制限（`isBotCheckError` 該当）**: **除外リストには一切登録しない**（`aborted_by_bot_check: true` の run では警告を表示）。
  - `likely_blocked`（`skipped_likely_blocked:*`）: `retry_policy: "needs_review"` として記録する（**自動では空きプールから除外せず**、`--status` の `skip_list.needs_review` に件数を集計する。運用者が内容を確認し、恒久除外と判断したものだけ `analysis/claims/_skip_list.json` 上で手動で `"retry_policy": "permanent"` に変更してコミット・push する）。
  - `unavailable`（非公開・削除等）/ `decode_corrupted`（デコード破損）: `retry_policy: "permanent"`（恒久除外）。
  - `format_unavailable`（形式取得不可）: まず DASH フォールバック対応後の `prepare` で元PCにて再試行し、それでも失敗したものだけを `--include-format-failures` 付きで `retry_policy: "retry_once"`（7日間クールダウン後 1 回のみ再試行可、2回目失敗で `permanent` へ昇格）として登録する。
- **登録手順（原則、主担当ワーカー `chibatmute` で実施。他ワーカー名で実行時は警告表示）**:
```powershell
# 恒久除外（unavailable / decode_corrupted / likely_blocked）のみ登録（format_unavailable は再試行待ちとして保留）
node scripts/claim-phase3-batch.mjs --add-skip-from-run <run_id> --worker chibatmute

# DASH 修正後の再試行でも失敗した format_unavailable も含めて登録する場合
node scripts/claim-phase3-batch.mjs --add-skip-from-run <run_id> --worker chibatmute --include-format-failures

git add analysis/claims/_skip_list.json
git commit -m "Update _skip_list.json from <run_id>"
git push
```

### ステップ4: 各PCのローカル SQLite を最新化（任意タイミング）
他のPCが TiDB に新しいバッチを反映したら、自分のPCでも以下を実行するだけで MCP（`search_references` / `plan_craft_sequence` 等）に最新点数が反映されます：
```powershell
cd E:\iketeru-eizou
node scripts/sync-tidb-to-sqlite-mirror.mjs --sqlite E:\iketeru-creative-studio\data\iketeru_knowledge.db
```

---

## 3. `iketeru-creative-studio` の複数台コード同期

- `.gitignore` により `data/*`（`stock_sites.example.json` 除く）・`assets/`・`outputs/`・`.env` は **完全にGit除外** 済みです（コード・テスト・スキル37ファイル＝約512 KB のみ追跡）。
- 初回のみプライベート GitHub リポジトリを作成して push すれば、以降は全PCで `git pull` / `git push` で同期できます：
  ```powershell
  cd E:\iketeru-creative-studio
  gh repo create aseaseproduction-a11y/iketeru-creative-studio --private --source=. --remote=origin --push
  ```
- 各PCの `C:\Users\<ユーザー名>\.gemini\config\mcp_config.json` はドライブ文字・ユーザー名がPC依存のため、**Git共有せず各PCローカルで管理**してください（`PYTHONUTF8=1` / `PYTHONIOENCODING=utf-8` の2行は全PC共通で設定）。

### 2台目以降（ZIP展開済みPC）を Git 管理へ切り替える手順
元PCで `iketeru-creative-studio` の非公開リポジトリ作成・push が完了するまで、2台目以降ではコードを編集しません。push 完了後、2台目PCでは以下を実行して Git 管理へ切り替えます：

1. 既存フォルダを一時退避（例: `C:\iketeru\iketeru-creative-studio` → `C:\iketeru\iketeru-creative-studio.bak`）
2. GitHub から新規 clone：`git clone https://github.com/aseaseproduction-a11y/iketeru-creative-studio.git C:\iketeru\iketeru-creative-studio`
3. 退避先から Git 除外対象のみコピー戻し：
   - `data\iketeru_knowledge.db`（および必要に応じて `data\craft_recipes\`）
   - `data\stock_sites.local.json`
   - `.env`（存在する場合）
4. `pip install -e .` と `python -m unittest discover -s tests -v`（14/14 合格）を確認後、`.bak` を削除

---

## 4. 現在のアクティブ予約と空きプール（2026-11-24 時点）

- **稼働中予約**: `run_20261124_080300`（担当: `chibatmute`、ロック中: **200本**〔準備済み184＋取得失敗16〕、重複: **0件**）
- **別PCが今すぐ重複ゼロで着手できる空きプール**:
  - `P0_craft_recipes`（YouTube）: **44本**（＋非YouTube 2本）
  - `P1_private_rating`（YouTube）: **18本**（＋非YouTube 273本）
  - 未校正 YouTube 全体: **4,447本**
