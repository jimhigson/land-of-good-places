/**
 * Seed hunting: `npm run sweep:seeds -- 1 40` runs `check:park` for each
 * seed in the range in a child process (module caches make in-process
 * re-solving impossible) and prints a verdict per seed. The family picks a
 * pleasant park from the passers; the canonical seed in `parkManifest.ts`
 * is the one they chose.
 */
import { execFileSync } from 'node:child_process';

const from = Number(process.argv[2] ?? 1);
const to = Number(process.argv[3] ?? 30);
let passed = 0;
for (let seed = from; seed <= to; seed += 1) {
  let verdict = 'PASS';
  let note = '';
  try {
    const out = execFileSync(
      process.execPath,
      [
        '--experimental-transform-types',
        '--import',
        './scripts/ts-extension-resolver-register.mjs',
        'scripts/check-park.mts',
      ],
      { env: { ...process.env, LGP_SEED: String(seed), LGP_RATCHET: 'off' }, stdio: ['ignore', 'pipe', 'pipe'] },
    ).toString();
    const summary = out.split('\n').find((line) => line.startsWith('check:park:'));
    note = summary ? summary.replace('check:park: ', '') : '';
    passed += 1;
  } catch (error) {
    verdict = 'fail';
    const out = (error as { stdout?: Buffer }).stdout?.toString() ?? '';
    const line = out.split('\n').find((l) => l.includes('no valid position') || l.includes('regression'));
    note = (line ?? 'did not solve').trim().slice(0, 90);
  }
  console.log(String(seed).padStart(4), verdict, note.slice(0, 110));
}
console.log(`\n${passed}/${to - from + 1} seeds make a working park`);
