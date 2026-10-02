/**
 * **A second World in the same process, the same park a fresh process builds.**
 *
 * The `World` adopts the plan's ground-claims registry (`parkPlanClaims()`) and
 * commits its world phase — trees, bushes, lamps, the road — into it. So a
 * second `World` built in the same process adopts a registry that already holds
 * the first one's claims, and its world phase refuses differently: on seed 5
 * the second World placed 534 bushes where the first placed 536 (measured,
 * 2 Oct 2026). A check measured on that World is measuring a park CI never
 * builds.
 *
 * So the registry is snapshotted straight after the plan solves, before any
 * World commits, and put back before every fresh World. Contributions are
 * immutable (every commit replaces the feature's entry with a new one), so the
 * map's entries and the commit clock are the whole state.
 */
import type { GroundClaims } from '../../src/boot/groundClaims.ts';

interface RegistryState {
  contributions: Map<string, unknown>;
  commitClock: number;
}

/** Solve the plan now and remember its registry as the plan left it. Returns the restorer. */
export async function snapshotPlanClaims(): Promise<() => void> {
  const { parkPlanClaims, solveParkPlanNow } = await import('../../src/world/parkPlan.ts');
  solveParkPlanNow();
  const registry = parkPlanClaims() as unknown as GroundClaims & RegistryState;
  if (!(registry.contributions instanceof Map) || typeof registry.commitClock !== 'number') {
    throw new Error('freshWorld: GroundClaims no longer keeps `contributions`/`commitClock` — the snapshot cannot restore it');
  }
  const entries = [...registry.contributions.entries()];
  const clock = registry.commitClock;
  return () => {
    registry.contributions.clear();
    for (const [feature, contribution] of entries) registry.contributions.set(feature, contribution);
    registry.commitClock = clock;
  };
}
