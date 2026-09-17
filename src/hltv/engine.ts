import * as vscode from 'vscode';
import { chromium, Browser, Page } from 'playwright-core';

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font']);

/**
 * Browser-backed fetch engine. HLTV sits behind Cloudflare bot management which
 * fingerprints TLS, so plain Node HTTP is rejected; a real Chromium (user's
 * Edge/Chrome, or a Playwright-managed Chromium) is the leanest engine that passes.
 */
class HltvEngine {
  private browser: Browser | null = null;
  private navPage: Page | null = null;
  private apiPage: Page | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private launchErrorShown = false;

  public async getHtml(url: string): Promise<string> {
    return this.serialize(() => this.navigate(url));
  }

  /**
   * Fetch a URL from inside a page whose origin is www.hltv.org, so the request
   * carries browser TLS + Cloudflare clearance cookies (needed by scorebot).
   */
  public async contextFetch(url: string, init?: { method?: string; body?: string }): Promise<{ status: number; body: string }> {
    const page = await this.ensureApiPage();
    return page.evaluate(
      async ({ url, init }) => {
        const r = await fetch(url, {
          method: init?.method ?? 'GET',
          body: init?.body,
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        });
        return { status: r.status, body: await r.text() };
      },
      { url, init },
    );
  }

  public async dispose(): Promise<void> {
    await this.browser?.close().catch(() => undefined);
    this.browser = null;
    this.navPage = null;
    this.apiPage = null;
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async navigate(url: string): Promise<string> {
    // Cloudflare bot scoring dislikes bursts — keep a polite gap between hits.
    await this.throttle();
    try {
      return await this.attemptNavigate(url);
    } catch {
      // Last resort: a poisoned page/context sometimes needs a clean slate.
      await this.resetNavPage();
      return this.attemptNavigate(url);
    }
  }

  private lastNavigation = 0;

  private async throttle(): Promise<void> {
    const gap = 600;
    const wait = this.lastNavigation + gap - Date.now();
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    this.lastNavigation = Date.now();
  }

  private async attemptNavigate(url: string): Promise<string> {
    const page = await this.ensureNavPage();
    // Retry ladder: reload in-place (keeps Cloudflare clearance cookies) with
    // growing pauses; only escalate to a fresh context from navigate().
    for (let round = 0; round < 3; round++) {
      if (round === 0) {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      } else {
        await page.waitForTimeout(2000 * round).catch(() => undefined);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => undefined);
      }
      for (let i = 0; i < 12; i++) {
        const html = await page.content();
        if (!html.includes('Just a moment...')) {
          await page.waitForTimeout(400).catch(() => undefined);
          return await page.content();
        }
        await page.waitForTimeout(2500).catch(() => undefined);
      }
    }
    throw new Error(`Cloudflare challenge did not clear for ${url}`);
  }

  private async resetNavPage(): Promise<void> {
    const page = this.navPage;
    this.navPage = null;
    this.apiPage = null;
    await page?.context().close().catch(() => undefined);
  }

  private async ensureNavPage(): Promise<Page> {
    if (this.navPage && !this.navPage.isClosed()) {
      return this.navPage;
    }
    const browser = await this.ensureBrowser();
    const context = await browser.newContext({ userAgent: CHROME_UA, locale: 'en-US', timezoneId: 'UTC' });
    // Cloudflare reads navigator.webdriver and the automation blink flag;
    // neutralize both so headless looks like an ordinary Chrome session.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    const page = await context.newPage();
    await this.installResourceBlocking(page);
    this.navPage = page;
    return page;
  }

  private async ensureApiPage(): Promise<Page> {
    if (this.apiPage && !this.apiPage.isClosed()) {
      return this.apiPage;
    }
    const page = await this.ensureNavPage();
    const context = page.context();
    const api = await context.newPage();
    await this.installResourceBlocking(api);
    // The page stays on about:blank: scorebot serves permissive CORS headers,
    // so page-context fetch needs no HLTV origin and cannot get stuck on a
    // Cloudflare interstitial.
    this.apiPage = api;
    return api;
  }

  private async installResourceBlocking(page: Page): Promise<void> {
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (BLOCKED_RESOURCE_TYPES.has(type)) {
        return route.abort();
      }
      const u = route.request().url();
      if (/cookielaw|onetrust|googletagmanager|google-analytics|outbrain|clean\.gg|plausible|doubleclick/.test(u)) {
        return route.abort();
      }
      return route.continue();
    });
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }
    const custom = vscode.workspace.getConfiguration('hltv').get<string>('browserPath', '');
    const attempts: { label: string; options: Record<string, unknown> }[] = [];
    if (custom) {
      attempts.push({ label: `configured browser (${custom})`, options: { executablePath: custom } });
    }
    attempts.push(
      { label: 'Microsoft Edge', options: { channel: 'msedge' } },
      { label: 'Google Chrome', options: { channel: 'chrome' } },
      { label: 'Chromium (Playwright-managed)', options: {} },
    );
    const errors: string[] = [];
    for (const a of attempts) {
      try {
        this.browser = await chromium.launch({
          headless: true,
          args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
          ...a.options,
        });
        return this.browser;
      } catch (e) {
        errors.push(`${a.label}: ${String(e).split('\n')[0]}`);
      }
    }
    const message = 'HLTV Browser cannot find a usable browser. Install Microsoft Edge or Google Chrome, or set "hltv.browserPath".';
    if (!this.launchErrorShown) {
      this.launchErrorShown = true;
      void vscode.window.showErrorMessage(message, 'Settings').then((choice) => {
        if (choice === 'Settings') {
          void vscode.commands.executeCommand('workbench.action.openSettings', 'hltv.browserPath');
        }
      });
    }
    throw new Error(`${message}\n${errors.join('\n')}`);
  }
}

export const engine = new HltvEngine();
