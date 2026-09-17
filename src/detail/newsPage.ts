import * as vscode from 'vscode';
import * as api from '../hltv/api';
import { NewsDetail, NewsBlock } from '../hltv/types';
import { PanelRegistry, shellHtml, escapeHtml } from './webviewCommon';
import { formatDateTime } from '../util/time';

const registry = new PanelRegistry();

export function openNewsDetail(url: string): void {
  registry.getOrCreate(`news:${url}`, () => {
    const panel = vscode.window.createWebviewPanel('hltv.newsDetail', 'HLTV News', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    const page = new NewsDetailPage(panel, url);
    void page.load();
    return panel;
  });
}

class NewsDetailPage {
  constructor(private panel: vscode.WebviewPanel, private url: string) {
    panel.webview.onDidReceiveMessage((msg: { type: string; url?: string }) => {
      if (msg.type === 'openLink' && msg.url) {
        void vscode.env.openExternal(vscode.Uri.parse(msg.url.startsWith('http') ? msg.url : 'https://www.hltv.org' + msg.url));
      }
    });
  }

  public async load(): Promise<void> {
    try {
      this.panel.webview.html = shellHtml('加载中…', '<h1 class="meta">正在加载新闻页面…</h1>', this.panel.webview.cspSource);
      const d = await api.getNewsDetail(this.url);
      this.panel.title = d.title.slice(0, 40);
      this.render(d);
    } catch (e) {
      this.panel.webview.html = shellHtml('加载失败', `<h1>加载失败</h1><p class="meta">${escapeHtml(String(e).split('\n')[0])}</p>`, this.panel.webview.cspSource);
    }
  }

  private render(d: NewsDetail): void {
    const parts: string[] = [];
    parts.push(`<h1>${escapeHtml(d.title)}</h1>`);
    parts.push(
      `<p class="meta">${[d.author, d.date ? formatDateTime(d.date) : ''].filter(Boolean).map(escapeHtml).join(' · ')}</p>`,
    );
    if (d.intro) {
      parts.push(`<blockquote>${escapeHtml(d.intro)}</blockquote>`);
    }

    for (const [i, block] of d.blocks.entries()) {
      switch (block.kind) {
        case 'text':
          parts.push(`<p>${escapeHtml(block.text)}${block.link ? ` <a href="#" class="extlink" data-url="${escapeHtml(block.link)}">[链接]</a>` : ''}</p>`);
          break;
        case 'quote':
          parts.push(`<blockquote>${escapeHtml(block.text)}</blockquote>`);
          break;
        case 'image':
          parts.push(
            `<div><span class="placeholder media" data-kind="image" data-src="${escapeHtml(block.src)}" data-index="${i}">[图片${block.label ? `: ${escapeHtml(block.label)}` : ''}] 点击加载</span><span class="loaded" data-index="${i}"></span></div>`,
          );
          break;
        case 'embed':
          parts.push(
            `<div><span class="placeholder media" data-kind="embed" data-src="${escapeHtml(block.src)}" data-index="${i}" data-provider="${escapeHtml(block.provider)}">[嵌入: ${escapeHtml(block.provider)}] 点击加载</span><span class="loaded" data-index="${i}"></span></div>`,
          );
          break;
      }
    }

    if (d.comments.length) {
      parts.push(`<hr/><h2>评论 <span class="sub">(${d.comments.length})</span></h2>`);
      for (const c of d.comments) {
        parts.push(
          `<div class="comment" style="margin-left:${c.depth * 22}px">` +
            `<div class="head">${escapeHtml(c.num)} · <span class="author">${escapeHtml(c.author)}</span>${c.fan ? ` · ${escapeHtml(c.fan)}` : ''}${c.time ? ` · ${escapeHtml(formatDateTime(c.time))}` : ''}${c.plus ? ` · +${escapeHtml(c.plus)}` : ''}</div>` +
            `<div>${escapeHtml(c.text)}</div></div>`,
        );
      }
    }

    const script = `
document.querySelectorAll('.media').forEach(el => el.addEventListener('click', () => {
  const target = document.querySelector('.loaded[data-index="' + el.dataset.index + '"]');
  const loaded = target.dataset.on === '1';
  if (!loaded) {
    if (el.dataset.kind === 'image') {
      const img = document.createElement('img');
      img.src = el.dataset.src; img.style.maxWidth = '100%';
      target.appendChild(img);
    } else {
      const frame = document.createElement('iframe');
      frame.src = el.dataset.src; frame.width = '100%'; frame.height = '152';
      frame.allow = 'autoplay; encrypted-media';
      target.appendChild(frame);
    }
    target.dataset.on = '1';
    el.textContent = el.dataset.kind === 'image' ? '[图片已加载] 点击关闭' : '[嵌入: ' + el.dataset.provider + '] 点击关闭';
  } else {
    target.innerHTML = '';
    target.dataset.on = '0';
    el.textContent = el.dataset.kind === 'image' ? '[图片] 点击加载' : '[嵌入: ' + el.dataset.provider + '] 点击加载';
  }
}));
document.querySelectorAll('.extlink').forEach(a => a.addEventListener('click', e => {
  e.preventDefault(); acquireVsCodeApi().postMessage({ type: 'openLink', url: a.dataset.url });
}));`;

    this.panel.webview.html = shellHtml(`${d.title} | HLTV`, parts.join('') + `<script>${script}</script>`, this.panel.webview.cspSource);
  }
}

export type { NewsBlock };
