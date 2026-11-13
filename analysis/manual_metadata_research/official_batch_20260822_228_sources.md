# 公式根拠台帳 — バッチ228

確認日: 2026-08-22

対象は、投稿元名が明示されたVimeoの未手動調査候補10件です。Vimeo公開oEmbedの投稿元・説明欄に明示された情報だけを保存します。

| 動画ID | 作品・投稿元 | 公開説明欄の根拠 | 保存・確認方針 |
|---|---|---|---|
| `878152560` | NTT Action Compass / Kaito Mizuno | [Vimeo](https://vimeo.com/878152560) にProducer: Taro Mikami (CEKAI)、Motion Design: Kaito Mizunoと明記。 | 制作Taro Mikami・Kaito Mizunoを役割別に補完する。サウンド担当は保存しない。説明欄に分類根拠がないため用途・表現は未入力維持。 |
| `875825150` | LTW_BRAND_MOVIE_JP / LTW | [Vimeo](https://vimeo.com/875825150) の限定公開URLは投稿元LTW・作品タイトル・既存動画IDが一致するが、公開説明欄は空。 | 投稿者・作品同一性を確認済みとして記録し、既存の用途・表現・LIGHT THE WAY Inc.・西澤 岳彦は変更しない。 |
| `873227804` | CEKAI SUMMER CAMP — 夏休みの映像日記をつくろう！編 / CEKAI | [Vimeo](https://vimeo.com/873227804) に子どもたちが夏休みをテーマに短編映像を制作したプログラムの説明があるが、当該映像の制作者・形式別クレジットは明示しない。 | 投稿元・作品同一性を確認済みとして記録する。既存分類を変更せず、制作者を推測保存しない。 |
| `872770998` | Amazon 季節先取りセール 2023Q3 / SUNJUNJIE | [Vimeo](https://vimeo.com/872770998) にArt direction and CGI production: SUNJUNJIE、CG design assistant: Kosei Yoneda、GEEK PICTURES INC. Produce: Teruki Murakami、Direction: Ichiro Komiya、Project management: Takahiro Kawamoto・Takuma Konishi、Client: Amazon Japanと明記。 | 既存の用途・表現・制作者表記を保持し、映像制作クレジットと役割を構造化する。音楽担当・クライアントは制作タグに保存しない。 |
| `87130088` | Westinghouse *Spec* / Chris Anderson | [Vimeo](https://vimeo.com/87130088) の投稿タイトルが`*Spec*`と明示する一方、説明欄は空で、Westinghouseの公式作品・権利者との関係を確認できない。 | 非公式の可能性を推測で補わず`held`として記録し、既存未入力を維持する。 |
| `864291204` | Peloton — Global Campaign Film — Fall/Autumn 2023 / Stink Studios | [Vimeo](https://vimeo.com/864291204) はStink Studios投稿だが、公開説明欄は空。 | 投稿元・作品同一性を確認済みとして記録し、既存の用途・Stink Studios以外の分類・制作値は追加しない。 |
| `86310035` | MaxCooper — Impacts / Dmitry Zakharov | [Vimeo](https://vimeo.com/86310035) に本人のコンセプト・デザイン説明と、3D animation、fluid simulation、post effectsを明記。 | 用途`アート`、表現`3D`・`アニメーション`、制作Dmitry Zakharov（デザイン・アニメーション）を補完する。音楽家名は映像制作クレジットとして保存しない。 |
| `861153826` | Playgrounds In Motion — 2023 Opening Titles / Erwin van den IJssel | [Vimeo](https://vimeo.com/861153826) に新フェスティバルのopening titles、Director: Erwin van den IJssel、Additional Animation: Hugo Morais・Kanso Ogboluと明記。 | 用途`OPED`、表現`アニメーション`、制作Erwin van den IJssel・Hugo Morais・Kanso Ogboluを補完する。クライアント・音楽担当は保存しない。 |
| `860759127` | 塩野香料 Brand movie / SHINICHI TAKAMURA | 元の限定公開URLに対する[Vimeo oEmbed](https://vimeo.com/860759127/6456c28c42?share=copy) はHTTP 200で、投稿元SHINICHI TAKAMURA・作品タイトル・既存動画IDが一致するが、公開説明欄は空。 | 投稿者・作品同一性を確認済みとして記録し、既存の用途・表現・髙村 伸一は変更しない。 |
| `85556391` | Statuspage / ILLO | [Vimeo](https://vimeo.com/85556391) にStatuspage.ioのサービス紹介動画、CLIENT: Statuspage.io、DIRECTION: Ilenoliukgo、DESIGN: Ilenia Notarangelo、ANIMATION: Matteo Ruffinengo・Ilenia Notarangelo・Luca Gonnelliと明記。投稿説明の`we`はILLOが映像制作に関与することを示す。 | 商材`IT / 通信 / ネットサービス`、用途`事業・サービス紹介`、表現`アニメーション`・`イラスト`、制作ILLOおよび明示クレジットを補完する。 |

## 保存ルール

- 保存日時は `2026-08-22`、根拠種別は `official_vimeo_description` とする。
- 制作タグは人物名・会社名に限定し、役割は `productionCredits.roles` に分離する。
- 音楽担当・クライアント・投稿元名だけで映像制作への関与を裏付けられない値は保存しない。
- 全10件で投稿者・作品同一性を確認する。値を追加する5件は`updated`、説明欄が不足する4件は`confirmed`、非公式の可能性を確認した1件は`held`と記録する。
