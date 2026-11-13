# 個別AI再分析台帳

> **保存ルール**：動画ID・URL・タイトルが一致した場合だけ、実映像に基づく分析結果を保存する。映像を確認できない場合は、分析結果をDBへ保存しない。

| No. | 動画ID | タイトル | 動画URL | 既存AI分析 | 三重照合 | 分析状態 | 保存状態 |
|---:|---|---|---|---|---|---|---|
| 1 | `lJXaNYTVjrQ` | THE COOK \| Award-Winning Short Film | https://www.youtube.com/watch?v=lJXaNYTVjrQ | 実映像ベースの分析を保存済み | ID・URL・タイトル確認済み | 実映像解析・メタデータ補完済み | 保存済み |
| 2 | `efGqe1j3RNk` | WiNDUP: Award-winning animated short film \| Unity | https://www.youtube.com/watch?v=efGqe1j3RNk | なし | ID・URL・タイトル確認済み | 待機 | 未保存 |
| 3 | `kagoEGKHZvU` | 【imase】NIGHT DANCER（MV） | https://www.youtube.com/watch?v=kagoEGKHZvU | なし | ID・URL・タイトル確認済み | 待機 | 未保存 |
| 4 | `5wEjV2ekSwE` | WINNER - 2014 BEST AUTO COMMERCIAL Honda "Hands" | https://www.youtube.com/watch?v=5wEjV2ekSwE | なし | ID・URL・タイトル確認済み | 待機 | 未保存 |
| 5 | `BE4oz2u6OHY` | CHILDREN | https://www.youtube.com/watch?v=BE4oz2u6OHY | なし | ID・URL・タイトル確認済み | 待機 | 未保存 |
| 6 | `Ew_UqyXIJeg` | Why This EMOTIONAL Thai Ad Went Viral in 2015... | https://www.youtube.com/watch?v=Ew_UqyXIJeg | なし | ID・URL・タイトル確認済み | 待機 | 未保存 |
| 7 | `4B6T8rHvTio` | Michael Jackson / SONY Television TV Commercial Japan | https://www.youtube.com/watch?v=4B6T8rHvTio | なし | ID・URL・タイトル確認済み | 待機 | 未保存 |
| 8 | `35i4zTky9pI` | Lost & Found \| Animated Short Film | https://www.youtube.com/watch?v=35i4zTky9pI | なし | ID・URL・タイトル確認済み | 待機 | 未保存 |
| 9 | `53i4Yuw2ld8` | Japanese band Mrs. Green Apple -- premiere of Spider-Man: Brand New Day | https://www.youtube.com/watch?v=53i4Yuw2ld8 | なし | ID・URL・タイトル確認済み | 待機 | 未保存 |
| 10 | `B4YTM8h6fJ4` | Matsuda Seiko - Anata ni aitakute | https://www.youtube.com/watch?v=B4YTM8h6fJ4 | なし | ID・URL・タイトル確認済み | 待機 | 未保存 |

## 保存・公開API確認

| 確認時刻（UTC） | 動画ID | タイトル | 動画URL | 保存状態 | 公開API確認 |
|---|---|---|---|---|---|
| 2026-08-18T06:29:55.719Z | `lJXaNYTVjrQ` | THE COOK \| Award-Winning Short Film | https://www.youtube.com/watch?v=lJXaNYTVjrQ | AI分析529文字、カテゴリ・追加情報・AI評価（総合A+／演出A+／技術A）・キュレーションメモを保存済み | `videos.list` HTTP 200でID・URL・タイトル、AI分析、目的・背景・評価、公式出典1件の返却を確認 |

## 実行ログ

| 日時 | 対象 | 実行内容 | 結果 |
|---|---|---|---|
| 2026-08-18 | `lJXaNYTVjrQ` | 実映像ベースの詳細分析を実行 | 映像解析環境が利用できず、分析・DB保存を中止 |
| 2026-08-18 | `lJXaNYTVjrQ` | 実映像・音声を解析し、保存候補を作成 | 構成・画・音・編集・実務応用を候補ファイルへ記録。DBは承認待ちのため未更新 |
| 2026-08-18 | `lJXaNYTVjrQ` | 承認済み候補をDBへ反映 | AI分析、ジャンル・商材・演出・トーン、用途・表現、制作、私的評価、AI評価、キュレーションメモを三重照合条件で保存 |
| 2026-08-18T06:29:55.719Z | `lJXaNYTVjrQ` | 公開API応答を検証 | `videos.list` HTTP 200で三重照合とAI分析・キュレーションメモ・AI評価の返却を確認 |
