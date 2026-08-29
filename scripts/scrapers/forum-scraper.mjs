/**
 * forum-scraper.mjs - phpBB 论坛爬虫
 * 抓取 devkitpro.org 论坛公告和主要讨论板块
 * 快照性质 — 保存最近的帖子即可
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { throttledFetch, logInfo, logOk, logWarn, logErr, logStep, sleep } from '../utils/fetcher.mjs';
import { htmlToMarkdown, frontmatter } from '../utils/converter.mjs';

const FORUM_BASE = 'https://devkitpro.org/forum';
const OUTPUT_DIR = join(import.meta.dirname, '../../src/content/forum');

// 要抓取的板块 ID 和名称
const BOARDS = [
  { id: 6, name: 'announcements', label: '公告' },
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
  // phpBB 主题列表常见结构: <a class="topictitle" href="viewtopic.php?f=X&t=Y">Title</a>
  const topicRegex = /<a[^>]*class="[^"]*topictitle[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = topicRegex.exec(html)) !== null) {
    const [, href, rawTitle] = match;
    const title = rawTitle.replace(/<[^>]+>/g, '').trim();
    if (title) {
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
  if (/^https?:\/\//i.test(href)) return href;
  return `${FORUM_BASE}/${href}`;
}

// ── 抓取板块帖子列表 ──
async function fetchBoardTopics(boardId, boardName) {
  logStep(`抓取板块: ${boardName} (f=${boardId})`);
  const url = `${FORUM_BASE}/viewforum.php?f=${boardId}`;
  const res = await throttledFetch(url, { interval: 800 });
  const html = await res.text();
  const topics = parseTopicList(html);
  logInfo(`  找到 ${topics.length} 个帖子 (限制取前 ${MAX_POSTS_PER_BOARD})`);
  return topics.slice(0, MAX_POSTS_PER_BOARD);
}

// ── 抓取帖子详情 ──
async function fetchTopicDetail(topic, boardName) {
  const url = resolveHref(topic.href);
  const res = await throttledFetch(url, { interval: 800 });
  const html = await res.text();
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

  return { success, failed, totalTopics };
}

// ── 独立运行 ──
if (process.argv[1] && process.argv[1].endsWith('forum-scraper.mjs')) {
  scrapeForum().catch((err) => {
    logErr(`论坛爬虫崩溃: ${err.message}`);
    process.exit(1);
  });
}
