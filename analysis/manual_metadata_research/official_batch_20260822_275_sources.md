# 公式根拠台帳 — バッチ275

確認日: 2026-08-22

対象は投稿元名が明示されたVimeoの未手動調査候補10件です。Vimeo公開oEmbedの投稿元・説明欄に明示された情報だけを保存します。

| 動画ID | 作品・投稿元 | 公開説明欄の根拠 | 保存方針 |
|---|---|---|---|
| `1069311388` | 'See it Differently' - Britbox / Blink | [Vimeo](https://vimeo.com/1069311388) の投稿元はBlinkだが、公開説明欄は空欄。 | 投稿元・タイトルだけでは商材・用途・制作役割を確定できないため、既存値を維持し`confirmed`とする。 |
| `1067426859` | Behind the Scenes - 'See it Differently' - Britbox / Blink | [Vimeo](https://vimeo.com/1067426859) の投稿元はBlinkだが、公開説明欄は空欄。 | 投稿元・タイトルだけでは商材・用途・制作役割を確定できないため、既存値を維持し`confirmed`とする。 |
| `1062016330` | Jota - reel 2025 / Juan Manuel Isola | [Vimeo](https://vimeo.com/1062016330) に作者自身の新しい3D artist reelであることを明記。 | 表現`3D`、制作（Juan Manuel Isola）を映像制作役割として補完する。メールアドレス・SNSリンクは保存しない。 |
| `105628386` | Tokyo Designers Week 2014 / Airside Nippon | [Vimeo](https://vimeo.com/105628386) にAirside Nipponの監督、Haruna SakaiのDesign & Animationを明記。 | 表現`アニメーション`、制作（Airside Nippon・Haruna Sakai）を役割別に補完する。音楽は保存しない。 |
| `1055994596` | Beats Powerbeats Pro 2 / FutureDeluxe | [Vimeo](https://vimeo.com/1055994596) の投稿元はFutureDeluxeだが、公開説明欄は空欄。 | 投稿元・タイトルだけでは商材・用途・制作役割を確定できないため、既存値を維持し`confirmed`とする。 |
| `1049880661` | 三井不動産株式会社 採用コンセプトムービー / 不明 | [Vimeo](https://vimeo.com/1049880661) は公開oEmbedがHTTP 404となり、投稿元・説明欄・クレジット・公開性を確認できない。 | 一次根拠を追加確認できないため`held`とする。人物・会社名でない無効な既存制作タグ`不明`のみ削除し、その他の既存値は維持する。 |
| `1046889896` | Powell Lacrosse \| Brand ID / Bemo | [Vimeo](https://vimeo.com/1046889896) にPowell Lacrosseの30秒Brand Ident、NLL・ESPNでの放送、Bemoによる2D・3D・手描きセルアニメーション、VFXと実写の組み合わせ、役割別クレジットを明記。 | 用途`ブランディングムービー`、表現`2D`・`3D`・`アニメーション`・`実写+アニメーション`、制作（Bemo・Brandon Hirzel・Alessandra Serrano・Rúben Almeida・Juan Andrés Molteno・Jacob Torres・Hugo Hors・Ricardo Van Es）を役割別に補完する。既存の商材`スポーツ / 健康 / フィットネス`は維持する。音響は保存しない。 |
| `1040121603` | AI ADS - Travel / Hippie House Studio | [Vimeo](https://vimeo.com/1040121603) にHippie House Studioの個人プロジェクト、AI生成フッテージとモーショングラフィックス／タイポグラフィアニメーションの組み合わせ、Travel等3テーマでの制作を明記。 | 商材に該当しない既存（IT / 通信 / ネットサービス、旅行 / 宿泊）を削除し、用途`アート`、表現`生成AI`・`アニメーション`、制作（Hippie House Studio）を役割別に補完する。 |
| `1032202784` | Node Fest 2024 / Never Sit Still | [Vimeo](https://vimeo.com/1032202784) にNode Fest 2024のopening titles、Never Sit Stillがアニメーションスタジオとして制作、2D・3Dアニメーション等の役割別クレジットを明記。 | 既存の用途`OPED`を維持し、商材に該当しない既存`IT / 通信 / ネットサービス`を削除、表現`2D`・`3D`・`アニメーション`、制作（Never Sit Still・Mike Tosetto・Sharon Lim・Zoe Crocker・Jonathan Puiほか）を役割別に補完する。音楽・演奏は保存しない。 |
| `103212033` | ADK New CI Movie 2014 / 1→10 | [Vimeo](https://vimeo.com/103212033) の投稿元は1→10だが、公開説明欄は空欄。 | 投稿元・タイトルだけでは商材・用途・制作役割を確定できないため、既存値を維持し`confirmed`とする。 |

## 保存ルール

- 保存日時は `2026-08-22`、根拠種別は `official_vimeo_description` とする。
- 制作タグは人物名・会社名に限定し、役割は `productionCredits.roles` に分離する。
- 音楽・音響等、映像制作の検索に不要な役割は制作タグ・クレジットへ保存しない。
