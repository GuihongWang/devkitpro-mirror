/**
 * packages-scraper.mjs - 包索引爬虫
 * 抓取 pkg.devkitpro.org 的 pacman 仓库包索引
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { throttledFetch, logInfo, logOk, logWarn, logErr, logStep } from '../utils/fetcher.mjs';

const PKG_BASE = 'https://pkg.devkitpro.org';
const OUTPUT_DIR = join(import.meta.dirname, '../../src/content/packages');

// pacman 仓库结构 — 每个 group 一个目录
const REPO_GROUPS = [
  // devkitARM 和相关
  { name: 'packages', url: `${PKG_BASE}/packages/` },
  { name: 'packages-linux', url: `${PKG_BASE}/packages-linux/` },
];

// ── 解析 pacman 目录索引 HTML ──
function parsePacmanIndex(html) {
  const files = [];
  // <a href="...">file.pkg.tar.xz</a>
  const regex = /<a[^>]*href="([^"]*\.(pkg\.tar\.(xz|zst)))"[^>]*>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const name = match[1];
    // 提取包名
    const pkgMatch = name.match(/^(.+?)-(\d+\..+)$/);
    if (pkgMatch) {
      files.push({
        filename: name,
        pkg_name: pkgMatch[1],
        version_raw: pkgMatch[2],
      });
    } else {
      files.push({
        filename: name,
        pkg_name: name.replace(/\.(pkg\.tar\.(xz|zst))$/, ''),
        version_raw: '',
      });
    }
  }
  return files;
}

// ── 解析 pacman 文件的元数据（从文件名推断） ──
function parsePkgMeta(filename) {
  // 格式: name-version-release-arch.pkg.tar.xz
  const base = filename.replace(/\.(pkg\.tar\.(xz|zst))$/, '');
  const parts = base.split('-');
  // arch 通常是最后一个
  const arch = parts[parts.length - 1];
  const archs = ['arm', 'armv7a', 'aarch64', 'x86_64', 'any', 'noarch', 'armv7hfh'];
  let pkgName, version;

  if (archs.includes(arch)) {
    const meta = parts.slice(0, -1).join('-');
    // 版本格式: version-release
    const lastDash = meta.lastIndexOf('-');
    if (lastDash > 0) {
      pkgName = meta.substring(0, lastDash);
      version = meta.substring(lastDash + 1);
    } else {
      pkgName = meta;
      version = '';
    }
    return { name: pkgName, version, arch };
  }

  return { name: base, version: '', arch: 'unknown' };
}

// ── 抓取 repo 目录 ──
async function scrapeRepo(repo) {
  logStep(`抓取仓库: ${repo.name} (${repo.url})`);
  const res = await throttledFetch(repo.url, { interval: 600 });
  const html = await res.text();
  const files = parsePacmanIndex(html);
  logInfo(`  找到 ${files.length} 个包文件`);

  // 解析元数据
  const packages = files.map((f) => {
    const meta = parsePkgMeta(f.filename);
    return {
      ...meta,
      filename: f.filename,
      repo: repo.name,
      download_url: `${repo.url}${f.filename}`,
    };
  });

  return packages;
}

// ── 主入口 ──
export async function scrapePackages() {
  logStep('═══ 包索引爬虫 ═══');

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const allPackages = [];
  const errors = [];

  for (const repo of REPO_GROUPS) {
    try {
      const packages = await scrapeRepo(repo);
      allPackages.push(...packages);
    } catch (err) {
      logErr(`  仓库 ${repo.name} 抓取失败: ${err.message}`);
      errors.push({ repo: repo.name, error: err.message });
    }
  }

  // 按包名分组
  const packageMap = {};
  for (const pkg of allPackages) {
    const key = pkg.name;
    if (!packageMap[key]) {
      packageMap[key] = {
        name: pkg.name,
        architectures: [],
        versions: {},
      };
    }
    packageMap[key].architectures.push(pkg.arch);
    if (pkg.version) {
      packageMap[key].versions[pkg.arch] = pkg.version;
    }
  }

  // 生成索引
  const index = {
    scraped_at: new Date().toISOString(),
    total_files: allPackages.length,
    unique_packages: Object.keys(packageMap).length,
    repos: REPO_GROUPS.map((r) => ({ name: r.name, url: r.url })),
    packages: Object.values(packageMap).sort((a, b) => a.name.localeCompare(b.name)),
    raw_files: allPackages,
    errors,
  };

  const outputPath = join(OUTPUT_DIR, 'index.json');
  writeFileSync(outputPath, JSON.stringify(index, null, 2), 'utf-8');

  logOk('包索引爬取完成');
  logInfo(`  包文件数: ${allPackages.length}`);
  logInfo(`  唯一包数: ${Object.keys(packageMap).length}`);
  logInfo(`  保存到: ${outputPath}`);

  return index;
}

// ── 独立运行 ──
if (process.argv[1] && process.argv[1].endsWith('packages-scraper.mjs')) {
  scrapePackages().catch((err) => {
    logErr(`包索引爬虫崩溃: ${err.message}`);
    process.exit(1);
  });
}
