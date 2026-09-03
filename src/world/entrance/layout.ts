import { GARDEN_HALF_SIZE } from '../../core/constants';
import { angleDelta } from '../../core/mathUtils';

/**
 * Where the park entrance sits, geometrically.
 *
 * Chosen from the existing path/boundary geometry rather than guessed: the
 * `fountain-approach` route (`world/paths.ts`) is the one spur that already
 * touches the main loop road and points straight at the plaza along the x=0
 * axis, arriving from `z = -21` (see `ANCHORS`/`ROUTES` — the building and the
 * space ferris wheel mass to the north, negative z). The player's default spawn
 * — `new Vector3(0, 0, 7)`, "just south of the fountain" (`Game.ts`) — already
 * sits on the plaza's paved disc on the *opposite* side, positive z, where the
 * park is otherwise open lawn all the way to the boundary. Continuing that same
 * x=0 axis outward through the boundary wall gives a gate that is symmetric
 * with the existing north approach, lines up with the plaza the player already
 * starts next to, and lands the cat bus on the open (south) side of the ring
 * road rather than ploughing through the building or a ride.
 */
export const ENTRANCE_ANGLE = Math.PI / 2;

/** Matches `Garden.ts`'s `buildBoundaryWall` radius exactly (`GARDEN_HALF_SIZE - 2`). */
export const ENTRANCE_WALL_RADIUS = GARDEN_HALF_SIZE - 2;

/**
 * Half-angle, in radians, of the gap left in the boundary wall for the gate.
 * At {@link ENTRANCE_WALL_RADIUS} this opens a walkway a little under 9 m wide —
 * comfortably wide for the bus plus a pedestrian gate either side of the road.
 */
export const ENTRANCE_GATE_HALF_ANGLE = 0.073;

/** Centre of the gate opening, right on the boundary wall. */
export const ENTRANCE_GATE_X = Math.cos(ENTRANCE_ANGLE) * ENTRANCE_WALL_RADIUS;
export const ENTRANCE_GATE_Z = Math.sin(ENTRANCE_ANGLE) * ENTRANCE_WALL_RADIUS;

/**
 * **The gate arch itself** — how far apart its posts stand, and how tall they
 * are.
 *
 * Here rather than inside `Entrance.ts`, because the arch is built **twice**:
 * once in the park by `Entrance.ts`, and once at the end of the lane by
 * `BusJourney.ts`, which is the park the bus is seen driving up to. They are the
 * same gate a second apart — the cut between the ride and the arrival lands
 * squarely on it — so a child looking at a gate and a road and nothing else
 * would see any disagreement between them as a jump.
 *
 * `layout.ts` is where they can both reach: it imports two dependency-free core
 * modules and nothing else, whereas `Entrance.ts` pulls in the terrain, the
 * collision world and the park boundary, none of which exist yet while the ride
 * is playing. A comment in the ride promising it matched the park's numbers was
 * written first and deleted: a promise that two numbers agree is not a
 * mechanism, and this repo has paid for that six times in a week.
 */
export const ENTRANCE_GATE_HALF_WIDTH = 4.3;
export const ENTRANCE_GATE_POST_HEIGHT = 3.3;

/**
 * **Is this point standing in the park's front doorway?**
 *
 * The one owner of that question, here because this module owns the gate, and
 * asked from **both** directions of the bridge pipeline (#414, #437):
 * `crossingPlanSolve.ts` will not *plan* a crossing whose ramp reaches the
 * arch, and `bridgeFootprint.ts` will not *build* one — the same shape as
 * `CROSSING_STATION_CLEARANCE`, and for the same reason. Planning it in one
 * place only is not enough: the planner and the builder search with different
 * levers (the builder may shift the deck sideways, narrow it, or fell a tree),
 * so a site the planner proved with a ramp stopping short of the arch was
 * still given a longer ramp by the builder, and the parapet went back into the
 * doorway. Measured on the canonical seed — Jim's own park — the moment the
 * paths moved: `gate-approach` ended at (0.0, 54.0), 0.70 m up on a bridge.
 *
 * **A bridge cannot fit through this gap at any width.** The deck is
 * `2 * SITE_HALF_WIDTH` = 10 m across and its parapets flank it; the arch is
 * `2 * ENTRANCE_GATE_HALF_WIDTH` = 8.6 m. So this is not a clearance to tune —
 * it is a statement that the two are the wrong sizes to overlap, and the
 * bridge is the one that has to move.
 */
export function isInEntranceGateway(x: number, z: number): boolean {
  return Math.hypot(x - ENTRANCE_GATE_X, z - ENTRANCE_GATE_Z) < ENTRANCE_GATE_HALF_WIDTH;
}

/** True if the angle (radians, `atan2(z, x)` convention) falls inside the gate gap. */
export function isInEntranceGateGap(angle: number): boolean {
  return Math.abs(angleDelta(angle, ENTRANCE_ANGLE)) < ENTRANCE_GATE_HALF_ANGLE;
}

/**
 * **How far into the park the walk in from the arch stays clear.**
 *
 * The gate is the one fixed thing in the park; everything else is drawn afresh
 * on every seed. So "the way in" is the one piece of ground that cannot move
 * out of anybody's way, and it needs a stated depth rather than a hope.
 *
 * Issue #481, measured on the built park rather than argued: on pool seed 288
 * the railway's lineside fence ran `(2.64, 57.73) -> (0.01, 57.76) ->
 * (-2.59, 57.41)` — 2.3 m inside the arch, straight across the opening — with
 * its 1.3 m track escort 4 m behind it. On sweep seed 18 the fence ran through
 * the arch itself, `(-1.13, 59.87) -> (1.43, 58.85)`. A child stepping off the
 * bus walked into a pen. (The issue blames the boundary wall; it is not the
 * boundary wall. `Garden.ts` cuts the gap in that correctly on both seeds —
 * its 0.45 m segments stop at `(4.47, 59.65)` and `(-3.48, 60.44)` on 288.)
 *
 * 12 m is the forecourt a six-year-old walks across before the park proper
 * begins: room for the arch, the welcome sign beside it, and turning round to
 * wave the bus off. It is deliberately not the whole walk to the plaza — the
 * railway is *allowed* to ring the park between the gate and the middle, and
 * `crossings.ts` gives that walk a level crossing or a bridge, which is the
 * park working as designed.
 *
 * **This is a depth to be *walkable*, not a depth to be empty**, and the
 * distinction is the whole of `gatewayWalk.ts`: measured across the sixteen
 * pool seeds, every one of them stands a lamp, a bollard or the welcome sign
 * somewhere in this box, and a rule that nothing may is a rule sixteen parks
 * out of sixteen break. What must hold is that a child can get from the arch to
 * here — past the furniture, and through any crossing in between.
 */
export const ENTRANCE_WALK_DEPTH = 12;

/**
 * Where the bus stop itself stands — a little inside the wall, well inside
 * `GARDEN_PLAY_RADIUS` (58) so the player is standing on solid, ordinary park
 * ground the instant they step off the bus.
 */
export const ENTRANCE_STOP_RADIUS = 52;
export const ENTRANCE_STOP_X = Math.cos(ENTRANCE_ANGLE) * ENTRANCE_STOP_RADIUS;
export const ENTRANCE_STOP_Z = Math.sin(ENTRANCE_ANGLE) * ENTRANCE_STOP_RADIUS;

/** Where the player ends up standing, right beside the stop, free to walk in. */
export const ENTRANCE_PLAYER_X = ENTRANCE_STOP_X - 1.6;
export const ENTRANCE_PLAYER_Z = ENTRANCE_STOP_Z - 0.4;

/**
 * **Where the bus parks — outside the park, never in it.**
 *
 * This used to be `ENTRANCE_STOP_Z + 2.6` (z = 54.6), which is **5.4 m inside
 * the boundary wall**, and on 7 August 2026 Jim watched the first ever run of
 * the arrival and said so: *"the bus drives something like 5 m into the park,
 * through a wall."* Both halves of that were true and neither was a rendering
 * fault — the bus really did drive to a point inside the park, and the wall
 * really had no hole in it (issue #195; `isInEntranceGateGap` had never been
 * called by anything).
 *
 * A bus is not a park vehicle. It stops on the road **outside** the gate and
 * the children walk in through the arch, which is what a bus stop is.
 *
 * The number is bounded at both ends and there is less room than you would
 * think:
 * - **Inwards** by the wall at `ENTRANCE_GATE_Z` (60) — the whole bus must
 *   clear it, and the bus is over 7 m long once scaled (see `catBus.ts`'s
 *   `BUS_SCALE`).
 * - **Outwards** by the terrain, which is a hilltop diorama: measured on the
 *   built ground, it is flat to z = 72 and then falls away hard — −0.13 m at
 *   72, −1.35 m at 74, −14 m at 80. Park a bus past the rim and it hangs in
 *   the air over a cliff.
 *
 * That leaves a **12 m window** between the wall and the rim for a 7 m bus,
 * which is the real reason the roll-in here is short. It is also the clearest
 * argument that Stage B's journey cannot happen on this terrain and needs its
 * own scene, as #245 already specifies.
 */
export const ENTRANCE_BUS_STOP_Z = ENTRANCE_GATE_Z + 9;

/**
 * **Where the bus's *door* stops: dead in front of the gate.**
 *
 * The bus pulls up **along** the kerb rather than nosing at the gate, which is
 * what a bus at a bus stop does — and here it is also the only thing that fits.
 * Sized to hold twelve children (see `catBus.ts`) the bus is 11 m long, and the
 * flat ground outside the wall is only 12 m deep before the hilltop's rim falls
 * away, so a bus pointed at the gate could not park, let alone drive. Turned
 * along the kerb it needs only its own width across that band, and has ±28 m of
 * level ground to run along — measured on the built terrain.
 *
 * The kerb sits 9 m out rather than hard against the wall, and that distance
 * was **measured, not chosen**. The park boundary is a spline pinned to 60 m at
 * the gate's bearing but bulging to 92 m a few degrees either side (#115), so a
 * straight kerb close to the wall dives back **inside** the park at both ends of
 * its run: at 4.5 m out, an 11 m bus had only a 15 m window it could stand in
 * without part of it being in the park. At 9 m out the window is 41 m of level
 * ground, which is room to drive. The rim starts at z = 73, so this still
 * leaves the bus a comfortable margin.
 *
 * This names where the **door** goes, not where the bus's centre goes, because
 * the door is the thing that has to line up with the gate. `ArrivalSequence`
 * asks the bus where its own door is (`CatBusHandle.doorDrop`) and works back
 * to the centre — so the two cannot drift apart, and a bus of a different
 * length still stops with its door in the right place.
 */
export const ENTRANCE_BUS_DOOR_X = 0;

/**
 * Where the bus comes in from, along the kerb. This is the frame Stage B hands
 * over on — see `ArrivalSequence`.
 *
 * **Both of these are bounded by a measurement, and the measurement moved.**
 * Sizing the bus from a child that had actually been measured took it from
 * 11 m to 18.2 m long, and the run of kerb an 18.2 m bus can stand on without
 * any part of it being inside the park is `x` from **-23 to +7.5** at this
 * kerb — not the ±28 an 11 m bus had. (`scripts/check-cat-bus.mts` measures the
 * bus's own bounding box against `PARK_BOUNDARY` on every frame of the run and
 * caught exactly this: *"the bus reached 1.48 m INSIDE the park boundary"*.)
 *
 * So these sit just inside that window, with the stop itself at x = -4.6 —
 * see `catBus.ts`'s `doorZ` for why the door is behind the bus's centre, which
 * is what buys the approach its 11.6 m.
 */
export const ENTRANCE_BUS_ARRIVE_X = 7;

/** Once the departing bus has rolled on this far, it is disposed. */
export const ENTRANCE_BUS_VANISH_X = -22;

/** Keeps the tree/bush scatter (`Scenery.ts`) off the stop and the gate plaza. */
export const ENTRANCE_CLEAR_X = ENTRANCE_STOP_X;
export const ENTRANCE_CLEAR_Z = (ENTRANCE_STOP_Z + ENTRANCE_GATE_Z) / 2;
export const ENTRANCE_CLEAR_RADIUS = 10;
