/**
 * curl-fetch.mjs — curl 传输层
 *
 * 用系统 curl 替代 undici fetch，因为 devkitpro.org 已启用 Cloudflare
 * 风控：undici 等 Node 原生 TLS 指纹被拦截（全部 403），而 curl 的 TLS
 * 指纹可过 Cloudflare，且原生支持通过 HTTPS_PROXY / HTTP_PROXY 走代理。
 *
 * 每个请求自动附加浏览器 UA 以获得 Cloudflare 放行。
 * 返回与 fetch 相近的结构：{ status, headers, body, url }。
 *
 * 代理不稳定（间歇 TLS 握手失败 / 连接重置）时由上层重试，本模块单次调用
 * 只发起一次 curl。curl 不可用（ENOENT）时抛出的错误带 code='ENOENT'，
 * 调用方可以据此回退到 undici fetch。
 */

import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getProxyEnvUrl } from './proxy.mjs';

// ── 浏览器 UA：Cloudflare 用它放行，缺省 UA 会 403 ──
export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// ── 执行一次 curl，返回 { stdout } 或抛带属性的错误 ──
function curlExec(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile('curl', args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        // Windows 上可能名为 curl.exe（Linux 上 curl.exe 会 ENOENT，自动回退）
        if (err.code === 'ENOENT') {
          execFile('curl.exe', args, { timeout: timeoutMs, windowsHide: true }, (err2, stdout2) => {
            if (err2) {
              reject(err2);
            } else {
              resolve(stdout2);
            }
          });
          return;
        }
        const cause = (stderr || err.message || '').trim();
        if (err.killed || /exit code 28|\(28\)|Operation timed out/i.test(cause)) {
          reject(Object.assign(new Error(`curl 超时: ${cause}`), { timedOut: true, cause }));
        } else if (/\(35\)|SSL connect error/i.test(cause)) {
          reject(Object.assign(new Error(`curl TLS 握手失败: ${cause}`), { network: true, cause }));
        } else if (/\(56\)|Failure when receiving/i.test(cause)) {
          reject(Object.assign(new Error(`curl 接收数据被中断: ${cause}`), { network: true, cause }));
        } else if (/\(52\)|Empty reply/i.test(cause)) {
          reject(Object.assign(new Error(`curl 空回复(52): ${cause}`), { network: true, cause }));
        } else if (/\(7\)|Failed to connect/i.test(cause)) {
          reject(Object.assign(new Error(`curl 连接失败(7): ${cause}`), { network: true, cause }));
        } else if (/\(18\)|transfer closed/i.test(cause)) {
          reject(Object.assign(new Error(`curl 传输中断(18): ${cause}`), { network: true, cause }));
        } else if (/\(60\)|certificate/i.test(cause)) {
          reject(Object.assign(new Error(`curl 证书错误: ${cause}`), { network: true, cause }));
        } else {
          reject(Object.assign(new Error(`curl 失败: ${cause || err.message}`), { network: true, cause, code: err.code }));
        }
        return;
      }
      resolve(stdout);
    });
  });
}

// ── 构造基础 curl 参数：代理显式 --proxy，浏览器 UA，跟随重定向 ──
function baseArgs({ compressed = true } = {}) {
  const args = [
    '-sS',
    '-L',
    '--connect-timeout', '10',
    '-A', BROWSER_UA,
  ];
  if (compressed) args.push('--compressed');
  const proxy = getProxyEnvUrl();
  if (proxy) args.push('--proxy', proxy);
  return args;
}

/**
 * 解析 curl -D 输出的响应头文本 → { status, headers, rawHeaders }
 * 支持 -L 跟随重定向产生的多组 Status-Line：取最后一组作为最终响应。
 * @param {string} raw header 文本
 */
export function parseCurlHeaders(raw) {
  const lines = raw.replace(/\r/g, '').split('\n');
  let status = 0;
  const headers = {};
  const rawHeaders = [];

  for (const line of lines) {
    if (/^HTTP\/\d+(\.\d+)?\s+\d{3}/.test(line)) {
      const m = line.match(/HTTP\/\d+(?:\.\d+)?\s+(\d{3})/);
      status = m ? parseInt(m[1], 10) : 0;
      rawHeaders.length = 0; // 重置：只保留最后一个响应块
      continue;
    }
    if (line === '' || line.startsWith('__DK_')) continue; // 空行 / 写出行
    const colon = line.indexOf(':');
    if (colon > 0) {
      const key = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim();
      rawHeaders.push({ key, value });
      if (!(key in headers)) headers[key] = value;
    }
  }
  return { status, headers, rawHeaders };
}

/**
 * GET 请求
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.timeout=30000] 毫秒
 * @param {boolean} [opts.binary=false] 为 true 时 body 返回 Buffer（用于二进制下载，
 *   并禁用 --compressed，避免服务端 Content-Encoding 导致自动解压）
 * @returns {Promise<{status:number, headers:object, body:string|Buffer, url:string}>}
 */
export async function curlGet(url, { timeout = 30000, binary = false } = {}) {
  const tmpDir = mkdtempSync(join(tmpdir(), 'dkr-'));
  const bodyFile = join(tmpDir, 'body');
  try {
    const args = [
      ...baseArgs({ compressed: !binary }),
      '--max-time', String(Math.max(10, Math.round(timeout / 1000))),
      '-o', bodyFile,
      '-D', '-',
      '-w', '\n__DK_STATUS:%{http_code}__DK_URL:%{url_effective}\n',
      '--url', url,
    ];
    const stdout = await curlExec(args, timeout + 5000);
    const { status, headers } = parseCurlHeaders(stdout);
    let body;
    try {
      body = readFileSync(bodyFile, binary ? undefined : 'utf-8');
    } catch {
      body = binary ? Buffer.alloc(0) : '';
    }
    const urlMatch = stdout.match(/__DK_URL:(\S+)/);
    return { status, headers, body, url: (urlMatch && urlMatch[1]) || url };
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * HEAD 请求（只取响应头）
 * @param {string} url
 * @param {object} [opts]
 * @returns {Promise<{status:number, headers:object}>}
 */
export async function curlHead(url, { timeout = 30000 } = {}) {
  const args = [
    ...baseArgs(),
    '-I',
    '--max-time', String(Math.max(10, Math.round(timeout / 1000))),
    '-D', '-',
    '-w', '\n__DK_STATUS:%{http_code}__DK_URL:%{url_effective}\n',
    '--url', url,
  ];
  const stdout = await curlExec(args, timeout + 5000);
  const { status, headers } = parseCurlHeaders(stdout);
  return { status, headers };
}

/**
 * curl 是否可用（供 fetcher 判断是否回退 undici）
 * @returns {Promise<boolean>}
 */
export async function hasCurl() {
  const probe = async (bin) =>
    new Promise((resolve) => {
      execFile(bin, ['--version'], { timeout: 5000, windowsHide: true }, (err) =>
        resolve(!err)
      );
    });
  return (await probe('curl')) || (await probe('curl.exe'));
}