import { hashString } from '../core/mathUtils';
import { ACCEPTED_RESTARTS } from './acceptedRestarts';

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
 * records every restart and what forced it. Its answer for every shipped seed
 * is recorded in `acceptedRestarts.ts` (generated, and verified by
 * `test:procgen`, which builds each recorded park and asks the measures
 * again). Everything else reads that answer — the game and every check alike,
 * at import, with no search. Two overrides, both explicit:
 *
 * - **Node**: `LGP_PARK_RESTART=r`, set by the loop for each attempt.
 * - **Browser**: `globalThis.__LGP_PARK_RESTART__`, for a park file that
 *   carries its own restart; it must be set before the park's modules
 *   evaluate, because the boundary is a module constant.
 *
 * Read once, at module load, exactly like the seed (`parkManifest.ts`'s
 * `PARK_RESTART`). Without an override, a seed takes the restart the loop
 * recorded for it in `acceptedRestarts.ts` — so every check, and the game,
 * builds the accepted park of a shipped seed with no search at all.
 */
export function restartFor(seed: number): number {
  return overriddenRestart() ?? ACCEPTED_RESTARTS[seed] ?? 0;
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
