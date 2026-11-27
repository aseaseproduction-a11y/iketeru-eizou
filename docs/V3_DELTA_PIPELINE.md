# 分析 v3 TiDB 差分反映・`videoScenes` 同期パイプライン運用ガイド

正本（`iketeru_analysis_v3`）に追加された検証合格済みの分析 v3 を、TiDB の `videos`・`videoAnalysisHistory`・`videoScenes` とローカル SQLite ミラーへ安全に反映するための手順書です。

## 前提とルール
- **接続情報・秘密値**: `.env`（または環境変数 `DATABASE_URL`）から読み込み、スクリプトには直書きしない。
- **承認上限**: 1 回あたり **1〜200 本** まで（`--dry-run` の Pre-D 40 列監査通過が条件）。**200 本超または監査不合格時は即停止して報告**する。
- **ロック担当と `videoScenes` 同期**: `videos` の差分反映と `videoScenes` の同期は **同じ TiDB 書き込みロック（`analysis/claims/_apply_lock.json`）の中で連続実行**する（CHIBA-PC2 と二重同期しない）。
- **`main` への push**: ロック取得・解放時に `analysis/claims/_apply_lock.json` のみを push する（UTF-8 BOM なし、解放時は `released_at` と `released_by` を必ず記録）。

## スクリプト一覧

| スクリプト | 役割 | TiDB 書き込み |
| --- | --- | :---: |
| `scripts/check-v3-delta.mjs` | 正本の検証合格 v3 と TiDB を比較し、未反映リスト（JSON）を出力 | なし（読取専用） |
| `scripts/manage-apply-lock.mjs` | `_apply_lock.json` の取得・状態確認・解放（`released_at`/`released_by` 付き・BOM なし） | なし（Git ロックのみ） |
| `scripts/run-v3-delta-pipeline.mjs` | `--dry-run` → `apply-reanalysis-v3-to-tidb.mjs --apply` → **同一ロック内で `sync-v3-video-scenes.mjs --apply`** → TiDB 件数検証 | あり（要ロック） |
| `scripts/check-v3-scenes-pending.mjs` | TiDB `videos (v3)` のうち `videoScenes` が旧版または 0 件の ID を調査 | なし（読取専用） |
| `scripts/verify-tidb-vs-sqlite-v3-scenes.mjs` | TiDB (`videos`/`videoAnalysisHistory`/`videoScenes`) と SQLite (`videos`/`scenes`) の v3 本数・シーン行数・時刻・整合性を全件照合 | なし（読取専用） |

## 実行手順（標準フロー）

```bash
# 0. 環境変数（例）
#   DATABASE_URL は .env から自動読込
#   IKETERU_WORKER_NAME=chibatmute
#   IKETERU_TMP_DIR=/path/to/tmp
#   IKETERU_SQLITE_PATH=/path/to/iketeru-creative-studio/data/iketeru_knowledge.db

RUN_ID="v3_apply_delta_YYYYMMDD_r1"
LIST_PATH="${IKETERU_TMP_DIR}/${RUN_ID}_list.json"

# 1. 未反映差分の確認と固定リスト作成（読取専用・1〜200 本を確認）
node scripts/check-v3-delta.mjs --list-id "${RUN_ID}" --list-out "${LIST_PATH}"

# 2. TiDB 書き込みロック取得（main を rebase 後、_apply_lock.json のみ commit & push）
node scripts/manage-apply-lock.mjs acquire --run-id "${RUN_ID}" --worker chibatmute

# 3. 差分反映 → 同一ロック内で videoScenes 同期 → TiDB 件数照合
#    ※ dry-run・5,653 行控え・Per-video videoScenes 控え・Pre-D 40 列監査を自動実行
node scripts/run-v3-delta-pipeline.mjs --run-id "${RUN_ID}" --list "${LIST_PATH}" --worker chibatmute --out-dir "${IKETERU_TMP_DIR}"

# 4. ロック解放（released_at / released_by 付き・BOM なし・_apply_lock.json のみ push）＆ 凍結 13 ファイル確認
node scripts/manage-apply-lock.mjs release --run-id "${RUN_ID}" --worker chibatmute
node --test scripts/verify-phase2-freeze-integrity.test.mjs

# 5. SQLite 片道ミラー（dry-run → 反映）
node scripts/sync-tidb-to-sqlite-mirror.mjs --dry-run --report-out "${IKETERU_TMP_DIR}/sqlite_mirror_dryrun_${RUN_ID}.json"
node scripts/sync-tidb-to-sqlite-mirror.mjs --report-out "${IKETERU_TMP_DIR}/sqlite_mirror_apply_${RUN_ID}.json"

# 6. TiDB / SQLite 最終全件照合（v3 本数・videoAnalysisHistory・v3 シーン行数・shotIndex/時刻・PRAGMA integrity_check）
node scripts/verify-tidb-vs-sqlite-v3-scenes.mjs --out "${IKETERU_TMP_DIR}/tidb_vs_sqlite_verify_${RUN_ID}.json"
```

## 完了後の記録
- `status_<worker>.md` / `.json` に、反映本数・累計 v3 本数・控え SHA-256・ロック取得/解放コミット・SQLite 照合結果とあわせて、
  `videoScenes は chibatmute が同期済み（本数・run_id）` を記載する。
