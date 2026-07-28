import { placedEntry } from '../../world/parkLayout';
import { clearOfPlots } from '../../world/train/plan';

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

function planFerrisExit(): FerrisExit {
  const wheel = placedEntry('ferrisWheel');
  const ex = wheel.entranceX;
  const ez = wheel.entranceZ;
  // The park middle is close enough to the origin for "which side" purposes —
  // exactly the approximation `ferrisKiosk` makes, and the two must agree for
  // the exit to land opposite the kiosk rather than merely near it.
  const towardMiddleX = -ex;
  const towardMiddleZ = -ez;
  const length = Math.hypot(towardMiddleX, towardMiddleZ) || 1;
  const sideX = -towardMiddleZ / length;
  const sideZ = towardMiddleX / length;

  for (let distance = 2.5; distance <= 12; distance += 0.5) {
    const x = ex - sideX * distance;
    const z = ez - sideZ * distance;
    if (clearOfPlots(x, z, 1.2)) return { x, z };
  }
  return { x: ex - sideX * 2.5, z: ez - sideZ * 2.5 };
}

/** The one exit point. Import this; never re-solve. */
export const FERRIS_WHEEL_EXIT: FerrisExit = planFerrisExit();
