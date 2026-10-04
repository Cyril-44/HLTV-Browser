/**
 * Dev-only: reproduce the missing-backlog-separators report offline. Builds a
 * synthetic backlog with the EXACT event shapes from the user's live dump
 * (histogram: RoundEnd 37 / Assist 109 / Kill 658 / RoundStart 36 / ...),
 * runs it through the REAL formatLogItems, and checks RoundEnd lines survive
 * format + the page-side dedup/trim logic.
 */
import { formatLogItems } from '../src/detail/matchPage';
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
  const backlog = buildBacklog();
  console.log('backlog items:', backlog.length);
  const lines = formatLogItems(backlog);
  const roundEnds = lines.filter((l) => l.text.includes('胜') || l.text.includes('win'));
  const roundStarts = lines.filter((l) => l.text.includes('回合') || l.text.includes('Round'));
  console.log('lines:', lines.length, '| roundEnd lines:', roundEnds.length, '| roundStart lines:', roundStarts.length);
  console.log('sample roundEnd:', JSON.stringify(roundEnds[0]));
  console.log('sample kill:', JSON.stringify(lines.find((l) => l.text.includes('['))));
  // page-side dedup simulation: only CONSECUTIVE identical texts collapse
  let dupCollapsed = 0;
  const seen: string[] = [];
  for (const l of lines) {
    if (seen.length && seen[seen.length - 1] === l.text && l.kind === 'normal') { dupCollapsed++; continue; }
    seen.push(l.text);
  }
  console.log('after dedup:', seen.length, '(collapsed', dupCollapsed + ')');
  const finalRoundEnds = seen.filter((x) => x.includes('胜') || x.includes('win'));
  const trimmed = seen.slice(-200); // logbox keeps newest 200
  console.log('roundEnd after dedup:', finalRoundEnds.length, '| within newest 200:', trimmed.filter((x) => x.includes('胜') || x.includes('win')).length);
}

main();
