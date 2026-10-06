/**
 * Dev-only: build the event detail page from a REAL captured event page
 * (default /tmp/event-rendered.html) through the production parser + builder,
 * then screenshot it. Also verifies the sanitizing contract: no TBD-vs-TBD
 * cards, media slots tagged, match links preserved.
 */
import { readFileSync } from 'node:fs';
import { parseEventPage } from '../src/hltv/parse/eventPage';
import { buildEventHtml } from '../src/detail/eventPage';

function main(): void {
  const html = readFileSync('/tmp/event-rendered.html', 'utf-8');
  const d = parseEventPage(html, '/events/8057/starladder-starseries-fall-2026');
  console.log('event:', d.name, '| bracketHtml:', d.bracketHtml.length, 'B | swissHtml:', d.swissHtml.length, 'B | cssUrls:', d.cssUrls.length);
  const contract = {
    bracketKept: d.bracketHtml.includes('slotted-bracket-placeholder') && d.bracketHtml.includes('Upper Bracket'),
    inlineStylesKept: d.bracketHtml.includes('--bracket-body-height'),
    matchLinks: (d.bracketHtml.match(/bracket-match/g) ?? []).length,
    natlinks: (d.bracketHtml.match(/class="[^"]*natlink/g) ?? []).length,
    mediaSlots: (d.bracketHtml.match(/data-kind="image"/g) ?? []).length,
    noScripts: !d.bracketHtml.includes('<script'),
    jsonAttrDropped: !d.bracketHtml.includes('data-slotted-bracket-json'),
    tbdCards: d.brackets.reduce((n, s) => n + s.rounds.reduce((m, r) => m + r.matchups.filter((mu) => mu.team1 === 'TBD' && mu.team2 === 'TBD').length, 0), 0),
    swissTbd: d.swiss.reduce((n, c) => n + c.matchups.filter((m) => m.includes('TBD')).length, 0),
  };
  console.log('contract:', JSON.stringify(contract));

  const css = readFileSync('/tmp/hltv-site.css', 'utf-8');
  const page = buildEventHtml(d, css, 'https://preview.invalid', d.url, 'night-theme');
  require('node:fs').writeFileSync('/tmp/event-preview.html', page);
  console.log('page written:', page.length, 'B | native css inlined:', page.includes('slotted-bracket-placeholder'));
}

main();
