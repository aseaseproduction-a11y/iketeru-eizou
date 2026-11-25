# iketeru-eizou 判断ログ（DECISIONS.md）

全 PC（chibatmute / CHIBA-PC / CHIBA-PC2）共通の「何を・なぜ決めたか」の記録。
**正本はリポジトリの `docs/DECISIONS.md`。** 追記は 1 つの会話から commit し、ほかの PC は `git pull` で読む（Google ドライブに置くと Google ドキュメントに変換されて読めなくなるため）。
新しい会話を始めたら、handoff メモ・status ファイルとあわせて最初に読むこと。
**ここに書かれた状態はその時点の記録。現在の状態は必ず実コマンド（git log / claim --status 等）で確認すること。**

追記ルール：1 件 = 日付・決定・理由・根拠（commit / run_id / ファイル）を数行で。過去の項目は消さず、覆す場合は新しい項目で「〇〇を変更」と書く。

---

## 共通ルール（現在有効）

- コマンドの結果は**実際に届いたものだけ**を使う。未着の結果を推測で書かない（長い会話で偽の SYSTEM_MESSAGE を生成した事例あり → D-012）。
- **YouTube に PC から直接アクセスしない**（yt-dlp・oEmbed・ページ取得すべて。ボット確認の回避・Cookie 利用もしない）。
- **ログインが必要な取得（Vimeo 等）は行わない**。認証情報・Cookie を使わない。
- 凍結 13 ファイル（`analysis/phase2_pre_freeze_sha256.json`）は変更しない。
- push 前に `git pull --rebase --autostash origin main`、**失敗したら push しない**。`git add` はファイル個別指定。
- 監査記録（`raw_scores.jsonl`・`run_manifest.json` 等）を書き換える場合は、**実行前に報告**し、元の記録を保全する。
- 採点役の割り当て直後に `scripts/verify-dispatched-prompt.mjs` で採点用プロンプトの完全一致を照合する。不一致なら結果を使わず再割り当て。
- 採点モデルは `gemini-4-neon-high`（固定設定の expected_model）。Antigravity の会話も Gemini 4 Neon (High) で始める。
- `sync-dispatched-runs.mjs` の親の会話 ID は**引数の並び**で渡す（`--parent-id` 形式は不可）。
- TiDB への反映：`--dry-run` → ユーザー承認 → 反映ロック取得（push 成功を確認）→ `--apply` → 適用後監査 → ロック解放。1 台ずつ。
- 会話が長くなったら、引き継ぎメモ（実コマンド出力のみで作成）を書かせて新しい会話に切り替える。1 つのバッチは 1 つの会話でだけ操作する。

---

## 判断の記録

### D-001 CHIBA-PC を 2 台目のワーカーとして追加（2026-11-24）
- 決定：CHIBA-PC を並列ワーカーとし、移行 ZIP（13:27 時点）を最新として `E:\` に作り直す。コードは Git の origin/main を正とする。
- 理由：既存の `D:\bitbucket\*` は古く、未コミットの変更が残っていたため。

### D-002 YouTube のボット確認では回避せず止める（2026-11-24）
- 決定：CHIBA-PC で YouTube のボット確認が出たため停止。YouTube 44 本の予約 `run_20261124_145350` は解除（`b46462f`、`--release` を追加）。
- 理由：回避策（Cookie、リトライ）は使わない方針。
- 補足：chibatmute でも 11/25 07:20 頃にボット確認が発生。YouTube の再取得は保留中（D-016）。

### D-003 キャッシュ済み・YouTube 以外の動画を優先して採点（2026-11-24）
- 決定：`claim-phase3-batch.mjs` に `--non-youtube` / `--cached-only` / `--verify-media` / `--batch-index` を追加し、キャッシュの場所は `IKETERU_VIDEO_CACHE_DIR` で指定する（未設定なら従来の `D:\マイドライブ\iketeru_videos`）。CHIBA-PC は `G:\マイドライブ\iketeru_videos`（ユーザー環境変数に登録済み）。
- 根拠：`441e074`。

### D-004 100MiB を超える動画は個別に再エンコード（2026-11-25）
- 決定：`4557534`（115.7MiB）を 2-pass で 90.13MiB に再エンコード（解像度・fps・長さは維持、メタデータは除去）。manifest に `staging_deviation` を記録。
- 理由：Antigravity の read_file の上限が 100MiB のため。
- 補足：prepare に自動で再エンコードする仕組みを入れるのは見送り（共有スクリプトのため、必要になれば相談）。

### D-005 監査記録を変更したら、必ず保全して報告する（2026-11-25）
- 経緯：同期の引数の誤り（`--parent-id`）で無効になった 2 件を、`raw_scores.jsonl` から報告なしで削除した事例があった。
- 決定：削除した行は `raw_scores.removed_lines.jsonl` に理由付きで保全。今後、監査記録の変更は必ず事前に報告する。

### D-006 TiDB 反映の手順（反映ロック）（2026-11-24〜25）
- 決定：反映ロック（`analysis/claims/_apply_lock.json`）による 1 台ずつの反映と、`IKETERU_WORKER_NAME` の必須化（chibatmute `7d6522b`）。Pre-D バックアップ（SHA-256 `17856f03…`）を各 PC の `E:\iketeru_backups\phase3_pre_d_20261123_153343\` に配置。
- 反映済み：`run_20261124_151553`（CHIBA-PC・P1 Batch 2・200 本、`8955537`）、`run_20261125_070347`（chibatmute・135 本、`cb327ed`）→ 校正済みは計 912 件。

### D-007 iketeru-creative-studio を非公開リポジトリにする（2026-11-25）
- 決定：`aseaseproduction-a11y/iketeru-creative-studio`（private、HEAD `d1beb3d`）を作成。`.env`・`data/`・`assets/`・`outputs/`・DB は追跡しない。
- CHIBA-PC は最新化し、SQLite のミラーを 912 件に同期済み。

### D-008 予約の優先度名を厳しくチェック（2026-11-25）
- 経緯：P2/P3 を指定しても ALL 扱いになっていた。`run_20261125_070347` は実際には P2 が 96 本、P3 が 39 本だった。
- 決定：P2/P3 を正しく絞り込み、存在しない優先度名はエラーにする（`175b0e3`）。P3 の正式な名前は複数形の `P3_unverified_genres`。混ざった件は、レポートを書き換えずに `priority_tier_note.json` に記録。

### D-009 「--」で始まる動画 ID への対応（2026-11-25）
- 決定：`record-scored-run.mjs`（`5f8baa4`）と `audit-blind-transcript.mjs` の CLI（`c54a88f`）で、`--` で始まる ID を受け取れるようにし、値が抜けたフラグはエラーにする。

### D-010 割り当て直後のプロンプト照合を必須にする（2026-11-25）
- 経緯：会話履歴が自動で要約された直後に、親がプロンプトを写し間違え、48 件が無効になった（chibatmute Wave 9〜10）。
- 決定：`verify-dispatched-prompt.mjs` を追加（`34bc46d`）し、割り当て直後に照合する。会話履歴が自動で要約された後は、プロンプトを記憶から組み立てない。

### D-011 ひとつの作品でない素材は採点しない（2026-11-25）
- 決定：`1202148916`（2.1 秒・音声なしの UI ループ素材）は `not_a_standalone_work` として `_skip_list.json`（permanent）に登録し、`run_20261125_113041` を 13 本で確定させる。
- 基準：それ自体がひとつの作品か、素材の断片か。`_F6oRAbEoLY`（5 秒のモーション作品）は作品として残す。
- 状態：実施済み（`_skip_list.json` に permanent で登録。2026-11-25 chibatmute の確認で確認）。

### D-012 長い会話は新しい会話に切り替える（2026-11-25）
- 経緯：CHIBA-PC の旧会話 `a56f7826`（1,800 ステップ超）が、届いていないコマンドの結果を偽の SYSTEM_MESSAGE として書いた（ステップ 1803・1809・1818。実際の作業は本物の結果にもとづいていた）。
- 決定：引き継ぎメモ `handoff_CHIBA-PC_20261125.md` を作って、新しい会話 `2a046c32` に移行。旧会話は使わない。chibatmute も同じく切り替える予定。

### D-013 恒久除外の候補（2026-11-25）
- 決定：`jfNr2Gju2Mk`（非公開・削除）は permanent。`wRXAEZ0RKCw` は手元のファイルが壊れているだけなので permanent にせず、YouTube の取得を再開したら再ダウンロードする。壊れたキャッシュは削除せず、`.corrupted` を付けて名前を変える。
- 状態：実施済み（`jfNr2Gju2Mk` は permanent、`wRXAEZ0RKCw` は retry_once、retry_after は 2026-12-02）。`_skip_list.json` は全 PC で共有するため、追記で更新し、競合したら止める。

### D-014 未キャッシュの Vimeo は取得しない（2026-11-25）
- 経緯：試験の 1 本目で `login_required`（ログインしないと取得できない）。
- 決定：ログインしない取得は中止し、試験予約 `run_20261125_113713` は解除する。認証情報や Cookie は使わない。
- 一覧ファイル：`analysis/claims/_vimeo_login_required_list.json`（未キャッシュ・YouTube 以外の未校正 312 件〔`vimeo`: 310、`instagram`: 2〕を記録。Gemini API で直接読めるのは YouTube の URL だけなので、今のところ採点の手段がない）。

### D-015 SQLite にだけ残っている 48 行は専用スクリプトで削除（2026-11-25）
- 経緯：TiDB から削除された 48 件が、削除を反映しない SQLite に残っていた。
- 決定：案 (a)。`prune-sqlite-tidb-orphans.mjs` で --dry-run → 承認 → --apply（事前にバックアップ）。普段の同期（zeroDeletions）は変えない。全 PC で同じ手順を実行する。
- 状態：chibatmute で実施済み（2026-11-25 14:38 JST、事前バックアップ `E:\iketeru_backups\sqlite_pre_prune_orphans_20261125_143831\iketeru_knowledge.db` 取得、SQLite 5,653 件＝TiDB と一致・校正済み 912 件・`craft_recipes` 1,036 件不変）。CHIBA-PC と CHIBA-PC2 は未実施。

### D-016 YouTube の再取得は見送る（2026-11-25）
- 決定：ボット確認が続いているため、YouTube の再取得は保留する。会社の回線全体が制限されるおそれがあるため。

### D-017 Gemini API に YouTube の URL を直接渡して採点する方法を試す（2026-11-25）
- 課金：AI Studio のプロジェクト `iketeru-eizou`、有料 1、前払い ¥800、自動チャージはオフ。Google AI Ultra の GCP クレジットが先に使われる。$300 のウェルカムクレジットは Gemini API には使えない。
- API キーは CHIBA-PC の `E:\iketeru-eizou\.env`（GEMINI_API_KEY）だけに置く。チャットや Git には出さない。
- 試験 `run_20261125_125425`（10 本 × 2 回、$1.72）：MAE 2.4、帯の一致 9/10、2 回の差はすべて 5 点未満、knows_work は 30%（確定時は 40%）、**偏り +2.2 点**。scenes との照合で、実際に動画を見ていることを確認。
- 動画を取りに行くのは Google のサーバー側なので、社内の回線から YouTube にはアクセスしない。

### D-018 大きな検証はやめ、本番の採点に「答え合わせ用の動画」を混ぜる（2026-11-25）
- 経緯：50 本の検証（`run_20261125_134050`）を始めたが、すでに採点済みの動画にクレジットを使いすぎるため、4 回の呼び出し（2 本）で打ち切った（`validation_stop_note.json`、事前登録ファイルは変更していない）。
- 決定：案 2。未採点の動画を API で採点し、API の点数は区別できる経由（route）で記録する。最初のバッチだけ、事前登録の未採点 48 本から 18 本を混ぜて答え合わせ用を 30 本にし、以降は 50 本ごとに 2〜3 本混ぜる。補正を当てて帯を判定するのは 30 本たまってから（承認が必要）。それまでは TiDB に書き込まない。
- 答え合わせ用の動画 12 本の時点：偏り +2.17、MAE 2.33、帯の一致 11/12（83 点の境目は 1/2）。試験の費用の合計は $2.16。
- 料金：Flex（service_tier: flex、Standard の半額、YouTube の URL を渡せる、CLI で使える。503・429 には再試行で対応）を使う予定。Batch は CLI が非対応で、URL を渡せるかも未確認。
- 状態：CHIBA-PC の試験用の会話 `ad9c681c` で設計書（`docs/API_URL_SCORING_DESIGN.md`）を作成中。実装と本番実行は、設計書を承認してから。

### D-019 PC 間で共有する情報（2026-11-25）
- 決定：Antigravity の brain をそのまま Google ドライブに置かない（大きすぎる、偽の結果が混ざっている、秘密情報が混ざるおそれ、会話 ID を 1 台専任にするルールに反する）。
- 共有するもの：`status_<PC>.md/json`、`handoff_<PC>_<日付>.md`（Google ドライブ）、この `DECISIONS.md`（リポジトリの `docs/`）。
- Google ドライブには、エクスプローラーでコピーして置く（ブラウザからアップロードすると Google ドキュメントに変換され、Antigravity が読めなくなる）。
- 監査のために残すもの：run が完了するたびに、親の会話と採点役の会話の記録を zip にまとめ、秘密情報の検査とチェックサムを付けて保管する（実装：`scripts/archive-run-evidence.mjs`、`4b4ef2f2`）。

### D-020 監査用 zip の親会話ログ伏せ字方針（2026-11-25）
- 経緯：`run_20261124_080300` / `run_20261125_070347` の監査 zip 事前検査で、共通の親会話（`8eb1cf89`）に TiDB 初期設定時の接続文字列・ユーザー名・ホスト名・旧パスワード（後にローテーション済み）が残っていることが判明し、保存せず停止した。
- 決定：`scripts/archive-run-evidence.mjs` では**親の会話の transcript だけ**メモリ上でコピーを伏せ字（`[REDACTED:<種類>]`）にし、元の brain ファイルは変更しない。**採点役の会話の transcript と `analysis/runs/<run_id>/` は監査の根拠なので一切変更しない**（そちらで秘密情報が検出された場合は保存せず停止）。`manifest.json` には伏せ字にしたファイルの元 SHA-256・伏せ字後 SHA-256・置き換え件数と種類のみ記録し、元の値は出力しない。伏せ字後に zip 全体（`manifest.json` 含む）を再検査して 0 件のときだけ保存する。
- 根拠：`scripts/archive-run-evidence.mjs` / `scripts/archive-run-evidence.test.mjs`。`run_20261124_080300.zip`（17.76 MB、SHA-256 `f1887cc6…`）と `run_20261125_070347.zip`（17.09 MB、SHA-256 `c118907c…`）を `D:\マイドライブ\iketeru_evidence_archive\` へ保存済み（各 39 箇所伏せ字・再検査 0 件）。
