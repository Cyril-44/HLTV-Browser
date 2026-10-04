/**
 * Dev-only END-TO-END test of the media pipeline with REAL code on both
 * sides: the page script (built by buildNativeNewsHtml) runs in Chrome,
 * acquireVsCodeApi is bridged to the REAL host loop (media.getMediaImage via
 * the live engine), mediaReady messages flow back into the page, and images
 * must render from local file uris. Only asWebviewUri (VSCode internal) is
 * simulated, as file:// with a permissive CSP.
 */
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import * as api from '../src/hltv/api';
import * as media from '../src/hltv/media';
import { buildNativeNewsHtml } from '../src/detail/newsPage';
import { shellHtml } from '../src/detail/webviewCommon';
import { engine } from '../src/hltv/engine';
import { formatDateTime } from '../src/util/time';

const CHROME = '/home/cyril/chrome/linux-153.0.8010.47/chrome-linux64/chrome';
const DARK_VARS = `:root{--vscode-editor-background:#1e1e1e;--vscode-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;--vscode-panel-border:#3c3c3c;--vscode-list-hoverBackground:#2a2d2e;--vscode-textLink-foreground:#3794ff;--vscode-charts-green:#89d185;--vscode-errorForeground:#f48771;--vscode-editor-font-family:monospace}`;

async function main(): Promise<void> {
  (engine.constructor as unknown as { debug: boolean }).debug = true; // HltvEngine.debug
  process.env.HLTV_DEBUG = '1';
  media.setMediaDir('/tmp/hltv-media-e2e');
  const d = await api.getNewsDetail('/news/45631/falcons-sweep-aurora-to-stay-flawless-at-epl');
  const css = await api.getSiteCss(d.cssUrls);
  const metaLine = [d.author, d.date ? formatDateTime(d.date) : ''].filter(Boolean).join(' · ');
  const body = buildNativeNewsHtml(d.title, metaLine, d, css, 'night-theme', DARK_VARS);
  // cspSource 'file:' so proxied file:// images pass CSP like webview uris do
  const html = shellHtml(`${d.title} | e2e`, body, 'file:', d.url, 'night-theme');
  writeFileSync('/tmp/media-e2e.html', html);

  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1500 } });
  const logs: string[] = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text().slice(0, 120)}`));
  page.on('pageerror', (e) => logs.push(`PAGEERROR: ${e.message.slice(0, 160)}`));

  // bridge acquireVsCodeApi → real host loop (same logic as NewsDetailPage)
  await page.exposeFunction('__hostBridge', async (msg: { type: string; urls?: string[] }) => {
    if (msg.type !== 'loadMedia' || !msg.urls) {
      return;
    }
    for (const u of msg.urls) {
      const file = await media.getMediaImage(u).catch((e) => {
        console.log(`[host] getMediaImage THREW ${u.slice(-30)}: ${String(e).split('\n')[0]}`);
        return null;
      });
      if (file) {
        await page.evaluate(
          ({ url, uri }) => window.postMessage({ type: 'mediaReady', url, uri }, '*'),
          { url: u, uri: 'file://' + file },
        );
      } else {
        const why = await (engine as unknown as { ensureFetchPage: () => Promise<{ evaluate: (fn: unknown) => Promise<unknown> }> })
          .ensureFetchPage().then((p) => p.evaluate(() => (globalThis as unknown as { __hltvImgErr?: string[] }).__hltvImgErr)).catch(() => null);
        console.log(`[host] FAILED: ${u.slice(0, 80)} why=${JSON.stringify(why)}`);
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    console.log('[host] loadMedia loop finished');
  });
  await page.addInitScript(() => {
    (window as unknown as { acquireVsCodeApi: unknown }).acquireVsCodeApi = () => ({
      postMessage: (m: unknown) => (window as unknown as { __hostBridge: (m: unknown) => void }).__hostBridge(m),
    });
  });

  await page.goto('file:///tmp/media-e2e.html');
  await page.waitForTimeout(400);
  const clickInfo = await page.evaluate(() => ({
    apiAvailable: typeof (window as unknown as { acquireVsCodeApi?: unknown }).acquireVsCodeApi === 'function',
    slots: document.querySelectorAll('.media-slot[data-kind="image"]').length,
  }));
  console.log('click precheck:', JSON.stringify(clickInfo));
  await page.evaluate(() => document.getElementById('mediaToggle')!.click());
  await page.waitForTimeout(1000);
  const progressive = await page.evaluate(() => document.querySelectorAll('img').length);
  // wait for the whole loop (18 imgs × (fetch+150ms))
  await page.waitForTimeout(20000);
  const final = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img')];
    return {
      total: imgs.length,
      loaded: imgs.filter((i) => i.naturalWidth > 0).length,
      sampleSrc: imgs[0]?.src.slice(0, 60),
    };
  });
  console.log('progressive imgs after 1s:', progressive);
  console.log('FINAL:', JSON.stringify(final));
  console.log('page logs:', JSON.stringify(logs.slice(0, 8)));
  await page.screenshot({ path: '/tmp/media-e2e.png' });
  await browser.close();
  await engine.dispose();
}

void main().then(() => process.exit(0)).catch((e) => {
  console.error(String(e).split('\n')[0]);
  process.exit(1);
});
