import type { APIRoute } from "astro";
import { getCollection, type CollectionEntry } from "astro:content";

/**
 * Build-time search index, emitted as /search-index.json.
 *
 * Consumed by <SearchBar /> (client-side filter). Entry shape:
 *   { "title": "Getting Started", "slug": "/wiki/getting-started/", "excerpt": "…" }
 *
 * Regenerated on every build so it always mirrors the scraped wiki content.
 */

export const prerender = true;

/** Decode the HTML entities that commonly survive scraping (e.g. &#039;). */
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ");
}

/** Strip markdown / wiki artifacts from a raw page body, keep readable text. */
function toPlainText(markdown: string): string {
  return decodeEntities(
    markdown
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links -> their label
      .replace(/\[\[|\]\]/g, "") // leftover wiki / ref brackets
      .replace(/<[^>]+>/g, "") // stray HTML tags
      .replace(/^#{1,6}\s*/gm, "") // heading markers
      .replace(/^\s*[-*+]\s+/gm, "") // list bullets
      .replace(/[`*_~]/g, "") // inline code / emphasis markers
      .replace(/\s+/g, " ")
      .trim(),
  );
}

/** First ~200 characters of the visible text, cut at a word boundary. */
function makeExcerpt(body: string, max = 200): string {
  const text = toPlainText(body);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : max)}…`;
}

export const GET: APIRoute = async () => {
  const wikiPages = await getCollection("wiki");

  const index = wikiPages.map((page: CollectionEntry<"wiki">) => ({
    title: decodeEntities(page.data.title),
    slug: `/wiki/${page.id}/`,
    excerpt: makeExcerpt(page.body ?? ""),
  }));

  return new Response(JSON.stringify(index), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};