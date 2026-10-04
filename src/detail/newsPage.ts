import * as vscode from 'vscode';
import * as api from '../hltv/api';
import { NewsDetail, NewsBlock, NewsSegment } from '../hltv/types';
import { PanelRegistry, shellHtml, escapeHtml, panelKey } from './webviewCommon';
import { openMatchDetail } from './matchPage';
import { openEventDetail } from './eventPage';
import { formatDateTime, formatMatchTime } from '../util/time';
import { t, webviewStrings } from '../i18n';

const registry = new PanelRegistry();

export function openNewsDetail(url: string): void {
  const key = panelKey('news', url) ?? `news:${url}`;
  registry.getOrCreate(key, () => {
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
    .map((seg) => {
      const inner = `${seg.italic ? '<em>' : ''}${escapeHtml(seg.text).replace(/\n/g, '<br>')}${seg.italic ? '</em>' : ''}`;
      const wrapped = seg.bold ? `<strong>${inner}</strong>` : inner;
      return seg.href ? `<a href="#" class="inlinelink" data-href="${escapeHtml(seg.href)}">${wrapped}</a>` : wrapped;
    })
    .join('');
}

function renderBlockList(blocks: NewsBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    switch (block.kind) {
      case 'text':
        parts.push(`<p>${renderSegments(block.segments)}</p>`);
        break;
      case 'quote':
        parts.push(`<blockquote>${renderSegments(block.segments)}</blockquote>`);
        break;
      case 'hr':
        parts.push('<hr/>');
        break;
      case 'teamList':
        parts.push(`<div class="teamgrid">${block.teams.map((x) => `<span>${escapeHtml(x)}</span>`).join('')}</div>`);
        break;
      default:
        break;
    }
  }
  return parts.join('');
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
      if (msg.type === 'refreshPage') {
        api.clearDetailCache(this.url);
        void this.load();
      }
      if (msg.type === 'inlineLink' && msg.url) {
        if (/^\/matches\//.test(msg.url)) {
          openMatchDetail(msg.url);
        } else if (/^\/events\//.test(msg.url)) {
          openEventDetail(msg.url);
        } else if (/^\/news\//.test(msg.url)) {
          openNewsDetail(msg.url);
        } else {
          void vscode.env.openExternal(vscode.Uri.parse(msg.url.startsWith('http') ? msg.url : 'https://www.hltv.org' + msg.url));
        }
      }
    });
  }

  public async load(): Promise<void> {
    try {
      this.panel.webview.html = shellHtml(t('web.loading'), `<h1 class="meta">${t('news.loadingPage')}</h1>`, this.panel.webview.cspSource, this.url);
      const d = await api.getNewsDetail(this.url);
      this.panel.title = d.title.slice(0, 40);
      const css = d.bodyHtml ? await api.getSiteCss(d.cssUrls).catch(() => '') : '';
      if (d.bodyHtml && css) {
        this.renderNative(d, css);
      } else {
        this.render(d); // fallback: structured blocks
      }
    } catch (e) {
      this.panel.webview.html = shellHtml(t('page.loadFailed'), `<h1>${t('page.loadFailed')}</h1><p class="meta">${escapeHtml(String(e).split('\n')[0])}</p>`, this.panel.webview.cspSource, this.url);
    }
  }

  /** Native rendering: sanitized original markup + HLTV's own stylesheet,
   *  with page chrome (backgrounds/boxes) stripped via overrides. */
  private renderNative(d: NewsDetail, hltvCss: string): void {
    const parts: string[] = [];
    parts.push(`<button id="mediaToggle" class="media-toggle" data-on="0">${t('news.loadMedia')}</button>`);
    parts.push(`<h1>${escapeHtml(d.title)}</h1>`);
    parts.push(`<p class="meta">${[d.author, d.date ? formatDateTime(d.date) : ''].filter(Boolean).map(escapeHtml).join(' · ')}</p>`);
    parts.push('<style>' + hltvCss + '</style>');
    parts.push('<style>body{background:var(--vscode-editor-background)!important;background-image:none!important}.hltv-native,.hltv-native *{background-color:transparent}.hltv-native .newsitem{margin:0;box-shadow:none}.hltv-native img{display:none}.hltv-native a{cursor:pointer}</style>');
    parts.push(`<div class="hltv-native">${d.bodyHtml}</div>`);

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
// native body links: routed like inline links
document.querySelectorAll('.natlink').forEach(a => a.addEventListener('click', e => {
  e.preventDefault();
  const href = a.getAttribute('href') || '';
  if (!href || href.startsWith('#')) return;
  vsApi().postMessage({ type: 'inlineLink', url: href });
}));
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
});`;
    this.panel.webview.html = shellHtml(`${d.title} | HLTV`, parts.join('') + `<script>${script}</script>`, this.panel.webview.cspSource, this.url);
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
          parts.push(`<p>${renderSegments(block.segments)}</p>`);
          break;
        case 'quote':
          parts.push(
            `<blockquote>${renderSegments(block.segments)}${block.author ? `<footer class="muted">— ${escapeHtml(block.author)}</footer>` : ''}</blockquote>`,
          );
          break;
        case 'hr':
          parts.push('<hr/>');
          break;
        case 'teamList':
          parts.push(`<div class="teamgrid">${block.teams.map((x) => `<span>${escapeHtml(x)}</span>`).join('')}</div>`);
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

    for (const frag of d.fragments) {
      const meta = [frag.timeAgo, frag.author].filter(Boolean).map(escapeHtml).join(' · ');
      parts.push(`<h2>${escapeHtml(frag.headline)}</h2>`);
      if (meta) {
        parts.push(`<p class="meta">${meta}</p>`);
      }
      parts.push(renderBlockList(frag.blocks));
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
document.querySelectorAll('.inlinelink').forEach(a => a.addEventListener('click', e => {
  e.preventDefault(); vsApi().postMessage({ type: 'inlineLink', url: a.dataset.href });
}));
document.querySelectorAll('.newslink').forEach(a => a.addEventListener('click', e => {
  e.preventDefault(); vsApi().postMessage({ type: 'openNews', url: a.dataset.url });
}));
document.querySelectorAll('.matchlink').forEach(a => a.addEventListener('click', e => {
  e.preventDefault(); vsApi().postMessage({ type: 'openMatch', url: a.dataset.url });
}));
document.querySelectorAll('.extlink').forEach(a => a.addEventListener('click', e => {
  e.preventDefault(); vsApi().postMessage({ type: 'openLink', url: a.dataset.url });
}));`;

    this.panel.webview.html = shellHtml(`${d.title} | HLTV`, parts.join('') + `<script>${script}</script>`, this.panel.webview.cspSource, this.url);
  }
}

export type { NewsBlock };
