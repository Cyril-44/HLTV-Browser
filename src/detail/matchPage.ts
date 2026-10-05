import * as vscode from 'vscode';
import * as api from '../hltv/api';
import { ScorebotMatchSession, scorebot } from '../hltv/scorebot';
import { MatchDetail, StatsTable, StatRow, ScoreFrame, LogItem } from '../hltv/types';
import { PanelRegistry, shellHtml, escapeHtml, panelKey } from './webviewCommon';
import { formatDateTime } from '../util/time';
import { t, webviewStrings } from '../i18n';

const registry = new PanelRegistry();

export function openMatchDetail(url: string): void {
  const key = panelKey('matches', url) ?? `match:${url}`;
  registry.getOrCreate(key, () => {
    const panel = vscode.window.createWebviewPanel('hltv.matchDetail', 'HLTV Match', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      enableFindWidget: true,
    });
    const page = new MatchDetailPage(panel, url);
    void page.load();
    return panel;
  });
}

class MatchDetailPage {
  private detail: MatchDetail | null = null;
  private session: ScorebotMatchSession | null = null;
  /** last round index seen — live log batches continue its zebra blocks */
  private roundSeq = 0;
  private scoreListener = {
    onScore: (frame: ScoreFrame): void => {
      const text = this.scoreText(frame);
      void this.panel.webview.postMessage({ type: 'score', ...text });
    },
    onLog: (items: LogItem[], reset: boolean): void => {
      const list = reset ? normalizeReplay(items) : items;
      const bombPlanted = list.some((i) => 'BombPlanted' in i);
      const roundEnded = list.some((i) => 'RoundEnd' in i);
      const roundStarted = list.some((i) => /roundstart/i.test(String(Object.keys(i)[0] ?? '')));
      if (reset) {
        // backlog diagnostic: if old-round RoundEnd separators are missing on
        // the page, this line shows exactly which event types the scorebot
        // replay actually delivered (find it in the Extension Host log)
        const hist = new Map<string, number>();
        for (const it of items) {
          const k = Object.keys(it)[0] ?? '?';
          hist.set(k, (hist.get(k) ?? 0) + 1);
        }
        const firstRoundEnd = items.find((it) => /roundend/i.test(Object.keys(it)[0] ?? ''));
        console.log(
          `[hltv] scorebot backlog (${items.length}): ${JSON.stringify([...hist.entries()])}` +
            ` | RoundEnd sample: ${firstRoundEnd ? JSON.stringify(firstRoundEnd).slice(0, 220) : 'none'}`,
        );
      }
      const lines = formatLogItems(list, reset ? 0 : this.roundSeq);
      this.roundSeq = lines.length ? lines[lines.length - 1].round ?? this.roundSeq : this.roundSeq;
      void this.panel.webview.postMessage({
        type: 'log',
        lines,
        reset,
        bombPlanted,
        roundEnded,
        roundStarted,
      });
    },
    onPlayerState: (state: unknown): void => {
      void this.panel.webview.postMessage({ type: 'playerState', state });
    },
  };

  constructor(private panel: vscode.WebviewPanel, private url: string) {
    panel.onDidDispose(() => {
      this.session?.close();
      this.session = null;
    });
    panel.webview.onDidReceiveMessage((msg: { type: string; url?: string; sample?: string }) => {
      if (msg.type === 'sbDebug' && msg.sample) {
        // one-shot scoreboard payload sample (player object / round history
        // shapes) — pins the exact scorebot field names from a live match
        console.log(`[hltv] scoreboard sample: ${msg.sample}`);
      }
      if (msg.type === 'openLink' && msg.url) {
        void vscode.env.openExternal(vscode.Uri.parse(msg.url.startsWith('http') ? msg.url : 'https://www.hltv.org' + msg.url));
      }
      if (msg.type === 'openMatch' && msg.url) {
        openMatchDetail(msg.url);
      }
      if (msg.type === 'refreshPage') {
        api.clearDetailCache(this.url);
        void this.load();
      }
    });
  }

  public async load(): Promise<void> {
    try {
      this.panel.webview.html = shellHtml(t('web.loading'), `<h1 class="meta">${t('match.loadingPage')}</h1>`, this.panel.webview.cspSource, this.url);
      this.detail = await api.getMatchDetail(this.url);
      this.panel.title = `${this.detail.team1.name} vs ${this.detail.team2.name}`;
      this.render();
      if (this.detail.scorebot) {
        // one dedicated scorebot socket per panel: two match pages open at
        // the same time can never receive each other's log streams. A page
        // refresh re-runs load() — close the previous socket first or both
        // deliver into the same log box.
        this.session?.close();
        this.session = new ScorebotMatchSession(this.detail.scorebot.id, this.scoreListener);
      }
    } catch (e) {
      this.panel.webview.html = shellHtml(t('page.loadFailed'), `<h1>${t('page.loadFailed')}</h1><p class="meta">${escapeHtml(String(e).split('\n')[0])}</p>`, this.panel.webview.cspSource, this.url);
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
        <h2>${t('match.liveSection')} <span class="sub" id="liveMap"></span></h2>
        <p class="matchline"><span class="score-big" id="liveScore">…</span> <span class="muted" id="roundClock"></span></p>
        <p class="meta" id="roundHistory"></p>
        <p class="meta" id="liveMaps"></p>
        <div id="playerTable"></div>
        <h3>${t('match.gameLog')}</h3>
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
      parts.push(`<h2>${t('match.maps')}</h2><table><tr><th>${t('match.thMap')}</th><th>${t('match.thScore')}</th><th>${t('match.thHalves')}</th></tr>`);
      for (const m of d.maps) {
        parts.push(
          `<tr><td>${escapeHtml(m.name)}</td><td class="num">${escapeHtml(m.score1)} - ${escapeHtml(m.score2)}</td><td class="num">${escapeHtml(m.halves)}</td></tr>`,
        );
      }
      parts.push('</table>');
    }

    // Stats with filters
    if (Object.keys(d.stats).length) {
      parts.push(`<h2>${t('match.playerStats')} <span class="sub">${t('match.statsSub')}</span></h2>`);
      parts.push('<div class="btnrow">');
      parts.push(`<span class="muted">${t('match.side')}</span>`);
      parts.push(`<button data-side="both" class="active side-btn">${t('match.both')}</button>`);
      parts.push('<button data-side="t" class="side-btn">T</button>');
      parts.push('<button data-side="ct" class="side-btn">CT</button>');
      parts.push(`<span class="muted" style="margin-left:10px">${t('match.eco')}</span>`);
      parts.push(`<button id="ecoBtn" data-on="0">${t('match.ecoOff')}</button>`);
      parts.push('</div>');
      if (d.statMaps.length > 1) {
        parts.push(`<div class="btnrow"><span class="muted">${t('match.mapLabel')}</span>`);
        for (const m of d.statMaps) {
          parts.push(`<button class="map-btn${m.id === 'all' ? ' active' : ''}" data-map="${escapeHtml(m.id)}">${escapeHtml(m.name)}</button>`);
        }
        parts.push('</div>');
      }
      parts.push('<div id="statsArea"></div>');
    }

    // Past matches (each side's recent results)
    for (const side of d.pastMatches) {
      parts.push(`<h2>${t('match.past')} <span class="sub">${escapeHtml(side.team)}</span></h2>`);
      parts.push(`<table><tr><th>${t('match.thOpponent')}</th><th>${t('match.thWhen')}</th><th>${t('match.thMap')}</th><th>${t('match.thScore')}</th></tr>`);
      for (const m of side.matches) {
        const scoreClass = m.won === true ? 'won' : m.won === false ? 'lost' : '';
        parts.push(
          `<tr><td>${m.url ? `<a href="#" class="matchlink" data-url="${escapeHtml(m.url)}">${escapeHtml(m.opponent)}</a>` : escapeHtml(m.opponent)}</td><td class="muted">${escapeHtml(m.timeAgo)}</td><td>${escapeHtml(m.format)}</td><td class="num ${scoreClass}">${escapeHtml(m.score)}</td></tr>`,
        );
      }
      parts.push('</table>');
    }

    // Lineups
    if (d.lineups.length) {
      parts.push(`<h2>${t('match.lineups')}</h2>`);
      for (const lu of d.lineups) {
        parts.push(`<div><strong>${escapeHtml(lu.team)}</strong>: ${lu.players.map((p) => `${escapeHtml(p.nick)} <span class="muted">(${escapeHtml(p.fullName)})</span>`).join(' · ')}</div>`);
      }
    }

    const statsJson = JSON.stringify(d.stats);
    const script = `
const STR = Object.assign({ ecoOn: ${JSON.stringify(t('match.ecoOn'))}, ecoOff: ${JSON.stringify(t('match.ecoOff'))}, weaponCol: ${JSON.stringify(t('match.weaponCol'))}, roundLabel: ${JSON.stringify(t('match.roundHistory'))} }, ${JSON.stringify(webviewStrings())});
const statsData = ${statsJson};
function statTables(mapId, side) {
  // All three side variants are embedded in the page data — switching is a
  // pure client-side filter, no request involved.
  const tables = (statsData[mapId] || []).filter(t => t.side === side);
  if (!tables.length) return '<p class="meta">' + STR.noSideData + '</p>';
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
  const activeSide = document.querySelector('.side-btn.active')?.dataset.side || 'both';
  document.getElementById('statsArea').innerHTML = statTables(activeMap, activeSide);
}
document.querySelectorAll('.map-btn').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.map-btn').forEach(x => x.classList.remove('active'));
  b.classList.add('active'); renderStats();
}));
document.querySelectorAll('.side-btn').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.side-btn').forEach(x => x.classList.remove('active'));
  b.classList.add('active'); renderStats();
}));
document.getElementById('ecoBtn')?.addEventListener('click', (e) => {
  const btn = e.currentTarget;
  const on = btn.dataset.on === '1';
  btn.dataset.on = on ? '0' : '1';
  btn.textContent = on ? STR.ecoOff : STR.ecoOn;
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
    prependLog(m.lines, !!m.reset, !!m.bombPlanted, !!m.roundEnded, !!m.roundStarted);
  }
  if (m.type === 'playerState') renderScoreboard(m.state);
});
// Round / bomb countdown: base value + timestamp, ticked locally. After a
// plant the server switches roundTimeRemainingMS to the bomb timer; log flags
// let us fall back to the standard 40s bomb window.
let clock = null; // { ms, at }
// The round-clock text at the moment of the plant — BombPlanted lines are
// stamped with THIS (the round time when the bomb went down), not the
// subsequent 40s bomb countdown.
let plantClockText = null;
function setClock(ms) {
  clock = { ms, at: Date.now() };
  renderClock();
}
function clearClock() {
  clock = null;
  const el = document.getElementById('roundClock');
  if (el) el.textContent = '';
}
function clockText() {
  if (!clock) return '';
  const ms = Math.max(0, clock.ms - (Date.now() - clock.at));
  const sec = Math.ceil(ms / 1000);
  // rounds last at most 1:55 — no minute padding
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}
function renderClock() {
  const el = document.getElementById('roundClock');
  if (el) el.textContent = clock ? clockText() : '';
}
setInterval(renderClock, 250);

// Newest on top: every line (backlog and live alike) is inserted at the top,
// so time runs from bottom (earliest) to top (latest).
function prependLog(lines, reset, bombPlanted, roundEnded, roundStarted) {
  const box = document.getElementById('logbox');
  if (!box) return;
  if (reset) box.innerHTML = '';
  // Freeze the round time BEFORE switching to the bomb countdown so the
  // BombPlanted line carries the round time at the plant.
  let stampAtPlant = null;
  if (bombPlanted && clock && clock.ms - (Date.now() - clock.at) > 40000) {
    stampAtPlant = clockText();
  }
  for (const l of lines) {
    // cross-batch duplicate collapse (warmup loops)
    const first = box.firstChild;
    if (first && first.textContent.replace(/^\[*[0-9:*]*\]*\s*/, '') === l.text) continue;
    const div = document.createElement('div');
    let text = l.text;
    if (!reset && l.kind !== 'notime') {
      let stamp = clockText();
      if (l.kind === 'bomb') stamp = stampAtPlant ?? plantClockText ?? stamp;
      if (stamp) text = (l.kind === 'bomb' ? '*' : '') + '[' + stamp + '] ' + text;
      else if (l.kind === 'bomb') text = '*' + text;
    } else if (l.kind === 'bomb') {
      text = '*' + text;
    }
    div.textContent = text;
    // round-block zebra: every line carries the round index from the host
    div.className = (l.round ?? 0) % 2 ? 'r1' : '';
    box.insertBefore(div, box.firstChild);
  }
  while (box.children.length > 2000) box.removeChild(box.lastChild);
  if (bombPlanted) {
    if (stampAtPlant) plantClockText = stampAtPlant;
    setClock(clock ? Math.min(clock.ms, 40000) : 40000);
  }
  if (roundStarted) {
    plantClockText = null;
    setClock(115000); // fresh round: 1:55
  }
  if (roundEnded) {
    plantClockText = null;
    clearClock();
  }
}

// ---- round history: two left-aligned rows, one per team; won rounds show
// the site's abbreviation letters (B bomb / K killed / S saved / T time),
// no fills ----
function roundWinnerSide(x) {
  var t = String((x && typeof x === 'object' ? (x.type || x.winType || '') : x) || '').toLowerCase();
  if (!t) return '';
  if (t.indexOf('terrorists_win') >= 0 || t.indexOf('target_bombed') >= 0 || t.indexOf('bomb_explod') >= 0) return 'T';
  if (t.indexOf('cts_win') >= 0 || t.indexOf('ct_win') >= 0 || t.indexOf('defuse') >= 0 || t.indexOf('saved') >= 0) return 'CT';
  return '?';
}
function roundLetter(x) {
  var t = String((x && typeof x === 'object' ? (x.type || x.winType || '') : x) || '').toLowerCase();
  if (t.indexOf('defuse') >= 0 || t.indexOf('saved') >= 0) return 'S';
  if (t.indexOf('bomb') >= 0) return 'B'; // Target_Bombed (check after defuse)
  if (t.indexOf('time') >= 0 || t.indexOf('expire') >= 0) return 'T';
  return 'K'; // elimination win
}
var sbDebugSent = false;
// Scoreboard history arrives as incremental payloads: deep into the second
// half they OMIT firstHalf (and pre-overtime they omit overtime). Accumulate
// per-side across payloads, keeping the longest half arrays. Within a map the
// second half only ever GROWS — a shrinking secondHalf means a new map (or a
// map restart), where we reset instead of merging stale rounds.
var histStore = { ct: null, t: null };
function mergedHist(stored, inc) {
  var f = inc && inc.firstHalf || [], s = inc && inc.secondHalf || [], o = inc && inc.overtime || [];
  if (!stored) return { firstHalf: f, secondHalf: s, overtime: o };
  // Many scoreboard payloads carry NO history at all (player-state-only
  // increments). They must NOT wipe what we accumulated — only a payload
  // that actually carries history may reset (new map) or extend it.
  if (!f.length && !s.length && !o.length) return stored;
  var sF = stored.firstHalf || [], sS = stored.secondHalf || [], sO = stored.overtime || [];
  if (s.length < sS.length) {
    return { firstHalf: f, secondHalf: s, overtime: o }; // new map / restart
  }
  return {
    firstHalf: f.length >= sF.length ? f : sF,
    secondHalf: s.length >= sS.length ? s : sS,
    overtime: o.length >= sO.length ? o : sO,
  };
}
function renderRoundHistory(s) {
  var el = document.getElementById('roundHistory');
  if (!el) return;
  histStore.ct = mergedHist(histStore.ct, s.ctMatchHistory);
  histStore.t = mergedHist(histStore.t, s.terroristMatchHistory);
  var pick = function (h) { return (h.firstHalf || []).concat(h.secondHalf || [], h.overtime || []); };
  var ct = pick(histStore.ct);
  var t = pick(histStore.t);
  if (!ct.length && !t.length) { el.textContent = ''; return; }
  var n = Math.max(ct.length, t.length);
  if (!n) { el.textContent = ''; return; }
  // three-row TABLE (round numbers / team A / team B): fixed col widths make
  // per-round alignment independent of team-name lengths
  var cols = '<colgroup><col style="width:104px">';
  for (var c = 0; c < n; c++) { cols += '<col style="width:18px">'; }
  cols += '</colgroup>';
  var numRow = '<tr class="rh-num"><th>' + esc(STR.roundLabel) + '</th>';
  for (var i = 0; i < n; i++) { numRow += '<td>' + (i + 1) + '</td>'; }
  numRow += '</tr>';
  var mkRow = function (name, arr, side) {
    var r = '<tr><th class="rh-team">' + esc(name) + '</th>';
    for (var j = 0; j < n; j++) {
      r += roundWinnerSide(arr[j]) === side ? '<td class="rh-w">' + roundLetter(arr[j]) + '</td>' : '<td class="rh-x"></td>';
    }
    return r + '</tr>';
  };
  el.innerHTML = '<table class="rhist">' + cols + numRow +
    mkRow(s.ctTeamName || 'CT', ct, 'CT') + mkRow(s.terroristTeamName || 'T', t, 'T') + '</table>';
  if (!sbDebugSent) {
    sbDebugSent = true;
    var api = (typeof vsApi === 'function') ? vsApi() : null;
    if (api) api.postMessage({ type: 'sbDebug', sample: JSON.stringify({ ctHist: s.ctMatchHistory, tHist: s.terroristMatchHistory }).slice(0, 900) });
  }
}
function renderScoreboard(s) {
  const area = document.getElementById('playerTable');
  if (!area || !s) return;
  if (typeof s.roundTimeRemainingMS === 'number') {
    if (s.bombPlanted && clock && !plantClockText && clock.ms - (Date.now() - clock.at) > 40000) {
      plantClockText = clockText();
    }
    setClock(s.bombPlanted ? Math.min(s.roundTimeRemainingMS, 40000) : s.roundTimeRemainingMS);
  }
  renderRoundHistory(s);
  // ONE table for both teams: a shared colgroup keeps the two team blocks'
  // columns pixel-aligned (two separate tables drift with content width).
  let html = '<table class="ptable ptable-fixed"><colgroup>' +
    '<col style="width:19%"><col style="width:9%"><col style="width:26%"><col style="width:7%"><col style="width:7%"><col style="width:7%"><col style="width:11%"><col style="width:14%">' +
    '</colgroup>';
  const sides = [['TERRORIST', s.terroristTeamName || 'T'], ['CT', s.ctTeamName || 'CT']];
  let sbSampleSent = false;
  for (const [side, label] of sides) {
    const rows = s[side];
    if (!Array.isArray(rows) || !rows.length) continue;
    html += '<tr class="team-head"><td colspan="7"><strong>' + esc(label) + '</strong></td><td class="num">' + (rows.filter(p => p.alive).length + '/' + rows.length) + '</td></tr>';
    html += '<tr><th>' + STR.playerCol + '</th><th>$</th><th>' + STR.weaponCol + '</th><th>K</th><th>A</th><th>D</th><th>ADR</th><th>' + STR.stateCol + '</th></tr>';
    for (const p of rows) {
      if (!sbSampleSent) {
        sbSampleSent = true;
        const api = (typeof vsApi === 'function') ? vsApi() : null;
        if (api) api.postMessage({ type: 'sbDebug', sample: JSON.stringify(p).slice(0, 600) });
      }
      const adr = p.damagePrRound != null ? (typeof p.damagePrRound === 'number' ? p.damagePrRound.toFixed(1) : p.damagePrRound) : '-';
      // field names pinned from a live scoreboard dump:
      // primaryWeapon / kevlar / helmet / hasDefusekit (booleans), hp, equipmentValue
      const weapon = (p.primaryWeapon ?? p.weapon ?? p.weaponName ?? p.activeWeapon) || '-';
      let gear = String(weapon);
      if (p.kevlar) gear += ' ' + STR.gearKev;
      if (p.helmet) gear += ' ' + STR.gearHelm;
      if (p.hasDefusekit) gear += ' ' + STR.gearKit;
      html += '<tr class="p-row ' + (p.alive ? 'p-alive' : 'p-dead') + '"><td>' + esc(p.name || p.nick || '') + '</td><td class="num">' + (p.money ?? '-') + '</td><td class="nw">' + esc(gear) + '</td><td class="num">' + (p.score ?? '-') + '</td><td class="num">' + (p.assists ?? '-') + '</td><td class="num">' + (p.deaths ?? '-') + '</td><td class="num">' + adr + '</td><td class="num">' + (p.alive ? STR.alive : STR.dead) + '</td></tr>';
    }
  }
  if (html) { html += '</table>'; area.innerHTML = html; }
}
document.querySelectorAll('.matchlink').forEach(a => a.addEventListener('click', e => {
  e.preventDefault(); vsApi().postMessage({ type: 'openMatch', url: a.dataset.url });
}));
renderStats();`;

    this.panel.webview.html = shellHtml(
      `${d.team1.name} vs ${d.team2.name} | HLTV`,
      parts.join('') + `<script>${script}</script>`,
      this.panel.webview.cspSource,
      this.url,
    );
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
      .map(([, m]) => `${(m.map ?? '').replace(/^de_/, '')} ${m.scores[t1 ?? ''] ?? 0}-${m.scores[t2 ?? ''] ?? 0}${m.mapOver ? '' : ` (${t('card.mapOngoing').replace(/[()]/g, '')})`}`)
      .join(' · ');
    const mapName = focus ? `${(focus[1].map ?? '').replace(/^de_/, '')}${current ? ` — ${t('card.mapOngoing').replace(/[()]/g, '')}` : ''}` : '';
    return { scoreLine, mapsLine, mapName };
  }
}

/**
 * Normalize a scorebot replay (the initial full-log batch). Verified against
 * the live wire (2026-10): the replay array is NEWEST-FIRST — array head is
 * the latest event, tail is the very first MatchStarted. The page renders
 * newest-on-top by inserting each item at the top, so a newest-first array
 * must be flipped or the oldest events land on top and the box trim eats
 * the recent rounds. Direction is detected two ways: RoundEnd score totals
 * descending, or (matches still in warmup, no rounds yet) the tail being the
 * founding MatchStarted while the head is a play event.
 */
export function normalizeReplay(items: LogItem[]): LogItem[] {
  const keyOf = (it: LogItem): string => String(Object.keys(it)[0] ?? '');
  const roundEndTotal = (it: LogItem): number | null => {
    const v = Object.values(it)[0] as Record<string, unknown> | undefined;
    if (!v || typeof v !== 'object') {
      return null;
    }
    const ct = Number(v.counterTerroristScore ?? v.ctScore ?? NaN);
    const t = Number(v.terroristScore ?? v.tScore ?? NaN);
    return Number.isFinite(ct) && Number.isFinite(t) ? ct + t : null;
  };
  const ends = items
    .filter((it) => /roundend/i.test(keyOf(it)))
    .map(roundEndTotal)
    .filter((x): x is number => x != null);
  if (ends.length >= 2 && ends[0] > ends[ends.length - 1]) {
    return [...items].reverse();
  }
  const headIsPlay = /^(kill|assist|suicide|bombplanted|roundstart|roundend)/i.test(keyOf(items[0] ?? {}));
  const tailIsFounding = /matchstarted/i.test(keyOf(items[items.length - 1] ?? {}));
  return headIsPlay && tailIsFounding ? [...items].reverse() : items;
}

interface PendingKill {
  index: number;
  killer: string;
  weapon: string;
  hs: string;
  victim: string;
}

/** A rendered log line plus how the webview should stamp it. */
export interface LogLine {
  text: string;
  /** normal: [clock] prefix · bomb: `*` before the clock · notime: no stamp */
  kind: 'normal' | 'bomb' | 'notime';
  /** round block index for zebra striping: bumps at each RoundStart, resets
   *  to 0 on MatchStarted (new map). Warmup lines live in block 0. */
  round?: number;
}

/**
 * Format the log stream as display lines. Assists arrive as standalone
 * entries right after the kill they belong to ("X assist") — merge them into
 * the kill line: `Niko + m0NESY [ak47] apEX`.
 */
export function formatLogItems(items: LogItem[], startRound = 0): LogLine[] {
  const out: LogLine[] = [];
  // Assists usually ARRIVE BEFORE the kill they belong to in the scorebot
  // stream, but sometimes follow it — support both directions.
  let pending: (PendingKill & { line: LogLine }) | null = null;
  let pendingAssist: string | null = null;
  // round block counter for zebra striping: live batches continue from the
  // previous batch's last round (startRound), reset batches start at 0.
  let round = startRound;
  const str = (x: unknown): string => String(x ?? '');
  const push = (line: LogLine): void => {
    // Warmup loops repeat identical announcements (Match started etc.) —
    // collapse consecutive duplicates.
    if (out.length && out[out.length - 1].text === line.text && line.kind === 'normal') {
      return;
    }
    line.round = round;
    out.push(line);
  };
  for (const item of items) {
    const [key, value] = Object.entries(item)[0] ?? [];
    if (/^matchstarted$/i.test(key)) {
      round = 0; // new map: fresh block sequence
    }
    if (!key || !value || typeof value !== 'object') {
      if (/roundend/i.test(key)) {
        // even a null/empty-valued RoundEnd must yield a separator
        push(roundEndLine({}, item));
        continue;
      }
      if (key) {
        push({ text: String(key), kind: 'normal' });
      }
      continue;
    }
    const v = value as Record<string, unknown>;
    if (/^roundstart$/i.test(key) || /restart/i.test(key)) {
      round++;
      push({ text: t(/restart/i.test(key) ? 'log.restart' : 'log.roundStart'), kind: 'notime' });
      pending = null;
      pendingAssist = null;
      continue;
    }
    if (/kill/i.test(key)) {
      const killer = str(v.killerNick ?? v.killer ?? v.killerName);
      const victim = str(v.victimNick ?? v.victim ?? v.victimName);
      const weapon = str(v.weapon ?? v.weaponName);
      const hs = killFlags(v);
      const inlineAssist = str(v.assisterNick ?? v.assistNick ?? v.assister ?? v.assist);
      const assist = pendingAssist ?? inlineAssist;
      pendingAssist = null;
      if (killer || victim) {
        const line: LogLine = { text: killLine(killer || '?', assist, weapon, hs, victim || '?'), kind: 'normal' };
        push(line);
        if (!assist) {
          pending = { index: out.length - 1, killer: killer || '?', weapon, hs, victim: victim || '?', line };
        } else {
          pending = null;
        }
      } else {
        push({ text: `${key} ${JSON.stringify(v).slice(0, 140)}`, kind: 'normal' });
        pending = null;
      }
      continue;
    }
    if (/assist/i.test(key)) {
      const nick = str(v.assisterNick ?? v.assistNick ?? v.playerNick ?? v.nick ?? v.playerName);
      if (nick && pending) {
        // assist arriving AFTER its kill
        pending.line.text = killLine(pending.killer, nick, pending.weapon, pending.hs, pending.victim);
        pending = null;
        continue;
      }
      pendingAssist = nick || null; // assist arriving BEFORE its kill
      continue;
    }
    if (/bombplanted/i.test(key)) {
      push({ text: t('log.bombPlanted'), kind: 'bomb' });
      pending = null;
      pendingAssist = null;
      continue;
    }
    if (/roundend/i.test(key)) {
      push(roundEndLine(v, item));
      pending = null;
      pendingAssist = null;
      continue;
    }
    pending = null;
    pendingAssist = null;
    const single = formatLogItem(item);
    if (single) {
      push({ text: single, kind: 'normal' });
    }
  }
  return out;
}

/**
 * Round-end separator line. Field names on RoundEnd vary across scorebot
 * builds (counterTerroristScore/ctScore/…, winner CT/T/CounterTerrorists/…);
 * extract defensively and degrade to a scoreless separator rather than
 * dropping the line entirely — the backlog showed RoundEnd events present
 * while no separators rendered, so nothing here may return empty.
 */
function roundEndLine(v: Record<string, unknown>, item?: LogItem): LogLine {
  const ct = v.counterTerroristScore ?? v.ctScore ?? v.counterTerroristsScore ?? v.ct ?? v.counterTerrorist;
  const tSide = v.terroristScore ?? v.tScore ?? v.terroristsScore ?? v.t;
  const winnerRaw = String(v.winner ?? v.winTeam ?? v.winnerSide ?? '').toLowerCase();
  const winnerIsCt = /ct|counter/.test(winnerRaw);
  const type = String(v.winType ?? v.type ?? v.reason ?? '').replace(/_/g, ' ');
  const ctTxt = ct != null ? String(ct) : '';
  const tTxt = tSide != null ? String(tSide) : '';
  if (ctTxt && tTxt && winnerRaw) {
    return {
      text: t('log.roundEnd', { ct: ctTxt, t: tTxt, w: winnerIsCt ? 'CT' : 'T', type }),
      kind: 'notime',
    };
  }
  if (winnerRaw) {
    return { text: t('log.roundEndShort', { w: winnerIsCt ? 'CT' : 'T' }), kind: 'notime' };
  }
  // nothing recognizable: still emit a separator, plus the raw shape when we
  // have it so the diagnostic log can pin the exact field names
  const raw = item ? ` ${JSON.stringify(item).slice(0, 80)}` : '';
  return { text: `${t('log.roundEndShort', { w: '?' })}${raw}`, kind: 'notime' };
}

/** Compact tags for special kills: headshot / wallbang / smokebang / noscope. */
function killFlags(v: Record<string, unknown>): string {
  const tags: string[] = [];
  if (v.headshot) {
    tags.push('HS');
  }
  if (v.penetrated || v.wallbang) {
    tags.push('WB');
  }
  if (v.throughSmoke || v.smokebang || v.thrusmoke) {
    tags.push('SB');
  }
  if (v.noscope) {
    tags.push('NS');
  }
  return tags.length ? ` (${tags.join('/')})` : '';
}

function killLine(killer: string, assist: string, weapon: string, hs: string, victim: string): string {
  return `${killer}${assist ? ` + ${assist}` : ''}${weapon ? ` [${weapon}]` : ''}${hs} ${victim}`;
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
      return t('log.join', { p: nick(v.playerNick) });
    case 'PlayerQuit':
      return t('log.quit', { p: nick(v.playerNick) });
    case 'MatchStarted':
      return t('log.matchStart', { map: nick(v.map).replace(/^de_/, '') });
    case 'RoundEnd':
      return roundEndLine(v, item).text;
    case 'Restart':
      return t('log.restart');
    case 'Suicide':
      return t('log.suicide', { p: nick(v.playerNick), w: nick(v.weapon) });
    case 'BombPlanted':
      return t('log.bombPlanted');
    case 'BombDefused':
      return t('log.bombDefused');
    default: {
      if (/kill/i.test(key)) {
        const killer = v.killerNick ?? v.killer ?? v.killerName;
        const victim = v.victimNick ?? v.victim ?? v.victimName;
        const weapon = v.weapon ?? v.weaponName;
        const hs = killFlags(v);
        if (killer || victim) {
          return killLine(nick(killer) || '?', '', nick(weapon), hs, nick(victim) || '?');
        }
      }
      if (/assist/i.test(key)) {
        return t('log.assist', { a: nick(v.assisterNick ?? v.assister) });
      }
      return `${key} ${JSON.stringify(v).slice(0, 140)}`;
    }
  }
}

export type { StatsTable, StatRow };
