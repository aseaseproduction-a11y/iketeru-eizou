# Phase 2 凍結データセット一覧（New Holdout 74本＋Dev 追加 31本）

- 作成日時: `2026-11-22T22:57:35.430Z`
- **New Holdout 確定構成**: **計 74本**（`Tier 2` $N_{\text{T2}} = 24$［CM 5・MV 5・モーション 5・3DCG/アニメ 5・企業映像 4］／`プロ商業` $N_{\text{PRO}} = 25$／`明らかな低品質` $N_{\text{LOW}} = 25$）
- **企業映像 Tier 2 達成状況**: Category D（Production Arts & Craft・Black Dolphin）公式一次出典の **別依頼主4本**（Novo Nordisk・Wernsing Food Family・Michelin・Aramco［単独1本・重複なし］）がすべてローカル OCR 通過したため、下限3本を上回り **5ジャンル構成（$N_{\text{T2}} = 24$、企業映像ジャンル別のみ `参考 n<5` 注記）** を確定（$N_{\text{T2}} = 20$ フォールバックは不要）。
- **事前固定合格ライン（$N_{\text{T2}} = 24$ vs $N_{\text{PRO}} = 25$）**: P-1 ROC-AUC $\ge 0.9000$ ／ P-2 感度 $\lceil 0.80 \times 24 \rceil = 20/24$本以上 ／ P-3 特異度 $\lceil 0.84 \times 25 \rceil = 21/25$本以上 ／ P-4 重大誤りA $= 0/24$本 ／ 低〜中露出・近作枠 15/24本（62.5% $\ge 60\%$）／ メガヒット 2/24本（$\le 2$）／ 透かし単独 R-LOW-04 0/25本（$\le 5$）。
- **Dev 追加分確定構成**: **計 31本**（モーション Tier 2 +5、R-PRO +11［Step 0 残存9本と合わせ CM 5・MV 5・モーション 3・3DCG 4・企業映像 3＝計20本、全ジャンル3本以上］、R-LOW +15［全5ジャンル×3本］）。
- **検証結果**: `validatePhase2Dataset` Holdout=`valid: true`・Dev=`valid: true`、Phase 1（83本）重複 `0`、Holdout/Dev 重複 `0`、全105本ローカル OCR 通過（`award_badge_ocr_hit: false`）・実取得可能（`playable_via_ytdlp: true`）。

## 1. New Holdout 全74本一覧

| # | 区分 | ジャンル | 規則ID | 動画ID | タイトル | 出典種別 | 出典URL | 再生数 | OCR結果 | 取得 |
|---:|---|---|---|---|---|---|---|---:|---|---|
| 1 | tier2_award | CM | R-T2-01 | `QmDckNBoKsY` | Hornbach - The Square Meter (HD film) | secondary | https://creative.salon/cannes-lions-curated/cannes-lions-2024/film-craft-lions-cannes-2024 | 23588 | PASS (40f, hit=false) | OK |
| 2 | tier2_award | CM | R-T2-01 | `ev83o3hVoso` | RSPCA - RESPECT #ForEveryKind ／ Hand-picked by Good  | secondary | https://creative.salon/cannes-lions-curated/cannes-lions-2024/film-craft-lions-cannes-2024 | 1083 | PASS (53f, hit=false) | OK |
| 3 | tier2_award | CM | R-T2-01 | `0PWmNDBWNz0` | Otsuka 大塚製薬 Calorie Mate CM 「光も影も」篇 120秒 | primary_official | https://www.acc-awards.com/festival/2024fes_result/js/data/film-craft.js | 10591 | PASS (52f, hit=false) | OK |
| 4 | tier2_award | CM | R-T2-01 | `nDI4TfI41FU` | 完璧じゃなくていい。｜NIKE JAPAN | primary_official | https://www.acc-awards.com/festival/2024fes_result/js/data/film-craft.js | 85122 | PASS (64f, hit=false) | OK |
| 5 | tier2_award | CM | R-T2-01 | `5G99rijm2AI` | SUNTORY 天然水 CM 「大自然を味方に」篇 60秒 | primary_official | https://www.acc-awards.com/festival/2025fes_result/js/data/film-craft.json | 3559 | PASS (41f, hit=false) | OK |
| 6 | tier2_award | MV | R-T2-02 | `Z8hWLECF2kE` | SKIIFALL -  2 Charming | primary_official | https://awards.ukmva.com/years/2023 | 229628 | PASS (62f, hit=false) | OK |
| 7 | tier2_award | MV | R-T2-02 | `3DnDPArgl_I` | METTE - BET (OFFICIAL VIDEO) | primary_official | https://awards.ukmva.com/years/2024 | 636817 | PASS (75f, hit=false) | OK |
| 8 | tier2_award | MV | R-T2-02 | `sDMLGzeHH6E` | AUDREY NUNA - Locket (Official Video) | primary_official | https://awards.ukmva.com/years/2023 | 812284 | PASS (60f, hit=false) | OK |
| 9 | tier2_award | MV | R-T2-02 | `4HZiS4VtscU` | HYUKOH(혁오), Sunset Rollercoaster - Antenna (Official | primary_official | https://awards.ukmva.com/years/2024 | 1259269 | PASS (81f, hit=false) | OK |
| 10 | tier2_award | MV | R-T2-02 | `nRtxogXp8sY` | The Chemical Brothers - Skipping Like A Stone (Offic | primary_official | https://awards.ukmva.com/years/2024 | 1446536 | PASS (85f, hit=false) | OK |
| 11 | tier2_award | モーション | R-T2-03 | `ZFVtLHLN8aU` | Star Trek Strange New Worlds Opening Titles Intro Se | primary_official | https://motionawards.com/winners-2023.html | 62312 | PASS (52f, hit=false) | OK |
| 12 | tier2_award | モーション | R-T2-03 | `6jhuEo2Upqs` | VALORANT, LOUDER // 2023 GAME CHANGERS CHAMPIONSHIP  | primary_official | https://motionawards.com/winners-2023.html | 173207 | PASS (49f, hit=false) | OK |
| 13 | tier2_award | モーション | R-T2-03 | `GJOn8nL2C8o` | Rugby's greatest stage awaits! ／ Rugby World Cup 202 | primary_official | https://motionawards.com/winners-2024.html | 208488 | PASS (35f, hit=false) | OK |
| 14 | tier2_award | モーション | R-T2-03 | `-15nbjw0IHU` | OOHA - Clash of Flavours ／ Golden Wolf, Stink Films  | primary_official | https://motionawards.com/winners-2024.html | 6091 | PASS (42f, hit=false) | OK |
| 15 | tier2_award | モーション | R-T2-03 | `OfCn09kBXXg` | Three Little Pigs Weetabix Advert ／ Golden Wolf | primary_official | https://motionawards.com/winners-2023.html | 9432 | PASS (38f, hit=false) | OK |
| 16 | tier2_award | 3DCG/アニメ | R-T2-04 | `a1EwwLFNQI0` | PICTOPLASMA OPENER 2023 | primary_official | https://www.annecyfestival.com/en/archives/2024/the-festival/2024-awards | 4647 | PASS (44f, hit=false) | OK |
| 17 | tier2_award | 3DCG/アニメ | R-T2-04 | `HoMeijpAI9E` | THE FRENCH DISPATCH ／ "Aline" Music Video ／ Directed | primary_official | https://www.annecyfestival.com/about/archives/2022/award-winners | 285428 | PASS (72f, hit=false) | OK |
| 18 | tier2_award | 3DCG/アニメ | R-T2-04 | `ke4kVFycpYY` | How did South African Apartheid happen, and how did  | primary_official | https://www.annecyfestival.com/en/archives/2024/the-festival/2024-awards | 1633840 | PASS (112f, hit=false) | OK |
| 19 | tier2_award | 3DCG/アニメ | R-T2-04 | `9acxn7qAST4` | Overwatch 2 Animated Short ／ “Kiriko” | primary_official | https://blog.siggraph.org/2023/08/take-in-the-show-stopping-animation-of-the-siggraph-2023-electronic-theater.html/ | 12403108 | PASS (147f, hit=false) | OK |
| 20 | tier2_award | 3DCG/アニメ | R-T2-04 | `5XwXliCK19Y` | The Beatles - I'm Only Sleeping | primary_official | https://www.annecyfestival.com/about/archives/2023/award-winners | 11297071 | PASS (68f, hit=false) | OK |
| 21 | tier2_award | 企業映像 | R-T2-05 | `-BNMlu1P1Cc` | The Broken Heart – Your Choices, Your Health, Your F | primary_official | https://winners.cannescorporate.com/single-entry/4212?award_id=10&category_id=86 | 11080 | PASS (65f, hit=false) | OK |
| 22 | tier2_award | 企業映像 | R-T2-05 | `LZ_ibd8XfJs` | What does a Good Life mean? // Emotional Employer Br | primary_official | https://winners.cannescorporate.com/single-entry/4020?award_id=12&category_id=159 | 688 | PASS (84f, hit=false) | OK |
| 23 | tier2_award | 企業映像 | R-T2-05 | `LgvVJkTeWBw` | Michelin, a matter of substance | primary_official | https://winners.cannescorporate.com/single-entry/3287?award_id=15&category_id=162 | 3659590 | PASS (89f, hit=false) | OK |
| 24 | tier2_award | 企業映像 | R-T2-05 | `GiKYGCz9EBI` | #من_الشدة_للرخاء - يوم التأسيس 2026م | primary_official | https://winners.cannescorporate.com/single-entry/5682?award_id=17&category_id=166 | 1087609 | PASS (73f, hit=false) | OK |
| 25 | non_tier2_pro | CM | R-PRO-04 | `sjURCaINARk` | テレビCM「待たずに、幸せ！篇 」30秒 | live_metadata | https://www.youtube.com/watch?v=sjURCaINARk | 29355 | PASS (30f, hit=false) | OK |
| 26 | non_tier2_pro | CM | R-PRO-04 | `t4nVyE0J9eo` | 【企業広告】TVCM　総合モビリティカンパニー 「みんなを喜ばせたい」篇 30秒 | live_metadata | https://www.youtube.com/watch?v=t4nVyE0J9eo | 13861913 | PASS (30f, hit=false) | OK |
| 27 | non_tier2_pro | CM | R-PRO-04 | `5jEJg-Sxl9U` | 【CIVIC】TVCM（WEB版）「風に、乗れ。」篇 30秒 | live_metadata | https://www.youtube.com/watch?v=5jEJg-Sxl9U | 1358924 | PASS (30f, hit=false) | OK |
| 28 | non_tier2_pro | CM | R-PRO-04 | `W796t4glQnU` | 【エルグランド】TVCM 「ELGRAND IS BACK」篇 30秒 | live_metadata | https://www.youtube.com/watch?v=W796t4glQnU | 266626 | PASS (30f, hit=false) | OK |
| 29 | non_tier2_pro | CM | R-PRO-04 | `xuMf1KZzMd8` | イエローハット 2025年テレビCM 30秒 | live_metadata | https://www.youtube.com/watch?v=xuMf1KZzMd8 | 110961 | PASS (30f, hit=false) | OK |
| 30 | non_tier2_pro | MV | R-PRO-02 | `Xvx1GvsOMdI` | 玉置浩二「ファンファーレ」MUSIC VIDEO(TBS系 日曜劇場『ザ・ロイヤルファミリー』主題歌) | live_metadata | https://www.youtube.com/watch?v=Xvx1GvsOMdI | 28465221 | PASS (79f, hit=false) | OK |
| 31 | non_tier2_pro | MV | R-PRO-02 | `P7bVX6fJfCg` | Omoinotake ／ 幾億光年 【Official Music Video】 | live_metadata | https://www.youtube.com/watch?v=P7bVX6fJfCg | 133162607 | PASS (92f, hit=false) | OK |
| 32 | non_tier2_pro | MV | R-PRO-02 | `m0lJzV55jKg` | arban「Spring Love」OFFICIAL MV | live_metadata | https://www.youtube.com/watch?v=m0lJzV55jKg | 1167552 | PASS (72f, hit=false) | OK |
| 33 | non_tier2_pro | MV | R-PRO-02 | `SZpiiixlHWY` | Tyla - IS IT (Official Music Video) | live_metadata | https://www.youtube.com/watch?v=SZpiiixlHWY | 60660893 | PASS (61f, hit=false) | OK |
| 34 | non_tier2_pro | MV | R-PRO-02 | `Wjew3Rc1PYI` | Rathinamo - Official Music Video ／ Saurav Srisan ／ T | live_metadata | https://www.youtube.com/watch?v=Wjew3Rc1PYI | 11827923 | PASS (67f, hit=false) | OK |
| 35 | non_tier2_pro | モーション | R-PRO-03 | `1rSz3x1x0Ew` | TRUSTART様 事業紹介動画｜モーショングラフィックス｜Unplug | live_metadata | https://www.youtube.com/watch?v=1rSz3x1x0Ew | 499 | PASS (52f, hit=false) | OK |
| 36 | non_tier2_pro | モーション | R-PRO-03 | `YlINk0vjtLg` | MCD3様 Designship2025告知動画｜モーショングラフィックス｜Unplug | live_metadata | https://www.youtube.com/watch?v=YlINk0vjtLg | 292 | PASS (16f, hit=false) | OK |
| 37 | non_tier2_pro | モーション | R-PRO-03 | `67UqYS-UsUI` | 【制作実績】HITOCREW様 サービスPRムービー(アニメーション動画) | live_metadata | https://www.youtube.com/watch?v=67UqYS-UsUI | 73 | PASS (40f, hit=false) | OK |
| 38 | non_tier2_pro | モーション | R-PRO-03 | `i70ijS4y6js` | 高知アニクリ祭2025 オープニングムービー│【スタジオエイトカラーズ】 | live_metadata | https://www.youtube.com/watch?v=i70ijS4y6js | 696 | PASS (52f, hit=false) | OK |
| 39 | non_tier2_pro | モーション | R-PRO-03 | `uTbgFqFA9GU` | Best SaaS Motion Graphics Product Launch Video for A | live_metadata | https://www.youtube.com/watch?v=uTbgFqFA9GU | 4269 | PASS (40f, hit=false) | OK |
| 40 | non_tier2_pro | 3DCG/アニメ | R-PRO-03 | `kdh0ucpJEH8` | TVアニメ「瑠璃の宝石」第２弾PV ｜ 2025年7月6日（日）より順次放送開始！ | live_metadata | https://www.youtube.com/watch?v=kdh0ucpJEH8 | 209570 | PASS (56f, hit=false) | OK |
| 41 | non_tier2_pro | 3DCG/アニメ | R-PRO-03 | `j5k7BgIqkI0` | TVアニメ『カラオケ行こ！』PV第2弾｜2025年7月24日（木）放送開始！ | live_metadata | https://www.youtube.com/watch?v=j5k7BgIqkI0 | 380531 | PASS (49f, hit=false) | OK |
| 42 | non_tier2_pro | 3DCG/アニメ | R-PRO-03 | `gcZXJ8cxDpM` | 【本PV vol.1】TVアニメ『ザ・ファブル』2024年4月6日(土)24:55より、日本テレビ系にて | live_metadata | https://www.youtube.com/watch?v=gcZXJ8cxDpM | 729173 | PASS (47f, hit=false) | OK |
| 43 | non_tier2_pro | 3DCG/アニメ | R-PRO-03 | `cmNtgMq5khQ` | 『最終楽章 響け！ユーフォニアム』後編 ファイナルPV | live_metadata | https://www.youtube.com/watch?v=cmNtgMq5khQ | 1123527 | PASS (72f, hit=false) | OK |
| 44 | non_tier2_pro | 3DCG/アニメ | R-PRO-03 | `aE0Eb23d6Dk` | TVアニメ「もめんたりー・リリィ」ティザーPV【2025年1月より放送予定】GoHands New An | live_metadata | https://www.youtube.com/watch?v=aE0Eb23d6Dk | 379310 | PASS (22f, hit=false) | OK |
| 45 | non_tier2_pro | 企業映像 | R-PRO-03 | `_sp_rADhJbI` | 【コンセプト動画】株式会社出前館様 採用動画【CINEMATO制作実績】 | live_metadata | https://www.youtube.com/watch?v=_sp_rADhJbI | 5489 | PASS (51f, hit=false) | OK |
| 46 | non_tier2_pro | 企業映像 | R-PRO-03 | `sEYd0PBAuo0` | 【AMR inc 制作実績動画】カタギ食品様 企業紹介動画 | live_metadata | https://www.youtube.com/watch?v=sEYd0PBAuo0 | 317 | PASS (71f, hit=false) | OK |
| 47 | non_tier2_pro | 企業映像 | R-PRO-03 | `MB5ZxJvIwUw` | 【企業プロモーションムービー】愛媛県四国中央市／井原工業株式会社／建設業 | live_metadata | https://www.youtube.com/watch?v=MB5ZxJvIwUw | 342 | PASS (42f, hit=false) | OK |
| 48 | non_tier2_pro | 企業映像 | R-PRO-03 | `qPZWGWxWPYs` | 株式会社RBadvance：プロモーションビデオ2020 | live_metadata | https://www.youtube.com/watch?v=qPZWGWxWPYs | 216 | PASS (62f, hit=false) | OK |
| 49 | non_tier2_pro | 企業映像 | R-PRO-03 | `FhhBAhJPUyE` | 制作事例　企業プロモーション映像　ジェネティックファクター美容　プリマポルタ 様　ＰＶ@PrimaPor | live_metadata | https://www.youtube.com/watch?v=FhhBAhJPUyE | 92 | PASS (53f, hit=false) | OK |
| 50 | non_tier2_low | CM | R-LOW-01 | `JBdhIf-49nc` | 【Aviutl練習がてら作ってみた】AviUtlのCMっぽいのを作ってみた | live_metadata | https://www.youtube.com/watch?v=JBdhIf-49nc | 1262 | PASS (22f, hit=false) | OK |
| 51 | non_tier2_low | CM | R-LOW-01 | `4bFPZNmx18o` | AviUtl初心者がAviUtlの30秒CM(?)作ってみた | live_metadata | https://www.youtube.com/watch?v=4bFPZNmx18o | 233 | PASS (31f, hit=false) | OK |
| 52 | non_tier2_low | CM | R-LOW-01 | `Ne9QqlYJJ24` | 主婦が無料ソフトでCM風動画作ってみた。 | live_metadata | https://www.youtube.com/watch?v=Ne9QqlYJJ24 | 67 | PASS (39f, hit=false) | OK |
| 53 | non_tier2_low | CM | R-LOW-02 | `0Ee4dRb1laM` | 商品紹介動画(Vyond練習用③) | live_metadata | https://www.youtube.com/watch?v=0Ee4dRb1laM | 32 | PASS (27f, hit=false) | OK |
| 54 | non_tier2_low | CM | R-LOW-01 | `94OoXKHO8mI` | Class Assignment - Graduate School Commercial | live_metadata | https://www.youtube.com/watch?v=94OoXKHO8mI | 22 | PASS (31f, hit=false) | OK |
| 55 | non_tier2_low | MV | R-LOW-01 | `Z1gGDaQWwdg` | 【MV風】初心者が一から制作！？ | live_metadata | https://www.youtube.com/watch?v=Z1gGDaQWwdg | 3345 | PASS (64f, hit=false) | OK |
| 56 | non_tier2_low | MV | R-LOW-01 | `Jyv8dO8XDEs` | 【オリジナル曲・MV】宝物/かぐや将軍　#オリジナル曲 #mv #cubase #作曲初心者 #lyri | live_metadata | https://www.youtube.com/watch?v=Jyv8dO8XDEs | 256 | PASS (67f, hit=false) | OK |
| 57 | non_tier2_low | MV | R-LOW-01 | `omQ99jeUujs` | 色々ド初心者が文化祭に向け作ったオリジナルMV | live_metadata | https://www.youtube.com/watch?v=omQ99jeUujs | 41 | PASS (52f, hit=false) | OK |
| 58 | non_tier2_low | MV | R-LOW-01 | `aV9CPYsqz9k` | 【オリジナル MV】つくってみた｜水の星｜歌ってみた　[何もかも超初心者] | live_metadata | https://www.youtube.com/watch?v=aV9CPYsqz9k | 112 | PASS (62f, hit=false) | OK |
| 59 | non_tier2_low | MV | R-LOW-01 | `Z0lN-XgQzlI` | Premiere Pro 初心者がプチMV作ってみた。オリジナル曲「うそつき」 | live_metadata | https://www.youtube.com/watch?v=Z0lN-XgQzlI | 178 | PASS (42f, hit=false) | OK |
| 60 | non_tier2_low | モーション | R-LOW-01 | `qQXsOOxsWgw` | 【aviutl】初心者が初めてのモーショングラフィックスを作ってみた。 | live_metadata | https://www.youtube.com/watch?v=qQXsOOxsWgw | 647 | PASS (24f, hit=false) | OK |
| 61 | non_tier2_low | モーション | R-LOW-01 | `PupfzrYviGc` | 【Capsule/Hello】超初心者のモーショングラフィックス練習【Aviutl】 | live_metadata | https://www.youtube.com/watch?v=PupfzrYviGc | 7510 | PASS (29f, hit=false) | OK |
| 62 | non_tier2_low | モーション | R-LOW-01 | `ZkQsrYzzG38` | 【AviUtl】モーショングラフィックスの練習 #1 | live_metadata | https://www.youtube.com/watch?v=ZkQsrYzzG38 | 20337 | PASS (37f, hit=false) | OK |
| 63 | non_tier2_low | モーション | R-LOW-01 | `bHbDA2R5EQ8` | 【AviUtl】初心者がモーショングラフィックスに初挑戦した件www【NCS - High】 | live_metadata | https://www.youtube.com/watch?v=bHbDA2R5EQ8 | 801 | PASS (40f, hit=false) | OK |
| 64 | non_tier2_low | モーション | R-LOW-01 | `oC1882y0IgA` | Learning After Effects – Day 1  My First Text Reveal | live_metadata | https://www.youtube.com/watch?v=oC1882y0IgA | 15 | PASS (39f, hit=false) | OK |
| 65 | non_tier2_low | 3DCG/アニメ | R-LOW-01 | `5AAcdVSxDdI` | My first animation made with Blender! Hope you like  | live_metadata | https://www.youtube.com/watch?v=5AAcdVSxDdI | 47 | PASS (31f, hit=false) | OK |
| 66 | non_tier2_low | 3DCG/アニメ | R-LOW-01 | `jjXPrOUXmZg` | My First Animation in Blender [beginner journey] | live_metadata | https://www.youtube.com/watch?v=jjXPrOUXmZg | 36 | PASS (60f, hit=false) | OK |
| 67 | non_tier2_low | 3DCG/アニメ | R-LOW-01 | `v-fCUQ1R51o` | Mundane monday - Blender 3.2 (EEVEE) and grease penc | live_metadata | https://www.youtube.com/watch?v=v-fCUQ1R51o | 278 | PASS (39f, hit=false) | OK |
| 68 | non_tier2_low | 3DCG/アニメ | R-LOW-01 | `KrCbjxKDY7Q` | Transformers test animation (Blender 3.4) | live_metadata | https://www.youtube.com/watch?v=KrCbjxKDY7Q | 3505 | PASS (21f, hit=false) | OK |
| 69 | non_tier2_low | 3DCG/アニメ | R-LOW-01 | `HaENcp4_4uY` | [Blender] Toy Story Woody Test Animation | live_metadata | https://www.youtube.com/watch?v=HaENcp4_4uY | 15691 | PASS (20f, hit=false) | OK |
| 70 | non_tier2_low | 企業映像 | R-LOW-03 | `nzmA4Gj5SrQ` | Website Webinar Recording (Intro): How to get a grea | live_metadata | https://www.youtube.com/watch?v=nzmA4Gj5SrQ | 29 | PASS (37f, hit=false) | OK |
| 71 | non_tier2_low | 企業映像 | R-LOW-02 | `qDHqAFdcxgw` | 【Vyond】サービス紹介動画 | live_metadata | https://www.youtube.com/watch?v=qDHqAFdcxgw | 83 | PASS (43f, hit=false) | OK |
| 72 | non_tier2_low | 企業映像 | R-LOW-02 | `u0h78N8hb8Y` | 営業支援サービス会社様向け紹介動画【サンプル動画】VYONDビジネスアニメーション | live_metadata | https://www.youtube.com/watch?v=u0h78N8hb8Y | 57 | PASS (64f, hit=false) | OK |
| 73 | non_tier2_low | 企業映像 | R-LOW-02 | `Z2eGGc9Z3CM` | 商品・サービス紹介 動画広告 30秒【サンプル動画】VYOND ビジネスアニメーション | live_metadata | https://www.youtube.com/watch?v=Z2eGGc9Z3CM | 190 | PASS (33f, hit=false) | OK |
| 74 | non_tier2_low | 企業映像 | R-LOW-02 | `a_C24dNnDQE` | VYONDで作る商品・サービス紹介アニメ」のサンプル｜services introduction ani | live_metadata | https://www.youtube.com/watch?v=a_C24dNnDQE | 276 | PASS (42f, hit=false) | OK |

## 2. Dev 追加分 全31本一覧

| # | 区分 | ジャンル | 規則ID | 動画ID | タイトル | 出典種別 | 出典URL | 再生数 | OCR結果 | 取得 |
|---:|---|---|---|---|---|---|---|---:|---|---|
| 1 | tier2_award | モーション | R-T2-03 | `D2J8YDIHhtY` | Rick & Morty Wormageddon ／ Golden Wolf | primary_official | https://motionawards.com/winners-2023.html | 1650 | PASS (60f, hit=false) | OK |
| 2 | tier2_award | モーション | R-T2-03 | `b1Izefj7Eag` | MURDER IN THE BELL TOWER ／ TV PROMO | primary_official | https://motionawards.com/winners-2024.html | 11 | PASS (45f, hit=false) | OK |
| 3 | tier2_award | モーション | R-T2-03 | `NmS3m0OG-Ug` | Severance - Official Intro Title Sequence  2022 / Cr | primary_official | https://www.televisionacademy.com/awards/nominees-winners/2022/outstanding-main-title-design | 2852071 | PASS (48f, hit=false) | OK |
| 4 | tier2_award | モーション | R-T2-03 | `8SWhBsbxmpk` | The Last of Us ／ Opening Credits ／ Max | primary_official | https://www.televisionacademy.com/awards/nominees-winners/2023/outstanding-main-title-design | 3572535 | PASS (46f, hit=false) | OK |
| 5 | tier2_award | モーション | R-T2-03 | `AJlOS6ZeIcA` | Silo — Opening Title Sequence ／ Apple TV | primary_official | https://www.televisionacademy.com/awards/nominees-winners/2024/outstanding-main-title-design | 572284 | PASS (51f, hit=false) | OK |
| 6 | non_tier2_pro | CM | R-PRO-04 | `GCdPC3gTBDs` | Fate/Grand Order「第2部 終章」告知TVCM 30秒ver. | live_metadata | https://www.youtube.com/watch?v=GCdPC3gTBDs | 11479425 | PASS (30f, hit=false) | OK |
| 7 | non_tier2_pro | CM | R-PRO-04 | `fBR8Wp2WF60` | TVCM『僕は知っている』篇30秒（2026年） | live_metadata | https://www.youtube.com/watch?v=fBR8Wp2WF60 | 691522 | PASS (30f, hit=false) | OK |
| 8 | non_tier2_pro | CM | R-PRO-04 | `xZ5DIjJOsgg` | テレビCM「ありがとう　だんだん篇」30秒 | live_metadata | https://www.youtube.com/watch?v=xZ5DIjJOsgg | 3131676 | PASS (30f, hit=false) | OK |
| 9 | non_tier2_pro | CM | R-PRO-04 | `u_lAdKpRp-8` | 日本メディアシステム TVCM｜「整ってますか」篇　30秒ver | live_metadata | https://www.youtube.com/watch?v=u_lAdKpRp-8 | 11344300 | PASS (33f, hit=false) | OK |
| 10 | non_tier2_pro | CM | R-PRO-04 | `aMWeNABISlg` | 【パズドラTVCM】「冬の青春」篇30秒 ✯ | live_metadata | https://www.youtube.com/watch?v=aMWeNABISlg | 3908 | PASS (32f, hit=false) | OK |
| 11 | non_tier2_pro | モーション | R-PRO-03 | `qtZPdgesJVk` | Commercial Video Ad Production: Rise Cola Campaign & | live_metadata | https://www.youtube.com/watch?v=qtZPdgesJVk | 55 | PASS (23f, hit=false) | OK |
| 12 | non_tier2_pro | モーション | R-PRO-03 | `5NsgViu8V0g` | TANKA様 サービス紹介動画｜モーショングラフィックス｜Unplug | live_metadata | https://www.youtube.com/watch?v=5NsgViu8V0g | 247 | PASS (53f, hit=false) | OK |
| 13 | non_tier2_pro | 3DCG/アニメ | R-PRO-03 | `QqLA-04V_uw` | TVアニメ『ワンダンス』　PV第1弾｜2025年10月より放送開始！ | live_metadata | https://www.youtube.com/watch?v=QqLA-04V_uw | 785099 | PASS (38f, hit=false) | OK |
| 14 | non_tier2_pro | 3DCG/アニメ | R-PRO-03 | `YT2Sh7sbZak` | 劇場アニメ『ひゃくえむ。』キャラクターPV【𝟗.𝟏𝟗(𝐅𝐫𝐢)公開】 | live_metadata | https://www.youtube.com/watch?v=YT2Sh7sbZak | 3269890 | PASS (38f, hit=false) | OK |
| 15 | non_tier2_pro | 3DCG/アニメ | R-PRO-03 | `hQjGJJ23BCE` | Gachiakuta Anime Series Teaser PV／Set for Release in | live_metadata | https://www.youtube.com/watch?v=hQjGJJ23BCE | 1006124 | PASS (35f, hit=false) | OK |
| 16 | non_tier2_pro | 企業映像 | R-PRO-03 | `OMFRjbG7aX8` | 【ブランディング動画】株式会社AIBJ 様　【CINEMATO制作実績】 | live_metadata | https://www.youtube.com/watch?v=OMFRjbG7aX8 | 673 | PASS (61f, hit=false) | OK |
| 17 | non_tier2_low | CM | R-LOW-01 | `zhRq3VuQZ_Q` | We, the Business Geeks. We made an ad as our class a | live_metadata | https://www.youtube.com/watch?v=zhRq3VuQZ_Q | 8 | PASS (49f, hit=false) | OK |
| 18 | non_tier2_low | CM | R-LOW-01 | `TYPrMMTbIE4` | American Apparel Commercial (advertising class assig | live_metadata | https://www.youtube.com/watch?v=TYPrMMTbIE4 | 1945 | PASS (25f, hit=false) | OK |
| 19 | non_tier2_low | CM | R-LOW-01 | `4iuLitLBhl8` | SHOE AD (Editing class assignment #5) | live_metadata | https://www.youtube.com/watch?v=4iuLitLBhl8 | 25 | PASS (38f, hit=false) | OK |
| 20 | non_tier2_low | MV | R-LOW-01 | `tGc4U3XeE_4` | 絵も音楽も初心者の僕がオリジナルMVを作ってみた「Labor」 | live_metadata | https://www.youtube.com/watch?v=tGc4U3XeE_4 | 186 | PASS (38f, hit=false) | OK |
| 21 | non_tier2_low | MV | R-LOW-01 | `q2412-rz1ts` | TRYD（オリジナル漫画のMV風映像）無謀、ギター初心者が作詞作曲して絵を描いてMV風動画にしてみた！ | live_metadata | https://www.youtube.com/watch?v=q2412-rz1ts | 102 | PASS (54f, hit=false) | OK |
| 22 | non_tier2_low | MV | R-LOW-01 | `Y6EztTVFX5M` | 【AviUtl】インドア系ならトラックメイカー 【MV 初心者が作ってみた】 | live_metadata | https://www.youtube.com/watch?v=Y6EztTVFX5M | 31157 | PASS (31f, hit=false) | OK |
| 23 | non_tier2_low | モーション | R-LOW-01 | `L1zAQoHoBUw` | My First Motion Graphics Edit | live_metadata | https://www.youtube.com/watch?v=L1zAQoHoBUw | 95 | PASS (25f, hit=false) | OK |
| 24 | non_tier2_low | モーション | R-LOW-01 | `dYqCocdxmZo` | My first motion graphics video | live_metadata | https://www.youtube.com/watch?v=dYqCocdxmZo | 21 | PASS (30f, hit=false) | OK |
| 25 | non_tier2_low | モーション | R-LOW-01 | `J4H5DFrB8cQ` | 初めて作ったAviutl動画 | live_metadata | https://www.youtube.com/watch?v=J4H5DFrB8cQ | 69 | PASS (37f, hit=false) | OK |
| 26 | non_tier2_low | 3DCG/アニメ | R-LOW-01 | `n8wefcKLOnY` | Blender Test Animation - Geoman | live_metadata | https://www.youtube.com/watch?v=n8wefcKLOnY | 1827 | PASS (39f, hit=false) | OK |
| 27 | non_tier2_low | 3DCG/アニメ | R-LOW-01 | `7ZA_8FKwgLY` | Kong Test Animation #2 (Blender) | live_metadata | https://www.youtube.com/watch?v=7ZA_8FKwgLY | 52970 | PASS (33f, hit=false) | OK |
| 28 | non_tier2_low | 3DCG/アニメ | R-LOW-01 | `3_c0l_p9dd8` | Test Blender Animation | live_metadata | https://www.youtube.com/watch?v=3_c0l_p9dd8 | 1279 | PASS (38f, hit=false) | OK |
| 29 | non_tier2_low | 企業映像 | R-LOW-02 | `CPeyrWJQi3U` | 事業内容紹介動画｜アニメーション｜VYOND | live_metadata | https://www.youtube.com/watch?v=CPeyrWJQi3U | 344 | PASS (54f, hit=false) | OK |
| 30 | non_tier2_low | 企業映像 | R-LOW-02 | `Fc63x0Bf6NY` | Why You Must Have A Website for Your Business | live_metadata | https://www.youtube.com/watch?v=Fc63x0Bf6NY | 46 | PASS (46f, hit=false) | OK |
| 31 | non_tier2_low | 企業映像 | R-LOW-02 | `DVKMAFQBBGk` | Announcement created with Powtoon | live_metadata | https://www.youtube.com/watch?v=DVKMAFQBBGk | 70 | PASS (46f, hit=false) | OK |

## 3. 除外・差し替え一覧および注記（全18本除外＋8本追加・差し替え）

- **Tier 2 CM 差し替え（2本）**:
  - `IVDpqih2KbI`（Bodyform Periodsomnia：自己申告サイト除外）→ いったん候補とした `8cnLzsAvVxU`（Honda MOVE 30秒）も ACC 登録尺60秒と不一致（`acc_registered_duration_mismatch_rule_1_8` で機械却下）のため除外 → **`nDI4TfI41FU`**（NIKE JAPAN 公式「完璧じゃなくていい。」、ACC 2024 フィルムクラフト部門ブロンズ `CF241461`、**登録尺 167秒＝実尺 167秒の完全一致**、85,122回）へ差し替え。
  - `jnzWdC90IbA`（ToyotaIndonesia「WILD MOMENT- Born To Run」30秒：日本公式登録5本との同一性が確認できなかったため除外）→ **`5G99rijm2AI`**（サントリー天然水「大自然を味方に」篇 60秒、ACC 2025 フィルムクラフト部門ゴールド `CF250991`、**登録尺 60秒＝実尺 60秒の完全一致**、3,559回）へ差し替え。
  - ほか `uH1PXkG8qD8`（Magnum：Film Craft Silver 一次裏付け未確認）・`9HpLhxMFJR8`（CoorDown：まとめサイト回避）を除外。
- **Tier 2 企業映像 差し替え（目的系3本＋OCR1本＋告知1本を除外 → Category D クラフト3本を追加）**: `Rs_NWwtBoks`（A.7 CSR）・`dRID0fo-2FQ`（A.15.c 観光）・`O1qBDmkRYL4`（A.1/Grand Prix）をルール1.2で `purpose_reference_only` へ移動、`y8oGkG0vuHw` をローカル OCR 賞ロゴ検知で自動除外、`kDFt3nL9qqY` を企画告知のため除外。新たに Category D Black Dolphin クラフト受賞3本（`LgvVJkTeWBw` Michelin Sound Design・`LZ_ibd8XfJs` Wernsing Editing・`GiKYGCz9EBI` Aramco Production Design）を追加し、既存の `-BNMlu1P1Cc`（Novo Nordisk Best Directing）と合わせ計4本（全4本別依頼主・Aramco重複なし）を確保。
- **Tier 2 MV・3DCG 厳格除外（2本）**: `JLQuHYNtQMI`（UKMVA 近接150文字超過）・`2P7E-K99cE0`（Annecy 本文ブロック近接未達）を除外。
- **R-PRO 除外・追加**: モーションから学生課題（`4CJEN2LNN-Q`）・架空自主制作（`EiaYW0tfHNY`）・制作会社記載なし（`ymLvrZMk51c`）の3本を除外し、Dev モーション補完として `5NsgViu8V0g`（Unplug「TANKA様 サービス紹介動画」）を追加。
- **R-LOW 除外・追加**: モーションから固定キーワード不一致3本（`ZY7IlAcqTDE`・`OK8GDW1Z7a8`・`IityDgK6x6w`）を除外し、Dev モーション補完として `J4H5DFrB8cQ`（「初めて作ったAviutl動画」38秒）を追加。YouTube 制限で止まっていた残り31本＋新規追加分はすべて未ログイン低速再試行（75〜105秒間隔）で取得・OCR 完了したため、取得不可による差し替えは `0本`。
- **構成上の注記（規則違反なし）**:
  - **同一スタジオ注記（モーション Tier 2・Dev/Holdout またぎ）**: Holdout のモーション Tier 2 5本のうち2本（`-15nbjw0IHU` OOHA、`OfCn09kBXXg` Weetabix）に加え、**Dev 追加分にも1本（`D2J8YDIHhtY` Rick & Morty Wormageddon）** があり、同一制作スタジオ（**Golden Wolf**）の作品がスタジオ単位で Dev と Holdout にまたがっています（別作品であり動画重複はなく規則違反ではありませんが、監査のため明記）。
  - **第三者チャンネル公開の注記**: Holdout Tier 2 のうち一部は第三者アーカイブチャンネルの公開版です（`ZFVtLHLN8aU` ScifinewsDE、`0PWmNDBWNz0`・`5G99rijm2AI` TV-CM JAPAN、`ev83o3hVoso` Good Ads Matter Selects）。なお `5G99rijm2AI`（サントリー天然水「大自然を味方に」篇 60秒）は 2026-11-23 時点でサントリー公式チャンネルに60秒版の公開がないことを確認したため、登録尺完全一致かつローカル RapidOCR v1.2.3 通過済（`award_badge_ocr_hit: false`）の本アップロードを採用しています。他の第三者公開版もすべてローカル OCR 通過済みです。

## 4. 凍結コミットに含める主要13ファイルの SHA-256

| ファイル | バイト数 | SHA-256 |
|---|---:|---|
| `docs/CALIBRATION_PHASE2_DESIGN.md` | 44412 | `199774458da9a89b7cc8fece3a86029fb83bdf972babbda2ab9b9a0f9c97dd0b` |
| `docs/PRO_BENCHMARK_RUBRIC.md` | 26705 | `f9b441095939047d985acee5c16c1ffe9cd8585f4f065b96fc6c981990bec6f7` |
| `analysis/phase2_holdout_v1.json` | 87020 | `d5b9bfba54cb8c4ace521b4b4ecc189fefafcf1428e9b839e5e7abfd30f2c10a` |
| `analysis/phase2_dev_additions_v1.json` | 34761 | `231e5ff2a136fc29455ea58f3e65510ac177b5951c73ed2a60b114b5665c760b` |
| `analysis/phase2_candidates_verified.json` | 112052 | `fb3fc4e64531f3da081149beb4ad4cc4923abedca8d53eaeacfba61b9ab1c298` |
| `analysis/phase2_source_verification_report.json` | 57828 | `e0ff6af85288cc070ec10cbfdf50e9727ad2e9700b79220c355e4aca2fa88b82` |
| `analysis/phase2_ocr_precheck_log.jsonl` | 80993 | `4988b96bd2102e237578567ec059a2d24546296eb2de00575cf2bc59781f01fc` |
| `analysis/phase2_purpose_reference_moved.json` | 6039 | `e54bffb0942e133f66333065ef04b7ab9ad8dc6249f5d79a344fa64ba8dc035c` |
| `analysis/cannes_corporate_categories_snapshot_2026-11-23.json` | 8138 | `bf02a86ea6aada6f794fe3d108c7a150ea5583937b851528a47b49059e9e350e` |
| `scripts/validate-phase2-dataset.mjs` | 12595 | `abde4d77cdab4df577471a1c772240384e9c884d01fdb1860d4dc27be94a6936` |
| `scripts/verify-phase2-sources.mjs` | 18075 | `732a1671cddb937657a062303e69940a9c81de86272d041a41798dea35e51c9d` |
| `scripts/verify-phase2-sources.test.mjs` | 5242 | `13e118581354a109c6ea230b3936097231ab34a23eb7753cf81f23ae21b92625` |
| `scripts/slow_retry_precheck_ocr.py` | 6299 | `7bc24ded5f20b3ef2e0946fe945699d9dd9f6ba25bd8f6ecdeccb485930e38d6` |
