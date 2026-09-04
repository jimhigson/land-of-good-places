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
import { CHILD_FOOTPRINT, TALLEST_CHILD_HEIGHT } from '../../art/models/kid';
import {
  createCatBus,
  CAT_BUS_LENGTH,
  CAT_BUS_LONGEST_WALK_TO_DOOR,
  CAT_BUS_SEAT_COUNT,
  CAT_BUS_TOP,
  CAT_BUS_WIDTH,
  type CatBusHandle,
} from './catBus';
import {
  CAMERA_DISTANCE,
  CAMERA_PITCH_DEGREES,
  CAMERA_VIEW_HEIGHT,
  CAMERA_YAW_DEGREES,
} from '../../core/constants';
import { createBusDriver, type BusDriver } from './busDriver';
import { playBrakeSqueak, playDoorHiss, playHornToot } from './sounds';
import { markArrived } from './arrivalFlag';
import {
  ENTRANCE_ANGLE,
  ENTRANCE_BUS_ARRIVE_X,
  ENTRANCE_BUS_DOOR_X,
  ENTRANCE_BUS_STOP_Z,
  ENTRANCE_BUS_VANISH_X,
  ENTRANCE_GATE_X,
  ENTRANCE_GATE_Z,
  ENTRANCE_PLAYER_X,
  ENTRANCE_PLAYER_Z,
} from './layout';

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
 * **How far out the camera sits while the bus is the subject.**
 *
 * Jim's first watched run of Stage A opened on a bus that filled the frame with
 * its own cat face cropped off the corner, and the previous round left it
 * alone rather than ship a camera change it could not re-verify.
 *
 * The default framing is built around a child: `CAMERA_VIEW_HEIGHT` is 15 m,
 * chosen so *"a 2.12 m kid fills about 14% of the height"*. The bus is
 * **18.16 m** long. It was never going to fit.
 *
 * So this is derived rather than dialled in, from the bus's **bounding
 * sphere** — which is the right measure precisely because it does not care
 * which way round the bus is, and the camera swings all the way round it
 * during the journey before this ever applies. The radius is half the body
 * diagonal; the view's half-height at zoom `z` is `CAMERA_VIEW_HEIGHT / 2 / z`;
 * asking the sphere to fit inside it with a little air gives the number below.
 * A bus that grows re-derives it and stays in shot.
 */
const ARRIVAL_BUS_RADIUS = Math.hypot(CAT_BUS_LENGTH, CAT_BUS_WIDTH, CAT_BUS_TOP) / 2;
const ARRIVAL_FRAMING_AIR = 1.15;
export const ARRIVAL_CAMERA_ZOOM =
  CAMERA_VIEW_HEIGHT / 2 / (ARRIVAL_BUS_RADIUS * ARRIVAL_FRAMING_AIR);

/**
 * How far above the pavement the door shot is aimed, in metres — about a
 * child's chest. Below `TALLEST_CHILD_HEIGHT` on purpose: the subject is the
 * children coming down the step, not the roof of the bus behind them.
 */
const ARRIVAL_DOOR_FOCUS_LIFT = 1.1;

/**
 * Which way the bus points.
 *
 * It runs **along** the kerb, not at the gate: the travel direction is the
 * boundary's own tangent at the gate's bearing, so this still reads correctly
 * if the gate is ever moved. A Three.js object at `rotation.y = t` sends local
 * +Z to world `(sin t, cos t)`, hence the `atan2`.
 */
const TRAVEL_X = -Math.sin(ENTRANCE_ANGLE);
const TRAVEL_Z = Math.cos(ENTRANCE_ANGLE);
const BUS_FACING = Math.atan2(TRAVEL_X, TRAVEL_Z);

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
 * Derived from {@link BUS_FACING} — *the bus's own idea of which way it
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
const SQUARE_ON_TO_THE_DOOR_DEGREES = (() => {
  // Perpendicular to the way the bus points, taken on whichever side the gate
  // is — a bus turned by the road's curve carries the shot round with it.
  const travelX = Math.sin(BUS_FACING);
  const travelZ = Math.cos(BUS_FACING);
  const towardsGateX = ENTRANCE_GATE_X - ENTRANCE_BUS_DOOR_X;
  const towardsGateZ = ENTRANCE_GATE_Z - ENTRANCE_BUS_STOP_Z;
  // Both perpendiculars; keep the one that points at the gate.
  const sign = Math.sign(travelZ * towardsGateX - travelX * towardsGateZ) || 1;
  return Math.atan2(sign * travelZ, -sign * travelX) / DEG;
})();

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
 * {@link ARRIVAL_DOOR_DISTANCE} now stands the eye **short of the gate**,
 * between the drop and the archway, so the arch is behind the lens and cannot
 * land on anybody. Square-on then costs nothing — and it is also what makes
 * the rest of Jim's sentence possible, because a camera already on the bus
 * side of the gateway is a camera that can *glide through it with her* rather
 * than watch her come towards it.
 */
export const ARRIVAL_DOOR_YAW_DEGREES =
  SQUARE_ON_TO_THE_DOOR_DEGREES +
  Math.sign(angleDelta(SQUARE_ON_TO_THE_DOOR_DEGREES * DEG, CAMERA_YAW_DEGREES * DEG)) *
    ARRIVAL_DOOR_THREE_QUARTER_DEGREES;

/**
 * **How low the door shot sits**, in degrees of downward tilt.
 *
 * The rig's own 38° looks down on the park from above — right for playing,
 * wrong for watching children step down off a bus, because from up there you
 * see the tops of their heads and the roof of the bus. At 24° a child's face
 * is towards the lens as she steps off, the doorway has a front rather than a
 * lid, and the arch is a thing to be walked *under* rather than a shape drawn
 * on the floor.
 *
 * **Not lower, and 12° was tried.** In an orthographic projection a very low
 * tilt collapses the ground plane to nothing, so the bus stops looking like it
 * is standing on a road and starts looking like it is hanging in the air above
 * the boundary wall — photographed, and unmistakable once seen. The tilt has to
 * keep enough ground under everybody for the pavement to read as pavement.
 */
const ARRIVAL_DOOR_PITCH_DEGREES = 24;

/**
 * How far short of the gate line the door shot stands, in metres.
 *
 * **This is what lets the shot be square-on.** The eye sits on the door's own
 * normal, between the drop and the archway, so the arch is *behind* it — see
 * {@link ARRIVAL_DOOR_YAW_DEGREES} for the collinearity fault this avoids, and
 * why turning the camera was the wrong answer to it.
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
const ARRIVAL_DOOR_DISTANCE =
  (ENTRANCE_BUS_STOP_Z - ENTRANCE_GATE_Z - ARRIVAL_GATE_STANDOFF) /
  Math.cos(ARRIVAL_DOOR_PITCH_DEGREES * DEG);


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
 */
const ARRIVAL_CLOSE_FRAMING_AIR = 2.2;

/** The push-in on the doorway itself, once the bus has stopped. */
export const ARRIVAL_DOOR_ZOOM =
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
 * the eye's own lag along z, at the pose it holds during the pass.
 *
 * Derived rather than timed, so it stays true if the bearing or the stand-back
 * change. It is what makes the shot hold its close pose until the camera has
 * actually cleared the arch, instead of starting to pull away while it is
 * still underneath it.
 */
const ARRIVAL_ARCH_TRAIL_Z =
  ARRIVAL_ARCH_DISTANCE *
  Math.cos(ARRIVAL_DOOR_PITCH_DEGREES * DEG) *
  Math.cos(CAMERA_YAW_DEGREES * DEG);

/**
 * How long the eye takes to dive from the door shot's stand-back to the
 * arch's, in seconds — see the note at its use.
 *
 * Derived from her own walking pace and the camera's own lag — a quarter of
 * the time she takes to walk the distance the eye trails her by — so a slower
 * walk or a shorter lag stretch or shorten it on their own rather than needing
 * a second number nudged to match.
 *
 * **Short on purpose, and the quarter is the measurement.** There is a band of
 * stand-backs, roughly 14 m down to 6 m, in which the near plane lies along the
 * length of the parked bus and saws it open down the left of frame. Photographed
 * at 20.7 m (clean, the bus wholly in front of the lens), at 10.5 m (a wedge of
 * cut-open bus) and at 5.6 m (clean again, the bus gone from the frame
 * entirely). The band cannot be avoided — the eye has to end up between the bus
 * and the park — so it is crossed quickly instead: `smoothstep` is at its
 * fastest in the middle of its own range, which is exactly where the band sits,
 * and at a quarter of the lag the whole crossing is a few frames at the extreme
 * edge of a frame whose subject is centred.
 */
const ARRIVAL_DIVE_SECONDS = ARRIVAL_ARCH_TRAIL_Z / (4 * NPC_WALK_SPEED);


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
const AT_STOPPED = ARRIVAL_TIMELINE.rollingIn;
/** The instant she steps off the kerb and starts walking in. */
export const AT_WALKING = ARRIVAL_CONTROL_AT - ARRIVAL_TIMELINE.walkingIn;
/** The instant the whole shot has landed on the rig's own pose. */
export const AT_SHOT_HOME = ARRIVAL_CONTROL_AT + ARRIVAL_RISE_TAIL;

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
  /** She crosses the gate line. */
  readonly under: number;
  /** The trailing eye crosses it — see {@link ARRIVAL_ARCH_TRAIL_Z}. */
  readonly clear: number;
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
  if (elapsed >= AT_SHOT_HOME) return null;

  const { under, clear } = archPass;

  // **How much of the door shot is in force**, 0 being the rig exactly. It
  // comes home over the walk *up to the arch*, not over the whole walk: by the
  // time the eye has to thread the gateway it must already be on the rig's own
  // bearing, or it goes through a pier instead of the gap.
  // **The eye holds its close pose for this long after it is through the
  // archway, before it starts pulling back.** Derived from the pass itself:
  // `clear - under` is exactly how long she takes to walk one eye-trail, so
  // holding for the same again puts her a second trail-length into the park
  // before the retreat begins.
  //
  // **This is what stops the camera shearing the arch open on the way out**,
  // and it is a geometry fix rather than a taste one. The stand-back has to
  // open from a few metres to the rig's 90 m, which retreats the eye far
  // faster than a child walks — so the eye is dragged back out through the
  // plane of the archway whatever it does. Photographed on two parks doing
  // exactly that: the near pier sheared into a wedge with its front faces
  // gone and a child drawn straight through it. The fix is to be *further in*
  // when the retreat starts, so that by the time the eye is back level with
  // the gate it is already above the whole arch rather than inside it.
  const holdPast = Math.min(clear + (clear - under), ARRIVAL_CONTROL_AT);

  const swing =
    elapsed < AT_STOPPED
      ? // Swinging round off the ordinary view as the bus rolls up, so the
        // arrival opens on a move rather than on a cut.
        smoothstep(0, 1, elapsed / Math.max(0.001, ARRIVAL_TIMELINE.rollingIn))
      : // **Square-on, held all the way through the gateway.** Jim: *"when the
        // child walks out it should stay looking straight at them, as they
        // walk through the gates the camera should glide to follow them
        // under."* The bearing is the whole of "looking straight at them" in
        // an orthographic rig, so it may not start coming home until the eye
        // is out the other side — an earlier version began unwinding it at
        // `under` and he read the result as the camera turning away from her
        // mid-walk.
        //
        // It still lands exactly on the rig at `ARRIVAL_CONTROL_AT`, which is
        // GAME_DESIGN.md's CONTROL rule and clause 2 of the check: the axes
        // "up on the stick" is read through are solved from the rig's fixed
        // yaw, so a bearing still moving under her hand sends her somewhere
        // that is not up the screen.
        elapsed < clear
        ? 1
        : 1 -
          smoothstep(0, 1, (elapsed - clear) / Math.max(0.001, ARRIVAL_CONTROL_AT - clear));

  // **How close the shot is riding**, 1 at the arch pass and 0 at the rig.
  // Held all the way through the gateway — from the moment she starts walking
  // until the *eye* is out the other side — and only then released. Releasing
  // it at her own crossing would start the pull-away while the camera was
  // still under the crossbar, which is the one moment the whole shot is for.
  const ride =
    elapsed < AT_WALKING
      ? swing
      : elapsed < holdPast
        ? 1
        : 1 - smoothstep(0, 1, (elapsed - holdPast) / Math.max(0.001, AT_SHOT_HOME - holdPast));

  // The tilt is the last thing home: it is still lifting when she takes the
  // controls, which is Jim's third beat. See ARRIVAL_RISE_TAIL.
  const lift =
    elapsed < AT_WALKING
      ? swing
      : elapsed < holdPast
        ? 1
        : 1 - smoothstep(0, 1, (elapsed - holdPast) / Math.max(0.001, AT_SHOT_HOME - holdPast));

  // Wide on the arriving bus, close on the child coming down the step, and it
  // *stays* close through the gateway — the framing does not back off until
  // the camera is out the other side.
  const zoom =
    elapsed < AT_STOPPED
      ? lerp(1, ARRIVAL_CAMERA_ZOOM, swing)
      : elapsed < AT_WALKING
        ? lerp(
            ARRIVAL_CAMERA_ZOOM,
            ARRIVAL_DOOR_ZOOM,
            smoothstep(0, 1, (elapsed - AT_STOPPED) / Math.max(0.001, AT_WALKING - AT_STOPPED)),
          )
        : // **Home by `ARRIVAL_CONTROL_AT`, unlike the stand-back**, and for a
          // reason the stand-back does not share: `nudgeZoom` writes this same
          // field, so every frame the shot drives it is a frame her pinch is
          // discarded (#329). The instant she can pinch, this must stop
          // moving. It rides `ride`'s curve while it can and is then held to
          // the handover, so the close framing still lasts through the
          // gateway.
          lerp(
            1,
            ARRIVAL_DOOR_ZOOM,
            elapsed < clear
              ? 1
              : 1 - smoothstep(0, 1, (elapsed - clear) / Math.max(0.001, ARRIVAL_CONTROL_AT - clear)),
          );

  // **The stand-back, which is the whole of "the camera goes under the arch
  // too".** It dives from the door shot's 20.8 m to ARRIVAL_ARCH_DISTANCE as
  // she walks up to the gateway, holds there while the eye passes through, and
  // then opens back out to the rig's 90 m on the way up. On `ride`, so it is
  // one continuous move with the framing rather than a second one beside it.
  //
  // **Late and quick, and that is not a taste call.** The eye has to travel
  // from the door shot's vantage — deep in the park, with the bus in front of
  // it — to a few metres behind her, which puts the bus *behind* it. So the
  // bus must cross the near plane, and an orthographic near plane crossing an
  // 18 m vehicle slowly, at a shallow angle, saws it open: the first version
  // dived from the moment she started walking and the bus sat sliced through
  // the corner of frame for the better part of a second, showing its own
  // hollow interior. Photographed, and it reads as a rendering fault rather
  // than as a move.
  //
  // Diving over only the last {@link ARRIVAL_DIVE_SECONDS} means the crossing
  // happens once she is well clear of the bus, when it is off the edge of a
  // frame that is by then close on her — so the cut lands on nothing anybody
  // is looking at.
  // Timed to end at `clear` rather than at `under`: the crossing has to happen
  // once she is far enough past the bus that it has left the frame, and at
  // `under` it has not. Half a second earlier there is a wedge of sawn-open bus
  // down the left edge — photographed twice while getting this right.
  const dive = smoothstep(clear - ARRIVAL_DIVE_SECONDS, clear, elapsed);
  const distance =
    elapsed < AT_WALKING
      ? lerp(CAMERA_DISTANCE, ARRIVAL_DOOR_DISTANCE, swing)
      : elapsed < holdPast
        ? lerp(ARRIVAL_DOOR_DISTANCE, ARRIVAL_ARCH_DISTANCE, dive)
        : lerp(CAMERA_DISTANCE, ARRIVAL_ARCH_DISTANCE, ride);

  return {
    // Turned the short way round — `angleDelta` owns that question everywhere
    // else in the codebase.
    yawDegrees:
      CAMERA_YAW_DEGREES +
      (angleDelta(CAMERA_YAW_DEGREES * DEG, ARRIVAL_DOOR_YAW_DEGREES * DEG) / DEG) * swing,
    pitchDegrees: lerp(CAMERA_PITCH_DEGREES, ARRIVAL_DOOR_PITCH_DEGREES, lift),
    distance,
    zoom,
    // The door is the subject exactly while the bus is stopped with children
    // coming out of it. Not during `rolling-in`: she is aboard for all of it,
    // so following the player already follows the bus, and pinning the camera
    // to a door that is still moving would hold the shot still while the bus
    // slid across it. From `walking-in` on it is her, and the ordinary damped
    // follow is what carries the camera through the gateway with her.
    ownsTheZoom: elapsed < ARRIVAL_CONTROL_AT,
    watchesTheDoor: elapsed >= AT_STOPPED && elapsed < AT_WALKING,
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


/** A point in the bus's own local space, in world space, for a bus at `(bx, bz)`. */
function busLocalToWorld(bx: number, bz: number, lx: number, lz: number): { x: number; z: number } {
  const cos = Math.cos(BUS_FACING);
  const sin = Math.sin(BUS_FACING);
  return { x: bx + lx * cos + lz * sin, z: bz - lx * sin + lz * cos };
}

interface Vector2Like {
  readonly x: number;
  readonly z: number;
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
  /** Where the bus's centre comes to rest, worked back from where its door goes. */
  private readonly stopX: number;

  private player: Player | null = null;
  private phaseIndex = 0;
  private phaseTime = 0;
  private busX = ENTRANCE_BUS_ARRIVE_X;
  private busSpeed = 0;
  private doneFlag = false;
  private handedOver = false;
  private tootedHorn = false;
  private squeaked = false;
  private hissed = false;
  private playerFacing = BUS_FACING;

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
    this.stopX = ENTRANCE_BUS_DOOR_X + this.bus.doorDrop.z;
    this.placeBus(ENTRANCE_BUS_ARRIVE_X);

    // The driver rides at the wheel and never gets out. He is the one person
    // here who is not a park NPC — see `busDriver.ts`.
    this.busDriver = createBusDriver();
    this.bus.driverSeat.add(this.busDriver.root);

    // Routes are derived from where the bus's own door actually is.
    const drop = busLocalToWorld(this.stopX, ENTRANCE_BUS_STOP_Z, this.bus.doorDrop.x, this.bus.doorDrop.z);
    const end = { x: ENTRANCE_PLAYER_X, z: ENTRANCE_PLAYER_Z };
    this.playerRoute = {
      from: drop,
      corner: { x: ENTRANCE_BUS_DOOR_X, z: ENTRANCE_GATE_Z },
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

      const route: WalkRoute = {
        from: { x: drop.x + wobble(0.35), z: drop.z + wobble(0.25) },
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
        corner: { x: ENTRANCE_BUS_DOOR_X + across * 6.0 + wobble(0.2), z: ENTRANCE_GATE_Z },
        to: {
          // Same rule at the far end: 2.4 m of spacing, so the wobble cannot
          // reorder them here either.
          x: end.x + across * 24 + wobble(1.0),
          z: end.z - 2.4 - rng() * 5.5 - Math.abs(across) * 1.4,
        },
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
   * Reads `ENTRANCE_GATE_Z` for the line and {@link ARRIVAL_ARCH_TRAIL_Z} for
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
    const under = crossing(ENTRANCE_GATE_Z);
    return { under, clear: Math.max(under, crossing(ENTRANCE_GATE_Z - ARRIVAL_ARCH_TRAIL_Z)) };
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
    const drop = this.playerRoute.from;
    const free = this.bus.seats
      .filter((seat) => seat !== this.bus.passengerSeat)
      .map((seat) => {
        const at = seat.getWorldPosition(new Vector3());
        return { seat, distance: Math.hypot(at.x - drop.x, at.z - drop.z) };
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
   * Lifted to roughly a child's chest so they sit in the middle of the frame
   * rather than along its bottom edge — the same reason the ordinary follow
   * aims above the player's feet.
   */
  get doorFocus(): Vector3 {
    const { x, z } = this.playerRoute.from;
    return new Vector3(x, terrainHeight(x, z) + ARRIVAL_DOOR_FOCUS_LIFT, z);
  }

  /** Where the bus is, for a check that wants to measure rather than trust. */
  get busPosition(): Vector3 {
    return this.bus.root.position.clone();
  }

  /** How many children are still aboard — for a check, and for the bus's patience. */
  get stillAboard(): number {
    return this.kidWalks.filter((walk) => !walk.released).length;
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
    const previous = this.busX;
    this.busX = lerp(ENTRANCE_BUS_ARRIVE_X, this.stopX, smoothstep(0, 1, t));
    this.placeBus(this.busX);
    this.busSpeed = Math.abs(this.busX - previous) / dt;

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
    const previous = this.busX;
    if (driving < 0.18) {
      this.bus.setDoorOpen(1 - smoothstep(0, 0.18, driving));
      this.busSpeed = 0;
      return;
    }
    this.bus.setDoorOpen(0);
    this.busX = lerp(this.stopX, ENTRANCE_BUS_VANISH_X, smoothstep(0.18, 1, driving));
    this.placeBus(this.busX);
    this.busSpeed = Math.abs(this.busX - previous) / dt;
  }

  // --- helpers ------------------------------------------------------------

  private placeBus(x: number): void {
    this.bus.root.position.set(x, terrainHeight(x, ENTRANCE_BUS_STOP_Z), ENTRANCE_BUS_STOP_Z);
    this.bus.root.rotation.y = BUS_FACING;
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
    this.setPlayerPose(seat.x, seat.y, seat.z, BUS_FACING, false, 0);
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
      kid.setScriptedPose(SCRATCH.x, SCRATCH.y, SCRATCH.z, BUS_FACING, 0);
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
        kid.setScriptedPose(SCRATCH.x, SCRATCH.y, SCRATCH.z, BUS_FACING, 0);
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
    const facing = dx !== 0 || dz !== 0 ? Math.atan2(dx, dz) : BUS_FACING;
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
