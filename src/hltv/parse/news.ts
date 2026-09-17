import * as cheerio from 'cheerio';
import { CheerioAPI } from 'cheerio';
import { NewsItem, NewsDetail, NewsBlock, NewsComment } from '../types';

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
    const text = el.text().replace(/\s+/g, ' ').trim();
    if (text) {
      blocks.push({ kind: 'quote', text });
    }
    return;
  }
  if (tag === 'p') {
    const text = el.text().replace(/\s+/g, ' ').trim();
    if (!text || /headertext/.test(cls)) {
      return; // headertext is the intro, captured separately
    }
    const link = el.find('a[href]').not('a[href*="hltv.org"]').first().attr('href');
    if (/news-block/.test(cls) && el.closest('blockquote').length) {
      blocks.push({ kind: 'quote', text });
    } else {
      blocks.push({ kind: 'text', text, link });
    }
    return;
  }
  // unknown container (divs wrapping paragraphs, etc.) — recurse one level
  const text = el.text().replace(/\s+/g, ' ').trim();
  if (text && el.children().length) {
    for (const child of el.children().toArray()) {
      pushBlock($, child, blocks);
    }
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
