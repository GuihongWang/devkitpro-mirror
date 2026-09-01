import { createProxyHandler } from "@lib/proxy-handler";
import { packagesCacheControl } from "@lib/proxy-cache-rules";

// Native pacman (packages) repository proxy route.
//
// Maps:  /repo/{path}  ->  https://pkg.devkitpro.org/packages/{path}
//
// This is now a first-class Astro route (no Vercel rewrite). pacman
// configuration on devkitpro.org uses repository URLs such as:
//   Server = https://pkg.devkitpro.org/packages
//   Server = https://pkg.devkitpro.org/packages/linux/$arch/
//   Server = https://pkg.devkitpro.org/packages/windows/$arch/
export const { prerender, GET } = createProxyHandler({
  upstreamBase: "https://pkg.devkitpro.org/packages",
  upstreamHost: "pkg.devkitpro.org",
  userAgent: "pacman/6.1.0 (Arch Linux)",
  cacheControlFor: packagesCacheControl,
});
