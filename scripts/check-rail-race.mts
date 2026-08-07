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
import { PLAYER_RADIUS, RIM_OUTSET_START } from '../src/core/constants.ts';
import { PARK_BOUNDARY } from '../src/world/boundary.ts';
import {
  BOUNDARY_MASONRY_HALF_WIDTH,
  BOUNDARY_WALL_COLLISION_HALF,
} from '../src/world/Garden.ts';
import { TAU } from '../src/core/mathUtils.ts';
import { terrainHeight } from '../src/world/terrain.ts';
import { TRAIN_PLAN } from '../src/world/train/plan.ts';
import { ENTRANCE_ANGLE, ENTRANCE_WALL_RADIUS } from '../src/world/entrance/layout.ts';
import { EXIT_INSIDE_EDGE, RAIL_RACE_PLAN } from '../src/world/railRace/plan.ts';
import {
  BASE_HEIGHT,
  LANE_COUNT,
  NOMINAL_OUTSET,
  PLAYER_LANE,
  RIDE_SCALE,
  UNDULATION_REACH,
} from '../src/world/railRace/route.ts';
import { RAIL_GAUGE_AT_PARK_SCALE } from '../src/world/railRace/track.ts';
import {
  RACE_LAPS,
  RIVAL_SKILL,
  CHILD_TAPS_PER_SECOND,
  PLAYER_BOOST_ADVANTAGE,
  BOB_SECONDS,
  simulateField,
  simulateRailRace,
  createRider,
  stepRider,
  scheduleForLevel,
  type Strategy,
} from '../src/world/railRace/simulate.ts';
import {
  AHEAD,
  FACE_TURN_MAX,
  RaceCamera,
  RIDER_RIDE_HEIGHT,
  faceTurnTowardsCamera,
} from '../src/world/railRace/camera.ts';
import { SEAT_HEIGHT, WHEEL_RADIUS } from '../src/world/railRace/cart.ts';
import { DUCK_CLEARANCE_AT_PARK_SCALE } from '../src/world/railRace/hazards.ts';
import {
  poseRailRaceRider,
  setRiderLegsVisible,
  riderLegsShow,
  cheerAt,
  SEATED,
  RESULT_SECONDS,
  type RidePhase,
  type RiderPose,
} from '../src/world/railRace/duckPose.ts';
import { duckBarAssetGeometry } from '../src/art/models/duckBarAsset.ts';
import { createKid, kidEyeCentre } from '../src/art/models/kid.ts';
import { createCart } from '../src/world/railRace/cart.ts';
import { PALETTE } from '../src/core/palette.ts';
import { Box3, Group, Mesh, Object3D } from 'three';
import { Player } from '../src/entities/Player.ts';
import { CollisionWorld } from '../src/world/Collision.ts';
import { IsoCamera } from '../src/core/IsoCamera.ts';
import type { FrameContext } from '../src/core/types.ts';
import type { InputSystem } from '../src/core/input/index.ts';

/**
 * A bounding box over only the parts that are actually **drawn**.
 *
 * `Box3.setFromObject` includes hidden children, which is wrong for a ride that
 * switches its riders' legs off (`RailRace.legsShow`): it would report clipping
 * nobody can see, and could pass a torso that genuinely went through the floor
 * because a hidden foot was lower still.
 */
function visibleBox(root: Object3D): Box3 {
  const box = new Box3();
  root.updateWorldMatrix(true, true);
  root.traverse((child) => {
    if (!child.visible) return;
    let node: Object3D | null = child;
    while (node && node !== root) {
      if (!node.visible) return;
      node = node.parent;
    }
    if (child instanceof Mesh) box.expandByObject(child);
  });
  return box;
}

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
const LANE_OFFSETS = route.laneOffsets;
const SAMPLES = 1400;

say(
  `loop        ${route.length.toFixed(1)} m at ${NOMINAL_OUTSET} m outside the park edge, ` +
    `${LANE_COUNT} lanes`,
);
say(`lane offsets ${LANE_OFFSETS.map((r) => r.toFixed(1)).join('  ')} m from centre line`);
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
// A search, not `bearing * R`: the ring is not a circle any more.
const gateDistance = route.wrap(route.path.distanceAtBearing(ENTRANCE_ANGLE));
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
// Measured as **outset** — metres outside the park's own edge — not as a radius.
// A radius only says where the ride is relative to the park while the park is a
// circle; the edge now runs 59.7 m at the pinch and 101.4 m at the bulge, so
// `r = 65.5` meant "outside" on one bearing and "35 m inside, with the masonry
// between the rails" on another. Sampled round the ring rather than computed
// from the lane offsets, because the curve's own bending widens its true
// perpendicular reach slightly beyond the nominal half-span.
const CLEAR_OF_MASONRY = Math.max(
  BOUNDARY_WALL_COLLISION_HALF + PLAYER_RADIUS,
  BOUNDARY_MASONRY_HALF_WIDTH,
);
for (const ring of rings) {
  let innermost = Infinity;
  let outermost = -Infinity;
  const steps = 720;
  for (let i = 0; i < steps; i += 1) {
    const d = (i / steps) * ring.route.length;
    const sample = ring.route.path.sampleAt(d);
    for (const lane of [0, LANE_COUNT - 1]) {
      const lateral = ring.route.laneOffsets[lane] ?? 0;
      for (const edge of [lateral - ring.half, lateral + ring.half]) {
        const outset = -PARK_BOUNDARY.distanceToEdge(
          sample.x + sample.normalX * edge,
          sample.z + sample.normalZ * edge,
        );
        if (outset < innermost) innermost = outset;
        if (outset > outermost) outermost = outset;
      }
    }
  }
  require(
    innermost > CLEAR_OF_MASONRY,
    `the ${ring.name.trim()} ring's inner rail comes ${innermost.toFixed(2)} m outside the park ` +
      `edge, inside the ${CLEAR_OF_MASONRY.toFixed(2)} m the masonry and a child need.`,
  );
  require(
    outermost < RIM_OUTSET_START,
    `the ${ring.name.trim()} ring's outer rail runs ${outermost.toFixed(2)} m outside the park ` +
      `edge, past the ${RIM_OUTSET_START} m crest where its trestles would stand on falling rim.`,
  );
  say(
    `rim         ${ring.name} ring rails ${innermost.toFixed(1)}-${outermost.toFixed(1)} m ` +
      `outside the edge, clear of masonry at ${CLEAR_OF_MASONRY.toFixed(2)}, inside the crest ` +
      `at ${RIM_OUTSET_START}`,
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
//
// Measured against the edge, not as a radius. This was `exitRadius < 56`, the
// mirror of `plan.ts`'s own clamp, and both said "inside the walkable park"
// only for as long as the park was a disc. The edge now runs 59.7–101.4 m out,
// so 56 m rejected good ground on most bearings and was never a statement about
// the pinch at all. Same correction as `railOutsetRange` in the procgen
// invariants: a radius is only a claim about the edge while the edge is the
// same distance away on every bearing.
const exitInside = PARK_BOUNDARY.distanceToEdge(RAIL_RACE_PLAN.exitX, RAIL_RACE_PLAN.exitZ);
say(
  `exit        (${RAIL_RACE_PLAN.exitX.toFixed(1)}, ${RAIL_RACE_PLAN.exitZ.toFixed(1)}) ` +
    `${exitInside.toFixed(1)} m inside the park edge`,
);
// `EXIT_INSIDE_EDGE` is imported from the planner, not restated here. This
// assertion previously hand-typed `> 1` against a planner that clamps at 2, so
// it could pass a plan that broke the rule it exists to enforce.
//
// What it actually guards is the planner's **fallback**: when no candidate spot
// is clear, `planExit` hands back the nearest try *without* applying the clamp,
// on the stated reasoning that a loud check is better than no exit. That is the
// path this catches.
//
// Note what single ownership does and does not buy. Mutating the constant no
// longer proves the check live — planner and checker move together, which is
// the whole point — and on today's seeds the exit stands 37.9 m inside the edge
// against a 2 m floor, so nothing can make this fire. It becomes load-bearing
// exactly when the booth moves to the rim (#117), which is when the fallback
// starts being reachable.
require(
  exitInside >= EXIT_INSIDE_EDGE,
  `the ride exit stands ${exitInside.toFixed(1)} m inside the park edge, short of the ` +
    `${EXIT_INSIDE_EDGE} m the planner clamps to — a rider is set down on or beyond the ` +
    'boundary rather than in the park.',
);

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
const RIDER_OFFSET = LANE_OFFSETS[PLAYER_LANE]!;
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
  const sample = route.path.sampleAt(s);
  return into.set(
    sample.x + sample.normalX * RIDER_OFFSET,
    route.base + 0.6 + RIDER_RIDE_HEIGHT,
    sample.z + sample.normalZ * RIDER_OFFSET,
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

// --- does it stand further back when she is going faster? --------------------
//
// Jim, 6 August 2026: the camera should pull back as she speeds up, showing more
// track ahead, **eased not snapped**. Three separate claims live in that, and
// each is asserted here against the real `RaceCamera`, driven frame by frame:
//
// 1. **It pulls back at all**, and by an amount worth the code.
// 2. **The rider does not move on screen while it does.** This is the one that
//    could quietly wreck the ride: `RIDER_SCREEN_X` is a promise the family
//    signed off twice, and a zoom that walked her towards the edge would undo
//    it. The rig is scaled about the rider, so this should be exact.
// 3. **The easing is frame-rate independent**, i.e. a real half-life rather than
//    a per-frame lerp. A per-frame lerp is the ordinary way to write this and it
//    ties the camera's feel to the frame rate — the same ramp settles at a
//    different place on a 240 Hz monitor than on a phone dropping frames. Asked
//    for explicitly, so measured explicitly.
//
// All three drive `rig.update` with the same wall-clock ramp and differ only in
// the step, so nothing here can agree with itself by construction.

rig.resize(1280, 720);

/** Drives the real rig at a constant speed for `seconds`, from a standstill. */
function settle(speed: number, dt: number, seconds = 6): number {
  rig.reset(0);
  let travelled = 0;
  for (let t = 0; t < seconds; t += dt) {
    travelled += speed * dt;
    rig.update(travelled, dt);
  }
  return travelled;
}

/** How far the lens ends up from the rider it is framing, in metres. */
function standOff(travelled: number): number {
  return rig.camera.position.distanceTo(onLane(route.startDistance + travelled, probe));
}

/** Where the rider sits across the picture, 0 at the left edge — her mark. */
function riderMark(travelled: number): number {
  return (onLane(route.startDistance + travelled, probe).project(rig.camera).x + 1) / 2;
}

const TICK = 1 / 60;
const crawlRun = settle(2, TICK);
const crawlStand = standOff(crawlRun);
const crawlMark = riderMark(crawlRun);
const racingRun = settle(32, TICK);
const racingStand = standOff(racingRun);
const racingMark = riderMark(racingRun);

say('');
say(
  `zoom       stands ${crawlStand.toFixed(1)} m off at a crawl, ${racingStand.toFixed(1)} m at ` +
    `racing speed (${((racingStand / crawlStand - 1) * 100).toFixed(1)}% further back)   ` +
    `rider holds her mark at ${crawlMark.toFixed(4)} / ${racingMark.toFixed(4)} across`,
);

// 1. It has to actually pull back, and by enough to notice.
require(
  racingStand > crawlStand * 1.1,
  `the camera stands ${racingStand.toFixed(2)} m off at racing speed against ` +
    `${crawlStand.toFixed(2)} m at a crawl — under a tenth further back, which is not a zoom. See ` +
    'SPEED_PULL_BACK in railRace/camera.ts.',
);
// ...and not so far that the ride turns into a map.
require(
  racingStand < crawlStand * 1.6,
  `the camera pulls back to ${(racingStand / crawlStand).toFixed(2)}x its resting distance, which ` +
    'is a different shot rather than the same shot with more road in it. See SPEED_PULL_BACK.',
);

// 2. **She holds her mark at every speed.** `RIDER_SCREEN_X` is a promise the
//    family signed off twice, and a camera that walked her towards the edge as
//    she sped up would undo it silently.
//
//    Measured end to end rather than as "the zoom contributes exactly zero",
//    which is what this assertion said first and is a subtly different claim.
//    The zoom really is a uniform scaling of the rig about the rider, so on its
//    own it moves her not at all — but the **follower** does, a little: leading
//    by `FOLLOW_LAG × speed` cancels the chase lag at every speed only to first
//    order, leaving a residual that grows with speed. Watched at
//    `SPEED_PULL_BACK = 0`, the drift is **0.0078** of the picture; with the
//    pull-back switched on it is **0.0057**, i.e. the zoom slightly *improves*
//    it. An assertion that blamed the zoom for the follower's residual would
//    have been red on arrival for the wrong reason, and would have gone green
//    again if someone deleted the lead-ahead.
//
//    So the bound is on what a child actually sees — under 2% of the picture
//    across the entire speed range — and it catches a broken zoom easily,
//    because scaling `stand` without `look` swings the aim and moves her by far
//    more than that.
const markDrift = Math.abs(racingMark - crawlMark);
require(
  markDrift < 0.02,
  `the rider slides from ${crawlMark.toFixed(4)} to ${racingMark.toFixed(4)} across the picture ` +
    `between a crawl and racing speed — ${(markDrift * 100).toFixed(1)}% of the width, and ` +
    'RIDER_SCREEN_X is a promise the family signed off. Either the pull-back is not a uniform ' +
    'scaling of the rig about the rider (it must scale `stand` and `look` by one factor, or the ' +
    'aim swings), or FOLLOW_LAG has stopped cancelling the follower lag. See camera.ts.',
);

// 3. **Frame-rate independence**: the same wall clock at 30 Hz and at 240 Hz has
//    to put the camera in the same place. A per-frame lerp — the ordinary way
//    to write this — ties the camera's feel to the frame rate, so the ride
//    behaves differently on a 240 Hz monitor than on a phone dropping frames.
//
//    **Sampled all the way along the ramp, not at one moment**, and that is not
//    caution: watched at a single 1.2 s probe, a per-frame lerp of 0.05 was
//    caught 1.768 m apart, but one of 0.2 slipped through at 0.028 m — a plain
//    hand-tuned value, fast enough that both rates had already settled by the
//    time the probe looked. The disagreement only exists *while the easing is
//    easing*, so the probe has to be there for it. Taking the worst of a sweep
//    catches a lerp of any speed: a slow one diverges late, a fast one early.
//
//    **The bound is not zero, and the reason is worth knowing before anyone
//    tightens it.** `damp` is exact for a target that is standing still, but
//    both followers here chase a target that is itself moving — the anchor
//    chases a rider accelerating away, and the zoom chases a speed that is still
//    settling — and stepping an exponential over a moving target carries an
//    inherent first-order-in-`dt` error. That is a property of discrete time,
//    not of a per-frame lerp, and it is most of what is left. Swept:
//
//    ```
//      SPEED_PULL_BACK = 0 (no zoom at all)     0.071 m   <- the follower alone
//      SPEED_PULL_BACK = 0.34 (shipping)        0.260 m   <- here
//      SPEED_PULL_BACK = 1.5                    1.306 m
//      per-frame lerp, 0.2 per frame            2.018 m   <- nearest failure
//      per-frame lerp, 0.05 per frame           4.063 m
//    ```
//
//    So 1.0 m: four times the shipping value, half the cheapest thing that is
//    genuinely wrong. Tightening it towards 0.26 would be fitting the bound to
//    today's `dt`s rather than to the fault it is looking for.
const RAMP_PROBES = [0.1, 0.2, 0.3, 0.5, 0.8, 1.2];
let worstRateGap = 0;
let worstRateAt = 0;
let worstSlow = 0;
let worstFast = 0;
for (const at of RAMP_PROBES) {
  const slow = standOff(settle(32, 1 / 30, at));
  const fast = standOff(settle(32, 1 / 240, at));
  if (Math.abs(slow - fast) > worstRateGap) {
    worstRateGap = Math.abs(slow - fast);
    worstRateAt = at;
    worstSlow = slow;
    worstFast = fast;
  }
}
say(
  `           worst 30 Hz vs 240 Hz disagreement ${worstRateGap.toFixed(4)} m, ` +
    `${worstRateAt.toFixed(1)} s into the ramp (${worstSlow.toFixed(3)} vs ${worstFast.toFixed(3)} m)`,
);
require(
  worstRateGap < 1.0,
  `${worstRateAt.toFixed(1)} s into the same acceleration the camera stands ${worstSlow.toFixed(3)} m ` +
    `out at 30 Hz and ${worstFast.toFixed(3)} m at 240 Hz — ${worstRateGap.toFixed(3)} m apart, so ` +
    'the easing is tied to the frame rate. Both the follower and the zoom must ease on a half-life ' +
    'in seconds (see `damp`), never a per-frame lerp.',
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
    // "Into the park" is the reverse of the ring's own outward normal, not the
    // direction of the origin. Those were the same vector while the ring was a
    // circle centred there; on a ring that follows a spline edge they are not,
    // and pointing at the origin would call a perfectly good side view "not
    // looking into the park" wherever the boundary bulges.
    const frame = route.path.sampleAt(at);
    inward.set(-frame.normalX, 0, -frame.normalZ).normalize();

    const angled = flat.dot(travelAtRider);
    worst.mostAngled = Math.max(worst.mostAngled, angled);
    worst.leastAngled = Math.min(worst.leastAngled, angled);
    worst.leastInward = Math.min(worst.leastInward, flat.dot(inward));
    worst.mostPitch = Math.max(worst.mostPitch, Math.abs(Math.asin(forward.y)));

    // The rider must cross the screen left to right. Screen-right is the
    // camera's own local +X in world space, which is `matrixWorld`'s first column.
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    worst.leastRightward = Math.min(worst.leastRightward, right.dot(travelAtRider));

    // Outset, not radius: "is the rig outside the park?" is a question about the
    // edge, and the edge is 41 m further out on some bearings than others.
    const standsAt = -PARK_BOUNDARY.distanceToEdge(camera.position.x, camera.position.z);
    worst.outsideRing &&= standsAt > -PARK_BOUNDARY.distanceToEdge(point.x, point.z);
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
      `stands ≥${p.closestToPark.toFixed(0)} m outside the edge`,
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
    p.closestToPark > 0,
    `in a ${shape.name} window the rig stands ${p.closestToPark.toFixed(1)} m inside the park ` +
      "edge, where the park's own scenery is between it and the race.",
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

// --- does a duck bar actually clear a ducked head, and meet a standing one? --
//
// Jim, 5 August 2026: *"their head just passes through the bonkers like a ghost
// which looks very bad"*. A duck bar has no collider — a bonk is decided by
// button state at the crossing — so nothing in the game ever compared a bar's
// height to a head's, and `DUCK_CLEARANCE_AT_PARK_SCALE` had been set twice
// from a live reading that turns out to be 1.40 m out. The bar sat inside her
// head in *both* states, so ducking looked exactly as wrong as not ducking.
//
// Measured by composing the real transform chain rather than re-doing the sum:
// a real kid, parented into a real cart group at the ring's own scale, world
// matrices updated, and her head's bounding box read back — hair and all,
// because hair is what a family watches pass through a bar.

say('');
{
  const barGeometry = duckBarAssetGeometry('bar');
  barGeometry.computeBoundingBox();
  const barHalfDepth = barGeometry.boundingBox
    ? -barGeometry.boundingBox.min.y
    : 0;

  const railPoint = route.pointAt(
    PLAYER_LANE,
    route.wrap(route.startDistance),
    new Vector3(),
  );
  const cartGroup = new Group();
  cartGroup.position.copy(railPoint);
  cartGroup.scale.setScalar(route.scale);
  // A real cart, because the complaint was about her going through *it*.
  const rideCart = createCart(PALETTE.markerPink);
  cartGroup.add(rideCart.root);

  // --- the rider is a real `Player`, driven through her real update order ----
  //
  // **This used to pose a bare `createKid` and it is the reason this PR was
  // still broken behind a green build.** `poseRailRaceRider` is genuinely the
  // single owner of `body.rotation.x` — but on the player it was not the last
  // *writer*: `Player.update`'s riding branch runs `animate()` (where the pose
  // is applied) and *then* `applyRidePose`, which assigned `body.rotation.x =
  // 0.3` unconditionally. Calling the pose function directly, as this check
  // did, skips that second write entirely — so seated / duck / boost /
  // celebration measured 0.160 / 0.860 / 0.580 / −0.148 here while the game
  // drew 0.300 for all four, and this file printed "clears by 0.73" about a bar
  // that went through her head.
  //
  // So the rider below is a **real `Player`**, boarded the way `RailRace` boards
  // her and posed the way `RailRace.poseRider` poses her, and every height on
  // this page is read off the model *after* `Player.update` has finished with
  // it. A check that cannot see the player's own pipeline cannot see the player's
  // own bugs, however faithfully it calls the ride's functions.
  const player = new Player(new CollisionWorld(), new IsoCamera(), new Vector3());
  // `RailRace.requestBoard()`, in order.
  player.beginRide();
  player.model.root.scale.setScalar(RIDE_SCALE);
  // Her group sits where `poseRider` puts it: on the cart's seat, at ring scale.
  // `route.scale` for the seat and `RIDE_SCALE` for the model is not a slip — it
  // is exactly the split the ride makes, kept so a third ring would show up here
  // as a disagreement rather than as a silent pass.
  const seatY = railPoint.y + SEAT_HEIGHT * route.scale;

  /** A player who is aboard and pressing nothing — the riding branch reads no input. */
  const idleInput = {
    isDown: () => false,
    wasPressed: () => false,
    moveX: 0,
    moveY: 0,
  } as unknown as InputSystem;
  let riderFrame = 0;

  /**
   * Poses her by `rider` and returns the top of her head, hair included, in
   * metres over the rail head — **and her whole body's box**, because the
   * complaint that started this was not about her head at all.
   *
   * Everything here is the game's own: `RailRace.poseRider` sets the pose field
   * and the root's place, then `Player.update` runs the whole animation
   * pipeline over it. Nothing re-creates a pose — a check that re-created one
   * would prove only that two copies of the arithmetic agree with each other
   * while she folded through the floor in the game.
   */
  const pose = (
    rider: { duck: number; pump: number; cheer: number },
  ): { headTop: number; headAt: Vector3; headDepth: number; body: Box3 } => {
    // Seat her **first**, then pose — this order is `poseRider`'s and it is
    // load-bearing. Posing first and seating afterwards would quietly undo any
    // translation the pose performed, so the "root is still on the seat"
    // assertion below would be asserting the line above it rather than the
    // thing it names. That is the hollow-check disease this whole PR keeps
    // running into.
    player.setRidePose(railPoint.x, seatY, railPoint.z, 0, 0);
    player.railRaceRide = rider;
    player.update({
      dt: 1 / 60,
      elapsed: 1,
      input: idleInput,
      playerPosition: player.position,
      cameraForward: new Vector3(0, 0, 1),
      frame: riderFrame++,
    } satisfies FrameContext);
    player.group.updateMatrixWorld(true);
    const head = player.model.head;
    return {
      headTop: new Box3().setFromObject(head).max.y - railPoint.y,
      headAt: head.getWorldPosition(new Vector3()),
      // Along the track: the rider's group is positioned and scaled but never
      // rotated here, so the model's own forward is world +Z.
      headDepth: new Box3().setFromObject(head).getSize(new Vector3()).z,
      body: visibleBox(player.model.root),
    };
  };

  // Raced with the legs off, exactly as `RailRace.legsShow` has them — so what
  // is measured below is what a family can actually see. Measuring hidden legs
  // would fail the ride for clipping nobody will ever witness, and would miss
  // a torso that really did go through the floor.
  setRiderLegsVisible(player.model, false);

  const uprightPose = pose({ duck: 0, pump: 0, cheer: 0 });
  const duckedPose = pose({ duck: 1, pump: 0, cheer: 0 });
  const standing = uprightPose.headTop;
  const ducked = duckedPose.headTop;
  const barUnderside = DUCK_CLEARANCE_AT_PARK_SCALE * route.scale - barHalfDepth;

  say(
    `duck bar   underside ${barUnderside.toFixed(2)} m over the rail   ` +
      `head top ${ducked.toFixed(2)} ducked / ${standing.toFixed(2)} standing   ` +
      `clears by ${(barUnderside - ducked).toFixed(2)}, strikes by ` +
      `${(standing - barUnderside).toFixed(2)}`,
  );

  // Ducking has to work. This is the half that was broken: at the old 2.1 the
  // underside sat at 4.88 m against a ducked head top of 6.42, so a bar went
  // through her whichever way she played it.
  require(
    ducked < barUnderside,
    `a ducked rider's head reaches ${ducked.toFixed(2)} m over the rail and the duck bar's ` +
      `underside is at ${barUnderside.toFixed(2)} m — the bar passes through her head even when ` +
      'she does the one thing the ride asks of her. See DUCK_CLEARANCE_AT_PARK_SCALE.',
  );
  // ...and not ducking has to be worth avoiding, or the bar is decoration and
  // the whole mechanic is untaught. Raising the clearance until everything
  // clears would "fix" the complaint above and quietly delete the game.
  require(
    standing > barUnderside,
    `a standing rider's head only reaches ${standing.toFixed(2)} m over the rail and the duck ` +
      `bar's underside is at ${barUnderside.toFixed(2)} m — she passes under it without ducking, ` +
      'so there is nothing to duck for. See DUCK_CLEARANCE_AT_PARK_SCALE.',
  );
  // --- and does she stay inside the cart while she does it? -----------------
  //
  // The half of Jim's complaint that was never about the bar: *"ducking still
  // just lowers the player and clips them through the car."* A check that the
  // duck clears the bar would pass happily while her feet hung out of the
  // bottom of the cart, which is exactly what the translation this replaced
  // did — so the floor is asserted separately from the bar.
  cartGroup.updateMatrixWorld(true);
  const cartBox = new Box3().setFromObject(rideCart.root);
  // The tub's own floor, which `cart.ts` builds at the wheels' axle height so
  // the hopper clears them — the real surface she would come through, not the
  // bounding box's bottom (which is the underside of the wheels and would let a
  // torso sink through the whole cart before complaining).
  const tubFloor = cartBox.min.y + WHEEL_RADIUS * route.scale;
  say(
    `ducked rider   lowest visible ${duckedPose.body.min.y.toFixed(2)} against a tub floor at ` +
      `${tubFloor.toFixed(2)} (${(duckedPose.body.min.y - tubFloor).toFixed(2)} m clear)`,
  );
  require(
    duckedPose.body.min.y > tubFloor,
    `ducking puts the lowest part of the rider at ${duckedPose.body.min.y.toFixed(2)}, only ` +
      `${(duckedPose.body.min.y - tubFloor).toFixed(2)} m above the cart's tub floor — she has ` +
      `sunk out of the seat and through it. That is the whole of what "that's not ` +
      `what ducking means" was about: the fold must move \`body\`, never \`root\` — see ` +
      'railRace/duckPose.ts.',
  );
  // ...and the fold must be a fold. A pose that got its clearance by sliding
  // the whole child down would leave her somewhere other than the seat — either
  // by moving the model's own root, or by moving the group `setRidePose` put on
  // the seat. Both are checked, because either would be the translation Jim
  // rejected and only one of them is where the old bug lived.
  require(
    Math.abs(player.model.root.position.y) < 1e-6 &&
      Math.abs(player.group.position.y - seatY) < 1e-6,
    `the duck pose moved the rider off the seat — model root at ` +
      `${player.model.root.position.y.toFixed(3)} (should be 0) and her group at ` +
      `${player.group.position.y.toFixed(3)} against a seat at ${seatY.toFixed(3)}. That is a ` +
      'translation, not a duck.',
  );

  // --- the boost rock, the win jump, and the two of them meeting a duck ------
  //
  // **Assert the movement, not the flag.** Four times this PR has shipped a
  // "boost is active"/"she won" boolean that was set correctly while nothing on
  // screen moved a millimetre. So every one of these measures where her head
  // actually ends up, through the real pose function, in the real cart.
  // **The celebration is driven by the curve the game actually runs.** Feeding a
  // hand-picked `cheer: 1` in here would measure only that the pose *can* lift
  // her — it would stay green with `cheerAt` returning 0 forever, which is the
  // "she won, and nothing moved" bug in its purest form. And 1 is not even a
  // number the ride produces: the fade means the curve peaks near 0.90.
  //
  // Sampled at 60 Hz across the whole result phase, so the peak below is the
  // highest she is ever actually posed at, on the frame she is posed at it.
  const CHEER_TICK = 1 / 60;
  const cheerCurve: number[] = [];
  for (let t = 0; t <= RESULT_SECONDS; t += CHEER_TICK) cheerCurve.push(cheerAt(t));
  const cheerPeak = Math.max(...cheerCurve);
  // A hop is a run of frames off the ground: `max(0, sin)` leaves her at exactly
  // 0 between them, which is what makes it hopping rather than bobbing.
  let hops = 0;
  for (let i = 1; i < cheerCurve.length; i += 1) {
    if (cheerCurve[i]! > 0 && cheerCurve[i - 1]! === 0) hops += 1;
  }

  const pumpedPose = pose({ duck: 0, pump: 1, cheer: 0 });
  const cheeringPose = pose({ duck: 0, pump: 0, cheer: cheerPeak });
  const duckPumpPose = pose({ duck: 1, pump: 1, cheer: 0 });

  // --- ONE OWNER, AND THAT OWNER IS THE LAST WRITER --------------------------
  //
  // **The bug this whole PR exists to fix hid behind a green build for three
  // days, and this is the assertion that would have caught it on day one.**
  //
  // `poseRailRaceRider` is the single owner of `body.rotation.x` — that much was
  // true and was checked. What nobody checked is that it is the last thing to
  // *write* it. `Player.update`'s riding branch ran `animate()` (which ends by
  // applying the pose) and then `applyRidePose`, which assigned
  // `body.rotation.x = RIDE_POSE_BODY_PITCH` unconditionally. So the owner wrote
  // 0.160 / 0.860 / 0.580 / −0.148 for seated / duck / boost / celebration, and
  // the screen showed **0.300 for all four**: the waist fold, the boost rock and
  // the celebration lean were invisible for the player, every frame, and only
  // the squash and the hip drop survived — 0.42 m of duck against the 0.73 m the
  // clearance is sized for, so the duck bar went through her head *while she was
  // ducking* and the line above printed "clears by 0.73".
  //
  // "One owner" is therefore not a property of a module; it is a property of an
  // **order**, and an order can only be checked by running it. So this compares
  // what the real `Player` ends up drawing against what the owner asked for on a
  // bare kid — two numbers from genuinely different places, neither able to
  // satisfy the other. Any fourth claimant assigning to the body after the pose
  // fires it, whatever it is called and however well-meant.
  const reference = createKid({ outfit: 0xffffff, hairStyle: 'short' });
  const POSE_STATES: readonly { readonly name: string; readonly rider: RiderPose }[] = [
    { name: 'seated', rider: SEATED },
    { name: 'duck', rider: { duck: 1, pump: 0, cheer: 0 } },
    { name: 'boost', rider: { duck: 0, pump: 1, cheer: 0 } },
    { name: 'celebration', rider: { duck: 0, pump: 0, cheer: cheerPeak } },
  ];
  const poseReport: string[] = [];
  for (const state of POSE_STATES) {
    pose(state.rider);
    poseRailRaceRider(reference, state.rider);
    const drawn = player.model.body.rotation.x;
    const asked = reference.body.rotation.x;
    poseReport.push(`${state.name} ${drawn.toFixed(3)}`);
    require(
      Math.abs(drawn - asked) < 1e-6,
      `the player's '${state.name}' pose never reaches the screen: poseRailRaceRider asks for ` +
        `body.rotation.x = ${asked.toFixed(3)} and Player.update leaves it at ` +
        `${drawn.toFixed(3)}. Something writes the body AFTER the pose does — check the order in ` +
        'Player.update/Player.animate. The owner of a property has to be its last writer, and ' +
        'the answer is never a fourth writer to patch over the third.',
    );
  }
  say(`pose drawn   ${poseReport.join('   ')}   (as poseRailRaceRider asked)`);
  reference.dispose?.();

  const rockThrow = pumpedPose.headAt.distanceTo(uprightPose.headAt);
  const cheerLift = cheeringPose.headTop - uprightPose.headTop;
  say(
    `boost rock   head throws ${rockThrow.toFixed(2)} m on a pump   ` +
      `win jump ${cheerLift.toFixed(2)} m of lift`,
  );
  say(
    `celebration  ${hops} hops, peaking at ${cheerPeak.toFixed(3)} of the jump, ` +
      `settled by ${(cheerCurve.findLastIndex((v) => v > 0) * CHEER_TICK).toFixed(2)} s of ` +
      `${RESULT_SECONDS} s on screen`,
  );
  // Jim asked for the boost to be *felt*. A rock nobody can see is the same
  // non-feature as a face nobody can look at.
  require(
    rockThrow > 0.4 * route.scale,
    `a full pump moves the rider's head by only ${rockThrow.toFixed(3)} m — at the ~37 px/m this ` +
      'ride draws her at, that is not visual feedback. See BOOST_ROCK in railRace/duckPose.ts.',
  );
  // The win jump has to leave the seat, upwards and visibly — **at the height
  // the real curve reaches**, not at a 1 it never gets to.
  require(
    cheerLift > 0.3 * route.scale,
    `winning lifts the rider only ${cheerLift.toFixed(3)} m at the celebration's own peak of ` +
      `${cheerPeak.toFixed(3)} — she is meant to jump in the cart, and this would read as sitting ` +
      'still. See CHEER_HOP in duckPose.ts, and cheerAt for the curve that drives it.',
  );
  // Jumping, not hovering: she has to come down and go again.
  require(
    hops >= 2,
    `the celebration is ${hops} hop(s) — Jim asked for her to jump while the camera holds, and ` +
      'one long rise reads as being lifted. See cheerAt.',
  );
  // And it has to be over while the camera is still on her, so the last hop
  // lands rather than being cut off in mid-air by the result card.
  require(
    cheerCurve[cheerCurve.length - 1] === 0,
    `she is still ${cheerCurve[cheerCurve.length - 1]!.toFixed(3)} of the way through a jump when ` +
      `the result card goes at ${RESULT_SECONDS} s — the last hop is cut off in the air. ` +
      'See CHEER_SECONDS.',
  );
  // ...and she must still be *in* it, not launched through the seat.
  require(
    cheeringPose.body.min.y > tubFloor,
    `the win jump puts her lowest visible part at ${cheeringPose.body.min.y.toFixed(2)}, below the ` +
      `cart's tub floor at ${tubFloor.toFixed(2)}.`,
  );
  require(
    Math.abs(player.model.root.position.y) < 1e-6 &&
      Math.abs(player.group.position.y - seatY) < 1e-6,
    `the celebration moved the rider off the seat — model root at ` +
      `${player.model.root.position.y.toFixed(3)} (should be 0) and her group at ` +
      `${player.group.position.y.toFixed(3)} against a seat at ${seatY.toFixed(3)} — the ride ` +
      'never moves the root.',
  );

  // **Boosting while ducking.** A child will hold boost under a bar — keyboard
  // duck and keyboard boost are genuinely independent signals — and `Rider.bob`
  // is set from the raw press whether or not it registered as thrust. If the
  // rock were not gated by the fold, she would throw forward on top of a 40°
  // crouch and her head would come up out of the duck she is relying on.
  say(
    `ducking while boosting   head top ${duckPumpPose.headTop.toFixed(2)} against ` +
      `${duckedPose.headTop.toFixed(2)} ducked alone (bar underside ${barUnderside.toFixed(2)})`,
  );
  require(
    duckPumpPose.headTop < barUnderside,
    `a rider who holds boost while ducking reaches ${duckPumpPose.headTop.toFixed(2)} m over the ` +
      `rail, and the bar's underside is at ${barUnderside.toFixed(2)} — mashing under a bar takes ` +
      'the duck away from her. The rock must be gated by the fold; see poseRailRaceRider.',
  );
  require(
    duckPumpPose.body.min.y > tubFloor,
    `ducking while boosting puts her lowest visible part at ${duckPumpPose.body.min.y.toFixed(2)}, ` +
      `through the cart's tub floor at ${tubFloor.toFixed(2)}.`,
  );

  // **Boosting into the celebration**, which is the other pair that shares
  // `body.rotation.x` — a pump throws the torso forward, the jump leans it back,
  // so where they overlap they subtract and she straightens up out of her own
  // celebration.
  //
  // They are kept apart not by a gate but by the clock, and this is the guard on
  // that: `simulate.ts`'s spring is empty `BOB_SECONDS` after her last press,
  // and the first hop of `cheerAt` does not peak until later, so by the time the
  // jump is worth looking at the rock is already zero. A gate was tried instead
  // and thrown away — being proportional it leaked 9.5% of the rock at the
  // curve's own peak, i.e. it did not do the thing it was named for.
  //
  // This compares two numbers from genuinely different modules, so lengthening
  // the spring or quickening the hop fires it.
  const cheerPeakAt = cheerCurve.indexOf(cheerPeak) * CHEER_TICK;
  say(
    `spring vs jump   pump spring empty at ${BOB_SECONDS.toFixed(2)} s, jump peaks at ` +
      `${cheerPeakAt.toFixed(2)} s`,
  );
  require(
    BOB_SECONDS < cheerPeakAt,
    `the pump spring is still unwinding (${BOB_SECONDS.toFixed(2)} s) when the victory jump peaks ` +
      `at ${cheerPeakAt.toFixed(2)} s, so the boost rock is subtracting from the celebration lean ` +
      'at the top of her jump and she straightens up instead of throwing her arms open. Either ' +
      'shorten BOB_SECONDS, slow CHEER_HOP_SECONDS, or gate the pump on the cheer inside ' +
      'poseRailRaceRider.',
  );

  // --- the approach-frame skull graze, rechecked at the new speeds ----------
  //
  // Her head is enormous (a cartoon child at ride scale), so its *front* reaches
  // a bar well before her centre does — and the bonk fires at her centre. For
  // the frames in between, the bar is inside the top of her skull while she is
  // still upright, before the knock-down folds her.
  //
  // Reported rather than asserted, deliberately. The fix is a ~1.9 m contact
  // lead subtracted inside `planHazards` so every consumer sees one number, and
  // it moves *when the bonk fires* — immediately after a PR that fixed the bonk
  // firing in the wrong place. It wants eyes on it before it ships, and this
  // line is here so the size of the artefact is on the screen at every build
  // rather than being rediscovered by measurement each round.
  const skullReach = uprightPose.headDepth / 2 + barHalfDepth;
  const childRace = simulateRailRace('childPace', 3);
  // Her top speed, not her average: she arrives at a bar still mashing, and a
  // race's average is dragged down by the standing start and every bonk in it.
  const frames = skullReach / (childRace.topSpeed / 60);
  say(
    `skull graze   bar is inside her head for the last ${skullReach.toFixed(2)} m of the approach ` +
      `— ${frames.toFixed(1)} frames at a child's ${childRace.topSpeed.toFixed(1)} m/s top speed ` +
      `(fix: a BAR_CONTACT_LEAD in planHazards; not shipped, wants eyes)`,
  );

  // --- the legs: off racing, on to celebrate, on when she leaves -------------
  //
  // Jim asked for three states in one ride, and the rule is a **derivation from
  // the phase**, never a remembered list — `TreeClimbing.hidePlayerBody` kept
  // such a list, recorded an empty restore set on its second call, and left her
  // a floating head on every other ride in the park until it was deleted.
  //
  // So this puts the real rule through the real setter for **every** phase the
  // ride has, and reads the result back off the model — including the box, so a
  // rule that set a flag nobody drew from would still be caught.
  const PHASES: readonly RidePhase[] = [
    'waiting',
    'levelSelect',
    'countdown',
    'racing',
    'finishing',
  ];
  const WANT_LEGS: Record<RidePhase, boolean> = {
    waiting: true,
    levelSelect: true,
    countdown: false,
    racing: false,
    finishing: true,
  };
  pose(SEATED);
  const legParts = [player.model.leftLeg, player.model.rightLeg];
  require(
    legParts.every((part) => part !== undefined && part !== null),
    'the rider has no legs to show or hide, so everything below this line is vacuous.',
  );
  const legReport: string[] = [];
  for (const phase of PHASES) {
    setRiderLegsVisible(player.model, riderLegsShow(phase));
    player.group.updateMatrixWorld(true);
    const drawn = legParts.every((part) => part?.visible === true);
    const reach = visibleBox(player.model.root).min.y;
    legReport.push(`${phase} ${drawn ? 'on' : 'off'}`);
    require(
      drawn === WANT_LEGS[phase],
      `in phase '${phase}' the rider's legs are ${drawn ? 'drawn' : 'hidden'} and they should be ` +
        `${WANT_LEGS[phase] ? 'drawn' : 'hidden'} — off while racing because they clip through the ` +
        'cart, on for the win because Jim asked to see her jump, on once she is off. See ' +
        'riderLegsShow in duckPose.ts.',
    );
    // The flag has to reach the picture. A `visible` that no bounding box
    // notices is a `visible` nothing renders from either.
    require(
      Number.isFinite(reach),
      `phase '${phase}' leaves the rider with no drawable geometry at all (box min ${reach}).`,
    );
  }
  const legsRacing = (() => {
    setRiderLegsVisible(player.model, riderLegsShow('racing'));
    player.group.updateMatrixWorld(true);
    return visibleBox(player.model.root).min.y;
  })();
  const legsWinning = (() => {
    setRiderLegsVisible(player.model, riderLegsShow('finishing'));
    player.group.updateMatrixWorld(true);
    return visibleBox(player.model.root).min.y;
  })();
  say(`legs         ${legReport.join('   ')}`);
  say(
    `             racing reaches down to ${legsRacing.toFixed(2)}, celebrating to ` +
      `${legsWinning.toFixed(2)} (tub floor ${tubFloor.toFixed(2)})`,
  );
  // The two states must differ *in the drawn geometry*, or the rule is switching
  // something that was never on screen — which is how a "hidden" leg goes on
  // clipping through the cart in front of a six-year-old.
  require(
    legsWinning < legsRacing - 1e-6,
    `hiding the legs changes nothing about what is drawn: racing reaches ${legsRacing.toFixed(3)} ` +
      `and celebrating ${legsWinning.toFixed(3)}. The legs were never the lowest thing, so this ` +
      'rule is not doing what it is documented to do.',
  );

  // --- the pump spring unwinds after the line --------------------------------
  //
  // `stepRider` returns early once a rider has finished, and the `bob` decay sat
  // below that return — so `bob` froze at whatever the last racing frame held,
  // which for a child mashing across the line is exactly 1, for the whole result
  // phase. Nothing read it until the boost rock did; then the winner spent her
  // victory jump thrown forward over the handlebars, and every finished rival
  // sat locked at the bottom of its seat dip.
  //
  // Driven through the real stepper, with the button **still held** — a child
  // does not stop tapping the instant she crosses the line, and a fix that only
  // worked for a released button would not have covered the case that broke.
  const springRider = createRider(0);
  const springHazards = scheduleForLevel(3);
  const dtSpring = 1 / 60;
  let springSeconds = 0;
  while (!springRider.finished && springSeconds < 400) {
    stepRider(
      route,
      springRider,
      springHazards,
      { pressed: true, ducking: false },
      dtSpring,
      1,
      PLAYER_BOOST_ADVANTAGE,
  BOB_SECONDS,
    );
    springSeconds += dtSpring;
  }
  const bobAtLine = springRider.bob;
  // A full result phase of standing at the line, still mashing.
  for (let t = 0; t < RESULT_SECONDS; t += dtSpring) {
    stepRider(
      route,
      springRider,
      springHazards,
      { pressed: true, ducking: false },
      dtSpring,
      1,
      PLAYER_BOOST_ADVANTAGE,
  BOB_SECONDS,
    );
  }
  say(
    `pump spring  ${bobAtLine.toFixed(2)} crossing the line, ${springRider.bob.toFixed(2)} after ` +
      `${RESULT_SECONDS} s of celebrating (still holding the button)`,
  );
  require(
    springRider.bob === 0,
    `the pump spring is still wound to ${springRider.bob.toFixed(3)} ${RESULT_SECONDS} s after the ` +
      'race ended, so the winner celebrates thrown forward on a pump that is long over (BOOST_ROCK) ' +
      'and finished rivals sit stuck in their seat dip (BOB_DROP). The decay must run before ' +
      "stepRider's `if (rider.finished)` return.",
  );

  player.dispose();
}

// --- can you actually SEE her face? ------------------------------------------
//
// PR #223 gave the riders a frowning expression for a bonk. It was invisible in
// normal play, and every check passed anyway, because "the frown state was set"
// is not the same claim as "somebody can see a frown" — the face was pointing
// 81° away from the lens. Jim, riding it on 5 August 2026: *"we can't see the
// face because the player needs to face towards the camera so you can see their
// expression."*
//
// So this asserts **visibility**, and does it the only way that cannot be
// fooled: it builds a real kid, poses her with `faceTurnTowardsCamera` — the
// very function the ride poses her with, not a copy of it — and then asks each
// of her two eyes two questions off the real projection matrix.
//
//   1. Is this eye on the near side of her head at all? Every eye sits on the
//      skull's own surface (the face is baked into its UVs, ART_DIRECTION §3),
//      so the outward normal there dotted with the direction to the camera is
//      exactly "is this bit of face turned towards the lens or round the back".
//      Zero or less means the eye is behind the silhouette and is not drawn.
//   2. Does it land on screen?
//
// Measured before the turn existed, for the record: the far eye sat at −0.254
// on a monitor and −0.348 on a phone — genuinely not rendered — while the near
// one grazed at 0.48/0.39 and *both* projected to the same screen x, which is
// what a profile looks like in numbers.

say('');

/**
 * How square-on the *worse* of the two eyes must sit to the lens to read as an
 * eye. Zero is the hard floor — at zero it is behind the silhouette and simply
 * is not rendered — so this is a real margin over "technically drawn".
 */
const EYE_FACING_MIN = 0.35;

/**
 * ...and how far inside the picture it must stay, in NDC. Small, because a
 * phone in portrait frames her hard left on purpose (`RIDER_SCREEN_X_PORTRAIT`)
 * and there is genuinely not much room out there — but not zero, or "just
 * barely on screen" would pass and the next tweak to the framing would push her
 * face off the edge with nothing complaining.
 */
const EYE_MARGIN_MIN = 0.03;

interface FaceView {
  readonly worstFacing: number;
  readonly worstOnScreen: number;
  readonly eyeSpread: number;
  readonly turn: number;
}

function faceView(width: number, height: number, sadness: number): FaceView {
  rig.resize(width, height);
  const kid = createKid({ outfit: 0xffffff, hairStyle: 'short' });
  const root = new Group();
  root.add(kid.root);
  const crown = kid.hatAnchor.parent;
  if (!crown) throw new Error('check-rail-race: the kid rig has no crown under its hat anchor');

  let worstFacing = 1;
  let worstOnScreen = 1;
  let eyeSpread = 1;
  let turn = 0;
  const eye = new Vector3();
  const normal = new Vector3();
  const toCamera = new Vector3();
  const skull = new Vector3();

  for (let i = 0; i < 48; i += 1) {
    const travelled = (i / 48) * route.length;
    rig.reset(travelled);
    const at = route.wrap(route.startDistance + travelled);
    const point = route.pointAt(PLAYER_LANE, at, new Vector3());
    const tangent = route.tangentAt(PLAYER_LANE, at, new Vector3());
    const cartYaw = Math.atan2(tangent.x, tangent.z);

    // Exactly `RailRace.poseRider`'s pose: the cart's yaw plus the body's share
    // of the turn on the root, the head's share on the head.
    const facing = faceTurnTowardsCamera(cartYaw, point, rig.camera.position, sadness);
    turn = facing.body + facing.head;
    root.position.set(point.x, point.y + SEAT_HEIGHT * route.scale, point.z);
    root.rotation.y = cartYaw + facing.body;
    root.scale.setScalar(route.scale);
    kid.head.rotation.y = facing.head;
    root.updateMatrixWorld(true);

    crown.getWorldPosition(skull);
    const screenX: number[] = [];
    for (const side of [-1, 1] as const) {
      crown.localToWorld(eye.copy(kidEyeCentre(side)));
      normal.subVectors(eye, skull).normalize();
      toCamera.subVectors(rig.camera.position, eye).normalize();
      worstFacing = Math.min(worstFacing, normal.dot(toCamera));
      const ndc = eye.clone().project(rig.camera);
      worstOnScreen = Math.min(worstOnScreen, 1 - Math.max(Math.abs(ndc.x), Math.abs(ndc.y)));
      screenX.push(ndc.x);
    }
    eyeSpread = Math.min(eyeSpread, Math.abs((screenX[0] ?? 0) - (screenX[1] ?? 0)));
  }
  kid.dispose?.();
  return { worstFacing, worstOnScreen, eyeSpread, turn };
}

for (const shape of POSES) {
  // --- sad: she looks round at you, and the frown is worth having ------------
  const view = faceView(shape.w, shape.h, 1);
  say(
    `face ${shape.name.padEnd(9)} sad: turned ${((view.turn * 180) / Math.PI).toFixed(1)}°   ` +
      `worst eye facing ${view.worstFacing.toFixed(3)}   ` +
      `on screen by ${view.worstOnScreen.toFixed(3)}   ` +
      `eyes ${view.eyeSpread.toFixed(3)} apart across the picture`,
  );

  require(
    view.worstFacing > EYE_FACING_MIN,
    `in a ${shape.name} window one of the rider's eyes is only ${view.worstFacing.toFixed(3)} ` +
      `turned towards the lens (needs > ${EYE_FACING_MIN}); at 0 it is round the back of her ` +
      'head and not drawn at all, and an expression nobody can see is not a feature. See ' +
      'FACE_TURN_MAX in railRace/camera.ts.',
  );
  require(
    view.worstOnScreen > EYE_MARGIN_MIN,
    `in a ${shape.name} window one of the rider's eyes is only ` +
      `${view.worstOnScreen.toFixed(3)} inside the edge of the picture (needs > ` +
      `${EYE_MARGIN_MIN}). She is framed by RIDER_SCREEN_X and turning her pushes her face ` +
      'towards that edge — see the sweep table on FACE_TURN_MAX.',
  );
  // A profile puts both eyes on the same pixel column. Any real turn separates
  // them, and the separation is the plainest possible statement that we are
  // looking at a face rather than at the side of a head.
  require(
    view.eyeSpread > 0.01,
    `in a ${shape.name} window the rider's two eyes land ${view.eyeSpread.toFixed(4)} apart ` +
      'across the picture — they are stacked, which is what a face in profile looks like.',
  );

  // --- and NOT sad: she watches where she is going ---------------------------
  //
  // The other half, and it is not optional. Jim asked for the turn *"only on
  // sad expression, not all the time"*, and a check that only ever exercised
  // the sad case would sail through while she rode the entire race with her
  // head cricked round at the camera — which is the complaint that started all
  // this, inverted. So the happy case is asserted just as hard: no turn at all,
  // and a face genuinely back in profile, watching the track.
  const calm = faceView(shape.w, shape.h, 0);
  say(
    `face ${shape.name.padEnd(9)} calm: turned ${((calm.turn * 180) / Math.PI).toFixed(1)}°   ` +
      `eyes ${calm.eyeSpread.toFixed(4)} apart (stacked = facing down the track)`,
  );
  require(
    calm.turn === 0,
    `in a ${shape.name} window a rider who is not sad is still turned ` +
      `${((calm.turn * 180) / Math.PI).toFixed(1)}° towards the camera. The turn is meant to be ` +
      'part of the frown, not the resting pose — see FACE_TURN_MAX in railRace/camera.ts.',
  );
  require(
    calm.eyeSpread < 0.01,
    `in a ${shape.name} window a rider who is not sad has her eyes ${calm.eyeSpread.toFixed(4)} ` +
      'apart across the picture, so she is angled towards the camera rather than watching the ' +
      'track. Only a frown should turn her.',
  );
}
require(
  FACE_TURN_MAX > 0,
  'FACE_TURN_MAX is zero, so nobody turns towards the camera and every face in the race is ' +
    'in profile again.',
);

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
const childField = fieldSummary('childPace');
const badlyField = fieldSummary('playsBadly');
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
const childMeanMargin = childField.margins.reduce((a, b) => a + b, 0) / childField.margins.length;
say(
  `child pace vs field       ${childField.wins}/${FIELD_SEEDS.length} wins   ` +
    `margin ${Math.min(...childField.margins).toFixed(1)}–${Math.max(...childField.margins).toFixed(1)} m ` +
    `(mean ${childMeanMargin.toFixed(1)} m)   ${CHILD_TAPS_PER_SECOND} taps/s, half the bars`,
);
say(`plays badly vs field      ${badlyField.wins}/${FIELD_SEEDS.length} wins   (must not be all of them)`);

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
// ...and nobody gets lapped.
//
// **This bound was 170 m and had to be re-derived on 6 August 2026 — not
// loosened to make a seed pass, but rebuilt, because the number it held was
// arithmetically incompatible with the instruction the game is now tuned to.**
// Jim: *"it's just too hard ffs, you go too slow and the computer goes too
// fast."* Work the 170 backwards and it demands rivals cruising at 27.8 m/s,
// which needs them mashing at 5.7 taps a second — a `RIVAL_SKILL` of ~0.86,
// i.e. almost exactly the 0.62/0.72/0.82 the family had already rejected once
// as "far too good". The old bound was held up by an aggressive rubber band
// that towed a far-behind rival to *38.9 m/s*, faster than the player's own top
// speed, so it came screaming back into shot: the very thing Jim is describing.
// A bound that can only be met by reinstating the complaint is not a bound.
//
// So it is replaced by the one that is a real, physical fact about the race
// rather than a tuning preference: **the nearest rival must not have been
// lapped.** It is taken from the game's own geometry (`route.length`), in the
// spirit of CLAUDE.md's rule about thresholds coming from the game rather than
// from the generator's target, and it still fires loudly if the field ever
// becomes scenery. It also protects something concrete — three rivals still on
// the track when she crosses the line, which is what the win celebration needs
// to hold a camera on.
require(
  Math.max(...perfectField.margins) < route.length,
  `playing well finishes as much as ${Math.max(...perfectField.margins).toFixed(1)} m clear of the ` +
    `nearest rival, which laps them on a ${route.length.toFixed(1)} m lap — the rivals have become ` +
    "scenery. Raise RIVAL_SKILL or the rubber band's SWING_BEHIND.",
);
// **The assertion Jim's complaint needed, and the build did not have.**
//
// Every strategy above taps 6 times a second. A child does not, and that single
// axis decided the whole race: measured at 3 taps/s with half the bars ducked,
// she won *1 of 24 seeds* while `mashPerfect` and `mashSloppy` both read as
// comfortable and every check in the build was green. Assert the player the
// game is actually for, not a metronome. See `PLAYER_BOOST_ADVANTAGE`.
require(
  childField.wins >= FIELD_SEEDS.length - 2,
  `a child tapping ${CHILD_TAPS_PER_SECOND}/s and ducking half the bars wins only ${childField.wins}/` +
    `${FIELD_SEEDS.length} seeds — this is the "too hard" complaint, unfixed. Raise ` +
    'PLAYER_BOOST_ADVANTAGE or lower RIVAL_SKILL.',
);
require(
  childMeanMargin > 40,
  `a child at ${CHILD_TAPS_PER_SECOND} taps/s wins by a mean of only ${childMeanMargin.toFixed(1)} m — ` +
    'close enough to read as a photo finish every time rather than a win. Jim asked to err well on ' +
    'the easy side.',
);
// ...and the other end of it, because after 6 August nothing guarded that end at
// all. The floor above says a child's win must be *visible*; this says it must
// still be a **race**. Between them the margin is bounded on both sides, which is
// what the retired 140 m bound used to do for a different player before it went
// 140 → 170 → `route.length` and moved onto `mashPerfect`.
//
// **A bound on the *worst* seed cannot do this job, and that is measured, not
// assumed.** `SWING_BEHIND`'s rubber band tows a far-behind rival forward, which
// compresses exactly the number a max-bound would read. Sweeping the rivals down
// to a quarter of their skill:
//
//   RIVAL_SKILL              child margin (24 seeds)      mean
//   0.40 / 0.48 / 0.56        27.3 – 306.2 m             114.8   <- shipping
//   0.30 / 0.36 / 0.42        64.3 – 389.9 m             219.4
//   0.20 / 0.24 / 0.28       187.9 – 484.5 m             316.4
//   0.10 / 0.12 / 0.14       308.0 – 529.1 m             425.4
//
// The max never reaches even one lap (600.2 m) however absurd the rivals get, so
// `max(...) < route.length` — the shape the `mashPerfect` bound uses — would be a
// guard incapable of failing here. The mean separates all four cleanly, and the
// handoff already says so about a different question: win count is seed noise,
// mean margin is the signal.
//
// Half a lap, from the game's own geometry rather than a preference, and it
// protects something you can see: the camera holds on her for the whole
// celebration, and a rival half a lap back is round the far side of the ring and
// not in the picture at all. Met today at 114.8 m with 2.6x of room — the point
// is to catch a runaway, not to pin the tuning Jim has already approved — and it
// fires at rivals cut to half skill (316.4 m).
const CHILD_PROCESSION_MARGIN = route.length / 2;
require(
  childMeanMargin < CHILD_PROCESSION_MARGIN,
  `a child at ${CHILD_TAPS_PER_SECOND} taps/s wins by a mean of ${childMeanMargin.toFixed(1)} m on a ` +
    `${(route.length * RACE_LAPS).toFixed(1)} m race — over the ${CHILD_PROCESSION_MARGIN.toFixed(1)} m ` +
    'half-lap bound, so the field is half a ring behind her and off screen for the entire finish. ' +
    'That is a procession, not a race she won. Raise RIVAL_SKILL, or lower PLAYER_BOOST_ADVANTAGE ' +
    'in simulate.ts.',
);
// The one guard rail Jim left standing: *"she must still be able to lose if she
// plays badly"*. This replaces the old `sloppyField.wins < 24`, which asserted
// the right idea about the wrong player — `mashSloppy` taps at 6/s, so it is
// not a careless child, it is a metronome that forgets bars, and it now wins
// every seed by design. `playsBadly` is the careless one: 1.2 taps/s, ducks a
// tenth of the bars, mashes through every black stretch.
require(
  badlyField.wins < FIELD_SEEDS.length / 4,
  `playing badly still wins ${badlyField.wins}/${FIELD_SEEDS.length} seeds — a race that cannot be ` +
    'lost teaches nothing and is the one thing Jim ruled out. Raise RIVAL_SKILL.',
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
say(`one lap is ${route.length.toFixed(1)} m`);

if (problems.length > 0) {
  console.error('');
  for (const problem of problems) console.error(`FAIL: ${problem}`);
  process.exitCode = 1;
} else {
  console.log('');
  console.log('rail race: OK');
}
