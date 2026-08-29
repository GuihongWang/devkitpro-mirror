/**
 * converter.mjs - HTML 转 Markdown 工具
 * 使用 turndown 将 HTML 转为 Markdown，相对 URL 转绝对 URL，清理无用标签
 */

import TurndownService from 'turndown';

// ── 颜色 ──
const C = {
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
};

function logInfo(msg) { console.log(`${C.cyan('[CONVERTER]')} ${msg}`); }

/**
 * 创建配置好的 TurndownService
 * @param {string} baseUrl  用于转换相对链接的基础 URL
 * @returns {TurndownService}
 */
export function createTurndown(baseUrl) {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    linkReferenceStyle: 'full',
    fence: '```',
    preformatted: true,
  });

  // ── 移除无用标签 ──
  const removeSelectors = [
    'script', 'style', 'noscript', 'iframe',
    'nav', 'footer', 'header',
    '.sidebar', '.toc', '.breadcrumbs',
    '#mw-page-base', '#mw-head', '#mw-navigation',
    '.mw-editsection', '.mw-editlink',
    '.printfooter', '#catlinks', '#footlinks',
    '.noprint', '.mw-empty-elt',
    'link[rel="stylesheet"]',
  ];

  for (const sel of removeSelectors) {
    td.remove(sel);
  }

  // ── 移除 <style> 和 <script> 标签内容 ──
  td.addRule('removeScriptStyle', {
    filter: ['script', 'style', 'noscript'],
    replacement: () => '',
  });

  // ── 处理相对 URL → 绝对 URL ──
  function resolveUrl(href) {
    if (!href) return href;
    // 已经是绝对 URL
    if (/^https?:\/\//i.test(href) || href.startsWith('//')) return href;
    // mailto / tel
    if (/^(mailto|tel):/i.test(href)) return href;
    // 锚点
    if (href.startsWith('#')) return href;
    try {
      return new URL(href, baseUrl).href;
    } catch {
      return href;
    }
  }

  // 链接转换
  td.addRule('resolveLinks', {
    filter: 'a',
    replacement: (content, node) => {
      const href = node.getAttribute('href');
      const resolved = resolveUrl(href);
      return `[${content.trim()}](${resolved})`;
    },
  });

  // 图片转换
  td.addRule('resolveImages', {
    filter: 'img',
    replacement: (content, node) => {
      const src = node.getAttribute('src');
      const alt = node.getAttribute('alt') || '';
      const resolved = resolveUrl(src);
      return `![${alt}](${resolved})`;
    },
  });

  // 表格美化
  td.addRule('tableEnhance', {
    filter: 'table',
    replacement: (content, node) => {
      return '\n\n' + content.trim() + '\n\n';
    },
  });

  // MediaWiki 特殊: 预格式化内容
  td.addRule('preContent', {
    filter: (node) => {
      return node.nodeName === 'PRE' && node.parentNode &&
        node.parentNode.nodeName !== 'CODE';
    },
    replacement: (content, node) => {
      const text = node.textContent || content;
      return '\n```\n' + text + '\n```\n';
    },
  });

  // 角标 (sup)
  td.addRule('superscript', {
    filter: 'sup',
    replacement: (content) => `^${content}`,
  });

  return td;
}

/**
 * 将 HTML 转为 Markdown
 * @param {string} html
 * @param {string} baseUrl  用于解析相对 URL 的基础地址
 * @returns {string}
 */
export function htmlToMarkdown(html, baseUrl) {
  if (!html || typeof html !== 'string') return '';

  const td = createTurndown(baseUrl);

  let md = td.turndown(html);

  // 清理多余空行 (连续 3+ 空行 → 2)
  md = md.replace(/\n{3,}/g, '\n\n');

  // 清理行尾空格
  md = md.replace(/[ \t]+$/gm, '');

  return md.trim();
}

/**
 * 生成 frontmatter
 * @param {object} meta
 * @returns {string}
 */
export function frontmatter(meta) {
  const lines = ['---'];
  for (const [key, val] of Object.entries(meta)) {
    if (val === undefined || val === null) continue;
    if (typeof val === 'string') {
      lines.push(`${key}: "${val.replace(/"/g, '\\"')}"`);
    } else {
      lines.push(`${key}: ${JSON.stringify(val)}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

export default { createTurndown, htmlToMarkdown, frontmatter };
