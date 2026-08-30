/**
 * cache-state.mjs — 智能缓存状态读写工具
 *
 * 负责维护 scripts/.cache-state.json，记录每个抓取模块的
 * 检测频率、上次抓取时间、连续未变化周数等状态，供 build-static.mjs
 * 决策是否抓取 / 检测 / 跳过。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

// ── ANSI 颜色（与 build-static.mjs 保持一致）──
const C = {
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
};

/** 缓存状态文件路径 */
export const STATE_FILE = join(import.meta.dirname, '../.cache-state.json');

/** 缓存状态结构版本号 */
export const STATE_VERSION = 1;

/** 支持的模块列表 */
export const MODULE_NAMES = ['wiki', 'forum', 'docs', 'packages'];

/**
 * 返回一个模块的初始状态
 * @returns {object}
 */
function createFreshModuleState() {
  return {
    frequency: 'weekly',          // "weekly" | "monthly"
    lastCheckedAt: null,          // ISO 时间（最近一次检查时间）
    lastScrapedAt: null,          // ISO 时间（最近一次抓取时间）
    lastChangedAt: null,          // ISO 时间（最近一次检测到变化的时间）
    consecutiveUnchangedWeeks: 0, // 连续未变化周数
    consecutiveCheckFailures: 0,  // 连续检测失败次数
    lastCheckHash: null,          // 上次内容摘要
    lastCheckResult: 'unknown',   // "changed" | "unchanged" | "unknown" | "error"
  };
}

/**
 * 构造一个具有默认结构的全新状态
 * @returns {object}
 */
function createFreshState() {
  const modules = {};
  for (const name of MODULE_NAMES) {
    modules[name] = createFreshModuleState();
  }
  return { version: STATE_VERSION, modules };
}

/**
 * 校验单个模块状态字段是否完整，缺失字段用默认值补齐
 * @param {object} mod
 */
function normalizeModuleState(mod) {
  const defaults = createFreshModuleState();
  const normalized = { ...defaults, ...mod };
  // 确保枚举合法
  if (!['weekly', 'monthly'].includes(normalized.frequency)) normalized.frequency = 'weekly';
  if (!['changed', 'unchanged', 'unknown', 'error'].includes(normalized.lastCheckResult)) {
    normalized.lastCheckResult = 'unknown';
  }
  // 数值字段兜底
  if (typeof normalized.consecutiveUnchangedWeeks !== 'number' || normalized.consecutiveUnchangedWeeks < 0) {
    normalized.consecutiveUnchangedWeeks = 0;
  }
  if (typeof normalized.consecutiveCheckFailures !== 'number' || normalized.consecutiveCheckFailures < 0) {
    normalized.consecutiveCheckFailures = 0;
  }
  return normalized;
}

/**
 * 读取状态文件。文件不存在 / 损坏 / 版本不匹配时返回全新默认状态。
 * @returns {object}
 */
export function loadState() {
  if (!existsSync(STATE_FILE)) {
    return createFreshState();
  }

  let raw;
  try {
    raw = readFileSync(STATE_FILE, 'utf-8');
  } catch (err) {
    console.log(`${C.yellow('[cache-state]')} 读取失败（${err.message}）— 重建默认状态`);
    return createFreshState();
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.log(`${C.yellow('[cache-state]')} 状态文件损坏（${err.message}）— 重建默认状态`);
    return createFreshState();
  }

  // 版本不匹配 → 重建
  if (!parsed || parsed.version !== STATE_VERSION) {
    console.log(
      `${C.yellow('[cache-state]')} 状态版本不匹配 (当前 ${STATE_VERSION}, 文件 ${
        parsed?.version ?? '未知'
      }) — 重建默认状态`
    );
    return createFreshState();
  }

  // 补齐缺失模块 / 字段
  const modules = parsed.modules && typeof parsed.modules === 'object' ? parsed.modules : {};
  const full = createFreshState();
  for (const name of MODULE_NAMES) {
    if (modules[name] && typeof modules[name] === 'object') {
      full.modules[name] = normalizeModuleState(modules[name]);
    }
  }

  return full;
}

/**
 * 写回状态文件（JSON 格式化 2 空格）
 * @param {object} state
 */
export function saveState(state) {
  try {
    const dir = dirname(STATE_FILE);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
    console.log(`${C.gray('[cache-state]')} 状态文件已保存: ${STATE_FILE}`);
  } catch (err) {
    console.log(`${C.yellow('[cache-state]')} 保存失败: ${err.message}`);
  }
}

export { createFreshModuleState, createFreshState };
