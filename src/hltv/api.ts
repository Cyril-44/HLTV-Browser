import * as cheerio from 'cheerio';
import { engine } from './engine';
import { TtlCache } from './cache';
import { parseMatchesPage } from './parse/matches';
import { parseResultsPage } from './parse/results';
import { parseEventsPage } from './parse/events';
import { parseMatchPage } from './parse/matchPage';
import { parseEventPage } from './parse/eventPage';
import { parseNewsList, parseNewsArticle } from './parse/news';

import { Match, ResultMatch, EventSummary, EventDetail, MatchDetail, NewsItem, NewsDetail, SideStatsTable, StatRow, StatsTable } from './types';

const BASE = 'https://www.hltv.org';

/**
 * Session snapshot cache: a page is fetched at most once per VSCode session
 * and reused forever — exactly the request pattern of the original extension
 * that never tripped Cloudflare. Manual refresh (refresh commands) is the
 * only path that clears these.
 */
function snapshotCache<T>(): TtlCache<T> {
  return new TtlCache<T>(Number.POSITIVE_INFINITY);
}

const caches = {
  matches: snapshotCache<Match[]>(),
  results: snapshotCache<ResultMatch[]>(),
  events: snapshotCache<EventSummary[]>(),
  eventMatches: new Map<number, TtlCache<Match[]>>(),
  matchDetail: snapshotCache<MatchDetail>(),
  eventDetail: snapshotCache<EventDetail>(),
  news: snapshotCache<NewsItem[]>(),
  newsDetail: snapshotCache<NewsDetail>(),
  sideStats: snapshotCache<SideStatsTable[]>(),
};

/** Manual refresh: forget every fetched page so the next load refetches. */
export function clearAllCaches(): void {
  caches.matches.clear();
  caches.results.clear();
  caches.events.clear();
  caches.eventMatches.clear();
  caches.matchDetail.clear();
  caches.eventDetail.clear();
  caches.news.clear();
  caches.newsDetail.clear();
  caches.sideStats.clear();
}

async function html(path: string): Promise<string> {
  const url = path.startsWith('http') ? path : BASE + path;
  return engine.getHtml(url);
}

export function getMatches(): Promise<Match[]> {
  return caches.matches.wrap('matches', async () =>
    parseMatchesPage(await html('/matches')));
}

export function getResults(): Promise<ResultMatch[]> {
  return caches.results.wrap('results', async () =>
    parseResultsPage(await html('/results')));
}

export function getEvents(): Promise<EventSummary[]> {
  return caches.events.wrap('events', async () => {
    const events = parseEventsPage(await html('/events'));
    // T1/featured (card) events first, then everything else by start date.
    return events.sort((a, b) => {
      if (a.big !== b.big) {
        return a.big ? -1 : 1;
      }
      return (a.dateStart ?? 0) - (b.dateStart ?? 0);
    });
  });
}

export function getEventMatches(eventId: number): Promise<Match[]> {
  let cache = caches.eventMatches.get(eventId);
  if (!cache) {
    cache = snapshotCache<Match[]>();
    caches.eventMatches.set(eventId, cache);
  }
  return cache.wrap(String(eventId), async () =>
    parseMatchesPage(await html(`/events/${eventId}/matches`)));
}

export function getMatchDetail(path: string): Promise<MatchDetail> {
  return caches.matchDetail.wrap(path, async () =>
    parseMatchPage(await html(path), path));
}

export function getEventDetail(path: string): Promise<EventDetail> {
  return caches.eventDetail.wrap(path, async () =>
    parseEventPage(await html(path), path));
}

export function getNews(): Promise<NewsItem[]> {
  return caches.news.wrap('news', async () =>
    parseNewsList(await html('/')));
}

export function getNewsDetail(path: string): Promise<NewsDetail> {
  return caches.newsDetail.wrap(path, async () =>
    parseNewsArticle(await html(path), path));
}

/** Per-side (Both/T/CT) player stats from the match page's "Detailed stats" sub-page. */
export function getSideStats(statsPath: string): Promise<SideStatsTable[]> {
  return caches.sideStats.wrap(statsPath, async () => {
    const $ = cheerio.load(await html(statsPath));
    const tables: SideStatsTable[] = [];
    // Walk siblings in order; track the nearest side heading above each table.
    let currentSide = 'Both';
    let currentTeam = '';
    const nodes = $('.stats-menu-link, .teamName, table.totalstats').toArray();
    for (const node of nodes) {
      const el = $(node);
      if (el.hasClass('stats-menu-link')) {
        currentSide = el.text().replace(/\s+/g, ' ').trim() || currentSide;
      } else if (el.hasClass('teamName') && !el.closest('table.totalstats').length) {
        currentTeam = el.text().trim();
      } else {
        const team = el.find('.teamName').first().text().trim() || currentTeam;
        const rows: StatRow[] = [];
        for (const tr of el.find('tr')) {
          const $tr = $(tr);
          const nameCell = $tr.find('.players .statsPlayerName').first();
          if (!nameCell.length) {
            continue;
          }
          rows.push({
            player: nameCell.text().replace(/\s+/g, ' ').trim(),
            nick: $tr.find('.player-nick').first().text().trim() || nameCell.text().trim(),
            kd: $tr.find('td.kd.traditional-data').first().text().trim(),
            ekd: $tr.find('td.kd.eco-adjusted-data').first().text().trim(),
            swing: $tr.find('td.roundSwing').first().text().trim(),
            adr: $tr.find('td.adr.traditional-data').first().text().trim(),
            eadr: $tr.find('td.adr.eco-adjusted-data').first().text().trim(),
            kast: $tr.find('td.kast.traditional-data').first().text().trim(),
            ekast: $tr.find('td.kast.eco-adjusted-data').first().text().trim(),
            rating: $tr.find('td.rating').first().text().trim(),
            ratingClass: $tr.find('td.rating').first().attr('class') ?? '',
          });
        }
        if (rows.length) {
          tables.push({ side: currentSide, team, rows });
        }
      }
    }
    return tables;
  });
}

export type { Match, ResultMatch, EventSummary, EventDetail, MatchDetail, NewsItem, NewsDetail, StatsTable };
