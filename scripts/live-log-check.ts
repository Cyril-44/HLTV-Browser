/**
 * Dev-only: feed the REAL captured scorebot replay (newest-first, 404KB,
 * /tmp/site-log-raw.txt — captured from the live wire on 2026-10-04) through
 * the production pipeline: normalizeReplay → formatLogItems → page-side
 * prepend/trim simulation. Asserts the rendering contract the user demands:
 * full history, correct newest-on-top order, round-end separators present.
 */
import { readFileSync } from 'node:fs';
import { formatLogItems, normalizeReplay } from '../src/detail/matchPage';
import { LogItem } from '../src/hltv/types';

function main(): void {
  const raw = readFileSync('/tmp/site-log-raw.txt', 'utf-8');
  const m = /42\["log","((?:[^"\\]|\\.)*)"\]/.exec(raw);
  if (!m) {
    console.log('FAIL: no log payload in capture');
    return;
  }
  const items = (JSON.parse(JSON.parse('"' + m[1] + '"')) as { log: LogItem[] }).log;
  console.log('raw replay:', items.length, 'events | first key:', Object.keys(items[0])[0], '| last key:', Object.keys(items[items.length - 1])[0]);

  const norm = normalizeReplay(items);
  const reversed = norm !== items;
  console.log('direction flip applied:', reversed, '| after flip first key:', Object.keys(norm[0])[0], '| last key:', Object.keys(norm[norm.length - 1])[0]);

  const lines = formatLogItems(norm);
  // round-block assignment: non-decreasing, bumps at RoundStart, resets on MatchStarted
  let roundOk = true;
  let lastRound = 0;
  let maxRound = 0;
  const roundBumps: number[] = [];
  for (const l of lines) {
    const r = l.round ?? 0;
    if (r < lastRound && !/比赛开始|Match started/.test(l.text)) roundOk = false;
    if (r !== lastRound) roundBumps.push(r);
    lastRound = r;
    if (r > maxRound) maxRound = r;
  }
  console.log('round blocks: max index', maxRound, '| transitions:', roundBumps.length, '| monotone-per-map:', roundOk);
  const striped = lines.filter((l) => (l.round ?? 0) % 2 === 1).length;
  console.log('striped (odd-round) lines:', striped, 'of', lines.length);
  const sepCount = lines.filter((l) => (l.text.includes('胜') || l.text.includes('win')) && l.kind === 'notime' && l.text.includes('——')).length;
  console.log('formatted lines:', lines.length, '| round-end separators:', sepCount);

  // simulate page box: insert each line at top (as prependLog does), then read top→bottom
  const box: string[] = [];
  for (const l of lines) {
    if (box.length && box[0] === l.text) continue; // page-side consecutive dedup
    box.unshift(l.text);
  }
  while (box.length > 2000) box.pop();
  console.log('box lines:', box.length, '| top (newest):', JSON.stringify(box[0]), '| bottom (oldest):', JSON.stringify(box[box.length - 1]));

  // chronology: extract RoundEnd scores from bottom (oldest) → top (newest);
  // totals must ascend WITHIN a map — a drop back to 1 is the next map starting
  const scoreSeq: number[] = [];
  for (let i = box.length - 1; i >= 0; i--) {
    const mm = /(\d+):(\d+) · (CT|T)/.exec(box[i]);
    if (mm) scoreSeq.push(Number(mm[1]) + Number(mm[2]));
  }
  let perMapAscending = true;
  let mapBase = 0;
  for (const v of scoreSeq) {
    if (v < mapBase) {
      // score dropped: only legal as a new map (back to small totals)
      if (v > 3) perMapAscending = false;
      mapBase = 0;
    }
    mapBase = v;
  }
  console.log('roundEnd score sequence (bottom→top):', scoreSeq.join(','));
  console.log('per-map ascending:', perMapAscending);
  const mapStarts = box.filter((x) => /Match started|比赛开始/.test(x)).length;
  console.log('matchStarted lines visible:', mapStarts, '| warmup fold marker present:', box.some((x) => x.includes('热身') || x.includes('warmup')));
  const pass = reversed && sepCount >= 40 && perMapAscending && box.length > 800;
  console.log(pass ? 'LIVE LOG CHECK PASS' : 'LIVE LOG CHECK FAIL');
}

main();
