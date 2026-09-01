import type { APIRoute } from "astro";
import { curlImpersonateFetch, binaryDiagFs, binaryDiagExec } from "@lib/curl-impersonate-fetch";

/**
 * proxy-handler.ts — 共享的 curl-impersonate 反向代理工厂
 *
 * 原 `src/pages/api/packages/[...path].ts` 与 `src/pages/api/apt/[...path].ts`
 * 的公共逻辑在这里被抽成工厂。调用方通过 ProxyConfig 差异化：
 *   - 上游 base / host
 *   - 伪装 UA（pacman / apt）
 *   - Cache-Control 策略（packages / apt 各有不同）
 *
 * 这使两套原生路由（/repo/*、/apt/*）与旧的 /api/* 复用同一份经过验证的行为，
 * 保证任何一处修改都不会在两个 handler 间产生漂移。
 */

export interface ProxyConfig {
  /** 上游 base URL，如 "https://pkg.devkitpro.org/packages" 或 "https://apt.devkitpro.org"。 */
  upstreamBase: string;
  /** 上游 host（写入 X-Mirror-Upstream 响应头），如 "pkg.devkitpro.org"。 */
  upstreamHost: string;
  /** 伪装成客户端 HTTP 客户端（curl-impersonate 的 -A）的 UA。 */
  userAgent: string;
  /** 根据请求路径挑选 Cache-Control 值，由外层传入。 */
  cacheControlFor: (path: string) => string;
}

/**
 * curl-impersonate 浏览器 TLS 指纹（用于上游）。
 *
 * Cloudflare 会以 403 拦截 Node 原生（undici）TLS 指纹，因此我们通过静态
 * curl-impersonate 二进制伪装当前 Chrome（JA3/JA4 + HTTP/2 SETTINGS）。
 * chrome142 是最新的可用伪装 profile，已确认返回 200；旧 profile（124/131）会被
 * 拦截。不要降级到过时的指纹。
 */
const IMPERSONATE_PROFILE = "chrome142";

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * 把任意异常序列化为 text/plain 诊断体（用于暴露被 FUNCTION_INVOCATION_FAILED
 * 掩盖的真异常）。内含 message、stack、code、cause。
 */
function diagBody(error: unknown): string {
  const e = error instanceof Error ? error : new Error(String(error));
  const cause = (e as { cause?: unknown }).cause;
  let causeStr: string;
  try {
    causeStr = cause === undefined ? "undefined" : JSON.stringify(cause);
  } catch {
    causeStr = String(cause);
  }
  return [
    `[proxy diagnostic] uncaught handler error (500)`,
    `message: ${e.message}`,
    `code: ${(e as { code?: unknown }).code ?? "undefined"}`,
    `cause: ${causeStr}`,
    `stack:\n${e.stack ?? "(no stack)"}`,
  ].join("\n");
}

/**
 * 创建反代 handler。返回的 GET APIRoute 完整保留原两个 handler 的所有行为。
 */
export function createProxyHandler(config: ProxyConfig): { prerender: false; GET: APIRoute } {
  const { upstreamBase, upstreamHost, userAgent, cacheControlFor } = config;

  const GET: APIRoute = async ({ params, request }) => {
    try {
      return await handleGET({ params, request });
    } catch (error) {
      return new Response(diagBody(error), {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  };

  async function handleGET({ params, request }: { params: { path?: string }; request: Request }): Promise<Response> {
    const path = params.path;

    if (!path || path === "") {
      return new Response("Not Found", { status: 404 });
    }

    // 二进制自检：仅当 URL 携带 __diag 时生效，不请求上游。
    //
    // 精确二分假设 A / B：
    //   - __diag 默认（无 ?__exec=1）→ 只跑纯 fs 检查（binaryDiagFs），**绝不 execFile/spawn**
    //     任何进程。若返回 200 → _render 函数/模块加载正常，问题在「执行二进制」→ 假设 A。
    //     若仍 FUNCTION_INVOCATION_FAILED → _render 函数级/模块加载问题 → 假设 B。
    //   - __diag?__exec=1 → 才执行 execFile(binary, ["--version"]) 并返回（用于确认执行二进制时是否崩）。
    if (path.includes("__diag")) {
      const execReq = new URL(request.url).searchParams.get("__exec") === "1";
      const diag = execReq ? await binaryDiagExec() : binaryDiagFs();
      return new Response(JSON.stringify(diag, null, 2), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const upstreamUrl = new URL(`${upstreamBase}/${path}`);
    // Forward the query string (query 操作，与 path 无关——必须用 request.url 的
    // searchParams 以便 query 正确转发，例如 ?debug / signature parameters)。
    const { searchParams } = new URL(request.url);
    for (const [key, value] of searchParams) {
      upstreamUrl.searchParams.append(key, value);
    }

    let upstream;
    try {
      upstream = await curlImpersonateFetch(upstreamUrl.toString(), {
        method: request.method,
        impersonate: IMPERSONATE_PROFILE,
        // Raw bytes are proxied verbatim (see curl-impersonate-fetch notes). No
        // --compressed, so the upstream sees no Accept-Encoding and sends as-is.
        ua: userAgent,
        timeoutMs: REQUEST_TIMEOUT_MS,
        // On Vercel we connect DIRECT to upstream; no proxy. Local tests may
        // pass a proxy via `proxy:` (we don't set one here so it stays direct).
      });
    } catch (error) {
      // The request was aborted because the upstream took too long.
      if (error instanceof Error && (error as { code?: string }).code === "ETIMEDOUT") {
        return new Response(
          "上游请求超时（504 Gateway Timeout）——请稍后重试",
          { status: 504 },
        );
      }

      // Connection-level failure (upstream unreachable / TLS / proxy error).
      return new Response(
        "无法连接上游服务器（502 Bad Gateway）——镜像源暂时不可用",
        { status: 502 },
      );
    }

    if (upstream.status !== 200 && upstream.status !== 404 && upstream.status !== 410) {
      return new Response(
        `上游错误（${upstream.status} ${upstream.statusText}）`,
        { status: upstream.status >= 500 ? 502 : upstream.status },
      );
    }

    const upstreamBody = upstream.body;

    const headers = new Headers();
    headers.set("Cache-Control", cacheControlFor(path));
    headers.set("X-Mirror-Upstream", upstreamHost);

    const contentType = upstream.headers["content-type"];
    if (contentType) headers.set("Content-Type", contentType);

    // Raw bytes are forwarded exactly as upstream sent them, so preserve the
    // transfer-level Content-Encoding (if any) verbatim.
    const contentEncoding = upstream.headers["content-encoding"];
    if (contentEncoding) headers.set("Content-Encoding", contentEncoding);

    // Content-Length must describe the bytes we actually forward.
    headers.set("Content-Length", String(upstreamBody.byteLength));

    const lastModified = upstream.headers["last-modified"];
    if (lastModified) headers.set("Last-Modified", lastModified);

    const etag = upstream.headers["etag"];
    if (etag) headers.set("ETag", etag);

    return new Response(new Uint8Array(upstreamBody), {
      status: upstream.status,
      headers,
    });
  }

  return { prerender: false, GET };
}
