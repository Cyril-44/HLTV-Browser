import * as vscode from 'vscode';
import * as api from '../hltv/api';
import { ResultMatch } from '../hltv/types';
import { formatMatchTime } from '../util/time';
import { CardRow, LazyMatchDetail } from './common';
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
      rows.push(new CardRow('时间', formatMatchTime(r.startTime)));
    }
    if (r.event.name) {
      rows.push(new CardRow('赛事', r.event.name));
    }

    const d = this.lazy.detail;
    if (!d) {
      if (this.lazy.state === 'loading') {
        rows.push(new CardRow('详情', '加载中…'));
      } else if (this.lazy.state === 'error') {
        rows.push(new CardRow('详情', '加载失败，收起后重新展开重试'));
      }
      if (r.format) {
        rows.push(new CardRow('赛制', r.format.toUpperCase()));
      }
      return rows;
    }

    if (d.format) {
      rows.push(new CardRow('赛制', d.format));
    }
    if (d.stage) {
      rows.push(new CardRow('阶段', d.stage));
    }
    for (const map of d.maps) {
      const played = map.score1 !== '-' && map.score2 !== '-';
      const score = played ? `${map.score1} - ${map.score2}${map.halves ? ` ${map.halves}` : ''}` : '—';
      rows.push(new CardRow(`地图 ${map.name}`, score));
    }
    return rows;
  }
}

export class ResultsView implements vscode.TreeDataProvider<ResultNode | vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ResultNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

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
    try {
      const results = await api.getResults();
      return results.map((r) => new ResultNode(r, (node) => this._onDidChangeTreeData.fire(node)));
    } catch (e) {
      return [errorItem(e)];
    }
  }

  public async refresh(): Promise<void> {
    await api.clearAllCaches();
    this._onDidChangeTreeData.fire(undefined);
  }
}
