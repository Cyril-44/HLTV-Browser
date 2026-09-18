import * as cheerio from 'cheerio';
import { ResultMatch } from '../types';

export function parseResultsPage(html: string): ResultMatch[] {
  const $ = cheerio.load(html);
  // The same match can appear twice (event tab + "all results" list); the
  // all-results copy carries data-zonedgrouping-entry-unix, so prefer it.
  const byId = new Map<number, ResultMatch>();

  for (const con of $('.result-con')) {
    const $con = $(con);
    const a = $con.find('a.a-reset').first();
    const href = a.attr('href') ?? '';
    const idMatch = /\/matches\/(\d+)\//.exec(href);
    if (!idMatch) {
      continue;
    }
    const id = Number(idMatch[1]);

    const scoreText = $con.find('.result-score').first().text().trim(); // "2 - 0"
    const [score1 = '', score2 = ''] = scoreText.split('-').map((s) => s.trim());

    const teamCells = $con.find('.team-cell');
    const team1 = teamCells.eq(0).find('.team').first().text().trim();
    const team2 = teamCells.eq(1).find('.team').first().text().trim();

    const eventName = $con.find('.event-name').first().text().trim();
    const eventHref = $con.find('.event a[href*="/events/"], td.event a[href*="/events/"]').attr('href') ?? '';
    const eventIdMatch = /\/events\/(\d+)/.exec(eventHref);

    // Per-row epoch (ms). Day-group headers only exist as a JS-rendered
    // fallback when the row attribute is missing.
    const entryUnix = $con.attr('data-zonedgrouping-entry-unix');
    const dayHeader = $con.closest('.results-sublist').find('[data-unix]').first();
    const startTime = entryUnix
      ? Number(entryUnix)
      : dayHeader.attr('data-unix')
        ? Number(dayHeader.attr('data-unix'))
        : null;

    const parsed: ResultMatch = {
      id,
      url: href,
      team1: { id: null, name: team1 },
      team2: { id: null, name: team2 },
      score1,
      score2,
      event: { id: eventIdMatch ? Number(eventIdMatch[1]) : null, name: eventName },
      startTime,
      format: $con.find('.map-text').first().text().trim(),
      stars: $con.find('.stars .fa-star:not(.faded), .stars i[class*=star]').length,
    };
    const existing = byId.get(id);
    if (!existing || (existing.startTime === null && parsed.startTime !== null)) {
      byId.set(id, parsed);
    }
  }
  return [...byId.values()];
}
