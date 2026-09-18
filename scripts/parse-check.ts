/**
 * Dev-only: run all parsers against saved HLTV page dumps.
 * Usage: node scripts/run-parse-check.js   (after building with esbuild)
 */
import { readFileSync } from 'node:fs';
import { parseMatchesPage } from '../src/hltv/parse/matches';
import { parseResultsPage } from '../src/hltv/parse/results';
import { parseEventsPage } from '../src/hltv/parse/events';
import { parseMatchPage } from '../src/hltv/parse/matchPage';
import { parseEventPage } from '../src/hltv/parse/eventPage';
import { parseNewsList, parseNewsArticle } from '../src/hltv/parse/news';

const dir = '/tmp/pwtest/out';
const read = (f: string) => readFileSync(`${dir}/${f}`, 'utf8');

function summary(label: string, data: unknown): void {
  console.log(`\n===== ${label} =====`);
  console.log(JSON.stringify(data, null, 1).slice(0, 2600));
}

const matches = parseMatchesPage(read('matches.html'));
summary(`matches (${matches.length})`, {
  live: matches.filter((m) => m.live).slice(0, 3),
  upcoming: matches.filter((m) => !m.live).slice(0, 3),
  noEvent: matches.filter((m) => !m.event.name).length,
  noTime: matches.filter((m) => !m.startTime && !m.live).length,
});

const results = parseResultsPage(read('results.html'));
summary(`results (${results.length})`, {
  first: results.slice(0, 4),
  noEvent: results.filter((r) => !r.event.name).length,
  noTime: results.filter((r) => !r.startTime).length,
});

const events = parseEventsPage(read('events.html'));
summary(`events (${events.length}, big=${events.filter((e) => e.big).length})`, {
  big: events.filter((e) => e.big).slice(0, 2),
  small: events.filter((e) => !e.big).slice(0, 2),
});

const matchDetail = parseMatchPage(read('livematch.html'), '/matches/2398090/natus-vincere-vs-aurora-starladder-starseries-fall-2026');
summary('matchDetail (live)', {
  teams: `${matchDetail.team1.name} vs ${matchDetail.team2.name}`,
  startTime: matchDetail.startTime,
  event: matchDetail.event,
  stage: matchDetail.stage,
  format: matchDetail.format,
  live: matchDetail.live,
  vetoes: matchDetail.vetoes,
  maps: matchDetail.maps,
  statMaps: matchDetail.statMaps,
  statTeams: Object.entries(matchDetail.stats).map(([k, v]) => `${k}: ${v.map((t) => `${t.team}(${t.rows.length})`).join(', ')}`),
  firstRow: matchDetail.stats['all']?.[0]?.rows?.[0],
  lineups: matchDetail.lineups.map((l) => `${l.team}: ${l.players.length}`),
  scorebot: matchDetail.scorebot,
});

const starladder = parseEventPage(read('event-starladder.html'), '/events/8057/starladder-starseries-fall-2026');
summary('eventDetail (starladder)', {
  name: starladder.name,
  prize: starladder.prize,
  teamsCount: starladder.teamsCount,
  location: starladder.location,
  dateStart: starladder.dateStart,
  formats: starladder.formats,
  teamSample: starladder.teams.slice(0, 3),
  brackets: starladder.brackets.map((b) => `${b.title}: ${b.rounds.map((r) => `${r.name}(${r.matchups.length})`).join(' | ')}`),
});

const porto = parseEventPage(read('event-porto.html'), '/events/8249/blast-open-porto-2026');
summary('eventDetail (porto)', {
  brackets: porto.brackets.map((b) => `${b.title}: ${b.rounds.map((r) => `${r.name}(${r.matchups.length})`).join(' | ')}`),
  sampleMatchup: porto.brackets[0]?.rounds?.[0]?.matchups?.[0],
  teams: porto.teams.length,
});

const news = parseNewsList(read('newslist.html'));
summary(`news (${news.length})`, news.slice(0, 3));

const article = parseNewsArticle(read('news-article-1.html'), '/news/45536/grim-it-was-a-great-win-for-us-and-much-needed-for-everyones-confidence');
summary('newsArticle', {
  title: article.title,
  author: article.author,
  date: article.date,
  intro: article.intro?.slice(0, 100),
  blocks: article.blocks.map((b) => `${b.kind}: ${'text' in b ? b.text?.slice(0, 60) : b.label}`),
  comments: article.comments.length,
  firstComments: article.comments.slice(0, 3),
});
