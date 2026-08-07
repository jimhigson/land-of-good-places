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

/** True if the angle (radians, `atan2(z, x)` convention) falls inside the gate gap. */
export function isInEntranceGateGap(angle: number): boolean {
  return Math.abs(angleDelta(angle, ENTRANCE_ANGLE)) < ENTRANCE_GATE_HALF_ANGLE;
}

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
export const ENTRANCE_BUS_STOP_X = ENTRANCE_STOP_X;
export const ENTRANCE_BUS_STOP_Z = ENTRANCE_GATE_Z + 5.8;

/**
 * Where the roll-in begins: the far end of the flat ground outside the gate.
 *
 * Kept at 69 rather than pushed to the last flat metre (72) so that the bus's
 * **back end** is still on level ground at the start, not overhanging the rim.
 * This is the frame Stage B hands over on — see `ArrivalSequence`.
 */
export const ENTRANCE_BUS_ARRIVE_Z = ENTRANCE_GATE_Z + 9;

/** Once the departing bus has rolled back out this far, it is disposed. */
export const ENTRANCE_BUS_VANISH_Z = ENTRANCE_GATE_Z + 9;

/** Keeps the tree/bush scatter (`Scenery.ts`) off the stop and the gate plaza. */
export const ENTRANCE_CLEAR_X = ENTRANCE_STOP_X;
export const ENTRANCE_CLEAR_Z = (ENTRANCE_STOP_Z + ENTRANCE_GATE_Z) / 2;
export const ENTRANCE_CLEAR_RADIUS = 10;
