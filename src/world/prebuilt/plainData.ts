import { Vector3 } from 'three';
import { BUILT_DECISIONS, PARK_FILE_FEATURES, PARK_FILE_FORMAT } from './parkFileName';
import type { ParkFile } from './parkFile';
/**
 * **Park-file plain data, and whether a file can be used** — the part of the
 * format with no park in it: the JSON type, tagged numbers and vectors, and the
 * usability test. A leaf (it imports `three` and the format's constants only),
 * so a module the park file itself reaches — the boundary — can ask it without
 * closing an import cycle through `parkFile.ts`.
 */

/**
 * **A park's solved decisions, as a small JSON file** — the format a prebuilt
 * park is shipped in, and the one owner of how it is written and read.
 *
 * Jim, 23 September 2026: *"procgen should be build-time and downloaded by the
 * game instead of done on the client that is playing"*, and *"it probably
 * needs to invent a file format for this that is the park's layout as json,
 * but not every mesh etc, so that the client can load a reasonably small park
 * with all decisions made."* The design, with the measurements behind it, is
 * `docs/design/PREBUILT-PARKS.md`.
 *
 * ## What goes in
 *
 * **What a search decided, never what is derived from it.** A route is its
 * chosen cubic segments; the arc-length table, the samplers and `TrainRoute`'s
 * lookup are rebuilt from them by the very functions that build them after a
 * fresh solve ({@link buildRoute}, `new TrainRoute`, `new CoasterRoute`). So a
 * hydrated feature and a searched one share every line after the search, and
 * the only thing this file can get wrong is the search's own output — which
 * `check:prebuilt-park` compares, by whole-park digest, against a fresh solve.
 *
 * Format 1 carries the plan's layout, cruiser, train, slide and crossings —
 * 7.8 of the plan's 7.9 s of search on the canonical seed. `pathGraph` and
 * `road` still run on the client (~50 ms): the path search leaves state in
 * `paths.ts` that the `World` reads, and that has to become data before it can
 * be shipped. The world phase (`worldPhase.ts`) is likewise still solved.
 *
 * ## Strict on the way out
 *
 * The encoder refuses anything it does not understand — a class instance
 * where plain data was expected, a function, a route with a field it has not
 * been taught, an `undefined` — rather than writing a lossy file. A new field
 * in a plan type therefore fails `build:parks` loudly, with the path, instead
 * of shipping a park that silently differs. Numbers JSON cannot carry
 * (`Infinity`, `NaN`, `-0`) are tagged, not lost.
 */

// ------------------------------------------------------------------- the shape

/** Any JSON value. */
export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };


// ---------------------------------------------------------------- plain data

/** A vector, tagged — tree parts and bush blobs carry `Vector3`s. */
interface TaggedVector {
  readonly $v: readonly Json[];
}


function isVector(value: unknown): value is TaggedVector {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 1 && '$v' in value;
}


/** A number JSON cannot carry, tagged. */
interface TaggedNumber {
  readonly $n: 'Infinity' | '-Infinity' | 'NaN' | '-0';
}


function isTagged(value: unknown): value is TaggedNumber {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 1 && '$n' in value;
}


export function unnum(value: Json, path: string): number {
  if (typeof value === 'number') return value;
  if (isTagged(value)) {
    switch (value.$n) {
      case 'NaN':
        return NaN;
      case 'Infinity':
        return Infinity;
      case '-Infinity':
        return -Infinity;
      case '-0':
        return -0;
    }
  }
  throw new Error(`park file: ${path} is not a number (${JSON.stringify(value)})`);
}


/** Plain data back in: tagged numbers restored, everything else as written. */
export function unplain(value: Json, path: string): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (isTagged(value)) return unnum(value, path);
  if (isVector(value)) {
    const [x, y, z] = value.$v;
    return new Vector3(unnum(x as Json, `${path}.x`), unnum(y as Json, `${path}.y`), unnum(z as Json, `${path}.z`));
  }
  if (Array.isArray(value)) return (value as readonly Json[]).map((item, i) => unplain(item, `${path}[${i}]`));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as { readonly [key: string]: Json })) {
    out[key] = unplain(item, `${path}.${key}`);
  }
  return out;
}


// -------------------------------------------------------------------- read

/**
 * Why a file cannot be used for this park, or null if it can. Asked once, by
 * the driver, before it trusts any of it: a file that fails here is ignored
 * whole and the park is solved, never half-hydrated.
 */
export function parkFileProblem(file: unknown, seed: number): string | null {
  if (typeof file !== 'object' || file === null) return 'not an object';
  const candidate = file as Partial<ParkFile>;
  if (candidate.format !== PARK_FILE_FORMAT) return `format ${String(candidate.format)}, this build reads ${PARK_FILE_FORMAT}`;
  if (candidate.seed !== seed) return `seed ${String(candidate.seed)}, this park is ${seed}`;
  const features = candidate.features as Record<string, unknown> | undefined;
  if (!features) return 'no features';
  const missing = PARK_FILE_FEATURES.filter((name) => features[name] === undefined);
  if (missing.length > 0) return `missing ${missing.join(', ')}`;
  if (!Array.isArray(candidate.planOrder)) return 'no planOrder';
  const built = (features['built'] ?? {}) as Record<string, unknown>;
  const absent = BUILT_DECISIONS.filter((key) => built[key] === undefined);
  if (absent.length > 0) return `its built decisions lack ${absent.join(', ')}`;
  return null;
}
