/**
 * fetcher.mjs - 通用抓取工具
 * 带重试、限流、超时、错误分类
 */

import pLimit from 'p-limit';

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

/**
 * 带重试 + 超时 + 限流的 fetch
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.maxRetries=3]
 * @param {number} [opts.timeout=30000]
 * @param {number} [opts.retryDelay=1000]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, opts = {}) {
  const {
    maxRetries = 3,
    timeout = 30000,
    retryDelay = 1000,
    signal: externalSignal,
  } = opts;

  let lastError;

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

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'DevkitPro-Mirror/1.0 (static-site-mirror)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);

      // 429 限流
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('retry-after') || '5', 10);
        const waitMs = Math.max(retryAfter * 1000, retryDelay * 2 ** attempt);
        logWarn(`429 限流 ${url} — 等待 ${waitMs}ms 后重试 (${attempt}/${maxRetries})`);
        await sleep(waitMs);
        lastError = new FetchError(`Rate limited: ${url}`, 'rate-limit', 429, url);
        continue;
      }

      // 5xx 服务器错误 → 重试
      if (res.status >= 500 && res.status < 600) {
        const waitMs = retryDelay * 2 ** (attempt - 1);
        logWarn(`${res.status} 服务器错误 ${url} — ${waitMs}ms 后重试 (${attempt}/${maxRetries})`);
        await sleep(waitMs);
        lastError = new FetchError(`Server error ${res.status}: ${url}`, 'server', res.status, url);
        continue;
      }

      // 其他非 2xx
      if (!res.ok) {
        throw new FetchError(`HTTP ${res.status}: ${url}`, 'http', res.status, url);
      }

      return res;
    } catch (err) {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);

      if (err.name === 'AbortError' || err.type === 'timeout') {
        const waitMs = retryDelay * 2 ** (attempt - 1);
        logWarn(`超时 ${url} — ${waitMs}ms 后重试 (${attempt}/${maxRetries})`);
        await sleep(waitMs);
        lastError = new FetchError(`Timeout: ${url}`, 'timeout', 0, url);
      } else if (err instanceof FetchError && err.type === 'http') {
        throw err; // 非重试错误直接抛出
      } else {
        const waitMs = retryDelay * 2 ** (attempt - 1);
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
