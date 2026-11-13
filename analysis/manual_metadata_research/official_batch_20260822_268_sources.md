# 公式根拠台帳 — バッチ268

確認日: 2026-08-22

対象は投稿元名が明示されたVimeoの未手動調査候補10件です。Vimeo公開oEmbedの投稿元・説明欄に明示された情報だけを保存します。

| 動画ID | 作品・投稿元 | 公開説明欄の根拠 | 保存方針 |
|---|---|---|---|
| `147440310` | URBAN RESEARCH 2015 Autumn / Winter Collection "THE SEVEN" / CEKAI | [Vimeo](https://vimeo.com/147440310) の投稿元はCEKAIだが、公開説明欄は空欄。 | 投稿者名だけでは当該作品への制作関与、固定分類、役割を確認できないため、既存値を維持し`confirmed`とする。 |
| `145927299` | Testing DJI OSMO ~ Times Square NY / STLL STUDIOS | [Vimeo](https://vimeo.com/145927299) に、購入直後のDJI Osmoテストであり、各プロジェクトのB-roll用途で購入した機材の試験と明記。 | 個人機材テストであり、登録作品としての公式性・映像制作クレジットを確認できないため`held`とする。 |
| `145836531` | SISSI RADA - SUNDAY / SCHNELLE BUNTE BILDER | [Vimeo](https://vimeo.com/145836531) にmusic video、Microsoft Kinect 2で撮影した40超の3D-recordings、VVVVによるparticle-aesthetic、Cinema4D・After Effects処理を明記。投稿元のSCHNELLE BUNTE BILDERは本文中のweとして制作工程を記載。 | 商材`娯楽 / アミューズメント`、用途`MV`、表現`3D`・`アニメーション`、制作（SCHNELLE BUNTE BILDER）を映像制作役割として補完する。音楽家の歌唱・演奏は保存しない。 |
| `144526368` | DJI Osmo First test / Dale McCready | [Vimeo](https://vimeo.com/144526368) に、新しいDJI OsmoとX3カメラでの短い散歩テスト、撮影設定の試行であると明記。 | 個人機材テストであり、登録作品としての用途・制作クレジットの根拠がないため`held`とする。 |
| `143468503` | Young Juvenile Youth 'Animation' / Kosai Sekine | [Vimeo](https://vimeo.com/143468503) にYoung Juvenile Youthのmusic video、監督Kosai Sekine、プロデューサーToshiyuki Takei・Kazunari Hujie、撮影Senzo Ueno、美術Tateo Yanagimachi、Flat CG Toru Hayai、編集Ryuichi Hasegawa、Frame Artist Hitoshi Kimura、Production Taiyo Kikaku、Post Production BOOKを明記。 | 商材`娯楽 / アミューズメント`、用途`MV`、制作を役割別に補完する。固定表現カテゴリは説明欄で明示されないため追加しない。音楽・ヘアメイク・機材・音響は保存しない。 |
| `140267871` | MTV GENERIC TITLES PACKAGE "HYPER FANTASTICS" / WOW inc. | [Vimeo](https://vimeo.com/140267871) に、MTV特番用オープニング、バンパー、エンディング、カウントダウンをWOWが企画・演出・制作したこと、監督Daihei Shibata、プロデューサーYasuaki Matsui、撮影Daisuke Oki、照明Takuma Saeki、production WOWを明記。 | 商材`娯楽 / アミューズメント`、用途`OPED`、制作（WOW inc.・Daihei Shibata・Yasuaki Matsui・Daisuke Oki・Takuma Saeki）を役割別に補完する。固定表現カテゴリは本文で明示されないため追加しない。 |
| `138942873` | PLAY / Hiromu Oka | [Vimeo](https://vimeo.com/138942873) の説明欄にはAfter Effects、Cinema 4Dというソフト名だけがある。 | 固定分類・映像制作役割を確認できないため、既存値を維持し`confirmed`とする。 |
| `137197579` | 2015 F/W SHOOPEN B/W Version / vivr | [Vimeo](https://vimeo.com/137197579) に2015 F/W SHOOPEN Shop videoであり、vivrのRoleはDirection / Design / animationと明記。 | 商材`ファッション / アパレル`、用途`プロモーション`、表現`アニメーション`、制作（vivr）を役割別に補完する。 |
| `134832670` | L'Œil du Cyclone / masanobu hiraoka | [Vimeo](https://vimeo.com/134832670) にEZ3kielのVideo clip、Masanobu HiraokaのDirector and animationを明記。 | 商材`娯楽 / アミューズメント`、用途`MV`、表現`アニメーション`、制作（Masanobu Hiraoka）を役割別に補完する。 |
| `133396066` | Embroidered Zoetrope / Elliot Schultz | [Vimeo](https://vimeo.com/133396066) に、ANU School of Artの2013年degree project、刺繍ディスクとストロボを同期させ物理的にアニメーションを体験させる作品であることを明記。 | 自己投稿の学位作品として制作目的・工程が明示されているため、用途`アート`、表現`アニメーション`、制作（Elliot Schultz）を映像制作役割として補完する。音楽は保存しない。 |

## 保存ルール

- 保存日時は `2026-08-22`、根拠種別は `official_vimeo_description` とする。
- 制作タグは人物名・会社名に限定し、役割は `productionCredits.roles` に分離する。
- 音楽・音響等、映像制作の検索に不要な役割は制作タグ・クレジットへ保存しない。
