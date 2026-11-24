# 「動画を見ずに分析した記録」全量洗い出し監査レポート（SQLite 読取専用 / TiDB SELECT のみ）

- **監査日時**: 2026-11-24T21:08:12+09:00
- **DB 書き込み**: **ゼロ**（SQLite `mode=ro`、TiDB `SELECT` クエリのみ実行）
- **全件データ（JSON）**: `analysis/craft_calibration_pilot/unwatched_analysis_audit.json`

---

## 1. 判定方法（誤検知を排除した厳密ルール）
単純に本文から「未視聴」という単語を検索すると、映画予告編やアニメMVの実視聴レビューに含まれる「アニメ未視聴層でも楽しめる」といった文章（31件）や、クラフトレシピ内の「サムネイル入りUIパネル」（1件）が誤検知されるため、**本文の文脈を全件確認したうえで以下のルールで厳密に分類**しました：

1. **確定・未視聴分析 `B1`（メタデータ単独一次評価テンプレート）**:
   - 本文に `公式公開メタデータ・クレジット完全精査` / `公開公式メタデータ・公式制作解説・クレジット・サムネイルURLに基づく一次完全評価` / `未視聴のタイムコード捏造を禁止` のいずれかを含むもの（Britbox `1069311388` が該当）。
2. **確定・未視聴分析 `B2`（動画未取得・コンタクトシート未生成）**:
   - 本文に `前処理コンタクトシート未生成` / `動画本体が取得できないため` / `コンタクトシート未生成のため確認不能` を含むもの。
3. **確定・未視聴分析 `B3`（映像実測値なし・定型文のみの1次速報診断）**:
   - `【1次速報診断レポート` 形式のうち、`fps`・解像度・音量（dB）・シート番号・タイムスタンプ等の実測記述が一切なく、複数動画で同一の定型テンプレート文（例：「標準的な映像構成であり、破綻はないものの…」）のみで構成されているもの。
4. **要確認 `C`（実測値未記載の短文1次速報診断）**:
   - `【1次速報診断レポート` 形式で固有の短い内容メモはあるが、`fps`/解像度/`dB` 等の実測値がないため、目視メモかメタデータ推測かを本文だけでは断定できないもの。
5. **別枠・未分析（`empty_unanalyzed`）**:
   - `ai_analysis` が NULL または空文字（分析文自体がまだ存在しない未分析レコード）。

---

## 2. 集計結果（SQLite vs TiDB 比較表）

| 区分 | SQLite（総数 5,701本） | TiDB（総数 5,653本） | 備考 |
|---|---:|---:|---|
| **確定・未視聴分析 合計（B1+B2+B3）** | **259本** | **257本** | Vimeo 237本が大多数（91.5%）／Phase 3 校正済みとの重複 **0本** |
| 　└ `B1` メタデータ単独一次評価 | 249本 | 249本 | SQLite・TiDB 完全一致（Vimeo 237 / YouTube 12） |
| 　└ `B2` 動画未取得・シート未生成 | 2本 | 0本 | `G4FxpJVuIfc`, `JVlAJlvaT0Y`（ローカル SQLite のみ存在） |
| 　└ `B3` 1次速報・定型文のみ | 8本 | 8本 | SQLite・TiDB 完全一致（すべて YouTube） |
| **要確認 `C`（実測値なし短文1次速報）** | **21本** | **17本** | 差分4本はローカル SQLite のみ存在 |
| **別枠・未分析（`ai_analysis` 空/NULL）** | 183本 | 182本 | 「見ずに分析」ではなく分析未実施 |
| **実視聴済み分析（通常＋実測付き速報）** | 5238本 | 5197本 | — |

### 確定・未視聴分析のプラットフォーム内訳（SQLite 259本 / TiDB 257本）
- **Vimeo**: **237本**（SQLite・TiDB 完全一致。主にログイン必須・埋め込み制限等で元 MP4 未取得だった Vimeo 作品）
- **YouTube**: SQLite **22本** / TiDB **20本**

---

## 3. `craft_recipes` 元動画 439本（1,036レシピ）の監査結果

- **該当件数（未視聴・メタデータのみで作成されたレコード）**: **0本 / 439本（0件 / 1,036レシピ）**
- **実動画証跡の確認**: 全 **439本（100%）** について、実動画ファイルから ffmpeg 等で切り出した **GIF / 6コマストリップ画像 / キーフレーム JSON** が存在することを確認しました。
- **補足（誤検知の除外確認）**:
  - 単語検索で一時ヒットした 4件（`403212163`, `5CfITO98wMc`, `1018644295`, `MCmi6ISIGRg`）をすべて原文確認し、「アニメ未視聴層」「UIパネルのサムネイル」「未視聴一次評価を実映像で補正済み」など**実視聴済みの記述**であることを確認済みです。
  - `craft_recipes` 元動画のうち 95本は `has_full_analysis = 0`（旧形式の短文 Vimeo 要約）ですが、いずれも実動画からの GIF/ストリップ抽出および実映像視聴に基づくレシピであることを確認しました。

---

## 4. 確定・未視聴分析の内訳リスト

### 4-1. `B2` 動画未取得・コンタクトシート未生成（2本・SQLite のみ）
| Video ID | Platform | 旧評価 | タイトル |
|---|---|---|---|
| `G4FxpJVuIfc` | youtube | D- | KARTE 10周年記念ムービー |
| `JVlAJlvaT0Y` | youtube | D- | 【MV】 てんやわんや、夏。 【月ノ美兎 / 笹木咲 / 椎名唯華】 |

### 4-2. `B3` 映像実測値なし・定型文のみの1次速報診断（8本・SQLite/TiDB 一致）
| Video ID | Platform | 旧評価 | 文字数 | タイトル |
|---|---|---|---:|---|
| `6S4IXJ5QTpY` | youtube | B | 436 | 「高額下取りがおトク」篇～ジャパネット「夏のエアコン祭り」～ 相葉雅紀さん＆川島明さん出演！ |
| `8A6F10zDt2Y` | youtube | B | 436 | キリン 午後の紅茶　遠くの町の夏の午後篇　Behind The Scenes |
| `95tF137_BKg` | youtube | B | 436 | Captain America: The Winter Soldier End Credit Theme |
| `BmV1TPKs2Wg` | youtube | A+ | 509 | 【公式】カーセンサー　「あの夏の思い出　～もしも平成にあのちゃんとドライブデートしたら～」篇（ロング） |
| `Co03Hc0CIXQ` | youtube | B | 436 | 【LUMINE】GIFT OF VOICE LUMINE CHRISTMAS 2021 |
| `JGAaNRSW_HU` | youtube | B | 436 | 【バーサス｜13面ラスボス頂上決戦】渋谷13面ジャック特別PV / VERSUS Shibuya 13 screen hijack report movie |
| `OQ1-0MmCFfc` | youtube | B | 435 | 【期間限定公開】ONE PIECE × SAMURAI BLUE｜「おれたちの最高地点へ」 |
| `lJJ2MJlIazI` | youtube | S | 556 | キリン 午後の紅茶　「遠くの町の夏の午後」篇　60秒 |

### 4-3. `B1` メタデータ単独一次評価テンプレート（全 249本・SQLite/TiDB 一致）
※全 249本の完全リストは `unwatched_analysis_audit.json` の `confirmed_unwatched_entries_sqlite` に格納。うち YouTube 全 12本＋Vimeo 代表 15本（Britbox `1069311388` 含む）を以下に抜粋：

| Video ID | Platform | 旧評価 | タイトル |
|---|---|---|---|
| `47GuClGEtyM` | youtube | B+ | DARLING in the FRANXX OPENING |
| `6FdqnZ8brOA` | youtube | B | Brand Storytelling Case Study | Professional Video for Businesses |
| `8l8RIntUIm8` | youtube | B | 短編映画「運命代行屋」タイトルシーケンス |
| `ADSho62yiDk` | youtube | B | トヨタ自動車株式会社「#ありがとう平成」 |
| `W5AA6QZzfDk` | youtube | B | 【MMGC2023 Day7】ブルージャイアント「海中の氷塊」 |
| `Wt5AhyH6BRE` | youtube | B | 【ドラえもん】ノンクレジットオープニング映像／星野源『ドラえもん』 |
| `Xfotcux_lqU` | youtube | B | 『 大王饶命』 シーズン2 OP/オープニングテーマ/【大王饶命第二季】动画OP/片头曲《对对对》 |
| `cMb_18qEgoo` | youtube | B | 【自主制作アニメーション】スイーツ☆インベイド　season３【尚美アニメーション　オリジナル作品】 |
| `k5-bWHLnfYU` | youtube | B | 【自主制作アニメ】心の王国　完全版 |
| `smx_qbPz_J4` | youtube | B+ | 乃木坂46 『空扉』Short Ver. |
| `v0et8aR3KF8` | youtube | B+ | 『LAZARUS ラザロ』Opening Movie(Full)｜「Vortex」Kamasi Washington |
| `yxfg1xxx-og` | youtube | B | サンボマスターとアイナ・ジ・エンド / 花束  MUSIC VIDEO |
| `1069311388` | vimeo | B+ | 'See it Differently' - Britbox - Directed by Nicos Livesey |
| `10070449` | vimeo |  | Kraddy - Android Porn (Mochipet Godzillaporn Remix) - Music Video |
| `1041875369` | vimeo |  | 星宮とと+ SOZEN OTSUBO - Hi-fi (Official Music Video) |
| `1041925523` | vimeo |  | REEL 2025 |
| `1046062913` | vimeo |  | A Composition for Upright Displays #01 |
| `1055994596` | vimeo |  | Beats Powerbeats Pro 2 |
| `1056688529` | vimeo |  | WWW |
| `1056750218` | vimeo |  | parlor |
| `1056762918` | vimeo | A- | Create magic. |
| `106226560` | vimeo | B | RUSH HOUR |
| `1068014839` | vimeo | A- | Balloon Your Hope. |
| `1073816481` | vimeo | B+ | 夢みる薬膳研究室はじまりの物語 |
| `1076319399` | vimeo | B+ | Neltz Ident |
| `1078424906` | vimeo | A+ | Revolut - Money Possibilities DC |
| `1080372107` | vimeo | B+ | Life360 - I Think of You (Dying) |

### 4-4. 要確認 `C`（実測値記載なしの短文1次速報：SQLite 21本 / TiDB 17本）
| Video ID | Platform | 旧評価 | 文字数 | タイトル |
|---|---|---|---:|---|
| `DVTp2N1wuzw` | youtube | B+ | 254 | ＜Campus＞モーションロゴ - YouTube |
| `FlqDBh8QjZk` | youtube | A | 271 | TVアニメ「正反対な君と僕」第2期ノンクレジットエンディング映像 |
| `HCC-0sr_-lo` | youtube | S | 300 | sumika / 赤春花 (feat. 幾田りら)【Music Video】 |
| `ISrRQs87DnI` | youtube | A+ | 303 | 【スペシャル映像】漫画『君と宇宙を歩くために』×BUMP OF CHICKEN『セントエルモの火』 |
| `JcDm0pNQrI8` | youtube | A- | 284 | circus / 鏑木ろこ cover |
| `QcDn6TATqOw` | youtube | B+ | 420 | サントリー緑茶 伊右衛門 特茶『特茶研究所　テクテク歩く』篇 15秒 ​本木雅弘 上白石萌音 サントリーCM |
| `Rz8_lGd2JzQ` | youtube | A- | 283 | 【MV】Genesis - 3SKM |
| `TwumA6YhQp4` | youtube | A | 274 | TVアニメ『ヤニねこ』ノンクレジットエンディング映像｜ネクライトーキー「煙とブルー」 |
| `UOnnmfdvRmk` | youtube | A- | 308 | 「なるほど使える、経営にビジネス・カード」（資金繰り篇） |
| `W73yqEnXBmA` | youtube | B+ | 265 | 保育・お子様向け食育ムービーのご紹介　フル |
| `XPm7zy-X_fI` | youtube | A+ | 297 | VOLTA - Blender Short |
| `bKA-ePajnTY` | youtube | B+ | 254 | こんにちは。Campusです。 - YouTube |
| `cUvp3ERw-Kg` | youtube | A- | 308 | 【陰キャギャルでもイキがりたい！】第4巻発売記念PV໒꒱‧₊˚ 7月28日(火)発売！ |
| `cybOVzgtL2Q` | youtube | A- | 276 | 簒奪 / 重音テトSV |
| `dUN8bvnygMQ` | youtube | A | 283 | PORSCHE 9HATE9 - BLENDER ANIMATION |
| `i47RggTEuPQ` | youtube | B | 261 | キャンパスノート（青色ドットボーダー）商品紹介（横） - YouTube |
| `lR2gNpgl-G8` | youtube | B+ | 278 | CUBERU |
| `noFwvq8FHoI` | youtube | D | 430 | 彌生「お似合いだったのに石野陽子…かわいい妻🩷」# #志村けん #石野陽子#やきもち#かわいい🩷#志村けんの表情が違う |
| `qeddzEzDnic` | youtube | D+ | 724 | XR BALL＠TOKYO NODE “XR PARADE” created with TNXR |
| `sG_ifd5hnHI` | youtube | A- | 280 | MAKE HASTE CORP |
| `xz7dvSS2lI8` | youtube | A- | 289 | 死神 / ゆう。- cover【オリジナルMV】 |
