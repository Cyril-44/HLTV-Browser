import * as cheerio from 'cheerio';
import { CheerioAPI } from 'cheerio';
import { NewsItem, NewsDetail, NewsBlock, NewsComment, NewsSegment } from '../types';

export function parseNewsList(html: string): NewsItem[] {
  const $ = cheerio.load(html);
  const items: NewsItem[] = [];
  const seen = new Set<string>();
  for (const a of $('a.newsline.article')) {
    const $a = $(a);
    const href = $a.attr('href') ?? '';
    if (!/^\/news\/\d+\//.test(href) || seen.has(href)) {
      continue;
    }
    seen.add(href);
    const tcs = $a.find('.newstc div').map((_, d) => $(d).text().trim()).get();
    items.push({
      id: href,
      url: href,
      title: $a.find('.newstext').first().text().replace(/\s+/g, ' ').trim(),
      timeText: $a.find('.newsrecent').first().text().trim(),
      comments: tcs.filter((t) => t.toLowerCase().includes('comment'))[0] ?? tcs[tcs.length - 1] ?? '',
    });
  }
  return items;
}

export function parseNewsArticle(html: string, url: string): NewsDetail {
  const $ = cheerio.load(html);
  const article = $('article.newsitem').first();

  const title = article.find('.headline').first().text().trim();
  const author = article.find('.authorName').first().text().trim();
  const dateEl = article.find('.date[data-unix]').first();
  const date = dateEl.attr('data-unix') ? Number(dateEl.attr('data-unix')) : null;
  const intro = article.find('.headertext').first().text().replace(/\s+/g, ' ').trim();

  const blocks: NewsBlock[] = [];
  const body = article.find('.newstext-con').first();
  if (body.length) {
    for (const child of body.children().toArray()) {
      pushBlock($, child, blocks);
    }
  }

  const comments: NewsComment[] = [];
  const forum = $('.news-comments-wrapper .forum').first();
  if (forum.length) {
    collectComments($, forum, 0, comments);
  }

  return { url, title, author, date, intro, blocks, comments };
}

type AnyNode = { tagName?: string };

function pushBlock($: CheerioAPI, node: AnyNode, blocks: NewsBlock[]): void {
  const el = $(node as never);
  const tag = (node.tagName ?? '').toLowerCase();
  const cls = el.attr('class') ?? '';

  if (/featured-quote/.test(cls)) {
    // HLTV's pull-quote board: big italic speech + attribution
    const quoteSegments = collectSegments($, el.find('.featured-quote-quote').first(), [])
      .map((seg) => ({ ...seg, italic: true }));
    const author = el.find('.featured-quote-author').first().text().replace(/\s+/g, ' ').trim();
    if (quoteSegments.length) {
      normalizeSegments(quoteSegments);
      blocks.push({ kind: 'quote', segments: quoteSegments, author });
    }
    return;
  }
  if (/image-con/.test(cls)) {
    const src = el.find('img').first().attr('src') ?? '';
    if (src) {
      blocks.push({ kind: 'image', src, label: el.find('img').first().attr('title') ?? 'image' });
    }
    return;
  }
  if (/audioCon|videoCon/.test(cls) || el.find('iframe').length) {
    const iframe = el.find('iframe').first();
    const src = iframe.attr('src') ?? '';
    if (src) {
      blocks.push({ kind: 'embed', provider: providerFromUrl(src), src, label: iframe.attr('title') ?? '' });
    }
    return;
  }
  if (tag === 'blockquote') {
    const segments = collectSegments($, node, []);
    if (segments.length) {
      blocks.push({ kind: 'quote', segments });
    }
    return;
  }
  if (tag === 'p') {
    if (/headertext/.test(cls)) {
      return; // headertext is the intro, captured separately
    }
    const segments = collectSegments($, node, []);
    const flat = segments.map((x) => x.text).join('').replace(/\s+/g, ' ').trim();
    if (!flat) {
      return;
    }
    // normalize whitespace inside segments while keeping bold/italic runs
    normalizeSegments(segments);
    const link = el.find('a[href]').not('a[href*="hltv.org"]').first().attr('href');
    if (/news-block/.test(cls) && el.closest('blockquote').length) {
      blocks.push({ kind: 'quote', segments });
    } else {
      blocks.push({ kind: 'text', segments, link });
    }
    return;
  }
  // Unknown container: recurse into block-level children; otherwise render
  // its inline content (bare-text divs like image captions were dropped
  // entirely by the old recursion-only branch).
  const hasBlockChildren = el.children('p,div,blockquote,ul,ol,table').length > 0;
  if (hasBlockChildren) {
    for (const child of el.children().toArray()) {
      pushBlock($, child, blocks);
    }
    return;
  }
  const segments = collectSegments($, node, []);
  const flat = segments.map((x) => x.text).join('').replace(/\s+/g, ' ').trim();
  if (flat) {
    normalizeSegments(segments);
    blocks.push({ kind: 'text', segments });
  }
}

/**
 * Walk inline content preserving bold (strong/b — HLTV uses them for
 * interview questions, leads and entity names) and italic (em/i) runs.
 */
function collectSegments($: CheerioAPI, node: unknown, out: NewsSegment[]): NewsSegment[] {
  const push = (text: string, bold: boolean, italic: boolean): void => {
    if (!text) {
      return;
    }
    const last = out[out.length - 1];
    if (last && last.bold === bold && last.italic === italic) {
      last.text += text;
    } else {
      out.push({ text, bold, italic });
    }
  };
  const walk = (child: unknown, bold: boolean, italic: boolean): void => {
    const $child = $(child as never);
    if ((child as { type?: string }).type === 'text') {
      push($child.text(), bold, italic);
      return;
    }
    const tag = ((child as { tagName?: string }).tagName ?? '').toLowerCase();
    const nextBold = bold || tag === 'strong' || tag === 'b';
    const nextItalic = italic || tag === 'em' || tag === 'i';
    if (tag === 'br') {
      push(' ', bold, italic);
      return;
    }
    for (const inner of $child.contents().toArray()) {
      walk(inner, nextBold, nextItalic);
    }
  };
  for (const child of $(node as never).contents().toArray()) {
    walk(child, false, false);
  }
  return out;
}

function normalizeSegments(segments: NewsSegment[]): void {
  for (const seg of segments) {
    seg.text = seg.text.replace(/\s+/g, ' ');
  }
  if (segments.length) {
    segments[0].text = segments[0].text.replace(/^\s+/, '');
    const last = segments[segments.length - 1];
    last.text = last.text.replace(/\s+$/, '');
  }
}

function providerFromUrl(url: string): string {
  if (/spotify/.test(url)) return 'Spotify';
  if (/twitch/.test(url)) return 'Twitch';
  if (/youtube|youtu\.be/.test(url)) return 'YouTube';
  if (/twitter|x\.com/.test(url)) return 'X';
  if (/steam/.test(url)) return 'Steam';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'embed';
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectComments($: CheerioAPI, container: cheerio.Cheerio<any>, depth: number, out: NewsComment[]): void {
  for (const post of container.children('.post').toArray()) {
    const $post = $(post);
    const num = $post.find('.replyNum').first().text().trim();
    const author = $post.find('.authorAnchor').first().text().trim();
    const fanImg = $post.find('.fan-con img[title]').first().attr('title');
    const fanText = $post.find('.fan-con .love').first().text().replace(/\s+/g, ' ').trim();
    const text = $post.find('.forum-middle').first().text().replace(/\s+/g, ' ').trim();
    const timeEl = $post.find('.time[data-unix]').first();
    const plus = $post.find('[data-plus-count]').first().attr('data-plus-count') ?? '';
    if (author || text) {
      out.push({
        num,
        author,
        fan: fanImg ?? fanText,
        text,
        time: timeEl.attr('data-unix') ? Number(timeEl.attr('data-unix')) : null,
        plus,
        depth,
      });
    }
    const children = $post.children('.children');
    for (const child of children.toArray()) {
      collectComments($, $(child), depth + 1, out);
    }
  }
}
