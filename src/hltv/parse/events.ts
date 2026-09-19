import * as cheerio from 'cheerio';
import { EventSummary } from '../types';

export function parseEventsPage(html: string): EventSummary[] {
  const $ = cheerio.load(html);
  // id → event; ongoing entries are inserted first so duplicates from the
  // upcoming lists never overwrite them.
  const byId = new Map<number, EventSummary>();

  // Ongoing events live in their own containers (a.ongoing-event, duplicated
  // across the FEATURED/TODAY tabs — the map dedupes them).
  for (const el of $('a.ongoing-event')) {
    const $el = $(el);
    const href = $el.attr('href') ?? '';
    const idMatch = /\/events\/(\d+)/.exec(href);
    if (!idMatch || byId.has(Number(idMatch[1]))) {
      continue;
    }
    const unixSpans = $el.find('[data-unix]').map((_, s) => $(s).attr('data-unix')).get();
    const dateSpans = $el.find('[data-unix]').map((_, s) => $(s).text().trim()).get();
    // The FEATURED tab shows ongoing tournaments with the big-block layout;
    // the TODAY tab lists all ongoing events (duplicates — deduped by the map).
    const featured = $el.closest('.tab-content').attr('id') === 'FEATURED';
    byId.set(Number(idMatch[1]), {
      id: Number(idMatch[1]),
      url: href,
      name: $el.find('.event-name-small .text-ellipsis').first().text().trim(),
      dateText: dateSpans.join(' - '),
      dateStart: unixSpans.length ? Math.min(...unixSpans.map(Number)) : null,
      prize: '',
      teamsCount: '',
      location: '',
      type: $el.find('.lan-marker').first().text().trim(),
      big: featured,
      ongoing: true,
    });
  }

  const events: EventSummary[] = [...byId.values()];

  for (const el of $('a.big-event, a.small-event')) {
    const $el = $(el);
    const href = $el.attr('href') ?? '';
    const idMatch = /\/events\/(\d+)/.exec(href);
    if (!idMatch) {
      continue;
    }
    const id = Number(idMatch[1]);
    if (byId.has(id)) {
      continue;
    }

    const big = $el.hasClass('big-event');
    const name = big
      ? $el.find('.big-event-name').first().text().trim()
      : $el.find('td.event-col .text-ellipsis').first().text().trim() || $el.find('.event-name, .text-ellipsis').first().text().trim();

    // Small rows: td.col-date | td.event-col (name) | td.small-col (teams) |
    // td.prizePoolEllipsis (prize) | td.gtSmartphone-only (type)
    const tdText = (selector: string): string => $el.find(selector).first().text().replace(/\s+/g, ' ').trim();
    const prizeTd = $el.find('td.prizePoolEllipsis').first();
    const prize = prizeTd.attr('title')?.trim() || prizeTd.text().trim();
    const type = tdText('td.gtSmartphone-only');
    const teamsCount = $el
      .find('td.small-col')
      .not('.prizePoolEllipsis')
      .not('.gtSmartphone-only')
      .first()
      .text()
      .trim();

    const unixSpans = $el.find('[data-unix]').map((_, s) => Number($(s).attr('data-unix'))).get();
    const dateStart = unixSpans.length ? Math.min(...unixSpans) : null;

    events.push({
      id,
      url: href,
      name,
      dateText: tdText('td.col-date') || $el.find('[data-unix]').first().text().trim(),
      dateStart,
      prize,
      teamsCount,
      location: big
        ? $el.find('.big-event-location').first().text().replace(/\s+/g, ' ').trim()
        : tdText('td.col-value.location'),
      type,
      big,
      ongoing: false,
    });
    byId.set(id, events[events.length - 1]);
  }
  return events;
}
