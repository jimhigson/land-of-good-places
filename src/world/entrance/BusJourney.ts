import {
  Box3,
  BoxGeometry,
  BufferAttribute,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { PALETTE } from '../../core/palette';
import { CAMERA_PITCH_DEGREES, CAMERA_YAW_DEGREES } from '../../core/constants';
// The declared one owner of "what a camera does in a portrait window". A leaf
// module — three, mathUtils and the look controls — so the ride can reach it
// without dragging the park in behind it.
import { fitCameraToViewport } from '../../core/RideCamera';
import { createRandom, clamp, clamp01, lerp, smoothstep } from '../../core/mathUtils';
import { toonMaterial } from '../../art/style/materials';
import {
  createKid,
  KID_SHOULDER_HEIGHT,
  KID_SKIN_TONES,
  type KidHandle,
} from '../../art/models/kid';
import { CROWD_HAIR_STYLES, type HairStyle } from '../../art/models/hair';
import { HAIR_COLOURS, OUTFIT_COLOURS } from '../../art/models/kidLooks';
import {
  createCatBus,
  CAT_BUS_CABIN_CEILING_Y,
  CAT_BUS_SEAT_COUNT,
  CAT_BUS_SEAT_Y,
  CAT_BUS_LENGTH,
  type CatBusHandle,
} from './catBus';
import { createBusDriver, type BusDriver } from './busDriver';
// The game's own seated pose. A leaf module precisely so the ride can reach it
// without dragging `PARK_BOUNDARY` in behind it — see `entities/ridePose.ts`.
import { applyRidePose } from '../../entities/ridePose';
import { ROAD_HALF_WIDTH, applyRoadUvs, roadMaterial } from './road';
// The park's own gate dimensions. Not a copy — `layout.ts` is the one owner, and
// it is reachable from here precisely because it depends on nothing heavier than
// two import-free core modules. See its note on why the arch is built twice.
import {
  ENTRANCE_GATE_HALF_WIDTH as GATE_HALF_WIDTH,
  ENTRANCE_GATE_POST_HEIGHT as GATE_POST_HEIGHT,
} from './layout';

/**
 * **The ride to the park — the twenty seconds before the gate.**
 *
 * Jim, 7 August 2026:
 *
 * > *"the bus should drive down a narrow lane with the camera rotating around
 * > it until it arrives at the park, with various hills and going past trees,
 * > but in an otherwise straight line"*
 *
 * ## Straight, and that is the point
 *
 * The lane is **one axis**. There is no route to solve, no curve to fit and no
 * interaction with the park boundary: the bus drives down world −Z, the ground
 * rises and falls beneath it, and scenery stands either side. The variety comes
 * entirely from {@link ORBIT} — the camera swinging round the bus — which is
 * why the brief specifies the two together, and why adding curves "for
 * interest" would be spending the expensive half of the budget to duplicate
 * what the cheap half already does.
 *
 * ## Why it is its own `Scene`
 *
 * Two reasons, and the second is the load-bearing one.
 *
 * The park's terrain is a **disc** that stops a couple of metres past the
 * boundary (`TERRAIN_EDGE_RADIUS = maxRadius + TERRAIN_APRON`) and then falls
 * away — measured, on the gate's own axis: −0.13 m at z = 72, −1.35 at 74,
 * −14 at 80. It is a diorama on a hilltop. A road "just outside the park" would
 * mean fighting the boundary system for ground that does not exist.
 *
 * But more than that: **this has to be on screen before the park exists at
 * all.** The whole ride is the park's loading screen, so it cannot borrow
 * `Player`, `NpcSystem` or anything else `World` owns — none of them have been
 * built yet. Hence its own scene, its own lights, its own bus and its own
 * passengers, depending on nothing heavier than the art modules.
 *
 * ## The passengers are copies, and that is fine — once
 *
 * The eleven children who ride here are **not** the park NPCs who get off at
 * the gate; they cannot be, because the crowd does not exist yet. They are
 * one-off `createKid()` models, like the driver.
 *
 * That is a second definition of "who is on the bus", which this repo has been
 * bitten by repeatedly — so it is worth being explicit about why it is safe
 * here and would not be anywhere else. The two sets are only ever compared
 * across **a single cut**, seen through translucent glass, at a distance, in
 * one frame. Nothing is ever on screen twice. The player's own look *is*
 * carried across, because that is the one a child would notice: it comes from
 * the same `CharacterCreationChoice` she chose sixty seconds ago.
 */

/** How long the ride lasts. Jim asked for "about 20s". */
export const JOURNEY_SECONDS = 20;

/** How fast the bus travels, in metres a second. A bus, not a rocket. */
const BUS_SPEED = 11;

/** The lane, in metres — everything the ride will cross, plus room to see ahead. */
const LANE_LENGTH = JOURNEY_SECONDS * BUS_SPEED + 220;

/** Half-width of the grass verge the ground mesh covers either side. */
const GROUND_HALF_WIDTH = 90;

/**
 * How far apart the two points are that the bus's pitch is taken from.
 *
 * A long vehicle bridges a dip rather than folding into it, so the bus lies
 * along the chord between the road under its front axle and the road under its
 * back one. Derived from the bus's own length — a wheelbase is most of it —
 * rather than the 14 m that used to be written here twice, so a bus that is
 * resized still bridges its own length.
 */
const BUS_PITCH_SPAN = CAT_BUS_LENGTH * 0.78;

/**
 * **How far short of the park's gate the bus stops.**
 *
 * Far enough that the arch is whole in the frame and the wall reads as a wall
 * rather than filling the screen; close enough that it is plainly *there*. At
 * {@link BUS_SPEED} this is the last two and a half seconds of the ride, which
 * is the stretch where a child works out where she is going.
 */
const PARK_STANDOFF = 30;

/**
 * How high a child bounces in her seat, at most, in metres.
 *
 * A ceiling on the excitement rather than the excitement itself: each rider gets
 * this or whatever fits over her head, whichever is less. See `riderBounce`.
 */
const RIDER_BOUNCE = 0.13;

/**
 * Air kept between the top of a bouncing child and the header band.
 *
 * Small — this is a clearance, not a design gap — but not zero: a child whose
 * hair grazes the ceiling on the peak of every bounce is the same defect as one
 * through the floor, seen from the other end.
 */
const RIDER_BOUNCE_MARGIN = 0.04;

/** Where the ride's own twenty seconds leave the bus, in metres down the lane. */
const RIDE_END_Z = -JOURNEY_SECONDS * BUS_SPEED;

/**
 * Where the park's gate stands, down the lane. Derived from where the ride ends.
 *
 * Exported so `check:bus-journey` can assert the bus **reaches** it while
 * waiting, rather than restating −250 in the check and having the two drift.
 */
export const JOURNEY_GATE_Z = -JOURNEY_SECONDS * BUS_SPEED - PARK_STANDOFF;
const PARK_AHEAD_Z = JOURNEY_GATE_Z;

/**
 * **Where the bus comes to rest when it has to wait — at the gate.**
 *
 * Jim, 8 August 2026, on the overrun: *"The bus stops in open lane, short of the
 * gate. It should idle **at the gate**, which is where a bus waits."*
 *
 * It stopped short because the only thing that had ever decided where the bus
 * *is* was `-elapsed * BUS_SPEED`, and `elapsed` clamps at {@link
 * JOURNEY_SECONDS}. So the bus's resting place was wherever twenty seconds
 * happened to leave it — {@link RIDE_END_Z}, which is {@link PARK_STANDOFF}
 * metres of empty tarmac short of the arch. That standoff is right for the
 * *closing shot* of a ride that ends on time, and it is the wrong place for a
 * vehicle to sit still: a bus parked in the open road with its engine running
 * reads as broken down, and a bus at a gate reads as waiting.
 *
 * Nose on the arch, so the bus's own length is the offset and a bus that is
 * resized still pulls up in the same relationship to the gate.
 */
export const BUS_WAIT_Z = PARK_AHEAD_Z + CAT_BUS_LENGTH / 2;

/** The last stretch, in metres: from where the ride ends to where it waits. */
const PULL_IN_DISTANCE = RIDE_END_Z - BUS_WAIT_Z;

/**
 * How long the bus takes to roll that last stretch and stop.
 *
 * **Not picked — it is what an even deceleration from {@link BUS_SPEED} to
 * nothing over {@link PULL_IN_DISTANCE} takes**, which is `2d/v`. Choosing a
 * duration instead would have been choosing a deceleration by accident, and a
 * bus that stops in half a second has crashed rather than parked.
 *
 * It lands at ~4.0 s, which is longer than four of the five overruns measured
 * on real hardware (0.96, 4.24, 4.48, 6.34, 7.73 s). So on a real slow seed the
 * bus is usually still visibly rolling when the park arrives, and the wait never
 * begins with a stationary frame.
 */
export const PULL_IN_SECONDS = (2 * PULL_IN_DISTANCE) / BUS_SPEED;

/**
 * Where the bus is, `idle` seconds after the ride ran out of road.
 *
 * Pure and exported for the same reason {@link cameraPoseAt} is: `check:bus-
 * journey` has to be able to assert *"it reaches the gate"* without building a
 * bus, and an assertion that asked the bus where it thought it was would pass on
 * a bus that never moved.
 */
export function busWaitZAt(idleSeconds: number): number {
  const t = clamp(idleSeconds, 0, PULL_IN_SECONDS);
  return RIDE_END_Z - BUS_SPEED * t * (1 - t / (2 * PULL_IN_SECONDS));
}

/** How fast it is going while it pulls in. Reaches exactly zero at the gate. */
export function busWaitSpeedAt(idleSeconds: number): number {
  const t = clamp(idleSeconds, 0, PULL_IN_SECONDS);
  return BUS_SPEED * (1 - t / PULL_IN_SECONDS);
}

/**
 * **A stopped bus is not a still bus.** How far it rocks on its springs once it
 * has pulled up, in metres and radians.
 *
 * Twelve children are bouncing in their seats; a body on springs carrying them
 * moves. Small enough that it reads as an idling engine rather than as a
 * wobble, and it is the difference between a held frame and a frozen one — the
 * whole complaint being fixed here is that the wait *read as a crash*.
 *
 * Ramped in by how far the bus has slowed, so it arrives with the stop rather
 * than switching on at it.
 */
const IDLE_ROCK_LIFT = 0.035;
const IDLE_ROCK_ROLL = 0.008;
const IDLE_ROCK_RATE = 1.9;

/**
 * **The camera breathes once the bus has stopped**, as a fraction of how far out
 * it is standing.
 *
 * Measured, not assumed. Under QA's own reproduction — 4x CPU throttle, real
 * Metal renderer — the wait divides into two halves that behave completely
 * differently, and only the first was ever looked at:
 *
 * | the wait | camera poses | bus positions | title layouts |
 * |---|---|---|---|
 * | pulling in (4.0 s) | 301 / 301 frames | 301 | 301 |
 * | stopped at the gate (1.7 s) | **1** / 131 frames | 65 | 131 |
 *
 * The pull-in moves the camera because the camera is following a moving bus, so
 * *any* liveness measurement taken across the whole wait passes on the manoeuvre
 * alone. Once the bus is parked, `busZ` stops changing and every term of the
 * camera's position is a constant: it holds one pose exactly, for as long as the
 * park takes. **One camera pose is the number QA reported as a crash**, and it
 * was still reachable, just later than anybody had looked.
 *
 * A dolly, deliberately, rather than a drift or an orbit: it scales the camera's
 * distance from the bus and leaves its **bearing untouched**, so the pose the
 * hand-over cuts from is still the park camera's own — which `cameraPoseAt` is
 * asserted against, and which an orbiting idle would quietly break, at an
 * instant chosen by however long generation happened to take.
 *
 * Ramped in by how far the bus has slowed, exactly like {@link IDLE_ROCK_LIFT},
 * so it arrives with the stop rather than switching on at it — and is therefore
 * identically zero for the whole of an on-time ride.
 */
const IDLE_BREATH = 0.02;
const IDLE_BREATH_RATE = 0.62;


/**
 * How much lane exists *behind* the bus's starting point.
 *
 * The camera orbits, so for a third of every turn it is looking back down the
 * road the bus came in on. Without this there is nothing there.
 */
const LANE_AHEAD = 120;

/**
 * The stretch of **open** lane — from behind the bus's start down to the park's
 * wall, with a few metres to spare.
 *
 * The hedges and trees are scattered over this rather than over the whole ground
 * mesh, because the ground now runs on past the gate to hold the park up: left
 * alone, the roadside hedge marched straight through the boundary wall and out
 * the other side.
 */
const LANE_OPEN_FROM = PARK_AHEAD_Z + 7;
const LANE_OPEN_RUN = LANE_AHEAD - LANE_OPEN_FROM;

/**
 * The hills, as a function of distance down the lane.
 *
 * Two sines of incommensurable wavelength plus a long swell, so the ride never
 * repeats within its own length and the bus is never level for long. Amplitudes
 * are small in absolute terms — this is a lane over rolling country, not a
 * rollercoaster, and the camera is orbiting, so vertical motion that reads as
 * gentle from one bearing reads as lurching from another.
 */
export function laneHeight(z: number): number {
  return (
    Math.sin(z * 0.0755) * 1.25 +
    Math.sin(z * 0.0412 + 1.7) * 2.0 +
    Math.sin(z * 0.0169 + 0.4) * 2.8
  );
}

/**
 * The steepest the lane ever gets, as a gradient — `sum of amplitude x
 * frequency`, which is the worst case of the derivative of the sum above.
 *
 * Exported because it is the number that decides whether this reads as a
 * country lane or a rollercoaster, and it is not obvious from the amplitudes:
 * shortening a wavelength makes a hill steeper without making it taller. The
 * first tuning kept sensible-looking amplitudes (3.1 / 4.4 / 3.2) and shortened
 * the wavelengths to make the hills visible, which took the worst gradient to
 * **27 degrees** — the captured frames show a bus diving nose-first down what
 * is plainly a ski slope. A real road tops out around 6.
 */
export const LANE_MAX_GRADIENT =
  1.25 * 0.0755 + 2.0 * 0.0412 + 2.8 * 0.0169;

/** Cross-slope, so the verges fall away and the lane sits in the land. */
function groundHeight(x: number, z: number): number {
  const across = Math.abs(x) - ROAD_HALF_WIDTH;
  if (across <= 0) return laneHeight(z);
  // Away from the tarmac the land rolls in its own right, and drops off at the
  // far edge so the mesh never ends in a visible cliff against the sky.
  const roll = Math.sin(x * 0.043 + z * 0.019) * 1.9 + Math.sin(x * 0.017) * 2.4;
  const fade = smoothstep(GROUND_HALF_WIDTH * 0.55, GROUND_HALF_WIDTH, Math.abs(x));
  return laneHeight(z) + roll * clamp01(across / 22) - fade * 26;
}

/**
 * How the camera swings round the bus.
 *
 * **The orbit is the shot** — its rate carries the whole twenty seconds, and
 * the brief says so. Slow enough that nothing swims (a six-year-old watching a
 * screen a foot from her face is the constraint, not a monitor at arm's
 * length), fast enough that it never reads as a static three-quarter view: a
 * little over one full turn across the ride.
 *
 * It **ends where the park's own camera begins**. `CAMERA_YAW_DEGREES` and
 * `CAMERA_PITCH_DEGREES` are the isometric rig's, taken from `core/constants`
 * rather than restated, and the last three seconds ease the orbit onto exactly
 * that bearing and elevation. So the cut into the park is a cut between two
 * frames of the same bus, the same size, at the same angle, moving the same way
 * — which is what makes an arrival out of what would otherwise be a jump.
 */
/**
 * How long the closing shot spends easing onto the park camera's bearing.
 *
 * Exported so `check:bus-journey` can assert the **shot list's** last beat is
 * at least this long: a cut to the inside during the settle would throw away
 * the 0.00-degree hand-over the arrival depends on. One owner, asked by the
 * check rather than restated in it.
 */
export const SETTLE_SECONDS = 3.2;

const ORBIT = {
  /** Turns completed over the ride, before the settle. */
  turns: 1.15,
  /** Where the swing starts, so the cat's face leads the first shot. */
  startYawDegrees: CAMERA_YAW_DEGREES + 150,
  /** Seconds at the end spent easing onto the park camera's own bearing. */
  settleSeconds: SETTLE_SECONDS,
} as const;

/**
 * How far back the camera sits, and how high.
 *
 * Framed on the **whole bus**, which is the fault this had to fix: Stage A's
 * opening put an 18 m vehicle in a frame that cropped the cat's face off the
 * top-left. The distance is derived from the bus's own length rather than
 * chosen, so a bus that grows is still fully in shot.
 */
const CAMERA_BACK = 26;
const CAMERA_LIFT = 11;
const CAMERA_FOV = 42;

/**
 * A **wider** lens for the view from inside — and the swap from narrow to wide
 * is the same correction as turning the camera round.
 *
 * This was 33 degrees, and the reasoning was sound for the shot it was serving:
 * with the lens beside the front row, two heads 0.53 m either side filled the
 * frame edges, and the only way to crop them out was to narrow the lens.
 *
 * From the back seat looking forward there is nothing beside the lens to crop —
 * the whole busload is *in front of* it — so the narrow lens stopped buying
 * anything and started costing. What a bus interior is made of is a **long**
 * shape: an aisle running away, seat backs down both sides, the window band and
 * the ceiling over them. A 33-degree lens sees a keyhole of that and none of its
 * edges, which is a large part of why the shot had no seat, window, pillar or
 * ceiling in it. This is wide enough to hold all four.
 */
const INSIDE_FOV = 52;

/**
 * How far back down the gangway the inside lens sits, in seat rows.
 *
 * Just over a third of a row behind the rearmost cushion: far enough that the
 * back row is in front of the lens rather than either side of it, and not so far
 * that the lens is in the back wall.
 */
const INSIDE_CAMERA_ROWS_BACK = 0.35;

/**
 * **How far off the aisle the inside camera looks, in degrees.**
 *
 * Jim, 8 August 2026, settling the inside shot for good: *"In all modes, not
 * just portrait, make the camera pan down the aisle of the bus, at 45º so that
 * it is moving along the row of seats with children on them."*
 *
 * Square down the aisle — which is what it did — a tall frame has nothing to
 * find but the floor below and the roof above, because along its length the
 * cabin is 2.7 m tall and 11 m long. Turned across the rows it is 2.7 m tall
 * and 2.6 m wide, and the frame lands on cushion, seat back, child and header
 * band the whole way up. Measured independently before Jim's note arrived: the
 * best static angle available was **35.8 degrees**, which is his 45 to within a
 * few degrees of the same answer.
 */
const INSIDE_PAN_DEGREES = 45;

const DEG = Math.PI / 180;

/**
 * What the ride needs to know about the girl riding it.
 *
 * Her own look, straight from the character creator she has just closed. The
 * other eleven are dressed from the park crowd's own lists
 * (`art/models/kidLooks.ts`) rather than a palette invented here, so the
 * children in the windows are drawn from the same population as the children
 * who will be in the park.
 */
export interface JourneyRider {
  readonly skin: number;
  readonly hair: number;
  readonly outfit: number;
  readonly hairStyle: HairStyle;
}

/** One passenger, dressed out of the park crowd's own lists. */
function rollLook(rng: () => number): JourneyRider {
  const pick = <T,>(list: readonly T[], fallback: T): T =>
    list[Math.floor(rng() * list.length)] ?? fallback;
  return {
    skin: pick(KID_SKIN_TONES, { colour: PALETTE.skin, label: 'Fair' }).colour,
    hair: pick(HAIR_COLOURS, PALETTE.hair),
    outfit: pick(OUTFIT_COLOURS, PALETTE.outfit),
    hairStyle: pick(CROWD_HAIR_STYLES, 'bunches'),
  };
}

/**
 * Where the ride is watched from.
 *
 * Jim, 7 August 2026: *"we would like to be able to see inside the bus, switch
 * between the view inside of the children riding it and looking excited and the
 * outside."*
 */
export type JourneyView = 'outside' | 'inside';

/**
 * **How the ride is cut**, as a shot list.
 *
 * Jim, correcting a first reading of *"switch between"* as a player control:
 * *"the view shouldn't be switchable, it should switch by itself."* So this is
 * direction. There is no button; the ride cuts between the two on its own
 * schedule, the way an on-ride video cuts between a trackside camera and a cart
 * cam.
 *
 * Modelled on `world/slide/cameras.ts`, which does the same job for the
 * ginormous slide and is the pattern this repo already has for "a ride that
 * cuts between cameras on its own": plan a list of shots over the ride's own
 * parameter, and have something *pure* answer which shot is playing, so a check
 * can hold the schedule without a renderer.
 *
 * ## The rhythm
 *
 * Five equal beats over twenty seconds — a cut every four seconds, four cuts in
 * all. Fewer and the inside shot is a single event you might blink through;
 * many more and a twenty-second ride becomes a trailer. Four seconds is also
 * long enough for the orbit to move visibly between cuts, which is what stops
 * the two outside shots reading as the same frame twice.
 *
 * **Odd, so the ride opens and closes outside** — the same trick the slide uses
 * with an even `BEATS`, for two reasons here:
 *
 * - It **opens** on the bus, the establishing shot: a child has to see what she
 *   is riding in before being put inside it.
 * - It **closes** outside, which is a requirement rather than a preference. The
 *   last {@link SETTLE_SECONDS} ease the camera onto the park's own bearing so
 *   the hand-over to the arrival is a cut between two frames of the same bus at
 *   the same angle — measured at 0.00 degrees off. A cut to the inside during
 *   the settle would throw that away. `check:bus-journey` asserts the closing
 *   beat is at least that long, so neither number can move without the other
 *   being reconsidered.
 *
 * ## Hard cuts, not blends
 *
 * A blend between a camera inside a vehicle and one outside it is a shot of the
 * lens travelling through the bodywork — here, through a giant cat's face. It
 * would read as a rendering fault rather than a transition. The slide hard-cuts
 * between its chase and trackside cameras and it reads well.
 */
export const JOURNEY_BEATS = 5;

/** How long one shot lasts. */
export const JOURNEY_BEAT_SECONDS = JOURNEY_SECONDS / JOURNEY_BEATS;

export interface JourneyShot {
  readonly view: JourneyView;
  /** When this shot starts, in seconds. Inclusive. */
  readonly from: number;
  /** When it ends. Exclusive, except the last shot, which owns the end. */
  readonly to: number;
}

/**
 * The whole shot list, in order. Pure and exported so a check can assert the
 * schedule — that it opens and closes outside, that both views get real time,
 * and that the beats tile the ride with no gap — without building a bus.
 */
export function planJourneyShots(): JourneyShot[] {
  const shots: JourneyShot[] = [];
  for (let beat = 0; beat < JOURNEY_BEATS; beat += 1) {
    shots.push({
      // Even beats outside. With an odd `JOURNEY_BEATS` that opens and closes
      // outside, which is what the settle needs.
      view: beat % 2 === 0 ? 'outside' : 'inside',
      from: beat * JOURNEY_BEAT_SECONDS,
      to: (beat + 1) * JOURNEY_BEAT_SECONDS,
    });
  }
  return shots;
}

const JOURNEY_SHOTS = planJourneyShots();

/**
 * **How long the ride spends inside the bus, over the whole journey.**
 *
 * The pan down the aisle is paced by this, so it covers the cabin exactly once
 * across the two interior beats however the shot list is re-cut. Summed off the
 * list itself rather than written as `2 * JOURNEY_BEAT_SECONDS`, which would be
 * a second opinion about how the ride is cut and would go quietly wrong the
 * first time {@link JOURNEY_BEATS} changed.
 */
export const INSIDE_SECONDS = JOURNEY_SHOTS.filter((shot) => shot.view === 'inside').reduce(
  (total, shot) => total + (shot.to - shot.from),
  0,
);

/** Which shot is playing at `t` seconds. The last one owns the end of the ride. */
export function shotAt(t: number): JourneyShot {
  for (const shot of JOURNEY_SHOTS) {
    if (t < shot.to) return shot;
  }
  return JOURNEY_SHOTS[JOURNEY_SHOTS.length - 1] as JourneyShot;
}

export class BusJourney {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;

  private readonly bus: CatBusHandle;
  private readonly driver: BusDriver;
  private readonly riders: KidHandle[] = [];
  /**
   * How far each rider may bounce, **measured against the ceiling over her own
   * head** rather than shared.
   *
   * The bounce was a flat 0.13 m for everybody, and once the children were
   * actually sat *on* the cushions rather than sunk through the floor that put
   * the tallest of them 0.016 m up inside the header band at the top of her
   * bob — measured, one seat in twelve, on the canonical look. A spiky-haired
   * child is 0.22 m taller than a bunched one, so a single amplitude is either
   * wrong for her or wasted on everybody else.
   *
   * Same seat, same cushion, same pose; only the hair differs, so the room left
   * over differs. Each child is measured after she is posed and gets what is
   * actually above her.
   */
  private readonly riderBounce: number[] = [];
  private readonly lane = new Group();

  private elapsedSeconds = 0;
  /**
   * **A clock that never stops, even when the bus does.**
   *
   * Separate from {@link elapsedSeconds}, which is *distance down the lane* and
   * is deliberately held still in two cases: once the ride has run its course,
   * and while `JourneyDirector.overrunning` idles the bus at the kerb waiting
   * for a park that is taking too long.
   *
   * Driving the children's excitement off the travel clock meant that in both of
   * those cases twelve children froze mid-bounce — arms up, motionless — which
   * is a worse thing to be looking at than twelve still children would have
   * been. Found by `check:bus-journey`, which measured 0.00 m of movement in
   * four seconds and said so; nothing about the code looked wrong.
   */
  private animationSeconds = 0;
  /**
   * **How long the bus has been waiting** for a park that is not ready yet.
   *
   * Zero on every ride that ends on time, so nothing about the ordinary journey
   * is expressed in terms of it. Once it starts running the bus is no longer
   * where the lane clock says — it is pulling in to the gate, which is
   * {@link busWaitZAt}'s job.
   */
  private idleSeconds = 0;
  private busZ = 0;

  private viewMode: JourneyView = 'outside';
  /** The lens this shot asks for, before the window's shape is taken into account. */
  private baseFov = CAMERA_FOV;
  /** The last base lens `render` fitted, so a cut re-fits and a still frame does not. */
  private fittedFov = -1;
  /**
   * The inside camera's eye and aim, **in the bus's own local space**.
   *
   * Computed once, off the seats that were actually built, and then carried
   * into world space through the bus's own matrix every frame. That is the
   * whole reason they are stored local: the bus climbs, dips and pitches, and a
   * camera inside it has to do all three exactly with it. A world-space pose
   * recomputed from a formula each frame is a second definition of where the
   * bus is, and this repo has paid for that shape repeatedly — most recently
   * with a face patch that had to track a surface it had left.
   */
  private readonly insideEye = new Vector3();
  private readonly insideAim = new Vector3();
  private readonly worldEye = new Vector3();
  private readonly worldAim = new Vector3();
  /** Where the pan down the aisle starts and ends, in the bus's own z. */
  private panFromZ = 0;
  private panToZ = 0;
  /** The lens's height, and how far ahead of it the aim lands. */
  private panEyeHeight = 0;
  private panReach = 1;
  /**
   * **Seconds spent inside the bus so far**, which is what the pan runs on.
   *
   * Not the ride's clock: the interior is two four-second beats with four
   * seconds of exterior between them, and a pan on the ride's clock would spend
   * that gap travelling where nobody can see it and arrive at the second beat
   * having skipped a third of the bus. On this clock the two beats are one
   * continuous eight-second journey from the back seat to the front, cut in
   * half — the second beat picks up exactly where the first was interrupted.
   */
  private insideSeconds = 0;

  constructor(rider: JourneyRider) {
    this.scene.name = 'cat-bus-journey';
    // The same linear fog the park uses, pulled in tight: the lane has to end
    // somewhere, and it should end in haze rather than in a visible edge.
    this.scene.fog = new Fog(PALETTE.skyDayBottom, 60, 235);

    // `near` at 0.2 rather than 0.5 because this camera also goes *inside* the
    // bus, where 0.5 m clips away the nearest row of children entirely.
    this.camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.2, 900);

    // --- lighting -----------------------------------------------------------
    // `DayNight`'s own daytime rig, at its daytime values. Not shared with it:
    // `DayNight` needs a `Scene` and a `Sky` and drives a clock, none of which
    // exist yet, and a twenty-second ride does not have a time of day.
    const key = new DirectionalLight(PALETTE.sunDay, 2.2);
    key.position.set(-40, 70, 30);
    this.scene.add(key, key.target);
    const fill = new DirectionalLight(PALETTE.skyDayBottom, 0.5);
    fill.position.set(30, 20, -40);
    this.scene.add(fill);
    this.scene.add(new HemisphereLight(PALETTE.ambientDay, PALETTE.grass, 1.1));

    this.scene.add(this.lane);
    this.buildGround();
    this.buildScenery();
    this.buildParkAhead();

    // --- the bus ------------------------------------------------------------
    this.bus = createCatBus();
    this.bus.setDoorOpen(0);
    // Nose-first down the lane. **No `rotation.y` here**: `place()` owns the
    // whole orientation, yaw and pitch together, by aiming the bus at the road
    // ahead of it. A separate yaw set once in a constructor is what let the
    // pitch be applied about the wrong axis and go unnoticed — see `place`.
    this.scene.add(this.bus.root);

    this.driver = createBusDriver();
    this.bus.driverSeat.add(this.driver.root);

    this.seatRiders(rider);
    // `place` first: `aimTheInsideCamera` converts the seated children's heads
    // out of world space through the bus's own matrix, so the bus has to be
    // somewhere before it can be asked where its passengers' faces are.
    this.place(0);
    this.bus.root.updateMatrixWorld(true);
    this.aimTheInsideCamera();
  }

  /**
   * Where the inside camera sits, **measured off the seats that were built**.
   *
   * ## It faces the front now, and it sits down among the seats
   *
   * QA, 8 August 2026, refusing to sign the shot off: *"the bottom 35–40% is
   * featureless cream floor, the two near heads are cropped by the frame edges,
   * and there is no seat, window, pillar or ceiling in shot — you cannot tell it
   * is a bus."* Jim agreed, and pointed at the fix QA had found by trying it:
   * *"the interior camera aims at the rear. **Aim it forward.**"*
   *
   * Two things were wrong, and the second is the one that mattered.
   *
   * **It was aimed backwards.** The seats face the nose; their backs are behind
   * their cushions. A lens at the front looking aft therefore sees the one thing
   * a bus interior has none of — the *fronts* of twelve seats, which is to say
   * nothing but children. Turned round, the same cabin is rows of seat backs
   * running away to the driver, which is what the inside of a coach looks like
   * from the back seat, and what a six-year-old has actually sat in.
   *
   * **And it was above the shoulder line, where there is no bus.** Everything
   * below {@link WINDOW_SILL_Y} — seats, cushions, floor pan, twelve bodies — is
   * *inside* the solid `cat-bus-shell-lower` block. Above it there is only the
   * flat top of that block, which is exactly the "featureless cream floor" in
   * QA's note: not a floor at all, but the lid of a box, with heads sticking out
   * of it. No shot from up there can contain a seat, because no seat reaches it:
   * the backs stop dead level with the sill.
   *
   * So the lens goes **down into the cabin proper**, and `catBus.ts`'s
   * `setCutaway` drops the one shell that would otherwise be all it could see.
   *
   * ## Everything here is measured, not chosen
   *
   * Asking `bus.seats` rather than restating `catBus.ts`'s seat plan matters
   * here more than usual: that plan has already been re-derived once, when a
   * child turned out to be 1.53 m across rather than the 0.6 m somebody had
   * imagined, and every number that had been copied out of it was wrong
   * afterwards.
   */
  private aimTheInsideCamera(): void {
    const seats = this.bus.seats;
    let front = -Infinity;
    let back = Infinity;
    let cushion = 0;
    /** How far off the centre line a seat column sits — measured, not restated. */
    let column = 0;
    for (const seat of seats) {
      front = Math.max(front, seat.position.z);
      back = Math.min(back, seat.position.z);
      cushion = seat.position.y;
      column = Math.max(column, Math.abs(seat.position.x));
    }

    // **Behind the back row, in the gangway.** `AISLE_WIDTH` is 0.8 m and a
    // seated child's shoulders start 0.53 m off the centre line, so `x = 0` is
    // the one column of clear air running the length of this bus — that much is
    // unchanged, and it is still the only place a lens can go.
    //
    // Half a row behind the rearmost cushion puts the whole busload in front of
    // the lens rather than beside it, which is what stops the near pair being
    // cropped by the frame edges: there is no near pair any more, only a first
    // row. `SEAT_PITCH` comes off the built seats — the gap between the two
    // rearmost rows — so a bus with a different seat plan still sits its camera
    // one row back.
    const pitch = seats.length > 2 ? Math.abs(seats[2]!.position.z - seats[0]!.position.z) : 1.8;
    const eyeZ = back - pitch * INSIDE_CAMERA_ROWS_BACK;

    // **At the height of a child's shoulders, not her eyes.** Low enough that
    // the seat backs stand over it and the aisle floor runs away underneath —
    // the two things that make the shot read as the inside of a vehicle — and
    // high enough to see over the rearmost cushions to the rows beyond.
    //
    // Taken off the cushion the children are actually sitting on rather than
    // from a height constant, so it tracks the seats if they move.
    const eyeHeight = cushion + KID_SHOULDER_HEIGHT * 0.72;
    this.insideEye.set(0, eyeHeight, eyeZ);

    // **Where the pan runs from and to.** Jim asked for the camera to *move*
    // along the row rather than sit and stare at it, so the lens travels the
    // length of the seating over the two interior beats, at a steady walk.
    //
    // The end is where the aim lands on the **front** row: at 45 degrees the
    // sightline reaches the far seat column one column-width ahead of the lens,
    // so a lens that stopped level with the last row would be aiming at the
    // bulkhead past it. Both ends therefore come off the seat plan, and a bus
    // with more rows pans further without anybody adjusting a second number.
    this.panEyeHeight = eyeHeight;
    this.panFromZ = eyeZ;
    this.panToZ = front - column;
    // Far enough ahead for the aim to land on the far seat column rather than
    // in the air short of it.
    //
    // **Level, with no downward tilt.** The shot this replaces aimed 0.25 m
    // below the lens, to hold the aisle and the seat bases in the bottom of the
    // frame. Turned across the rows there is no aisle running away to hold, so
    // that tilt would do nothing but push floor back into shot — measured at 10
    // points of the lower third.
    this.panReach = column / Math.sin(INSIDE_PAN_DEGREES * DEG);
    this.placeTheInsideCamera();
  }

  /**
   * **Where the inside lens is now**, as it travels down the aisle.
   *
   * Bus-local, so the pose can be carried through the bus's own matrix and
   * climb, dip and pitch with it exactly.
   *
   * Linear in {@link insideSeconds}, with no ease at either end: the beats are
   * hard cuts, so an ease-in would only ever be seen as the shot arriving
   * already moving, and a steady travel is what makes seat after seat land at
   * the same rhythm. Over eight seconds it covers the cabin at roughly one
   * metre a second — a row every 1.7 s, which is slow enough to read a face and
   * fast enough that it is plainly a moving shot.
   */
  private placeTheInsideCamera(): void {
    const travelled = clamp01(this.insideSeconds / INSIDE_SECONDS);
    const z = lerp(this.panFromZ, this.panToZ, travelled);
    this.insideEye.set(0, this.panEyeHeight, z);
    // **45 degrees off the aisle**, towards the **far** side. That side because
    // the door is cut into the other flank — `catBus.ts` skips a pillar and a
    // pane at the doorway — so this is the one with an unbroken run of both,
    // and because a lens at `x = 0` is already among the near column's backs.
    this.insideAim.set(
      Math.sin(INSIDE_PAN_DEGREES * DEG) * this.panReach,
      this.panEyeHeight,
      z + Math.cos(INSIDE_PAN_DEGREES * DEG) * this.panReach,
    );
  }

  /**
   * Puts the inside camera where it belongs and points it at {@link insideAim}.
   *
   * Through the bus's own matrix, so the camera climbs, dips and pitches with
   * it exactly — you feel the hills from inside, which is half of why being
   * able to sit in there is worth having.
   *
   * Its own method because **two** callers need it: `update` every frame, and
   * `render` again on the one frame a window changes shape, so the swing lands
   * on the frame that caused it rather than on the next one.
   */
  private pointTheInsideCamera(): void {
    this.bus.root.updateMatrixWorld(true);
    this.worldEye.copy(this.insideEye).applyMatrix4(this.bus.root.matrixWorld);
    this.worldAim.copy(this.insideAim).applyMatrix4(this.bus.root.matrixWorld);
    this.camera.position.copy(this.worldEye);
    this.camera.lookAt(this.worldAim);
  }

  /**
   * Seconds of **road** — how far down the lane the bus has come, as a time.
   *
   * Clamped at {@link JOURNEY_SECONDS} and held still while the bus waits, so
   * **this is not the clock for anything that has to keep moving on screen**.
   * That is {@link animationTime}. Feeding the title card this one is the whole
   * of the frozen-title fault QA found: see `ui/JourneyTitle.ts`.
   */
  get elapsed(): number {
    return this.elapsedSeconds;
  }

  /**
   * **The clock that never stops**, in seconds — the one for anything drawn.
   *
   * Jim, 8 August 2026, on the overrun: *"Anything that should keep moving
   * during the idle needs a clock that keeps running. Find every such thing."*
   * This is that clock, and it was already here driving the children and the
   * tail — which is exactly why those two were the only things QA measured
   * still moving. Exposed so everything else that must stay alive can read the
   * same one rather than grow a second.
   */
  get animationTime(): number {
    return this.animationSeconds;
  }

  /** How long the bus has been waiting at the kerb. Zero on an on-time ride. */
  get waited(): number {
    return this.idleSeconds;
  }

  /** Where the bus is down the lane, in metres. Negative is towards the park. */
  get busPositionZ(): number {
    return this.busZ;
  }

  /** Whether the ride is being watched from outside the bus or in it. */
  get view(): JourneyView {
    return this.viewMode;
  }

  /**
   * Cuts to a shot. Private: **the ride decides, not the player.**
   *
   * There was a "Look inside!" button here, built from a first reading of Jim's
   * *"switch between"*. He corrected it — *"the view shouldn't be switchable,
   * it should switch by itself"* — and the correction makes the feature both
   * simpler and better: a six-year-old watching her first twenty seconds of the
   * game should be shown the ride, not asked to operate it.
   */
  private cutTo(view: JourneyView): void {
    this.viewMode = view;
    // **The shot chooses a lens; `render` decides what that lens does in this
    // window.** Writing `camera.fov` here as well would be two owners of one
    // number, and the portrait rule would be silently undone on every cut.
    this.baseFov = view === 'inside' ? INSIDE_FOV : CAMERA_FOV;
    // **The cabin is only a cabin from inside a cutaway.** The lower body's
    // outline shell is a lightless `BackSide` box round every seat in the bus,
    // and it is the only part of that body a lens in there can see. Dropped for
    // the inside shot and put straight back for the outside one, where it is
    // what draws the bus's own dark edge. See `catBus.ts`'s `setCutaway`.
    this.bus.setCutaway(view === 'inside');
  }

  /** True once the ride has run its course. */
  get finished(): boolean {
    return this.elapsedSeconds >= JOURNEY_SECONDS;
  }

  /**
   * Eleven passengers plus her, in the bus's own seats.
   *
   * Seated by asking the bus where its seats are, exactly as `ArrivalSequence`
   * does — `catBus.ts` is the only thing that knows where a seat is, and a
   * second copy of that arithmetic is a second thing to keep in step.
   *
   * Parented **into** the seat rather than posed at its world position every
   * frame. The park has to do the latter because a crowd member's rig root is
   * where `NpcSystem` writes a world coordinate; these are one-off models that
   * belong to nobody else, so they can simply ride along for free.
   */
  private seatRiders(player: JourneyRider): void {
    const rng = createRandom(20260807);
    // Hers is the seat nearest the door, so she is the one you see best — and
    // so it is the same seat the arrival will put her in on the other side of
    // the cut.
    const seats = this.bus.seats;
    const playerSeat = this.bus.passengerSeat;

    for (let index = 0; index < CAT_BUS_SEAT_COUNT; index += 1) {
      const seat = seats[index];
      if (!seat) continue;
      const isPlayer = seat === playerSeat;
      const look: JourneyRider = isPlayer ? player : rollLook(rng);
      const kid = createKid({
        skin: look.skin,
        hair: look.hair,
        outfit: look.outfit,
        hairStyle: look.hairStyle,
        backpack: false,
      });
      kid.setExpression('happy');
      // **Turned in towards the gangway**, which is where the excitement is.
      //
      // A kid's painted face points along its own +Z (measured, not assumed),
      // so twelve children all facing the bus's nose sit in two lines with
      // their faces pointing *past* anyone in the aisle: from the inside camera
      // they are a corridor of profiles and the backs of heads. Turned inboard
      // they are children talking to each other on a bus, which is both what
      // happens on a bus and the only arrangement that puts faces where they
      // can be seen.
      //
      // Kept to 0.6 rad rather than a full quarter turn because they are also
      // looked at side-on **through the side windows from outside**, which is
      // the thing the previous round's glazing work existed to make possible.
      // At this angle they read as three-quarter faces from both places.
      const inboard = -Math.sign(seat.position.x || 1) * 0.6;
      kid.root.rotation.y = inboard + rng() * 0.4 - 0.2;
      // **Actually sitting.** This line is the fix for Jim's *"the children on
      // the bus aren't sitting on seats"*: there was no pose here at all, so
      // twelve children rode the whole way stood bolt upright with the cushions
      // through their shins, and the guard that counted twelve occupied seats
      // was perfectly happy about it. `applyRidePose` is the game's own seated
      // pose — the same one the ferris wheel and the Rail Race use — reached
      // through `entities/ridePose.ts` rather than copied, so the bus cannot
      // drift from what sitting means everywhere else.
      applyRidePose({ root: kid.root, body: kid.body, head: kid.head, ...kid.limbs }, 0, 0);
      // **How much air is over this particular child**, measured on her, posed,
      // before she is parented into anything — so `box.max.y` is plainly "how
      // far she reaches above her own origin" and her origin is about to become
      // the cushion top. See `riderBounce`.
      kid.root.updateMatrixWorld(true);
      const reach = new Box3().setFromObject(kid.root).max.y;
      const headroom = CAT_BUS_CABIN_CEILING_Y - (CAT_BUS_SEAT_Y + reach);
      this.riderBounce.push(Math.max(0, Math.min(RIDER_BOUNCE, headroom - RIDER_BOUNCE_MARGIN)));
      seat.add(kid.root);
      this.riders.push(kid);
    }
  }

  /**
   * The lane's ground, as one displaced plane.
   *
   * Vertices are displaced by {@link groundHeight}, which is the same function
   * the bus's own wheels and every tree read — one definition of "where the
   * ground is", so nothing here can ever float or sink.
   */
  private buildGround(): void {
    const segmentsZ = 220;
    const segmentsX = 40;
    const geometry = new PlaneGeometry(
      GROUND_HALF_WIDTH * 2,
      LANE_LENGTH,
      segmentsX,
      segmentsZ,
    );
    geometry.rotateX(-Math.PI / 2);
    // **Translated into world space before anything is displaced.** The first
    // version left the plane at the origin, displaced its vertices by
    // `groundHeight(x, localZ)`, and then moved the *mesh* 100 m down the lane
    // — so the hills ended up a hundred metres out of step with the road, the
    // hedges, the trees and the bus, every one of which reads the same function
    // in world coordinates. The result was a bus sailing along ten metres above
    // a flat green sheet with the road and the verges buried underneath it, and
    // it read on screen as "the camera is too high", which it was not.
    //
    // Baking the offset into the geometry means there is only ever one z here,
    // and it is the one everything else uses.
    geometry.translate(0, 0, LANE_AHEAD - LANE_LENGTH / 2);
    const position = geometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < position.count; i += 1) {
      position.setY(i, groundHeight(position.getX(i), position.getZ(i)));
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();

    const ground = new Mesh(geometry, toonMaterial(PALETTE.grass));
    ground.name = 'journey-ground';
    ground.receiveShadow = true;
    this.lane.add(ground);

    // The carriageway, a narrow ribbon laid on the same hills a hand's breadth
    // up so it never z-fights the grass.
    //
    // **Segmented across as well as along**, at 8 rather than 2: the texture now
    // carries kerbs at fixed `u`, and two segments across a 5.7 m road put the
    // nearest UV sample 2.9 m from the kerb it is meant to draw.
    const roadGeometry = new PlaneGeometry(ROAD_HALF_WIDTH * 2, LANE_LENGTH, 8, segmentsZ);
    roadGeometry.rotateX(-Math.PI / 2);
    roadGeometry.translate(0, 0, LANE_AHEAD - LANE_LENGTH / 2);
    const roadPosition = roadGeometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < roadPosition.count; i += 1) {
      roadPosition.setY(i, laneHeight(roadPosition.getZ(i)) + 0.07);
    }
    roadPosition.needsUpdate = true;
    roadGeometry.computeVertexNormals();
    // Slabs, kerbs and a dashed centre line, in metres — the same road the park
    // lays at its own gate. Jim: *"the texture on the road is too plain"*; it was
    // one flat fill, so nothing moved past under the bus for twenty seconds.
    applyRoadUvs(roadGeometry, { across: 'x', along: 'z' });
    const road = new Mesh(roadGeometry, roadMaterial());
    road.name = 'journey-road';
    road.receiveShadow = true;
    this.lane.add(road);
  }

  /**
   * Trees and hedges either side, instanced.
   *
   * Two populations doing two different jobs, which is why there are two:
   * **hedge posts close to the road** give the speed something to be measured
   * against — a distant tree at 11 m/s barely moves — and **trees further out**
   * give the lane somewhere to be. Everything sits on {@link groundHeight}, so
   * the scenery rides the hills with the bus.
   */
  private buildScenery(): void {
    const rng = createRandom(19470116);
    const trunkGeometry = new CylinderGeometry(0.22, 0.34, 1, 6);
    const canopyGeometry = new IcosahedronGeometry(1, 1);

    const TREES = 460;
    const trunks = new InstancedMesh(trunkGeometry, toonMaterial(PALETTE.barkDark), TREES);
    const canopies = new InstancedMesh(canopyGeometry, toonMaterial(PALETTE.leafMid), TREES);
    trunks.name = 'journey-tree-trunks';
    canopies.name = 'journey-tree-canopies';
    const matrix = new Matrix4();
    const at = new Vector3();
    const scale = new Vector3();
    const spin = new Quaternion();

    for (let i = 0; i < TREES; i += 1) {
      const side = i % 2 === 0 ? 1 : -1;
      // Clear of the tarmac, thinning outwards so the lane has a near edge and
      // a soft far one.
      const x = side * (ROAD_HALF_WIDTH + 2.6 + rng() * rng() * 62);
      const z = LANE_AHEAD - rng() * LANE_OPEN_RUN;
      const ground = groundHeight(x, z);
      const height = 3.4 + rng() * 4.2;
      const radius = 1.5 + rng() * 1.6;

      spin.setFromAxisAngle(new Vector3(0, 1, 0), rng() * Math.PI * 2);
      at.set(x, ground + height / 2, z);
      scale.set(1, height, 1);
      matrix.compose(at, spin, scale);
      trunks.setMatrixAt(i, matrix);

      at.set(x, ground + height + radius * 0.3, z);
      scale.set(radius, radius * (0.85 + rng() * 0.3), radius);
      matrix.compose(at, spin, scale);
      canopies.setMatrixAt(i, matrix);
    }
    trunks.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
    trunks.castShadow = true;
    canopies.castShadow = true;
    this.lane.add(trunks, canopies);

    // The hedge: little rounded blobs marching along both verges, close enough
    // to the camera to sell the speed.
    const HEDGE = 520;
    const hedge = new InstancedMesh(
      new SphereGeometry(1, 8, 6),
      toonMaterial(PALETTE.leafDeep),
      HEDGE,
    );
    hedge.name = 'journey-hedge';
    for (let i = 0; i < HEDGE; i += 1) {
      const side = i % 2 === 0 ? 1 : -1;
      const along = (i / HEDGE) * LANE_OPEN_RUN;
      const z = LANE_AHEAD - along;
      const x = side * (ROAD_HALF_WIDTH + 0.9 + rng() * 0.5);
      const radius = 0.75 + rng() * 0.45;
      at.set(x, groundHeight(x, z) + radius * 0.55, z);
      scale.set(radius * 1.35, radius, radius * 1.35);
      spin.setFromAxisAngle(new Vector3(0, 1, 0), rng() * Math.PI);
      matrix.compose(at, spin, scale);
      hedge.setMatrixAt(i, matrix);
    }
    hedge.instanceMatrix.needsUpdate = true;
    hedge.castShadow = true;
    this.lane.add(hedge);
  }

  /**
   * **The park, at the end of the lane.**
   *
   * Jim, 7 August 2026: *"it doesn't actually drive up to the park, the road
   * needs to actually go to the park."*
   *
   * The road went nowhere. The lane ran on past the horizon, the ride simply
   * stopped after twenty seconds, and the cut put a child beside a gate she had
   * never seen coming. Nothing on screen ever said where the bus was going, so
   * "driving to the park" was a caption rather than a thing you watched happen.
   *
   * Now the park is **built at the far end of the road**: its boundary wall
   * across the view, its gate arch dead ahead with the carriageway running
   * through it, and its trees and rooftops standing over the wall behind. It
   * begins the ride buried in {@link Scene.fog} — 250 m out against a fog that
   * ends at 235 — and emerges over the last third, so the arrival is something
   * that grows in the windscreen rather than something that is announced.
   *
   * ## It is the park's own gate, not a lookalike
   *
   * The posts, the caps and the crossbar are built to `Entrance.ts`'s own
   * dimensions and out of the same `stonePink` family, and the road through it
   * is `road.ts`'s road at `road.ts`'s width. That matters at exactly one
   * moment — the cut — where a child is looking at a gate and a road and
   * nothing else, and any disagreement between the two scenes is a jump.
   *
   * The bus stops {@link PARK_STANDOFF} short of the arch, which is what makes
   * it an arrival rather than a collision.
   */
  private buildParkAhead(): void {
    const gateZ = PARK_AHEAD_Z;
    const stone = toonMaterial(PALETTE.stonePink);
    const capStone = toonMaterial(PALETTE.stonePinkLight);

    // --- the boundary wall, either side of the opening -----------------------
    // Blocks laid along the ground it stands on, so the wall rides the same
    // hills as everything else rather than hovering over them.
    const BLOCK = 2.2;
    const WALL_HEIGHT = 2.6;
    const blockGeometry = new BoxGeometry(BLOCK * 0.96, WALL_HEIGHT, 1.1);
    const perSide = 26;
    const wall = new InstancedMesh(blockGeometry, stone, perSide * 2);
    wall.name = 'journey-park-wall';
    const matrix = new Matrix4();
    const at = new Vector3();
    const spin = new Quaternion();
    const one = new Vector3(1, 1, 1);
    let laid = 0;
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < perSide; i += 1) {
        // Starts clear of the gate opening and marches outward.
        const x = side * (GATE_HALF_WIDTH + 1.2 + i * BLOCK);
        at.set(x, groundHeight(x, gateZ) + WALL_HEIGHT / 2 - 0.3, gateZ);
        matrix.compose(at, spin, one);
        wall.setMatrixAt(laid, matrix);
        laid += 1;
      }
    }
    wall.instanceMatrix.needsUpdate = true;
    wall.castShadow = true;
    wall.receiveShadow = true;
    this.lane.add(wall);

    // --- the gate arch -------------------------------------------------------
    // `Entrance.ts`'s own posts, caps and crossbar. Same shape, same stone: this
    // is the gate she is about to walk through, seen from outside.
    const gateGround = groundHeight(0, gateZ);
    const gate = new Group();
    gate.name = 'journey-park-gate';
    for (const side of [-1, 1] as const) {
      const post = new Mesh(new CylinderGeometry(0.42, 0.5, GATE_POST_HEIGHT, 12), stone);
      post.position.set(side * GATE_HALF_WIDTH, gateGround + GATE_POST_HEIGHT / 2, gateZ);
      post.castShadow = true;
      gate.add(post);

      const cap = new Mesh(new SphereGeometry(0.62, 14, 10), capStone);
      cap.position.set(side * GATE_HALF_WIDTH, gateGround + GATE_POST_HEIGHT + 0.15, gateZ);
      cap.scale.set(1, 0.75, 1);
      gate.add(cap);
    }
    const crossbar = new Mesh(new TorusGeometry(GATE_HALF_WIDTH, 0.28, 10, 24, Math.PI), capStone);
    crossbar.position.set(0, gateGround + GATE_POST_HEIGHT + 0.15, gateZ);
    crossbar.rotation.z = Math.PI;
    crossbar.castShadow = true;
    gate.add(crossbar);
    this.lane.add(gate);

    // --- what stands over the wall -------------------------------------------
    // Trees and bright pastel rooftops behind the stone, so what is on the other
    // side reads as somewhere worth arriving at rather than a walled field. Kept
    // to silhouettes: at this distance that is all anybody can see anyway, and a
    // second park modelled in detail is a second park to keep in step.
    const rng = createRandom(20260808);
    const PARK_THINGS = 54;
    const roofGeometry = new ConeGeometry(1, 1, 7);
    const roofs = new InstancedMesh(roofGeometry, toonMaterial(PALETTE.markerPink), PARK_THINGS);
    roofs.name = 'journey-park-rooftops';
    const canopyGeometry = new IcosahedronGeometry(1, 1);
    const canopies = new InstancedMesh(canopyGeometry, toonMaterial(PALETTE.leafMid), PARK_THINGS);
    canopies.name = 'journey-park-trees';
    const scale = new Vector3();
    for (let i = 0; i < PARK_THINGS; i += 1) {
      const x = (rng() - 0.5) * 120;
      const z = gateZ - 6 - rng() * 55;
      const ground = groundHeight(x, z);

      const roofHeight = 5 + rng() * 7;
      spin.setFromAxisAngle(new Vector3(0, 1, 0), rng() * Math.PI * 2);
      at.set(x, ground + roofHeight / 2, z);
      scale.set(2.4 + rng() * 2.2, roofHeight, 2.4 + rng() * 2.2);
      matrix.compose(at, spin, scale);
      roofs.setMatrixAt(i, matrix);

      const treeX = (rng() - 0.5) * 130;
      const treeZ = gateZ - 4 - rng() * 60;
      const radius = 2.6 + rng() * 2.4;
      at.set(treeX, groundHeight(treeX, treeZ) + radius * 1.5, treeZ);
      scale.set(radius, radius * 1.15, radius);
      matrix.compose(at, spin, scale);
      canopies.setMatrixAt(i, matrix);
    }
    roofs.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
    roofs.castShadow = true;
    canopies.castShadow = true;
    this.lane.add(roofs, canopies);
  }

  /**
   * Puts the bus at a point down the lane, on the hills, **lying along the
   * slope it is standing on**.
   *
   * ## Why this is a `lookAt` and not an angle
   *
   * It was an angle, and the angle was backwards. `rotation.x` was set to
   * `atan2(behind − ahead, 14)`, which — once the constructor's separate
   * `rotation.y = π` had turned the bus to face −Z — pitched its nose **down**
   * every time the road went up. Measured over a whole ride, the bus disagreed
   * with the ground on **every one of 1200 frames**: at t = 10 s the lane climbs
   * at +0.12 m per metre and the bus's nose pointed 0.11 *below* the horizontal.
   * Jim, 7 August 2026: *"the bus doesn't tilt up when going over a hill"* — it
   * tilted the other way, which reads as not tilting at all right up until it
   * reads as wrong.
   *
   * A sign is exactly the kind of thing that is invisible in review and obvious
   * on screen, so there is no longer a sign here to get wrong. The bus is simply
   * pointed at the piece of road under its own nose: `Object3D.lookAt` aims
   * local **+Z** — the bus's own length, the way `catBus.ts` builds it — at a
   * target, so yaw and pitch both fall out of where the road *is*. There is
   * nothing left to invert.
   *
   * The nose and tail points are {@link BUS_PITCH_SPAN} apart rather than
   * sampled at a point, so the bus lies along the hill the way a long vehicle
   * does instead of pivoting on its middle.
   *
   * {@link laneHeight} is the one owner: the ground mesh, the road ribbon, every
   * tree, every hedge and this all read it, so the bus cannot drift from the
   * road it is driving on.
   */
  private place(z: number): void {
    const half = BUS_PITCH_SPAN / 2;
    // The bus drives towards −Z, so its nose rests at the smaller z.
    const rise = laneHeight(z - half) - laneHeight(z + half);
    this.bus.root.position.set(0, laneHeight(z), z);
    // Aim the bus's length along the chord from where its tail rests to where
    // its nose rests. Uphill means `rise > 0` means the target is above the bus
    // means the nose comes up — which is a statement about the road, not about
    // a rotation convention.
    this.bus.root.lookAt(0, laneHeight(z) + rise, z - BUS_PITCH_SPAN);
  }

  /**
   * Where the camera goes this frame.
   *
   * Exported shape rather than an inline lump because {@link cameraPoseAt} is
   * pure: a check can ask where the camera will be at t = 19.9 s without
   * building a bus, which is the only way to assert that the ride ends on the
   * park's own bearing.
   */
  /**
   * One frame of the ride.
   *
   * `travelling` is false while the bus idles at the kerb — the ride has run its
   * course and the park has not finished generating (`JourneyDirector`). The
   * road stops moving; **the children do not**, because a bus of frozen
   * passengers is what a stopped clock actually looks like on screen.
   */
  update(dt: number, travelling = true): void {
    if (dt <= 0) return;
    this.animationSeconds += dt;
    if (travelling) {
      this.elapsedSeconds = Math.min(JOURNEY_SECONDS, this.elapsedSeconds + dt);
    } else {
      this.idleSeconds += dt;
    }

    // **The wait is a manoeuvre, not a pause.** Once the road has run out the
    // bus stops taking its position from the lane clock — which is clamped —
    // and takes it from how long it has been waiting instead, rolling the last
    // stretch and pulling up at the gate. See {@link BUS_WAIT_Z}.
    const waiting = this.idleSeconds > 0;
    this.busZ = waiting ? busWaitZAt(this.idleSeconds) : -this.elapsedSeconds * BUS_SPEED;
    const speed = waiting ? busWaitSpeedAt(this.idleSeconds) : BUS_SPEED;
    // **How stopped the bus is**, 0 at road speed and 1 at rest. Computed once
    // and handed to everything that ramps with the stop — the rock on the
    // springs and the camera's breath — rather than each deriving it from
    // `speed` again, which would be two definitions of one number.
    const atRest = clamp01(1 - Math.abs(speed) / BUS_SPEED);
    this.place(this.busZ);
    // **The wheels stop turning because the bus stops moving**, rather than
    // because a boolean said so: `speed` is the real speed throughout, so they
    // visibly slow down over the pull-in instead of switching off.
    this.bus.animate(dt, this.animationSeconds, speed);
    this.exciteRiders(this.animationSeconds);
    this.rockAtRest(atRest);

    // **The cut.** Driven by the ride's own clock through the shot list, so the
    // schedule is a thing `check:bus-journey` can hold rather than something
    // that only exists while a frame is being drawn.
    this.cutTo(shotAt(this.elapsedSeconds).view);

    if (this.viewMode === 'inside') {
      // **The pan's own clock, which only runs while the shot is on screen.**
      // Advanced here rather than in `update`'s preamble so the four seconds of
      // exterior between the two interior beats are not spent travelling down a
      // bus nobody is looking at.
      this.insideSeconds += dt;
      this.placeTheInsideCamera();
      this.pointTheInsideCamera();
      return;
    }

    const pose = cameraPoseAt(this.elapsedSeconds);
    const height = laneHeight(this.busZ);
    // **The breath.** A scale on how far out the camera stands, so the bearing
    // — `pose.yaw`, the whole of what the hand-over cuts on — is untouched.
    // Exactly 1 for the whole of an on-time ride, because `atRest` is 0 until
    // the bus starts slowing. See {@link IDLE_BREATH}.
    const breath = 1 + Math.sin(this.animationSeconds * IDLE_BREATH_RATE) * IDLE_BREATH * atRest;
    this.camera.position.set(
      Math.sin(pose.yaw) * pose.horizontal * breath,
      height + pose.lift * breath,
      this.busZ + Math.cos(pose.yaw) * pose.horizontal * breath,
    );
    // **Aimed at the bus, not at the road under it.** The two are the same
    // number on an ordinary ride, and they part company at exactly the moment
    // it matters: a bus rocking at the kerb is something the camera should be
    // seen to be watching. Taking the height off `bus.root` rather than
    // recomputing `laneHeight` also removes a second definition of where the
    // bus is, which is this repo's most expensive bug shape.
    this.camera.lookAt(0, this.bus.root.position.y + 2.2, this.busZ);
  }

  /**
   * **The engine is running while she waits.**
   *
   * Applied after {@link place}, which rewrites the bus's whole transform every
   * frame, so this is a fresh offset each time rather than an accumulating one.
   *
   * `atRest` is how far the bus has slowed — 0 at road speed, 1 stopped — and
   * the amplitude is ramped by it, so the rock arrives *with* the stop.
   * Switching it on at zero speed would put a visible step in the one frame the
   * whole change exists to smooth over. Taken as an argument rather than
   * re-derived from `speed` here: `update` needs the same number for the
   * camera's breath, and two derivations of one quantity is the bug shape this
   * repo pays for most often.
   */
  private rockAtRest(atRest: number): void {
    if (atRest <= 0) return;
    const t = this.animationSeconds;
    this.bus.root.position.y += Math.sin(t * IDLE_ROCK_RATE) * IDLE_ROCK_LIFT * atRest;
    // About the bus's own length, which `place`'s `lookAt` has just aimed down
    // the road — so this is roll, whatever bearing the lane has put it on.
    this.bus.root.rotateZ(Math.sin(t * IDLE_ROCK_RATE * 0.77 + 1.4) * IDLE_ROCK_ROLL * atRest);
  }

  /**
   * **The children, riding and looking excited.**
   *
   * Jim asked for the inside view to show *"the children riding it and looking
   * excited"*, and a `setExpression('happy')` on a body that never moves is a
   * photograph of a smile rather than excitement. So they bounce in their seats,
   * throw their arms up, and look about at the countryside going past — each on
   * their own phase, so twelve children are not one child twelve times.
   *
   * Driven every frame **whatever the view is**, not only from inside. They are
   * visible through the glazing from outside too — that glazing was the whole
   * point of the previous round — and a bus full of children who freeze the
   * moment you step out of it is a worse bug than one full of still children.
   */
  private exciteRiders(elapsed: number): void {
    for (let i = 0; i < this.riders.length; i += 1) {
      const kid = this.riders[i];
      if (!kid) continue;
      const phase = i * 1.31;
      // Bouncing on the seat. `body` is the rig's own bob target, and the
      // amplitude is this child's own — measured against the ceiling over her
      // head when she was seated. See `riderBounce`.
      kid.body.position.y =
        Math.abs(Math.sin(elapsed * 3.2 + phase)) * (this.riderBounce[i] ?? 0);
      // Looking out at what is going past, and up at each other.
      // Glancing about, not turning away: at ±0.55 rad most of the bus had its
      // face pointed somewhere other than forward, and the inside view is a
      // shot of faces or it is nothing.
      kid.head.rotation.y = Math.sin(elapsed * 0.9 + phase) * 0.26;
      kid.head.rotation.z = Math.sin(elapsed * 1.7 + phase) * 0.09;
      if (kid.limbs) {
        // Arms up: negative `rotation.x` raises an arm, as the ferris wheel's
        // excited riders do it.
        const lift = -1.35 + Math.sin(elapsed * 6.5 + phase) * 0.32;
        kid.limbs.leftArm.rotation.x = lift;
        kid.limbs.rightArm.rotation.x = lift + Math.sin(elapsed * 7.4 + phase) * 0.3;
        kid.limbs.leftArm.rotation.z = 0.34;
        kid.limbs.rightArm.rotation.z = -0.34;
      }
    }
  }

  /**
   * Draws the ride, **fitted to the window it is being drawn into**.
   *
   * This used to set `aspect` and nothing else, which is the whole of QA's
   * *"the bus is cropped at both ends mid-orbit"* on a phone: a
   * `PerspectiveCamera`'s `fov` is its *vertical* one, so on a portrait window
   * the horizontal field narrows with the width and an 18 m vehicle broadside
   * to the lens runs off both edges. Every other ride camera in the game
   * already widens for this, through `fitCameraToViewport` — the declared one
   * owner of the portrait rule — and the ride was the one camera that did not
   * ask it.
   */
  render(renderer: WebGLRenderer, width: number, height: number): void {
    const aspect = width / Math.max(1, height);
    if (this.camera.aspect !== aspect || this.fittedFov !== this.baseFov) {
      this.fittedFov = this.baseFov;
      fitCameraToViewport(this.camera, this.baseFov, width, height);
      // **The inside shot is the same shot in every window**, per Jim on 8
      // August: *"in all modes, not just portrait."* So there is nothing to
      // decide here beyond the lens — the pan down the aisle is what makes a
      // tall frame work, and it is the same pan a wide one gets.
    }
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.driver.dispose();
    for (const rider of this.riders) rider.root.removeFromParent();
    this.riders.length = 0;
    this.bus.dispose();
    this.scene.clear();
  }
}

/**
 * Where the camera is, as a bearing and a distance from the bus, at time `t`.
 *
 * Pure and exported so a check can measure the shot without a renderer — in
 * particular that the ride **ends on the park's own camera bearing**, which is
 * what makes the hand-over a cut rather than a jump, and which is exactly the
 * kind of claim that is easy to write in a comment and never verify.
 */
export function cameraPoseAt(t: number): {
  readonly yaw: number;
  readonly horizontal: number;
  readonly lift: number;
} {
  const settleStart = JOURNEY_SECONDS - ORBIT.settleSeconds;
  const spun = ORBIT.startYawDegrees * DEG + (t / JOURNEY_SECONDS) * ORBIT.turns * Math.PI * 2;
  const parkYaw = CAMERA_YAW_DEGREES * DEG;

  // Ease onto the park's bearing over the last few seconds, taking the shortest
  // way round from wherever the orbit has got to, so the settle never spins
  // back on itself.
  let yaw = spun;
  if (t > settleStart) {
    const settle = smoothstep(0, 1, clamp01((t - settleStart) / ORBIT.settleSeconds));
    const target = parkYaw + Math.round((spun - parkYaw) / (Math.PI * 2)) * Math.PI * 2;
    yaw = lerp(spun, target, settle);
  }

  // The park's camera is a fixed elevation; the ride's drifts a little so the
  // shot breathes, and lands on the park's own by the end.
  const parkPitch = CAMERA_PITCH_DEGREES * DEG;
  const settle = t > settleStart ? smoothstep(0, 1, clamp01((t - settleStart) / ORBIT.settleSeconds)) : 0;
  const drift = Math.sin(t * 0.42) * 0.09;
  const pitch = lerp(parkPitch + drift, parkPitch, settle);
  const distance = lerp(CAMERA_BACK + Math.sin(t * 0.31) * 3.5, CAMERA_BACK, settle);

  return {
    yaw,
    horizontal: Math.cos(pitch) * distance,
    lift: lerp(Math.sin(pitch) * distance, CAMERA_LIFT, settle * 0.25),
  };
}
