/**
 * **Is the Rail Race built sanely, and is it still a game?**
 *
 * ```
 * npm run check:rail-race
 * ```
 *
 * Two halves, both measuring the thing that was built rather than the rules that
 * built it.
 *
 * ### The track
 *
 * The four lanes fly over a band of the park that is already full — the railway,
 * the boundary wall, the entrance's gate corridor — so the clearances are
 * asserted rather than trusted, in the claim-versus-fact tradition the rest of
 * this park's checks are written in. It also asserts the thing that makes it a
 * *race*: every lane must be exactly as hard as every other, which for a course
 * whose only difficulty is its hills means identical total climb and identical
 * steepest gradient. Only a *rigid rotation* of one profile preserves both — a
 * free phase per harmonic does not, which this caught on the first draft at
 * 2.54 m of climb between the easiest and hardest lane. It is also what would
 * catch someone "improving" the look by giving lane 3 a bigger dipper.
 *
 * ### The game
 *
 * The old race shipped with a bug the family reported as *"duck bars
 * invisible/ineffective — holding wins"*, and "holding wins" is fatal: a
 * one-button game in which the button should just be held down has nothing to
 * teach and nothing to enjoy. So the race is simulated end to end, five ways,
 * and the ordering of their finishing times is asserted. It is deliberately a
 * *simulation of the real ride*, not of a model of it: `stepRider` is the same
 * function the browser calls every frame.
 *
 * ### The strategy that matters, and why the obvious one was not enough
 *
 * Comparing "never lets go" against "plays well" is **not** a guard on the duck
 * bars, and review caught this file claiming it was. A rider who never lets go
 * also powers over every black stretch, so the whole of their deficit can be
 * spark drag while a bonk costs nothing whatever — reconstructing the original
 * bug still passed. `hold.bonks > 0` proves only that bars are *encountered*.
 *
 * `barsOnly` exists to isolate the one number that matters. It plays the black
 * stretches perfectly and the bars not at all, so against `perfect` the spark
 * drag cancels on both sides and what remains is exactly what a bonk costs.
 *
 * ### Mutation-tested, on 1 August 2026
 *
 * A regression guard nobody has watched fail is not a guard. Measured, by
 * reintroducing the original faults one at a time:
 *
 * ```
 * fix in place                          bars worth  15.6 s   exit 0
 * thrust un-gated during the wobble      "     "     7.8 s   exit 1
 * a bonk costs no speed                  "     "     7.3 s   exit 1
 * both (the original Coaster behaviour)  "     "    -0.2 s   exit 1
 * ```
 *
 * The threshold is 8 s: comfortably under the 15.6 s the real thing is worth,
 * and comfortably over every way of breaking it.
 */

import './headless-canvas.mjs';
import { Vector3 } from 'three';
import { TAU } from '../src/core/mathUtils.ts';
import { terrainHeight } from '../src/world/terrain.ts';
import { TRAIN_PLAN } from '../src/world/train/plan.ts';
import { ENTRANCE_ANGLE, ENTRANCE_WALL_RADIUS } from '../src/world/entrance/layout.ts';
import { RAIL_RACE_PLAN } from '../src/world/railRace/plan.ts';
import {
  BASE_HEIGHT,
  LANE_COUNT,
  LANE_RADII,
  NOMINAL_RADIUS,
  PLAYER_LANE,
  UNDULATION_REACH,
} from '../src/world/railRace/route.ts';
import { RACE_LAPS, simulateRailRace, type Strategy } from '../src/world/railRace/simulate.ts';
import { RaceCamera } from '../src/world/railRace/camera.ts';

const problems: string[] = [];
const say = (line: string): void => console.log(line);
const require = (ok: boolean, complaint: string): void => {
  if (!ok) problems.push(complaint);
};

const route = RAIL_RACE_PLAN.route;
const SAMPLES = 1400;

say(`loop        ${route.length.toFixed(1)} m at r=${NOMINAL_RADIUS} m, ${LANE_COUNT} lanes`);
say(`lane radii  ${LANE_RADII.map((r) => r.toFixed(1)).join('  ')} m`);
say(`race        ${RACE_LAPS} laps = ${(route.length * RACE_LAPS).toFixed(0)} m`);

// --- every lane is exactly as hard as every other ----------------------------
//
// Measured off the built height function, not off the harmonic table.

interface LaneFacts {
  climb: number;
  steepest: number;
  lowest: number;
  highest: number;
}

const point = new Vector3();
const trainPoint = new Vector3();
const lanes: LaneFacts[] = [];
for (let lane = 0; lane < LANE_COUNT; lane += 1) {
  const facts: LaneFacts = { climb: 0, steepest: 0, lowest: Infinity, highest: -Infinity };
  let previous = route.heightAt(lane, 0);
  for (let i = 1; i <= SAMPLES; i += 1) {
    const distance = (i / SAMPLES) * route.length;
    const height = route.heightAt(lane, distance);
    if (height > previous) facts.climb += height - previous;
    previous = height;
    facts.steepest = Math.max(facts.steepest, Math.abs(route.slopeAt(lane, distance)));
    route.pointAt(lane, distance, point);
    const above = height - terrainHeight(point.x, point.z);
    facts.lowest = Math.min(facts.lowest, above);
    facts.highest = Math.max(facts.highest, above);
  }
  lanes.push(facts);
  say(
    `lane ${lane}      climb ${facts.climb.toFixed(2)} m  steepest ` +
      `${((Math.atan(facts.steepest) * 180) / Math.PI).toFixed(1)}°  ` +
      `height ${facts.lowest.toFixed(2)}–${facts.highest.toFixed(2)} m over the ground`,
  );
}

const climbSpread = Math.max(...lanes.map((l) => l.climb)) - Math.min(...lanes.map((l) => l.climb));
const steepSpread =
  Math.max(...lanes.map((l) => l.steepest)) - Math.min(...lanes.map((l) => l.steepest));
say(`fairness    climb spread ${climbSpread.toFixed(4)} m, gradient spread ${steepSpread.toFixed(5)}`);
require(
  climbSpread < 0.02,
  `lanes are not equally hard: total climb differs by ${climbSpread.toFixed(3)} m between the ` +
    'easiest and hardest lane. Lanes must differ by PHASE only — see railRace/route.ts.',
);
require(
  steepSpread < 0.002,
  `lanes are not equally hard: steepest gradient differs by ${steepSpread.toFixed(4)}.`,
);

// The gentle-rollercoaster promise. 11° was the retired 2D game's ceiling; this
// allows a little more because the hills here are what make the lanes read apart.
const steepestDegrees = (Math.atan(Math.max(...lanes.map((l) => l.steepest))) * 180) / Math.PI;
require(
  steepestDegrees <= 15,
  `steepest gradient is ${steepestDegrees.toFixed(1)}°, over the 15° a cosy ride should reach.`,
);

// --- clearance over everything the ring flies across -------------------------

/** Rail-over-rail air, Decision 4. */
const RAIL_OVER_RAIL = 5.5;

let worstOverTrain = Infinity;
let worstOverTrainAt = 0;
let worstGround = Infinity;
for (let i = 0; i < SAMPLES; i += 1) {
  const distance = (i / SAMPLES) * route.length;
  for (let lane = 0; lane < LANE_COUNT; lane += 1) {
    route.pointAt(lane, distance, point);
    const ground = terrainHeight(point.x, point.z);
    worstGround = Math.min(worstGround, point.y - ground);

    // Where the railway passes under, measure the actual air over its rail head.
    const near = TRAIN_PLAN.route.distanceNear(point.x, point.z);
    TRAIN_PLAN.route.pointAt(near, trainPoint);
    const apart = Math.hypot(trainPoint.x - point.x, trainPoint.z - point.z);
    if (apart < 4) {
      const air = point.y - trainPoint.y;
      if (air < worstOverTrain) {
        worstOverTrain = air;
        worstOverTrainAt = distance;
      }
    }
  }
}

say(`ground      lowest rail is ${worstGround.toFixed(2)} m over the ground it crosses`);
say(
  worstOverTrain === Infinity
    ? 'railway     the ring never passes within 4 m of the railway'
    : `railway     ${worstOverTrain.toFixed(2)} m of air over the rail head (worst, at s=${worstOverTrainAt.toFixed(0)} m)`,
);

require(
  worstGround > 4,
  `the track dips to ${worstGround.toFixed(2)} m over the ground — a child walks under this.`,
);
require(
  worstOverTrain === Infinity || worstOverTrain >= RAIL_OVER_RAIL,
  `only ${worstOverTrain.toFixed(2)} m of rail-over-rail air over the railway; Decision 4 asks ` +
    `for ${RAIL_OVER_RAIL} m.`,
);

// The entrance gate: the ring crosses the corridor a child walks in through.
const gateDistance = route.wrap(ENTRANCE_ANGLE * NOMINAL_RADIUS);
let lowestOverGate = Infinity;
for (let lane = 0; lane < LANE_COUNT; lane += 1) {
  for (let d = -12; d <= 12; d += 0.5) {
    route.pointAt(lane, route.wrap(gateDistance + d), point);
    lowestOverGate = Math.min(lowestOverGate, point.y - terrainHeight(point.x, point.z));
  }
}
say(
  `gate        ${lowestOverGate.toFixed(2)} m of air over the entrance corridor ` +
    `(wall r=${ENTRANCE_WALL_RADIUS})`,
);
require(lowestOverGate > 6, `only ${lowestOverGate.toFixed(2)} m of air over the entrance arch.`);

// Every lane must sit inside the boundary wall, so the ring reads as the park's
// own rim rather than something hovering out over the treeline.
const outermost = Math.max(...LANE_RADII);
require(
  outermost < ENTRANCE_WALL_RADIUS - 1,
  `the outer lane at r=${outermost} reaches the boundary wall at r=${ENTRANCE_WALL_RADIUS}.`,
);
say(`rim         outer lane r=${outermost.toFixed(1)} inside the wall at r=${ENTRANCE_WALL_RADIUS}`);

// The dismount has to be somewhere a person can stand.
const exitRadius = Math.hypot(RAIL_RACE_PLAN.exitX, RAIL_RACE_PLAN.exitZ);
say(
  `exit        (${RAIL_RACE_PLAN.exitX.toFixed(1)}, ${RAIL_RACE_PLAN.exitZ.toFixed(1)}) ` +
    `r=${exitRadius.toFixed(1)}`,
);
require(exitRadius < 56, 'the ride exit is outside the walkable park.');

// --- is the camera actually side-on, and the right way round? ----------------
//
// The lesson the coaster learned the hard way (every ride camera in this park
// faced backwards for weeks, at dot(forward, travel) = -1.000, and it was found
// by measuring rather than by reading). Nothing here is argued from the code; it
// is all read off the built camera.

const rig = new RaceCamera(route);
rig.resize(1280, 720);

const forward = new Vector3();
const travel = new Vector3();
const inward = new Vector3();
const travelAtRider = new Vector3();
const toCamera = new Vector3();

let worstSideOn = 0;
let worstInward = 1;
let leastRightward = 1;
let outsideEverywhere = true;
let worstPitch = 0;

for (let i = 0; i < 240; i += 1) {
  const travelled = (i / 240) * route.length;
  rig.reset(travelled);
  const camera = rig.camera;
  camera.getWorldDirection(forward);

  // "Side-on" is a property of the middle of the picture, so it is measured
  // there — the rider is deliberately held left of centre and is therefore
  // always a little off-axis, which is the framing working, not a fault. The
  // rig stands radially out from the point it aims at, so the bearing it stands
  // at IS the bearing of the centre of the picture.
  const centreBearing = Math.atan2(camera.position.z, camera.position.x);
  inward.set(-Math.cos(centreBearing), 0, -Math.sin(centreBearing));
  // The clockwise horizontal tangent at that bearing — see RailRaceRoute.angleAt.
  travel.set(Math.sin(centreBearing), 0, -Math.cos(centreBearing));

  // Compared flat, so the rig's downward tilt is not mistaken for looking along
  // the track. The tilt is checked separately below.
  const flat = new Vector3(forward.x, 0, forward.z).normalize();
  worstSideOn = Math.max(worstSideOn, Math.abs(flat.dot(travel)));
  worstInward = Math.min(worstInward, flat.dot(inward));
  worstPitch = Math.max(worstPitch, Math.abs(Math.asin(forward.y)));

  // The rider must cross the screen left to right. Screen-right is the camera's
  // own local +X in world space, which is `matrixWorld`'s first column.
  const at = route.wrap(route.startDistance + travelled);
  route.tangentAt(PLAYER_LANE, at, travelAtRider);
  const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  leastRightward = Math.min(leastRightward, right.dot(travelAtRider));

  // The rig has to stand outside the ring, or it is looking out of the park.
  route.pointAt(PLAYER_LANE, at, point);
  toCamera.subVectors(camera.position, point);
  outsideEverywhere &&= Math.hypot(camera.position.x, camera.position.z) > Math.hypot(point.x, point.z);
}

say('');
say(`camera      |dot(forward, travel)| ≤ ${worstSideOn.toFixed(4)}  (0 is perfectly side-on)`);
say(`            dot(forward, inward)  ≥ ${worstInward.toFixed(4)}  (1 is straight into the park)`);
say(`            dot(screenRight, travel) ≥ ${leastRightward.toFixed(3)}  (1 is left-to-right)`);
say(`            tilt ${((worstPitch * 180) / Math.PI).toFixed(1)}° down`);
say(`            fov ${rig.camera.fov.toFixed(1)}° at 16:9`);

require(
  worstSideOn < 0.02,
  `the camera is not side-on: it looks along the direction of travel by ` +
    `${worstSideOn.toFixed(3)}. The brief asks for a side view, not a chase.`,
);
require(
  worstInward > 0.99,
  `the camera is not looking into the park (dot with inward is ${worstInward.toFixed(3)}). ` +
    'The park is meant to be the backdrop of the whole race.',
);
require(
  leastRightward > 0.95,
  `riders cross the screen the wrong way (dot(screenRight, travel) = ` +
    `${leastRightward.toFixed(3)}). A side-scroller reads left to right — see the sign of ` +
    'RailRaceRoute.angleAt.',
);
require(outsideEverywhere, 'the camera rig strays inside the ring, so it would look outwards.');
// Enough tilt to stack the four lanes into four rows of the picture, not so much
// that the storybook side view turns into a plan view.
require(
  worstPitch > 0.12 && worstPitch < 0.5,
  `the camera tilts ${((worstPitch * 180) / Math.PI).toFixed(1)}° down; it needs a little, to ` +
    'separate the four lanes, and not a lot, or the side view becomes a map.',
);

// A portrait phone must see the same track ahead as a monitor.
rig.resize(720, 1280);
const portraitFov = rig.camera.fov;
rig.resize(1280, 720);
say(`            fov ${portraitFov.toFixed(1)}° in portrait — taller, not narrower`);
require(
  portraitFov > rig.camera.fov + 10,
  'a portrait screen does not widen the view vertically, so it must be cropping the track ' +
    'ahead — a hazard would arrive with less warning on a phone than on a monitor.',
);

// --- is it still a game? -----------------------------------------------------

say('');
const STRATEGIES: readonly { readonly name: string; readonly strategy: Strategy }[] = [
  { name: 'never lets go', strategy: 'alwaysHold' },
  { name: 'never holds', strategy: 'neverHold' },
  { name: 'sloppy', strategy: 'sloppy' },
  { name: 'ducks nothing', strategy: 'barsOnly' },
  { name: 'plays well', strategy: 'perfect' },
];

const results = new Map<Strategy, { seconds: number; bonks: number; sparkSeconds: number }>();
for (const { name, strategy } of STRATEGIES) {
  const run = simulateRailRace(strategy);
  results.set(strategy, run);
  say(
    `${name.padEnd(14)} ${run.seconds.toFixed(1)} s   ` +
      `${run.bonks} bonk${run.bonks === 1 ? '' : 's'}   ` +
      `${run.sparkSeconds.toFixed(1)} s sparking`,
  );
}

const hold = results.get('alwaysHold')!;
const perfect = results.get('perfect')!;
const sloppy = results.get('sloppy')!;
const never = results.get('neverHold')!;
const barsOnly = results.get('barsOnly')!;

// The bug this file exists for.
require(
  perfect.seconds < hold.seconds - 4,
  `HOLDING WINS: never letting go finishes in ${hold.seconds.toFixed(1)} s against ` +
    `${perfect.seconds.toFixed(1)} s for playing well. Letting go must be worth at least 4 s, ` +
    'or the one control has nothing to teach — this is the 28 July family bug.',
);

// --- what a duck bar actually costs, on its own ------------------------------
//
// The assertion above is NOT enough on its own, and review caught exactly that:
// `alwaysHold` also powers over every black stretch, so its whole deficit can be
// spark drag while a bonk costs nothing at all. Reconstructing the old bug
// (thrust un-gated during the wobble, a free bonk) still passed it. `bonks > 0`
// proves only that bars are *encountered*.
//
// `barsOnly` differs from `perfect` in one single thing: it does not let go for
// the bars. Both play the black stretches perfectly, so spark drag cancels and
// what is left is the duck-bar mechanic's entire contribution to the race.
const barCost = barsOnly.seconds - perfect.seconds;
say('');
say(
  `duck bars are worth ${barCost.toFixed(1)} s on their own ` +
    `(${barsOnly.bonks} bonks, ${barsOnly.sparkSeconds.toFixed(2)} s sparking)`,
);
require(
  barsOnly.sparkSeconds < 0.05,
  `the bars-only run sparked for ${barsOnly.sparkSeconds.toFixed(2)} s, so this comparison is ` +
    'still contaminated by the black stretches and cannot isolate what a bonk costs.',
);
require(
  barsOnly.bonks > 0,
  'the bars-only run hit no duck bars at all — the bars are not being tested.',
);
require(
  barCost > 8,
  `DUCKING IS POINTLESS: hitting every duck bar costs only ${barCost.toFixed(1)} s once spark ` +
    'drag is taken out of both sides. A bonk must cost more than the coasting it saved, or the ' +
    'bars are decoration — this is the 28 July family bug, and it is the assertion that fails ' +
    'when the wobble stops gating thrust.',
);
require(
  hold.sparkSeconds > 1,
  'a rider who never lets go never sparked — the black zones are not being tested.',
);
require(
  perfect.bonks === 0 && perfect.sparkSeconds < 0.05,
  `playing well still cost ${perfect.bonks} bonks and ${perfect.sparkSeconds.toFixed(2)} s of ` +
    'sparks — the hazards cannot be cleared cleanly, so the game is unfair rather than hard.',
);
// Coasting the whole way must be the slowest thing you can do, or "hold" is
// pointless too — a one-button game needs both answers to be wrong sometimes.
require(
  never.seconds > perfect.seconds,
  'never holding is as quick as playing well — the accelerate half of the control does nothing.',
);
// ...and being sloppy has to land in between, or the game is pass/fail rather
// than something a six-year-old gets gradually better at.
require(
  sloppy.seconds > perfect.seconds && sloppy.seconds < hold.seconds,
  `being sloppy finishes in ${sloppy.seconds.toFixed(1)} s, which is not between playing well ` +
    `(${perfect.seconds.toFixed(1)} s) and never letting go (${hold.seconds.toFixed(1)} s).`,
);
// Cheerful and forgiving: nobody should be out there for two minutes.
require(
  hold.seconds < 105,
  `even the worst run takes ${hold.seconds.toFixed(1)} s — too long for one go.`,
);
require(
  perfect.seconds > 30,
  `a good run is over in ${perfect.seconds.toFixed(1)} s — barely a ride.`,
);

say('');
say(`player rides lane ${PLAYER_LANE} (outermost, nearest the camera)`);
say(`undulation reach ±${UNDULATION_REACH.toFixed(2)} m about a base of ${BASE_HEIGHT} m`);
say(`start/finish arch at s=${route.startDistance.toFixed(1)} m (bearing of the booth)`);
say(`one lap is ${(TAU * NOMINAL_RADIUS).toFixed(1)} m`);

if (problems.length > 0) {
  console.error('');
  for (const problem of problems) console.error(`FAIL: ${problem}`);
  process.exitCode = 1;
} else {
  console.log('');
  console.log('rail race: OK');
}
