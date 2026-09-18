import * as vscode from 'vscode';
import * as api from '../hltv/api';
import { EventDetail } from '../hltv/types';
import { PanelRegistry, shellHtml, escapeHtml } from './webviewCommon';
import { formatDate } from '../util/time';
import { t, webviewStrings } from '../i18n';
import { openMatchDetail } from './matchPage';

const registry = new PanelRegistry();

export function openEventDetail(url: string): void {
  registry.getOrCreate(`event:${url}`, () => {
    const panel = vscode.window.createWebviewPanel('hltv.eventDetail', 'HLTV Event', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    const page = new EventDetailPage(panel, url);
    void page.load();
    return panel;
  });
}

class EventDetailPage {
  constructor(private panel: vscode.WebviewPanel, private url: string) {
    panel.webview.onDidReceiveMessage((msg: { type: string; url?: string }) => {
      if (msg.type === 'openMatch' && msg.url) {
        openMatchDetail(msg.url);
      }
      if (msg.type === 'openLink' && msg.url) {
        void vscode.env.openExternal(vscode.Uri.parse('https://www.hltv.org' + msg.url));
      }
    });
  }

  public async load(): Promise<void> {
    try {
      this.panel.webview.html = shellHtml(t('web.loading'), `<h1 class="meta">${t('event.loadingPage')}</h1>`, this.panel.webview.cspSource);
      const d = await api.getEventDetail(this.url);
      this.panel.title = d.name;
      this.render(d);
    } catch (e) {
      this.panel.webview.html = shellHtml(t('page.loadFailed'), `<h1>${t('page.loadFailed')}</h1><p class="meta">${escapeHtml(String(e).split('\n')[0])}</p>`, this.panel.webview.cspSource);
    }
  }

  private render(d: EventDetail): void {
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

    if (d.brackets.length) {
      for (const section of d.brackets) {
        parts.push(`<h2>${escapeHtml(section.title)}</h2>`);
        for (const round of section.rounds) {
          parts.push(`<h3 class="meta">${escapeHtml(round.name)}</h3>`);
          for (const mu of round.matchups) {
            const score = mu.score1 !== null && mu.score2 !== null ? ` <strong>${mu.score1} - ${mu.score2}</strong>` : '';
            const link = mu.matchUrl
              ? `<a href="#" class="matchlink" data-url="${escapeHtml(mu.matchUrl)}">${escapeHtml(mu.team1)} vs ${escapeHtml(mu.team2)}</a>`
              : `${escapeHtml(mu.team1)} vs ${escapeHtml(mu.team2)}`;
            parts.push(`<p class="matchline">${link}${score}</p>`);
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

    if (d.teams.length) {
      if (d.teams.some((team) => team.logo)) {
        parts.push(`<button id="logoToggle" class="media-toggle" data-on="0">${t('event.loadLogos')}</button>`);
      }
      parts.push(`<h2>${t('event.teams')} <span class="sub">${t('event.teamsSub')}</span></h2><div class="teamgrid">`);
      for (const team of d.teams) {
        const ranks = [team.worldRank ? `HLTV ${team.worldRank}` : '', team.vrsRank ? `VRS ${team.vrsRank}` : ''].filter(Boolean).join(' / ');
        parts.push(
          `<div class="teamcell">${team.logo ? `<span class="logo-slot" data-src="${escapeHtml(team.logo)}"></span> ` : ''}<strong>${escapeHtml(team.name)}</strong>${ranks ? ` <span class="muted">${escapeHtml(ranks)}</span>` : ''}</div>`,
        );
      }
      parts.push('</div>');
    }

    if (d.relatedEvents.length) {
      parts.push(`<h2>${t('event.related')}</h2>`);
      for (const re of d.relatedEvents) {
        parts.push(`<p class="matchline"><a href="#" class="extlink" data-url="${escapeHtml(re.url)}">${escapeHtml(re.name)}</a></p>`);
      }
    }

    const script = `
const STR = ${JSON.stringify(webviewStrings())};
document.querySelectorAll('.matchlink').forEach(a => a.addEventListener('click', e => {
  e.preventDefault(); acquireVsCodeApi().postMessage({ type: 'openMatch', url: a.dataset.url });
}));
document.querySelectorAll('.extlink').forEach(a => a.addEventListener('click', e => {
  e.preventDefault(); acquireVsCodeApi().postMessage({ type: 'openLink', url: a.dataset.url });
}));
// One toggle loads/clears ALL team logos at once.
document.getElementById('logoToggle')?.addEventListener('click', (e) => {
  const btn = e.currentTarget;
  const turnOn = btn.dataset.on !== '1';
  btn.dataset.on = turnOn ? '1' : '0';
  btn.textContent = turnOn ? STR.hideLogos : STR.loadLogos;
  btn.classList.toggle('active', turnOn);
  document.querySelectorAll('.logo-slot').forEach(slot => {
    if (turnOn) {
      if (!slot.querySelector('img')) {
        const img = document.createElement('img');
        img.src = slot.dataset.src; img.alt = 'logo'; img.height = 20;
        slot.appendChild(img);
      }
    } else {
      slot.querySelectorAll('img').forEach(el => el.remove());
    }
  });
});`;

    this.panel.webview.html = shellHtml(`${d.name} | HLTV`, parts.join('') + `<script>${script}</script>`, this.panel.webview.cspSource);
  }
}
