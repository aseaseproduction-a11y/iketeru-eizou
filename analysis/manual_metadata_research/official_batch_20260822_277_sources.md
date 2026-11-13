# 公式根拠台帳 — バッチ277

確認日: 2026-08-22

対象はDB上で投稿元未取得だったVimeo候補10件です。公開oEmbedにより取得した投稿元と説明欄の明示情報だけを保存します。

| 動画ID | 作品・公開投稿元 | 公開説明欄の根拠 | 保存方針 |
|---|---|---|---|
| `982944535` | CRMC / SIGNIF | [Vimeo](https://vimeo.com/982944535) に`Movie: Koji Aramaki`、投稿元はSIGNIFと明記。 | 制作（SIGNIF・Koji Aramaki）を映像制作役割として補完する。音響は保存しない。 |
| `946821430` | EYE SEE / Hoji Tsuchiya・土屋萌児 | [Vimeo](https://vimeo.com/946821430) にPagani Eyewear向け映像、Hoji TsuchiyaによるIllustrationsを明記。 | 無効な連結・説明文形式の既存制作タグを削除し、制作（土屋萌児）をイラスト役割として補完する。商材`ファッション / アパレル`、用途`ブランディングムービー`、表現`イラスト`を補完する。音楽・音響・文章は保存しない。 |
| `937033322` | OFT_REedit_Olive / niceairproduction | [Vimeo](https://vimeo.com/937033322) にDaisuke Ukisitaの監督・found footage、Satoshi OkanoとMasaki TodaのPainting、CLEAR GALLERY TOKYOでの展示を明記。 | 商材に該当しない既存`娯楽 / アミューズメント`を削除し、用途`アート`を補完する。既存のDaisuke Ukisitaクレジットへ監督・found footage役割のみを追記する。既存クレジットが空でないため、追加人物は保存しない。音楽・音響は保存しない。既存の表現`アニメーション`・`2D`は維持する。 |
| `936975333` | BLUE / Synichi Yamamoto | [Vimeo](https://vimeo.com/936975333) の投稿元はSynichi Yamamotoだが、公開説明欄は空欄。 | 投稿元以外の制作関与・分類・役割を確認できないため、既存値を維持し`confirmed`とする。 |
| `936903617` | お笑い4コマパーティーロロロロ OP / amnys | [Vimeo](https://vimeo.com/936903617) の投稿元はamnysだが、公開説明欄は空欄。 | 投稿元・タイトルだけでは当該作品への制作関与・役割を確定できないため`confirmed`とする。ただし、人物・会社名でない既存の連結文字列・説明文・役割だけの無効制作タグおよび対応する無効クレジットのみ削除する。 |
| `936559027` | CyberAgent Game Conference 2024 Opening Sequence / Takeru Shima | [Vimeo](https://vimeo.com/936559027) にBungo Aoyama（CyberAgent）のProducer、Junya Saito（Archipatch）のArt Director、Takeru ShimaのOP Director / Motion Graphicsを明記。 | 既存の商材・用途・制作タグを維持し、既存の島猛クレジットにのみ`オープニング監督`・`モーショングラフィックス`役割を補完する。既存外のクレジットは構造化追記の安全条件を満たさないため追加しない。音楽・音響は保存しない。 |
| `936067765` | 3D OOH for EUROJAPAN CUP / Yuuki Kawakami | [Vimeo](https://vimeo.com/936067765) にEUROJAPAN CUP 2022向けのOutdoor 3D advertisementと明記。 | 既存の表現`3D`と制作（河上裕紀）を維持し、用途`プロモーション`を補完する。 |
| `934629152` | IDENCE SHOWREEL 2024-04 / IDENCE Inc. | [Vimeo](https://vimeo.com/934629152) の投稿元はIDENCE Inc.だが、公開説明欄は空欄。 | 投稿元・タイトルだけでは個別掲載作品の分類・役割を確定できないため`confirmed`とする。ただし、同一の商材が重複した既存値のみを1件へ正規化する。 |
| `933948780` | #JVMC2023_MARU AKARI / MARU AKARI | [Vimeo](https://vimeo.com/933948780) の投稿元はMARU AKARIだが、公開説明欄は実質空欄。 | 投稿元・タイトルだけでは追加の制作役割を確定できないため、既存値を維持し`confirmed`とする。 |
| `931257238` | SUPER SLIT SCAN - AIR MAX DYNAMIC LAND ver / Kitasenju Design | [Vimeo](https://vimeo.com/931257238) はNike公式Air Max Dnキャンペーンページへ直接リンクしており、投稿元はKitasenju Design。 | 商材`ファッション / アパレル`、用途`プロモーション`を補完する。制作は既存の北千住デザインを維持し、説明欄に役割明示がないため追加しない。 |

## 保存ルール

- 保存日時は `2026-08-22`、根拠種別は `official_vimeo_description` とする。
- 制作タグは人物名・会社名に限定し、役割は `productionCredits.roles` に分離する。
- 音楽・音響等、映像制作の検索に不要な役割、連結文字列、説明文、メールアドレスは制作タグ・クレジットへ保存しない。
