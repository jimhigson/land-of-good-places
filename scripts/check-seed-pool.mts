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

// The module reads `localStorage` through `globalThis`, so a store has to be
// there before anything imports it. Node has none of its own.
const store = fakeStorage();
(globalThis as { localStorage?: Storage }).localStorage = store;

const { CANONICAL_PARK_SEED, PARK_SEED_KEY, PARK_SEED_POOL, forgetParkSeed, parkSeedSource, resolveParkSeed } =
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

// ------------------------------------------------------------ how a seed is got

delete (globalThis as { localStorage?: Storage }).localStorage;
process.env['LGP_SEED'] = '';
check(
  'Node, with no storage and nothing pinned, gets the canonical seed',
  resolveParkSeed() === CANONICAL_PARK_SEED,
  `got ${resolveParkSeed()} — every check script would then measure a park nobody chose`,
);

process.env['LGP_SEED'] = '424242';
check(
  'LGP_SEED pins the seed, in or out of the pool',
  resolveParkSeed() === 424242 && parkSeedSource() === 'pinned',
  `got ${resolveParkSeed()} (${parkSeedSource()}) — the whole fleet steers by this variable`,
);
delete process.env['LGP_SEED'];

const fresh = fakeStorage();
(globalThis as { localStorage?: Storage }).localStorage = fresh;
const drawn = resolveParkSeed();
check(
  'a brand-new profile draws from the pool, and remembers it',
  PARK_SEED_POOL.includes(drawn) &&
    parkSeedSource() === 'drawn' &&
    fresh.getItem(PARK_SEED_KEY) === String(drawn),
  `drew ${drawn} (${parkSeedSource()}), remembered ${fresh.getItem(PARK_SEED_KEY)}`,
);
check(
  'a reload gets the same park',
  resolveParkSeed() === drawn && parkSeedSource() === 'remembered',
  `got ${resolveParkSeed()} (${parkSeedSource()}) where ${drawn} was remembered — ` +
    'her save, and every position in it, is measured in that one park',
);

forgetParkSeed();
check(
  'forgetting the seed is what makes the next park a new one',
  fresh.getItem(PARK_SEED_KEY) === null && PARK_SEED_POOL.includes(resolveParkSeed()),
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
const retired = fakeStorage({ [PARK_SEED_KEY]: '999999' });
(globalThis as { localStorage?: Storage }).localStorage = retired;
const replaced = resolveParkSeed();
check(
  'a remembered seed that has left the pool is replaced',
  replaced !== 999999 && PARK_SEED_POOL.includes(replaced),
  `stayed on ${replaced}`,
);

// The one migration this file owes anybody: everyone playing before the pool
// existed was playing the canonical park, and their saved positions mean
// nothing anywhere else.
const { SAVE_KEY } = await import('../src/state/save.ts');
const preexisting = fakeStorage({ [SAVE_KEY]: '{"v":2}' });
(globalThis as { localStorage?: Storage }).localStorage = preexisting;
check(
  'a save from before the pool keeps the canonical park',
  resolveParkSeed() === CANONICAL_PARK_SEED,
  `got ${resolveParkSeed()} — every position in that save would land in the wrong park`,
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
