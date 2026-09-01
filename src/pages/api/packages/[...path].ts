import { createProxyHandler } from "@lib/proxy-handler";
import { packagesCacheControl } from "@lib/proxy-cache-rules";

// Package (pacman) repository reverse proxy.
//
// Maps:  /api/packages/{path}  ->  https://pkg.devkitpro.org/packages/{path}
//
// This reuses the shared `createProxyHandler` (same config as the native
// /repo/* route). Both /repo/* and /api/packages/* remain available.
//
// Served as a Serverless Function on Vercel (not prerendered). This proxy
// shells out to a static curl-impersonate binary (no native binding), so it
// MUST run as a Node.js Serverless Function (not the Edge Runtime). The page
// does not set `runtime = "edge"`, so @astrojs/vercel emits it as a Node
// function.
export const { prerender, GET } = createProxyHandler({
  upstreamBase: "https://pkg.devkitpro.org/packages",
  upstreamHost: "pkg.devkitpro.org",
  userAgent: "pacman/6.1.0 (Arch Linux)",
  cacheControlFor: packagesCacheControl,
});
