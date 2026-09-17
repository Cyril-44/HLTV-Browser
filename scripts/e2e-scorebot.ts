/**
 * Dev-only focused scorebot test.
 */
import { scorebot, ScorebotClient } from '../src/hltv/scorebot';

async function main(): Promise<void> {
  ScorebotDebug();
  const matchId = 2398090; // NaVi vs Aurora (live during research)
  scorebot.subscribeMatch(matchId, {
    onScore: (frame) => console.log('score:', JSON.stringify(frame).slice(0, 220)),
    onLog: (items) => console.log(`log +${items.length}:`, JSON.stringify(items[items.length - 1] ?? null).slice(0, 160)),
  });
  await new Promise((r) => setTimeout(r, 60000));
  console.log('done');
}

function ScorebotDebug(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ScorebotClient.debug = true;
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
