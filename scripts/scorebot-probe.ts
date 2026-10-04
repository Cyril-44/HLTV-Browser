/**
 * Dev-only: connect a real ScorebotMatchSession to the current live match and
 * dump (a) the initial/backlog log event histogram + RoundEnd sample shape,
 * (b) a full playerState object (weapon/armor fields). Scorebot websocket
 * traffic only — no page navigations.
 */
import * as api from '../src/hltv/api';
import { ScorebotMatchSession, type ScorebotListener } from '../src/hltv/scorebot';
import { LogItem } from '../src/hltv/types';
import { parseMatchesPage } from '../src/hltv/parse/matches';
import { getMatchDetail } from '../src/hltv/api';
import { engine } from '../src/hltv/engine';
import { engine as eng } from '../src/hltv/engine';

async function main(): Promise<void> {
  const matches = parseMatchesPage(await eng.getText('https://www.hltv.org/matches'));
  const live = matches.filter((m) => m.live);
  console.log('live matches:', live.map((m) => `${m.team1.name} vs ${m.team2.name} ${m.url}`).join(' | ') || 'NONE');
  const target = live[0];
  if (!target) {
    await engine.dispose();
    return;
  }
  const detail = await api.getMatchDetail(target.url);
  const sbId = detail.scorebot?.id;
  console.log('scorebot id:', sbId);
  if (!sbId) {
    await engine.dispose();
    return;
  }

  let backlogDumped = false;
  let stateDumped = false;
  const listener: ScorebotListener = {
    onLog: (items: LogItem[], reset) => {
      if (backlogDumped) return;
      backlogDumped = true;
      const hist = new Map<string, number>();
      for (const it of items) {
        const k = Object.keys(it)[0] ?? '?';
        hist.set(k, (hist.get(k) ?? 0) + 1);
      }
      console.log(`BACKLOG reset=${reset} n=${items.length}`);
      console.log('histogram:', JSON.stringify([...hist.entries()]));
      const re = items.find((it) => /roundend/i.test(Object.keys(it)[0] ?? ''));
      console.log('RoundEnd sample:', re ? JSON.stringify(re).slice(0, 300) : 'ABSENT IN BACKLOG');
      const kill = items.find((it) => /kill/i.test(Object.keys(it)[0] ?? ''));
      console.log('Kill sample:', kill ? JSON.stringify(kill).slice(0, 400) : 'none');
    },
    onPlayerState: (state) => {
      if (stateDumped) return;
      stateDumped = true;
      console.log('playerState top-level keys:', Object.keys(state as object).join(','));
      const arr = (state as Record<string, unknown>).TERRORIST ?? (state as Record<string, unknown>).CT;
      if (Array.isArray(arr) && arr.length) {
        console.log('player[0] full:', JSON.stringify(arr[0]));
        console.log('player keys:', Object.keys(arr[0] as object).join(','));
      }
      const ctH = (state as Record<string, unknown>).ctMatchHistory;
      if (ctH) {
        console.log('ctMatchHistory:', JSON.stringify(ctH).slice(0, 400));
      }
    },
  };
  const session = new ScorebotMatchSession(sbId, listener);
  await new Promise((r) => setTimeout(r, 25000));
  session.close();
  await engine.dispose();
  console.log(stateDumped ? '' : 'no playerState seen in 25s');
}

void main().then(() => process.exit(0)).catch((e) => {
  console.error(String(e).split('\n')[0]);
  process.exit(1);
});
