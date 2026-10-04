/**
 * Dev-only: reproduce the missing-backlog-separators report offline. Builds a
 * synthetic backlog with the EXACT event shapes from the user's live dump
 * (histogram: RoundEnd 37 / Assist 109 / Kill 658 / RoundStart 36 / ...),
 * runs it through the REAL formatLogItems, and checks RoundEnd lines survive
 * format + the page-side dedup/trim logic.
 */
import { formatLogItems, normalizeReplay } from '../src/detail/matchPage';
import { LogItem } from '../src/hltv/types';

function buildBacklog(): LogItem[] {
  const items: LogItem[] = [];
  let ct = 0;
  let t = 0;
  for (let round = 1; round <= 36; round++) {
    items.push({ RoundStart: {} });
    for (let k = 0; k < 12; k++) {
      // assist usually precedes its kill in the stream
      if (k % 3 === 1) {
        items.push({ Assist: { assisterNick: `assist${round}_${k}` } });
      }
      const hs = k % 4 === 0;
      items.push({ Kill: { killerNick: `k${round}_${k}`, victimNick: `v${round}_${k}`, weapon: 'ak47', headshot: hs, penetrated: k % 5 === 0 } });
    }
    if (round % 2 === 0) {
      items.push({ BombPlanted: {} });
    }
    const winner = round % 2 === 0 ? 'T' : 'CT';
    if (winner === 'CT') { ct++; } else { t++; }
    const winType = round % 2 === 0 ? 'Target_Bombed' : round % 3 === 0 ? 'Bomb_Defused' : 'CounterTerrorists_Win';
    items.push({ RoundEnd: { counterTerroristScore: ct, terroristScore: t, winner, winType } });
  }
  items.unshift({ MatchStarted: { map: 'de_mirage' } });
  for (let i = 0; i < 8; i++) {
    items.push({ PlayerJoin: { playerName: `p${i}`, playerNick: `p${i}` } });
  }
  items.push({ Suicide: { playerNick: 's1', side: 'CT', weapon: 'hegrenade' } });
  return items;
}

function main(): void {
  // --- scenario 1: chronological replay with warmup spam ---
  const warmup: LogItem[] = [];
  for (let i = 0; i < 80; i++) {
    warmup.push({ Kill: { killerNick: `w${i % 5}`, victimNick: `v${i % 7}`, weapon: 'usp' } });
  }
  const chrono = [...warmup, ...buildBacklog()];
  const norm = normalizeReplay(chrono);
  const lines = formatLogItems(norm);
  const warmupKills = lines.filter((l) => / \[usp\] /.test(l.text)).length;
  console.log('scenario1: items', chrono.length, '->', norm.length,
    '| warmup kills left:', warmupKills,
    '| marker:', JSON.stringify(lines.find((l) => l.text.includes('热身') || l.text.includes('warmup'))));
  const ends = lines.filter((l) => l.text.includes('胜') || l.text.includes('win'));
  const first = ends.findIndex((l) => /\d+:\d+/.test(l.text));
  console.log('  roundEnd lines:', ends.length, '| first has scores:', first >= 0, JSON.stringify(ends[first]?.text));

  // --- scenario 2: newest-first replay (the suspected live shape) ---
  const reversed = [...chrono].reverse();
  const norm2 = normalizeReplay(reversed);
  const lines2 = formatLogItems(norm2);
  const ends2 = lines2.filter((l) => /\d+:\d+/.test(l.text) && (l.text.includes('胜') || l.text.includes('win')));
  const totals = ends2.map((l) => {
    const m = /(\d+):(\d+)/.exec(l.text);
    return m ? Number(m[1]) + Number(m[2]) : -1;
  });
  const ascending = totals.every((v, i) => i === 0 || v >= totals[i - 1]);
  console.log('scenario2: reversed input', reversed.length, '-> normalized', norm2.length,
    '| roundEnd score sequence ascending (oldest→newest in array):', ascending,
    '| sample:', JSON.stringify(totals.slice(0, 8)));
}

main();
