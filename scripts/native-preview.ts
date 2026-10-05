/**
 * Dev-only: render the REAL native news page HTML to files for screenshot
 * inspection (dark + light VSCode variable sets), sharing the exact builder
 * the extension uses.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as api from '../src/hltv/api';
import { buildNativeNewsHtml } from '../src/detail/newsPage';
import { shellHtml } from '../src/detail/webviewCommon';
import { engine } from '../src/hltv/engine';
import { formatDateTime } from '../src/util/time';

const DARK_VARS = `:root{--vscode-editor-background:#1e1e1e;--vscode-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;--vscode-panel-border:#3c3c3c;--vscode-list-hoverBackground:#2a2d2e;--vscode-textLink-foreground:#3794ff;--vscode-charts-green:#89d185;--vscode-errorForeground:#f48771;--vscode-editor-font-family:monospace}`;
const LIGHT_VARS = `:root{--vscode-editor-background:#ffffff;--vscode-foreground:#3b3b3b;--vscode-descriptionForeground:#717171;--vscode-panel-border:#cecece;--vscode-list-hoverBackground:#e8e8e8;--vscode-textLink-foreground:#006ab1;--vscode-charts-green:#388a34;--vscode-errorForeground:#e51400;--vscode-editor-font-family:monospace}`;
const CSS_CACHE = '/tmp/hltv-site.css';

async function main(): Promise<void> {
  const argIdx = process.argv.findIndex((a) => a.startsWith('/news/'));
  const url = argIdx >= 0 ? process.argv[argIdx] : '/news/45631/falcons-sweep-aurora-to-stay-flawless-at-epl';
  let d: Awaited<ReturnType<typeof api.getNewsDetail>>;
  try {
    d = await api.getNewsDetail(url);
    if (!d.bodyHtml) {
      throw new Error('empty bodyHtml (challenged?)');
    }
  } catch (e) {
    // engine CF-challenged: fall back to the passing persistent profile
    const { chromium } = await import('playwright-core');
    const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.8010.47 Safari/537.36';
    const ctx = await chromium.launchPersistentContext('/tmp/cf-solve-profile', {
      headless: true,
      executablePath: '/home/cyril/chrome/linux-153.0.8010.47/chrome-linux64/chrome',
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
      userAgent: UA,
      viewport: { width: 1440, height: 1200 },
    });
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    console.log(`engine path failed (${String(e).split('\n')[0]}); fetching via cf profile…`);
    await page.goto('https://www.hltv.org' + url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    const html = await page.content();
    const cssLinks = await page.evaluate(() => [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute('href') ?? ''));
    await ctx.close();
    const { parseNewsArticle } = await import('../src/hltv/parse/news');
    d = parseNewsArticle(html, url);
    (d as { cssUrls: string[] }).cssUrls = cssLinks;
  }
  console.log(`article: ${d.title} | bodyHtml=${d.bodyHtml.length}B | cssUrls=${d.cssUrls.length}`);
  // disk cache the 2.6MB stylesheet so render iterations don't re-hit HLTV
  let css: string;
  if (existsSync(CSS_CACHE) && readFileSync(CSS_CACHE, 'utf-8').length > 100000) {
    css = readFileSync(CSS_CACHE, 'utf-8');
    console.log(`css: ${css.length}B (disk cache)`);
  } else {
    css = await api.getSiteCss(d.cssUrls).catch(() => '');
    if (css.length < 100000) {
      // engine challenged — pull the stylesheet through the passing profile
      const { chromium } = await import('playwright-core');
      const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.8010.47 Safari/537.36';
      const ctx = await chromium.launchPersistentContext('/tmp/cf-solve-profile', {
        headless: true,
        executablePath: '/home/cyril/chrome/linux-153.0.8010.47/chrome-linux64/chrome',
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
        userAgent: UA,
        viewport: { width: 1440, height: 1200 },
      });
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      const href = d.cssUrls.find((u) => u.includes('everything') || u.includes('all')) ?? d.cssUrls[0];
      await page.goto(href.startsWith('http') ? href : 'https://www.hltv.org' + href, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => undefined);
      css = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
      await ctx.close();
    }
    writeFileSync(CSS_CACHE, css);
    console.log(`css: ${css.length}B (fetched, cached)`);
  }
  const metaLine = [d.author, d.date ? formatDateTime(d.date) : ''].filter(Boolean).join(' · ');

  for (const [name, themeClass, vars] of [
    ['dark', 'night-theme', DARK_VARS],
    ['light', 'day-theme', LIGHT_VARS],
  ] as const) {
    const body = buildNativeNewsHtml(d.title, metaLine, d, css, themeClass, vars);
    const html = shellHtml(`${d.title} | preview`, body + '<script>function vsApi(){return null}</script>', 'https://preview.invalid', url, themeClass);
    writeFileSync(`/tmp/preview-${name}.html`, html);
    console.log(`wrote /tmp/preview-${name}.html (${html.length}B)`);
  }
  await engine.dispose();
}

void main().then(() => process.exit(0)).catch((e) => {
  console.error(String(e).split('\n')[0]);
  process.exit(1);
});
