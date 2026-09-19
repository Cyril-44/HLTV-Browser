import * as vscode from 'vscode';

type Params = Record<string, string | number>;

const en: Record<string, string> = {
  // sidebar cards
  'card.status': 'Status',
  'card.time': 'Time',
  'card.event': 'Event',
  'card.score': 'Score',
  'card.waitingData': 'Waiting for data…',
  'card.detail': 'Details',
  'card.loading': 'Loading…',
  'card.loadFailedRetry': 'Load failed — collapse and expand again to retry',
  'card.format': 'Format',
  'card.type': 'Type',
  'card.map': 'Map',
  'card.mapOngoing': ' (live)',
  'card.mapNotPlayed': 'not played',
  'card.stage': 'Stage',
  'card.bpSteps': '{n} steps (see detail page)',
  'view.loadError': 'Load failed: {msg}',
  // match detail page
  'web.loading': 'Loading…',
  'match.loadingPage': 'Loading match page…',
  'page.loadFailed': 'Failed to load',
  'match.liveSection': 'Live scoreboard',
  'match.gameLog': 'Game log (kill feed)',
  'match.maps': 'Maps',
  'match.thMap': 'Map',
  'match.thScore': 'Score',
  'match.thHalves': 'Halves',
  'match.playerStats': 'Player stats',
  'match.statsSub': 'Rating 3.0 · K-D / ADR / KAST incl. eco-adjusted columns',
  'match.side': 'Side:',
  'match.both': 'Both',
  'match.eco': 'Eco-adjusted:',
  'match.ecoOn': 'On',
  'match.ecoOff': 'Off',
  'match.mapLabel': 'Map:',
  'match.lineups': 'Lineups',
  'match.past': 'Past matches',
  'match.thOpponent': 'Opponent',
  'match.thWhen': 'When',
  'card.recent': 'Recent {team}',
  'match.noSideData': 'No data for this side',
  'match.alive': 'Alive',
  'match.dead': 'Dead',
  'match.stateCol': 'State',
  // event detail page
  'event.loadingPage': 'Loading event page…',
  'event.formats': 'Formats',
  'event.teams': 'Teams',
  'event.teamsSub': 'Logos are off by default; use the top-right button to toggle all',
  'event.loadLogos': 'Show team logos',
  'event.hideLogos': 'Hide team logos',
  'event.related': 'Related events',
  'event.swiss': 'Swiss stage',
  'event.teamsCount': '{n} teams',
  // news detail page
  'news.loadingPage': 'Loading article…',
  'news.loadMedia': 'Load media',
  'news.hideMedia': 'Hide media',
  'news.image': 'Image',
  'news.embed': 'Embed: {p}',
  'news.comments': 'Comments',
  'news.teams': 'Teams mentioned',
  'news.readMore': 'Read more',
  'news.link': 'link',
  // kill feed formatting
  'log.roundStart': '—— Round start ——',
  'log.restart': '—— Restart ——',
  'log.join': '→ {p} joined',
  'log.quit': '← {p} left',
  'log.matchStart': '=== Match started: {map} ===',
  'log.roundEnd': '—— {ct}:{t} · {w} win ({type}) ——',
  'log.suicide': '{p} suicided ({w})',
  'log.bombPlanted': 'Bomb planted',
  'log.bombDefused': 'Bomb defused',
  'log.assist': '{a} assist',
  // engine messages
  'cf.verifyPrompt': 'HLTV is blocked by Cloudflare: a browser window will open — please complete the verification (it closes automatically once done).',
  'cf.verifyIncomplete': 'Cloudflare verification was not completed (window closed or timed out); will retry later.',
  'cf.verifyWindowFail': 'Could not open the Cloudflare verification window (this environment may have no display): {msg}',
  'engine.noBrowser': 'HLTV Browser cannot find a usable browser. Install Microsoft Edge or Google Chrome, or set "hltv.browserPath".',
  'engine.settings': 'Settings',
};

const zh: Record<string, string> = {
  // sidebar cards
  'card.status': '状态',
  'card.time': '时间',
  'card.event': '赛事',
  'card.score': '比分',
  'card.waitingData': '等待数据…',
  'card.detail': '详情',
  'card.loading': '加载中…',
  'card.loadFailedRetry': '加载失败，收起后重新展开重试',
  'card.format': '赛制',
  'card.type': '类型',
  'card.map': '地图',
  'card.mapOngoing': '(进行中)',
  'card.mapNotPlayed': '未开始',
  'card.stage': '阶段',
  'card.bpSteps': '{n} 步（详见详情页）',
  'view.loadError': '加载失败: {msg}',
  // match detail page
  'web.loading': '加载中…',
  'match.loadingPage': '正在加载比赛页面…',
  'page.loadFailed': '加载失败',
  'match.liveSection': '实时计分板',
  'match.gameLog': 'Game log（击杀提示）',
  'match.maps': '地图',
  'match.thMap': '地图',
  'match.thScore': '比分',
  'match.thHalves': '半场',
  'match.playerStats': '选手统计',
  'match.statsSub': 'Rating 3.0 · K-D / ADR / KAST 含 Eco 调整列',
  'match.side': '阵营：',
  'match.both': 'Both',
  'match.eco': 'Eco 调整：',
  'match.ecoOn': '开启',
  'match.ecoOff': '关闭',
  'match.mapLabel': '地图：',
  'match.lineups': '阵容',
  'match.past': '过去的比赛',
  'match.thOpponent': '对手',
  'match.thWhen': '时间',
  'card.recent': '近期 {team}',
  'match.noSideData': '该侧暂无数据',
  'match.alive': '存活',
  'match.dead': '阵亡',
  'match.stateCol': '状态',
  // event detail page
  'event.loadingPage': '正在加载赛事页面…',
  'event.formats': '赛制',
  'event.teams': '参赛战队',
  'event.teamsSub': '图标默认不加载，右上角按钮统一开关',
  'event.loadLogos': '加载战队图标',
  'event.hideLogos': '关闭战队图标',
  'event.related': '相关赛事',
  'event.swiss': '瑞士轮',
  'event.teamsCount': '{n} 队',
  // news detail page
  'news.loadingPage': '正在加载新闻页面…',
  'news.loadMedia': '加载媒体',
  'news.hideMedia': '关闭媒体',
  'news.image': '图片',
  'news.embed': '嵌入: {p}',
  'news.comments': '评论',
  'news.teams': '文中战队',
  'news.readMore': '阅读更多',
  'news.link': '链接',
  // kill feed formatting
  'log.roundStart': '—— 回合开始 ——',
  'log.restart': '—— 重启 ——',
  'log.join': '→ {p} 加入',
  'log.quit': '← {p} 离开',
  'log.matchStart': '=== 比赛开始: {map} ===',
  'log.roundEnd': '—— {ct}:{t} · {w} 胜（{type}）——',
  'log.suicide': '{p} 自杀 ({w})',
  'log.bombPlanted': '炸弹已安放',
  'log.bombDefused': '炸弹已拆除',
  'log.assist': '{a} 助攻',
  // engine messages
  'cf.verifyPrompt': 'HLTV 被Cloudflare拦截：即将弹出浏览器窗口，请完成人机验证（验证通过后窗口会自动关闭并继续加载）。',
  'cf.verifyIncomplete': 'Cloudflare 验证未完成（窗口被关闭或超时），稍后将再次尝试。',
  'cf.verifyWindowFail': '无法打开 Cloudflare 验证窗口（当前环境可能没有图形界面）：{msg}',
  'engine.noBrowser': 'HLTV Browser 找不到可用的浏览器。请安装 Microsoft Edge 或 Google Chrome，或设置 "hltv.browserPath"。',
  'engine.settings': '设置',
};

const dictionaries: Record<string, Record<string, string>> = { en, zh };

function dictionaryFor(language: string): Record<string, string> {
  const normalized = language.toLowerCase();
  if (normalized.startsWith('zh')) {
    return zh;
  }
  return en;
}

/** Look up a UI string for the current VSCode display language. */
export function t(key: string, params?: Params): string {
  const dict = dictionaryFor(vscode.env.language);
  const template = dict[key] ?? en[key] ?? key;
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in params ? String(params[name]) : m,
  );
}

/** Strings the webview scripts need at runtime (injected into the page). */
export function webviewStrings(): Record<string, string> {
  return {
    noSideData: t('match.noSideData'),
    alive: t('match.alive'),
    dead: t('match.dead'),
    stateCol: t('match.stateCol'),
    loadMedia: t('news.loadMedia'),
    hideMedia: t('news.hideMedia'),
    loadLogos: t('event.loadLogos'),
    hideLogos: t('event.hideLogos'),
  };
}

export function htmlLang(): string {
  return vscode.env.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}
