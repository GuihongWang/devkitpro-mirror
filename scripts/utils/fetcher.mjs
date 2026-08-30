/**
 * fetcher.mjs - 通用抓取工具
 * 带重试、限流、超时、错误分类
 *
 * 传输层：优先使用 curl（scripts/utils/curl-fetch.mjs），因为 devkitpro.org
 * 的 Cloudflare 风控会拦截 undici 的 TLS 指纹（全部 403）；curl 的 TLS 指纹
 * 可过 Cloudflare。curl 不可用时回退到 undici fetch。
 */

import pLimit from 'p-limit';
import { setupProxy } from './proxy.mjs';
import { curlGet, hasCurl } from './curl-fetch.mjs';

// ── ANSI 颜色 ──
const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

// ── 日志 ──
export function logInfo(msg)  { console.log(`${C.cyan('[INFO]')}  ${msg}`); }
export function logOk(msg)    { console.log(`${C.green('[OK]')}    ${msg}`); }
export function logWarn(msg)  { console.log(`${C.yellow('[WARN]')}  ${msg}`); }
export function logErr(msg)   { console.error(`${C.red('[ERROR]')} ${msg}`); }
export function logStep(msg)  { console.log(`${C.bold(C.cyan('▸'))} ${msg}`); }

// ── 并发限制 ──
const defaultLimit = pLimit(3);

// ── 错误分类 ──
export class FetchError extends Error {
  constructor(message, type, status, url) {
    super(message);
    this.name = 'FetchError';
    this.type = type;   // 'rate-limit' | 'server' | 'timeout' | 'network' | 'http'
    this.status = status;
    this.url = url;
  }
}

// ── curl 响应包装为类 Response 对象（向下兼容 fetch Response 用法）──
class CurlResponse {
  constructor({ status, headers = {}, body = '', url = '' }) {
    this.status = status;
    this.ok = status >= 200 && status < 300;
    this.url = url;
    this.headers = new Headers();
    for (const [k, v] of Object.entries(headers)) {
      try {
        this.headers.set(k, v);
      } catch {
        /* 忽略非法头名（如 set-cookie 带多个值） */
      }
    }
    this._body = body;
  }

  async text() {
    return this._body;
  }

  async json() {
    return JSON.parse(this._body);
  }
}

/**
 * 带重试 + 超时 + 限流的 fetch
 * 传输层优先级：curl（可过 Cloudflare）> undici fetch（回退）
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.maxRetries=7]
 * @param {number} [opts.timeout=30000]
 * @param {number} [opts.retryDelay=1200]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, opts = {}) {
  const {
    maxRetries = 7,
    timeout = 30000,
    retryDelay = 1200,
    signal: externalSignal,
  } = opts;

  let lastError;

  // 退避时长：指数增长但封顶 20s（代理/Cloudflare 波动可能持续数十秒）
  const bw = (attempt) => Math.min(retryDelay * 2 ** (attempt - 1), 20000);

  // 先确保代理就绪（幂等，走环境变量），使抓取流量可经代理
  await setupProxy();

  // 探测 curl 是否可用（结果缓存到局部，ENOENT 时置 false 回退 undici）
  let curlOk = await hasCurl();
  if (!curlOk) {
    logWarn('未检测到 curl，传输层将使用 undici fetch（可能被 Cloudflare 拦截）');
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    // 如果外部有 signal，监听它来取消内部 controller
    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        clearTimeout(timer);
        throw new FetchError('Request aborted', 'timeout', 0, url);
      }
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }

    const cleanup = () => {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    };

    try {
      let res;

      if (curlOk) {
        // ── 首选 curl 传输层 ──
        try {
          const c = await curlGet(url, { timeout });
          res = new CurlResponse(c);
        } catch (err) {
          if (err.code === 'ENOENT' || /找不到 curl/.test(err.message)) {
            // curl 不存在 → 本请求及后续回退 undici
            curlOk = false;
            logWarn(`curl 不可用（${err.message}），回退 undici fetch`);
          } else {
            // 网络 / 超时错误：交给外层统一重试，不在此回退 undici
            // （undici 无论如何会被 Cloudflare 拦，只有 curl 缺失才值得回退）
            throw err;
          }
        }
      }

      if (!curlOk) {
        // ── 回退：undici fetch（直连或经 proxy.mjs 的 ProxyAgent）──
        res = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'DevkitPro-Mirror/1.0 (static-site-mirror)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        });
      }

      // 429 限流
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('retry-after') || '5', 10);
        const waitMs = Math.min(Math.max(retryAfter * 1000, bw(attempt)), 30000);
        logWarn(`429 限流 ${url} — 等待 ${waitMs}ms 后重试 (${attempt}/${maxRetries})`);
        cleanup();
        await sleep(waitMs);
        lastError = new FetchError(`Rate limited: ${url}`, 'rate-limit', 429, url);
        continue;
      }

      // 5xx 服务器错误 → 重试
      if (res.status >= 500 && res.status < 600) {
        const waitMs = bw(attempt);
        logWarn(`${res.status} 服务器错误 ${url} — ${waitMs}ms 后重试 (${attempt}/${maxRetries})`);
        cleanup();
        await sleep(waitMs);
        lastError = new FetchError(`Server error ${res.status}: ${url}`, 'server', res.status, url);
        continue;
      }

      // 403 Forbidden → 可能是 Cloudflare 风控 / 代理节点波动，指数退避重试
      if (res.status === 403) {
        const waitMs = bw(attempt);
        logWarn(`403 ${url} — ${waitMs}ms 后重试 (${attempt}/${maxRetries})：可能被 Cloudflare 拦截或代理节点波动`);
        cleanup();
        await sleep(waitMs);
        lastError = new FetchError(`Forbidden ${res.status}: ${url}`, 'http', res.status, url);
        continue;
      }

      // 其他非 2xx
      if (!res.ok) {
        throw new FetchError(`HTTP ${res.status}: ${url}`, 'http', res.status, url);
      }

      cleanup();
      return res;
    } catch (err) {
      cleanup();

      if (err.name === 'AbortError' || err.timedOut || err.type === 'timeout') {
        const waitMs = bw(attempt);
        logWarn(`超时 ${url} — ${waitMs}ms 后重试 (${attempt}/${maxRetries})`);
        await sleep(waitMs);
        lastError = new FetchError(`Timeout: ${url}`, 'timeout', 0, url);
      } else if (err instanceof FetchError && err.type === 'http') {
        throw err; // 非重试错误直接抛出
      } else {
        const waitMs = bw(attempt);
        logWarn(`网络错误 ${url} — ${waitMs}ms 后重试 (${attempt}/${maxRetries}): ${err.message}`);
        await sleep(waitMs);
        lastError = new FetchError(`Network error: ${err.message}`, 'network', 0, url);
      }
    }
  }

  throw lastError;
}

/**
 * 用限流包装的 fetch
 * @param {string} url
 * @param {object} opts
 * @param {boolean} [opts.limited=true]  是否使用限流
 * @param {number}  [opts.interval=500]  请求间隔 ms
 */
export async function throttledFetch(url, opts = {}) {
  const { limited = true, interval = 500, ...fetchOpts } = opts;

  if (!limited) return fetchWithRetry(url, fetchOpts);

  return defaultLimit(async () => {
    const result = await fetchWithRetry(url, fetchOpts);
    await sleep(interval);
    return result;
  });
}

/**
 * 批量抓取 URL 列表
 * @param {string[]} urls
 * @param {(url: string, res: Response) => Promise<void>} handler
 * @param {object} opts
 */
export async function fetchAll(urls, handler, opts = {}) {
  const { concurrency = 3, interval = 500, onProgress, ...fetchOpts } = opts;
  const limit = pLimit(concurrency);
  let done = 0;
  const total = urls.length;
  const errors = [];

  const tasks = urls.map((url) =>
    limit(async () => {
      try {
        const res = await throttledFetch(url, { limited: false, ...fetchOpts });
        await handler(url, res);
      } catch (err) {
        errors.push({ url, error: err });
        logWarn(`跳过 ${url}: ${err.message}`);
      }
      done++;
      if (onProgress) onProgress(done, total);
      else if (done % 20 === 0 || done === total) {
        logInfo(`进度: ${done}/${total}`);
      }
      // 每次请求后间隔
      await sleep(interval);
    })
  );

  await Promise.allSettled(tasks);

  return { done, total, errors };
}

/** sleep 工具 */
export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export { C };
