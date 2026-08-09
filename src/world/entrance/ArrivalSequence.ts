import { Group, Vector3 } from 'three';
import { clamp01, createRandom, lerp, smoothstep, turnTowards } from '../../core/mathUtils';
import { terrainHeight } from '../terrain';
import type { FrameContext } from '../../core/types';
import type { Player } from '../../entities/Player';
import type { NpcCharacter } from '../../entities/npc/NpcCharacter';
import { NPC_WALK_SPEED } from '../../entities/npc/NpcCharacter';
import { CHILD_FOOTPRINT } from '../../art/models/kid';
import {
  createCatBus,
  CAT_BUS_LENGTH,
  CAT_BUS_LONGEST_WALK_TO_DOOR,
  CAT_BUS_SEAT_COUNT,
  CAT_BUS_TOP,
  CAT_BUS_WIDTH,
  type CatBusHandle,
} from './catBus';
import { CAMERA_VIEW_HEIGHT } from '../../core/constants';
import { createBusDriver, type BusDriver } from './busDriver';
import { playBrakeSqueak, playDoorHiss, playHornToot } from './sounds';
import { markArrived } from './arrivalFlag';
import {
  ENTRANCE_ANGLE,
  ENTRANCE_BUS_ARRIVE_X,
  ENTRANCE_BUS_DOOR_X,
  ENTRANCE_BUS_STOP_Z,
  ENTRANCE_BUS_VANISH_X,
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
 * The zoom the park camera should be holding, for a given arrival phase.
 *
 * A pure function in its own right, for the reason `arrivalSpawn.ts` exists:
 * the caller is `Game.tick()`, `Game` cannot be constructed in a test, and a
 * camera decision made inline in there is a camera decision no check can reach
 * — which is exactly how the last camera bug on this feature stayed green.
 *
 * Back to 1 from `departing` onward. She has the controls by then, and the
 * framing she plays in is the ordinary one; the damping in `IsoCamera.update`
 * turns the change into a push-in rather than a jump.
 */
export function arrivalCameraZoom(phase: ArrivalPhase): number {
  return phase === 'departing' || phase === 'done' ? 1 : ARRIVAL_CAMERA_ZOOM;
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
      walks.push({
        route,
        arc: buildArcTable(route.from, route.corner, route.to),
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

    this.bus.animate(dt, context.elapsed, this.busSpeed);

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
    const walked = (moving - walk.aisleSeconds) * walk.speed;
    const progress = clamp01(walked / Math.max(0.5, walk.arc.total));
    const route = walk.route;
    const at = tAtDistance(walk.arc, walked);
    const here = bezier(route.from, route.corner, route.to, at);
    const ahead = bezier(route.from, route.corner, route.to, Math.min(1, at + 0.05));
    const dx = ahead.x - here.x;
    const dz = ahead.z - here.z;

    const x = here.x + walk.nudgeX;
    const z = here.z + walk.nudgeZ;
    const facing = dx !== 0 || dz !== 0 ? Math.atan2(dx, dz) : BUS_FACING;
    kid.setScriptedPose(x, terrainHeight(x, z), z, facing, progress >= 1 ? 0 : walk.speed);

    // **Handed back inside the park, not at the kerb.** The scripted route runs
    // all the way through the gate and several metres in, so when the wander
    // driver takes over it is anchoring on a waypoint that is genuinely nearby
    // and genuinely reachable — rather than on the far side of a wall the child
    // is currently standing outside of.
    if (progress >= 1) this.release(index, dt);
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
