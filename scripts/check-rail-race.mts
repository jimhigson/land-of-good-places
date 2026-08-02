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
 * The old hold-to-accelerate race shipped with a bug the family reported as
 * *"duck bars invisible/ineffective — holding wins"*, and "holding wins" is
 * fatal: a control the player should just mash flat out and never think about
 * has nothing to teach and nothing to enjoy. The 2 August 2026 tap-rate rework
 * replaced hold-to-accelerate with mash-to-go-faster and made duck a separate
 * held control (see `simulate.ts`'s own header) — a bigger surface for the
 * exact same failure mode to hide in, so this file simulates the race end to
 * end, five ways, and asserts the ordering of their finishing times. It is
 * deliberately a *simulation of the real ride*, not of a model of it:
 * `stepRider` is the same function the browser calls every frame, and it is
 * run at **level 3** (every hazard live) so both the spark zones and the duck
 * bars are actually being exercised — see "the levels are gated correctly"
 * below for a separate, direct check that level 1 and level 2 really are
 * quieter than level 3.
 *
 * ### The strategy that matters, and why the obvious one was not enough
 *
 * Comparing "mashes through everything" against "plays well" is **not** a
 * guard on the duck bars, and review caught the pre-rework version of this
 * file claiming it was. A rider who never ducks also powers over every black
 * stretch, so the whole of their deficit can be spark drag while a bonk costs
 * nothing whatever — reconstructing the original bug still passed.
 * `mashThroughEverything.bonks > 0` proves only that bars are *encountered*.
 *
 * `ducksNothing` exists to isolate the one number that matters. It plays the
 * black stretches perfectly and the bars not at all, so against `mashPerfect`
 * the spark drag cancels on both sides and what remains is exactly what a
 * bonk costs.
 *
 * ### Tuned against the physics itself, not carried over from the old numbers
 *
 * The tap-rate rework changed the whole shape of the control (a continuous
 * `boost` charge fed by discrete presses, rather than a boolean "is the
 * button down"), so the pre-rework thresholds in this file's own git history
 * do not transfer — they were measured against a different game. The
 * constants below were re-measured against the rework directly: run this
 * file and read `mashThroughEverything`/`mashPerfect`/`ducksNothing`'s own
 * printed figures if you change `BOOST_GAIN_PER_PRESS`, `BOOST_DECAY_RATE`,
 * `THRUST_MAX` or the drag constants in `simulate.ts` — the numbers below
 * will need the same re-measurement, not a rescale.
 */

import './headless-canvas.mjs';
import { Vector3 } from 'three';
import { RIM_START, TERRAIN_RADIUS } from '../src/core/constants.ts';
import { TAU } from '../src/core/mathUtils.ts';
import { terrainHeight } from '../src/world/terrain.ts';
import { TRAIN_PLAN } from '../src/world/train/plan.ts';
import { ENTRANCE_ANGLE, ENTRANCE_WALL_RADIUS } from '../src/world/entrance/layout.ts';
import { RAIL_RACE_PLAN } from '../src/world/railRace/plan.ts';
import {
  BASE_HEIGHT,
  LANE_COUNT,
  NOMINAL_RADIUS,
  PLAYER_LANE,
  RIDE_SCALE,
  UNDULATION_REACH,
} from '../src/world/railRace/route.ts';
import { RAIL_GAUGE_AT_PARK_SCALE } from '../src/world/railRace/track.ts';
import {
  RACE_LAPS,
  RIVAL_SKILL,
  simulateField,
  simulateRailRace,
  type Strategy,
} from '../src/world/railRace/simulate.ts';
import { AHEAD, RaceCamera, RIDER_RIDE_HEIGHT } from '../src/world/railRace/camera.ts';

const problems: string[] = [];
const say = (line: string): void => console.log(line);
const require = (ok: boolean, complaint: string): void => {
  if (!ok) problems.push(complaint);
};

// The race ring — the one a child is actually on. Its walk-past twin shares
// this route's arc length, start distance and undulation exactly (see
// `route.ts`), so everything below about *when* things happen holds for both;
// what differs is lane spread, and that is checked on its own at the bottom.
const route = RAIL_RACE_PLAN.raceRing;
const walkPast = RAIL_RACE_PLAN.walkPastRing;
const LANE_RADII = route.laneRadii;
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

// Every rail of every lane of **both** rings must sit outside the boundary wall
// (2 August 2026 — this used to assert the opposite, back when the ring flew
// over the park's own crowded rim band at 53.5 m). Measured to the rail head,
// not the lane centre: half a gauge either side is real structure.
const rings = [
  { name: 'race     ', route, half: (RAIL_GAUGE_AT_PARK_SCALE * route.scale) / 2 },
  { name: 'walk-past', route: walkPast, half: (RAIL_GAUGE_AT_PARK_SCALE * walkPast.scale) / 2 },
];
for (const ring of rings) {
  const innermost = Math.min(...ring.route.laneRadii) - ring.half;
  const outermost = Math.max(...ring.route.laneRadii) + ring.half;
  require(
    innermost > ENTRANCE_WALL_RADIUS,
    `the ${ring.name.trim()} ring's inner rail at r=${innermost.toFixed(2)} is inside the ` +
      `boundary wall at r=${ENTRANCE_WALL_RADIUS} — both rings belong outside the park.`,
  );
  require(
    outermost < TERRAIN_RADIUS - 4,
    `the ${ring.name.trim()} ring's outer rail at r=${outermost.toFixed(2)} runs off the edge ` +
      `of the terrain disc at r=${TERRAIN_RADIUS}.`,
  );
  require(
    outermost < RIM_START,
    `the ${ring.name.trim()} ring's outer rail at r=${outermost.toFixed(2)} is out past the ` +
      `hilltop crest at r=${RIM_START}, where its trestles would stand on the falling rim.`,
  );
  say(
    `rim         ${ring.name} ring rails r=${innermost.toFixed(1)}-${outermost.toFixed(1)}, ` +
      `outside the wall at r=${ENTRANCE_WALL_RADIUS}, inside the crest at r=${RIM_START}`,
  );
}

// The two rings are built, not scaled: the race ring's lanes really are
// RIDE_SCALE further apart than the walk-past ring's. Asserted here rather than
// left to read, because "one geometry with a group scale on it" is exactly the
// shortcut this ride had before and exactly what put a 2.5x rival in the park.
const spanRatio = route.laneSpan / walkPast.laneSpan;
require(
  Math.abs(spanRatio - RIDE_SCALE) < 1e-6,
  `the race ring's lane span is ${spanRatio.toFixed(3)}x the walk-past ring's, not ${RIDE_SCALE}x.`,
);
require(
  Math.abs(route.length - walkPast.length) < 1e-9 &&
    Math.abs(route.startDistance - walkPast.startDistance) < 1e-9,
  `the two rings disagree about arc length or start distance, so a rider's travelled distance ` +
    `would not survive being moved from one to the other.`,
);
say(
  `rings       race lane span ${route.laneSpan.toFixed(2)} m = ${spanRatio.toFixed(1)}x the ` +
    `walk-past ring's ${walkPast.laneSpan.toFixed(2)} m, on one shared ${route.length.toFixed(1)} m lap`,
);

// The dismount has to be somewhere a person can stand.
const exitRadius = Math.hypot(RAIL_RACE_PLAN.exitX, RAIL_RACE_PLAN.exitZ);
say(
  `exit        (${RAIL_RACE_PLAN.exitX.toFixed(1)}, ${RAIL_RACE_PLAN.exitZ.toFixed(1)}) ` +
    `r=${exitRadius.toFixed(1)}`,
);
require(exitRadius < 56, 'the ride exit is outside the walkable park.');

// --- does the camera build the picture it promises? --------------------------
//
// The rig has no rig measurements left to read off. It is handed two things —
// how many metres of track in front of the rider must reach the right-hand
// edge, and where across the picture the rider sits — and solves its own
// distance, aim and lens from them, to a different answer for every shape of
// window. So the first half of this asserts the *picture*, read straight off
// the built projection matrix, rather than the numbers that produced it.
//
// The second half still asserts the thing the coaster learned the hard way
// (every ride camera in this park faced backwards for weeks, at
// dot(forward, travel) = -1.000, and it was found by measuring rather than by
// reading). What has changed is that the view is now *deliberately* angled a
// little down the track — that angle is what lets the rig stand close enough
// for a phone — so the assertion is a bounded range rather than a zero. The
// bound is what keeps it a guard: a camera that had flipped measures -1.000 and
// a camera that had become a chase measures +1.000, and the range below admits
// neither. It is also swept at two window shapes now, because the rig is a
// different rig at each and measuring one would leave the other unmeasured.
//
// ### Watched to fail, on 1 August 2026
//
// ```
// the shipped pre-fix rig put back    portrait spans the same 37.6 m as a
//                                     monitor; 10.4 px/m; 122° of fisheye in a
//                                     sliver; and it aimed 9.6° BACKWARDS of
//                                     the rider — which the old check, taking
//                                     its bearing from the middle of the frame
//                                     rather than from the rider, scored 0.000
// the aim swung the other way          0.0 m of road ahead, rider 460% across
// the rider asked for off-screen left  rider -55% across
// AHEAD raised to 75 m                 7.3 px/m, aims 23.2° backwards
// AHEAD cut to 9 m                     9.9 m of road ahead
// ```
//
// The chase-camera ceiling (`mostAngled < 0.45`, about 27°) is the one thing
// here no mutation reached: the rig measures 2.5° on a monitor and 14.5° on a
// phone, and nothing that can be done to the two inputs pushes it past 27
// without tripping something else first. It is honestly a ceiling on the design
// rather than a detector of a fault, and it is what would catch a future rewrite
// that puts an explicit swing dial back on the rig.

const rig = new RaceCamera(route);
const RIDER_RADIUS = LANE_RADII[PLAYER_LANE]!;
const probe = new Vector3();

/**
 * The rider's own lane at `s`, at the height the rider themself rides at.
 *
 * At the rider's height and not the rail's, because that is where the rider is
 * and the promises are about the rider. It is the rig's own constant rather than
 * a second copy of it: measuring the framing at a different height from the one
 * it was solved at reads a different answer (a tilted camera pushes a raised
 * off-centre point further off centre), so a duplicate here would drift out of
 * step with the rig and quietly stop measuring it. Grounded in the running game
 * on 1 August 2026: the player's own object sits 1.2–2.0 m above the rail.
 */
const onLane = (s: number, into: Vector3): Vector3 => {
  const t = route.angleAt(s);
  return into.set(
    Math.cos(t) * RIDER_RADIUS,
    route.base + 0.6 + RIDER_RIDE_HEIGHT,
    Math.sin(t) * RIDER_RADIUS,
  );
};

/** Where the track `s` metres along lands across the screen, -1 left, +1 right. */
const across = (s: number): number => onLane(s, probe).project(rig.camera).x;

interface Framing {
  /** The rider's own place across the picture, 0 at the left edge. */
  riderX: number;
  /** Metres of track in front of the rider that are on screen. */
  ahead: number;
  /** Metres of world the whole picture spans, at the rider. */
  frameWidth: number;
  fov: number;
}

function framing(width: number, height: number): Framing {
  rig.resize(width, height);
  rig.reset(0);
  const start = route.startDistance;
  // Walked, not bisected. The track is a ring, so far enough round it comes back
  // into shot from behind the camera and `project` starts answering about a
  // point that is behind the lens — bisecting straight off would have found one
  // of those and reported 200 m of visible road, which it did.
  const heading = new Vector3();
  rig.camera.getWorldDirection(heading);
  const walk = new Vector3();
  let ahead = 0;
  for (let s = 0.25; s <= 140; s += 0.25) {
    onLane(start + s, walk).sub(rig.camera.position);
    if (walk.dot(heading) <= 0) break;
    if (across(start + s) >= 1) {
      let near = ahead;
      let far = s;
      for (let i = 0; i < 40; i += 1) {
        const mid = (near + far) / 2;
        if (across(start + mid) < 1) near = mid;
        else far = mid;
      }
      ahead = (near + far) / 2;
      break;
    }
    ahead = s;
  }
  // How much world the picture spans: step one metre sideways from the rider and
  // see how much of the screen that took.
  const right = new Vector3().setFromMatrixColumn(rig.camera.matrixWorld, 0).normalize();
  const stepped = onLane(start, new Vector3()).addScaledVector(right, 1).project(rig.camera).x;
  return {
    riderX: (across(start) + 1) / 2,
    ahead,
    frameWidth: 2 / (stepped - across(start)),
    fov: rig.camera.fov,
  };
}

const SHAPES: readonly { readonly name: string; readonly w: number; readonly h: number }[] = [
  { name: 'monitor 1280x720', w: 1280, h: 720 },
  { name: 'laptop 1440x900', w: 1440, h: 900 },
  { name: 'square 900x900', w: 900, h: 900 },
  { name: 'tablet 820x1180', w: 820, h: 1180 },
  { name: 'phone 390x844', w: 390, h: 844 },
  { name: 'sliver 320x900', w: 320, h: 900 },
];

say('');
const frames = SHAPES.map((shape) => {
  const f = framing(shape.w, shape.h);
  say(
    `${shape.name.padEnd(17)} rider ${(f.riderX * 100).toFixed(1).padStart(5)}% across   ` +
      `${f.ahead.toFixed(1).padStart(5)} m of track ahead   ` +
      `picture ${f.frameWidth.toFixed(1).padStart(5)} m wide   ` +
      `${(shape.w / f.frameWidth).toFixed(1).padStart(5)} px/m   ` +
      `fov ${f.fov.toFixed(0).padStart(3)}°`,
  );
  return f;
});

const monitor = frames[0]!;
const phone = frames[4]!;

// The promise the retired 2D game made and this rig inherited: the same amount
// of track is *coming* whatever shape the window is, so a hazard does not arrive
// with less warning on a phone than on a monitor. It used to be kept by fixing
// the metres either side of the middle of the frame; it is now kept about the
// rider, which is where it always meant something.
const leastAhead = Math.min(...frames.map((f) => f.ahead));
say(
  `                  ahead ${leastAhead.toFixed(1)}–` +
    `${Math.max(...frames.map((f) => f.ahead)).toFixed(1)} m across every shape ` +
    `(a monitor gets ${monitor.ahead.toFixed(1)} m)`,
);
// The floor is AHEAD itself, not a historical figure: AHEAD is the metres-ahead
// promise this rig is solved from, and AHEAD_SCREEN_X insets the target point
// short of the true edge, so every window shape shows a little more than AHEAD
// — the promise is broken only if a shape shows *less*. (Previously pinned to
// 26.1 m, the pre-solve rig's figure, back when AHEAD was 27 — that guarded
// against buying "less zoomed out" with "less warning". On the family's own
// 1 August 2026 playtest verdict on the deployed rig, AHEAD itself was halved
// to 13.5, which is the number now being protected here.)
require(
  leastAhead > AHEAD,
  `only ${leastAhead.toFixed(1)} m of track is visible in front of the rider in the tightest ` +
    `window shape, which is less than the ${AHEAD} m the rig is solved to promise. A window ` +
    'shape must never see less than the promise, only more.',
);
// The rig pins AHEAD metres at a fixed place across the picture, so what varies
// between shapes is only the sliver beyond that, which is why this is a floor
// against the monitor rather than a symmetric spread. The direction matters and
// the size does not: a *narrow* window must never be the one that sees less.
require(
  leastAhead > monitor.ahead - 2,
  `the tightest window shape sees ${leastAhead.toFixed(1)} m of track ahead against a ` +
    `monitor's ${monitor.ahead.toFixed(1)} m. A hazard a landscape player had a second to ` +
    "react to would already be past a portrait player's nose. See AHEAD in railRace/camera.ts.",
);

// Left of centre, because a side-scroller spends its screen on what is coming —
// but on the screen, not half off the edge of it, and with enough behind them to
// see a rider who has just been bonked drop back.
for (const [i, f] of frames.entries()) {
  require(
    f.riderX > 0.06 && f.riderX < 0.36,
    `in a ${SHAPES[i]!.name} the rider sits ${(f.riderX * 100).toFixed(1)}% across the picture. ` +
      'They belong left of centre and clear of the edge — see RIDER_SCREEN_X.',
  );
}

// The bug this whole rewrite is for. A phone stood up used to get the same 37.6
// m of world across 390 px that a monitor got across 1280, which is 10.4 px per
// metre against 34.1, which is what "it is too zoomed out" was.
require(
  phone.frameWidth < monitor.frameWidth * 0.8,
  `a phone in portrait spans ${phone.frameWidth.toFixed(1)} m of world against a monitor's ` +
    `${monitor.frameWidth.toFixed(1)} m. Portrait has no width to spare, so it must buy a ` +
    'closer view with the room it does not have to spend behind the rider — this is the ' +
    '1 August 2026 "too zoomed out" report, and it is what RIDER_SCREEN_X exists to fix.',
);
require(
  390 / phone.frameWidth > 15,
  `a phone in portrait renders the world at ${(390 / phone.frameWidth).toFixed(1)} px per metre, ` +
    'which is the size the rider was too small to read at.',
);

// A very narrow window derives a very tall field of view from a fixed horizontal
// one; past about 110° that stops being a picture and starts being a fisheye.
const widestFov = Math.max(...frames.map((f) => f.fov));
require(
  widestFov <= 112.5,
  `the vertical field of view reaches ${widestFov.toFixed(1)}°, which is a fisheye. ` +
    'See MAX_V_FOV in railRace/camera.ts.',
);

// --- and is it pointed the right way, all the way round? ---------------------

const forward = new Vector3();
const inward = new Vector3();
const travelAtRider = new Vector3();

interface Pose {
  mostAngled: number;
  leastAngled: number;
  leastInward: number;
  leastRightward: number;
  mostPitch: number;
  outsideRing: boolean;
  closestToPark: number;
}

function sweep(width: number, height: number): Pose {
  rig.resize(width, height);
  const worst: Pose = {
    mostAngled: -1,
    leastAngled: 1,
    leastInward: 1,
    leastRightward: 1,
    mostPitch: 0,
    outsideRing: true,
    closestToPark: Infinity,
  };
  for (let i = 0; i < 240; i += 1) {
    const travelled = (i / 240) * route.length;
    rig.reset(travelled);
    const camera = rig.camera;
    camera.getWorldDirection(forward);
    // Compared flat, so the rig's downward tilt is not mistaken for looking
    // along the track. The tilt is checked separately.
    const flat = new Vector3(forward.x, 0, forward.z).normalize();

    // Everything is measured against the rider, who is what the rig is for.
    const at = route.wrap(route.startDistance + travelled);
    route.pointAt(PLAYER_LANE, at, point);
    route.tangentAt(PLAYER_LANE, at, travelAtRider);
    travelAtRider.y = 0;
    travelAtRider.normalize();
    inward.set(-point.x, 0, -point.z).normalize();

    const angled = flat.dot(travelAtRider);
    worst.mostAngled = Math.max(worst.mostAngled, angled);
    worst.leastAngled = Math.min(worst.leastAngled, angled);
    worst.leastInward = Math.min(worst.leastInward, flat.dot(inward));
    worst.mostPitch = Math.max(worst.mostPitch, Math.abs(Math.asin(forward.y)));

    // The rider must cross the screen left to right. Screen-right is the
    // camera's own local +X in world space, which is `matrixWorld`'s first column.
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    worst.leastRightward = Math.min(worst.leastRightward, right.dot(travelAtRider));

    const standsAt = Math.hypot(camera.position.x, camera.position.z);
    worst.outsideRing &&= standsAt > Math.hypot(point.x, point.z);
    worst.closestToPark = Math.min(worst.closestToPark, standsAt);
  }
  return worst;
}

say('');
const POSES: readonly { readonly name: string; readonly w: number; readonly h: number }[] = [
  { name: 'monitor', w: 1280, h: 720 },
  { name: 'phone', w: 390, h: 844 },
];
for (const shape of POSES) {
  const p = sweep(shape.w, shape.h);
  say(
    `camera ${shape.name.padEnd(9)} looks ${((Math.asin(p.leastAngled) * 180) / Math.PI).toFixed(1)}–` +
      `${((Math.asin(p.mostAngled) * 180) / Math.PI).toFixed(1)}° down the track from side-on   ` +
      `into the park ≥ ${p.leastInward.toFixed(3)}   ` +
      `left-to-right ≥ ${p.leastRightward.toFixed(3)}   ` +
      `tilt ${((p.mostPitch * 180) / Math.PI).toFixed(1)}° down   ` +
      `stands r≥${p.closestToPark.toFixed(0)}`,
  );

  // Deliberately angled forward, and bounded at both ends. A rig that had been
  // built facing the way the rider has come — the fault every other ride camera
  // in this park has had at some point — measures -1.000 here, and a chase
  // camera measures +1.000. Neither is within a mile of this range.
  require(
    p.leastAngled > -0.05,
    `in a ${shape.name} window the camera looks BACK down the track by ` +
      `${(-(Math.asin(p.leastAngled) * 180) / Math.PI).toFixed(1)}°. It is meant to lead the ` +
      'rider, never trail them — this is the coaster eyeMount fault, in a new place.',
  );
  require(
    p.mostAngled < 0.45,
    `in a ${shape.name} window the camera looks ` +
      `${((Math.asin(p.mostAngled) * 180) / Math.PI).toFixed(1)}° down the track. A little is ` +
      'what lets the rig stand close enough for a phone; this much is a chase camera, and the ' +
      'brief asks for a side view.',
  );
  require(
    p.leastInward > 0.85,
    `in a ${shape.name} window the camera is not looking into the park (dot with inward is ` +
      `${p.leastInward.toFixed(3)}). The park is meant to be the backdrop of the whole race.`,
  );
  require(
    p.leastRightward > 0.9,
    `in a ${shape.name} window riders cross the screen the wrong way ` +
      `(dot(screenRight, travel) = ${p.leastRightward.toFixed(3)}). A side-scroller reads left ` +
      'to right — see the sign of RailRaceRoute.angleAt.',
  );
  require(
    p.outsideRing,
    `in a ${shape.name} window the camera rig strays inside the ring, so it would look outwards.`,
  );
  // Solving the rig for a tighter picture pulls it in towards the track. It must
  // not come in so far that it is standing in the park among the trees and the
  // boundary wall it is meant to be looking over.
  require(
    p.closestToPark > ENTRANCE_WALL_RADIUS,
    `in a ${shape.name} window the rig stands at r=${p.closestToPark.toFixed(1)}, inside the ` +
      `boundary wall at r=${ENTRANCE_WALL_RADIUS}, where the park's own scenery is between it ` +
      'and the race.',
  );
  // Enough tilt to stack the four lanes into four rows of the picture, not so
  // much that the storybook side view turns into a plan view.
  require(
    p.mostPitch > 0.12 && p.mostPitch < 0.5,
    `in a ${shape.name} window the camera tilts ${((p.mostPitch * 180) / Math.PI).toFixed(1)}° ` +
      'down; it needs a little, to separate the four lanes, and not a lot, or the side view ' +
      'becomes a map.',
  );
}

// --- is it still a game? -----------------------------------------------------
//
// Run at level 3 — every hazard live — so both mechanics are actually being
// exercised. "the levels are gated correctly" below checks level 1 and 2
// directly.

say('');
const STRATEGIES: readonly { readonly name: string; readonly strategy: Strategy }[] = [
  { name: 'mashes through everything', strategy: 'mashThroughEverything' },
  { name: 'never presses', strategy: 'neverPress' },
  { name: 'sloppy', strategy: 'mashSloppy' },
  { name: 'ducks nothing', strategy: 'ducksNothing' },
  { name: 'plays well', strategy: 'mashPerfect' },
];

const results = new Map<Strategy, { seconds: number; bonks: number; sparkSeconds: number }>();
for (const { name, strategy } of STRATEGIES) {
  const run = simulateRailRace(strategy, 3);
  results.set(strategy, run);
  say(
    `${name.padEnd(24)} ${run.seconds.toFixed(1)} s   ` +
      `${run.bonks} bonk${run.bonks === 1 ? '' : 's'}   ` +
      `${run.sparkSeconds.toFixed(1)} s sparking`,
  );
}

const mashThrough = results.get('mashThroughEverything')!;
const perfect = results.get('mashPerfect')!;
const sloppy = results.get('mashSloppy')!;
const never = results.get('neverPress')!;
const ducksNothing = results.get('ducksNothing')!;

// The bug this file exists for, rephrased for a tap button: mashing flat out
// through every hazard and never ducking must lose to playing well.
require(
  perfect.seconds < mashThrough.seconds - 4,
  `MASHING WINS: mashing through everything finishes in ${mashThrough.seconds.toFixed(1)} s against ` +
    `${perfect.seconds.toFixed(1)} s for playing well. Playing well must be worth at least 4 s, or ` +
    'the controls have nothing to teach — this is the 28 July family bug, in its new shape.',
);

// --- what a duck bar actually costs, on its own ------------------------------
//
// The assertion above is NOT enough on its own — the same review finding that
// shaped the old hold-based version of this file applies just as much here:
// `mashThroughEverything` also powers over every black stretch, so its whole
// deficit can be spark drag while a bonk costs nothing at all. `bonks > 0`
// proves only that bars are *encountered*.
//
// `ducksNothing` differs from `mashPerfect` in one single thing: it does not
// duck for the bars. Both play the black stretches perfectly, so spark drag
// cancels and what is left is the duck-bar mechanic's entire contribution to
// the race.
const barCost = ducksNothing.seconds - perfect.seconds;
say('');
say(
  `duck bars are worth ${barCost.toFixed(1)} s on their own ` +
    `(${ducksNothing.bonks} bonks, ${ducksNothing.sparkSeconds.toFixed(2)} s sparking) ` +
    `= ${(barCost / Math.max(1, ducksNothing.bonks)).toFixed(2)} s per bonk`,
);
require(
  ducksNothing.sparkSeconds < 0.05,
  `the ducks-nothing run sparked for ${ducksNothing.sparkSeconds.toFixed(2)} s, so this comparison is ` +
    'still contaminated by the black stretches and cannot isolate what a bonk costs.',
);
require(
  ducksNothing.bonks > 0,
  'the ducks-nothing run hit no duck bars at all — the bars are not being tested.',
);
require(
  barCost > 12,
  `DUCKING IS POINTLESS: hitting every duck bar costs only ${barCost.toFixed(1)} s once spark ` +
    'drag is taken out of both sides. A bonk must cost more than the coasting it saved, or the ' +
    'bars are decoration. See this file\'s own header before touching this number: re-measure it ' +
    'against the physics directly rather than rescaling it.',
);
require(
  mashThrough.sparkSeconds > 1,
  'a rider who mashes through everything never sparked — the black zones are not being tested.',
);
require(
  perfect.bonks === 0 && perfect.sparkSeconds < 0.05,
  `playing well still cost ${perfect.bonks} bonks and ${perfect.sparkSeconds.toFixed(2)} s of ` +
    'sparks — the hazards cannot be cleared cleanly, so the game is unfair rather than hard.',
);
// Coasting the whole way must be the slowest thing you can do, or mashing is
// pointless too — the control needs both answers to be wrong sometimes.
require(
  never.seconds > perfect.seconds,
  'never pressing is as quick as playing well — mashing does nothing.',
);
// ...and being sloppy has to land in between, or the game is pass/fail rather
// than something a six-year-old gets gradually better at.
require(
  sloppy.seconds > perfect.seconds && sloppy.seconds < mashThrough.seconds,
  `being sloppy finishes in ${sloppy.seconds.toFixed(1)} s, which is not between playing well ` +
    `(${perfect.seconds.toFixed(1)} s) and mashing through everything (${mashThrough.seconds.toFixed(1)} s).`,
);
// Cheerful and forgiving: nobody should be out there for two minutes.
require(
  mashThrough.seconds < 105,
  `even the worst run takes ${mashThrough.seconds.toFixed(1)} s — too long for one go.`,
);
require(
  perfect.seconds > 20,
  `a good run is over in ${perfect.seconds.toFixed(1)} s — barely a ride.`,
);

// --- the levels are gated correctly ------------------------------------------
//
// A direct check on the "three levels" ask itself, run against the physics
// rather than trusted from `hazards.ts` alone: level 1 must be completely
// clear, level 2 must have the spark zones but not the bars, whatever the
// player does — measured here with a rider who mashes through everything and
// never ducks, so a bar or a zone that shouldn't be live has nowhere to hide.
say('');
const level1 = simulateRailRace('mashThroughEverything', 1);
const level2 = simulateRailRace('mashThroughEverything', 2);
say(
  `level 1, mashing blindly    ${level1.bonks} bonks   ${level1.sparkSeconds.toFixed(1)} s sparking`,
);
say(
  `level 2, mashing blindly    ${level2.bonks} bonks   ${level2.sparkSeconds.toFixed(1)} s sparking`,
);
require(
  level1.bonks === 0 && level1.sparkSeconds === 0,
  `level 1 has a live hazard (${level1.bonks} bonks, ${level1.sparkSeconds.toFixed(1)} s sparking) — ` +
    'it should be completely clear, per the family brief.',
);
require(
  level2.bonks === 0,
  `level 2 bonked ${level2.bonks} times — duck bars should only appear from level 3.`,
);
require(
  level2.sparkSeconds > 1,
  'level 2 never sparked — the black stretches should already be live at level 2.',
);

// --- the field: can she actually win? -----------------------------------
//
// Everything above races the player alone against the clock. It cannot
// answer the family's actual complaint (1 August 2026 — "the competitor NPCs
// are far too good... make them make mistakes and sometimes not play
// optimally, at random"), because there is no field to be too good *at*
// without the three rivals actually racing alongside her. `simulateField`
// drives all four carts through the same `stepRider`/`rivalInput`/`rivalBand`
// the browser calls, at level 3 (every hazard live, the hardest of the three
// the family can pick), across a fixed sweep of seeds — so a change to
// `RIVAL_SKILL` or the rubber band constants in `simulate.ts` is measured
// against the real physics, not carried over from a figure that belonged to
// a different control scheme (the hold-based rivals this file's git history
// once tuned raced a game that no longer exists after the 2 August tap-rate
// rework).
say('');
say(`rival skill (inside-out)   ${RIVAL_SKILL.map((s) => s.toFixed(2)).join('  ')}`);

const FIELD_SEEDS = [
  1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181, 6765, 10946, 17711,
  28657, 46368, 75025,
];

function fieldSummary(strategy: Strategy): {
  wins: number;
  margins: number[];
  rivalBonks: number[];
} {
  const margins: number[] = [];
  const rivalBonks: number[] = [];
  let wins = 0;
  for (const seed of FIELD_SEEDS) {
    const outcome = simulateField(strategy, 3, seed);
    if (outcome.playerPlace === 1) wins += 1;
    margins.push(outcome.marginMetres);
    rivalBonks.push(outcome.rivalBonks);
  }
  return { wins, margins, rivalBonks };
}

const perfectField = fieldSummary('mashPerfect');
const sloppyField = fieldSummary('mashSloppy');
const perfectMeanMargin = perfectField.margins.reduce((a, b) => a + b, 0) / perfectField.margins.length;
const perfectMeanBonks = perfectField.rivalBonks.reduce((a, b) => a + b, 0) / perfectField.rivalBonks.length;
say(
  `plays well vs field      ${perfectField.wins}/${FIELD_SEEDS.length} wins   ` +
    `margin ${Math.min(...perfectField.margins).toFixed(1)}–${Math.max(...perfectField.margins).toFixed(1)} m ` +
    `(mean ${perfectMeanMargin.toFixed(1)} m)   ${perfectMeanBonks.toFixed(1)} rival bonks/race`,
);
const sloppyMeanMargin = sloppyField.margins.reduce((a, b) => a + b, 0) / sloppyField.margins.length;
say(
  `sloppy vs field           ${sloppyField.wins}/${FIELD_SEEDS.length} wins   ` +
    `margin ${Math.min(...sloppyField.margins).toFixed(1)}–${Math.max(...sloppyField.margins).toFixed(1)} m ` +
    `(mean ${sloppyMeanMargin.toFixed(1)} m)`,
);

// She has to be able to win playing well — every seed, not just on average,
// because an "on average" pass hides individual seeds where the rivals are
// still unbeatable (exactly what caught the old hold-based rubber band: a
// field-average assertion passed while five of 24 seeds individually blew
// past the ceiling its own prose claimed to enforce).
require(
  perfectField.wins === FIELD_SEEDS.length,
  `playing well only wins ${perfectField.wins}/${FIELD_SEEDS.length} of the fixed seeds — the rivals ` +
    'are still beating a child who plays every hazard cleanly. Lower RIVAL_SKILL or raise the ' +
    "rubber band's SWING_BEHIND in simulate.ts.",
);
// ...but not a procession. A margin the checker itself thinns to "generous
// but bounded" rather than a fixed historical figure, because that figure
// belongs to whatever the current physics happens to produce — re-measure,
// don't rescale, same rule as the rest of this file.
require(
  Math.max(...perfectField.margins) < 140,
  `playing well finishes as much as ${Math.max(...perfectField.margins).toFixed(1)} m clear of the ` +
    'nearest rival on one of the fixed seeds — a procession, not a race. Raise RIVAL_SKILL or the ' +
    "rubber band's CATCHUP_BEHIND.",
);
// A sloppy player must not always win — losing sometimes is what makes
// playing well worth doing — but must not be hopeless either.
require(
  sloppyField.wins < FIELD_SEEDS.length,
  'playing sloppily still wins every single seed — the rivals have nothing to teach a careless player.',
);
require(
  sloppyField.wins > 0,
  'playing sloppily never wins a single seed — a race a careless child can never win either is not ' +
    'the "far too good" complaint fixed, just moved.',
);
// The rivals must actually be seen to make mistakes — bonks are the one
// mistake visible from the player's own lane (a rival sparking is visible
// too, but bonks are the ask the family named directly: "make mistakes").
require(
  perfectMeanBonks > 0.5,
  `the rivals only bonk ${perfectMeanBonks.toFixed(2)} times a race between the three of them — too ` +
    'rarely to read as "makes mistakes" rather than "plays perfectly". Lower RIVAL_SKILL.',
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
