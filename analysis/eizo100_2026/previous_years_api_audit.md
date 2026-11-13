# 映像作家100人：2025年以前の公式データ取得監査

調査日: 2026-08-18

## 公式取得経路

公式WordPress REST APIの`video`カスタム投稿タイプに、年度カテゴリIDを指定して取得する。各年度とも`per_page=100`で取得でき、100件を超える年度は2ページに分かれることをHTTPヘッダー`X-WP-Total`および`X-WP-TotalPages`で確認した。

| 年度 | カテゴリID | 公式掲載件数 | APIページ数 | 取得URL |
|---|---:|---:|---:|---|
| 2018 | 161 | 87 | 1 | `wp-json/wp/v2/video?categories=161` |
| 2019 | 663 | 97 | 1 | `wp-json/wp/v2/video?categories=663` |
| 2020 | 946 | 94 | 1 | `wp-json/wp/v2/video?categories=946` |
| 2021 | 989 | 98 | 1 | `wp-json/wp/v2/video?categories=989` |
| 2022 | 999 | 145 | 2 | `wp-json/wp/v2/video?categories=999` |
| 2023 | 1013 | 198 | 2 | `wp-json/wp/v2/video?categories=1013` |
| 2024 | 1026 | 194 | 2 | `wp-json/wp/v2/video?categories=1026` |
| 2025 | 1033 | 181 | 2 | `wp-json/wp/v2/video?categories=1033` |

合計1,094件を年度単位で構造化し、動画ID・URL・タイトルの三重照合、既存DB重複監査、公式出典およびキュレーションメモの保存を行う。

> 年度の選出掲載と動画URLの存在は別に扱う。動画URLが確認できないもの、oEmbedによる動画タイトルの確認ができないもの、既存DBとの照合に不整合があるものは登録せず保留にする。
