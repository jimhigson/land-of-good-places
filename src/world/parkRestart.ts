import { hashString } from '../core/mathUtils';
import { SUPPORTED_PARK_SEEDS } from './parkSeedPool';

/**
 * **Backtracking to zero: the whole park, started again.**
 *
 * Jim, 24 Sep 2026: *"there should be no 'fail some placement checks'
 * GUARANTEED STRUCTURALLY because ALL FEATURES SHOULD BE BACKTRACKABLE — this
 * means that even in the case of total failure, backtracking to zero will
 * work, effectively starting again."*
 *
 * The round-robin driver (`boot/parkSolve.ts`) backtracks inside one park:
 * retry, accommodate, unwind, decision zero. What it cannot see is a property
 * of the *finished* park — a duck bar that slows nobody, a camera that runs
 * backwards, a doormat a welcome sign has sealed off. Those are measured on the
 * built `World` by the acceptance measures (`test/procgen/invariants.ts` and
 * `scripts/lib/parkFindings.mts`, one owner each), and when any of them fails
 * the park is thrown away and **started again from zero with a different
 * decision stream**. That is this number.
 *
 * A restart is the root rung of the ladder. `PARK_RESTART = r` makes every
 * seeded choice in the park — the boundary, the layout, every ride's search,
 * every tree — draw from {@link generationSeed}`(seed, r)` instead of `seed`,
 * so restart `r` is a genuinely independent park, exactly as a fresh seed
 * would be, while the park's identity (the number a child's profile
 * remembers, the one `?seed=` names) stays `seed`. Restart 0 is the seed
 * itself, unchanged: a park that passes first time is the park it always was.
 *
 * ## Who chooses it
 *
 * Only the root loop (`scripts/lib/acceptedPark.mts`), which tries
 * `r = 0, 1, 2, …`, each in a fresh process, until the whole park passes, and
 * records every restart and what forced it. **Nothing is committed**: the
 * answer is the loop's verdict at the exact source being run, cached on its
 * hash (`acceptanceSourceHash`), and taken afresh whenever the generator or a
 * measure changes. (A committed table, `acceptedRestarts.ts`, used to hold it.
 * Every generator change made it stale until someone re-ran the loop by hand,
 * and merges waited on that. Jim, 2 Oct 2026: "that should be done by a
 * script, no?")
 *
 * So a supported seed's restart comes from, in order:
 *
 * - **an explicit override**: `LGP_PARK_RESTART=r` in Node, set by the loop
 *   for each attempt; `globalThis.__LGP_PARK_RESTART__` in the browser, for a
 *   park file that carries its own restart (it must be set before the park's
 *   modules evaluate, because the boundary is a module constant);
 * - **the resolver** a Node process installs (`__LGP_RESOLVE_RESTART__`:
 *   `scripts/ts-extension-resolver-register.mjs`, and vitest's setup file),
 *   which reads the cached verdict or runs the loop for that seed;
 * - otherwise **0**, the seed's own park. A browser with no park file has no
 *   way to run the loop, so it builds restart 0; the prebuilt park files
 *   (#705) are what carry the accepted restart to it.
 *
 * Seeds outside `SUPPORTED_PARK_SEEDS` are never resolved: a sweep over
 * arbitrary seeds measures each seed's own park unless it asks otherwise.
 *
 * Read once, at module load, exactly like the seed (`parkManifest.ts`'s
 * `PARK_RESTART`).
 */
export function restartFor(seed: number): number {
  return overriddenRestart() ?? resolvedRestart(seed) ?? 0;
}

/** The installed resolver's answer for a supported seed; null with no resolver. */
function resolvedRestart(seed: number): number | null {
  if (!SUPPORTED_PARK_SEEDS.includes(seed)) return null;
  const resolve = (globalThis as { __LGP_RESOLVE_RESTART__?: unknown }).__LGP_RESOLVE_RESTART__;
  if (typeof resolve !== 'function') return null;
  return readRestart((resolve as (seed: number) => unknown)(seed));
}

function readRestart(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

/** An explicit restart: `LGP_PARK_RESTART` in Node, `__LGP_PARK_RESTART__` in a browser. */
export function overriddenRestart(): number | null {
  try {
    const nodeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
    const fromEnv = readRestart(nodeProcess?.env?.['LGP_PARK_RESTART']);
    if (fromEnv !== null) return fromEnv;
  } catch {
    // no process
  }
  return readRestart((globalThis as { __LGP_PARK_RESTART__?: unknown }).__LGP_PARK_RESTART__);
}

/**
 * The seed every generator draws from for restart `restart` of park `seed`.
 * Restart 0 is `seed` itself; any other is a hash of both, so no two restarts
 * of one park, nor the same restart of two parks, share a stream.
 */
export function generationSeed(seed: number, restart: number): number {
  if (restart === 0) return seed;
  return hashString(`park-restart/${seed}/${restart}`);
}
