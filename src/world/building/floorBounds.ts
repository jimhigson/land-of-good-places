import { INTERIOR_PLAY_RADIUS } from '../../core/constants';
import { circleBoundary, rectanglesBoundary, type ParkBoundary } from '../boundary';
import { floorX, floorZ, type CastleFloor } from './floors';
import { LIFT_SHAFT, ROOF_EDGE_X, ROOF_EDGE_Z, TOP_DECK } from './layout';

/**
 * **The soft edge of a castle floor** — what holds her inside the storey she is
 * on, at every height.
 *
 * A storey with walls to its ceiling is held by them, and a generous circle
 * round its plate is all the leash it needs. **The roof garden is held at the
 * battlement's outer face** (`ROOF_EDGE_X`/`_Z`), with the lift's alcove: since
 * every solid has its real top (17 Oct 2026) the battlement is the 1.6 m of
 * merlon it is drawn as, and a trough beside it is a step up to it — so a jump
 * along the rampart was a jump off the castle, onto three hundred metres of
 * nothing. The edge of the floor is now the edge of the space, exactly as the
 * park's boundary wall stands inside a soft edge of its own: the stone stays the
 * height Jim chose (#462), and no height of jump carries her past it.
 */
export function castleFloorBounds(floor: CastleFloor): ParkBoundary {
  if (floor.index !== TOP_DECK) return circleBoundary(INTERIOR_PLAY_RADIUS, floor.originX, floor.originZ);
  return rectanglesBoundary([
    {
      minX: floorX(floor, -ROOF_EDGE_X),
      maxX: floorX(floor, ROOF_EDGE_X),
      minZ: floorZ(floor, -ROOF_EDGE_Z),
      maxZ: floorZ(floor, ROOF_EDGE_Z),
    },
    {
      minX: floorX(floor, LIFT_SHAFT.minX),
      maxX: floorX(floor, LIFT_SHAFT.maxX),
      minZ: floorZ(floor, LIFT_SHAFT.minZ),
      maxZ: floorZ(floor, LIFT_SHAFT.maxZ),
    },
  ]);
}
