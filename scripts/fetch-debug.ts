/**
 * Dev-only: dump what the parked fetch page actually sees for an image url
 * (status, content-type, first bytes) under both credential modes, plus the
 * parked page state itself.
 */
import { engine } from '../src/hltv/engine';

async function main(): Promise<void> {
  const url = 'https://www.hltv.org/img/static/flags/30x20/EU.gif';
  // reach the parked page the same way fetchImageBase64 does
  const page = await (engine as unknown as { ensureFetchPage: () => Promise<import('playwright-core').Page> }).ensureFetchPage();
  console.log('parked page url:', page.url());
  const info = await page.evaluate(async (u: string) => {
    const out: Record<string, unknown> = {};
    out.title = document.title;
    out.bodyHead = document.body?.innerText?.slice(0, 80);
    for (const mode of ['omit', 'include'] as const) {
      try {
        const r = await fetch(u, { credentials: mode });
        const ct = r.headers.get('content-type');
        const clone = r.clone();
        const head = (await clone.text()).slice(0, 120);
        out[mode] = { status: r.status, ct, head };
      } catch (e) {
        out[mode] = { error: String(e).slice(0, 120) };
      }
    }
    return out;
  }, url);
  console.log(JSON.stringify(info, null, 1));
  await engine.dispose();
}

void main().then(() => process.exit(0)).catch((e) => {
  console.error(String(e).split('\n')[0]);
  process.exit(1);
});
