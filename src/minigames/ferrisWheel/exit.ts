import { decideBuilt } from '../../world/prebuilt/built';
import { lazyView } from '../../boot/lazyView';
import { registerPlanCache } from '../../boot/planCaches';

/**
 * Where the Space Ferris Wheel sets a rider down: a couple of metres to the
 * side of its entrance doormat, so its dismount has a home the way a
 * coaster's does (`coaster/plan.ts`) and a train station's does
 * (`train/plan.ts`) — solved once at module load from the placed layout
 * alone, so `paths.ts` can give it a node before the ride is ever built.
 *
 * Deliberately the *opposite* side from the kiosk
 * (`minigames/stallPlacement.ts`'s `ferrisKiosk`, which offsets the same
 * entrance point the other way): the same maths, negated, so getting off
 * never lands a child back in the queue.
 */
export interface FerrisExit {
  readonly x: number;
  readonly z: number;
}

/** The one exit point. Import this; never re-solve. */
let ferrisExitMemo: FerrisExit | null = null;
/** A view: the wheel stands where the layout the park's driver decided put it, and the exit follows. */
export const FERRIS_WHEEL_EXIT: FerrisExit = lazyView(
  () => (ferrisExitMemo ??= decideBuilt('ferrisExit', (solver) => solver.ferrisExit())),
);
registerPlanCache(() => {
  ferrisExitMemo = null;
});
