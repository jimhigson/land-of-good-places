import type { GroundClaims } from './groundClaims';

/**
 * **A one-slot letterbox for the registry the generator claimed against.**
 *
 * The same mechanism as `world/pathsPrewarm.ts`, `train/prewarm.ts` and the
 * rest, and deliberately not a second design — see those files for the full
 * argument. What differs is only what it carries.
 *
 * ## Why a letterbox and not a module-level `new GroundClaims()`
 *
 * There must be exactly **one** registry per park, and it must be the
 * scheduler's: `boot/parkGeneration.ts` owns the round-robin, so it owns the
 * ground its tasks claim. But the scheduler finishes before `new World(...)`
 * is called (`journeyDirector` holds the bus until generation is done), and
 * `Game` does not hand the generator to the `World` it builds — so there is no
 * argument to thread it down.
 *
 * The obvious shortcut is an `export const claims = new GroundClaims()` that
 * everybody imports. That is the thing this project's design explicitly
 * forbids: a module-level singleton is one instance only for as long as
 * nothing duplicates the module graph, and it also silently outlives the park
 * it describes. A slot that is **filled by the one owner and emptied as it is
 * read** has neither problem.
 *
 * ## Why it is take-once
 *
 * {@link takePrewarmedGroundClaims} clears the slot as it reads it, so a
 * registry can never be served twice. A stale registry is the dangerous
 * failure: its claims are a function of the seed, and a leftover from an
 * earlier park would have every placer negotiating against ground that no
 * longer exists — silently, and only on the second park built in one process.
 *
 * Nothing calls {@link offerPrewarmedGroundClaims} in Node: the harness,
 * `check:park` and `test:procgen` never run the generator, so `World` builds
 * its own registry and the claims it holds are exactly the ones the park's own
 * builders made. That is why a check may read `World.groundClaims` without
 * having to boot a generator first.
 */
let waiting: GroundClaims | null = null;

/**
 * Hands over the registry the round-robin claimed against. The next `World`
 * built takes it. `boot/parkGeneration.ts` is the only caller.
 */
export function offerPrewarmedGroundClaims(claims: GroundClaims): void {
  waiting = claims;
}

/** Takes the waiting registry, if there is one, emptying the slot. */
export function takePrewarmedGroundClaims(): GroundClaims | null {
  const claims = waiting;
  waiting = null;
  return claims;
}

/** Empties the slot without reading it — for a test that builds two parks. */
export function forgetPrewarmedGroundClaimsForTesting(): void {
  waiting = null;
}
