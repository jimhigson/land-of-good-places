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
 * The park everyone had before the pool existed, and the one every check and
 * every test that does not ask for another still gets.
 *
 * It stays the canonical seed for three separate jobs, and they are worth
 * keeping apart: it is the park a **returning child** carries on playing (her
 * save's positions mean nothing in a different park); it is the seed **Node
 * resolves to** when nothing pins one, so `check:park` and every other check
 * measures the same park it always did; and it is `test/procgen`'s canonical
 * regression seed. It is also, being the most-played park in the game, the
 * most thoroughly vetted member of the pool.
 */
export const CANONICAL_PARK_SEED = 20260728;

/**
 * **The vetted pool. Sixteen for now; change the array and nothing else.**
 *
 * Jim expects this number to move ("that's enough for now but we might change
 * the number later"), so there is no `16` anywhere in the code — the size of
 * the pool *is* `PARK_SEED_POOL.length`, and every consumer asks the array.
 *
 * **To change it:**
 *
 * 1. `pnpm run vet:seeds -- <from> <to>` to find candidates.
 * 2. Put the passers in this array.
 * 3. `pnpm run vet:seeds -- --list <the whole pool>` to confirm the pool as a
 *    whole, and update the note below with the date and commit.
 *
 * **Budget for a low hit rate.** Vetting candidates from 1-1400 at `101b5415`
 * tried **515 and kept 17 — about one in thirty.** Sixteen are here; 1102 and
 * 1104 are spares, recorded on the PR rather than used.
 *
 * That rate is a measurement of the generator's health rather than of the
 * search. Of the 498 rejected, about three quarters fail `check:park` — most
 * often waypoints with nowhere a child fits (`poi.stranded`, 100 seeds) or a
 * railway loop that will not solve at all (~96) — and the rest fail an
 * invariant, most often the Rail Race's duck bar standing where it slows the
 * ride (95), its camera running backwards (94), or the Sky Cruiser flying
 * through the castle (73).
 *
 * **Re-vet the whole pool whenever the generator changes.** A seed is not
 * sound in the abstract; it is sound against the code that builds it. #460 (a
 * hoppable wall's routing cost, 6.4 → 2.65) invalidated a whole vetting run of
 * these seeds mid-search by moving paths across the park — that is how quickly
 * it goes stale. **Three routing changes landed while this pool was being
 * found, and it was re-vetted against every one of them**: #460 (the hop
 * multiplier), #461 (long grass, and solid benches, planters and pavilion) and
 * #421 (paving preference in the router). All sixteen still pass after all
 * three, and not one seed that passed earlier fails now.
 * **Vetted at `fb8496a0`, 1 September 2026.**
 *
 * `check:seed-pool` guards the cheap half of this: that the pool is a set of
 * distinct positive integers containing {@link CANONICAL_PARK_SEED}. It cannot
 * guard the expensive half — that each one still builds a sound park — which
 * is what the re-vetting run above is for, and it says so on every run.
 *
 * **Seed 18 is deliberately absent**, and it is the reason a pool is not just
 * "the seeds `test/procgen` already uses": it is one of that suite's four
 * sweep seeds, green on all 80 invariants, and it fails `check:park` with
 * `route.crossesRail: 4` — four walks routed across the railway at grade,
 * 0.56 m above the rail where the deck they need is 4.06 m up. The seed goes,
 * not the assertion. Written up on #437.
 */
export const PARK_SEED_POOL: readonly number[] = [
  CANONICAL_PARK_SEED,
  5,
  11,
  24,
  115,
  128,
  131,
  208,
  225,
  267,
  274,
  288,
  326,
  346,
  428,
  451,
];

/** Where the drawn seed is remembered, so a reload is the same park. */
export const PARK_SEED_KEY = 'lgp:parkSeed';

/**
 * How this load got its seed. `startFresh` reads it: only a **remembered**
 * seed may be thrown away and redrawn, because a *pinned* one is a developer
 * asking for that exact park and a *drawn* one is already brand new — and
 * redrawing either would put `main.ts` in a reload loop.
 */
export type ParkSeedSource = 'pinned' | 'remembered' | 'drawn';

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
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
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

/** Is there a save on this device — i.e. is somebody already playing a park? */
function hasSave(): boolean {
  try {
    return storage()?.getItem(SAVE_KEY) != null;
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
    source = 'remembered';
    return CANONICAL_PARK_SEED;
  }

  const store = storage();
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
  const fromBeforeThePool = remembered === null && hasSave();
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
