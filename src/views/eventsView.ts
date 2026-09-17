import * as vscode from 'vscode';
import * as api from '../hltv/api';
import { EventSummary } from '../hltv/types';
import { MatchNode, sortMatches } from './common';
import { errorItem } from './matchesView';

export class EventNode extends vscode.TreeItem {
  public children: MatchNode[] | null = null;

  constructor(public event: EventSummary) {
    super(event.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'hltv-event';
    const bits: string[] = [];
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
    this.iconPath = new vscode.ThemeIcon(event.big ? 'trophy' : 'list-unordered');
  }
}

export class EventsView implements vscode.TreeDataProvider<EventNode | MatchNode | vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<EventNode | MatchNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  getTreeItem(element: EventNode | MatchNode | vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: EventNode | MatchNode | vscode.TreeItem): Promise<(EventNode | MatchNode | vscode.TreeItem)[]> {
    if (element instanceof EventNode) {
      try {
        const matches = sortMatches(await api.getEventMatches(element.event.id));
        element.children = matches.map((m) => new MatchNode(m));
        return element.children;
      } catch (e) {
        return [errorItem(e)];
      }
    }
    if (element) {
      return element instanceof MatchNode ? element.children() : [];
    }
    try {
      return (await api.getEvents()).map((e) => new EventNode(e));
    } catch (e) {
      return [errorItem(e)];
    }
  }

  public async refresh(): Promise<void> {
    await api.clearListCaches();
    this._onDidChangeTreeData.fire(undefined);
  }
}
