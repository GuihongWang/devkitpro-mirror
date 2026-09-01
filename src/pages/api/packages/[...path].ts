import type { APIRoute } from "astro";
import { curlImpersonateFetch } from "@lib/curl-impersonate-fetch";

// Served as a Serverless Function on Vercel (not prerendered).
// NOTE: this proxy shells out to a static curl-impersonate binary (no native
// binding), so it MUST run as a Node.js Serverless Function (not the Edge
// Runtime). The page does not set `runtime = "edge"`, so @astrojs/vercel emits
// it as a Node function.
export const prerender = false;

/**
 * Package (pacman) repository reverse proxy.
 *
 * Maps:  /repo/{path}  ->  https://pkg.devkitpro.org/packages/{path}
 *
 * The pacman configuration on devkitpro.org uses repository URLs such as:
 *   Server = https://pkg.devkitpro.org/packages
 *   Server = https://pkg.devkitpro.org/packages/linux/$arch/
 *   Server = https://pkg.devkitpro.org/packages/windows/$arch/
 *
 * The vercel.json rewrite forwards `/repo/*` here as `/api/packages/*`, so the
 * `path` param holds everything after `/repo/` (e.g. `linux/x86_64/dkp-linux.db`).
 */

const UPSTREAM_BASE = "https://pkg.devkitpro.org/packages";
const UPSTREAM_HOST = "pkg.devkitpro.org";

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * curl-impersonate browser TLS fingerprint used against the upstream.
 *
 * Cloudflare blocks Node's native (undici) TLS fingerprint with a 403, so we
 * impersonate a current Chrome (JA3/JA4 + HTTP/2 SETTINGS) via the static
 * curl-impersonate binary. chrome142 is the newest-available impersonation
 * profile and is confirmed to return 200; older profiles (124/131) are blocked.
 * Do NOT downgrade this to an outdated fingerprint.
 */
const IMPERSONATE_PROFILE = "chrome142";

/**
 * Select a Cache-Control value based on the requested file.
 *
 * pacman database files are small, frequently updated and must stay fresh for
 * clients to notice new packages, so they get a short cache.
 *
 * Binary package archives are immutable (a package file name is never reused),
 * so they can be cached aggressively.
 */
function cacheControlFor(path: string): string {
  const name = path.split("/").pop() ?? "";

  // Repository databases: dkp-libs.db, dkp-linux.db, .db.sig, .db.tar.gz ...
  if (/\.db(\.tar(\.gz|\.xz|\.zst)?)?(\.sig)?$/.test(name)) {
    return "no-cache, no-store, must-revalidate";
  }

  // pacman package archives: *-x86_64.pkg.tar.zst, *-any.pkg.tar.xz ...
  if (/\.pkg\.tar(\.(gz|xz|zst|lrz|lzo))?$/.test(name)) {
    return "public, max-age=86400, s-maxage=604800";
  }

  // Anything else (e.g. .files lists) — be conservative.
  return "public, s-maxage=300, max-age=60";
}

export const GET: APIRoute = async ({ params, request }) => {
  const path = params.path;

  if (!path || path === "") {
    return new Response("Not Found", { status: 404 });
  }

  const upstreamUrl = new URL(`${UPSTREAM_BASE}/${path}`);
  // Forward the query string (e.g. ?debug / signature parameters).
  const { searchParams } = new URL(request.url);
  for (const [key, value] of searchParams) {
    upstreamUrl.searchParams.append(key, value);
  }

  let upstream;
  try {
    upstream = await curlImpersonateFetch(upstreamUrl.toString(), {
      method: request.method,
      impersonate: IMPERSONATE_PROFILE,
      // Raw bytes are proxied verbatim (see module notes). No --compressed,
      // so the upstream sees no Accept-Encoding and sends the file as-is.
      ua: "pacman/6.1.0 (Arch Linux)",
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
  headers.set("X-Mirror-Upstream", UPSTREAM_HOST);

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
};
