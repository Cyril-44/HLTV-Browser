import * as cheerio from 'cheerio';
import { CheerioAPI } from 'cheerio';
import { NewsItem, NewsDetail, NewsBlock, NewsComment, NewsSegment, NewsTeamMention, NewsFragment } from '../types';

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
  const teams: NewsTeamMention[] = [];
  const seenTeams = new Set<string>();
  const body = article.find('.newstext-con').first();
  if (body.length) {
    for (const child of body.children().toArray()) {
      pushBlock($, child, blocks, teams, seenTeams);
    }
  }

  // Short-news weeklies are built from fragments: headline + time + author +
  // a per-item body (paragraphs, images, embedded match widgets).
  const fragments: NewsFragment[] = [];
  for (const frag of body.find('.fragment')) {
    const $frag = $(frag);
    const fragBlocks: NewsBlock[] = [];
    for (const child of $frag.find('.fragment-content').first().children().toArray()) {
      pushBlock($, child, fragBlocks, teams, seenTeams);
    }
    fragments.push({
      id: $frag.attr('id') ?? '',
      timeAgo: $frag.find('.fragment-time').first().text().replace(/\s+/g, ' ').trim(),
      author: $frag.find('.fragment-author').first().text().replace(/\s+/g, ' ').trim(),
      authorUrl: $frag.find('.fragment-author').attr('href') ?? '',
      headline: $frag.find('.fragment-headline').first().text().replace(/\s+/g, ' ').trim(),
      blocks: fragBlocks,
    });
  }

  // Team hover cards live OUTSIDE the body container (siblings within the
  // article); collect each mentioned team's roster, deduplicated.
  for (const teamBox of article.find('.newsitem-tooltips.team-tooltip').toArray()) {
    const $box = $(teamBox);
    const teamLink = $box.find('.newsitem-flex a[href^="/team/"]').first();
    const name = teamLink.text().replace(/\s+/g, ' ').trim();
    const teamId = teamLink.attr('href') ?? name;
    if (!name || seenTeams.has(teamId)) {
      continue;
    }
    seenTeams.add(teamId);
    teams.push({
      name,
      rank: $box.find('.newsitem-flex .text-right b').first().text().trim(),
      players: $box
        .find('a.team-player-row')
        .map((_, x) => $(x).find('b').first().text().trim() || $(x).text().replace(/\s+/g, ' ').trim())
        .get()
        .filter(Boolean),
    });
  }

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
    blocks,
    fragments,
    teams,
    comments,
  };
}

type AnyNode = { tagName?: string };

function pushBlock($: CheerioAPI, node: AnyNode, blocks: NewsBlock[], teams: NewsTeamMention[], seenTeams: Set<string>): void {
  const el = $(node as never);
  const tag = (node.tagName ?? '').toLowerCase();
  const cls = el.attr('class') ?? '';

  if (tag === 'hr') {
    blocks.push({ kind: 'hr' });
    return;
  }
  if (/twocol/.test(cls)) {
    // Two-column team list (flags + team links separated by <br>)
    const teams = el.find('a[href^="/team/"]')
      .map((_, x) => $(x).text().replace(/\s+/g, ' ').trim())
      .get()
      .filter(Boolean);
    if (teams.length) {
      blocks.push({ kind: 'teamList', teams });
    }
    return;
  }
  if (/^fragments?$/.test(cls) || /fragment(?!s)/.test(cls)) {
    return; // short-news fragments are collected separately in parseNewsArticle
  }
  if (/newsitem-match-result/.test(cls)) {
    // Embedded match result widget; the stats table is an adjacent sibling.
    const eventName = el.find('.newsitem-match-result-top a').first().text().replace(/\s+/g, ' ').trim();
    const matchType = el.find('.newsitem-match-type').first().text().trim();
    const teamLinks = el.find('.newsitem-match-result-team-con a[href^="/team/"]');
    const team1 = teamLinks.eq(0).text().trim();
    const team2 = teamLinks.eq(1).text().trim();
    const scores = el.find('.newsitem-match-result-score').map((_, x) => $(x).text().trim()).get();
    const matchUrl = el.find('.newsitem-match-result-score-con a[href^="/matches/"]').attr('href') ?? '';
    const dateText = el.find('.newsitem-match-result-date').first().text().trim();
    const maps: { name: string; score1: string; score2: string }[] = [];
    for (const mapEl of el.find('.newsitem-match-result-map')) {
      const $m = $(mapEl);
      maps.push({
        name: $m.find('.newsitem-match-result-map-name').first().text().trim(),
        score1: $m.children().first().text().trim(),
        score2: $m.children().last().text().trim(),
      });
    }
    // adjacent stats table (same widget family)
    const stats: { team: string; rows: { nick: string; kd: string; swing: string; adr: string; kast: string; rating: string }[] }[] = [];
    const statsBoxes = el.nextAll('.newsitem-match-stats');
    for (const statsBox of statsBoxes.toArray()) {
      const $stats = $(statsBox).find('table.newsitem-match-stats-table');
      let current: { team: string; rows: { nick: string; kd: string; swing: string; adr: string; kast: string; rating: string }[] } | null = null;
      for (const tr of $stats.find('tr')) {
        const $tr = $(tr);
        if ($tr.hasClass('newsitem-match-stats-header')) {
          current = { team: $tr.find('a').first().text().trim(), rows: [] };
          stats.push(current);
          continue;
        }
        if (!current) {
          continue;
        }
        const nick = $tr.find('.newsitem-match-stats-player .bold').first().text().trim()
          || $tr.find('.newsitem-match-stats-player a').first().text().trim();
        if (!nick) {
          continue;
        }
        const cell = (cls: string): string => $tr.find(`td.newsitem-match-stats-${cls}`).first().text().replace(/\s+/g, ' ').trim();
        current.rows.push({ nick, kd: cell('kd'), swing: cell('roundSwing'), adr: cell('adr'), kast: cell('kast'), rating: cell('rating') });
      }
    }
    if (team1 || team2) {
      blocks.push({
        kind: 'match',
        event: eventName,
        matchType,
        team1,
        team2,
        score1: scores[0] ?? '',
        score2: scores[2] ?? scores[1] ?? '',
        dateText,
        matchUrl,
        maps,
        stats,
      });
    }
    return;
  }
  if (/newsitem-match-stats/.test(cls)) {
    return; // consumed by the match widget above
  }
  if (/event-matches-table/.test(cls)) {
    // Upcoming-match fixture table embedded in preview articles
    const eventName = el.find('tr.event-header-cell a').first().text().replace(/\s+/g, ' ').trim();
    const rows: { epoch: number | null; team1: string; team2: string; url: string }[] = [];
    for (const tr of el.find('tr.team-row')) {
      const $tr = $(tr);
      const names = $tr.find('.team-name').map((_, x) => $(x).text().trim()).get();
      const epochEl = $tr.find('.time-cell [data-unix]').first();
      const url = $tr.find('.stats-button-cell a[href^="/matches/"]').attr('href') ?? '';
      if (names.length >= 2) {
        rows.push({
          epoch: epochEl.attr('data-unix') ? Number(epochEl.attr('data-unix')) : null,
          team1: names[0],
          team2: names[1],
          url,
        });
      }
    }
    if (rows.length) {
      blocks.push({ kind: 'fixtures', event: eventName, rows });
    }
    return;
  }
  if (/news-read-more/.test(cls)) {
    const title = el.find('[class*="-bottom"]').first().text().replace(/\s+/g, ' ').trim();
    const url = el.attr('href') ?? '';
    if (title && url) {
      blocks.push({ kind: 'readMore', title, url });
    }
    return;
  }
  if (/tooltip-con/.test(cls)) {
    // Hover cards carry the roster of every team mentioned in the article;
    // render them as a deduplicated appendix instead of stray fragments.
    const teamBox = el.find('.newsitem-tooltips.team-tooltip').first();
    if (!teamBox.length) {
      return; // player tooltips and other popups are not body content
    }
    const teamLink = teamBox.find('.newsitem-flex a[href^="/team/"]').first();
    const name = teamLink.text().replace(/\s+/g, ' ').trim();
    const teamId = teamLink.attr('href') ?? name;
    if (!name || seenTeams.has(teamId)) {
      return;
    }
    seenTeams.add(teamId);
    teams.push({
      name,
      rank: teamBox.find('.newsitem-flex .text-right b').first().text().trim(),
      players: teamBox
        .find('a.team-player-row')
        .map((_, x) => $(x).find('b').first().text().trim() || $(x).text().replace(/\s+/g, ' ').trim())
        .get()
        .filter(Boolean),
    });
    return;
  }
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
    if (/news-block/.test(cls) && el.closest('blockquote').length) {
      blocks.push({ kind: 'quote', segments });
    } else {
      blocks.push({ kind: 'text', segments });
    }
    return;
  }
  // Unknown container: recurse into block-level children; otherwise render
  // its inline content (bare-text divs like image captions were dropped
  // entirely by the old recursion-only branch).
  const hasBlockChildren = el.children('p,div,blockquote,ul,ol,table').length > 0;
  if (hasBlockChildren) {
    for (const child of el.children().toArray()) {
      pushBlock($, child, blocks, teams, seenTeams);
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
function collectSegments($: CheerioAPI, node: unknown, out: NewsSegment[] = []): NewsSegment[] {
  const append = (target: NewsSegment[], text: string, bold: boolean, italic: boolean, href?: string): void => {
    if (!text) {
      return;
    }
    const last = target[target.length - 1];
    if (last && last.bold === bold && last.italic === italic && last.href === href) {
      last.text += text;
    } else {
      target.push({ text, bold, italic, href: href || undefined });
    }
  };
  const walk = (child: unknown, bold: boolean, italic: boolean, target: NewsSegment[]): void => {
    const $child = $(child as never);
    if ((child as { type?: string }).type === 'text') {
      append(target, $child.text(), bold, italic);
      return;
    }
    const tag = ((child as { tagName?: string }).tagName ?? '').toLowerCase();
    if (tag === 'br') {
      append(target, '\n', bold, italic);
      return;
    }
    if (tag === 'a') {
      const href = $child.attr('href') ?? '';
      const sub: NewsSegment[] = [];
      for (const inner of $child.contents().toArray()) {
        walk(inner, bold, italic, sub);
      }
      for (const seg of sub) {
        append(target, seg.text, seg.bold, seg.italic, href);
      }
      return;
    }
    const nextBold = bold || tag === 'strong' || tag === 'b';
    const nextItalic = italic || tag === 'em' || tag === 'i';
    for (const inner of $child.contents().toArray()) {
      walk(inner, nextBold, nextItalic, target);
    }
  };
  for (const child of $(node as never).contents().toArray()) {
    walk(child, false, false, out);
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

/**
 * Build a sanitized copy of the original article body for native rendering
 * with HLTV's own CSS: strip scripts/ads/hover-cards, neutralize media into
 * opt-in placeholders, and tag links for in-app routing.
 */
function sanitizeNativeBody($: CheerioAPI, article: cheerio.Cheerio<never>): string {
  const src = article.find('.newsdsl').first();
  if (!src.length) {
    return '';
  }
  const root = $('<div></div>').append(src.html() ?? '');
  // scripts, styles, ads, mobile-only navigation, hover cards
  root.find('script, style, ins, .tooltip-con, [data-ddzyhtbikk], .BZ4Bl4KkTN, .fragments-overview-button-wrapper, .fragments-overview-wrapper').remove();
  // media opt-in: images → placeholder slots (existing global toggle drives them)
  root.find('img').each((_, img) => {
    const $img = $(img);
    const srcUrl = $img.attr('src') ?? '';
    if (!srcUrl) {
      $img.remove();
      return;
    }
    const slot = $(`<span class="media-slot" data-kind="image" data-src="${srcUrl.replace(/"/g, '&quot;')}"><span class="placeholder">[IMG]</span></span>`);
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
