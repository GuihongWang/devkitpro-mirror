/**
 * docs-scraper.mjs - Doxygen 文档爬虫
 * 抓取 libnds.devkitpro.org 和 maxmod.devkitpro.org 的 API 文档
 * 递归抓取 HTML，保留相对路径结构
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { throttledFetch, logInfo, logOk, logWarn, logErr, logStep, sleep } from '../utils/fetcher.mjs';

// ── 要抓取的文档站点 ──
const DOC_SITES = [
  {
    name: 'libnds',
    baseUrl: 'https://libnds.devkitpro.org',
    outputDir: 'public/docs/libnds',
  },
  {
    name: 'maxmod',
    baseUrl: 'https://maxmod.devkitpro.org',
    outputDir: 'public/docs/maxmod',
  },
];

const ROOT_OUTPUT = join(import.meta.dirname, '../../');
const MAX_DEPTH = 6;
const MAX_PAGES = 500;
const REQUEST_INTERVAL = 600;

// ── 从 HTML 提取链接 ──
function extractLinks(html, currentUrl) {
  const links = new Set();
  // 匹配 href="xxx" 中的链接
  const regex = /href="([^"#]*)"[^>]*>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    let href = match[1];
    if (!href || href.startsWith('mailto:') || href.startsWith('javascript:')) continue;
    try {
      const resolved = new URL(href, currentUrl);
      links.add(resolved.href);
    } catch { /* skip invalid */ }
  }
  return [...links];
}

// ── 判断是否是同一站点的页面 ──
function isSameSite(url, baseUrl) {
  try {
    const u = new URL(url);
    const b = new URL(baseUrl);
    return u.hostname === b.hostname;
  } catch {
    return false;
  }
}

// ── 获取 URL 对应的本地文件路径 ──
function urlToFilePath(url, baseUrl, outputDir) {
  try {
    const u = new URL(url);
    const b = new URL(baseUrl);
    let path = u.pathname;
    // 去掉开头的 /
    path = path.replace(/^\//, '');
    if (!path || path.endsWith('/')) path += 'index.html';
    return join(ROOT_OUTPUT, outputDir, path);
  } catch {
    return null;
  }
}

// ── 抓取单个站点 ──
async function scrapeSite(site) {
  const { name, baseUrl, outputDir } = site;
  logStep(`═══ 文档站点: ${name} (${baseUrl}) ═══`);

  const outDir = join(ROOT_OUTPUT, outputDir);
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  const visited = new Set();
  const queue = [{ url: baseUrl, depth: 0 }];
  let success = 0;
  let failed = 0;

  while (queue.length > 0 && visited.size < MAX_PAGES) {
    const { url, depth } = queue.shift();

    // 跳过已访问
    const normalized = url.replace(/\/index\.html$/, '/').replace(/\/$/, '');
    if (visited.has(normalized)) continue;

    // 跳过超出深度
    if (depth > MAX_DEPTH) continue;

    // 只处理同站点
    if (!isSameSite(url, baseUrl)) continue;

    // 跳过非 HTML 资源
    if (/\.(css|js|png|jpg|gif|svg|ico|woff|ttf|pdf|zip|tar|gz)$/i.test(url)) continue;

    visited.add(normalized);

    try {
      logInfo(`[${visited.size}] 深度=${depth} ${url}`);
      const res = await throttledFetch(url, { interval: REQUEST_INTERVAL });
      const contentType = res.headers.get('content-type') || '';

      // 只处理 HTML
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        logInfo(`  跳过非 HTML: ${contentType}`);
        continue;
      }

      const html = await res.text();

      // 保存 HTML
      const filePath = urlToFilePath(url, baseUrl, outputDir);
      if (filePath) {
        const fileDir = dirname(filePath);
        if (!existsSync(fileDir)) {
          mkdirSync(fileDir, { recursive: true });
        }
        writeFileSync(filePath, html, 'utf-8');
        success++;
      }

      // 提取链接，加入队列
      const links = extractLinks(html, url);
      for (const link of links) {
        if (!visited.has(link.replace(/\/index\.html$/, '/').replace(/\/$/, ''))) {
          queue.push({ url: link, depth: depth + 1 });
        }
      }
    } catch (err) {
      logWarn(`  失败: ${url} — ${err.message}`);
      failed++;
    }
  }

  logOk(`文档站点 ${name} 完成`);
  logInfo(`  保存页面: ${success}`);
  logInfo(`  失败: ${failed}`);
  logInfo(`  总访问: ${visited.size}`);

  return { name, success, failed, visited: visited.size };
}

// ── 主入口 ──
export async function scrapeDocs() {
  logStep('═══ Doxygen 文档爬虫 ═══');
  const results = [];

  for (const site of DOC_SITES) {
    try {
      const result = await scrapeSite(site);
      results.push(result);
    } catch (err) {
      logErr(`站点 ${site.name} 爬取崩溃: ${err.message}`);
      results.push({ name: site.name, success: 0, failed: 0, visited: 0, error: err.message });
    }
  }

  logOk('文档爬取全部完成');
  for (const r of results) {
    logInfo(`  ${r.name}: 保存=${r.success} 失败=${r.failed}`);
  }

  return results;
}

// ── 独立运行 ──
if (process.argv[1] && process.argv[1].endsWith('docs-scraper.mjs')) {
  scrapeDocs().catch((err) => {
    logErr(`文档爬虫崩溃: ${err.message}`);
    process.exit(1);
  });
}
