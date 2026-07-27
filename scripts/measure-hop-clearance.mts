/**
 * **How tall a wall does the jump actually carry the player over?**
 *
 * This is where `Collision.ts`'s `MAX_AUTO_HOP_HEIGHT` and
 * `measuredHopCeiling()` come from. They are measurements, not algebra: run
 * this again if `JUMP_SPEED`, `GRAVITY`, `PLAYER_RADIUS`, `PLAYER_MAX_SPEED`,
 * `PLAYER_ACCELERATION`, `AUTO_HOP_LOOKAHEAD` or `JUMP_CLEARANCE_GRACE` moves —
 * `CollisionWorld.checkHoppableColliders` shouts at boot if the apex has moved
 * and nobody did.
 *
 * ```
 * node --experimental-strip-types \
 *      --import ./scripts/ts-extension-resolver-register.mjs \
 *      scripts/measure-hop-clearance.mts
 * ```
 *
 * It drives the **real** `CollisionWorld` — not a model of one — with a
 * faithful copy of `Player.update`'s movement integration, in the same order:
 * accelerate → step → `resolve` → escort latch → velocity read-back → auto-hop
 * lookahead → vertical integration → `hopClearance`. The copy is the one thing
 * here that can rot; if `Player.update` is restructured, re-check `attempt()`
 * against it.
 *
 * Three outcomes are distinguished, and the distinction is the whole point:
 * **clean** (flew the footprint untouched), **popped** (fell back inside the
 * footprint, the wall went solid under her and ejected her out the far side —
 * she gets across, but by glitch, and a route must never plan on one) and
 * **stuck** (never released at all: pinned against the face, landing and
 * auto-hopping forever). `MAX_AUTO_HOP_HEIGHT` is set from the *clean* column.
 */
import { Vector3 } from 'three';
import {
  CollisionWorld,
  MAX_AUTO_HOP_HEIGHT,
  MEASURED_HOP_APEX,
} from '../src/world/Collision.ts';
import {
  PLAYER_ACCELERATION,
  PLAYER_DECELERATION,
  PLAYER_MAX_SPEED,
  PLAYER_RADIUS,
} from '../src/core/constants.ts';

// Player's own numbers. Not imported: `Player.ts` pulls in three.js meshes and
// the DOM, neither of which exists here, and only `JUMP_APEX_HEIGHT` is
// exported anyway. `checkHoppableColliders` is what stops these drifting
// unnoticed — it compares the live apex against the one recorded in
// `Collision.ts` as having been measured.
const JUMP_SPEED = 6.6;
const GRAVITY = 17;
const JUMP_APEX_HEIGHT = (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY);
const AUTO_HOP_LOOKAHEAD = 0.5;
const SPRINT_MULTIPLIER = 1.5;

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

interface Options {
  topHeight: number;
  halfThickness: number;
  dt: number;
  sprint: boolean;
  phase: number;
  approachAngle: number;
}

type Outcome = 'clean' | 'popped' | 'stuck';

/** Walks a simulated player at one long wall lying along x at z = 0. */
function attempt(o: Options): Outcome {
  const collision = new CollisionWorld();
  collision.setPlayBounds(0, 0, 100000);
  collision.addWall(-5000, 0, 5000, 0, o.halfThickness, o.topHeight, true);

  const position = new Vector3(0, 0, -6);
  const velocity = new Vector3();
  const desired = new Vector3();
  const moveDirection = new Vector3();
  const hopProbe = new Vector3();
  const previousPosition = new Vector3();

  const angle = (o.approachAngle * Math.PI) / 180;
  const dirX = Math.sin(angle);
  const dirZ = Math.cos(angle);

  let verticalVelocity = 0;
  let airborne = false;
  let hopClearance = 0;
  let escorting = false;

  const face = o.halfThickness + PLAYER_RADIUS;
  const speedLimit = PLAYER_MAX_SPEED * (o.sprint ? SPRINT_MULTIPLIER : 1);
  /** Set if the wall ever pushed her while she was inside its footprint. */
  let shoved = false;

  let time = 0;
  let first = true;
  while (time < 20) {
    const dt = first ? o.dt * (1 - o.phase) : o.dt;
    first = false;
    time += dt;

    moveDirection.set(dirX, 0, dirZ);
    const inputLength = moveDirection.length();
    desired.copy(moveDirection).multiplyScalar(speedLimit);
    const rate = inputLength > 1e-4 ? PLAYER_ACCELERATION : PLAYER_DECELERATION;
    approach(velocity, desired, rate * dt);

    previousPosition.copy(position);
    position.x += velocity.x * dt;
    position.z += velocity.z * dt;
    const r = collision.resolve(position, PLAYER_RADIUS, hopClearance, dt);
    escorting = r.corrected && (r.escorting || escorting);
    // Inside the footprint (not merely resting against the near face) and
    // still being pushed: the wall went solid under her mid-flight.
    if (r.corrected && position.z > -face + 1e-6) shoved = true;

    if (dt > 0 && !escorting) {
      const previousSpeed = Math.hypot(velocity.x, velocity.z);
      const derivedX = (position.x - previousPosition.x) / dt;
      const derivedZ = (position.z - previousPosition.z) / dt;
      if (Math.hypot(derivedX, derivedZ) <= previousSpeed) {
        velocity.x = derivedX;
        velocity.z = derivedZ;
      }
    }

    // `CollisionWorld.wouldAutoHopClear` deliberately is *not* used here. It
    // consults `autoHopClears`, i.e. the very ceiling this script exists to
    // measure, so asking it would only confirm the policy back to us. The
    // probe below is the same lookahead geometry with the policy removed: fire
    // at the wall whatever its height, and find out where the flight fails.
    let autoHopWanted = false;
    if (!airborne && inputLength > 1e-4) {
      const inverse = 1 / inputLength;
      hopProbe.copy(position).addScaledVector(moveDirection, AUTO_HOP_LOOKAHEAD * inverse);
      autoHopWanted = Math.abs(hopProbe.z) < o.halfThickness + PLAYER_RADIUS;
    }
    if (autoHopWanted && !airborne) {
      verticalVelocity = JUMP_SPEED;
      airborne = true;
    }

    if (airborne) {
      verticalVelocity -= GRAVITY * dt;
      position.y += verticalVelocity * dt;
      if (position.y <= 0) {
        position.y = 0;
        verticalVelocity = 0;
        airborne = false;
      }
    }
    hopClearance = position.y;

    if (position.z > face + 0.05) return shoved ? 'popped' : 'clean';
  }
  return 'stuck';
}

/** Highest wall (to 1 mm) cleanly flown over under every timing phase swept. */
function highest(base: Omit<Options, 'topHeight' | 'phase'>, accept: Outcome[]): number {
  const phases = [0, 0.13, 0.29, 0.41, 0.57, 0.71, 0.89];
  const ok = (h: number): boolean =>
    phases.every((phase) => accept.includes(attempt({ ...base, topHeight: h, phase })));
  let lo = 0.05;
  let hi = 2.0;
  if (!ok(lo)) return NaN;
  if (ok(hi)) return hi;
  while (hi - lo > 0.001) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

console.log(`JUMP_APEX_HEIGHT (algebraic) = ${JUMP_APEX_HEIGHT.toFixed(4)} m`);
console.log(`Collision.ts believes it was measured at ${MEASURED_HOP_APEX.toFixed(4)} m`);
console.log(`Collision.ts currently permits topHeight <= ${MAX_AUTO_HOP_HEIGHT.toFixed(2)} m`);
console.log('The "clean" column below is what that number must stay under.');

for (const dt of [1 / 30, 1 / 60, 1 / 90, 1 / 120, 1 / 144]) {
  let v = JUMP_SPEED;
  let y = 0;
  let peak = 0;
  for (let i = 0; i < 400; i += 1) {
    v -= GRAVITY * dt;
    y += v * dt;
    peak = Math.max(peak, y);
    if (y <= 0) break;
  }
  console.log(`  discrete apex at ${Math.round(1 / dt)} fps: ${peak.toFixed(4)} m`);
}

console.log('\nhalf   fps  gait    angle   clean   clean-or-pop');
let worstClean = Infinity;
for (const halfThickness of [0.15, 0.22, 0.28, 0.34, 0.45, 0.6]) {
  for (const dt of [1 / 20, 1 / 30, 1 / 60, 1 / 90, 1 / 120]) {
    for (const sprint of [false, true]) {
      for (const approachAngle of [0, 20, 40]) {
        const base = { halfThickness, dt, sprint, approachAngle };
        const clean = highest(base, ['clean']);
        const either = highest(base, ['clean', 'popped']);
        if (halfThickness >= 0.2 && halfThickness <= 0.4) worstClean = Math.min(worstClean, clean);
        console.log(
          `${halfThickness.toFixed(2)}  ${String(Math.round(1 / dt)).padStart(3)}  ` +
            `${sprint ? 'sprint' : 'walk  '}  ${String(approachAngle).padStart(3)}     ` +
            `${clean.toFixed(3)}   ${either.toFixed(3)}`,
        );
      }
    }
  }
}
console.log(`\nWorst clean crossing over the park's own wall thicknesses: ${worstClean.toFixed(3)} m`);
