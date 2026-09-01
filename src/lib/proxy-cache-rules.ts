/**
 * proxy-cache-rules.ts — packages（pacman）与 apt 各自的 Cache-Control 策略。
 *
 * 供 `createProxyHandler` 的 `cacheControlFor` 参数使用。策略与原先
 * `src/pages/api/packages/[...path].ts` 与 `src/pages/api/apt/[...path].ts`
 * 中的实现一致（原样搬运，未改语义）。
 */

/**
 * pacman 仓库文件的 Cache-Control。
 *
 * pacman 数据库文件小而频繁更新，必须保持新鲜以便客户端发现新包 → 短缓存。
 * 二进制包归档不可变（包文件名不会复用）→ 可激进缓存。
 */
export function packagesCacheControl(path: string): string {
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

/**
 * APT 仓库文件的 Cache-Control。
 *
 * Release 元数据与各架构包索引文件每次 `apt update` 都会刷新，必须由客户端重新
 * 校验 → 短缓存。二进制 .deb/.udeb 池不可变 → 长缓存。
 */
export function aptCacheControl(path: string): string {
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
