import * as vscode from 'vscode';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { chromium, Browser, BrowserContext, Cookie, Page } from 'playwright-core';

const CHROME_UA_FALLBACK =
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
  private storagePath: string | null = null;
  private solving: Promise<boolean> | null = null;
  /** cf_clearance is bound to the UA that earned it — the engine must match. */
  private userAgent = CHROME_UA_FALLBACK;
  private clearanceCookies: Cookie[] = [];

  /** Extension global storage — keeps the manual-verification browser profile. */
  public setStoragePath(p: string): void {
    this.storagePath = p;
  }

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
      // The challenge survived the automatic ladder (typically an IP-level
      // flag): let the user clear it manually in a visible browser window,
      // then retry with the freshly granted clearance cookie.
      const solved = await this.solveChallengeManually(url);
      if (solved) {
        try {
          return await this.attemptNavigate(url);
        } catch {
          // fall through to a clean-context retry
        }
      }
      await this.resetNavPage();
      return this.attemptNavigate(url);
    }
  }

  /**
   * Opens a small headful browser window on the challenged URL so the user can
   * complete Cloudflare's interactive verification. On success the clearance
   * cookies are copied into the headless context and navigation resumes.
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
        // Remember the clearance together with the UA that earned it, then
        // rebuild the headless context so both stay consistent.
        this.clearanceCookies = await ctx.cookies().catch(() => []);
        this.userAgent = await page
          .evaluate(() => navigator.userAgent)
          .catch(() => this.userAgent);
        await this.resetNavPage();
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
          ignoreDefaultArgs: ['--enable-automation'],
          args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--no-first-run',
            '--no-default-browser-check',
            '--window-size=980,720',
          ],
          locale: 'en-US',
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

  private lastNavigation = 0;

  private async throttle(): Promise<void> {
    const gap = 1500;
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
    this.loadManualClearance();
    const browser = await this.ensureBrowser();
    const context = await browser.newContext({ userAgent: this.userAgent, locale: 'en-US', timezoneId: 'UTC' });
    if (this.clearanceCookies.length) {
      await context.addCookies(this.clearanceCookies).catch(() => undefined);
    }
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
          expires: -1, // session cookie — playwright refreshes the real expiry from the value itself
          secure: true,
          httpOnly: true,
          sameSite: 'Lax',
        },
      ];
    }
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

  private launchAttempts(): { label: string; options: Record<string, unknown> }[] {
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

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }
    const errors: string[] = [];
    for (const a of this.launchAttempts()) {
      try {
        this.browser = await chromium.launch({
          headless: true,
          ignoreDefaultArgs: ['--enable-automation'],
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
