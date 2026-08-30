import {
  INTERIOR_HALF_X,
  INTERIOR_HALF_Z,
  INTERIOR_ORIGIN_X,
  INTERIOR_ORIGIN_Z,
  INTERIOR_PLAY_RADIUS,
} from '../../core/constants';
import type { SpaceId } from '../spaces';

/**
 * **The castle's three floors, each its own place.**
 *
 * ARCHITECTURE-DECISIONS Decision 3 and issues #377 / #380, together. Jim,
 * 29 August 2026:
 *
 * > *"the floors of the castle should be like the hotel — disjoint spaces
 * > without overlap … an elevator only to get between them"*
 *
 * and, on how many:
 *
 * > *"the castle also has too many floors and the floors aren't distinct
 * > enough … Maybe just three — mall on the floor, something else in the
 * > middle, and the roof."*
 *
 * So: **three floors, one job each, no two sharing a coordinate.** Five
 * stacked decks told apart by height become three plates hundreds of metres
 * apart, told apart by position — the same trick the interior as a whole has
 * used since it moved six hundred metres from the garden, applied one level
 * down, which is precisely how GAME_DESIGN 31f phrases the request.
 *
 * ## Why this is a leaf module
 *
 * Three files need to agree about which floors exist: `layout.ts` (the plan),
 * `world/spaces.ts` (which space a position is in) and `Building.ts` (the
 * transitions). `spaces.ts` already imports `layout.ts` for `BUILDING_BASE_Y`,
 * so the table cannot live in `layout.ts` without a cycle. It lives here
 * instead, importing nothing but `core/constants`, and everybody imports it.
 * The `SpaceId` import is `import type`, which is erased, so it cannot make
 * one either.
 *
 * ## Why disjoint is worth the work
 *
 * Indoor collision is **height-blind**: a shop counter registered on one deck
 * is an invisible wall on every other deck, and `check:castle` cannot see it —
 * it tests props against keep-outs, not colliders against another deck's
 * furniture. The market's own layout was bent around that fact twice (see
 * `layout.ts`'s `MARKET_BEAM_INSET`), and a stall standing over the great
 * hall's feast table would have walled off the hall below with nothing to
 * catch it. **After the split no two floors share a plan, so that entire class
 * of bug is impossible by construction** — which is also what finally lets
 * castle props have real colliders at all (#376 records that they deliberately
 * get none today, for exactly this reason).
 */

/**
 * How far apart two floors' origins stand, in metres.
 *
 * Decision 3's number. Comfortably beyond `FOG_FAR` plus the visible frame —
 * fog completes about 168 m from the player — and far beyond any tap-ray or
 * play-bounds reach, so no two floors can ever appear in one frame or be
 * confused for one another. The farthest origin is (1200, 600), which keeps
 * float32 positions exact to well under a millimetre.
 */
export const FLOOR_SPACE_SPACING = 300;

/**
 * How far past a floor's own plate still counts as being on it.
 *
 * Decision 3 specifies 120 m, and the existing single-castle test in
 * `world/spaces.ts` already uses the same shape of rule. It has to contain the
 * plate (21.2 x 15.6 m half-extents), the porch and the lift alcove hanging off
 * the east wall, and the whole of {@link INTERIOR_PLAY_RADIUS}, or a child
 * standing at the edge of her own play bounds would be reported as being
 * somewhere else. With {@link FLOOR_SPACE_SPACING} at 300 the bands are 60 m
 * apart at their nearest, so they cannot overlap.
 */
export const CASTLE_FLOOR_RADIUS = 120;

/** The mall: the market, the toilets, the front door. The way in and out. */
export const SPACE_CASTLE_MALL: SpaceId = 'castle.mall';
/** The great hall: throne, feast, hearth, knights. */
export const SPACE_CASTLE_HALL: SpaceId = 'castle.hall';
/** The roof garden, open to the sky, where the ginormous slide launches. */
export const SPACE_CASTLE_ROOF: SpaceId = 'castle.roof';

/**
 * One floor of the castle — the direct analogue of `hotel/layout.ts`'s
 * `HotelRoom`, deliberately so. The hotel is the shipped reference for what
 * Jim asked the castle to become, and a second shape for the same idea would
 * be two definitions of one thing.
 */
export interface CastleFloor {
  readonly space: SpaceId;
  /** 0 mall, 1 great hall, 2 roof garden. The lift's own numbering. */
  readonly index: number;
  /** What the lift panel, the HUD pill and the park map call it. */
  readonly name: string;
  /** And how it says it in one glyph, for the lift's buttons. */
  readonly glyph: string;
  /** The middle of this floor's plate, in world metres. */
  readonly originX: number;
  readonly originZ: number;
  /** Half-extents of the plate. Every floor is the same plate today. */
  readonly halfX: number;
  readonly halfZ: number;
  /**
   * **Is there a ceiling over it?** False for the roof garden, which is
   * genuinely outdoors (GAME_DESIGN.md items 5 and 30c) — the sun keeps its
   * moving shadows there and `InteriorLighting` stays off, exactly as it does
   * on today's top deck.
   */
  readonly roofed: boolean;
}

/**
 * Where floor `index`'s plate stands.
 *
 * Floor 0 keeps the interior's existing origin, so the front door's numbers —
 * its trigger band, its arrival spot, `castleExitBand`'s depth — barely move.
 */
export function floorSpaceOriginX(index: number): number {
  return INTERIOR_ORIGIN_X + index * FLOOR_SPACE_SPACING;
}

/**
 * The three floors, in lift order: ground first.
 *
 * Each is the same plate for now. Decision 3 §5 wants per-floor footprints and
 * clear heights eventually — 31f asks for floors that need not line up at all —
 * and this table is the seam that makes that a per-floor edit rather than a
 * rewrite. Nothing here assumes they are equal.
 */
export const CASTLE_FLOORS: readonly CastleFloor[] = [
  {
    space: SPACE_CASTLE_MALL,
    index: 0,
    name: 'The mall',
    glyph: '🛍️',
    originX: floorSpaceOriginX(0),
    originZ: INTERIOR_ORIGIN_Z,
    halfX: INTERIOR_HALF_X,
    halfZ: INTERIOR_HALF_Z,
    roofed: true,
  },
  {
    space: SPACE_CASTLE_HALL,
    index: 1,
    name: 'The great hall',
    glyph: '👑',
    originX: floorSpaceOriginX(1),
    originZ: INTERIOR_ORIGIN_Z,
    halfX: INTERIOR_HALF_X,
    halfZ: INTERIOR_HALF_Z,
    roofed: true,
  },
  {
    space: SPACE_CASTLE_ROOF,
    index: 2,
    name: 'The roof garden',
    glyph: '🌻',
    originX: floorSpaceOriginX(2),
    originZ: INTERIOR_ORIGIN_Z,
    halfX: INTERIOR_HALF_X,
    halfZ: INTERIOR_HALF_Z,
    roofed: false,
  },
];

/** The floor you walk into from the garden, and leave from. */
export const CASTLE_MALL = CASTLE_FLOORS[0]!;
/** The middle floor. #368's furniture finally has somewhere of its own. */
export const CASTLE_HALL = CASTLE_FLOORS[1]!;
/** The top. The ginormous slide leaves from here — non-negotiable (#380). */
export const CASTLE_ROOF = CASTLE_FLOORS[2]!;

/**
 * Which castle floor a world position is on, or `null` for anywhere else —
 * **purely positional**, exactly as Decision 3 requires.
 *
 * Position alone answering the question is the load-bearing choice, and it is
 * the same one the original interior offset made: no mode flag threads through
 * `CollisionWorld` or `WalkSurfaces`, the sampler stays a pure function, and
 * nothing has to be *told* when the player changes floor. The rejected
 * alternative — every floor at one origin with visibility and collision swapped
 * by a "current floor" flag — was examined in Decision 3 §2 and refused for
 * precisely those reasons.
 */
export function castleFloorAt(x: number, z: number): CastleFloor | null {
  const dz = z - INTERIOR_ORIGIN_Z;
  for (const floor of CASTLE_FLOORS) {
    const dx = x - floor.originX;
    if (dx * dx + dz * dz <= CASTLE_FLOOR_RADIUS * CASTLE_FLOOR_RADIUS) return floor;
  }
  return null;
}

/** The floor with this space id, or `null` for an id from another building. */
export function castleFloorFor(space: SpaceId): CastleFloor | null {
  return CASTLE_FLOORS.find((floor) => floor.space === space) ?? null;
}

/** Floor-local metres to world, on the ground plane. */
export function floorX(floor: CastleFloor, localX: number): number {
  return floor.originX + localX;
}

export function floorZ(floor: CastleFloor, localZ: number): number {
  return floor.originZ + localZ;
}
