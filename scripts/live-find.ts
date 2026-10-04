import { parseMatchesPage } from '../src/hltv/parse/matches';
import { engine } from '../src/hltv/engine';
async function main() {
  const html = await engine.getText('https://www.hltv.org/matches');
  const matches = parseMatchesPage(html);
  for (const m of matches.filter((x) => x.live)) {
    console.log(`LIVE ${m.team1.name} vs ${m.team2.name} :: ${m.url}`);
  }
  await engine.dispose();
}
void main().then(() => process.exit(0)).catch((e) => { console.error(String(e).split('\n')[0]); process.exit(1); });
