/**
 * Dev-only: exercise the full engine path against the real site, including the
 * interactive Cloudflare verification popup when the automatic ladder fails.
 * Run: node scripts/run-e2e.cjs scripts/.cf-test.build.cjs
 */
import { engine } from '../src/hltv/engine';

async function main(): Promise<void> {
  const t0 = Date.now();
  const html = await engine.getHtml('https://www.hltv.org/matches');
  const count = (html.match(/class="match-wrapper/g) ?? []).length;
  console.log(`fetched ${(html.length / 1024).toFixed(0)}KB in ${((Date.now() - t0) / 1000).toFixed(1)}s; match-wrapper count: ${count}`);
  console.log(count > 10 ? 'CF SOLVE TEST PASS' : 'CF SOLVE TEST FAIL (page loaded but unexpected content)');
  await engine.dispose();
}

void main().then(() => process.exit(0)).catch((e) => {
  console.error('CF SOLVE TEST FAIL:', String(e).split('\n')[0]);
  process.exit(1);
});
