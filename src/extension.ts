import * as vscode from 'vscode';
import { engine } from './hltv/engine';
import { scorebot } from './hltv/scorebot';
import { MatchesView } from './views/matchesView';
import { ResultsView } from './views/resultsView';
import { EventsView } from './views/eventsView';
import { NewsView } from './views/newsView';
import { MatchNode } from './views/common';
import { ResultNode } from './views/resultsView';
import { EventNode } from './views/eventsView';
import { NewsNode } from './views/newsView';
import { openMatchDetail } from './detail/matchPage';
import { openEventDetail } from './detail/eventPage';
import { openNewsDetail } from './detail/newsPage';

const HLTV_ORIGIN = 'https://www.hltv.org';

export function activate(context: vscode.ExtensionContext): void {
  engine.setStoragePath(context.globalStorageUri.fsPath);

  const matchesView = new MatchesView();
  const resultsView = new ResultsView();
  const eventsView = new EventsView();
  const newsView = new NewsView();

  const views: Record<string, vscode.TreeDataProvider<unknown>> = {
    'hltv.matches': matchesView,
    'hltv.results': resultsView,
    'hltv.events': eventsView,
    'hltv.news': newsView,
  };

  const registrations = [
    ...Object.entries(views).map(([id, provider]) =>
      vscode.window.registerTreeDataProvider(id, provider as vscode.TreeDataProvider<never>),
    ),
    vscode.commands.registerCommand('hltv.refreshMatches', () => void matchesView.refresh()),
    vscode.commands.registerCommand('hltv.refreshResults', () => void resultsView.refresh()),
    vscode.commands.registerCommand('hltv.refreshEvents', () => void eventsView.refresh()),
    vscode.commands.registerCommand('hltv.refreshNews', () => void newsView.refresh()),
    vscode.commands.registerCommand('hltv.openMatchDetail', (node: MatchNode | ResultNode) => {
      const url = node instanceof MatchNode ? node.match.url : node.result.url;
      if (url) {
        openMatchDetail(url);
      }
    }),
    vscode.commands.registerCommand('hltv.openEventDetail', (node: EventNode) => {
      if (node.event.url) {
        openEventDetail(node.event.url);
      }
    }),
    vscode.commands.registerCommand('hltv.openNewsDetail', (node: NewsNode) => {
      if (node.news.url) {
        openNewsDetail(node.news.url);
      }
    }),
    vscode.commands.registerCommand('hltv.openOnHLTV', (node: MatchNode | ResultNode | EventNode | NewsNode) => {
      const url =
        node instanceof MatchNode ? node.match.url
          : node instanceof ResultNode ? node.result.url
            : node instanceof EventNode ? node.event.url
              : node.news.url;
      if (url) {
        void vscode.env.openExternal(vscode.Uri.parse(url.startsWith('http') ? url : HLTV_ORIGIN + url));
      }
    }),
  ];

  for (const r of registrations) {
    context.subscriptions.push(r);
  }
}

export function deactivate(): void {
  scorebot.shutdown();
  void engine.dispose();
}
