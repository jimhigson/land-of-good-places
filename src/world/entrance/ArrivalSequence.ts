import { Group, Vector3 } from 'three';
import { clamp01, lerp, smoothstep, turnTowards } from '../../core/mathUtils';
import { terrainHeight } from '../terrain';
import type { FrameContext } from '../../core/types';
import type { Player } from '../../entities/Player';
import { createCatBus, type CatBusHandle } from './catBus';
import { createDisembarkingKid, type DisembarkingKid } from './disembarkingKids';
import { playBrakeSqueak, playDoorHiss, playHornToot } from './sounds';
import { hasArrivedBefore, markArrived } from './arrivalFlag';
import {
  ENTRANCE_ANGLE,
  ENTRANCE_BUS_ARRIVE_Z,
  ENTRANCE_BUS_STOP_X,
  ENTRANCE_BUS_STOP_Z,
  ENTRANCE_BUS_VANISH_Z,
  ENTRANCE_PLAYER_X,
  ENTRANCE_PLAYER_Z,
} from './layout';

/**
 * **The cat bus arrival — the scripted timeline.**
 *
 * The bus, the children, the sounds and the waypoints all shipped in PR #27 on
 * 26 July 2026 and none of them ever ran: that PR added six files under
 * `world/entrance/` and wired **none** of them, so `Entrance` was never
 * constructed, `createCatBus` had no callers, and the string `cat-bus` did not
 * appear in the shipped bundle at all. What was missing was never a bug in the
 * art — it was this file. Nobody had written the choreography.
 *
 * ## Why it hangs off `World` and not off `Game`
 *
 * `Game` cannot be built in a test: it constructs `Engine`, which is a real
 * `WebGLRenderer`. `World` **can** — `scripts/park-harness.mts` builds a real
 * `Scene` and a real `World` in Node, and `test/procgen/parkFacts.ts` already
 * traverses the result. So a cat bus owned by `World` is visible to the
 * invariant suite that CI blocks the merge on, and a cat bus owned by `Game`
 * would be visible to nothing whatsoever.
 *
 * That is not a tidiness argument. The original feature went twelve days
 * undetected precisely because nothing could see it, and hanging the fix off
 * `Game` would have rebuilt that blind spot around the repair.
 *
 * ## When it runs
 *
 * Whenever the player has not already arrived — see {@link arrivalIsDue}. That
 * is the same thing as "every time a new game is started", because `main.ts`'s
 * `startFresh` calls `clearSave()` and a cleared save has `arrivedByBus` false.
 * The flag is **the** mechanism rather than a second guard beside a "was this a
 * new game?" boolean, and the default is deliberately the arrival *happening*:
 * a caller who forgets to pass anything gets the sequence, and only an explicit
 * opt-out suppresses it. Forgetting then fails loud instead of failing silent,
 * which is the exact direction the original bug failed in.
 *
 * `markArrived()` fires when she is handed the controls, not before, so quitting
 * halfway through replays it — she never finished arriving.
 *
 * ## Where Stage B attaches
 *
 * The animated journey down the lane (issue #245 part 1) ends exactly where
 * this begins: bus at {@link ENTRANCE_BUS_ARRIVE_Z}, outside the gate, facing
 * in, door shut, player aboard. That is the `'rolling-in'` phase's first frame.
 * {@link ArrivalSequence} therefore accepts an **already-built bus** so the
 * journey's own bus can be handed straight over at an identical pose, rather
 * than a second one being created and popping into place at the seam.
 */

/** How long each phase lasts, in seconds. Exported so a check can drive it. */
export const ARRIVAL_TIMELINE = {
  /** Rolling in through the gate to the stop. */
  rollingIn: 3.0,
  /** The door swinging open. */
  doorsOpening: 0.8,
  /** The other children hopping down and setting off. */
  kidsOff: 1.8,
  /** The player stepping down onto the curb. */
  steppingDown: 1.2,
  /** Walking in, round the front of the bus and into the park. */
  walkingIn: 2.4,
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
 * Is the arrival due for this player?
 *
 * One question, asked in one place, so `World` and any check agree about it.
 */
export function arrivalIsDue(): boolean {
  return !hasArrivedBefore();
}

/**
 * Which way the bus points, as a `rotation.y`.
 *
 * It drives **inward** — nose first through the gate, so the first thing anyone
 * ever sees of this game is a cat's face coming towards them rather than a bus
 * reversing. A Three.js object at `rotation.y = t` sends its local +Z to world
 * `(sin t, cos t)`, and we want that to be the inward radial direction, hence
 * the `atan2` rather than a hand-written `Math.PI`: the gate is fixed at
 * `ENTRANCE_ANGLE` today (Decision 5), but nothing here has to be revisited if
 * it ever is not.
 */
const INWARD_X = -Math.cos(ENTRANCE_ANGLE);
const INWARD_Z = -Math.sin(ENTRANCE_ANGLE);
const BUS_FACING = Math.atan2(INWARD_X, INWARD_Z);

/** A point in the bus's own local space, in world space, for a bus at `(bx, bz)`. */
function busLocalToWorld(bx: number, bz: number, lx: number, lz: number): { x: number; z: number } {
  const cos = Math.cos(BUS_FACING);
  const sin = Math.sin(BUS_FACING);
  return { x: bx + lx * cos + lz * sin, z: bz - lx * sin + lz * cos };
}

/**
 * A quadratic Bézier — the walk off the curb, round the bus's nose, into the
 * park.
 *
 * A rounded corner rather than two straight legs, and it matters: the drop-off
 * is on the **curb side** (`Entrance.ts` puts the shelter there and says the
 * door opens onto it), while the place gameplay starts is on the other side of
 * the bus. Walking that as a hard right-angle looks like a bug; the control
 * point pulls the turn out in front of the bus's nose, which is both prettier
 * and what keeps everyone clear of the bodywork.
 */
function bezier(a: Vector2Like, c: Vector2Like, b: Vector2Like, t: number): { x: number; z: number } {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    z: u * u * a.z + 2 * u * t * c.z + t * t * b.z,
  };
}

interface Vector2Like {
  readonly x: number;
  readonly z: number;
}

/** Reused rather than allocated every frame — `getWorldPosition` needs a target. */
const SCRATCH = new Vector3();

/** How fast anyone in this sequence turns to face where they are going, rad/s. */
const TURN_RATE = 7;

/** One walker's route off the bus and into the park. */
interface WalkRoute {
  readonly from: Vector2Like;
  readonly corner: Vector2Like;
  readonly to: Vector2Like;
}

export interface ArrivalOptions {
  /**
   * A bus that already exists — Stage B's journey handing its own bus over at
   * the gate. Omitted, one is built here, parked outside the gate.
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

  private player: Player | null = null;
  private phaseIndex = 0;
  private phaseTime = 0;
  private busZ = ENTRANCE_BUS_ARRIVE_Z;
  private busSpeed = 0;
  private doneFlag = false;
  private handedOver = false;
  private tootedHorn = false;
  private squeaked = false;
  private hissed = false;
  /** Facing, carried across frames so turns are smoothed rather than snapped. */
  private playerFacing = BUS_FACING;

  constructor(options: ArrivalOptions = {}) {
    this.group.name = 'cat-bus-arrival';

    this.bus = options.bus ?? createCatBus();
    this.group.add(this.bus.root);
    this.bus.setDoorOpen(0);
    this.placeBus(ENTRANCE_BUS_ARRIVE_Z);

    // The driver rides in the cabin, so she moves with the bus for free. She
    // never gets out — somebody has to drive it away again.
    this.driver = createDisembarkingKid(2);
    this.driver.setWalkPhase(0, 0);
    this.bus.driverSeat.add(this.driver.root);

    // Two other children, aboard until the door opens.
    this.kids = [createDisembarkingKid(0), createDisembarkingKid(1)];
    for (const kid of this.kids) {
      kid.root.visible = false;
      this.group.add(kid.root);
    }

    // Every route is derived from where the bus's own door actually is (see
    // `CatBusHandle.doorDrop`) rather than from a second copy of the bus's
    // dimensions kept in step by hand.
    const drop = busLocalToWorld(
      ENTRANCE_BUS_STOP_X,
      ENTRANCE_BUS_STOP_Z,
      this.bus.doorDrop.x,
      this.bus.doorDrop.z,
    );
    const end = { x: ENTRANCE_PLAYER_X, z: ENTRANCE_PLAYER_Z };
    this.playerRoute = { from: drop, corner: { x: drop.x, z: end.z }, to: end };
    this.kidRoutes = [
      {
        from: { x: drop.x + 0.55, z: drop.z + 0.36 },
        corner: { x: drop.x + 0.55, z: end.z - 0.7 },
        to: { x: end.x + 2.1, z: end.z - 1.2 },
      },
      {
        from: { x: drop.x + 0.55, z: drop.z - 0.34 },
        corner: { x: drop.x + 0.65, z: end.z - 0.4 },
        to: { x: end.x - 1.7, z: end.z - 0.7 },
      },
    ];
  }

  /**
   * The player, once `Game` has built her — same shape as every other
   * `World.attachPlayer` consumer.
   *
   * She is put aboard immediately: the sequence starts with the bus already
   * outside the gate with her in it, so there is never a frame where she is
   * standing in the park watching her own bus arrive.
   */
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
    // Paused (the pause menu, `/view`'s frozen clock) hands `dt` of zero, so
    // the timeline stops on its own and needs no pause flag of its own.
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
        this.kidsOff(t);
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

    this.bus.animate(dt, context.elapsed, this.busSpeed);

    if (this.phaseTime >= duration) {
      this.phaseTime = 0;
      this.phaseIndex += 1;
      if (this.phaseIndex >= PHASE_ORDER.length) this.finish();
    }
  }

  // --- the phases ---------------------------------------------------------

  /**
   * Through the gate and up to the stop, decelerating into it.
   *
   * `smoothstep` rather than a linear run so the bus eases to a halt instead of
   * stopping dead — and the speed handed to `catBus.animate` is the **measured**
   * one (how far it actually moved this frame, over `dt`), so the wheel spin and
   * the tail swish cannot disagree with the motion on screen.
   */
  private rollIn(t: number, dt: number): void {
    const previous = this.busZ;
    const eased = smoothstep(0, 1, t);
    this.busZ = lerp(ENTRANCE_BUS_ARRIVE_Z, ENTRANCE_BUS_STOP_Z, eased);
    this.placeBus(this.busZ);
    this.busSpeed = Math.abs(this.busZ - previous) / dt;

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

  /** The other two hop down and set off, the second a beat behind the first. */
  private kidsOff(t: number): void {
    this.busSpeed = 0;
    this.kids.forEach((kid, index) => {
      const start = index * 0.34;
      const local = clamp01((t - start) / Math.max(0.01, 1 - start));
      if (local <= 0) return;
      kid.root.visible = true;
      // A short hop down from the step onto the curb, then the first strides of
      // the walk in — this phase and the next two share one clock for the kids,
      // so they keep moving while the player is still getting off.
      this.walkKid(index, local * 0.34);
    });
    this.poseSeated();
  }

  /** Down the step onto the curb, with a little hop. */
  private stepDown(t: number, dt: number): void {
    this.busSpeed = 0;
    for (let index = 0; index < this.kids.length; index += 1) {
      this.walkKid(index, 0.34 + t * 0.3);
    }

    const player = this.player;
    if (!player) return;
    const seat = this.bus.passengerSeat.getWorldPosition(SCRATCH);
    const drop = this.playerRoute.from;
    const eased = smoothstep(0, 1, t);
    const x = lerp(seat.x, drop.x, eased);
    const z = lerp(seat.z, drop.z, eased);
    const ground = terrainHeight(x, z);
    // A shallow arc, so she hops down rather than sliding out at seat height.
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

  /** Round the nose of the bus and into the park, the children alongside. */
  private walkIn(t: number, dt: number): void {
    this.busSpeed = 0;
    for (let index = 0; index < this.kids.length; index += 1) {
      this.walkKid(index, 0.64 + t * 0.36);
    }

    const player = this.player;
    if (!player) return;
    const eased = smoothstep(0, 1, t);
    const here = bezier(this.playerRoute.from, this.playerRoute.corner, this.playerRoute.to, eased);
    // Sampled a little ahead on her own curve rather than differentiated: the
    // direction she is *going* is what she should be facing, and one extra
    // evaluation is cheaper and steadier than a derivative near the ends.
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
   * The bus pulls away back out of the gate — and she already has the controls.
   *
   * Handing over at the *start* of this phase rather than the end is deliberate:
   * a six-year-old should be walking while the bus is still leaving, not made to
   * watch it go. The rest of the sequence finishes around her.
   */
  private depart(t: number, dt: number): void {
    this.handOver();
    for (let index = 0; index < this.kids.length; index += 1) {
      this.walkKid(index, 1);
    }

    const previous = this.busZ;
    if (t < 0.18) {
      this.bus.setDoorOpen(1 - smoothstep(0, 0.18, t));
      return;
    }
    const away = smoothstep(0.18, 1, t);
    this.bus.setDoorOpen(0);
    this.busZ = lerp(ENTRANCE_BUS_STOP_Z, ENTRANCE_BUS_VANISH_Z, away);
    this.placeBus(this.busZ);
    this.busSpeed = Math.abs(this.busZ - previous) / dt;
  }

  // --- helpers ------------------------------------------------------------

  private placeBus(z: number): void {
    this.bus.root.position.set(ENTRANCE_BUS_STOP_X, terrainHeight(ENTRANCE_BUS_STOP_X, z), z);
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

  /** Walks one child along its own route, `progress` 0..1 of the whole walk. */
  private walkKid(index: number, progress: number): void {
    const kid = this.kids[index];
    const route = this.kidRoutes[index];
    if (!kid || !route) return;
    kid.root.visible = true;

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
   * and marks her airborne, and `teleportTo` is what puts her feet on the ground
   * with the momentum cleared. The other way round she drops the last few
   * centimetres onto the grass the instant she is given the controls.
   *
   * She lands on `ENTRANCE_PLAYER_X/Z` — the same point `check:park` measures
   * "every attraction routes from the entrance" from, and the same point
   * `Game.DEFAULT_SPAWN` now uses, so all three agree by construction.
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
