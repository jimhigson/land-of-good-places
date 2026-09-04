/**
 * `check:seed-pool` — the pool is well formed, and the draw does what it says.
 *
 * Issue #426 made which park a child gets a *decision* rather than a constant.
 * This check owns the cheap half of that decision being right: that
 * `PARK_SEED_POOL` is a set of distinct positive integers containing the
 * canonical seed, and that `resolveParkSeed()` picks from it in the documented
 * order — pins first, then the seed this profile already drew, then a draw.
 *
 * **What it deliberately does not prove**, and says so on every run: that each
 * seed in the pool still builds a sound park. That is
 * `scripts/vet-seed-pool.mts`, it costs about half a minute per seed, and it
 * has to be re-run whenever the generator changes. A green line here about a
 * pool full of broken parks would be exactly the "assertion reporting success
 * about something it is not describing" this repo keeps catching in itself.
 *
 * Every case below was watched go red before being trusted green — break the
 * pool (drop the canonical seed, duplicate an entry, return a seed that is not
 * in it) and the matching probe fails.
 */

/**
 * A `localStorage` good enough to decide a park by: the four methods
 * `parkSeedPool.ts` touches, over a plain `Map`.
 *
 * Installed on `globalThis` **before** the module under test is imported,
 * because it reads storage at call time but is imported once — and because a
 * browser-only code path that is never exercised in Node is a code path
 * nothing can see go wrong until a child does.
 */
function fakeStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, String(value)),
  };
}

const failures: string[] = [];
function check(claim: string, ok: boolean, detail: string): void {
  if (ok) console.log(`  ok   ${claim}`);
  else {
    console.log(`  FAIL ${claim} — ${detail}`);
    failures.push(`${claim} — ${detail}`);
  }
}

const { CANONICAL_PARK_SEED, PARK_SEED_KEY, PARK_SEED_POOL, forgetParkSeed, parkSeedFor, parkSeedSource, resolveParkSeed } =
  await import('../src/world/parkSeedPool.ts');

console.log(`check:seed-pool: ${PARK_SEED_POOL.length} seed(s) in the pool\n`);

// ------------------------------------------------------------- the pool itself

check(
  'the pool is not empty',
  PARK_SEED_POOL.length > 0,
  'an empty pool would draw nothing and every park would be the fallback',
);
check(
  'every seed is a positive integer',
  PARK_SEED_POOL.every((s) => Number.isInteger(s) && s > 0),
  `got ${PARK_SEED_POOL.filter((s) => !Number.isInteger(s) || s <= 0).join(', ')}`,
);
check(
  'no seed appears twice',
  new Set(PARK_SEED_POOL).size === PARK_SEED_POOL.length,
  `${PARK_SEED_POOL.length} entries, ${new Set(PARK_SEED_POOL).size} distinct — a repeat is a park drawn twice as often`,
);
check(
  'the canonical seed is in the pool',
  PARK_SEED_POOL.includes(CANONICAL_PARK_SEED),
  `${CANONICAL_PARK_SEED} is what a returning child and every check script build; ` +
    'out of the pool, `resolveParkSeed` would move her off her own park on the next load',
);

// ---------------------------------------------- what Node gets (issue #496)
//
// **These are the clauses that were missing, and their absence is the whole of
// #496.** What stood here was:
//
// ```
// delete (globalThis as { localStorage?: Storage }).localStorage;
// check('Node, with no storage and nothing pinned, gets the canonical seed', …)
// ```
//
// — which deleted the storage first and so asked about a *hypothetical* Node,
// not the one every check script actually runs in. Every check script imports
// `scripts/headless-dom.mjs`, which carries
// `globalThis.localStorage ??= { getItem: () => null, setItem() {}, … }`; on
// Node 26 (no `localStorage` of its own, unlike 25) that shim installs, and
// `resolveParkSeed` fell through to `Math.random()`. Measured before the fix,
// five consecutive runs of a script importing that harness got `PARK_SEED`
// 326, 326, 20260728, 274 and 5. The check above was green the whole time,
// because it had removed the exact condition that caused it.
//
// So these ask with a storage **present**, which is the real case.

const shim = fakeStorage();
(globalThis as { localStorage?: Storage }).localStorage = shim;
delete process.env['LGP_SEED'];
check(
  'Node gets the canonical seed even with a working localStorage in place',
  resolveParkSeed() === CANONICAL_PARK_SEED && parkSeedSource() === 'remembered',
  `got ${resolveParkSeed()} (${parkSeedSource()}) with a storage installed — ` +
    'this is issue #496: every check script would measure a park drawn at random',
);
check(
  'and it did not write a seed into that storage',
  shim.getItem(PARK_SEED_KEY) === null,
  `Node remembered ${String(shim.getItem(PARK_SEED_KEY))} — a check script must leave no park behind it`,
);
(globalThis as { localStorage?: Storage }).localStorage = fakeStorage({ [PARK_SEED_KEY]: '115' });
check(
  'and a seed already sitting in that storage does not steer Node either',
  resolveParkSeed() === CANONICAL_PARK_SEED,
  `got ${resolveParkSeed()} — a check script must build the canonical park whatever it finds`,
);
(globalThis as { localStorage?: Storage }).localStorage = shim;

process.env['LGP_SEED'] = '424242';
check(
  'LGP_SEED pins the seed, in or out of the pool',
  resolveParkSeed() === 424242 && parkSeedSource() === 'pinned',
  `got ${resolveParkSeed()} (${parkSeedSource()}) — the whole fleet steers by this variable`,
);
delete process.env['LGP_SEED'];

// ------------------------------------------- what a browser profile gets
//
// Driven through `parkSeedFor(store)` rather than by faking a `localStorage`
// and calling `resolveParkSeed()`, because Node no longer draws whatever is on
// `globalThis` — see that function's own comment for why the split is the
// point and not a concession.

const fresh = fakeStorage();
const drawn = parkSeedFor(fresh);
check(
  'a brand-new profile draws from the pool, and remembers it',
  PARK_SEED_POOL.includes(drawn) &&
    parkSeedSource() === 'drawn' &&
    fresh.getItem(PARK_SEED_KEY) === String(drawn),
  `drew ${drawn} (${parkSeedSource()}), remembered ${fresh.getItem(PARK_SEED_KEY)}`,
);
check(
  'a reload gets the same park',
  parkSeedFor(fresh) === drawn && parkSeedSource() === 'remembered',
  `got ${parkSeedFor(fresh)} (${parkSeedSource()}) where ${drawn} was remembered — ` +
    'her save, and every position in it, is measured in that one park',
);

(globalThis as { localStorage?: Storage }).localStorage = fresh;
forgetParkSeed();
check(
  'forgetting the seed is what makes the next park a new one',
  fresh.getItem(PARK_SEED_KEY) === null && PARK_SEED_POOL.includes(parkSeedFor(fresh)),
  `key still reads ${String(fresh.getItem(PARK_SEED_KEY))}`,
);
// `main.ts`'s "start again" forgets the seed and reloads, and reloads again
// for as long as the seed is `remembered`. This is the assertion that says it
// cannot loop: after the forget, the next load's seed is `drawn`.
check(
  'and the park after a forget is drawn, not remembered — so "start again" reloads once',
  parkSeedSource() === 'drawn',
  `source is ${parkSeedSource()}: startFresh would forget and reload for ever`,
);

// A seed is usually retired because it was found to build a bad park, so a
// profile still holding one must be moved rather than kept on it.
const replaced = parkSeedFor(fakeStorage({ [PARK_SEED_KEY]: '999999' }));
check(
  'a remembered seed that has left the pool is replaced',
  replaced !== 999999 && PARK_SEED_POOL.includes(replaced),
  `stayed on ${replaced}`,
);

// The one migration this file owes anybody: everyone playing before the pool
// existed was playing the canonical park, and their saved positions mean
// nothing anywhere else.
const { SAVE_KEY } = await import('../src/state/save.ts');
check(
  'a save from before the pool keeps the canonical park',
  parkSeedFor(fakeStorage({ [SAVE_KEY]: '{"v":2}' })) === CANONICAL_PARK_SEED,
  `got ${parkSeedFor(fakeStorage({ [SAVE_KEY]: '{"v":2}' }))} — ` +
    'every position in that save would land in the wrong park',
);

// ------------------------------ the end-to-end clause, in real child processes
//
// Everything above is in *this* process, where `headless-dom.mjs` was never
// loaded and the imports have already happened. The failure in #496 was
// end-to-end — a whole check script, booted from scratch, getting a different
// park than the one before it — so this clause boots real ones and compares.
//
// It carries its own control: the same comparison is first run over a child
// that deliberately reports a random pool member, and the check fails if that
// control does **not** disagree with itself. A repetition test that cannot
// see a difference would pass this file for ever while every park moved.

const { execFileSync } = await import('node:child_process');
const RUNS = 6;

function seedsFromChildren(script: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    out.push(
      execFileSync(
        process.execPath,
        ['--no-warnings', '--import', './scripts/ts-extension-resolver-register.mjs', script],
        { encoding: 'utf8', env: { ...process.env, LGP_SEED: '' } },
      ).trim(),
    );
  }
  return out;
}

const control = seedsFromChildren('scripts/seed-report-control.mts');
const real = seedsFromChildren('scripts/seed-report.mts');
const distinctControl = new Set(control).size;
const distinctReal = new Set(real).size;

check(
  `the control disagrees with itself, so this comparison can fail (${distinctControl} distinct in ${RUNS})`,
  distinctControl > 1,
  `the deliberately-random child reported ${control.join(', ')} — all the same, so the ` +
    'clause below proves nothing and the instrument is broken, not the code',
);
check(
  `${RUNS} freshly booted check harnesses all build the same park (${distinctReal} distinct)`,
  distinctReal === 1 && real[0] === String(CANONICAL_PARK_SEED),
  `got ${real.join(', ')} — on Node ${process.versions.node}. This is issue #496: ` +
    'a seeded park that is not the same twice makes every invariant and every ' +
    'threshold in every check script a coin flip',
);

// --------------------------------------------------------------------- verdict

console.log(
  `\ncheck:seed-pool: this proves the pool is well formed and the draw is correct. ` +
    `It does NOT prove any of the ${PARK_SEED_POOL.length} seeds still builds a sound park — ` +
    `that is \`pnpm run vet:seeds -- --list ${PARK_SEED_POOL.join(',')}\`, and it must be ` +
    're-run whenever the generator changes.',
);

if (failures.length > 0) {
  console.error(`\ncheck:seed-pool: ${failures.length} failure(s):\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('PASS');
