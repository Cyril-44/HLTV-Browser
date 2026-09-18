import * as vscode from 'vscode';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { chromium, Browser, BrowserContext, Cookie, Page } from 'playwright-core';

/**
 * Browser-backed fetch engine mirroring the request model of the original
 * extension (master), which never tripped Cloudflare:
 *
 *  - one navigation at a time, each in a FRESH browser instance that is closed
 *    afterwards (inherently serial, naturally paced, no state pollution)
 *  - human-like context: real UA (headless token sanitized), real local
 *    timezone, 1440x1200 viewport, document-like HTTP headers
 *  - NO request interception of any kind — blocking subresources breaks the
 *    Cloudflare challenge's own probes
 *  - pages are cached by the api layer and fetched at most once per session;
 *    this engine is only hit on first load or manual refresh
 */
const MASTER_LAUNCH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-dev-shm-usage',
  '--disable-features=IsolateOrigins,site-per-process',
];

const MASTER_HEADERS = {
  'Accept-Language': 'en-US,en;q=0.9',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'no-cache',
};

// UA confirmed working against HLTV from this environment (Chrome for
// Testing 153 on WSL, provided by the user); only used if probing fails.
const UA_FALLBACK =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

class HltvEngine {
  private chain: Promise<unknown> = Promise.resolve();
  private launchErrorShown = false;
  private storagePath: string | null = null;
  private solving: Promise<boolean> | null = null;
  /** cf_clearance is bound to the UA that earned it — the engine must match. */
  private userAgent: string | null = null;
  private clearanceCookies: Cookie[] = [];
  private fetchBrowser: Browser | null = null;
  private fetchPage: Page | null = null;
  private lastNavigation = 0;

  /** Extension global storage — keeps the manual-verification browser profile. */
  public setStoragePath(p: string): void {
    this.storagePath = p;
  }

  /**
   * Optional proxy (e.g. "http://127.0.0.1:7890"). Cloudflare's challenge
   * backend must be reachable through the same network path the user's normal
   * browser uses, or verification loops forever. Precedence: setting > env.
   */
  private proxyOption(): { server: string } | undefined {
    const configured = vscode.workspace.getConfiguration('hltv').get<string>('proxyServer', '').trim();
    if (configured) {
      return { server: configured };
    }
    const env = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
    return env ? { server: env } : undefined;
  }

  public async getHtml(url: string): Promise<string> {
    return this.serialize(() => this.navigate(url));
  }

  /**
   * Fetch a URL from an about:blank page context (scorebot serves permissive
   * CORS). Lives on a small persistent browser separate from page navigation.
   */
  public async contextFetch(url: string, init?: { method?: string; body?: string }): Promise<{ status: number; body: string }> {
    const page = await this.ensureFetchPage();
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
    await this.fetchBrowser?.close().catch(() => undefined);
    this.fetchBrowser = null;
    this.fetchPage = null;
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async navigate(url: string): Promise<string> {
    await this.throttle();
    // Two fresh-browser attempts, then let the user clear an interactive
    // challenge, then a final attempt with the fresh clearance.
    for (let i = 0; i < 2; i++) {
      try {
        return await this.freshNavigate(url);
      } catch {
        // fall through to the next fresh attempt
      }
    }
    const solved = await this.solveChallengeManually(url);
    if (solved) {
      return this.freshNavigate(url);
    }
    throw new Error(`Cloudflare challenge did not clear for ${url}`);
  }

  /** Politeness gap with jitter — never let requests look bursty. */
  private async throttle(): Promise<void> {
    const gap = 1500 + Math.floor(Math.random() * 1500);
    const wait = this.lastNavigation + gap - Date.now();
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    this.lastNavigation = Date.now();
  }

  private async freshNavigate(url: string): Promise<string> {
    const browser = await this.ensureLaunch();
    try {
      if (!this.userAgent) {
        await this.probeUserAgent(browser);
      }
      const context = await browser.newContext({
        userAgent: this.userAgent ?? UA_FALLBACK,
        viewport: { width: 1440, height: 1200 },
        locale: 'en-US',
        timezoneId: this.localTimezone(),
        ignoreHTTPSErrors: true,
      });
      if (this.clearanceCookies.length) {
        await context.addCookies(this.clearanceCookies).catch(() => undefined);
      }
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });
      const page = await context.newPage();
      await page.setExtraHTTPHeaders(MASTER_HEADERS);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      for (let i = 0; i < 10; i++) {
        const html = await page.content();
        if (!html.includes('Just a moment...')) {
          await page.waitForTimeout(500).catch(() => undefined);
          return await page.content();
        }
        await page.waitForTimeout(2000).catch(() => undefined);
      }
      throw new Error(`Cloudflare challenge did not clear for ${url}`);
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  /** Read the binary's genuine UA once; sanitize the headless token. */
  private async probeUserAgent(browser: Browser): Promise<void> {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1200 },
      locale: 'en-US',
      timezoneId: this.localTimezone(),
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();
    try {
      const ua = await page
        .evaluate(() => navigator.userAgent)
        .catch(() => UA_FALLBACK);
      this.userAgent = ua.replace(/HeadlessChrome/i, 'Chrome');
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  private localTimezone(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
    } catch {
      return 'Asia/Shanghai';
    }
  }

  private async ensureFetchPage(): Promise<Page> {
    if (this.fetchPage && !this.fetchPage.isClosed()) {
      return this.fetchPage;
    }
    // A single long-lived browser just for scorebot fetches; navigation uses
    // throwaway browsers, so this one needs its own launch loop.
    if (!this.fetchBrowser || !this.fetchBrowser.isConnected()) {
      const errors: string[] = [];
      let launched = false;
      for (const a of this.launchAttempts()) {
        try {
          this.fetchBrowser = await chromium.launch({ headless: true, args: MASTER_LAUNCH_ARGS, proxy: this.proxyOption(), ...a.options });
          launched = true;
          break;
        } catch (e) {
          errors.push(`${a.label}: ${String(e).split('\n')[0]}`);
        }
      }
      if (!launched) {
        throw new Error(`no browser available for scorebot\n${errors.join('\n')}`);
      }
    }
    const context = await this.fetchBrowser!.newContext({ locale: 'en-US' });
    // Stays on about:blank: scorebot allows any origin, so page-context fetch
    // needs no HLTV origin and cannot get stuck on an interstitial.
    this.fetchPage = await context.newPage();
    return this.fetchPage;
  }

  /**
   * Escape hatch: a cf_clearance token + matching UA pasted by the user from a
   * trusted browser on the same public IP (settings hltv.cfClearance/hltv.userAgent).
   */
  private loadManualClearance(): void {
    const cfg = vscode.workspace.getConfiguration('hltv');
    const token = cfg.get<string>('cfClearance', '').trim();
    const ua = cfg.get<string>('userAgent', '').trim();
    if (ua) {
      this.userAgent = ua;
    }
    if (token) {
      this.clearanceCookies = [
        {
          name: 'cf_clearance',
          value: token,
          domain: '.hltv.org',
          path: '/',
          expires: -1,
          secure: true,
          httpOnly: true,
          sameSite: 'Lax',
        },
      ];
    }
  }

  /**
   * Opens a small headful browser window on the challenged URL so the user can
   * complete Cloudflare's interactive verification. On success the clearance
   * cookies are remembered (with the UA that earned them) for later contexts.
   * Single-flight: concurrent blocked navigations share one popup.
   */
  private async solveChallengeManually(url: string): Promise<boolean> {
    if (this.solving) {
      return this.solving;
    }
    this.solving = this.doSolveChallenge(url).finally(() => {
      this.solving = null;
    });
    return this.solving;
  }

  private async doSolveChallenge(url: string): Promise<boolean> {
    const profileDir = path.join(
      this.storagePath ?? path.join(os.tmpdir(), 'hltv-vscode'),
      'cf-profile',
    );
    fs.mkdirSync(profileDir, { recursive: true });

    void vscode.window.showInformationMessage(
      'HLTV 被Cloudflare拦截：即将弹出浏览器窗口，请完成人机验证（验证通过后窗口会自动关闭并继续加载）。',
    );

    let ctx: BrowserContext;
    try {
      ctx = await this.launchPersistentForVerification(profileDir);
    } catch (e) {
      void vscode.window.showErrorMessage(
        `无法打开 Cloudflare 验证窗口（当前环境可能没有图形界面）：${String(e).split('\n')[0]}`,
      );
      return false;
    }

    let cleared = false;
    try {
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => undefined);
      cleared = await this.waitForClearance(page, 300_000);
      if (cleared) {
        this.clearanceCookies = await ctx.cookies().catch(() => []);
        this.userAgent = await page
          .evaluate(() => navigator.userAgent)
          .catch(() => this.userAgent);
      }
    } finally {
      await ctx.close().catch(() => undefined);
    }
    if (!cleared) {
      void vscode.window.showWarningMessage('Cloudflare 验证未完成（窗口被关闭或超时），稍后将再次尝试。');
    }
    return cleared;
  }

  private async launchPersistentForVerification(profileDir: string): Promise<BrowserContext> {
    let lastError: unknown = null;
    for (const a of this.launchAttempts()) {
      try {
        // A clean, human-like browser: no automation flag, no UA override (the
        // real binary version must match its own UA), normal window size.
        const ctx = await chromium.launchPersistentContext(profileDir, {
          headless: false,
          args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--no-first-run',
            '--no-default-browser-check',
            '--window-size=980,720',
          ],
          locale: 'en-US',
          timezoneId: this.localTimezone(),
          proxy: this.proxyOption(),
          ...a.options,
        });
        await ctx.addInitScript(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });
        return ctx;
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError ?? new Error('no browser available for verification window');
  }

  private async waitForClearance(page: Page, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    let closed = false;
    page.context().once('close', () => {
      closed = true;
    });
    while (Date.now() < deadline && !closed) {
      try {
        const html = await page.content();
        if (!html.includes('Just a moment...')) {
          await page.waitForTimeout(800).catch(() => undefined);
          return true;
        }
      } catch {
        // page navigating between challenge and target — keep waiting
      }
      await page.waitForTimeout(1000).catch(() => undefined);
    }
    return false;
  }

  private launchAttempts(): { label: string; options: Record<string, unknown> }[] {
    this.loadManualClearance();
    const custom = vscode.workspace.getConfiguration('hltv').get<string>('browserPath', '');
    const attempts: { label: string; options: Record<string, unknown> }[] = [];
    if (custom) {
      attempts.push({ label: `configured browser (${custom})`, options: { executablePath: custom } });
    }
    attempts.push(
      { label: 'Microsoft Edge', options: { channel: 'msedge' } },
      { label: 'Google Chrome', options: { channel: 'chrome' } },
    );
    const puppeteerChrome = this.detectChromeForTesting();
    if (puppeteerChrome) {
      attempts.push({ label: `Chrome for Testing (${puppeteerChrome})`, options: { executablePath: puppeteerChrome } });
    }
    attempts.push({ label: 'Chromium (Playwright-managed)', options: {} });
    return attempts;
  }

  /**
   * Find a Chrome for Testing binary installed via `npx @puppeteer/browsers
   * install chrome@…` — standard cache (~/.cache/puppeteer) or the npx default
   * cwd layout (~/chrome/linux-<ver>/chrome-linux64/chrome). Newest wins.
   */
  private detectChromeForTesting(): string | null {
    if (this.detectedChromeForTesting !== undefined) {
      return this.detectedChromeForTesting;
    }
    const home = os.homedir();
    const roots = [path.join(home, '.cache', 'puppeteer'), path.join(home, 'chrome')];
    const found: { version: number[]; file: string }[] = [];
    for (const root of roots) {
      const level1 = this.safeReaddir(root).map((e) => path.join(root, e));
      for (const dir of [root, ...level1]) {
        for (const sub of this.safeReaddir(dir)) {
          if (!/^chrome-linux/.test(sub)) {
            continue;
          }
          const file = path.join(dir, sub, 'chrome');
          if (fs.existsSync(file)) {
            const m = /(\d+)\.(\d+)\.(\d+)\.(\d+)/.exec(file);
            found.push({
              version: m ? [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] : [0, 0, 0, 0],
              file,
            });
          }
        }
      }
    }
    found.sort((a, b) => {
      for (let i = 0; i < 4; i++) {
        if (a.version[i] !== b.version[i]) {
          return b.version[i] - a.version[i];
        }
      }
      return 0;
    });
    this.detectedChromeForTesting = found[0]?.file ?? null;
    return this.detectedChromeForTesting;
  }

  private detectedChromeForTesting: string | null | undefined = undefined;

  private safeReaddir(dir: string): string[] {
    try {
      return fs.readdirSync(dir);
    } catch {
      return [];
    }
  }

  private async ensureLaunch(): Promise<Browser> {
    const errors: string[] = [];
    for (const a of this.launchAttempts()) {
      try {
        return await chromium.launch({ headless: true, args: MASTER_LAUNCH_ARGS, proxy: this.proxyOption(), ...a.options });
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
