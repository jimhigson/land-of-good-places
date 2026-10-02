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
