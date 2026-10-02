/**
 * **What `build:parks` found, read back** — for Node tooling that needs a
 * seed's accepted restart without searching for it. Node builtins, the source
 * hash and the format's leaf constants only, so the `--import` hook can load it
 * before its own resolver is registered (`acceptedPark.mts`'s
 * `acceptedRestartSync` asks it first).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PARK_FILE_FORMAT,
  PREBUILT_PARKS_MANIFEST,
  PREBUILT_PARKS_OUT,
  type PrebuiltParksManifest,
} from '../../src/world/prebuilt/parkFileName.ts';
import { parkSourceHash } from './park-source-hash.mjs';

/**
 * **Seed `seed`'s accepted restart, as `build:parks` found it for this exact
 * source** — or `null` if it has not: no manifest under `.parks/`, a manifest
 * from another source (its `sourceHash` is not this tree's), or one that does
 * not cover the seed. The one way Node tooling should learn a seed's restart
 * from a build rather than search for it; a `null` means run
 * `LGP_SEEDS=<seed> pnpm run build:parks` (or search, as `acceptParkCached` does).
 */
export function builtRestartOf(root: string, seed: number): number | null {
  const path = join(root, PREBUILT_PARKS_OUT, PREBUILT_PARKS_MANIFEST);
  if (!existsSync(path)) return null;
  let manifest: PrebuiltParksManifest;
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8')) as PrebuiltParksManifest;
  } catch {
    return null;
  }
  if (manifest.format !== PARK_FILE_FORMAT || manifest.sourceHash !== parkSourceHash(root)) return null;
  const restart = manifest.restarts?.[String(seed)];
  return typeof restart === 'number' ? restart : null;
}

/**
 * **The `LGP_*` switches the game and the generator actually read** — measured
 * off the source (`src/`, `procgen/`), not listed by hand, so a switch added
 * tomorrow is counted the day it exists. One that is set asks for a park that
 * may not be the shipped one, so {@link builtParkFileOf} offers nothing. A
 * switch nothing in the park's code reads (a check's own `LGP_*_CHILD` marker,
 * `LGP_PROCGEN_SHARD`, `LGP_LANES`) cannot change a park and is ignored.
 * Excluded: `LGP_SEED` (which park — the file is per seed), the restart (its
 * own rule below), and the `LGP_DEBUG_*`/`LGP_TRACE_*` switches, which print
 * and decide nothing.
 */
let parkSwitchesMemo: ReadonlySet<string> | null = null;
export function parkSwitches(root: string): ReadonlySet<string> {
  if (parkSwitchesMemo) return parkSwitchesMemo;
  const found = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.[mc]?[jt]s$/.test(entry.name)) {
        for (const match of readFileSync(path, 'utf8').matchAll(/\bLGP_[A-Z0-9_]*[A-Z0-9]\b/g)) found.add(match[0]);
      }
    }
  };
  for (const dir of ['src', 'procgen']) if (existsSync(join(root, dir))) walk(join(root, dir));
  for (const key of [...found]) {
    if (key === 'LGP_SEED' || key === 'LGP_PARK_RESTART' || /^LGP_(DEBUG|TRACE)_/.test(key)) found.delete(key);
  }
  return (parkSwitchesMemo = found);
}

/**
 * Scripts whose point is the search itself, so they always solve: the
 * cross-platform identity of the solve, the scatter digests, every seed being
 * buildable from scratch, and the measurements of the generator's own ledgers.
 * By name, because their park modules load before any line of theirs could set
 * `LGP_SOLVE`. A script added here is one more that pays for a solve.
 */
const SEARCH_SCRIPTS = new Set([
  'park-identity.mts',
  'scatter-digest.mts',
  'check-every-seed-builds.mts',
  'measure-tree-scatter.mts',
  'measure-bush-space.mts',
  'measure-duck-bars.mts',
  'measure-deck-fallthrough.mts',
]);

/**
 * **The shipped park file for `seed`, when a Node process may build from it
 * instead of solving** — or null. Node tooling (every check, through the
 * `--import` hook's `__LGP_RESOLVE_PARK_FILE__`) then builds the park the way
 * the game does: hydrated from the file `build:parks` proved builds exactly the
 * solved park, in milliseconds instead of a solve's minutes.
 *
 * Null — so the process solves — when the file would not be the park it asked
 * for: no fresh manifest for this source and seed; an explicit restart
 * (`LGP_PARK_RESTART`, `__LGP_PARK_RESTART__`: the accept loop's attempts, which
 * are searching); a switch the park's code reads ({@link parkSwitches});
 * `LGP_SOLVE=1`; or a script in
 * {@link SEARCH_SCRIPTS}.
 */
export function builtParkFileOf(root: string, seed: number, env: Readonly<Record<string, string | undefined>>): unknown {
  if (env['LGP_SOLVE'] === '1' || env['LGP_PARK_FILE']) return null;
  const script = (process.argv[1] ?? '').split(/[\\/]/).at(-1) ?? '';
  if (SEARCH_SCRIPTS.has(script)) return null;
  if (env['LGP_PARK_RESTART'] !== undefined && env['LGP_PARK_RESTART'] !== '') return null;
  if ((globalThis as { __LGP_PARK_RESTART__?: unknown }).__LGP_PARK_RESTART__ !== undefined) return null;
  const switches = parkSwitches(root);
  for (const key of Object.keys(env)) {
    if (switches.has(key) && env[key] !== undefined && env[key] !== '') return null;
  }
  if (builtRestartOf(root, seed) === null) return null;
  const file = join(root, PREBUILT_PARKS_OUT, `${seed}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as unknown;
}
