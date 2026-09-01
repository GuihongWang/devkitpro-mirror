/**
 * curl-impersonate-fetch.ts — 用 curl-impersonate 静态二进制做子进程 HTTP 客户端
 *
 * 为什么用它替代 wreq-js / Node 原生 fetch
 * ----------------------------------------
 * devkitpro.org 上游在 Cloudflare 后面，Node 原生的 TLS 指纹（undici/globalThis.fetch）
 * 会被 403 拦截；之前用的 wreq-js 依赖 native binding，在 Vercel 上 DLOPEN 失败 → 500。
 *
 * 本模块调用仓库自带的 **静态链接** curl-impersonate 二进制（子进程，不依赖任何 native
 * binding），并用 `--impersonate chrome142` 伪装成最新 Chrome 的 TLS 指纹（JA3/JA4 +
 * HTTP/2 SETTINGS）。Cloudflare 只放行 chrome142 这份最新指纹，旧指纹（124/131）会被 403，
 * 因此不要降级 profile。
 *
 * 二进制如何被包含进 Vercel 函数
 * ------------------------------
 * `@vercel/nft` 只会打包 JS 可达的依赖，不会自动带上这个静态二进制。因此构建脚本
 * （scripts/copy-curl-impersonate.mjs）会把 `bin/curl-impersonate` 复制进
 * `.vercel/output/functions/_render.func/bin/curl-impersonate`。运行时解析顺序：
 *   1. 环境变量 `CURL_IMPERSONATE_BIN`（本机测试时可指向 Windows 版）
 *   2. 从本模块所在构建产物目录向上寻找 `bin/curl-impersonate`（在 Vercel 上即函数根 /var/task）
 *   3. `/var/task/bin/curl-impersonate` 兜底
 *
 * 原始字节透传（gzip/brotli 不做自动解压）
 * ----------------------------------------
 * pacman 的 `.db` / apt 的 `Packages.gz` 等文件本身就是 gzip 字节，服务端并非用
 * `Content-Encoding: gzip` 传输，而是真实的 `.gz` 内容。我们：
 *   - **不**传 `--compressed`（但 curl-impersonate 模拟真实 Chrome，仍会发出
 *     `Accept-Encoding: gzip, deflate, br, zstd`，上游可能回传输层压缩）
 *   - 传 `--raw`（禁用 curl 自动解码，保留原始传输字节）
 * 这样拿到的是与上游一致的原始字节，再把上游的 `Content-Encoding` 头原样透传给客户端，
 * 由客户端自行解压——语义与之前 wreq-js 的 `compress:false` 完全一致。
 */

import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BIN_FILENAME = "curl-impersonate";

export interface CurlImpersonateResult {
  status: number;
  statusText: string;
  /** Header keys are lowercased. */
  headers: Record<string, string | undefined>;
  /** Raw (possibly compressed) body bytes exactly as upstream sent them. */
  body: Buffer;
}

export interface CurlImpersonateFetchOptions {
  method?: string;
  ua?: string;
  timeoutMs?: number;
  /** Local-only: proxy to route through. Omit (leave undefined) on Vercel. */
  proxy?: string;
  impersonate?: string;
}

/** 请求失败时抛出的错误会带 `code`：'ETIMEDOUT'=超时，'ENETUNREACH'=连接级失败。 */
export interface CurlImpersonateError extends Error {
  code?: string;
  exitCode?: number;
  cause?: string;
}

/**
 * 解析 curl-impersonate 二进制路径。
 */
export function resolveBinaryPath(): string {
  // 1. 环境变量覆盖（本机测试可指向 Windows 版）
  if (process.env.CURL_IMPERSONATE_BIN) {
    return process.env.CURL_IMPERSONATE_BIN;
  }

  // 2. 从本模块所在目录向上寻找 bin/<BIN_FILENAME>
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    const candidate = path.join(dir, "bin", BIN_FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 3. Vercel 函数根（/var/task）兜底
  const vercelCandidate = path.join("/var/task", "bin", BIN_FILENAME);
  if (existsSync(vercelCandidate)) return vercelCandidate;

  throw new Error(
    `curl-impersonate 二进制未找到。请配置 CURL_IMPERSONATE_BIN，或确认 bin/${BIN_FILENAME} 已就位。`,
  );
}

/** 解析 curl `-D` 头文件输出 → { status, statusText, headers }（headers 小写键） */
function parseHeaders(raw: string): { status: number; statusText: string; headers: Record<string, string> } {
  const lines = raw.replace(/\r/g, "").split("\n");
  let status = 0;
  let statusText = "";
  const headers: Record<string, string> = {};
  for (const line of lines) {
    if (/^HTTP\/\d(\.\d+)?\s+\d{3}/.test(line)) {
      const m = line.match(/^HTTP\/\d(?:\.\d+)?\s+(\d{3})\s*(.*)$/);
      if (m) {
        status = parseInt(m[1], 10);
        statusText = (m[2] || "").trim();
      }
      // 只保留最后一个响应块（-L 跟随重定向后取最终响应）
      Object.keys(headers).forEach((k) => delete headers[k]);
      continue;
    }
    if (line === "" || line.startsWith(" ")) continue;
    const colon = line.indexOf(":");
    if (colon > 0) {
      const key = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim();
      // 保持首个值（多个同名头时取第一个）
      if (!(key in headers)) headers[key] = value;
    }
  }
  return { status, statusText, headers };
}

/**
 * 用 curl-impersonate 发起一次请求。
 * @returns {Promise<CurlImpersonateResult>}
 */
export async function curlImpersonateFetch(
  url: string,
  { method = "GET", ua, timeoutMs = 30_000, proxy, impersonate = "chrome142" }: CurlImpersonateFetchOptions = {},
): Promise<CurlImpersonateResult> {
  const binary = resolveBinaryPath();
  const tmpDir = mkdtempSync(path.join(tmpdir(), "dkr-ci-"));
  const bodyFile = path.join(tmpDir, "body");
  const headerFile = path.join(tmpDir, "headers");

  const args = [
    "-sS",
    "--impersonate", impersonate,
    "-L", // 跟随重定向（上游 3xx），与旧 wreq-js 的 redirect: "follow" 行为一致
    "--raw", // 禁用自动解压，保留原始字节
    "--max-time", String(Math.max(5, Math.round(timeoutMs / 1000))),
    "-o", bodyFile,
    "-D", headerFile,
    "-w", "%{http_code}",
    "-A", ua || "pacman/6.1.0 (Arch Linux)",
    "--url", url,
  ];

  // 本机测试走代理；Vercel 上直连（不传 proxy）
  if (proxy) {
    args.push("--proxy", proxy);
  }

  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      binary,
      args,
      { timeout: timeoutMs + 10_000, windowsHide: true },
      (err, _stdout, stderr) => {
        const cause = (stderr || "").toString().trim();
        if (err) {
          const errCodeRaw = (err as NodeJS.ErrnoException).code;
          const errCode = errCodeRaw as string | number | undefined;
          if (Number(errCode) === 28 || /\(28\)|Operation timed out|timed out/i.test(cause)) {
            const e = new Error(`上游请求超时: ${cause}`) as CurlImpersonateError;
            e.code = "ETIMEDOUT";
            reject(e);
            return;
          }
          const e = new Error(
            `无法连接上游（curl 退出码 ${errCode ?? "?"}）: ${cause || err.message}`,
          ) as CurlImpersonateError;
          e.code = "ENETUNREACH";
          e.exitCode = typeof errCode === "number" ? errCode : undefined;
          reject(e);
          return;
        }
        resolve(_stdout.toString().trim());
      },
    );
  });

  const status = parseInt(stdout, 10) || 0;
  let parsed: { status: number; statusText: string; headers: Record<string, string> };
  try {
    parsed = parseHeaders(readFileSync(headerFile, "utf8"));
  } catch {
    parsed = { status, statusText: "", headers: {} };
  }
  let body: Buffer;
  try {
    body = readFileSync(bodyFile);
  } catch {
    body = Buffer.alloc(0);
  }

  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  return {
    status: parsed.status || status,
    statusText: parsed.statusText,
    headers: parsed.headers,
    body,
  };
}
