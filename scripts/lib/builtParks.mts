/**
 * **What `build:parks` found, read back** — for Node tooling that needs a
 * seed's accepted restart without searching for it. Node builtins, the source
 * hash and the format's leaf constants only, so the `--import` hook can load it
 * before its own resolver is registered (`acceptedPark.mts`'s
 * `acceptedRestartSync` asks it first).
 */
import { existsSync, readFileSync } from 'node:fs';
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
 * Every `LGP_*` switch that does not change what a park build makes. Any other
 * one (`LGP_WARP`, `LGP_SPUR_STRETCH`, `LGP_LAYOUT_RUNG`, …) asks for a park
 * that is not the shipped one, so {@link builtParkFileOf} offers nothing.
 */
const HARMLESS_SWITCHES = new Set([
  'LGP_SEED',
  'LGP_SEEDS',
  'LGP_LANES',
  'LGP_RESTART_LANES',
  'LGP_PROCGEN_SHARD',
  'LGP_PARK_TIMEOUT_MS',
  'LGP_REQUIRE_PARKS',
  'LGP_PARKS_OUT',
]);

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
 * are searching); a park-changing `LGP_*` switch; `LGP_SOLVE=1`; or a script in
 * {@link SEARCH_SCRIPTS}.
 */
export function builtParkFileOf(root: string, seed: number, env: Readonly<Record<string, string | undefined>>): unknown {
  if (env['LGP_SOLVE'] === '1' || env['LGP_PARK_FILE']) return null;
  const script = (process.argv[1] ?? '').split(/[\\/]/).at(-1) ?? '';
  if (SEARCH_SCRIPTS.has(script)) return null;
  if (env['LGP_PARK_RESTART'] !== undefined && env['LGP_PARK_RESTART'] !== '') return null;
  if ((globalThis as { __LGP_PARK_RESTART__?: unknown }).__LGP_PARK_RESTART__ !== undefined) return null;
  for (const key of Object.keys(env)) {
    if (key.startsWith('LGP_') && !HARMLESS_SWITCHES.has(key) && key !== 'LGP_SOLVE') return null;
  }
  if (builtRestartOf(root, seed) === null) return null;
  const file = join(root, PREBUILT_PARKS_OUT, `${seed}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as unknown;
}
