import { parseMatchesPage } from '../src/hltv/parse/matches';
import { engine } from '../src/hltv/engine';
async function main() {
  const html = await engine.getText('https://www.hltv.org/matches');
  console.log('page len:', html.length, '| isRealSite:', html.includes('href="/matches"'));
  const matches = parseMatchesPage(html);
  console.log('total matches parsed:', matches.length, '| live:', matches.filter((m) => m.live).length);
  for (const m of matches.filter((x) => x.live)) console.log(`LIVE ${m.team1.name} vs ${m.team2.name} :: ${m.url}`);
  await engine.dispose();
}
void main().then(() => process.exit(0)).catch((e) => { console.error('ERR', String(e).split('\n')[0]); process.exit(1); });
