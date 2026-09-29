import * as vscode from 'vscode';
import * as api from '../hltv/api';
import { ResultMatch } from '../hltv/types';
import { formatMatchTime } from '../util/time';
import { CardRow, LazyMatchDetail } from './common';
import { t } from '../i18n';
import { errorItem } from './matchesView';

export class ResultNode extends vscode.TreeItem {
  public lazy: LazyMatchDetail;

  constructor(public result: ResultMatch, onCardRefresh?: (node: ResultNode) => void) {
    super(`${result.team1.name} ${result.score1} - ${result.score2} ${result.team2.name}`, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'hltv-match';
    this.lazy = new LazyMatchDetail(result.url, () => onCardRefresh?.(this));
    const bits: string[] = [];
    if (result.startTime) {
      bits.push(formatMatchTime(result.startTime));
    }
    bits.push(result.event.name);
    if (result.format) {
      bits.push(result.format.toUpperCase());
    }
    this.description = bits.join(' · ');
    this.tooltip = `${result.event.name} — ${result.format.toUpperCase()}`;
    this.iconPath = new vscode.ThemeIcon('check');
  }

  public children(): vscode.TreeItem[] {
    this.lazy.ensure();
    const rows: vscode.TreeItem[] = [];
    const r = this.result;
    if (r.startTime) {
      rows.push(new CardRow(t('card.time'), formatMatchTime(r.startTime)));
    }
    if (r.event.name) {
      rows.push(new CardRow(t('card.event'), r.event.name));
    }

    const d = this.lazy.detail;
    if (!d) {
      if (this.lazy.state === 'loading') {
        rows.push(new CardRow(t('card.detail'), t('card.loading')));
      } else if (this.lazy.state === 'error') {
        rows.push(new CardRow(t('card.detail'), t('card.loadFailedRetry')));
      }
      if (r.format) {
        rows.push(new CardRow(t('card.format'), r.format.toUpperCase()));
      }
      return rows;
    }

    if (d.format) {
      rows.push(new CardRow(t('card.format'), d.format));
    }
    if (d.stage) {
      rows.push(new CardRow(t('card.stage'), d.stage));
    }
    for (const map of d.maps) {
      const played = map.score1 !== '-' && map.score2 !== '-';
      const score = played ? `${map.score1} - ${map.score2}${map.halves ? ` ${map.halves}` : ''}` : '—';
      rows.push(new CardRow(`${t('card.map')} ${map.name}`, score));
    }
    return rows;
  }
}

export class ResultsView implements vscode.TreeDataProvider<ResultNode | vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ResultNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private loaded: ResultNode[] = [];
  private nextOffset = 0;
  private hasMore = true;
  private loading = false;

  getTreeItem(element: ResultNode | vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ResultNode | vscode.TreeItem): Promise<(ResultNode | vscode.TreeItem)[]> {
    if (element instanceof ResultNode) {
      return element.children();
    }
    if (element) {
      return [];
    }
    if (this.loaded.length === 0 && this.hasMore) {
      await this.loadMore();
    }
    if (!this.hasMore) {
      return this.loaded;
    }
    const more = new vscode.TreeItem(t('view.loadMore'));
    more.contextValue = 'hltv-card';
    more.iconPath = new vscode.ThemeIcon('more');
    more.command = { command: 'hltv.loadMoreResults', title: '' };
    return [...this.loaded, more];
  }

  public async loadMore(): Promise<void> {
    if (this.loading || !this.hasMore) {
      return;
    }
    this.loading = true;
    try {
      const page = await api.getResults(this.nextOffset);
      this.nextOffset += page.length;
      this.hasMore = page.length > 0;
      for (const r of page) {
        this.loaded.push(new ResultNode(r, (node) => this._onDidChangeTreeData.fire(node)));
      }
    } finally {
      this.loading = false;
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  public async refresh(): Promise<void> {
    await api.clearAllCaches();
    this.loaded = [];
    this.nextOffset = 0;
    this.hasMore = true;
    this._onDidChangeTreeData.fire(undefined);
  }
}
