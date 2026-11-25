# Gemini API YouTube URL 直接採点 本番運用設計書（案 2：アンカー混入方式）

- **作成日**: 2026-11-25
- **ステータス**: **承認済み・実装完了（Flex 事前検証・run 1 ドライラン実施フェーズ）**
- **対象リポジトリ**: `E:\iketeru-eizou`
- **根拠となる事前試験**:
  - 10 本 × 2 回パイロット: `analysis/pilot_gemini_api_url/run_20261125_125425/`（MAE 2.40、偏り +2.20、帯一致 90.0%、2 回差 `< 5` 達成 100%、SQLite `scenes` 観察照合 10/10 一致、合計 \$1.7193）
  - 50 本検証の事前登録と打ち切り記録: `analysis/pilot_gemini_api_url/validation_preregistration.json`（SHA-256 不変）、`validation_stop_note.json`（2 本 × 2 回完了、合計 \$0.4442）
  - 答え合わせ用 12 本集計（補正なし）: `analysis/pilot_gemini_api_url/anchor_12_summary.json`（偏り +2.17、MAE 2.33、帯一致 91.7%、24 コール合計 \$2.1634）

### 大前提（厳守事項）
1. **凍結 13 ファイル（Phase 2 凍結マニフェスト `analysis/phase2_pre_freeze_sha256.json`）は一切変更しない**（`audit-blind-transcript.mjs` 等のローカルブラインド用監査資産も破壊しない）。
2. **この PC から YouTube への直接アクセス（oEmbed・ページ取得・`yt-dlp`）は一切行わない**。動画取得はすべて Gemini API サーバー側（Google 側）に任せる。
3. **`GEMINI_API_KEY` は `E:\iketeru-eizou\.env`（`.gitignore` 済み）のみで管理**し、コード・ログ・保存 JSON・Git コミットへ一切出力・保存しない。
4. **プロンプト・モデル・thinking level・出力 JSON はパイロット（`run_20261125_125425/run_config.json`）と同一**とする（`model = "gemini-4-neon"`, `generation_config.thinking_level = "high"`, `store = false`, `stream = false`, `prompt_sha256 = "dd74e99d719942bcb3dcdceffcdfbad38aacfc23eaba9b84d7cd2b4b88c2a4c8"`）。

---

## 1. 料金・Flex ティア運用と Standard 同等性確認

### 1.1 利用ティアと料金単価
本番運用は Interactions API の **Flex inference（`service_tier: "flex"`）** を使用する。`gemini-api` CLI v0.5.0 の `--body` に `"service_tier": "flex"` を指定できることはオフライン `--dry-run` で検証済み。

| 項目 | Standard（実績） | **Flex（本番採用）** | 備考 |
|---|---:|---:|---|
| 入力トークン単価（/ 1M tok） | \$3.00 | **\$1.50** | 50% オフ |
| 出力＋思考トークン単価（/ 1M tok） | \$15.00 | **\$7.50** | 50% オフ |
| インターフェース | 同期 | **同期** | 2+1 集約（r1/r2 の差を見て r3 判断）と親和性が高い |
| 応答時間（公式目安） | 数十秒（実測平均 35.5s） | **1〜15 分** | クライアント側タイムアウト 10 分以上を公式推奨 |
| 混雑時の挙動 | 高優先度 | **503 / 429 返却** | Standard への自動フォールバックなし（想定外課金なし） |

### 1.2 503 / 429 発生時の後回しキュー＆再試行ポリシー（2026-11-25 改定）
Flex はオフピーク計算資源（sheddable capacity）を使うため、503（Service Unavailable）および 429（Resource Exhausted / Too Many Requests）が出たときは単一動画で長時間粘らず、**後回しキュー（`deferred_retry_queue.json`）方式** で効率的に処理する。

- **1 コールあたりのタイムアウト**: **900 秒（15 分）**（変更なし、公式推奨「10 分以上」を満たす）。
- **呼び出し間隔（通常パス）**: 呼び出し完了後 **4 秒** 待機。並列度は **1（直列）**。
- **通常パスでの 503 / 429 の扱い**:
  1. 1 回目の 503/429 が出たら、**30〜60 秒のランダム待機** を挟んで 1 回だけ再試行する。
  2. **2 回続けて 503/429 が出たら、待たずにその失敗した回だけを `deferred_retry_queue.json`（後回しキュー）に入れて次の動画へ進む**。
  3. 2 回の採点のうち、**成功した回の結果は捨てずに保全**する（例：r1 が成功し r2 が 503×2 なら、r1 の結果は残し r2 だけを後回しにする）。
  4. **続けて 3 本の動画が 503/429 で後回しになったら**、Flex 全体の混雑と判断してその run を安全停止する（それまでに成功した全結果と `deferred_retry_queue.json` を保存して報告）。
- **一巡後の後回しキュー再試行パス**:
  - すべての動画を一巡したあと、`deferred_retry_queue.json` の項目を **呼び出し間隔 1〜2 分（60〜120 秒ランダム待機）** を空けて **1 回ずつ** 再試行する。
  - それでも 503/429 が出た呼び出しがあれば、**そこで run を停止**し、残りの後回しキューを保存して報告する。
- **`--resume` 再開時の処理順**:
  - `--resume` で再開した場合は、**`deferred_retry_queue.json`（後回しキュー）を通常キューより先に処理**する。
- **費用の台帳記録**:
  - 予算台帳（`analysis/api_url_budget_ledger.json`）には **成功した呼び出しの費用のみ** を記録する。503/429 で失敗した呼び出しは **回数と時刻（`congestion_events`）のみ** を記録し、費用には加算しない。
- **即座に全体を停止するエラー（再試行・後回しをしない）**:
  - **402（残高不足 / PAYMENT_REQUIRED）**
  - **403（権限・キーエラー / PERMISSION_DENIED）**
  - **JSON 破損が 2 回連続**
  - **動画トークン数不足**（第 7 章の監査条件に違反）

### 1.3 Flex の結果が Standard と変わらないことの確認方法
Flex は「同一モデル・同一重み・計算優先度のみ異なる」仕様だが、本番投入前に **2 段階の同等性チェック** を行う。

1. **事前スモーク検証（本番 1 本目の前、予算約 \$0.50）**:
   - すでに Standard で採点済みの既存アンカー 12 本から、帯・長さが分散する **5 本**（例: `CWnqX41JHuM`, `-K2c-HL9cIA`, `_H-Y1ZhWYIE`, `12jPI4V5dJ0`, `QA9PLeM0EUs`）を Flex で各 2 回（計 10 コール、Flex 費用約 \$0.48）採点する。
   - 確認基準:
     - 入力トークン数（テキスト・動画）が Standard 実測と完全一致（または ±1% 以内）
     - 出力＋思考トークン数の平均が Standard と大きな乖離がない（±30% 以内）
     - Flex 平均点と Standard 平均点の差の絶対値（MAE）が **2.5 点以下**、平均差（Flex − Standard）が **±1.5 点以内**
     - 観察内容が SQLite `scenes` と 5/5 一致
   - 上記を満たさなければ、本番バッチへ進まず停止して報告する。
2. **初回バッチ（30 アンカー到達時）での統計確認**:
   - Standard で採点済みの 12 本の偏り（平均 +2.17）と、初回バッチに Flex で混ぜる 18 本の偏りを比較し（Welch の t 検定、`p >= 0.05` かつ群間差 `|diff| <= 1.5` 点）、両者を合算して 30 本で補正を推定して問題ないことを確認する。もし Flex 側だけに明確な別バイアスが出た場合は、Flex 側のみで補正を見積もる判断に切り替える（ユーザー承認ゲートで確認）。

---

## 2. 対象と順番・claim 予約の仕組み

### 2.1 対象と優先順位（2026-11-25 時点の TiDB 実測）
対象は **未校正の YouTube 動画**（`platform = 'youtube'` または YouTube URL かつ `calibratedScore IS NULL`）全 **4,328 本**。優先順は以下のとおり既存 `scripts/claim-phase3-batch.mjs` の体系と完全一致させる。

| 順位 | `priority` 名（既存準拠） | 未校正 YouTube 実本数 | 平均尺（SQLite `scenes` 参照） | 備考 |
|---:|---|---:|---:|---|
| 1 | `P0_craft_recipes` | **60 本** | 170.2 秒 | `analysis/phase3_craft_recipes_target_ids.json` 由来 |
| 2 | `P1_private_rating` | **18 本** | 139.3 秒 | `privateRating IS NOT NULL` |
| 3 | `P2_verified_5_genres` | **2,954 本** | 177.1 秒（900s 上限時 173.8s） | 検証済み 5 ジャンル（MV/CM/企業映像/3DCG・アニメ/モーション） |
| 4 | `P3_unverified_genres` | **1,296 本** | 244.9 秒（900s 上限時 202.3s） | 5 ジャンル外（参考値枠） |
| — | **合計** | **4,328 本** | — | 現在アクティブ claim 中の他 3 run は別 ID（重複なし） |

### 2.2 バッチサイズと長尺フィルタ
- **初回バッチ**: `P0_craft_recipes` **60 本**（＋アンカー 18 本 = 計 78 本）、または `P0` 60 本と `P1` 18 本を連続して 2 claim（または 1 バッチ計 78 本＋アンカー 18 本 = 96 本）で実施する。
  - 既存 `claim-phase3-batch.mjs` は 1 claim に 1 `priority` を紐づける仕様のため、**`P0`（60 本）を Batch 1、`P1`（18 本）を Batch 2 と別 claim で予約しつつ、Batch 1 に初回アンカー 18 本を混ぜる**のが既存コードとの整合性が最も高い（詳細比較は第 11 章の決定事項に記載）。
- **2 つ目以降（P2 / P3）**: **1 バッチ 50 本**（＋アンカー 2〜3 本 = 計 52〜53 本）を基本単位とする（1 ラン約 \$5.5〜\$6.5 で月 \$38 予算管理・途中再開・監査の粒度がちょうど良い）。
- **長尺動画（900 秒超）の扱い**: SQLite `scenes` 基準で 900 秒を超える動画は 1 本あたりの費用が膨らむため、claim 時に `--max-duration-sec 900`（任意）で後回しにし、末尾で別枠承認して処理するか、またはそのまま含めるかを運用前に確定する。

### 2.3 claim 予約の拡張（他 PC との重複防止）
既存の `scripts/claim-phase3-batch.mjs` と `analysis/claims/<run_id>.json` をそのまま利用し、以下の **2 点の識別子** を追加する。

- **ワーカー名**: **`CHIBA-PC-api`**
  - 既存の `CHIBA-PC`（ローカルブラインド採点中の会話 `2a046c32`）、`CHIBA-PC2`、`chibatmute` と明確に分離する。
  - `.env` の `IKETERU_WORKER_NAME=CHIBA-PC` は既存会話と共用しているため変更せず、API 経由の CLI 呼び出し時は必ず **`--worker CHIBA-PC-api`** を明示指定する。
- **予約の印（API 経由識別フィールド）**:
  - `claim-phase3-batch.mjs --claim` に `--scoring-channel <local_blind|gemini_api_url>` オプションを追加（省略時は従来どおり `"local_blind"`）。
  - `analysis/claims/<run_id>.json` と `<run_id>_ids.json` に **`"scoring_channel": "gemini_api_url"`** を記録する。
  - `claim-phase3-batch.mjs --status` の `active_claims` 一覧にも `scoring_channel` を表示し、どの予約が API 経由でどの予約がローカルブラインドか一目で判別できるようにする。
  - 既存の `verifyActiveClaims()` は `status === "active"` の全 claim の `video_ids` を横断検査するため、ローカルブラインドと API 経由のあいだで **動画 ID の重複は構造的に 0 件** となる。
  - なお、**答え合わせ用のアンカー動画 ID は TiDB 上で既に `calibratedScore IS NOT NULL` のため、`claim` の `video_ids`（未校正予約リスト）には入れず**、各 run の `anchor_ids` として別管理する。

---

## 3. 答え合わせ用の動画（アンカー）の運用

### 3.1 初回バッチ（アンカー累計 30 本の達成）
- すでに採点済みのアンカー **12 本**（`run_20261125_125425` の 10 本 + `run_20261125_134050` の 2 本）に加え、初回バッチに **`analysis/pilot_gemini_api_url/validation_preregistration.json` の未採点 48 本から、事前登録の配列順どおりに先頭 18 本** を混ぜる（計 **30 本**）。
- 先頭 18 本の具体 ID（平均尺 156.3 秒、Flex 2 回予想費用約 \$1.73）：
  `6sX_BfDnyrg`, `nW2CpHcmlo4`, `Y_I_NOHVwzI`, `_Rvur-ySGyU`, `-TBB-K6Sk0U`, `-YiVSav-PZw`, `0kHO87Qqjpk`, `BEYeHsfGXJw`, `-1nKzOF8-_Q`, `Q4C1O2A-Cqg`, `8zxQpYYSvTM`, `mJk17F-vym8`, `jsEVOjI690Y`, `JokUSZnJBQU`, `_9cGKFO4mm8`, `58-kBdaXKxY`, `SEABn1jepkY`, `-igT-XOKyEo`
- 既存 12 本＋新規 18 本＝**30 本の内訳**:
  - 帯: `>=83` 11 本 / `63-82` 17 本 / `<63` **2 本**（境目：83±3 点 8 本、63±3 点 5 本）
  - 経由: `video_h1` 17 本 / `contact_sheet` 9 本 / `video_h2_escalated` 4 本
  - 長さ: `<=60s` 9 本 / `60-180s` 12 本 / `180-360s` 6 本 / `360-900s` 3 本
  - ※ **注記**: `validation_preregistration.json` の `main_50` は `fit`（スコア降順）→ `validation`（スコア降順）で並んでいるため、配列先頭 18 本には `<63` が含まれず、30 本合計の `<63` は既存 2 本のみとなる。厳密に事前登録順どおり先頭 18 本を使うか、`fit` 末尾の `<63` 2 本（`_PO5O3QAaVM`, `Jf9F5VBqA2A`）を含めるよう 2 本差し替えるかは第 11 章で確認事項とする。
- 実行順は、新規未校正動画とアンカー動画を固定シードでシャッフルして混ぜて実行する（モデルへのプロンプトは完全同一・ステートレス `store: false` なので独立性は保たれるが、時間帯による API 側の挙動差も均等に観測できる）。

### 3.2 2 つ目以降のバッチ（継続ドリフト監視）
- 新規未校正 **50 本ごとにアンカー 2〜3 本**（約 4〜6%）を混ぜる。
- 供給元:
  1. まず `validation_preregistration.json` の残り未採点 **30 本**（19〜48 番目）を順番に消費する（約 10〜15 バッチ＝500〜750 本分をカバー）。
  2. 使い切った後は、TiDB の `calibrationVersion = 'phase2_v1'` かつ YouTube の確定済みプール（390 本のうち未アンカー分）から、固定シードで帯（`>=83`, `63-82`, `<63`）が偏らないよう抽出する。
- **ドリフト検知ルール**:
  - 継続アンカーの直近 15 本（移動窓）の平均差が、承認済み補正値 `delta` から **±1.5 点以上** 乖離した場合（モデル更新や仕様変更の兆候）、自動で警告を出して TiDB 反映を保留し、ユーザーへ報告する。

### 3.3 TiDB の確定済み値を上書きしないための二段防御
1. **第 1 防御（ペイロード生成側）**:
   - 各 run ディレクトリ内で、アンカー動画の結果は **`anchor_eval_results.json`** にのみ書き出し、TiDB 反映用 **`phase3_batch_payload.json` の `updates` 配列には一切含めない**。
   - 生成時に「`updates` の全 ID が `anchor_ids` と交差ゼロであること」をアサートする。
2. **第 2 防御（TiDB 反映側 `apply-phase3-batch-to-tidb.mjs`）**:
   - `UPDATE` 実行前に、対象 ID 群に対して `SELECT id, calibratedScore, calibrationVersion FROM videos WHERE id IN (...)` を実行し、**既に `calibratedScore IS NOT NULL` の行が 1 件でもあれば即エラー停止**するガードを追加する（明示フラグ `--allow-overwrite` がない限り既校正行の上書きを物理的に不可能にする）。

---

## 4. 補正の推定・承認ゲートと帯（Tier Band）

### 4.1 30 本到達時の補正推定
アンカー 30 本（既存 12 本 + 初回バッチ 18 本）が揃った時点で、専用分析スクリプトにより以下を算出する。

- **各アンカーの差**: $d_i = \text{api\_score}_i - \text{calibrated\_score}_i$（$i = 1, \dots, 30$）
  - ただし $\text{api\_score}_i$ は 2+1 ルール集約後の生点数（$|r_1 - r_2| < 5$ なら平均、$\ge 5$ なら 3 回目の中央値）。
- **定数オフセット補正値**:
  $$\hat{\delta} = \frac{1}{n}\sum_{i=1}^{n} d_i \quad (n = 30)$$
- **95% 信頼区間（t 分布、自由度 $df = n - 1 = 29$, $t_{0.975, 29} = 2.0452$）**:
  $$\text{CI}_{95\%} = \hat{\delta} \pm t_{0.975, 29} \cdot \frac{s_d}{\sqrt{n}}, \quad s_d = \sqrt{\frac{1}{n-1}\sum_{i=1}^{n}(d_i - \hat{\delta})^2}$$
- **あわせて報告する診断指標**:
  - 補正前／補正後の MAE、平均差（偏り）、最大絶対誤差
  - 帯（`>=83` / `63-82` / `<63`）の一致率（全体および境目 ±3 点以内）
  - 経由別（`video_h1` / `video_h2_escalated` / `contact_sheet`）、長さ別、5 項目別の偏り
  - Standard（12 本）と Flex（18 本）の偏りの差（同等性確認）

### 4.2 補正前・補正後の両方の保存と丸め規則
- **補正前点数 (`raw_api_score`)**: 2+1 集約後の生スコア（小数点第 2 位丸め）。
- **補正後点数 (`calibratedScore`)**:
  $$\text{calibratedScore} = \text{round}_2\big(\text{clamp}(\text{raw\_api\_score} - \hat{\delta},\ 0,\ 100)\big)$$
  - （参考：0.5 点刻みではなく小数第 2 位 `decimal(5,2)` をそのまま保持。既存 `calibratedScore` も `decimal(5,2)` 定義。）
- **ランク・帯の決定**: 補正後 `calibratedScore` に対して、既存の `evaluate-phase3-batch.mjs` と同一の `scoreToCalibratedRank()`（`S+` 97-100 〜 `D` 0-44）および `scoreToTierBand(score, 83, 63)`（`award_tier >= 83` / `pro_band 63..82.99` / `low_band < 63`）を適用する。
- **両方保存**: TiDB の `calibratedScore` には**補正後点数**を格納し、同じ行の `calibratedBreakdown` JSON 内に **`rawApiScore`（補正前）** と **`biasCorrection`（補正幅 $\hat{\delta}$・95% CI・承認日・アンカー件数）** の両方を必ず記録する。ローカルの `api_batch_report.json` にも両方を保持する。

### 4.3 承認ゲート（TiDB 反映の保留）
- 補正値 $\hat{\delta}$ が確定し **ユーザーが明示承認するまで、初回バッチの新規採点結果はローカル（`analysis/runs/<run_id>/`）に保存するのみで TiDB には一切書き込まない**。
- ユーザー承認後、確定した補正パラメータを **`analysis/api_url_bias_config_v1.json`**（固定設定ファイル）に保存し、それを参照して `phase3_batch_payload.json` を生成 → TiDB 反映を行う。

---

## 5. TiDB への記録仕様（既存 10 カラム完全互換）

TiDB `videos` テーブルの既存 `calibrated*` 10 カラムのスキーマ（`ALTER TABLE` 不要）をそのまま利用する。既存カラムの型制約（`varchar(32)` 等）と既存ローカルブラインド採点（現在 912 本・進行中込み約 1,000 本）との区別は以下のとおり。

| TiDB カラム名 | 型 | 既存ブラインド採点（約 1,000 本） | **今回の API URL 方式** | 区別・互換性 |
|---|---|---|---|---|
| `calibratedRoute` | `varchar(32)` | `video_h1` / `video_h2_escalated` / `contact_sheet` | **`gemini_api_youtube_url_v1`** (25文字) | **この列で一目で区別可** |
| `calibrationVersion` | `varchar(32)` | `phase2_v1` | **`gemini_api_youtube_url_v1`** (25文字) | **この列でも一目で区別可** |
| `calibrationStatus` | `varchar(32)` | `calibrated_verified` / `calibrated_unverified_genre` | **`calibrated_verified` / `calibrated_unverified_genre`**（既存維持） | `classifyVideoForCalibration()` の 5 ジャンル判定を継承。UI フィルタ（`useVideos.ts`）・`VideoCard`・`VideoModal`・SQLite ミラー・MCP が無破壊で動作 |
| `calibratedScore` | `decimal(5,2)` | 2+1 集約点 | **補正後点数**（`rawApiScore - offset`） | 既存と同一スケールで並び替え・比較可能 |
| `calibratedRank` | `varchar(8)` | `S+`〜`D` | 補正後点数から算出（既存同一表） | 完全互換 |
| `calibratedTierBand` | `varchar(24)` | `award_tier` / `pro_band` / `low_band` | 補正後点数から算出（閾値 83 / 63 同一） | 完全互換 |
| `calibratedAt` | `timestamp` | 採点確定 UTC 時刻 | 採点確定 UTC 時刻 | 完全互換 |
| `calibratedRunId` | `varchar(64)` | `run_YYYYMMDD_HHMMSS` | `run_YYYYMMDD_HHMMSS` | 完全互換 |
| `calibrationGenreBucket` | `varchar(64)` | `MV` / `CM` / `unverified:*` 等 | `classifyVideoForCalibration()` 同一値 | 完全互換 |
| `calibratedBreakdown` | `mediumtext` | JSON | **下記 JSON 構造** | 補正前・補正幅・トークン・モデル情報を完全保存 |

> **フロントエンド型定義の最小更新**: `client/src/lib/types.ts`（L106）の `calibratedRoute` union 型に `"gemini_api_youtube_url_v1"` を追加する（`VideoModal.tsx` はそのまま文字列表示するため無改修でも動作し、任意でラベル表示を整えられる）。SQLite ミラー同期スクリプト `scripts/sync-tidb-to-sqlite-mirror.mjs` は文字列を透過コピーするため変更不要。

### `calibratedBreakdown` に格納する JSON 構造
```json
{
  "version": "gemini_api_youtube_url_v1",
  "runId": "run_20261126_100000",
  "route": "gemini_api_youtube_url_v1",
  "scoringChannel": "gemini_api_url",
  "model": "gemini-4-neon",
  "modelVersion": "gemini-4-neon",
  "thinkingLevel": "high",
  "serviceTier": "flex",
  "promptSha256": "dd74e99d719942bcb3dcdceffcdfbad38aacfc23eaba9b84d7cd2b4b88c2a4c8",
  "thresholds": { "tAward": 83, "tLow": 63 },
  "ensembleRule": "mean_of_2",
  "rawScores": [77, 75],
  "rawApiScore": 76.0,
  "biasCorrection": {
    "method": "constant_offset",
    "offsetSubtracted": 2.15,
    "ci95": [1.42, 2.88],
    "anchorCount": 30,
    "configVersion": "api_url_bias_v1",
    "approvedAt": "2026-11-26T00:00:00Z"
  },
  "finalScore": 73.85,
  "rank": "B+",
  "tierBand": "pro_band",
  "dimensions": {
    "direction": 15.0,
    "visual_craft": 15.5,
    "editing_rhythm": 15.5,
    "sound_integration": 15.0,
    "originality_finish": 15.0
  },
  "rationales": ["...", "..."],
  "timestampedObservations": [
    [{ "timestamp": "00:05", "observation": "..." }],
    [{ "timestamp": "00:05", "observation": "..." }]
  ],
  "postCheck": {
    "knowsWork": false,
    "knowsAwardHistory": false,
    "awardBadgeVisibleInVideo": false,
    "perRunKnowsWork": [false, false]
  },
  "usageSummary": {
    "callsCount": 2,
    "inputVideoTokens": 12833,
    "inputTextTokens": 1790,
    "avgOutputTokens": 485,
    "avgThoughtTokens": 2611,
    "totalCostUsd": 0.0903,
    "estimatedDurationSec": 127.7
  },
  "auditPassed": true,
  "auditReportSha256": "<64-hex>",
  "interactionIds": ["v1_...", "v1_..."]
}
```

---

## 6. TiDB 反映の手順（`apply-phase3-batch-to-tidb.mjs` の再利用と変更点）

### 6.1 既存 `scripts/apply-phase3-batch-to-tidb.mjs` の再利用性
`scripts/apply-phase3-batch-to-tidb.mjs` を精読した結果、以下の既存安全機構は **そのまま 100% 再利用可能** である：
- `analysis/runs/<run_id>/phase3_batch_payload.json` の読み込みと 200 行上限ガード
- `analysis/claims/_apply_lock.json` の `(status === "locked", worker, run_id)` 厳格検証
- Pre-D ベースラインバックアップ（`tidb_videos_backup.jsonl`）の SHA-256 照合
- 反映直前のフレッシュ TiDB 全行バックアップ取得
- 10 個の `calibrated*` カラムのみの `UPDATE`＋`updatedAt = updatedAt`（履歴汚染ゼロ）
- 反映後の全 5,653 行 × 旧 40 列（旧スコア 8 列含む）全セル差分 0 監査＋SQLite SHA-256 無傷確認
- `tidb_apply_verification.json` の出力

### 6.2 `apply-phase3-batch-to-tidb.mjs` に必要な最小限の変更（2 点）
1. **既校正行の上書き禁止ガード（必須・アンカー保護）**:
   - `--dry-run` および `--apply` の pre-flight で、`payload.updates` の全 ID を TiDB に `SELECT id, calibratedScore FROM videos WHERE id IN (...)` で照会し、**既に `calibratedScore IS NOT NULL` の行が 1 件でもあれば即エラー停止**する（明示 `--allow-overwrite` なしでは上書き禁止）。
2. **API 経路ペイロードの監査通過確認（推奨）**:
   - `payload.calibration_version === "gemini_api_youtube_url_v1"` のとき、同ディレクトリ内の `api_audit_report.json` が存在し `all_checks_passed === true` かつ `payload.bias_config_approved === true` であることを pre-flight で検証する（未承認・監査未通過ペイロードの誤反映を防止）。

### 6.3 反映の実行フロー（既存 `MULTI_PC_WORKFLOW.md` と完全同一）
1. `git pull --rebase --autostash origin main`
2. `node scripts/claim-phase3-batch.mjs --apply-lock-status`（`unlocked` 確認）
3. `node scripts/claim-phase3-batch.mjs --acquire-apply-lock <run_id> --worker CHIBA-PC-api` → `_apply_lock.json` のみ `git add` / `commit` / `push`（push 成功を確認）
4. `node scripts/apply-phase3-batch-to-tidb.mjs <run_id> --dry-run --worker CHIBA-PC-api`
5. `node scripts/apply-phase3-batch-to-tidb.mjs <run_id> --apply --worker CHIBA-PC-api`
6. `node scripts/claim-phase3-batch.mjs --release-apply-lock <run_id> --worker CHIBA-PC-api`
7. `node scripts/claim-phase3-batch.mjs --complete <run_id>`
8. 必要ファイルのみ個別 `git add` → `commit` → `git pull --rebase --autostash origin main` → `push`

---

## 7. 自動監査と人的抜き取り確認（`audit-blind-transcript.mjs` 代替）

ローカルのサブエージェント会話ログを監査する `scripts/audit-blind-transcript.mjs` は API 直接呼び出し方式では使えないため、凍結資産には一切触れず、専用監査スクリプト **`scripts/audit-api-url-run.mjs`** を新設する。**全自動チェックが 100% PASS しない限り、`phase3_batch_payload.json` の生成を拒否する。**

### 7.1 自動監査項目（全コール・全動画で機械検証）

| # | 監査項目 | 合格条件（FAIL 時は当該コール無効・再実行または停止） |
|---:|---|---|
| 1 | **プロンプト同一性** | 各コールの `request.prompt_sha256` および `run_config.json` の `sha256(prompt_text)` が `dd74e99d719942bcb3dcdceffcdfbad38aacfc23eaba9b84d7cd2b4b88c2a4c8` と完全一致。タイトル・チャンネル名・ジャンル等のメタデータ混入パターンも検査 |
| 2 | **モデル・ティア・状態** | `request.model === "gemini-4-neon"`, `thinking_level === "high"`, `service_tier === "flex"`, `api_status === "completed"`。レスポンス内のモデル識別子（`raw_response.model` 等）が存在する場合は `gemini-4-neon` 系であることを確認し、バージョン文字列を記録 |
| 3 | **出力 JSON 構造検証** | 5 項目（`direction`, `visual_craft`, `editing_rhythm`, `sound_integration`, `originality_finish`）すべて 0〜20 の整数、`total_score` が 0〜100 かつ 5 項目合計と一致、`rank` が `scoreToCalibratedRank(total_score)` と一致、`brief_rationale` 非空、`post_check` 全 4 項目型一致、`timestamped_observations` が 3 件以上 |
| 4 | **動画トークン数下限** | **尺が既知の動画**（SQLite `scenes` の `MAX(end_sec)` 等、YouTube 直接アクセスなし）: `input_video_tokens >= duration_sec * 90` かつ `input_video_tokens >= 1000`（※実測では全 12 本が 95.05〜101.67 tok/s だったため、90 tok/s は正常動画を弾かず未処理動画を確実に捉える閾値）。**SQLite に尺がない動画**: 絶対下限 `>= 1000` かつ r1/r2 の `input_video_tokens` が一致（`Math.abs(vid1 - vid2) <= 10`） |
| 5 | **時刻つき観察の範囲** | 3 件すべての `timestamp`（`MM:SS` または `HH:MM:SS`）がパース可能で、`0 <= t <= ref_duration_sec + 5` を満たす（`ref_duration_sec` は SQLite `scenes` の `MAX(end_sec)`、無ければ動画トークンからの推定尺 `input_video_tokens / 95` を使用）。かつ 3 件がすべて同一時刻ではないこと |
| 6 | **レスポンス全文保存＆秘密非含有** | 各コールの `raw_response` 全文がディスクに保存済み（空・欠損なし）であり、全保存ファイルに対して `GEMINI_API_KEY` および `AIza[0-9A-Za-z\-_]{20,}` の検出件数が **0 件** であること |
| 7 | **2+1 集約＆アンカー分離** | 全新規動画が `mean_of_2`（`|r1-r2| < 5`）または `median_of_3` で完了しており、アンカー動画 ID が `phase3_batch_payload.json` に 1 件も含まれていないこと |

### 7.2 人的抜き取り確認の運用
自動監査を通過した各バッチについて、TiDB 反映前に以下のルールで人が抜き取り照合を行う：
- **抽出件数**: **1 バッチ（50 本）あたり 3〜5 本**（約 6〜10%）。
- **層化抽出基準（優先枠）**:
  1. 帯の境目付近（補正後 `80〜86` 点または `60〜66` 点）から 1〜2 本
  2. タイブレーカー（3 回目）が発動した動画、または 2 回の差が 4 点だった動画から 1 本
  3. 当該バッチのアンカー動画のうち誤差 `|api - base| >= 4` 点だったもの（該当なければ任意 1 本）
  4. SQLite `scenes` がある動画からランダム 1 本
- **照合手順**: `scripts/audit-api-url-run.mjs --sample-review <run_id>` が出力する「時刻つき観察 3 件 × 2 回 vs SQLite `scenes` 対比表」を人が目視確認し、一致／おおむね一致／不一致を記録する（`scenes` がない場合は任意の 1 本だけブラウザ等で実映像確認）。
- **異常時の対応**: 抜き取りで「明らかに実映像と違う（見ていない疑い）」が **1 件でも出た場合**、当該バッチの TiDB 反映を停止し、生レスポンスと動画トークン内訳を全件精査する。

---

## 8. 予算の安全策と累計費用の記録

### 8.1 多層予算上限
| 層 | 上限値 | 動作 |
|---|---:|---|
| **月次スクリプト上限** | **\$38.00 / 月** | 月 \$40 Ultra クレジットに対し \$2.00 の安全バッファ。`月累計 + 次回予想費 > $38.00` となった時点で次の呼び出しをせず安全停止 |
| **1 回の実行（ラン）上限** | **\$10.00 / ラン**（初回 P0+アンカー18本や P0+P1 用。通常 50 本バッチは **\$7.00 / ラン**） | 1 ランの暴走を防止。超過見込みで途中保存して安全停止（`--resume` で再開可） |
| **リクエスト回数上限** | **バッチ本数 × 2.3 回（切り上げ）**（例：50 本＋アンカー 3 本なら最大 125 回、再試行含む） | 無限リトライによる課金・時間浪費を防止 |
| **1 コール単価ガード** | **動画トークン予想費 > \$0.25（約 1,450 秒超）** | 極端な長尺（数十分〜数時間）を自動保留キューへ退避 |

### 8.2 累計費用の記録方法
- Git 管理の軽量 JSON 台帳 **`analysis/api_url_budget_ledger.json`** を正本とする：
  - `monthly_totals["YYYY-MM"]`: `{ limit_usd: 38.0, spent_usd, calls_count, congestion_failure_count, runs: [...] }`
  - **成功した呼び出しの費用のみ** を `spent_usd` と `calls_count` に記録する。503 / 429 で失敗した呼び出しは費用に加算せず、**失敗回数（`congestion_failure_count`）と発生時刻（`congestion_events`）のみ** を記録する。
  - 各コール完了時にもローカルランの `calls_log.jsonl` に単回費用・累計費用を追記し、ラン終了時（正常終了／途中停止どちらも）に `api_url_budget_ledger.json` および `deferred_retry_queue.json` を自動更新する。
  - **重要**: 費用計算は常に `usage` の実測トークン数（Flex 単価：入力 \$1.50/1M、出力＋思考 \$7.50/1M）で行い、月次上限判定時は GCP 請求画面の実際のクレジット残高と月 1 回突合する（台帳と請求画面の乖離があれば大きい方を採用して安全側に倒す）。

### 8.3 Google AI Studio / GCP 側の上限推奨値
- **GCP 請求設定（プロジェクト `iketeru-eizou`）**:
  - 自動チャージ: **OFF のまま維持**（現在 OFF）。
  - Billing Budgets & Alerts: 月額 **\$40（約 6,000 円）** で予算アラートを作成し、**50% / 80% / 95% / 100%** の通知メールを有効化。
  - ※ GCP の予算アラート自体は自動遮断ではないため、自動チャージ OFF（前払い残高＋月次クレジット上限）＋スクリプト側 \$38.00 ハードストップを主防御とする。
- **AI Studio / GCP Quotas（プロジェクト `iketeru-eizou`）**:
  - もしコンソールで日次支出／トークン上限（Spend Cap / Daily Token Quota）を設定できる場合は、**月額 \$45 相当（または 1 日あたり入力 20M tok / 出力 2M tok 程度＝日次上限約 \$45 未満に抑える値）** を推奨。これによりスクリプトのバグ時でも単月で前払い残高を枯渇させない。

---

## 9. 実行する場所・他 PC／他会話との分担・Git の扱い

### 9.1 実行場所とワーカー分離
- **実行マシン**: `GEMINI_API_KEY` を保有する **CHIBA-PC のみ**（ワーカー名 **`CHIBA-PC-api`**）。他 PC（`chibatmute`, `CHIBA-PC2` 等）には API キーを配布しない。
- **同居する別会話（例：採点中の `2a046c32`）との完全隔離**:
  - API 方式は `E:\iketeru_blind_eval\` を **一切使用しない**（ローカル動画 DL も ffmpeg ステージングも不要）。
  - API 方式のランディレクトリは `analysis/runs/<run_id>/`（既存 TiDB 反映パイプラインと互換）に作るが、claim 時に一意な `run_id` を発行するため、進行中の `run_20261125_113036` / `run_20261125_113041` とは完全に分離される。
  - API 方式のワーカー名は `CHIBA-PC-api` とし、`CHIBA-PC` のローカル採点とログ・ロック・進捗を混同させない。

### 9.2 他 PC との役割分担
| 担当 | ワーカー名 | 強み・担当範囲 |
|---|---|---|
| **CHIBA-PC（API URL 方式）** | `CHIBA-PC-api` | **未キャッシュの YouTube 動画**（`P0` → `P1` → `P2` → `P3`）。ローカル DL・ボット確認回避が不要で安定稼働 |
| **chibatmute / CHIBA-PC2 / CHIBA-PC（ローカル枠）** | `chibatmute`, `CHIBA-PC2`, `CHIBA-PC` | **非 YouTube（Vimeo 等）**、ローカルキャッシュ済み動画、無料 Antigravity 枠で回せるバッチ |

### 9.3 Git の扱いと大容量生レスポンスの保管
- **commit 規律**: 必ず **ファイル単位の個別 `git add`** を行い、`git add -A` / `git add .` は禁止する。特に CHIBA-PC 上の他会話が作業中の未追跡ファイルや `.env` を絶対に巻き込まない。
- **同期手順**: 予約（`--claim`）・ロック取得（`--acquire-apply-lock`）・完了（`--complete`）の各タイミングで `git pull --rebase --autostash origin main` → 競合・重複チェック（`--verify`）→ `git push` を実施する。
- **生レスポンス全文（`calls/*.json`）の保管先**:
  - 1 コール約 20 KB × 2.05 回 × 4,328 本 ≈ **約 180 MB**（約 9,000 ファイル）になるため、すべてを Git にコミットするとリポジトリが肥大化する。
  - **推奨構成**:
    - **Git にコミットするもの（軽量・監査必須）**: `analysis/runs/<run_id>/run_config.json`, `calls_log.jsonl`, `api_audit_report.json`, `anchor_eval_results.json`, `phase3_batch_payload.json`, `tidb_apply_verification.json`、および `analysis/api_url_budget_ledger.json`。
    - **ローカル永続保管（Git 外）**: 生レスポンス全文 `calls/*.json` は **`E:\iketeru_api_url_logs\<run_id>\calls\`**（外部バックアップ／共有ドライブに任意ミラー）に永続保存し、`calls_log.jsonl` と `api_audit_report.json` に各ファイルの **SHA-256** を記録して改ざん検知・全文追跡性を担保する（全件 Git 管理にするか外出しにするかは第 11 章で確認事項とする）。

---

## 10. 費用と時間の見積もり（Flex・実測ベース）

### 10.1 計算根拠（12 本 / 24 コールの実測トークンモデル）
パイロット 12 本（24 コール、Standard 実測）から得たトークン式：
- 入力動画トークン: 約 **100.5 tok/秒**
- 入力テキストトークン: **1,282 + 4.0 tok/秒**（合計入力 ≈ `1,282 + 104.5 × D` tok/call）
- 出力＋思考トークン: 平均 **2,898 tok/call**（出力 514 + 思考 2,384）

**Flex 単価（入力 \$1.50/1M、出力＋思考 \$7.50/1M）** を当てはめた費用式：
- **1 コール**: `≈ $0.02365 + $0.00015675 × D(秒)`
- **1 本（2 コール）**: `≈ $0.0473 + $0.0003135 × D(秒)`
- **1 本（2+1 想定・タイブレーカー率 5% = 平均 2.05 コール）**: `≈ $0.0485 + $0.0003213 × D(秒)`

### 10.2 優先度別の費用・月数見積もり（Flex、2026-11-25 TiDB 実測本数）

※ 各区分の平均尺は SQLite `scenes` の `MAX(end_sec)` 実測値を使用。カッコ内は 900 秒超の極端な長尺を除いた平均尺ベース。アンカー費用は 1 本 2.05 コール（平均尺 156 秒）≈ **\$0.0986/本** として合算。

| 対象区分 | 未校正本数 | 平均尺 | 混入アンカー本数 | 本体費用（Flex 2.05回） | アンカー費用 | **合計費用（Flex）** | 月 \$40 クレジット所要月数 | 月 \$38 安全上限所要月数 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **P0 (`craft_recipes`)** | 60 本 | 170.2s | 18 本（初回） | \$6.19 | \$1.78 | **\$7.97** | 0.20 か月 | 0.21 か月 |
| **P1 (`private_rating`)** | 18 本 | 139.3s | 0〜1 本 | \$1.68 | \$0.10 | **\$1.78** | 0.04 か月 | 0.05 か月 |
| **小計：P0 + P1（＋初回アンカー18本）** | **78 本** | **163.1s** | **18 本** | **\$7.87** | **\$1.78** | **\$9.65** | **0.24 か月**（1 か月目の約 1/4） | **0.25 か月** |
| **P2 (`verified_5_genres`)** | 2,954 本 | 177.1s (173.8s) | 約 148 本（50本に2.5本） | \$311.3 (\$308.2) | \$14.59 | **\$325.9**（\$322.8） | **8.15 か月**（8.07） | **8.58 か月**（8.49） |
| **P3 (`unverified_genres`)** | 1,296 本 | 244.9s (202.3s) | 約 65 本（50本に2.5本） | \$164.8 (\$147.1) | \$6.41 | **\$171.2**（\$153.5） | **4.28 か月**（3.84） | **4.51 か月**（4.04） |
| **全 4,328 本合計** | **4,328 本** | **197.0s (182.1s)** | **約 231 本** | **\$484.0**（\$463.2） | **\$22.78** | **\$506.8**（\$486.0） | **12.67 か月**（12.15） | **13.34 か月**（12.79） |

- ※ 事前スモーク検証（Flex 同等性確認 5 本 × 2 回）の約 **\$0.48** を足しても、**P0 + P1 + 初回アンカー 18 本 + スモーク検証 = 計 約 \$10.1** で 1 か月目のクレジット（\$40）内に余裕で収まる。
- ※ 上記は **全 4,328 本をすべて CHIBA-PC の API だけで処理した場合の上限見積もり**。他 PC（`chibatmute` / `CHIBA-PC2`）の無料枠ローカルブラインド採点と並行すれば、API 負担本数と所要月数はそのまま減少する。

### 10.3 所要時間の見積もり（Flex）
Flex の 1 コールあたり実応答時間は混雑状況に依存する（公式目安 1〜15 分、オフピークは 1〜2 分程度）。

| 規模 | 想定コール数（2.05回＋アンカー） | 1 コール平均 1.5 分時（直列） | 1 コール平均 3.0 分時（直列） | （参考）並列度 2・平均 2 分時 |
|---|---:|---:|---:|---:|
| **通常 1 バッチ（50 本＋アンカー 3 本）** | 約 109 回 | 約 **2.7 時間** | 約 **5.5 時間** | 約 **1.8 時間** |
| **P0 + P1 + 初回アンカー 18 本（96 本）** | 約 197 回 | 約 **4.9 時間** | 約 **9.9 時間** | 約 **3.3 時間** |
| **月間 \$38 枠（約 350 本＋アンカー 18 本）** | 約 754 回 | 約 **18.9 時間 / 月** | 約 **37.7 時間 / 月** | 約 **12.6 時間 / 月** |
| **全 4,328 本（アンカー込み）** | 約 9,346 回 | 延べ約 **234 時間** | 延べ約 **467 時間** | 延べ約 **156 時間** |

→ 処理時間よりも **月 \$40 クレジット枠（約 350〜380 本/月）** が律速となるため、月内に数回の夜間バッチ実行（週 1〜2 バッチ × 50 本）で無理なく月次上限まで消化できる。

---

## 11. 実装時に変更が必要な既存ファイルと新規作成ファイル

### 変更が必要な既存ファイル（最小 3 ファイル＋任意 1 ファイル）
1. **`scripts/claim-phase3-batch.mjs`**: `--scoring-channel <local_blind|gemini_api_url>` オプション追加、`analysis/claims/<run_id>.json` / `_ids.json` / `--status` に `scoring_channel` を記録・表示（既存ローカル予約には影響ゼロ）。
2. **`scripts/apply-phase3-batch-to-tidb.mjs`**: 既校正行（`calibratedScore IS NOT NULL`）の上書き拒否ガード（アンカー誤上書き防止）と、API 経路ペイロード時の監査通過＋補正承認チェックを追加。
3. **`client/src/lib/types.ts`**: `calibratedRoute` の union 型に `"gemini_api_youtube_url_v1"` を追加。
4. （任意）**`client/src/components/VideoModal.tsx`**: `calibratedRoute === "gemini_api_youtube_url_v1"` の表示ラベル調整（無改修でも文字列はそのまま表示される）。

### 新規作成するファイル
1. **`scripts/run-api-url-batch.mjs`**: Flex ティア・503/429 指数バックオフ再試行・2+1 集約・アンカー混入・予算台帳チェック（月 \$38 / ラン上限）・途中再開（`--resume`）を備えた本番実行ランナー。
2. **`scripts/audit-api-url-run.mjs`**: 第 7 章の自動監査 7 項目および人的抜き取り確認レポート（`--sample-review`）出力スクリプト。
3. **`scripts/evaluate-api-url-batch.mjs`**: アンカー 30 本到達時のバイアス推定（平均差・95% CI・Standard vs Flex 比較）レポート生成、承認済み補正値の適用、`anchor_eval_results.json` 分離、および `phase3_batch_payload.json` 生成スクリプト。
4. **`analysis/api_url_budget_ledger.json`**: 月次・ラン別の実測費用とリクエスト数を記録する予算台帳。
5. **`analysis/api_url_bias_config_v1.json`**: ユーザー承認後に確定した定数オフセット補正値・95% CI・承認日時を固定保存する設定ファイル。

---

## 12. 承認・決定事項（2026-11-25 確定）と P0 後工程確認結果

### 12.1 ユーザー決定 6 項目
1. **Flex 事前スモーク検証**: **実施する**（Standard で採点済みの 12 本から 5 本を選び、Flex で 2 回ずつ採点。予算上限 **\$0.60**）。
2. **初回バッチの区切り方**: **2 つの run に分ける**（`run 1` = `P0_craft_recipes` 60 本 + 答え合わせ用アンカー 18 本、`run 2` = `P1_private_rating` 18 本）。
3. **63 点未満の答え合わせ用動画の差し替え**: **2 本差し替える**（`SEABn1jepkY` / `-igT-XOKyEo` を後続バッチ用へ回し、`fit` 末尾の `<63` 動画 2 本 `_PO5O3QAaVM` / `Jf9F5VBqA2A` を初回 18 本に編入）。`validation_preregistration.json` は一切変更せず、差し替え理由と前後 ID を `analysis/pilot_gemini_api_url/anchor_selection_deviation.json` に記録済み（30 本合計の内訳：`>=83` 11 本 / `63-82` 15 本 / `<63` 4 本、境目 83±3 が 8 本・63±3 が 4 本）。
4. **900 秒超の長尺動画の扱い**: **後回しキュー（`deferred_long_videos`）へ回し、900 秒以下を先に採点する**（`claim-phase3-batch.mjs --max-duration-sec 900` および `run-api-url-batch.mjs --max-duration-sec 900` で自動分離）。
5. **応答全文の保管と `archive-run-evidence.mjs` 連携**: 全文（`calls/*.json`）は **`E:\iketeru_api_url_logs\<run_id>\calls\`** へ保管し、Git（`analysis/runs/<run_id>/`）には軽量サマリーと **`evidence_manifest.json`**（各ファイルの絶対パス・相対パス・バイト数・SHA-256・シークレット検査結果）のみ入れる。`chibatmute` 作成の `scripts/archive-run-evidence.mjs`（D-019）は `analysis/runs/<run_id>/` 一式を収集するため、そのまま manifest が同梱され、外部フルログの場所と SHA-256 が完全に追跡可能となる。
6. **並列数**: 最初は **1（直列）** で実行する。

### 12.2 P0（`P0_craft_recipes`）の後工程影響確認（読み取り専用実測・2026-11-25）
- **対象の実態**: TiDB の未校正 YouTube `P0_craft_recipes` **60 本** は、SQLite（`E:\iketeru-creative-studio\data\iketeru_knowledge.db`）上で **60/60 本すべてが既に `craft_recipes`（計 158 レシピ）および `scenes` テーブルに登録済み**（最大尺 524 秒、900 秒超は **0 本**、ローカル動画キャッシュは 0 本）。
- **後工程への影響**: P0 の目的は「作成済みクラフトレシピの参照元動画へ、信頼できる校正スコアを優先付与すること」であり、API 経由で校正点数だけを付けても `craft_recipes` 利用・SQLite ミラー同期（`sync-tidb-to-sqlite-mirror.mjs`）・MCP 検索（`search_craft_recipes` / `plan_craft_sequence`）に欠落や混乱は一切生じない（なお `CRAFT_CALIBRATION_PILOT_DESIGN.md` の小実験はオープン編集データ・Blender `.blend`・BTS ペア 8 組で独立しているため影響なし）。
- **結論**: P0 を後回しにする必要はなく、予定どおり **`run 1` = P0（60 本）＋アンカー 18 本 → `run 2` = P1（18 本）** の順で進める。
