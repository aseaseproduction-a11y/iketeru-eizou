# 週次映像収集 実行監査（2026-09-24）

## 実行概要

2026年9月24日に第3週ローテーションの収集を実行した。対象は毎週確認する **BB-NAVI**、**動画NOW!!** と、第3週の **高橋貴士**、**Eisuke Shirota**、**竹留**、**佐倉**、**maxilla**、**ワチャジャック** の計8収集元である。掲載ページと正規YouTube/Vimeo URLの対応、公開oEmbed、動画IDを用いて照合し、既存動画のタイトル、分類、制作クレジットを自動で上書きしない保存ルールを適用した。

| 指標 | 結果 |
| --- | ---: |
| ローテーション週 | 第3週 |
| 巡回収集元数 | 8件 |
| 差分・最新順で照合した掲載数 | 127件 |
| 保存処理へ送信した候補数 | 60件 |
| 新規動画の追加件数 | 38件 |
| 既存動画の安全な更新件数 | 2件 |
| 重複除外件数 | 0件 |
| 保留・失敗件数 | 20件 |
| 実行ログ | `dailyCollectionRuns.id = 90001` |
| 動画総数 | 4,884件 → 4,922件 |

実行ログには候補60件、追加38件、更新2件、スキップ20件が保存され、8収集元すべての`lastCheckedAt`が **2026-09-24 03:20:18 UTC（12:20:18 JST）** に更新された。候補保存はローカルの補助スクリプトを使った一度限りの実査であり、定期実行時に認証済みサイト側エンドポイントを使う構成・保存ルールとは同じである。

## 収集元別結果

| 収集元 | 照合掲載数 | 候補送信数 | 新規 | 更新 | 保留・失敗 | 補足 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| BB-NAVI | 2 | 0 | 0 | 0 | 0 | 直近2記事には公式チャンネル名のみがあり、正規YouTube/Vimeo URL・動画IDが明示されなかったため候補化しなかった。 |
| 動画NOW!! | 10 | 21 | 21 | 0 | 0 | 10記事で明示されたYouTube埋め込みURLを個別に照合した。 |
| 高橋貴士 | 20 | 0 | 0 | 0 | 0 | 最新掲載が2026年8月22日であり、初回時の直近範囲外だった。 |
| Eisuke Shirota | 20 | 20 | 0 | 0 | 20 | 公式サイトのVimeo埋め込み対応は確認できたが、保存時のVimeo oEmbedがタイトルを返さず、`domain_status_code: 403`だったため公開メタデータ安全ゲートで保留した。 |
| 竹留 | 20 | 5 | 3 | 2 | 0 | 個別作品ページのYouTube埋め込みURLを照合した。 |
| 佐倉 | 20 | 0 | 0 | 0 | 0 | 最新作を含め直近範囲内の掲載を確認できなかった。 |
| maxilla | 20 | 14 | 14 | 0 | 0 | 公式作品ページの明示YouTube埋め込みURLを照合した。公開oEmbedが403となったIONIQ 5 Nの2件は候補化前に除外した。 |
| ワチャジャック | 15 | 0 | 0 | 0 | 0 | 掲載日が2025年以前で直近範囲外だった。 |

候補60件は、掲載ページ・動画ID・正規URLの対応を確認して送信した値である。このうち40件は公開oEmbedのタイトルを含め保存条件を満たし、20件はEisuke Shirota掲載のVimeo公開メタデータ取得が不十分だったため登録していない。タイトルまたは公開状態を推測して保存する処理は行わなかった。

## 新規登録した38件

### 動画NOW!!（21件）

| 動画ID | 公開タイトル |
| --- | --- |
| `sGS4I_W0dJk` | YOMIURI GIANTS SEASON SEAT「いっしょに熱狂すれば、仲間だ。_先輩・後輩篇」 |
| `ik5mPZbIwI4` | 【ジョージア】「100人がカフェウォー ブラックを飲んでみた」篇 15秒 横 GEORGIA |
| `OSmAT68IhoU` | プチッと鍋 実演篇 プチッと炒飯 瀬戸康史 |
| `2Pr8xQ7LSvo` | キャンメイクCM「花咲かなのかさん篇」15秒 |
| `Yk-14JZQjPo` | キャンメイクCM「花咲かなのかさん篇」30秒 |
| `gedRoZr3VcQ` | キャンメイクCM「花咲かなのかさん篇」メイキング |
| `ufYC_mc_7F0` | 31 CM動画 パパ篇 30秒 |
| `fpIAbzh5Ql0` | 34 CM動画 ママ篇 30秒 |
| `6qqEluntB1M` | 37 CM動画 祖母篇 30秒 |
| `Tr50MVHWlF8` | 山田涼介さん メイベリン ニューヨーク シャインビースト |
| `lvMcYm2LIdQ` | 眼鏡市場｜ストレスフリー遠近「見やすっ」篇 15秒 |
| `cddePm1brLI` | BEHIND THE SCENES｜ストレスフリー遠近 |
| `E1EzaMG-3nE` | SPECIAL FITTING｜吉岡里帆 & 滝藤賢一 |
| `CXSg3r3yqrc` | 『TOYOTAHOMEstay「トヨタの家」』篇 30秒 |
| `ULiGgpTq16k` | 『TOYOTAHOMEstay「トヨタの家」』篇 60秒 |
| `Z_zy3Pp-Ejc` | 「TOYOTAHOMEstay」CMメイキングムービー |
| `pXKI4jvlLp0` | 「TOYOTAHOMEstay」出演者インタビュー |
| `r2RowYi7kfA` | 湖池屋 金のポテト「バンド」篇 |
| `37cUjNWMWfY` | 湖池屋 金のポテト「実感 ポテトといえば」篇 |
| `kbbq935MKVI` | パブロンSゴールドW TVCM「葛藤する親心」篇 15秒 |
| `w2yRyaW3wW8` | パブロンSゴールドW TVCM「葛藤する親心」篇 30秒（秋） |

### 竹留（3件）

| 動画ID | 公開タイトル |
| --- | --- |
| `aMdnFM0oAqg` | 【先行レビュー】TETTOR 60mm F1.4｜クラフトレンズ |
| `7Y-irzSTH3Y` | dアニメストアCM「好きに全振ろう」篇 30秒 |
| `aIsc4pNiUT4` | KNRから大事な発表があります |

### maxilla（14件）

| 動画ID | 公開タイトル |
| --- | --- |
| `pqEG4PgdNIw` | 【ノンクレジットOP映像『RISE UP』】Paradox Live THE ANIMATION |
| `MIBqS9kcDg0` | Tohji - Aglio e olio |
| `O4yzPf1oC6k` | yama『パレットは透明』MV |
| `JLWOejLxVUQ` | Lucky Kilimanjaro - 無限さ |
| `KLLqZQnMprI` | INZONE H5【ソニー公式】 |
| `cmqphEIn8xs` | INZONE Buds【ソニー公式】 |
| `vWrzZ6Y5rpc` | 新垣結衣が出合う、ハリー・ウィンストンのドラマチックな煌めき |
| `2vGlDQiBLd4` | VALORANT Game Changers Japan 2023 Split 1 ティザー |
| `anNntfCVkE4` | VALORANT Game Changers Japan 2023 Split 2 ティザー |
| `pl72zalxnq0` | RUN FOR YOU - Ayumu Imazu |
| `Xq9VPMuK3JQ` | ポルカドットスティングレイ「ゴーストダイブ」 |
| `hDm0hwnKm-Q` | 『エルドレインの森』アニメトレーラー |
| `ZTl-7yhRhzw` | YOASOBI「アイドル」Official Music Video HIKAKIN Ver. |
| `P6MTnRIvMYI` | 天晴れ乾杯 / TOOBOE |

## 既存動画への安全更新（2件）

| 動画ID | 公開タイトル | 更新内容 |
| --- | --- | --- |
| `X7slwzXNhwg` | 【ハイドライバーズ】テーマソング「Hi-DRIVERS！」MV | 竹留の掲載作品ページを`curationNote.sourceUrls`へ追加。 |
| `4srsrJ2lbdU` | 「KASHIKA_02 BOUNCE DANCE」feat.4s4ki | 竹留の掲載作品ページを`curationNote.sourceUrls`へ追加。 |

既存のタイトル、ジャンル、商材、用途、表現、トンマナ、制作クレジット、評価値は変更していない。記事・作品ページで明示されていたジャンル、商材、用途は、新規動画または該当欄が空の既存動画に限って保存対象とした。用途は固定10種の選択肢へ正規化した。

## 次回への引き継ぎ

週次スケジュールは毎週月曜7:00 JST、Asia/Tokyoで再有効化済みである。次回は第4週としてBB-NAVI・動画NOW!!・SIGNIF・フラッパー3・太陽企画・ピラミッドフィルム・Stink Studios・D-Walkerを巡回する。今回保留したEisuke Shirotaの20件は、Vimeoが公開タイトルを返す状態に回復した場合だけ再確認し、推測登録は行わない。
