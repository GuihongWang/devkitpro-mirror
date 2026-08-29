/**
 * SEO utility functions for the devkitPro mirror site.
 *
 * - Canonical URLs always point to the original devkitpro.org
 * - Robots meta is always noindex/nofollow (mirror etiquette)
 */

const ORIGINAL_SITE = "https://devkitpro.org";

/**
 * Generate a canonical URL pointing to the original devkitpro.org site.
 * @param originalPath - Path on the original site (e.g. "/wiki/Main_Page")
 * @returns Full canonical URL
 */
export function getCanonicalUrl(originalPath: string): string {
  const path = originalPath.startsWith("/") ? originalPath : `/${originalPath}`;
  return `${ORIGINAL_SITE}${path}`;
}

/**
 * Generate the robots meta content.
 * Mirror sites should use noindex + nofollow to avoid confusing search engines.
 * @param isMirror - Whether this is a mirror site (default true)
 * @returns robots meta content string
 */
export function getRobotsMeta(isMirror: boolean = true): string {
  return isMirror ? "noindex, nofollow" : "index, follow";
}
