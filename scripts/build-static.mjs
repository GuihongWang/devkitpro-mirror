#!/usr/bin/env node

/**
 * build-static.mjs - 主构建脚本（智能缓存抓取系统）
 *
 * 每天执行一次：无缓存立即抓取、有缓存一周更新一次、
 * 连续两周原站无变化则降频为一月一更新。
 *
 * 用法:
 *   node scripts/build-static.mjs                          # 智能模式（默认）
 *   node scripts/build-static.mjs --force                   # 强制全量抓取
 *   node scripts/build-static.mjs --dry-run                 # 只显示决策，不实际抓取
 *   node scripts/build-static.mjs --check-only              # 只做变化检测并更新状态，不抓取
 *   node scripts/build-static.mjs --skip-wiki               # 跳过 wiki
 *   node scripts/build-static.mjs --skip-forum              # 跳过论坛
 *   node scripts/build-static.mjs --skip-docs               # 跳过文档
 *   node scripts/build-static.mjs --skip-packages           # 跳过包索引
 *   node scripts/build-static.mjs --only wiki               # 只处理 wiki
 *   node scripts/build-static.mjs --help, -h                # 显示帮助
 *
 * 代理: 通过 HTTPS_PROXY / HTTP_PROXY 环境变量走代理
 *   HTTPS_PROXY=http://127.0.0.1:7890 node scripts/build-static.mjs
 */

import { scrapeWiki } from './scrapers/wiki-scraper.mjs';
import { scrapeForum } from './scrapers/forum-scraper.mjs';
import { scrapeDocs } from './scrapers/docs-scraper.mjs';
import { scrapePackages } from './scrapers/packages-scraper.mjs';
import { checkWiki, checkForum, checkDocs, checkPackages } from './utils/change-detector.mjs';
import { loadState, saveState, createFreshModuleState, MODULE_NAMES, STATE_VERSION } from './utils/cache-state.mjs';
import { setupProxy, hasProxyEnv } from './utils/proxy.mjs';

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

// ── 模块注册表 ──
const MODULES = {
  wiki: { name: 'wiki', label: 'Wiki', scrape: scrapeWiki, check: checkWiki },
  forum: { name: 'forum', label: '论坛', scrape: scrapeForum, check: checkForum },
  docs: { name: 'docs', label: '文档', scrape: scrapeDocs, check: checkDocs },
  packages: { name: 'packages', label: '包索引', scrape: scrapePackages, check: checkPackages },
};

// ── 时间常量（毫秒）──
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const SKIP_CHECK_THRESHOLD = 3; // 连续检测失败 >= 3 则跳过检测请求直接 skip

// ── 辅助 ──
function nowIso() {
  return new Date().toISOString();
}

function daysSince(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  return ms / (24 * 60 * 60 * 1000);
}

function logModule(icon, text) {
  console.log(`  ${icon} ${text}`);
}

// ── 解析命令行参数 ──
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    force: false,
    dryRun: false,
    checkOnly: false,
    skipWiki: false,
    skipForum: false,
    skipDocs: false,
    skipPackages: false,
    only: null, // 如果指定，只处理这个
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--force':        opts.force = true; break;
      case '--dry-run':      opts.dryRun = true; break;
      case '--check-only':   opts.checkOnly = true; break;
      case '--skip-wiki':    opts.skipWiki = true; break;
      case '--skip-forum':   opts.skipForum = true; break;
      case '--skip-docs':    opts.skipDocs = true; break;
      case '--skip-packages': opts.skipPackages = true; break;
      case '--only':
        opts.only = args[++i];
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        console.log(C.red(`未知参数: ${args[i]}`));
        printHelp();
        process.exit(1);
    }
  }

  // 校验 --only 值
  if (opts.only && !MODULES[opts.only]) {
    console.log(C.red(`--only 取值无效: ${opts.only}（可选: ${Object.keys(MODULES).join('|')}）`));
    process.exit(1);
  }

  return opts;
}

function printHelp() {
  console.log(`
${C.bright('DevkitPro Mirror — 智能缓存抓取构建器')}

${C.bold('用法:')} node scripts/build-static.mjs [选项]

${C.bold('选项:')}
  --force              强制全量抓取（忽略缓存策略）
  --dry-run            只显示本轮决策，不实际抓取
  --check-only         只做变化检测并更新状态文件，不抓取内容
  --skip-wiki          跳过 Wiki
  --skip-forum         跳过论坛
  --skip-docs          跳过文档
  --skip-packages      跳过包索引
  --only <name>        只处理指定模块 (wiki|forum|docs|packages)
  --help, -h           显示帮助

${C.bold('示例:')}
  HTTPS_PROXY=http://127.0.0.1:7890 node scripts/build-static.mjs
  node scripts/build-static.mjs --force
  node scripts/build-static.mjs --dry-run
  node scripts/build-static.mjs --check-only
  node scripts/build-static.mjs --only docs

${C.gray('代理: 通过 HTTPS_PROXY / HTTP_PROXY 环境变量启用（本地需走代理）')}
`);
}

/**
 * 模块是否应被处理（考虑 --only / --skip-*）
 */
function shouldProcess(name, opts) {
  if (opts.only) return opts.only === name;
  if (name === 'wiki' && opts.skipWiki) return false;
  if (name === 'forum' && opts.skipForum) return false;
  if (name === 'docs' && opts.skipDocs) return false;
  if (name === 'packages' && opts.skipPackages) return false;
  return true;
}

/**
 * 决策逻辑：决定某个模块本轮是 scrape / skip。
 *
 * 与旧的实现不同，本函数**不会原地修改 modState**，只基于当前状态
 * 计算并返回决策结果。所有状态更新被收集到 `stateChanges` 中，
 * 由 main() 在合适的时机（抓取成功 / 仅检测 / skip）应用，从而
 * 避免在真实抓取执行之前就把 lastScrapedAt 提前写入，杜绝：
 *   - --check-only 把 lastScrapedAt 误推成“今天刚抓过”而阻塞后续抓取；
 *   - 抓取失败时状态回滚不完整 / 误记成功。
 *
 * @param {string} moduleName  模块名
 * @param {object} modState    模块当前状态（只读，不会被修改）
 * @param {object} opts        命令行选项
 * @returns {Promise<{ action: 'scrape'|'skip', reason: string, detail?: string, stateChanges: object }>}
 *   action       本轮决策
 *   reason       决策原因（日志用）
 *   stateChanges 若抓取成功 / skip 时需要应用的字段集（含可能出现的 lastScrapedAt）。
 *                main() 会根据实际是否抓取成功来决定是否包含 lastScrapedAt。
 */
async function decide(moduleName, modState, opts) {
  const now = nowIso();
  const { check } = MODULES[moduleName];

  // 1. 强制抓取（完整重置缓存决策状态）
  if (opts.force) {
    return {
      action: 'scrape',
      reason: '强制全量抓取（--force）',
      stateChanges: {
        frequency: 'weekly',
        lastCheckedAt: now,
        lastChangedAt: now, // 强制抓取视为一次变更
        consecutiveUnchangedWeeks: 0,
        consecutiveCheckFailures: 0,
        lastCheckHash: null,
        lastCheckResult: 'changed',
        lastScrapedAt: now,
      },
    };
  }

  // 2. 无状态或从未抓取 → 首次抓取
  if (!modState.lastScrapedAt) {
    return {
      action: 'scrape',
      reason: '首次抓取（无缓存）',
      stateChanges: { frequency: 'weekly', lastScrapedAt: now },
    };
  }

  // 3. 距上次抓取 < 7 天 → 跳过
  const d = daysSince(modState.lastScrapedAt);
  if (d !== null && d < 7) {
    return {
      action: 'skip',
      reason: `距上次抓取仅 ${d.toFixed(1)} 天，不足 7 天`,
      stateChanges: { lastCheckedAt: now },
    };
  }

  // 4. 距上次抓取 ≥ 7 天 → 执行变化检测
  // b.1 连续检测失败 >= 3 → 跳过检测请求，直接 skip
  if (modState.consecutiveCheckFailures >= SKIP_CHECK_THRESHOLD) {
    return {
      action: 'skip',
      reason: `连续检测失败 ${modState.consecutiveCheckFailures} 次，已暂停检测，保留缓存`,
      stateChanges: { lastCheckedAt: now },
    };
  }

  // 执行变化检测
  let result;
  try {
    result = await check(modState.lastScrapedAt, { lastCheckHash: modState.lastCheckHash });
  } catch (err) {
    result = { changed: false, hash: null, error: err.message, lastModified: null };
  }

  // 检测成功后每次都会应用的基础字段（重置失败计数、记录检测时间与 hash）
  const baseCheckChanges = {
    consecutiveCheckFailures: 0,
    lastCheckedAt: now,
    lastCheckHash: result.hash || modState.lastCheckHash,
  };

  // b. 检测失败 → 跳过，保留缓存
  if (result.error) {
    const proxyHint = hasProxyEnv()
      ? '检查代理是否可连通目标站点'
      : '如本地需走代理请设置 HTTPS_PROXY / HTTP_PROXY 环境变量';
    return {
      action: 'skip',
      reason: `变化检测失败: ${result.error}`,
      detail: `连续失败 ${(modState.consecutiveCheckFailures || 0) + 1} 次（${proxyHint}）`,
      stateChanges: {
        consecutiveCheckFailures: (modState.consecutiveCheckFailures || 0) + 1,
        lastCheckResult: 'error',
        lastCheckedAt: now,
      },
    };
  }

  // c. 检测到变化 → 抓取，恢复 weekly
  if (result.changed) {
    return {
      action: 'scrape',
      reason: '原站检测到变化',
      stateChanges: {
        ...baseCheckChanges,
        lastChangedAt: now,
        consecutiveUnchangedWeeks: 0,
        frequency: 'weekly',
        lastScrapedAt: now,
        lastCheckResult: 'changed',
      },
    };
  }

  // d. 检测无变化 → consecutiveUnchangedWeeks++
  const unchangedChanges = {
    ...baseCheckChanges,
    lastCheckResult: 'unchanged',
    consecutiveUnchangedWeeks: (modState.consecutiveUnchangedWeeks || 0) + 1,
  };

  if (modState.frequency === 'monthly') {
    const m = daysSince(modState.lastScrapedAt);
    if (m !== null && m >= 30) {
      return {
        action: 'scrape',
        reason: '月度抓取到点（未变但已满 30 天）',
        stateChanges: { ...unchangedChanges, lastScrapedAt: now },
      };
    }
    return {
      action: 'skip',
      reason: `月度周期内无变化，距上次抓取 ${(m ?? 0).toFixed(1)} 天`,
      stateChanges: unchangedChanges,
    };
  }

  // frequency == weekly
  if (modState.consecutiveUnchangedWeeks >= 2) {
    return {
      action: 'skip',
      reason: '连续两周原站无变化，降频为一月一更新',
      stateChanges: { ...unchangedChanges, frequency: 'monthly' },
    };
  }

  return {
    action: 'skip',
    reason: '检测无变化，保留缓存',
    stateChanges: unchangedChanges,
  };
}

// ── 汇总输出辅助 ──
function logResult(label, data) {
  if (data.error) {
    console.log(`  ${C.red('✗')} ${label}: ${C.red(data.error)}`);
  } else if (data.success !== undefined) {
    console.log(`  ${C.green('✓')} ${label}: 成功=${C.green(String(data.success))} 失败=${C.yellow(String(data.failed || 0))}`);
  } else {
    console.log(`  ${C.green('✓')} ${label}: 完成`);
  }
}

function logBanner() {
  console.log('');
  console.log(C.bright('╔══════════════════════════════════════════════╗'));
  console.log(C.bright('║') + '   DevkitPro Mirror — 智能缓存抓取系统        ' + C.bright('║'));
  console.log(C.bright('╚══════════════════════════════════════════════╝'));
  console.log('');
}

// ── 主函数 ──
async function main() {
  const opts = parseArgs();
  const startTime = Date.now();

  // 首次调用时启用代理（走环境变量）——必须 await，否则后续 fetch 可能先于代理设置执行
  await setupProxy();

  logBanner();

  console.log(C.gray(`  开始时间: ${nowIso()}`));
  console.log(C.gray(`  工作目录: ${process.cwd()}`));
  if (opts.force)     console.log(C.yellow('  模式: 强制全量抓取 (--force)'));
  if (opts.dryRun)    console.log(C.yellow('  模式: 演练 (--dry-run)  — 不实际抓取'));
  if (opts.checkOnly) console.log(C.yellow('  模式: 仅检测 (--check-only)  — 不抓取内容'));
  if (!hasProxyEnv()) {
    console.log(C.gray('  代理: 未检测到 HTTPS_PROXY/HTTP_PROXY 环境变量 — 将直连（本地需走代理时抓取可能失败）'));
    console.log(C.gray('       提示: devkitpro.org 需走代理才能访问，本机有 Clash 等代理时请设置：'));
    console.log(C.gray('       set https_proxy=http://127.0.0.1:7890 && set http_proxy=http://127.0.0.1:7890'));
  }
  console.log('');

  // 加载状态，并确保每个模块都有状态
  const state = loadState();
  for (const name of MODULE_NAMES) {
    if (!state.modules[name]) {
      state.modules[name] = createFreshModuleState();
    }
  }

  const decisions = {};
  const summaries = [];

  for (const name of Object.keys(MODULES)) {
    if (!shouldProcess(name, opts)) {
      console.log(`  ${C.gray('⊘')} ${name}: 跳过（参数过滤）`);
      continue;
    }

    const modState = state.modules[name];
    try {
      const decision = await decide(name, modState, opts);
      decisions[name] = decision;
      const f = MODULES[name];
      const stateChanges = decision.stateChanges || {};

      if (decision.action === 'scrape') {
        logModule(C.green('▸'), `${C.green(f.label)}: ${C.green(decision.reason)}`);
        if (opts.checkOnly) {
          // 仅检测：只应用检测相关字段，绝不触碰 lastScrapedAt
          const { lastScrapedAt, ...rest } = stateChanges;
          Object.assign(modState, rest);
          summaries.push({ label: f.label, data: { skipped: true } });
        } else if (opts.dryRun) {
          // 演练：不执行抓取，也不改动状态（后续也不会写状态文件）
          summaries.push({ label: f.label, data: { skipped: true } });
        } else {
          try {
            const res = await f.scrape();
            // 抓取成功 → 应用全部状态变更（含 lastScrapedAt）
            Object.assign(modState, stateChanges);
            summaries.push({ label: f.label, data: res });
          } catch (err) {
            // 抓取失败 → 不应用 lastScrapedAt（保留旧缓存），只记录检测相关字段
            Object.assign(modState, {
              lastCheckedAt: stateChanges.lastCheckedAt ?? nowIso(),
              lastCheckResult: 'error',
              consecutiveCheckFailures: (modState.consecutiveCheckFailures || 0) + 1,
            });
            console.log(`    ${C.yellow(`⚠ ${f.label} 抓取失败: ${err.message} — 缓存保留`)}`);
            if (!hasProxyEnv()) {
              console.log(`    ${C.gray('  提示: 未检测到 HTTPS_PROXY/HTTP_PROXY 环境变量，本地抓取可能需代理 (如 http://127.0.0.1:7890)')}`);
            }
            summaries.push({ label: f.label, data: { error: err.message } });
          }
        }
      } else {
        // skip → 应用除 lastScrapedAt 外的状态字段（skip 分支本就不含 lastScrapedAt，防御性剥离）
        logModule(C.gray('⊘'), `${C.gray(f.label)}: skip — ${C.gray(decision.reason)}`);
        if (decision.detail) console.log(`    ${C.gray(`   (${decision.detail})`)}`);
        const { lastScrapedAt, ...rest } = stateChanges;
        Object.assign(modState, rest);
      }
    } catch (err) {
      console.log(`  ${C.red('✗')} ${name}: 决策异常 ${err.message}`);
    }
  }

  // 保存状态文件（非 dry-run）
  if (!opts.dryRun) {
    saveState(state);
  } else {
    console.log(C.gray('  [dry-run] 未写状态文件'));
  }

  // ── 汇总 ──
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log(C.bright('══════════════════════════════════════════════'));
  console.log(C.bright('  本轮决策汇总'));
  console.log(C.bright('══════════════════════════════════════════════'));
  for (const name of Object.keys(MODULES)) {
    if (!decisions[name]) continue;
    const d = decisions[name];
    const mark = d.action === 'scrape' ? C.green('✓') : C.gray('-');
    console.log(`  ${mark} ${name.padEnd(9)} ${d.action === 'scrape' ? C.green('scrape') : C.gray('skip  ')} — ${d.reason}`);
  }

  if (summaries.length > 0) {
    console.log('');
    for (const { label, data } of summaries) {
      if (data.skipped) {
        console.log(`  ${C.gray('○')} ${label}: 本轮不抓取（演练/仅检测）`);
      } else {
        logResult(label, data);
      }
    }
  }

  // 覆盖未处理的模块说明
  const wildcard = opts.force ? '（强制）' : '（按策略）';
  console.log('');
  console.log(C.cyan(`  总耗时: ${elapsed}s${wildcard}`));
  console.log(C.gray(`  完成时间: ${nowIso()}`));
  console.log('');
}

main().catch((err) => {
  console.error(`${C.red('构建脚本崩溃:')} ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
