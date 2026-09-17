import * as vscode from 'vscode';
import { Match, LiveScore } from '../hltv/types';
import { scorebot } from '../hltv/scorebot';
import { formatMatchTime } from '../util/time';

/** A plain key/value row inside an expanded match card. */
export class CardRow extends vscode.TreeItem {
  constructor(label: string, value: string) {
    super(`${label}:  ${value}`, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'hltv-card';
  }
}

export function liveScoreOf(match: Match): LiveScore | undefined {
  if (!match.live) {
    return undefined;
  }
  const frame = scorebot.getLatestScore(match.id);
  if (!frame) {
    return undefined;
  }
  const maps = Object.values(frame.mapScores).map((m) => ({
    name: (m.map ?? '').replace(/^de_/, ''),
    ordinal: 0,
    scores: m.scores as { [teamId: number]: number },
    over: m.mapOver,
  }));
  (Object.keys(frame.mapScores) as string[]).forEach((k, i) => {
    if (maps[i]) {
      maps[i].ordinal = Number(k) || i + 1;
    }
  });
  return {
    current: {},
    mapsWon: frame.wins as { [teamId: number]: number },
    maps,
    updatedAt: Date.now(),
  };
}

export function liveScoreText(match: Match): string | null {
  const score = liveScoreOf(match);
  if (!score || !match.team1.id || !match.team2.id) {
    return null;
  }
  const currentMap = [...score.maps].sort((a, b) => a.ordinal - b.ordinal).find((m) => !m.over) ?? score.maps[score.maps.length - 1];
  if (!currentMap) {
    return null;
  }
  const s1 = currentMap.scores[match.team1.id] ?? 0;
  const s2 = currentMap.scores[match.team2.id] ?? 0;
  const w1 = score.mapsWon[match.team1.id] ?? 0;
  const w2 = score.mapsWon[match.team2.id] ?? 0;
  return `${s1} - ${s2}  (maps ${w1}-${w2}, ${currentMap.name})`;
}

export class MatchNode extends vscode.TreeItem {
  constructor(public match: Match) {
    super('', vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'hltv-match';
    this.rebuild();
  }

  public rebuild(): void {
    const { team1, team2 } = this.match;
    this.label = this.match.live
      ? `${team1.name} - ${team2.name}`
      : `${team1.name} - ${team2.name}`;
    const bits: string[] = [];
    if (this.match.live) {
      bits.push('● LIVE');
    }
    if (this.match.format) {
      bits.push(this.match.format.toUpperCase());
    }
    if (this.match.lan) {
      bits.push('LAN');
    }
    bits.push(this.match.event.name);
    this.description = bits.join(' · ');
    if (this.match.startTime) {
      this.tooltip = `${formatMatchTime(this.match.startTime)} — ${this.match.event.name}`;
    }
    this.iconPath = this.match.live
      ? new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.red'))
      : new vscode.ThemeIcon('clock');
  }

  public children(): CardRow[] {
    const rows: CardRow[] = [];
    const m = this.match;
    if (m.live) {
      rows.push(new CardRow('状态', 'LIVE'));
    } else if (m.startTime) {
      rows.push(new CardRow('时间', formatMatchTime(m.startTime)));
    }
    if (m.format) {
      rows.push(new CardRow('赛制', m.format.toUpperCase()));
    }
    if (m.event.name) {
      rows.push(new CardRow('赛事', m.event.name));
    }
    if (m.lan) {
      rows.push(new CardRow('类型', 'LAN'));
    }
    if (m.live) {
      const score = liveScoreText(m);
      rows.push(new CardRow('比分', score ?? '等待数据…'));
    }
    const live = liveScoreOf(m);
    if (live && m.team1.id && m.team2.id) {
      for (const map of [...live.maps].sort((a, b) => a.ordinal - b.ordinal)) {
        rows.push(
          new CardRow(
            map.over ? `地图 ${map.name}` : `地图 ${map.name}(进行中)`,
            `${map.scores[m.team1.id!] ?? 0} - ${map.scores[m.team2.id!] ?? 0}`,
          ),
        );
      }
    }
    return rows;
  }
}

export function sortMatches(matches: Match[]): Match[] {
  return [...matches].sort((a, b) => {
    if (a.live !== b.live) {
      return a.live ? -1 : 1;
    }
    return (a.startTime ?? 0) - (b.startTime ?? 0);
  });
}
