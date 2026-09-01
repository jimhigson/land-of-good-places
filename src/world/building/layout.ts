import { PALETTE } from '../../core/palette';
import { placedEntry } from '../parkLayout';
import { BUILDING_CENTRE_NUDGE } from '../../core/constants';

/**
 * The facade's centre: the placed 'building' plot, nudged towards the park
 * middle so the interior's corners stay inside the soft play boundary — the
 * same nudge the authored park used, now applied from wherever the solver
 * put the castle. The seed sweep caught the facade still standing at the
 * old authored coordinates while its plot, its rail avoidance and its
 * keep-outs had all moved: 85 m of 'building' at seed 7.
 */
const FACADE_ANCHOR = placedEntry('building');
const FACADE_LENGTH = Math.hypot(FACADE_ANCHOR.x, FACADE_ANCHOR.z) || 1;
export const BUILDING_CENTRE_X =
  FACADE_ANCHOR.x - (FACADE_ANCHOR.x / FACADE_LENGTH) * BUILDING_CENTRE_NUDGE;
export const BUILDING_CENTRE_Z =
  FACADE_ANCHOR.z - (FACADE_ANCHOR.z / FACADE_LENGTH) * BUILDING_CENTRE_NUDGE;
import {
  BUILDING_FLOOR_HEIGHT,
  BUILDING_HALF_X,
  BUILDING_HALF_Z,
  BUILDING_PLINTH,
  BUILDING_SLAB,
  BUILDING_WALL_THICKNESS,
  INTERIOR_HALF_X,
  INTERIOR_HALF_Z,
  INTERIOR_ORIGIN_X,
  INTERIOR_ORIGIN_Z,
  INTERIOR_PLATE_SHRINK,
  INTERIOR_PLAZA_DROP,
  PLAYER_RADIUS,
} from '../../core/constants';
import { CASTLE_HALL, CASTLE_MALL, CASTLE_ROOF } from './floors';
import { TAP_FINGER_METRES } from '../tapSpacing';
import { terrainHeight } from '../terrain';

/**
 * The floor plan of the big building, as data.
 *
 * Everything here is in **building-local metres**: `x` and `z` are measured from
 * the middle of the footprint, and `y = 0` is the ground-floor deck. Deck `k`
 * sits at `y = k * BUILDING_FLOOR_HEIGHT`.
 *
 * Keeping the plan as a table rather than scattering numbers through the
 * builders means the walkable-surface sampler (`surfaces.ts`) and the geometry
 * (`Shell.ts`, `Stairs.ts`, …) can never disagree about where a hole is.
 *
 * The one rule that must not be broken: **every hole in a deck has to be fully
 * spanned by a ramp or platform, with solid deck at both ends — or, where it
 * is walked onto directly rather than crossed (the trampoline well, the
 * helter-skelter), fully guarded by a rail and a
 * matching collider (see `ShaftGuards.ts`).** Otherwise a child walking
 * towards the stairs drops through the floor instead.
 *
 * ## Two spaces
 *
 * Since the family asked for a building that is *bigger on the inside*, "the
 * building" is two separate places that never appear in the same frame:
 *
 * - the **facade**, a 24 x 18 m tower standing in the garden at
 *   (`BUILDING_CENTRE_X`, `BUILDING_CENTRE_Z`). It is scenery with a door in it.
 * - the **interior**, a 42 x 31 m floor plate at
 *   (`INTERIOR_ORIGIN_X`, `INTERIOR_ORIGIN_Z`) — six hundred metres away, which
 *   is past the terrain disc *and* past the far fog plane, so the park cannot
 *   leak into the interior nor the interior into the park.
 *
 * `worldX()` / `worldZ()` map interior-local to world, and `facadeX()` /
 * `facadeZ()` do the same for the shell in the garden. Everything that used to
 * say "the building" and meant "where you walk about" goes through the first
 * pair, which is why moving the whole interior six hundred metres sideways cost
 * almost no code.
 */

// --------------------------------------------------------------- geometry

/** Ground-floor deck height in world units. Deck 0 is level; the site is not. */
export const BUILDING_BASE_Y = highestTerrainUnderFootprint() + BUILDING_PLINTH;

/**
 * The interior's own ground, a little below its ground-floor deck.
 *
 * The interior region has no terrain — it is not part of the hilltop. A single
 * soft plaza disc under the floor plate gives the windows something to look out
 * at, gives the roof terrace a "we are very high up" drop, and gives anybody who
 * walks off the edge of deck zero somewhere to land.
 */
export const INTERIOR_GROUND_Y = BUILDING_BASE_Y - INTERIOR_PLAZA_DROP;

/**
 * The three floors by name, so nothing has to type a bare `0`, `1` or `2`.
 *
 * `world/building/floors.ts` is the one owner of what the floors *are*; these
 * are just its indices under the names the rest of this file already uses.
 */
export const MALL_DECK = CASTLE_MALL.index;
export const HALL_DECK = CASTLE_HALL.index;

/**
 * Index of the topmost floor. It is the roof garden, and it is outdoors.
 *
 * It no longer means "the top of a stack" — the floors are disjoint spaces —
 * only "the one with sky over it". Everything that used to ask `deck ===
 * TOP_DECK` to mean "is this outdoors?" should ask the floor's own `roofed`
 * flag instead; this survives for the builders that genuinely index by storey.
 */
export const TOP_DECK = CASTLE_ROOF.index;

/** World height of deck `index`. */
export function deckY(index: number): number {
  return BUILDING_BASE_Y + index * BUILDING_FLOOR_HEIGHT;
}

/** Interior-local -> world on the ground plane. */
export function worldX(localX: number): number {
  return INTERIOR_ORIGIN_X + localX;
}

export function worldZ(localZ: number): number {
  return INTERIOR_ORIGIN_Z + localZ;
}

/**
 * An **authored** interior-local coordinate, moved onto today's plate (#403).
 *
 * Most of the interior derives from `INTERIOR_HALF_X` / `INTERIOR_HALF_Z` and
 * so resized for free when the plate halved its area. The numbers below did
 * not: they were typed as absolute metres on the 60 x 44 m plate, and left
 * alone they would have put the stairwell and the helter-skelter outside the
 * west and east walls. `onPlate` is what those numbers go through, so the
 * whole room still has *one* owning constant.
 *
 * ## Scale anchors, never parts
 *
 * This multiplies a **position**. It must never be applied to an extent, a
 * radius or a half-width: the entire point of #403 is that the same furniture
 * stands on half the floor, so furniture keeps its authored size and only its
 * anchor comes in. A composite — the stairs' two flights, the helter's shaft
 * and its entry pad, the toilet room and its fittings — is scaled **once, at
 * its anchor**, with its parts laid out from that anchor as before. Scaling
 * each part's own coordinate instead pulls the parts together and the sizes
 * do not follow: applied naively to `stairFlights`, the two flights overlapped
 * by 0.72 m and left 0.36 m of open slot down each side of the stairwell,
 * which is architecture review S5's bug rebuilt from scratch.
 *
 * ## What had to be told rather than deriving (the #403 findings)
 *
 * Everything on this list hard-coded a position that could have been derived,
 * and each one is a place where a future resize will need this same treatment:
 *
 * - `STAIRWELL` and `stairFlights` each typed the same four numbers, so the
 *   well "matches the flights" only by hand. Both now come off `STAIR_AXIS_X`.
 * - `ESCALATOR_WELL` and `escalatorRamp`, the same pairing.
 * - `HELTER_ENTRY_X` typed 15.4 against a shaft edge at 16.5 — a 1.1 m gap
 *   held by arithmetic nobody had written down. It is now that subtraction.
 * - `STAIR_STAND_Z` typed 5.2 against a flight ending at 3.3, likewise.
 * - `TOILET_STAND/PAN/BASIN` were three absolute points inside a fourth
 *   absolute rectangle. They are now offsets from the room's own centre.
 * - `scripts/checkShopSpacing.mjs` keeps a hand-copied duplicate of
 *   `INTERIOR_HALF_X/Z`, every shop x, and `TOILET_ROOM` — deliberately, and
 *   documented as such, but it does mean this resize had to be typed twice.
 */
export function onPlate(authored: number): number {
  return authored * INTERIOR_PLATE_SHRINK;
}

/** Facade-local (the shell in the garden) -> world on the ground plane. */
export function facadeX(localX: number): number {
  return BUILDING_CENTRE_X + localX;
}

export function facadeZ(localZ: number): number {
  return BUILDING_CENTRE_Z + localZ;
}

function highestTerrainUnderFootprint(): number {
  let highest = -Infinity;
  for (let x = -BUILDING_HALF_X; x <= BUILDING_HALF_X; x += 1.5) {
    for (let z = -BUILDING_HALF_Z; z <= BUILDING_HALF_Z; z += 1.5) {
      const h = terrainHeight(BUILDING_CENTRE_X + x, BUILDING_CENTRE_Z + z);
      if (h > highest) highest = h;
    }
  }
  return highest;
}

// ------------------------------------------------------------------ holes

export interface RectRegion {
  readonly kind: 'rect';
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface CircleRegion {
  readonly kind: 'circle';
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

export type Region = RectRegion | CircleRegion;

export function rect(minX: number, maxX: number, minZ: number, maxZ: number): RectRegion {
  return { kind: 'rect', minX, maxX, minZ, maxZ };
}

export function circle(x: number, z: number, radius: number): CircleRegion {
  return { kind: 'circle', x, z, radius };
}

export function regionContains(region: Region, x: number, z: number): boolean {
  if (region.kind === 'rect') {
    return x >= region.minX && x <= region.maxX && z >= region.minZ && z <= region.maxZ;
  }
  const dx = x - region.x;
  const dz = z - region.z;
  return dx * dx + dz * dz <= region.radius * region.radius;
}

/**
 * **There are no shafts, and no holes, any more.**
 *
 * `DeckHole`, `BUILDING_SHAFTS`, `DECK_HOLES`, `deckIsSolid`, `STAIRWELL`,
 * `ESCALATOR_WELL`, `TRAMPOLINE_SHAFT` and `HELTER_SHAFT` all stood here until
 * the floors became separate spaces (#377/#380). A shaft is a hole through a
 * slab so that something can travel between two storeys, and there are no two
 * storeys left to travel between: the lift is the only way between floors, and
 * it does not move anything through a hole — it changes which space you are in.
 *
 * This is the single largest deletion in the split and the one with the
 * longest tail of consequences, all good:
 *
 * - **The `keepOutsFor` / `BUILDING_SHAFTS` trap is gone by construction.**
 *   Prop placers had to consult `BUILDING_SHAFTS` *separately* from
 *   `DECK_HOLES`, because a shaft is not only an absence of floor — it also
 *   carries a structure down through storeys whose floor is perfectly solid.
 *   Five different agents missed that in one week, and it is how the
 *   helter-skelter came down through the great hall's dinner table while
 *   `check:castle` stayed green. There is now nothing to remember.
 * - **The deck-fallthrough invariant has nothing left to prove.** Every hole
 *   had to be fully spanned by a ramp or fully guarded by a rail and a
 *   collider, or a child walking towards the stairs dropped through the floor.
 *   That was two of the last three P0s (architecture review S5 and S14).
 * - **`ShaftGuards.ts` is deleted outright** — there is nothing to guard.
 */

/** Is this interior-local point on the floor plate at all? */
export function insideInterior(localX: number, localZ: number, margin = 0): boolean {
  return (
    localX >= -INTERIOR_HALF_X - margin &&
    localX <= INTERIOR_HALF_X + margin &&
    localZ >= -INTERIOR_HALF_Z - margin &&
    localZ <= INTERIOR_HALF_Z + margin
  );
}

// ------------------------------------------------------------------ doors

/** The way out of the interior, on the +Z (south) face of the ground floor. */
export const INTERIOR_DOOR_MIN_X = -3.2;
export const INTERIOR_DOOR_MAX_X = 3.2;

/** The matching door in the facade out in the garden, at the top of the steps. */
export const ENTRANCE_MIN_X = -1;
export const ENTRANCE_MAX_X = 4;

/** Way through the +X (east) wall into the glass lift, on every deck. */
export const LIFT_DOOR_MIN_Z = 3.5;
export const LIFT_DOOR_MAX_Z = 6.5;

// ------------------------------------------------------- the facade's height

/**
 * **How tall the castle in the garden is** — its wall, its battlements, and
 * the top of its stonework.
 *
 * These live here rather than in `Shell.ts` for exactly the reason
 * {@link CASTLE_TOWERS} does, one section below: two things need them and the
 * dependency only runs one way. `Shell.ts` builds the battlements;
 * `slide/solve.ts` has to launch the ginormous slide *over* them. The slide
 * plan already imports this file, and `Shell.ts` imports the plan, so
 * `Shell.ts` cannot be the owner without making a cycle.
 *
 * ## Why the slide's launch height had to stop being a deck index
 *
 * `solve.ts` used to take its start height from `deckY(TOP_DECK)` — the
 * interior's topmost storey. That was never *about* the interior: it was a
 * proxy for "as high as the castle is", and it only worked because a
 * five-storey interior happened to be taller than the facade's battlements.
 *
 * When the floors became separate spaces (#377/#380) the interior stopped
 * having five stacked storeys and `TOP_DECK` fell from 4 to 2, taking 7.2 m
 * off the slide's launch height with it. The chute came down **3.76 m inside
 * solid battlements**, on every seed, and `test:procgen` caught it on all five.
 * Nothing about the facade had changed; the number the facade's clearance
 * depended on lived in a different building.
 *
 * GAME_DESIGN 30c is explicit that the inside never has to agree with the
 * outside's shape, so a figure about the *outside* must not be derived from the
 * inside's floor count. It is derived from the outside now.
 */
export const CASTLE_WALL_HEIGHT = 8.8;
export const CASTLE_MERLON_HEIGHT = 1.05;

/**
 * The top of the facade's stonework, facade-local — what the ginormous slide
 * has to clear, and what `test/procgen`'s `castleMasonryTopY` measures off the
 * built mesh.
 */
export const CASTLE_MASONRY_TOP = CASTLE_WALL_HEIGHT + CASTLE_MERLON_HEIGHT;

// ------------------------------------------------------------ corner towers

/**
 * The castle's four corner towers, as solids.
 *
 * **They live here rather than in `Shell.ts` because two things need them and
 * the dependency only runs one way.** `Shell.ts` builds them; `slide/plan.ts`
 * has to route the ginormous slide around them. The plan already imports this
 * file for `BUILDING_CENTRE_*` and `deckY`, and `Shell.ts` imports the plan, so
 * `Shell.ts` cannot be the owner without making a cycle.
 *
 * That they were *only* in `Shell.ts` is precisely how the slide came to run
 * through them. `slide/plan.ts` re-imposes the castle as its footprint
 * rectangle — a good, precise substitute for a bounding circle, and one that
 * does not contain these: the towers stand at `(±outerX, ±outerZ)`, outside the
 * rectangle by half a wall thickness, and bulge 2.05–2.45 m further out again.
 * Jim rode the slide through one. Measured on the canonical seed the chute ran
 * 1.10 m inside a tower body while every invariant stayed green.
 */
export const TOWER_RADIUS = 2.05;
export const TOWER_HEIGHT = 10.6;
export const TOWER_ROOF_HEIGHT = 4.2;
/** How far the conical roof oversails the body it sits on. */
export const TOWER_ROOF_OVERHANG = 0.4;
/** How much wider the body is at its foot than at its top. */
export const TOWER_BASE_FLARE = 1.08;

/**
 * A tower part as a solid of revolution: a vertical span with a radius that
 * varies linearly from bottom to top. A cylinder and a cone are both this.
 */
export interface TowerSolid {
  readonly name: string;
  /** Axis position, in world space. */
  readonly x: number;
  readonly z: number;
  readonly bottomY: number;
  readonly topY: number;
  readonly radiusBottom: number;
  readonly radiusTop: number;
}

/** Where the four towers stand, facade-local. Outside the footprint rectangle. */
const TOWER_HALF_X = BUILDING_HALF_X + BUILDING_WALL_THICKNESS / 2;
const TOWER_HALF_Z = BUILDING_HALF_Z + BUILDING_WALL_THICKNESS / 2;

/**
 * The towers in world space, body and roof, ready to be routed around.
 *
 * Derived from the same numbers `Shell.ts` composes its instance matrices from,
 * so the solid a ride avoids and the mesh a child sees cannot drift apart.
 */
export const CASTLE_TOWERS: readonly TowerSolid[] = (() => {
  const solids: TowerSolid[] = [];
  const corners: readonly (readonly [number, number])[] = [
    [-TOWER_HALF_X, -TOWER_HALF_Z],
    [TOWER_HALF_X, -TOWER_HALF_Z],
    [-TOWER_HALF_X, TOWER_HALF_Z],
    [TOWER_HALF_X, TOWER_HALF_Z],
  ];
  corners.forEach(([localX, localZ], index) => {
    const x = BUILDING_CENTRE_X + localX;
    const z = BUILDING_CENTRE_Z + localZ;
    solids.push({
      name: `tower-body-${index}`,
      x,
      z,
      bottomY: BUILDING_BASE_Y,
      topY: BUILDING_BASE_Y + TOWER_HEIGHT,
      radiusBottom: TOWER_RADIUS * TOWER_BASE_FLARE,
      radiusTop: TOWER_RADIUS,
    });
    solids.push({
      name: `tower-roof-${index}`,
      x,
      z,
      bottomY: BUILDING_BASE_Y + TOWER_HEIGHT,
      topY: BUILDING_BASE_Y + TOWER_HEIGHT + TOWER_ROOF_HEIGHT,
      radiusBottom: TOWER_RADIUS + TOWER_ROOF_OVERHANG,
      radiusTop: 0,
    });
  });
  return solids;
})();

/**
 * Horizontal distance from a tower's surface at height `y`, or `Infinity` where
 * `y` is outside the solid entirely.
 *
 * A tower is a solid of revolution, so this is exact: comparing the distance to
 * the axis against the radius *at the height the chute actually passes* is a
 * swept disc in closed form. It is deliberately **not** the ring-of-probe-rays
 * approach `coaster/castleWindows.ts` uses — that exists because the Sky
 * Cruiser's window has to be checked against arbitrary meshes, where there is
 * no formula and rays are the only option, and it pays for that with gaps
 * between the rays that a thin obstacle can slip through. Do not "unify" the
 * two: for a cylinder, rays would be strictly less accurate than this.
 */
export function distanceOutsideTower(tower: TowerSolid, x: number, z: number, y: number): number {
  if (y < tower.bottomY || y > tower.topY) return Infinity;
  const span = tower.topY - tower.bottomY;
  const t = span <= 1e-9 ? 0 : (y - tower.bottomY) / span;
  const radius = tower.radiusBottom + (tower.radiusTop - tower.radiusBottom) * t;
  return Math.hypot(x - tower.x, z - tower.z) - radius;
}

/**
 * The gaps the ginormous slide leaves through — in the roof parapet inside, and
 * in the facade's top storey out in the garden — **live on `SLIDE_PLAN`**, not
 * here. See `world/slide/plan.ts`.
 *
 * They were four hand-written coordinates in this file, and the search that
 * decides where the chute actually leaves the tower had no say in them: it
 * reported the door it chose and the masonry cut the hole somewhere else
 * regardless. Deriving the hole from the solved route is what stops the two
 * disagreeing, and the direction of the dependency is the reason they cannot
 * live here — this file is imported *by* the plan (for `BUILDING_CENTRE_*` and
 * `deckY`), so it must never import back from it.
 */

// -------------------------------------------------------------- lift alcove

/**
 * **Which wall the lift is in** — the middle of its doorway, in floor-local
 * metres, and the way *out* of it.
 *
 * The **west** wall, and that is not arbitrary: it is the hotel's wall, and the
 * reason is the camera. The park's camera is fixed at 45° looking along −X−Z
 * (design feedback #16, no more rotating), so an alcove is only ever watchable
 * from one side — the side its doors face. `Hotel.fitLiftAlcove` puts its lift
 * in a west wall and you look straight into the car; the castle's was in the
 * **east** wall, which is the near side, so the car's closed back panel stood
 * squarely between the camera and whoever was inside it and the dial faced away
 * into the room.
 *
 * That was invisible in code and obvious the moment it was ridden (#450): with
 * a car finally built, the child boarded and **disappeared** behind a solid
 * box. Ghosting the shell was tried and does not work — it is panelled, so a
 * sightline crosses four or five of its own surfaces and translucency
 * compounds; at the hotel overhang's 0.24 the box still reads as solid, and at
 * the ~0.06 that lets her through the lift has effectively vanished. Hiding the
 * shell outright leaves a doorway and a wire handrail, which is not a lift.
 *
 * **None of those are fixes; they are apologies for the wrong wall.** The east
 * wall was only ever right for the `GlassLift` that used to hang there, which
 * you could see through. So the alcove moved to the wall the hotel already
 * proved, and every one of those workarounds went with it.
 */
export const LIFT_WALL_X = -INTERIOR_HALF_X;

/**
 * The yaw of "out of the lift", in `Player.facing`'s units (0 along +Z, +π/2
 * along +X) — the doors' facing, the rider's facing, and the only orientation
 * `world/lift/LiftAlcove.ts` takes.
 *
 * One owner, because three places have to agree: `Building` builds the alcove
 * and lands her in it, and `liftRide.ts` poses her while she rides. Both used a
 * hand-written `Math.PI / 2` copied from the hotel, which was right for the
 * hotel's wall and, while the castle's alcove was in the east wall, had her
 * riding **facing the back of the car**. Deriving both from this makes that
 * disagreement impossible rather than unlikely.
 */
export const LIFT_OUT_YAW = Math.PI / 2;

/** Out of the alcove as a unit vector, from {@link LIFT_OUT_YAW}. */
const LIFT_OUT_X = Math.sin(LIFT_OUT_YAW);

/**
 * How deep the alcove is cut past the wall, and where the car and the rider
 * stand in it. All measured **out from the doorway**, so moving the lift to
 * another wall is one line above rather than four sign flips down here.
 */
export const LIFT_ALCOVE_DEPTH = 3.4;
export const LIFT_SHAFT = rect(
  Math.min(LIFT_WALL_X, LIFT_WALL_X - LIFT_OUT_X * LIFT_ALCOVE_DEPTH),
  Math.max(LIFT_WALL_X, LIFT_WALL_X - LIFT_OUT_X * LIFT_ALCOVE_DEPTH),
  3.3,
  6.7,
);
/**
 * How far back from the doorway the rider stands, in metres — **just inside the
 * car's mouth, not in the middle of it.**
 *
 * The car is 2.43 m deep with its ceiling at 2.62 m, and the camera looks down
 * at 38°: a child standing in the middle of it has her head behind that ceiling
 * from every point the camera can be. At 1.7 m back (the depth this was first
 * given, copied from the hotel) `check:castle`'s sightline probe finds the roof
 * of the car in front of her head and her chest, and only her waist is visible —
 * which is the shape of #450 all over again, in miniature.
 *
 * 0.9 m puts her 0.87 m inside the mouth: the car is still round and over her,
 * the doors still shut in front of her, and her whole body is in the frame.
 * The number is held honest by that probe rather than by this comment.
 */
export const LIFT_RIDER_DEPTH = 0.9;
export const LIFT_CAR_X = LIFT_WALL_X - LIFT_OUT_X * LIFT_RIDER_DEPTH;
export const LIFT_CAR_Z = 5;
export const LIFT_CAR_HALF = 1.3;


/**
 * The lift lobby: where a child stands to wait, and what a tap aims at.
 *
 * `LIFT_STAND_X` is deliberately *inside* the doorway rather than in the car:
 * standing here is what puts the lift's call panel on screen (`liftRide.ts`),
 * and stepping into the car is something the lift does *for* her, once it has
 * actually arrived. The original reason was an open five-storey shaft below the
 * car; there is no shaft any more (#377/#380), and the rule survives because
 * the family's own spec is that she never has to walk into a lift herself.
 *
 * Shared by `interactZones.ts` (the tap target) and `liftRide.ts` (the waiting
 * area and the spot she is set down on when she gets out), so the two can
 * never drift apart.
 */
export const LIFT_STAND_X = LIFT_WALL_X + LIFT_OUT_X * 1.1;
export const LIFT_PICK_X = LIFT_WALL_X - LIFT_OUT_X * 0.6;
/** The point every boarding and alighting glide is bent through — the doorway. */
export const LIFT_VIA_X = LIFT_WALL_X - LIFT_OUT_X * 0.3;
export const LIFT_DOOR_Z = 5;
/** How far back from the doors the call panel still appears. */
export const LIFT_LOBBY_REACH = 4;

// ------------------------------------------------------------------ ramps

/**
 * A walkable slope or landing.
 *
 * `axis` is the direction the ramp climbs along; outside `[from, to]` the height
 * is clamped, which is what turns the top of a stair flight into its landing
 * without needing a separate platform definition.
 *
 * `space` says which origin the footprint is measured from — the interior, or
 * the facade standing in the garden. The entrance steps are the only thing in
 * the game that is walkable *and* lives out in the park.
 */
export interface RampDefinition {
  readonly id: string;
  readonly space: 'interior' | 'garden';
  /**
   * Restricts an `interior` ramp to one floor.
   *
   * Every castle floor shares the same floor-local plan, so an interior ramp
   * applies on all three unless it says otherwise — which is right for the lift
   * pit, since each floor has its own alcove at the same spot. The **porch** is
   * the exception: only the mall has a front door, and without this a child on
   * the great hall or the roof garden would find a metre of walkable floor
   * outside the south wall and walk off the plate onto it.
   */
  readonly onlyFloor?: number;
  readonly footprint: RectRegion;
  readonly axis: 'x' | 'z';
  readonly from: number;
  readonly to: number;
  /** Local height at `from` and at `to`. */
  readonly yFrom: number;
  readonly yTo: number;
}

/** Steps up from the garden to the facade's front door. */
export const ENTRANCE_RAMP: RampDefinition = {
  id: 'entrance',
  space: 'garden',
  footprint: rect(ENTRANCE_MIN_X, ENTRANCE_MAX_X, BUILDING_HALF_Z, BUILDING_HALF_Z + 3),
  axis: 'z',
  from: BUILDING_HALF_Z + 2.8,
  to: BUILDING_HALF_Z,
  yFrom: -0.75,
  yTo: 0,
};

/**
 * The threshold of the facade's door: one flat metre of walkable floor inside
 * the shell, so a child arrives *somewhere* rather than being bounced off the
 * lobby wall by collision before the doorway trigger notices them.
 */
export const FACADE_THRESHOLD: RampDefinition = {
  id: 'facade-threshold',
  space: 'garden',
  footprint: rect(ENTRANCE_MIN_X, ENTRANCE_MAX_X, BUILDING_HALF_Z - 1.6, BUILDING_HALF_Z),
  axis: 'z',
  from: 0,
  to: 1,
  yFrom: 0,
  yTo: 0,
};

/** The interior's porch: the flat step outside its own south door. */
export const INTERIOR_PORCH: RampDefinition = {
  id: 'interior-porch',
  space: 'interior',
  onlyFloor: MALL_DECK,
  footprint: rect(
    INTERIOR_DOOR_MIN_X - 1,
    INTERIOR_DOOR_MAX_X + 1,
    INTERIOR_HALF_Z,
    INTERIOR_HALF_Z + 3.2,
  ),
  axis: 'z',
  from: 0,
  to: 1,
  yFrom: 0,
  yTo: 0,
};

/**
 * **The stairs and the escalator are gone**, with `stairFlights`,
 * `stairRoute`, `STAIR_STAND_X/Z`, `escalatorRamp` and
 * `ESCALATOR_DIRECTION_Z`.
 *
 * Jim, 29 August 2026: *"there are too many ways between the floors right now.
 * Let's reduce it to just the lift."* Decision 3 had proposed keeping the
 * escalator as a portal *flavour* — you would ride half a flight, the iris
 * would blink, and you would step off the other half in the next space. That
 * is superseded: a route that is not the lift is exactly what was removed, and
 * an escalator that returned you where you started would be nonsense. It was
 * also, in the family's own words, the mall look they complained about.
 *
 * The tap stairs took `StairRide` (a 3.5x time-scaled walk with a whoosh) and
 * `ui/StairMenu.ts` (a Climb / Descend menu) with them. Neither is a loss: the
 * lift is one press, it never makes a child wait, and it is the route the
 * family designed themselves (GAME_DESIGN.md, "Riding the lift").
 */

/** The floor of the lift shaft, so nobody falls out of the bottom of it. */
export const LIFT_PIT: RampDefinition = {
  id: 'lift-pit',
  space: 'interior',
  footprint: LIFT_SHAFT,
  axis: 'z',
  from: 0,
  to: 1,
  yFrom: 0,
  yTo: 0,
};

export function allRamps(): RampDefinition[] {
  const ramps: RampDefinition[] = [
    ENTRANCE_RAMP,
    FACADE_THRESHOLD,
    INTERIOR_PORCH,
    LIFT_PIT,
  ];
  return ramps;
}

// ----------------------------------------------------------- fun machinery

/**
 * **The trampoline, on the roof garden — a toy now, not a way upstairs.**
 *
 * Decision 3 §4 had it as a one-way portal: tap, walk to the pad, launch, iris
 * at the apex, land on a marked pad one floor up. That is transport, and
 * transport is the lift's. Jim's ruling leaves the trampoline as what a
 * six-year-old already thinks a trampoline is — you bounce, and you come back
 * down where you started. No shaft, no hole, no landing pad, nothing to guard.
 *
 * It stands on the roof garden, where there is open sky above it and nothing
 * to bang your head on, beside the long grass and the burrows.
 */
export const TRAMPOLINE_X = onPlate(8);
export const TRAMPOLINE_Z = onPlate(0.4);
export const TRAMPOLINE_RADIUS = 1.7;

/**
 * **The helter-skelter is deleted** (#377), with `HELTER_DECK`,
 * `HELTER_ENTRY_X/Z`, `HELTER_MOUTH_X`, `HELTER_CENTRE_X/Z`, `HELTER_SEMI_X/Z`
 * and its shaft.
 *
 * It was a ride *and* a route — an oval helix from deck 2 down to the ground
 * floor — and with three floors the only version of it that still made sense
 * was roof-garden-to-mall, which is a second way between floors and therefore
 * precisely what Jim removed. Making it return you to the floor you started on
 * would have meant a helix that goes down and then puts you back up, which
 * reads as broken.
 *
 * Jim, asked directly, 30 August 2026: *"yeah I don't care about that - just
 * delete it, it never really worked anyway."*
 *
 * **That last clause is the part worth keeping.** If a slide inside the castle
 * is ever wanted again it should be designed, not resurrected: the original had
 * problems of its own, and the roof garden already has the ginormous slide as
 * its down-and-out ride. One great slide off the roof beats two competing ones.
 */

/**
 * Where you step on to ride the ginormous slide is `SLIDE_PLAN.entryX/entryZ`.
 *
 * It moved out with the parapet gap it stands in front of, and for the same
 * reason: the boarding pad and the gap had to hold the same x, and did so only
 * because someone typed 20 in both places.
 */
/** The cuddly grown-up waits here, ready to be asked along. */
export const GROWN_UP_X = onPlate(15.2);
export const GROWN_UP_Z = onPlate(14);

// ------------------------------------------------------------- the toilets

/**
 * The cute toilets, in the north-east corner of deck one.
 *
 * Good manners are part of the game (GAME_DESIGN.md): using one flushes, and
 * then runs the tap while you wash your hands.
 */
/**
 * **On the mall**, beside the market. They were on deck 1 while the castle had
 * five storeys of scattered shops; a child in a market is exactly who needs
 * them, and the great hall and the roof garden are not places for a loo.
 */
export const TOILET_DECK = MALL_DECK;

/**
 * The room's authored size. It does **not** shrink with the plate (#403): a
 * pan, a basin and a child washing her hands are all the size they were.
 */
const TOILET_ROOM_WIDTH = 7.4;
const TOILET_ROOM_DEPTH = 7.1;

/**
 * The toilets moved from the north-east corner to the south-east (#403), and
 * this is the one placement the resize actually forced rather than scaled.
 *
 * **The finding:** the north strip cannot hold both the shop run and this room
 * once the plate is 42.43 m wide instead of 60. Five shops on the north wall
 * need 46.7 m of it at their authored spacing — they do not fit at all, at any
 * spacing, so one had to move to the west wall (see `SHOP_UNITS`). Four fit,
 * with 6 m to spare; but this room is 7.4 m wide, so four shops *and* the
 * toilets need 44 m of a 42.43 m wall. Something had to leave the north strip,
 * and a room with its own walls is a cleaner thing to move than a shop the
 * layout rules pin to a far wall. **Nothing was made smaller and no clearance
 * was relaxed to reach this** — see HANDOFF-castle-shrink.md.
 *
 * South-east rather than north-west because the west end of the north wall is
 * now the shop run's, and because the south wall is otherwise empty above the
 * ground floor: the interior's own door is deck 0 only.
 *
 * `maxX` stops at the lift lobby's west edge (`dressing.ts` keeps a 4 m disc
 * at `INTERIOR_HALF_X - 2`), so the room never walls off the walk to the lift.
 * That constant cannot be imported — `dressing.ts` imports this file — so the
 * `6` is written out with this note rather than derived.
 */
export const TOILET_ROOM = rect(
  INTERIOR_HALF_X - 6 - TOILET_ROOM_WIDTH,
  INTERIOR_HALF_X - 6,
  INTERIOR_HALF_Z - 0.5 - TOILET_ROOM_DEPTH,
  INTERIOR_HALF_Z - 0.5,
);

/**
 * Which way the open front of the room faces: **into the room**, always.
 *
 * `-1` is -Z, i.e. north, because the room now stands on the south wall. It
 * was +1 while the room stood on the north wall, and it was not a constant at
 * all — `Toilets.ts` simply built its front screen at `maxZ`. Making it a sign
 * is what let the room move corners without the child having to walk through
 * the back wall to use it.
 */
export const TOILET_FRONT_Z = -1;

const TOILET_CENTRE_X = (TOILET_ROOM.minX + TOILET_ROOM.maxX) / 2;
const TOILET_CENTRE_Z = (TOILET_ROOM.minZ + TOILET_ROOM.maxZ) / 2;
/**
 * Where a child stands to use them — **inside the room**.
 *
 * GAME_DESIGN.md, 27 July 2026: *"you do not use the toilet from the doorway.
 * The character walks into the room and goes in"*. This used to be `-13.4`, a
 * metre *outside* `TOILET_ROOM`'s front edge, which is exactly the thing the
 * family objected to: she stood in the corridor and the loo flushed at her.
 *
 * `x` is the middle of the gap in the front screen (the two front panels leave
 * 23.4–26.4 clear), so walking here walks her through the doorway rather than
 * through a wall. `z` is between the doorway and the fittings, clear of both
 * the pan and the basin, and far enough in that the roof covers her.
 */
export const TOILET_STAND_X = TOILET_CENTRE_X;
export const TOILET_STAND_Z = TOILET_CENTRE_Z + TOILET_FRONT_Z * 1.15;
/** Where the pan itself sits, against the room's back wall. */
export const TOILET_PAN_X = TOILET_CENTRE_X - 1.7;
export const TOILET_PAN_Z = TOILET_CENTRE_Z - TOILET_FRONT_Z * 1.65;
/** And the basin, on the other side of the little room. */
export const TOILET_BASIN_X = TOILET_CENTRE_X + 2.2;
export const TOILET_BASIN_Z = TOILET_CENTRE_Z - TOILET_FRONT_Z * 1.45;

// ------------------------------------------------------------- roof terrace

/** The pavilion on the roof terrace, at the west end. */
export const ROOF_PAVILION_X = onPlate(-18);
export const ROOF_PAVILION_Z = onPlate(-2);
export const ROOF_PAVILION_HALF_X = 5.4;
export const ROOF_PAVILION_HALF_Z = 4.6;

// ------------------------------------------------------------- shop units

export interface ShopUnitDefinition {
  readonly id: string;
  readonly deck: number;
  /** Local position of the unit's front-centre, on its deck. */
  readonly x: number;
  readonly z: number;
  /** Yaw in radians; 0 faces +Z. */
  readonly yaw: number;
  readonly title: string;
  readonly glyph: string;
  readonly accent: number;
}

/**
 * "Shops must dominate their rooms" (design feedback, 26 July 2026): every shop
 * gets a bigger footprint, and — everywhere the ground floor's "never has a
 * hole" rule (see `deckIsSolid`) does not forbid it — a shallow sunken
 * forecourt, so the counter and awning loom over a child standing in front of
 * them instead of reading as a hut in a warehouse.
 *
 * `SHOP_SCALE_XZ` alone is what makes every shop bigger; it is applied to the
 * whole kiosk+stock+shopkeeper group in `ShopUnits`, so nothing that builds a
 * shop's contents (`shops/kiosk.ts`, `shops/fitouts.ts`) has to know it
 * happened. Anything computed independently in *world* space — the counter's
 * collision segment, the till spot, the keep-out zone other floor dressing
 * respects — has to be scaled by hand alongside it; see `ShopUnits.ts`,
 * `shops/Shops.ts` and `dressing.ts`.
 */
/**
 * ## Amended for the market (#403) — 1.6 became 0.8
 *
 * The paragraph above is **not retracted**. "Shops must dominate their rooms"
 * was right about the thing it was looking at: a wall-mounted kiosk marooned
 * on a sixty-metre plate did read as a hut in a warehouse, and scaling it up
 * was the correct fix for that object in that room.
 *
 * A market stall is a different object. It is not trying to dominate a room
 * from across it — it is one of seven, an arm's length from the child walking
 * between them, and the thing that makes it read as a market is that there are
 * *lots* of them close together. At 1.6 only three stalls fit anywhere on the
 * plate at all (measured, `scripts/measure-market-floor.mts`); at 0.8 all
 * seven fit with room for the aisle.
 *
 * So: if the shops ever go back on the walls, put this back to 1.6 with them.
 * Do not raise it while they are stalls, and do not read this as licence to
 * shrink furniture generally — it is the one object whose *kind* changed.
 *
 * ## Declared here, above the market, and not by accident
 *
 * It used to sit two hundred lines further down, next to the other shop
 * geometry. The market's own spacing derives from {@link SHOP_STAND_Z}, which
 * derives from this — and a `const` referenced before its declaration is
 * evaluated is a `ReferenceError`, not a warning. So it moved up rather than
 * the market growing a second copy of 0.8. Nothing else changed.
 */
export const SHOP_SCALE_XZ = 0.8;

/**
 * Where a child stands to be served, in unit-local metres.
 *
 * Scaled by {@link SHOP_SCALE_XZ} along with the rest of the shop: a bigger
 * counter needs the standing spot to recede with it, or a child would be asked
 * to stand inside the (now bigger) counter itself.
 *
 * **Owned here, re-exported by `shops/Shops.ts`** (which is where it used to
 * live, and where every consumer still imports it from). It had to move
 * because the market's aisle is now *defined* as "wide enough that two
 * children can walk past two more being served", and that sentence is
 * arithmetic on this number. A layout that guesses how far a served child
 * stands from a counter is the two-definitions bug CLAUDE.md opens with.
 */
export const SHOP_STAND_Z = 2.4 * SHOP_SCALE_XZ;

/**
 * # The market (#403)
 *
 * Jim, 30 August: *"Come up with an aisle-based market-like layout with the
 * stalls in a grid, not all against the back wall."*
 *
 * The seven shops used to stand along the north and west walls. That worked on
 * a 60 m plate and stopped working on a 42 m one, and the reason is worth
 * keeping: **a wall is one-dimensional.** Five wall units needed 46.72 m of a
 * 42.43 m wall, and no re-spacing could help because a counter is 2.8 m either
 * side of centre whatever the room is. A grid uses the *floor* — the thing
 * that was just made denser — and the floor is two-dimensional, so it has
 * room to spare.
 *
 * It is also the better answer to the complaint that started all this. A row
 * of shopfronts reads as a corridor. Two rows of stalls facing each other
 * across an aisle read as a busy place, which is what "less sparse" means.
 *
 * ## Everything here derives from the plate
 *
 * The grid is anchored at the plate's **inside north-west corner** — inside
 * the perimeter ceiling beam, so no stall stands under one — and steps by a
 * pitch built from the game's own numbers. Resize the castle and the market
 * re-lays itself; that is the whole difference between this and the ten
 * hard-coded positions #403 had to chase.
 *
 * Verified against the built room by `scripts/measure-market-floor.mts`, which
 * rasterises the plan with every obstacle folded in — shafts, the roundel, the
 * toilets, the doorway, the lift lobby and all 41 boxes of the great hall's
 * own furniture — and reports which cells are clear. **Seven of the eight
 * are**, which is exactly the seven shops. The eighth is taken by the great
 * hall's fireside bench at the hearth, so the fireplace interrupts the north
 * row: a market with a fire in the middle of it, which is better than the
 * eight-square grid would have been.
 */

/**
 * A stall's footprint, square, in metres.
 *
 * Half of what a wall counter was, which is the point: `SHOP_SCALE_XZ` drops
 * from 1.6 to 0.8 with it. See that constant's own note for why reversing the
 * "shops must dominate their rooms" decision is not a retraction of it.
 */
export const MARKET_STALL = 2.8;

/**
 * The walking aisle: two children passing, plus elbow room.
 *
 * From `PLAYER_RADIUS` rather than from a number that looked right.
 */
const MARKET_WALK_AISLE = 2 * PLAYER_RADIUS + 1.2;

/**
 * How far a child being served sticks out into the lane behind her.
 *
 * She stands at `SHOP_STAND_Z`, which is 0.52 m clear of a 2.8 m stall, and
 * she is `PLAYER_RADIUS` across. Derived rather than guessed because it is the
 * unit both lane widths below are built out of.
 */
const MARKET_QUEUE_DEPTH = SHOP_STAND_Z - MARKET_STALL / 2 + PLAYER_RADIUS;

/**
 * A lane with stalls down **one** side: the strip in front of the back-wall
 * pair. One child being served, two more walking past behind her.
 */
const MARKET_SIDE_LANE = MARKET_QUEUE_DEPTH + MARKET_WALK_AISLE;

/**
 * The main aisle: **two children being served, and two more walking between
 * them** (#446 — "spread them out more").
 *
 * The old aisle was 2.93 m, which is what the *tap targets* need and nothing
 * more: one child at a counter filled it, and the market read as a huddle
 * because every gap in it was the narrowest gap that could legally exist. This
 * is the width the thing is actually *for* — a child can walk the whole length
 * of the market without asking anyone to move — and it comes out at 4.72 m.
 *
 * The tap-target floor is kept as a floor, not deleted: it is still true that
 * two stalls facing each other must not put their 2.3 m pick radii within
 * `TAP_FINGER_METRES` of each other, and if the queue term ever shrank below
 * it this would still be honest. `check:tap-spacing` proves it either way.
 */
export const MARKET_AISLE_WIDTH = Math.max(
  2 * MARKET_QUEUE_DEPTH + MARKET_WALK_AISLE,
  2.3 + 2.3 + TAP_FINGER_METRES - MARKET_STALL,
);

/** Between two facing rows, centre to centre. */
const MARKET_ROW_SEPARATION = MARKET_STALL + MARKET_AISLE_WIDTH;

/**
 * Along a row, stall to stall — **the same as across the aisle, so the grid is
 * square.**
 *
 * It used to be the walking aisle alone (5.24 m, a 2.44 m slot between
 * neighbours), which made the market a tight double row inside a very large
 * room. Setting the cross-lanes to the aisle's own width is what turns it into
 * a hall you move about in rather than a corridor you file down, and it keeps
 * one number rather than two: widen the aisle and the cross-lanes widen with
 * it.
 */
export const MARKET_PITCH_X = MARKET_STALL + MARKET_AISLE_WIDTH;

/**
 * # One aisle, seven stalls, all on the mall (#380)
 *
 * The market used to be split across two aisles on four different decks, and
 * the previous engineer's own verdict was the honest one: *"it is a grid, and
 * it is not yet a market … no floor ever shows more than two stalls."* That
 * was not a layout failure. Indoor collision was height-blind, so all seven
 * footprints shared one plan whatever deck they stood on, and the grid was the
 * only fix available at plan level. What it could not do was put them in one
 * **frame**.
 *
 * Jim chose the answer, knowing it costs a reason to climb: **all seven on one
 * floor, and that floor is the mall.**
 *
 * ## Two constraints vanished with the split, and neither was traded away
 *
 * Both of the tuned constants this file used to carry were measured against
 * things that only existed because the market shared a deck with something
 * else:
 *
 * - `MARKET_BEAM_INSET = 1.8` was measured off the **great hall's hearth**,
 *   whose fire reached about 4.6 m into the room and crowded the north row's
 *   queue keep-out. The hearth is on the great hall now, which is its own
 *   space. There is no fire on the mall.
 * - `MARKET_SOUTH_Z`'s `+1.6` was measured off the **stairwell's** deliberately
 *   wide 4.2 m pick radius. There is no stairwell anywhere.
 *
 * So the market is re-laid rather than relaxed: **two rows facing each other
 * across a single aisle, four stalls and three.** That is a market a child
 * walks *down*, with something on both sides of her the whole way, and it is
 * what the two-aisle split was a workaround for.
 *
 * Everything still derives from the plate and from the game's own numbers —
 * along a row from `PLAYER_RADIUS`, across the aisle from `TAP_FINGER_METRES`
 * — so resizing the castle re-lays the market for free.
 */

/**
 * A stall faces **into the aisle**, so a child walking down it can see what
 * each one sells and the serving spot is on the side she is standing.
 *
 * Unit-local +Z is "into the room" for a wall unit and "into the aisle" for a
 * stall — the same thing as far as `shopLocalToBuilding`, the till spot and
 * the keep-out are concerned, so none of them had to learn about markets.
 */
const FACE_SOUTH = 0;
const FACE_NORTH = Math.PI;

/**
 * How far a stall's centre stands off the wall it backs onto.
 *
 * `check:shop-spacing` refuses any stall footprint within 0.8 m of the plate
 * edge — the perimeter wall-plate hangs there — so this is that clearance,
 * plus the stall's own half footprint, plus 0.3 m so the assertion is met with
 * room rather than to the centimetre. Backing right onto the plaster would
 * also hide the skirt on the stall's back panel, which is the thing that makes
 * a back-wall stall look like a stall from the aisle.
 */
const MARKET_WALL_STANDOFF = 0.8 + MARKET_STALL / 2 + 0.3;

/**
 * The back wall: the north side of the mall, opposite the front door.
 *
 * A stall here faces **+Z**, into the room, which is also the face the fixed
 * isometric camera shows (see #447). Moving stalls here therefore shows a
 * child more shop fronts, not fewer.
 */
const MARKET_BACK_Z = -(INTERIOR_HALF_Z - MARKET_WALL_STANDOFF);

/** The aisle's north row, one side lane clear of the back-wall pair. */
const MARKET_NORTH_Z = MARKET_BACK_Z + MARKET_STALL + MARKET_SIDE_LANE;

/** The aisle's south row, across the aisle from it. */
const MARKET_SOUTH_Z = MARKET_NORTH_Z + MARKET_ROW_SEPARATION;

/** The middle of the aisle, for anything that wants to run down it. */
export const MARKET_AISLE_Z = MARKET_NORTH_Z + MARKET_ROW_SEPARATION / 2;

/** One rank of stalls: where it stands, which way it looks, and its columns. */
interface MarketRow {
  /** Floor-local Z of every stall in the rank. */
  readonly z: number;
  /** Which way they all look. */
  readonly yaw: number;
  /**
   * Column centres, in **pitches** either side of the market's mid-line. Half
   * pitches are deliberate: a rank offset by half a pitch sits opposite its
   * neighbours' cross-lanes rather than behind their canopies, so from the
   * aisle you look through a gap and see another stall behind it.
   */
  readonly cols: readonly number[];
}

/**
 * # Three ranks, not two (#446)
 *
 * Jim, looking at the market: *"Market stalls are all clumped together in the
 * middle of a large room — spread them out more. Move a couple to the back
 * wall, while keeping the rest in a bigger grid."*
 *
 * He was describing a real thing and not a matter of taste. Seven stalls at
 * the old 5.24 m pitch occupied a 15.7 m × 5.7 m patch of a 42.4 m × 31.1 m
 * room, all of it within a few metres of the middle, with every gap in it set
 * to the narrowest width that would pass a check. The room was doing nothing.
 *
 * So the market now has three ranks:
 *
 * - **The back wall** — two stalls against the north wall, facing into the
 *   room, half a pitch outboard of the grid so they read from the aisle
 *   through the cross-lanes rather than hiding behind the north row.
 * - **The aisle** — three facing two across {@link MARKET_AISLE_WIDTH}, which
 *   is the #403 ruling kept intact and widened from 2.93 m to 4.72 m.
 *
 * Everything still derives from the plate and the game's own numbers, so
 * resizing the castle re-lays the market for free — and `keepOutsFor` reads
 * `SHOP_UNITS`, so the benches and props move with the stalls without a second
 * list being edited.
 *
 * **The south strip is left alone on purpose.** The front door, the roundel
 * and its planters own the floor from about z = 2.8 southwards; the market
 * fills the room from the back wall down to the edge of that, which is the
 * whole of the floor it is allowed to have.
 */
const MARKET_ROWS: readonly MarketRow[] = [
  { z: MARKET_BACK_Z, yaw: FACE_SOUTH, cols: [-1.5, 1.5] },
  { z: MARKET_NORTH_Z, yaw: FACE_SOUTH, cols: [-1, 0, 1] },
  { z: MARKET_SOUTH_Z, yaw: FACE_NORTH, cols: [-0.5, 0.5] },
];

/**
 * Centre of the stall in column `col` of rank `row`, floor-local.
 *
 * Every rank is centred on the market's own mid-line, so a short rank sits
 * symmetrically against a long one instead of trailing off one end.
 */
export function marketCell(row: number, col: number): [number, number] {
  const rank = MARKET_ROWS[row];
  if (!rank) return [0, MARKET_AISLE_Z];
  return [(rank.cols[col] ?? 0) * MARKET_PITCH_X, rank.z];
}

/**
 * Which pitch each shop has. A **seating plan**, not a formula: which shop
 * gets which stall is a thing a six-year-old should be allowed an opinion
 * about, and it should be editable without touching any arithmetic.
 *
 * Two judgements are baked into the order below, both worth arguing with:
 *
 * - **The back wall gets the two you go looking for** — stickers-and-pets and
 *   surprise eggs — rather than the two a child beelines for. Ice cream,
 *   candy floss, balloons, toys and hats stay on the aisle she walks into;
 *   the far rank rewards going further in.
 * - **The south row, which shows the camera its back, gets the two canopies
 *   that have no back** — the balloon stall's bouquet on a post and the candy
 *   floss stall's parasol read the same from every side. That is #447 made
 *   smaller: three stalls used to present their back panel, now two do, and
 *   those two are the ones it costs least.
 */
const MARKET_PLAN: readonly (readonly [number, number])[] = [
  [1, 0], // toy
  [2, 0], // balloon
  [2, 1], // candyFloss
  [1, 1], // iceCream
  [1, 2], // hat
  [0, 0], // stickerPet
  [0, 1], // surpriseEgg
];

function stall(index: number): { x: number; z: number; yaw: number } {
  const seat = MARKET_PLAN[index];
  if (!seat) throw new Error(`market: shop ${index} has no pitch — MARKET_PLAN is short`);
  const [row, col] = seat;
  const rank = MARKET_ROWS[row];
  if (!rank) throw new Error(`market: shop ${index} is seated in rank ${row}, which does not exist`);
  const [x, z] = marketCell(row, col);
  // Every stall looks at a lane a child walks down: the back-wall pair and the
  // north row south into theirs, the south row north into the same aisle.
  return { x, z, yaw: rank.yaw };
}


/**
 * **All seven, on the mall.** They were spread over decks 0, 1, 2 and 3, which
 * is what made a market impossible to see: no floor ever showed more than two
 * stalls. `MALL_DECK` rather than a typed `0` at seven call sites, so the
 * market moves floor in one edit if it ever should.
 */
export const SHOP_UNITS: readonly ShopUnitDefinition[] = [
  { id: 'toy', deck: MALL_DECK, ...stall(0), title: 'Toy Shop', glyph: '🧸', accent: PALETTE.markerPink },
  { id: 'balloon', deck: MALL_DECK, ...stall(1), title: 'Balloon Shop', glyph: '🎈', accent: PALETTE.markerSky },
  { id: 'candyFloss', deck: MALL_DECK, ...stall(2), title: 'Candy Floss', glyph: '🍬', accent: PALETTE.blossomPink },
  { id: 'iceCream', deck: MALL_DECK, ...stall(3), title: 'Ice Cream', glyph: '🍦', accent: PALETTE.markerMint },
  { id: 'hat', deck: MALL_DECK, ...stall(4), title: 'Hat Shop', glyph: '🎩', accent: PALETTE.markerLilac },
  { id: 'stickerPet', deck: MALL_DECK, ...stall(5), title: 'Stickers & Pets', glyph: '🐹', accent: PALETTE.markerLemon },
  { id: 'surpriseEgg', deck: MALL_DECK, ...stall(6), title: 'Surprise Eggs', glyph: '🥚', accent: PALETTE.flowerViolet },
];

/** Scene-graph name for a shop unit's anchor group. */
export function shopGroupName(id: string): string {
  return `shop:${id}`;
}

/**
 * Unit-local metres to interior-local metres.
 *
 * A unit's anchor group is translated to `(x, z)` and rotated by `yaw`, so its
 * own +Z points into the room whichever wall it is on. Anything that has to
 * agree with the geometry from *outside* the group — the counter's collision
 * segment, the spot a child stands on to be served — goes through here rather
 * than re-deriving the rotation, so the two can never drift apart.
 */
export function shopLocalToBuilding(
  unit: ShopUnitDefinition,
  localX: number,
  localZ: number,
): [number, number] {
  const cos = Math.cos(unit.yaw);
  const sin = Math.sin(unit.yaw);
  return [unit.x + localX * cos + localZ * sin, unit.z - localX * sin + localZ * cos];
}

/**
 * A shop unit's own axis-aligned footprint, in interior-local metres.
 *
 * Every yaw a unit actually uses (`FACE_SOUTH`, `FACE_EAST`) is a multiple of
 * 90°, so a unit-local rectangle always maps onto an axis-aligned rectangle in
 * interior-local space too — never a rotated one. Four corners through
 * `shopLocalToBuilding` and a min/max is all that takes, which is why this
 * stays a plain `RectRegion` rather than a general polygon.
 */
function shopFootprintRect(
  unit: ShopUnitDefinition,
  localMinX: number,
  localMaxX: number,
  localMinZ: number,
  localMaxZ: number,
): RectRegion {
  const corners = [
    shopLocalToBuilding(unit, localMinX, localMinZ),
    shopLocalToBuilding(unit, localMaxX, localMinZ),
    shopLocalToBuilding(unit, localMinX, localMaxZ),
    shopLocalToBuilding(unit, localMaxX, localMaxZ),
  ];
  const xs = corners.map((c) => c[0]);
  const zs = corners.map((c) => c[1]);
  return rect(Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs));
}

/**
 * How much taller a shop with a sunken forecourt gets to be, on top of
 * `SHOP_SCALE_XZ`.
 *
 * A floor's clear height is only `BUILDING_FLOOR_HEIGHT - BUILDING_SLAB` (3.3 m
 * — the kiosk's awning and sign already reach to within a few centimetres of
 * that), so height cannot simply scale up with the footprint everywhere
 * without poking through the slab above. Sinking the forecourt by
 * `SHOP_RECESS_DEPTH` buys back exactly that much headroom, which is why only
 * recessed shops (`shopHasForecourt`) get any extra height at all.
 */
const SHOP_SCALE_Y_RECESSED = 1.05;

/**
 * How far a shop's own forecourt sinks below its deck.
 *
 * Matches `BUILDING_SLAB` on purpose: the hole cut for it (see `DECK_HOLES`,
 * below) already grows a vertical rim wall exactly `BUILDING_SLAB` deep as
 * part of the deck slab's own extrusion, so that rim is *all* the retaining
 * wall the pit needs — no separate riser geometry to keep in sync with it.
 */
export const SHOP_RECESS_DEPTH = BUILDING_SLAB;

/**
 * Ground floor decks can never carry a hole (`deckIsSolid` hard-codes deck 0
 * solid, and that invariant is relied on elsewhere), so only shops on decks 1
 * and up get the sunken-forecourt treatment. The two ground-floor shops (toy,
 * balloon) still get the full footprint scale-up — only the extra height and
 * the recess are unavailable to them.
 */
export function shopHasForecourt(unit: ShopUnitDefinition): boolean {
  // **Never, since the shops became stalls (#403).** A sunken forecourt is a
  // hole in the slab, and it existed to give a wall-mounted kiosk headroom to
  // loom over the child in front of it. A stall in the middle of the floor has
  // a child on *both* sides and nothing to loom from; a pit round it would be
  // a trip hazard down an aisle. Keeping the function (rather than deleting
  // every call) means the wall arrangement is one edit away if it comes back.
  void unit;
  return false;
}

/** Vertical scale for a shop's kiosk group: bigger only where there is headroom for it. */
export function shopScaleY(unit: ShopUnitDefinition): number {
  return shopHasForecourt(unit) ? SHOP_SCALE_Y_RECESSED : 1;
}

/** Half-width and near/far depth of a shop's forecourt, in *unit-local* metres, pre-scale. */
const FORECOURT_HALF_X = 2.9;
const FORECOURT_NEAR_Z = 0.25;
const FORECOURT_FAR_Z = 3.2;

/**
 * A shop's sunken forecourt footprint, in interior-local metres — the counter,
 * the till spot and the standing room in front of it, all scaled up with the
 * rest of the shop. Only meaningful where `shopHasForecourt` is true; used both
 * as the deck hole (`DECK_HOLES`, below) and as the flat "landing" ramp that
 * fills it (`shopForecourtRamp`), so the two can never disagree about where
 * the pit is.
 */
export function shopForecourtRegion(unit: ShopUnitDefinition): RectRegion {
  return shopFootprintRect(
    unit,
    -FORECOURT_HALF_X * SHOP_SCALE_XZ,
    FORECOURT_HALF_X * SHOP_SCALE_XZ,
    FORECOURT_NEAR_Z * SHOP_SCALE_XZ,
    FORECOURT_FAR_Z * SHOP_SCALE_XZ,
  );
}


/**
 * `DECK_HOLES` and `shopForecourtRamps()` stood here. Both are gone with the
 * shafts: there are no holes in any floor, and `shopHasForecourt` has answered
 * `false` for every unit since the shops became market stalls (a sunken pit
 * round a stall in the middle of an aisle is a trip hazard, not a shopfront).
 */

// --------------------------------------------------------------- ball pit

/** Centre of the ball pit, in world coordinates (the `ballPit` anchor). */
export const BALL_PIT_X = placedEntry('ballPit').x;
export const BALL_PIT_Z = placedEntry('ballPit').z;
export const BALL_PIT_RADIUS = 6;
/** How far the pit floor sits below the surrounding grass. */
export const BALL_PIT_DEPTH = 0.5;
export const BALL_PIT_FLOOR_Y = terrainHeight(BALL_PIT_X, BALL_PIT_Z) - BALL_PIT_DEPTH;
