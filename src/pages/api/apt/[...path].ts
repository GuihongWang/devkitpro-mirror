import { createProxyHandler } from "@lib/proxy-handler";
import { aptCacheControl } from "@lib/proxy-cache-rules";

// APT repository reverse proxy.
//
// Maps:  /api/apt/{path}  ->  https://apt.devkitpro.org/{path}
//
// This reuses the shared `createProxyHandler` (same config as the native
// /apt/* route). Both /apt/* and /api/apt/* remain available.
//
// Served as a Serverless Function on Vercel (not prerendered). This proxy
// shells out to a static curl-impersonate binary (no native binding), so it
// MUST run as a Node.js Serverless Function (not the Edge Runtime). The page
// does not set `runtime = "edge"`, so @astrojs/vercel emits it as a Node
// function.
export const { prerender, GET } = createProxyHandler({
  upstreamBase: "https://apt.devkitpro.org",
  upstreamHost: "apt.devkitpro.org",
  userAgent: "apt/2.7.14 (x86_64-pc-linux-gnu)",
  cacheControlFor: aptCacheControl,
});
