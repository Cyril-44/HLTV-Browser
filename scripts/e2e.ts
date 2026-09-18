/**
 * Dev-only end-to-end test: real browser engine + real HLTV network.
 * Run via scripts/run-e2e.cjs (stubbed vscode module).
 */
import * as api from '../src/hltv/api';
import { scorebot, ScorebotClient } from '../src/hltv/scorebot';

async function main(): Promise<void> {
  console.log('=== getMatches ===');
  const matches = await api.getMatches();
  const live = matches.filter((m) => m.live);
  console.log(`matches: ${matches.length} (live: ${live.length})`);
  for (const m of live.slice(0, 3)) {
    console.log(`  LIVE: ${m.team1.name} vs ${m.team2.name} [${m.format}] ${m.event.name}`);
  }

  console.log('=== getResults ===');
  const results = await api.getResults();
  console.log(`results: ${results.length}; first: ${results[0]?.team1.name} ${results[0]?.score1}-${results[0]?.score2} ${results[0]?.team2.name}`);

  console.log('=== getEvents ===');
  const events = await api.getEvents();
  console.log(`events: ${events.length} (big: ${events.filter((e) => e.big).length}); first big: ${events.find((e) => e.big)?.name}`);

  console.log('=== getEventMatches (starladder drill-down) ===');
  const eventMatches = await api.getEventMatches(8057);
  console.log(`event matches: ${eventMatches.length}; sample: ${eventMatches[0] ? `${eventMatches[0].team1.name} vs ${eventMatches[0].team2.name} (${eventMatches[0].live ? 'LIVE' : 'upcoming'})` : 'none'}`);

  console.log('=== getNews ===');
  const news = await api.getNews();
  console.log(`news: ${news.length}; first: ${news[0]?.title.slice(0, 60)}`);

  const liveMatch = live[0];
  if (liveMatch) {
    console.log('=== getMatchDetail (live) ===');
    const detail = await api.getMatchDetail(liveMatch.url);
    console.log(`${detail.team1.name} vs ${detail.team2.name} | live=${detail.live} | ${detail.format} | event=${detail.event.name}`);
    console.log(`vetoes: ${detail.vetoes.length}; maps: ${detail.maps.map((m) => `${m.name} ${m.score1}-${m.score2}`).join(', ')}`);
    console.log(`statMaps: ${detail.statMaps.map((m) => m.name).join(',')}; stats tables: ${Object.keys(detail.stats).map((k) => `${k}=${detail.stats[k].length}`).join(',')}`);
    console.log(`scorebot: ${JSON.stringify(detail.scorebot)}`);
  } else if (results[0]) {
    console.log('=== getMatchDetail (finished) ===');
    const detail = await api.getMatchDetail(results[0].url);
    console.log(`${detail.team1.name} vs ${detail.team2.name} | live=${detail.live} | ${detail.format} | ${detail.event.name}`);
    console.log(`vetoes: ${detail.vetoes.length}; maps: ${detail.maps.map((m) => `${m.name} ${m.score1}-${m.score2}${m.halves}`).join(', ')}`);
    const statKey = detail.statMaps[1]?.id ?? 'all';
    const table = detail.stats[statKey]?.[0];
    console.log(`stats[${statKey}] ${table?.team}: ${table?.rows.length} players; first: ${table?.rows[0]?.nick} ${table?.rows[0]?.kd} rating ${table?.rows[0]?.rating}`);
    console.log(`lineups: ${detail.lineups.map((l) => `${l.team}(${l.players.length})`).join(', ')}`);
  }

  console.log('=== getEventDetail (starladder) ===');
  const event = await api.getEventDetail('/events/8057/starladder-starseries-fall-2026');
  console.log(`${event.name} | ${event.prize} | ${event.teamsCount} teams | ${event.location}`);
  console.log(`formats: ${event.formats.map((f) => `${f.name}=${f.value}`).join(' | ')}`);
  console.log(`teams: ${event.teams.length} (${event.teams[0]?.name} ${event.teams[0]?.worldRank})`);
  console.log(`brackets: ${event.brackets.map((b) => `${b.title}[${b.rounds.map((r) => `${r.name}:${r.matchups.length}`).join(',')}]`).join(' ; ')}`);

  console.log('=== getNewsDetail ===');
  if (news[0]) {
    const article = await api.getNewsDetail(news[0].url);
    console.log(`"${article.title}" by ${article.author}; blocks: ${article.blocks.map((b) => b.kind).join(',')}; comments: ${article.comments.length}`);
  }

  if (liveMatch) {
    console.log('=== scorebot live subscription (45s) ===');
    ScorebotClient.debug = true;
    let scoreEvents = 0;
    let logEvents = 0;
    scorebot.subscribeMatch(liveMatch.id, {
      onScore: (frame) => {
        scoreEvents++;
        const maps = Object.entries(frame.mapScores).map(([, m]) => `${m.map.replace('de_', '')} ${JSON.stringify(m.scores)}${m.mapOver ? '' : '*'}`);
        console.log(`  score #${frame.listId}: ${maps.join(' ')} wins=${JSON.stringify(frame.wins)}`);
      },
      onLog: (items) => {
        logEvents += items.length;
        if (items.length) {
          console.log(`  log +${items.length}: ${JSON.stringify(items[items.length - 1]).slice(0, 140)}`);
        }
      },
    });
    await new Promise((r) => setTimeout(r, 45000));
    console.log(`scorebot summary: scoreEvents=${scoreEvents} logItems=${logEvents}`);
  }

  console.log('E2E PASS');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('E2E FAIL:', e);
    process.exit(1);
  });
