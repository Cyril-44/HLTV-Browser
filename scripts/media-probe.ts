/**
 * Dev-only: exercise the real media proxy path against the live site.
 * Fetches the Falcons article, picks a same-origin flag url + an img-cdn
 * logo url from the sanitized body, then runs engine.fetchImageBase64 on
 * each and reports sizes. One article page + one parked page + 2 image
 * fetches — keep runs spaced.
 */
import * as api from '../src/hltv/api';
import { engine } from '../src/hltv/engine';

async function main(): Promise<void> {
  const d = await api.getNewsDetail('/news/45631/falcons-sweep-aurora-to-stay-flawless-at-epl');
  const urls = [...d.bodyHtml.matchAll(/data-src="([^"]+)"/g)].map((m) => m.dataset ? m[1] : m[1].replace(/&amp;/g, '&'));
  const flag = urls.find((u) => /hltv\.org\/img\/static\/flags/.test(u));
  const logo = urls.find((u) => /img-cdn\.hltv\.org\/teamlogo/.test(u));
  const photo = urls.find((u) => /img-cdn\.hltv\.org\/gallery|picture/.test(u));
  console.log('picked:', { flag: flag?.slice(0, 70), logo: logo?.slice(0, 90), photo: photo?.slice(0, 90) });

  for (const [kind, u] of [['flag', flag], ['logo', logo], ['photo', photo]] as const) {
    if (!u) { console.log(kind, 'SKIP'); continue; }
    const t0 = Date.now();
    const b64 = await engine.fetchImageBase64(u).catch((e) => `THREW:${String(e).split('\n')[0]}`);
    if (typeof b64 !== 'string' || b64.startsWith('THREW')) {
      console.log(kind, 'FAILED:', b64, `(${Date.now() - t0}ms)`);
    } else {
      console.log(kind, `OK b64=${b64.length} chars (~${Math.round(b64.length * 3 / 4 / 1024)}KB, ${Date.now() - t0}ms)`);
    }
  }
  await engine.dispose();
}

void main().then(() => process.exit(0)).catch((e) => {
  console.error(String(e).split('\n')[0]);
  process.exit(1);
});
