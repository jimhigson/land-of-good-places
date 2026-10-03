/**
 * **The castle's front door, in the facade's own frame** — a leaf module
 * (imports only `core/constants`), so the park layout can put the castle's
 * doormat at the foot of its real front steps without importing the castle.
 * `building/layout.ts` re-exports these and builds `ENTRANCE_RAMP` from them.
 */
import { BUILDING_HALF_Z } from '../../core/constants';

/** The door in the facade out in the garden, at the top of the steps. */
export const ENTRANCE_MIN_X = -1;
export const ENTRANCE_MAX_X = 4;

/** How far past the facade (`BUILDING_HALF_Z`) the front steps reach the lawn. */
export const ENTRANCE_STEPS_REACH = 2.8;

/**
 * **The castle's doormat, local to the facade centre**: on the lawn at the foot
 * of the front steps, square in front of the door. The front door faces +Z
 * whatever bearing the castle stands on, so this is where its path arrives.
 */
export const CASTLE_DOORMAT_LOCAL: readonly [number, number] = [
  (ENTRANCE_MIN_X + ENTRANCE_MAX_X) / 2,
  BUILDING_HALF_Z + ENTRANCE_STEPS_REACH,
];
