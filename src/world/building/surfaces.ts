import { BUILDING_STEP_UP } from '../../core/constants';
import { BUILDING_CENTRE_X, BUILDING_CENTRE_Z } from './layout';
import { clamp01 } from '../../core/mathUtils';
import { terrainHeight } from '../terrain';
import { castleFloorAt, type CastleFloor } from './floors';
import {
  allRamps,
  BALL_PIT_FLOOR_Y,
  BALL_PIT_RADIUS,
  BALL_PIT_X,
  BALL_PIT_Z,
  BUILDING_BASE_Y,
  insideInterior,
  INTERIOR_GROUND_Y,
  regionContains,
  type RampDefinition,
} from './layout';

/**
 * A platform that moves — the lift car, the trampoline pad.
 *
 * The sampler asks it, every time, where its top surface is and whether a point
 * is standing on it. That is the whole of the "moving platform physics" in this
 * game: if the surface under your feet goes up, so do you.
 */
export interface MovingPlatform {
  /** World height of the surface you stand on. */
  readonly surfaceY: number;
  /** Does this world-space point sit on the platform? */
  covers(x: number, z: number): boolean;
  /**
   * Optional height-varying answer for a platform whose surface is not one
   * flat level — the railway bridges' smooth hump (a continuous rise and
   * fall, Jim's 2026-08-23 bridge feedback) is the one user. Only ever
   * consulted where {@link covers} is true; a platform without it is flat
   * at {@link surfaceY}, exactly as every platform always was.
   */
  surfaceYAt?(x: number, z: number): number;
}

/**
 * A point along a {@link LevelConnector}'s walk path, world metres.
 * `y` is the walking surface's height at that point.
 */
export interface ConnectorPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * A declared way between two walkable **levels** — a stair, a ramp — as the
 * walk path along it, first point on the lower level's floor, last point on
 * the upper one's, both stood a stride clear of the connector's own flanks.
 *
 * Whatever builds a stair declares one of these, **derived from the same plan
 * data the stair's geometry and walk surfaces come from** (the lobby's is
 * `hotel/layout.ts`'s `mezzanineWalkConnectors`), so the path can never drift
 * from the treads. `NavGrid` consumes them as ordinary graph edges between
 * the levels — see ARCHITECTURE-DECISIONS.md Decision 11 for why a declared
 * edge and not the lattice: a stair channel between solid flanks is narrower
 * than any lattice pitch once the flanks are fattened by the walker's own
 * radius, so no grid, however layered, can find its way through; the plan
 * that built the stair is the one authority that knows the way.
 */
export interface LevelConnector {
  readonly points: readonly ConnectorPoint[];
}

/**
 * **`inInteriorSpace` is gone; `floors.ts`'s `castleFloorAt` replaces it.**
 *
 * It answered "is this position inside the castle at all?" with one radius
 * round one origin, which was the right question while the castle was one
 * stacked space. Since the split there are three, and the useful question is
 * *which* — so the test lives with the floor table that knows the answer,
 * rather than being a second copy of the arithmetic here. That is the same
 * move `world/spaces.ts` made in the same commit.
 */

/**
 * Where the ground is, for anything that walks.
 *
 * `Player` normally asks `terrainHeight()`; once the building exists it asks
 * this instead, which answers with whichever walkable surface is highest at that
 * point *and* within stepping distance below the walker's feet. That single rule
 * gives multi-storey floors, stairs, escalators, moving lifts and holes you can
 * fall through, without a physics engine anywhere in sight.
 *
 * It answers for **both spaces**, because the player is only ever in one of them
 * and the two are hundreds of metres apart: out in the park it is the terrain and
 * the facade's front steps, and in the building's own space it is the decks, the
 * ramps and the plaza floor underneath them.
 */
export class WalkSurfaces {
  private readonly ramps: readonly RampDefinition[] = allRamps();
  private readonly platforms: MovingPlatform[] = [];
  private readonly levelConnectors: LevelConnector[] = [];

  addPlatform(platform: MovingPlatform): void {
    this.platforms.push(platform);
  }

  /**
   * Declares a walk path between two levels. Register at build time, before
   * the first route is asked for — `NavGrid` reads the list when it builds a
   * lattice, and a connector added later is invisible until the next rebuild.
   */
  addConnector(points: readonly ConnectorPoint[]): void {
    if (points.length < 2) throw new Error('a level connector needs at least two points');
    this.levelConnectors.push({ points });
  }

  /** Every declared way between levels. See {@link LevelConnector}. */
  get connectors(): readonly LevelConnector[] {
    return this.levelConnectors;
  }

  /**
   * Highest walkable surface at (x, z) that is no more than one step above `y`.
   * Coordinates are world space.
   */
  sample(x: number, z: number, y: number): number {
    const floor = castleFloorAt(x, z);
    const localX = x - (floor ? floor.originX : BUILDING_CENTRE_X);
    const localZ = z - (floor ? floor.originZ : BUILDING_CENTRE_Z);
    const ceiling = y + BUILDING_STEP_UP;

    // Inside the castle the ground is either this floor's own plate or, off the
    // edge of it, the plaza disc that floor floats above. Out in the park it is
    // the terrain. **There is no stack to scan**: the five-deck top-down loop,
    // `deckIsSolid` and `DECK_HOLES` are all gone, because a floor is now a
    // single unbroken slab and the only way off it is the lift.
    let best = floor
      ? insideInterior(localX, localZ)
        ? BUILDING_BASE_Y
        : INTERIOR_GROUND_Y
      : groundAt(x, z);

    // Ramps and landings — the porch, the lift pit, the facade's entrance
    // steps. Every castle floor carries the same set, because each one has its
    // own porch and its own lift alcove at the same floor-local spot; a lift
    // that wandered from floor to floor would read as broken.
    const space = floor ? 'interior' : 'garden';
    for (const ramp of this.ramps) {
      if (ramp.space !== space) continue;
      if (ramp.onlyFloor !== undefined && ramp.onlyFloor !== floor?.index) continue;
      if (!regionContains(ramp.footprint, localX, localZ)) continue;
      const height = BUILDING_BASE_Y + rampHeight(ramp, localX, localZ);
      if (height <= ceiling && height > best) best = height;
    }

    // The bridges' humps, the one platform kind whose surface height varies
    // across its own footprint. The castle has no moving platforms any more —
    // the lift car is gone, and with it the last reason the interior had one.
    for (const platform of this.platforms) {
      if (!platform.covers(x, z)) continue;
      const height = platform.surfaceYAt ? platform.surfaceYAt(x, z) : platform.surfaceY;
      if (height <= ceiling && height > best) best = height;
    }

    return best;
  }

  /**
   * **Which castle floor a walker is on**, or `null` out in the park.
   *
   * This was `deckAt(x, z, y)`, and the `y` is what has gone: it had to round
   * the walker's height to the nearest storey, because five decks shared one
   * coordinate system and height was the only thing telling them apart. Now
   * **position alone answers**, which is Decision 3's load-bearing choice — the
   * sampler stays a pure function of where you are, and a child in mid-air over
   * the great hall is unambiguously in the great hall rather than being rounded
   * onto the floor above.
   *
   * The generous margin the old version needed — to cover the porch outside the
   * south door and the lift alcove hanging off the east wall, or stepping onto
   * either popped the whole tower out of view — is `CASTLE_FLOOR_RADIUS`'s job
   * now, and it is 120 m rather than 4.
   */
  floorAt(x: number, z: number): CastleFloor | null {
    return castleFloorAt(x, z);
  }
}

// ------------------------------------------------------------------ helpers

/**
 * The natural ground — the terrain, except inside the ball pit where it is
 * scooped out. Handled here rather than in `terrain.ts` because the pit is a
 * built thing, not a landform, and `terrainHeight` must stay a pure function of
 * the hills for everything else that samples it.
 */
function groundAt(x: number, z: number): number {
  const dx = x - BALL_PIT_X;
  const dz = z - BALL_PIT_Z;
  if (dx * dx + dz * dz < BALL_PIT_RADIUS * BALL_PIT_RADIUS) return BALL_PIT_FLOOR_Y;
  return terrainHeight(x, z);
}

/** Local height of a ramp at a point inside its footprint, clamped at both ends. */
function rampHeight(ramp: RampDefinition, localX: number, localZ: number): number {
  const value = ramp.axis === 'x' ? localX : localZ;
  const span = ramp.to - ramp.from;
  const t = span === 0 ? 0 : clamp01((value - ramp.from) / span);
  return ramp.yFrom + (ramp.yTo - ramp.yFrom) * t;
}

/** Exported for the ball pit builder, which needs the same scooped ground. */
export { groundAt as walkableGroundAt };
