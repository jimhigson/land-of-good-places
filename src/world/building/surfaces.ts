import { BUILDING_FLOOR_COUNT, BUILDING_FLOOR_HEIGHT, BUILDING_STEP_UP, INTERIOR_ORIGIN_X, INTERIOR_ORIGIN_Z } from '../../core/constants';
import { BUILDING_CENTRE_X, BUILDING_CENTRE_Z } from './layout';
import { clamp01 } from '../../core/mathUtils';
import { terrainHeight } from '../terrain';
import {
  allRamps,
  BALL_PIT_FLOOR_Y,
  BALL_PIT_RADIUS,
  BALL_PIT_X,
  BALL_PIT_Z,
  BUILDING_BASE_Y,
  deckIsSolid,
  deckY,
  insideInterior,
  INTERIOR_GROUND_Y,
  LIFT_SHAFT,
  regionContains,
  type RampDefinition,
} from './layout';

/**
 * A platform that moves — the lift car, the floating bubble.
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
 * Anything within this of the interior origin is in the building's own space.
 *
 * The two spaces are 848 m apart, so the exact number does not matter as long as
 * it comfortably contains the interior and comes nowhere near the park.
 */
const INTERIOR_REGION_RADIUS = 200;

/** True when a world position is inside the building's own space at all. */
export function inInteriorSpace(x: number, z: number): boolean {
  const dx = x - INTERIOR_ORIGIN_X;
  const dz = z - INTERIOR_ORIGIN_Z;
  return dx * dx + dz * dz < INTERIOR_REGION_RADIUS * INTERIOR_REGION_RADIUS;
}

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
    const interior = inInteriorSpace(x, z);
    const localX = x - (interior ? INTERIOR_ORIGIN_X : BUILDING_CENTRE_X);
    const localZ = z - (interior ? INTERIOR_ORIGIN_Z : BUILDING_CENTRE_Z);
    const ceiling = y + BUILDING_STEP_UP;

    let best = interior ? INTERIOR_GROUND_Y : groundAt(x, z);

    // Ramps and landings — stairs, escalators, the facade's entrance steps.
    const space = interior ? 'interior' : 'garden';
    for (const ramp of this.ramps) {
      if (ramp.space !== space) continue;
      if (!regionContains(ramp.footprint, localX, localZ)) continue;
      const height = BUILDING_BASE_Y + rampHeight(ramp, localX, localZ);
      if (height <= ceiling && height > best) best = height;
    }

    // Deck slabs, skipping any deck that has a hole here. Only the interior has
    // decks — the tower in the garden is a facade with a door in it.
    if (interior && insideInterior(localX, localZ)) {
      for (let deck = BUILDING_FLOOR_COUNT - 1; deck >= 0; deck -= 1) {
        const height = deckY(deck);
        if (height > ceiling || height <= best) continue;
        if (!deckIsSolid(deck, localX, localZ)) continue;
        best = height;
        break; // decks are ordered top-down, so the first hit is the highest
      }
    }

    // Lifts and bubbles — and the bridges' humps, the one platform kind
    // whose surface height varies across its own footprint.
    for (const platform of this.platforms) {
      if (!platform.covers(x, z)) continue;
      const height = platform.surfaceYAt ? platform.surfaceYAt(x, z) : platform.surfaceY;
      if (height <= ceiling && height > best) best = height;
    }

    return best;
  }

  /**
   * Which deck a walker at this world position counts as being on, or `null`
   * when they are not in the building at all. Used for the cutaway view.
   */
  deckAt(x: number, z: number, y: number): number | null {
    if (!inInteriorSpace(x, z)) return null;
    const localX = x - INTERIOR_ORIGIN_X;
    const localZ = z - INTERIOR_ORIGIN_Z;
    // Generous margin: it also has to cover the porch outside the south door
    // and the lift shaft hanging off the east wall, otherwise stepping onto
    // either pops the whole tower back into view.
    const inShell = insideInterior(localX, localZ, 4);
    const inLift = regionContains(LIFT_SHAFT, localX, localZ);
    if (!inShell && !inLift) return null;
    if (y < BUILDING_BASE_Y - 2) return null;

    const raw = Math.round((y - BUILDING_BASE_Y) / BUILDING_FLOOR_HEIGHT);
    return raw < 0 ? 0 : raw > BUILDING_FLOOR_COUNT - 1 ? BUILDING_FLOOR_COUNT - 1 : raw;
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
