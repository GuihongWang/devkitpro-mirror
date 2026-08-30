/**
 * change-detector.mjs — 轻量变化检测器
 *
 * 通过 HEAD 请求检测 Last-Modified / ETag，无则 GET 计算内容 hash，
 * 判断各个模块的原站内容是否发生了变化。
 *
 * 网络请求统一走 curl 传输层（scripts/utils/curl-fetch.mjs）——Cloudflare
 * 风控会拦截 undici 的 TLS 指纹，curl 可正常访问且原生支持代理。
 *
 * 所有函数返回统一结构：
 *   { changed: boolean, hash: string|null, error: string|null, lastModified: string|null }
 */

import { createHash } from 'node:crypto';
import { curlHead, curlGet } from './curl-fetch.mjs';

// ── 常量 ──
// MediaWiki API 的正确路径是 /w/api.php（/wiki/api.php 是 404）
const WIKI_API_URL =
  'https://devkitpro.org/w/api.php?action=query&list=recentchanges&rclimit=5&rctype=edit|new&rcprop=timestamp|ids&format=json';
// 论坛在 devkitpro.org 根路径（phpBB 门户），/forum/ 子路径已移除（404）
const FORUM_URL = 'https://devkitpro.org/';

const DOC_SITES = {
  libnds: 'https://libnds.devkitpro.org/index.html',
  maxmod: 'https://maxmod.devkitpro.org/index.html',
};

// packages 无 HTML 目录索引（/packages/ 404），用 pacman 数据库文件做变化检测
const PKG_INDEX_URL = 'https://pkg.devkitpro.org/packages/dkp-libs.db';

// ── SHA-256 摘要（取前 16 位）──
function computeHash(content) {
  if (content == null) return null;
  return createHash('sha256').update(String(content)).digest('hex').slice(0, 16);
}

// 秒级精度比较（RFC1123 Last-Modified 无毫秒）
function isModifiedSince(lastModified, sinceIso) {
  if (!lastModified || !sinceIso) return false;
  const lm = new Date(lastModified).getTime();
  const since = new Date(sinceIso).getTime();
  if (Number.isNaN(lm) || Number.isNaN(since)) return false;
  // Last-Modified 为秒级，允许 1 秒误差
  return lm - since > 1000;
}

// ── 轻量重试（代理不稳定，间歇 TLS 握手失败/连接重置）──
async function withRetry(fn, { attempts = 4, baseDelay = 1000 } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts) {
        const delay = baseDelay * 2 ** (i - 1) + Math.floor(Math.random() * 400);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

// ── HEAD 请求辅助（curl）──
async function headFetch(url, timeoutMs = 15000) {
  return withRetry(async () => {
    const r = await curlHead(url, { timeout: timeoutMs });
    if (r.status === 429 || r.status >= 500) {
      throw new Error(`HTTP ${r.status} ${url}`);
    }
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      lastModified: r.headers['last-modified'] || null,
      etag: r.headers['etag'] || null,
    };
  });
}

// ── GET 请求辅助（curl）──
async function getFetch(url, timeoutMs = 15000) {
  return withRetry(async () => {
    const r = await curlGet(url, { timeout: timeoutMs });
    if (!(r.status >= 200 && r.status < 300)) throw new Error(`HTTP ${r.status} ${url}`);
    return r.body;
  });
}

function wrapError(err, label) {
  return { changed: false, hash: null, error: `${label}: ${err.message}`, lastModified: null };
}

function okResult(changed, hash, lastModified) {
  return { changed, hash, error: null, lastModified: lastModified ?? null };
}

/**
 * Wiki 变化检测：
 * 调用 recentchanges API，取最近编辑时间戳与 lastScrapedAt 比较。
 * hash：拼接 5 条 recentchanges 的 revid 计算。
 * @param {string|null} lastScrapedAt ISO 时间
 * @returns {Promise<object>}
 */
export async function checkWiki(lastScrapedAt) {
  try {
    const body = await getFetch(WIKI_API_URL);
    const data = JSON.parse(body);
    const changes = data?.query?.recentchanges || [];

    const hash = computeHash(changes.map((c) => c.revid).join(','));

    // 取最近一条编辑时间戳
    const latestTimestamp = changes.length > 0 ? changes[0].timestamp || changes[0].revid : null;
    const changed = latestTimestamp
      ? isModifiedSince(latestTimestamp, lastScrapedAt)
      : false;

    return okResult(changed, hash, latestTimestamp);
  } catch (err) {
    return wrapError(err, 'wiki 检测失败');
  }
}

/**
 * Forum 变化检测：
 * HEAD /forum/ 检查 Last-Modified 头；若无则 GET 首页计算 hash。
 * @param {string|null} lastScrapedAt ISO 时间
 * @param {object} [opts] opts.lastCheckHash 用于对比上次 hash
 * @returns {Promise<object>}
 */
export async function checkForum(lastScrapedAt, opts = {}) {
  try {
    // 优先 HEAD 取 Last-Modified
    const head = await headFetch(FORUM_URL);
    if (head.ok && head.lastModified) {
      const changed = isModifiedSince(head.lastModified, lastScrapedAt);
      return okResult(changed, null, head.lastModified);
    }

    // 无 Last-Modified → GET 首页计算 hash
    const html = await getFetch(FORUM_URL);
    const hash = computeHash(html);
    const changed = opts.lastCheckHash ? hash !== opts.lastCheckHash : false;
    return okResult(changed, hash, null);
  } catch (err) {
    return wrapError(err, 'forum 检测失败');
  }
}

/**
 * 单个 Docs 站点变化检测（HEAD index.html 的 Last-Modified）
 * @param {string} host  host，如 libnds
 * @param {string|null} lastScrapedAt
 */
async function checkDocsSite(host, lastScrapedAt) {
  try {
    const head = await headFetch(DOC_SITES[host]);
    if (head.ok && head.lastModified) {
      const changed = isModifiedSince(head.lastModified, lastScrapedAt);
      return okResult(changed, null, head.lastModified);
    }
    // 无 Last-Modified：退化为“未知”，不误判为变化
    return okResult(false, null, null);
  } catch (err) {
    return wrapError(err, `${host} 检测失败`);
  }
}

/**
 * Docs 变化检测：合并 libnds + maxmod 两个站点
 * – 任一站点失败则视为整体 error（不抓）。
 * – 任一站点变化即 changed=true。
 * @param {string|null} lastScrapedAt
 * @returns {Promise<object>}
 */
export async function checkDocs(lastScrapedAt) {
  const [libnds, maxmod] = await Promise.all([
    checkDocsSite('libnds', lastScrapedAt),
    checkDocsSite('maxmod', lastScrapedAt),
  ]);

  const errors = [libnds.error, maxmod.error].filter(Boolean);
  if (errors.length > 0) {
    return { changed: false, hash: null, error: errors.join('; '), lastModified: null };
  }

  const changed = libnds.changed || maxmod.changed;
  const lastModified = (libnds.lastModified || maxmod.lastModified) ?? null;
  const hash = computeHash([libnds.lastModified, maxmod.lastModified].join('|')) || null;
  return { changed, hash, error: null, lastModified };
}

/** 单独检测 libnds 官网文档 */
export async function checkDocsLibnds(lastScrapedAt) {
  return checkDocsSite('libnds', lastScrapedAt);
}

/** 单独检测 maxmod 官网文档 */
export async function checkDocsMaxmod(lastScrapedAt) {
  return checkDocsSite('maxmod', lastScrapedAt);
}

/**
 * Packages 变化检测：HEAD 包索引目录的 Last-Modified
 * @param {string|null} lastScrapedAt
 * @returns {Promise<object>}
 */
export async function checkPackages(lastScrapedAt) {
  try {
    const head = await headFetch(PKG_INDEX_URL);
    if (head.ok && head.lastModified) {
      const changed = isModifiedSince(head.lastModified, lastScrapedAt);
      return okResult(changed, null, head.lastModified);
    }
    return okResult(false, null, null);
  } catch (err) {
    return wrapError(err, 'packages 检测失败');
  }
}

// ── 独立运行（调试）──
if (process.argv[1] && process.argv[1].endsWith('change-detector.mjs')) {
  const name = process.argv[2] || 'all';
  const lastScrapedAt = process.argv[3] || null;
  (async () => {
    const checks = {
      wiki: checkWiki,
      forum: checkForum,
      docs: checkDocs,
      packages: checkPackages,
    };
    if (name === 'all') {
      for (const [k, fn] of Object.entries(checks)) {
        console.log(k, await fn(lastScrapedAt));
      }
    } else if (checks[name]) {
      console.log(name, await checks[name](lastScrapedAt));
    } else {
      console.log('用法: node scripts/utils/change-detector.mjs [wiki|forum|docs|packages|all] [lastScrapedAtIso]');
    }
  })();
}
