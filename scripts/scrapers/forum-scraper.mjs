/**
 * forum-scraper.mjs - phpBB 论坛爬虫
 * 抓取 devkitpro.org 论坛公告和主要讨论板块
 * 快照性质 — 保存最近的帖子即可
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { throttledFetch, logInfo, logOk, logWarn, logErr, logStep, sleep } from '../utils/fetcher.mjs';
import { htmlToMarkdown, frontmatter } from '../utils/converter.mjs';

// 论坛实际挂在站点根路径（phpBB + 门户扩展）；/forum/ 子路径已移除（404）
const FORUM_BASE = 'https://devkitpro.org';
const OUTPUT_DIR = join(import.meta.dirname, '../../src/content/forum');

// 板块说明：devkitPro 论坛已收紧访问，匿名用户仅能看到 Announcements (f=13)。
// 其他板块（开发/帮助等）会重定向到 Login 页，无法匿名抓取 → 标注为需登录。
const BOARDS = [
  { id: 13, name: 'announcements', label: '公告' },
];

// 曾经可匿名访问、现已关闭的板块（f=6/7/8/9 → 404 或 Login），仅作记录
const LOGIN_REQUIRED_BOARDS = [
  { id: 7, name: 'general', label: '综合讨论' },
  { id: 8, name: 'dev', label: '开发讨论' },
  { id: 9, name: 'help', label: '帮助与支持' },
];

// 每个板块最多抓取多少帖子
const MAX_POSTS_PER_BOARD = 30;
// 每个帖子最多抓取多少回复
const MAX_REPLIES = 20;

// ── 解析 phpBB HTML 页面中的帖子列表 ──
function parseTopicList(html) {
  const topics = [];
  // 匹配所有 <a> 标签，挑选含 class="…topictitle…" 且 href 指向 viewtopic 的条目。
  // 注意：当前站点的属性顺序是 href 在前、class 在后（旧正则 class 在前，会失配）。
  const linkRegex = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set();
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const tag = match[0];
    if (!/class="[^"]*topictitle[^"]*"/.test(tag)) continue;
    const hrefMatch = tag.match(/href="([^"]*)"/);
    if (!hrefMatch) continue;
    const href = hrefMatch[1].replace(/&amp;/g, '&');
    if (!/viewtopic\.php\?t=\d+/.test(href)) continue;
    const title = match[1].replace(/<[^>]+>/g, '').trim();
    if (title && !seen.has(href)) {
      seen.add(href);
      topics.push({ title, href });
    }
  }
  return topics;
}

// ── 解析帖子内容 ──
function parsePostContent(html) {
  // phpBB 帖子内容在 <div class="content"> 中
  const contentRegex = /<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  const posts = [];
  let match;
  while ((match = contentRegex.exec(html)) !== null) {
    posts.push(match[1]);
  }
  return posts;
}

// ── 构建完整 URL ──
function resolveHref(href) {
  if (!href) return '';
  const clean = href.replace(/&amp;/g, '&');
  if (/^https?:\/\//i.test(clean)) return clean;
  try {
    return new URL(clean, FORUM_BASE + '/').href;
  } catch {
    return `${FORUM_BASE}/${clean.replace(/^\.?\//, '')}`;
  }
}

// ── 判断是否为 phpBB 登录页（板块要求登录时的重定向页面）──
// 注意：普通板块页顶部导航也有 <a href="ucp.php?mode=login"> 登录链接，
// 不能仅凭链接出现就判定登录页，必须结合页面标题或实际登录表单。
function isLoginPage(html) {
  const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
  if (/\bLogin\b/i.test(title)) return true;

  // 有实际登录表单（name=credential / name=login / form action 指向 mode=login）
  if (/name=["']credential["']/i.test(html)) return true;
  if (/<form\b[^>]*action=["'][^"']*ucp\.php[^"']*mode=login/i.test(html)) return true;
  return false;
}

// ── 抓取板块帖子列表 ──
async function fetchBoardTopics(boardId, boardName) {
  logStep(`抓取板块: ${boardName} (f=${boardId})`);
  const url = `${FORUM_BASE}/viewforum.php?f=${boardId}`;
  const res = await throttledFetch(url, { interval: 800 });
  const html = await res.text();

  if (isLoginPage(html)) {
    throw new Error('该板块需要登录，匿名访问不可用');
  }

  const topics = parseTopicList(html);
  logInfo(`  找到 ${topics.length} 个帖子 (限制取前 ${MAX_POSTS_PER_BOARD})`);
  return topics.slice(0, MAX_POSTS_PER_BOARD);
}

// ── 抓取帖子详情 ──
async function fetchTopicDetail(topic, boardName) {
  const url = resolveHref(topic.href);
  const res = await throttledFetch(url, { interval: 800 });
  const html = await res.text();

  if (isLoginPage(html)) {
    throw new Error('帖子需要登录，匿名访问不可用');
  }

  const postsHtml = parsePostContent(html);

  // 只保留前 MAX_REPLIES 条
  const limitedPosts = postsHtml.slice(0, MAX_REPLIES);
  const markdownPosts = limitedPosts.map((h) => htmlToMarkdown(h, FORUM_BASE));

  return {
    title: topic.title,
    url,
    board: boardName,
    post_count: postsHtml.length,
    posts: markdownPosts,
    scraped_at: new Date().toISOString(),
  };
}

// ── 清理文件名 ──
function sanitizeFilename(title) {
  return title
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .trim()
    .slice(0, 100);
}

// ── 主入口 ──
export async function scrapeForum() {
  logStep('═══ Forum 爬虫 ═══');

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  let totalTopics = 0;
  let success = 0;
  let failed = 0;
  const allResults = [];

  for (const board of BOARDS) {
    try {
      const topics = await fetchBoardTopics(board.id, board.name);

      for (let i = 0; i < topics.length; i++) {
        const topic = topics[i];
        try {
          logInfo(`  [${board.name}] ${i + 1}/${topics.length}: ${topic.title}`);
          const detail = await fetchTopicDetail(topic, board.label);

          // 保存 JSON 元数据
          const filename = `${board.name}_${sanitizeFilename(topic.title)}.json`;
          const filePath = join(OUTPUT_DIR, filename);

          const output = {
            title: detail.title,
            url: detail.url,
            board: detail.board,
            board_name: board.name,
            post_count: detail.post_count,
            scraped_at: detail.scraped_at,
            summary: detail.posts.slice(0, 3).join('\n\n---\n\n'),
          };

          writeFileSync(filePath, JSON.stringify(output, null, 2), 'utf-8');
          success++;
          allResults.push(output);
        } catch (err) {
          logWarn(`  跳过帖子: ${topic.title} — ${err.message}`);
          failed++;
        }
      }
    } catch (err) {
      logErr(`  板块 ${board.name} 抓取失败: ${err.message}`);
      failed++;
    }
  }

  // 保存汇总 index
  const index = {
    boards: BOARDS.map((b) => ({ id: b.id, name: b.name, label: b.label })),
    total_topics: allResults.length,
    scraped_at: new Date().toISOString(),
    topics: allResults.map((r) => ({
      title: r.title,
      url: r.url,
      board: r.board_name,
      post_count: r.post_count,
    })),
  };

  writeFileSync(join(OUTPUT_DIR, 'index.json'), JSON.stringify(index, null, 2), 'utf-8');

  logOk('论坛爬取完成');
  logInfo(`  成功: ${success}`);
  logInfo(`  失败: ${failed}`);
  logWarn(`  以下板块要求登录，无法匿名抓取: ${LOGIN_REQUIRED_BOARDS.map((b) => `${b.name}(f=${b.id})`).join(', ')}`);

  return { success, failed, totalTopics, loginRequired: LOGIN_REQUIRED_BOARDS.map((b) => b.name) };
}

// ── 独立运行 ──
if (process.argv[1] && process.argv[1].endsWith('forum-scraper.mjs')) {
  scrapeForum().catch((err) => {
    logErr(`论坛爬虫崩溃: ${err.message}`);
    process.exit(1);
  });
}
