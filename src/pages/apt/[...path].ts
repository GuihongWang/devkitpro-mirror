import { createProxyHandler } from "@lib/proxy-handler";
import { aptCacheControl } from "@lib/proxy-cache-rules";

// Native APT repository proxy route.
//
// Maps:  /apt/{path}  ->  https://apt.devkitpro.org/{path}
//
// This is now a first-class Astro route (no Vercel rewrite). The `path` param
// holds everything after `/apt/` (e.g. `dists/stable/InRelease`,
// `pool/.../package.deb`, `dists/stable/main/binary-amd64/Packages.gz`).
export const { prerender, GET } = createProxyHandler({
  upstreamBase: "https://apt.devkitpro.org",
  upstreamHost: "apt.devkitpro.org",
  userAgent: "apt/2.7.14 (x86_64-pc-linux-gnu)",
  cacheControlFor: aptCacheControl,
});
