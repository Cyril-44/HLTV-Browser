import * as vscode from 'vscode';
import * as api from '../hltv/api';
import { scorebot } from '../hltv/scorebot';
import { MatchDetail, StatsTable, StatRow, ScoreFrame, LogItem } from '../hltv/types';
import { PanelRegistry, shellHtml, escapeHtml } from './webviewCommon';
import { formatDateTime } from '../util/time';

const registry = new PanelRegistry();

export function openMatchDetail(url: string): void {
  const key = `match:${url}`;
  registry.getOrCreate(key, () => {
    const panel = vscode.window.createWebviewPanel('hltv.matchDetail', 'HLTV Match', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    const page = new MatchDetailPage(panel, url);
    void page.load();
    return panel;
  });
}

class MatchDetailPage {
  private detail: MatchDetail | null = null;
  private scoreListener = {
    onScore: (frame: ScoreFrame): void => {
      const text = this.scoreText(frame);
      void this.panel.webview.postMessage({ type: 'score', ...text });
    },
    onLog: (items: LogItem[], reset: boolean): void => {
      void this.panel.webview.postMessage({ type: 'log', lines: items.map(formatLogItem).filter(Boolean), reset });
    },
    onPlayerState: (state: unknown): void => {
      void this.panel.webview.postMessage({ type: 'playerState', state });
    },
  };

  constructor(private panel: vscode.WebviewPanel, private url: string) {
    panel.onDidDispose(() => {
      if (this.detail?.scorebot) {
        scorebot.unsubscribe(this.detail.scorebot.id, this.scoreListener);
      }
    });
    panel.webview.onDidReceiveMessage((msg: { type: string; statsUrl?: string; url?: string }) => {
      if (msg.type === 'openLink' && msg.url) {
        void vscode.env.openExternal(vscode.Uri.parse('https://www.hltv.org' + msg.url));
      }
      if (msg.type === 'sideStats' && msg.statsUrl) {
        void this.loadSideStats(msg.statsUrl);
      }
    });
  }

  public async load(): Promise<void> {
    try {
      this.panel.webview.html = shellHtml('加载中…', '<h1 class="meta">正在加载比赛页面…</h1>', this.panel.webview.cspSource);
      this.detail = await api.getMatchDetail(this.url);
      this.panel.title = `${this.detail.team1.name} vs ${this.detail.team2.name}`;
      this.render();
      if (this.detail.scorebot) {
        scorebot.subscribeMatch(this.detail.scorebot.id, this.scoreListener);
        const latest = scorebot.getLatestScore(this.detail.scorebot.id);
        if (latest) {
          this.scoreListener.onScore?.(latest);
        }
        const backlog = scorebot.getRecentLog();
        if (backlog.length) {
          void this.panel.webview.postMessage({ type: 'log', lines: backlog.map(formatLogItem).filter(Boolean), reset: true });
        }
      }
    } catch (e) {
      this.panel.webview.html = shellHtml('加载失败', `<h1>加载失败</h1><p class="meta">${escapeHtml(String(e).split('\n')[0])}</p>`, this.panel.webview.cspSource);
    }
  }

  private render(): void {
    const d = this.detail!;
    const parts: string[] = [];

    // Header
    parts.push('<h1>');
    if (d.seriesScore) {
      parts.push(`${escapeHtml(d.team1.name)} <span class="score-big">${escapeHtml(d.seriesScore)}</span> ${escapeHtml(d.team2.name)}`);
    } else {
      parts.push(`${escapeHtml(d.team1.name)} — ${escapeHtml(d.team2.name)}`);
    }
    if (d.live) {
      parts.push(' <span class="live">● LIVE</span>');
    }
    parts.push('</h1>');
    parts.push(`<p class="meta">${[
      d.event.name,
      d.stage,
      d.format,
      d.startTime ? formatDateTime(d.startTime) : '',
    ].filter(Boolean).map(escapeHtml).join(' · ')}</p>`);

    if (d.live) {
      parts.push(`<div id="liveSection">
        <h2>实时计分板 <span class="sub" id="liveMap"></span></h2>
        <p class="matchline"><span class="score-big" id="liveScore">…</span></p>
        <p class="meta" id="liveMaps"></p>
        <div id="playerTable"></div>
        <h3>Game log（击杀提示）</h3>
        <div class="logbox" id="logbox"></div>
      </div><hr/>`);
    }

    // Vetoes
    if (d.vetoes.length) {
      parts.push('<h2>Veto / BP</h2>');
      parts.push(`<div class="meta">${d.vetoes.map((v) => escapeHtml(v)).join('<br>')}</div>`);
    }

    // Maps
    if (d.maps.length) {
      parts.push('<h2>地图</h2><table><tr><th>Map</th><th>Score</th><th>Halves</th></tr>');
      for (const m of d.maps) {
        parts.push(
          `<tr><td>${escapeHtml(m.name)}</td><td class="num">${escapeHtml(m.score1)} - ${escapeHtml(m.score2)}</td><td class="num">${escapeHtml(m.halves)}</td></tr>`,
        );
      }
      parts.push('</table>');
    }

    // Stats with filters
    if (Object.keys(d.stats).length) {
      parts.push('<h2>选手统计 <span class="sub">Rating 3.0 · K-D / ADR / KAST 含 Eco 调整列</span></h2>');
      parts.push('<div class="btnrow">');
      parts.push('<span class="muted">Side:</span>');
      parts.push('<button data-side="Both" class="active side-btn">Both</button>');
      parts.push('<button data-side="Terrorist" class="side-btn">T</button>');
      parts.push('<button data-side="Counter-Terrorist" class="side-btn">CT</button>');
      parts.push('<span class="muted" style="margin-left:10px">Eco-adjusted:</span>');
      parts.push('<button id="ecoBtn" data-on="0">关闭</button>');
      parts.push('</div>');
      if (d.statMaps.length > 1) {
        parts.push('<div class="btnrow"><span class="muted">Map:</span>');
        for (const m of d.statMaps) {
          parts.push(`<button class="map-btn${m.id === 'all' ? ' active' : ''}" data-map="${escapeHtml(m.id)}">${escapeHtml(m.name)}</button>`);
        }
        parts.push('</div>');
      }
      parts.push('<div id="statsArea"></div><div id="sideStatsArea"></div>');
    }

    // Lineups
    if (d.lineups.length) {
      parts.push('<h2>阵容</h2>');
      for (const lu of d.lineups) {
        parts.push(`<div><strong>${escapeHtml(lu.team)}</strong>: ${lu.players.map((p) => `${escapeHtml(p.nick)} <span class="muted">(${escapeHtml(p.fullName)})</span>`).join(' · ')}</div>`);
      }
    }

    const statsJson = JSON.stringify(d.stats);
    const script = `
const statsData = ${statsJson};
function statTables(mapId) {
  const tables = statsData[mapId] || [];
  return tables.map(t => {
    let h = '<table><tr><th>' + esc(t.team) + '</th><th class="trad">K-D</th><th class="eco">eK-eD</th><th>Swing</th><th class="trad">ADR</th><th class="eco">eADR</th><th class="trad">KAST</th><th class="eco">eKAST</th><th>Rating</th></tr>';
    for (const r of t.rows) {
      h += '<tr><td>' + esc(r.nick) + '</td>'
        + td(r.kd,'trad') + td(r.ekd,'eco') + td(r.swing,'')
        + td(r.adr,'trad') + td(r.eadr,'eco')
        + td(r.kast,'trad') + td(r.ekast,'eco')
        + '<td class="num ' + ratingClass(r.rating) + '">' + esc(r.rating) + '</td></tr>';
    }
    return h + '</table>';
  }).join('');
}
function td(v, cls) { return '<td class="num ' + cls + '">' + esc(v || '-') + '</td>'; }
function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
function ratingClass(v) { const n = parseFloat(v); if (isNaN(n)) return ''; return n >= 1.05 ? 'ratingPositive' : n <= 0.95 ? 'ratingNegative' : 'ratingNeutral'; }
function renderStats() {
  const activeMap = document.querySelector('.map-btn.active')?.dataset.map || 'all';
  document.getElementById('statsArea').innerHTML = statTables(activeMap);
  document.getElementById('sideStatsArea').innerHTML = '';
  document.querySelectorAll('.side-btn').forEach(b => { if (b.dataset.side === 'Both') b.classList.add('active'); else b.classList.remove('active'); });
}
document.querySelectorAll('.map-btn').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.map-btn').forEach(x => x.classList.remove('active'));
  b.classList.add('active'); renderStats();
}));
document.querySelectorAll('.side-btn').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.side-btn').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  const side = b.dataset.side;
  if (side === 'Both') { renderStats(); return; }
  const mapId = document.querySelector('.map-btn.active')?.dataset.map || 'all';
  document.getElementById('sideStatsArea').innerHTML = '<p class="meta">正在加载 ' + side + ' 数据…</p>';
  const statsUrl = (document.getElementById('mapStatsUrls')?.dataset[mapId]) || document.getElementById('mapStatsUrls')?.dataset.all;
  if (!statsUrl) { document.getElementById('sideStatsArea').innerHTML = '<p class="meta">该地图暂无 Detailed stats 页面</p>'; return; }
  acquireVsCodeApi().postMessage({ type: 'sideStats', statsUrl });
}));
document.getElementById('ecoBtn')?.addEventListener('click', (e) => {
  const btn = e.currentTarget;
  const on = btn.dataset.on === '1';
  btn.dataset.on = on ? '0' : '1';
  btn.textContent = on ? '关闭' : '开启';
  btn.classList.toggle('active', !on);
  document.body.classList.toggle('eco', !on);
});
window.addEventListener('message', (ev) => {
  const m = ev.data;
  if (m.type === 'score') {
    document.getElementById('liveScore').textContent = m.scoreLine || '…';
    document.getElementById('liveMaps').textContent = m.mapsLine || '';
    document.getElementById('liveMap').textContent = m.mapName || '';
  }
  if (m.type === 'log' && m.lines) {
    const box = document.getElementById('logbox');
    if (box) {
      if (m.reset) box.innerHTML = '';
      for (const line of m.lines) { const div = document.createElement('div'); div.textContent = line; box.prepend(div); }
      while (box.children.length > 200) box.removeChild(box.lastChild);
    }
  }
  if (m.type === 'playerState') renderScoreboard(m.state);
  if (m.type === 'sideStatsResult') {
    document.getElementById('sideStatsArea').innerHTML = m.html || '<p class="meta">无数据</p>';
  }
});
function renderScoreboard(s) {
  const area = document.getElementById('playerTable');
  if (!area || !s) return;
  let html = '';
  const sides = [['TERRORIST', s.terroristTeamName || 'T'], ['CT', s.ctTeamName || 'CT']];
  for (const [side, label] of sides) {
    const rows = s[side];
    if (!Array.isArray(rows) || !rows.length) continue;
    html += '<table><tr><th>' + esc(label) + '</th><th>$</th><th>K</th><th>A</th><th>D</th><th>ADR</th><th>状态</th></tr>';
    for (const p of rows) {
      const adr = p.damagePrRound != null ? (typeof p.damagePrRound === 'number' ? p.damagePrRound.toFixed(1) : p.damagePrRound) : '-';
      html += '<tr><td>' + esc(p.name || p.nick || '') + '</td><td class="num">' + (p.money ?? '-') + '</td><td class="num">' + (p.score ?? '-') + '</td><td class="num">' + (p.assists ?? '-') + '</td><td class="num">' + (p.deaths ?? '-') + '</td><td class="num">' + adr + '</td><td class="num">' + (p.alive ? '存活' : '阵亡') + '</td></tr>';
    }
    html += '</table>';
  }
  if (html) area.innerHTML = html;
}
renderStats();
applyEcoBody();
function applyEcoBody(){ document.body.classList.remove('eco'); }`;

    // stash per-map detailed-stats URLs for on-demand side loading
    const mapStatsUrls: Record<string, string> = {};
    for (const m of d.maps) {
      if (m.statsUrl && m.name) {
        const statMap = d.statMaps.find((sm) => sm.name.toLowerCase() === m.name.toLowerCase());
        if (statMap) {
          mapStatsUrls[statMap.id] = m.statsUrl;
        }
      }
    }

    this.panel.webview.html = shellHtml(
      `${d.team1.name} vs ${d.team2.name} | HLTV`,
      parts.join('') + `<div id="mapStatsUrls" data-all='${escapeHtml(mapStatsUrls[Object.keys(mapStatsUrls)[0]] ?? '')}' ${Object.entries(mapStatsUrls).map(([k, v]) => `data-${escapeHtml(k)}="${escapeHtml(v)}"`).join(' ')}></div><script>${script}</script>`,
      this.panel.webview.cspSource,
    );
  }

  private async loadSideStats(statsUrl: string): Promise<void> {
    try {
      const tables = await api.getSideStats(statsUrl);
      const html = tables
        .map((t) => {
          const h: string[] = [`<table><tr><th>${escapeHtml(t.team)} <span class="muted">(${escapeHtml(t.side)})</span></th><th class="trad">K-D</th><th class="eco">eK-eD</th><th>Swing</th><th class="trad">ADR</th><th class="eco">eADR</th><th class="trad">KAST</th><th class="eco">eKAST</th><th>Rating</th></tr>`];
          for (const r of t.rows) {
            h.push(
              `<tr><td>${escapeHtml(r.nick)}</td><td class="num trad">${escapeHtml(r.kd || '-')}</td><td class="num eco">${escapeHtml(r.ekd || '-')}</td><td class="num">${escapeHtml(r.swing || '-')}</td><td class="num trad">${escapeHtml(r.adr || '-')}</td><td class="num eco">${escapeHtml(r.eadr || '-')}</td><td class="num trad">${escapeHtml(r.kast || '-')}</td><td class="num eco">${escapeHtml(r.ekast || '-')}</td><td class="num">${escapeHtml(r.rating || '-')}</td></tr>`,
            );
          }
          h.push('</table>');
          return h.join('');
        })
        .join('');
      void this.panel.webview.postMessage({ type: 'sideStatsResult', html: html || '<p class="meta">该侧暂无数据</p>' });
    } catch {
      void this.panel.webview.postMessage({ type: 'sideStatsResult', html: '<p class="meta">加载失败</p>' });
    }
  }

  private scoreText(frame: ScoreFrame): { scoreLine: string; mapsLine: string; mapName: string } {
    const d = this.detail!;
    const t1 = d.scorebot?.team1Id;
    const t2 = d.scorebot?.team2Id;
    const maps = Object.entries(frame.mapScores).sort(([a], [b]) => Number(a) - Number(b));
    const current = maps.find(([, m]) => !m.mapOver);
    const last = maps[maps.length - 1];
    const focus = current ?? last;
    const scoreLine = focus
      ? `${frame.wins[t1 ?? ''] ?? 0} : ${frame.wins[t2 ?? ''] ?? 0}  (${focus[1].scores[t1 ?? ''] ?? 0} - ${focus[1].scores[t2 ?? ''] ?? 0})`
      : '…';
    const mapsLine = maps
      .map(([, m]) => `${(m.map ?? '').replace(/^de_/, '')} ${m.scores[t1 ?? ''] ?? 0}-${m.scores[t2 ?? ''] ?? 0}${m.mapOver ? '' : ' (进行中)'}`)
      .join(' · ');
    const mapName = focus ? `${(focus[1].map ?? '').replace(/^de_/, '')}${current ? ' — 进行中' : ''}` : '';
    return { scoreLine, mapsLine, mapName };
  }
}

export function formatLogItem(item: LogItem): string {
  const [key, value] = Object.entries(item)[0] ?? [];
  if (!key || !value || typeof value !== 'object') {
    return key ? String(key) : '';
  }
  const v = value as Record<string, unknown>;
  const nick = (x: unknown): string => String(x ?? '');
  switch (key) {
    case 'PlayerJoin':
      return `→ ${nick(v.playerNick)} 加入`;
    case 'PlayerQuit':
      return `← ${nick(v.playerNick)} 离开`;
    case 'MatchStarted':
      return `=== 比赛开始: ${nick(v.map).replace(/^de_/, '')} ===`;
    case 'RoundEnd': {
      const winner = v.winner === 'CT' ? 'CT' : 'T';
      return `回合结束 ${nick(v.counterTerroristScore)}:${nick(v.terroristScore)} — ${winner} 胜 (${String(v.winType ?? '').replace(/_/g, ' ')})`;
    }
    case 'Suicide':
      return `${nick(v.playerNick)} 自杀 (${nick(v.weapon)})`;
    case 'BombPlanted':
      return `炸弹已安放`;
    case 'BombDefused':
      return `炸弹已拆除`;
    default: {
      if (/kill/i.test(key)) {
        const killer = v.killerNick ?? v.killer ?? v.killerName;
        const victim = v.victimNick ?? v.victim ?? v.victimName;
        const weapon = v.weapon ?? v.weaponName;
        const hs = v.headshot ? ' (HS)' : '';
        if (killer || victim) {
          return `${nick(killer) || '?'} 击杀 ${nick(victim) || '?'}${weapon ? ` [${nick(weapon)}]` : ''}${hs}`;
        }
      }
      if (/assist/i.test(key)) {
        return `${nick(v.assisterNick ?? v.assister)} 助攻`;
      }
      return `${key} ${JSON.stringify(v).slice(0, 140)}`;
    }
  }
}

export type { StatsTable, StatRow };
