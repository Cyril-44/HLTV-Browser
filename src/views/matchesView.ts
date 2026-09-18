import * as vscode from 'vscode';
import * as api from '../hltv/api';
import { scorebot } from '../hltv/scorebot';
import { MatchNode, sortMatches } from './common';

export class MatchesView implements vscode.TreeDataProvider<MatchNode | vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<MatchNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private nodes = new Map<number, MatchNode>();
  private loading = 0;

  private scoreListener = {
    onScore: (frame: { listId: number }): void => {
      const node = this.nodes.get(frame.listId);
      if (node) {
        node.rebuild();
        this._onDidChangeTreeData.fire(node);
      }
    },
  };

  getTreeItem(element: MatchNode | vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: MatchNode | vscode.TreeItem): Promise<(MatchNode | vscode.TreeItem)[]> {
    if (element instanceof MatchNode) {
      return element.children();
    }
    if (element) {
      return [];
    }
    if (this.loading++) {
      this.loading = 1;
      return [...this.nodes.values()];
    }
    try {
      const matches = sortMatches(await api.getMatches());
      const next = new Map<number, MatchNode>();
      for (const m of matches) {
        const existing = this.nodes.get(m.id);
        const node = existing ? Object.assign(existing, { match: m }) : new MatchNode(m, (n) => this._onDidChangeTreeData.fire(n));
        node.rebuild();
        next.set(m.id, node);
        if (m.live) {
          scorebot.subscribeScores(m.id, this.scoreListener);
        }
      }
      this.nodes = next;
      return [...next.values()];
    } catch (e) {
      return [errorItem(e)];
    } finally {
      this.loading = 0;
    }
  }

  public async refresh(): Promise<void> {
    await api.clearAllCaches();
    this._onDidChangeTreeData.fire(undefined);
  }
}

export function errorItem(e: unknown): vscode.TreeItem {
  const item = new vscode.TreeItem(`加载失败: ${String(e).split('\n')[0].slice(0, 120)}`);
  item.iconPath = new vscode.ThemeIcon('error');
  item.contextValue = 'hltv-card';
  return item;
}
