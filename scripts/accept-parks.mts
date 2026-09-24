/**
 * **`accept:parks` — run the root acceptance loop over many seeds, and say
 * how hard each one had to try.**
 *
 * ```
 * pnpm run accept:parks -- 0-15                 # the shipped seeds
 * pnpm run accept:parks -- 1000-1099 --out r.json
 * LGP_LANES=3 pnpm run accept:parks -- 3,6,15
 * pnpm run accept:parks -- 0-15 --fresh        # ignore the verdict cache
 * pnpm run accept:parks -- 0-15 --write        # record the answers in src/world/acceptedRestarts.ts
 * ```
 *
 * For each seed, `acceptPark` (`scripts/lib/acceptedPark.mts`) tries restart
 * 0, 1, 2, … — each a fresh process building and measuring one whole park —
 * until one passes every acceptance measure. This prints, per seed, the
 * restart that was accepted, what forced every restart before it, and the
 * time it took; `--out` writes the whole log as JSON. Verdicts are cached
 * under `.cache/lgp-accepted/<source hash>/` (`acceptParkCached`), so a
 * later `test:procgen` or `check:park` at the same source reuses them.
 *
 * This is the termination proof in practice: the loop is finite for a seed
 * exactly when some restart passes, and this is how that is measured rather
 * than assumed. Exit 1 if any seed hit `MAX_RESTARTS` (or its loop broke).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';

import { acceptPark, acceptParkCached, describeRestarts, type AcceptedPark } from './lib/acceptedPark.mts';

function parseSeeds(args: readonly string[]): number[] {
  const seeds: number[] = [];
  for (const arg of args) {
    for (const part of arg.split(',').filter(Boolean)) {
      const range = /^(\d+)-(\d+)$/.exec(part);
      if (range) {
        for (let s = Number(range[1]); s <= Number(range[2]); s += 1) seeds.push(s);
      } else if (/^\d+$/.test(part)) {
        seeds.push(Number(part));
      } else {
        throw new Error(`accept:parks: not a seed or a range: ${part}`);
      }
    }
  }
  return seeds;
}

const argv = process.argv.slice(2);
const outAt = argv.indexOf('--out');
const out = outAt >= 0 ? argv[outAt + 1] : undefined;
const seeds = parseSeeds(argv.filter((a, i) => !a.startsWith('--') && !(outAt >= 0 && i === outAt + 1)));
if (seeds.length === 0) {
  console.error('accept:parks: name some seeds, e.g. 0-15');
  process.exit(2);
}
const lanes = Math.max(1, Math.min(Number(process.env['LGP_LANES'] ?? 3), cpus().length));
const queue = [...seeds].reverse();
const results: AcceptedPark[] = [];
const broken: { seed: number; error: string }[] = [];
const began = performance.now();

process.stdout.write(`accept:parks: ${seeds.length} seed(s), ${lanes} at a time\n`);

const save = (): void => {
  if (!out) return;
  writeFileSync(
    out,
    `${JSON.stringify({ seeds, results: [...results].sort((a, b) => a.seed - b.seed), broken }, null, 1)}\n`,
  );
};

await Promise.all(
  Array.from({ length: Math.min(lanes, queue.length) }, async () => {
    for (let seed = queue.pop(); seed !== undefined; seed = queue.pop()) {
      try {
        const accept = argv.includes('--fresh') ? acceptPark : acceptParkCached;
        const accepted = await accept(seed, {
          onAttempt: (record) => {
            if (!record.accepted) {
              process.stdout.write(
                `  seed ${seed} restart ${record.restart} rejected (${(record.wallMs / 1000).toFixed(0)} s): ` +
                  `${record.forcedBy.map((f) => f.measure).join(' | ').slice(0, 300)}\n`,
              );
            }
          },
        });
        results.push(accepted);
        process.stdout.write(
          `seed ${String(seed).padStart(5)}: accepted restart ${accepted.restart} after ${accepted.attempts.length} attempt(s), ` +
            `${(accepted.wallMs / 1000).toFixed(0)} s wall\n`,
        );
        for (const line of describeRestarts(accepted)) process.stdout.write(`    ${line.slice(0, 400)}\n`);
      } catch (error) {
        broken.push({ seed, error: String(error) });
        process.stdout.write(`seed ${String(seed).padStart(5)}: NO PARK — ${String(error).slice(0, 600)}\n`);
      }
      save();
    }
  }),
);

const attempts = results.map((r) => r.attempts.length);
const restarted = results.filter((r) => r.restart > 0).length;
process.stdout.write(
  `accept:parks: ${results.length}/${seeds.length} accepted, ${restarted} needed a restart, ` +
    `attempts max ${Math.max(0, ...attempts)} mean ${(attempts.reduce((a, b) => a + b, 0) / Math.max(1, attempts.length)).toFixed(2)}, ` +
    `${broken.length} broken, ${((performance.now() - began) / 1000).toFixed(0)} s\n`,
);
save();
/**
 * `--write`: record each accepted seed's restart in `src/world/acceptedRestarts.ts`
 * — the file every check and the game read. Seeds not run keep their entry.
 * Refused if anything broke: a partial answer is not recorded.
 */
if (argv.includes('--write')) {
  if (broken.length > 0) {
    process.stdout.write('accept:parks: --write refused — a seed did not finish; nothing recorded\n');
  } else {
    const file = new URL('../src/world/acceptedRestarts.ts', import.meta.url);
    const text = readFileSync(file, 'utf8');
    const open = text.indexOf('= {\n');
    const close = text.indexOf('\n};', open);
    const entries = new Map<number, number>();
    for (const m of text.slice(open, close).matchAll(/^\s*(\d+): (\d+),$/gm)) entries.set(Number(m[1]), Number(m[2]));
    for (const r of results) entries.set(r.seed, r.restart);
    const body = [...entries].sort((a, b) => a[0] - b[0]).map(([seed, restart]) => `  ${seed}: ${restart},`).join('\n');
    writeFileSync(file, `${text.slice(0, open)}= {\n${body}${text.slice(close)}`);
    process.stdout.write(`accept:parks: recorded ${results.length} restart(s) in src/world/acceptedRestarts.ts\n`);
  }
}
process.exit(broken.length > 0 ? 1 : 0);
