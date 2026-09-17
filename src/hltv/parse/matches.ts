import * as cheerio from 'cheerio';
import { Match } from '../types';

export function parseMatchesPage(html: string): Match[] {
  const $ = cheerio.load(html);
  const matches: Match[] = [];
  const seen = new Set<number>();

  // `.match-event` (live rows) and section headers `.event-headline-text`
  // both carry the event; walk the mixed selector in document order.
  let currentEventName = '';
  let currentEventId: number | null = null;
  const nodes = $('.event-headline-text, .match-wrapper');
  for (const el of nodes) {
    const $el = $(el);
    if ($el.hasClass('event-headline-text')) {
      const clone = $el.clone();
      clone.children('span').remove();
      currentEventName = clone.text().trim();
      const href = $el.closest('a[href*="/events/"]').attr('href') ?? '';
      const m = /\/events\/(\d+)/.exec(href);
      currentEventId = m ? Number(m[1]) : null;
      continue;
    }
    const idAttr = $el.attr('data-match-id');
    if (!idAttr) {
      continue;
    }
    const id = Number(idAttr);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);

    const $ownEvent = $el.find('.match-event[data-event-headline]').first();
    const eventName = $ownEvent.attr('data-event-headline') ?? currentEventName;
    const eventHref = $ownEvent.find('a[href*="/events/"]').attr('href') ?? $el.find('a[href*="/events/"]').first().attr('href') ?? '';
    const eventIdMatch = /\/events\/(\d+)/.exec(eventHref);
    const ownId = $ownEvent.attr('data-event-id');
    const eventId = ownId ? Number(ownId) : eventIdMatch ? Number(eventIdMatch[1]) : currentEventId;

    const metaTexts = $el
      .find('.match-meta')
      .map((_, m) => $(m).text().trim())
      .get()
      .filter((t) => t && t.toLowerCase() !== 'live');
    const format = metaTexts[0] ?? '';

    const names = $el.find('.match-teamname').map((_, t) => $(t).text().trim()).get();
    const href = $el.find('a.match-top').attr('href') ?? $el.find('a.match-info').attr('href') ?? '';
    const timeEl = $el.find('.match-time[data-unix]').first();
    const live = $el.attr('live') === 'true' || $el.find('.match-meta-live').length > 0;
    const stage = $el.find('.match-stage').first().text().trim();

    matches.push({
      id,
      url: href,
      team1: { id: numOrNull($el.attr('team1')), name: names[0] ?? '?' },
      team2: { id: numOrNull($el.attr('team2')), name: names[1] ?? '?' },
      event: { id: eventId, name: eventName },
      startTime: timeEl.attr('data-unix') ? Number(timeEl.attr('data-unix')) : null,
      format,
      stars: Number($el.attr('data-stars') ?? '0') || 0,
      live,
      lan: ($el.attr('lan') ?? '') === 'true',
      region: $el.attr('data-region') ?? undefined,
      stage: stage || undefined,
    });
  }
  return matches;
}

function numOrNull(v: string | undefined): number | null {
  return v && /^\d+$/.test(v) ? Number(v) : null;
}
