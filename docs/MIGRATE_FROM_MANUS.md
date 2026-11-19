# Manus 脱却ガイド（Vercel Serverless Functions + TiDB Cloud Serverless 無料構成）

`iketeru-eizou` のバックエンド＆MySQL DB を Manus (`iketeruvid-mzehlcez.manus.space`) から切り離し、**完全無料枠（TiDB Cloud Serverless 5 GiB + Vercel Hobby）** へ移行する手順です。

---

## ステップ 1：TiDB Cloud Serverless（無料 DB）を作成（所要 2〜3 分）

1. https://tidbcloud.com/ にアクセスし、Google または GitHub でサインアップ（クレジットカード不要）。
2. **「Create Cluster」→「Serverless」** を選択。
   - Region: `Tokyo (ap-northeast-1)` 推奨
   - Cluster Name: `iketeru-eizou`
3. 作成完了後、右上の **「Connect」** をクリック：
   - **Generate Password** を押してパスワードを控える
   - 接続先ドライバで **General / Node.js** を選び、接続 URI をコピーする：
     ```text
     mysql://<USER>:<PASSWORD>@gateway01.ap-northeast-1.prod.aws.tidbcloud.com:4000/test?ssl={"minVersion":"TLSv1.2","rejectUnauthorized":true}
     ```
   - （DB名を `iketeru_eizou` にしたい場合は TiDB コンソールの SQL Editor で `CREATE DATABASE iketeru_eizou;` を実行し、URI 末尾の `/test` を `/iketeru_eizou` に変えます）

---

## ステップ 2：ローカルからテーブル作成＆全 5,635 本データ移行

PowerShell で以下を順に実行します（`DATABASE_URL` にステップ 1 の URI を設定）：

```powershell
cd E:\iketeru-eizou
$env:DATABASE_URL = 'mysql://<USER>:<PASSWORD>@gateway01.ap-northeast-1.prod.aws.tidbcloud.com:4000/test'

# 1. 全テーブル作成（100点評価カラム込み）
node scripts/init-tidb-schema.mjs

# 2. 移行ドライラン確認（API全件メタデータ + ローカルSQLiteの詳細分析4,561本を合体）
node scripts/migrate-to-tidb.mjs

# 3. 本番移行実行（全5,635本を TiDB Cloud へ投入）
node scripts/migrate-to-tidb.mjs --apply

# 4. 既存動画の100点初期バックフィル（既存S+〜D-ランク据え置き）
node scripts/backfill-100pt-scores.mjs --apply
```

※ Manus 側の `DATABASE_URL` も手元にある場合は、`$env:SOURCE_DATABASE_URL = "..."` を追加して `migrate-to-tidb.mjs --apply` を実行すると、お気に入りプロフィール等の全テーブルまで丸ごとコピーされます。

---

## ステップ 3：Vercel 環境変数設定＆デプロイ切替

1. Vercel ダッシュボード（`iketeru-eizou` プロジェクト）→ **Settings → Environment Variables** を開く。
2. `DATABASE_URL` にステップ 1 の TiDB Cloud 接続 URI を追加（Production / Preview / Development にチェック）。
3. `git push origin main` を実行すると、Vercel が自動で：
   - フロントエンド（Vite）をビルド
   - バックエンド API（`api/index.mjs`）を `esbuild` でバンドル＆デプロイ
   - `/api/*` を Manus ではなく自身の Vercel Serverless Function へルーティング
4. デプロイ完了後、以下にアクセスして `{"ok":true,"runtime":"vercel-serverless","hasDb":true,"videoCount":5635}` が返れば **Manus 脱却完了** です：
   - `https://iketeru-eizou.vercel.app/api/health`
