#!/usr/bin/env node

/**
 * build-static.mjs - 主构建脚本
 * 依次调用所有爬虫，抓取 devkitpro.org 内容到本地
 *
 * 用法:
 *   node scripts/build-static.mjs                 # 全部爬取
 *   node scripts/build-static.mjs --skip-wiki     # 跳过 wiki
 *   node scripts/build-static.mjs --skip-forum    # 跳过论坛
 *   node scripts/build-static.mjs --skip-docs     # 跳过文档
 *   node scripts/build-static.mjs --skip-packages # 跳过包索引
 *   node scripts/build-static.mjs --only wiki     # 只爬 wiki
 */

import { scrapeWiki } from './scrapers/wiki-scraper.mjs';
import { scrapeForum } from './scrapers/forum-scraper.mjs';
import { scrapeDocs } from './scrapers/docs-scraper.mjs';
import { scrapePackages } from './scrapers/packages-scraper.mjs';

// ── ANSI 颜色 ──
const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  bright: (s) => `\x1b[1;36m${s}\x1b[0m`,
};

function logBanner() {
  console.log('');
  console.log(C.bright('╔══════════════════════════════════════════════╗'));
  console.log(C.bright('║') + '   DevkitPro Mirror — 静态内容构建器         ' + C.bright('║'));
  console.log(C.bright('╚══════════════════════════════════════════════╝'));
  console.log('');
}

function logResult(label, data) {
  if (data.error) {
    console.log(`  ${C.red('✗')} ${label}: ${C.red(data.error)}`);
  } else if (data.success !== undefined) {
    console.log(`  ${C.green('✓')} ${label}: 成功=${C.green(String(data.success))} 失败=${C.yellow(String(data.failed || 0))}`);
  } else {
    console.log(`  ${C.green('✓')} ${label}: 完成`);
  }
}

// ── 解析命令行参数 ──
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    skipWiki: false,
    skipForum: false,
    skipDocs: false,
    skipPackages: false,
    only: null, // 如果指定，只运行这个
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--skip-wiki':     opts.skipWiki = true; break;
      case '--skip-forum':    opts.skipForum = true; break;
      case '--skip-docs':     opts.skipDocs = true; break;
      case '--skip-packages': opts.skipPackages = true; break;
      case '--only':
        opts.only = args[++i];
        break;
      case '--help':
      case '-h':
        console.log(`
用法: node scripts/build-static.mjs [选项]

选项:
  --skip-wiki      跳过 Wiki 爬取
  --skip-forum     跳过论坛爬取
  --skip-docs      跳过文档爬取
  --skip-packages  跳过包索引爬取
  --only <name>    只运行指定爬虫 (wiki|forum|docs|packages)
  --help, -h       显示帮助
`);
        process.exit(0);
    }
  }

  return opts;
}

// ── 主函数 ──
async function main() {
  const opts = parseArgs();
  const startTime = Date.now();

  logBanner();

  console.log(C.gray(`  开始时间: ${new Date().toISOString()}`));
  console.log(C.gray(`  工作目录: ${process.cwd()}`));
  console.log('');

  const results = {};

  // ── Wiki ──
  if (shouldRun('wiki', opts)) {
    try {
      results.wiki = await scrapeWiki();
    } catch (err) {
      console.log(C.yellow(`  ⚠ Wiki 爬取失败: ${err.message} — 将使用缓存`));
      results.wiki = { error: err.message };
    }
  } else {
    console.log(C.gray('  ⊘ Wiki: 跳过'));
  }

  console.log('');

  // ── Forum ──
  if (shouldRun('forum', opts)) {
    try {
      results.forum = await scrapeForum();
    } catch (err) {
      console.log(C.yellow(`  ⚠ 论坛爬取失败: ${err.message} — 将使用缓存`));
      results.forum = { error: err.message };
    }
  } else {
    console.log(C.gray('  ⊘ Forum: 跳过'));
  }

  console.log('');

  // ── Docs ──
  if (shouldRun('docs', opts)) {
    try {
      results.docs = await scrapeDocs();
    } catch (err) {
      console.log(C.yellow(`  ⚠ 文档爬取失败: ${err.message} — 将使用缓存`));
      results.docs = { error: err.message };
    }
  } else {
    console.log(C.gray('  ⊘ Docs: 跳过'));
  }

  console.log('');

  // ── Packages ──
  if (shouldRun('packages', opts)) {
    try {
      results.packages = await scrapePackages();
    } catch (err) {
      console.log(C.yellow(`  ⚠ 包索引爬取失败: ${err.message} — 将使用缓存`));
      results.packages = { error: err.message };
    }
  } else {
    console.log(C.gray('  ⊘ Packages: 跳过'));
  }

  // ── 汇总 ──
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log(C.bright('══════════════════════════════════════════════'));
  console.log(C.bright('  构建结果汇总'));
  console.log(C.bright('══════════════════════════════════════════════'));

  if (results.wiki)     logResult('Wiki', results.wiki);
  if (results.forum)    logResult('Forum', results.forum);
  if (results.docs)     logResult('Docs', results.docs);
  if (results.packages) logResult('Packages', results.packages);

  console.log('');
  console.log(C.cyan(`  总耗时: ${elapsed}s`));
  console.log(C.gray(`  完成时间: ${new Date().toISOString()}`));
  console.log('');
}

function shouldRun(name, opts) {
  if (opts.only) return opts.only === name;
  if (name === 'wiki' && opts.skipWiki) return false;
  if (name === 'forum' && opts.skipForum) return false;
  if (name === 'docs' && opts.skipDocs) return false;
  if (name === 'packages' && opts.skipPackages) return false;
  return true;
}

main().catch((err) => {
  console.error(`${C.red('构建脚本崩溃:')} ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
