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
  type RaceLevel,
} from '../src/world/railRace/simulate.ts';
import {
  FACE_TURN_MAX,
  RaceCamera,
  faceTurnTowardsCamera,
} from '../src/world/railRace/camera.ts';
import { SEAT_HEIGHT, WHEEL_RADIUS } from '../src/world/railRace/cart.ts';
import { measureRaceCamera, POSES } from './lib/raceCameraFindings.mts';
import { DUCK_CLEARANCE_AT_PARK_SCALE } from '../src/world/railRace/hazards.ts';
import {
  BONK_SWAY,
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
import { Box3, DoubleSide, Group, Matrix4, Mesh, Object3D, Raycaster } from 'three';
import { placeRaceCart, seatRaceRider, type CartHeading } from '../src/world/railRace/seat.ts';
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
function visibleBox(root: Object3D, into: Matrix4 | null = null, visibleOnly = true): Box3 {
  const box = new Box3();
  root.updateWorldMatrix(true, true);
  const toFrame = new Matrix4();
  const corner = new Vector3();
  root.traverse((child) => {
    if (visibleOnly) {
      if (!child.visible) return;
      let node: Object3D | null = child;
      while (node && node !== root) {
        if (!node.visible) return;
        node = node.parent;
      }
    }
    if (!(child instanceof Mesh)) return;
    const geometry = child.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const local = geometry.boundingBox;
    if (!local || local.isEmpty()) return;
    // The eight corners of the mesh's own box, taken into `into`'s frame —
    // exactly what `Box3.expandByObject` does into the world frame when `into`
    // is null, so an upright cart reads the same numbers either way.
    toFrame.copy(child.matrixWorld);
    if (into) toFrame.premultiply(into);
    for (let i = 0; i < 8; i += 1) {
      corner
        .set(
          i & 1 ? local.max.x : local.min.x,
          // flat-ok: a mesh's own geometry box, in its own frame — the corners are then taken into the cart's frame
          i & 2 ? local.max.y : local.min.y,
          i & 4 ? local.max.z : local.min.z,
        )
        .applyMatrix4(toFrame);
      box.expandByPoint(corner);
    }
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
  // **Climb is measured as rise above the lane's own base, not as world `y`.**
  // `heightAt` is `baseAt + undulation`, and `baseAt` is the sphere's cap under
  // the lane's own column plus the ring's clearance — so a world-`y` sum carries
  // the planet's curvature inside it, and the outer lanes, whose columns sit
  // further round the cap, "climb" more for nothing. Measured at scale 1 on the
  // canonical seed: world `y` gave a spread of **13.758 m** (lanes 34.3–48.1 m);
  // radius from the planet's centre gives **0.116 m**, the remainder being the
  // terrain waves, which `terrainHeight` adds along world `y` rather than
  // radially; this gives the undulation alone, which is also the only thing
  // `simulate.ts` integrates (`slopeAt`). Every lane rides the same hills.
  // Before the sphere `baseAt` was the single number `route.base`, so this is the
  // quantity the clause always measured.
  let previous = route.heightAt(lane, 0) - route.baseAt(0, lane);
  for (let i = 1; i <= SAMPLES; i += 1) {
    const distance = (i / SAMPLES) * route.length;
    const height = route.heightAt(lane, distance);
    const rise = height - route.baseAt(distance, lane);
    if (rise > previous) facts.climb += rise - previous;
    previous = rise;
    facts.steepest = Math.max(facts.steepest, Math.abs(route.slopeAt(lane, distance)));
    // The flat point, so the ground is asked in the same column as `height`.
    route.flatPointAt(lane, distance, point);
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

// --- the camera: measured by `scripts/lib/raceCameraFindings.mts` ---------------
//
// The whole of this check's camera section lives there now, verbatim, so the
// park acceptance loop asks the same questions of every attempt. See that file.
const rig = new RaceCamera(route);
{
  const camera = measureRaceCamera(route, rig);
  for (const line of camera.said) say(line);
  problems.push(...camera.problems);
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

  // **The cart is placed by the game's own `placeRaceCart`, lean and all.**
  //
  // This used to build its own group with a position, a scale and no rotation,
  // and seat the rider straight up world `+Y`. Once the ring was leant onto the
  // sphere the game's tub leant with it and this one did not — so every clause
  // below measured an upright tub against a leant rider the game never draws,
  // and reported her ducking 0.53 m through a floor that was not there. The
  // placement and the seating now come from `railRace/seat.ts`, the same
  // functions `RailRace.placeCarts`/`poseRider` call.
  const cartGroup = new Group();
  const cartHeading: CartHeading = { yaw: 0, pitch: 0 };
  placeRaceCart(route, PLAYER_LANE, route.wrap(route.startDistance), cartGroup, cartHeading);
  cartGroup.scale.setScalar(route.scale);
  const railPoint = cartGroup.position;
  // **Every height and width below is read in the cart's own frame**: origin at
  // the rail head, `+Y` the tub's up, `+X` across it, `+Z` along the track. On a
  // leant ring world `y` is none of those, so "above the tub floor" has to be
  // asked in the frame the tub is built in or it measures the lean instead.
  const cartFrame = new Matrix4().compose(
    cartGroup.position,
    cartGroup.quaternion,
    new Vector3(1, 1, 1),
  );
  const toCart = cartFrame.clone().invert();
  say(
    `pose cart    at ${route.wrap(route.startDistance).toFixed(1)} m, leant ` +
      // flat-ok: world +Y is the datum the cart's lean is being reported AGAINST
      `${((new Vector3(0, 1, 0).applyQuaternion(cartGroup.quaternion).angleTo(new Vector3(0, 1, 0)) * 180) / Math.PI).toFixed(1)}° off world +Y`,
  );
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
  const seatLift = SEAT_HEIGHT * route.scale;
  /** The last sway she was seated at, so the seat assertions know where the seat is. */
  let seatedSway = 0;
  /** Where she is sitting, in the cart's frame — should be `(sway, seatLift, 0)`. */
  const seatInCart = (): Vector3 => player.group.position.clone().applyMatrix4(toCart);
  const offSeat = (): number => seatInCart().distanceTo(new Vector3(seatedSway, seatLift, 0));

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
    /**
     * Sideways slide of the rider **relative to the cart**, in world metres.
     *
     * `RailRace.poseRider` places her at `cart.position.x + wobble` while the
     * cart itself stays at `cart.position.x`, so after a bonk she really does
     * travel across the tub she is sitting in. It is not part of `RiderPose`,
     * which is exactly why sweeping the pose cube alone said everything was
     * fine while Jim watched her hands come through.
     */
    sway = 0,
  ): { headTop: number; headAt: Vector3; headDepth: number; body: Box3 } => {
    // Seat her **first**, then pose — this order is `poseRider`'s and it is
    // load-bearing. Posing first and seating afterwards would quietly undo any
    // translation the pose performed, so the "root is still on the seat"
    // assertion below would be asserting the line above it rather than the
    // thing it names. That is the hollow-check disease this whole PR keeps
    // running into.
    seatedSway = sway;
    seatRaceRider(player, cartGroup, cartHeading, route.scale, sway, 0);
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
      // flat-ok: a box in the cart's own frame (toCart), so +Y is the tub's up
      headTop: visibleBox(head, toCart, false).max.y,
      headAt: head.getWorldPosition(new Vector3()),
      // Along the track, which is the cart frame's +Z.
      headDepth: visibleBox(head, toCart, false).getSize(new Vector3()).z,
      body: visibleBox(player.model.root, toCart),
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
  const cartBox = visibleBox(rideCart.root, toCart, false);
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
      offSeat() < 1e-6,
    `the duck pose moved the rider off the seat — model root at ` +
      `${player.model.root.position.y.toFixed(3)} (should be 0) and her group at ` +
      `${seatInCart().y.toFixed(3)} against a seat at ${seatLift.toFixed(3)}, ${offSeat().toFixed(3)} m off it. That is a ` +
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
  //
  // **The floor moved 0.4 → 0.2 of the ride scale (1.0 m → 0.5 m) when Jim cut
  // the rock by 50%** — deliberately, and this is what it is still for. The two
  // failures it has to keep catching are both *disappearances*, not shrinkages:
  // `BOOST_ROCK` at 0, and round 8's bug where the pose was computed correctly
  // and then stamped over by a later writer, which read as exactly 0.00 m here.
  // A rock of 0.713 m clears 0.5 m by 1.43x, so the bound is not a restatement
  // of the constant — it sits between "halved, as asked" and "gone".
  require(
    rockThrow > 0.2 * route.scale,
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
      offSeat() < 1e-6,
    `the celebration moved the rider off the seat — model root at ` +
      `${player.model.root.position.y.toFixed(3)} (should be 0) and her group at ` +
      `${seatInCart().y.toFixed(3)} against a seat at ${seatLift.toFixed(3)}, ${offSeat().toFixed(3)} m off it — the ride ` +
      'never moves the root.',
  );

  // --- her arms stay inside the tub -----------------------------------------
  //
  // Jim, 7 August 2026: *"the characters arm clips through the mine cart - make
  // the box of the cart wider until this no longer happens"*. Measured then: her
  // hand reached **0.285 m outside** the tub's own surface at ride scale.
  //
  // **Ray-cast across the built hopper, not compared against a half-width**, for
  // two reasons. The tub is not a box — it was a taper, and is now a vertical
  // wall over a flared foot, so "the cart's width" is a different number at every
  // height and a single constant would be wrong nearly everywhere. And the whole
  // point of the fix was a change of *shape*: a check written against a width
  // would have gone green on a uniform scale-up that never touched the taper.
  //
  // Every vertex her arms actually draw, outlines included, in each pose that
  // moves them. The victory jump lifts her arms clear over the rim, so it has
  // nothing beside the tub at all and says so rather than silently passing.
  {
    const hopperMesh = rideCart.root.getObjectByName('hopper');
    if (!(hopperMesh instanceof Mesh)) {
      problems.push('check:rail-race: the built cart has no hopper mesh to measure her arms against');
    } else {
      // Both faces must register or a ray leaving the solid is invisible.
      (hopperMesh.material as { side: number }).side = DoubleSide;
      cartGroup.updateMatrixWorld(true);
      const hopperBox = visibleBox(hopperMesh, toCart, false);
      const acrossCart = new Vector3(1, 0, 0).transformDirection(cartFrame);
      const hitInCart = new Vector3();
      const armCaster = new Raycaster();
      armCaster.far = 500;

      /** Where a line straight across the cart at this height and depth meets the tub. */
      const wallAt = (y: number, z: number, x: number): number | null => {
        // A line across the tub in the cart's frame, cast in the world.
        armCaster.set(
          new Vector3(hopperBox.min.x - 10, y, z).applyMatrix4(cartFrame),
          acrossCart,
        );
        const xs = armCaster
          .intersectObject(hopperMesh, false)
          .map((hit) => hitInCart.copy(hit.point).applyMatrix4(toCart).x)
          .sort((a, b) => a - b);
        if (xs.length < 2) return null;
        // How far past the tub's **outer** skin on this point's own side.
        // Positive is through it, and out in the open air beside the cart —
        // which is the thing Jim can actually see and the thing he reported.
        //
        // First and last crossing, deliberately, rather than the middle pair
        // this used to take. When the tub was a zero-thickness paper shell a
        // ray across it hit exactly twice, so the middle pair *was* the outer
        // skin and the two spellings agreed. Closing the tub into a real solid
        // (7 August, the see-through corners) gives every ray four crossings,
        // and the middle pair silently becomes the **inner** skin — which asks
        // a completely different question: not "does her arm come out of the
        // cart" but "does her arm touch the wall's material". Her forearm rests
        // against the inside of the wall and enters it by ~0.017 m, buried
        // invisibly inside a 0.030 m wall, so the middle-pair spelling failed
        // this check on an asset where nothing was visibly wrong at all.
        //
        // This is not a loosened bar: measured against the outer skin the five
        // poses report 0.057 / 0.116 / 0.057 / 0.116 / clear — identical to the
        // numbers this same check gave on the open-shelled asset before the tub
        // was closed. The guarantee is exactly the one that landed this
        // morning; it is now just written so that it cannot change meaning the
        // next time the tub's wall gains or loses thickness.
        return x >= hopperBox.getCenter(new Vector3()).x
          ? x - xs[xs.length - 1]!
          : xs[0]! - x;
      };

      const armReport: string[] = [];
      let worstThrough = -Infinity;
      let worstPose = '';
      // **Every pose the ride can produce, swept — not a list of the ones
      // somebody remembered.**
      //
      // `RiderPose` is exactly three numbers, each clamped to 0..1 by
      // `poseRailRaceRider`, so the set of poses that exist *is* this cube and
      // enumerating it is a finite job. The hand-written list this replaces held
      // five named corners, and Jim's 7 August report — "after a head bonk the
      // players hands clip through the cart" — landed between them: a bonk
      // drives `duck` through `knockdown(wobble)`, which eases continuously from
      // 1 back to 0 as the wobble decays, so the knock-down pose is every
      // intermediate fold and not the `duck: 1` corner that was being checked.
      const AXIS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
      const sweep: {
        name: string;
        rider: { duck: number; pump: number; cheer: number };
        sway: number;
      }[] = [];
      for (const duck of AXIS) {
        for (const pump of AXIS) {
          for (const cheer of AXIS) {
            for (const sway of [-BONK_SWAY, 0, BONK_SWAY]) {
              sweep.push({
                name:
                  `duck ${duck.toFixed(1)} pump ${pump.toFixed(1)} cheer ${cheer.toFixed(1)} ` +
                  `sway ${sway.toFixed(3)}`,
                rider: { duck, pump, cheer },
                sway,
              });
            }
          }
        }
      }
      for (const state of sweep) {
        pose(state.rider, state.sway);
        let through = -Infinity;
        let beside = 0;
        for (const limb of [player.model.leftArm, player.model.rightArm]) {
          if (!limb) continue;
          limb.updateMatrixWorld(true);
          limb.traverse((object) => {
            if (!(object instanceof Mesh)) return;
            const position = object.geometry.getAttribute('position');
            if (!position) return;
            const vertex = new Vector3();
            for (let i = 0; i < position.count; i += 1) {
              vertex
                .set(position.getX(i), position.getY(i), position.getZ(i))
                .applyMatrix4(object.matrixWorld)
                .applyMatrix4(toCart);
              // Above the rim there is no tub to go through.
              if (vertex.y > hopperBox.max.y) continue;
              beside += 1;
              const past = wallAt(vertex.y, vertex.z, vertex.x);
              if (past !== null && Number.isFinite(past) && past > through) through = past;
            }
          });
        }
        if (beside === 0) {
          armReport.push(`${state.name} clear of the tub`);
          continue;
        }
        if (through > -Infinity) armReport.push(`${state.name} ${(-through).toFixed(3)}`);
        if (through > worstThrough) {
          worstThrough = through;
          worstPose = state.name;
        }
      }
      say(`arms in the tub   worst of ${sweep.length} poses: ${worstPose} at ${(-worstThrough).toFixed(3)} m clearance`);
      require(
        worstThrough < 0,
        `the rider's arm goes ${worstThrough.toFixed(3)} m through the side of the cart at ` +
          `'${worstPose}' — this is Jim's 7 August report. ` +
          '**Do not widen the cart.** CART_WIDTH_AT_PARK_SCALE is 1.10 and that is a measured ' +
          'ceiling, not a preference: 1.12 fails raceCameraNeverRunsBackwards on seed 5, and ' +
          'lane spacing derives from it. Change what moves her instead — the pose ' +
          '(railRace/duckPose.ts) or the bonk sway (BONK_SWAY in the same file), whichever the ' +
          'name above points at.',
      );
    }
  }

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
    // flat-ok: a box in the cart's own frame (toCart), so +Y is the tub's up
    const reach = visibleBox(player.model.root, toCart).min.y;
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
    // flat-ok: a box in the cart's own frame (toCart), so +Y is the tub's up
    return visibleBox(player.model.root, toCart).min.y;
  })();
  const legsWinning = (() => {
    setRiderLegsVisible(player.model, riderLegsShow('finishing'));
    player.group.updateMatrixWorld(true);
    // flat-ok: a box in the cart's own frame (toCart), so +Y is the tub's up
    return visibleBox(player.model.root, toCart).min.y;
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
  // **The real player, in a cart placed and seated by `railRace/seat.ts`** —
  // so she leans with the ring exactly as the game draws her. This used to be a
  // bare kid stood straight up world `+Y` with a plain yaw, which is a rider the
  // game stopped drawing when the ring was leant onto the sphere.
  const player = new Player(new CollisionWorld(), new IsoCamera(), new Vector3());
  player.beginRide();
  player.model.root.scale.setScalar(RIDE_SCALE);
  const cart = new Group();
  const heading: CartHeading = { yaw: 0, pitch: 0 };
  const faceIdleInput = {
    isDown: () => false,
    wasPressed: () => false,
    moveX: 0,
    moveY: 0,
  } as unknown as InputSystem;
  const crown = player.model.hatAnchor.parent;
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
    placeRaceCart(route, PLAYER_LANE, at, cart, heading);
    const point = cart.position;

    // Exactly `RailRace.poseRider`'s pose: the cart's yaw plus the body's share
    // of the turn on the root, the head's share on the head.
    const facing = faceTurnTowardsCamera(heading.yaw, point, rig.camera.position, sadness);
    turn = facing.body + facing.head;
    seatRaceRider(player, cart, heading, route.scale, 0, facing.body);
    player.model.head.rotation.y = facing.head;
    // Through her real update, seated, so the body's own lean in the seat moves
    // her head the way it does on screen.
    player.railRaceRide = SEATED;
    player.update({
      dt: 1 / 60,
      elapsed: 1,
      input: faceIdleInput,
      playerPosition: player.position,
      cameraForward: new Vector3(0, 0, 1),
      frame: i,
    } satisfies FrameContext);
    player.group.updateMatrixWorld(true);

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
  player.dispose();
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

/**
 * **`marginMetres` is only meaningful on a win.** `simulateField` samples it as
 * `RACE_DISTANCE - max(rival.travelled)` at the moment the *player* crosses, so
 * when she loses a rival is already on the line and it reads ≈ −0.2 m whatever
 * happened. A mean taken over seeds she lost is therefore diluted by zeros
 * rather than by near-misses, and it is not a "how close was it" number.
 *
 * That is why the bounds below take their mean from a level she wins *every*
 * seed of, and use win **count** for the level she does not.
 */
function fieldSummary(
  strategy: Strategy,
  level: RaceLevel = 3,
): {
  wins: number;
  margins: number[];
  rivalBonks: number[];
  meanMargin: number;
} {
  const margins: number[] = [];
  const rivalBonks: number[] = [];
  let wins = 0;
  for (const seed of FIELD_SEEDS) {
    const outcome = simulateField(strategy, level, seed);
    if (outcome.playerPlace === 1) wins += 1;
    margins.push(outcome.marginMetres);
    rivalBonks.push(outcome.rivalBonks);
  }
  return {
    wins,
    margins,
    rivalBonks,
    meanMargin: margins.reduce((a, b) => a + b, 0) / margins.length,
  };
}

const perfectField = fieldSummary('mashPerfect');
const sloppyField = fieldSummary('mashSloppy');
const childField = fieldSummary('childPace');
const badlyField = fieldSummary('playsBadly');
// The same child, on the two levels she will actually pick. Level 3 is the only
// one with duck bars at all (`BARS_FROM_LEVEL`), so it is hard mode by
// construction and the other two are where "can a six-year-old win this?" is
// really answered. Cheap: 24 more races each, and the whole field sweep is
// about a second.
const childEasyField = fieldSummary('childPace', 1);
const childMidField = fieldSummary('childPace', 2);
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
const childMeanMargin = childField.meanMargin;
say(
  `child pace vs field       ${childField.wins}/${FIELD_SEEDS.length} wins   ` +
    `margin ${Math.min(...childField.margins).toFixed(1)}–${Math.max(...childField.margins).toFixed(1)} m ` +
    `(mean ${childMeanMargin.toFixed(1)} m)   ${CHILD_TAPS_PER_SECOND} taps/s, half the bars`,
);
say(
  `child pace, level 1       ${childEasyField.wins}/${FIELD_SEEDS.length} wins   ` +
    `(mean ${childEasyField.meanMargin.toFixed(1)} m)        level 2   ` +
    `${childMidField.wins}/${FIELD_SEEDS.length} wins   (mean ${childMidField.meanMargin.toFixed(1)} m)`,
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
// A bound on a *competent* player's mean winning margin used to sit here, and
// was **deleted on 7 August 2026 at Jim's instruction**: "I never signed off
// that check as a requirement, if you want me to, tell me what it is, otherwise
// delete it."
//
// It was added the same morning by the Overseer rather than asked for by the
// family. It asserted the mean margin stayed under half a lap, on the theory
// that a larger margin would leave no rival in frame for the winner's
// celebration — a staging consequence **nobody had ever looked at**. It is gone
// rather than loosened, deliberately: a guess about an unobserved problem is not
// made better by a bigger number. The child-facing bound further down is a
// different assertion and stays.
//
// `perfectMeanMargin` is still measured and still printed above, because the
// number is worth seeing; nothing asserts on it.

// **The assertion Jim's complaint needed, and the build did not have.**
//
// Every strategy above taps 6 times a second. A child does not, and that single
// axis decided the whole race: measured at 3 taps/s with half the bars ducked,
// she won *1 of 24 seeds* while `mashPerfect` and `mashSloppy` both read as
// comfortable and every check in the build was green. Assert the player the
// game is actually for, not a metronome. See `PLAYER_BOOST_ADVANTAGE`.
// **Re-derived on 7 August 2026, when Jim asked for the difficulty to go
// halfway back — not slid down to fit the new numbers. Read this before
// touching either bound.**
//
// It used to be one assertion at level 3: `childField.wins >= 22` with a mean
// margin over 40 m. That encoded "a child wins essentially every race on the
// hardest level", which was the right reading of the *previous* instruction
// (*"it's just too hard ffs"*) and is arithmetically incompatible with the
// current one. Halfway between a child who never wins and a child who always
// wins is a child who wins about half, so a 22/24 bound makes "halfway"
// impossible by construction — and a bound only satisfiable by ignoring the
// instruction is not a bound, it is a veto.
//
// So the question was split by level, which is where it always belonged.
// **Level 3 is the only level with duck bars at all** (`BARS_FROM_LEVEL`), so it
// is hard mode by construction; levels 1 and 2 are where a six-year-old
// actually plays. Measured across the three settings the family has ridden:
//
//   config                       child L1    child L2    child L3   competent L3
//   old      (Jim: "too hard")     0/24        0/24        0/24        100.1 m
//   halfway  (shipping)           24/24       24/24       11/24        298.0 m
//   current  (Jim: "too easy")    24/24       24/24       24/24        461.2 m
//
// The old settings — the actual complaint — lose 0/24 at *every* level, so a
// level-1 bound catches them just as loudly as the level-3 one did, and catches
// them at 24/24 rather than 22/24. **This is a tighter assertion than the one it
// replaces**, in the place that decides whether the game is playable at all.
require(
  childEasyField.wins === FIELD_SEEDS.length && childMidField.wins === FIELD_SEEDS.length,
  `a child tapping ${CHILD_TAPS_PER_SECOND}/s wins ${childEasyField.wins}/${FIELD_SEEDS.length} at ` +
    `level 1 and ${childMidField.wins}/${FIELD_SEEDS.length} at level 2 — she must win every seed on ` +
    'the levels with no duck bars, or the game is the "too hard" complaint again on the settings a ' +
    'six-year-old actually picks. Raise PLAYER_BOOST_ADVANTAGE or lower RIVAL_SKILL.',
);
// The mean is taken from level 1, and only from level 1, because that is the
// one sweep she wins on every seed — see `fieldSummary`'s note. A mean over a
// level she loses half of is diluted by ≈0 rather than by near-misses, so it
// measures win *rate* while pretending to measure closeness.
require(
  childEasyField.meanMargin > 20,
  `a child at ${CHILD_TAPS_PER_SECOND} taps/s wins level 1 by a mean of only ` +
    `${childEasyField.meanMargin.toFixed(1)} m — close enough to read as a photo finish every time ` +
    'rather than a win, on the easiest setting in the game.',
);
// And level 3 must still be a *race* rather than a wall. A quarter of the seeds
// is the floor: below that a child who picks hard mode is not losing a close
// one, she is being told the level is not for her. Fires at the old settings
// (0/24) — which is the failure this half of the guard exists for.
require(
  childField.wins >= FIELD_SEEDS.length / 4,
  `a child tapping ${CHILD_TAPS_PER_SECOND}/s and ducking half the bars wins only ${childField.wins}/` +
    `${FIELD_SEEDS.length} seeds at level 3 — hard mode is meant to be hard, not shut. Raise ` +
    'PLAYER_BOOST_ADVANTAGE or lower RIVAL_SKILL.',
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

// --- the rider sits square in her cart, and the cart square on its rails ---
//
// **One heading, composed one way, for the child and the tub she sits in.** The
// rider is turned by `Player.setRidePose` -> `faceOnGround`, the cart by
// `rideFrame`; both hand a yaw and a pitch to `world/headingTurn.ts`. #680 once
// moved the first to `YXZ` and left the second on a default `XYZ` euler, and the
// two came apart by up to 10.68° round this ring (p50 2.55°) where they had
// agreed to 1.50° — her arms through the side of the tub on every bend with a
// hill in it. Nothing in this file could see it, because every clause above
// seats her at ONE station of the ring, where the heading happened to be kind.
//
// So this walks the whole lap, on every lane, through the game's own
// `placeRaceCart` and `seatRaceRider`, and asks two questions of each station:
// how far her up is from the tub's up, and how far the tub's nose is from the
// rails **as drawn** — a finite difference of the leant `pointAt`, not the flat
// `tangentAt`, which is the unleant route and would report the ring's own lean
// as a fault.
{
  const LAP_STATIONS = 360;
  /**
   * Her up against the tub's, in degrees. Not zero, and the reason is real:
   * `faceOnGround` leans her about the sphere normal at *her* seat, the cart is
   * leant about the rails' flat column 0.5 m below it, and the two normals
   * differ by the arc between them — 0.5 m on a 400 m sphere is 0.07°. Half a
   * degree is seven times that and a sixth of the 3° a child could see.
   */
  const RIDER_IN_CART_DEGREES = 0.5;
  /**
   * The tub's nose against the drawn rails, in degrees. The heading is read off
   * the flat tangent and carried onto the sphere by the tilt at one column,
   * while the drawn rail's direction also feels the tilt *changing* along it —
   * a turn of arc/R, 0.14° per metre of the 0.5 m finite difference here. A
   * degree is room for that and nothing like the 7-15° a wrong composition or a
   * double lean produces.
   */
  const CART_ON_RAILS_DEGREES = 1;
  const lapCart = new Group();
  const lapHeading: CartHeading = { yaw: 0, pitch: 0 };
  const lapRider = new Player(new CollisionWorld(), new IsoCamera(), new Vector3());
  lapRider.beginRide();
  const riderUp = new Vector3();
  const cartUp = new Vector3();
  const riderNose = new Vector3();
  const cartNose = new Vector3();
  const ahead = new Vector3();
  const behind = new Vector3();
  const degrees = (a: Vector3, b: Vector3): number => (a.angleTo(b) * 180) / Math.PI;
  const riderInCart: number[] = [];
  const cartOnRails: number[] = [];
  let worstRider = { value: 0, lane: 0, at: 0 };
  let worstCart = { value: 0, lane: 0, at: 0 };
  for (let lane = 0; lane < LANE_OFFSETS.length; lane += 1) {
    for (let k = 0; k < LAP_STATIONS; k += 1) {
      const at = route.wrap(route.startDistance + (route.length * k) / LAP_STATIONS);
      placeRaceCart(route, lane, at, lapCart, lapHeading);
      seatRaceRider(lapRider, lapCart, lapHeading, route.scale, 0, 0);
      // flat-ok: local axes, carried into the world by each body's own quaternion
      riderUp.set(0, 1, 0).applyQuaternion(lapRider.group.quaternion);
      // flat-ok: the cart's local up, carried into the world by its quaternion
      cartUp.set(0, 1, 0).applyQuaternion(lapCart.quaternion);
      riderNose.set(0, 0, 1).applyQuaternion(lapRider.group.quaternion);
      cartNose.set(0, 0, 1).applyQuaternion(lapCart.quaternion);
      const rider = Math.max(degrees(riderUp, cartUp), degrees(riderNose, cartNose));
      route.pointAt(lane, route.wrap(at + 0.25), ahead);
      route.pointAt(lane, route.wrap(at - 0.25), behind);
      const cart = degrees(cartNose, ahead.sub(behind).normalize());
      riderInCart.push(rider);
      cartOnRails.push(cart);
      if (rider > worstRider.value) worstRider = { value: rider, lane, at };
      if (cart > worstCart.value) worstCart = { value: cart, lane, at };
    }
  }
  const p50 = (values: number[]): number => [...values].sort((a, b) => a - b)[values.length >> 1]!;
  say('');
  say(
    `rider in her cart, round the whole lap (${LAP_STATIONS} stations x ${LANE_OFFSETS.length} lanes): ` +
      `p50 ${p50(riderInCart).toFixed(2)}°, worst ${worstRider.value.toFixed(2)}° (lane ` +
      `${worstRider.lane}, s=${worstRider.at.toFixed(1)} m) — allowed ${RIDER_IN_CART_DEGREES}°`,
  );
  say(
    `cart nose against the drawn rails: p50 ${p50(cartOnRails).toFixed(2)}°, worst ` +
      `${worstCart.value.toFixed(2)}° (lane ${worstCart.lane}, s=${worstCart.at.toFixed(1)} m) — ` +
      `allowed ${CART_ON_RAILS_DEGREES}°`,
  );
  require(
    riderInCart.length === LAP_STATIONS * LANE_OFFSETS.length && riderInCart.every(Number.isFinite),
    'the lap sweep measured nothing, or measured NaN — the rider/cart clauses below assert nothing',
  );
  require(
    worstRider.value <= RIDER_IN_CART_DEGREES,
    `the child is turned ${worstRider.value.toFixed(2)}° away from the cart she sits in (lane ` +
      `${worstRider.lane}, s=${worstRider.at.toFixed(1)} m), against ${RIDER_IN_CART_DEGREES}° allowed — ` +
      'she and her tub are composing one heading two different ways. Both must ask ' +
      '`world/headingTurn.ts`; a second euler anywhere on either path is this bug again',
  );
  require(
    worstCart.value <= CART_ON_RAILS_DEGREES,
    `the cart's nose points ${worstCart.value.toFixed(2)}° off the rails drawn under it (lane ` +
      `${worstCart.lane}, s=${worstCart.at.toFixed(1)} m), against ${CART_ON_RAILS_DEGREES}° allowed — ` +
      'it is crabbing along its own track',
  );
}

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
