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
import { mkdtempSync, readFileSync, rmSync, existsSync, statSync, accessSync, constants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BIN_FILENAME = "curl-impersonate";

/**
 * 模块加载期的静态状态：`node:child_process` 是否可被导入。
 *
 * 本模块顶部就 `import { execFile } from "node:child_process"`——若模块能加载到底部
 * 并被调用到此，证明该导入已成功；否则模块本身在加载阶段就崩了（假设 B）。
 * 这只是静态标记，绝不 spawn/execFile 任何进程。
 */
export function childProcessLoadable(): boolean {
  // 顶部的静态 `import { execFile }` 能成功执行到,说明 child_process 可加载。
  return true;
}

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

/**
 * 纯 fs 诊断（== 假设 A / B 的二分关键 ==）。
 *
 * 本接口代表 `__diag` **默认**（无 `?__exec=1`）应返回的内容：全部是同步 fs / 直接读，
 * **绝不调用 execFile/spawn 任何进程**。若这个纯 fs 版返回 200 JSON → `_render` Lambda
 * 函数与模块加载正常，问题在「执行二进制」→ 支持假设 A。若仍 FUNCTION_INVOCATION_FAILED
 * → `_render` 函数级 / 模块加载问题 → 支持假设 B，与二进制无关。
 */
export interface BinaryDiagFs {
  kind: "fs-only" | "exec";
  /** resolveBinaryPath() 解析出的路径（可能不带具体二进制是否存在）。 */
  path: string;
  exists: boolean;
  executable: boolean;
  size: number | null;
  isFile: boolean;
  mode: string | null;
  /** 环境变量是否覆盖了二进制路径。 */
  fromEnv: boolean;
  /** 解析二进制路径是否抛错（resolveBinaryPath 失败时的错误消息）。 */
  resolveError: string | null;
  /** 进程信息。 */
  process: {
    version: string;
    platform: string;
    arch: string;
  };
  /** process.report.getReport() 里的 glibc/OS 信息（若可用）。 */
  glibc: Record<string, unknown> | null;
  /** child_process 模块在本模块加载期是否可导入（静态标记，不 spawn）。 */
  childProcessLoadable: boolean;
}

/**
 * 仅执行纯 fs 检查（绝不 spawn）。同步，不抛错——任何 stat/access 失败都折叠成字段返回。
 * 用于 `__diag` 默认路径。
 */
function safeStat(binPath: string): { size: number | null; isFile: boolean; mode: string | null } {
  try {
    const s = statSync(binPath);
    return {
      size: s.size,
      isFile: s.isFile(),
      mode: s.mode != null ? s.mode.toString(8) : null,
    };
  } catch {
    return { size: null, isFile: false, mode: null };
  }
}

function safeAccess(binPath: string): boolean {
  try {
    accessSync(binPath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function binaryDiagFs(): BinaryDiagFs {
  let binPath: string;
  let resolveError: string | null = null;
  try {
    binPath = resolveBinaryPath();
  } catch (e) {
    binPath = "";
    resolveError = e instanceof Error ? e.message : String(e);
  }

  const exists = binPath ? existsSync(binPath) : false;
  const st = binPath ? safeStat(binPath) : { size: null, isFile: false, mode: null };
  const executable = binPath && exists ? safeAccess(binPath) : false;

  // 直接从 process.report 读取 glibc 版本（同步，不 spawn）。
  let glibc: Record<string, unknown> | null = null;
  try {
    const report = (process.report?.getReport?.() ?? {}) as {
      header?: Record<string, unknown>;
      os?: Record<string, unknown>;
    };
    const header = report.header ?? {};
    const os = report.os ?? {};
    // 挑选可能与 "二进制能否跑 / 动态链接库" 相关的字段
    glibc = {
      osType: typeof os.platform === "string" ? os.platform : undefined,
      osRelease: typeof os.release === "string" ? os.release : undefined,
      osVersion: typeof os.version === "string" ? os.version : undefined,
      glibcVersionRuntime: typeof header.glibcVersionRuntime === "string" ? header.glibcVersionRuntime : undefined,
      glibcVersion: typeof header.glibcVersion === "string" ? header.glibcVersion : undefined,
      cpus: typeof os.cpus === "number" ? os.cpus : undefined,
      arch: typeof os.arch === "string" ? os.arch : undefined,
      hostname: typeof os.hostname === "string" ? os.hostname : undefined,
    };
    // 去掉 undefined 字段，让输出干净
    for (const k of Object.keys(glibc)) if (glibc[k] === undefined) delete glibc[k];
  } catch (e) {
    glibc = { error: e instanceof Error ? e.message : String(e) };
  }

  return {
    kind: "fs-only",
    path: binPath,
    exists,
    executable,
    size: st.size,
    isFile: st.isFile,
    mode: st.mode,
    fromEnv: !!process.env.CURL_IMPERSONATE_BIN,
    resolveError,
    process: {
      version: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    glibc,
    childProcessLoadable: childProcessLoadable(),
  };
}

/**
 * execFile 触发版（只在 `?__exec=1` 下才调用）：在纯 fs 基础上，真正执行
 * `execFile(binary, ["--version"])` 并返回结果。用于确认「执行二进制时」是否崩（假设 A 后半）。
 * 若二进制在子进程中导致原生崩溃（SIGSEGV / 被 kill），此处产出的响应可能无法回传——
 * 这本身就是诊断信息。
 */
export interface BinaryDiagExec extends BinaryDiagFs {
  kind: "exec";
  version: string | null;
  versionError: string | null;
}

export async function binaryDiagExec(): Promise<BinaryDiagExec> {
  const base = binaryDiagFs();

  let version: string | null = null;
  let versionError: string | null = null;
  if (base.exists && base.path) {
    try {
      version = await new Promise<string>((resolve, reject) => {
        execFile(base.path, ["--version"], { timeout: 10_000, windowsHide: true }, (err, stdout, stderr) => {
          if (err) {
            reject(new Error(`${err.message}${stderr ? ` :: ${stderr.toString().trim()}` : ""}`));
            return;
          }
          resolve(stdout.toString().trim().split("\n")[0] || "");
        });
      });
    } catch (e) {
      versionError = e instanceof Error ? e.message : String(e);
    }
  }

  return { ...base, kind: "exec", version, versionError };
}

/**
 * 兼容旧调用：默认跑纯 fs（不 spawn），避免 `__diag` 默认触发二进制执行导致崩溃。
 * 需要 execFile 时请改用 binaryDiagExec()。
 */
export async function binaryDiag(): Promise<BinaryDiagFs> {
  return binaryDiagFs();
}

/* 解析 curl `-D` 头文件输出 → { status, statusText, headers }（headers 小写键） */
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
          // 附加二进制诊断：路径 / 存在 / 可执行(X_OK) / 大小。
          // 帮助判断失败是「子进程本身起不来」（binary 缺失/不可执行）还是「上游连接问题」。
          let binDiag = "";
          try {
            const dp = resolveBinaryPath();
            const de = existsSync(dp);
            const dst = de ? safeStat(dp) : { size: null, isFile: false, mode: null };
            const dex = de ? safeAccess(dp) : false;
            binDiag = ` [bin path=${dp} exists=${de} exec=${dex} size=${dst.size ?? "?"}]`;
          } catch {
            binDiag = " [bin resolve=failed]";
          }
          const e = new Error(
            `无法连接上游（curl 退出码 ${errCode ?? "?"}）: ${cause || err.message}${binDiag}`,
          ) as CurlImpersonateError;
          e.code = "ENETUNREACH";
          e.exitCode = typeof errCode === "number" ? errCode : undefined;
          e.cause = cause;
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
