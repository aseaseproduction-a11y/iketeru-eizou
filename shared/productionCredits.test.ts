import { describe, expect, it } from "vitest";
import { getProductionNames, getProductionRoles, normalizeProductionCredits, parseProductionCreditText } from "./productionCredits";

describe("production credit normalization", () => {
  it("splits concatenated role labels into individual people and companies", () => {
    const credits = normalizeProductionCredits([], ["Agency : CHOCOLATE.incDirector : EISUKE SHIROTAArt Director : SHUN YONEMURAEditor : TAISHU TOMITA, EISUKE SHIROTA"]);

    expect(credits).toEqual([
      { name: "CHOCOLATE Inc.", roles: ["エージェンシー"], entityType: "company" },
      { name: "代田栄介", roles: ["監督", "編集"], entityType: "person" },
      { name: "SHUN YONEMURA", roles: ["アートディレクター"], entityType: "person" },
      { name: "TAISHU TOMITA", roles: ["編集"], entityType: "person" },
    ]);
  });

  it("merges Japanese and English aliases into the chosen canonical name", () => {
    const credits = normalizeProductionCredits([], ["株式会社ライト・ザ・ウェイ", "LIGHT THE WAY Inc.", "代田栄介", "Eisuke Shirota"]);

    expect(getProductionNames(credits)).toEqual(["LIGHT THE WAY Inc.", "代田栄介"]);
  });

  it("keeps roles separately from person and company names", () => {
    const credits = normalizeProductionCredits([], ["Kakeru Mizui（監督・撮影）", "Production : NANAME Inc."]);

    expect(credits).toEqual([
      { name: "Kakeru Mizui", roles: ["監督", "撮影"], entityType: "person" },
      { name: "NANAME Inc.", roles: ["制作"], entityType: "company" },
    ]);
    expect(getProductionRoles(credits)).toEqual(["監督", "撮影", "制作"]);
  });

  it("extracts Japanese creator and production manager labels as roles", () => {
    const credits = normalizeProductionCredits([], ["制作者（映像作家100人掲載者）：HARU", "プロダクション・マネージャー：三隅光治", "ディレクター：しらたき"]);

    expect(credits).toEqual([
      { name: "HARU", roles: ["制作者"], entityType: "person" },
      { name: "三隅光治", roles: ["プロダクションマネージャー"], entityType: "person" },
      { name: "しらたき", roles: ["監督"], entityType: "person" },
    ]);
  });

  it("does not turn descriptive sentences into production entities", () => {
    expect(parseProductionCreditText("暖かな表現にこだわるためコピー&ペーストや移動を使わず1枚1枚アナログのように制作。" )).toEqual([]);
  });

  it("splits inline Japanese role chains and removes affiliations from names", () => {
    expect(normalizeProductionCredits([
      { name: "奥村 拓弥 (KOO-KI) アシスタント" },
      { name: "藤本高志 アカウントエグゼクティブ 田中裕介" },
      { name: "中村凪沙/酒井嵐丸/鳥居宥生/渡部葵衣" },
    ])).toEqual([
      { name: "奥村 拓弥", roles: ["アシスタント"], entityType: "person" },
      { name: "藤本高志", roles: ["アカウントエグゼクティブ"], entityType: "person" },
      { name: "田中裕介", roles: [], entityType: "person" },
      { name: "中村凪沙", roles: [], entityType: "person" },
      { name: "酒井嵐丸", roles: [], entityType: "person" },
      { name: "鳥居宥生", roles: [], entityType: "person" },
      { name: "渡部葵衣", roles: [], entityType: "person" },
    ]);
  });

  it("separates label prefixes and removes role-only values", () => {
    expect(normalizeProductionCredits([], [
      "制作会社・関連会社(公式資料):株式会社シースリーフィルム",
      "プロダクション:マネージャー 砂川紘一",
      "Music",
      "2D animationAnimationMusic video",
      "Director / Animator",
    ])).toEqual([
      { name: "株式会社シースリーフィルム", roles: ["制作会社"], entityType: "company" },
      { name: "砂川紘一", roles: ["プロダクションマネージャー"], entityType: "person" },
    ]);
  });

  it("uses canonical company and person forms for confirmed aliases", () => {
    expect(normalizeProductionCredits([], ["ワウ株式会社", "WOW.inc", "WOW", "土岐 彩乃 (KOO-KI)", "土岐 彩乃", "superSymmetry by omnibus japan"])).toEqual([
      { name: "WOW inc.", roles: [], entityType: "company" },
      { name: "土岐 彩乃", roles: [], entityType: "person" },
      { name: "superSymmetry", roles: [], entityType: "company" },
    ]);
  });

  it("separates English role phrases and excludes music-only people from production credits", () => {
    expect(normalizeProductionCredits([], [
      "vocals performed by 牧野由依",
      "Vocalist: Yui Makino",
      "Vocal:角巻わため",
      "Vocal Direction:かっさん",
      "Music by Ayatake Ezaki",
      "Video by イクミ",
    ])).toEqual([
      { name: "イクミ", roles: ["制作"], entityType: "person" },
    ]);
  });

  it("removes navigation and site UI strings instead of treating them as creators", () => {
    expect(normalizeProductionCredits([], [
      "← 前の投稿: Aisho Nakajima – Gangbang feat. Yohji Igarashi",
      "次の投稿: showmore – liquid【Official Music Video】 →",
    ])).toEqual([]);
  });

  it("unifies Japanese and English variants of Shuji Hirai", () => {
    expect(normalizeProductionCredits([], ["平井 秀次", "Shuji Hirai", "Hirai Shuji"])).toEqual([
      { name: "平井秀次", roles: [], entityType: "person" },
    ]);
  });
});
