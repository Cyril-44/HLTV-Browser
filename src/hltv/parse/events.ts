import * as cheerio from 'cheerio';
import { EventSummary } from '../types';

export function parseEventsPage(html: string): EventSummary[] {
  const $ = cheerio.load(html);
  const events: EventSummary[] = [];
  const seen = new Set<number>();

  for (const el of $('a.big-event, a.small-event')) {
    const $el = $(el);
    const href = $el.attr('href') ?? '';
    const idMatch = /\/events\/(\d+)/.exec(href);
    if (!idMatch) {
      continue;
    }
    const id = Number(idMatch[1]);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);

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
    });
  }
  return events;
}
