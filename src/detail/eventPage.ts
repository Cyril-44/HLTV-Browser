import * as vscode from 'vscode';
import * as api from '../hltv/api';
import * as media from '../hltv/media';
import { EventDetail } from '../hltv/types';
import { PanelRegistry, shellHtml, escapeHtml, panelKey } from './webviewCommon';
import { formatDate } from '../util/time';
import { t, webviewStrings } from '../i18n';
import { openMatchDetail } from './matchPage';

const registry = new PanelRegistry();

export function openEventDetail(url: string): void {
  const key = panelKey('events', url) ?? `event:${url}`;
  registry.getOrCreate(key, () => {
    const panel = vscode.window.createWebviewPanel('hltv.eventDetail', 'HLTV Event', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      enableFindWidget: true,
      // media proxy hands back local cache files for the bracket/swiss logos
      localResourceRoots: [vscode.Uri.file(media.mediaDir())],
    });
    const page = new EventDetailPage(panel, url);
    void page.load();
    return panel;
  });
}

class EventDetailPage {
  constructor(private panel: vscode.WebviewPanel, private url: string) {
    panel.webview.onDidReceiveMessage((msg: { type: string; url?: string; urls?: string[] }) => {
      if (msg.type === 'openMatch' && msg.url) {
        openMatchDetail(msg.url);
      }
      if (msg.type === 'openEvent' && msg.url) {
        openEventDetail(msg.url);
      }
      if (msg.type === 'openLink' && msg.url) {
        void vscode.env.openExternal(vscode.Uri.parse(msg.url.startsWith('http') ? msg.url : 'https://www.hltv.org' + msg.url));
      }
      if (msg.type === 'refreshPage') {
        api.clearDetailCache(this.url);
        void this.load();
      }
      if (msg.type === 'loadMedia' && msg.urls) {
        // same proxy as news pages: hltv images are CF-challenged in the
        // webview, fetch through the parked engine page, sequentially
        void (async () => {
          for (const u of [...new Set(msg.urls!)]) {
            const file = await media.getMediaImage(u).catch(() => null);
            if (file) {
              // svg results are data URIs already — pass them through as-is
              const uri = file.startsWith('data:') ? file : this.panel.webview.asWebviewUri(vscode.Uri.file(file)).toString();
              void this.panel.webview.postMessage({ type: 'mediaReady', url: u, uri });
            }
            await new Promise((r) => setTimeout(r, 150));
          }
          void this.panel.webview.postMessage({ type: 'mediaDone' });
        })();
      }
    });
  }

  public async load(): Promise<void> {
    try {
      this.panel.webview.html = shellHtml(t('web.loading'), `<h1 class="meta">${t('event.loadingPage')}</h1>`, this.panel.webview.cspSource, this.url);
      const d = await api.getEventDetail(this.url);
      this.panel.title = d.name;
      // brackets / swiss render natively with the site's own stylesheet
      const css = d.bracketHtml || d.swissHtml ? await api.getSiteCss(d.cssUrls).catch(() => '') : '';
      this.render(d, css);
    } catch (e) {
      this.panel.webview.html = shellHtml(t('page.loadFailed'), `<h1>${t('page.loadFailed')}</h1><p class="meta">${escapeHtml(String(e).split('\n')[0])}</p>`, this.panel.webview.cspSource, this.url);
    }
  }

  private render(d: EventDetail, hltvCss: string): void {
    this.panel.webview.html = buildEventHtml(d, hltvCss, this.panel.webview.cspSource, this.url);
  }
}

/** Pure page builder shared by the webview and the offline preview. */
export function buildEventHtml(d: EventDetail, hltvCss: string, cspSource: string, url: string, forcedTheme?: string): string {
    const themeKind = vscode.window.activeColorTheme?.kind;
    const themeClass: 'day-theme' | 'night-theme' =
      themeKind === vscode.ColorThemeKind.Light || themeKind === vscode.ColorThemeKind.HighContrastLight
        ? 'day-theme'
        : 'night-theme';
    const parts: string[] = [];
    parts.push(`<h1>${escapeHtml(d.name)}</h1>`);
    parts.push(
      `<p class="meta">${[
        d.dateStart ? formatDate(d.dateStart) : '',
        d.dateEnd ? `— ${formatDate(d.dateEnd)}` : '',
        d.prize,
        d.teamsCount ? escapeHtml(t('event.teamsCount', { n: d.teamsCount })) : '',
        d.location,
      ]
        .map((s) => (s ? escapeHtml(String(s)) : ''))
        .filter(Boolean)
        .join(' · ')}</p>`,
    );

    if (d.formats.length) {
      parts.push(`<h2>${t('event.formats')}</h2><table>`);
      for (const f of d.formats) {
        parts.push(`<tr><th>${escapeHtml(f.name)}</th><td>${escapeHtml(f.value.replace(/\n/g, ' '))}</td></tr>`);
      }
      parts.push('</table>');
    }

    const native = hltvCss && (d.bracketHtml || d.swissHtml);
    if (native) {
      // real rendered bracket / swiss DOM with the site's stylesheet: the
      // wrapper's inline styles drive layout, links route in-editor, team
      // logos are opt-in media slots fed through the host proxy
      const css = hltvCss
        .replace(/url\((['"]?)\/([^'")]+)\1\)/g, 'url($1https://www.hltv.org/$2$1)')
        .replace(/url\((['"]?)\.\.\/([^'")]+)\1\)/g, 'url($1https://www.hltv.org/$2$1)');
      parts.push('<style>' + css + '</style>');
      parts.push(
        `<style>
html,body{background:var(--vscode-editor-background)!important;background-image:none!important}
body{max-width:1028px!important;margin:0 auto!important;overflow-x:hidden}
.hltv-native{overflow-x:auto}
body:not(.logos-on) .hltv-native img{display:none}
.hltv-native .media-slot.filled{display:inline-block}
.hltv-native .media-slot.filled img{display:inline-block;max-width:100%;height:auto;vertical-align:middle}
.hltv-native a{cursor:pointer}
.hltv-native .bracket-match{cursor:pointer}
/* bracket slot logos: the site sizes the CONTAINER (16px flex box) and
   lets the img fill it via max-100%; our slot span must bridge the two —
   fill the container box, img fills the span with object-fit */
.hltv-native .slot-team-image-container .media-slot{height:100%;width:100%}
.hltv-native .slot-team-image-container .media-slot img{height:100%;width:100%;object-fit:contain;display:block}
.teamgrid .media-slot.logo-slot img{height:20px;width:auto;vertical-align:middle}
.teamgrid .media-slot.logo-slot{display:inline-block;vertical-align:middle}</style>`,
      );
      parts.push(`<div class="hltv-native ${themeClass}">${d.bracketHtml}${d.swissHtml}</div><hr/>`);
    } else {
      // fallback: text cards (no native markup or stylesheet available)
      if (d.brackets.length) {
        for (const section of d.brackets) {
          parts.push(`<h2>${escapeHtml(section.title)}</h2>`);
          for (const round of section.rounds) {
            parts.push(`<h3 class="meta">${escapeHtml(round.name)}</h3>`);
            for (const mu of round.matchups) {
              const hasScore = mu.score1 !== null && mu.score2 !== null;
              const body = hasScore
                ? `${escapeHtml(mu.team1)} <strong>${mu.score1} - ${mu.score2}</strong> ${escapeHtml(mu.team2)}`
                : `${escapeHtml(mu.team1)} vs ${escapeHtml(mu.team2)}`;
              const link = mu.matchUrl ? `<a href="#" class="matchlink" data-url="${escapeHtml(mu.matchUrl)}">${body}</a>` : body;
              parts.push(`<p class="matchline">${link}</p>`);
            }
          }
        }
      }
      if (d.swiss.length) {
        parts.push(`<h2>${t('event.swiss')}</h2>`);
        for (const col of d.swiss) {
          if (!col.matchups.length) {
            continue;
          }
          parts.push(`<h3 class="meta">${escapeHtml(col.title || '')} (${col.matchups.length})</h3>`);
          for (const mu of col.matchups) {
            parts.push(`<p class="matchline">${escapeHtml(mu)}</p>`);
          }
        }
      }
    }

    if (d.teams.length) {
      if (d.teams.some((team) => team.logo)) {
        parts.push(`<button id="logoToggle" class="media-toggle" data-on="0">${t('event.loadLogos')}</button>`);
      }
      parts.push(`<h2>${t('event.teams')} <span class="sub">${t('event.teamsSub')}</span></h2><div class="teamgrid">`);
      for (const team of d.teams) {
        const ranks = [team.worldRank ? `HLTV ${team.worldRank}` : '', team.vrsRank ? `VRS ${team.vrsRank}` : ''].filter(Boolean).join(' / ');
        const logoUrl = team.logo ? (team.logo.startsWith('/') ? `https://www.hltv.org${team.logo}` : team.logo) : '';
        parts.push(
          `<div class="teamcell">${logoUrl ? `<span class="media-slot logo-slot" data-kind="image" data-src="${escapeHtml(logoUrl)}"></span> ` : ''}<strong>${escapeHtml(team.name)}</strong>${ranks ? ` <span class="muted">${escapeHtml(ranks)}</span>` : ''}</div>`,
        );
      }
      parts.push('</div>');
    }

    if (d.relatedEvents.length) {
      parts.push(`<h2>${t('event.related')}</h2>`);
      for (const re of d.relatedEvents) {
        parts.push(`<p class="matchline"><a href="#" class="eventlink" data-url="${escapeHtml(re.url)}">${escapeHtml(re.name)}</a></p>`);
      }
    }

    const script = `
const STR = ${JSON.stringify(webviewStrings())};
document.querySelectorAll('.matchlink').forEach(a => a.addEventListener('click', e => {
  e.preventDefault(); vsApi().postMessage({ type: 'openMatch', url: a.dataset.url });
}));
document.querySelectorAll('.eventlink').forEach(a => a.addEventListener('click', e => {
  e.preventDefault(); vsApi().postMessage({ type: 'openEvent', url: a.dataset.url });
}));
// rendered bracket / swiss blocks: click opens the match page in-editor;
// hover shows the teams (and scores when present) so slots read fine even
// with logos off. Names are taken PER TEAM CONTAINER (.team / .swiss-visual-
// team): bracket logos come in day/night pairs sharing one title, so a flat
// [title] scan would read the same team twice ("VITALITY vs VITALITY").
document.querySelectorAll('.bracket-match').forEach(m => {
  const containers = m.querySelectorAll('.team, .swiss-visual-team');
  const names = [...containers]
    .map((c) => (c.querySelector('.team-name')?.textContent.trim() || c.querySelector('[title]')?.getAttribute('title') || '').trim())
    .filter(Boolean);
  if (names.length >= 2) {
    const results = [...m.querySelectorAll('.result')].map(r => r.textContent.trim());
    if (results.length >= 2) {
      m.title = names[0] + ' ' + (results[0] ?? '') + ' - ' + (results[1] ?? '') + ' ' + names[1];
    } else {
      m.title = names[0] + ' vs ' + names[1];
    }
  }
  m.addEventListener('click', e => {
    e.preventDefault();
    if (m.dataset.url) vsApi().postMessage({ type: 'openMatch', url: m.dataset.url });
  });
});
// native bracket/swiss links: match pages open in-editor, everything else external
document.querySelectorAll('.natlink').forEach(a => a.addEventListener('click', e => {
  e.preventDefault();
  const href = a.getAttribute('href') || '';
  if (!href || href.charAt(0) === '#') return;
  if (/^\\/matches\\//.test(href)) { vsApi().postMessage({ type: 'openMatch', url: href }); return; }
  if (/^\\/events\\//.test(href)) { vsApi().postMessage({ type: 'openEvent', url: href }); return; }
  const target = href.charAt(0) === '/' ? 'https://www.hltv.org' + href : href;
  vsApi().postMessage({ type: 'openLink', url: target });
}));
// one toggle loads/clears ALL logos (bracket, swiss, team grid) through the
// host media proxy — direct loads are Cloudflare-challenged
document.getElementById('logoToggle')?.addEventListener('click', (e) => {
  const btn = e.currentTarget;
  const turnOn = btn.dataset.on !== '1';
  btn.dataset.on = turnOn ? '1' : '0';
  btn.textContent = turnOn ? STR.hideLogos : STR.loadLogos;
  btn.classList.toggle('active', turnOn);
  document.body.classList.toggle('logos-on', turnOn);
  if (!turnOn) {
    document.querySelectorAll('.media-slot').forEach(slot => {
      slot.classList.remove('filled');
      slot.querySelectorAll('img').forEach(el => el.remove());
    });
    return;
  }
  const urls = [];
  document.querySelectorAll('.media-slot[data-kind="image"]').forEach(slot => {
    slot.classList.add('filled');
    urls.push(slot.dataset.src);
  });
  const api = vsApi();
  if (api && urls.length) api.postMessage({ type: 'loadMedia', urls });
});
window.addEventListener('message', ev => {
  const m = ev.data || {};
  if (m.type === 'mediaReady' && m.url && m.uri && document.body.classList.contains('logos-on')) {
    document.querySelectorAll('.media-slot[data-kind="image"]').forEach(slot => {
      if (slot.dataset.src === m.url && !slot.querySelector('img')) {
        const img = document.createElement('img');
        img.src = m.uri;
        slot.appendChild(img);
      }
    });
  }
  if (m.type === 'mediaDone') {
    const btn = document.getElementById('logoToggle');
    const failed = document.querySelectorAll('.media-slot.filled:not(:has(img))').length;
    if (btn && failed) btn.textContent = STR.hideLogos + ' · ' + failed + '\\u2717';
  }
});`;

    return shellHtml(
      `${d.name} | HLTV`,
      parts.join('') + `<script>${script}</script>`,
      cspSource,
      url,
      native ? (forcedTheme ?? themeClass) : undefined,
    );
}
