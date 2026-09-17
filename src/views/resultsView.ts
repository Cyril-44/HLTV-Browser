import * as vscode from 'vscode';
import * as api from '../hltv/api';
import { ResultMatch } from '../hltv/types';
import { formatDate } from '../util/time';
import { errorItem } from './matchesView';

export class ResultNode extends vscode.TreeItem {
  constructor(public result: ResultMatch) {
    super(`${result.team1.name} ${result.score1} - ${result.score2} ${result.team2.name}`, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'hltv-match';
    const bits: string[] = [];
    if (result.dayStart) {
      bits.push(formatDate(result.dayStart));
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
    const rows: vscode.TreeItem[] = [];
    const r = this.result;
    const row = (label: string, value: string): vscode.TreeItem => {
      const item = new vscode.TreeItem(`${label}:  ${value}`);
      item.contextValue = 'hltv-card';
      return item;
    };
    if (r.dayStart) {
      rows.push(row('日期', formatDate(r.dayStart)));
    }
    if (r.format) {
      rows.push(row('赛制', r.format.toUpperCase()));
    }
    if (r.event.name) {
      rows.push(row('赛事', r.event.name));
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
      return results.map((r) => new ResultNode(r));
    } catch (e) {
      return [errorItem(e)];
    }
  }

  public async refresh(): Promise<void> {
    await api.clearListCaches();
    this._onDidChangeTreeData.fire(undefined);
  }
}
