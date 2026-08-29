import type { APIRoute } from "astro";

// Served as a Serverless Function on Vercel (not prerendered).
export const prerender = false;

/**
 * APT repository reverse proxy.
 *
 * Maps:  /apt/{path}  ->  https://apt.devkitpro.org/{path}
 *
 * The vercel.json rewrite forwards `/apt/*` here as `/api/apt/*`, so the `path`
 * param holds everything after `/apt/` (e.g. `dists/stable/InRelease`,
 * `pool/.../package.deb`, `dists/stable/main/binary-amd64/Packages.gz`).
 */

const UPSTREAM_BASE = "https://apt.devkitpro.org";
const UPSTREAM_HOST = "apt.devkitpro.org";

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Select a Cache-Control value based on the requested file.
 *
 * Release metadata (Release, InRelease) and the per-architecture package index
 * files are refreshed on every `apt update`, so they must be revalidated by
 * clients — a short cache is used.
 *
 * Binary .deb/.udeb pools are immutable per version, so they can be cached long.
 */
function cacheControlFor(path: string): string {
  const name = path.split("/").pop() ?? "";
  const lower = path.toLowerCase();

  // Binary pool packages — immutable per version, cache aggressively.
  if (lower.includes("/pool/") && (/\.deb$/.test(name) || /\.udeb$/.test(name))) {
    return "public, max-age=86400, s-maxage=604800";
  }

  // Release index files — must be checked by apt on every update.
  if (/^(InRelease|Release|Release\.gpg)$/i.test(name)) {
    return "no-cache, no-store, must-revalidate";
  }

  // Per-architecture package indexes, checksums & sources.
  if (
    name.endsWith("Packages") ||
    name.endsWith("Packages.gz") ||
    name.endsWith("Packages.xz") ||
    name.endsWith("Packages.bz2") ||
    name.endsWith("Sources") ||
    name.endsWith("Sources.gz") ||
    name.endsWith("Sources.xz") ||
    name.endsWith("Sources.bz2") ||
    name.endsWith("Contents-amd64") ||
    name.endsWith("Contents-amd64.gz") ||
    name.endsWith(".dsc") ||
    /^Packages(\.(gz|xz|bz2))?$/.test(name)
  ) {
    return "public, max-age=3600, s-maxage=300";
  }

  // Fallback for translation indexes and anything else.
  return "public, s-maxage=300, max-age=60";
}

export const GET: APIRoute = async ({ params, request }) => {
  const path = params.path;

  if (!path || path === "") {
    return new Response("Not Found", { status: 404 });
  }

  const upstreamUrl = new URL(`${UPSTREAM_BASE}/${path}`);
  // Forward the query string.
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
