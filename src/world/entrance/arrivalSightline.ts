/**
 * **Nothing may stand between the camera and the arriving bus.**
 *
 * ## The fault this replaces
 *
 * `layout.ts` has carried `ENTRANCE_CLEAR_X/Z/RADIUS` — a **10 m disc centred
 * on (0, 56)** — since the entrance was written, and Stage A wired it into
 * `Scenery.isPlantable` so it finally did something. It is still the wrong
 * shape and in the wrong place, for a reason that is worth writing down because
 * it is this repo's commonest bug and it survived being fixed once:
 *
 * - The radius, **10 m**, was chosen for a bus that was **11 m** long. The bus
 *   is now **18.16 m** long, because the seat plan was re-derived from a child
 *   who had actually been measured. The literal did not move.
 * - The centre, **(0, 56)**, is where the bus used to *park* — 5.4 m **inside**
 *   the park. The stop moved outside the gate to `z = 69` in round 2 and the
 *   disc stayed behind. It covers z 46–66; the bus is at 69. **The keep-out
 *   has never once covered the vehicle it is named after.**
 *
 * Jim watched the first captured run and the lower-left of the bus was behind
 * trees from t = 3 to t = 6.
 *
 * ## What is actually in the shot, measured
 *
 * Not the plantable scatter — that is held five metres inside a boundary which
 * is 60 m at the gate's bearing, so it cannot reach the kerb. It is
 * **`Scenery.ts`'s `buildTreeline()`**: 540 trees in a band from
 * `edgeRadiusAt + 11.5` outwards, which on the gate bearing starts at
 * **z = 71.5** — two and a half metres behind the kerb and squarely between the
 * camera and the bus. `buildTreeline` does not go through `isPlantable`, so it
 * never asked the keep-out anything, before or after Stage A.
 *
 * ## Why this is an exact test and not a fudged radius
 *
 * **The park camera is orthographic** (`IsoCamera` builds an
 * `OrthographicCamera`), so every view ray is parallel and occlusion depends
 * only on the camera's *direction* — never on where it is focused. That is what
 * makes "is this in front of the bus?" answerable in closed form rather than by
 * picking a radius and hoping:
 *
 * ```
 * d = (sin yaw cos pitch, sin pitch, cos yaw cos pitch)   // towards the camera
 * ```
 *
 * A thing standing at `(x, z)` whose top is at world height `top` traces the
 * **upper edge of its own silhouette** forward to the bus:
 *
 * ```
 * back      = (z - BUS_Z) / d.z        // how far back along the ray it stands
 * xAtBus    = x   - d.x * back
 * topAtBus  = top - d.y * back
 * ```
 *
 * Everything it hides lies *below* that line, because it is a solid thing
 * standing on the ground. So it hides part of the bus exactly when `topAtBus`
 * is still **above the ground the bus is standing on**, with `xAtBus` somewhere
 * the bus actually is.
 *
 * **The first version of this had that comparison the wrong way round** — it
 * asked whether the line fell *below the roof*, which flags things far enough
 * away to be harmless and exempts the tall near ones that do the actual hiding.
 * It is worth the sentence because it passed a casual read and its results
 * looked plausible: it did clear the corridor, just of the wrong trees. What
 * caught it was seed 2 reporting a **0.7 m bush** as hiding an 18 m bus.
 *
 * With the numbers this park has, the boundary lands at about z = 74: a 9.3 m
 * treeline tree at z = 71.5 still projects 6.5 m up at the bus and hides it,
 * while by z = 76 the same tree projects below the kerb and hides nothing.
 *
 * ## What it deliberately does not cover
 *
 * **Only the arrival, not the departure.** The bus runs on to
 * `ENTRANCE_BUS_VANISH_X` after she already has the controls, and it does so in
 * her peripheral vision while the camera is on her at the gate. Extending the
 * keep-out over that stretch would cut a 47 m hole in the treeline whose whole
 * job is to hide the edge of the terrain disc, to protect a shot nobody is
 * watching. The corridor here is the run the bus is the *subject* of.
 */

import { CAMERA_PITCH_DEGREES, CAMERA_YAW_DEGREES } from '../../core/constants';
import { terrainHeight } from '../terrain';
import { CAT_BUS_LENGTH, CAT_BUS_TOP, CAT_BUS_WIDTH } from './catBus';
import {
  ENTRANCE_BUS_ARRIVE_X,
  ENTRANCE_BUS_DOOR_X,
  ENTRANCE_BUS_STOP_Z,
} from './layout';

const DEG = Math.PI / 180;

/**
 * Unit vector from a thing in the world **towards the camera**.
 *
 * Taken from the game's own camera constants rather than restated, per
 * `test/procgen/invariants.ts` rule 2 — the threshold has to come from the
 * camera that will actually be looking, or this measures a camera nobody uses.
 */
const TOWARDS_CAMERA = {
  x: Math.sin(CAMERA_YAW_DEGREES * DEG) * Math.cos(CAMERA_PITCH_DEGREES * DEG),
  y: Math.sin(CAMERA_PITCH_DEGREES * DEG),
  z: Math.cos(CAMERA_YAW_DEGREES * DEG) * Math.cos(CAMERA_PITCH_DEGREES * DEG),
} as const;

/**
 * How much of the kerb the bus covers during the arrival — **a whole bus length
 * beyond each end of the run, not a half.**
 *
 * Two separate half-lengths stack up here and it is easy to count only one:
 *
 * 1. `ENTRANCE_BUS_DOOR_X` names where the **door** stops, not the centre.
 *    `ArrivalSequence` works the centre back from the bus's own `doorDrop.z`,
 *    and the door is somewhere within the bus — so the centre can be up to half
 *    a length away from that mark.
 * 2. The **bodywork** then reaches half a length beyond the centre.
 *
 * One whole length covers both without importing a built bus to ask, and it
 * also swallows the gap between the bodywork and the silhouette: `CAT_BUS_*`
 * describe the box, while the tail, the whiskers and the swung-open door stand
 * up to 1.24 m proud of it. `check:cat-bus` measures the real thing against
 * these bounds, so "conservative" is a fact rather than a hope.
 *
 * Widening a keep-out costs a handful of decorative trees. Narrowing one is
 * what put trees across the bus in every frame of the first run anyone watched.
 */
const RUN_FROM_X = Math.min(ENTRANCE_BUS_ARRIVE_X, ENTRANCE_BUS_DOOR_X) - CAT_BUS_LENGTH;
const RUN_TO_X = Math.max(ENTRANCE_BUS_ARRIVE_X, ENTRANCE_BUS_DOOR_X) + CAT_BUS_LENGTH;

/**
 * The bus's two flanks, each a whole width out from its centre line for the
 * silhouette reason above.
 *
 * Anything further out than {@link BUS_FAR_Z} is behind the bus and cannot
 * occlude it whatever its height. Anything between the two is beside or over
 * the bus's own footprint, where the projection is meaningless and the answer
 * is simply *yes* — which is what clamping `back` at zero says.
 */
const BUS_FAR_Z = ENTRANCE_BUS_STOP_Z - CAT_BUS_WIDTH;
const BUS_NEAR_Z = ENTRANCE_BUS_STOP_Z + CAT_BUS_WIDTH;

/**
 * The ground the bus stands on — the height its silhouette starts from.
 *
 * Read from the terrain rather than assumed to be zero. The ground outside the
 * gate is flat only to z = 72 and then falls away hard (−1.35 m at 74, −14 m at
 * 80: the park is a diorama on a hilltop), so "sea level" and "the kerb" are
 * emphatically not the same number a few metres out, and the trees this has to
 * judge stand exactly in that falling band — which makes them *shorter* in the
 * shot than their own height suggests, and is why the corridor is not as wide
 * as it first looks.
 */
const BUS_GROUND_Y = terrainHeight(ENTRANCE_BUS_DOOR_X, ENTRANCE_BUS_STOP_Z);

/**
 * Does a thing standing here, this tall, hide any part of the arriving bus?
 *
 * @param x     where it stands.
 * @param z     where it stands.
 * @param top   the world height of its **highest point** — its own ground plus
 *              its own height. The grazing ray is cast from the top because a
 *              ray that clears the top of a thing is not blocked by it; every
 *              ray below that one is.
 */
export function hidesTheArrivingBus(x: number, z: number, top: number): boolean {
  // Behind the bus: it cannot be in front of what it is not in front of.
  // (`d.z` is positive — the camera is on the +z side.)
  if (z <= BUS_FAR_Z) return false;

  const back = Math.max(0, (z - BUS_NEAR_Z) / TOWARDS_CAMERA.z);
  const topAtBus = top - TOWARDS_CAMERA.y * back;
  // Its whole silhouette lands below the kerb: it hides ground, not bus.
  if (topAtBus <= BUS_GROUND_Y) return false;

  const xAtBus = x - TOWARDS_CAMERA.x * back;
  return xAtBus >= RUN_FROM_X && xAtBus <= RUN_TO_X;
}

/**
 * The corridor's own numbers, for a check that would rather measure than trust.
 *
 * Exported so `check:cat-bus` can state where the boundary fell on this build
 * instead of asserting against a copy of it.
 */
export const ARRIVAL_SIGHTLINE = {
  towardsCamera: TOWARDS_CAMERA,
  runFromX: RUN_FROM_X,
  runToX: RUN_TO_X,
  busFarZ: BUS_FAR_Z,
  busNearZ: BUS_NEAR_Z,
  busGroundY: BUS_GROUND_Y,
  busTop: CAT_BUS_TOP,
} as const;
