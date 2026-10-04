/**
 * Dev-only: list current live matches. ALWAYS goes through the production
 * parser (parseMatchesPage) — hand-rolled DOM selectors in earlier probe
 * scripts missed live matches (wrong class-name guesses like `.matchTeamName`)
 * and led to false "no live matches" conclusions while a match was running.
 * If the page comes back CF-challenged this exits non-zero with a clear
 * message instead of printing an empty list.
 */
import { parseMatchesPage } from '../src/hltv/parse/matches';
import { engine } from '../src/hltv/engine';

async function main(): Promise<void> {
  const html = await engine.getText('https://www.hltv.org/matches');
  if (!html.includes('href="/matches"') || html.includes('Just a moment')) {
    console.error('BLOCKED: matches page came back Cloudflare-challenged — do NOT conclude anything about live matches from this run');
    await engine.dispose();
    process.exitCode = 2;
    return;
  }
  const matches = parseMatchesPage(html);
  const live = matches.filter((m) => m.live);
  console.log(`parsed ${matches.length} matches, ${live.length} live`);
  for (const m of live) {
    console.log(`LIVE ${m.team1.name} vs ${m.team2.name} :: ${m.url}`);
  }
  if (!live.length) {
    // parser-independent cross-check so a zero can be verified by eye:
    // live wrappers carry live="true" (anchors are a.match-top; class names
    // are kebab-case — `.matchTeamName`-style guesses are wrong)
    const wrappers = (html.match(/live="true"/g) ?? []).length;
    console.log(`(page contains ${wrappers} live="true" markers)`);
  }
  await engine.dispose();
}

void main().then(() => process.exit(0)).catch((e) => {
  console.error('ERR', String(e).split('\n')[0]);
  process.exit(1);
});
