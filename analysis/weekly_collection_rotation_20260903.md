# 週次映像収集の4週ローテーション

更新日: 2026-09-03

> 週次実行の対象を絞るため、日次・最新CMとして更新状況を確認できる2収集元を毎週巡回し、残る制作会社・制作者の公式ポートフォリオ24件は4週で一巡する。1回の巡回対象は8件である。

| 巡回区分 | 収集元ID | 収集元 |
|---|---|---|
| 毎週 | `bb_navi` | BB-NAVI |
| 毎週 | `douganow` | 動画NOW!! |
| 第1週 | `all_d`, `one_media`, `pics`, `edp`, `babel_pro`, `aoi_pro` | 大手・中核制作会社 6件 |
| 第2週 | `light_the_way`, `odd_fellows`, `naname`, `liki`, `tyo`, `geek_pictures` | 制作会社 6件 |
| 第3週 | `takashi_ohashi`, `shirotaeisuke`, `takerushima`, `sgasakura`, `maxilla`, `wachajack` | 制作者・制作会社 6件 |
| 第4週 | `signif`, `flapper3`, `taiyo_kikaku`, `pyramidfilm`, `stink_studios`, `d_walker` | 制作会社 6件 |

## ローテーション起点

`Asia/Tokyo` で、2026-09-07（月）を第1週、2026-09-14（月）を第2週、2026-09-21（月）を第3週、2026-09-28（月）を第4週とし、以後4週単位で繰り返す。各回では毎週対象2件と該当週6件だけを巡回する。

## 週次対象外

映像作家100人、ALINCOLONY、BOVAは固定・年度アーカイブのため無効とする。Vook イケてる映像は掲載一覧の安定取得を再確認するまで、Video Refsは直近更新の実績を確認するまで、いずれも週次対象から外す。

## 設計時の公開状況確認

| 収集元 | 公開ページで確認した状況 | 運用判断 |
|---|---|---|
| BB-NAVI | 2026-09-03更新。新着・更新順の約1か月分・約400本の最新CMを掲載し、RSSも提供している。 | 毎週巡回 |
| 動画NOW!! | 2026-09-03付の新着記事が同日に複数公開されている。 | 毎週巡回。ただし記事内のYouTube/Vimeo正規URLが確認できる候補だけを登録 |
| P.I.C.S. | 2026-09-02、08-27、08-21など直近のニュース更新を確認。 | 第1週。作品ページで動画URLを個別照合 |
| EDP | 2026年の新作一覧と2026-05-15、01-22、01-05のニュースを確認。 | 第1週。作品ページで動画URLを個別照合 |
| AOI Pro. | 2026-09-03、09-01、08-31のニュースと2026年の作品ページを確認。 | 第1週。作品ページで動画URLを個別照合 |
| ONE MEDIA | 公開Worksがあり、直近コラムは2026-08-28。掲載媒体はTikTok中心。 | 第1週。ただし週次のYouTube/Vimeo条件に合致するURLだけを対象 |
| ALLd. | トップページの公開テキストから個別作品・動画URLを安定取得できなかった。 | 第1週。作品詳細で明示URLを取得できた時だけ候補化 |
| BABEL LABEL | メンバープロフィールは確認できたが、トップページから個別作品の公開動画URLを取得できなかった。 | 第1週。プロフィール・作品詳細で明示URLを取得できた時だけ候補化 |

### 試験抽出の保留判断

動画NOW!!の2026-09-03掲載記事4件を個別確認したところ、記事本文には「公式チャンネルで公開」との記載はあったが、YouTubeまたはVimeoの正規URLと動画IDを確認できなかった。このため、試験登録候補には入れず、`動画ID・正規URLの未確認` として保留する。掲載内容からURLを推測して登録しない。

BB-NAVIの「佐藤健 夏うたベスト100 CM チルい夏篇」について、検索で発見したYouTube動画ID `BqoOL7Mezls` を公開動画ページで確認したところ、タイトルは「佐藤健・K (&TEAM) #夏うたベスト100 『ドライブの夏』篇」だった。掲載タイトルと一致しないため、同IDは登録対象から除外した。個別詳細に表示される「YouTube UNIVERSAL MUSIC JAPAN公式チャンネル」という記載だけでは、`チルい夏篇` の正規動画IDを確定できない。

AOI Pro.の「キリンビール 淡麗グリーンラベル『GREEN JUKEBOX 光』篇」は、AOI Pro.の作品一覧に掲載を確認できた。キリン公式商品ページでは年齢確認が必要となり、利用者の年齢情報を入力せずに正規動画URL・動画IDを確認することはできなかった。したがって、試験時点では候補化せず、`年齢ゲートにより動画ID未確認` として保留する。

### 参照URL

- https://www.bb-navi.com/cm-douga/index-news.html
- https://douganow.jp/
- https://douganow.jp/archives/20260903525416.html
- https://douganow.jp/archives/20260903525403.html
- https://douganow.jp/archives/20260903525390.html
- https://douganow.jp/archives/20260903525379.html
- https://www.pics.tokyo/
- https://www.edp.jp/
- https://babel-pro.com/
- https://www.aoi-pro.com/jp/
- https://www.onemedia.jp/

## 第1週の試験巡回結果

実行日時: 2026-09-03 09:34 JST

| 指標 | 件数 | 内容 |
|---|---:|---|
| 巡回収集元数 | 8 | 毎週対象のBB-NAVI・動画NOW!!、第1週のALLd.・ONE MEDIA・P.I.C.S.・EDP・BABEL LABEL・AOI Pro. |
| 候補数 | 0 | 動画ID・正規URL・掲載タイトルを一対一で確認でき、YouTube/Vimeoの公開oEmbed照合へ進める候補は0件 |
| 新規動画の追加件数 | 0 | 照合通過候補なし |
| 既存動画の更新件数 | 0 | 既存IDは更新しない週次仕様 |
| 重複除外数 | 0 | 照合通過候補なし |
| 保留・失敗件数 | 6 | 動画NOW!!の4記事でYouTube/Vimeo正規URL・動画IDを確認できず、BB-NAVIの1件で検索発見IDのタイトル不一致、AOI Pro.の1件で年齢ゲートにより動画IDを未確認 |

ALLd.、ONE MEDIA、P.I.C.S.、EDP、BABEL LABELのトップ／一覧確認では、週次条件を満たすYouTube/Vimeoの正規URL付き新規作品を確認できなかったため、登録候補・保留件数には含めていない。
