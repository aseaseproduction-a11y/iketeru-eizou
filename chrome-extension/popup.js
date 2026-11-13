const targetSite = "https://iketeru-eizou.vercel.app/manage";
const status = document.querySelector("#status");
const metadata = document.querySelector("#metadata");
const platformNode = document.querySelector("#platform");
const titleNode = document.querySelector("#title");
const addButton = document.querySelector("#add-button");

function detectPlatform(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (/(^|\.)youtube\.com$/.test(host) || host === "youtu.be") return "youtube";
    if (/(^|\.)vimeo\.com$/.test(host)) return "vimeo";
    if (/(^|\.)(x|twitter)\.com$/.test(host)) return "x";
    if (/(^|\.)tiktok\.com$/.test(host)) return "tiktok";
    if (/(^|\.)instagram\.com$/.test(host)) return "instagram";
    return "external";
  } catch {
    return null;
  }
}

function labelFor(platform) {
  return { youtube: "YouTube", vimeo: "Vimeo", x: "X", tiktok: "TikTok", instagram: "Instagram", external: "その他の公開サイト" }[platform];
}

async function initialize() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const platform = tab?.url ? detectPlatform(tab.url) : null;
  if (!tab?.url || !platform) {
    status.textContent = "このページは追加できません。公開されている動画または作品ページを開いてください。";
    return;
  }

  const pageTitle = (tab.title || "").trim();
  status.textContent = "追加画面で内容を確認してから保存できます。";
  platformNode.textContent = labelFor(platform);
  titleNode.textContent = pageTitle || "タイトル未取得";
  metadata.hidden = false;
  addButton.disabled = false;
  addButton.addEventListener("click", async () => {
    const destination = new URL(targetSite);
    destination.searchParams.set("from", "chrome-extension");
    destination.searchParams.set("url", tab.url);
    destination.searchParams.set("title", pageTitle);
    destination.searchParams.set("platform", platform);
    await chrome.tabs.create({ url: destination.toString() });
    window.close();
  }, { once: true });
}

initialize().catch(() => {
  status.textContent = "ページ情報を取得できませんでした。ページを再読み込みしてからもう一度お試しください。";
});
