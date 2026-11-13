/**
 * **The checked-in parks, read back** — for Node tooling that needs a seed's
 * accepted restart, or its park file, without searching for either. Node
 * builtins and the format's leaf constants only, so the `--import` hook can
 * load it before its own resolver is registered (`acceptedPark.mts`'s
 * `acceptedRestartSync` asks it first).
 */
import { PARK_FILE_FORMAT } from '../../src/world/prebuilt/parkFileName.ts';
import { checkedInPark, readParksManifest } from './checked-in-parks.mjs';
import { PARK_CHANGING_SWITCHES } from './acceptedPark.mts';

/**
 * **Seed `seed`'s accepted restart, from its checked-in park** — or `null` when
 * `parks/manifest.json` has no line for it (or is of another format). The one
 * way Node tooling learns a seed's restart.
 *
 * **It does not ask whether the source changed.** The park is used for as long
 * as it is checked in; whether this source still accepts it is
 * `pnpm run validate:parks`' question, asked by CI on every commit. (Until
 * 13 November 2026 this returned null whenever the park source hash had moved,
 * and every caller then solved the seed again — 12-30 minutes for a park that
 * came out identical.) A manifest that is there but unreadable throws
 * (`readParksManifest`): it is a bad merge, not a missing park.
 */
export function builtRestartOf(root: string, seed: number): number | null {
  const manifest = readParksManifest(root);
  if (!manifest || manifest.format !== PARK_FILE_FORMAT) return null;
  const restart = manifest.seeds[String(seed)]?.restart;
  return typeof restart === 'number' ? restart : null;
}

/**
 * **The `LGP_*` switches that change what a park build makes** — one owner,
 * `acceptedPark.mts`'s `PARK_CHANGING_SWITCHES` (held to every switch the code
 * reads by `test/parkChangingSwitches.test.ts`). One that is set asks for a
 * park that may not be the shipped one, so {@link builtParkFileOf} offers
 * nothing; a switch outside it (a check's own `LGP_*_CHILD` marker,
 * `LGP_PROCGEN_SHARD`) cannot change a park and is ignored. Read at call time:
 * `acceptedPark.mts` imports this module, so the list is read once both have
 * loaded.
 */
export function parkSwitches(_root?: string): ReadonlySet<string> {
  return new Set(PARK_CHANGING_SWITCHES);
}

/**
 * Scripts whose point is the search itself, so they always solve: the
 * cross-platform identity of the solve, the scatter digests, every seed being
 * buildable from scratch, and the measurements of the generator's own ledgers.
 * By name, because their park modules load before any line of theirs could set
 * `LGP_SOLVE`. A script added here is one more that pays for a solve.
 */
const SEARCH_SCRIPTS = new Set([
  // `solve` produces the very file it would otherwise hydrate from (its
  // `hydrate` mode is told its file outright, `LGP_PARK_FILE`).
  'park-file-probe.mts',
  'park-identity.mts',
  'scatter-digest.mts',
  'check-every-seed-builds.mts',
  // Drives the world phase's stalls builder (`accommodate`), which only a search has.
  'check-stall-accommodate.mts',
  'measure-tree-scatter.mts',
  'measure-bush-space.mts',
  'measure-duck-bars.mts',
  'measure-deck-fallthrough.mts',
]);

/** Whether this process's script is one whose point is the search ({@link SEARCH_SCRIPTS}). */
export function isSearchScript(): boolean {
  const script = (process.argv[1] ?? '').split(/[\\/]/).at(-1) ?? '';
  return SEARCH_SCRIPTS.has(script);
}

/**
 * **The shipped park file for `seed`, when a Node process may build from it
 * instead of solving** — or null. Node tooling (every check, through the
 * `--import` hook's `__LGP_RESOLVE_PARK_FILE__`) then builds the park the way
 * the game does: hydrated from the file `build:parks` proved builds exactly the
 * solved park, in milliseconds instead of a solve's minutes.
 *
 * Null — so the process solves — when the file would not be the park it asked
 * for: no checked-in park for the seed; an explicit restart **other
 * than the shipped one** (`LGP_PARK_RESTART`, `__LGP_PARK_RESTART__`: the accept
 * loop's attempts, which are searching); a switch the park's code reads ({@link parkSwitches});
 * `LGP_SOLVE=1`; or a script in
 * {@link SEARCH_SCRIPTS}.
 *
 * A file that is not the one its manifest line records throws
 * (`checkedInPark`): a check must never measure a park nobody can name.
 */
export function builtParkFileOf(root: string, seed: number, env: Readonly<Record<string, string | undefined>>): unknown {
  if (env['LGP_SOLVE'] === '1' || env['LGP_PARK_FILE']) return null;
  if (isSearchScript()) return null;
  const shipped = builtRestartOf(root, seed);
  if (shipped === null) return null;
  // **The shipped restart asked for by number is still the shipped park.** The
  // invariant suite and every check ask for the accepted restart explicitly
  // (`parkFacts.ts`, `acceptedRestartSync`), and refusing them made each one
  // re-solve a park the file already proves: up to 850 s apiece on CI, three
  // seeds a shard, past the shards' watchdogs (#708, run 37221975719).
  const askedEnv = env['LGP_PARK_RESTART'];
  if (askedEnv !== undefined && askedEnv !== '' && Number(askedEnv) !== shipped) return null;
  const askedGlobal = (globalThis as { __LGP_PARK_RESTART__?: unknown }).__LGP_PARK_RESTART__;
  if (askedGlobal !== undefined && Number(askedGlobal) !== shipped) return null;
  const switches = parkSwitches(root);
  for (const key of Object.keys(env)) {
    if (switches.has(key) && env[key] !== undefined && env[key] !== '') return null;
  }
  return checkedInPark(root, seed).park;
}
