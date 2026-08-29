/**
 * wiki-scraper.mjs - MediaWiki 爬虫
 * 抓取 devkitpro.org wiki 的所有页面，转为 Markdown
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { throttledFetch, logInfo, logOk, logWarn, logErr, logStep, sleep } from '../utils/fetcher.mjs';
import { htmlToMarkdown, frontmatter } from '../utils/converter.mjs';

const WIKI_API = 'https://devkitpro.org/wiki/api.php';
const WIKI_BASE = 'https://devkitpro.org/wiki/';
const OUTPUT_DIR = join(import.meta.dirname, '../../src/content/wiki');

// ── 获取所有页面列表 ──
async function getAllPages() {
  const pages = [];
  let continueParam = '';
  let batch = 0;

  logStep('获取 Wiki 页面列表…');

  while (true) {
    batch++;
    const params = new URLSearchParams({
      action: 'query',
      list: 'allpages',
      aplimit: '500',
      format: 'json',
    });
    if (continueParam) params.set('apcontinue', continueParam);

    const url = `${WIKI_API}?${params.toString()}`;
    const res = await throttledFetch(url, { interval: 500 });
    const data = await res.json();

    const batchPages = data?.query?.allpages || [];
    pages.push(...batchPages.map((p) => p.title));

    logInfo(`  批次 ${batch}: 获取 ${batchPages.length} 个页面 (累计 ${pages.length})`);

    if (data.continue?.apcontinue) {
      continueParam = data.continue.apcontinue;
      await sleep(500);
    } else {
      break;
    }
  }

  return pages;
}

// ── 获取单个页面内容 ──
async function getPageContent(title) {
  const params = new URLSearchParams({
    action: 'parse',
    page: title,
    format: 'json',
    prop: 'text|displaytitle',
  });

  const url = `${WIKI_API}?${params.toString()}`;
  const res = await throttledFetch(url, { interval: 500 });
  const data = await res.json();

  if (data.error) {
    throw new Error(`API error: ${data.error.info}`);
  }

  return {
    html: data.parse?.text?.['*'] || '',
    displayTitle: data.parse?.displaytitle || title,
  };
}

// ── 清理文件名 ──
function sanitizeFilename(title) {
  return title
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .trim();
}

// ── 主入口 ──
export async function scrapeWiki() {
  logStep('═══ Wiki 爬虫 ═══');

  // 确保输出目录存在
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const titles = await getAllPages();
  logInfo(`共找到 ${titles.length} 个页面`);

  let success = 0;
  let failed = 0;
  const failedPages = [];

  for (let i = 0; i < titles.length; i++) {
    const title = titles[i];
    const progress = `[${i + 1}/${titles.length}]`;

    try {
      logInfo(`${progress} 抓取: ${title}`);
      const { html, displayTitle } = await getPageContent(title);

      if (!html) {
        logWarn(`${progress} 空内容: ${title}`);
        failed++;
        failedPages.push(title);
        continue;
      }

      // 转 Markdown
      const md = htmlToMarkdown(html, WIKI_BASE);

      // 添加 frontmatter
      const meta = {
        title: displayTitle.replace(/<[^>]+>/g, ''), // 清除 HTML 标签
        original_url: `${WIKI_BASE}${encodeURIComponent(title)}`,
        scraped_at: new Date().toISOString(),
      };

      const filename = sanitizeFilename(title) + '.md';
      const filePath = join(OUTPUT_DIR, filename);
      const content = frontmatter(meta) + md + '\n';

      writeFileSync(filePath, content, 'utf-8');
      success++;

      if ((i + 1) % 20 === 0) {
        logInfo(`  进度: ${i + 1}/${titles.length} (成功: ${success}, 失败: ${failed})`);
      }
    } catch (err) {
      logWarn(`${progress} 失败: ${title} — ${err.message}`);
      failed++;
      failedPages.push(title);
    }
  }

  // ── 输出统计 ──
  logOk('Wiki 爬取完成');
  logInfo(`  总页面: ${titles.length}`);
  logInfo(`  成功: ${success}`);
  logInfo(`  失败: ${failed}`);
  if (failedPages.length > 0) {
    logWarn(`  失败页面: ${failedPages.slice(0, 10).join(', ')}${failedPages.length > 10 ? '...' : ''}`);
  }

  return { success, failed, total: titles.length, failedPages };
}

// ── 独立运行 ──
if (process.argv[1] && process.argv[1].endsWith('wiki-scraper.mjs')) {
  scrapeWiki().catch((err) => {
    logErr(`Wiki 爬虫崩溃: ${err.message}`);
    process.exit(1);
  });
}
