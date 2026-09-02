/**
 * Mirror site URL configuration.
 *
 * Everything a user must paste into their own configuration (e.g. the
 * dkp-pacman `Server =` line) must point at the mirror's own domain, so the
 * base URL has to be configurable without touching source code.
 *
 * Resolution order:
 *   1. PUBLIC_SITE_URL — Vercel / build-time environment variable (use this
 *      to point at a custom domain without editing the codebase).
 *   2. import.meta.env.SITE — the Astro `site` value from astro.config.mjs.
 *   3. The custom domain default (https://devkitpro.marisa.ml) as a last resort.
 */

function normalize(value: string | undefined): string {
  return value?.trim().replace(/\/+$/, "") ?? "";
}

export const SITE_URL: string =
  normalize(import.meta.env.PUBLIC_SITE_URL) ||
  normalize(import.meta.env.SITE) ||
  "https://devkitpro.marisa.ml";

/**
 * dkp-pacman `Server =` line that points at the mirror's own package
 * repository reverse proxy.
 *
 * Path mapping (see vercel.json + src/pages/api/packages/[...path].ts):
 *
 *   https://{SITE_URL}/repo/{path}
 *     -> /api/packages/{path}          (Vercel rewrite)
 *     -> https://pkg.devkitpro.org/packages/{path}   (serverless function)
 *
 * Therefore `/repo/` maps to the upstream repository root and `Server = `
 * must be the full domain + `/repo/`.
 */
export const PACKAGE_MIRROR_SERVER: string = `${SITE_URL}/repo/`;

/** Official upstream repository — kept as a fallback when the proxy is down. */
export const OFFICIAL_PACKAGE_SERVER: string = "https://pkg.devkitpro.org/packages";