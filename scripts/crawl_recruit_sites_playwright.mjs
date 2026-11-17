/**
 * 案3: JS動的描画（React/Next.js/遅延iframe）対応の採用サイト＆制作会社Worksクローラー
 * GitHub Actions（毎日1回・無料枠）で実行し、抽出したYouTube/Vimeo動画をGAS Webhookへ送信する。
 *
 * 使い方（ローカルテスト）:
 *   GAS_WEBHOOK_URL="https://script.google.com/macros/s/.../exec" node scripts/crawl_recruit_sites_playwright.mjs
 */

import { chromium } from 'playwright';

const TARGET_SITES = [
  { name: 'MUUUUU.ORG 採用系', url: 'https://muuuuu.org/category/tag/recruit', maxSubPages: 8 },
  { name: 'SANKOU! 採用サイト', url: 'https://sankoudesign.com/category/recruit/', maxSubPages: 8 },
  { name: 'LIG Works', url: 'https://liginc.co.jp/works', maxSubPages: 6 },
  { name: 'Vimeo Staff Picks / Branded', url: 'https://vimeo.com/channels/staffpicks', maxSubPages: 0 },
  { name: 'Crevo 採用動画実績', url: 'https://crevo.jp/projects/?category=recruit', maxSubPages: 6 },
  { name: 'LOCUS 採用動画実績', url: 'https://www.locus-inc.co.jp/works/category/recruit/', maxSubPages: 6 },
];

function normalizeVideoUrl(raw) {
  if (!raw) return null;
  const ytMatch = raw.match(/(?:youtube\.com\/(?:embed\/|watch\?v=|shorts\/)|youtube-nocookie\.com\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
  if (ytMatch) {
    return { id: ytMatch[1], url: `https://www.youtube.com/watch?v=${ytMatch[1]}` };
  }
  const vmMatch = raw.match(/(?:player\.vimeo\.com\/video\/|vimeo\.com\/)(\d{7,11})/i);
  if (vmMatch) {
    return { id: `vimeo-${vmMatch[1]}`, url: `https://vimeo.com/${vmMatch[1]}` };
  }
  return null;
}

async function extractVideosFromPage(page, sourceName) {
  // 遅延読み込みiframeを発火させるため軽くスクロール
  await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight * 0.4);
    await new Promise(r => setTimeout(r, 400));
    window.scrollTo(0, document.body.scrollHeight * 0.8);
    await new Promise(r => setTimeout(r, 400));
  });

  const data = await page.evaluate(() => {
    const title = document.title || '';
    const urls = [];
    document.querySelectorAll('iframe').forEach(el => {
      if (el.src) urls.push(el.src);
      if (el.dataset && el.dataset.src) urls.push(el.dataset.src);
    });
    document.querySelectorAll('a[href]').forEach(el => {
      urls.push(el.href);
    });
    document.querySelectorAll('[data-video-id], [data-youtube-id]').forEach(el => {
      const id = el.getAttribute('data-video-id') || el.getAttribute('data-youtube-id');
      if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) {
        urls.push(`https://www.youtube.com/watch?v=${id}`);
      }
    });
    const links = Array.from(document.querySelectorAll('a[href]')).map(a => ({
      href: a.href,
      text: (a.textContent || '').trim(),
    }));
    return { title, urls, links };
  });

  const found = [];
  for (const raw of data.urls) {
    const norm = normalizeVideoUrl(raw);
    if (norm) {
      found.push({
        id: norm.id,
        url: norm.url,
        title: data.title.slice(0, 80) || sourceName,
        source: `Playwright(${sourceName})`,
      });
    }
  }
  return { found, links: data.links };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  const uniqueVideos = new Map();

  for (const site of TARGET_SITES) {
    console.log(`[Crawling] ${site.name}: ${site.url}`);
    try {
      await page.goto(site.url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      const { found, links } = await extractVideosFromPage(page, site.name);
      for (const v of found) uniqueVideos.set(v.id, v);

      if (site.maxSubPages > 0) {
        const subLinks = links
          .filter(l => l.href.startsWith('http') && !/twitter\.com|x\.com|facebook\.com|instagram\.com|youtube\.com/i.test(l.href))
          .filter(l => /works|projects|web|recruit|saiyo|case/i.test(l.href))
          .map(l => l.href);
        const dedupedSubs = Array.from(new Set(subLinks)).slice(0, site.maxSubPages);

        for (const sub of dedupedSubs) {
          try {
            await page.goto(sub, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(1000);
            const subRes = await extractVideosFromPage(page, site.name);
            for (const v of subRes.found) uniqueVideos.set(v.id, v);
          } catch (err) {
            // サブページ失敗はスキップ
          }
        }
      }
    } catch (err) {
      console.warn(`[Skip] ${site.name}: ${err.message}`);
    }
  }

  await browser.close();

  const videos = Array.from(uniqueVideos.values());
  console.log(`Total unique videos discovered: ${videos.length}`);

  const webhookUrl = process.env.GAS_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log('GAS_WEBHOOK_URL not set; dry-run output:', JSON.stringify(videos.slice(0, 10), null, 2));
    return;
  }

  if (videos.length > 0) {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add_recruit_videos', videos }),
    });
    console.log('GAS Webhook status:', res.status, await res.text());
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
