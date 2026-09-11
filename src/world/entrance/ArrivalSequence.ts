import { Group, Vector3 } from 'three';
import {
  angleDelta,
  clamp01,
  createRandom,
  DEG,
  lerp,
  smoothstep,
  turnTowards,
} from '../../core/mathUtils';
import { terrainHeight } from '../terrain';
import type { FrameContext } from '../../core/types';
import type { Player } from '../../entities/Player';
import type { NpcCharacter } from '../../entities/npc/NpcCharacter';
import { NPC_WALK_SPEED } from '../../entities/npc/NpcCharacter';
import {
  CHILD_FOOTPRINT,
  TALLEST_CHILD_HEIGHT,
  KID_EYE_HEIGHT,
} from '../../art/models/kid';
import {
  createCatBus,
  CAT_BUS_DOOR_DROP,
  CAT_BUS_LONGEST_WALK_TO_DOOR,
  CAT_BUS_SEAT_COUNT,
  CAT_BUS_TOP,
  type CatBusHandle,
} from './catBus';
import {
  CAMERA_PITCH_DEGREES,
  CAMERA_VIEW_HEIGHT,
  CAMERA_YAW_DEGREES,
} from '../../core/constants';
import { cameraOffset } from '../../core/cameraRig';
import { createBusDriver, type BusDriver } from './busDriver';
import { playBrakeSqueak, playDoorHiss, playHornToot } from './sounds';
import { markArrived } from './arrivalFlag';
import {
  ENTRANCE_BUS_DOOR_X,
  ENTRANCE_GATE_X,
  ENTRANCE_GATE_Z,
  ENTRANCE_PLAYER_X,
  ENTRANCE_PLAYER_Z,
} from './layout';
import {
  entranceBusArriveAt,
  entranceBusVanishAt,
  entranceRoadAt,
  entranceRoadFacing,
} from './roadRoute';

/**
 * **The cat bus arrival — the scripted timeline.**
 *
 * The bus, the children, the sounds and the waypoints all shipped in PR #27 on
 * 26 July 2026 and none of them ever ran: that PR added six files under
 * `world/entrance/` and wired **none** of them, so `Entrance` was never
 * constructed and the string `cat-bus` did not appear in the shipped bundle at
 * all. What was missing was never the art — it was this file.
 *
 * ## Why it hangs off `World` and not off `Game`
 *
 * `Game` cannot be built in a test: it constructs `Engine`, a real
 * `WebGLRenderer`. `World` **can** — `scripts/park-harness.mts` builds a real
 * `Scene` and a real `World` in Node, and `test/procgen/parkFacts.ts` traverses
 * the result. So a cat bus owned by `World` is visible to the invariant suite
 * CI blocks the merge on, and one owned by `Game` would be visible to nothing.
 *
 * ## The children are park NPCs, and always were
 *
 * Jim, 7 August 2026: *"These are the park NPCs, and should continue as such
 * when they are in the park, joining NPCs already there."*
 *
 * So this sequence **borrows** eleven of the park's own children for the first
 * fifteen seconds of their lives. It does not build them, it does not own them,
 * and — the fault that made the ruling necessary — **it does not dispose of
 * them.** The previous version created eleven one-off `createKid()` models and
 * deleted them in `dispose()`, which is why Jim watched children *"get off the
 * bus, walk in and vanish"*. There is no conversion step, because a conversion
 * step is a second definition of who each child is and the two definitions
 * drift apart. There is only a claim (`NpcCharacter.beginScripted`), a puppet
 * string (`setScriptedPose`), and letting go (`endScripted`).
 *
 * It could not have worked any other way: `KidCrowd` sizes a fixed-capacity
 * `InstancedMesh` from `NPC_COUNT` and `InstancedCrowd.spawn()` **throws** when
 * it is exhausted, so eleven children joining the crowd *on arrival* is not a
 * thing this engine can do. They have to be NPCs from birth, which is exactly
 * the shape that was wanted.
 *
 * ## The order she experiences it in — she gets off first
 *
 * The player used to be made to sit and watch every other child file out before
 * her turn came. Eleven children cannot leave one doorway quickly: a child is
 * {@link CHILD_FOOTPRINT} across, so at {@link NPC_WALK_SPEED} the doorway
 * cannot clear faster than one child every ~0.71 s, and eleven of them is the
 * better part of nine seconds however it is arranged. Making a six-year-old
 * watch that before she may move is the wrong nine seconds.
 *
 * So **she steps down first and walks in first**, and the rest of the bus
 * unloads behind her while she already has the controls. The bus waits at the
 * kerb until the last of them is clear, then pulls away — by which time she has
 * been playing for several seconds and it is happening in her peripheral
 * vision, which is where a departing bus belongs.
 */

/**
 * How long a child needs to be clear of the doorway before the next one may
 * follow — **derived, not chosen**.
 *
 * A child is {@link CHILD_FOOTPRINT} wide and walks at {@link NPC_WALK_SPEED},
 * so this is simply how long they take to move their own width. Anything
 * shorter and two of them are inside each other in the door, which is precisely
 * the *"they still get off so close in time that their models all overlap"*
 * Jim reported — that version used a 0.42 s gap against children it believed to
 * be 0.6 m wide.
 */
const KID_DOORWAY_GAP = CHILD_FOOTPRINT / NPC_WALK_SPEED;

/** A little extra, varied, so the queue is not a metronome. */
const KID_DAWDLE = 0.3;

/** Fixed, so the arrival plays the same way every time the family watches it. */
const ARRIVAL_SEED = 20260807;

/**
 * When each child steps down, in seconds after the doors open.
 *
 * **Cumulative rather than `index * gap + jitter`**, and that is the whole fix.
 * The old form added an independent jitter of up to 0.9 s to a 0.42 s spacing,
 * so adjacent children could not only land on the same instant but swap order.
 * Accumulating instead makes the gap a floor that no amount of jitter can eat
 * into: child *n + 1* leaves at least {@link KID_DOORWAY_GAP} after child *n*,
 * always, and the dawdle only ever makes it longer.
 *
 * Computed once at module scope, from a fixed seed, because the timeline below
 * has to know how long the bus must wait — and a phase length that disagrees
 * with the stagger it is supposed to contain is the same class of bug as
 * everything else in this file's history.
 */
const KID_DELAYS: readonly number[] = (() => {
  const rng = createRandom(ARRIVAL_SEED);
  const delays: number[] = [];
  let when = 0;
  for (let index = 0; index < CAT_BUS_SEAT_COUNT - 1; index += 1) {
    delays.push(when);
    when += KID_DOORWAY_GAP + rng() * KID_DAWDLE;
  }
  return delays;
})();

/**
 * The longest anybody spends walking down the inside of the bus to the door.
 *
 * **Children walk out; they do not teleport out.** The first version moved each
 * child from their seat straight to the pavement in a single frame, which
 * `check:jitter` caught at once — an 8.8 m step and an apparent 26.9 m/s, right
 * at the door, against bounds of 1 m and 8 m/s. That check exists because
 * something writing a child's position behind their own movement code is how
 * the park train once accelerated its passengers to 2,200 m/s, and it was
 * entirely right to complain.
 *
 * It also just looked wrong: with real windows in the bus you can now watch the
 * seats, so a child blinking out of one and appearing on the step is a jump cut
 * in the middle of the shot.
 */
const KID_AISLE_SECONDS = CAT_BUS_LONGEST_WALK_TO_DOOR / NPC_WALK_SPEED;

/** How long the last child needs to walk clear before the bus may move. */
const KID_CLEAR_SECONDS = 1.8;

const LAST_KID_DELAY = KID_DELAYS[KID_DELAYS.length - 1] ?? 0;

/** How long each phase lasts, in seconds. Exported so a check can drive it. */
const ROLLING_IN = 3.0;
const DOORS_OPENING = 0.8;
const STEPPING_DOWN = 1.0;
const WALKING_IN = 4.5;
/** The bus actually driving off, once it is empty. */
const BUS_PULLS_AWAY = 3.0;

/**
 * How long the bus sits with its door open after she has already gone in.
 *
 * Derived from the stagger above: everyone must be off, and clear, before it
 * moves. If the queue is made slower this grows on its own rather than the bus
 * driving away with children still aboard.
 */
const BUS_WAITS_FOR_THE_REST = Math.max(
  0,
  LAST_KID_DELAY + KID_AISLE_SECONDS + KID_CLEAR_SECONDS -
    (DOORS_OPENING + STEPPING_DOWN + WALKING_IN),
);

export const ARRIVAL_TIMELINE = {
  /** Rolling along the kerb to the stop. */
  rollingIn: ROLLING_IN,
  /** The door swinging open. */
  doorsOpening: DOORS_OPENING,
  /** The player stepping down onto the pavement — first off. */
  steppingDown: STEPPING_DOWN,
  /** Walking in through the gate. */
  walkingIn: WALKING_IN,
  /** She has the controls throughout; the bus empties, waits, then leaves. */
  departing: BUS_WAITS_FOR_THE_REST + BUS_PULLS_AWAY,
} as const;

export type ArrivalPhase =
  | 'rolling-in'
  | 'doors-opening'
  | 'stepping-down'
  | 'walking-in'
  | 'departing'
  | 'done';

/** Index of the doors-opening phase in {@link PHASE_ORDER} — when children may move. */
const DOORS_OPEN_PHASE = 1;

const PHASE_ORDER: readonly (readonly [ArrivalPhase, number])[] = [
  ['rolling-in', ARRIVAL_TIMELINE.rollingIn],
  ['doors-opening', ARRIVAL_TIMELINE.doorsOpening],
  ['stepping-down', ARRIVAL_TIMELINE.steppingDown],
  ['walking-in', ARRIVAL_TIMELINE.walkingIn],
  ['departing', ARRIVAL_TIMELINE.departing],
];

/** Total run time, derived rather than restated. */
export const ARRIVAL_DURATION = PHASE_ORDER.reduce((total, [, seconds]) => total + seconds, 0);

/** When she is handed the controls — the number that actually matters. */
export const ARRIVAL_CONTROL_AT =
  ARRIVAL_TIMELINE.rollingIn +
  ARRIVAL_TIMELINE.doorsOpening +
  ARRIVAL_TIMELINE.steppingDown +
  ARRIVAL_TIMELINE.walkingIn;

/**
 * How many other children ride in with her.
 *
 * Every seat is filled and one of them is hers, so this is simply the rest.
 * Derived from the bus's own seat count — the bus owns how many seats it has.
 */
export const ARRIVAL_KID_COUNT = CAT_BUS_SEAT_COUNT - 1;



/**
 * **How high the arrival camera's eye rides: a child's eye height, plus the
 * clearance a *camera* needs that a child does not.**
 *
 * `KID_EYE_HEIGHT` (#586, 1.5164 m, measured off the built rig) is the one
 * owner of where a child's eyes are — and it describes exactly that. **It does
 * not describe where a camera may sit.** A camera also carries a near plane,
 * and a near plane inside the ground is the floor drawn across the bottom of
 * frame however high the eye nominally is. That margin belongs to the camera,
 * not to the child, which is why it is added here rather than folded into the
 * constant.
 *
 * Generous against the rig's own 0.1 m near plane: the ground under the eye is
 * sampled at a point, and a camera a hand's breadth above a curved surface is
 * still on the wrong side of it a metre away.
 */
/**
 * **The world point every child steps down onto** — the drop, in world space,
 * asked of the road and the bus rather than restated.
 *
 * Exported so `check:arrival-camera` can measure the shot against the ground it
 * is actually over. The check used to model the focus at an arbitrary point,
 * which is fine for angles and useless for clearance: how far the eye is above
 * the grass depends entirely on *where in the park it is standing*.
 */
export function arrivalDoorDropWorld(): { readonly x: number; readonly z: number } {
  const facing = busFacingAtStop(BUS_STOP_AT);
  const stop = entranceRoadAt(BUS_STOP_AT);
  return busLocalToWorld(stop.x, stop.z, CAT_BUS_DOOR_DROP.x, CAT_BUS_DOOR_DROP.z, facing);
}

/**
 * **How high the ground is that the arrival's eye has to clear — the one
 * owner, and the whole of what "not inside the ground" means here.**
 *
 * Jim, 6 September 2026: *"it should not be drawn inside the ground in any way,
 * even taking the curvature into account."* The last clause is the load-bearing
 * one and it is why this is not a point sample.
 *
 * **Why the curvature changes the question.** The ground is a sphere of
 * {@link GROUND_SPHERE_RADIUS} now, so it falls away from the park's centre as
 * `r²/2R`. The eye stands `distance` metres from the drop, *towards the gate* —
 * which is towards the middle of the park, where the ground is **higher**.
 * Measured on the canonical seed: the drop sits at radius 75.0 m where the
 * terrain is −2.465 m, and the eye stands at radius 59.4 m where it is
 * −1.76 m. Anchoring the shot's height to the ground under the *drop* would put
 * the lens 0.7 m into a hill it cannot see, and the further back the shot
 * stands the worse that gets — which is precisely the failure his sentence
 * names.
 *
 * So this returns the **highest** ground the eye has to be above, over:
 *
 * - the drop itself and the eye's own footprint;
 * - the run between them, because on a convex ground the middle of a chord
 *   stands higher than either end, and that is the ground the shot looks
 *   along;
 * - a disc around the eye of the shot's **own frame half-height**, because an
 *   orthographic near plane is a rectangle that size, not a point — ground
 *   inside it is ground drawn across the picture. Derived from the shot's zoom
 *   rather than chosen, so a tighter frame automatically samples a smaller
 *   disc.
 *
 * `doorFocus` sits {@link ARRIVAL_EYE_HEIGHT} above whatever this returns, and
 * `check:arrival-camera` asserts the result never leaves
 * {@link ARRIVAL_EYE_FLOOR_MARGIN} of clearance. **They are one call, not two
 * numbers that agree.**
 */
function arrivalGroundUnderEye(
  drop: { readonly x: number; readonly z: number },
  shot: { readonly yawDegrees: number; readonly pitchDegrees: number; readonly distance: number; readonly zoom: number },
): number {
  const eye = cameraOffset(shot.yawDegrees * DEG, shot.pitchDegrees * DEG, shot.distance);
  const eyeX = drop.x + eye.x;
  const eyeZ = drop.z + eye.z;
  let highest = Math.max(terrainHeight(drop.x, drop.z), terrainHeight(eyeX, eyeZ));
  // Along the run the shot looks down.
  for (let step = 1; step < ARRIVAL_GROUND_SAMPLES; step += 1) {
    const f = step / ARRIVAL_GROUND_SAMPLES;
    highest = Math.max(highest, terrainHeight(drop.x + eye.x * f, drop.z + eye.z * f));
  }
  // The near face's own reach around the eye.
  const reach = CAMERA_VIEW_HEIGHT / (2 * Math.max(0.01, shot.zoom));
  for (let step = 0; step < ARRIVAL_GROUND_BEARINGS; step += 1) {
    const bearing = (step / ARRIVAL_GROUND_BEARINGS) * Math.PI * 2;
    highest = Math.max(highest, terrainHeight(eyeX + Math.cos(bearing) * reach, eyeZ + Math.sin(bearing) * reach));
  }
  return highest;
}

/** How finely the run from the drop to the eye is sampled. A metre or so at the shot's longest. */
const ARRIVAL_GROUND_SAMPLES = 24;
/** Bearings round the eye. Twelve is every 30°, finer than the ground bends. */
const ARRIVAL_GROUND_BEARINGS = 12;

/**
 * **The whole of the arrival camera, as Jim stated it on 6 September 2026:**
 * *"the rule should be simple - camera fixed on the player, about 2m from them,
 * at head height, until they're in the park - that's it."*
 *
 * That sentence replaced a shot with four beats — a wide roll-in, a door beat
 * orbiting the bus's own drop point, a walk beat, and an arch pass with a dive
 * and a hold — plus the constants that answered each of them. They are deleted
 * rather than left in place, because a constant kept "in case" is a second
 * answer to a question nobody is asking any more.
 *
 * **The one place the rule does not map straight onto this rig**, and it is
 * worth stating rather than hiding: the park camera is **orthographic**, so an
 * eye's distance from its subject changes nothing on screen. "About 2 m from
 * them" therefore lands as two separate facts — a 2 m stand-back, which is
 * purely an occlusion control here, and a frame height, which is what actually
 * makes her that size. {@link ARRIVAL_FOLLOW_ZOOM} is the second of those, sized
 * so she fills the frame the way a 2 m stand-back would.
 */
export const ARRIVAL_FOLLOW_DISTANCE = 2;

/**
 * How tall the frame is while the arrival owns the camera, in metres of world.
 *
 * A child plus a little air, and nothing to do with the bus: the subject is
 * her. Derived from {@link TALLEST_CHILD_HEIGHT} so a child who grows reframes
 * the shot, and kept a shade above her so the tallest possible hat has
 * somewhere to go — `check:arrival-camera` asserts both edges.
 */
const ARRIVAL_FOLLOW_FRAME_HEIGHT = TALLEST_CHILD_HEIGHT * 1.2;
export const ARRIVAL_FOLLOW_ZOOM = CAMERA_VIEW_HEIGHT / ARRIVAL_FOLLOW_FRAME_HEIGHT;

/**
 * How long the bearing takes to come home to the rig's own yaw at the end.
 *
 * **The only interpolation left in the shot, and it is about her thumb rather
 * than the picture.** GAME_DESIGN.md's CONTROL rule reads "up on the stick"
 * through the camera's yaw, so handing her the controls while the bearing is
 * still moving sends her somewhere that is not up the screen. Snapping it at
 * the hand-over would be a visible cut on the frame she takes control, which is
 * the worst possible instant for one.
 */
const ARRIVAL_YAW_HOME_SECONDS = 0.6;

export const ARRIVAL_EYE_FLOOR_MARGIN = 0.3;

/**
 * **A little higher than her own eyes.** Jim, 6 September 2026, on the sphere
 * preview: *"the entry camera on spherical world is basically good, it just
 * needs to be closer to the player and also a little higher."*
 *
 * A **composition** number, and said so plainly rather than dressed up as a
 * derivation: he asked to be looking slightly over her rather than dead level
 * with her face, and how much is a thing you answer by looking at a frame. It
 * is deliberately not folded into {@link ARRIVAL_EYE_FLOOR_MARGIN} — that one
 * is the camera's safety clearance over the ground and must not move when
 * somebody re-judges the framing, which is exactly the confusion that gets a
 * lens driven into the grass.
 *
 * **Bounded by her feet, not by taste alone.** At zero pitch the aim rises with
 * the eye, so lifting this drops her down the frame; lift it far enough and her
 * feet leave the bottom. `check:arrival-camera` measures that and fails, so the
 * band this can move in is held by a check rather than by care.
 */
const ARRIVAL_EYE_COMPOSITION_LIFT = 0.3;

/**
 * **How high the arrival's eye rides above the ground it is over** — the one
 * owner, and the number `doorFocus` actually uses.
 *
 * Exported on 6 September 2026 to kill a second definition. `check:arrival-
 * camera` was asserting the eye's height against `ARRIVAL_DOOR_FOCUS_LIFT`, a
 * constant **nothing in `src/` read** — `doorFocus` has used this expression
 * since the eye was anchored under itself. So the check was measuring a number
 * the game did not use, and would have gone on passing while the shot moved.
 * That constant is deleted rather than kept "in case"; a spare definition of a
 * height is how this comes back.
 */
const ARRIVAL_EYE_HEIGHT = KID_EYE_HEIGHT + ARRIVAL_EYE_FLOOR_MARGIN + ARRIVAL_EYE_COMPOSITION_LIFT;

/**
 * **Which way the bus points while it is standing at the stop.**
 *
 * Was `atan2(TRAVEL_X, TRAVEL_Z)` — a constant, because the bus drove down a
 * straight kerb and never turned. It drives a road that follows the park's edge
 * now, so its facing is a function of where it is along that road, and this is
 * simply that function asked at the stop. Everything that used to read the
 * constant wants the *stopped* bus's frame — the seated riders' facing, the
 * door's world position, the walk routes off it — so they all ask here, and the
 * moving bus asks `entranceRoadFacing` per frame instead.
 */
function busFacingAtStop(stopAt: number): number {
  return entranceRoadFacing(stopAt);
}

// ---------------------------------------------------------------------------
// The arrival camera: three placements, and the path between them
// ---------------------------------------------------------------------------

/**
 * **What Jim asked for, and what the first attempt got wrong.**
 *
 * Jim, on what the arrival should do: *"when the bus arrives at the park, the
 * camera needs to face the bus's doors as the children get off the bus, then
 * follow your character as they walk into the park and under the arch, and
 * then once through the arch the camera moves up to its usual pseudo-isometric
 * perspective."*
 *
 * The first version of this changed the **pitch** (38° → 26° → 38°) and the
 * look-at point, and nothing else. He watched it and said *"why doesn't the
 * camera follow into the park like asked for?"* and *"this is nothing like
 * what I asked for."*
 *
 * The reason it could not have worked is worth writing down, because it is a
 * property of this game's rig rather than a matter of taste. **The park camera
 * is orthographic.** Sliding an orthographic eye along its own view axis
 * changes literally nothing on screen; the only three things that can make an
 * orthographic shot a different shot are its **yaw**, its **pitch** and the
 * **point it is looking at**. That first attempt held the yaw at the park's one
 * eternal 45° for the whole sequence — so however much the tilt moved, the park
 * was still being seen from exactly the compass angle it is always seen from,
 * and "the camera never went anywhere" was a correct description of the frame.
 *
 * So this shot swings the yaw round to stand square-ish to the bus's door,
 * drops the pitch to a child's eye line, pushes in on the step, and then
 * *travels* — the yaw arcs back round and the pitch lifts while the focus rides
 * along with her through the gateway — landing on the rig's own pose exactly.
 */

/**
 * **Where the camera stands to face the doors: square-on to the bus's own
 * side, on whichever side of it the gate is.**
 *
 * Derived from {@link entranceRoadFacing} — *the bus's own idea of which way it
 * points* — and nothing else. That matters more than it looks. This used to
 * be `atan2(gate - busStop)`, the **gate-to-stop line**, which gives the same
 * answer only while the bus happens to stand at right angles to it. It did,
 * so it was right, so nothing said otherwise. The curved road then turned the
 * bus 12 degrees without moving it much, and the two parted company by exactly
 * that: the bus would have swung under a camera that did not swing with it.
 * Two definitions of one thing agreeing by coincidence — this repo's most
 * expensive habit, and this file has form.
 *
 * `cameraOffset` puts the eye at `focus + offset` looking back down `-offset`,
 * so the offset wanted here points **from the bus towards the gate**: a camera
 * standing between the two, facing the bus, which is where somebody waiting to
 * meet the children would stand.
 */
/**
 * **Where the bus stops, as a position along the road's arc.**
 *
 * The same value `ArrivalSequence` gives its own `stopAt` — the bus's door
 * drop, read from {@link CAT_BUS_DOOR_DROP}, which is `catBus.ts`'s one owner
 * of where the door puts a child down. Read from there rather than written
 * down here: a second number that "should match" the door is exactly how this
 * shot came to be derived against a road the bus no longer drives.
 */
const BUS_STOP_AT = CAT_BUS_DOOR_DROP.z;

/**
 * The shot's geometry, solved once against the **road as it actually curves**
 * and then cached.
 *
 * **Lazy rather than module-scope-eager on purpose.** `roadRoute.ts` builds
 * its `RingPath` off the seeded park boundary, so anything that asks it a
 * question at import time is asking before the seed is necessarily set. These
 * are wanted only once a bus is arriving, by which point the park exists.
 */
let shotGeometry: { readonly squareOnDegrees: number; readonly doorDistance: number } | null = null;

function arrivalShotGeometry(): { readonly squareOnDegrees: number; readonly doorDistance: number } {
  if (shotGeometry !== null) return shotGeometry;
  const facing = entranceRoadFacing(BUS_STOP_AT);
  const stop = entranceRoadAt(BUS_STOP_AT);
  // Perpendicular to the way the bus points, taken on whichever side the gate
  // is — a bus turned by the road's curve carries the shot round with it.
  const travelX = Math.sin(facing);
  const travelZ = Math.cos(facing);
  const towardsGateX = ENTRANCE_GATE_X - stop.x;
  const towardsGateZ = ENTRANCE_GATE_Z - stop.z;
  // Both perpendiculars; keep the one that points at the gate.
  const sign = Math.sign(travelZ * towardsGateX - travelX * towardsGateZ) || 1;
  const squareOnDegrees = Math.atan2(sign * travelZ, -sign * travelX) / DEG;
  // **The stand-back is a ground-plan distance from the stop to the gate**, not
  // a difference of z. On the straight road those were the same number and the
  // z-difference was written down; the arc separates them, and a shot standing
  // the wrong distance back is a shot with the park's furniture in front of it.
  const doorDistance =
    (Math.hypot(towardsGateX, towardsGateZ) - ARRIVAL_GATE_STANDOFF) /
    Math.cos(ARRIVAL_DOOR_PITCH_DEGREES * DEG);
  shotGeometry = { squareOnDegrees, doorDistance };
  return shotGeometry;
}

function squareOnToTheDoorDegrees(): number {
  return arrivalShotGeometry().squareOnDegrees;
}

/**
 * How far off square-on the door shot sits, in degrees, turned towards the
 * rig's own bearing — so the camera looks **along the kerb** at the bus rather
 * than straight through the gateway at it.
 *
 * **This is the number that decides whether the arch frames the shot or lands
 * on top of it**, and the reason is the projection rather than taste. An
 * orthographic camera puts everything on the view axis at the same screen
 * point, however far apart the two things are — so from square-on, where the
 * gate, the door and the lens are collinear, the arch draws itself squarely
 * across the doorway at the same size it would be if it were touching the bus.
 * It was photographed doing exactly that: the LAND OF GOOD PLACES sign lying
 * across a child's chest as she stepped down. There is no pitch and no zoom
 * that moves it, because in this projection nothing about distance moves
 * anything.
 *
 * Turned this far down the kerb the arch stands at the edge of frame, as the
 * thing she is about to walk under rather than a thing across her. It also
 * gives the doorway some depth — dead square-on to an orthographic bus is a
 * flat elevation drawing — and shortens the arc the camera has to travel on
 * the way home, so the swing under the arch stays a move rather than a spin.
 *
 * **The quantity this is really setting**, and the one to re-measure if the
 * bus stop ever moves, is the screen-horizontal separation between the drop
 * point the shot orbits and the arch's *nearer pier*:
 *
 * ```
 * separation = D · sin θ − ENTRANCE_GATE_HALF_WIDTH · cos θ
 *              where D = distance from the drop to the gate line
 * ```
 *
 * Measured today: D = 7.70 m, θ = 60° → **4.52 m**. The working band is
 * roughly **2 m** at the bottom — a child is `CHILD_FOOTPRINT` 1.53 m across,
 * and below that the pier is drawn on top of her, which at θ = 25° it is
 * (−0.64 m: the pier is past her) — and the frame's own half-width at the top,
 * **7.17 m** on a 16:10 screen at {@link ARRIVAL_DOOR_ZOOM}, beyond which the
 * arch leaves the frame entirely and stops framing anything. On a 390×844
 * phone that ceiling is only **3.29 m**, so the arch is already at the very
 * edge there.
 *
 * **`D` is not a constant — it is wherever the bus put its door**, so a stop
 * that moves nearer the wall shrinks the whole band. At D = 4.5 m the
 * separation cannot exceed 4.5 m at any θ, and 60° would give 1.75 m, which is
 * under the floor. That is not a number to nudge; it is a sign the shot needs
 * its focus moved out along the bus rather than its bearing turned further.
 */
const ARRIVAL_DOOR_THREE_QUARTER_DEGREES = 0;

/**
 * The bearing the door shot is taken from. **Square-on, and nothing else.**
 *
 * Jim, 3 September 2026, having watched the three-quarter version: *"The
 * camera should start facing the doors. Straight on to the doors."* That is
 * the spec, and it retires the 60° above.
 *
 * **The objection the 60° existed for is answered by moving the camera, not by
 * turning it.** The fault was real: from square-on the gate, the door and the
 * lens were collinear, and an orthographic projection puts everything on the
 * view axis at the same screen point, so the sign drew itself across a child's
 * chest whatever the pitch or zoom. But that was a camera standing
 * `ENTRANCE_CLEAR_RADIUS` **past** the gate, looking back through the archway
 * at the bus. The arch was between the lens and the subject because the camera
 * had put it there.
 *
 * {@link arrivalDoorDistance} now stands the eye **short of the gate**,
 * between the drop and the archway, so the arch is behind the lens and cannot
 * land on anybody. Square-on then costs nothing — and it is also what makes
 * the rest of Jim's sentence possible, because a camera already on the bus
 * side of the gateway is a camera that can *glide through it with her* rather
 * than watch her come towards it.
 */
export function arrivalDoorYawDegrees(): number {
  const squareOn = squareOnToTheDoorDegrees();
  return (
    squareOn +
    Math.sign(angleDelta(squareOn * DEG, CAMERA_YAW_DEGREES * DEG)) *
      ARRIVAL_DOOR_THREE_QUARTER_DEGREES
  );
}

/**
 * **How low the door shot sits**, in degrees of downward tilt. **Zero — the
 * view direction is purely horizontal.**
 *
 * Jim, 3 September 2026, shown a photograph of the sign lying across a child's
 * chest: *"The camera can just be lower there. It should be looking purely
 * horizontally."*
 *
 * **This is what makes square-on possible, and it is the only thing that
 * could have.** The fault it fixes was the arch drawing itself across the
 * subject when the gate, the door and the lens are collinear. Two parameters
 * were tried against it and neither can work:
 *
 * - **Bearing** (`ARRIVAL_DOOR_THREE_QUARTER_DEGREES`, once 60°) moves the
 *   arch aside, but only by giving up "straight on to the doors", which is the
 *   thing actually asked for.
 * - **Stand-back** does nothing at all. An orthographic camera renders
 *   everything along the view ray whatever the eye's position on that ray, so
 *   standing the eye short of the gate leaves the arch exactly where it was.
 *   That was tried, photographed, and is the trap
 *   {@link ARRIVAL_GATE_STANDOFF} now warns about.
 *
 * **Pitch is neither of those.** With the view direction horizontal, world
 * *height* maps to frame height: the sign hangs `GATE_ARCH_CLEAR_HEIGHT` up,
 * the child stands on the ground, and the arch therefore projects **above**
 * her instead of across her. It was the downward tilt that folded the two
 * together, which is also why no stand-back ever helped — the one parameter
 * being varied was the one that genuinely could not separate them.
 *
 * **The old objection, and why it no longer decides this.** 12° was once tried
 * and rejected because a very low tilt collapses the ground plane, so the bus
 * read as hanging in the air above the boundary wall. That is a real effect
 * and it will be visible here too. It is now outranked: Jim has seen the
 * alternative and chosen this, and a horizontal camera at a child's eye
 * height is *also* the natural way to watch children get off a bus. If the
 * ground plane reads badly, the answer is the height the shot is taken at,
 * not a reintroduced tilt.
 *
 * The rig's own pitch is still where the shot lands — see the `lift` curve in
 * {@link arrivalShot}, which now holds zero through the gateway and does the
 * whole climb afterwards.
 */
const ARRIVAL_DOOR_PITCH_DEGREES = 0;

/**
 * How far short of the gate line the door shot stands, in metres.
 *
 * **This does NOT put the arch behind the lens, and nothing about a stand-back
 * ever could.** An earlier version of this comment claimed it did; it was
 * wrong, it was photographed being wrong, and the correction is worth more
 * than the constant. An orthographic camera renders everything along the view
 * ray whatever the eye's position on that ray — the near plane sits far
 * behind the eye, which is the same property that once let the eye end up
 * *inside* a pier without being clipped away. Moving the eye 3 m nearer the
 * bus leaves the archway exactly where it was in frame.
 *
 * What actually makes square-on possible is {@link ARRIVAL_DOOR_PITCH_DEGREES}
 * being zero. Read that first.
 *
 * So what this constant is still for is smaller and honest: it keeps the eye
 * on the bus side of the archway so the shot **starts inside the gateway's
 * approach**, which is what lets it glide *through* the opening with her
 * rather than watch her walk towards it.
 *
 * It is also the first metre of Jim's third beat. A camera already inside the
 * gateway's approach is one that can **glide through the opening ahead of
 * her** as she walks up to it, which is what *"as they walk through the gates
 * the camera should glide to follow them under"* asks for. The old 20.8 m
 * stand-back was on the far side of the arch looking back, and could only ever
 * watch her come towards it.
 *
 * Big enough that the eye is unambiguously on the bus side of the archway
 * rather than in its mouth — the arch's own piers stand at
 * `ENTRANCE_GATE_HALF_WIDTH`, and an eye level with them would have them in
 * the frame edges from the first frame.
 */
const ARRIVAL_GATE_STANDOFF = 3;

/**
 * **How far back the door shot's eye stands, in metres — and this is about
 * what is in the way, not about how big anything looks.**
 *
 * An orthographic camera has no size falloff, so this cannot frame anything:
 * every object lands on the same pixels whatever it is set to. The only thing
 * it decides is **which geometry sits between the lens and the bus**, and on
 * this shot that is the whole difficulty. The door faces *into* the park, so
 * any bearing that faces the door is also looking down the length of the park,
 * and at the rig's own 90 m stand-back that means whatever the seed put there:
 * the rail race's track and pylons on one bearing, the hotel tower straight
 * through the middle on another. Both were photographed while building this.
 * Nothing tuneable fixes that, because it is a different obstacle on every
 * seed.
 *
 * So the eye comes forward until it is standing **in the park's own gateway**,
 * and the horizontal run is derived from the one thing in the world that
 * promises a clear line: `ENTRANCE_CLEAR_RADIUS`, the disc `Scenery.ts` keeps
 * free of trees and bushes around the stop and the gate. Stand within that and
 * the deep park is behind the lens, where it cannot intrude, and the only
 * things left between the camera and the children are the gateway and the arch
 * — which are the subject's own setting rather than clutter across it.
 *
 * Divided by the pitch's cosine because {@link cameraOffset} takes a slant
 * distance and the reasoning above is entirely about ground plan.
 */
function arrivalDoorDistance(): number {
  return arrivalShotGeometry().doorDistance;
}


/**
 * How much air the close shot leaves around a child, as a multiple of her own
 * height.
 *
 * **The subject is the child, not the bus**, and that is the change Jim asked
 * for: *"as the child gets out of the bus I want the camera much closer to
 * them."* It used to frame {@link CAT_BUS_TOP} — the whole vehicle, ears
 * included — which put her at a sixth of the frame with the bus filling the
 * rest. Framed against {@link TALLEST_CHILD_HEIGHT} instead she is nearly half
 * of it, and the bus becomes the thing she is stepping out of rather than the
 * thing being photographed.
 *
 * Still derived rather than dialled: a child who grows re-frames the shot, the
 * same way a bus that grew used to.
 *
 * **2.2 -> 1.7 on 6 September 2026**, on Jim's *"it just needs to be closer to
 * the player"* against the sphere preview. She goes from 45% of frame height to
 * **59%**. The floor on this number is her own feet: at zero pitch the aim sits
 * {@link ARRIVAL_EYE_COMPOSITION_LIFT} above her eyeline, so a tighter frame
 * crops her from the bottom before it crops her head. `check:arrival-camera`
 * measures the margin under her feet and fails if it goes.
 */
const ARRIVAL_CLOSE_FRAMING_AIR = 1.7;

/** The push-in on the doorway itself, once the bus has stopped. */
const ARRIVAL_DOOR_ZOOM =
  CAMERA_VIEW_HEIGHT / (TALLEST_CHILD_HEIGHT * ARRIVAL_CLOSE_FRAMING_AIR);


/**
 * **How far back the eye stands while it goes under the arch, in metres.**
 *
 * Jim, on the follow: *"the camera to follow them as they go under the arch"*,
 * and then the decisive clarification — *"ie, the camera goes under the arch
 * as well."* Not a camera outside the gateway watching her walk through it.
 * It travels through the opening itself, a few metres behind her, and comes
 * out into the park on the other side.
 *
 * In an orthographic rig that is entirely a question of this number, because
 * stand-back is the only control over what lies between the eye and the
 * subject — and the eye's own position is then a real path through the world,
 * so it has to fit through a real hole. Two clearances bound it, both measured
 * off the arch rather than guessed:
 *
 * - **Headroom.** The eye rides at `focus.y + d·sin(pitch)` and must pass under
 *   {@link GATE_ARCH_CLEAR_HEIGHT}, 3.60 m above the paving. The focus during
 *   the pass is the ordinary player-follow one — her feet plus `IsoCamera`'s
 *   `CAMERA_FOCUS_LIFT`, 1.25 m — so `d·sin(pitch)` has to stay under 2.35 m.
 * - **The opening.** The eye trails her by `d·cos(pitch)` along the bearing,
 *   which by then is the rig's own 45°, so it is off to one side by
 *   `d·cos(pitch)·sin(45°)`. {@link GATE_ARCH_CLEAR_WIDTH} is 7.00 m, so that
 *   has to stay under 3.5 m or the camera goes through a pier instead of the
 *   gap.
 *
 * **Two different numbers, and it matters which is quoted.** At 4.0 m and the
 * door shot's own 24° tilt the eye rides 1.63 m above her chest — 0.72 m of
 * headroom — and passes 2.58 m to her side, 0.92 m clear of the pier. Those
 * are the *nominal* margins, at the pose the dive aims for. What
 * `check:arrival-camera` actually asserts is the worst of a swept pass, and
 * the worst sample is not at that pose: the tilt is already lifting by the
 * time the eye is on the gate line, which costs height. Swept, the margins are
 * **0.37 m of headroom and 0.81 m of sideroom** — roughly half the nominal
 * figure in the first case. Quote the swept numbers when asking whether this
 * fits; the nominal pair only describes the instant the dive bottoms out.
 */
const ARRIVAL_ARCH_DISTANCE = 4.0;

/**
 * How far past the gate she has walked by the time the *eye* is through it —
 * the eye's own offset along z, at the pose it holds during the pass.
 *
 * **Signed, and the sign is the point.** `cameraOffset` puts the eye on the
 * side its offset points, so this is positive when the eye TRAILS her (it sits
 * on the bus side, and crosses the gate after she does) and negative when it
 * LEADS her (it sits between her and the archway, and is through before she
 * is). Nothing downstream may assume either — see {@link ArchPass}.
 *
 * It used to be taken at `CAMERA_YAW_DEGREES`, the rig's 45°, which was right
 * only while the shot came home to the rig's bearing *before* the pass. It no
 * longer does: the bearing is held square-on all the way through the gateway,
 * so the pass is flown at {@link squareOnToTheDoorDegrees} and that is
 * the bearing this has to be measured at. Square-on points from the bus
 * towards the gate, so this went negative and the eye became a leading one —
 * which is what *"the camera should glide to follow them under"* actually
 * asks for, and it is also why the shot no longer has to drag the eye back
 * out through the plane of the arch at speed.
 *
 * Derived rather than timed, so it stays true if the bearing or the stand-back
 * change.
 */
function arrivalArchEyeOffsetZ(): number {
  return (
    ARRIVAL_ARCH_DISTANCE *
    Math.cos(ARRIVAL_DOOR_PITCH_DEGREES * DEG) *
    Math.cos(squareOnToTheDoorDegrees() * DEG)
  );
}



/**
 * **How long the rise keeps going after she has the controls**, in seconds.
 *
 * The pitch is the one part of the shot that is deliberately still moving at
 * the hand-over. Jim's third beat is *"once through the arch the camera moves
 * up to its usual pseudo-isometric perspective"*, and she is through the arch
 * and holding the controls at the same instant ({@link ARRIVAL_CONTROL_AT}) —
 * so a rise that had already finished by then would have happened in front of
 * her instead of under her hand, which is the difference between the game
 * handing her the park and the game making her watch one more second of
 * something.
 *
 * **The yaw, by contrast, is home before she can touch anything, and that is
 * not a taste call.** `IsoCamera.forward`/`right` — the axes "up on the stick"
 * is read through — are solved once from the rig's fixed yaw and never move.
 * A camera still swinging while she walks would therefore mean pressing up
 * sends her somewhere that is not up the screen, which is precisely the class
 * of thing GAME_DESIGN.md's CONTROL rule exists to forbid. A pitch that is
 * still lifting has no such problem: "up the screen" is the same ground
 * direction at every tilt.
 *
 * Clamped to the phase it has to fit inside, so a shorter `departing` shortens
 * this rather than leaving the camera mid-rise when the sequence ends.
 */
export const ARRIVAL_RISE_TAIL = Math.min(1.6, ARRIVAL_TIMELINE.departing);

/** On the arrival's own clock: the instant the bus has stopped at the kerb. */
/** The instant she steps off the kerb and starts walking in. */
export const AT_WALKING = ARRIVAL_CONTROL_AT - ARRIVAL_TIMELINE.walkingIn;
/** The instant the whole shot has landed on the rig's own pose. */
export const AT_SHOT_HOME = ARRIVAL_CONTROL_AT + ARRIVAL_RISE_TAIL;

/**
 * **The beats `/arrive?at=` can open on, on the arrival's own clock.**
 *
 * Jim asked twice for a link that lands on her *getting off the bus* and a
 * link that lands on the park *after* the arrival, rather than one that starts
 * a nine-second sequence he then has to sit through — twice, on every round of
 * feedback, on a park that is different on every seed.
 *
 * **Every number here is summed from {@link ARRIVAL_TIMELINE}, never typed.**
 * Lengthen a phase and these move with it. A hand-written 3.8 here would be a
 * second definition of the timeline and would be found wrong by whoever
 * shortened `doorsOpening` — this repo's most common bug, and this file has
 * already paid for it once.
 */
export const ARRIVAL_BEATS = {
  /** The bus still rolling along the kerb — the ordinary `/arrive`. */
  'rolling-in': 0,
  /** The bus stopped, the door swinging open. */
  'doors-opening': ARRIVAL_TIMELINE.rollingIn,
  /** **Her stepping down onto the pavement**, first off the bus. */
  'stepping-down': ARRIVAL_TIMELINE.rollingIn + ARRIVAL_TIMELINE.doorsOpening,
  /** Off the kerb, walking in through the gate. */
  'walking-in': AT_WALKING,
  /** **The end state**: she is in the park and has the controls. */
  park: ARRIVAL_CONTROL_AT,
} as const;

export type ArrivalBeat = keyof typeof ARRIVAL_BEATS;

/**
 * The fixed step {@link ArrivalSequence.runTo} replays the timeline at — a
 * 60 fps frame, so the replay is the sequence the game itself would have run.
 */
const BEAT_STEP = 1 / 60;

/** Whether a hand-typed `?at=` names a beat. Nothing else may be trusted. */
export function isArrivalBeat(name: string): name is ArrivalBeat {
  return Object.hasOwn(ARRIVAL_BEATS, name);
}

/**
 * **When she is under the arch, and when the camera is out the other side** —
 * both on the arrival's own clock.
 *
 * Measured off her actual walk rather than assumed to be a fraction of it:
 * `walkIn` drives her along a quadratic bezier under a `smoothstep`, so the
 * instant she crosses the gate line is not a round number and moves whenever
 * the drop, the gate or the phase length does. `ArrivalSequence` solves it
 * once, at construction, from the very curve it will walk.
 */
export interface ArchPass {
  /** The instant **she** crosses the gate line. */
  readonly sheThrough: number;
  /**
   * The instant the **eye** crosses it — which may be before or after she
   * does, depending on the sign of {@link arrivalArchEyeOffsetZ}.
   *
   * **Do not assume an order.** These were once called `under` and `clear`,
   * names that quietly asserted the eye came second; when the shot went
   * square-on the eye began leading her and every interval built on that
   * assumption went negative. The tell was a derived walking pace printing as
   * −3.65 m/s. Take `Math.min`/`Math.max` of the pair rather than subtracting
   * one from the other in a fixed order.
   */
  readonly eyeThrough: number;
}

/** One frame of the arrival camera — a placement, not a nudge. */
export interface ArrivalShot {
  /** Compass bearing the camera looks from, degrees. */
  readonly yawDegrees: number;
  /** Downward tilt, degrees. */
  readonly pitchDegrees: number;
  /**
   * How far back the eye stands, metres. **Occlusion, not framing** — see
   * `IsoCamera.setShotOverride`. Orthographic: it changes what can get in the
   * way and nothing else.
   */
  readonly distance: number;
  /** Framing. 1 is the ordinary playing view. */
  readonly zoom: number;
  /**
   * **True only while the shot still has a moving zoom to write.**
   *
   * `nudgeZoom` writes the same field `setZoomTarget` does, so every frame a
   * caller re-asserts a *constant* zoom is a frame her pinch or wheel notch is
   * silently discarded — that is #329, and it was found the hard way once
   * already. The zoom here finishes moving at {@link ARRIVAL_CONTROL_AT}, the
   * very instant she is handed the controls, but the shot itself runs on for
   * {@link ARRIVAL_RISE_TAIL} afterwards while the tilt lifts. Without this
   * flag those 1.6 seconds are spent writing `setZoomTarget(1)` every frame at
   * a child who can already pinch.
   *
   * Decided here rather than in `Game.tick` because this is where the reason
   * lives and where a check can reach it.
   */
  readonly ownsTheZoom: boolean;

  /**
   * True while the **bus's own door** is the subject and the camera should
   * orbit `ArrivalSequence.doorFocus` instead of the player. False everywhere
   * else, which includes the whole walk in: `walkIn` already drives her along
   * a bezier from the step through the gateway, so the ordinary damped
   * player-follow *is* beat two, and it translates with her by construction.
   */
  readonly watchesTheDoor: boolean;
}

/**
 * **The whole camera, as a function of one number.**
 *
 * A pure function of the arrival's own elapsed seconds, for the reason
 * `arrivalSpawn.ts` exists: the caller is `Game.tick()`, `Game` builds a real
 * `WebGLRenderer` and cannot be constructed in a test, so a camera decision
 * made inline in there is a camera decision no check can reach — which is
 * exactly how the last camera bug on this feature stayed green.
 *
 * **One continuous clock rather than a per-phase lookup**, and that is what
 * makes the third beat expressible at all. The rise has to cross the boundary
 * between `walking-in` and `departing` — it starts before she has the controls
 * and finishes after — and a function of the *phase* cannot say that. It also
 * means every easing here is stated once, in seconds, against instants derived
 * from {@link ARRIVAL_TIMELINE}: lengthen a phase and the shot stretches with
 * it rather than desynchronising from it.
 *
 * Returns `null` once the shot has landed, which is the honest way to say
 * "the ordinary camera owns this now" — the caller then clears its overrides
 * and the rig is the single owner of the pose again.
 */
export function arrivalShot(elapsed: number, archPass: ArchPass): ArrivalShot | null {
  if (elapsed >= ARRIVAL_CONTROL_AT) return null;
  // The arch pass is no longer part of the shot's shape — see the header. Kept
  // in the signature because `Game` has it to hand and a future beat may want
  // it; reading it here would be reinstating choreography that has been ruled
  // out.
  void archPass;

  return {
    // **Square on to her.** In an orthographic rig the bearing is the whole of
    // "the camera is on her" — an ortho eye's distance changes nothing you can
    // see, so yaw and pitch are the entire vocabulary. Held from the first
    // frame to the hand-over, then the rig's own yaw takes over in one step
    // because `ArrivalShot` stops being returned.
    //
    // **It must land on the rig's yaw by `ARRIVAL_CONTROL_AT`**, and that is
    // not composition: GAME_DESIGN.md's CONTROL rule reads "up on the stick"
    // through the camera's yaw, so a bearing still moving under her hand sends
    // her somewhere that is not up the screen. This comes home over the last
    // {@link ARRIVAL_YAW_HOME_SECONDS} rather than snapping, which is the one
    // interpolation left in the shot and is about her thumb rather than the
    // picture.
    yawDegrees:
      CAMERA_YAW_DEGREES +
      (angleDelta(CAMERA_YAW_DEGREES * DEG, arrivalDoorYawDegrees() * DEG) / DEG) *
        (1 -
          smoothstep(
            0,
            1,
            (elapsed - (ARRIVAL_CONTROL_AT - ARRIVAL_YAW_HOME_SECONDS)) /
              ARRIVAL_YAW_HOME_SECONDS,
          )),
    // **Head height, at the park camera's own angle.**
    //
    // This was `0` — "at head height means looking level" — and that reading
    // of Jim's sentence is what he then reported three times as *"the camera
    // is under the floor"* and *"walls in the foreground sitting on
    // nothing"*. Two explanations were relayed to him as fact without being
    // measured (a composition consequence of the level look; the dolly
    // opening on a 20 m frame) and both were wrong. This is the measured one.
    //
    // **An orthographic camera at zero pitch cannot see the ground at all.**
    // Ortho rays are parallel, so at pitch 0 every ray in the frame is
    // *horizontal* and stays at its own height for ever. The ground is
    // therefore not a surface in the picture, it is a single line where the
    // terrain crosses eye height; every ray below that line runs underneath
    // the terrain (single-sided, so it draws nothing) all the way to the far
    // plane. The bottom of the frame is void by construction, and anything
    // standing in it — the bus's flank, the gate-arch piers, the rail-race
    // trestle legs — is drawn sitting on nothing. Exactly his sentence.
    //
    // Measured in the page at his own 1.82 aspect, ray-picking a 3x9 grid of
    // the frame at seven beats across the whole 9.3 s shot: `terrain` was hit
    // **once in 189 picks**. At t=1.5, 3.2 and 4.0 the entire frame is
    // `cat-bus-shell-lower`/`cat-bus-door-panel`; at t=6.5 two of the three
    // columns are `NOTHING` from top to bottom. A 21-rung ladder down the
    // frame returned `hitY == rayY` at every rung — the rays never descend,
    // which is the mechanism itself, read off the running game.
    //
    // So the pitch is the rig's own, {@link CAMERA_PITCH_DEGREES}, and for
    // the same reason the yaw comes home to {@link CAMERA_YAW_DEGREES}: this
    // shot hands over to the ordinary park camera, and the park camera's
    // angle is the one angle in this game that is known to show a floor. It
    // is one owner, not a second number that agrees — and it also removes a
    // 38-degree pitch swing at the hand-over that nobody had asked for.
    //
    // "At head height" survives where it is actually visible: an ortho eye's
    // *position* changes nothing on screen, so what that phrase buys is the
    // frame being centred on her head at {@link ARRIVAL_FOLLOW_FRAME_HEIGHT},
    // and it still is. What the pitch buys is that the lower half of that
    // frame has ground in it.
    pitchDegrees: CAMERA_PITCH_DEGREES,
    // **About 2 m from her.** Jim's number, held for the whole shot.
    distance: ARRIVAL_FOLLOW_DISTANCE,
    zoom: ARRIVAL_FOLLOW_ZOOM,
    ownsTheZoom: true,
    // **Never.** "Fixed on the player" is the rule, so the ordinary damped
    // player-follow is the whole of the tracking and there is no second focus
    // to arbitrate against. The door beat that used to orbit `doorFocus` is
    // gone with the rest of the choreography.
    watchesTheDoor: false,
  };
}

/**
 * Re-exported from `arrivalFlag.ts`, which is where it is now defined.
 *
 * It had to move so that `main.ts` could ask it without importing this file,
 * which drags in `terrain` and `boundary` and so solves `PARK_BOUNDARY` — see
 * that function's own note. `Entrance` still reads it from here, and there is
 * still one definition of "is the arrival due".
 */
export { arrivalIsDue } from './arrivalFlag';


/** A point in the bus's own local space, in world space, for a bus at `(bx, bz)` facing `facing`. */
function busLocalToWorld(
  bx: number,
  bz: number,
  lx: number,
  lz: number,
  facing: number,
): { x: number; z: number } {
  const cos = Math.cos(facing);
  const sin = Math.sin(facing);
  return { x: bx + lx * cos + lz * sin, z: bz - lx * sin + lz * cos };
}

interface Vector2Like {
  readonly x: number;
  readonly z: number;
}

/**
 * **The control point that makes a walk actually pass through the gate at the
 * x it was aimed at.**
 *
 * The route's middle point is called the corner and its comment calls it *"the
 * point they funnel through"*, and until now it was neither: a quadratic
 * Bézier does not pass through its control point, it is only pulled towards
 * it. On the straight road that was harmless, because the step down and the
 * gate were on the same axis, so the curve sagged symmetrically and the sag
 * cost nothing. #498's arc moved the bus's door drop off that axis — the bus
 * stands on a curve now and steps its children down at an angle to it — and
 * the sag stopped being symmetric. Measured by `check:cat-bus`: **child 0
 * crossed the boundary at across = −4.95 m, 0.65 m outside a gate opening that
 * is ±4.30 m**, walking through the masonry beside the arch.
 *
 * Widening the opening or narrowing the fan would both be numbers tuned until
 * this seed passed. This solves it instead: find the parameter at which the
 * curve crosses the gate line, and place the control point so that the curve
 * is at `gateX` *there*.
 *
 * ```
 * x(t) = (1−t)²·from.x + 2(1−t)t·corner.x + t²·to.x
 * ```
 *
 * is linear in `corner.x`, so inverting it for a chosen `x(t*)` is one line and
 * exact. `t*` comes from the z equation, which is unaffected because the corner
 * keeps its own z on the gate line.
 *
 * Where the crossing is too close to either end for that inversion to be
 * stable — the denominator `2(1−t*)t*` going to zero — the aimed-at x is
 * returned unchanged, which is exactly the old behaviour. That cannot happen
 * with a drop outside the wall and a destination well inside it, but a fallback
 * that silently divides by zero is how a camera path ends up at `NaN`.
 */
function funnelCorner(from: Vector2Like, to: Vector2Like, gateX: number): Vector2Like {
  const corner = { x: gateX, z: ENTRANCE_GATE_Z };
  // Where does the curve cross the gate line? z(t) with corner.z on the line.
  const a = from.z - 2 * corner.z + to.z;
  const b = 2 * (corner.z - from.z);
  const c = from.z - ENTRANCE_GATE_Z;
  let crossing = Number.NaN;
  if (Math.abs(a) < 1e-9) {
    if (Math.abs(b) > 1e-9) crossing = -c / b;
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      for (const t of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
        if (t > 0 && t < 1 && (Number.isNaN(crossing) || t < crossing)) crossing = t;
      }
    }
  }
  const weight = Number.isNaN(crossing) ? 0 : 2 * (1 - crossing) * crossing;
  if (weight < 1e-3) return corner;
  const rest = (1 - crossing) * (1 - crossing) * from.x + crossing * crossing * to.x;
  return { x: (gateX - rest) / weight, z: corner.z };
}

/** One walker's route: off the pavement, through the gate, into the park. */
interface WalkRoute {
  readonly from: Vector2Like;
  readonly corner: Vector2Like;
  readonly to: Vector2Like;
}

/**
 * A Bézier's length, and the map from *distance walked* back to its parameter.
 *
 * **A quadratic Bézier's parameter is not its arc length**, and treating it as
 * one is a subtler version of the same mistake as budgeting the control
 * polygon. Advancing `t` at a constant rate walks the curve at a speed that
 * varies with how tightly it is bending: on these routes the first stride out
 * of the doorway is taken at **1.3 m/s** and the last at well over 3, on a
 * child who is supposed to walk at a constant 2.55.
 *
 * That is not a cosmetic wrongness. The slow part is exactly the part next to
 * the door, so every child dawdles precisely where the next one is about to
 * step down on top of them — measured, two children 0.49 m apart at the step,
 * inside a 1.8 m body. Staggering their departures cannot fix a queue that
 * slows down at its own exit.
 *
 * So the curve is sampled once, at construction, into a table of cumulative
 * distances, and walking it is a lookup: *"I have walked 4.2 m; where is that?"*
 * Constant speed, and the guard that asserts they walk at the park's pace is
 * then asserting something true at every instant rather than on average.
 */
interface ArcTable {
  /** Cumulative distance at each of {@link ARC_SAMPLES} + 1 evenly spaced `t`. */
  readonly distances: readonly number[];
  readonly total: number;
}

const ARC_SAMPLES = 48;

function buildArcTable(a: Vector2Like, c: Vector2Like, b: Vector2Like): ArcTable {
  const distances: number[] = [0];
  let previous = a;
  let total = 0;
  for (let step = 1; step <= ARC_SAMPLES; step += 1) {
    const point = bezier(a, c, b, step / ARC_SAMPLES);
    total += Math.hypot(point.x - previous.x, point.z - previous.z);
    distances.push(total);
    previous = point;
  }
  return { distances, total };
}

/**
 * How far inside the wall a disembarking child must be before they are
 * genuinely "in the park" rather than still crossing the gate — the same
 * z depth `world/entrance/BusJourney.ts`'s own road measures itself against
 * ("never closer than 0.65 m outside the park... z 52 inside the park").
 * `ENTRANCE_GATE_Z` (60) is the wall itself; releasing right at it would
 * hand a child to `WanderDriver.rejoinGraph`, which anchors on whatever
 * `PoiGraph` node is *nearest* — reachable from outside the wall at all only
 * by accident, since the graph is built for the park's own interior.
 */
const RELEASE_Z = ENTRANCE_GATE_Z - 8;

/**
 * How far along a child's own arc they have walked when they first cross
 * {@link RELEASE_Z} — the point past which issue #269 QA hands them to the
 * normal wander driver instead of continuing the scripted route.
 *
 * Walked, not just computed from the curve's shape: two children on the same
 * route can cross the same z at different arc distances if their curve bows
 * differently, and the arc table is the one place that already maps "how far
 * walked" to "where on the curve", so this reuses it rather than re-deriving
 * a second answer to the same question.
 */
function releaseDistanceFor(table: ArcTable, route: WalkRoute): number {
  for (let index = 0; index < table.distances.length; index += 1) {
    const t = index / (table.distances.length - 1);
    const point = bezier(route.from, route.corner, route.to, t);
    if (point.z <= RELEASE_Z) return table.distances[index]!;
  }
  // The curve never reaches RELEASE_Z (should not happen — every route passes
  // through the gate on its way to a point deep in the park) — fall back to
  // walking the whole thing rather than releasing nowhere.
  return table.total;
}

/** The curve parameter at which this much of the curve has been walked. */
function tAtDistance(table: ArcTable, distance: number): number {
  if (distance <= 0) return 0;
  if (distance >= table.total) return 1;
  const { distances } = table;
  let low = 0;
  let high = distances.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (distances[mid]! <= distance) low = mid;
    else high = mid;
  }
  const before = distances[low]!;
  const after = distances[high]!;
  const span = after - before;
  const within = span > 1e-6 ? (distance - before) / span : 0;
  return (low + within) / ARC_SAMPLES;
}

/** A quadratic Bézier — a rounded walk rather than two straight legs. */
function bezier(a: Vector2Like, c: Vector2Like, b: Vector2Like, t: number): { x: number; z: number } {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    z: u * u * a.z + 2 * u * t * c.z + t * t * b.z,
  };
}

/** Reused rather than allocated every frame — `getWorldPosition` needs a target. */
const SCRATCH = new Vector3();

/** How fast anyone in this sequence turns to face where they are going, rad/s. */
const TURN_RATE = 7;

/**
 * How close two children get before they push each other apart, in metres.
 *
 * **A whole child**, from the model, not the 0.72 m this file used to use with
 * a comment claiming *"a child is about 0.6 m across"*. A child is 1.53 m
 * across — it is nearly all head — so 0.72 m was a personal space entirely
 * inside the person it belonged to.
 */
const KID_PERSONAL_SPACE = CHILD_FOOTPRINT;

/** How fast a push-apart correction fades once the crowding is over, m/s. */
const NUDGE_DECAY = 1.2;

/**
 * The most a child may ever be nudged off their own route.
 *
 * Without a cap this accumulates: a child standing on the step is permanently
 * within a body's width of the passengers still sitting inside the bus beside
 * them, so the correction was re-applied every frame and grew to **several
 * metres**, teleporting children into the park at 12 m/s past the gate. Half a
 * body is as far as anybody needs to step aside, and a correction bigger than
 * that means the routes are wrong rather than the crowd being tight.
 */
const NUDGE_LIMIT = CHILD_FOOTPRINT / 2;

/** One child's scripted walk out of the bus and into the park. */
interface KidWalk {
  readonly route: WalkRoute;
  readonly arc: ArcTable;
  /** Arc distance at which this child is handed to the normal wander driver
   * — see {@link releaseDistanceFor}. Short of {@link ArcTable.total}: the
   * route's tail into the park (issue #269) is never walked by the script. */
  readonly releaseDistance: number;
  readonly speed: number;
  /** Where this child sits, and how long their walk to the door takes. */
  seat: Group | null;
  aisleSeconds: number;
  /** Lateral correction from the push-apart, carried between frames. */
  nudgeX: number;
  nudgeZ: number;
  /** Set once, when the child is handed back to their own wander driver. */
  released: boolean;
}

export interface ArrivalOptions {
  /**
   * A bus that already exists — Stage B's journey handing its own bus over at
   * the kerb. Omitted, one is built here.
   */
  readonly bus?: CatBusHandle;
}

export class ArrivalSequence {
  readonly group = new Group();

  private readonly bus: CatBusHandle;
  private readonly busDriver: BusDriver;
  private readonly playerRoute: WalkRoute;
  private readonly kidWalks: readonly KidWalk[];

  /** The park's own children, borrowed for the ride. Never owned, never freed. */
  private kids: readonly NpcCharacter[] = [];

  /** Seconds since the doors opened — the clock every child's own walk reads. */
  private kidClock = 0;
  /**
   * **Where the bus's centre comes to rest, in metres along the road**, worked
   * back from where its door has to end up.
   *
   * The gate is arc zero and the bus drives down *decreasing* arc, so its
   * forward is `-at` and a door sitting `doorDrop.z` ahead of the centre puts
   * the centre that far *up* the arc. Same derivation as the `stopX` this
   * replaces — a longer bus still stops with its door at the arch — with the
   * straight kerb's `x` swapped for the curved road's own parameter.
   */
  private readonly stopAt: number;
  /** The stopped bus's yaw. Constant, unlike the driving bus's. */
  private readonly stopFacing: number;

  private player: Player | null = null;
  private phaseIndex = 0;
  private phaseTime = 0;
  private busAt = entranceBusArriveAt();
  private busSpeed = 0;
  private doneFlag = false;
  private handedOver = false;
  private tootedHorn = false;
  private squeaked = false;
  private hissed = false;
  private playerFacing = 0;

  /**
   * The pose {@link update} computed for the player this frame, re-applied at
   * the very end of `World.update` by {@link reassertPlayerPose}. One
   * computation, two applications — never two computations.
   */
  private readonly playerPose = { x: 0, y: 0, z: 0, facing: 0, walking: false, gait: 0, live: false };

  constructor(options: ArrivalOptions = {}) {
    this.group.name = 'cat-bus-arrival';

    this.bus = options.bus ?? createCatBus();
    this.group.add(this.bus.root);
    this.bus.setDoorOpen(0);

    // The bus knows where its own door is; the layout knows where the door
    // should end up. Working back from the two is what keeps them from
    // drifting apart — and means a longer bus still stops with its door at the
    // gate rather than needing a second constant nudged by hand.
    this.stopAt = this.bus.doorDrop.z;
    this.stopFacing = busFacingAtStop(this.stopAt);
    this.playerFacing = this.stopFacing;
    this.placeBus(entranceBusArriveAt());

    // The driver rides at the wheel and never gets out. He is the one person
    // here who is not a park NPC — see `busDriver.ts`.
    this.busDriver = createBusDriver();
    this.bus.driverSeat.add(this.busDriver.root);

    // Routes are derived from where the bus's own door actually is.
    const stop = entranceRoadAt(this.stopAt);
    const drop = busLocalToWorld(
      stop.x,
      stop.z,
      this.bus.doorDrop.x,
      this.bus.doorDrop.z,
      this.stopFacing,
    );
    const end = { x: ENTRANCE_PLAYER_X, z: ENTRANCE_PLAYER_Z };
    this.playerRoute = {
      from: drop,
      corner: funnelCorner(drop, end, ENTRANCE_BUS_DOOR_X),
      to: end,
    };

    // **Everybody leaves by the door.** They used to be scattered along 6.2 m
    // of kerb the instant their turn came — eleven children 0.62 m apart, which
    // is less than half a child, so they began their walk already inside one
    // another. Now they all step down onto the same spot and fan out *after*
    // it, which is both what a bus looks like and what keeps them apart: two
    // children leaving 0.75 s apart on diverging bearings are metres away from
    // each other by the time the second one is clear of the step.
    const rng = createRandom(ARRIVAL_SEED + 7);
    const walks: KidWalk[] = [];
    for (let index = 0; index < ARRIVAL_KID_COUNT; index += 1) {
      const across = ARRIVAL_KID_COUNT <= 1 ? 0 : index / (ARRIVAL_KID_COUNT - 1) - 0.5;
      const wobble = (amount: number): number => (rng() - 0.5) * 2 * amount;

      const start = { x: drop.x + wobble(0.35), z: drop.z + wobble(0.25) };
      const finish = {
        // Same rule at the far end: 2.4 m of spacing, so the wobble cannot
        // reorder them here either.
        x: end.x + across * 24 + wobble(1.0),
        z: end.z - 2.4 - rng() * 5.5 - Math.abs(across) * 1.4,
      };
      const route: WalkRoute = {
        from: start,
        // The point they funnel through. Two competing constraints, and the
        // first version got the balance wrong in a way that showed:
        //
        // - The opening is only ~8.8 m wide, so a fan wider than the gate walks
        //   them into the masonry either side of it.
        // - But **the jitter must stay smaller than the spacing**, or adjacent
        //   children's aim points swap over and their routes cross. At
        //   `across * 3.4` the eleven corners were 0.34 m apart with a +/-0.4 m
        //   wobble on top — so neighbours regularly changed places, and two of
        //   them met in the middle at 0.54 m, well inside a 1.8 m child.
        //
        // 6 m of fan gives 0.6 m of spacing, comfortably more than the wobble,
        // and still leaves the outermost child half a body inside the gate.
        // **Solved so the curve is actually at this x on the gate line** — see
        // {@link funnelCorner}. Before that it was this x used directly as the
        // control point, which a quadratic Bézier does not pass through, and
        // once the arc moved the drop off the gate's axis the outermost child
        // walked through the masonry.
        corner: funnelCorner(start, finish, ENTRANCE_BUS_DOOR_X + across * 6.0 + wobble(0.2)),
        to: finish,
      };
      const arc = buildArcTable(route.from, route.corner, route.to);
      walks.push({
        route,
        arc,
        releaseDistance: releaseDistanceFor(arc, route),
        // The park's own pace, varied by a tenth either way. It is **not** an
        // independent number any more: `KID_WALK_SPEED = 1.5` was 46-75% of
        // what every other child in the park walks at, and it showed.
        speed: NPC_WALK_SPEED * (0.94 + rng() * 0.12),
        seat: null,
        aisleSeconds: 0,
        nudgeX: 0,
        nudgeZ: 0,
        released: false,
      });
    }
    this.kidWalks = walks;
  }

  /**
   * **When she goes under the arch, and when the trailing eye does** — solved
   * once, here, off the very bezier {@link walkIn} will walk her along.
   *
   * Not a fraction of `walkingIn` chosen to look about right: the curve is
   * quadratic and driven through a `smoothstep`, so her crossing of the gate
   * line is at neither the middle of the phase nor the middle of the curve,
   * and it moves whenever the drop, the gate or the phase length moves. On the
   * geometry as it stands she is under the arch **44%** of the way through the
   * walk — a camera timed to the phase would have started pulling away long
   * before she got there.
   *
   * Reads `ENTRANCE_GATE_Z` for the line and {@link arrivalArchEyeOffsetZ} for
   * how far past it she has walked by the time the eye is through, so both
   * follow the pose the shot actually holds rather than a second copy of it.
   */
  private solveArchPass(): ArchPass {
    const { from, corner, to } = this.playerRoute;
    // Inverting a smoothstep of a bezier analytically is not worth it; a
    // fine scan of the phase is exact to a frame and obviously correct.
    const steps = 480;
    const crossing = (line: number): number => {
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const at = bezier(from, corner, to, smoothstep(0, 1, t));
        if (at.z <= line) return AT_WALKING + t * ARRIVAL_TIMELINE.walkingIn;
      }
      // She never reaches it — cannot happen for a route that ends deep in the
      // park, but a shot that never releases would be far worse than one that
      // releases at the hand-over, so fail towards letting go.
      return ARRIVAL_CONTROL_AT;
    };
    const sheThrough = crossing(ENTRANCE_GATE_Z);
    // **No `Math.max` clamp, and no assumed order.** Subtracting the signed
    // offset gives the line she is on when the *eye* is on the gate line, and
    // that works for a leading eye and a trailing one alike: a positive offset
    // puts the line deeper in the park so she reaches it later, a negative one
    // puts it short of the gate so she reaches it earlier. The old clamp
    // silently pinned `clear` to `under` whenever the eye led, which is how a
    // leading eye could look like a zero-length pass instead of a bug.
    return { sheThrough, eyeThrough: crossing(ENTRANCE_GATE_Z - arrivalArchEyeOffsetZ()) };
  }

  /**
   * The two instants the camera's pass through the gateway is timed to.
   * Solved once — the route never changes after construction.
   */
  get archPassAt(): ArchPass {
    return (this.archPass ??= this.solveArchPass());
  }

  private archPass: ArchPass | null = null;

  /** The player, once `Game` has built her — via `World.attachPlayer`. */
  attachPlayer(player: Player): void {
    this.player = player;
    if (this.doneFlag) return;
    player.beginRide();
    this.poseSeated();
  }

  /**
   * The park's own children, once `World` has built the crowd.
   *
   * Claimed with `beginScripted()`, which is what exempts them from gravity,
   * collision, the soft park boundary and — the one that matters on a bus —
   * **separation**. Without that last exemption the crowd's relaxation pass
   * walks passengers out through the sides of the vehicle, because it can see
   * eleven children a metre or two apart and cannot see the bus at all.
   */
  attachNpcs(children: readonly NpcCharacter[]): void {
    if (this.doneFlag) return;
    this.kids = children.slice(0, ARRIVAL_KID_COUNT);
    for (const kid of this.kids) kid.beginScripted();

    // **Nearest the door first.** Whoever sits closest gets off first, which is
    // both what happens on a bus and what keeps the queue in order: the walk to
    // the door then gets *longer* with every child, so the gaps between people
    // appearing on the step can only widen from the stagger, never narrow.
    //
    // **Asked in the bus's own frame**, and that is the whole of issue #488's
    // disembark fault. `World`'s constructor calls this while the bus is still
    // standing at the far end of the road it has yet to drive — measured, 36.26 m
    // from the drop — so a *world* distance from a seat to the drop carried the
    // entire length of that drive. Every child's aisle walk came out at 12.7-16.3
    // seconds against the {@link KID_AISLE_SECONDS} 5.49 s this file's own
    // timeline budgets, so:
    //
    // - they crawled, because the lerp below covers the real ~5 m at whatever
    //   pace a 13-second budget implies — `check:cat-bus` saw 0.87 m/s;
    // - most of them never reached the door at all inside the sequence, and were
    //   left behind by the departing bus rather than walking out of it;
    // - and the 36 m every seat shared **compressed the differences between
    //   them**: two seats either side of the gangway are all but equidistant
    //   from a point 36 m away, which is the 0.02 s gap reported as "two
    //   children left the bus at once".
    //
    // The seat's offset from the door is a property of the bus, not of where the
    // bus is parked, so it is measured where it does not move — the same cure
    // `check:cat-bus` itself was given the day the bus started driving a curve.
    // {@link CatBusHandle.doorDrop} is the drop in those same local coordinates,
    // which is why the two are directly comparable.
    const door = this.bus.doorDrop;
    this.bus.root.updateMatrixWorld(true);
    const free = this.bus.seats
      .filter((seat) => seat !== this.bus.passengerSeat)
      .map((seat) => {
        const at = this.bus.root.worldToLocal(seat.getWorldPosition(new Vector3()));
        return { seat, distance: Math.hypot(at.x - door.x, at.z - door.z) };
      })
      .sort((a, b) => a.distance - b.distance);

    for (let index = 0; index < this.kidWalks.length; index += 1) {
      const walk = this.kidWalks[index];
      const slot = free[index];
      if (!walk || !slot) continue;
      walk.seat = slot.seat;
      walk.aisleSeconds = slot.distance / NPC_WALK_SPEED;
    }
    this.seatKids();
  }

  get phase(): ArrivalPhase {
    return this.doneFlag ? 'done' : (PHASE_ORDER[this.phaseIndex]?.[0] ?? 'done');
  }

  get finished(): boolean {
    return this.doneFlag;
  }

  /**
   * **Seconds since the bus first came into view** — the single clock
   * {@link arrivalShot} reads.
   *
   * Summed from the phases already finished plus however far into the current
   * one we are, rather than kept as a second accumulator beside
   * {@link phaseTime}: two clocks advanced by the same `dt` in two places is a
   * pair of numbers somebody has to keep in step by hand, and this file's own
   * history is what that costs. It also means it is `dt`-driven for free —
   * `update` returns early on `dt <= 0`, so `gameStore.setPaused(true)` stops
   * this clock exactly as it stops the bus, and no camera move can be stranded
   * half-finished by a pause or a slow frame.
   */
  get elapsed(): number {
    if (this.doneFlag) return ARRIVAL_DURATION;
    let total = this.phaseTime;
    for (let index = 0; index < this.phaseIndex && index < PHASE_ORDER.length; index += 1) {
      total += PHASE_ORDER[index]![1];
    }
    return total;
  }

  /**
   * **Where the camera looks during beat one: the spot on the pavement every
   * child steps down onto.**
   *
   * This is `playerRoute.from`, which is worked back from the bus's *own*
   * `doorDrop` — so a bus of a different length still gets its door framed,
   * and the shot cannot drift from the thing it is a shot of. Everybody leaves
   * by this one point (see the constructor), so it frames the whole queue
   * coming off, not just her.
   *
   * Lifted to {@link ARRIVAL_EYE_HEIGHT} over the ground under the eye — and since
   * the door beat looks purely horizontally, that is also the height the eye
   * itself stands at. Jim: *"For the arrival shot the camera should be face
   * height so the ground should be visible normally."*
   */
  get doorFocus(): Vector3 {
    const { x, z } = this.playerRoute.from;
    // **Anchored under the EYE, not under what it looks at.** Jim, 6 September
    // 2026: *"the camera should be at eye-height, not overlapping into the
    // floor"*.
    //
    // The door beat looks purely horizontally, so the eye sits at exactly this
    // focus's height — but it stands `distance` metres away, over ground that is
    // not the ground here. Anchoring the lift to the drop's own terrain left the
    // eye wherever the difference happened to put it: measured on the canonical
    // seed, **0.44 m of clearance** above the ground it was actually over, which
    // is ankle height and takes any camber or undulation straight into the floor.
    //
    // So the ground under the *eye* is what the lift is measured from — and,
    // since #511's sphere, the highest ground anywhere the near face reaches,
    // not a point sample. {@link arrivalGroundUnderEye} owns that question and
    // `check:arrival-camera` asserts against the same call. Resolvable without
    // circularity because the eye's x,z depend only on the shot's yaw and
    // stand-back, never on the focus's height.
    const shot = arrivalShot(this.elapsed, this.archPassAt);
    const groundUnderEye = shot
      ? arrivalGroundUnderEye({ x, z }, shot)
      : terrainHeight(x, z);
    return new Vector3(x, groundUnderEye + ARRIVAL_EYE_HEIGHT, z);
  }

  /** Where the bus is, for a check that wants to measure rather than trust. */
  get busPosition(): Vector3 {
    return this.bus.root.position.clone();
  }

  /** How many children are still aboard — for a check, and for the bus's patience. */
  get stillAboard(): number {
    return this.kidWalks.filter((walk) => !walk.released).length;
  }

  /**
   * **Runs the sequence forward to a beat, by actually playing it** — for
   * `/arrive?at=`, and for nothing else.
   *
   * The one rule this had to obey: **never construct a pose that merely looks
   * like the beat.** A hand-placed bus, a hand-placed child and a hand-written
   * camera would be a second definition of the arrival, and the whole value of
   * a link that lands on a beat is that it lands on *the* beat — the one a
   * child gets when she sits through the nine seconds. So this pumps
   * {@link update} with real `dt`, at a fixed step, exactly as the game would,
   * and simply does not draw the frames in between. Everything the sequence
   * drives — the bus, the eleven borrowed NPCs, her own walk, the sounds'
   * triggers — arrives at the beat having genuinely been through it.
   *
   * The step is {@link BEAT_STEP} rather than the caller's `dt`: this is a
   * fixed-step replay of a timeline, and using whatever the first real frame
   * happened to be would make the same URL land somewhere slightly different
   * on a slow machine.
   *
   * Returns how far it actually got, which is the honest answer when `target`
   * is past the end.
   */
  runTo(target: number, context: FrameContext): number {
    const step = { ...context, dt: BEAT_STEP };
    // Bounded rather than `while`: a beat that never arrives must not hang the
    // boot in front of whoever was sent the link.
    const limit = Math.ceil(ARRIVAL_DURATION / BEAT_STEP) + 2;
    for (let i = 0; i < limit; i += 1) {
      if (this.doneFlag || this.elapsed >= target) break;
      this.update(step);
    }
    return this.elapsed;
  }

  update(context: FrameContext): void {
    if (this.doneFlag) return;
    const { dt } = context;
    // Paused hands `dt` of zero, so the timeline stops on its own.
    if (dt <= 0) return;

    this.phaseTime += dt;
    const current = PHASE_ORDER[this.phaseIndex];
    if (!current) {
      this.finish();
      return;
    }
    const [phase, duration] = current;
    const t = clamp01(this.phaseTime / duration);

    switch (phase) {
      case 'rolling-in':
        this.rollIn(t, dt);
        break;
      case 'doors-opening':
        this.openDoors(t);
        break;
      case 'stepping-down':
        this.stepDown(t, dt);
        break;
      case 'walking-in':
        this.walkIn(t, dt);
        break;
      case 'departing':
        this.depart(t, dt);
        break;
      default:
        break;
    }

    // Every child walks on their own clock, every frame from the doors opening
    // onward — not on the phase's. That is what stops them moving in a line.
    if (this.phaseIndex >= DOORS_OPEN_PHASE) {
      this.kidClock += dt;
      for (let index = 0; index < this.kids.length; index += 1) this.advanceKid(index, dt);
      this.pushApart(dt);
    } else {
      this.seatKids();
    }

    this.bus.animate(dt, this.busSpeed);

    if (this.phaseTime >= duration) {
      this.phaseTime = 0;
      this.phaseIndex += 1;
      if (this.phaseIndex >= PHASE_ORDER.length) this.finish();
    }
  }

  /** See {@link playerPose} — re-applies, never recomputes. */
  reassertPlayerPose(): void {
    const player = this.player;
    if (!player || !this.playerPose.live || this.doneFlag) return;
    player.ridePosture = this.playerPose.walking ? 'walking' : 'seated';
    if (this.playerPose.walking) player.setScriptedWalk(this.playerPose.gait);
    player.setRidePose(this.playerPose.x, this.playerPose.y, this.playerPose.z, this.playerPose.facing);
  }

  // --- the phases ---------------------------------------------------------

  /**
   * Along the kerb to the stop, easing to a halt.
   *
   * The speed handed to `catBus.animate` is the **measured** one — how far it
   * actually moved this frame over `dt` — so the wheel spin and the tail swish
   * cannot disagree with the motion on screen.
   */
  private rollIn(t: number, dt: number): void {
    const previous = this.busAt;
    this.busAt = lerp(entranceBusArriveAt(), this.stopAt, smoothstep(0, 1, t));
    this.placeBus(this.busAt);
    // Metres of *road* per second, so the wheels and the tail still agree with
    // the motion on screen now that a metre of arc is a metre of travel.
    this.busSpeed = Math.abs(this.busAt - previous) / dt;

    if (!this.tootedHorn && t > 0.08) {
      this.tootedHorn = true;
      playHornToot();
    }
    if (!this.squeaked && t > 0.82) {
      this.squeaked = true;
      playBrakeSqueak();
    }
    this.poseSeated();
  }

  private openDoors(t: number): void {
    this.busSpeed = 0;
    if (!this.hissed) {
      this.hissed = true;
      playDoorHiss();
    }
    this.bus.setDoorOpen(smoothstep(0, 1, t));
    this.poseSeated();
  }

  /** Down the step onto the pavement, with a little hop. She goes first. */
  private stepDown(t: number, dt: number): void {
    this.busSpeed = 0;

    const player = this.player;
    if (!player) return;
    const seat = this.bus.passengerSeat.getWorldPosition(SCRATCH);
    const drop = this.playerRoute.from;
    const eased = smoothstep(0, 1, t);
    const x = lerp(seat.x, drop.x, eased);
    const z = lerp(seat.z, drop.z, eased);
    const ground = terrainHeight(x, z);
    const y = lerp(seat.y, ground, eased) + Math.sin(eased * Math.PI) * 0.16;

    this.playerFacing = turnTowards(
      this.playerFacing,
      Math.atan2(drop.x - seat.x, drop.z - seat.z),
      TURN_RATE * dt,
    );
    this.setPlayerPose(x, y, z, this.playerFacing, true, 1.1 * eased);
  }

  /** Through the gate and into the park, the other children spilling out behind. */
  private walkIn(t: number, dt: number): void {
    this.busSpeed = 0;

    const player = this.player;
    if (!player) return;
    const eased = smoothstep(0, 1, t);
    const here = bezier(this.playerRoute.from, this.playerRoute.corner, this.playerRoute.to, eased);
    const ahead = bezier(
      this.playerRoute.from,
      this.playerRoute.corner,
      this.playerRoute.to,
      Math.min(1, eased + 0.06),
    );
    const dx = ahead.x - here.x;
    const dz = ahead.z - here.z;
    const speed = Math.hypot(dx, dz) / 0.06 / Math.max(0.001, ARRIVAL_TIMELINE.walkingIn);

    if (dx !== 0 || dz !== 0) {
      this.playerFacing = turnTowards(this.playerFacing, Math.atan2(dx, dz), TURN_RATE * dt);
    }
    this.setPlayerPose(
      here.x,
      terrainHeight(here.x, here.z),
      here.z,
      this.playerFacing,
      true,
      Math.min(3.2, speed),
    );
  }

  /**
   * She already has the controls; the bus finishes unloading, then leaves.
   *
   * Handing over at the *start* of this phase is the whole point of the
   * reordering: a six-year-old should be walking into her park while the last
   * few children are still hopping down behind her, not standing on a pavement
   * waiting for a queue.
   */
  private depart(t: number, dt: number): void {
    this.handOver();
    // Her pose is no longer ours to write — she is driving.
    this.playerPose.live = false;

    const waitFraction = clamp01(BUS_WAITS_FOR_THE_REST / Math.max(0.001, ARRIVAL_TIMELINE.departing));
    if (t < waitFraction) {
      // Still unloading. The door stays open and the bus stays put.
      this.busSpeed = 0;
      return;
    }

    const driving = (t - waitFraction) / Math.max(0.001, 1 - waitFraction);
    const previous = this.busAt;
    if (driving < 0.18) {
      this.bus.setDoorOpen(1 - smoothstep(0, 0.18, driving));
      this.busSpeed = 0;
      return;
    }
    this.bus.setDoorOpen(0);
    this.busAt = lerp(this.stopAt, entranceBusVanishAt(), smoothstep(0.18, 1, driving));
    this.placeBus(this.busAt);
    this.busSpeed = Math.abs(this.busAt - previous) / dt;
  }

  // --- helpers ------------------------------------------------------------

  /**
   * Stands the bus `at` metres along the road, pointing the way the road goes.
   *
   * The whole of the curve arrives here: nothing else in this file knows the
   * road bends, because position *and* yaw both come from the same station, so
   * a bus can never be facing one way while standing somewhere the road turns
   * the other.
   */
  private placeBus(at: number): void {
    const station = entranceRoadAt(at);
    this.bus.root.position.set(station.x, terrainHeight(station.x, station.z), station.z);
    this.bus.root.rotation.y = entranceRoadFacing(at);
  }

  private setPlayerPose(
    x: number,
    y: number,
    z: number,
    facing: number,
    walking: boolean,
    gait: number,
  ): void {
    const pose = this.playerPose;
    pose.x = x;
    pose.y = y;
    pose.z = z;
    pose.facing = facing;
    pose.walking = walking;
    pose.gait = gait;
    pose.live = true;
    this.reassertPlayerPose();
  }

  /** Puts the player in her seat, wherever the bus currently is. */
  private poseSeated(): void {
    const player = this.player;
    if (!player) return;
    const seat = this.bus.passengerSeat.getWorldPosition(SCRATCH);
    this.setPlayerPose(seat.x, seat.y, seat.z, this.stopFacing, false, 0);
  }

  /**
   * Sits every child who has not got off yet in their own seat.
   *
   * Read off the seat's **world** matrix every frame rather than parenting the
   * child into it. A crowd member's rig root is where `NpcSystem` writes its
   * world position, so re-parenting it into a moving vehicle would make its own
   * `syncTransform` write a world coordinate into a local one — and the child
   * would ride at the bus's position *plus* their own. `getWorldPosition` is
   * the same answer without the second frame of reference.
   */
  private seatKids(): void {
    for (let index = 0; index < this.kids.length; index += 1) {
      const kid = this.kids[index];
      const walk = this.kidWalks[index];
      if (!kid || !walk || walk.released || !walk.seat) continue;
      walk.seat.getWorldPosition(SCRATCH);
      kid.setScriptedPose(SCRATCH.x, SCRATCH.y, SCRATCH.z, this.stopFacing, 0);
    }
  }

  /**
   * **Children do not walk through each other.**
   *
   * The previous version of this ran a relaxation pass that **could not
   * possibly have worked**: every frame it recomputed each child's position
   * from their Bézier curve with `position.set(...)`, *then* nudged them apart,
   * and the next frame's `position.set` threw the nudge away before anybody
   * ever saw it. The correction was real, correctly calculated, and discarded
   * 60 times a second.
   *
   * So the correction now lives in the child's own `nudge`, which **persists**
   * across frames and is added to the curve rather than overwritten by it, and
   * decays gently once the crowding passes. That is the difference between a
   * push-apart and a push-apart-shaped piece of arithmetic.
   */
  private pushApart(dt: number): void {
    for (let i = 0; i < this.kids.length; i += 1) {
      const a = this.kids[i];
      const wa = this.kidWalks[i];
      if (!a || !wa || wa.released || !this.onThePavement(i)) continue;
      for (let j = i + 1; j < this.kids.length; j += 1) {
        const b = this.kids[j];
        const wb = this.kidWalks[j];
        // **Only children who are actually outside.** Somebody still in their
        // seat is inside a vehicle, a metre from the doorway by construction,
        // and pushing the child on the step away from them is both meaningless
        // and unbounded — it is what grew the nudge to several metres.
        if (!b || !wb || wb.released || !this.onThePavement(j)) continue;
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const gap = Math.hypot(dx, dz);
        if (gap >= KID_PERSONAL_SPACE || gap < 1e-4) continue;
        // Half the correction each, so neither is privileged by index order.
        const push = (KID_PERSONAL_SPACE - gap) / 2;
        const nx = dx / gap;
        const nz = dz / gap;
        wa.nudgeX -= nx * push;
        wa.nudgeZ -= nz * push;
        wb.nudgeX += nx * push;
        wb.nudgeZ += nz * push;
      }
    }

    // Fade the corrections out, so a squeeze at the gate does not leave eleven
    // children permanently walking a metre to the left of their own route — and
    // cap them, so no accumulation can ever throw somebody across the park.
    const decay = NUDGE_DECAY * dt;
    for (const walk of this.kidWalks) {
      let size = Math.hypot(walk.nudgeX, walk.nudgeZ);
      if (size > NUDGE_LIMIT) {
        walk.nudgeX = (walk.nudgeX / size) * NUDGE_LIMIT;
        walk.nudgeZ = (walk.nudgeZ / size) * NUDGE_LIMIT;
        size = NUDGE_LIMIT;
      }
      if (size <= decay) {
        walk.nudgeX = 0;
        walk.nudgeZ = 0;
      } else {
        walk.nudgeX -= (walk.nudgeX / size) * decay;
        walk.nudgeZ -= (walk.nudgeZ / size) * decay;
      }
    }
  }

  /** Has this child finished walking down the bus and stepped onto the kerb? */
  private onThePavement(index: number): boolean {
    const walk = this.kidWalks[index];
    const delay = KID_DELAYS[index];
    if (!walk || delay === undefined) return false;
    return this.kidClock - delay >= walk.aisleSeconds;
  }

  /**
   * Moves one child along their own route, by their own distance covered.
   *
   * Progress is `(their own elapsed time) x (their own speed) / (their own
   * route length)`, so no two are ever at the same point of the same curve on
   * the same frame.
   */
  private advanceKid(index: number, dt: number): void {
    const kid = this.kids[index];
    const walk = this.kidWalks[index];
    const delay = KID_DELAYS[index];
    if (!kid || !walk || delay === undefined) return;
    if (walk.released) return;

    const moving = this.kidClock - delay;
    if (moving <= 0) {
      // Still in their seat, waiting their turn.
      if (walk.seat) {
        walk.seat.getWorldPosition(SCRATCH);
        kid.setScriptedPose(SCRATCH.x, SCRATCH.y, SCRATCH.z, this.stopFacing, 0);
      }
      return;
    }

    // --- down the bus to the door ------------------------------------------
    // At the park's own walking pace, so nothing about this child ever moves
    // faster than a child walks — which is what `check:jitter` is asserting and
    // what the old single-frame jump violated by a factor of three.
    if (moving < walk.aisleSeconds && walk.seat) {
      const seat = walk.seat.getWorldPosition(SCRATCH);
      const eased = clamp01(moving / Math.max(0.001, walk.aisleSeconds));
      const to = walk.route.from;
      const x = lerp(seat.x, to.x, eased);
      const z = lerp(seat.z, to.z, eased);
      // Down off the floor onto the pavement over the last of it, with the same
      // little hop the player's own step down has.
      const ground = terrainHeight(x, z);
      const step = smoothstep(0.72, 1, eased);
      const y = lerp(seat.y, ground, step) + Math.sin(step * Math.PI) * 0.14;
      const facing = Math.atan2(to.x - seat.x, to.z - seat.z);
      kid.setScriptedPose(x, y, z, facing, walk.speed);
      return;
    }

    // Distance walked, mapped back onto the curve — so the pace on screen is
    // the pace that was asked for, everywhere along it.
    //
    // **Only as far as `releaseDistance`.** The full curve (`route.to`) still
    // shapes the bend through the gate — the fan-out spacing that keeps eleven
    // children from clipping the gate posts or each other is tuned against
    // that whole shape — but nobody actually walks all the way to `to` any
    // more (issue #269 QA, Jim's ruling: disembarking children are ordinary
    // park NPCs from the moment they clear the gate, not a bespoke walk-in).
    // `rawWalked` decides *when* to hand off; `walked` is clamped so the pose
    // this frame never overshoots the handoff point itself.
    const rawWalked = (moving - walk.aisleSeconds) * walk.speed;
    const releasing = rawWalked >= walk.releaseDistance;
    const walked = Math.min(rawWalked, walk.releaseDistance);
    const route = walk.route;
    const at = tAtDistance(walk.arc, walked);
    const here = bezier(route.from, route.corner, route.to, at);
    const ahead = bezier(route.from, route.corner, route.to, Math.min(1, at + 0.05));
    const dx = ahead.x - here.x;
    const dz = ahead.z - here.z;

    const x = here.x + walk.nudgeX;
    const z = here.z + walk.nudgeZ;
    const facing = dx !== 0 || dz !== 0 ? Math.atan2(dx, dz) : this.stopFacing;
    kid.setScriptedPose(x, terrainHeight(x, z), z, facing, releasing ? 0 : walk.speed);

    // **Handed back the moment they clear the gate, not several metres in.**
    // `BusArrival.disembark()`'s own doc says the rejoin should happen "the
    // moment a child steps down, not when the whole sequence ends" — the
    // walk used to continue scripted (bypassing `NpcSystem`'s collision and
    // separation entirely — see `attachNpcs`) all the way to a point deep in
    // the park, which is what let a scripted arrival child and a free
    // background child pass through each other with only one side's soft,
    // rate-limited push trying to keep them apart (`check:cat-bus`,
    // issue #269 QA). `RELEASE_Z` is short of `route.to` precisely so the
    // rest of the walk — the part that actually crosses paths with the rest
    // of the crowd — is ordinary `WanderDriver` pathfinding, exactly like any
    // other child, with the same two-sided collision and separation
    // everybody else gets.
    if (releasing) this.release(index, dt);
  }

  /** Gives one child back to their own driver, mid-stride. */
  private release(index: number, _dt: number): void {
    const kid = this.kids[index];
    const walk = this.kidWalks[index];
    if (!kid || !walk || walk.released) return;
    walk.released = true;
    kid.endScripted();
    const driver = kid.driver as { leaveBus?: () => void };
    driver.leaveBus?.();
  }

  /**
   * Gives her the controls, exactly once.
   *
   * `endRide` first, then `teleportTo`: `endRide` hands back a fresh velocity
   * and marks her airborne, and `teleportTo` puts her feet on the ground with
   * the momentum cleared. The other way round she drops the last few
   * centimetres onto the grass the instant she is given the controls.
   */
  private handOver(): void {
    if (this.handedOver) return;
    this.handedOver = true;
    markArrived();
    const player = this.player;
    if (!player) return;
    player.endRide();
    player.teleportTo(
      ENTRANCE_PLAYER_X,
      terrainHeight(ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z),
      ENTRANCE_PLAYER_Z,
      this.playerFacing,
    );
  }

  private finish(): void {
    if (this.doneFlag) return;
    this.handOver();
    // Anybody still scripted when the music stops goes back to being an
    // ordinary child right where they are. Belt and braces: every child should
    // already have been released by finishing their own route, and the bus
    // waits for exactly that — but a child left permanently `scripted` would be
    // a child frozen in the park for ever, and that is too bad a failure to
    // leave to an inequality.
    for (let index = 0; index < this.kids.length; index += 1) this.release(index, 0);
    this.doneFlag = true;
    this.dispose();
  }

  /**
   * Tears down **the bus and its driver, and nothing else.**
   *
   * The children are the park's, not ours. Disposing of them here is precisely
   * the bug Jim reported — *"they get off the bus, walk in and vanish"* — and
   * it is worth stating plainly rather than leaving as an absence: an arrival
   * that deletes the arrivals has no purpose.
   */
  dispose(): void {
    this.bus.dispose();
    this.bus.root.removeFromParent();
    this.busDriver.dispose();
    this.group.removeFromParent();
  }
}
