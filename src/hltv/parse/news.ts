import * as cheerio from 'cheerio';
import { CheerioAPI } from 'cheerio';
import { NewsItem, NewsDetail, NewsComment } from '../types';

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

/**
 * Pure passthrough article extraction: headline metadata + the sanitized
 * original body markup. No structured text-block parsing — the page renders
 * with HLTV's own CSS (see detail/newsPage.ts).
 */
export function parseNewsArticle(html: string, url: string): NewsDetail {
  const $ = cheerio.load(html);
  const article = $('article.newsitem').first();

  const title = article.find('.headline').first().text().trim();
  const author = article.find('.authorName').first().text().trim();
  const dateEl = article.find('.date[data-unix]').first();
  const date = dateEl.attr('data-unix') ? Number(dateEl.attr('data-unix')) : null;
  const intro = article.find('.headertext').first().text().replace(/\s+/g, ' ').trim();

  const comments: NewsComment[] = [];
  const forum = $('.news-comments-wrapper .forum').first();
  if (forum.length) {
    collectComments($, forum, 0, comments);
  }

  return {
    url,
    title,
    author,
    date,
    intro,
    bodyHtml: sanitizeNativeBody($, article as unknown as cheerio.Cheerio<never>),
    cssUrls: [],
    comments,
  };
}

/**
 * Sanitize the article DOM for webview passthrough:
 * - drop scripts/styles/ads/tooltips and inline styles
 * - images → empty opt-in slots keeping the original element's classes (site
 *   CSS positions flag watermarks etc. via those classes); src absolutized
 *   because the webview cannot resolve `/img/…`
 * - iframes → opt-in embed slots with a [EMBED] placeholder
 * - links → tagged for in-editor routing
 */
function sanitizeNativeBody($: CheerioAPI, article: cheerio.Cheerio<never>): string {
  // `.newsdsl` is the article content subtree (headline/author chrome around
  // it is replaced by our own h1/meta line).
  const src = article.find('.newsdsl').first();
  if (!src.length) {
    return '';
  }
  const root = $('<div></div>').append(src.html() ?? '');
  // scripts, styles, ads, mobile-only navigation, hover cards
  root.find('script, style, ins, .tooltip-con, [data-ddzyhtbikk], .BZ4Bl4KkTN, .fragments-overview-button-wrapper, .fragments-overview-wrapper').remove();
  // media opt-in: images → empty opt-in slots. NO placeholder text: hidden
  // images must be invisible, and the site's own CSS (which positions e.g.
  // the flag watermarks via the original classes) keeps applying to the slot.
  root.find('img').each((_, img) => {
    const $img = $(img);
    const raw = $img.attr('src') ?? '';
    if (!raw) {
      $img.remove();
      return;
    }
    const srcUrl = raw.startsWith('/') ? `https://www.hltv.org${raw}` : raw;
    const keptClass = ($img.attr('class') ?? '').replace(/["'<>]/g, '');
    const slot = $(`<span class="media-slot ${keptClass}" data-kind="image" data-src="${srcUrl.replace(/"/g, '&quot;')}"></span>`);
    $img.replaceWith(slot);
  });
  // iframes (Spotify/Twitch/…) → opt-in embeds
  root.find('iframe').each((_, frame) => {
    const $f = $(frame);
    const srcUrl = $f.attr('src') ?? '';
    if (!srcUrl) {
      $f.remove();
      return;
    }
    const slot = $(`<span class="media-slot" data-kind="embed" data-src="${srcUrl.replace(/"/g, '&quot;')}" data-provider="embed"><span class="placeholder">[EMBED]</span></span>`);
    $f.replaceWith(slot);
  });
  // tag links for delegated routing; drop inline styles (page-chrome leftovers)
  root.find('a').each((_, a) => {
    $(a).addClass('natlink').removeAttr('style target');
  });
  root.find('[style]').removeAttr('style');
  return root.html() ?? '';
}

function collectComments($: CheerioAPI, container: cheerio.Cheerio<any>, depth: number, out: NewsComment[]): void {
  for (const post of container.children('.post').toArray()) {
    const $p = $(post);
    const text = $p.find('.postbody').first().text().replace(/\s+/g, ' ').trim();
    if (text) {
      out.push({
        num: $p.find('.postnum').first().text().replace('#', '').trim(),
        author: $p.find('.postauthorname').first().text().trim(),
        fan: $p.find('.postfan').first().text().trim(),
        text,
        time: Number($p.find('[data-unix]').first().attr('data-unix')) || null,
        plus: $p.find('.postplus').first().text().trim(),
        depth,
      });
    }
    const replies = $p.children('.replies');
    if (replies.length) {
      collectComments($, replies, depth + 1, out);
    }
  }
}
