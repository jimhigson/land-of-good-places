/**
 * **Does tilting the phone point the view where the child means?**
 *
 * ```
 * npm run check:orientation
 * ```
 *
 * `core/deviceOrientationLook.ts` lets a six-year-old look around a first-person
 * ride by turning the phone. All of the risk in that feature is in one pure
 * function, {@link orientationToYawPitch}: four numbers off a sensor in, a yaw
 * and a pitch out. Everything around it — the listener, the permission dance,
 * the smoothing — either works or visibly does not. The maths can be subtly,
 * quietly wrong in a way nobody catches until a child says "it goes funny when
 * I hold it sideways", which is not a bug report anybody can act on.
 *
 * It cannot be tested in the browser without a phone in someone's hand, and it
 * needs no browser at all, so it is tested here.
 *
 * ## The independent reference
 *
 * The interesting assertions compare the function against a **second, separate
 * implementation** written straight from the W3C Device Orientation spec rather
 * than from the same three.js idiom — otherwise this would only prove the
 * function agrees with itself.
 *
 * The spec says the device frame is reached from the earth frame (x east, y
 * north, z up) by the intrinsic rotation `Rz(alpha)·Rx(beta)·Ry(gamma)`. A
 * phone's *back* — the face a child points at what she wants to see — is the
 * device's `-z`. So the true aim is `Rz(alpha)·Rx(beta)·Ry(gamma)·(0,0,-1)`,
 * built here from plain 3×3 matrix multiplication, and then put into three.js
 * axes (x east, y up, z south).
 *
 * ## The property that matters most
 *
 * A phone can be rolled about the axis you are looking along — held at forty
 * degrees, or in landscape with rotation lock on — and where it is *pointing*
 * does not change when you do that. An implementation that pulls an `YXZ` Euler
 * out of the device quaternion gets this badly wrong: rolling ninety degrees
 * moves the extracted yaw by ninety degrees. That was the first version of this
 * function, and this file is what caught it.
 *
 * `screenAngle` enters the maths as exactly such a roll, so the property is
 * cheap to state and impossible to fudge: **vary the screen angle, and the yaw
 * and pitch must not move at all.**
 */

import { orientationToYawPitch } from '../src/core/deviceOrientationLook.ts';

const DEG = Math.PI / 180;
const TO_DEG = 180 / Math.PI;

let failures = 0;
let checks = 0;

function fail(message: string): void {
  console.error(`FAIL: ${message}`);
  failures += 1;
}

function check(condition: boolean, message: string): void {
  checks += 1;
  if (!condition) fail(message);
}

function near(actual: number, expected: number, tolerance: number, message: string): void {
  checks += 1;
  if (!(Math.abs(actual - expected) <= tolerance)) {
    fail(`${message}: expected ${expected.toFixed(4)}, got ${actual.toFixed(4)}`);
  }
}

/** Shortest signed difference between two angles in degrees. */
function angleGap(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

// ---------------------------------------------------------------------------
// The independent reference: straight from the spec, no three.js.
// ---------------------------------------------------------------------------

type Matrix = readonly (readonly [number, number, number])[];

function multiply(a: Matrix, b: Matrix): Matrix {
  const out: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      let sum = 0;
      for (let k = 0; k < 3; k += 1) sum += a[i]![k]! * b[k]![j]!;
      out[i]![j] = sum;
    }
  }
  return out as Matrix;
}

function rotZ(t: number): Matrix {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [
    [c, -s, 0],
    [s, c, 0],
    [0, 0, 1],
  ];
}

function rotX(t: number): Matrix {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [
    [1, 0, 0],
    [0, c, -s],
    [0, s, c],
  ];
}

function rotY(t: number): Matrix {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [
    [c, 0, s],
    [0, 1, 0],
    [-s, 0, c],
  ];
}

/**
 * The true aim of the phone's back, as yaw/pitch in degrees in three.js's
 * frame. Built from the spec's own `Rz·Rx·Ry` and nothing else.
 */
function referenceAim(alpha: number, beta: number, gamma: number): { yaw: number; pitch: number } {
  const r = multiply(multiply(rotZ(alpha * DEG), rotX(beta * DEG)), rotY(gamma * DEG));
  // The device's -z, in the earth frame (east, north, up).
  const east = -r[0]![2]!;
  const north = -r[1]![2]!;
  const upward = -r[2]![2]!;
  // Into three.js axes: x east, y up, z south.
  const x = east;
  const y = upward;
  const z = -north;
  const horizontal = Math.hypot(x, z);
  return {
    yaw: Math.atan2(-x, -z) * TO_DEG,
    pitch: Math.atan2(y, horizontal) * TO_DEG,
  };
}

// ---------------------------------------------------------------------------
// 1. Poses a person can picture, checked by hand as well as by the reference.
// ---------------------------------------------------------------------------

console.log('Poses a child actually holds the phone in:');

const POSES: readonly {
  readonly name: string;
  readonly a: number;
  readonly b: number;
  readonly g: number;
  readonly yaw: number;
  readonly pitch: number;
}[] = [
  // Upright, screen towards her face, back towards the park: the default.
  { name: 'held up, looking ahead', a: 0, b: 90, g: 0, yaw: 0, pitch: 0 },
  // Flat in her lap, screen up: the back points at the floor.
  { name: 'flat in lap, screen up', a: 0, b: 0, g: 0, yaw: 0, pitch: -90 },
  // Held overhead, screen down, looking up through the glass roof.
  { name: 'overhead, screen down', a: 0, b: 180, g: 0, yaw: 0, pitch: 90 },
  // Tipped back and forwards from upright.
  { name: 'tipped back 30', a: 0, b: 120, g: 0, yaw: 0, pitch: 30 },
  { name: 'tipped down 30', a: 0, b: 60, g: 0, yaw: 0, pitch: -30 },
  // Turning on the spot.
  { name: 'turned 30 left', a: 30, b: 90, g: 0, yaw: 30, pitch: 0 },
  { name: 'turned 90 left', a: 90, b: 90, g: 0, yaw: 90, pitch: 0 },
  { name: 'turned 30 right', a: -30, b: 90, g: 0, yaw: -30, pitch: 0 },
];

for (const pose of POSES) {
  const got = orientationToYawPitch(pose.a, pose.b, pose.g, 0);
  const yaw = got.yaw * TO_DEG;
  const pitch = got.pitch * TO_DEG;
  console.log(
    `  ${pose.name.padEnd(26)} yaw ${yaw.toFixed(1).padStart(7)}  pitch ${pitch.toFixed(1).padStart(7)}`,
  );
  // Yaw is meaningless when pointed dead up or down, so only pitch is asserted
  // there — that is the whole point of the degenerate branch.
  if (Math.abs(pose.pitch) < 89.9) {
    near(angleGap(pose.yaw, yaw), 0, 1e-6, `${pose.name}: yaw`);
  }
  near(pitch, pose.pitch, 1e-6, `${pose.name}: pitch`);
}

// ---------------------------------------------------------------------------
// 2. Against the independent reference, over a dense sweep.
// ---------------------------------------------------------------------------

console.log('\nAgainst the spec-derived reference, over a sweep:');

let compared = 0;
let worstYaw = 0;
let worstPitch = 0;

for (let alpha = 0; alpha < 360; alpha += 23) {
  for (let beta = -180; beta <= 180; beta += 17) {
    for (let gamma = -90; gamma <= 90; gamma += 13) {
      const expected = referenceAim(alpha, beta, gamma);
      const got = orientationToYawPitch(alpha, beta, gamma, 0);
      const gotYaw = got.yaw * TO_DEG;
      const gotPitch = got.pitch * TO_DEG;

      if (!Number.isFinite(gotYaw) || !Number.isFinite(gotPitch)) {
        fail(`not finite at alpha=${alpha} beta=${beta} gamma=${gamma}`);
        continue;
      }

      worstPitch = Math.max(worstPitch, Math.abs(gotPitch - expected.pitch));
      // Near vertical the reference's own yaw is as meaningless as ours, so it
      // is compared only where there is a heading to compare.
      if (Math.abs(expected.pitch) < 89) {
        worstYaw = Math.max(worstYaw, Math.abs(angleGap(expected.yaw, gotYaw)));
      }
      compared += 1;
    }
  }
}

console.log(`  ${compared} orientations compared`);
console.log(`  worst yaw disagreement   ${worstYaw.toExponential(2)} deg`);
console.log(`  worst pitch disagreement ${worstPitch.toExponential(2)} deg`);
check(worstYaw < 1e-9, `yaw disagrees with the spec reference by ${worstYaw} deg`);
check(worstPitch < 1e-9, `pitch disagrees with the spec reference by ${worstPitch} deg`);

// ---------------------------------------------------------------------------
// 3. The property that caught the first implementation: rolling the phone about
//    the axis it is looking along must not move the aim.
// ---------------------------------------------------------------------------

console.log('\nRolling the phone must not move the aim:');

let worstRoll = 0;
let rollChecks = 0;

for (let alpha = 0; alpha < 360; alpha += 29) {
  for (let beta = -180; beta <= 180; beta += 21) {
    for (let gamma = -90; gamma <= 90; gamma += 19) {
      const base = orientationToYawPitch(alpha, beta, gamma, 0);
      // Dead up or down the heading legitimately depends on the roll — that is
      // the fallback doing its job — so those are excluded here and covered by
      // case 4 instead.
      if (Math.abs(base.pitch * TO_DEG) > 88) continue;
      const baseYaw = base.yaw * TO_DEG;
      const basePitch = base.pitch * TO_DEG;

      for (const screen of [90, 180, 270]) {
        const got = orientationToYawPitch(alpha, beta, gamma, screen);
        worstRoll = Math.max(
          worstRoll,
          Math.abs(angleGap(baseYaw, got.yaw * TO_DEG)),
          Math.abs(basePitch - got.pitch * TO_DEG),
        );
        rollChecks += 1;
      }
    }
  }
}

console.log(`  ${rollChecks} rolled orientations`);
console.log(`  worst movement ${worstRoll.toExponential(2)} deg`);
check(
  worstRoll < 1e-9,
  `rolling the phone moved the aim by ${worstRoll} deg — the YXZ-decomposition bug is back`,
);

// ---------------------------------------------------------------------------
// 4. Pointed dead up or dead down: still an answer, and a stable one.
// ---------------------------------------------------------------------------

console.log('\nPointed dead down and dead up:');

for (const [name, beta] of [
  ['dead down', 0],
  ['dead up', 180],
] as const) {
  for (const screen of [0, 90, 180, 270]) {
    const got = orientationToYawPitch(0, beta, 0, screen);
    check(
      Number.isFinite(got.yaw) && Number.isFinite(got.pitch),
      `${name} at screen ${screen} produced a non-finite angle`,
    );
    near(
      Math.abs(got.pitch * TO_DEG),
      90,
      1e-6,
      `${name} at screen ${screen}: pitch should be vertical`,
    );
  }
  console.log(`  ${name}: finite and vertical at every screen angle`);
}

// ---------------------------------------------------------------------------
// 5. Ranges, and no surprises anywhere in the space.
// ---------------------------------------------------------------------------

console.log('\nRanges over the whole input space:');

let minPitch = Infinity;
let maxPitch = -Infinity;
let minYaw = Infinity;
let maxYaw = -Infinity;

for (let alpha = 0; alpha < 360; alpha += 11) {
  for (let beta = -180; beta <= 180; beta += 9) {
    for (let gamma = -90; gamma <= 90; gamma += 7) {
      for (const screen of [0, 90, 180, 270]) {
        const got = orientationToYawPitch(alpha, beta, gamma, screen);
        if (!Number.isFinite(got.yaw) || !Number.isFinite(got.pitch)) {
          fail(`not finite at ${alpha}/${beta}/${gamma}/${screen}`);
          continue;
        }
        minPitch = Math.min(minPitch, got.pitch);
        maxPitch = Math.max(maxPitch, got.pitch);
        minYaw = Math.min(minYaw, got.yaw);
        maxYaw = Math.max(maxYaw, got.yaw);
      }
    }
  }
}

console.log(`  pitch ${(minPitch * TO_DEG).toFixed(2)} .. ${(maxPitch * TO_DEG).toFixed(2)} deg`);
console.log(`  yaw   ${(minYaw * TO_DEG).toFixed(2)} .. ${(maxYaw * TO_DEG).toFixed(2)} deg`);
check(minPitch >= -Math.PI / 2 - 1e-9, 'pitch went below straight down');
check(maxPitch <= Math.PI / 2 + 1e-9, 'pitch went above straight up');
check(minYaw >= -Math.PI - 1e-9, 'yaw went below -PI');
check(maxYaw <= Math.PI + 1e-9, 'yaw went above +PI');

// ---------------------------------------------------------------------------
// 6. Small movements of the phone make small movements of the view.
// ---------------------------------------------------------------------------
//
// A child moves the phone smoothly, and anywhere this function jumps she sees
// the park flick.
//
// Measured as the angle between the two **aim directions**, not as a distance
// in yaw and pitch, and that distinction is the whole subtlety here. Yaw is a
// spherical coordinate: approaching straight up or straight down it becomes
// arbitrarily sensitive, so that near the pole a quarter-degree of phone really
// does swing it several degrees. That is a property of longitude — it happens
// on any globe near the poles — and not a discontinuity in the aim. The aim
// itself moves smoothly the whole way through, which is what this asserts.
//
// The ride is protected from the sensitive region separately, and by design:
// `RideCamera` clamps pitch, and even the most generous of them (the ferris, at
// 80 degrees) stops short of vertical for exactly this reason.

console.log('\nContinuity under a small nudge:');

const STEP = 0.25;
let worstJump = 0;
let jumpAt = '';

/** A unit aim vector from a yaw/pitch pair, for comparing two of them. */
function aimVector(yaw: number, pitch: number): readonly [number, number, number] {
  const c = Math.cos(pitch);
  return [-c * Math.sin(yaw), Math.sin(pitch), -c * Math.cos(yaw)];
}

/** The angle between two aims, in degrees. */
function aimGap(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return Math.acos(dot) * TO_DEG;
}

for (let alpha = 0; alpha < 360; alpha += 13) {
  for (let beta = -180; beta <= 180; beta += 11) {
    for (let gamma = -90; gamma <= 90; gamma += 9) {
      const a = orientationToYawPitch(alpha, beta, gamma, 0);
      const b = orientationToYawPitch(alpha + STEP, beta + STEP, gamma + STEP, 0);
      const jump = aimGap(aimVector(a.yaw, a.pitch), aimVector(b.yaw, b.pitch));
      if (jump > worstJump) {
        worstJump = jump;
        jumpAt = `alpha=${alpha} beta=${beta} gamma=${gamma}`;
      }
    }
  }
}

console.log(`  worst aim move from a ${STEP} deg nudge: ${worstJump.toFixed(4)} deg (at ${jumpAt})`);
// Three axes nudged at once, so a little over 3x the step is the honest ceiling.
check(worstJump < 3.5 * STEP, `a ${STEP} deg nudge moved the aim ${worstJump.toFixed(2)} deg`);

// ---------------------------------------------------------------------------

console.log(
  failures === 0
    ? `\nPASS: ${checks} checks. Tilting the phone points the view where it should.`
    : `\n${failures} FAILURE(S) out of ${checks} checks`,
);
process.exit(failures === 0 ? 0 : 1);
