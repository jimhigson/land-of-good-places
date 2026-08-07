import { Group, Vector3 } from 'three';
import { clamp01, createRandom, lerp, smoothstep, turnTowards } from '../../core/mathUtils';
import { terrainHeight } from '../terrain';
import type { FrameContext } from '../../core/types';
import type { Player } from '../../entities/Player';
import { createCatBus, CAT_BUS_SEAT_COUNT, type CatBusHandle } from './catBus';
import { createDisembarkingKid, type DisembarkingKid } from './disembarkingKids';
import { playBrakeSqueak, playDoorHiss, playHornToot } from './sounds';
import { hasArrivedBefore, markArrived } from './arrivalFlag';
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
 * The original went twelve days undetected precisely because nothing could see
 * it; hanging the fix off `Game` would have rebuilt that blind spot.
 *
 * ## The shape of it
 *
 * The bus **pulls up along the kerb outside the gate** and never enters the
 * park — Jim watched the first run and said *"the bus drives something like 5 m
 * into the park, through a wall"*, and both halves were true. A bus is not a
 * park vehicle. It stops on the road, the children walk in through the arch,
 * and the arch now actually has a hole in it (#195).
 *
 * Twelve seats, all occupied: eleven other children plus the player, and a
 * driver who stays at the wheel because somebody has to drive it away.
 * Everybody gets off — a bus arriving at a park unloads.
 *
 * ## When it runs
 *
 * Whenever the player has not already arrived — {@link arrivalIsDue}. That is
 * the same as "every time a new game is started", because `main.ts`'s
 * `startFresh` calls `clearSave()` and a cleared save has `arrivedByBus` false.
 * The default is deliberately the arrival *happening*: forgetting to wire an
 * opt-out then fails loud rather than silent, which is the direction the
 * original bug failed in. `markArrived()` fires when she is handed the
 * controls, so quitting halfway replays it.
 *
 * ## Where Stage B attaches
 *
 * The animated journey (issue #245 part 1) ends where this begins: bus at
 * {@link ENTRANCE_BUS_ARRIVE_X} on the kerb, facing along it, door shut,
 * everyone aboard. That is the `'rolling-in'` phase's first frame, and
 * {@link ArrivalOptions.bus} lets the journey's own bus be handed straight over
 * at an identical pose rather than a second one popping in at the seam.
 */

/** How long each phase lasts, in seconds. Exported so a check can drive it. */
export const ARRIVAL_TIMELINE = {
  /** Rolling along the kerb to the stop. */
  rollingIn: 3.2,
  /** The door swinging open. */
  doorsOpening: 0.8,
  /** The other children hopping down and setting off. */
  kidsOff: 2.2,
  /** The player stepping down onto the pavement. */
  steppingDown: 1.1,
  /** Walking in through the gate. */
  walkingIn: 4.6,
  /** The bus pulling away. She already has the controls throughout this. */
  departing: 3.2,
} as const;

export type ArrivalPhase =
  | 'rolling-in'
  | 'doors-opening'
  | 'kids-off'
  | 'stepping-down'
  | 'walking-in'
  | 'departing'
  | 'done';

/** Index of the doors-opening phase in {@link PHASE_ORDER} — when children may move. */
const DOORS_OPEN_PHASE = 1;

const PHASE_ORDER: readonly (readonly [ArrivalPhase, number])[] = [
  ['rolling-in', ARRIVAL_TIMELINE.rollingIn],
  ['doors-opening', ARRIVAL_TIMELINE.doorsOpening],
  ['kids-off', ARRIVAL_TIMELINE.kidsOff],
  ['stepping-down', ARRIVAL_TIMELINE.steppingDown],
  ['walking-in', ARRIVAL_TIMELINE.walkingIn],
  ['departing', ARRIVAL_TIMELINE.departing],
];

/** Total run time, derived rather than restated. */
export const ARRIVAL_DURATION = PHASE_ORDER.reduce((total, [, seconds]) => total + seconds, 0);

/**
 * How many other children ride in with her.
 *
 * Every seat is filled and one of them is hers, so this is simply the rest.
 * Derived from the bus's own seat count — the bus owns how many seats it has.
 */
export const ARRIVAL_KID_COUNT = CAT_BUS_SEAT_COUNT - 1;

/** Is the arrival due for this player? One question, asked in one place. */
export function arrivalIsDue(): boolean {
  return !hasArrivedBefore();
}

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
 * **One child's own walk — their own moment to get off, their own pace.**
 *
 * Jim, watching the twelve arrive: *"make the children all get off at different
 * times, and then walk into the park, currently they all move exactly in a
 * line"*. They did, and the reason was structural rather than cosmetic: every
 * child's progress was a function of the *phase clock*, so whatever their route,
 * they were all at the same fraction of it on the same frame and moved as one
 * rigid body.
 *
 * Progress is now each child's **own** — distance covered at their own speed
 * since their own start time — so they spread out on their own, bunch at the
 * gate, and arrive strung out. A stagger painted on top of a shared clock would
 * have looked like a stagger for about a second and then snapped back.
 */
interface KidWalk {
  /** Seconds after the doors open before this one moves at all. */
  readonly delay: number;
  /** Metres a second, varied — children dawdle at different rates. */
  readonly speed: number;
  /** Rough length of their route, so speed means metres rather than fractions. */
  readonly length: number;
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

/** Fixed, so the arrival plays the same way every time the family watches it. */
const ARRIVAL_SEED = 20260807;
/** Base gap between one child stepping down and the next, in seconds. */
const KID_QUEUE_GAP = 0.42;
/** How much longer than that any one of them might take to get going. */
const KID_DAWDLE = 0.9;
/** A child's ambling pace, metres a second, before their own variation. */
const KID_WALK_SPEED = 1.5;
/**
 * How close two children get before they push each other apart, in metres.
 *
 * A child is about 0.6 m across, so this is shoulder to shoulder with a little
 * air — close enough to look like a crowd squeezing through a gate, far enough
 * that nobody is inside anybody.
 */
const KID_PERSONAL_SPACE = 0.72;

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
  private readonly kids: readonly DisembarkingKid[];
  private readonly driver: DisembarkingKid;
  private readonly playerRoute: WalkRoute;
  private readonly kidRoutes: readonly WalkRoute[];
  private readonly kidWalks: readonly KidWalk[];
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

    // The driver rides at the wheel and never gets out.
    this.driver = createDisembarkingKid(CAT_BUS_SEAT_COUNT);
    this.driver.setWalkPhase(0, 0);
    this.bus.driverSeat.add(this.driver.root);

    // Eleven other children, one per seat that is not the player's, so every
    // one of the twelve seats has somebody on it.
    const free = this.bus.seats.filter((seat) => seat !== this.bus.passengerSeat);
    this.kids = free.slice(0, ARRIVAL_KID_COUNT).map((seat, index) => {
      const kid = createDisembarkingKid(index);
      kid.setWalkPhase(0, 0);
      seat.add(kid.root);
      return kid;
    });

    // Routes are derived from where the bus's own door actually is.
    const drop = busLocalToWorld(this.stopX, ENTRANCE_BUS_STOP_Z, this.bus.doorDrop.x, this.bus.doorDrop.z);
    const end = { x: ENTRANCE_PLAYER_X, z: ENTRANCE_PLAYER_Z };
    this.playerRoute = {
      from: drop,
      corner: { x: ENTRANCE_BUS_DOOR_X, z: ENTRANCE_GATE_Z },
      to: end,
    };

    // The others fan out through the same gate and spread across the park edge
    // ahead of her, so she walks in among a crowd rather than behind a queue.
    //
    // **Everything here is jittered from a fixed seed.** An even fan with an
    // even stagger is still a formation — it just marches diagonally instead of
    // abreast. The seed is fixed so the arrival is the same every time it is
    // watched, which matters when the family is giving notes on it.
    const rng = createRandom(ARRIVAL_SEED);
    const spread: WalkRoute[] = [];
    const walks: KidWalk[] = [];
    for (let index = 0; index < this.kids.length; index += 1) {
      const across = ARRIVAL_KID_COUNT <= 1 ? 0 : index / (ARRIVAL_KID_COUNT - 1) - 0.5;
      const wobble = (amount: number): number => (rng() - 0.5) * 2 * amount;

      const route: WalkRoute = {
        // Spread along the kerb and **towards the park**, never back towards
        // the bus: the drop point is already on the park side of the bodywork,
        // so a positive z jitter here walks them into the bus — which is
        // exactly what the "nobody walks through the parked bus" guard caught.
        from: { x: drop.x + across * 6.2 + wobble(0.5), z: drop.z - 0.2 - rng() * 1.4 },
        // Tight: this is the point they funnel through, and the opening is only
        // ~8.8 m wide. A fan wider than the gate walks them into the masonry
        // either side of it, which the wall guard duly caught.
        corner: { x: ENTRANCE_BUS_DOOR_X + across * 3.4 + wobble(0.5), z: ENTRANCE_GATE_Z },
        to: {
          x: end.x + across * 24 + wobble(2.2),
          z: end.z - 1.6 - rng() * 5.5 - Math.abs(across) * 1.4,
        },
      };
      spread.push(route);
      walks.push({
        // Queued at the door: a base wait by position in the queue, plus a
        // dawdle of its own, so two children never step down together.
        delay: index * KID_QUEUE_GAP + rng() * KID_DAWDLE,
        speed: KID_WALK_SPEED * (0.78 + rng() * 0.5),
        length:
          Math.hypot(route.corner.x - route.from.x, route.corner.z - route.from.z) +
          Math.hypot(route.to.x - route.corner.x, route.to.z - route.corner.z),
      });
    }
    this.kidRoutes = spread;
    this.kidWalks = walks;
  }

  /** The player, once `Game` has built her — via `World.attachPlayer`. */
  attachPlayer(player: Player): void {
    this.player = player;
    if (this.doneFlag) return;
    player.beginRide();
    this.poseSeated();
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
      case 'kids-off':
        this.kidsOff();
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
      for (let index = 0; index < this.kids.length; index += 1) this.advanceKid(index);
      this.pushApart();
    }

    this.bus.animate(dt, context.elapsed, this.busSpeed);

    if (this.phaseTime >= duration) {
      this.phaseTime = 0;
      this.phaseIndex += 1;
      if (this.phaseIndex >= PHASE_ORDER.length) this.finish();
    }
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

  /** The others hop down and set off, each in their own time. */
  private kidsOff(): void {
    this.busSpeed = 0;
    this.poseSeated();
  }

  /** Down the step onto the pavement, with a little hop. */
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

    player.ridePosture = 'walking';
    player.setScriptedWalk(1.1 * eased);
    this.playerFacing = turnTowards(
      this.playerFacing,
      Math.atan2(drop.x - seat.x, drop.z - seat.z),
      TURN_RATE * dt,
    );
    player.setRidePose(x, y, z, this.playerFacing);
  }

  /** Through the gate and into the park, the other children alongside. */
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

    player.ridePosture = 'walking';
    player.setScriptedWalk(Math.min(3.2, speed));
    if (dx !== 0 || dz !== 0) {
      this.playerFacing = turnTowards(this.playerFacing, Math.atan2(dx, dz), TURN_RATE * dt);
    }
    player.setRidePose(here.x, terrainHeight(here.x, here.z), here.z, this.playerFacing);
  }

  /**
   * The bus pulls away along the kerb — and she already has the controls.
   *
   * Handing over at the *start* of this phase is deliberate: a six-year-old
   * should be walking while the bus is still leaving, not made to watch it go.
   */
  private depart(t: number, dt: number): void {
    this.handOver();

    const previous = this.busX;
    if (t < 0.18) {
      this.bus.setDoorOpen(1 - smoothstep(0, 0.18, t));
      return;
    }
    this.bus.setDoorOpen(0);
    this.busX = lerp(this.stopX, ENTRANCE_BUS_VANISH_X, smoothstep(0.18, 1, t));
    this.placeBus(this.busX);
    this.busSpeed = Math.abs(this.busX - previous) / dt;
  }

  // --- helpers ------------------------------------------------------------

  private placeBus(x: number): void {
    this.bus.root.position.set(x, terrainHeight(x, ENTRANCE_BUS_STOP_Z), ENTRANCE_BUS_STOP_Z);
    this.bus.root.rotation.y = BUS_FACING;
  }

  /** Puts the player in her seat, wherever the bus currently is. */
  private poseSeated(): void {
    const player = this.player;
    if (!player) return;
    const seat = this.bus.passengerSeat.getWorldPosition(SCRATCH);
    player.ridePosture = 'seated';
    player.setRidePose(seat.x, seat.y, seat.z, BUS_FACING);
  }

  /**
   * **Children do not walk through each other.**
   *
   * Eleven of them funnel through an 8.8 m gate, so they bunch — that is what a
   * gate does and it looks right. What does not look right is two of them
   * occupying the same half metre, which is what the routes alone produced
   * (0.16 m at the worst frame, against a child about 0.6 m wide).
   *
   * Separation rather than hand-tuning eleven Bézier curves until they happen
   * never to cross: curves tuned to miss each other are eleven numbers that
   * must all stay true of one another for ever, and the park's own NPC crowd
   * already solved this with a push-apart. This is that, one relaxation pass a
   * frame, on the scripted walk.
   */
  private pushApart(): void {
    for (let i = 0; i < this.kids.length; i += 1) {
      const a = this.kids[i]?.root;
      if (!a || a.parent !== this.group) continue;
      for (let j = i + 1; j < this.kids.length; j += 1) {
        const b = this.kids[j]?.root;
        if (!b || b.parent !== this.group) continue;
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const gap = Math.hypot(dx, dz);
        if (gap >= KID_PERSONAL_SPACE || gap < 1e-4) continue;
        // Half the correction each, so neither is privileged by index order.
        const push = (KID_PERSONAL_SPACE - gap) / 2;
        const nx = dx / gap;
        const nz = dz / gap;
        a.position.x -= nx * push;
        a.position.z -= nz * push;
        b.position.x += nx * push;
        b.position.z += nz * push;
      }
    }
  }

  /**
   * Moves one child along their own route, by their own distance covered.
   *
   * Progress is `(their own elapsed time) x (their own speed) / (their own
   * route length)`, so no two are ever at the same point of the same curve on
   * the same frame — which is the whole of Jim's "they all move exactly in a
   * line".
   */
  private advanceKid(index: number): void {
    const walk = this.kidWalks[index];
    if (!walk) return;
    const moving = this.kidClock - walk.delay;
    if (moving <= 0) return;
    this.walkKid(index, (moving * walk.speed) / Math.max(0.5, walk.length));
  }

  /** Walks one child along its own route, `progress` 0..1 of the whole walk. */
  private walkKid(index: number, progress: number): void {
    const kid = this.kids[index];
    const route = this.kidRoutes[index];
    if (!kid || !route) return;

    // The moment a child starts walking they leave their seat and join the
    // world, so the group is re-parented once rather than having its seat
    // transform cancelled every frame.
    if (kid.root.parent !== this.group) this.group.add(kid.root);

    const t = clamp01(progress);
    const here = bezier(route.from, route.corner, route.to, t);
    const ahead = bezier(route.from, route.corner, route.to, Math.min(1, t + 0.05));
    const dx = ahead.x - here.x;
    const dz = ahead.z - here.z;

    kid.root.position.set(here.x, terrainHeight(here.x, here.z), here.z);
    if (dx !== 0 || dz !== 0) kid.root.rotation.y = Math.atan2(dx, dz);
    // Stride phase from distance covered, not from the clock, so the legs match
    // the ground however fast the route is being walked.
    const walked = Math.hypot(here.x - route.from.x, here.z - route.from.z);
    kid.setWalkPhase((walked * 0.62) % 1, t >= 1 ? 0 : 0.85);
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
    this.doneFlag = true;
    this.dispose();
  }

  dispose(): void {
    this.bus.dispose();
    this.bus.root.removeFromParent();
    for (const kid of this.kids) kid.dispose();
    this.driver.dispose();
    this.group.removeFromParent();
  }
}
