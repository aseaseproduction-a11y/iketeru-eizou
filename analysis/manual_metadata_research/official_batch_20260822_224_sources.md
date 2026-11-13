# 公式根拠台帳 — バッチ224

確認日: 2026-08-22

対象は、`metadataClassificationAudit.manualResearch` が未設定のVimeo動画から、投稿元名が表示されている10件を抽出したものです。Vimeoの公開oEmbed説明欄・投稿元表示を一次公開情報として扱い、説明欄に明示された分類・映像制作クレジットだけを保存対象としました。

| 動画ID | 作品・投稿元 | 一次根拠 | 保存・保留方針 |
|---|---|---|---|
| `99898665` | 雨音の由来 / tha | [Vimeo](https://vimeo.com/99898665) の説明欄に「NHKの『テクネ 映像の教室の中』で放送」「仮説を検証する映像」と記載。`tha.jp`へのリンクも明示。 | 用途に`企画系`を補完する。投稿元名だけでは映像制作の役割を断定せず、制作タグは未入力を維持する。 |
| `99872019` | We Got Your Back / Viktor Hertz | [Vimeo](https://vimeo.com/99872019) の作者説明欄に Written & directed: Viktor Hertz、Produced & cinematography: Johann Gustavsson、Edited: Viktor Hertz & Johann Gustavsson と明記。 | 主要映像制作クレジットを構造化して補完する。音声・出演者は映像制作フィルターの対象外のため保存しない。 |
| `998498858` | SHIBUYA DOGENZAKA FLAG Signage — Matsumoto Kiyoshi / EDP graphic works Co.,Ltd. | [Vimeo](https://vimeo.com/998498858) の説明欄に Producer: 土井伸晃 (THREE CHORDS Inc.)、Creative Director: 前田光朝 (EDP graphic works Co.,Ltd.)、Director: 佐藤広基 (EDP graphic works Co.,Ltd.) と明記。 | 既存の略称`EDP`を公式表記へ置換し、人物・会社と構造化役割を補完する。 |
| `993382821` | EYETALK / 株式会社ナナメ | [Vimeo](https://vimeo.com/993382821) の投稿元は株式会社ナナメだが、公開説明欄に追加の分類・クレジット記載はない。 | 既存分類・制作タグを変更せず、投稿元を確認済みとして記録する。 |
| `98910710` | Tokyo Jazz : Visual Design + Branding / JKD Collective | [Vimeo](https://vimeo.com/98910710) の説明欄に、Tokyo Jazzのブランディング／ビジュアルデザイン、Design Agency / Production: JKD Collective + Oryel、Art Director / Designers: Koichi Inoue, Chikako Nakashima、Producer: Bruce Ikeda、Creator of Promotion Video: Shane Lester と明記。 | 商材`エンターテインメント`、用途`ブランディングムービー`・`プロモーション`、主要映像制作クレジットを補完する。音楽担当は保存しない。 |
| `98834333` | Mekaku City Actors CM Kano Spanish Fandub / Mekakushi-dan Spain | [Vimeo](https://vimeo.com/98834333) のタイトルに Spanish Fandub、説明欄に投稿者による声優紹介のみを記載。 | 非公式ファンダブであり原作品の公式・制作者本人根拠ではないため、未入力を保ったまま保留する。 |
| `98834462` | Mekaku City Actors CM Hibiya Spanish Fandub / Mekakushi-dan Spain | [Vimeo](https://vimeo.com/98834462) のタイトルに Spanish Fandub、説明欄に声優紹介のみを記載。 | 非公式ファンダブとして保留する。 |
| `98834555` | Mekaku City Actors CM Seto Spanish Fandub / Mekakushi-dan Spain | [Vimeo](https://vimeo.com/98834555) のタイトルに Spanish Fandub、説明欄に声優紹介のみを記載。 | 非公式ファンダブとして保留する。 |
| `98835535` | Mekaku City Actors CM Shintaro Spanish Fandub / Mekakushi-dan Spain | [Vimeo](https://vimeo.com/98835535) のタイトルに Spanish Fandub、説明欄に声優紹介のみを記載。 | 非公式ファンダブとして保留する。 |
| `98835536` | Mekaku City Actors CM Ayano Spanish Fandub / Mekakushi-dan Spain | [Vimeo](https://vimeo.com/98835536) のタイトルに Spanish Fandub、説明欄に声優紹介のみを記載。 | 非公式ファンダブとして保留する。 |

## 保存ルール

- 保存日時は `2026-08-22`、根拠種別は `official_vimeo_description` とする。
- `productions` には人物名または会社名だけを保存し、役割は `productionCredits.roles` に分離する。
- `manualResearch` がすでに設定されたレコードは更新対象外とする。
- Fan dubの5件は既存分類を上書き・削除せず、一次根拠不足として `held` を記録する。
