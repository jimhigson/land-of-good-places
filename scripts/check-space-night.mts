/**
 * **Is space really just more night — and where isn't it?**
 *
 * ```
 * npm run check:space-night
 * ```
 *
 * `DayNight.setSpaceFactor` takes the park's own sky past the far end of night
 * and into space, by blending one extra keyframe in at the single seam where
 * the whole look is decided. That is a small change with a wide blast radius:
 * one number moves the sky gradient, the star field, all four lights, the fog,
 * and — through `nightFactor` — every lamp post, fairy light, firefly and
 * fountain glow in the park.
 *
 * Three things are worth proving without a browser.
 *
 * ## 1. The park is untouched when nobody is climbing
 *
 * The override has to be genuinely inert at zero, and inert *again* after a
 * ride, or the park quietly changes for everyone who never went near the ferris
 * wheel. So the whole look is captured at zero, driven to one and back, and
 * compared exactly.
 *
 * ## 2. Fog moves the opposite way, and only fog
 *
 * This is the place the "space is just more night" idea breaks. Night pulls fog
 * *in* on purpose, so distance falls away into the dark. A climb needs it
 * pushed *out*, or the park is swallowed at fifty metres exactly when it
 * becomes worth looking down at. Two nights are kept apart in the code for this
 * one reason, and if they are ever collapsed back together this fails.
 *
 * ## 3. The clock is not a casualty
 *
 * A look override that moved the park clock would put the ride in the save. The
 * time of day must come out of a trip to space exactly as it went in.
 */

import { Fog, Scene, Vector3 } from 'three';
import { DayNight, Sky } from '../src/world/index.ts';
import { PALETTE } from '../src/core/palette.ts';
import { FOG_FAR, FOG_NEAR } from '../src/core/constants.ts';
import type { FrameContext } from '../src/core/types.ts';

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
    fail(`${message}: expected ${expected.toFixed(6)}, got ${actual.toFixed(6)}`);
  }
}

const scene = new Scene();
scene.fog = new Fog(PALETTE.skyDayBottom, FOG_NEAR, FOG_FAR);
const sky = new Sky();
sky.setAspect(16 / 9);
const dayNight = new DayNight(scene, sky);

/** Enough of a frame for `DayNight`; it reads dt, elapsed and the player only. */
const FRAME = {
  dt: 0,
  elapsed: 0,
  frame: 0,
  playerPosition: new Vector3(0, 0, 0),
  cameraForward: new Vector3(0, 0, 1),
} as unknown as FrameContext;

/** Everything one frame of `DayNight` decides, flattened for comparison. */
function look(): Record<string, number> {
  const fog = scene.fog as Fog;
  const u = sky.uniforms;
  const hex = (name: string): number => (u[name] as { value: { getHex(): number } }).value.getHex();
  const num = (name: string): number => (u[name] as { value: number }).value;
  return {
    top: hex('uTopColour'),
    bottom: hex('uBottomColour'),
    horizon: hex('uHorizonColour'),
    horizonStrength: num('uHorizonStrength'),
    stars: num('uStarStrength'),
    sunVisible: num('uSunVisible'),
    moonVisible: num('uMoonVisible'),
    keyIntensity: dayNight.keyLight.intensity,
    moonIntensity: dayNight.moonLight.intensity,
    fillIntensity: dayNight.fillLight.intensity,
    ambientIntensity: dayNight.ambientLight.intensity,
    ambientSky: dayNight.ambientLight.color.getHex(),
    ambientGround: dayNight.ambientLight.groundColor.getHex(),
    fogColour: fog.color.getHex(),
    fogNear: fog.near,
    fogFar: fog.far,
    nightFactor: dayNight.nightFactor,
  };
}

/** Sets the clock and the climb, then runs one frame. */
function frameAt(hour: number, space: number): Record<string, number> {
  dayNight.setTimeOfDay(hour / 24);
  dayNight.setSpaceFactor(space);
  dayNight.update(FRAME);
  return look();
}

const NOON = 12;
const MIDNIGHT = 0;
const AFTERNOON = 15;

// --- 1. inert at zero, and inert again afterwards ---------------------------
console.log('the park is untouched when nobody is climbing');
for (const hour of [0, 3, 6, 9, 12, 15, 18, 21]) {
  const before = frameAt(hour, 0);
  // All the way up and all the way back down again.
  frameAt(hour, 0.5);
  frameAt(hour, 1);
  frameAt(hour, 0.25);
  const after = frameAt(hour, 0);
  for (const key of Object.keys(before)) {
    near(
      after[key] as number,
      before[key] as number,
      0,
      `${key} at ${hour}:00 did not come back after a trip to space`,
    );
  }
}

// --- 2. space really is the far end of night --------------------------------
console.log('at full climb the sky is flat space indigo, whatever the clock says');
for (const hour of [MIDNIGHT, NOON, AFTERNOON]) {
  const inSpace = frameAt(hour, 1);
  near(inSpace.top as number, PALETTE.skyNightTop, 0, `space sky top at ${hour}:00`);
  near(inSpace.bottom as number, PALETTE.skyNightTop, 0, `space sky bottom at ${hour}:00`);
  near(inSpace.horizonStrength as number, 0, 1e-9, `space horizon band at ${hour}:00`);
  near(inSpace.nightFactor as number, 1, 1e-9, `space night factor at ${hour}:00`);
  near(inSpace.stars as number, 1, 1e-9, `space star strength at ${hour}:00`);
  // The discs are painted into the sky quad, behind everything in the world —
  // in space they would sit behind the 3D Moon and the Earth.
  near(inSpace.sunVisible as number, 0, 1e-9, `space sun disc at ${hour}:00`);
  near(inSpace.moonVisible as number, 0, 1e-9, `space moon disc at ${hour}:00`);
}

console.log('climbing in the afternoon darkens the sky the whole way, never back');
{
  let previousStars = -1;
  let previousSun = 2;
  let previousNight = -1;
  for (let space = 0; space <= 1.0001; space += 0.02) {
    const now = frameAt(AFTERNOON, space);
    check(
      (now.stars as number) >= previousStars - 1e-9,
      `stars dimmed on the way up at space=${space.toFixed(2)}`,
    );
    check(
      (now.sunVisible as number) <= previousSun + 1e-9,
      `the sun disc brightened on the way up at space=${space.toFixed(2)}`,
    );
    check(
      (now.nightFactor as number) >= previousNight - 1e-9,
      `night went backwards on the way up at space=${space.toFixed(2)}`,
    );
    previousStars = now.stars as number;
    previousSun = now.sunVisible as number;
    previousNight = now.nightFactor as number;
  }
}

// --- 3. fog goes the other way ----------------------------------------------
//
// The assertion this file exists for. Night pulls fog in; a climb must push it
// out, from *both* ends of the day, including from the midnight end where the
// naive "space is more night" reading would pull it in hardest.
console.log('fog is pushed out by the climb, not pulled in — from both ends of the day');
for (const hour of [MIDNIGHT, NOON, AFTERNOON]) {
  const ground = frameAt(hour, 0);
  const halfway = frameAt(hour, 0.5);
  const inSpace = frameAt(hour, 1);
  check(
    (halfway.fogFar as number) > (ground.fogFar as number),
    `fog far should open up on the way to space at ${hour}:00`,
  );
  check(
    (inSpace.fogFar as number) > (halfway.fogFar as number),
    `fog far should keep opening at ${hour}:00`,
  );
  check(
    (inSpace.fogNear as number) > (ground.fogNear as number),
    `fog near should move away at ${hour}:00`,
  );
  // Far enough out that the ferris wheel's own space show — a star shell at
  // 620 m, the Earth beyond it — is never touched.
  check(
    (inSpace.fogNear as number) > 700,
    `fog would eat the space show at ${hour}:00 (near ${(inSpace.fogNear as number).toFixed(0)} m)`,
  );
}

// Midnight is the case the analogy would have broken worst: `nightFactor` is
// already 1 there, so a single blended night would have left fog exactly where
// it was and the park would have vanished under the climb.
{
  const groundMidnight = frameAt(MIDNIGHT, 0);
  const spaceMidnight = frameAt(MIDNIGHT, 1);
  check(
    (spaceMidnight.fogFar as number) > (groundMidnight.fogFar as number) * 4,
    'a midnight climb must still open the fog right up',
  );
  console.log(
    `  midnight fog far: ${(groundMidnight.fogFar as number).toFixed(0)} m on the ground, ` +
      `${(spaceMidnight.fogFar as number).toFixed(0)} m in space`,
  );
}

// --- 4. the clock is not a casualty -----------------------------------------
console.log('a trip to space does not move the park clock');
{
  dayNight.setTimeOfDay(AFTERNOON / 24);
  dayNight.setSpaceFactor(0);
  dayNight.update(FRAME);
  const before = dayNight.formatClock();
  for (let space = 0; space <= 1; space += 0.1) {
    dayNight.setSpaceFactor(space);
    dayNight.update(FRAME);
  }
  dayNight.setSpaceFactor(0);
  dayNight.update(FRAME);
  check(
    dayNight.formatClock() === before,
    `the clock moved from ${before} to ${dayNight.formatClock()} during a climb`,
  );
  near(dayNight.spaceFactor, 0, 0, 'the override should be back at zero');
}

// A value outside 0..1 must not be able to overshoot the blend.
console.log('the climb is clamped, so nothing can blend past space');
{
  dayNight.setSpaceFactor(4);
  near(dayNight.spaceFactor, 1, 0, 'space factor above one');
  dayNight.setSpaceFactor(-3);
  near(dayNight.spaceFactor, 0, 0, 'space factor below zero');
}

// ---------------------------------------------------------------------------

console.log(
  failures === 0
    ? `\nPASS: ${checks} checks. Space is the far end of night, and fog knows it is not.`
    : `\n${failures} FAILURE(S) out of ${checks} checks`,
);
process.exit(failures === 0 ? 0 : 1);
