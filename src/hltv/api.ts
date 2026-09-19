import * as cheerio from 'cheerio';
import { engine } from './engine';
import { TtlCache } from './cache';
import { parseMatchesPage } from './parse/matches';
import { parseResultsPage } from './parse/results';
import { parseEventsPage } from './parse/events';
import { parseMatchPage } from './parse/matchPage';
import { parseEventPage } from './parse/eventPage';
import { parseNewsList, parseNewsArticle } from './parse/news';

import { Match, ResultMatch, EventSummary, EventDetail, MatchDetail, NewsItem, NewsDetail, StatRow, StatsTable } from './types';

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
  eventResults: new Map<number, TtlCache<ResultMatch[]>>(),
  matchDetail: snapshotCache<MatchDetail>(),
  eventDetail: snapshotCache<EventDetail>(),
  news: snapshotCache<NewsItem[]>(),
  newsDetail: snapshotCache<NewsDetail>(),
};

/** Manual refresh: forget every fetched page so the next load refetches. */
export function clearAllCaches(): void {
  caches.matches.clear();
  caches.results.clear();
  caches.events.clear();
  caches.eventMatches.clear();
  caches.eventResults.clear();
  caches.matchDetail.clear();
  caches.eventDetail.clear();
  caches.news.clear();
  caches.newsDetail.clear();
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
    // Big-block (featured) tournaments first — ongoing featured (like a
    // running StarLadder) above upcoming featured — then small ongoing
    // events, then everything else by date.
    const rank = (e: EventSummary): number => (e.big ? 2 : 0) + (e.ongoing ? 1 : 0);
    return events.sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) {
        return rb - ra;
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

/** Past results of one event (/results?event=<id> filters correctly). */
export function getEventResults(eventId: number): Promise<ResultMatch[]> {
  let cache = caches.eventResults.get(eventId);
  if (!cache) {
    cache = snapshotCache<ResultMatch[]>();
    caches.eventResults.set(eventId, cache);
  }
  return cache.wrap(String(eventId), async () => parseResultsPage(await html(`/results?event=${eventId}`)));
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


export type { Match, ResultMatch, EventSummary, EventDetail, MatchDetail, NewsItem, NewsDetail, StatsTable };
