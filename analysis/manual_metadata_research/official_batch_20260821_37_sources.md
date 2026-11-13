# 混在高速補完バッチ 37 — 取得済み公開根拠

YouTube Data API v3で10件の投稿説明欄を確認した。投稿者本人または企業自身が、映像のサービス内容・公式ライブ・制作主体を公開しているものだけを補完対象とする。非公式再投稿、CM集、歌詞動画、作品出典が不明なTVスポット、説明欄から映像固有のメタデータを確定できない動画は、推測せず保留する。

| ID | タイトル | 判断 | 確認した公開根拠 | URL |
|---|---|---|---|---|
| DMowlj44nZc | 光れ日本！フルミュージックビデオ | 保留 | #aimusic等のハッシュタグと楽曲配信リンクのみ。映像の正式な制作主体・制作クレジット・映像表現を確認できない。 | <https://www.youtube.com/watch?v=DMowlj44nZc> |
| HI2zL-gkBAw | docomo「いつか、あたりまえになることを。」 | 保留 | 第三者チャンネルIfeelCMの投稿。ドコモ25周年ムービーの内容は説明されるが、公式投稿・公式制作クレジットとして確認できない。 | <https://www.youtube.com/watch?v=HI2zL-gkBAw> |
| 6RwAELjZSD8 | 斉藤和義「HAPPY」ライブツアー映像 | 補完 | 斉藤和義公式チャンネル。2026年発売アルバムおよびツアーへの公式導線、楽曲が全国ネット番組テーマソングであることを記載。 | <https://www.youtube.com/watch?v=6RwAELjZSD8> |
| jhAx4_YDLIE | シチズン「Junction～VEGA」’87 | 保留 | 個人チャンネルによる1987年のテレビ放送録画。シチズン公式投稿・映像制作クレジットを確認できない。 | <https://www.youtube.com/watch?v=jhAx4_YDLIE> |
| hzFoDmmbZyQ | 2000年代前半生まれが懐かしいCM BEST100 | 保留 | 個人チャンネルによるCM集で説明欄も空。各映像の公式性・作品同一性・制作根拠を確認できない。 | <https://www.youtube.com/watch?v=hzFoDmmbZyQ> |
| 6HNWWIpuDxA | Japanese R&B AIプレイリスト | 保留 | 投稿者は音楽・ビジュアルをAIおよび音楽後製ツールで制作と記載するが、映像作品としての制作目的・クレジットを確認できない。 | <https://www.youtube.com/watch?v=6HNWWIpuDxA> |
| nxze0exTj6U | Niji coversong Hiragana lyrics | 保留 | 個人チャンネルの歌詞動画。説明欄は空で、公式タイアップ・映像制作根拠を確認できない。 | <https://www.youtube.com/watch?v=nxze0exTj6U> |
| 4HALL5-PZu4 | THE END OF EVANGELION TV Spot #1 | 保留 | 個人チャンネルの投稿。タイトルはTVスポットを示すが、権利元の公式公開・制作クレジットを確認できない。 | <https://www.youtube.com/watch?v=4HALL5-PZu4> |
| QcmIt4ma2-o | KIYOSHI KURAHARA STUDIO 紹介映像 | 補完 | 株式会社KIYOSHI KURAHARA STUDIOの公式チャンネル。高品質な映像制作・動画広告・YouTube CM・企業ブランディング・YouTubeコンサルティングを自社サービスとして記載。 | <https://www.youtube.com/watch?v=QcmIt4ma2-o> |
| c_-QqzYtlUM | 「スタンドイン」とは？CM業界用語辞典 | 保留 | #CM制作・#映像制作・#業界用語のみで、映像制作作品または具体的なサービスの根拠を確認できない。 | <https://www.youtube.com/watch?v=c_-QqzYtlUM> |

> 出典：YouTube Data API v3 `videos.list`（`part=snippet`、取得日時 2026-08-21）。
