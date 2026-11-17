/**
 * 採用動画・中小企業ブランディングムービー自動収集モジュール (GAS版 / 完全無料)
 *
 * 含まれる機能:
 *   - 案1: 映像制作会社Works / 採用サイトギャラリーの定期巡回 (UrlFetchApp)
 *   - 案2: Google Custom Search JSON API (無料枠1日100クエリ) による採用サイト探索
 *   - 案3連携: GitHub Actions (Playwright) からの抽出結果受け取りヘルパー
 *
 * 導入手順:
 *   1. GASエディタで「+」→「スクリプト」を作成し、このコード全体を貼り付ける。
 *   2. 必要なら SPREADSHEET_SHEET_NAME / YOUTUBE_URL_COL をご自身のシート列に合わせて調整。
 *   3. (案2を使う場合) プロジェクトの設定 → スクリプトプロパティに以下を追加:
 *        - GOOGLE_CSE_API_KEY : Google Cloud の Custom Search API キー (無料)
 *        - GOOGLE_CSE_CX      : Programmable Search Engine の検索エンジンID (ウェブ全体検索ON)
 *   4. トリガーで `runDailyCorporateRecruitCollector` を「毎日 午前3〜4時」等に1つ登録する。
 */

const CORP_COLLECTOR_CONFIG = {
  // 動画を追加するシート名（環境に合わせて変更可）
  SHEET_NAME: '動画リスト',
  // URLが入る列（1始まり: A=1, B=2, C=3...）
  URL_COLUMN_INDEX: 2,
  // タイトルが入る列
  TITLE_COLUMN_INDEX: 3,
  // 取得元ラベルが入る列（空なら書き込まない場合は null）
  SOURCE_COLUMN_INDEX: 4,
  // ステータス列（未分析等を入れる場合）
  STATUS_COLUMN_INDEX: 1,
  INITIAL_STATUS: '未分析',
  // 1回の実行での最大処理時間（GAS 6分制限対策で4.5分で安全停止）
  MAX_RUNTIME_MS: 270000,
  // 1日に追加する上限本数（暴走防止）
  MAX_NEW_VIDEOS_PER_RUN: 40,
  // 案1: 1ソースあたりの詳細ページ巡回上限
  MAX_DETAIL_PAGES_PER_SOURCE: 8,
  // 案2: 1回の実行で消費するCSEクエリ数（無料枠100/日の範囲内）
  MAX_CSE_QUERIES_PER_RUN: 5,
};

/**
 * 案1: 採用動画・中小企業ブランディング動画が集まりやすい制作会社Works・Webギャラリー
 * 静的HTMLからYouTube/Vimeo埋め込みを抽出し、限定公開(Unlisted)動画も拾う。
 */
const GALLERY_AND_WORKS_SOURCES = [
  {
    name: '制作実績: 採用/企業動画系ギャラリー (MUUUUU.ORG)',
    url: 'https://muuuuu.org/category/tag/recruit',
    followDetailLinks: true,
    detailLinkPattern: /https?:\/\/muuuuu\.org\/[a-z0-9_-]+\.html/gi,
  },
  {
    name: '制作実績: SANKOU! リクルート・採用サイト',
    url: 'https://sankoudesign.com/category/recruit/',
    followDetailLinks: true,
    detailLinkPattern: /https?:\/\/sankoudesign\.com\/web\/[a-z0-9_-]+\/?/gi,
  },
  {
    name: '制作実績: 動画幹事 採用動画事例まとめ',
    url: 'https://douga-kanji.com/posts/recruit-movie',
    followDetailLinks: false,
  },
  {
    name: '制作実績: 動画制作会社Crevo Works (採用・会社紹介)',
    url: 'https://crevo.jp/projects/?category=recruit',
    followDetailLinks: true,
    detailLinkPattern: /https?:\/\/crevo\.jp\/projects\/\d+\/?/gi,
  },
  {
    name: '制作実績: プルークス 採用動画実績',
    url: 'https://proox.co.jp/works/category/recruit/',
    followDetailLinks: true,
    detailLinkPattern: /https?:\/\/proox\.co\.jp\/works\/\d+\/?/gi,
  },
];

/**
 * 案2: Google Custom Search API 用クエリローテーション
 * 普通にYouTube検索しても出ない「企業の採用ページ埋め込み動画」を直接狙う。
 */
const CSE_RECRUIT_QUERIES = [
  'inurl:recruit ("youtube.com/embed" OR "youtu.be") "採用"',
  'inurl:saiyo ("youtube.com/embed" OR "youtu.be")',
  '"採用ムービー" OR "リクルートムービー" site:.co.jp ("youtube.com" OR "youtu.be")',
  '"会社紹介動画" OR "企業ブランドムービー" site:.co.jp ("youtube.com/embed" OR "youtu.be")',
  '"社員インタビュー" "採用" site:.co.jp ("youtube.com/embed" OR "youtu.be")',
  '"ブランドムービー" 中小企業 OR 製造業 OR 建設業 ("youtube.com" OR "vimeo.com")',
  '"コーポレートムービー" site:.co.jp ("youtube.com/embed" OR "vimeo.com")',
  'inurl:company ("youtube.com/embed" OR "youtu.be") "想い" OR "理念"',
];

/**
 * メインエントリポイント（毎日トリガーで実行）
 */
function runDailyCorporateRecruitCollector() {
  const startedAt = Date.now();
  const sheet = getTargetSheet_();
  if (!sheet) {
    Logger.log('対象シートが見つかりません: ' + CORP_COLLECTOR_CONFIG.SHEET_NAME);
    return;
  }

  const existingIds = loadExistingVideoIds_(sheet);
  const discovered = [];

  // 1. 案1: 制作会社Works・ギャラリー巡回
  for (let i = 0; i < GALLERY_AND_WORKS_SOURCES.length; i++) {
    if (isTimeOrCountLimitReached_(startedAt, discovered.length)) break;
    const src = GALLERY_AND_WORKS_SOURCES[i];
    try {
      const items = crawlStaticSource_(src, existingIds, startedAt);
      for (const item of items) {
        if (!existingIds.has(item.videoId)) {
          existingIds.add(item.videoId);
          discovered.push(item);
        }
      }
    } catch (e) {
      Logger.log('[案1エラー] ' + src.name + ': ' + e.message);
    }
  }

  // 2. 案2: Google Custom Search API による採用サイト探索
  if (!isTimeOrCountLimitReached_(startedAt, discovered.length)) {
    try {
      const cseItems = searchViaCustomSearchApi_(existingIds, startedAt);
      for (const item of cseItems) {
        if (!existingIds.has(item.videoId)) {
          existingIds.add(item.videoId);
          discovered.push(item);
        }
      }
    } catch (e) {
      Logger.log('[案2エラー] Custom Search: ' + e.message);
    }
  }

  // 3. シートへ追記
  const added = appendDiscoveredVideos_(sheet, discovered);
  Logger.log('完了: 新規追加 ' + added + ' 本 (所要時間 ' + Math.round((Date.now() - startedAt) / 1000) + ' 秒)');
}

/**
 * 案3連携: GitHub Actions (Playwright) から POST された候補を追記する
 * 既存の doPost(e) 内から `if (data.action === 'add_recruit_videos') return handleRecruitWebhook_(data);` のように呼び出す。
 */
function handleRecruitWebhook_(payload) {
  const sheet = getTargetSheet_();
  if (!sheet) return { ok: false, error: 'Sheet not found' };

  const existingIds = loadExistingVideoIds_(sheet);
  const candidates = Array.isArray(payload.videos) ? payload.videos : [];
  const toAdd = [];

  for (const c of candidates) {
    const vid = extractVideoIdFromUrl_(c.url || '');
    if (!vid || existingIds.has(vid.id)) continue;
    existingIds.add(vid.id);
    toAdd.push({
      videoId: vid.id,
      platform: vid.platform,
      url: vid.canonicalUrl,
      title: c.title || ('採用・企業動画 (' + vid.id + ')'),
      source: c.source || 'Playwright巡回(採用サイト)',
    });
  }

  const added = appendDiscoveredVideos_(sheet, toAdd);
  return { ok: true, received: candidates.length, added: added };
}

/* ==================== 内部ヘルパー ==================== */

function crawlStaticSource_(src, existingIds, startedAt) {
  const results = [];
  const html = fetchHtmlSafe_(src.url);
  if (!html) return results;

  // トップページから直接動画抽出
  extractVideosFromHtml_(html, src.name, results, existingIds);

  // 詳細ページも辿る場合（外部採用サイトリンクや実績詳細ページ）
  if (src.followDetailLinks && src.detailLinkPattern) {
    const matches = html.match(src.detailLinkPattern) || [];
    const uniqueLinks = Array.from(new Set(matches)).slice(0, CORP_COLLECTOR_CONFIG.MAX_DETAIL_PAGES_PER_SOURCE);

    for (const link of uniqueLinks) {
      if (isTimeOrCountLimitReached_(startedAt, results.length)) break;
      Utilities.sleep(400);
      const detailHtml = fetchHtmlSafe_(link);
      if (!detailHtml) continue;
      extractVideosFromHtml_(detailHtml, src.name, results, existingIds);

      // Webギャラリーの場合、掲載先の企業公式サイトURL（「VISIT SITE」等）も1ホップだけ辿る
      const externalUrl = extractExternalCompanySiteUrl_(detailHtml, link);
      if (externalUrl) {
        Utilities.sleep(400);
        const corpHtml = fetchHtmlSafe_(externalUrl);
        if (corpHtml) {
          extractVideosFromHtml_(corpHtml, '採用サイト巡回(' + externalUrl + ')', results, existingIds);
        }
      }
    }
  }
  return results;
}

function searchViaCustomSearchApi_(existingIds, startedAt) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('GOOGLE_CSE_API_KEY');
  const cx = props.getProperty('GOOGLE_CSE_CX');
  if (!apiKey || !cx) {
    Logger.log('GOOGLE_CSE_API_KEY / GOOGLE_CSE_CX 未設定のため案2をスキップします');
    return [];
  }

  const results = [];
  // 日替わりオフセットで全クエリを順番に回す
  const dayIndex = Math.floor(Date.now() / 86400000);
  const queriesToRun = [];
  for (let i = 0; i < CORP_COLLECTOR_CONFIG.MAX_CSE_QUERIES_PER_RUN; i++) {
    queriesToRun.push(CSE_RECRUIT_QUERIES[(dayIndex + i) % CSE_RECRUIT_QUERIES.length]);
  }

  for (const q of queriesToRun) {
    if (isTimeOrCountLimitReached_(startedAt, results.length)) break;
    const endpoint =
      'https://www.googleapis.com/customsearch/v1?key=' + encodeURIComponent(apiKey) +
      '&cx=' + encodeURIComponent(cx) +
      '&num=10&q=' + encodeURIComponent(q);

    try {
      const res = UrlFetchApp.fetch(endpoint, { muteHttpExceptions: true });
      if (res.getResponseCode() !== 200) {
        Logger.log('CSE HTTP ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
        continue;
      }
      const data = JSON.parse(res.getContentText());
      const items = data.items || [];
      for (const item of items) {
        if (isTimeOrCountLimitReached_(startedAt, results.length)) break;
        if (!item.link) continue;
        Utilities.sleep(300);
        const pageHtml = fetchHtmlSafe_(item.link);
        if (pageHtml) {
          extractVideosFromHtml_(pageHtml, '企業サイト(' + (item.displayLink || item.link) + ')', results, existingIds);
        }
      }
    } catch (e) {
      Logger.log('CSE fetch error: ' + e.message);
    }
  }
  return results;
}

function extractVideosFromHtml_(html, sourceLabel, outList, existingIds) {
  const pageTitleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const pageTitle = pageTitleMatch
    ? pageTitleMatch[1].replace(/\s+/g, ' ').replace(/<[^>]+>/g, '').trim().slice(0, 80)
    : sourceLabel;

  // YouTube (embed / watch / youtu.be / shorts / nocookie)
  const ytRegex = /(?:youtube\.com\/(?:embed\/|watch\?v=|shorts\/)|youtube-nocookie\.com\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/gi;
  let m;
  while ((m = ytRegex.exec(html)) !== null) {
    const id = m[1];
    if (existingIds.has(id)) continue;
    if (outList.some(x => x.videoId === id)) continue;
    outList.push({
      videoId: id,
      platform: 'youtube',
      url: 'https://www.youtube.com/watch?v=' + id,
      title: pageTitle,
      source: sourceLabel,
    });
  }

  // Vimeo (player.vimeo.com/video/123456789 or vimeo.com/123456789)
  const vimeoRegex = /(?:player\.vimeo\.com\/video\/|vimeo\.com\/)(\d{7,11})/gi;
  while ((m = vimeoRegex.exec(html)) !== null) {
    const id = 'vimeo-' + m[1];
    if (existingIds.has(id)) continue;
    if (outList.some(x => x.videoId === id)) continue;
    outList.push({
      videoId: id,
      platform: 'vimeo',
      url: 'https://vimeo.com/' + m[1],
      title: pageTitle,
      source: sourceLabel,
    });
  }
}

function extractExternalCompanySiteUrl_(html, currentPageUrl) {
  const hostMatch = currentPageUrl.match(/^https?:\/\/([^\/]+)/i);
  const currentHost = hostMatch ? hostMatch[1] : '';
  const aRegex = /<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = aRegex.exec(html)) !== null) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, '').trim();
    if (!href || href.includes(currentHost)) continue;
    if (/twitter\.com|x\.com|facebook\.com|instagram\.com|youtube\.com|youtu\.be|google\.com/i.test(href)) continue;
    if (/visit|site|公式サイト|採用サイト|企業サイト|url/i.test(text) || /co\.jp/i.test(href)) {
      return href;
    }
  }
  return null;
}

function fetchHtmlSafe_(url) {
  try {
    const res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    const code = res.getResponseCode();
    if (code >= 200 && code < 300) {
      return res.getContentText('UTF-8');
    }
  } catch (e) {
    // タイムアウトやSSLエラーは静かにスキップ
  }
  return null;
}

function getTargetSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(CORP_COLLECTOR_CONFIG.SHEET_NAME) || ss.getSheets()[0];
}

function loadExistingVideoIds_(sheet) {
  const ids = new Set();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return ids;
  const values = sheet.getRange(2, CORP_COLLECTOR_CONFIG.URL_COLUMN_INDEX, lastRow - 1, 1).getValues();
  for (const row of values) {
    const vid = extractVideoIdFromUrl_(String(row[0] || ''));
    if (vid) ids.add(vid.id);
  }
  return ids;
}

function extractVideoIdFromUrl_(url) {
  const yt = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/);
  if (yt) {
    return { id: yt[1], platform: 'youtube', canonicalUrl: 'https://www.youtube.com/watch?v=' + yt[1] };
  }
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d{7,11})/);
  if (vm) {
    return { id: 'vimeo-' + vm[1], platform: 'vimeo', canonicalUrl: 'https://vimeo.com/' + vm[1] };
  }
  return null;
}

function appendDiscoveredVideos_(sheet, items) {
  if (!items || items.length === 0) return 0;
  const maxCols = Math.max(
    CORP_COLLECTOR_CONFIG.STATUS_COLUMN_INDEX || 1,
    CORP_COLLECTOR_CONFIG.URL_COLUMN_INDEX,
    CORP_COLLECTOR_CONFIG.TITLE_COLUMN_INDEX,
    CORP_COLLECTOR_CONFIG.SOURCE_COLUMN_INDEX || 1
  );
  const rows = [];
  for (const item of items.slice(0, CORP_COLLECTOR_CONFIG.MAX_NEW_VIDEOS_PER_RUN)) {
    const row = new Array(maxCols).fill('');
    if (CORP_COLLECTOR_CONFIG.STATUS_COLUMN_INDEX) {
      row[CORP_COLLECTOR_CONFIG.STATUS_COLUMN_INDEX - 1] = CORP_COLLECTOR_CONFIG.INITIAL_STATUS;
    }
    row[CORP_COLLECTOR_CONFIG.URL_COLUMN_INDEX - 1] = item.url;
    row[CORP_COLLECTOR_CONFIG.TITLE_COLUMN_INDEX - 1] = item.title;
    if (CORP_COLLECTOR_CONFIG.SOURCE_COLUMN_INDEX) {
      row[CORP_COLLECTOR_CONFIG.SOURCE_COLUMN_INDEX - 1] = item.source;
    }
    rows.push(row);
  }
  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, maxCols).setValues(rows);
  }
  return rows.length;
}

function isTimeOrCountLimitReached_(startedAt, count) {
  if (Date.now() - startedAt >= CORP_COLLECTOR_CONFIG.MAX_RUNTIME_MS) return true;
  if (count >= CORP_COLLECTOR_CONFIG.MAX_NEW_VIDEOS_PER_RUN) return true;
  return false;
}
