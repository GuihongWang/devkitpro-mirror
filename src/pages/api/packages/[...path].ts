import type { APIRoute } from "astro";

// Served as a Serverless Function on Vercel (not prerendered).
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const upstream = await fetch(upstreamUrl.toString(), {
      method: request.method,
      headers: {
        "user-agent": "devkitpro-mirror/0.1 (reverse proxy)",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!upstream.ok && upstream.status !== 404 && upstream.status !== 410) {
      return new Response(
        `Upstream error: ${upstream.status} ${upstream.statusText}`,
        { status: upstream.status >= 500 ? 502 : upstream.status },
      );
    }

    const upstreamBody = await upstream.arrayBuffer();

    const headers = new Headers();
    headers.set("Cache-Control", cacheControlFor(path));
    headers.set("X-Mirror-Upstream", UPSTREAM_HOST);

    const contentType = upstream.headers.get("content-type");
    if (contentType) headers.set("Content-Type", contentType);

    const contentLength = upstream.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);

    const lastModified = upstream.headers.get("last-modified");
    if (lastModified) headers.set("Last-Modified", lastModified);

    const etag = upstream.headers.get("etag");
    if (etag) headers.set("ETag", etag);

    return new Response(upstreamBody, {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    clearTimeout(timeout);

    // The request was aborted because the upstream took too long.
    if (error instanceof Error && error.name === "AbortError") {
      return new Response("Upstream timeout", { status: 504 });
    }

    // The upstream is unreachable.
    return new Response("Upstream unreachable", { status: 502 });
  }
};
