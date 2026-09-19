import * as vscode from 'vscode';
import * as api from '../hltv/api';
import { NewsDetail, NewsBlock, NewsSegment } from '../hltv/types';
import { PanelRegistry, shellHtml, escapeHtml } from './webviewCommon';
import { openMatchDetail } from './matchPage';
import { formatDateTime, formatMatchTime } from '../util/time';
import { t, webviewStrings } from '../i18n';

const registry = new PanelRegistry();

export function openNewsDetail(url: string): void {
  registry.getOrCreate(`news:${url}`, () => {
    const panel = vscode.window.createWebviewPanel('hltv.newsDetail', 'HLTV News', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      enableFindWidget: true,
    });
    const page = new NewsDetailPage(panel, url);
    void page.load();
    return panel;
  });
}

function renderSegments(segments: NewsSegment[]): string {
  return segments
    .map((seg) => `${seg.bold ? '<strong>' : ''}${seg.italic ? '<em>' : ''}${escapeHtml(seg.text)}${seg.italic ? '</em>' : ''}${seg.bold ? '</strong>' : ''}`)
    .join('');
}

class NewsDetailPage {
  constructor(private panel: vscode.WebviewPanel, private url: string) {
    panel.webview.onDidReceiveMessage((msg: { type: string; url?: string }) => {
      if (msg.type === 'openLink' && msg.url) {
        void vscode.env.openExternal(vscode.Uri.parse(msg.url.startsWith('http') ? msg.url : 'https://www.hltv.org' + msg.url));
      }
      if (msg.type === 'openMatch' && msg.url) {
        openMatchDetail(msg.url);
      }
      if (msg.type === 'openNews' && msg.url) {
        openNewsDetail(msg.url);
      }
    });
  }

  public async load(): Promise<void> {
    try {
      this.panel.webview.html = shellHtml(t('web.loading'), `<h1 class="meta">${t('news.loadingPage')}</h1>`, this.panel.webview.cspSource);
      const d = await api.getNewsDetail(this.url);
      this.panel.title = d.title.slice(0, 40);
      this.render(d);
    } catch (e) {
      this.panel.webview.html = shellHtml(t('page.loadFailed'), `<h1>${t('page.loadFailed')}</h1><p class="meta">${escapeHtml(String(e).split('\n')[0])}</p>`, this.panel.webview.cspSource);
    }
  }

  private render(d: NewsDetail): void {
    const parts: string[] = [];
    parts.push(`<button id="mediaToggle" class="media-toggle" data-on="0">${t('news.loadMedia')}</button>`);
    parts.push(`<h1>${escapeHtml(d.title)}</h1>`);
    parts.push(
      `<p class="meta">${[d.author, d.date ? formatDateTime(d.date) : ''].filter(Boolean).map(escapeHtml).join(' · ')}</p>`,
    );
    if (d.intro) {
      parts.push(`<blockquote>${escapeHtml(d.intro)}</blockquote>`);
    }

    for (const block of d.blocks) {
      switch (block.kind) {
        case 'text':
          parts.push(`<p>${renderSegments(block.segments)}${block.link ? ` <a href="#" class="extlink" data-url="${escapeHtml(block.link)}">[${t('news.link')}]</a>` : ''}</p>`);
          break;
        case 'quote':
          parts.push(
            `<blockquote>${renderSegments(block.segments)}${block.author ? `<footer class="muted">— ${escapeHtml(block.author)}</footer>` : ''}</blockquote>`,
          );
          break;
        case 'match': {
          const mapsLine = block.maps.map((m) => `${escapeHtml(m.name)} ${escapeHtml(m.score1)}-${escapeHtml(m.score2)}`).join(' · ');
          parts.push(
            `<div class="matchcard"><div class="meta">${[escapeHtml(block.event), escapeHtml(block.matchType), escapeHtml(block.dateText)].filter(Boolean).join(' · ')}</div>` +
              `<p class="matchline">${block.matchUrl ? `<a href="#" class="matchlink" data-url="${escapeHtml(block.matchUrl)}">` : ''}${escapeHtml(block.team1)} <strong>${escapeHtml(block.score1)} - ${escapeHtml(block.score2)}</strong> ${escapeHtml(block.team2)}${block.matchUrl ? '</a>' : ''}</p>` +
              (mapsLine ? `<p class="meta">${mapsLine}</p>` : '') +
              `</div>`,
          );
          for (const table of block.stats) {
            parts.push(`<table><tr><th>${escapeHtml(table.team)}</th><th>K-D</th><th>Swing</th><th>ADR</th><th>KAST</th><th>Rating</th></tr>`);
            for (const r of table.rows) {
              parts.push(`<tr><td>${escapeHtml(r.nick)}</td><td class="num">${escapeHtml(r.kd)}</td><td class="num">${escapeHtml(r.swing)}</td><td class="num">${escapeHtml(r.adr)}</td><td class="num">${escapeHtml(r.kast)}</td><td class="num">${escapeHtml(r.rating)}</td></tr>`);
            }
            parts.push('</table>');
          }
          break;
        }
        case 'fixtures': {
          parts.push(`<div class="matchcard"><div class="meta">${escapeHtml(block.event)}</div>`);
          for (const row of block.rows) {
            const when = row.epoch ? formatMatchTime(row.epoch) : '';
            const body = `${escapeHtml(row.team1)} - ${escapeHtml(row.team2)}${when ? ` <span class="muted">· ${escapeHtml(when)}</span>` : ''}`;
            parts.push(
              `<p class="matchline">${row.url ? `<a href="#" class="matchlink" data-url="${escapeHtml(row.url)}">${body}</a>` : body}</p>`,
            );
          }
          parts.push('</div>');
          break;
        }
        case 'readMore': {
          parts.push(
            `<blockquote><a href="#" class="newslink" data-url="${escapeHtml(block.url)}">${t('news.readMore')} ▸ ${escapeHtml(block.title)}</a></blockquote>`,
          );
          break;
        }
        case 'image':
          parts.push(
            `<div class="media-slot" data-kind="image" data-src="${escapeHtml(block.src)}"><span class="placeholder">[${t('news.image')}${block.label ? `：${escapeHtml(block.label)}` : ''}]</span></div>`,
          );
          break;
        case 'embed':
          parts.push(
            `<div class="media-slot" data-kind="embed" data-src="${escapeHtml(block.src)}" data-provider="${escapeHtml(block.provider)}"><span class="placeholder">[${t('news.embed', { p: escapeHtml(block.provider) })}]</span></div>`,
          );
          break;
      }
    }

    if (d.teams.length) {
      parts.push(`<h2>${t('news.teams')} <span class="sub">(${d.teams.length})</span></h2>`);
      for (const team of d.teams) {
        parts.push(
          `<p class="matchline"><strong>${escapeHtml(team.name)}</strong>${team.rank ? ` <span class="muted">${escapeHtml(team.rank)}</span>` : ''}${team.players.length ? `: ${team.players.map(escapeHtml).join('、')}` : ''}</p>`,
        );
      }
    }

    if (d.comments.length) {
      parts.push(`<hr/><h2>${t('news.comments')} <span class="sub">(${d.comments.length})</span></h2>`);
      for (const c of d.comments) {
        parts.push(
          `<div class="comment" style="margin-left:${c.depth * 22}px">` +
            `<div class="head">${escapeHtml(c.num)} · <span class="author">${escapeHtml(c.author)}</span>${c.fan ? ` · ${escapeHtml(c.fan)}` : ''}${c.time ? ` · ${escapeHtml(formatDateTime(c.time))}` : ''}${c.plus ? ` · +${escapeHtml(c.plus)}` : ''}</div>` +
            `<div>${escapeHtml(c.text)}</div></div>`,
        );
      }
    }

    const script = `
const STR = ${JSON.stringify(webviewStrings())};
// One toggle in the top-right corner controls ALL media: load everything at
// once, or tear everything down again (iframes are destroyed, not hidden).
document.getElementById('mediaToggle').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  const turnOn = btn.dataset.on !== '1';
  btn.dataset.on = turnOn ? '1' : '0';
  btn.textContent = turnOn ? STR.hideMedia : STR.loadMedia;
  btn.classList.toggle('active', turnOn);
  document.querySelectorAll('.media-slot').forEach(slot => {
    if (turnOn) {
      slot.classList.add('filled');
      if (!slot.querySelector('img, iframe')) {
        if (slot.dataset.kind === 'image') {
          const img = document.createElement('img');
          img.src = slot.dataset.src; img.style.maxWidth = '100%';
          slot.appendChild(img);
        } else {
          const frame = document.createElement('iframe');
          frame.src = slot.dataset.src; frame.width = '100%'; frame.height = '152';
          frame.allow = 'autoplay; encrypted-media';
          slot.appendChild(frame);
        }
      }
    } else {
      slot.classList.remove('filled');
      slot.querySelectorAll('img, iframe').forEach(el => el.remove());
    }
  });
});
document.querySelectorAll('.newslink').forEach(a => a.addEventListener('click', e => {
  e.preventDefault(); acquireVsCodeApi().postMessage({ type: 'openNews', url: a.dataset.url });
}));
document.querySelectorAll('.matchlink').forEach(a => a.addEventListener('click', e => {
  e.preventDefault(); acquireVsCodeApi().postMessage({ type: 'openMatch', url: a.dataset.url });
}));
document.querySelectorAll('.extlink').forEach(a => a.addEventListener('click', e => {
  e.preventDefault(); acquireVsCodeApi().postMessage({ type: 'openLink', url: a.dataset.url });
}));`;

    this.panel.webview.html = shellHtml(`${d.title} | HLTV`, parts.join('') + `<script>${script}</script>`, this.panel.webview.cspSource);
  }
}

export type { NewsBlock };
