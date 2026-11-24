# 複数台PC 並列運用ガイド（iketeru-eizou / iketeru-creative-studio）

2台・3台以上の複数PC（Windows / Mac 混在可）で同時に開発・再採点・MV試作を進めても、**データ破損・二重採点・上書き衝突を起こさないための運用規約とツール手順**です。

---

## 1. 複数台運用の4原則（正本の分離）

| データ種別 | 唯一の正本（マスター） | 複数台での扱い |
|---|---|---|
| **コード・設計書・採点バッチログ・ID予約** | **GitHub**（`iketeru-eizou` / `iketeru-creative-studio` プライベートリポ） | 作業開始前に `git pull`、区切りごとに `git push`（大きな機能開発はPC別ブランチ推奨） |
| **動画の校正点数・状態（Phase 3）** | **TiDB（クラウド）** | 動画ID単位の `UPDATE` のため、**予約（claim）でIDが重複しなければ何台から同時に反映しても安全** |
| **ローカルSQLite（`iketeru_knowledge.db`）** | **TiDBからの片道ミラー（参照専用）** | 各PCで必要に応じて `sync-tidb-to-sqlite-mirror.mjs` を叩き、他PCが反映した最新点数をプルする。`craft_recipes` テーブルへのローカル追記は1台（レシピ担当機）に集約する |
| **Antigravity 会話DB（`conversations/*.db`）** | **各PCローカル専用（統合不可）** | **同じ会話IDを複数台で同時に進めない**。別PCで作業するときは新しいチャットを立て、引き継ぎ状態は Git（`analysis/claims/`, `analysis/runs/`）と TiDB を参照する |

---

## 2. 複数台で Phase 3 C 再採点を並列実行する手順

動画IDの二重採点を防ぐため、`analysis/claims/<run_id>.json` に**Git管理の予約ファイル（claim）**を置いてから作業します。

### ステップ1: 最新状態を取得し、空きプールを確認
```powershell
cd E:\iketeru-eizou
git pull
node scripts/claim-phase3-batch.mjs --status
```

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
- `IKETERU_VIDEO_CACHE_DIR`（環境変数または `.env`）: 動画キャッシュディレクトリの上書き（未設定時は `D:\マイドライブ\iketeru_videos`）。`claim-phase3-batch.mjs` と `prepare-phase3-batch.mjs` の両方で参照。
- `claim-phase3-batch.mjs`:
  - `--cached-only`: キャッシュに存在する動画のみ候補にする。
  - `--non-youtube`: YouTube 以外（Vimeo 等）のみ候補にする。
  - `--verify-media`: `--cached-only` 時に `ffprobe` で実際に読めるファイルか検証する（未指定時はサイズ > 0 判定のみ）。
  - `--batch-index <N>`: claim JSON の `batch_index` と推奨コマンドの `--batch <N>` を明示一致させる。
  - `--release --run-id <id> [--reason <text>]`: 未完了の予約を正規解除（`status: "released"` に変更しロック対象外へ戻す）。
- `prepare-phase3-batch.mjs`:
  - `--no-download`: 未キャッシュ動画が 1 本でもあれば `yt-dlp` を一切呼ばず即停止する。
  - `--limit-stage <N>`: 先頭 `N` 本だけ試験ステージングし、問題なければ `--resume` で残りを続行する。
生成された予約ファイルを **採点開始前に必ず commit & push** します：
```powershell
node scripts/claim-phase3-batch.mjs --verify
git add analysis/claims/<run_id>.json analysis/claims/<run_id>_ids.json
git commit -m "Claim Phase 3 batch <run_id> for <このPC名>"
git push
```
> **衝突時の安全装置**: 別PCとほぼ同時に push して競合した場合は `git pull --rebase` のあと `node scripts/claim-phase3-batch.mjs --verify` を実行してください。重複が1件でもあれば終了コード1で即停止します（その場合は自分の予約ファイルを消してステップ2をやり直せばOK）。

### ステップ3: 予約したIDリストで動画準備〜採点〜TiDB反映
`--claim` が出力する `next_prepare_cmd` を使って `prepare-phase3-batch.mjs` を実行します（凍結設定は不変・YouTubeログイン不要・ボット確認で即停止）。
完了・監査後：
```powershell
node scripts/apply-phase3-batch-to-tidb.mjs <run_id> --dry-run
node scripts/apply-phase3-batch-to-tidb.mjs <run_id> --apply
node scripts/claim-phase3-batch.mjs --complete <run_id>
```
その後、`analysis/runs/<run_id>/` と更新された `analysis/claims/<run_id>.json` を `git commit && git push` します。

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

---

## 4. 現在のアクティブ予約と空きプール（2026-11-24 時点）

- **稼働中予約**: `run_20261124_080300`（担当: `chibatmute`、ロック中: **200本**〔準備済み184＋取得失敗16〕、重複: **0件**）
- **別PCが今すぐ重複ゼロで着手できる空きプール**:
  - `P0_craft_recipes`（YouTube）: **44本**（＋非YouTube 2本）
  - `P1_private_rating`（YouTube）: **18本**（＋非YouTube 273本）
  - 未校正 YouTube 全体: **4,447本**
