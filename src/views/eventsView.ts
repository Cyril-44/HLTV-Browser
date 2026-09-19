import * as vscode from 'vscode';
import * as api from '../hltv/api';
import { EventSummary, ResultMatch } from '../hltv/types';
import { ResultNode } from './resultsView';
import { MatchNode, sortMatches } from './common';
import { errorItem } from './matchesView';

export class EventNode extends vscode.TreeItem {
  public children: (MatchNode | ResultNode | vscode.TreeItem)[] | null = null;

  constructor(public event: EventSummary) {
    super(event.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'hltv-event';
    const bits: string[] = [];
    if (event.ongoing) {
      bits.push('● LIVE');
    }
    if (event.dateText) {
      bits.push(event.dateText);
    }
    if (event.prize) {
      bits.push(event.prize);
    }
    if (event.location) {
      bits.push(event.location);
    }
    if (event.type) {
      bits.push(event.type);
    }
    this.description = bits.join(' · ');
    this.iconPath = event.ongoing
      ? new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.red'))
      : new vscode.ThemeIcon(event.big ? 'trophy' : 'list-unordered');
  }
}

export class EventsView implements vscode.TreeDataProvider<EventNode | MatchNode | ResultNode | vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<EventNode | MatchNode | ResultNode | vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event as vscode.Event<EventNode | MatchNode | ResultNode | vscode.TreeItem | undefined | void>;

  getTreeItem(element: EventNode | MatchNode | ResultNode | vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: EventNode | MatchNode | ResultNode | vscode.TreeItem): Promise<(EventNode | MatchNode | ResultNode | vscode.TreeItem)[]> {
    if (element instanceof EventNode) {
      try {
        const [matches, results] = await Promise.all([
          api.getEventMatches(element.event.id),
          api.getEventResults(element.event.id).catch(() => [] as ResultMatch[]),
        ]);
        const children: (MatchNode | ResultNode | vscode.TreeItem)[] = sortMatches(matches).map(
          (m) => new MatchNode(m, (n) => this._onDidChangeTreeData.fire(n)),
        );
        for (const r of results) {
          children.push(new ResultNode(r, (n) => this._onDidChangeTreeData.fire(n)));
        }
        element.children = children;
        return children;
      } catch (e) {
        return [errorItem(e)];
      }
    }
    if (element instanceof MatchNode) {
      return element.children();
    }
    if (element instanceof ResultNode) {
      return element.children();
    }
    if (element) {
      return [];
    }
    try {
      return (await api.getEvents()).map((e) => new EventNode(e));
    } catch (e) {
      return [errorItem(e)];
    }
  }

  public async refresh(): Promise<void> {
    await api.clearAllCaches();
    this._onDidChangeTreeData.fire(undefined);
  }
}
