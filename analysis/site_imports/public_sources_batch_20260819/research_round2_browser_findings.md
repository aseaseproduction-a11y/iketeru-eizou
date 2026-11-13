# 指定サイト再調査（ブラウザ確認）

調査日: 2026-08-20 JST

以下は、ユーザー指定URLを公開状態で確認した時点の事実である。登録候補は後続工程で動画ID・正規URL・タイトルの三重照合、公開性、既存DB重複を通過したものに限定する。

| 掲載元 | URL | 確認結果 | 登録判断に必要な補足 |
|---|---|---|---|
| BB-NAVI | https://www.bb-navi.com/cm-douga/index-news.html | 公開ページ。CM作品名、作品説明、公式YouTubeチャンネル名の記載と出演者別ページ導線を確認。 | 一覧には個別のYouTube ID/URLが直接現れないため、公式動画URLを別途照合する必要がある。 |
| BOVA | https://awardg.sendenkaigi.com/bova | 公開ページ。過去受賞作一覧 `https://awardg.sendenkaigi.com/bova/history` への導線と、YouTube埋め込みURL `https://www.youtube.com/embed/8oPGJuZByzg` を確認。 | 過去受賞作は詳細一覧で外部URLと照合する。 |
| Creshore | https://creshore.jp/home#/ | ログイン画面へ遷移し、未ログインで動画一覧は閲覧不可。 | 新規会員登録・ログインが必要。公開範囲の動画候補なし。 |
| Video Refs | https://video-refs.com/ | 公開一覧。YouTube URLを直接表示。例: `8BxKB-kY570`、`oVNz-tLAwfI`、`YdkBLUwksrQ`、`sD7_6en5xxQ`。 | 既存登録と公開性を再照合し、重複のみ除外する。 |
| 動画NOW | https://douganow.jp/#google_vignette | 公開ページ。公式チャンネルで公開済みとの記事を表示。 | 記事詳細から公式YouTube URLを取得して照合する。 |
| ONE MEDIA | https://www.onemedia.jp/ | 公開公式サイト。Works詳細ページ導線と、トップ上の自社mp4 URL 2件を確認。 | mp4直リンクはタイトルとの一対一対応をWorks詳細で確認してから登録する。TikTok事例は外部正規URLが確認できるもののみ対象。 |
| REClike MotionGraphics_2D | https://reclike.com/l/s21cf | 公開リスト（329件）。YouTube/Vimeo動画詳細への導線を確認。例: `PH_3XBd_C9M`、Vimeo `50572971`、`5324878`、`36889665`。 | リスト掲載を出典とし、各外部動画の公開性・タイトル・既存重複を照合する。 |
| REClike MOTION COMIC | https://reclike.com/l/stwNM | 公開リスト（37件）。YouTube詳細導線を確認。例: `swq--rdN-2k`、`S6-KDUOTkNo`、`pCDiE2WihKE`、`trel5T03ajY`、`O8czN6GUqHw`。 | 公式アップロードかつ公開のものを対象にする。 |
| REClike ライブ演出 | https://reclike.com/l/5floC | 公開リスト（1件）。YouTube ID `g8NbvGE8w6s`、タイトル「花譜 #69『まほう feat.理芽』【オリジナルMV『不可解弐Q1』Live Ver.】」を確認。 | 正規YouTube URLと既存重複を照合する。 |
| REClike independent animation | https://reclike.com/l/WoA4q | 公開リスト（8件）。例: `rtcH5k2-fLM`、`XPgcC9Wamtw`、`u7arpOmVMqw`。 | 外部動画の公開性と既存重複を照合する。 |
| REClike Drawing_animation | https://reclike.com/l/XZP5b | 公開リスト（21件）。例: `H6QFLov4WUA`、`XoBzp0CvJ50`、`iNMxn8Ib6jI`、Vimeo `92712103`。 | 外部動画の公開性と既存重複を照合する。 |
| REClike Photorealistic | https://reclike.com/l/ZBmfR | 公開リスト（15件）。例: `lBy4XBv48wU`、`DDsRfbfnC_A`、`J3ue35ago3Y`、`QmLBz4FuVDA`、Vimeo `92712103`。 | 外部動画の公開性と既存重複を照合する。 |
| REClike introduction_product | https://reclike.com/l/q7U1A | 公開リスト（31件）。例: Vimeo `93201564`、YouTube `CqbZiYoOfRA`、Vimeo `160734113`。 | 外部動画の公開性と既存重複を照合する。 |
| REClike 実写/シネマ | https://reclike.com/l/yB7jA | 公開リスト（24件）。例: `kOHB85vDuow`、`iBDnRK9ACTY`、`xaI-_TfJOeQ`、`JUJ3Pq74H4c`、`QD5nlibg2aw`。 | 外部動画の公開性と既存重複を照合する。 |
| REClike ONE TAKE | https://reclike.com/l/kov7h | 公開リスト（6件）。例: `VXoycAM-3QM`、`EN9auBn6Jys`、`vS6wzjpCvec`。 | 外部動画の公開性と既存重複を照合する。 |

## 注意事項

- REClikeは公開リストであっても、外部動画が削除・非公開・権利制限されている可能性があるため、掲載だけでは登録確定にしない。
- Creshoreは未ログイン状態で動画候補を取得できない。認証済み範囲を扱う場合はユーザー操作が必要となる。
- BB-NAVI、動画NOW、ONE MEDIAの一覧・記事・Worksでは、掲載作品名と外部動画URLの対応を公式ページまたは公開oEmbedで確認してから登録する。

## 追記: 個別ページ・埋め込み再照合（2026-08-20）

### Creshore

- My Browserのログイン済みセッションで `https://creshore.jp/home#/` を確認した。初期表示後に投稿カードが読み込まれ、クリショアStaff Picks、新着動画、制作年順の各一覧から個別投稿へ遷移可能であることを確認した。
- 一覧には「キュレル｜衣料用柔軟剤」「JINS - JINS 360°」「L'Oréal MAYBELLNE」「ツクリオ」「mineoクイズショー 春のマイネオ割 30sec」等の作品タイトル、制作者表示、サムネイル、再生ボタンが掲載される。
- 各カードの実際の外部動画ID・埋め込みURLは一覧HTMLでは取得できないため、次工程では個別カードの詳細表示・埋め込みプレーヤーから動画URLを一件ずつ取得し、公開再生・ID/URL/タイトル照合を行う。ログイン済み一覧に表示されるだけでは登録しない。

### BB-NAVI

- 出演者別詳細 `https://www.bb-navi.com/cm-douga/yoshizawaryo.html` を確認した。個別CMの掲載タイトル、商品名、CM説明、更新日、公式チャンネル名の記載と、ページ内再生対応の表示を確認した。
- ただし、当該ページの各CM欄にはYouTube/Vimeoの正規URL・動画ID・iframe埋め込み・外部動画詳細への個別導線が掲載されていない。掲載タイトルから外部動画を推測対応させず、公式動画URLがBB-NAVI内または広告主公式ページで一対一に確認できるものだけを登録対象とする。

### ONE MEDIAの投稿元公式アカウント

- ONE MEDIA Works「ゴキッシュ スッ、スゴい！」に明示されたアース製薬TikTok公式アカウント `@earthofficialjp` を確認した。プロフィールには「公式です！」および `www.earth.jp` への導線があり、投稿元アカウントがアース製薬公式であることは確認できた。
- 同Worksに掲載された投稿 `https://www.tiktok.com/@earthofficialjp/video/7358773868351196417` を直接確認したが、TikTok上では「動画は現在ご利用できません」と表示された。従って、当該投稿は公開再生・投稿タイトルの照合が成立せず登録しない。
- 他のONE MEDIA掲載TikTok候補も、投稿元公式性、直接URLの閲覧可否、投稿タイトルの三条件を個別に満たす場合だけを登録対象とする。

## 追記: REClike・Vimeo Likeの公開確認

| 掲載元 | URL | 確認結果 | 登録判断に必要な補足 |
|---|---|---|---|
| REClike Osmo | https://reclike.com/l/3UQCi | 公開リスト（19件）。例: Vimeo `144587558`、YouTube `VXoycAM-3QM`、`C9WRe2h7dWw`。 | 外部動画の公開性と既存重複を照合する。 |
| REClike 360° | https://reclike.com/l/eSrYD | 公開リスト（10件）。例: `dEYQCZ1zSmQ`、`x3dhMxf7-QM`、Vimeo `205288184`。 | 外部動画の公開性と既存重複を照合する。 |
| REClike goodLook | https://reclike.com/l/pC5a6 | 公開リスト（131件）。例: `llje-FhGktY`、`toR7LIGVj0Q`、`jIH2X4ypMU4`、Vimeo `123234937`。 | 外部動画の公開性と既存重複を照合する。 |
| REClike MotionGraphics_3D | https://reclike.com/l/cfFvX | 公開リスト（144件）。例: `iUS3WBxx_Ww`、Vimeo `433532815`、`9a239ZI3iYI`、Vimeo `436055990`。 | 外部動画の公開性と既存重複を照合する。 |
| Vimeo karekitsune Likes | https://vimeo.com/karekitsune/likes | 公開Likeページ（1,814 Likes）だが、初期HTMLには作品カードが現れずRSS導線のみ確認。 | 公開RSSまたはページングで個別Vimeo ID・タイトルを取得してから照合する。 |
| Vimeo taker Likes | https://vimeo.com/taker/likes | 公開Likeページ（37 Likes）だが、初期HTMLには作品カードが現れずRSS導線のみ確認。 | 公開RSSまたはページングで個別Vimeo ID・タイトルを取得してから照合する。 |
| Vimeo user10086421 Likes | https://vimeo.com/user10086421/likes | 公開Like一覧。例: Vimeo `768475858`、`756446904`、`545934303`、`357088764`、`540604030`。 | 各Vimeo動画の公開性・既存重複を照合する。 |
| 白田英輔公式サイト | https://shirotaeisuke.com/ | 公開ポートフォリオ。CM・MV中心の活動プロフィールと受賞歴を確認。 | 既存9件登録済みのため、追加候補は詳細ページの外部動画URLと照合する。 |
| Vimeo shirotaeisuke Likes | https://vimeo.com/shirotaeisuke/likes | 公開Like一覧。例: Vimeo `898073746`、`253892735`、`702004093`、`820892498`、`192648962`。 | 各Vimeo動画の公開性・既存重複を照合する。 |
| Vimeo cubezeero Likes | https://vimeo.com/cubezeero/likes | 公開Likeページ（2,374 Likes）だが、初期HTMLには作品カードが現れずRSS導線のみ確認。 | 公開RSSまたはページングで個別Vimeo ID・タイトルを取得してから照合する。 |
| Vimeo tkmk Likes | https://vimeo.com/tkmk/likes | 公開Likeページ（523 Likes）だが、初期HTMLには作品カードが現れずRSS導線のみ確認。 | 公開RSSまたはページングで個別Vimeo ID・タイトルを取得してから照合する。 |
