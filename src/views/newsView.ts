import * as vscode from 'vscode';
import * as api from '../hltv/api';
import { NewsItem } from '../hltv/types';
import { errorItem } from './matchesView';

export class NewsNode extends vscode.TreeItem {
  constructor(public news: NewsItem) {
    super(news.title, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'hltv-news';
    this.description = [news.timeText, news.comments].filter(Boolean).join(' · ');
    this.tooltip = news.title;
    this.iconPath = new vscode.ThemeIcon('newspaper');
    this.command = undefined;
  }
}

export class NewsView implements vscode.TreeDataProvider<NewsNode | vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<NewsNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  getTreeItem(element: NewsNode | vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: NewsNode | vscode.TreeItem): Promise<(NewsNode | vscode.TreeItem)[]> {
    if (element) {
      return [];
    }
    try {
      return (await api.getNews()).map((n) => new NewsNode(n));
    } catch (e) {
      return [errorItem(e)];
    }
  }

  public async refresh(): Promise<void> {
    await api.clearAllCaches();
    this._onDidChangeTreeData.fire(undefined);
  }
}
