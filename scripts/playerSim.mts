/**
 * **One faithful copy of `Player.update`'s movement integration**, driving the
 * **real** `CollisionWorld` — not a model of one.
 *
 * It exists because two measurement scripts need the same walking girl:
 * `measure-hop-clearance.mts` (how tall a wall does the hop actually clear?)
 * and `measure-wall-tunnelling.mts` (can a long frame carry her through one?).
 * They used to be able to drift apart, and a measurement taken against a copy
 * that no longer matches the game is worse than no measurement at all — so
 * there is exactly **one** copy here, and it is the thing to re-check against
 * `Player.update` if that is ever restructured.
 *
 * The order below is `Player.update`'s order, and the order matters:
 * accelerate → step + `resolve` → escort latch → velocity read-back →
 * auto-hop lookahead → vertical integration → `hopClearance`.
 *
 * Uneven ground is **opt-in**: pass a `ground` sampler and the full vertical
 * half of `Player.update` runs too — the sub-stepped surface follow, the
 * fall-off-a-deck check, gravity, **the landing**, and the height damp. Pass
 * nothing and everything stands on y = 0 exactly as it always did, which is
 * what the two wall harnesses want and is byte-for-byte the old behaviour.
 *
 * ### Why the landing is not optional (#358, and a rig that got this wrong)
 *
 * A rig built for the bridge work drove the vertical loop but never simulated
 * the landing, and so **over-counted on descents**: going downhill the damped
 * height legitimately lags *above* the ground, the player goes briefly
 * airborne and lands again half a metre down the ramp, and that is normal and
 * harmless. Counting it as a fall reports failures on geometry that is fine —
 * its tell was spurious events sitting at exactly `FALL_THRESHOLD` on the
 * descending side. `step` below integrates all the way through the landing for
 * that reason, and callers should judge safety by whether she **kept the
 * surface** (see `lostSurface`), not by whether she ever left the ground.
 */
import { Vector3 } from 'three';
import type { CollisionWorld } from '../src/world/Collision.ts';
import { carryReference } from '../src/world/building/surfaces.ts';
import { STEP_DOWN_ASKED, STEP_SAMPLES, WEDGE_DEPTH, crackFloor, dropWedges, liftOutOfSqueeze, nearestFit, riseUnder, solidStepCeiling, standingHeight, walkingOntoStep, wedgeDepth } from '../src/world/standing.ts';
import { KID_HEIGHT } from '../src/art/models/kidHeight.ts';
import { damp } from '../src/core/mathUtils.ts';
import {
  BUILDING_STEP_UP,
  FALL_THRESHOLD,
  GRAVITY,
  JUMP_SPEED,
  PLAYER_ACCELERATION,
  PLAYER_DECELERATION,
  PLAYER_HEIGHT_DAMP_HALF_LIFE,
  PLAYER_MAX_SPEED,
  PLAYER_RADIUS,
  PLAYER_SPRINT_MULTIPLIER,
} from '../src/core/constants.ts';

/**
 * `Player`'s jump, from the one place it is written (`core/constants.ts`), and
 * the apex it gives — re-exported for the scripts that measured against them
 * here.
 */
export { JUMP_SPEED, GRAVITY };
export const JUMP_APEX_HEIGHT = (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY);
export const AUTO_HOP_LOOKAHEAD = 0.5;

/** `Player.ts`'s `approach`, verbatim. */
function approach(current: Vector3, target: Vector3, maxDelta: number): void {
  const dx = target.x - current.x;
  const dz = target.z - current.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= maxDelta || distance < 1e-6) {
    current.x = target.x;
    current.z = target.z;
    return;
  }
  const scale = maxDelta / distance;
  current.x += dx * scale;
  current.z += dz * scale;
}

/**
 * "Should a hop fire from here?", asked with the probe point `Player` would
 * have used. The default — never — is a player who only walks.
 *
 * A callback rather than a flag because the two scripts want different
 * answers. The tunnelling harness wants the real
 * `CollisionWorld.wouldAutoHopClear`; the hop-clearance harness deliberately
 * wants the same lookahead *geometry* with the height policy removed, because
 * that policy is the very thing it exists to measure and asking it would only
 * confirm it back to us.
 */
export type HopProbe = (probe: Vector3, feet: Vector3, feetAt?: (x: number, z: number) => number) => boolean;

/**
 * **The auto-hop `Player` has** — `CollisionWorld.wouldAutoHopClear`, judged
 * from her feet. What a measure that means "her" must hand the sim: the census
 * ran with no auto-hop at all, and so could not see her first step along a
 * wall's top throw her off it (PR #722's QA).
 */
export function playerHopProbe(collision: CollisionWorld): HopProbe {
  return (probe, feet, feetAt) => collision.wouldAutoHopClear(probe, PLAYER_RADIUS, JUMP_APEX_HEIGHT, feet, feetAt);
}

/**
 * `WalkSurfaces.sample`'s shape: the highest walkable surface at (x, z) that is
 * no more than one step above `y`. Pass the **real** one — the whole value of
 * this rig is that it asks the shipping sampler, not a model of it.
 */
export type GroundSampler = (x: number, z: number, y: number) => number;

export interface SimOptions {
  hopProbe?: HopProbe;
  radius?: number;
  /**
   * How many points along her front half the step-up asks (`walkingOntoStep`):
   * `Player`'s own number unless a check's control asks for the one point
   * past her front edge it used to be (`check:solids`' `single-step` proof).
   */
  stepSamples?: number;
  /**
   * Standing, her feet for the resolver are the surface she stands on
   * (`Player`'s own rule) — `false` hands it her drawn height instead, damping
   * up behind them, as it was before the foyer log's shuttle was fixed
   * (`check:solids`' `drawn-feet` proof).
   */
  feetOnGround?: boolean;
  /**
   * The step-up asks where a top is drawn, not the body she walks into, as it
   * did before seed 5's knee-high wall stopped her dead (`check:solids`'
   * `drawn-step` proof).
   */
  drawnStep?: boolean;
  /**
   * `false` turns off everything that keeps her out of a crack she does not
   * fit — the step-down hold, a walk that ends wedged refused, the crack
   * floor, the squeeze lift and the nearest fit — as it was before seed 5's
   * wall and bush blinked her back to where she started (`check:solids`'
   * `no-crack-rules` proof).
   */
  crackRules?: boolean;
  /**
   * Uneven ground. Omitted, everything stands on y = 0 and the vertical loop
   * is the flat-world one the wall harnesses have always used.
   */
  ground?: GroundSampler;
  /**
   * **The vertical control (#358).** `false` reproduces the single
   * end-of-frame ground sample `Player` used before this landed: one
   * `sample` call at the position the whole frame's movement ended at, asked
   * from her *damped* height. That is what let a long frame carry a sprinting
   * child straight through a deck she was walking up. Kept, and kept
   * exercised by `measure-deck-fallthrough.mts`, for the same reason
   * `substepping: false` is kept: a fix nobody can demonstrate the absence of
   * is a fix nobody can defend later.
   */
  groundSubstepping?: boolean;
  /**
   * **The other half of #358, controlled separately so the two can be told
   * apart.** `'damped'` asks the sampler from `position.y` — the smoothed
   * height she is *drawn* at, which lags 0.309x the climb behind her on a
   * steady ascent — which is what `Player` used to do. `'surface'` (the
   * default, and what ships) asks from `groundHeight`, the surface she is
   * actually standing on.
   *
   * Sub-stepping and the reference height are independent fixes and it is a
   * measurable question which of them mattered, so they are separate flags
   * rather than one "pre-fix" switch. Answering that from the code rather than
   * from a measurement is how the damp term went missing from the bridge
   * arithmetic in the first place.
   */
  groundReference?: 'surface' | 'damped';
  /**
   * **The control.** `false` reproduces the single-step integration `Player`
   * used before substepping landed — `position += velocity·dt`, then one
   * `resolve` — which is what let a stuttering frame carry her clean through a
   * wall. Kept, and kept exercised by `measure-wall-tunnelling.mts`, so the
   * bug can still be *shown* rather than only asserted against: a fix nobody
   * can demonstrate the absence of is a fix nobody can defend later.
   */
  substepping?: boolean;
}

export class SimPlayer {
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  readonly previousPosition = new Vector3();

  verticalVelocity = 0;
  airborne = false;
  /** Feet height above the ground, one frame stale — exactly as in `Player`. */
  hopClearance = 0;
  /** `Player`'s escort latch (PR #59): held until corrections stop entirely. */
  escorting = false;

  /** What the last step's `resolve` reported, for a caller that watches it. */
  clearedWall = false;
  corrected = false;
  /** True if the last step's correction was deep enough to count as an escort. */
  deepThisStep = false;
  /**
   * How much **further** the last step actually carried her than she asked to
   * go, in metres — the fling watch.
   *
   * Zero or negative every ordinary frame: being blocked is a constraint, so
   * it can only ever take distance away. Positive means something pushed her
   * along, and the only thing allowed to is a depenetration escort, which is
   * capped at `MAX_DEPENETRATION_SPEED · dt`. Anything above that cap is
   * design feedback #17's fling coming back.
   */
  lastOvershoot = 0;

  /**
   * The surface she is standing on — `Player.groundHeight`, the height the
   * sampler is asked from. Distinct from `position.y`, which is damped.
   */
  groundHeight = 0;
  /** Last frame's sampled ground under her feet. */
  groundY = 0;
  /** `Player`'s own: the highest her feet have been since she last stood on something. */
  private flightHighest = -Infinity;
  private readonly collision: CollisionWorld;
  private readonly hopProbe: HopProbe;
  private readonly stepSamples: number;
  private readonly feetOnGround: boolean;
  private readonly stepTop: ((x: number, z: number, ceiling: number) => number) | undefined;
  private readonly crackRules: boolean;
  readonly radius: number;
  private readonly substepping: boolean;
  private readonly ground: GroundSampler | null;
  private readonly groundSubstepping: boolean;
  private readonly groundReference: 'surface' | 'damped';

  private readonly moveDirection = new Vector3();
  private readonly desired = new Vector3();
  private readonly probe = new Vector3();
  private readonly feet = new Vector3();
  /** `Player`'s own: her feet at a plan point, reached on foot from {@link feet} — where the auto-hop judges a face from. */
  private readonly feetFromHop = (x: number, z: number): number =>
    this.sampleGround(x, z, carryReference(this.feet.x, this.feet.z, this.feet.y, x, z));

  constructor(collision: CollisionWorld, options: SimOptions = {}) {
    this.collision = collision;
    this.hopProbe = options.hopProbe ?? (() => false);
    this.radius = options.radius ?? PLAYER_RADIUS;
    this.substepping = options.substepping ?? true;
    this.ground = options.ground ?? null;
    this.groundSubstepping = options.groundSubstepping ?? true;
    this.groundReference = options.groundReference ?? 'surface';
    this.stepSamples = options.stepSamples ?? STEP_SAMPLES;
    this.feetOnGround = options.feetOnGround ?? true;
    this.stepTop = options.drawnStep ? (x, z, ceiling) => collision.highestTopAt(x, z, ceiling) : undefined;
    this.crackRules = options.crackRules ?? true;
  }

  /**
   * Stand her on the surface at (x, z), the way `Player.teleportTo` does —
   * position, sampling reference and damped height all collapsed onto the
   * ground together, so a run does not begin with a manufactured lag.
   */
  placeOnGround(x: number, z: number): void {
    const y = this.sampleGround(x, z, Infinity);
    this.position.set(x, y, z);
    this.previousPosition.copy(this.position);
    this.groundHeight = y;
    this.groundY = y;
    this.airborne = false;
    this.verticalVelocity = 0;
  }

  /**
   * One frame. `dirX`/`dirZ` are the stick, already in world space (the camera
   * basis is a rotation, so measuring against an axis-aligned wall loses
   * nothing); `sprint` is the button.
   */
  step(dt: number, dirX: number, dirZ: number, sprint: boolean): void {
    this.moveDirection.set(dirX, 0, dirZ);
    const inputLength = this.moveDirection.length();
    const speedLimit = PLAYER_MAX_SPEED * (sprint ? PLAYER_SPRINT_MULTIPLIER : 1);

    this.desired.set(0, 0, 0);
    if (inputLength > 1e-4) this.desired.copy(this.moveDirection).multiplyScalar(speedLimit);

    const rate = inputLength > 1e-4 ? PLAYER_ACCELERATION : PLAYER_DECELERATION;
    approach(this.velocity, this.desired, rate * dt);

    this.previousPosition.copy(this.position);
    const deltaX = this.velocity.x * dt;
    const deltaZ = this.velocity.z * dt;

    // `Player.update`'s ground sample, riding the same sub-steps. `following`
    // and `reference` mirror it name for name.
    // Airborne she follows no surface; on the damped reference there is no
    // surface height to carry, so in both cases the reference stays put and
    // only the last sub-step's answer is used.
    const damped = this.groundReference === 'damped';
    const following = !this.airborne && !damped;
    let reference = this.airborne || damped ? this.position.y : this.groundHeight;
    let groundY = reference;
    let fromX = this.position.x;
    let fromZ = this.position.z;
    const onStep = (at: Vector3): void => {
      // The damped control carries its reference too: it models the damp's
      // lag, not a world-y reach, and must not start counting the planet.
      if (!this.airborne) reference = carryReference(fromX, fromZ, reference, at.x, at.z);
      else {
        // `Player.update`'s flight, name for name: her own height travels
        // with her at her distance from the planet's centre.
        at.y = this.carryFlight(fromX, fromZ, at.y, at.x, at.z);
        reference = at.y;
      }
      fromX = at.x;
      fromZ = at.z;
      groundY = this.sampleGround(at.x, at.z, reference);
      if (following) reference = groundY;
    };
    // The flight's carry is motion, not sampling, so the pre-#358 control
    // (one ground sample a frame) keeps it too.
    const carryOnly = (at: Vector3): void => {
      if (this.airborne) at.y = this.carryFlight(fromX, fromZ, at.y, at.x, at.z);
      fromX = at.x;
      fromZ = at.z;
    };

    // `Player.update`'s step up onto a solid, name for name: only walking
    // *into* one (the point past her front edge), from the same reference.
    const stepping =
      following &&
      inputLength > 1e-4 &&
      walkingOntoStep(this.collision, this.position.x, this.position.z, dirX / inputLength, dirZ / inputLength, reference, this.stepSamples, this.stepTop);
    const stepCeiling = stepping
      ? (x: number, z: number): number => solidStepCeiling(this.collision, x, z, carryReference(fromX, fromZ, reference, x, z))
      : undefined;

    let result;
    if (this.substepping) {
      result = this.collision.resolveMovement(
        this.position,
        deltaX,
        deltaZ,
        this.radius,
        this.hopClearance,
        dt,
        this.groundSubstepping ? onStep : carryOnly,
        stepCeiling,
        KID_HEIGHT,
        // `Player`'s own: standing, her feet are the surface she stands on.
        following && this.feetOnGround ? Math.max(this.position.y, this.groundHeight) : undefined,
      );
    } else {
      // The whole frame in one move and one `resolve`: one sub-step of
      // `resolveMovement`, less its pinch guard. So the flight is carried the
      // way that sub-step's `carryOnly` carries it, once, from where the frame
      // began to where `resolve` left her. Carried before `resolve` as well,
      // the two paths asked `resolve` about different feet and parted by
      // 1e-13 m on frames where nothing touched her, which check:wall-
      // tunnelling's "ordinary movement is untouched" reads as a change.
      const startX = this.position.x;
      const startZ = this.position.z;
      this.position.x += deltaX;
      this.position.z += deltaZ;
      result = this.collision.resolve(this.position, this.radius, this.hopClearance, dt, stepCeiling, KID_HEIGHT);
      if (this.airborne) this.position.y = this.carryFlight(startX, startZ, this.position.y, this.position.x, this.position.z);
    }

    this.clearedWall = result.clearedWall;
    this.corrected = result.corrected;
    this.deepThisStep = result.escorting;
    this.lastOvershoot =
      Math.hypot(
        this.position.x - this.previousPosition.x,
        this.position.z - this.previousPosition.z,
      ) - Math.hypot(deltaX, deltaZ);
    this.escorting = result.corrected && (result.escorting || this.escorting);

    if (dt > 0 && !this.escorting) {
      const previousSpeed = Math.hypot(this.velocity.x, this.velocity.z);
      const derivedX = (this.position.x - this.previousPosition.x) / dt;
      const derivedZ = (this.position.z - this.previousPosition.z) / dt;
      if (Math.hypot(derivedX, derivedZ) <= previousSpeed) {
        this.velocity.x = derivedX;
        this.velocity.z = derivedZ;
      }
    }

    // `Player.update`'s order: walked off an edge, she starts falling before
    // the auto-hop is asked, so a step off a wall's top is a fall — never a
    // hop judged from the ground she is now over, fired from the top she has
    // just left. The census's walks along wall tops, the first to give this
    // rig a hop that can fire, found the difference: a bush beside the wall
    // nudged her off its top, and here alone she was thrown up from it
    // (seeds 9 and 12). The control path has not sampled the ground yet, so
    // for it this asks the frame's start, and the fall below still stands.
    groundY = this.fallIfOff(groundY);

    let autoHopWanted = false;
    if (!this.airborne && inputLength > 1e-4) {
      const inverse = 1 / inputLength;
      this.probe
        .copy(this.position)
        .addScaledVector(this.moveDirection, AUTO_HOP_LOOKAHEAD * inverse);
      // Her feet, as `Player` hands them to the probe: the auto-hop judges a
      // wall's height from where she stands (`CollisionWorld.hopsOver`).
      this.feet.set(this.position.x, groundY, this.position.z);
      autoHopWanted = this.hopProbe(this.probe, this.feet, this.feetFromHop);
    }
    let tookOff = false;
    if (autoHopWanted && !this.airborne) {
      this.verticalVelocity = JUMP_SPEED;
      this.airborne = true;
      tookOff = true;
    }

    // The pre-#358 vertical: one sample, at the end of the whole frame's
    // movement, asked from her damped height. This is the control. A frame
    // that began in the air asks from her own height, carried with her.
    if (!this.groundSubstepping || !this.substepping) {
      const { x, z } = this.position;
      const asked = !this.airborne
        ? carryReference(this.previousPosition.x, this.previousPosition.z, reference, x, z)
        : tookOff
          ? reference
          : this.position.y;
      groundY = this.sampleGround(x, z, asked);
    }
    this.groundY = groundY;
    // `Player.update`'s take-off, name for name: she leaves the ground from
    // the ground, never from the damped height lagging under it on a climb.
    if (tookOff && this.position.y < groundY) this.position.y = groundY;

    groundY = this.fallIfOff(groundY);

    let hopHeight = 0;
    if (this.airborne) {
      this.verticalVelocity -= GRAVITY * dt;
      const before = this.position.y;
      this.flightHighest = Math.max(this.flightHighest, before);
      this.verticalVelocity = riseUnder(this.collision, this.position, this.verticalVelocity, dt, KID_HEIGHT);
      // `Player`'s own: over a crack she does not fit, she comes down on what stands either side.
      if (this.verticalVelocity < 0 && this.crackRules) {
        const floor = crackFloor(this.collision, this.position.x, this.position.z, before, this.position.y, groundY);
        if (floor !== null && floor > groundY) groundY = floor;
        else {
          const lifted = liftOutOfSqueeze(this.collision, this.position, this.flightHighest);
          if (lifted !== null && lifted > groundY) groundY = lifted;
        }
      }
      // The landing. Its absence is what made the earlier rig over-count.
      if (this.position.y <= groundY) {
        this.position.y = groundY;
        this.verticalVelocity = 0;
        this.airborne = false;
      }
      hopHeight = this.position.y - groundY;
    } else {
      this.flightHighest = this.position.y;
      this.position.y = damp(this.position.y, groundY, PLAYER_HEIGHT_DAMP_HALF_LIFE, dt);
    }
    // `Player`'s own: squeezed after all of that, at the nearest place she fits.
    if (!this.crackRules) {
      // (the proof's girl: nothing keeps her out of a crack)
    } else if (this.airborne) nearestFit(this.collision, this.position, this.position.y);
    else if (nearestFit(this.collision, this.position, groundY, (x, z) => this.levelWith(x, z, groundY))) groundY = this.sampleGround(this.position.x, this.position.z, groundY);
    this.hopClearance = hopHeight;
    this.groundHeight = groundY;
  }

  /**
   * `Player.update`'s fall test, name for name: standing more than
   * `FALL_THRESHOLD` over the ground under her, she has walked off something
   * and starts falling. One test, asked twice a frame (see `step`).
   */
  /** `Player.levelWith`, name for name. */
  private levelWith(x: number, z: number, groundY: number): boolean {
    const there = this.sampleGround(x, z, groundY);
    return there >= groundY - STEP_DOWN_ASKED && there <= groundY + BUILDING_STEP_UP;
  }

  /** `Player.walksIntoWedge`, name for name. */
  private walksIntoWedge(groundY: number): boolean {
    if (this.position.x === this.previousPosition.x && this.position.z === this.previousPosition.z) return false;
    if (wedgeDepth(this.collision, this.position, groundY) <= WEDGE_DEPTH) return false;
    return wedgeDepth(this.collision, this.previousPosition, this.groundHeight) <= WEDGE_DEPTH;
  }

  private fallIfOff(groundY: number): number {
    // `Player`'s own: a step down into a crack she does not fit is not taken,
    // nor a walk that ends wedged where the frame began she was not.
    if (
      !this.airborne &&
      this.crackRules &&
      ((groundY < this.groundHeight - STEP_DOWN_ASKED && dropWedges(this.collision, this.position.x, this.position.z, groundY, this.groundHeight)) ||
        this.walksIntoWedge(groundY))
    ) {
      this.position.x = this.previousPosition.x;
      this.position.z = this.previousPosition.z;
      this.velocity.x = 0;
      this.velocity.z = 0;
      return this.groundHeight;
    }
    if (!this.airborne && this.position.y - groundY > FALL_THRESHOLD) {
      this.airborne = true;
      this.verticalVelocity = 0;
    }
    return groundY;
  }

  /**
   * Her height in flight, carried from one point to the next: `Player.update`'s
   * flight on the planet, name for name — `carryReference`, her distance from
   * the planet's centre kept. **The flat world (no `ground`) has no planet.**
   * Its ground and every top in it are level, so a height there carries
   * unchanged, as it always did. Carried over a curve that world does not
   * have, her flight sank about 9 cm per metre travelled outwards at 20 m from
   * the middle while the walls stayed put: hops came down inside walls they
   * would have cleared (check:wall-tunnelling's identity clause, walks 1-3 m
   * apart) and the auto-hop measured up to 5 cm short of the planet's.
   */
  private carryFlight(fromX: number, fromZ: number, y: number, toX: number, toZ: number): number {
    return this.ground ? carryReference(fromX, fromZ, y, toX, toZ) : y;
  }

  /**
   * Where her feet come to rest at a point: the caller's ground (or the flat
   * y = 0 world when there isn't one), or the top of a solid she is over,
   * whichever is higher and within a step — `world/standing.ts`'s
   * `standingHeight`, the very function `Player.groundAt` asks, so the rig
   * lands where she lands.
   *
   * Whether the answer is the *right* one is deliberately the harness's
   * question, not this class's: only the harness knows where it put the deck,
   * and comparing `groundY` against that ground truth is the one statement of
   * the failure that a legitimate descent cannot trip.
   */
  private sampleGround(x: number, z: number, expected: number): number {
    const ground = this.ground ? this.ground(x, z, expected) : 0;
    return standingHeight(ground, this.collision, x, z, expected);
  }
}
