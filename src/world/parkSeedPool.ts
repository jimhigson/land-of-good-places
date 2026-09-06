import { SAVE_KEY } from '../state/save';

/**
 * **Which park a child gets, and where that number comes from.**
 *
 * Jim, 31 August 2026 (issue #426):
 *
 * > *"There should now be a non-fixed seed for the park — each park should be
 * > generated from a new seed. To make this work, let's have 16 seeds that are
 * > pre-confirmed as conforming to invariants, and choose from the 16, that's
 * > enough for now but we might change the number later."*
 *
 * Until this file existed every child got the same park, for ever. Now a new
 * game draws one of {@link PARK_SEED_POOL}, and the one she draws is a park
 * somebody has proved is sound.
 *
 * ## A pool, not a free random number
 *
 * A seed off the top of `Math.random()` is a park nobody has ever built, and
 * measured on this branch **only about one candidate in thirty** passes both
 * gates a park has to pass. The other twenty-nine strand waypoints, put a duck
 * bar where it slows the Rail Race down, run a street off the lattice, fail to
 * grow a railway loop at all, or (seed 2, issue #429) admit no railway bridge
 * anywhere. Those are the parks a free seed would have handed a six-year-old.
 *
 * So the pool is a list of seeds that have each been through `check:park` and
 * the full procgen invariant suite, with the ratchet enforced, by
 * `scripts/vet-seed-pool.mts`. See {@link PARK_SEED_POOL} for how to change it.
 *
 * ## What vetting does *not* prove
 *
 * It proves the park **works** (everything routes from the entrance, every
 * waypoint is connected, the boot asserts pass) and that its furniture is
 * **placed sanely** (no wall through a wall, no lamp inside anything, every
 * path lit). It does not prove the park is *nice*: nothing here can tell that
 * one seed puts the ice cream a long dull walk from the gate, or that another
 * clumps every stall on one side. A pool seed can still carry every fault the
 * checks cannot see — this week alone those included a fire 300 m from its
 * fireplace and a grown-up 589 m from the slide she was meant to ride. The
 * pool raises the floor; it does not raise the ceiling.
 */

/**
 * **The pool is seeds 0 through 15.** Jim, 6 September 2026, retiring the
 * sixteen arbitrary seeds the pool used to hold (20260728, 5, 11, 24, 115, 128,
 * 131, 208, 225, 267, 274, 288, 326, 346, 428, 451): *"I don't care about those
 * seeds — the new procgen should work for 0..15 so forget they ever existed."*
 * Nothing about the old seeds is carried over: no warp vectors
 * (`parkWarp.ts`), no per-seed notes, no baselines. The bar for the generator
 * is that every one of these sixteen builds a good park; a seed the generator
 * cannot make a good park from is a generator bug, not a seed to swap.
 *
 * The canonical seed — the park Node builds by default, the one every
 * canonical-only check measures — is **14, provisionally**. Measured on 6 Sep
 * 2026 (`check:park-pool`, hill geometry): 14 is the one seed of the sixteen
 * that builds end to end today, so it is the one the forty canonical-only
 * steps can measure at all; seed 0 dies in the railway loop solver
 * (`RailRouteUnsolvable`). **This goes back to 0 the moment 0 builds** — a
 * canonical that does not build is not a canonical, and a pool where the
 * canonical has to be chosen by survival is the generator bug this ruling
 * exists to expose.
 */
export const CANONICAL_PARK_SEED = 14;

/**
 * Sixteen, by ruling — and there is no `16` anywhere else: the size of the
 * pool *is* `PARK_SEED_POOL.length`, and every consumer asks the array.
 * `check:park-pool` builds every one of these on every PR; `check:seed-pool`
 * guards only that this is a well-formed set containing
 * {@link CANONICAL_PARK_SEED}.
 */
export const PARK_SEED_POOL: readonly number[] = Array.from({ length: 16 }, (_, seed) => seed);
/**
 * **The seeds a multi-seed check script sweeps — THE one owner.** Derived
 * from the pool (the filter below throws on a seed that is not in it): the
 * canonical and the first six, each with a checked-in `test/procgen/seed-N.test.ts`, so
 * `test:procgen`'s deep sweep keeps the blocking chain's cost where it was
 * while `check:park-pool` covers all sixteen.
 */
export const CI_SWEEP_SEEDS: readonly number[] = [CANONICAL_PARK_SEED, 0, 1, 2, 3, 4, 5].map(
  (seed) => {
    if (!PARK_SEED_POOL.includes(seed)) {
      throw new Error(`CI_SWEEP_SEEDS: ${seed} is not in PARK_SEED_POOL — sweep only real parks`);
    }
    return seed;
  },
);

/** Where the drawn seed is remembered, so a reload is the same park. */
export const PARK_SEED_KEY = 'lgp:parkSeed';

/**
 * How this load got its seed. `startFresh` reads it: only a **remembered**
 * seed may be thrown away and redrawn, because a *pinned* one is a developer
 * asking for that exact park, a *drawn* one is already brand new, and a
 * *canonical* one was never anybody's choice to throw away — and redrawing any
 * of them would put `main.ts` in a reload loop.
 *
 * **`canonical` is its own value because the alternative was a lie.** The Node
 * branch of {@link resolveParkSeed} used to report `remembered`, on the path
 * every unpinned check run in CI takes — where there is no storage, no save and
 * nothing remembered. It is the *"Node never draws"* rule returning
 * {@link CANONICAL_PARK_SEED}, which is a different fact about the world, and
 * saying `remembered` made the one string whose entire job is to state
 * provenance state it falsely. That is the same disease as a check that reports
 * success about something it is not describing — #496's whole family — one
 * level down, and it was caught in review of the very PR that added a line to
 * print this. `check:seed-pool` had the tell already: a clause *named* "Node
 * gets the canonical seed" asserting `=== 'remembered'`.
 */
export type ParkSeedSource = 'pinned' | 'remembered' | 'drawn' | 'canonical';

let source: ParkSeedSource = 'pinned';

/** See {@link ParkSeedSource}. Meaningful only after {@link resolveParkSeed}. */
export function parkSeedSource(): ParkSeedSource {
  return source;
}

function storage(): Storage | null {
  try {
    const candidate = (globalThis as { localStorage?: Storage }).localStorage;
    if (!candidate) return null;
    // A storage that throws on touch (Safari private mode) is no storage —
    // the same guard `core/solveCache.ts` and `state/save.ts` already use.
    candidate.getItem(PARK_SEED_KEY);
    return candidate;
  } catch {
    return null;
  }
}

function readSeed(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  // `>= 0`, not `> 0`: seed 0 is a real park now that the pool is 0..15.
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

/**
 * `LGP_SEED=n pnpm run check:park` — the Node-only pin every check script,
 * the sweep and the invariant suite steer by. It has to keep working: it is
 * how the whole fleet asks for one specific park, and `test/procgen`'s
 * per-seed files are nothing but this variable plus a fresh module registry.
 */
function envPin(): number | null {
  try {
    const nodeProcess = (globalThis as { process?: { env?: Record<string, string> } }).process;
    return readSeed(nodeProcess?.env?.['LGP_SEED']);
  } catch {
    return null;
  }
}

/**
 * `?seed=n` on any URL — the browser's equivalent, for reproducing the park in
 * a bug report. A developer's URL, never a button a child presses, exactly
 * like `/view` and `/spawn`.
 *
 * **Deliberately not remembered.** It pins this load only, so dropping the
 * parameter puts the profile straight back on its own park rather than
 * silently having moved it. The flip side, and the reason it is a developer's
 * tool: continuing a *save* under a `?seed=` pin restores a position measured
 * in a different park, so it is for looking, not for playing on.
 */
function urlPin(): number | null {
  try {
    const search = (globalThis as { location?: { search?: string } }).location?.search;
    if (!search) return null;
    return readSeed(new URLSearchParams(search).get('seed'));
  } catch {
    return null;
  }
}

/**
 * **Is this Node rather than a real browser?**
 *
 * Asked because {@link resolveParkSeed} must never draw a random park outside
 * a browser, and — issue #496 — it used to decide that by accident rather
 * than on purpose.
 *
 * The rule this file used to rely on was written in its own doc comment:
 * *"In Node, with nothing pinned, this is still `CANONICAL_PARK_SEED`,
 * because there is no `localStorage`."* That is an observation about a
 * runtime, not a mechanism, and it is exactly the "two definitions of one
 * thing, kept in step by hand" fault CLAUDE.md catalogues — the moment
 * anything supplied a `localStorage`, the invariant died silently.
 *
 * Something did. `scripts/headless-dom.mjs` has long carried
 * `globalThis.localStorage ??= { getItem: () => null, setItem() {}, … }`, and
 * which way the `??=` falls is decided by the Node version:
 *
 * - **Node 25 and earlier** ship their own `globalThis.localStorage`, so the
 *   shim is *not* installed; Node's own throws on `getItem` without
 *   `--localstorage-file`, {@link storage} catches that and returns `null`,
 *   and the canonical seed is reached. Deterministic, by luck.
 * - **Node 26** — the version this repo requires and CI pins — has no
 *   `globalThis.localStorage` at all, so the shim *is* installed, its
 *   `getItem` returns `null` without throwing, {@link storage} hands it back,
 *   and {@link resolveParkSeed} fell through to {@link drawFromPool} and
 *   `Math.random()`. Its `setItem` is a no-op, so nothing was ever
 *   remembered and **every run drew a different park**.
 *
 * Measured on `488605cd`, five consecutive runs of a script that imports
 * `headless-dom.mjs`: `PARK_SEED` came out 326, 326, 20260728, 274, 5 on
 * Node 26.7.0, and 20260728 every time on Node 25.6.1. That is why
 * `check:pet-slide` was flaky (#496) — it was not measuring one park.
 *
 * So the answer is now asked directly, of the runtime rather than of a DOM
 * global a harness can fake. `process.versions.node` is absent from the
 * browser bundle (there is no `process` shim — `vite.config.ts`'s `define`
 * block adds only `__APP_VERSION__`), so this is `false` in the game and
 * `true` in every check, test and script.
 */
function inNode(): boolean {
  const nodeProcess = (globalThis as { process?: { versions?: { node?: unknown } } }).process;
  return typeof nodeProcess?.versions?.node === 'string';
}

/** Is there a save in `store` — i.e. is somebody already playing a park? */
function hasSave(store: Storage | null): boolean {
  try {
    return store?.getItem(SAVE_KEY) != null;
  } catch {
    return false;
  }
}

/**
 * The one owner of "which park is this?".
 *
 * In order: a pin (`LGP_SEED`, then `?seed=`); the seed this profile already
 * drew; the canonical seed, for a profile that has a save from before the pool
 * existed — her park is that one, and moving her to another would strand every
 * position in her save; and only then a fresh draw from the pool.
 *
 * **Node, with nothing pinned, always lands on {@link CANONICAL_PARK_SEED}**,
 * and since issue #496 that is enforced by {@link inNode} rather than left to
 * depend on whether the runtime happens to have a `localStorage`. That is what
 * keeps every check script and the canonical test seed measuring exactly the
 * park they measured before this file existed.
 */
export function resolveParkSeed(): number {
  const pinned = envPin() ?? urlPin();
  if (pinned !== null) {
    source = 'pinned';
    return pinned;
  }

  // **Node never draws a park.** A random seed is a thing a *child* gets, once,
  // on a device that can remember it; a check script that drew one would be
  // measuring a different park on every run, which is issue #496 exactly. See
  // {@link inNode} for how that happened and why this is asked of the runtime
  // rather than of `localStorage`.
  if (inNode()) {
    // Not `remembered` — nothing was. See {@link ParkSeedSource}.
    source = 'canonical';
    return CANONICAL_PARK_SEED;
  }

  return parkSeedFor(storage());
}

/**
 * **What a browser profile holding `store` gets** — everything after the pins
 * and after {@link inNode}.
 *
 * Split out so `check:seed-pool` can exercise the browser's own path from
 * Node, which is the only runtime any check has. It used to do that by
 * assigning a fake `localStorage` onto `globalThis` and calling
 * {@link resolveParkSeed}, and that is no longer possible now that Node never
 * draws — nor should it be, because a check able to fake its way into the
 * browser path is a check that cannot notice Node taking it for real, which is
 * exactly how #496 hid.
 *
 * So the split is the point rather than a concession to testing: **which
 * storage this runtime has** is {@link resolveParkSeed}'s question, and
 * **what to do with one** is this function's, and a test can answer the second
 * honestly without being able to lie about the first.
 */
export function parkSeedFor(store: Storage | null): number {
  const remembered = readSeed(store?.getItem(PARK_SEED_KEY));
  // A seed no longer in the pool is one that has been retired — usually
  // because it was found to build a bad park — so it is not honoured. The
  // profile is moved to a fresh one and the save degrades exactly as it does
  // across a `LAYOUT_VERSION` bump.
  if (remembered !== null && PARK_SEED_POOL.includes(remembered)) {
    source = 'remembered';
    return remembered;
  }

  if (store === null) {
    source = 'remembered';
    return CANONICAL_PARK_SEED;
  }

  // A save with no remembered seed is a profile from before the pool existed:
  // the park she has been playing is the canonical one, and every position in
  // her save is measured in it.
  const fromBeforeThePool = remembered === null && hasSave(store);
  const seed = fromBeforeThePool ? CANONICAL_PARK_SEED : drawFromPool();
  source = fromBeforeThePool ? 'remembered' : 'drawn';
  try {
    store.setItem(PARK_SEED_KEY, String(seed));
  } catch {
    // Quota or private mode: she gets a park, it is simply a different one
    // next time. Not worth interrupting a six-year-old about.
  }
  return seed;
}

function drawFromPool(): number {
  const at = Math.floor(Math.random() * PARK_SEED_POOL.length);
  return PARK_SEED_POOL[Math.min(at, PARK_SEED_POOL.length - 1)] ?? CANONICAL_PARK_SEED;
}

/**
 * Forget the remembered seed, so the next load draws a new park.
 *
 * Called by "start again" and nowhere else — deliberately **not** folded into
 * `clearSave()`, which also runs on the boot path of a brand-new profile whose
 * seed was drawn a moment earlier: forgetting it there would leave the child
 * playing one park and every later reload building another.
 */
export function forgetParkSeed(): void {
  try {
    storage()?.removeItem(PARK_SEED_KEY);
  } catch {
    // Nothing to do, and nothing that needs saying.
  }
}
