/**
 * packages-scraper.mjs - 包索引爬虫
 * 抓取 pkg.devkitpro.org 的 pacman 仓库包索引
 *
 * pkg.devkitpro.org 已关闭 HTML 目录索引（/packages/ → 404），
 * 改为下载 pacman 数据库文件（dkp-libs.db / dkp-linux.db，gzip 的 tar 包）
 * 解析其中的 desc 元数据。
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { logInfo, logOk, logWarn, logErr, logStep, sleep } from '../utils/fetcher.mjs';
import { curlGet } from '../utils/curl-fetch.mjs';

const PKG_BASE = 'https://pkg.devkitpro.org';
const OUTPUT_DIR = join(import.meta.dirname, '../../src/content/packages');

// pacman 仓库结构 — 每个 repo 一个 .db 数据库文件（路径参照官方 wiki）
const REPO_GROUPS = [
  {
    name: 'dkp-libs',
    url: `${PKG_BASE}/packages/`,                       // HTML 目录页（已 404，仅尝试）
    dbUrl: `${PKG_BASE}/packages/dkp-libs.db`,
  },
  {
    name: 'dkp-linux',
    url: `${PKG_BASE}/packages/linux/x86_64/`,           // HTML 目录页（已 404，仅尝试）
    dbUrl: `${PKG_BASE}/packages/linux/x86_64/dkp-linux.db`,
  },
];

// ── 本地带重试的 curl 请求（返回 { status, headers, body, url }）──
async function pkgFetch(url, { timeout = 30000, binary = false, attempts = 5 } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const r = await curlGet(url, { timeout, binary });
      if (r.status === 429 || r.status === 403 || (r.status >= 500 && r.status < 600)) {
        const delay = 1200 * 2 ** (i - 1) + Math.floor(Math.random() * 400);
        lastErr = new Error(`HTTP ${r.status} ${url}`);
        if (i < attempts) {
          logWarn(`  ${lastErr.message} — ${delay}ms 后重试 (${i}/${attempts})`);
          await sleep(delay);
          continue;
        }
      }
      return r;
    } catch (err) {
      lastErr = err;
      if (i < attempts) {
        const delay = 1000 * 2 ** (i - 1) + Math.floor(Math.random() * 500);
        logWarn(`  ${err.message} — ${delay}ms 后重试 (${i}/${attempts})`);
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}

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

// ── 解析 pacman 数据库 .db（gzip 压缩的 tar，内含 <pkgver>/desc）──
function parsePacmanDb(dbBody) {
  const tar = gunzipSync(dbBody);

  const entries = [];
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const nameBuf = tar.subarray(offset, offset + 100);
    if (nameBuf[0] === 0) break; // 全零块 = tar 结束
    const name = nameBuf.toString('utf-8').replace(/\0[\s\S]*$/, '');
    if (!name) break;
    const sizeStr = tar.subarray(offset + 124, offset + 136).toString('utf-8').replace(/\0[\s\S]*$/, '').trim();
    const size = parseInt(sizeStr, 8) || 0;
    offset += 512;
    const data = tar.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;
    entries.push({ name, data });
  }

  const pkgs = [];
  for (const e of entries) {
    if (!e.name.endsWith('/desc')) continue;
    const text = e.data.toString('utf-8');
    const fields = {};
    let current = null;
    for (const line of text.split('\n')) {
      if (line.startsWith('%') && line.endsWith('%')) {
        current = line.slice(1, -1).toUpperCase();
        fields[current] = '';
      } else if (current && line.trim() !== '' && fields[current] !== undefined) {
        fields[current] += fields[current] ? `\n${line}` : line;
      }
    }
    pkgs.push({
      name: fields.NAME || e.name.replace(/-[^-/]+\/desc$/, ''),
      version: fields.VERSION || '',
      arch: fields.ARCH || '',
      filename: fields.FILENAME || '',
    });
  }
  return pkgs;
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

// ── 把文件列表转成包条目（HTML 索引路径） ──
function buildFromFiles(files, repo) {
  return files.map((f) => ({
    ...parsePkgMeta(f.filename),
    filename: f.filename,
    repo: repo.name,
    download_url: `${repo.url}${f.filename}`,
  }));
}

// ── 抓取 repo（优先 HTML 索引，失败则解析 .db） ──
async function scrapeRepo(repo) {
  logStep(`抓取仓库: ${repo.name}`);
  logInfo(`  HTML 目录: ${repo.url}`);
  logInfo(`  .db 数据库: ${repo.dbUrl}`);

  // 1) 尝试 HTML 目录索引
  try {
    const htmlRes = await pkgFetch(repo.url, { timeout: 30000 });
    if (htmlRes.status === 200) {
      const files = parsePacmanIndex(htmlRes.body || '');
      if (files.length > 0) {
        logInfo(`  [HTML] 找到 ${files.length} 个包文件`);
        return buildFromFiles(files, repo);
      }
      logWarn('  [HTML] 目录页无包文件（可能未开启 autoindex），改用 .db');
    } else {
      logWarn(`  [HTML] HTTP ${htmlRes.status}，改用 .db`);
    }
  } catch (err) {
    logWarn(`  [HTML] ${err.message}，改用 .db`);
  }

  // 2) 下载并解析 pacman .db
  const db = await pkgFetch(repo.dbUrl, { timeout: 60000, binary: true });
  if (db.status !== 200) throw new Error(`.db 下载失败 HTTP ${db.status}`);
  logInfo(`  [.db] 下载完成: ${db.body.length} bytes`);

  let pkgs;
  try {
    pkgs = parsePacmanDb(db.body);
  } catch (err) {
    throw new Error(`.db 解析失败: ${err.message}`);
  }
  logInfo(`  [.db] 解析到 ${pkgs.length} 个包`);

  return pkgs.map((p) => ({
    name: p.name,
    version: p.version,
    arch: p.arch,
    filename: p.filename || `${p.name}-${p.version}-${p.arch}.pkg.tar.zst`,
    repo: repo.name,
    download_url: p.filename ? `${repo.url}${p.filename}` : `${repo.url}${p.name}/`,
  }));
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
