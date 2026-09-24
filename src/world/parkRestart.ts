import { hashString } from '../core/mathUtils';

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
 * records every restart and what forced it. Everything else reads the answer:
 *
 * - **Node**: `LGP_PARK_RESTART=r`, set by the root loop for its attempts and
 *   by any check that measures the accepted park.
 * - **Browser**: `globalThis.__LGP_PARK_RESTART__`, which the prebuilt-park
 *   loader sets from the park file before the park's modules evaluate. It must
 *   be known at import, because the boundary is a module constant.
 *
 * Read once, at module load, exactly like the seed.
 */
export const PARK_RESTART: number = resolveRestart();

function readRestart(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function resolveRestart(): number {
  try {
    const nodeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
    const fromEnv = readRestart(nodeProcess?.env?.['LGP_PARK_RESTART']);
    if (fromEnv !== null) return fromEnv;
  } catch {
    // no process
  }
  return readRestart((globalThis as { __LGP_PARK_RESTART__?: unknown }).__LGP_PARK_RESTART__) ?? 0;
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
