import * as vscode from 'vscode';
import * as api from '../hltv/api';
import * as media from '../hltv/media';
import { NewsDetail } from '../hltv/types';
import { PanelRegistry, shellHtml, escapeHtml, panelKey } from './webviewCommon';
import { openMatchDetail } from './matchPage';
import { openEventDetail } from './eventPage';
import { formatDateTime } from '../util/time';
import { t, webviewStrings } from '../i18n';

const registry = new PanelRegistry();

export function openNewsDetail(url: string): void {
  const key = panelKey('news', url) ?? `news:${url}`;
  registry.getOrCreate(key, () => {
    const panel = vscode.window.createWebviewPanel('hltv.newsDetail', 'HLTV News', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      enableFindWidget: true,
      // the media proxy hands back local cache files; without whitelisting
      // the dir here VSCode refuses to serve them (broken-image placeholders)
      localResourceRoots: [vscode.Uri.file(media.mediaDir())],
    });
    const page = new NewsDetailPage(panel, url);
    void page.load();
    return panel;
  });
}

/**
 * Build the COMPLETE native-rendering page body for a news article: media
 * toggle, headline, HLTV's own stylesheet (with our chrome-removal overrides),
 * the sanitized original article markup, the comments appendix and the
 * interaction script. Pure on purpose: the extension webview and the offline
 * preview harness share this exact code path, so what the harness screenshots
 * is byte-identical to what users see.
 *
 * themeClass is HLTV's own day/night theme ("day-theme" / "night-theme") and
 * must ALSO be set on <html> by the shell (theme vars live on :root.<theme>).
 */
export function buildNativeNewsHtml(
  title: string,
  metaLine: string,
  d: NewsDetail,
  hltvCss: string,
  themeClass: 'day-theme' | 'night-theme',
  vscodeVars = '',
): string {
  const parts: string[] = [];
  parts.push(`<button id="mediaToggle" class="media-toggle" data-on="0">${t('news.loadMedia')}</button>`);
  parts.push(`<h1>${escapeHtml(title)}</h1>`);
  parts.push(`<p class="meta">${metaLine}</p>`);
  // absolutize CSS asset urls: the webview has no hltv.org origin, so
  // url(/img/…) / url(../fonts/…) would resolve against the webview and 404.
  const css = hltvCss
    .replace(/url\((['"]?)\/([^'")]+)\1\)/g, 'url($1https://www.hltv.org/$2$1)')
    .replace(/url\((['"]?)\.\.\/([^'")]+)\1\)/g, 'url($1https://www.hltv.org/$2$1)');
  parts.push('<style>' + css + '</style>');
  // chrome removal: force our editor background on the page shell, keep the
  // content widgets' own look. Backgrounds (cards, zebra rows, score chips)
  // stay hidden until the user opts into media via the toggle — text colors
  // are untouched.
  parts.push(
    `<style>${vscodeVars}
html,body{background:var(--vscode-editor-background)!important;background-image:none!important}
body{overflow-x:hidden}
.hltv-native .text-ellipsis,.hltv-native .newstext-con{max-width:none}
.hltv-native a{cursor:pointer}
body:not(.media-on) .hltv-native img{display:none}
/* no backgrounds at all until the user opts into media (text colors stay) */
body:not(.media-on) .hltv-native,
body:not(.media-on) .hltv-native *,
body:not(.media-on) .hltv-native *::before,
body:not(.media-on) .hltv-native *::after{background-color:transparent!important;background-image:none!important}
/* score chips are white-on-color; give them readable text once stripped */
body:not(.media-on) .hltv-native .newsitem-match-result-score{color:var(--text-color)!important}
/* match widget team cell: small crest inline before the name */
.hltv-native .newsitem-match-result-team{display:flex;align-items:center;justify-content:center;gap:8px}
.hltv-native .newsitem-match-result-team-logo-con{width:26px;height:26px;flex:0 0 26px;margin:0}
.hltv-native .newsitem-match-result-team-con{padding-top:8px;padding-bottom:8px}
/* flag watermarks: the slot span carries the original classes, img fills it */
.hltv-native .newsitem-match-result-team-flag-left img,
.hltv-native .newsitem-match-result-team-flag-right img{height:100%;width:auto;max-width:none;display:block}
/* stats-table header crest: site sizes the element (16px) via this class —
   the recreated img must fill the slot span, not render at natural size */
.hltv-native .newsitem-match-stats-logo img{height:100%;width:auto;max-width:none;display:inline-block;vertical-align:middle}
.hltv-native .videoCon{margin:1em 0}
.hltv-native .videoWrapper{height:auto!important;padding-bottom:0!important;min-height:0!important;background:none!important}
/* filled slots become inline-block: the site's sizing classes (e.g. the
   16px stats crest) were written for the <img> itself and only apply to a
   non-inline box; the recreated img fills the sized slot instead of
   rendering at natural size */
.hltv-native .media-slot.filled{display:inline-block}
.hltv-native .media-slot[data-kind="embed"].filled{display:block}
.hltv-native .media-slot.filled iframe{display:block;width:100%;aspect-ratio:16/9;height:auto;border:0}
.hltv-native .media-slot.filled img{display:inline-block;max-width:100%;height:auto;vertical-align:middle}
.hltv-native .media-slot.filled.newsitem-match-stats-logo img{height:100%;width:auto;max-width:none}</style>`,
  );
  // `newsdsl` scope is required: HLTV scopes every embedded news widget
  // (.newsitem-match-result etc.) under `.newsdsl .…`; without this ancestor
  // the widgets fall back to stacked block layout.
  parts.push(`<div class="hltv-native ${themeClass} newsdsl">${d.bodyHtml}</div>`);

  if (d.comments.length) {
    const commentRows = d.comments
      .map(
        (c) =>
          `<div class="comment" style="margin-left:${c.depth * 22}px">` +
          `<div class="head">${escapeHtml(c.num)} · <span class="author">${escapeHtml(c.author)}</span>${c.fan ? ` · ${escapeHtml(c.fan)}` : ''}${c.time ? ` · ${escapeHtml(formatDateTime(c.time))}` : ''}${c.plus ? ` · +${escapeHtml(c.plus)}` : ''}</div>` +
          `<div>${escapeHtml(c.text)}</div></div>`,
      )
      .join('');
    parts.push(`<hr/><h2>${t('news.comments')} <span class="sub">(${d.comments.length})</span></h2>${commentRows}`);
  }

  parts.push(`<script>${interactionScript()}</script>`);
  return parts.join('');
}

/** Webview-side behavior: link routing + the opt-in media toggle. */
function interactionScript(): string {
  return `
var STR = ${JSON.stringify(webviewStrings())};
// body links routed like inline links (in-editor when possible)
document.querySelectorAll('.natlink').forEach(function (a) {
  a.addEventListener('click', function (e) {
    e.preventDefault();
    var href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#') return;
    var target = href;
    if (href.charAt(0) === '/') target = 'https://www.hltv.org' + href;
    var msg = /^https:\\/\\/www\\.hltv\\.org\\/matches\\//.test(target) ? { type: 'openMatch', url: href }
      : /^https:\\/\\/www\\.hltv\\.org\\/events\\//.test(target) ? { type: 'openEvent', url: href }
      : /^https:\\/\\/www\\.hltv\\.org\\/news\\//.test(target) ? { type: 'openNews', url: href }
      : { type: 'inlineLink', url: target };
    var api = (typeof vsApi === 'function') ? vsApi() : null;
    if (api) api.postMessage(msg);
  });
});
document.getElementById('mediaToggle').addEventListener('click', function (e) {
  var btn = e.currentTarget;
  var turnOn = btn.dataset.on !== '1';
  btn.dataset.on = turnOn ? '1' : '0';
  btn.textContent = turnOn ? STR.hideMedia : STR.loadMedia;
  btn.classList.toggle('active', turnOn);
  document.body.classList.toggle('media-on', turnOn);
  if (turnOn) {
    var api = (typeof vsApi === 'function') ? vsApi() : null;
    var imageUrls = [];
    document.querySelectorAll('.media-slot[data-kind="image"]').forEach(function (slot) {
      slot.classList.add('filled');
      imageUrls.push(slot.dataset.src);
    });
    document.querySelectorAll('.media-slot[data-kind="embed"]').forEach(function (slot) {
      slot.classList.add('filled');
      if (!slot.querySelector('iframe')) {
        var frame = document.createElement('iframe');
        frame.src = slot.dataset.src; frame.width = '100%';
        frame.allow = 'autoplay; encrypted-media';
        slot.appendChild(frame);
      }
    });
    // hltv images are CF-challenged when loaded by the webview directly: the
    // host proxies them through the parked engine page and answers with
    // mediaReady messages carrying local webview uris.
    if (api) {
      mediaProgress = { total: new Set(imageUrls).size, loaded: 0, failed: 0 };
      updateMediaLabel();
      api.postMessage({ type: 'loadMedia', urls: imageUrls });
    } else {
      imageUrls.forEach(function (u) {
        fillImage(u, u);
      });
    }
  } else {
    mediaProgress = null;
    document.querySelectorAll('.media-slot').forEach(function (slot) {
      slot.classList.remove('filled');
      slot.querySelectorAll('img, iframe').forEach(function (el) { el.remove(); });
    });
  }
});
var mediaProgress = null;
function updateMediaLabel() {
  var btn = document.getElementById('mediaToggle');
  if (!btn || !mediaProgress) return;
  btn.textContent = STR.hideMedia + ' ' + mediaProgress.loaded + '/' + mediaProgress.total +
    (mediaProgress.failed ? ' · ' + mediaProgress.failed + '\\u2717' : '');
}
function fillImage(url, src) {
  document.querySelectorAll('.media-slot[data-kind="image"]').forEach(function (slot) {
    if (slot.dataset.src === url && !slot.querySelector('img')) {
      var img = document.createElement('img');
      img.src = src;
      img.onerror = function () {
        // surface load failures (CSP / localResourceRoots issues show here)
        var api = (typeof vsApi === 'function') ? vsApi() : null;
        if (api) api.postMessage({ type: 'imgError', url: url, src: String(src).slice(0, 140) });
        if (mediaProgress) { mediaProgress.failed++; updateMediaLabel(); }
      };
      slot.appendChild(img);
    }
  });
}
window.addEventListener('message', function (ev) {
  var m = ev.data || {};
  if (m.type === 'mediaReady' && m.url && m.uri && document.body.classList.contains('media-on')) {
    fillImage(m.url, m.uri);
    if (mediaProgress) { mediaProgress.loaded++; updateMediaLabel(); }
  }
  if (m.type === 'mediaDone' && mediaProgress) {
    mediaProgress.failed = m.fail || 0;
    updateMediaLabel();
    setTimeout(function () {
      mediaProgress = null;
      var btn = document.getElementById('mediaToggle');
      if (btn && btn.dataset.on === '1') btn.textContent = STR.hideMedia;
    }, 4000);
  }
});`;
}

class NewsDetailPage {
  constructor(private panel: vscode.WebviewPanel, private url: string) {
    panel.webview.onDidReceiveMessage((msg: { type: string; url?: string; urls?: string[]; src?: string }) => {
      if (msg.type === 'openLink' && msg.url) {
        void vscode.env.openExternal(vscode.Uri.parse(msg.url.startsWith('http') ? msg.url : 'https://www.hltv.org' + msg.url));
      }
      if (msg.type === 'openMatch' && msg.url) {
        openMatchDetail(msg.url);
      }
      if (msg.type === 'openEvent' && msg.url) {
        openEventDetail(msg.url);
      }
      if (msg.type === 'openNews' && msg.url) {
        openNewsDetail(msg.url);
      }
      if (msg.type === 'refreshPage') {
        api.clearDetailCache(this.url);
        void this.load();
      }
      if (msg.type === 'loadMedia' && msg.urls) {
        // webviews get CF-challenged on hltv images: proxy each through the
        // parked engine page, sequentially (no concurrent fetches), replying
        // per image so slots fill progressively.
        void (async () => {
          const urls = [...new Set(msg.urls!)];
          let ok = 0;
          let fail = 0;
          for (const u of urls) {
            const file = await media.getMediaImage(u).catch(() => null);
            if (file) {
              ok++;
              void this.panel.webview.postMessage({
                type: 'mediaReady',
                url: u,
                uri: this.panel.webview.asWebviewUri(vscode.Uri.file(file)).toString(),
              });
            } else {
              fail++;
            }
            await new Promise((r) => setTimeout(r, 150));
          }
          void this.panel.webview.postMessage({ type: 'mediaDone', ok, fail });
        })();
      }
      if (msg.type === 'imgError' && msg.url) {
        // webview refused to render a proxied image — almost always CSP or a
        // localResourceRoots miss; log where the user can find it
        console.log(`[hltv] image failed to render: ${msg.url.slice(0, 80)} → ${msg.src ?? ''}`);
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
      // pure passthrough: without the body markup or the site stylesheet there
      // is nothing to render — surface the failure instead of degrading into
      // a text-only approximation.
      const css = d.bodyHtml ? await api.getSiteCss(d.cssUrls).catch(() => '') : '';
      if (!d.bodyHtml || !css) {
        this.panel.webview.html = shellHtml(
          t('page.loadFailed'),
          `<h1>${t('page.loadFailed')}</h1><p class="meta">${escapeHtml(t('news.nativeUnavailable'))}</p>`,
          this.panel.webview.cspSource,
          this.url,
        );
        return;
      }
      const themeClass: 'day-theme' | 'night-theme' =
        vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light ||
        vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrastLight
          ? 'day-theme'
          : 'night-theme';
      const metaLine = [d.author, d.date ? formatDateTime(d.date) : ''].filter(Boolean).map(escapeHtml).join(' · ');
      this.panel.webview.html = shellHtml(
        `${d.title} | HLTV`,
        buildNativeNewsHtml(d.title, metaLine, d, css, themeClass),
        this.panel.webview.cspSource,
        this.url,
        themeClass, // HLTV theme vars live on :root.<theme> — must be on <html>
      );
    } catch (e) {
      this.panel.webview.html = shellHtml(t('page.loadFailed'), `<h1>${t('page.loadFailed')}</h1><p class="meta">${escapeHtml(String(e).split('\n')[0])}</p>`, this.panel.webview.cspSource, this.url);
    }
  }
}
