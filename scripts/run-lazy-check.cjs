/**
 * Dev-only runner for scripts/lazy-check.ts: stubs 'vscode' and 'playwright-core'
 * so the tree views run offline against saved page snapshots.
 */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('module');

const SNAP = '/tmp/pwtest/out';

const htmlFor = (url) => {
  if (url.startsWith('https://www.hltv.org/matches/')) return `${SNAP}/livematch.html`;
  if (url === 'https://www.hltv.org/matches' || url.startsWith('https://www.hltv.org/matches?')) return `${SNAP}/matches.html`;
  if (url === 'https://www.hltv.org/results') return `${SNAP}/results.html`;
  if (url === 'https://www.hltv.org/events') return `${SNAP}/events.html`;
  if (url === 'https://www.hltv.org/') return `${SNAP}/newslist.html`;
  if (url.includes('/news/')) return `${SNAP}/news-article-1.html`;
  if (url.includes('/events/')) return `${SNAP}/event-starladder.html`;
  return null;
};

const makePage = () => {
  let currentUrl = '';
  return {
    isClosed: () => false,
    route: async () => undefined,
    goto: async (url) => {
      currentUrl = url;
      if (!htmlFor(url)) {
        throw new Error(`no snapshot for ${url}`);
      }
    },
    reload: async () => undefined,
    waitForTimeout: async () => undefined,
    setExtraHTTPHeaders: async () => undefined,
    content: async () => {
      const file = htmlFor(currentUrl);
      if (!file) {
        return '<html><body>empty</body></html>';
      }
      return fs.readFileSync(file, 'utf8');
    },
    context: () => ({ newPage: async () => makePage(), close: async () => undefined }),
    evaluate: async (fn) => {
      if (typeof fn === 'function' && String(fn).includes('navigator.userAgent')) {
        return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
      }
      throw new Error('network fetch disabled in offline check');
    },
  };
};

const fakeBrowser = {
  isConnected: () => true,
  newContext: async () => ({
    newPage: async () => makePage(),
    addInitScript: async () => undefined,
    addCookies: async () => undefined,
    cookies: async () => [],
    close: async () => undefined,
  }),
  close: async () => undefined,
};

const vscodeStub = {
  window: {
    registerTreeDataProvider: () => ({ dispose() {} }),
    createWebviewPanel: () => ({
      webview: { onDidReceiveMessage() {}, postMessage: async () => true, cspSource: 'https://test' },
      onDidDispose() {},
      title: '',
      reveal() {},
    }),
    showErrorMessage: async () => undefined,
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    withProgress: (_opts, task) => Promise.resolve(task({ report: () => undefined })),
  },
  commands: { registerCommand: () => ({ dispose() {} }), executeCommand: async () => undefined },
  workspace: { getConfiguration: () => ({ get: (_k, d) => d }) },
  env: { openExternal: async () => true, language: 'zh-cn' },
  Uri: { parse: (u) => u },
  ViewColumn: { Active: 1 },
  ProgressLocation: { Notification: 15 },
  EventEmitter: class {
    constructor() {
      this.event = () => ({ dispose() {} });
    }
    fire() {}
  },
  TreeItem: class {
    constructor(label, state) {
      this.label = label;
      this.collapsibleState = state;
    }
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class {},
  ThemeColor: class {},
};

const playwrightStub = { chromium: { launch: async () => fakeBrowser } };

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'vscode') {
    return vscodeStub;
  }
  if (request === 'playwright-core') {
    return playwrightStub;
  }
  return origLoad.call(this, request, ...rest);
};

const entry = process.argv[2] ?? path.join(__dirname, '.lazy-check.build.cjs');
require(path.resolve(entry));
