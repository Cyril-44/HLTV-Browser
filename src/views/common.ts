import * as vscode from 'vscode';
import * as api from '../hltv/api';
import { Match, LiveScore, MatchDetail } from '../hltv/types';
import { scorebot } from '../hltv/scorebot';
import { formatMatchTime } from '../util/time';
import { t } from '../i18n';

/** A plain key/value row inside an expanded match card. */
export class CardRow extends vscode.TreeItem {
  constructor(label: string, value: string) {
    super(`${label}:  ${value}`, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'hltv-card';
  }
}

/**
 * Lazy per-item detail loader: the sidebar only fetches list pages up front;
 * a match page is fetched when its row is expanded, never in bulk.
 */
export class LazyMatchDetail {
  public detail: MatchDetail | null = null;
  public state: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  private lastAttempt = 0;

  public constructor(
    private readonly url: string,
    private readonly onChanged: () => void,
  ) {}

  public ensure(): void {
    const now = Date.now();
    if (this.state === 'loading' || this.state === 'ready') {
      return;
    }
    if (this.state === 'error' && now - this.lastAttempt < 5000) {
      return; // avoid reload loops when the tree re-renders an error card
    }
    this.lastAttempt = now;
    this.state = 'loading';
    api
      .getMatchDetail(this.url)
      .then((d) => {
        this.detail = d;
        this.state = 'ready';
      })
      .catch(() => {
        this.state = 'error';
      })
      .finally(() => this.onChanged());
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
  public lazy: LazyMatchDetail;

  constructor(public match: Match, onCardRefresh?: (node: MatchNode) => void) {
    super('', vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'hltv-match';
    this.lazy = new LazyMatchDetail(match.url, () => onCardRefresh?.(this));
    this.rebuild();
  }

  public rebuild(): void {
    const { team1, team2 } = this.match;
    this.label = `${team1.name} - ${team2.name}`;
    const bits: string[] = [];
    if (this.match.live) {
      bits.push('● LIVE');
    } else if (this.match.startTime) {
      bits.push(formatMatchTime(this.match.startTime));
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
    this.lazy.ensure();
    const m = this.match;
    const rows: CardRow[] = [];

    if (m.live) {
      rows.push(new CardRow(t('card.status'), 'LIVE'));
    } else if (m.startTime) {
      rows.push(new CardRow(t('card.time'), formatMatchTime(m.startTime)));
    }
    if (m.event.name) {
      rows.push(new CardRow(t('card.event'), m.event.name));
    }
    if (m.live) {
      rows.push(new CardRow(t('card.score'), liveScoreText(m) ?? t('card.waitingData')));
    }

    const d = this.lazy.detail;
    if (!d) {
      // Detail page not fetched yet: show what the list already gave us.
      if (this.lazy.state === 'loading') {
        rows.push(new CardRow(t('card.detail'), t('card.loading')));
      } else if (this.lazy.state === 'error') {
        rows.push(new CardRow(t('card.detail'), t('card.loadFailedRetry')));
      }
      if (m.format) {
        rows.push(new CardRow(t('card.format'), m.format.toUpperCase()));
      }
      if (m.lan) {
        rows.push(new CardRow(t('card.type'), 'LAN'));
      }
      const live = liveScoreOf(m);
      if (live && m.team1.id && m.team2.id) {
        for (const map of [...live.maps].sort((a, b) => a.ordinal - b.ordinal)) {
          rows.push(
            new CardRow(
              `${t('card.map')} ${map.name}${map.over ? '' : t('card.mapOngoing')}`,
              `${map.scores[m.team1.id!] ?? 0} - ${map.scores[m.team2.id!] ?? 0}`,
            ),
          );
        }
      }
      return rows;
    }

    // Detail page loaded — the card mirrors the match page content.
    if (d.format) {
      rows.push(new CardRow(t('card.format'), d.format));
    }
    if (d.stage) {
      rows.push(new CardRow(t('card.stage'), d.stage));
    }
    for (const map of d.maps) {
      const played = map.score1 !== '-' && map.score2 !== '-';
      const score = played ? `${map.score1} - ${map.score2}${map.halves ? ` ${map.halves}` : ''}` : t('card.mapNotPlayed');
      rows.push(new CardRow(`${t('card.map')} ${map.name}`, score));
    }
    if (d.vetoes.length) {
      rows.push(new CardRow('BP', t('card.bpSteps', { n: d.vetoes.length })));
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
