/**
 * Dev-only: verify the lazy card flow offline. Run via scripts/run-lazy-check.cjs
 * (stubs vscode + playwright-core; page navigation is served from saved
 * HLTV snapshots in /tmp/pwtest/out).
 */
import { readFileSync, existsSync } from 'node:fs';
import { MatchesView } from '../src/views/matchesView';
import { MatchNode } from '../src/views/common';

const SNAP = '/tmp/pwtest/out';
const pages: Record<string, string> = {
  'https://www.hltv.org/matches': `${SNAP}/matches.html`,
};
for (const name of ['livematch', 'results', 'events', 'newslist', 'news-article-1']) {
  const p = `${SNAP}/${name}.html`;
  if (existsSync(p)) {
    pages[`raw:${name}`] = p;
  }
}
// any /matches/<id>/... URL serves the live match snapshot
const matchDetailPath = `${SNAP}/livematch.html`;

async function main(): Promise<void> {
  const view = new MatchesView();
  const roots = (await view.getChildren()) as MatchNode[];
  const matchRoots = roots.filter((r): r is MatchNode => r instanceof MatchNode);
  console.log(`roots: ${matchRoots.length}`);

  const live = matchRoots.find((r) => r.match.live) ?? matchRoots[0];
  console.log(`testing expand of: ${live.label}`);

  const cardBefore = live.children();
  const loadingRow = cardBefore.find((c) => c.label.includes('加载中'));
  console.log(`card before: ${cardBefore.length} rows; loading row present: ${Boolean(loadingRow)}`);

  await new Promise((r) => setTimeout(r, 3500));
  const cardAfter = live.children();
  const labels = cardAfter.map((c) => String(c.label));
  console.log(`card after: ${cardAfter.length} rows`);
  for (const l of labels) {
    console.log('  |', l);
  }
  const enriched =
    labels.some((l) => l.includes('Best of 3')) &&
    labels.some((l) => l.includes('Nuke')) &&
    labels.some((l) => l.includes('BP'));
  console.log(`enriched from detail page: ${enriched}`);

  if (!loadingRow || !enriched) {
    console.log('LAZY CHECK FAIL');
    process.exit(1);
  }
  console.log('LAZY CHECK PASS');
}

void main().then(() => process.exit(0)).catch((e) => {
  console.error('LAZY CHECK ERROR', e);
  process.exit(1);
});
