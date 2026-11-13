export const sourceConfig = {
  favvid: {
    label: "FAVVID",
    tags: ["FAVVID", "映像リファレンス", "モーショングラフィックス", "YouTube"],
    background: "FAVVIDの公開キュレーションに、モーショングラフィックスを中心とした映像作品として掲載。",
    evaluation: "FAVVIDの映像リファレンスとして選定された作品。",
  },
  light_the_way: {
    label: "LIGHT THE WAY 公式制作実績",
    tags: ["LIGHT THE WAY", "公式制作実績", "YouTube"],
    background: "LIGHT THE WAYの公式制作実績ページに掲載。",
    evaluation: "制作会社公式の実績として公開された作品。",
  },
  alld: {
    label: "ALLd. 公式制作実績",
    tags: ["ALLd.", "公式制作実績", "Vimeo"],
    background: "ALLd.の公式制作実績ページに掲載。",
    evaluation: "制作会社公式の実績として公開された作品。",
  },
  takashi_ohashi: {
    label: "Takashi Ohashi 公式ポートフォリオ",
    tags: ["Takashi Ohashi", "公式ポートフォリオ", "YouTube"],
    background: "Takashi Ohashi公式ポートフォリオに掲載。",
    evaluation: "モーションデザイナー／ムービーディレクター本人の公式ポートフォリオに掲載された作品。",
  },
};

export function createSiteImport(item) {
  const config = sourceConfig[item.source] ?? {
    label: item.sourceLabel || `${item.source} 公式掲載`,
    tags: [item.sourceLabel || item.source, "公式制作実績", item.platform === "vimeo" ? "Vimeo" : "YouTube"],
    background: `${item.sourceLabel || item.source}の公式掲載ページに掲載。`,
    evaluation: "公式掲載作品として確認された映像。",
  };
  return {
    id: item.id,
    platform: item.platform,
    title: item.retrievedTitle,
    sourceTitle: item.title,
    thumbnail: item.thumbnail,
    videoUrl: item.videoUrl,
    embedUrl: item.platform === "youtube" ? `https://www.youtube.com/embed/${item.id}` : `https://player.vimeo.com/video/${item.id}`,
    source: item.source,
    sourceLabel: config.label,
    channelTitle: item.channelTitle,
    allTags: config.tags,
    productions: item.productionName ? [item.productionName] : [],
    curationNote: {
      purpose: "映像表現のリファレンス収集",
      background: `${config.background} 公式掲載タイトル: ${item.title}`,
      evaluation: config.evaluation,
      sourceUrls: item.sourceUrls?.length ? item.sourceUrls : [item.sourceUrl],
    },
    awards: [],
    addedDate: "2026-08-19",
    verification: {
      method: item.verificationReason,
      sourceTitle: item.title,
      retrievedTitle: item.retrievedTitle,
      sourceUrls: item.sourceUrls?.length ? item.sourceUrls : [item.sourceUrl],
    },
  };
}

export function createVerifiedSiteImports(rows) {
  return rows.filter((row) => row.result === "verified" && row.id && row.videoUrl && row.titleMatch).map(createSiteImport);
}
