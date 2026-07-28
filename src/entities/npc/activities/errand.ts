import type { CharacterIntent, DriverContext } from '../driver';
import type { ActivityHost } from './activity';

/**
 * Walking somewhere that is not on the waypoint graph — with the safety rails
 * built in, because the one place they were left out cost us a P1 bug.
 *
 * Most of what a child does is walk a validated waypoint edge: `poiGraph`
 * checks every edge against the finished collision world at build time, so
 * walking one cannot wedge. Activities are the exception. A station platform,
 * a face-painting stall and the player himself are all *points*, not nodes,
 * and getting to them means steering straight at them through whatever the
 * scenery has put in the way.
 *
 * The train block asked the two questions that steering has to answer — "what
 * if I get wedged?" and "what if I never arrive?" — and answered them with a
 * stuck-sidestep and a timeout. The face-paint block was copy-adapted from it
 * and dropped both, so a child wedged behind a bush pushed at it for the rest
 * of the session while holding one of the four face-paint slots for ever
 * (ARCHITECTURE-REVIEW, review 2, C1).
 *
 * Hence: {@link ErrandLimits} has no optional fields. You cannot start an
 * errand without saying what happens when it goes wrong.
 */
export class Errand {
  private elapsed = 0;
  private lastX = 0;
  private lastZ = 0;
  private stuckTimer = 0;
  private sidestep = 0;

  /** Set by {@link step}, so callers that need the bearing (to look at what
   *  they are walking towards) can read it without recomputing or allocating. */
  private dxValue = 0;
  private dzValue = 0;
  private distanceValue = 0;

  private readonly limits: ErrandLimits;

  constructor(limits: ErrandLimits) {
    this.limits = limits;
  }

  /** Call when the walk starts, before the first {@link step}. */
  begin(context: DriverContext): void {
    this.elapsed = 0;
    this.markProgress(context);
  }

  /**
   * Forgets which way round the scenery was working.
   *
   * Deliberately *not* part of {@link begin}: the sidestep is a running
   * estimate of how this child is getting past whatever is in front of them,
   * and it survives from one errand to the next until the stuck check
   * re-evaluates it a couple of seconds in. That is what the train block did
   * before this class existed, and this is a refactor.
   */
  clearSidestep(): void {
    this.sidestep = 0;
  }

  /** Vector to the target as of the last {@link step}. */
  get dx(): number {
    return this.dxValue;
  }
  get dz(): number {
    return this.dzValue;
  }
  get distance(): number {
    return this.distanceValue;
  }

  /**
   * One frame of walking. Fills in `intent.moveX`/`moveZ` while still walking
   * and leaves them alone otherwise, so an `'arrived'` or `'givenUp'` frame is
   * a frame the caller is free to do something else with.
   */
  step(
    host: ActivityHost,
    context: DriverContext,
    intent: CharacterIntent,
    targetX: number,
    targetZ: number,
  ): ErrandStep {
    this.elapsed += context.dt;
    if (this.elapsed > this.limits.timeout) return 'givenUp';

    const dx = targetX - context.position.x;
    const dz = targetZ - context.position.z;
    const distance = Math.hypot(dx, dz);
    this.dxValue = dx;
    this.dzValue = dz;
    this.distanceValue = distance;

    if (distance > this.limits.abandonRadius) return 'givenUp';
    if (distance <= this.limits.arriveRadius) return 'arrived';

    if (this.limits.unstick) this.updateUnstick(host, context);

    const scale = host.pace / distance;
    // Perpendicular in the ground plane, which for a heading (dx, dz) is
    // (dz, -dx) — no need to normalise, the scale is shared.
    intent.moveX = (dx + dz * this.sidestep * SIDESTEP_WEIGHT) * scale;
    intent.moveZ = (dz - dx * this.sidestep * SIDESTEP_WEIGHT) * scale;
    return 'walking';
  }

  /**
   * Collision resolution slides a child around most things, but one that has
   * not moved for a few seconds is wedged, and a couple of metres of sideways
   * gets them past it.
   */
  private updateUnstick(host: ActivityHost, context: DriverContext): void {
    this.stuckTimer += context.dt;
    if (this.stuckTimer <= STUCK_WINDOW) return;

    const moved = Math.hypot(context.position.x - this.lastX, context.position.z - this.lastZ);
    this.sidestep = moved < STUCK_DISTANCE ? (host.rng.chance(0.5) ? 1 : -1) : 0;
    this.markProgress(context);
  }

  private markProgress(context: DriverContext): void {
    this.lastX = context.position.x;
    this.lastZ = context.position.z;
    this.stuckTimer = 0;
  }
}

/** What one frame of an {@link Errand} came to. */
export type ErrandStep = 'walking' | 'arrived' | 'givenUp';

/**
 * The four questions a walk off the waypoint graph has to answer. All four are
 * required on purpose — see the class comment above.
 */
export interface ErrandLimits {
  /** How close counts as having arrived. */
  readonly arriveRadius: number;
  /** Seconds before the walk is given up. {@link NO_TIMEOUT} to never — which
   *  is a bug in every case we have seen so far, so say why in a comment. */
  readonly timeout: number;
  /** Give up if the target ends up further away than this (a player who walked
   *  off). {@link NO_LIMIT} for a target that cannot move. */
  readonly abandonRadius: number;
  /** Sidestep when wedged. Wanted by any walk long enough to meet scenery. */
  readonly unstick: boolean;
}

/** A walk that is never given up on. Only correct if something else can end it. */
export const NO_TIMEOUT = Number.POSITIVE_INFINITY;

/** A target that cannot get away. */
export const NO_LIMIT = Number.POSITIVE_INFINITY;

/**
 * "And if this never happens?", in a form you cannot forget to answer.
 *
 * The walking half of that question is {@link Errand}; this is the standing-
 * around half — waiting on a platform for a train that never comes, and
 * (Decision 2) holding a place in a queue that never moves.
 */
export class Backstop {
  private elapsed = 0;

  private readonly seconds: number;

  constructor(seconds: number) {
    this.seconds = seconds;
  }

  restart(): void {
    this.elapsed = 0;
  }

  /** Ticks, and returns `true` once the time is up. */
  expired(dt: number): boolean {
    this.elapsed += dt;
    return this.elapsed > this.seconds;
  }
}

/** Moving less than this in this long means something is in the way. */
const STUCK_WINDOW = 2.5;
const STUCK_DISTANCE = 0.8;

/** How hard a sidestep leans off the direct heading. */
const SIDESTEP_WEIGHT = 0.9;
