/**
 * **The invariants themselves. This list is meant to grow.**
 *
 * Adding one is a small function taking {@link ParkFacts} plus one line in
 * {@link INVARIANTS}. It then runs against every seed automatically, because
 * each seed file just calls {@link registerParkInvariants}.
 *
 * Three rules for anything added here:
 *
 * 1. **Measure the built park, never the rules that built it.** `ParkFacts`
 *    reads everything back off a real `World`. An invariant that re-derives a
 *    placement rule and checks the placement agrees with it has proved
 *    nothing — see the header of `parkFacts.ts`.
 * 2. **Thresholds come from the game, not from the generator.** Prefer
 *    `PLAYER_RADIUS`, `TRACK_CLEARANCE`, `SHORTFALL_TOLERANCE` — numbers that
 *    already mean something — over the constant the generator happens to aim
 *    for. Asserting the generator's own target only proves it can do
 *    arithmetic, and it turns every future tuning change into a test failure.
 * 3. **Return your complaints; do not assert them.** {@link Invariant} is
 *    `=> readonly string[]` and {@link registerParkInvariants} does the
 *    asserting. See that type's own comment for why it is not `=> void`:
 *    briefly, a hollow invariant that passed unconditionally shipped into this
 *    suite, and the return type is what makes writing another one a compile
 *    error rather than a thing you have to remember.
 *
 * **Whichever you write, prove it can fail.** Break the thing it guards, watch
 * it go red, put it back. An invariant nobody has ever seen fail is a claim
 * about the park, not a check on it.
 *
 * ## Which seeds run this suite, and the rule that governs the list
 *
 * Jim's ruling, 2 Sep 2026, revising the older "swap the seed and write down
 * why": **the bar is sixteen good seeds** (`parkSeedPool.ts`) **that pass
 * every invariant — including quality, like not bunching the park up —
 * and beyond those sixteen, not every seed the generator can produce needs
 * to pass. The invariants themselves are never weakened; a seed that cannot
 * satisfy them is simply not in the pool.**
 *
 * That ruling retired **seed 18** from this suite (its file registered
 * `registerParkInvariants(18)` since the #374 gradient work): seed 18's
 * loop pins the entrance walk to ground where only a *level* crossing ever
 * fit, and since every crossing must be a bridge (2 Sep 2026 — the level
 * tier is deleted), a park like seed 18 cannot exist under the rules. It
 * was never in the sixteen-seed pool (b2617949 records why); it stops
 * being a sweep seed rather than the invariants learning to excuse it.
 * Nothing about the deletion was assumed: emptying the tier was measured
 * across all sixteen pool seeds first (branch feat/park-warp-solver,
 * measurements/ — no attraction lost anywhere; only seed 18, not in the
 * pool, went red).
 */
import { describe, it, beforeAll, expect } from 'vitest';
import { Box3, InstancedMesh, Matrix4, Mesh, Raycaster, Vector3, type Object3D } from 'three';
import {
  buildParkFacts,
  segmentDistance,
  pointToSegment,
  alongRun,
  pairKey,
  type ParkFacts,
} from './parkFacts.ts';
import { offAxisGround, recutCarriers, type OffAxisGround } from './gridAxes.ts';
import { resolveDismount, resolveDismountGroup } from '../../src/world/dismount.ts';
// Leaf module, safe to import statically: `bridgeSpine.ts`'s ONLY import is
// a type-only one (from `world/train/crossings`), which erases — no seeded
// module loads, so this cannot pin the park's seed the way this file's own
// header warns about. It is imported (rather than restated) because the
// frame it builds from a crossing's recorded spine is pure geometry, and a
// second hand-written arc-walk here would be exactly the "two definitions
// of one thing" disease CLAUDE.md names.
import { frameFor } from '../../src/world/train/bridgeSpine.ts';
// Leaf module: reaches only core/constants, core/uiScale and (type-only)
// world/interact — nothing seeded, so a static import cannot fix the park.
import {
  differentActions,
  sameStorey,
  TAP_FINGER_METRES,
  zoneBandClearance,
  zoneSeparation,
} from '../../src/world/tapSpacing.ts';
import {
  BUILDING_STEP_UP,
  CAMERA_FACING_YAW,
  FALL_THRESHOLD,
  MAX_FRAME_DELTA,
  PATH_KERB_LIFT,
  PATH_SURFACE_LIFT,
  PLAYER_HEIGHT_DAMP_HALF_LIFE,
  PLAYER_LONGEST_STEP,
  PLAYER_MAX_SPEED,
  PLAYER_RADIUS,
  RIM_OUTSET_START,
} from '../../src/core/constants.ts';
import {
  ENTRANCE_BUS_ARRIVE_X,
  ENTRANCE_BUS_STOP_Z,
  ENTRANCE_GATE_HALF_WIDTH,
  ENTRANCE_GATE_X,
  ENTRANCE_GATE_Z,
  ENTRANCE_PLAYER_X,
  ENTRANCE_PLAYER_Z,
  ENTRANCE_WALK_DEPTH,
  entranceGateFrame,
  isInEntranceGateOpening,
} from '../../src/world/entrance/layout.ts';
// A leaf module: pure geometry over a `standable` predicate, no three.js and
// nothing seed-dependent, so importing it here cannot fix the park's seed early.
import { GATE_PROBE_INSET, measureGatewayWalk } from '../../src/world/entrance/gatewayWalk.ts';
import { ROAD_TILE_METRES } from '../../src/world/entrance/road.ts';
import {
  GATE_FOOT_TOLERANCE,
  GATE_POST_PROBE_INSET,
  GATE_POST_REACH,
} from '../../src/world/entrance/gateArch.ts';
import { visibleTop } from '../../src/art/style/measure.ts';
import { COPING_SINK, bridgeStoneGeometry } from '../../src/art/models/bridgeStones.ts';
import {
  CHILD_FOOTPRINT,
  createKid,
  TALLEST_CHILD_HEIGHT,
  TALLEST_CHILD_SEATED_HEIGHT,
} from '../../src/art/models/kid.ts';
// A leaf module — see its own header — so importing it here cannot fix the
// park's seed early the way a `trainModel.ts`/`route.ts` import would.
import { applyRidePose } from '../../src/entities/ridePose.ts';
import { HAIR_STYLES } from '../../src/art/models/hair.ts';
import { HAT_KINDS, createHat } from '../../src/art/models/hats.ts';
// `train/trainDimensions.ts` and `train/clearance.ts` rather than
// `train/trainModel.ts` — issue #226: the numbers belong somewhere a test can
// read them without loading three.js and the track builder. Checked rather than
// assumed (5 August 2026): `trainModel.ts` does **not** reach `parkManifest` at
// runtime — `track.ts` imports `TrainRoute` with `import type`, which is erased
// — so importing it here would not actually fix the seed early, and review
// proved that by pointing this import back at it and watching 132 still pass.
// The leaf module is defence against that chain becoming real, not a fix for a
// live bug. `railRaceFliesClear`'s "reached through the built world, never
// imported" note below is about `railRace/plan.ts`, which genuinely does.
import {
  CAR_FLOOR_Y,
  CARRIAGE_BODY_HALF_WIDTH,
  LOCO_BODY_TOP_Y,
} from '../../src/world/train/trainDimensions.ts';
import {
  PLATFORM_LENGTH,
  RIDER_HEADROOM,
  STATION_GAP,
  TRAIN_CLEARANCE_Y,
} from '../../src/world/train/clearance.ts';
// A leaf module (imports nothing), so it cannot pin the park's seed the way a
// static import of `train/route.ts` would — see that constant's own note.
import { TRAIN_MIN_TURN_RADIUS } from '../../src/world/train/turning.ts';
// Safe to import statically: `slide/landing.ts` deliberately reaches nothing
// seeded — see the note on `PitCircle`. It takes the pit as an argument for
// exactly this reason, so importing it here cannot fix the park's seed before
// the harness sets `LGP_SEED`.
import { LANDING_DROP, riderClearanceFromChute } from '../../src/world/slide/landing.ts';
// `railRace/trestleGeometry.ts` rather than `railRace/track.ts`, for the reason
// the train imports give above: `track.ts` reaches `parkLayout.ts`, and a static
// import of that into `test/` fixes the park's seed before the harness sets
// `LGP_SEED`. The leaf module imports nothing at all.
import { SUPPORT_REACH_TOLERANCE as CRUISER_SUPPORT_REACH_TOLERANCE } from '../../src/world/coaster/cruiserDimensions.ts';
import {
  BAR_HALF_SPAN_AT_PARK_SCALE,
  BEAM_DROP,
  forkPlan,
  LEGACY_LEG_FOOT_RADIUS,
  RAIL_GAUGE_AT_PARK_SCALE,
  RAIL_RADIUS_AT_PARK_SCALE,
  SLEEPER_THICKNESS,
} from '../../src/world/railRace/trestleGeometry.ts';

/**
 * The narrowest gap a child can actually use.
 *
 * `PLAYER_RADIUS` is 0.62 and `NavGrid` fattens every collider by it before
 * deciding a cell is walkable, so anything narrower than this is not a gap at
 * all — it is a solid wall with a visible slot in it.
 */
const WALKABLE_GAP = 1.24;

/**
 * Half the track's width plus a little — `train/route.ts`'s own number.
 *
 * Anything closer than this to the centre line is inside the train.
 */
const TRACK_CLEARANCE = 1.3;

/**
 * How long a child may spend getting to a tree she can climb.
 *
 * Nine seconds at her own flat-out {@link PLAYER_MAX_SPEED} — a duration, not a
 * distance, because Jim's complaint was a duration: *"it takes a long time to
 * find one"*. Converting through the game's own speed is what stops this being
 * a number somebody liked the look of.
 *
 * **It was seven, and raising it deserves an explanation rather than a quiet
 * edit**, because "loosen the threshold until the seed passes" is the exact
 * move this repo forbids.
 *
 * Seven was calibrated against a park with 8 climbable trees, where the worst
 * paved point was 41.9 m. Then #216 landed, `isPlantable` stopped capping at
 * 55 m, and the park went to 72 trees with **40–49** of them climbable. The
 * worst paved point got *worse* — 55.4 m on seed 2 — because the new ground
 * opened up is the **outer** park, so the trees moved away from the middle even
 * as their number quintupled.
 *
 * That is the tell that this metric is not measuring what its name says. Every
 * worst point on every seed sits in the plaza — (9,-7), (-0,-6), (-9,10),
 * (-9,10), (-9,6) — ground owned by the plots, the stalls and the paving, where
 * no tree of any kind can be planted. A max over path points therefore reports
 * the distance from the middle of a paved square to the lawn, on a park that
 * has never had a findability problem at 40+ climbable trees.
 *
 * So this becomes what it can honestly be: **a backstop against gross
 * clustering**, wide enough not to be a report on the plaza. The tight guard on
 * the thing Jim actually complained about is now the count floor below, which
 * moved the other way — from 6 to 25 — and is what would catch a regression to
 * the park he could not find a tree in. Nine seconds still fails the park as it
 * was when he complained (96.9 m worst).
 */
const SEARCH_SECONDS = 9;
const MAX_CLIMB_SEARCH = PLAYER_MAX_SPEED * SEARCH_SECONDS;

/**
 * How far off a doormat the game itself considers "arrived" — imported in
 * spirit from `entities/TapNavigator.ts`, which `check:park` also uses for
 * exactly this. An entrance is usable if there is standable ground this close
 * to it; demanding the doormat's exact centre be standable is stricter than
 * the game has ever been, and would fail on every seed for the building, whose
 * entrance sits in its doorway.
 */
const SHORTFALL_TOLERANCE = 1.6;

/**
 * How far a lamp usefully lights. Deliberately well inside the ~20.5 m ground
 * pool documented in `LampPosts.ts`, so this measures *coverage*, not the
 * outer edge of the falloff curve.
 */
const LAMP_REACH = 15;

/**
 * Rail-over-rail air where one ride passes over another — Decision 4's number,
 * not the Rail Race's own target, so this keeps meaning something if the ring's
 * cruise height is ever retuned.
 */
const RAIL_OVER_RAIL = 5.5;

/**
 * Longest stretch of path allowed with no lamp within {@link LAMP_REACH}.
 *
 * 2.5x the 10 m the placer aims for: two lamps in a row may legitimately be
 * skipped where a path squeezes past a plot, three in a row is a dark park.
 */
const MAX_DARK_RUN = 25;

/**
 * Longest stretch of the Rail Race ring allowed to stand with no trestle leg
 * at all.
 *
 * `track.ts`'s `trestleSpots` aims for a leg every 12 m and searches a small
 * neighbourhood before giving one up as genuinely un-standable ground (over
 * the railway, a path, a plot gap). One skipped slot (~12-24 m, generously
 * ~36 m allowing for the search's own few metres of nudge either side) is the
 * track shrugging off a single bad spot, exactly as intended. This is not
 * that number, doubled to a clean 40 m on purpose — it is independently how
 * long an elevated ride can go with *no visible means of support* before it
 * reads as floating rather than built, which is the actual thing a family
 * would notice from the ground. (Measured before `trestleSpots` gained its
 * search, 1 August 2026: the canonical seed's single surviving leg left a
 * ~330 m gap — this would have failed loudly, which is the point.)
 */
const TRESTLE_GAP_TOLERANCE = 40;

/**
/**
 * How close a ribbon has to come to count as having arrived somewhere.
 *
 * A child's full width — `2 x PLAYER_RADIUS`, the same derivation
 * {@link WALKABLE_GAP} is built from — so "the paving reaches the counter"
 * means a child standing at the counter is standing on the paving rather than
 * out on the grass beside it. Not `paths.ts`'s own numbers: neither the 4 m it
 * uses to decide a node is already served, nor any route width it happens to
 * draw with.
 *
 * There is one deliberate overshoot in the generator and this clears it
 * comfortably. A spur is carried a little *past* a doormat into the plot mouth,
 * but that extension is structurally capped at 0.4 m: it is
 * `min(2, l - edge - PAST_CLEARANCE)` where `l = edge + standOff`, which
 * collapses to `min(2, 1.4 - 1)` for anything with a footprint. Meanwhile the
 * bug this was written for — every stall's ribbon stopping short of its own
 * counter, issue #114 — missed by 3.4 to 6.9 m on all five seeds, so there is
 * no risk of the tolerance swallowing the thing it exists to catch.
 */
const ARRIVAL = 2 * PLAYER_RADIUS;

/**
 * How much of the chute is allowed to be inside the castle's footprint.
 *
 * The slide leaves through a gap in the roof parapet, so its first stretch is
 * *in* the doorway by design. Long enough to cover the mouth and the wall it
 * comes through, short enough that the return leg of #118's curve — which came
 * back and stopped dead in the middle of the tower — could never hide in it.
 */
const DOORWAY_GRACE = 6;

/**
 * The ginormous slide's legs, as built: `supports.ts`'s foot radius, and how
 * far from the chute one may stand and still be holding it up.
 *
 * The reach is the arc nudge the placer is allowed (8.5 m) plus a little — a
 * leg further from the chute than the placer could possibly have moved it is a
 * leg attached to nothing.
 */
const SLIDE_LEG_RADIUS = 0.52;
const SLIDE_LEG_REACH = 10;

// ------------------------------------------------------------------ the list

/**
 * An invariant **returns** what it found wrong. It does not assert.
 *
 * One string per complaint, empty for a healthy park;
 * {@link registerParkInvariants} is the only thing here that calls `expect`.
 *
 * This return type is load-bearing, not a style choice. These functions all
 * have the same shape — walk the built park, push a sentence into an array for
 * anything wrong — and while the type was `=> void` it was possible to build
 * that array and simply forget to assert it. The result compiled, ran on every
 * seed, and passed unconditionally: a test that could never fail, sitting in
 * the suite that CI blocks merges on. That happened (5 August 2026, caught only
 * because the author reverted their own fix to check the new invariant went
 * red, and it did not).
 *
 * With a return type, forgetting is a compile error — `strict` rejects a
 * function that declares an array and falls off the end. The runner cannot be
 * bypassed by accident, so the mistake is unavailable rather than merely
 * discouraged. That matters here more than in most files, because CLAUDE.md
 * *requires* a new invariant with every procgen change: this is a mandated
 * path, walked by people who have never opened this file before.
 */
type Invariant = (facts: ParkFacts) => readonly string[];


/**
 * Every wall run keeps clear of every other one.
 *
 * Arms of a single L-shaped maze piece are exempt: they meet at a shared
 * corner on purpose, which is what makes it an L rather than two walls.
 */
const wallsDoNotClash: Invariant = (facts) => {
  const clashes: string[] = [];
  for (let i = 0; i < facts.walls.length; i += 1) {
    for (let j = i + 1; j < facts.walls.length; j += 1) {
      const a = facts.walls[i]!;
      const b = facts.walls[j]!;
      if (a.piece === b.piece) continue;
      const gap = segmentDistance(a.from, a.to, b.from, b.to) - a.halfWidth - b.halfWidth;
      if (gap < WALKABLE_GAP) {
        clashes.push(
          `${a.kind} run (${fmt(a.from)}->${fmt(a.to)}) and ${b.kind} run ` +
            `(${fmt(b.from)}->${fmt(b.to)}) leave ${gap.toFixed(2)} m between their faces`,
        );
      }
    }
  }
  return clashes;
};

/** No wall stands on the railway. Measured against the *solved* centre line. */
const wallsClearTheRailway: Invariant = (facts) => {
  const fouls: string[] = [];
  for (const wall of facts.walls) {
    let worst = Infinity;
    for (const [x, z] of alongRun(wall.from, wall.to)) {
      worst = Math.min(worst, facts.distanceToRail(x, z) - wall.halfWidth);
    }
    if (worst < TRACK_CLEARANCE) {
      fouls.push(
        `${wall.kind} run (${fmt(wall.from)}->${fmt(wall.to)}) comes within ` +
          `${worst.toFixed(2)} m of the rail centre line`,
      );
    }
  }
  return fouls;
};

/**
 * **Every decorative wall run actually borders something, on its own grid
 * axis.** Issue #300, Jim, playing, on `grid-aligned-park`'s own preview:
 * *"here we see 3 walls placed at nonsensical locations that make no sense.
 * On the grid layout, the walls should be at the same orthogonal axes as the
 * path and also be around the edges of the path where there is nothing else
 * they would collide with — the point of walls isn't to scatter them at
 * random!"*
 *
 * Before the fix, both `Scenery.ts` wall generators drew a candidate's centre
 * from the whole lawn disc — `(angle, radius)`, fully free — and only
 * afterwards asked whether the result was *clear* of everything nearby.
 * "Clear of everything" and "next to something" are different claims, and a
 * candidate could satisfy the first while utterly failing the second: nothing
 * ever measured how far a wall ended up from the path or plot it was
 * supposedly decorating. The lawn benches additionally rolled a fully free
 * yaw (`rng.range(0, Math.PI)`), so half the time they landed further off a
 * grid axis than on one.
 *
 * Two real, measured claims, neither taken from the generator's own intent —
 * `ParkFacts.walls` reads `from`/`to` off the built runs, `ParkFacts.pathEdges`
 * and `ParkFacts.plots` off the built network and layout:
 *
 * 1. **Angle.** The path network is itself locked to the global X/Z axes —
 *    {@link pathsRunOnGridAxes} above proves exactly that of the drawn curve,
 *    with the closed ring the one deliberate exception, excluded here for the
 *    same reason it is excluded there ({@link ringIsATrueCircleRoundTheStatue}).
 *    So "the same orthogonal axis as the nearest path edge" and "a global
 *    grid axis" are the same claim wherever a wall sits close enough to a
 *    spur or interconnect to be called bordering it. Measuring against the
 *    fixed global axis directly — rather than hunting for the one nearby
 *    curve sample and trusting its local tangent — means a momentary wobble
 *    in one Catmull-Rom sample near a corner can never be mistaken for the
 *    thing a wall is meant to match.
 * 2. **Proximity.** Every point along a wall run ({@link alongRun}, sampled
 *    every metre) is within reach of the nearest thing it could plausibly be
 *    bordering — a paved edge's own surface, or a plot's own bounding circle
 *    — so a whole run stays near what it borders rather than just touching it
 *    at one lucky corner and trailing off into open lawn.
 *
 * `WALL_BORDER_PROXIMITY_TOLERANCE` carries real headroom above the measured
 * worst case: built and measured across all five CI seeds after the fix, the
 * furthest any sampled wall point ever sits from the nearest path edge or
 * plot boundary is 10.96 m (wood, seed 20260728) — comfortably inside the
 * 14 m here, while still nowhere near what an unconstrained scatter across
 * the ~90 m-wide lawn disc could produce. `WALL_AXIS_TOLERANCE_DEG` is looser
 * than the generator's own worst rounding (the tightest `pathBorderSegments`
 * stretch can be ~2.9 deg off true axis) but far tighter than a genuine
 * diagonal, which the old bench yaw could put anywhere up to 45 deg off.
 */
const WALL_AXIS_TOLERANCE_DEG = 8;
const WALL_BORDER_PROXIMITY_TOLERANCE = 14;

const wallsBorderTheGridSensibly: Invariant = (facts) => {
  const problems: string[] = [];
  // The ring is a deliberate true circle, never a grid edge — see this
  // invariant's own comment and `pathsRunOnGridAxes` above.
  const borderEdges = facts.pathEdges.filter((edge) => !edge.backbone);

  const nearestBorderDistance = (point: readonly [number, number]): number => {
    let nearest = Infinity;
    for (const edge of borderEdges) {
      for (let i = 1; i < edge.points.length; i += 1) {
        const d = pointToSegment(point, edge.points[i - 1]!, edge.points[i]!) - edge.halfWidth;
        if (d < nearest) nearest = d;
      }
    }
    for (const plot of facts.plots) {
      const d = Math.hypot(point[0] - plot.x, point[1] - plot.z) - plot.boundingRadius;
      if (d < nearest) nearest = d;
    }
    return nearest;
  };

  for (const wall of facts.walls) {
    const dx = wall.to[0] - wall.from[0];
    const dz = wall.to[1] - wall.from[1];
    if (Math.hypot(dx, dz) < 1e-6) continue;

    const angleDeg = (Math.atan2(dz, dx) * 180) / Math.PI;
    const mod90 = ((angleDeg % 90) + 90) % 90;
    const offAxis = Math.min(mod90, 90 - mod90);
    if (offAxis > WALL_AXIS_TOLERANCE_DEG) {
      problems.push(
        `${wall.kind} run (${fmt(wall.from)}->${fmt(wall.to)}) sits ${offAxis.toFixed(1)} deg off ` +
          `the park's grid axes — the path network itself runs orthogonal, this wall does not`,
      );
    }

    let worstProximity = 0;
    for (const point of alongRun(wall.from, wall.to, 1)) {
      worstProximity = Math.max(worstProximity, nearestBorderDistance(point));
    }
    if (worstProximity > WALL_BORDER_PROXIMITY_TOLERANCE) {
      problems.push(
        `${wall.kind} run (${fmt(wall.from)}->${fmt(wall.to)}) strays ${worstProximity.toFixed(1)} m ` +
          `from the nearest path edge or plot boundary at its furthest point — bordering nothing`,
      );
    }
  }

  return problems;
};

/**
 * **Every wall run goes alongside a path, and a good few stand flush against
 * one.** Issue #417, Jim, playing: *"outside, the walls are placed seemingly at
 * random. They should be alongside the paths and flush with it at various
 * places. Same number of walls, but no wall in the middle of a patch of grass
 * for no reason."*
 *
 * ### Why {@link wallsBorderTheGridSensibly} above did not already catch this
 *
 * It is not a weaker version of this check; it answers a different question,
 * and answers it correctly. Two gaps let Jim's walls through it:
 *
 * 1. **It counts a plot as a thing worth bordering.** A wall placed 6 m outside
 *    a building's bounding circle passes it — even when that building sits out
 *    near the park edge with lawn all round it and the nearest paving is 37 m
 *    away. Measured on the built park before this change: seed 11 stood a run
 *    at (-89.7, 41.5), **37.5 m** from any paving; seed 2 one at 34.8 m; seed 5
 *    one at 27.4 m. All three were comfortably legal.
 * 2. **Its 14 m tolerance is far too generous to see a verge.** Across the five
 *    CI seeds, **116 of 155 runs** stood more than 4 m from any paved surface,
 *    and the closest any wall in any park ever came to paving was **3.34 m**.
 *    Nothing was ever flush, because nothing *could* be: the placer asked
 *    `isPlantable(x, z, 3.2)`, so the gap it kept from a path was the same one
 *    it kept from a plot.
 *
 * So this one measures the single thing that complaint is about — **distance
 * from the wall to real paving** — and it does it on the built park:
 * `ParkFacts.walls` is read off the runs that stand, and the paving is the
 * *drawn* ribbon (`pathEdges[].points`) plus the plaza's own disc, not the
 * control polygon the placer positioned against.
 *
 * ### The two claims, and where their numbers come from
 *
 * 1. **Alongside.** Every run's closest approach to paving is within
 *    `widest path half-width x 2 + PLAYER_RADIUS`. Both terms are read rather
 *    than typed: the half-width comes from `pathEdges` on this very park, and
 *    the reasoning is that a strip of grass as wide as the path beside it still
 *    reads as that path's verge, while twice the path's width reads as a field
 *    with a wall in it. `PLAYER_RADIUS` is the slack, and it buys something
 *    specific — the placer works against a route's control polygon, while the
 *    paving drawn is the Catmull-Rom curve through those points, which bows
 *    away from it in between.
 *
 *    That comes to 3.82 m on every CI seed (widest non-ring path is 3.2 m
 *    wide). Measured worst case after the fix: **3.16 m** (seed 5), with
 *    2.50 / 2.83 / 2.91 / 2.97 on the others — 0.66 m of headroom on the worst
 *    seed. Before the fix, the same measurement was 3.34 m at *best* and ran
 *    to 37.5 m, so this invariant would have been red on all five.
 *
 * 2. **Flush in places.** A run counts as flush when its own face — its centre
 *    line less its `halfWidth` — comes within `PLAYER_RADIUS` of the paving:
 *    the child cannot fit between the wall and the path, so there is no verge
 *    there at all, which is what "flush" means to someone looking at it. At
 *    least {@link FLUSH_RUNS_FLOOR} of them must be. This is the half of the
 *    ask a proximity bound alone cannot express — walls uniformly 3 m off would
 *    satisfy claim 1 completely and still be exactly what Jim complained about.
 *    Measured after the fix: 9 / 9 / 8 / 9 / 11 flush runs across the five
 *    seeds. Before it: **zero, on every seed, necessarily.**
 */
const FLUSH_RUNS_FLOOR = 4;

const wallsRunAlongsideAPath: Invariant = (facts) => {
  const problems: string[] = [];

  // Real paving: every drawn ribbon, and the plaza, which is a paved disc
  // rather than a ribbon (`PathNodeFact.reach`) and which the four garden beds
  // border rather than bordering any path.
  const pavedDiscs = facts.pathNodes.filter((node) => node.reach > 0);
  const distanceToPaving = (point: readonly [number, number]): number => {
    let nearest = Infinity;
    for (const edge of facts.pathEdges) {
      for (let i = 1; i < edge.points.length; i += 1) {
        const d = pointToSegment(point, edge.points[i - 1]!, edge.points[i]!) - edge.halfWidth;
        if (d < nearest) nearest = d;
      }
    }
    for (const disc of pavedDiscs) {
      const d = Math.hypot(point[0] - disc.x, point[1] - disc.z) - disc.reach;
      if (d < nearest) nearest = d;
    }
    return nearest;
  };

  // The widest verge that can still read as a verge, off this park's own
  // network. The ring is excluded for the same reason it is excluded from
  // `wallsBorderTheGridSensibly` — it is a true circle, not a grid edge, and
  // no wall is ever anchored to it.
  let widestHalfWidth = 0;
  for (const edge of facts.pathEdges) {
    if (edge.backbone) continue;
    widestHalfWidth = Math.max(widestHalfWidth, edge.halfWidth);
  }
  const alongsideMax = widestHalfWidth * 2 + PLAYER_RADIUS;

  let flushRuns = 0;
  for (const wall of facts.walls) {
    let closest = Infinity;
    for (const point of alongRun(wall.from, wall.to, 1)) {
      closest = Math.min(closest, distanceToPaving(point));
    }
    if (closest > alongsideMax) {
      problems.push(
        `${wall.kind} run (${fmt(wall.from)}->${fmt(wall.to)}) never comes closer than ` +
          `${closest.toFixed(2)} m to any paving — more than ${alongsideMax.toFixed(2)} m, so it ` +
          `stands in open grass rather than alongside a path`,
      );
    }
    if (closest - wall.halfWidth <= PLAYER_RADIUS) flushRuns += 1;
  }

  if (facts.walls.length > 0 && flushRuns < FLUSH_RUNS_FLOOR) {
    problems.push(
      `only ${flushRuns} of ${facts.walls.length} wall runs stand flush against paving ` +
        `(face within ${PLAYER_RADIUS} m of it); at least ${FLUSH_RUNS_FLOOR} should. Walls all ` +
        `holding the same polite distance off the kerb is the arrangement #417 asked to end`,
    );
  }

  return problems;
};

/**
 * **No tree stands on the railway.** Issue #235.
 *
 * The twin of {@link wallsClearTheRailway}, and it did not exist because it
 * used to be unnecessary: `Scenery.isPlantable` refused anything beyond 55 m of
 * centre, which kept every tree well inside the outer railway by construction.
 * PR #216 retires that cap in favour of a distance-to-boundary test, which
 * opens the outer reaches — exactly where the railway runs — for planting, and
 * leaves the whole guarantee resting on `onRailway`'s 2.6 m fence with nothing
 * measuring the result.
 *
 * Written here **ahead of** that PR, deliberately. The gap is not reachable on
 * `main` today — trees still stop at 54.0 m — so this costs nothing now and
 * means #216 cannot land the problem silently. That is the same lesson as the
 * Sky Cruiser striking the fairy lights (#210): an obstacle class nobody
 * measured, because a since-retired assumption had made it unnecessary.
 *
 * The margin it is guarding is **not** generous. Measured on the canonical
 * seed, the closest tree's canopy reaches to **3.11 m** of the rail centre line
 * (then 3.26, then 3.58) against a `TRACK_CLEARANCE` of 1.3 — so 1.81 m of
 * slack on the worst tree in the park, today, before anything is widened.
 *
 * `TRACK_CLEARANCE` is the game's own half-width, and `footprint` is the tree's
 * real reach, so this asks the question in the units a collision would happen
 * in rather than in the scatter's own target.
 */
const treesClearTheRailway: Invariant = (facts) => {
  const fouls: string[] = [];
  for (const tree of facts.trees) {
    const gap = facts.distanceToRail(tree.x, tree.z) - tree.footprint;
    if (gap < TRACK_CLEARANCE) {
      fouls.push(
        `tree at ${fmt([tree.x, tree.z])} reaches to ${gap.toFixed(2)} m of the rail centre ` +
          `line (needs ${TRACK_CLEARANCE} m)`,
      );
    }
  }
  return fouls;
};

/**
 * How close any part of an entrance prop may come to the train's centre line
 * before it is standing where the carriage's own body actually passes.
 *
 * `TRACK_CLEARANCE` is the half-width anything counts as "inside the train"
 * within — the same number {@link wallsClearTheRailway} and
 * {@link treesClearTheRailway} hold walls and trees to. `CARRIAGE_BODY_HALF_WIDTH`
 * (`train/trainDimensions.ts`) is what the carriage is actually built to, so a
 * prop closer than their sum is inside the carriage's real geometry, not just
 * inside a safety margin around it. This is the hard minimum the game itself
 * would be broken by crossing — not `Entrance.WELCOME_SIGN_MIN_TRACK_CLEARANCE`,
 * which is the *placer's own target* (this minimum plus a metre of slack it
 * aims for); asserting the placer's target here would only prove the placer
 * agrees with itself, which is the mistake this file's own header warns against.
 */
const ENTRANCE_PROP_MIN_TRACK_CLEARANCE = TRACK_CLEARANCE + CARRIAGE_BODY_HALF_WIDTH;

/**
 * **Named entrance props whose built geometry must clear the railway.**
 *
 * One line per prop — the same shape as {@link INVARIANTS} itself — so a
 * future prop standing near the gate gets this check for free by giving its
 * `Group` a name and adding it here, rather than by writing a new invariant.
 */
const ENTRANCE_PROP_NAMES = ['welcome-sign'] as const;

/**
 * **No entrance prop stands on the railway.** Issue #303 (PR #303 QA).
 *
 * The welcome sign moved to just inside the gate (#298) and landed 0.63 m
 * from the train's *solved* centre line on the canonical seed — inside both
 * `TRACK_CLEARANCE` and the carriage's own body half-width at once. The cause
 * was structural, not a bad coordinate: `train/route.ts` solves the train's
 * loop from `PARK_LAYOUT` alone, **before** `Entrance` is built (see that
 * module's own doc), so nothing the solver avoided knew the sign would stand
 * there. `wallsClearTheRailway` and `treesClearTheRailway` above ask this
 * question of every wall and every tree; nothing before this asked it of a
 * prop, which is exactly the gap that let it through five seeds of CI.
 *
 * **Measured off the built mesh geometry** — every vertex of every prop in
 * {@link ENTRANCE_PROP_NAMES}, in world space, against `facts.distanceToRail`
 * (the same solved centre line the train itself runs on) — not off the
 * placement logic that positions the prop. `Entrance.findWelcomeSignSpot`
 * already asks a version of this question in order to *place* the sign;
 * re-deriving that same answer here would only prove the placer agrees with
 * itself, the exact failure mode this file's header warns against. This
 * walks the real triangles a player would actually see clip the train.
 *
 * Proven red on the bug it fixes: reverting `Entrance.ts`'s placement search
 * back to the fixed `(7, 56)` coordinate and re-running `test:procgen`
 * reports `entrance prop 'welcome-sign' comes within 0.63 m of the train's
 * centre line ... (needs 2.10 m)` on the canonical seed — the exact QA
 * measurement — before going green again once the search is restored.
 */
const entrancePropsClearTheRailway: Invariant = (facts) => {
  const fouls: string[] = [];
  const at = new Vector3();

  for (const propName of ENTRANCE_PROP_NAMES) {
    const prop = facts.world.entrance.group.getObjectByName(propName);
    if (!prop) {
      fouls.push(`entrance prop '${propName}' was not found anywhere in the built scene to measure`);
      continue;
    }
    prop.updateWorldMatrix(true, false);

    let worst = Infinity;
    let worstAt: readonly [number, number] = [0, 0];
    prop.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      const position = child.geometry.getAttribute('position');
      if (!position) return;
      for (let i = 0; i < position.count; i += 1) {
        at.set(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(child.matrixWorld);
        const gap = facts.distanceToRail(at.x, at.z);
        if (gap < worst) {
          worst = gap;
          worstAt = [at.x, at.z];
        }
      }
    });

    if (!Number.isFinite(worst)) {
      fouls.push(`entrance prop '${propName}' has no mesh geometry in the built scene to measure`);
      continue;
    }
    if (worst < ENTRANCE_PROP_MIN_TRACK_CLEARANCE) {
      fouls.push(
        `entrance prop '${propName}' comes within ${worst.toFixed(2)} m of the train's centre ` +
          `line at ${fmt(worstAt)} (needs ${ENTRANCE_PROP_MIN_TRACK_CLEARANCE.toFixed(2)} m: ` +
          `${TRACK_CLEARANCE} m TRACK_CLEARANCE + ${CARRIAGE_BODY_HALF_WIDTH} m carriage half-width)`,
      );
    }
  }

  return fouls;
};

/**
 * No two plots overlap.
 *
 * Pairs the manifest deliberately relates with `near` are exempt — that field
 * exists precisely to put two things close together (the ginormous slide flies
 * over the ground between the building and the ball pit), and the manifest's
 * own `min` is the whole rule for such a pair.
 */
const plotsDoNotOverlap: Invariant = (facts) => {
  const overlaps: string[] = [];
  for (let i = 0; i < facts.plots.length; i += 1) {
    for (let j = i + 1; j < facts.plots.length; j += 1) {
      const a = facts.plots[i]!;
      const b = facts.plots[j]!;
      if (facts.nearPairs.has(pairKey(a.id, b.id))) continue;
      const gap = Math.hypot(a.x - b.x, a.z - b.z) - a.boundingRadius - b.boundingRadius;
      if (gap < 0) overlaps.push(`${a.id} and ${b.id} overlap by ${(-gap).toFixed(2)} m`);
    }
  }
  return overlaps;
};

/** Every doormat and stall counter has ground a visitor can stand on. */
/**
 * **The park gate's arch stands over its own posts, and the way in stays
 * open.** Issue #480 — Jim, playing: *"There's a weird segment of a taurus
 * near the park edge."*
 *
 * The crossbar carried two rotations too many. `rotation.z = Math.PI` turned
 * the upper half of the torus — the arch shape — into the lower half, so it
 * hung down from the tops of the posts and drove its apex 1.34 m under the
 * paving; `rotation.y = Math.PI / 2` laid it *along* the path instead of
 * across it. What stood at the park's front door was two curved prongs coming
 * out of the ground either side of the way in, with nothing solid about them.
 *
 * Every number involved was right. The gate was the right width, the posts
 * stood in the right places, the arch was centred on the opening, and both
 * rotations read like framing. **Only the mesh's own world box says which way
 * it points**, which is why this is measured off the built scene.
 *
 * Three clauses:
 *
 * 1. **The arch's two ends come down on its two posts** — the meshes named
 *    beside it by `src/world/entrance/gateArch.ts`, found in the scene, not
 *    asked of the builder. A crossbar turned out of the gate plane takes its
 *    ends with it and lands nowhere near them.
 * 2. **The gate is solid where a child walks into it** — a stride in front of
 *    each post, inside the reach that post has over her. This is what fails
 *    if the gate loses its colliders, and it is the control on the probe:
 *    it has to be able to answer "no".
 *
 *    **Where that probe may not be pointed:** the gate line itself is
 *    blocked from wall to wall, because the park boundary keeps a child
 *    *inside* the park and a `PLAYER_RADIUS` body standing on the line
 *    overlaps the outside — 33 of 33 probes across the gate at z = 60 on the
 *    canonical seed, whatever the gate is doing. A clause probing there is
 *    green for a reason that has nothing to do with the gate, which is
 *    exactly how the first draft of this invariant passed the *broken*
 *    arch's own geometry. See `scripts/measure-gate-480.mts`.
 * 3. **Nothing hangs into that gap.** The lowest point of the arch clears
 *    {@link TALLEST_CHILD_HEIGHT} — the park's tallest possible child, party
 *    hat and all, taken from the game rather than from the gate's own design.
 *    The broken arch reached below ground and failed this by 4.31 m.
 *
 * The arch itself is deliberately **not** solid: its feet are the posts,
 * which are, and the span is headroom over a child walking under it.
 */
/** The cover this invariant does not give, said the same way every time. */
const GATE_UNCOVERED =
  'the park gate arch invariant asserts nothing about whether a child can walk through the gateway ' +
  '— that is theWalkInFromTheGateIsWalkable (#481, #485); this one covers only the arch pointing the ' +
  'right way, the posts being solid, and the headroom';

const theParkGateArchStandsOverItsGateway: Invariant = (facts) => {
  // **What this invariant does not assert.** Written before the early returns
  // below, not after, so a park with no gate in it at all still says what is
  // uncovered rather than falling silent at the one moment that matters.
  //
  // There is no clause here that the gateway is *walkable* — that a child can
  // actually get from outside the gate to inside it. That clause was written
  // on this branch, it worked, and it found a defect that is not this one: the
  // park boundary is a seed-dependent spline while the gate is a fixed
  // constant at (0, 60), so on some seeds the boundary wall ran *across* the
  // opening — pool seed 288 (a chain of 0.18 m walls through (0.01, 57.76))
  // and sweep seed 18 (through (-1.13, 59.87), shut but for a 1 m slot at
  // x = 3.5). It was withheld rather than weakened, to land with that fix.
  //
  // **It has since landed, and not here.** #481 was fixed by #485, which moved
  // the boundary masonry out of the opening and brought its own invariant,
  // `theWalkInFromTheGateIsWalkable`, over `gatewayWalk.ts`'s full-width flood
  // fill. So the clause is no longer withheld — it exists, it is simply owned
  // by the check next door, and this one stays about the arch. The note above
  // says which, because "asserts nothing about X" is only useful to the next
  // reader if it also says who does.
  //
  // On `process.stderr`, because Vitest shows `console.log` from *failing*
  // tests only and this note exists for the passing runs.
  const say = (line: string): void => process.stderr.write(`${line}\n`);

  const arch = facts.parkGateArch;
  if (!arch) {
    say(GATE_UNCOVERED + ' — and there is no gate in the scene at all, so it covers nothing else either');
    return [
      'NO SCENE OBJECT "park-gate-arch": the park has no front gate to measure. ' +
        'Either the entrance stopped building one or the crossbar lost its name, ' +
        'and either way every clause below would have passed vacuously.',
    ];
  }
  if (arch.posts.length !== 2) {
    say(GATE_UNCOVERED + ` — and the gate has ${arch.posts.length} named posts, so clause 1 covers nothing`);
    return [
      `the park gate has ${arch.posts.length} named posts in the built scene, not 2 — ` +
        'clause 1 below has nothing to measure the arch against',
    ];
  }

  const fouls: string[] = [];

  // The axis the arch lies along, taken from the arch rather than from the
  // gate's design: the longer of its two horizontal extents. A crossbar turned
  // out of the gate plane takes this with it.
  const spanX = arch.maxX - arch.minX;
  const spanZ = arch.maxZ - arch.minZ;
  const alongX = spanX >= spanZ;
  const span = Math.max(spanX, spanZ);
  const half = span / 2;
  const along = (t: number): readonly [number, number] =>
    alongX ? [arch.centreX + t * half, arch.centreZ] : [arch.centreX, arch.centreZ + t * half];

  // 1. Each end of the arch comes down on a post.
  for (const t of [-1, 1] as const) {
    const [x, z] = along(t);
    let nearest = Infinity;
    for (const post of arch.posts) {
      nearest = Math.min(nearest, Math.hypot(x - post.x, z - post.z));
    }
    if (nearest > GATE_FOOT_TOLERANCE) {
      fouls.push(
        `the gate arch's ${t < 0 ? 'first' : 'second'} end at (${x.toFixed(2)}, ${z.toFixed(2)}) is ` +
          `${nearest.toFixed(2)} m from the nearest post — it is not standing on the gate, so it is ` +
          `pointing somewhere the gate does not go (it spans ${span.toFixed(2)} m along ` +
          `${alongX ? 'X' : 'Z'}, posts at ` +
          arch.posts.map((post) => `(${post.x.toFixed(2)}, ${post.z.toFixed(2)})`).join(' and ') +
          ')',
      );
    }
  }

  // 2. The gate is solid where a child bumps into it — and the probe proves
  // itself at each post before it is believed there.
  //
  // **Why per-post and not once:** on the canonical seed, with the colliders
  // removed, the *east* post's probe flips to standable — a clean control —
  // while the west post's stays blocked, because something other than the post
  // occupies that ground. A clause that quietly covers one post while reading
  // as though it covers two is the disease this file is most often about. So
  // each post is asked twice: outside the post's reach (must be open, or
  // nothing here is being answered by the gate) and inside it (must be
  // closed), and the stderr note below reports how many posts survived that.
  //
  // **What the count is, measured on the rebased tree** (`test:procgen`, five
  // seeds, 541 tests, exit 0): **9 of 10 post-probes live** — four seeds at 2
  // of 2, one seed masked at (-4.30, 60.00) — and no seed where it asserts
  // nothing. Before the rebase onto #485 it was 5 of 10 with two seeds
  // covering nothing at all; moving the boundary masonry out of the opening is
  // what freed the other four. Both numbers were true when taken, which is the
  // reason this one is dated to the tree it was read off rather than left as a
  // bare figure for the next reader to trust.
  const toMiddle = Math.hypot(arch.centreX, arch.centreZ);
  const inward: readonly [number, number] =
    toMiddle > 1e-6 ? [-arch.centreX / toMiddle, -arch.centreZ / toMiddle] : [0, 0];
  const reach = GATE_POST_REACH;
  let postsCovered = 0;
  const masked: string[] = [];

  for (const post of arch.posts) {
    const at = (inset: number): readonly [number, number] => [
      post.x + inward[0] * inset,
      post.z + inward[1] * inset,
    ];
    const [clearX, clearZ] = at(GATE_POST_PROBE_INSET.clear);
    if (!facts.isStandable(clearX, clearZ)) {
      // Something that is not this post is answering here, so the reading a
      // stride closer cannot be attributed to the post's collider.
      masked.push(`(${post.x.toFixed(2)}, ${post.z.toFixed(2)})`);
      continue;
    }
    postsCovered += 1;
    const [solidX, solidZ] = at(GATE_POST_PROBE_INSET.solid);
    if (facts.isStandable(solidX, solidZ)) {
      fouls.push(
        `a child can stand at (${solidX.toFixed(2)}, ${solidZ.toFixed(2)}), ${GATE_POST_PROBE_INSET.solid} m ` +
          `in front of the gate post at (${post.x.toFixed(2)}, ${post.z.toFixed(2)}) — inside the ` +
          `${reach.toFixed(2)} m the post is supposed to hold her off, so the gate is not solid`,
      );
    }
  }

  say(
    `${GATE_UNCOVERED}; its solidity clause is live on ${postsCovered} of ${arch.posts.length} gate posts` +
      (masked.length > 0
        ? ` — masked at ${masked.join(' and ')}, where something that is not the post already blocks ` +
          `${GATE_POST_PROBE_INSET.clear.toFixed(2)} m out, past the ${reach.toFixed(2)} m the post ` +
          `itself reaches, so the reading a stride closer proves nothing there`
        : ''),
  );
  if (postsCovered === 0) {
    say('  ...so the gate-is-solid clause asserts NOTHING on this seed');
  }

  // 3. Nothing of it hangs into that gap.
  const headroom = arch.minY - arch.groundY;
  if (headroom < TALLEST_CHILD_HEIGHT) {
    fouls.push(
      `the gate arch reaches down to ${arch.minY.toFixed(2)} m, ${headroom.toFixed(2)} m over ground at ` +
        `${arch.groundY.toFixed(2)} m — less than the ${TALLEST_CHILD_HEIGHT} m of the tallest child the ` +
        'park can make, so she walks through it',
    );
  }

  return fouls;
};

const entrancesAreUsable: Invariant = (facts) => {
  const blocked: string[] = [];
  for (const entrance of facts.entrances) {
    if (standableNear(facts, entrance.x, entrance.z)) continue;
    blocked.push(
      `${entrance.id} at (${entrance.x.toFixed(1)}, ${entrance.z.toFixed(1)}) has no standable ` +
        `ground within ${SHORTFALL_TOLERANCE} m`,
    );
  }
  return blocked;
};

/**
 * No bush clump stands on the paving, or inside a plot.
 *
 * A bush is a solid collider a child has to walk round, so one sitting on a
 * path narrows it, and one inside a booth's plot is furniture in a room it does
 * not belong to. Held to the clump's **own collider radius** — the thing that
 * actually gets in the way — against the paved *surface*, not the centre line,
 * so the number comes from the built park rather than from the generator's
 * `isPlantable` clearance. Re-deriving that clearance here would only prove the
 * scatter agrees with itself.
 *
 * There was no bush invariant before this one, and nothing to write it against:
 * bushes had no observable output at all until {@link BushFact}. That is the
 * gap that let a fill-to-108 loop quietly re-roll every clump in the park each
 * time a path moved — see `Scenery.ts`'s `BUSH_BUDGET`.
 */
const bushesStandOnOpenGround: Invariant = (facts) => {
  const fouls: string[] = [];
  for (const bush of facts.bushes) {
    const where = `bush at (${bush.x.toFixed(1)}, ${bush.z.toFixed(1)})`;
    const paving = distanceToOtherPaving(facts, '', [bush.x, bush.z]);
    if (paving < bush.radius) {
      fouls.push(
        `${where} overlaps the paving by ${(bush.radius - paving).toFixed(2)} m ` +
          `— a child walking the path has to go round it`,
      );
    }
    for (const plot of facts.plots) {
      const gap = Math.hypot(bush.x - plot.x, bush.z - plot.z) - plot.boundingRadius - bush.radius;
      if (gap < 0) fouls.push(`${where} stands ${(-gap).toFixed(2)} m inside ${plot.id}'s plot`);
    }
  }
  return fouls;
};

/** No two trees grow through each other. */
const treesDoNotInterpenetrate: Invariant = (facts) => {
  const overlaps: string[] = [];
  for (let i = 0; i < facts.trees.length; i += 1) {
    for (let j = i + 1; j < facts.trees.length; j += 1) {
      const a = facts.trees[i]!;
      const b = facts.trees[j]!;
      const gap = Math.hypot(a.x - b.x, a.z - b.z) - a.footprint - b.footprint;
      if (gap < 0) {
        overlaps.push(
          `trees at (${a.x.toFixed(1)}, ${a.z.toFixed(1)}) and ` +
            `(${b.x.toFixed(1)}, ${b.z.toFixed(1)}) interpenetrate by ${(-gap).toFixed(2)} m`,
        );
      }
    }
  }
  return overlaps;
};

/**
 * No tree grows into a wall.
 *
 * Measured canopy edge to wall face: `TreeFact.footprint` is the furthest any
 * part the tree is actually built from reaches away from its trunk, and
 * `halfWidth` is the widest part of the wall (a stone wall's coping stone
 * overhangs its own courses), so this is the gap between the two things a
 * child can see and walk between.
 *
 * Held to {@link WALKABLE_GAP} for the same reason `wallsDoNotClash` is. Every
 * tree gets a collider of its own, so a tree beside a wall is two solid
 * obstacles: a slot between them narrower than two player radii is not a way
 * through, it is a dead end that looks like a way through — and the six-year-
 * old this park is for will try to run down it. Requiring the clearance at the
 * canopy edge rather than at the trunk is also what keeps a wall from
 * vanishing into a bush of leaves, which is the visible half of the same bug.
 */
const treesKeepOffWalls: Invariant = (facts) => {
  const fouls: string[] = [];
  for (const tree of facts.trees) {
    for (const wall of facts.walls) {
      const gap =
        segmentDistance([tree.x, tree.z], [tree.x, tree.z], wall.from, wall.to) -
        wall.halfWidth -
        tree.footprint;
      if (gap < WALKABLE_GAP) {
        fouls.push(
          `tree at (${tree.x.toFixed(1)}, ${tree.z.toFixed(1)}) reaching ` +
            `${tree.footprint.toFixed(2)} m leaves ${gap.toFixed(2)} m to the ${wall.kind} run ` +
            `(${fmt(wall.from)}->${fmt(wall.to)})`,
        );
      }
    }
  }
  return fouls;
};

/**
 * **No bush grows through a wall or out of a tree.**
 *
 * Issue #500, and it had been true since walls and trees both existed: the
 * bush scatter's whole idea of an obstacle was `isPlantable` — paving, plots,
 * the railway, ride exits, the plaza — so nothing else could refuse it a spot.
 * Measured on the built park across these five seeds before the fix: **64
 * clumps standing inside a wall run** (worst 1.17 m, through a wooden fence a
 * child can see straight through) and **653 inside a tree's own footprint**
 * (worst 3.89 m, a clump growing out of a trunk).
 *
 * About eighty invariants missed it for one reason: **every one of them names
 * the pair it checks**, and nobody had written `bushesKeepOffWalls`. This one
 * names two more pairs and is therefore the same shape of thing — it is here
 * to hold the fix on `main` until the universal deny-by-default sweep
 * (`feat/universal-overlap-invariant`, blocked on this issue and #501) lands
 * and subsumes it. **When that merges, delete this**; a narrower check kept
 * beside a wider one is two definitions of one rule, which is this repo's
 * most-repeated bug.
 *
 * Measured off the built park, in the game's own published numbers: a clump's
 * `radius` is the collider a walking child actually meets, a wall's
 * `halfWidth` is what it is drawn at, and a tree's `footprint` is derived from
 * the parts it is really built from. Nothing here re-derives the scatter's own
 * clearances, which would only prove the generator agrees with itself.
 *
 * Threshold zero: touching is legal and a bush against a fence is a good look.
 * It is *sharing ground* that a player sees as a bush sprouting through rails.
 */
const bushesGrowThroughNothing: Invariant = (facts) => {
  const fouls: string[] = [];
  for (const bush of facts.bushes) {
    const where = `bush at (${bush.x.toFixed(1)}, ${bush.z.toFixed(1)})`;
    for (const wall of facts.walls) {
      const overlap =
        wall.halfWidth +
        bush.radius -
        segmentDistance([bush.x, bush.z], [bush.x, bush.z], wall.from, wall.to);
      if (overlap > 0) {
        fouls.push(
          `${where} stands ${overlap.toFixed(2)} m inside the ${wall.kind} run ` +
            `(${fmt(wall.from)}->${fmt(wall.to)}) — it grows through the rails`,
        );
      }
    }
    for (const tree of facts.trees) {
      const overlap =
        tree.footprint + bush.radius - Math.hypot(bush.x - tree.x, bush.z - tree.z);
      if (overlap > 0) {
        fouls.push(
          `${where} stands ${overlap.toFixed(2)} m inside the footprint of the tree at ` +
            `(${tree.x.toFixed(1)}, ${tree.z.toFixed(1)}) reaching ${tree.footprint.toFixed(2)} m`,
        );
      }
    }
  }
  // What this ran against, on every run including a green one — a count of
  // zero fouls means nothing unless you know how many pairs produced it.
  process.stderr.write(
    `[bushes grow through nothing] swept ${facts.bushes.length} clumps x ` +
      `${facts.walls.length} wall runs and ${facts.trees.length} trees; ` +
      `NOT covered: a clump's drawn blobs, which reach up to 2.15 m while ` +
      `PlacedBush.radius publishes 0.85 m, so a leaf overhanging a wall it ` +
      `does not stand in is invisible here\n`,
  );
  return fouls;
};

/** No lamp stands in anything: another lamp, a wall, a plot, or the railway. */
const lampsTouchNothing: Invariant = (facts) => {
  const fouls: string[] = [];
  for (let i = 0; i < facts.lamps.length; i += 1) {
    const [x, z] = facts.lamps[i]!;
    const where = `lamp at (${x.toFixed(1)}, ${z.toFixed(1)})`;

    for (let j = i + 1; j < facts.lamps.length; j += 1) {
      const [ox, oz] = facts.lamps[j]!;
      const gap = Math.hypot(x - ox, z - oz);
      if (gap < WALKABLE_GAP) fouls.push(`${where} is ${gap.toFixed(2)} m from another lamp`);
    }
    for (const wall of facts.walls) {
      const gap = segmentDistance([x, z], [x, z], wall.from, wall.to) - wall.halfWidth;
      if (gap < 0) fouls.push(`${where} stands in a ${wall.kind} wall`);
    }
    for (const plot of facts.plots) {
      const gap = Math.hypot(x - plot.x, z - plot.z) - plot.boundingRadius;
      if (gap < 0) fouls.push(`${where} stands inside plot ${plot.id}`);
    }
    const rail = facts.distanceToRail(x, z);
    if (rail < TRACK_CLEARANCE) {
      fouls.push(`${where} is ${rail.toFixed(2)} m from the rail centre line`);
    }
  }
  return fouls;
};

/**
 * Every ride's exit (GAME_DESIGN.md's EXIT rule, 28 July 2026) is clear
 * ground a rider of the player's own radius can actually stand on, and the
 * real nav lattice can actually route a child there from the entrance —
 * proving `paths.ts`'s exit nodes are not just present in the graph but
 * genuinely usable, the same "measure the built park" standard every other
 * invariant here holds to.
 */
const rideExitsAreUsable: Invariant = (facts) => {
  const problems: string[] = [];
  for (const exit of facts.exits) {
    const at = `${exit.id} at (${exit.x.toFixed(1)}, ${exit.z.toFixed(1)})`;
    if (!facts.isStandable(exit.x, exit.z)) problems.push(`${at} is not clear ground`);
    if (!facts.reachableFromEntrance(exit.x, exit.z)) {
      problems.push(`${at} is not reachable from the entrance`);
    }
  }
  return problems;
};

/**
 * The Rail Race's exit has room for the whole **party** that arrives on it, not
 * just for one child.
 *
 * A race ends with four riders, and since 1 August 2026 all four of them are
 * put down at the exit: the player by `RailRace.arrive()`, and Pip, Nell and
 * Otto — look-alikes, see `railRace/exitCrowd.ts` — gathered round her. Three
 * extra bodies is three more chances for somebody to be standing inside a
 * hedge, or inside the player, on a seed nobody looked at.
 *
 * This runs the **real** placement code (`resolveDismount` then
 * `resolveDismountGroup`) against the **real** built collision world, in the
 * same order and with the same radii the ride uses, and then measures where
 * everybody actually ended up. It does not restate the rule that placed them:
 * an assertion that the placer's output satisfies the placer's own constraint
 * would prove nothing, so the check is against `facts.isStandable` — the same
 * "can a walker of the player's radius stand here" question every other
 * invariant in this file asks — and against {@link WALKABLE_GAP}, the width two
 * bodies genuinely need, rather than the seed spacing the placer aims for.
 *
 * The rival count is read off the **built ride** (`laneCount` minus the
 * player's own lane) rather than imported, for the reason `railRaceFliesClear`
 * gives: a static import of `railRace/plan.ts` here would pull in
 * `parkManifest` and fix the park seed before the harness has set it.
 */
const railRaceExitFitsTheParty: Invariant = (facts) => {
  const exit = facts.exits.find((node) => node.id === 'exit-railRace');
  if (!exit) return [`the built path graph has no 'exit-railRace' node`];

  const collision = facts.world.collision;
  // The player is set down first and keeps her spot — exactly `arrive()`'s
  // order, which is what makes "nobody appears on top of her" true.
  const player = resolveDismount(collision, exit.x, exit.z, PLAYER_RADIUS);
  const rivals = facts.world.railRace.laneCount - 1;
  const spots = resolveDismountGroup(collision, player.x, player.z, PLAYER_RADIUS, rivals, [
    { x: player.x, z: player.z, radius: PLAYER_RADIUS },
  ]);

  // Fail here rather than carrying on: the crowding checks below walk whatever
  // party was actually placed, so a short list would quietly check fewer bodies
  // against each other and still come back clean.
  if (spots.length !== rivals) {
    return [`only ${spots.length} of ${rivals} rivals were given a spot`];
  }

  const party = [
    { who: 'the player', x: player.x, z: player.z },
    ...spots.map((spot, index) => ({ who: `rival ${index + 1}`, x: spot.x, z: spot.z })),
  ];

  const problems: string[] = [];
  for (let i = 0; i < party.length; i += 1) {
    const a = party[i]!;
    const at = `(${a.x.toFixed(1)}, ${a.z.toFixed(1)})`;
    if (!facts.isStandable(a.x, a.z)) {
      problems.push(`${a.who} is put down at ${at}, which is not clear ground`);
    }
    for (let j = i + 1; j < party.length; j += 1) {
      const b = party[j]!;
      const gap = Math.hypot(a.x - b.x, a.z - b.z);
      if (gap < WALKABLE_GAP) {
        problems.push(
          `${a.who} and ${b.who} are ${gap.toFixed(2)} m apart at ${at} — ` +
            `two bodies need ${WALKABLE_GAP} m, so they are standing inside each other`,
        );
      }
    }
  }
  return problems;
};

/**
 * **No paved ribbon stops anywhere but a destination.**
 *
 * REQUIREMENTS-2026-07-28 §5, the family's "paths to nowhere" ruling: the
 * walking network derives from a graph of places to visit only, and no ribbon
 * may terminate anywhere but a node. A spur has two ends and both are held to
 * it — the far end must reach the node its edge names, and the near end must
 * genuinely meet the rest of the paving rather than beginning in the grass a
 * few metres off it.
 *
 * Measured on the **drawn** curve, which is the point. The ribbon is a
 * Catmull-Rom swept through control points, and `paths.ts` chooses a spur's
 * junction by walking the control *polygon* of the routes built so far — a
 * polygon the drawn curve bows away from. Checking the control points would
 * only restate the generator's intention; these are the metres of paving a
 * child actually walks on.
 *
 * The backbone is exempt: it is a closed loop and has no ends.
 */
const noPathEndsNowhere: Invariant = (facts) => {
  const nodes = new Map(facts.pathNodes.map((node) => [node.id, node]));
  const strays: string[] = [];

  for (const edge of facts.pathEdges) {
    if (edge.backbone) continue;
    const first = edge.points[0];
    const last = edge.points[edge.points.length - 1];
    if (!first || !last) {
      strays.push(`${edge.name} is a paved edge that drew no ribbon at all`);
      continue;
    }

    const ends = [
      ['start', edge.from, first],
      ['end', edge.to, last],
    ] as const;

    for (const [which, id, point] of ends) {
      // `'ring'` is not a node: it is `paths.ts`'s name for the paved network
      // itself. A spur branches off wherever paving already runs — the
      // backbone or an earlier spur — so what has to be true of this end is
      // that it really does land on some other paving.
      if (id === 'ring') {
        const gap = distanceToOtherPaving(facts, edge.name, point);
        if (gap > ARRIVAL) {
          strays.push(
            `${edge.name}'s ${which} at ${fmt(point)} is ${gap.toFixed(2)} m from the ` +
              `nearest other paving — it branches off nothing`,
          );
        }
        continue;
      }

      const node = nodes.get(id);
      if (!node) {
        strays.push(`${edge.name}'s ${which} names '${id}', which is not a node in the graph`);
        continue;
      }
      const gap = Math.max(
        0,
        Math.hypot(point[0] - node.x, point[1] - node.z) - node.reach,
      );
      if (gap > ARRIVAL) {
        strays.push(
          `${edge.name}'s ${which} at ${fmt(point)} stops ${gap.toFixed(2)} m short of ` +
            `'${node.id}' (${node.kind}) at ${fmt([node.x, node.z])} — a path to nowhere`,
        );
      }
    }
  }
  return strays;
};

/**
 * **Every plot's sign faces exactly the camera's own fixed diagonal**
 * (issue #269).
 *
 * `anchors.ts`'s own doc is explicit that this applies to every plot, camera
 * facing or not: "these all sit near +45 degrees, which is the one fixed
 * angle the camera ever looks from... a sign facing any other way is one a
 * child simply cannot read." Before issue #269, "near" meant a fresh random
 * draw every seed (`parkLayout.ts` drew `Math.PI * rng.range(0.2, 0.3)`) —
 * never exactly square to the camera, and different on every rebuild.
 *
 * `PlotFact.signYaw` is read straight off the solved `PARK_LAYOUT` entry —
 * not re-derived — and that same field is what a sign's own mesh rotation is
 * built from everywhere it appears (`minigames/dodgems/plot.ts`'s
 * `signGroup.rotation.y`, `world/hotel/Hotel.ts`'s `facadeYaw`,
 * `stallPlacement.ts`'s `counterFacing`), so one measurement here catches
 * every one of those drifting apart again, the way `parkLayout.ts`'s own
 * "one owner" doc warns they used to.
 */
const buildingsFaceTheCameraAxis: Invariant = (facts) => {
  const problems: string[] = [];
  for (const plot of facts.plots) {
    const drift = Math.abs(plot.signYaw - CAMERA_FACING_YAW);
    if (drift > 1e-9) {
      problems.push(
        `'${plot.id}' has signYaw ${plot.signYaw.toFixed(4)} rad, ${drift.toFixed(4)} rad off ` +
          `CAMERA_FACING_YAW (${CAMERA_FACING_YAW.toFixed(4)} rad) — not axis-aligned to the camera`,
      );
    }
  }
  return problems;
};

/**
 * Longest continuous stretch of any paved ribbon allowed to run diagonally
 * rather than along a grid axis (issue #269).
 *
 * Not zero, on purpose. Two things legitimately still run at an angle:
 *
 * - **A booth's own doorway approach.** `paths.ts`'s `spur()` deliberately
 *   carries the last few metres of a camera-facing booth's spur along the
 *   counter's own facing diagonal so the ribbon arrives head-on rather than
 *   grazing the counter's side wall (see that function's "Arrive HEAD-ON,
 *   not obliquely" note) — a short, intentional exception to the rule this
 *   invariant otherwise enforces.
 * - **A train platform's fixed final approach**, which predates issue #269
 *   and is out of its scope: the platform turn is authored geometry, not
 *   part of the axis-aligned trunk network `paths.ts` grows.
 *
 * The closed backbone ring is exempt outright, not just tolerated — see
 * {@link ringIsATrueCircleRoundTheStatue} below. It is not a lapse in this
 * invariant's coverage: Jim's own follow-up instruction (issue #269, 18
 * August 2026) is that the ring is deliberately the one route in the network
 * allowed to be a genuine circle, off grid axes for its entire circumference,
 * while everything else — every spur, every interconnect — stays on the
 * grid this invariant polices.
 *
 * Measured, not guessed: the canonical seed's longest such stretch (outside
 * the now-exempt ring) is 11.2 m
 * (the west station's own platform approach). This is set generously above
 * that measured worst case — the same shape of bound
 * {@link TRESTLE_GAP_TOLERANCE} uses — so what actually trips it is a
 * regression: a long run of the *trunk* network (a ring segment, a spur's
 * main body) left diagonal, not a legitimate short approach.
 */
const MAX_DIAGONAL_APPROACH = 16;

/**
 * **Every paved ribbon's trunk runs on grid axes** — purely north/south or
 * purely east/west, never a sustained diagonal (issue #269).
 *
 * Measured on the drawn curve (`PathEdgeFact.points`, sampled every ~0.5 m
 * off the real Catmull-Rom curve `paths.ts` sweeps) — the same ground
 * {@link noPathEndsNowhere} stands on, and for the same reason:
 * `paths.ts` axis-aligns its *control* points, and the curve bows a little
 * rounding each corner, so "runs on grid axes" is stated as a bound on how
 * far any *continuous* stretch of off-axis travel can run
 * ({@link MAX_DIAGONAL_APPROACH}), not as "every single 0.5 m hop is
 * exactly axis-aligned" — a corner's own rounding would fail that trivially
 * and prove nothing about the shape of the route.
 *
 * A hop counts as off-axis when the smaller of its x/z movement is more
 * than 15% of its own length (~8.6 degrees off a grid axis) — loose enough
 * that ordinary curve-sampling jitter on a straight run never counts, tight
 * enough that a genuinely diagonal run cannot hide inside it.
 */
/**
 * **The railway's own geometry is the grid rule's one measured exception**
 * (Decision 6's "genuine minority"): a crossing runs square to the TRACK
 * — which is diagonal to the world axes wherever the loop is — and a
 * fence-following leg (a pocket pinched between rail and boundary has
 * nowhere else to walk) curves with the loop. Both are the railway
 * dictating the shape, exactly as designed (`crossingPlan.ts`); a stepped
 * zigzag over a bridge deck is the absurdity this exemption avoids.
 * Measured off the built park: a hop is railway geometry when it sits
 * over a real bridge's own footprint, or when both its ends hug the rail
 * corridor (fence-follow legs run at `RAIL_CORRIDOR_CLEARANCE`, 4.2 m;
 * a level crossing's feet stand `DECK_HALF_LENGTH + 4` ≈ 7.2 m out).
 *
 * Shared by {@link pathsRunOnGridAxes} and {@link streetsShareLatticeLines}
 * — one owner for "is this hop the railway's shape, not the street plan's".
 */
function railwayGeometryTest(
  facts: ParkFacts,
): (a: readonly [number, number], b: readonly [number, number]) => boolean {
  const railPoint = new Vector3();
  const nearRail = (x: number, z: number): boolean => {
    const route = facts.world.train.route;
    route.pointAt(route.distanceNear(x, z), railPoint);
    return Math.hypot(railPoint.x - x, railPoint.z - z) <= 8.5;
  };
  return (a, b) => {
    const midX = (a[0] + b[0]) / 2;
    const midZ = (a[1] + b[1]) / 2;
    for (const bridge of facts.world.train.bridges) {
      if (bridge.covers(midX, midZ)) return true;
    }
    return nearRail(a[0], a[1]) && nearRail(b[0], b[1]);
  };
}

const describeGround = (ground: OffAxisGround): string =>
  `the paving from ${fmt(ground.from)} to ${fmt(ground.to)} runs diagonally for ` +
  `${ground.extent.toFixed(1)} m — longer than a doorway approach or a platform turn should ` +
  `ever need (drawn by ${ground.carriers.join(', ')})`;

const pathsRunOnGridAxes: Invariant = (facts) => {
  // See {@link railwayGeometryTest} — the grid rule's one measured exception.
  const ground = offAxisGround(facts.pathEdges, railwayGeometryTest(facts));
  return ground
    .filter((piece) => piece.extent > MAX_DIAGONAL_APPROACH)
    .map((piece) => describeGround(piece));
};

/**
 * **The grid verdict is a property of the paving, not of the route object
 * that happens to carry it.**
 *
 * `pathsRunOnGridAxes` used to answer differently about one piece of painted
 * ground depending on which ribbon you asked — see `gridAxes.ts`'s header for
 * the seed 225 measurement that pinned it down, where the same diagonal at the
 * `building` door was "two short approach runs" to `spur-building` and the
 * first 3 m of a 15.89 m failure to `connector-building-ballPit`. A check that
 * changes its answer with the observer is not a check, so this asserts the
 * property directly rather than leaving it to be inferred from the fix.
 *
 * {@link recutCarriers} re-cuts every edge into two carriers through the
 * middle of its longest off-axis stretch. **Not one metre of paving moves** —
 * the sample points are the same points, in the same order, with the same
 * classification — so the only thing that changed is which route object owns
 * which metres, and the answer must be identical, extent for extent.
 *
 * It is deliberately not a comparison of *counts*: two runs with the same
 * number of violations can be a swap, and only the set says which.
 */
const gridAxisVerdictsIgnoreTheCarrier: Invariant = (facts) => {
  const railwayGeometry = railwayGeometryTest(facts);
  const asBuilt = offAxisGround(facts.pathEdges, railwayGeometry);
  const recut = offAxisGround(recutCarriers(facts.pathEdges, railwayGeometry), railwayGeometry);

  // Geometry only: the carrier *names* are expected to differ, since that is
  // the whole variable being changed.
  const shape = (ground: readonly OffAxisGround[]): string[] =>
    ground.map((piece) => `${piece.extent.toFixed(2)} ${fmt(piece.from)} -> ${fmt(piece.to)}`).sort();

  const before = shape(asBuilt);
  const after = shape(recut);
  const missing = before.filter((line) => !after.includes(line));
  const extra = after.filter((line) => !before.includes(line));
  if (missing.length === 0 && extra.length === 0) {
    // A passing run must still say what it covered — CLAUDE.md's "a check that
    // stops covering something must say so on every run". stderr, because
    // vitest's default reporter shows console output from failing tests only.
    process.stderr.write(
      `    gridAxisVerdictsIgnoreTheCarrier: ${asBuilt.length} pieces of off-axis paving, ` +
        `longest ${(asBuilt[0]?.extent ?? 0).toFixed(1)} m, unchanged when every edge is re-cut ` +
        `into two carriers\n`,
    );
    return [];
  }
  return [
    `re-cutting the same paving into different route objects changed the answer: ` +
      `${missing.length} piece(s) only the as-built carriers see (${missing.join(' | ')}), ` +
      `${extra.length} only the re-cut ones do (${extra.join(' | ')})`,
  ];
};

/**
 * The street lattice's pitch — Decision 1's "grid pitch 12 m", the same
 * number `paths.ts`'s `STREET_PITCH` builds with. Duplicated as a literal
 * deliberately: this invariant asks whether the *built park* sits on a
 * 12 m lattice, and importing the generator's own constant would make the
 * check true by definition whenever someone changed the pitch — measuring
 * the rules that built the park instead of the park (CLAUDE.md's procgen
 * rule, and the exact "check that cannot fail" disease this file exists
 * to prevent).
 */
const STREET_LATTICE_PITCH = 12;

/**
 * How long an axis-aligned straight run must be before it counts as a
 * *street* (and so must sit on a lattice line): door stubs, arrival leads
 * and fillet transitions are all shorter than this; anything longer is a
 * run a person would read as a street line on the map.
 */
const MIN_STREET_RUN = 8;

/**
 * How far a street run's own line may sit off the nearest lattice line.
 * The drawn curve on a straight is exact (dense collinear control points),
 * so this headroom only has to absorb the fillet's own approach at the
 * run's two ends — measured worst case across the five seeds: 0.31 m.
 */
const STREET_LINE_TOLERANCE = 0.9;

/**
 * How much of an edge's either end counts as its door approach (see the
 * exemption list in {@link streetsShareLatticeLines}): the doormat's
 * stand-off (1.4 m), its 3.5 m arrival lead, the into-the-plot `past`
 * extension (2 m), the up-to-7 m off-street stub tail and a fillet's own
 * give. A run must fit entirely inside this reach to be exempt, so no
 * street-length line can hide in it: the longest exemptable run is by
 * construction shorter than this constant.
 */
const DOOR_APPROACH_REACH = 15;

/**
 * **Every street sits on the shared 12 m lattice through the plaza** —
 * the invariant that actually checks "reads as a grid", where
 * {@link pathsRunOnGridAxes} above only ever bounded one continuous
 * diagonal's length. The lesson of 23 August 2026 (Jim, on a top-down
 * screenshot of a park where that older invariant passed clean on every
 * seed: *"that top-down view looks nothing like how we discussed"*): a
 * network can be axis-aligned segment by segment and still read as
 * organic wandering, because "reads as a grid" is a property of the *set
 * of lines* the segments share — the old elbow-folding router put its
 * north-south runs on 19 different x-positions with nothing lining up
 * with anything. So this measures exactly that: every axis-aligned drawn
 * run long enough to read as a street ({@link MIN_STREET_RUN}) must sit
 * within {@link STREET_LINE_TOLERANCE} of a lattice line at
 * {@link STREET_LATTICE_PITCH} through the plaza (the lattice is anchored
 * there so the statue circle's four compass streets are lattice lines by
 * construction, whatever the seed).
 *
 * Exemptions, all measured shapes rather than escape hatches:
 * - **Railway geometry** ({@link railwayGeometryTest}) — a crossing's
 *   ramp corridor and a fence-follow leg take the railway's shape.
 * - **The gate corridor** — `gate-approach`'s authored `x = 0` run: the
 *   park gate is a world-fixed landmark (`[0, 54]`, the cat-bus's own
 *   arrival ground) and the lattice is plaza-anchored, so the corridor
 *   is on-lattice only by coincidence of seed.
 * - **`fountain-approach`** — the plaza spoke inside the statue circle,
 *   deliberately radial.
 * - **A route's own door approach** ({@link DOOR_APPROACH_REACH}): the
 *   final metres of an edge run where the *door* is — the doormat, its
 *   arrival lead and the into-the-plot-mouth extension all sit on the
 *   destination's own line (Decisions 7/8: one entrance node strictly in
 *   front, pavement to the doorstep), and a door is only ever on a
 *   lattice line by coincidence. Bounded: a run must fit *entirely*
 *   inside the reach to be exempt, so it can never also be street-length
 *   paving that merely ends at a door.
 * - **A run threading ground the lattice does not serve**: when *both*
 *   lattice lines either side of the run are obstructed over the run's own
 *   span — by a plot's real footprint, the boundary, or the rail corridor,
 *   measured off the built park — there is no street line for this paving
 *   to sit on, and threading the gap between plots is the router doing its
 *   job (the layout solver does not yet keep street lines clear — Decision
 *   4's joint solve is the eventual owner of removing this case). A run
 *   with even one clear neighbouring line stays a violation: it could have
 *   been there, and was not.
 * - **Station spurs' own platform tails** are *not* name-exempted: their
 *   fence-follows and platform turns are already railway geometry by
 *   measurement, and any straight run they keep beyond that is a street
 *   like any other.
 */
const streetsShareLatticeLines: Invariant = (facts) => {
  const problems: string[] = [];
  const railwayGeometry = railwayGeometryTest(facts);
  const plaza = facts.pathNodes.find((node) => node.kind === 'plaza');
  if (!plaza) {
    return ['no plaza node in the path graph — cannot anchor the street lattice'];
  }
  const offLattice = (coordinate: number, anchor: number): number => {
    const remainder =
      ((((coordinate - anchor) % STREET_LATTICE_PITCH) + STREET_LATTICE_PITCH) %
        STREET_LATTICE_PITCH);
    return Math.min(remainder, STREET_LATTICE_PITCH - remainder);
  };

  // Is a straight lattice-line segment obstructed anywhere along the span,
  // in the built park? Sampled every 2 m. The margins mirror what the
  // generator itself demands of a street (`paths.ts`: plots at
  // `STREET_PLOT_CLEARANCE` 2.6, the rail corridor at 4.2, the boundary at
  // a fallback route's own walkable margin) — a hair under each, so float
  // noise never flips a genuinely usable line to "blocked", while a line
  // the generator would refuse anyway never counts as available (calling
  // it available would make the violation unfixable, not stricter).
  const railPoint = new Vector3();
  // The statue circle's ground blocks a street exactly as the generator's
  // own ring guard does — measured off the built backbone ring's drawn
  // radius, not off a constant.
  const backbone = facts.pathEdges.find((edge) => edge.backbone);
  let ringRadius = 0;
  if (backbone) {
    let sum = 0;
    for (const [x, z] of backbone.points) sum += Math.hypot(x - plaza.x, z - plaza.z);
    ringRadius = sum / backbone.points.length;
  }
  const route = facts.world.train.route;
  const lineBlocked = (
    axis: 'x' | 'z',
    line: number,
    spanStart: number,
    spanEnd: number,
  ): boolean => {
    const from = Math.min(spanStart, spanEnd);
    const to = Math.max(spanStart, spanEnd);
    const steps = Math.max(1, Math.ceil((to - from) / 2));
    for (let s = 0; s <= steps; s += 1) {
      const along = from + ((to - from) * s) / steps;
      const x = axis === 'z' ? line : along;
      const z = axis === 'z' ? along : line;
      for (const plot of facts.plots) {
        const dx = Math.max(Math.abs(x - plot.x) - plot.halfX, 0);
        const dz = Math.max(Math.abs(z - plot.z) - plot.halfZ, 0);
        if (Math.hypot(dx, dz) < 2.55) return true;
      }
      if (facts.boundary.distanceToEdge(x, z) < 2.55) return true;
      if (Math.hypot(x - plaza.x, z - plaza.z) < ringRadius + 0.4) return true;
      route.pointAt(route.distanceNear(x, z), railPoint);
      if (Math.hypot(railPoint.x - x, railPoint.z - z) < 4.0) return true;
      // A Rail Race arch foot blocks a street the same way it blocks the
      // generator: `paths.ts`'s `ARCH_FOOT_MARGIN` (a walkable gap plus
      // the widest ribbon's own half-width and kerb) keeps paving this far
      // off every foot, drawn or not — matched to the formula, a hair
      // under, so a borderline-clear spot never flips the wrong way.
      const ARCH_FOOT_REACH = PLAYER_RADIUS * 2 + 0.4 + (3.6 / 2 + 0.85) - 0.02;
      for (const foot of facts.railRaceArchFeet) {
        if (Math.hypot(x - foot.x, z - foot.z) < foot.radius + ARCH_FOOT_REACH) return true;
      }
    }
    return false;
  };

  for (const edge of facts.pathEdges) {
    if (edge.backbone) continue;
    if (edge.name === 'fountain-approach') continue;
    const points = edge.points;

    // Arc length at each sample, for the door-approach exemption below.
    const along: number[] = [0];
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1] as readonly [number, number];
      const b = points[i] as readonly [number, number];
      along.push((along[i - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const total = along[along.length - 1] as number;

    // Group consecutive same-axis hops into maximal straight runs.
    let axis: 'x' | 'z' | null = null; // 'x': east-west (constant z); 'z': north-south (constant x)
    let runStart = 0;
    const flush = (endIndex: number): void => {
      if (axis === null || endIndex <= runStart) return;
      const a = points[runStart] as readonly [number, number];
      const b = points[endIndex] as readonly [number, number];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const runAxis = axis;
      const startAlong = along[runStart] as number;
      const endAlong = along[endIndex] as number;
      axis = null;
      if (length < MIN_STREET_RUN) return;
      // The door's own approach — see this invariant's header.
      if (endAlong <= DOOR_APPROACH_REACH || startAlong >= total - DOOR_APPROACH_REACH) return;
      // The run's own line: mean of the cross-axis coordinate.
      let sum = 0;
      for (let i = runStart; i <= endIndex; i += 1) {
        sum += (points[i] as readonly [number, number])[runAxis === 'z' ? 0 : 1];
      }
      const line = sum / (endIndex - runStart + 1);
      if (edge.name === 'gate-approach' && runAxis === 'z' && Math.abs(line) < 1) return;
      const anchor = runAxis === 'z' ? plaza.x : plaza.z;
      const off = offLattice(line, anchor);
      if (off > STREET_LINE_TOLERANCE) {
        // Threading ground the lattice does not serve — see this
        // invariant's exemption list. Both neighbouring lines must be
        // obstructed over the run's own span for the run to be excused.
        const rem =
          ((((line - anchor) % STREET_LATTICE_PITCH) + STREET_LATTICE_PITCH) %
            STREET_LATTICE_PITCH);
        const lower = line - rem;
        const upper = lower + STREET_LATTICE_PITCH;
        const spanStart = runAxis === 'z' ? a[1] : a[0];
        const spanEnd = runAxis === 'z' ? b[1] : b[0];
        // A neighbouring line is *usable* only when the line itself is
        // clear over the run's span AND the run could actually have joined
        // it — a short perpendicular connector from at least one of the
        // run's own ends must also be clear. A locally-clear line walled
        // off behind a field of rainbow-arch feet (seed 11's rim stall)
        // is not a street this run declined; it is ground the router
        // could never reach.
        const usable = (candidateLine: number): boolean => {
          if (lineBlocked(runAxis, candidateLine, spanStart, spanEnd)) return false;
          const joins: (readonly [number, number, number, number])[] =
            runAxis === 'z'
              ? [
                  [line, spanStart, candidateLine, spanStart],
                  [line, spanEnd, candidateLine, spanEnd],
                ]
              : [
                  [spanStart, line, spanStart, candidateLine],
                  [spanEnd, line, spanEnd, candidateLine],
                ];
          return joins.some(([jax, jaz, jbx, jbz]) => {
            const steps = Math.max(1, Math.ceil(Math.hypot(jbx - jax, jbz - jaz) / 1.5));
            for (let s = 0; s <= steps; s += 1) {
              const t = s / steps;
              const x = jax + (jbx - jax) * t;
              const z = jaz + (jbz - jaz) * t;
              for (const foot of facts.railRaceArchFeet) {
                const reach = PLAYER_RADIUS * 2 + 0.4 + (3.6 / 2 + 0.85) - 0.02;
                if (Math.hypot(x - foot.x, z - foot.z) < foot.radius + reach) return false;
              }
              for (const plot of facts.plots) {
                const dx = Math.max(Math.abs(x - plot.x) - plot.halfX, 0);
                const dz = Math.max(Math.abs(z - plot.z) - plot.halfZ, 0);
                if (Math.hypot(dx, dz) < 2.55) return false;
              }
              if (facts.boundary.distanceToEdge(x, z) < 2.55) return false;
              if (Math.hypot(x - plaza.x, z - plaza.z) < ringRadius + 0.4) return false;
              route.pointAt(route.distanceNear(x, z), railPoint);
              if (Math.hypot(railPoint.x - x, railPoint.z - z) < 4.0) return false;
            }
            return true;
          });
        };
        if (!usable(lower) && !usable(upper)) {
          return;
        }
      }
      if (off > STREET_LINE_TOLERANCE) {
        problems.push(
          `${edge.name} runs ${runAxis === 'z' ? 'north-south' : 'east-west'} for ` +
            `${length.toFixed(1)} m on ${runAxis === 'z' ? 'x' : 'z'} = ${line.toFixed(2)}, ` +
            `${off.toFixed(2)} m off the nearest ${STREET_LATTICE_PITCH} m lattice line through ` +
            `the plaza (${plaza.x.toFixed(2)}, ${plaza.z.toFixed(2)}) — a street on its own ` +
            `private line is what makes the network read as wandering instead of a grid`,
        );
      }
    };

    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1] as readonly [number, number];
      const b = points[i] as readonly [number, number];
      const dx = Math.abs(b[0] - a[0]);
      const dz = Math.abs(b[1] - a[1]);
      const hop = Math.hypot(dx, dz);
      if (hop < 1e-6) continue;
      const hopAxis: 'x' | 'z' | null =
        dz / hop <= 0.15 ? 'x' : dx / hop <= 0.15 ? 'z' : null;
      const exempt = railwayGeometry(a, b);
      if (hopAxis === null || exempt) {
        flush(i - 1);
        continue;
      }
      if (axis === null) {
        axis = hopAxis;
        runStart = i - 1;
      } else if (axis !== hopAxis) {
        flush(i - 1);
        axis = hopAxis;
        runStart = i - 1;
      }
    }
    flush(points.length - 1);
  }
  return problems;
};

/**
 * How far the drawn backbone ring's radius (measured from the plaza/statue
 * centre `PLAZA` is built around) may vary from its own mean before it stops
 * counting as "one true circle" (issue #269 follow-up, Jim, 18 August 2026,
 * superseding round 2's `ringReadsAsAGrid` — a straight *reversal* of that
 * invariant's own requirement, not a refinement of it): *"one central perfect
 * circle is ok circling the statue, and then the rest should be on a grid,
 * with a fairly high degree of connectivity between the closer nodes in the
 * graph."*
 *
 * Measured, not guessed, fresh on all five procgen seeds after
 * {@link solveRing} stopped feeding its 32-point, blocker-clearance profile
 * through axis-alignment: the drawn (sampled-every-~0.5 m Catmull-Rom)
 * curve's radius from the plaza centre never strays more than **0.27 m**
 * from its own mean on any seed (0.02 m on the canonical 20260728, 0.27 m on
 * seed 2, 0.18 m on seed 5, 0.07 m on seed 11, 0.19 m on seed 18) — real
 * variation, not curve-sampling noise, because the profile still relaxes its
 * radius slightly per bearing to keep clear of whichever plot sits nearest
 * at that angle (see {@link solveRing}'s own comment for why a genuinely
 * fixed radius was tried and reverted). Checked out `paths.ts` as it stood
 * immediately before this fix (the simplified-then-axis-aligned ~12-vertex
 * polygon) and re-measured the same way: radius varied by **6.55 m** on the
 * canonical seed (16.76 m to 29.39 m from plaza centre) and **7.68 m** on
 * seed 2 (16.42 m to 29.16 m) — more than an order of magnitude past the
 * true circle's worst case, an axis-aligned polygon being exactly what a
 * "radius from centre" metric is built to catch. 1 m sits with real
 * headroom above every true-circle measurement (>3.7x the worst seed) and
 * far below any polygon's, so what actually trips this is a regression back
 * toward straight chords, not the profile's own small, legitimate
 * bearing-to-bearing give.
 *
 * Deliberately not derived from a game constant such as `RAIL_CORRIDOR_CLEARANCE`
 * (`paths.ts`) — that number bounds how close a route may draw to the
 * railway, a different question from how round this one route's own shape
 * is, and the two happen to sit in the same file for an unrelated reason
 * (both guard `paths.ts` output). Forcing a link between them would tie this
 * invariant to a future rail-clearance change it has nothing to do with.
 * This *is* the "measure the game" case CLAUDE.md asks for — the mean/max
 * pair above is measured off the built ring on every seed, the same way
 * `PLAYER_RADIUS`-derived thresholds are measured off the player.
 */
const RING_RADIUS_TOLERANCE = 1;

/**
 * **The ring road is one true circle round the statue, not a grid loop**
 * (issue #269 follow-up). Round 2 (issue #319) fixed a wiggly axis-aligned
 * staircase by simplifying it down to ~12 long straight runs and asserted
 * exactly the opposite of this — `ringReadsAsAGrid`, "reads as a grid loop,
 * not a stepped approximation of a circle." Jim's next comment on the same
 * live preview reversed that requirement outright for this one route: *"one
 * central perfect circle is ok circling the statue, and then the rest should
 * be on a grid."* `solveRing` (`paths.ts`) now hands its 32-point,
 * blocker-clearance profile straight to the backbone's Catmull-Rom curve
 * instead of axis-aligning it at all — this invariant is the direct
 * replacement for `ringReadsAsAGrid`, checking the *opposite* shape claim:
 * that the ring's radius from the plaza centre stays close to constant,
 * rather than that it turns onto grid axes.
 *
 * Scoped to the closed backbone loop (`edge.backbone`) specifically — every
 * other route in the network (spurs, {@link addInterconnects}'s shortcuts)
 * is still required to run on grid axes by {@link pathsRunOnGridAxes} above,
 * unchanged; the statue's ring is the one deliberate exception, not a
 * loosening of the rule generally.
 */
const ringIsATrueCircleRoundTheStatue: Invariant = (facts) => {
  const problems: string[] = [];
  const plaza = facts.pathNodes.find((node) => node.kind === 'plaza');
  if (!plaza) {
    problems.push('no plaza node in the path graph — cannot check the ring circles the statue');
    return problems;
  }
  for (const edge of facts.pathEdges) {
    if (!edge.backbone) continue;
    const radii = edge.points.map(([x, z]) => Math.hypot(x - plaza.x, z - plaza.z));
    const mean = radii.reduce((sum, r) => sum + r, 0) / radii.length;
    const maxDeviation = radii.reduce((worst, r) => Math.max(worst, Math.abs(r - mean)), 0);
    if (maxDeviation > RING_RADIUS_TOLERANCE) {
      const min = Math.min(...radii);
      const max = Math.max(...radii);
      problems.push(
        `${edge.name}'s radius from the plaza/statue centre (${plaza.x.toFixed(1)}, ${plaza.z.toFixed(1)}) ` +
          `varies from ${min.toFixed(2)} m to ${max.toFixed(2)} m (${maxDeviation.toFixed(2)} m off its own ` +
          `${mean.toFixed(2)} m mean) — needs to stay within ${RING_RADIUS_TOLERANCE} m of constant to read as ` +
          `one true circle round the statue, not a faceted or grid-aligned approximation of one`,
      );
    }
  }
  return problems;
};

/**
 * **Every place a child can be served is a node in the graph.**
 *
 * The other half of §5's ruling: the network derives from a graph of *real*
 * destinations, and the entrance of every ride and building is one of them. So
 * this asks the question the other way round from {@link noPathEndsNowhere} —
 * not "does this ribbon end somewhere real?" but "does every real place have a
 * node?".
 *
 * `facts.entrances` is built from the coordinates the **game** uses — the
 * anchors' own entrances and `STALL_STANDS`, the same points the interact zones
 * and the NPC waypoint graph are seeded from — so this compares the
 * destinations the park actually has against the destinations the path network
 * knows about, rather than comparing the generator to itself.
 *
 * The ferris wheel's ticket kiosk was missing from the graph entirely until
 * issue #114: it is placed by relation to the wheel rather than by the layout
 * solver, so the loop that built stall nodes by walking `PARK_LAYOUT`'s
 * `stall.` entries never saw it, and it survived only by happening to stand
 * near the wheel's own spur.
 */
const everyDestinationIsANode: Invariant = (facts) => {
  const missing: string[] = [];
  for (const entrance of facts.entrances) {
    let best = Infinity;
    for (const node of facts.pathNodes) {
      const gap = Math.hypot(entrance.x - node.x, entrance.z - node.z) - node.reach;
      if (gap < best) best = gap;
    }
    if (best > ARRIVAL) {
      missing.push(
        `${entrance.id} at ${fmt([entrance.x, entrance.z])} is ${best.toFixed(2)} m from the ` +
          `nearest path-graph node — nothing in the network leads to it`,
      );
    }
  }
  return missing;
};

/** Destination kinds {@link detourRatiosStayReasonable} measures — real
 * places a child is going, matching `paths.ts`'s own `addInterconnects`. */
const DETOUR_DESTINATION_KINDS = new Set(['anchor', 'stall', 'station', 'exit']);

/**
 * How close a ribbon's own end must land to another ribbon's drawn curve
 * before {@link buildFactsDistanceGraph} treats it as the same junction.
 * `parkFacts.ts` resamples every route to ~0.5 m steps (`drawnCentreLine`'s
 * `steps`), so the true junction point — always exact on the *new* ribbon's
 * own first/last sample, since Catmull-Rom passes through its own control
 * points exactly, `t=0`/`t=1` — can sit up to half a sampling step from the
 * nearest sample on whichever *other* ribbon it branched from. 0.6 m clears
 * that with real room, while staying far short of the metres of daylight
 * between any two genuinely unconnected ribbons in this park.
 */
const DETOUR_SPLICE_TOLERANCE = 0.6;

/**
 * Independent shortest-path oracle over the park's **drawn** paved edges
 * (`facts.pathEdges`, the resampled Catmull-Rom curve — not `paths.ts`'s own
 * control polylines, and not that module's own graph-building code: this is
 * a second, separately-written measurement of the same built geometry, per
 * this file's "measure the built park" rule).
 *
 * A ribbon's start/end is a junction onto whichever other ribbon it
 * branched from, not necessarily one of that ribbon's own drawn samples —
 * so every edge's two ends are spliced onto the nearest point of every
 * *other* edge's drawn curve, within {@link DETOUR_SPLICE_TOLERANCE}, before
 * the graph is built.
 */
function buildFactsDistanceGraph(
  edges: readonly ParkFacts['pathEdges'][number][],
): { distanceBetween: (ax: number, az: number, bx: number, bz: number) => number } {
  const polylines: [number, number][][] = edges.map((edge) =>
    edge.points.map((p) => [p[0], p[1]] as [number, number]),
  );
  const closedFlags = edges.map((edge) => edge.backbone);

  const spliceOnto = (targetIdx: number, px: number, pz: number): void => {
    const pts = polylines[targetIdx] as [number, number][];
    const segCount = closedFlags[targetIdx] ? pts.length : pts.length - 1;
    let bestSeg = -1;
    let bestDistance = DETOUR_SPLICE_TOLERANCE;
    for (let i = 0; i < segCount; i += 1) {
      const a = pts[i] as [number, number];
      const b = pts[(i + 1) % pts.length] as [number, number];
      if (Math.hypot(px - a[0], pz - a[1]) < 1e-6) return; // already a vertex
      if (Math.hypot(px - b[0], pz - b[1]) < 1e-6) return;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const lengthSq = dx * dx + dz * dz;
      if (lengthSq < 1e-12) continue;
      const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / lengthSq));
      const projX = a[0] + dx * t;
      const projZ = a[1] + dz * t;
      const distance = Math.hypot(px - projX, pz - projZ);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestSeg = i;
      }
    }
    // Insert the *original* point (px, pz), not its projection onto the
    // segment: it flows in verbatim from the edge it belongs to (see the
    // call site below), and that same edge already has this exact
    // coordinate as one of its own points. Splicing in the projection
    // instead would put two merely-nearby-but-distinct floating-point
    // values where the graph needs one shared vertex — the two edges would
    // never actually join, just sit within `DETOUR_SPLICE_TOLERANCE` of
    // each other, and every shortest path through that junction would have
    // to detour around the gap via wherever the graph *was* connected.
    if (bestSeg >= 0) pts.splice(bestSeg + 1, 0, [px, pz]);
  };

  for (let i = 0; i < polylines.length; i += 1) {
    const pts = polylines[i] as [number, number][];
    if (pts.length === 0) continue;
    const first = pts[0] as [number, number];
    const last = pts[pts.length - 1] as [number, number];
    for (let j = 0; j < polylines.length; j += 1) {
      if (j === i) continue;
      spliceOnto(j, first[0], first[1]);
      spliceOnto(j, last[0], last[1]);
    }
  }

  const vertexIndex = new Map<string, number>();
  const vertexCoord: [number, number][] = [];
  const adjacency: { to: number; weight: number }[][] = [];
  const vertexKey = (x: number, z: number): string =>
    `${Math.round(x / 0.05)},${Math.round(z / 0.05)}`;
  const idOf = (x: number, z: number): number => {
    const key = vertexKey(x, z);
    let id = vertexIndex.get(key);
    if (id === undefined) {
      id = adjacency.length;
      vertexIndex.set(key, id);
      vertexCoord.push([x, z]);
      adjacency.push([]);
    }
    return id;
  };
  const addEdge = (aId: number, bId: number, weight: number): void => {
    if (aId === bId) return;
    (adjacency[aId] as { to: number; weight: number }[]).push({ to: bId, weight });
    (adjacency[bId] as { to: number; weight: number }[]).push({ to: aId, weight });
  };
  for (let i = 0; i < polylines.length; i += 1) {
    const pts = polylines[i] as [number, number][];
    const segCount = closedFlags[i] ? pts.length : pts.length - 1;
    for (let s = 0; s < segCount; s += 1) {
      const a = pts[s] as [number, number];
      const b = pts[(s + 1) % pts.length] as [number, number];
      const weight = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (weight < 1e-9) continue;
      addEdge(idOf(a[0], a[1]), idOf(b[0], b[1]), weight);
    }
  }

  /**
   * A destination's own coordinate is a *control* point of its own edge
   * (`paths.ts`'s `spur`), not necessarily one the curve's arc-length
   * resampling (`drawnCentreLine`) lands on exactly — Catmull-Rom only
   * guarantees hitting a curve's very first/last control point exactly, and
   * a destination's own point is often followed by a "past the doormat"
   * extension (`spur`'s `past`), pushing it into the interior of the array.
   * So a query point that isn't already an exact sampled vertex is attached
   * to the nearest one instead, with the gap added to the walk as a real
   * (if tiny) leash — the true "last few centimetres of curve-sampling
   * slack," not a routing shortcut. Capped well under this park's median
   * destination spacing (13-15 m) so it can never accidentally bridge two
   * genuinely different, unconnected pieces of paving.
   */
  const DESTINATION_ATTACH_TOLERANCE = 5;
  const attach = (x: number, z: number): { id: number; leash: number } | null => {
    const exact = vertexIndex.get(vertexKey(x, z));
    if (exact !== undefined) return { id: exact, leash: 0 };
    let bestId = -1;
    let bestDistance = DESTINATION_ATTACH_TOLERANCE;
    for (let i = 0; i < vertexCoord.length; i += 1) {
      const [vx, vz] = vertexCoord[i] as [number, number];
      const d = Math.hypot(x - vx, z - vz);
      if (d < bestDistance) {
        bestDistance = d;
        bestId = i;
      }
    }
    return bestId >= 0 ? { id: bestId, leash: bestDistance } : null;
  };

  return {
    distanceBetween(ax, az, bx, bz) {
      const start = attach(ax, az);
      const goal = attach(bx, bz);
      if (!start || !goal) return Infinity;
      const startId = start.id;
      const goalId = goal.id;
      const dist = new Float64Array(adjacency.length).fill(Infinity);
      dist[startId] = 0;
      const visited = new Uint8Array(adjacency.length);
      for (;;) {
        let curId = -1;
        let curDist = Infinity;
        for (let i = 0; i < dist.length; i += 1) {
          const d = dist[i] as number;
          if (!visited[i] && d < curDist) {
            curDist = d;
            curId = i;
          }
        }
        if (curId === -1) break;
        if (curId === goalId) return curDist + start.leash + goal.leash;
        visited[curId] = 1;
        for (const { to, weight } of adjacency[curId] as { to: number; weight: number }[]) {
          const next = curDist + weight;
          if (next < (dist[to] as number)) dist[to] = next;
        }
      }
      return Infinity;
    },
  };
}

/** The built park's own median nearest-neighbour spacing between real
 * destinations — sizes {@link detourRatiosStayReasonable}'s thresholds off
 * the park itself, per CLAUDE.md's procgen-threshold rule, rather than a
 * metre literal that means nothing on a different seed. */
function medianDestinationSpacing(nodes: readonly { x: number; z: number }[]): number {
  if (nodes.length < 2) return 0;
  const gaps: number[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    let best = Infinity;
    for (let j = 0; j < nodes.length; j += 1) {
      if (i === j) continue;
      const a = nodes[i] as { x: number; z: number };
      const b = nodes[j] as { x: number; z: number };
      best = Math.min(best, Math.hypot(a.x - b.x, a.z - b.z));
    }
    gaps.push(best);
  }
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] as number;
}

/** How many "typical plot hops" apart, straight-line, a pair of
 * destinations may be and still count as "close" for this invariant —
 * mirrors `paths.ts`'s own `CONNECTOR_SPACING_CAP_MULTIPLE` exactly, so this
 * invariant only ever asks the generator to fix what it actually attempts
 * to fix (see that constant's own comment for why it is 2.0, not a more
 * generous number: a second, independent constraint — `Scenery.ts`'s hiding
 * maze — measured against `check:park`'s waypoint-reachability invariant,
 * not against this one). */
const DETOUR_CLOSE_CAP_MULTIPLE = 2.0;

/** How many "typical plot hops" of paved distance a pair must be wasting
 * (paved minus straight-line) before a bad ratio is worth flagging — a
 * little looser than `paths.ts`'s own `CONNECTOR_MIN_WASTE_MULTIPLE` (1.5),
 * deliberately: this invariant only cares about *real* wasted walking, and
 * a pair the generator correctly left unconnected because the absolute
 * waste was trivial (e.g. two doormats 2 m apart, paved 8 m apart — a
 * dramatic-looking ratio over a handful of metres) should never trip it. */
const DETOUR_WASTE_FLOOR_MULTIPLE = 1.5;

/**
 * **No two close destinations are left with a wildly disproportionate paved
 * detour between them** (Jim, PR #286, 18 August 2026): "there aren't
 * enough edges between nodes that are close but currently unlinked, which
 * makes most things into branches off a central hub, whereas they should be
 * inter-connected."
 *
 * For every pair of real destinations within {@link DETOUR_CLOSE_CAP_MULTIPLE}
 * plot-hops of each other, straight-line, and losing at least
 * {@link DETOUR_WASTE_FLOOR_MULTIPLE} plot-hops of paved distance to the
 * detour (so a merely small-numbers-divide-badly ratio over a trivial
 * absolute distance is never flagged), the paved distance may not exceed
 * `DETOUR_RATIO_LIMIT` times the straight-line distance.
 *
 * **Proved red, then green** (18 August 2026): with `addInterconnects`
 * disabled (the hub-and-spoke tree `paths.ts` built before this fix), the
 * canonical seed's `stall.dodgems`/`station-1` pair (21.0 m straight, 52.3 m
 * paved) is one of several pairs that clear both the close cap and the
 * waste floor at a bad ratio, and every seed tested shows several more —
 * `LGP_DISABLE_INTERCONNECTS=1` reliably fails this invariant everywhere.
 * Restoring `addInterconnects` measurably improves every one of those
 * pairs (see `addInterconnects`'s own comment for the mechanism), which is
 * what the ratio limit below is actually proving held.
 *
 * `DETOUR_RATIO_LIMIT = 15` is not the number a network with no other
 * constraints would earn — it is real headroom (35%+) above the worst ratio
 * the generator *actually* produces once it also respects two independent,
 * measured safety limits `addInterconnects`'s own comments document in
 * full: `CONNECTOR_SPACING_CAP_MULTIPLE` (2.0, kept low so new pavement
 * can't shift `Scenery.ts`'s hiding-maze placement into stranding an NPC
 * waypoint — `check:park`'s `poi.stranded`) and the ride-corridor guard
 * (keeps a connector off the Sky Cruiser's own structural footprint, or a
 * roadside lamp can starve it of a pylon — `skyCruiserStandsOnItsOwnSupports`).
 * Both are real, reproduced regressions this branch hit and fixed, not
 * theoretical caution, and both mean some genuinely close, badly-detoured
 * pairs are correctly left unconnected because fixing them was measured to
 * break something else. Measured worst ratio per seed at the generator's
 * real (safety-constrained) settings: canonical 7.35x
 * (`building`/`stall.skyCruiser`), seed 2 4.59x, seed 5 11.15x (the worst of
 * the five — `stall.skyCruiser`/`exit-skyCruiser`, both ends pinned by the
 * same corridor guard), seed 11 4.50x, seed 18 5.80x. This invariant's job
 * given that reality is to catch a *regression* — the network going back
 * towards the fully hub-and-spoke tree — not to assert every seed reaches
 * an ideal no constraint could ever force it to miss.
 */
const DETOUR_RATIO_LIMIT = 15;

/** Does the straight segment a-b pass within the same 4 m clearance of the
 * BUILT Sky Cruiser's route that `paths.ts`'s `routeCrossesARideCorridor`
 * refuses connectors at? Sampled every 2 m along the built curve — the
 * mirror of that screen, measured off the park rather than the plan. */
function straightSegmentCrossesCruiser(
  facts: ParkFacts,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): boolean {
  const route = facts.world.coaster.route;
  const length = route.length;
  if (!Number.isFinite(length) || length <= 0) return false;
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  const point = new Vector3();
  for (let d = 0; d < length; d += 2) {
    route.pointAt(d, point);
    const t = lengthSq > 1e-9 ? Math.max(0, Math.min(1, ((point.x - ax) * dx + (point.z - az) * dz) / lengthSq)) : 0;
    if (Math.hypot(point.x - (ax + dx * t), point.z - (az + dz * t)) < 4) return true;
  }
  return false;
}

const detourRatiosStayReasonable: Invariant = (facts) => {
  const destinations = facts.pathNodes.filter((n) => DETOUR_DESTINATION_KINDS.has(n.kind));
  if (destinations.length < 2) return [];

  const spacing = medianDestinationSpacing(destinations);
  if (spacing <= 0) return [];
  const closeCap = spacing * DETOUR_CLOSE_CAP_MULTIPLE;
  const wasteFloor = spacing * DETOUR_WASTE_FLOOR_MULTIPLE;

  // The *connectivity* graph, not just the paved ribbons: a destination that
  // already stood within a few metres of the network gets no drawn ribbon
  // (`paths.ts`'s "connectivity fact, not a ribbon" edges), but that short
  // unpaved walk is exactly as real as a paved one for "how far does a
  // child actually have to walk between these two destinations" — the
  // question this invariant asks. Using paved-only `facts.pathEdges` here
  // would strand such a destination or force a wildly longer route through
  // whatever paving happens to also touch its coordinate.
  const graph = buildFactsDistanceGraph(facts.pathConnectivityEdges);
  const problems: string[] = [];
  for (let i = 0; i < destinations.length; i += 1) {
    for (let j = i + 1; j < destinations.length; j += 1) {
      const a = destinations[i] as (typeof destinations)[number];
      const b = destinations[j] as (typeof destinations)[number];
      const straight = Math.hypot(a.x - b.x, a.z - b.z);
      if (straight < 1e-6 || straight > closeCap) continue;
      // A pair with the railway between them is not "close": the crow
      // flies over the track, the child crosses at a planned bridge or
      // level crossing (`crossingPlan.ts`), and `paths.ts` deliberately
      // refuses to draw a direct connector across the rail. Measured off
      // the solved loop the same way the other railway exemptions are
      // (2026-08-23, seed 5: ballPit and a station 10.8 m apart across
      // the tracks, 17x by paving — exactly as designed).
      const sideOf = (x: number, z: number): number => {
        const trainRoute = facts.world.train.route;
        const t = trainRoute.tangentAt(trainRoute.distanceNear(x, z), railTangentScratch);
        trainRoute.pointAt(trainRoute.distanceNear(x, z), railScratch);
        return Math.sign(t.z * (x - railScratch.x) - t.x * (z - railScratch.z)) >= 0 ? 1 : -1;
      };
      if (sideOf(a.x, a.z) !== sideOf(b.x, b.z)) continue;
      // Nor is a pair with a ride's own structural corridor between them:
      // `paths.ts`'s `routeCrossesARideCorridor` deliberately refuses a
      // connector there (a connector seeds lamps, and a lamp on a pylon
      // spot cost the Sky Cruiser its supports — that function's own
      // measured story), so the detour is the designed outcome. Mirrored
      // here off the BUILT cruiser at the same 4 m clearance (seed 2,
      // 2026-08-23: the cruiser's own stall and exit, 13.4 m apart with
      // the ride's loop between them, 17x by paving — as designed).
      if (straightSegmentCrossesCruiser(facts, a.x, a.z, b.x, b.z)) continue;
      const paved = graph.distanceBetween(a.x, a.z, b.x, b.z);
      // Not a real defect: `everyDestinationIsANode` and `noPathEndsNowhere`
      // already independently prove every destination sits on one connected
      // graph, so a "disconnected" result here is this invariant's own
      // splice-reconstruction (`buildFactsDistanceGraph`) missing a junction
      // within its tolerance, not a park that fails to connect two
      // destinations. Skipped rather than flagged so an approximation limit
      // in a second, independently-written measurement doesn't fail a build
      // over nothing — the ratio check below still runs on every pair this
      // reconstruction *does* bridge, which is the real signal.
      if (!Number.isFinite(paved)) continue;
      const waste = paved - straight;
      if (waste < wasteFloor) continue;
      const ratio = paved / straight;
      if (ratio > DETOUR_RATIO_LIMIT) {
        problems.push(
          `'${a.id}' and '${b.id}' are ${straight.toFixed(1)} m apart in a straight line but ` +
            `${paved.toFixed(1)} m apart by paving (${ratio.toFixed(2)}x, wasting ` +
            `${waste.toFixed(1)} m) — closer than ${closeCap.toFixed(1)} m ` +
            `(${DETOUR_CLOSE_CAP_MULTIPLE}x the park's own ${spacing.toFixed(1)} m median ` +
            `destination spacing) with no direct connector between them`,
        );
      }
    }
  }
  return problems;
};

/** Every path is lit along its whole length. */
const everyPathIsLit: Invariant = (facts) => {
  const dark: string[] = [];
  for (const route of facts.routes) {
    const step = route.length / (route.points.length - 1);
    let run = 0;
    let worst = 0;
    for (const [x, z] of route.points) {
      // A stretch carried by a railway bridge is the bridge's own ground,
      // not lamp-post verge: `LampPosts` is *required* to keep off the
      // reserved deck-and-ramp footprint (a lamp base 0.09 m inside a
      // walker's clearance there is exactly what used to kill real
      // bridges), so a crossing leg's middle can never hold a post. The
      // run resets across it — a bridge is its own furniture, lamps stand
      // at its feet. Lighting the deck itself (guard-rail lanterns, say)
      // is real follow-up work, not something this invariant can conjure
      // by failing the seed.
      const onBridge =
        facts.world.train.bridges.some((bridge) => bridge.covers(x, z)) ||
        // The conservative reservation, not just a built deck: the keepout
        // excludes lamp ground at every measured crossing (level crossings
        // included), whether or not the real search went on to build there
        // — ported from the sibling bridge-backtrack fix (76285e3).
        facts.bridgeReservations.some((footprint) => footprint && footprint.covers(x, z));
      const lit = onBridge || facts.lamps.some(([lx, lz]) => Math.hypot(lx - x, lz - z) < LAMP_REACH);
      run = lit ? 0 : run + step;
      if (run > worst) worst = run;
    }
    if (worst > MAX_DARK_RUN) {
      dark.push(`${route.name} has ${worst.toFixed(1)} m with no lamp within ${LAMP_REACH} m`);
    }
  }
  return dark;
};

/**
 * **You can find a tree to climb without hunting for one.**
 *
 * Jim, 6 August: *"re the trees, we need more climbable trees, it takes a long
 * time to find one."* The complaint is about **finding**, not about the total,
 * and the two have identical symptoms — a park with plenty of climbable trees
 * all in one corner is just as bad as a park with three. So this measures the
 * walk, not the count. (The count gets its own anti-vacuity floor below, which
 * is a different job: that one catches a park with none.)
 *
 * Measured along the **paved network**, in the shape of {@link everyPathIsLit},
 * because that is where a child actually walks and it is already sampled every
 * ~0.5 m. Measuring instead over every standable square metre would be
 * dominated by the middle of the park, which has no trees of any kind in it —
 * the plots, stalls and plaza consume the inner ~30 m — and would therefore
 * report a number nothing in this PR could move.
 *
 * The threshold comes from the game: `PLAYER_MAX_SPEED`, her own top speed,
 * times {@link SEARCH_SECONDS}. Not from the scatter's target, and not from
 * whatever the park currently manages.
 *
 * Measured on the paved network, worst point on each CI seed. The middle
 * column is this branch's predicate on the pre-#216 park; the last is the same
 * predicate on the park as it now stands, where trees plant past the old 55 m
 * cap and so sit further from the middle:
 *
 * ```
 *            old rule   this rule   this rule, post-#216
 *   canon       54.2       41.9            51.3
 *   seed 2      45.9       39.4            55.4
 *   seed 5      96.9       38.8            47.3   <- had ONE climbable tree
 *   seed 11     72.9       38.5            43.3
 *   seed 18     42.4       40.7            42.9
 * ```
 *
 * Every one of those worst points is in the plaza — see
 * {@link SEARCH_SECONDS} for why that makes this a backstop rather than the
 * tight guard it looks like.
 */
const everyPathIsNearAClimbableTree: Invariant = (facts) => {
  const far: string[] = [];
  for (const edge of facts.pathEdges) {
    let worst = 0;
    let worstAt: readonly [number, number] = [0, 0];
    for (const [x, z] of edge.points) {
      let nearest = Infinity;
      for (const tree of facts.climbableTrees) {
        const d = Math.hypot(tree.x - x, tree.z - z);
        if (d < nearest) nearest = d;
      }
      if (nearest > worst) {
        worst = nearest;
        worstAt = [x, z];
      }
    }
    // `worst` stays 0 for an edge with no points; it stays Infinity-free
    // because a park with no climbable trees at all leaves `nearest` infinite,
    // which is exactly the complaint below and must not be silently skipped.
    if (!Number.isFinite(worst)) {
      far.push(`${edge.name} has no climbable tree anywhere in the park to be near`);
    } else if (worst > MAX_CLIMB_SEARCH) {
      far.push(
        `${edge.name} passes ${fmt(worstAt)}, which is ${worst.toFixed(1)} m from the nearest ` +
          `climbable tree (a child would walk ${(worst / PLAYER_MAX_SPEED).toFixed(1)} s flat out ` +
          `to reach one, and only ${facts.climbableTrees.length} trees in the park can be climbed)`,
      );
    }
  }
  return far;
};

/**
 * **The Rail Race flies clear of everything it crosses.**
 *
 * The ring runs round the park's rim at a radius the railway already occupies,
 * so the two share ground the whole way round and only height keeps them apart
 * — and the ground under it is different on every seed. Two things are measured
 * off the built park:
 *
 * 1. **Air over the railway.** Decision 4 asks for 5.5 m of rail-over-rail
 *    clearance. Measured from the Rail Race's own rail heights down to the
 *    train's, wherever the two pass within a track's width of each other.
 * 2. **Where the trestles landed.** The legs are read back out of the built
 *    scene by name and their instance matrices decoded — not recomputed from
 *    the placement predicate, which would only prove the predicate agrees with
 *    itself. A leg standing on the railway is a leg the train drives through.
 * 3. **How many actually landed.** `track.ts`'s `trestleSpots` search a small
 *    neighbourhood before giving up on a slot (1 August 2026 — the ring runs
 *    through the park's own busiest band, and a single fixed candidate point
 *    per slot found almost nowhere clear to stand: 1 of 28 on the canonical
 *    seed before that search existed). A slot going missing here and there is
 *    fine and expected; a long unsupported run is the ring visibly floating,
 *    which this measures as the widest gap between consecutive legs, sorted
 *    round the ring by angle — not by re-running the search and checking it
 *    agrees with itself, but by measuring the real distance between the real
 *    legs the built scene actually has.
 *
 * `check:rail-race` asserts the same clearances in far more detail, but only on
 * the canonical seed; this is the half that has to hold whatever park is grown.
 */
const railRaceFliesClear: Invariant = (facts) => {
  // Reached through the built world, never imported: see the note on
  // `RailRace.route`. A static import here would set the park seed too early.
  const { walkPastRoute, raceRoute, laneCount } = facts.world.railRace;
  const train = facts.world.train.route;
  const complaints: string[] = [];

  // --- 1. air over the railway ----------------------------------------------
  //
  // Both rings, though since 2 August 2026 they circle the park outside the
  // boundary wall and the railway's own band is 48-58 m, so on a healthy park
  // nothing here is ever within range and this passes vacuously. Kept, and kept
  // measuring rather than assuming: it is the thing that would notice the day
  // somebody moves a ring back inside.
  const rail = new Vector3();
  const under = new Vector3();
  let worstAir = Infinity;
  let worstAt: readonly [number, number] = [0, 0];

  const samples = 720;
  for (const route of [walkPastRoute, raceRoute]) {
  for (let i = 0; i < samples; i += 1) {
    const distance = (i / samples) * route.length;
    for (let lane = 0; lane < laneCount; lane += 1) {
      route.pointAt(lane, distance, rail);
      if (facts.distanceToRail(rail.x, rail.z) > TRACK_CLEARANCE * 2) continue;
      train.pointAt(train.distanceNear(rail.x, rail.z), under);
      const air = rail.y - under.y;
      if (air < worstAir) {
        worstAir = air;
        worstAt = [rail.x, rail.z];
      }
    }
  }
  }
  if (worstAir < RAIL_OVER_RAIL) {
    complaints.push(
      `only ${worstAir.toFixed(2)} m of air over the railway at ${fmt(worstAt)} — ` +
        `Decision 4 asks for ${RAIL_OVER_RAIL} m`,
    );
  }

  // --- 2. where the trestle legs actually landed -----------------------------
  //
  // Per ring, because there are two of them and `getObjectByName` on the ride's
  // whole group would silently only ever find the first.
  for (const ring of builtRings(facts)) {
  const legs = ring.group.getObjectByName('railRace:trestle-legs');
  if (!(legs instanceof InstancedMesh)) {
    complaints.push(`the ${ring.label} ring has no trestle legs in the built scene to measure`);
  } else {
    const matrix = new Matrix4();
    const at = new Vector3();
    const positions: { angle: number; x: number; z: number }[] = [];
    for (let i = 0; i < legs.count; i += 1) {
      legs.getMatrixAt(i, matrix);
      at.setFromMatrixPosition(matrix);
      positions.push({ angle: Math.atan2(at.z, at.x), x: at.x, z: at.z });
      const toRail = facts.distanceToRail(at.x, at.z);
      if (toRail < TRACK_CLEARANCE) {
        complaints.push(
          `a trestle leg at ${fmt([at.x, at.z])} stands ${toRail.toFixed(2)} m from the railway ` +
            `centre line, inside the train`,
        );
      }
      for (const entrance of facts.entrances) {
        const gap = Math.hypot(at.x - entrance.x, at.z - entrance.z);
        if (gap < WALKABLE_GAP) {
          complaints.push(
            `a trestle leg at ${fmt([at.x, at.z])} is ${gap.toFixed(2)} m from ` +
              `${entrance.id}'s doormat, close enough to pinch it shut`,
          );
        }
      }
    }

    // --- 3. no long unsupported run ------------------------------------------
    // Angle order round a ring this close to circular puts legs in the same
    // order the track visits them; the *distance* itself is the real chord
    // between two real measured leg positions, not an angle converted through
    // an assumed radius — measuring the built legs, not a description of them.
    if (positions.length >= 2) {
      positions.sort((a, b) => a.angle - b.angle);
      let worstGap = 0;
      let worstIndex = 0;
      for (let i = 0; i < positions.length; i += 1) {
        const a = positions[i]!;
        const b = positions[(i + 1) % positions.length]!;
        const gap = Math.hypot(b.x - a.x, b.z - a.z);
        if (gap > worstGap) {
          worstGap = gap;
          worstIndex = i;
        }
      }
      if (worstGap > TRESTLE_GAP_TOLERANCE) {
        complaints.push(
          `the widest run between consecutive trestle legs on the ${ring.label} ring is ` +
            `${worstGap.toFixed(1)} m (after leg ${worstIndex}), over the ` +
            `${TRESTLE_GAP_TOLERANCE} m tolerance — the ring is standing on air for a stretch ` +
            `that long`,
        );
      }
    }
  }
  }

  return complaints;
};

/**
 * The two rings the Rail Race actually built, read back out of the scene.
 *
 * Named groups, not a description of them: if a ring stops being built, or is
 * renamed, or is quietly folded back into a single scaled one, this returns the
 * wrong number of rings and every invariant below says so.
 */
interface BuiltRing {
  readonly label: string;
  readonly group: Object3D;
  /** How big this ring claims to be, straight off the world's own route. */
  readonly scale: number;
  /**
   * ...and how big relative to the race ring, which is what every bare number in
   * `track.ts` is authored against. `track.ts`'s own `ringSizeVsRace`.
   */
  readonly sizeVsRace: number;
}

function builtRings(facts: ParkFacts): readonly BuiltRing[] {
  const railRace = facts.world.railRace;
  return (
    [
      ['walk-past', 'railRace:walk-past-ring', railRace.walkPastRoute.scale],
      ['race', 'railRace:race-ring', railRace.raceRoute.scale],
    ] as const
  ).flatMap(([label, name, scale]) => {
    // `flatMap` with a narrowing `if`, rather than `.map(...).filter(guard)`.
    //
    // The filter form was two type errors, and they were not cosmetic — this
    // file was never typechecked until `tsconfig.test.json` existed (#192), so
    // they sat on main unnoticed. `.map` produced `group: Object3D | undefined`,
    // and the guard claimed `ring is BuiltRing`, which TypeScript rejected
    // outright (TS2677): `BuiltRing.label` is `string`, but the mapped element's
    // is the literal union `'walk-past' | 'race'`, so the predicate's type was
    // not assignable to the parameter it was narrowing. The `readonly
    // BuiltRing[]` return then failed too, because nothing had actually narrowed
    // `group`.
    //
    // A predicate would have silenced both, but a predicate is an *assertion* —
    // the compiler takes it on trust, which is what let the mismatch hide in the
    // first place. Here the `if` narrows `group` for real and the object literal
    // is checked against `BuiltRing` by ordinary inference. Nothing is asserted,
    // so nothing can be asserted wrongly.
    //
    // Behaviour is identical: a ring whose group is missing is still dropped,
    // which is deliberate — see this function's doc. The callers count the rings
    // they get back, and that count going wrong is the alarm.
    const group = railRace.group.getObjectByName(name);
    return group ? [{ label, group, scale, sizeVsRace: scale / railRace.raceRoute.scale }] : [];
  });
}

/**
 * How far outside the park's edge the rails of one ring actually run — the
 * nearest and furthest, straight off the swept tube's own vertices.
 *
 * **Outset, not radius, and that is the whole point.** This measured
 * `Math.hypot(x, z)` until the park stopped being a circle. A radius is only a
 * statement about the edge when the edge is the same distance away on every
 * bearing; once the boundary ran 59.7 m at the pinch and 101.4 m at the bulge,
 * `r = 65.5` meant "comfortably outside" on one bearing and "35 m inside, with
 * the masonry running between the rails" on another — and the assertion built
 * on it went on passing, because 65.5 > 60 is true regardless of where the park
 * actually is. Asking the boundary itself is what makes the claim survive a
 * change of shape.
 *
 * Not `route.pointAt` — that is the rule the rails were built from, and this
 * file's first commandment is to measure the thing that was built. The lane
 * centre line would also miss half a gauge of real structure either side of it,
 * which is exactly the margin these checks are about.
 */
function railOutsetRange(
  ring: BuiltRing,
  boundary: ParkFacts['boundary'],
): { min: number; max: number; vertices: number } {
  let min = Infinity;
  let max = -Infinity;
  let vertices = 0;
  ring.group.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    if (!child.name.startsWith('railRace:rail-')) return;
    const position = child.geometry.getAttribute('position');
    if (!position) return;
    for (let i = 0; i < position.count; i += 1) {
      // Outset, not radius. `distanceToEdge` is positive inside the park, so a
      // rail out beyond the wall — where both rings belong — reads positive here.
      const outset = -boundary.distanceToEdge(position.getX(i), position.getZ(i));
      if (outset < min) min = outset;
      if (outset > max) max = outset;
      vertices += 1;
    }
  });
  return { min, max, vertices };
}

/**
 * Every rail's true centre line, as segments in a 1 m lookup grid.
 *
 * **This used to be `railRadii`, and that was a circle-era test.** It averaged
 * each rail mesh's vertices into a single *radius* and asked how far a
 * dropper's own radius was from one of those — sound while the ring was a
 * circle of fixed radius, and meaningless the moment #216 made it follow the
 * park boundary. The edge runs 59.7 m at the pinch and 101.4 m at the bulge, so
 * "the average radius of this rail" stopped describing anything: the check
 * reported real numbers, in metres, about a quantity that no longer existed.
 *
 * Two things have to be right for the replacement to resolve a defect as small
 * as {@link DROPPER_RAIL_TOLERANCE}, and both were got wrong on the way here:
 *
 * 1. **Centre lines, not skin.** The vertices are the swept *tube's* surface,
 *    so the nearest one to a post sitting perfectly on the axis is a whole tube
 *    radius away. `TubeGeometry` gives every vertex of one cross-section ring
 *    the same `uv.x`, so grouping by it and averaging recovers the axis exactly
 *    — and needs no constant from `track.ts`, which cannot be imported here
 *    anyway (it reaches `parkManifest.ts`, and a static seed-dependent import
 *    in `test/` is what once turned one failure into 76 silent skips).
 * 2. **Segments, not points.** The rings sit ~0.83 m apart along the track, so
 *    the nearest *vertex ring* can be 0.42 m from a perfectly-placed post —
 *    noise larger than the 0.25 m defect being hunted. Measuring to the centre
 *    line *between* the rings removes it: the first draft measured to points
 *    and called half of a healthy ring broken, with a median sitting exactly on
 *    the tolerance, which is what a resolution limit looks like when it is
 *    mistaken for a result.
 */
function railCentreLines(ring: BuiltRing): Map<string, [number, number, number, number][]> {
  const grid = new Map<string, [number, number, number, number][]>();
  const point = new Vector3();

  const add = (key: string, segment: [number, number, number, number]): void => {
    const cell = grid.get(key);
    if (cell) cell.push(segment);
    else grid.set(key, [segment]);
  };

  ring.group.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    if (!child.name.startsWith('railRace:rail-')) return;
    const position = child.geometry.getAttribute('position');
    const uv = child.geometry.getAttribute('uv');
    if (!position || !uv) return;
    child.updateWorldMatrix(true, false);

    // One entry per cross-section ring, keyed by the `uv.x` they share.
    const rings = new Map<number, { x: number; z: number; n: number }>();
    for (let i = 0; i < position.count; i += 1) {
      point.set(position.getX(i), 0, position.getZ(i)).applyMatrix4(child.matrixWorld);
      const key = Math.round(uv.getX(i) * 1e6);
      const entry = rings.get(key);
      if (entry) {
        entry.x += point.x;
        entry.z += point.z;
        entry.n += 1;
      } else {
        rings.set(key, { x: point.x, z: point.z, n: 1 });
      }
    }

    const centres = [...rings.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, e]) => [e.x / e.n, e.z / e.n] as const);

    for (let i = 0; i < centres.length; i += 1) {
      const a = centres[i]!;
      const b = centres[(i + 1) % centres.length]!;
      const segment: [number, number, number, number] = [a[0], a[1], b[0], b[1]];
      // Both ends, so a lookup from either side of a segment finds it.
      add(`${Math.floor(a[0])},${Math.floor(a[1])}`, segment);
      add(`${Math.floor(b[0])},${Math.floor(b[1])}`, segment);
    }
  });
  return grid;
}

/** Distance from `(x, z)` to the nearest rail centre line, searching outwards. */
function nearestRail(
  grid: Map<string, [number, number, number, number][]>,
  x: number,
  z: number,
): number {
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  let nearest = Infinity;
  for (let radius = 0; radius <= 40; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        if (radius > 0 && Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
        for (const [ax, az, bx, bz] of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
          const d = pointToSegment([x, z], [ax, az], [bx, bz]);
          if (d < nearest) nearest = d;
        }
      }
    }
    if (nearest <= radius) return nearest;
  }
  return nearest;
}

/**
 * How far a dropper may stand from the nearest rail and still be holding it up.
 *
 * Taken from the built structure rather than from the placer: the rail tube is
 * 0.075 m at park scale, which `RIDE_SCALE` (2.5) takes to 0.1875 m on the
 * race ring, and a dropper post is 0.08 m. Past their sum, ~0.27 m, the post
 * and the rail no longer intersect at any point — the post is visibly holding
 * up fresh air, which is the entire complaint. 0.25 m sits just inside that.
 *
 * For scale: the defect this guards against — one dropper per lane on the
 * lane's *centre line* rather than one under each rail — puts every post half
 * a gauge out, 0.78 m on the race ring, three times this tolerance.
 */
const DROPPER_RAIL_TOLERANCE = 0.25;

/**
 * **Both Rail Race rings are built outside the park, at their own real size,
 * and only the one you can walk up to is solid.**
 *
 * This is the invariant for the two-ring rebuild of 2 August 2026, and it is
 * really one claim in four parts. All four are measured off the built scene —
 * the rails from their own swept vertices, the legs from their instance
 * matrices, the solidity from the collision world the park actually registered.
 *
 * 1. **Outside the wall, on real ground.** Every rail vertex of every lane of
 *    both rings sits further *outside the park's own edge* than the boundary
 *    masonry and a child's own radius need — a child pressed against the
 *    outside of the wall is not standing in a rail — and no further out than
 *    `RIM_OUTSET_START`, where the hill starts falling away and there is no flat
 *    ground to stand a trestle on. Both are measured as **outset**, by asking
 *    the built boundary; see `railOutsetRange` for why a radius stopped being a
 *    statement about the edge the moment the park stopped being a circle. The
 *    whole point of moving out here was that the apron is empty; this is what
 *    stops a later tweak drifting the ring back over the park or off the hill.
 *
 * 2. **Two sizes, genuinely built.** The race ring's measured radial width is
 *    the ride's own scale factor times the walk-past ring's, taken as the ratio
 *    of the two routes the world is holding rather than as an invented number.
 *    A single ring drawn twice at different `group.scale` would pass a lane-span
 *    check computed from the rules and fail this one, because this one measures
 *    vertices.
 *
 * 3. **Nothing in the ride carries a scale multiply on its geometry.** Every
 *    object under a ring group, and the ring groups themselves, must be at unit
 *    scale — and so must every cart sitting in the park at rest. This is the
 *    literal bug from Jim's screenshot: a rival's cart group was scaled 2.5x
 *    once at construction and never unscaled, so the ambient riders were
 *    two-and-a-half times life size to anyone who walked or flew past. A park
 *    that has just been built is a park at rest, so at rest is what this asserts.
 *
 * 4. **Only the walk-past ring is solid.** Its trestle legs are registered as
 *    collision circles; the race ring's are not. `CollisionWorld` cannot
 *    un-register a collider, so a race ring that ever registered one would leave
 *    an invisible solid post standing in the park for the rest of the session —
 *    the classic "walked into a rail that is not drawn" bug. Checked by asking
 *    the real collision world what is at each measured leg position.
 */
const railRaceRingsStandOutsideThePark: Invariant = (facts) => {
  const complaints: string[] = [];
  const rings = builtRings(facts);

  if (rings.length !== 2) {
    complaints.push(
      `the Rail Race built ${rings.length} named ring group(s), not the two the ride is made of ` +
        `— a walk-past ring at park scale and a race ring at ride scale`,
    );
    return complaints;
  }

  // --- 1. outside the wall, inside the hill ---------------------------------
  const widths = new Map<string, number>();
  // Two separate claims, and the rail has to satisfy both, so the threshold is
  // whichever binds harder. Neither number is chosen here; both are read off the
  // built park.
  //
  //  - **No child is standing in a rail.** She is stopped by the *collision*
  //    wall, so the furthest out she can be is its half-thickness plus her own
  //    radius.
  //  - **No rail is driven through stone.** The widest masonry is the pillar
  //    cap, which bulges past the collision wall — a rail clearing the collider
  //    can still pass through a cap, invisible to physics and obvious to a
  //    six-year-old.
  const clearOfMasonry = Math.max(
    facts.wallCollisionHalf + PLAYER_RADIUS,
    facts.masonryHalfWidth,
  );
  for (const ring of rings) {
    const { min, max, vertices } = railOutsetRange(ring, facts.boundary);
    if (vertices === 0) {
      complaints.push(`the ${ring.label} ring has no rail geometry in the built scene to measure`);
      continue;
    }
    widths.set(ring.label, max - min);
    if (min < clearOfMasonry) {
      complaints.push(
        `the ${ring.label} ring's innermost rail comes ${min.toFixed(2)} m outside the park edge, ` +
          `inside the ${clearOfMasonry.toFixed(2)} m the boundary masonry and a child's own ` +
          `${PLAYER_RADIUS} m need — the wall runs through the ride there`,
      );
    }
    if (max > RIM_OUTSET_START) {
      complaints.push(
        `the ${ring.label} ring's outermost rail runs ${max.toFixed(2)} m outside the park edge, ` +
          `past the ${RIM_OUTSET_START} m where the hill starts falling away — there is no flat ` +
          `ground out there to stand a trestle on`,
      );
    }
  }

  // --- 2. two sizes, measured, not described --------------------------------
  const walkPastWidth = widths.get('walk-past');
  const raceWidth = widths.get('race');
  if (walkPastWidth !== undefined && raceWidth !== undefined && walkPastWidth > 0) {
    const measured = raceWidth / walkPastWidth;
    // The ride's own factor, off the world rather than imported: `route.ts`
    // pulls in the park manifest at module load and a static import here would
    // fix the seed before the harness has set it.
    const expected = facts.world.railRace.raceRoute.scale / facts.world.railRace.walkPastRoute.scale;
    if (Math.abs(measured - expected) > 0.02) {
      complaints.push(
        `the race ring's rails span ${raceWidth.toFixed(2)} m against the walk-past ring's ` +
          `${walkPastWidth.toFixed(2)} m — a ratio of ${measured.toFixed(3)}, not the ` +
          `${expected.toFixed(3)} the two rings' scales claim. The rings are supposed to be built ` +
          `to their own dimensions, not drawn once and multiplied`,
      );
    }
  }

  // --- 3. no scale multiply anywhere in the ride ----------------------------
  const unit = (object: Object3D): boolean =>
    Math.abs(object.scale.x - 1) < 1e-6 &&
    Math.abs(object.scale.y - 1) < 1e-6 &&
    Math.abs(object.scale.z - 1) < 1e-6;

  for (const ring of rings) {
    ring.group.traverse((child) => {
      if (unit(child)) return;
      complaints.push(
        `${child.name || child.type} in the ${ring.label} ring is drawn at scale ` +
          `${child.scale.x.toFixed(2)} — ring geometry is built at its own size, never scaled`,
      );
    });
  }

  const walkPastScale = facts.world.railRace.walkPastRoute.scale;
  facts.world.railRace.group.traverse((child) => {
    if (child.name !== 'railRace:cart') return;
    if (Math.abs(child.scale.x - walkPastScale) < 1e-6) return;
    complaints.push(
      `a cart is sitting in the park at scale ${child.scale.x.toFixed(2)} with nobody racing — ` +
        `at rest every cart and rider belongs on the walk-past ring at scale ` +
        `${walkPastScale.toFixed(2)}. This is the 2 August 2026 bug: giant rivals idling past a ` +
        `normal-sized child`,
    );
  });

  // --- 4. only the walk-past ring is solid ----------------------------------
  const solid: { x: number; z: number; radius: number }[] = [];
  facts.world.collision.forEachCircle((x, z, radius) => {
    solid.push({ x, z, radius });
  });
  const matrix = new Matrix4();
  const at = new Vector3();
  for (const ring of rings) {
    const legs = ring.group.getObjectByName('railRace:trestle-legs');
    if (!(legs instanceof InstancedMesh)) {
      complaints.push(`the ${ring.label} ring has no trestle legs in the built scene to measure`);
      continue;
    }
    const wantsSolid = ring.label === 'walk-past';
    for (let i = 0; i < legs.count; i += 1) {
      legs.getMatrixAt(i, matrix);
      at.setFromMatrixPosition(matrix);
      const found = solid.some(
        (circle) => Math.hypot(circle.x - at.x, circle.z - at.z) < circle.radius,
      );
      if (found === wantsSolid) continue;
      complaints.push(
        wantsSolid
          ? `the walk-past ring's trestle leg at ${fmt([at.x, at.z])} is not solid — it is the ` +
            `ring that is standing there while a child is on foot, so it has to be something ` +
            `she bumps into rather than walks through`
          : `the race ring's trestle leg at ${fmt([at.x, at.z])} registered a collider. That ring ` +
            `is hidden except mid-race, and CollisionWorld cannot un-register anything, so this ` +
            `is an invisible solid post standing in the park for the rest of the session`,
      );
    }
  }

  return complaints;
};

/**
 * Longest a duck bar is allowed to sit from the nearest real trestle leg,
 * horizontally.
 *
 * Not the generator's own bound (`track.ts`'s `WIDE_ARC_NUDGES`/
 * `WIDE_RADIAL_NUDGES` can in principle nudge a support a little over 9 m
 * from its nominal grid point) — deliberately tighter, because the actual
 * guarantee this invariant exists to protect is architectural: a duck bar's
 * `at` and its support's grid index are *the same number*
 * (`hazards.ts`'s `snapToTrestleGrid`, `trestleGridIndex`), not two
 * independently-placed things that merely tend to end up near each other.
 * With legs roughly every 13 m round the ring, "nearest leg" would often be
 * under this by pure chance even for a bar placed with no relationship to
 * the supports at all, which is exactly the bug this whole mechanism exists
 * to fix — so this number is a sanity cross-check on the real, measured
 * geometry, not the proof of correctness by itself; the shared grid index in
 * the code is that proof. Measured against the real built park before this
 * mechanism existed (bars placed by the old, independent RNG cursor): worst
 * observed gap to the nearest leg was several times this.
 */
const DUCK_BAR_SUPPORT_TOLERANCE = 8;

/**
 * **Every duck bar stands over a real trestle leg.**
 *
 * Jim, 1 August 2026: the hazard schedule and the trestle placement were
 * "completely independent systems with no relationship" — a bar could land
 * anywhere a seeded RNG's cursor happened to stop, with nothing structural
 * underneath it. `hazards.ts`'s `snapToTrestleGrid` and `track.ts`'s
 * `trestleSpots` now derive both from one shared grid index, and
 * `trestleSpots` treats a grid slot with a bar scheduled on it as mandatory
 * rather than something the ring is allowed to shrug off.
 *
 * Measured off the built scene — both `railRace:duck-bars` and
 * `railRace:trestle-legs` are read back by name and their instance matrices
 * decoded — not by recomputing `snapToTrestleGrid`/`trestleGridIndex` and
 * checking they agree with themselves, which is exactly the tautology
 * ART-AGENT-NOTES.md §6 warns a parity check can quietly become. A real
 * geometric distance between two real meshes is what a family would
 * actually see if this broke again.
 */
const duckBarsStandOnRealSupports: Invariant = (facts) => {
  const complaints: string[] = [];
  const matrix = new Matrix4();
  const barPosition = new Vector3();

  // Both rings: each builds its own bars over its own legs, and a bar floating
  // free on the ring nobody is currently looking at is still a bug.
  for (const ring of builtRings(facts)) {
    const barsMesh = ring.group.getObjectByName('railRace:duck-bars');
    const legsMesh = ring.group.getObjectByName('railRace:trestle-legs');
    if (!(barsMesh instanceof InstancedMesh) || !(legsMesh instanceof InstancedMesh)) {
      complaints.push(
        `the ${ring.label} ring has no duck bars or trestle legs in the built scene to measure`,
      );
      continue;
    }

    const legPositions: Vector3[] = [];
    for (let i = 0; i < legsMesh.count; i += 1) {
      legsMesh.getMatrixAt(i, matrix);
      legPositions.push(new Vector3().setFromMatrixPosition(matrix));
    }

    for (let i = 0; i < barsMesh.count; i += 1) {
      barsMesh.getMatrixAt(i, matrix);
      barPosition.setFromMatrixPosition(matrix);
      let nearest = Infinity;
      for (const leg of legPositions) {
        const d = Math.hypot(barPosition.x - leg.x, barPosition.z - leg.z);
        if (d < nearest) nearest = d;
      }
      if (nearest > DUCK_BAR_SUPPORT_TOLERANCE) {
        complaints.push(
          `duck bar ${i} on the ${ring.label} ring at ${fmt([barPosition.x, barPosition.z])} is ` +
            `${nearest.toFixed(1)} m from the nearest trestle leg, over the ` +
            `${DUCK_BAR_SUPPORT_TOLERANCE} m tolerance — it is floating free of the ring's own ` +
            `support structure`,
        );
      }
    }
  }

  return complaints;
};

/**
 * **A duck bar slows you down where it stands, not a cart's length later.**
 *
 * Jim, riding it on 5 August 2026: *"their head just passes through the bonkers
 * like a ghost... and then they slow down only after passing through it."*
 *
 * The cause was two positions for one bar. The geometry renders over the bar's
 * supporting trestle, which `trestleSpots` may nudge along the loop to find
 * clear ground; `simulate.ts` bonked at the *unnudged* distance the bar was
 * planned for, and nothing reconciled them. `track.ts`'s own comment argued an
 * arc nudge "costs nothing" because bar and leg move together — true of
 * bar-versus-leg, and silent about bar-versus-physics. On the canonical seed
 * every one of the seven bars carried a −2.00 m nudge.
 *
 * Both halves are asserted, because either alone would have passed while the
 * bug was live:
 *
 * 1. **Where.** The bonk fires within one frame's travel of the bar's own
 *    instance matrix. A tolerance in metres would have to be re-picked every
 *    time the physics got faster; one frame of *her actual speed at that bar*
 *    is the finest a 60 Hz game can do, so it is the honest bound.
 * 2. **That she is actually slowed by then.** A crossing list that agreed with
 *    the geometry but no longer cost anything would sail through (1). This
 *    measures the speed either side of the frame she reaches the bar in, off
 *    the same `stepRider` the browser runs.
 *
 * Fixed by drawing the bar at `bar.at` — the number it is scored at — instead
 * of at its trestle's nudged one, so the two are the same by construction and
 * not by two systems agreeing to keep in step. `ParkFacts.duckBars` does the
 * measuring; see `DuckBarFact` for why it is gathered there and not here, and
 * in particular for why the two sides of the comparison have to come from
 * different places.
 */
/**
 * How much slop the *measurement* of a bar's built position is allowed, in
 * metres — see {@link duckBarsSlowYouWhereTheyStand}'s use of it.
 *
 * `ParkFacts.duckBars` recovers a bar's arc position by walking the ring path's
 * own samples and projecting onto the polyline between them, which lands well
 * inside a centimetre but is not exact. Two orders of magnitude below the 2.00 m
 * drift this invariant was written to catch.
 */
const BAR_MEASUREMENT_SLACK = 0.05;

/**
 * **Every rider passes under the finish rainbow with room to spare.**
 *
 * Jim, 6 August 2026: *"the finish line looks like an obstacle."* It was one.
 * The straight beam it replaced hung at an invented `base + UNDULATION_REACH +
 * 2.2`, while a standing rider's head reaches 7.67 m over the rail — so the
 * finish line passed through every rider, every lap, and the chequered flags
 * below it hung lower still. Nothing noticed, because nothing was asked.
 *
 * "The arch exists" would have passed all along while it decapitated the
 * winner, so this measures the built arc's **own vertices** — the lowest the
 * rainbow gets directly over each lane, within a child's width either side —
 * against a rider's real height at that lane. Both rings, every lane, every
 * seed: the walk-past ring carries the ambient rivals and is the one a child
 * standing in the park sees close up.
 */
const finishRainbowClearsEveryRider: Invariant = (facts) => {
  const complaints: string[] = [];
  if (facts.archClearance.length === 0) {
    return ['the built scene has no finish rainbow over either Rail Race ring to measure'];
  }
  for (const lane of facts.archClearance) {
    if (!Number.isFinite(lane.rainbowY)) {
      complaints.push(
        `the finish rainbow has no arc at all over lane ${lane.lane} of the ${lane.ring} ring — ` +
          `a rider there passes the line under open sky, so the span does not reach all four ` +
          `tracks`,
      );
      continue;
    }
    const headroom = lane.rainbowY - lane.crownY;
    if (headroom < ARCH_MIN_HEADROOM) {
      complaints.push(
        `the finish rainbow leaves only ${headroom.toFixed(2)} m over a standing rider's head in ` +
          `lane ${lane.lane} of the ${lane.ring} ring (needs ${ARCH_MIN_HEADROOM} m) — at zero it ` +
          `is going through her, which is what the straight beam it replaced did. See ` +
          `RIDER_HEAD_TOP_AT_PARK_SCALE in railRace/hazards.ts`,
      );
    }
  }
  return complaints;
};

/**
 * The least headroom the finish rainbow may leave over a standing rider, in
 * metres.
 *
 * Well under `track.ts`'s own `ARCH_HEADROOM`, on purpose: this is the point at
 * which a family would see something wrong, not the target the builder aims
 * for, so tuning the arch a little lower is allowed to pass and a rider's hair
 * brushing it is not.
 */
const ARCH_MIN_HEADROOM = 0.5;

/**
 * **The finish rainbow stands on the ground, on both sides, on every seed.**
 *
 * Jim, 7 August 2026: *"make the rainbow extend all the way to the floor with
 * straight sections, not just float in space"*. It was an arc whose feet stopped
 * dead at `footY` — 6.0 m over the lawn on the park side and 22.6 m over the
 * hillside on the rim side, on the canonical seed.
 *
 * Three things have to be true, and they are deliberately three separate
 * assertions because the ways this breaks are different shapes:
 *
 * 1. **The legs exist.** An empty list is the original bug exactly, and
 *    "measure the legs you find" would pass in silence with none.
 * 2. **Each reaches the ground**, judged against the *lowest* terrain under its
 *    own footprint rather than the terrain at its centre — see
 *    {@link ArchLegFact.groundY}. The centre reading is the placement arithmetic
 *    played straight back, and would be green with the legs stopped anywhere.
 * 3. **Each meets the arc it hangs from.** A leg that reaches the floor but
 *    starts below its own band is the same complaint with a gap in a new place,
 *    and nothing else in the suite would see it.
 *
 * Plus the ordinary question asked of anything the park stands on the ground:
 * that it did not come down on a path, on the railway, or in somebody's plot.
 * The thresholds are the game's own — `WALKABLE_GAP` (two player radii, what it
 * takes to get past a thing) and `TRACK_CLEARANCE` (half the train track's
 * width) — not numbers invented here.
 */
const finishRainbowStandsOnTheGround: Invariant = (facts) => {
  const complaints: string[] = [];
  if (facts.archLegs.length === 0) {
    return [
      'the finish rainbow has no legs at all in the built scene — its arc stops in mid-air ' +
        '6 m over the lawn on one side and 22 m over the rim on the other, which is exactly the ' +
        '"not just float in space" complaint. See buildArch in railRace/track.ts',
    ];
  }
  for (const leg of facts.archLegs) {
    if (!Number.isFinite(leg.bottomY) || !Number.isFinite(leg.groundY)) {
      complaints.push(
        `${leg.name} on the ${leg.ring} ring measures as non-finite (bottom ${leg.bottomY}, ` +
          `ground ${leg.groundY}) — a NaN loses every comparison below rather than failing one`,
      );
      continue;
    }
    // Above the ground by any amount is daylight under the foot.
    if (leg.bottomY > leg.groundY) {
      complaints.push(
        `${leg.name} on the ${leg.ring} ring stops ${(leg.bottomY - leg.groundY).toFixed(2)} m ` +
          `above the ground beneath it (foot at ${leg.bottomY.toFixed(2)}, lowest terrain under it ` +
          `${leg.groundY.toFixed(2)}) — the rainbow is floating again. See buildArch in ` +
          `railRace/track.ts`,
      );
    }
    if (leg.topY < leg.arcFootY) {
      complaints.push(
        `${leg.name} on the ${leg.ring} ring ends ${(leg.arcFootY - leg.topY).toFixed(2)} m below ` +
          `the foot of the band it carries (leg top ${leg.topY.toFixed(2)}, arc foot ` +
          `${leg.arcFootY.toFixed(2)}) — there is a gap between the arc and its own leg`,
      );
    }
    if (leg.distanceToPath < WALKABLE_GAP) {
      complaints.push(
        `${leg.name} on the ${leg.ring} ring comes down ${leg.distanceToPath.toFixed(2)} m from a ` +
          `path (needs ${WALKABLE_GAP} m, two player radii) — it lands in the way of somebody walking`,
      );
    }
    if (leg.distanceToRail < TRACK_CLEARANCE) {
      complaints.push(
        `${leg.name} on the ${leg.ring} ring comes down ${leg.distanceToRail.toFixed(2)} m from the ` +
          `railway corridor (needs ${TRACK_CLEARANCE} m) — the train would run through it`,
      );
    }
    if (!leg.clearOfPlots) {
      complaints.push(
        `${leg.name} on the ${leg.ring} ring comes down inside a building plot — it would grow up ` +
          `through whatever is built there`,
      );
    }
  }
  return complaints;
};

const duckBarsSlowYouWhereTheyStand: Invariant = (facts) => {
  const complaints: string[] = [];
  const bars = facts.duckBars;

  if (bars.length === 0) {
    return ['the race ring has no duck bars in the built scene to measure'];
  }

  for (const bar of bars) {
    if (bar.bonkAt === null) {
      complaints.push(
        `the duck bar at ${bar.builtAt.toFixed(2)} m from the arch never bonks anybody — it is ` +
          `standing over the track as decoration`,
      );
      continue;
    }
    // One frame's travel, at the speed she is actually doing when she gets
    // there, plus the measurement's own resolution. Below one frame there is
    // nothing a 60 Hz game could have done sooner; `BAR_MEASUREMENT_SLACK` is
    // there because `builtAt` is *measured* off an instance matrix against a
    // sampled path and is not exact to the millimetre — seed 5 sat 0.02 m over
    // a bare frame, which is resolution, not lateness. Together they still
    // catch the defect this exists for by a factor of forty.
    const slack = Math.max(bar.frameTravel, 0.01) + BAR_MEASUREMENT_SLACK;
    const late = bar.bonkAt - bar.builtAt;
    if (Math.abs(late) > slack) {
      complaints.push(
        `the duck bar at ${bar.builtAt.toFixed(2)} m from the arch bonks at ` +
          `${bar.bonkAt.toFixed(2)} m — ${late > 0 ? 'after' : 'before'} the bar by ` +
          `${Math.abs(late).toFixed(2)} m, and she only covers ${slack.toFixed(2)} m in a frame. ` +
          `A bar is meant to be drawn at exactly the DuckBar.at it is scored at — see the ` +
          `duck-bar loop in railRace/track.ts, and MANDATORY_RADIAL_NUDGES below it`,
      );
    }
    if (bar.speedAfter >= bar.speedBefore) {
      complaints.push(
        `just past the duck bar at ${bar.builtAt.toFixed(2)} m from the arch, a rider who never ` +
          `ducks is still doing ${bar.speedAfter.toFixed(2)} m/s against ` +
          `${bar.speedBefore.toFixed(2)} going in — she has not been slowed by the time she is ` +
          `level with it, whatever happens to her afterwards`,
      );
    }
  }

  return complaints;
};

/**
 * **The rail-race stall's doormat is usable** — standable ground under it, and
 * walkable to from the park entrance on the real nav lattice.
 *
 * ### What this stopped claiming, and where that claim went
 *
 * This was `railRaceStallStandsAtTheRim`, and its headline claim was
 * *relational*: the booth's gap to the built ring had to be the smallest of
 * every plot in the park. That was a sound way to say "at the rim" while the
 * ring was a circle of fixed radius, because closest-to-the-ring and
 * furthest-out were then the same statement. Once the ring follows the park's
 * edge they are not. The edge runs 59.7 m at the pinch and 101.4 m at the
 * bulge, so a plot's gap to the ring became a fact about which *way* it lies,
 * not about how far out it stands.
 *
 * The booth is pinned at bearing 20°, and measured across the five seeds this
 * suite runs it sits 43.1 m from the ring against `waterFight`'s 34.0 m
 * (canonical) and 50.2 m against `ferrisWheel`'s 33.3 m (seed 18). It failed on
 * five of five, so this is not one unlucky seed and CLAUDE.md's "swap the seed"
 * remedy has nothing to swap to.
 *
 * ### The reason is what it *costs* to satisfy it, not that it cannot be
 *
 * Be careful with two tempting explanations. **Both are false, and both were
 * written here before being checked:**
 *
 *  - *"The rivals move per seed."* They do not. **11 of the 12 plots are
 *    identical to three decimal places on all five seeds**, including every
 *    anchor — `ferrisWheel`, `dodgems`, `building`, `ballPit`. Only
 *    `stall.skyCruiser` moves at all (by up to 3.9 m) and it is never the
 *    binding rival. What re-rolls per seed is the **boundary and the ring**:
 *    the edge runs 58.4–110.4 m and the lap 591.9–604.5 m. The gaps move
 *    because the ring moves, not because the plots do.
 *  - *"A fixed pin cannot satisfy a relational claim."* It can. Enumerating the
 *    legal disc (r ≤ 48.6) at 0.1° × 0.25 m finds **49,384 positions that
 *    satisfy the rim claim**, best margin −19.2 m. (A coarser independent sweep
 *    at 0.5° × 0.5 m finds 9,867 — the same density.) There is no shortage of
 *    winning pins.
 *
 * **What is true is that every winning pin breaks the park.** Four positions
 * from the cleanest part of that region — bearings 265/270/275/280 at r = 48.5,
 * clear of every plot and 170–180° round from the gate — were built and checked.
 * **All four fail `check:park`:** `poi.stranded` 1–2 where this branch has 0,
 * `rail.exclusion` 36 m against a recorded 21, `rail.walkable` 44 against 30.
 * An earlier exhaustive sweep of the east cluster found the same thing from the
 * other side: 344 rim-passing positions, none of them clean.
 *
 * And one of the stranded waypoints is **(20.9, 20.2)** — the ferris wheel
 * kiosk's own stand, which #233 shows sits 2.39 m *inside* that ride's exclusion
 * disc and so strands the moment anything reshapes the path network. The booth
 * cannot be pinned to the rim without paying that, which is why the claim is
 * **handed to issue #117** ("Ride stalls must adjoin their rides in the
 * generated layout"): placing the stall *by relation to its ride* is what gets
 * it near the rails without a pin that wrecks the network. (#117 waits on #222's
 * scenery RNG decoupling in turn — moving the booth lengthens its path spur, and
 * the single shared scatter stream then drops a garden wall across an unrelated
 * waypoint, the cascade `parkManifest.ts` already documents.)
 *
 * ### What it still claims, and why that half stays here
 *
 * The two usability claims, unchanged and green on all five seeds: the doormat
 * has standable ground, and it can be walked to from the park entrance. They
 * are precisely the properties *this* change can break — it moves the ride exit
 * and rewrites where a path spur branches (`bestBranchPoint`) — so they earn
 * their place in this PR rather than travelling with #117. Standability is also
 * covered generically for every entrance by `entrancesAreUsable`, but
 * reachability is not covered for any entrance anywhere else in this file, and
 * it is the half `poiGraph`'s stranding bug actually broke. Dropping the whole
 * invariant would have thrown that away along with the part that had to go.
 */
const railRaceStallDoormatIsUsable: Invariant = (facts) => {
  const complaints: string[] = [];
  const doormat = facts.entrances.find((entrance) => entrance.id === 'stall:railRacer');
  if (!doormat) {
    complaints.push("the built park has no 'stall:railRacer' doormat");
    return complaints;
  }
  const at = `(${doormat.x.toFixed(1)}, ${doormat.z.toFixed(1)})`;
  if (!standableNear(facts, doormat.x, doormat.z)) {
    complaints.push(`the rail-race stall's doormat at ${at} has no standable ground nearby`);
  }
  if (!facts.reachableFromEntrance(doormat.x, doormat.z)) {
    complaints.push(
      `the rail-race stall's doormat at ${at} cannot be walked to from the park entrance`,
    );
  }
  return complaints;
};

/**
 * **Every keyring on the keychain rack has a usable stand point — issues
 * #119/#225, extended for the rack-as-picker rework.**
 *
 * `railRaceStallDoormatIsUsable`'s twin, added for the reason that one's own
 * doc comment gives: standability is already covered for every entrance by
 * the generic {@link entrancesAreUsable}, but reachability from the park
 * entrance is not covered anywhere else in this file for any stall, and
 * reachability is exactly the property a brand-new manifest entry can break —
 * `stall.keychain` is placed by the same solver as every other plot
 * (`STALL_PLACEMENTS.keychain`, an ordinary `placedStall(...)`), and the path
 * network grows a spur to it the same way it does for every other stall
 * (`world/paths.ts`, seeded from `STALL_STANDS`), but nothing else here would
 * notice if that spur came out disconnected from the rest of the paving.
 *
 * **One stand point became six** when the rack itself replaced the 2D picker
 * (`world/KeychainShop.ts`'s own header): every keyring is now its own
 * `InteractZone` (`stall:keychain:${kind}`), each with its own `standX`/
 * `standZ` offset sideways from the others so proximity favours whichever
 * keyring she's actually stood in front of. Checking only one of the six (the
 * old single `stall:keychain` id) would miss exactly the class of bug the
 * stand-point fix this invariant caught during that rework was: a keyring
 * whose stand point sits inside the cart's own collision walls is
 * "reachable" nowhere a child can stand, and four of the six were, the first
 * time round.
 *
 * `stand.x`/`stand.z` (the interact zone's `standX`/`standZ`, not the
 * keyring's own `x`/`z` on the counter) is what a child is actually walked to
 * on pressing the chip, and so is the coordinate worth measuring — this
 * reads it back from the **built world's own interact zones**
 * (`facts.keychainKeyringEntrances`, `parkFacts.ts`'s own field for exactly
 * this — see its doc comment) rather than from `STALL_STANDS_BY_ID`
 * directly — the same "measure what the game actually sends her to, not the
 * table it was computed from" reasoning `parkFacts.ts`'s own `entrances`
 * comment gives, and the same defect class (the ferris kiosk stand point
 * existing in a table that nothing built ever reached) this whole mechanism
 * exists to catch.
 *
 * **Not `facts.entrances` any more (23 August 2026).** The rack is now
 * *entered* rather than walked up to keyring by keyring (`world/KeychainShop.ts`'s
 * own header): `interactZones()` offers the six keyrings only while its zoomed
 * view is open, and the one `stall:keychain` entry zone otherwise — never
 * both, because they sit on the same small cart and would fail
 * `check:tap-spacing`'s spacing rule if they did. `facts.entrances` is built
 * from the shop's ordinary, closed, default state, so it only ever holds the
 * one entry zone now; `parkFacts.ts` opens the view for one extra read to
 * populate `keychainKeyringEntrances`, which is what this invariant needs.
 */
const keychainStallStandIsUsable: Invariant = (facts) => {
  const complaints: string[] = [];
  const keyrings = facts.keychainKeyringEntrances;
  if (keyrings.length === 0) {
    complaints.push("the built park has no 'stall:keychain:*' keyring stand points");
    return complaints;
  }
  for (const stand of keyrings) {
    const at = `(${stand.x.toFixed(1)}, ${stand.z.toFixed(1)})`;
    if (!standableNear(facts, stand.x, stand.z)) {
      complaints.push(`${stand.id}'s stand point at ${at} has no standable ground nearby`);
    }
    if (!facts.reachableFromEntrance(stand.x, stand.z)) {
      complaints.push(`${stand.id}'s stand point at ${at} cannot be walked to from the park entrance`);
    }
  }
  return complaints;
};

/**
 * Half a Sky Cruiser car, in metres.
 *
 * The car body is `toonBox(1.5, 0.7, 2.2, …)` in `Coaster.ts` — so 0.75 m of it
 * sticks out either side of the centre line, and 0.75 m is therefore the gap at
 * which the ride stops missing something and starts hitting it.
 *
 * Deliberately the *car*, not the rails (0.625 m) and emphatically not the 3 m
 * corridor the generator aims for. Asserting the generator's own target would
 * only prove it can do arithmetic, and would turn every future tuning change
 * into a test failure. This is the number at which a child in a seat would feel
 * the castle go past.
 */
const CAR_HALF_WIDTH = 0.75;

/**
 * **The Sky Cruiser flies clear of the entire park.** (Issue #198.)
 *
 * ### What this replaces, and why the thing it replaces was wrong
 *
 * There used to be a `TOO_TALL_TO_FLY_OVER` list here — two plot ids, latterly
 * one — with a comment explaining that the 6.2 m cruise floor "clears the trees,
 * the garlands and the train", and that the big wheel was therefore *"the only
 * horizontal obstacle the loop actually has"*.
 *
 * **That claim was false when it was last written down, and the park had been
 * contradicting it for as long as the station ramp existed.** The ride flew
 * through a tree canopy and a bush beside its own station on every one of the
 * five seeds below, and through a wooden hiding wall on seed 5. It was invisible
 * because all three checks that asked "does the coaster hit anything?" — this
 * one, the boot assert and the route solver — asked it of that same typed-out
 * list rather than of the park.
 *
 * Two measurements say why it could not have been kept true by hand. A canopy
 * reaches **6.68 m** above its own ground while the car's underside at cruise is
 * 6.04 m, so the cruise floor does *not* clear the trees; and **83 m of the
 * 185 m loop** has the car below 6 m, because the profile dips at the station
 * and again to thread the castle. A sentence cannot track that, and nothing
 * warns you when it stops being true.
 *
 * ### What it does instead
 *
 * Sweeps the car's own envelope — 0.75 m either side, 1.55 m up to the
 * first-person eye, 0.16 m down to the ties — along the whole loop as eight rays
 * (four corners **plus four edge midpoints**, because corners alone leave a
 * 1.5 m gap across the beam that a lamp post passes clean through) and reports
 * whatever real triangles they hit. No list, no plot circles, no height
 * threshold: a thing added to the park is covered from the day it appears.
 *
 * The requirement is simply **"does not intersect"**. There is deliberately no
 * generous clearance band, and the threshold is emphatically not the generator's
 * `CORRIDOR_RADIUS` of 3 m — asserting a solver's own target proves only that it
 * can do arithmetic and turns every future retune red.
 *
 * A near miss is therefore a pass, and one in particular is meant to stay that
 * way: the RiPika statue at 2.01 m of clear air. It is *reported* as the
 * tightest approach by `check:cruiser-clearance` and fails nothing, and whether
 * a rider passing level with a giant RiPika's chest is a good idea belongs to
 * the family, not to a collision check.
 *
 * Rays decide and boxes only report, and that split is load-bearing: no bounding
 * volume can fly through the castle window, because the wall band has a hole in
 * it and its box does not.
 *
 * Same `cruiserStrikes` the `check:cruiser-clearance` build gate runs, so there
 * is one definition of "does the ride hit anything".
 *
 * Proven red rather than assumed: against the pre-fix scatter it names both
 * original strikes, the canopy at 167 m and the bush at 182 m along the loop.
 */
const skyCruiserFliesClearOfThePark: Invariant = (facts) => facts.cruiserStrikes;

/**
 * **The Sky Cruiser still goes round the big wheel.**
 *
 * Kept alongside the sweep above rather than folded into it, because it is a
 * different kind of claim. The sweep asks whether the built ride *touches*
 * anything; this asks whether the loop respects the one plot it is required to
 * route around, measured against the built curve and the built plot.
 *
 * The distinction matters at the margin the sweep cannot see: a loop threading
 * between the wheel's legs would strike nothing and still be wrong.
 */
const skyCruiserGoesRoundTheBigWheel: Invariant = (facts) => {
  const route = facts.world.coaster.route;
  const complaints: string[] = [];
  const point = new Vector3();

  const plot = facts.plots.find((candidate) => candidate.id === 'ferrisWheel');
  if (!plot) return ['the park has no ferrisWheel plot to measure the coaster against'];

  let worst = Infinity;
  let worstAt: readonly [number, number] = [0, 0];
  // Every metre: the loop is a few hundred metres long and a clip can be
  // brief, so a coarse sweep can step straight over the one bad bend.
  for (let distance = 0; distance < route.length; distance += 1) {
    route.pointAt(distance, point);
    const gap = Math.hypot(point.x - plot.x, point.z - plot.z) - plot.boundingRadius;
    if (gap < worst) {
      worst = gap;
      worstAt = [point.x, point.z];
    }
  }
  if (worst < CAR_HALF_WIDTH) {
    complaints.push(
      `the Sky Cruiser passes ${worst.toFixed(2)} m from the big wheel at ${fmt(worstAt)} — ` +
        `a car is ${CAR_HALF_WIDTH * 2} m wide, so it clips it`,
    );
  }

  return complaints;
};

/**
 * The gentlest turn a rail ride may make, in metres.
 *
 * A ride-comfort number, not a solver setting: the retired 2D game settled on
 * "nothing a six-year-old has to brace against", and `coaster/route.ts` states
 * 12 m as the tightest turn the Sky Cruiser will make. This file cannot import
 * that constant — a static import of the coaster would solve the park layout at
 * the default seed before the per-seed tests get to set theirs — so it is
 * restated here, which is also the point: this is the *claim* being checked,
 * and it is checked against the curve riders are actually on.
 */
const GENTLEST_TURN = 12;

/** Arc spacing between the three points a curvature measurement is taken from. */
const CURVATURE_SPAN = 2.5;

/**
 * Radius of the circle through three points, in plan view. Menger curvature.
 * Infinity where they are collinear.
 */
const radiusThrough = (a: Vector3, b: Vector3, c: Vector3): number => {
  const ab = Math.hypot(b.x - a.x, b.z - a.z);
  const bc = Math.hypot(c.x - b.x, c.z - b.z);
  const ca = Math.hypot(a.x - c.x, a.z - c.z);
  const area = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
  if (area < 1e-9) return Infinity;
  return (ab * bc * ca) / (4 * area);
};

/**
 * **The Sky Cruiser's built track really does turn as gently as it claims.**
 *
 * The generator validates turning radius on its own cubics, and that is not the
 * same thing as the ride having it. `CoasterRoute` resamples the solved plan
 * into control points and rebuilds it as a `CatmullRomCurve3`, and a rebuild is
 * not a copy: the spline sags away from the curve its points came from, worst
 * at the tightest bends. Measured before this was fixed, the rebuild ate up to
 * 1.38 m and two of the five seeds here shipped a curve tighter than the 12 m
 * the code declares — seed 2 at 11.68 m, seed 18 at 10.98 m.
 *
 * Which is the same mistake the old solver made, one layer down: it too pushed
 * control points where it wanted them and then smoothed them, so the built
 * curve did not honour what had been validated. A plan is a claim. This
 * measures the fact, and it is the reason the fix cannot silently rot.
 */
const skyCruiserTurnsGently: Invariant = (facts) => {
  const route = facts.world.coaster.route;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  let tightest = Infinity;
  let at = 0;
  // Half-metre steps: a single tight bend is a few metres long, and a coarse
  // sweep can step straight over the one that matters.
  for (let d = 0; d < route.length; d += 0.5) {
    route.pointAt(d - CURVATURE_SPAN, a);
    route.pointAt(d, b);
    route.pointAt(d + CURVATURE_SPAN, c);
    const radius = radiusThrough(a, b, c);
    if (radius < tightest) {
      tightest = radius;
      at = d;
    }
  }
  if (tightest < GENTLEST_TURN) {
    return [
      `the Sky Cruiser's built track turns at ${tightest.toFixed(2)} m radius ` +
        `${at.toFixed(0)} m along the loop, tighter than the ${GENTLEST_TURN} m it promises — ` +
        `the plan was validated but the rebuilt curve does not honour it`,
    ];
  }
  return [];
};

/**
 * **The park train's built loop keeps its turning circle.**
 *
 * Its own analogue of {@link skyCruiserTurnsGently}, and it did not exist
 * because until 11 August 2026 the train had no turning circle at all: its route
 * was a radius-per-bearing profile with no curvature constraint anywhere, and a
 * sharp radial dip between two 5° control bearings produced a **0.60 m** bend on
 * the canonical seed — a hairpin tighter than one 1.5 m carriage, on a train
 * whose cars then overlapped through it, and nothing measured it. Switching the
 * train to the generic `rail/generate.ts` solver makes the minimum radius a
 * number in the vocabulary ({@link TRAIN_MIN_TURN_RADIUS}); this is what proves
 * the built curve honours it.
 *
 * The train keeps its own cubics rather than resampling them into a spline, so
 * there is no rebuild sag to lose radius to — but this measures the curve a
 * child actually rides regardless, which is the standard every rail invariant
 * here holds to.
 */
const trainKeepsItsTurningCircle: Invariant = (facts) => {
  const route = facts.world.train.route;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  let tightest = Infinity;
  let at = 0;
  for (let d = 0; d < route.length; d += 0.5) {
    route.pointAt(d - CURVATURE_SPAN, a);
    route.pointAt(d, b);
    route.pointAt(d + CURVATURE_SPAN, c);
    const radius = radiusThrough(a, b, c);
    if (radius < tightest) {
      tightest = radius;
      at = d;
    }
  }
  if (tightest < TRAIN_MIN_TURN_RADIUS) {
    return [
      `the park train's built track turns at ${tightest.toFixed(2)} m radius ` +
        `${at.toFixed(0)} m along the loop, tighter than the ${TRAIN_MIN_TURN_RADIUS} m it promises`,
    ];
  }
  return [];
};

/**
 * **The train runs through no plot and no stall.**
 *
 * The twin of {@link wallsClearTheRailway} and {@link treesClearTheRailway}, for
 * the obstacles those two do not cover — the booths and the ride plots. It did
 * not exist, and that is the second half of the 11 August 2026 bug: the old
 * profile could snap into a different free radial interval at each 5° control
 * bearing, and the spline between two of them ran *straight through whatever sat
 * between* — 0.31 m from the Rail Racer booth's centre and clean through the
 * middle of the Water Fight ride on the canonical seed, with nothing measuring
 * stall-versus-rail at all.
 *
 * Measured off the built centre line (`facts.distanceToRail`) against every
 * layout entry's own `boundingRadius` — the number the whole park routes and
 * scatters around — held to {@link TRACK_CLEARANCE}, the train's own half-width,
 * so a plot whose edge is within it is literally inside the train.
 */
const trainClearsEveryPlotAndStall: Invariant = (facts) => {
  const fouls: string[] = [];
  for (const plot of facts.plots) {
    const gap = facts.distanceToRail(plot.x, plot.z) - plot.boundingRadius;
    if (gap < TRACK_CLEARANCE) {
      fouls.push(
        `${plot.id} at (${plot.x.toFixed(1)}, ${plot.z.toFixed(1)}) reaches to ${gap.toFixed(2)} m ` +
          `of the rail centre line (needs ${TRACK_CLEARANCE} m) — the train runs through it`,
      );
    }
  }
  return fouls;
};

/**
 * **No flower grows on the railway.**
 *
 * The fourth twin of {@link wallsClearTheRailway}, {@link treesClearTheRailway}
 * and {@link trainClearsEveryPlotAndStall}, and the meadow needed one for
 * exactly the reason the trees did: `Flowers.pickSpawnPoint` kept its own list
 * of things to avoid — paths, plots, tap zones, the Sky Cruiser — and the train
 * was not on it. Nothing measured the result, so a flower could sprout between
 * the rails and stay there.
 *
 * It did. Found on 3 September 2026 by `check:coplanar`, which reported
 * `flowers/living-flower-stems` sharing a plane with
 * `park-train/train-track/track-ballast` on pool seed 225 — 0.0035 m² at a
 * 5.0 mm stand-off. The seam is the symptom; the defect is a flower growing out
 * of the ballast, on the far side of a fence a child cannot cross, so it can
 * never be picked either.
 *
 * Measured on the **built meadow** — the world-space instance positions of the
 * `living-flower-stems` `InstancedMesh` as the renderer is handed them — not on
 * the scatter's own rules, which is what let the gap exist unseen. The
 * threshold is the game's: `TRACK_CLEARANCE`, the train's own half-width, the
 * same number the three invariants above hold walls, trees and plots to, plus
 * the flower's own reach so the question is asked in the units a collision
 * would happen in. `Scenery.onRailway`'s 2.6 m fence margin is the generator's
 * target and is deliberately **not** the number here.
 */
const flowersClearTheRailway: Invariant = (facts) => {
  const fouls: string[] = [];
  const matrix = new Matrix4();
  const at = new Vector3();
  /**
   * The widest a flower's own bloom reaches from its stem, in metres —
   * `Flowers.WIDEST_FLOWER`'s value restated as a *measurement of the built
   * mesh* rather than imported, because importing `world/Flowers.ts` here would
   * load a seed-dependent module into `test/` before the seed is set (see this
   * file's own header). Read off the stems mesh's bounding sphere below.
   */
  let reach = 0;
  let measured = 0;
  facts.world.flowers.group.updateMatrixWorld(true);
  facts.world.flowers.group.traverse((object) => {
    if (!(object instanceof InstancedMesh) || object.name !== 'living-flower-stems') return;
    object.geometry.computeBoundingSphere();
    reach = object.geometry.boundingSphere?.radius ?? 0;
    for (let index = 0; index < object.count; index += 1) {
      object.getMatrixAt(index, matrix);
      at.setFromMatrixPosition(matrix).applyMatrix4(object.matrixWorld);
      // A picked flower is scaled to nothing until it respawns; it is not
      // standing anywhere yet and is not a finding.
      if (matrix.getMaxScaleOnAxis() <= 0) continue;
      measured += 1;
      const gap = facts.distanceToRail(at.x, at.z) - reach;
      if (gap < TRACK_CLEARANCE) {
        fouls.push(
          `flower at ${fmt([at.x, at.z])} reaches to ${gap.toFixed(2)} m of the rail centre ` +
            `line (needs ${TRACK_CLEARANCE} m) — it is growing on the track`,
        );
      }
    }
  });
  if (measured === 0) {
    return ['the meadow reported no flowers at all — this invariant measured nothing'];
  }
  return fouls;
};

/**
 * The suite. **Add an invariant by adding a line here.**
 */
/**
 * Half-width of the ginormous slide's chute, as built.
 *
 * `SlideRide`'s cross-section reaches ±0.95 m and its hand-rails sit at ±1.0 m
 * with a 0.11 m tube, so the thing a child rides in is 2.22 m across. Taken
 * from that geometry rather than from the route generator's corridor half-width,
 * which is the generator's own target and so would prove only that it can do
 * arithmetic.
 *
 * `PLAYER_RADIUS` is deliberately **not** added on top, unlike everywhere else
 * in this file. A rider on a slide is *inside* the trough, held by the rails —
 * the child's own width is already contained by the number above, and adding it
 * again would be double-counting a body that cannot stick out.
 */
const CHUTE_HALF_WIDTH = 1.11;

/**
 * The most the chute may climb between two samples, in metres.
 *
 * Not a tolerance for "roughly downhill": a slide is a thing you go down
 * because gravity does it, and a stretch that rises is a stretch a child stops
 * on. The figure is not zero only because the chute is a Catmull-Rom spline
 * through sampled points, which may overshoot by fractions of a millimetre
 * between them; a millimetre is four hundred times smaller than the 0.41 m
 * profile depth a rider sits in, so nothing at this scale is a slope.
 */
const SLIDE_MAY_RISE = 0.001;

/**
 * **The ginormous slide is one a child can actually ride down and walk away
 * from.** This is #118, stated as something the park proves on every seed.
 *
 * The bug was not subtle and neither is this: the slide's twelve hand-authored
 * coordinates were absolute, the castle's position is per-seed, and eight of
 * the twelve ended up inside the tower — the last of them behind a solid wall,
 * where a six-year-old was left with no way out. Every clause below would have
 * failed on that curve, which is the point.
 *
 * Measured off `facts.slideChute`, which is the built chute pushed out through
 * the scene graph into world space, against the built plots — never against
 * `slide/plan.ts`, which is the thing under test.
 */
const theGinormousSlideIsRideable: Invariant = (facts) => {
  const complaints: string[] = [];
  const chute = facts.slideChute;
  const first = chute[0];
  const last = chute[chute.length - 1];

  if (chute.length < 2 || !first || !last) {
    complaints.push('the ginormous slide has no chute at all');
    return complaints;
  }

  // --- 1. it goes down, all the way down ------------------------------------
  let worstRise = 0;
  let worstRiseAt: readonly [number, number, number] = first;
  for (let i = 1; i < chute.length; i += 1) {
    const before = chute[i - 1];
    const here = chute[i];
    if (!before || !here) continue;
    const rise = here[1] - before[1];
    if (rise > worstRise) {
      worstRise = rise;
      worstRiseAt = here;
    }
  }
  if (worstRise > SLIDE_MAY_RISE) {
    complaints.push(
      `the ginormous slide climbs ${worstRise.toFixed(3)} m at ` +
        `(${worstRiseAt[0].toFixed(1)}, ${worstRiseAt[1].toFixed(1)}, ${worstRiseAt[2].toFixed(1)}) ` +
        '— a slide that goes uphill is one a child stops on',
    );
  }

  // --- 2. it finishes in the ball pit ---------------------------------------
  //
  // Where it ends is the whole of #118, so it is asserted against the built
  // pit's own position rather than against anything the slide's plan believes.
  const pit = facts.plots.find((plot) => plot.id === 'ballPit');
  if (!pit) complaints.push('there is no ball pit for the ginormous slide to land in');
  else {
    const missed = Math.hypot(last[0] - pit.x, last[2] - pit.z);
    // BALL_PIT_RADIUS is 6; the plot's bounding radius is larger than the pit
    // itself, so the pit's own radius is what "lands in the balls" means.
    if (missed > 6) {
      complaints.push(
        `the ginormous slide ends ${missed.toFixed(1)} m from the middle of the ball pit ` +
          `at ${fmt([last[0], last[2]])} — it should end in the balls`,
      );
    }
  }

  // --- 3. it is not inside the castle ---------------------------------------
  //
  // The exact failure of #118. The chute starts *in* the parapet doorway by
  // design, so the first few metres of it are allowed to be within the
  // footprint and nothing after that is.
  const castle = facts.castleFootprint;
  {
    let insideAfterDoor: readonly [number, number, number] | null = null;
    let travelled = 0;
    for (let i = 1; i < chute.length; i += 1) {
      const before = chute[i - 1];
      const here = chute[i];
      if (!before || !here) continue;
      travelled += Math.hypot(here[0] - before[0], here[2] - before[2]);
      if (travelled < DOORWAY_GRACE) continue;
      if (
        Math.abs(here[0] - castle.x) < castle.halfX &&
        Math.abs(here[2] - castle.z) < castle.halfZ
      ) {
        insideAfterDoor = here;
        break;
      }
    }
    if (insideAfterDoor) {
      complaints.push(
        `the ginormous slide runs back inside the castle at ` +
          `${fmt([insideAfterDoor[0], insideAfterDoor[2]])} — this is #118, where a ` +
          'child finished the ride sealed inside the tower',
      );
    }
  }

  // --- 4. it clears every plot it is not deliberately joining ---------------
  //
  // At the width of the thing a child rides in, plus the child's own radius.
  for (const plot of facts.plots) {
    if (plot.id === 'building' || plot.id === 'ballPit') continue;
    for (const point of chute) {
      const gap = Math.hypot(point[0] - plot.x, point[2] - plot.z);
      if (gap < plot.boundingRadius + CHUTE_HALF_WIDTH) {
        complaints.push(
          `the ginormous slide passes ${gap.toFixed(1)} m from the middle of ` +
            `${plot.id} (radius ${plot.boundingRadius.toFixed(1)}) at ` +
            `${fmt([point[0], point[2]])}`,
        );
        break;
      }
    }
  }

  return complaints;
};

/**
 * **The ginormous slide is standing on something, and you can walk between the
 * legs.**
 *
 * Separate from the chute's own invariant because it fails differently. A
 * support planner that places *nothing* looks healthy from every angle except
 * the park's — the ride still works, the tests still pass, and a 95 m trough
 * hangs in the air. That happened here: the "do not pinch a plot corridor"
 * rule counted the castle and the ball pit, whose bounding circles cover this
 * entire ride between them, and it rejected all 37 viable spots in silence.
 *
 * The second clause is the opposite failure. Legs a child cannot walk between
 * turn the ground under the slide into a paddock, which is worse than no legs
 * at all — so the gap between the nearest two is measured at the width a child
 * actually is.
 */
const theGinormousSlideStandsOnSomething: Invariant = (facts) => {
  const complaints: string[] = [];
  const legs = facts.slideLegs;
  const chute = facts.slideChute;

  // --- 1. it is held up at all ----------------------------------------------
  //
  // Scaled to the ride: a leg roughly every 20 m of chute is sparse, and
  // anything sparser than that is not "deliberately generous spacing", it is a
  // planner that has quietly given up.
  let chuteLength = 0;
  for (let i = 1; i < chute.length; i += 1) {
    const before = chute[i - 1];
    const here = chute[i];
    if (!before || !here) continue;
    chuteLength += Math.hypot(here[0] - before[0], here[1] - before[1], here[2] - before[2]);
  }
  const wanted = Math.floor(chuteLength / 20);
  if (legs.length < wanted) {
    complaints.push(
      `the ginormous slide is ${chuteLength.toFixed(0)} m long and stands on ` +
        `${legs.length} legs — at least ${wanted} were expected, and a chute this ` +
        'long with nothing under it reads as floating',
    );
  }

  // --- 2. a child can walk between them -------------------------------------
  for (let i = 0; i < legs.length; i += 1) {
    for (let j = i + 1; j < legs.length; j += 1) {
      const a = legs[i];
      const b = legs[j];
      if (!a || !b) continue;
      const faces = Math.hypot(a.x - b.x, a.z - b.z) - 2 * SLIDE_LEG_RADIUS;
      if (faces < WALKABLE_GAP) {
        complaints.push(
          `two of the ginormous slide's legs leave ${faces.toFixed(2)} m between their ` +
            `faces at ${fmt([a.x, a.z])} and ${fmt([b.x, b.z])} — a child cannot get through`,
        );
      }
    }
  }

  // --- 3. each one actually reaches its chute -------------------------------
  //
  // A leg is only support if it meets the thing it is supporting. Measured
  // against the built chute rather than against what the planner believed.
  for (const leg of legs) {
    if (leg.top <= leg.ground) {
      complaints.push(`a ginormous slide leg at ${fmt([leg.x, leg.z])} has no height at all`);
      continue;
    }
    let nearest = Infinity;
    for (const point of chute) {
      const gap = Math.hypot(point[0] - leg.x, point[2] - leg.z);
      if (gap < nearest) nearest = gap;
    }
    if (nearest > SLIDE_LEG_REACH) {
      complaints.push(
        `a ginormous slide leg at ${fmt([leg.x, leg.z])} is ${nearest.toFixed(1)} m from the ` +
          'chute it is supposed to be holding up',
      );
    }
  }

  return complaints;
};

/**
 * **The ginormous slide leaves the castle over the top of the battlements**,
 * with real air under it — not through the stone.
 *
 * ### This used to claim something that was not true
 *
 * It was called `theGinormousSlideLeavesThroughItsDoor`, and it asserted that
 * the chute passed through a hole cut in the south curtain wall, citing
 * `SLIDE_PLAN.facadeDoorMinX/MaxX` as the value both the plan and the masonry
 * read. **No such hole is ever cut.** `SLIDE_PLAN`'s door numbers reach
 * `ShellPlan.slideGap`, whose only two readers are inside `wallShapes` and
 * `buildWindows` — and `BuildingShell` early-returns into `buildCastle` on the
 * facade branch, which cuts the front entrance and nothing else, while the
 * interior shell that *does* reach those builders sets `slideGap: null`. Both
 * readers are unreachable, so the doorway existed only in the plan and in this
 * test. Pre-existing rot, orphaned by the castle rewrite.
 *
 * The old clauses could not fail. One compared `SLIDE_PLAN`'s door span against
 * `BUILDING_HALF_X` — both generator-side, and already guaranteed by
 * `doorFitsTheWall`, which is rules against rules. The other compared the built
 * chute against that same planned span, which is a number nothing builds from.
 *
 * ### What is true, measured
 *
 * The chute crosses the south wall plane at **y 14.84** on every one of the
 * five seeds, and the tallest stone — the crenellations — tops out at
 * **y 10.29**. What matters is the chute's *underside*, at 14.84 − 1.11 =
 * **13.73 m**, so the air a rider actually has under them is **3.44 m** — not
 * the 4.55 m the centre line clears by, which is the number this was first
 * written up with. (Corrected in review. Two numbers describing one gap is the
 * exact habit this branch has now been bitten by twice; the code below was
 * always right, only the prose was loose.)
 *
 * So the honest guarantee is not "it goes through the hole" but "it goes over
 * the top, and there is air under it", and that is what is asserted here.
 *
 * That is a guarantee worth holding: it is what keeps a child from riding down
 * inside a wall. It fails the moment anyone lowers `START_Y`, raises
 * `CASTLE_WALL_HEIGHT`, or gives the merlons another metre — none of which is
 * far-fetched, and all of which currently pass unnoticed.
 *
 * Measured off the built chute pushed out through the scene graph into world
 * space, against the built masonry's own world bounding boxes — never against
 * `slide/plan.ts` or `CASTLE_WALL_HEIGHT`, which are the things under test.
 */
const theGinormousSlideLeavesOverTheBattlements: Invariant = (facts) => {
  const complaints: string[] = [];
  const castle = facts.castleFootprint;
  const chute = facts.slideChute;

  const first = chute[0];
  const last = chute[chute.length - 1];
  if (chute.length < 2 || !first || !last) {
    complaints.push('the ginormous slide has no chute, so it leaves over nothing');
    return complaints;
  }

  // --- 1. the chute starts over the castle, not in mid-air beyond it --------
  //
  // In plan view. The mouth is carried back over the footprint on purpose, so
  // the ride begins on the tower rather than floating off the south face. The
  // castle's south face is +Z.
  const wallZ = castle.z + castle.halfZ;
  if (first[2] > wallZ) {
    complaints.push(
      `the ginormous slide's mouth starts ${(first[2] - wallZ).toFixed(2)} m beyond the ` +
        `castle's south wall (chute z ${first[2].toFixed(2)}, wall z ${wallZ.toFixed(2)}) ` +
        '— it should start back over the castle, so the ride begins on the tower',
    );
  }

  // --- 2. it does cross the south side, so there is something to measure ----
  //
  // Interpolates across the span that straddles the wall plane rather than
  // taking the nearest sample: at 0.4 m spacing the nearest sample can sit a
  // third of a metre to either side, which is most of the clearance measured.
  let crossing: { x: number; y: number } | null = null;
  for (let i = 1; i < chute.length; i += 1) {
    const before = chute[i - 1];
    const here = chute[i];
    if (!before || !here) continue;
    if (before[2] > wallZ || here[2] < wallZ) continue;
    const span = here[2] - before[2];
    // Guard the degenerate case: a chute running exactly along the wall plane
    // would divide by zero and hand the message a NaN, and NaN compares false
    // against every threshold — which would make this clause incapable of
    // failing while still looking like a test.
    const t = Math.abs(span) < 1e-9 ? 0 : (wallZ - before[2]) / span;
    crossing = {
      x: before[0] + (here[0] - before[0]) * t,
      y: before[1] + (here[1] - before[1]) * t,
    };
    break;
  }

  if (crossing === null) {
    complaints.push(
      `the ginormous slide never crosses its own south wall (wall z ${wallZ.toFixed(2)}, ` +
        `chute runs z ${first[2].toFixed(2)}…${last[2].toFixed(2)}) — it does not leave ` +
        'the castle on the side it is built to leave on',
    );
    return complaints;
  }

  // --- 3. and where it crosses, the stone is below it -----------------------
  //
  // The clause that carries the weight. The underside of the chute — its centre
  // line less the half-envelope a rider sits in — must be above the highest
  // masonry, or the ride passes through the battlements.
  const underside = crossing.y - CHUTE_HALF_WIDTH;
  const stone = facts.castleMasonryTopY;

  // **A missing measurement is a failure here, not a pass.** `castleMasonryTopY`
  // is a max seeded with `-Infinity` over meshes picked out by name, so if the
  // castle is ever renamed out from under it the fact arrives as `-Infinity` and
  // `underside < -Infinity` is false for *every conceivable chute* — this
  // invariant would go quietly green while measuring nothing at all. Caught in
  // review by breaking the name pattern: the canonical suite stayed 28/28 green.
  //
  // Note the polarity is the opposite of
  // {@link theGinormousSlideMissesTheCastleTowers}'s `Number.isFinite(worstGap)`
  // guard, and the reason is worth having, because the two look contradictory
  // side by side. That invariant can read `Infinity` as a *genuine pass* — the
  // chute simply never came near a tower — **only because it has already ruled
  // out the disarmed case separately**, with its own `towers.length === 0`
  // complaint. Two possible meanings, two checks.
  //
  // Here there is only one number to guard, so one check does both jobs: an
  // unmatched name and a missing castle are the same failure and read the same
  // way. Neither guard should be "made consistent" with the other by removing
  // it — they are opposite for that reason, not by accident.
  if (!Number.isFinite(stone)) {
    complaints.push(
      'no castle stonework was found in the built park at all, so the check that ' +
        'keeps the ginormous slide out of the battlements measured nothing. Either ' +
        'the castle is missing, or the mesh names `parkFacts.castleMasonryTopY` ' +
        'looks for have changed and this invariant has been silently switched off',
    );
    return complaints;
  }

  if (underside < stone) {
    complaints.push(
      `the ginormous slide crosses the castle's south wall at world ` +
        `(${crossing.x.toFixed(2)}, ${crossing.y.toFixed(2)}) — its underside is at ` +
        `${underside.toFixed(2)} m and the stonework tops out at ${stone.toFixed(2)} m, so ` +
        `the chute is ${(stone - underside).toFixed(2)} m inside the battlements. Nothing ` +
        'cuts a hole for it: `slideGap` reaches no geometry, so there is solid stone here',
    );
  }

  return complaints;
};

/**
 * **The ginormous slide clears the garden on the castle's roof.** (Issue #462.)
 *
 * Jim, having stood on the roof garden: *"when out in the park there should be
 * a roof on the castle with a few of the features from the actual roof garden
 * on top of it."* So the castle grew a roof, and on it the garden's paving, its
 * pavilion and its ring of planters.
 *
 * ## Why that needs an invariant of its own
 *
 * Everything else on the castle is matched by
 * {@link ParkFacts.castleMasonryTopY}'s name pattern, and
 * {@link theGinormousSlideLeavesOverTheBattlements} measures the chute against
 * it. The roof garden deliberately is **not** matched — an interior-ish name
 * falling into that pattern is the fault `castleFabric.ts`'s `castle-timber-`
 * note exists for. So the roof garden is a class of solid standing on the
 * castle that the slide's own invariant cannot see, and the guard has to be
 * explicit.
 *
 * It is not hypothetical. The pavilion is a **scaled copy** of a building sized
 * for the 42 m interior plate, and even cut to facade scale its pyramid stands
 * **1.95 m above the battlements** — measured, on the canonical seed. Its mast
 * and bobble stood 4 m higher again until they were dropped from the facade
 * copy for exactly this reason.
 *
 * ## What it asserts, and the proxy it deliberately does not
 *
 * The first draft asserted *"nothing on the roof rises above the
 * battlements"*, which is tidy, easy to measure, and **the wrong question**. It
 * fails on a pavilion that clears the ride by metres, and worse, a pavilion
 * standing proud of the parapet is the whole point: it is what a child in the
 * park can actually see. Passing that draft would have meant shrinking the
 * pavilion to a fifth of its size to satisfy a number nothing in the game
 * cares about.
 *
 * So this measures the real requirement instead: **no sampled point of the
 * chute passes over the roof garden lower than the roof garden's own top**,
 * with the chute's full built envelope (`CHUTE_ENVELOPE`, the trough as
 * measured, not the generator's wider steering corridor) counted underneath its
 * centre line. That is stated against the ride a child sits in rather than
 * against a decorative line, and it is the assertion that would actually catch
 * a pavilion growing into the slide.
 *
 * **Two ways this could assert nothing, both announced rather than passed.** A
 * missing roof garden is a failure, in the tradition of `castleMasonryTopY`'s
 * own guard. And a chute that never crosses the roof's plan box on a given seed
 * is a legitimate pass — but it is a pass over *zero* samples, so the count is
 * reported on every run the way `everyProvenBridgeSiteKeepsItsBridge` reports
 * its coverage, and a suite where every seed covers nothing is visible instead
 * of silent.
 */
const theSlideClearsTheCastleRoofGarden: Invariant = (facts) => {
  const complaints: string[] = [];
  const roof = facts.castleRoofGarden;

  if (roof === null) {
    complaints.push(
      'the castle in the garden has no roof garden on it at all (nothing named ' +
        '`castle-roof-garden` is in the built park), so this invariant is switched off. ' +
        "Issue #462 put the roof garden's paving, pavilion and planters up there so a " +
        'child out in the park can see where she was standing',
    );
    return complaints;
  }

  // The chute is a tube, so a centre line passing beside the roof still puts
  // trough over it. Widen the box by the built half-width before asking.
  const reach = facts.chuteEnvelope.halfWidth;
  let over = 0;
  let worst = Infinity;
  for (const [x, y, z] of facts.slideChute) {
    if (x < roof.minX - reach || x > roof.maxX + reach) continue;
    if (z < roof.minZ - reach || z > roof.maxZ + reach) continue;
    over += 1;
    const gap = y - facts.chuteEnvelope.below - roof.topY;
    if (gap < worst) worst = gap;
  }

  process.stderr.write(
    `  the slide over the castle's roof garden: ${over} chute sample(s) pass over it` +
      `${over === 0 ? ' — this clause asserts nothing on this seed' : `, clearing its ${roof.topY.toFixed(2)} m top by ${worst.toFixed(2)} m at worst`}\n`,
  );

  if (over > 0 && worst < 0) {
    complaints.push(
      `the ginormous slide passes over the castle's roof garden with its trough floor ` +
        `${(-worst).toFixed(2)} m *inside* it — the roof tops out at ${roof.topY.toFixed(2)} m ` +
        `and the chute's underside gets to ${(roof.topY + worst).toFixed(2)} m. Lower what is ` +
        'on that roof, or the ride goes through the pavilion',
    );
  }

  return complaints;
};

/**
 * **The ginormous slide does not go through the castle's corner towers.**
 *
 * Jim rode it and found it clipping through them; this is that, stated as
 * something the park proves on every seed. It fails the build, which is what he
 * asked for.
 *
 * ### Why nothing caught it
 *
 * `slide/plan.ts` cannot use the standard `clearOfPlots` predicate — the
 * castle's plot circle and the ball pit's overlap, so no point between the two
 * satisfies it, and a ride whose whole job is joining them would never solve.
 * It therefore exempts exactly those two plots and re-imposes the castle
 * "precisely, as its actual footprint rectangle".
 *
 * A footprint rectangle does not contain the towers. They stand at
 * `(±outerX, ±outerZ)` — *outside* the rectangle by half a wall thickness — and
 * bulge 2.05–2.45 m further out again. So the exemption was narrow and
 * deliberate exactly as intended, and the thing re-imposed in its place was
 * still missing the one solid the chute passes closest to. Measured on the
 * canonical seed the chute ran **2.02 m inside a tower body**, 87 consecutive
 * samples buried, while every existing invariant stayed green.
 *
 * ### What it measures
 *
 * The built chute against the built towers — both read out of the scene graph,
 * neither taken from the plan. The threshold is the **rider's own envelope**
 * (`CHUTE_ENVELOPE`, derived from the trough's cross-section) rather than
 * `CORRIDOR_RADIUS`, which is the wider margin the generator steers by: a
 * collision test owes the truth about where the trough physically is, not about
 * where the search preferred to keep it.
 *
 * A tower is a solid of revolution, so testing the centre line against
 * `towerRadius + halfWidth` is exact — it is a swept disc in closed form, and
 * strictly better here than firing a ring of probe rays and hoping the gaps
 * between them are small enough to catch a thin obstacle.
 */
const theGinormousSlideMissesTheCastleTowers: Invariant = (facts) => {
  const complaints: string[] = [];
  const chute = facts.slideChute;
  const towers = facts.castleTowers;
  const envelope = facts.chuteEnvelope;

  if (towers.length === 0) {
    complaints.push(
      'no castle towers were found in the built park, so this invariant is ' +
        'measuring nothing — the tower meshes have been renamed or removed',
    );
    return complaints;
  }
  if (chute.length < 2) {
    complaints.push('the ginormous slide has no chute to check against the towers');
    return complaints;
  }

  let worstGap = Infinity;
  let worstTower = '';
  let worstAt: readonly [number, number, number] = chute[0] ?? [0, 0, 0];
  let buried = 0;

  for (const point of chute) {
    const [px, py, pz] = point;
    for (const tower of towers) {
      // The chute occupies a band around its centre line, so it fouls the
      // tower's height range if either edge of that band is inside it.
      if (py + envelope.above < tower.bottomY) continue;
      if (py - envelope.below > tower.topY) continue;

      // Radius where the two actually meet in height, so a cone is measured at
      // the height the chute passes it rather than at its widest.
      const clamped = Math.min(Math.max(py, tower.bottomY), tower.topY);
      const span = tower.topY - tower.bottomY;
      const t = span <= 1e-9 ? 0 : (clamped - tower.bottomY) / span;
      const radius = tower.radiusBottom + (tower.radiusTop - tower.radiusBottom) * t;

      const gap = Math.hypot(px - tower.x, pz - tower.z) - radius - envelope.halfWidth;
      if (gap < worstGap) {
        worstGap = gap;
        worstTower = tower.name;
        worstAt = point;
      }
      if (gap < 0) buried += 1;
    }
  }

  // `worstGap` stays Infinity only if the chute never shares a height with any
  // tower, which is a clean pass rather than a missing measurement — but it must
  // never reach a message, because Infinity and NaN compare false against every
  // threshold and would make this look green while testing nothing.
  if (Number.isFinite(worstGap) && worstGap < 0) {
    complaints.push(
      `the ginormous slide passes ${(-worstGap).toFixed(2)} m inside ${worstTower} at ` +
        `(${worstAt[0].toFixed(2)}, ${worstAt[1].toFixed(2)}, ${worstAt[2].toFixed(2)}) ` +
        `— ${buried} of ${chute.length} sampled points are inside a tower, and a child ` +
        'rides through solid masonry',
    );
  }

  return complaints;
};

/**
 * **Every trackside camera on the ginormous slide can see the bit of ride it
 * was stood beside, on every seed.**
 *
 * The slide cuts between a chase camera and three trackside ones
 * (`slide/cameras.ts`, and Jim's ruling quoted there). Those three are placed
 * from the **solved route**, so on a procgen ride they land somewhere different
 * every time — and a camera that ends up looking at the back of a tower, buried
 * in a hill, or too shallow to see over the chute's own hand-rail is a stretch
 * of the ride where a child cannot see herself.
 *
 * `check:slide-rider` already rides the canonical seed with a real `Player` and
 * measures her in pixels. This is the other four seeds, and it asks a different
 * question: not *is the rider legible* but *is the camera anywhere sensible*.
 * That split is deliberate — the pixel check is far too slow to run five times,
 * and a placement fault shows up in geometry long before it needs a rider.
 *
 * Four clauses, and the first is the one the brief called for:
 *
 * 1. **Every part of the ride is covered by some camera.** Measured as
 *    arithmetic on the built plan: the spans must start at 0, end at 1, and
 *    meet exactly — no gap where the game has no shot, and no overlap where two
 *    disagree about which is live.
 * 2. **Nothing stands between a camera and the chute it covers**, sampled
 *    across that camera's whole beat against the built chute and the built
 *    castle. This is the clause the measured 50° elevation threshold exists for.
 * 3. **No camera is underground.** A lens below the hills renders dirt.
 * 4. **There is more than one shot.** A plan that collapsed to a single chase
 *    beat would satisfy 1–3 vacuously while quietly undoing the whole feature.
 */
const theSlideTracksideCamerasCanSeeTheRide: Invariant = (facts) => {
  const complaints: string[] = [];
  const spans = facts.slideShotSpans;
  const cameras = facts.slideCameras;

  // Anti-vacuity first, in the tradition of `castleMasonryTopY`'s guard: an
  // empty plan must be a complaint, not a silent pass over nothing.
  if (spans.length < 2) {
    complaints.push(
      `the ginormous slide's shot plan has ${spans.length} beat(s) — it is meant to cut ` +
        'between a chase camera and trackside ones, and with fewer than two it cuts nowhere',
    );
    return complaints;
  }
  if (cameras.length === 0) {
    complaints.push(
      'the ginormous slide has no trackside cameras at all, so the chase camera — which ' +
        'shows a rider lying feet-first as a floating head, by construction — is the only ' +
        'view of the whole ride',
    );
    return complaints;
  }

  // 1. The beats tile the ride.
  const first = spans[0];
  const last = spans[spans.length - 1];
  if (first && Math.abs(first.from) > 1e-9) {
    complaints.push(
      `the ginormous slide's first shot starts at ${first.from.toFixed(4)} of the way down ` +
        'rather than at the top — the opening of the ride has no camera',
    );
  }
  if (last && Math.abs(last.to - 1) > 1e-9) {
    complaints.push(
      `the ginormous slide's last shot ends at ${last.to.toFixed(4)} rather than at the ` +
        'bottom — the end of the ride has no camera',
    );
  }
  for (let i = 1; i < spans.length; i += 1) {
    const previous = spans[i - 1];
    const current = spans[i];
    if (!previous || !current) continue;
    const step = current.from - previous.to;
    if (Math.abs(step) > 1e-9) {
      complaints.push(
        `beat ${i - 1} of the ginormous slide ends at ${previous.to.toFixed(4)} and beat ${i} ` +
          `starts at ${current.from.toFixed(4)} — ${step > 0 ? 'a gap where no camera has ' +
          'her' : 'an overlap where two shots each think they are live'}`,
      );
    }
  }

  // 2 and 3. Each camera can see its own beat, and is above the ground.
  for (const camera of cameras) {
    if (camera.samples === 0) {
      complaints.push(
        `the trackside camera on beat ${camera.beat} was never sampled, so its sight line ` +
          'proves nothing',
      );
      continue;
    }
    if (camera.blocked > 0) {
      complaints.push(
        `the trackside camera on beat ${camera.beat}, at (${camera.eye[0].toFixed(1)}, ` +
          `${camera.eye[1].toFixed(1)}, ${camera.eye[2].toFixed(1)}), cannot see the chute ` +
          `for ${camera.blocked} of ${camera.samples} samples across its own beat — the ` +
          'chute or the castle is in the way. If it is the near hand-rail, the elevation ' +
          'in `slide/cameras.ts` is too shallow: the sweep recorded there puts the ' +
          'threshold at 50°',
      );
    }
    // Clear of the grass by at least the chute's own half-width. Taken from the
    // game's built profile rather than invented here, in the spirit of the rule
    // about thresholds: it is a length this ride already has an opinion about,
    // and it is comfortably more than a lens needs to be out of the dirt. The
    // three cameras measure 20.0, 13.8 and 6.7 m on the canonical seed, so this
    // fires on a camera that has genuinely gone into a hill rather than on one
    // that is merely low.
    const air = camera.eye[1] - camera.groundY;
    const needed = facts.chuteEnvelope.halfWidth;
    if (air < needed) {
      complaints.push(
        `the trackside camera on beat ${camera.beat} sits ${air.toFixed(2)} m over the ` +
          `ground against ${needed.toFixed(2)} m needed — it is in the hillside, and ` +
          'renders dirt',
      );
    }
  }

  return complaints;
};

/**
 * **The Sky Cruiser fits through the castle it flies into.** (Issue #113.)
 *
 * The other cruiser invariants ask whether the loop *misses* things. This one
 * exists because the loop now deliberately does not: it crosses two curtain
 * walls, and the only thing standing between a child and a wall of stone is
 * that the hole was cut in the right place, at the right height, wide enough,
 * and clear of the towers at either end of the panel.
 *
 * It is measured twice over, on purpose, and the two are not redundant:
 *
 * - the geometric check says *why* — within one panel, this much masonry left
 *   beside the tower, this wide against a car this wide, both openings sharing
 *   a height because the run through the castle is level;
 * - the swept check says *whether* — four rays along the car's own envelope,
 *   fired at **every mesh under the castle's garden root**, naming what they
 *   hit. It knows nothing about walls or towers, so a fixture added to the
 *   castle later is covered from the day it appears.
 *
 * Both are the same functions the boot assert and `check:castle-window` run,
 * so there is one definition of "does the ride fit" and it cannot drift.
 *
 * **This one still passes vacuously on a seed with no crossing** — it asks
 * whether the windows that exist are right, not whether any exist. That the
 * crossing *happens at all* is now a separate and much stronger claim, made by
 * {@link skyCruiserAlwaysFliesThroughTheCastle} below. The two were one
 * invariant for a while and the split matters: "the hole is in the right place"
 * and "there is a hole" fail for completely different reasons, and reading one
 * green as evidence of the other is exactly how a seed shipped an unbroken
 * castle.
 *
 * Proven to have teeth rather than assumed to: shrinking the opening below the
 * car's width, cutting it 3 m from where the route crosses, shoving it into a
 * corner tower and raising it through the battlements each turn this red — and
 * building the wall solid while still declaring the openings is what exposed
 * that the swept check was measuring nothing at all, because a headless park
 * never renders and every `matrixWorld` was still the identity.
 */
const skyCruiserFitsThroughTheCastle: Invariant = (facts) => facts.castlePass.complaints;

/**
 * **A child boarding the ginormous slide is put down on the chute**, not a
 * castle's width from it.
 *
 * The seat, the grown-up and the teleport all position themselves from
 * `SlideRide.pointAt`, and all three are parented alongside the chute so those
 * are the same coordinates. `Building.ts` says so in a comment; this is the
 * part that checks it is still true.
 *
 * It exists because the chute had to move out of the castle's plot group and up
 * to park level — a ride spanning two plots is the park's content, and
 * `check:park` measures everything under an anchor against the radius that
 * anchor promises. Moving the chute alone would have left three riders behind
 * in the castle's frame, each of them floating about 26 m from the trough,
 * while the slide itself still looked perfect from every angle. So they moved
 * together, and this is the assertion that they still travel together.
 *
 * Comparing `pointAt` straight against `pointAt` pushed through the scene graph
 * is the whole test: at park level the group is the identity and the two are
 * the same number. It needs no knowledge of *which* group is correct, so it
 * keeps working if the park is restructured again for some other reason.
 */
const theSlideRiderSitsOnTheChute: Invariant = (facts) => {
  const complaints: string[] = [];
  const { local, world } = facts.slideRiderFrame;

  if (local.length === 0 || local.length !== world.length) {
    complaints.push(
      `the ginormous slide's rider frame was sampled ${local.length} times locally ` +
        `and ${world.length} times in world space — nothing can be concluded`,
    );
    return complaints;
  }

  let worst = 0;
  let worstAt = 0;
  for (let i = 0; i < local.length; i += 1) {
    const a = local[i]!;
    const b = world[i]!;
    const drift = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    if (drift > worst) {
      worst = drift;
      worstAt = i;
    }
  }

  // Millimetres, not zero: these are floating-point transforms of the same
  // number, and the failure this guards against is metres wide.
  if (worst > 0.001) {
    const a = local[worstAt]!;
    const b = world[worstAt]!;
    complaints.push(
      `the ginormous slide's riders would sit ${worst.toFixed(2)} m off the chute — ` +
        `${(worstAt / (local.length - 1) * 100).toFixed(0)}% along, \`pointAt\` gives ` +
        `(${a[0].toFixed(2)}, ${a[1].toFixed(2)}, ${a[2].toFixed(2)}) but the chute is ` +
        `drawn at (${b[0].toFixed(2)}, ${b[1].toFixed(2)}, ${b[2].toFixed(2)}) — the seat, ` +
        'the grown-up and the boarding teleport all read the first of those',
    );
  }

  return complaints;
};

/**
 * **About half the ginormous slide's chute is see-through** (#228).
 *
 * Jim: *"the slide should have a mix of transparent and opaque sections to see
 * the part through it"*, roughly 50/50.
 *
 * #228 asks whoever builds this to say plainly whether it needs an invariant,
 * rather than leaving it unstated. It does, and this is why: the split is a
 * function of the chute's **length**, and the chute's length is procedural. A
 * ride that came out shorter than one band period on some future seed would
 * build an empty see-through mesh and be uniformly opaque again — a feature
 * silently absent on one seed, which is precisely the class of failure this
 * suite exists to catch and the one a reviewer reading the diff cannot.
 *
 * What is **not** asserted here, because it is structural rather than
 * measurable: that the two meshes tile the sweep exactly. `buildChute` is
 * called with a predicate and its negation, so every quad lands in exactly one
 * of the two by construction — there is no arithmetic that could leave a hole
 * in the slide for a test to find. (Checked once by hand on a 61 m probe:
 * 2520 + 2340 = 4860 vertices, exactly a full sweep.)
 *
 * The band is deliberately wide. This is an art decision Jim will tune by
 * looking at it, and an invariant that pinned it to 0.5 would fail the moment
 * he said "a bit more glass" — it is here to catch *absent*, not to police
 * taste.
 */
const theChuteIsHalfSeeThrough: Invariant = (facts) => {
  const { solid, clear } = facts.slideChuteBands;
  const total = solid + clear;

  if (total === 0) {
    return ['the ginormous slide built no chute at all — neither mesh has any geometry'];
  }
  if (clear === 0) {
    return [
      'the ginormous slide is entirely opaque: its see-through mesh has no geometry, ' +
        `against ${solid} vertices of solid chute — issue #228 asked for about half of it ` +
        'to be see-through, and on this seed none of it is',
    ];
  }
  if (solid === 0) {
    return [
      'the ginormous slide is entirely see-through: its solid mesh has no geometry, ' +
        `against ${clear} vertices of clear chute — it is meant to be a mix`,
    ];
  }

  const share = clear / total;
  if (share < 0.35 || share > 0.65) {
    return [
      `the ginormous slide is ${(share * 100).toFixed(0)}% see-through ` +
        `(${clear} clear vertices against ${solid} solid) — issue #228 asked for about ` +
        'half and half, and this is far enough off that the pattern has stopped reading ' +
        'as alternating',
    ];
  }

  return [];
};

/**
 * How tall a child is, standing, in metres.
 *
 * ART_DIRECTION.md §4: the player kid is 2.12 m after the cartoon pass. Stated
 * here rather than imported for the reason {@link CHUTE_HALF_WIDTH} is — and
 * `scripts/check-statue-occlusion.mts` states the same number for the same
 * reason, which is the other place in this repo that asks "can she be seen
 * through something".
 *
 * Unlike {@link CHUTE_HALF_WIDTH}, `PLAYER_RADIUS` **is** added on top wherever
 * this is used: a rider on the chute is contained by the trough, but a child
 * standing in the ball pit is a free body next to a structure, and her shoulder
 * is as able to be inside the chute as her nose.
 */
const RIDER_HEIGHT = 2.12;

/**
 * **A child finishes the ginormous slide in the balls, and not inside the
 * chute she has just come out of.**
 *
 * Jim, having ridden it on 5 August 2026: *"at the bottom of the slide, at the
 * end of the ride, the player appears clipped into the slide, not in the ball
 * pit like they should"*. Both halves were true and both had one cause — the
 * dismount was computed by `planExit()`, which fans bearings out from the pit
 * and has never been told where the chute is (see `slide/landing.ts`).
 *
 * This is the guard that stops it coming back, and it is deliberately written
 * as the **two** things Jim said rather than one: in the pit, *and* clear of
 * the chute. Either alone passes for the wrong reason. A landing far out on
 * the grass is clear of the chute; a landing dead under the mouth is inside the
 * pit.
 *
 * ### Why this measures a column and not a point
 *
 * `finishRide` hands her back `LANDING_DROP` above the balls and lets gravity
 * close the gap, so there is no single height at which she exists. The
 * clearance is taken over the whole column she occupies between being handed
 * back and coming to rest — feet on the balls at the bottom, head at the top of
 * the drop — which is conservative in the only direction that matters.
 *
 * Thresholds come from the built trough (`CHUTE_ENVELOPE`, via
 * `riderClearanceFromChute`) and never from `slide/plan.ts`'s `CORRIDOR_RADIUS`,
 * which is the wider margin the *generator* steers by: measuring against the
 * generator's own target would report a clip half a metre before there is one,
 * and the temptation would then be to loosen the wrong number.
 */
const theSlideRiderLandsInTheBalls: Invariant = (facts) => {
  const complaints: string[] = [];
  const landing = facts.slideLanding;
  const chute = facts.slideChute;

  // Anti-vacuity, in the tradition of `castleMasonryTopY`'s guard: every clause
  // below is a comparison, and a comparison against a missing measurement is a
  // pass that measured nothing.
  if (chute.length === 0) {
    return ['the ginormous slide has no chute, so where it lands cannot be measured'];
  }
  if (
    !Number.isFinite(landing.x) ||
    !Number.isFinite(landing.z) ||
    !Number.isFinite(landing.groundY) ||
    !Number.isFinite(landing.pitRadius)
  ) {
    return [
      'the ginormous slide’s landing could not be measured — ' +
        `spot (${landing.x}, ${landing.z}), ground ${landing.groundY}, ` +
        `pit radius ${landing.pitRadius}`,
    ];
  }

  // 1. She is in the balls — all of her, not just her centre line.
  const fromPitCentre = Math.hypot(landing.x - landing.pitX, landing.z - landing.pitZ);
  if (fromPitCentre + PLAYER_RADIUS > landing.pitRadius) {
    complaints.push(
      `the ginormous slide puts a child down ${fromPitCentre.toFixed(2)} m from the ball ` +
        `pit’s centre, and she is ${PLAYER_RADIUS} m wide, so she overhangs a pit of ` +
        `radius ${landing.pitRadius} m by ` +
        `${(fromPitCentre + PLAYER_RADIUS - landing.pitRadius).toFixed(2)} m — ` +
        'the ride is supposed to land her in the balls',
    );
  }

  // 2. And she is not inside the thing she just came out of. Measured against
  //    every sample of the built chute, not only its last one: the route wraps
  //    the castle and an earlier stretch passing over the pit would clip her
  //    just as thoroughly as the mouth does.
  let worstGap = Infinity;
  let worstAt = -1;
  for (let i = 0; i < chute.length; i += 1) {
    const [cx, cy, cz] = chute[i]!;
    const gap = riderClearanceFromChute(
      landing.x,
      landing.groundY,
      landing.z,
      // The whole column: the drop she is handed back at, plus her own height.
      LANDING_DROP + RIDER_HEIGHT,
      cx,
      cy,
      cz,
    );
    if (gap < worstGap) {
      worstGap = gap;
      worstAt = i;
    }
  }

  if (!Number.isFinite(worstGap)) {
    // Cannot happen with a non-empty chute, and says so rather than passing if
    // it somehow does. Opposite polarity to `theSlideDoesNotClipTheTowers`'s
    // `Infinity`, where "never came near one" is a genuine pass; here every
    // sample is compared, so an infinity means no comparison happened.
    return ['the ginormous slide’s landing was never compared against the chute'];
  }

  if (worstGap < 0) {
    const [cx, cy, cz] = chute[worstAt]!;
    complaints.push(
      `the ginormous slide leaves a child ${(-worstGap).toFixed(2)} m inside its own chute ` +
        `where it stops: she is put down at (${landing.x.toFixed(2)}, ${landing.z.toFixed(2)}) ` +
        `standing on ${landing.groundY.toFixed(2)} m, and the chute runs through ` +
        `(${cx.toFixed(2)}, ${cy.toFixed(2)}, ${cz.toFixed(2)}) — ` +
        `${((worstAt / (chute.length - 1)) * 100).toFixed(0)}% along the ride`,
    );
  }

  return complaints;
};

/**
 * Air that must separate the ginormous slide from the Sky Cruiser, in metres.
 *
 * Decision 4's rail-over-rail figure. Stated here rather than imported from
 * `slide/plan.ts` for the reason {@link CHUTE_HALF_WIDTH} is: importing the
 * number the generator aimed at would prove only that it can reach its own
 * target, and this file's job is to measure the park that was built.
 */
const CRUISER_AIR_REQUIRED = 5.5;

/**
 * Half-width of the Sky Cruiser's cart, as built: `CART_BODY_WIDTH` is 1.5 m.
 *
 * Stated rather than imported for the same reason as {@link CHUTE_HALF_WIDTH} —
 * and unlike the chute's, this one is a *body* whose width is what sweeps past,
 * so it is the right thing to add to the chute's half-width to ask whether two
 * solids overlap rather than two centre lines.
 */
const CART_HALF_WIDTH = 0.75;

/**
 * **The ginormous slide keeps its air from the Sky Cruiser.**
 *
 * The chute crosses the cruiser's loop shortly after leaving the parapet and
 * passes over the top of it — about 4 m of clearance is the whole reason the
 * route is solvable at all, because at ground level there is roughly 2 m between
 * the castle's east wall and the cruiser and the chute is 3.4 m wide.
 *
 * **This existed only as a throw at module load until 5 August 2026, which is
 * why it is here now.** The slide's height at a point is a function of how far
 * along it that point is *as a fraction of the whole*, and the whole is not
 * known until the route is solved — so the search runs on an assumed length and
 * `planSlide` iterates. That loop used to fall out of its pass limit and use the
 * last route regardless, whose clearance had been checked against a different
 * length's height profile. On seed 11, once #213 moved the cruiser, it built a
 * 64.4 m ride from a search that had verified an 86 m one, and put the chute
 * 1.15 m inside the cruiser's air at a spot the search had checked and passed.
 *
 * The failure mode is what matters here: it surfaced as the **whole park
 * failing to construct**, because a module-load throw takes everything with it,
 * and every other invariant for that seed reported "skipped" rather than
 * "failed". A geometric fact about two rides belongs where a geometric fact
 * about two rides is checked, on every seed, saying which two things are how
 * close.
 *
 * Measured on the built chute against the built coaster curve — neither is the
 * plan either of them was solved from.
 */
const theSlideKeepsItsAirFromTheCruiser: Invariant = (facts) => {
  const chute = facts.slideChute;
  if (chute.length === 0) return ['the ginormous slide has no chute to measure against the cruiser'];

  const cruiser = facts.world.coaster.route;
  let worst = Infinity;
  let worstAt: readonly [number, number, number] | null = null;
  let worstNear: { x: number; y: number; z: number } | null = null;

  for (const point of chute) {
    const near = cruiser.nearestPoint(point[0], point[2]);
    // Only somewhere the two actually overlap in plan view can foul at all.
    // Half the chute plus half the cart's envelope, so it is the solids being
    // compared rather than two centre lines.
    if (Math.hypot(near.x - point[0], near.z - point[2]) > CHUTE_HALF_WIDTH + CART_HALF_WIDTH) {
      continue;
    }
    const vertical = Math.abs(near.y - point[1]);
    if (vertical < worst) {
      worst = vertical;
      worstAt = point;
      worstNear = { x: near.x, y: near.y, z: near.z };
    }
  }

  if (!worstAt || !worstNear || worst >= CRUISER_AIR_REQUIRED) return [];
  return [
    `the ginormous slide passes ${worst.toFixed(2)} m from the Sky Cruiser, against ` +
      `${CRUISER_AIR_REQUIRED} m required — chute at ${fmt([worstAt[0], worstAt[2]])} ` +
      `y ${worstAt[1].toFixed(2)}, cruiser at ${fmt([worstNear.x, worstNear.z])} ` +
      `y ${worstNear.y.toFixed(2)}`,
  ];
};

/**
 * **Every park's Sky Cruiser flies through the castle, not round it.**
 *
 * The family asked for the ride to go *through* the building, and for a while
 * it only usually did. The generator returns the **first** route that fits, not
 * the best one, and nothing was asking it for a crossing — so on one CI seed in
 * five the loop simply closed before it got there, and that child got an
 * ordinary circuit and an unbroken castle. Nothing was broken; nothing had been
 * requested.
 *
 * It is requested now, in two parts, and this invariant is what holds them to
 * it. `coaster/route.ts` declares a {@link RouteInfluence} at the castle, which
 * biases the choice *at the decision point* and does the actual work; and a
 * `satisfies` backstop discards a solved route with no crossing. Measured
 * across these five seeds, the backstop fires **twice** — the weighting is
 * carrying the feature and the backstop is insurance, which is the balance
 * wanted. If this ever goes red the honest first question is which of the two
 * stopped working.
 *
 * **Deliberately measured on the built curve, not on the solver's report.**
 * `route.castleSpan` is re-derived from the finished `CatmullRomCurve3`, which
 * is a rebuild of the plan and not a copy of it — the plan runs about 1.5%
 * short, and treating one as the other already silently cost a window once.
 * Asking the report whether it was satisfied would be asking the generator to
 * mark its own homework.
 *
 * **It does not assert that space was reserved, because none is** (Decision 6).
 * The opening is still cut wherever the route actually crosses; this asserts
 * the crossing happened, never that anything was held open for it.
 */
const skyCruiserAlwaysFliesThroughTheCastle: Invariant = (facts) => {
  const route = facts.world.coaster.route;
  if (route.castleSpan) return [];
  return [
    'the Sky Cruiser never enters the castle on this seed — the loop closed ' +
      'without crossing it, so no windows were cut and the castle is whole. ' +
      'The family asked that the ride always flies through it: check the ' +
      "castle influence's weight and the `satisfies` backstop in coaster/route.ts",
  ];
};

/**
 * The tallest **seated** child the park can build, measured once per fork.
 *
 * Every hair style crossed with every hat, on **real models**, attached the way
 * `WornHat` and `NpcSystem.buildIndividualAvatar` attach them — `hatAnchor.add`
 * at the hat's own natural scale, which is also exactly what the shop
 * catalogue's `model()` hands over. Styles that hide a hat (`hairHidesHat` —
 * mohican's crest) are measured bare, because that is what they render as.
 * Posed through the game's real `applyRidePose('seated')` before measuring,
 * exactly as `Player.animate` and (since 2026-08-23) `NpcCharacter.animate`
 * pose a train rider — a check that re-implements a pose is a check that can
 * pass a pose the game never renders. Guards `TALLEST_CHILD_SEATED_HEIGHT`
 * (`kid.ts`) — see that constant's own note for why sitting on this no-knee
 * rig saves a real but small amount, not half of standing.
 *
 * Lazy rather than at module load, because `createKid` wants the headless
 * canvas shim and that arrives with `buildParkFacts`. ~0.5 s per fork.
 */
let tallestSeatedChildMeasured: { height: number; what: string } | null = null;

function measureTallestSeatedChild(): { height: number; what: string } {
  if (tallestSeatedChildMeasured) return tallestSeatedChildMeasured;
  let height = 0;
  let what = '';
  const pose = (kid: ReturnType<typeof createKid>) =>
    applyRidePose({ root: kid.root, body: kid.body, head: kid.head, ...kid.limbs! }, 0, 0, 'seated');
  for (const style of HAIR_STYLES) {
    const bare = createKid({ hairStyle: style });
    pose(bare);
    const bareTop = visibleTop(bare.root);
    if (bareTop > height) {
      height = bareTop;
      what = `${style}, bare-headed, seated`;
    }
    if (bare.hairHidesHat) continue;
    for (const kind of HAT_KINDS) {
      const kid = createKid({ hairStyle: style });
      kid.hatAnchor.add(createHat(kind).root);
      kid.setHatWorn(true);
      pose(kid);
      const top = visibleTop(kid.root);
      if (top > height) {
        height = top;
        what = `${style} hair + ${kind} hat, seated`;
      }
    }
  }
  tallestSeatedChildMeasured = { height, what };
  return tallestSeatedChildMeasured;
}

/**
 * **Nothing built over the railway may touch the train — or anyone riding it.**
 *
 * This exists because the constant that was *supposed* to mean that did not.
 * `trainModel.ts` exported `LOCO_TOP_Y`, documented as "the tallest point of the
 * whole train" and "the number anything built over the railway has to clear",
 * and it was the funnel tip — **the locomotive's bodywork, on a train that
 * carries passengers who are taller than the funnel.** A bridge deck derived
 * from it put its soffit at exactly 2.42 m: zero margin for Puffing Percy, and
 * between a quarter and three quarters of a metre *inside* the children behind
 * her. The whole point of PR #220 was to stop clearance being a claim, so the
 * claim now gets measured.
 *
 * Three measurements, all off things that were actually built:
 *
 * 1. **The locomotive's real bodywork**, `visibleTop` on the built car groups
 *    found by name in `world.train.group` — not recomputed from the constants
 *    that positioned them. `LOCO_BODY_TOP_Y` has to cover what is really there.
 *    (The station canopies live in that same group and are deliberately skipped:
 *    they stand beside the line, they do not travel it.)
 * 2. **The tallest child the park can build, seated** — hair × hats, real
 *    models, posed through the game's own `applyRidePose('seated')` — see
 *    {@link measureTallestSeatedChild}. `TALLEST_CHILD_SEATED_HEIGHT` has to
 *    cover it, so adding a taller hat turns this red instead of quietly
 *    lowering a bridge.
 * 3. **Where riders actually are.** Both riders sit now (2026-08-23, Jim,
 *    resolving Decision 8's open question): `ParkTrain.carryPassengers`
 *    folds `applyRidePose('seated')` onto whoever it carries
 *    (`NpcCharacter.animate`), and `ParkTrain.updateRider` seats the player
 *    with her feet on the carriage floor (`CAR_FLOOR_Y`) rather than the
 *    bench — the same reference an NPC rider uses. One rider term, not two.
 *
 * Then `TRAIN_CLEARANCE_Y` — the published number, from `train/clearance.ts` —
 * is checked against that measured worst case. This is `railRaceFliesClear`'s
 * pattern exactly: measure the built thing, compare it against the number the
 * game publishes, and never against the arithmetic that produced it.
 *
 * **Seed-independent by construction**, and kept here rather than in
 * `check:park` on purpose: it costs nothing extra to run on five seeds, and it
 * is the file CLAUDE.md sends anyone changing procgen to. When #116 lands a real
 * deck, the deck's own surfaces get measured against `TRAIN_CLEARANCE_Y` here
 * too — the constant this guards is the one they will be built from.
 */
const railwayClearanceCoversTheTrainAndItsRiders: Invariant = (facts) => {
  const complaints: string[] = [];

  // --- 1. the built locomotive and carriages -------------------------------
  let builtBodyTop = 0;
  let builtBodyWhat = '';
  for (const child of facts.world.train.group.children) {
    const name = child.name;
    if (name !== 'train-locomotive' && !name.startsWith('train-carriage')) continue;
    const top = visibleTop(child);
    if (top > builtBodyTop) {
      builtBodyTop = top;
      builtBodyWhat = name;
    }
  }
  if (builtBodyWhat === '') {
    complaints.push(
      'no locomotive or carriage in the built train group to measure — the car ' +
        'names in trainModel.ts have changed and this invariant is measuring nothing',
    );
    return complaints;
  }
  if (builtBodyTop > LOCO_BODY_TOP_Y) {
    complaints.push(
      `LOCO_BODY_TOP_Y is ${LOCO_BODY_TOP_Y.toFixed(2)} m but the built ` +
        `${builtBodyWhat} reaches ${builtBodyTop.toFixed(2)} m — the constant no ` +
        'longer covers the bodywork it is meant to describe',
    );
  }

  // --- 2. the tallest child the park can build, seated ----------------------
  const child = measureTallestSeatedChild();
  if (child.height > TALLEST_CHILD_SEATED_HEIGHT) {
    complaints.push(
      `TALLEST_CHILD_SEATED_HEIGHT is ${TALLEST_CHILD_SEATED_HEIGHT.toFixed(2)} m ` +
        `but a real ${child.what} measures ${child.height.toFixed(3)} m — raise ` +
        'the constant in kid.ts, because train/clearance.ts sizes a bridge from it',
    );
  }

  // --- 3. does the published clearance cover all of that? -------------------
  //
  // Measured child, not the constant, so a stale constant cannot hide a real
  // rider: this stays honest even if the complaint above is the one that fires.
  // Both riders' feet are on the carriage floor now (see the header), so
  // there is one rider term rather than a `Math.max` across two poses.
  const riderTop = CAR_FLOOR_Y + child.height;
  const sweptTop = Math.max(builtBodyTop, riderTop);
  if (TRAIN_CLEARANCE_Y < sweptTop) {
    const intrusion = sweptTop - TRAIN_CLEARANCE_Y;
    complaints.push(
      `TRAIN_CLEARANCE_Y is ${TRAIN_CLEARANCE_Y.toFixed(2)} m but the train sweeps ` +
        `to ${sweptTop.toFixed(2)} m — anything built to that clearance sits ` +
        `${intrusion.toFixed(2)} m inside it. Worst: ` +
        `built ${builtBodyWhat} ${builtBodyTop.toFixed(2)}, seated rider ` +
        `${riderTop.toFixed(2)} (${child.what})`,
    );
  } else if (TRAIN_CLEARANCE_Y - sweptTop < RIDER_HEADROOM) {
    // Not "is the arithmetic right" — the swept top here is *measured*, so this
    // catches the geometry growing into headroom that the constants still think
    // is there.
    complaints.push(
      `only ${(TRAIN_CLEARANCE_Y - sweptTop).toFixed(2)} m of measured headroom ` +
        `over the train, against the ${RIDER_HEADROOM.toFixed(2)} m ` +
        'train/clearance.ts believes it is leaving',
    );
  }

  // --- 4. every real bridge deck, over the ground it actually stands over ---
  //
  // The promise this file's own header made when #116 was still open: measure
  // the *built* deck, not `BRIDGE_RISE` (which already has `BRIDGE_DECK_DEPTH`,
  // a stated claim rather than a derivation, baked into it) and not
  // `bridge.deckY` restated — the mesh's own lowest visible vertex, the same
  // way builtBodyTop above is the locomotive's.
  //
  // The ground reference is the *route's own* Y at the crossing — the same
  // "ground under the track" `check-park.mts`'s invariant 2 calls `hit.rail`
  // — never `WalkSurfaces.sample`. A station platform is a `MovingPlatform`
  // too, and `sample`'s "highest surface within a step" rule happily answers
  // with a *platform's* height for a crossing that merely stands near one:
  // measured live, a crossing 3.6 m from a station read 0.58 m of phantom
  // extra ground, understating real clearance by exactly that much (issue
  // #116). The route was solved against the same terrain the deck's own
  // height is built from, so it is ground either way — just never a
  // platform's.
  const clearancePoint = new Vector3();
  for (const crossing of facts.world.train.crossings) {
    // Every crossing carries a bridge now — the level fallback died with
    // the tier (2 Sep 2026), so nothing is skipped here.
    // The same name `bridges.ts` builds this crossing's own group under —
    // one owner (the crossing's own `railDistance`) for both.
    const deckMesh = facts.world.train.group.getObjectByName(
      `bridge-${crossing.railDistance.toFixed(1)}`,
    )?.getObjectByName('deck');
    if (!deckMesh) {
      complaints.push(
        `the crossing at (${fmt([crossing.x, crossing.z])}) has no built bridge deck to measure`,
      );
      continue;
    }
    const soffit = new Box3().setFromObject(deckMesh).min.y;
    const route = facts.world.train.route;
    route.pointAt(route.distanceNear(crossing.x, crossing.z), clearancePoint);
    const groundY = clearancePoint.y;
    const clearance = soffit - groundY;
    if (clearance < TRAIN_CLEARANCE_Y) {
      complaints.push(
        `the bridge deck at (${fmt([crossing.x, crossing.z])}) leaves only ` +
          `${clearance.toFixed(2)} m under its own built soffit, against the ` +
          `${TRAIN_CLEARANCE_Y.toFixed(2)} m the train and its riders sweep to`,
      );
    }
  }

  return complaints;
};

/**
 * Every railway crossing's bridge is genuinely walkable and genuinely
 * reachable (issue #116, Decision 8) — measured against the real, built
 * bridge and the real nav lattice, never against the plan that placed
 * either.
 *
 * Three questions, in the order a child would meet them:
 *
 * 1. **Does a route from the entrance actually reach the deck?** The exact
 *    question `check:park`'s invariant 1 asks of every attraction, asked
 *    here of every bridge, at the deck's own height (`reachableFromEntrance`'s
 *    `goalY` — a ground-level probe would find nothing there at all, which
 *    is the whole point of a bridge over a level crossing).
 * 2. **Is the deck itself standable**, at the height a walker on it really
 *    stands at? A ground-level probe passing here would prove nothing: it
 *    is exactly the question a level crossing's own probe used to ask, and
 *    exactly what this feature retired.
 * 3. **Is each ramp standable partway down its own slope?** — proving the
 *    climb itself is walkable, not just its two ends, which is where
 *    #116's own ramp-flank guard rails (since removed) once wedged a
 *    routable edge without ever touching the deck or the ground.
 */
/**
 * **The masonry a bridge really builds leaves the train its air — measured by
 * firing rays up at it from the rail, not by reading a marker.**
 *
 * The sibling invariant above measures the invisible box named `deck`. That box
 * is a *claim*: `bridges.ts` positions it at what it believes the tightest point
 * of its own arch is. Until 2026-08-29 the two were trivially the same thing,
 * because the soffit over the train was flat. It is now a genuine three-centred
 * arch (`bridgeStonework.ts`), so the soffit *varies* across the span the train
 * uses, the marker sits at one particular height on that curve, and "is the
 * marker in the right place on the curve" became a real question that a marker
 * cannot answer about itself.
 *
 * Worse, the bridge has since grown modelled stone — a voussoir ring round each
 * mouth, imposts at the springings, coping on the parapets, courses on the
 * flank. Every one of those is placed by a formula, every one is new, and not
 * one of them is described by the `deck` box at all. A stone hung a little too
 * far into the opening would be invisible to every check in this file.
 *
 * So this asks the geometry instead. From under the rail, at points across the
 * train's own swept width, it fires a ray **straight up** and looks at what it
 * hits first. That first hit is the real underside of the bridge at that point —
 * arch barrel, spandrel, or a voussoir that should not be there. If it is
 * lower than `TRAIN_CLEARANCE_Y` over the ground, the train hits it.
 *
 * The ray is the technique CLAUDE.md records from the hood-face bug, used the
 * other way round: there, casting a ray in from outside proved a mesh was never
 * being drawn. Here it proves what is really overhead, on a mesh nobody can
 * measure by reading, and it is the only kind of check that could have caught
 * the wedge of daylight and the bars-across-the-tunnel that this geometry has
 * already produced twice while looking correct in code.
 *
 * Jim's own acceptance test for the redesign was one sentence — *"there should
 * be just a bridge with nothing clipping inside it"* — and this is the half of
 * it that points at the tunnel.
 */
const nothingHangsIntoTheTunnel: Invariant = (facts) => {
  const complaints: string[] = [];
  const raycaster = new Raycaster();
  const from = new Vector3();
  const here = new Vector3();
  const ahead = new Vector3();
  const up = new Vector3(0, 1, 0);
  let bridgesTested = 0;

  const route = facts.world.train.route;

  for (const crossing of facts.world.train.crossings) {
    const group = facts.world.train.group.getObjectByName(
      `bridge-${crossing.railDistance.toFixed(1)}`,
    );
    if (!group) continue;
    bridgesTested += 1;

    let worst = Infinity;
    let worstAt = '';
    const centre = route.distanceNear(crossing.x, crossing.z);
    // Along the rail, through the whole tunnel and a stride past each mouth,
    // so a stone hung just inside a mouth is inside the sampled range.
    for (let d = -4.0; d <= 4.0 + 1e-6; d += 0.4) {
      route.pointAt(centre + d, here);
      route.pointAt(centre + d + 0.1, ahead);
      let tx = ahead.x - here.x;
      let tz = ahead.z - here.z;
      const norm = Math.hypot(tx, tz) || 1;
      tx /= norm;
      tz /= norm;
      // Across the train's own swept half-width — the same `TRACK_CLEARANCE`
      // the rest of this file measures rail clearance with, never a figure of
      // this invariant's own.
      for (let across = -TRACK_CLEARANCE; across <= TRACK_CLEARANCE + 1e-6; across += 0.325) {
        const x = here.x + -tz * across;
        const z = here.z + tx * across;
        const ground = here.y;
        from.set(x, ground + 0.05, z);
        raycaster.set(from, up);
        raycaster.far = 40;
        const hits = raycaster.intersectObject(group, true);
        // `deck` is the invisible marker, and `intersectObject` does not care
        // about `.visible` — skipping it is the whole point of measuring the
        // drawn stone instead of the claim.
        const hit = hits.find((candidate) => candidate.object.name !== 'deck');
        if (!hit) continue;
        const air = hit.point.y - ground;
        if (air < worst) {
          worst = air;
          worstAt = `${hit.object.name || 'unnamed mesh'} at (${fmt([x, z])})`;
        }
      }
    }

    if (worst === Infinity) {
      complaints.push(
        `no bridge masonry at all overhead anywhere along the rail under ` +
          `bridge-${crossing.railDistance.toFixed(1)} — a ray fired up from the ` +
          'track hit nothing, so either the bridge is not over its own crossing ' +
          'or this invariant is measuring the wrong group',
      );
      continue;
    }
    if (worst < TRAIN_CLEARANCE_Y) {
      complaints.push(
        `bridge-${crossing.railDistance.toFixed(1)} leaves only ${worst.toFixed(2)} m ` +
          `of air over the rail against the ${TRAIN_CLEARANCE_Y.toFixed(2)} m the train ` +
          `and its riders sweep to — lowest built stone is ${worstAt}`,
      );
    }
  }

  if (bridgesTested === 0) {
    complaints.push(
      'no bridge was tested — every crossing on this seed fell back to a level ' +
        'crossing, or the built group names have changed, so this invariant proved nothing',
    );
  }

  return complaints;
};

/**
 * **Every modelled coping stone sits on the wall it caps — no stone floating
 * over a gap, none sunk into the parapet, none hanging off the end of it.**
 *
 * The coping is authored geometry repeated along a line by a formula
 * (`bridgeStonework.ts`'s `buildCopingRun`), and the formula samples the
 * parapet's height at each block's *centre* while the block itself is 0.86 m
 * long. On a ramp at peak grade that is a real hazard: the ends can lift off
 * what the centre was measured against. It also has to stop cleanly where the
 * parapet tapers out at a ramp foot, and "stop cleanly" is precisely the sort
 * of edge that is one `<=` away from leaving a stone in mid-air.
 *
 * **Measured by plan projection, not by a ray, and that is the point.** A
 * downward ray only reports a surface whose normals face the ray, so against a
 * single-sided shell it can come back empty on perfectly good geometry and
 * `!hit` reads identically to "nothing there" — a check that cannot fail is
 * this file's oldest recorded disease, and peer review of PR #360 correctly
 * called an earlier raycast on this exact question *inconclusive* rather than
 * passing. So this drops each coping vertex onto the `wallTop` mesh's own
 * triangles in plan and reads the height off barycentrically: no normals
 * involved, no material side, and a vertex over no triangle at all is a
 * complaint rather than a silent skip.
 *
 * Jim's acceptance test for the redesign was *"there should be just a bridge
 * with nothing clipping inside it"*. `nothingHangsIntoTheTunnel` is the half of
 * that pointing at the tunnel; this is the half pointing at the parapet.
 */
const everyCopingStoneSitsOnItsWall: Invariant = (facts) => {
  const complaints: string[] = [];
  let bridgesTested = 0;

  for (const crossing of facts.world.train.crossings) {
    const group = facts.world.train.group.getObjectByName(
      `bridge-${crossing.railDistance.toFixed(1)}`,
    );
    if (!group) continue;
    const coping = group.getObjectByName('coping');
    const wallTop = group.getObjectByName('wallTop');
    if (!(coping instanceof Mesh) || !(wallTop instanceof Mesh)) {
      complaints.push(
        `bridge-${crossing.railDistance.toFixed(1)} is missing its 'coping' or ` +
          "'wallTop' mesh — the names bridges.ts builds them under have changed " +
          'and this invariant is measuring nothing',
      );
      continue;
    }
    bridgesTested += 1;

    // The parapet's own top face, as plan triangles with their heights.
    const top = wallTop.geometry;
    const topPos = top.getAttribute('position');
    const topIndex = top.getIndex();
    if (!topPos || !topIndex) continue;

    /** Height of the parapet's top face at `(x, z)`, or null if not over it. */
    const wallTopAt = (x: number, z: number): number | null => {
      for (let t = 0; t < topIndex.count; t += 3) {
        const ia = topIndex.getX(t);
        const ib = topIndex.getX(t + 1);
        const ic = topIndex.getX(t + 2);
        const ax = topPos.getX(ia);
        const az = topPos.getZ(ia);
        const bx = topPos.getX(ib);
        const bz = topPos.getZ(ib);
        const cx = topPos.getX(ic);
        const cz = topPos.getZ(ic);
        const area = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(area) < 1e-12) continue;
        const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / area;
        const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / area;
        const w = 1 - u - v;
        if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
        return u * topPos.getY(ia) + v * topPos.getY(ib) + w * topPos.getY(ic);
      }
      return null;
    };

    const copingPos = coping.geometry.getAttribute('position');
    if (!copingPos) continue;

    // **Measure each block's base, not every vertex.** A coping block is
    // tilted onto the local grade, and near a ramp foot the parapet's own top
    // line is very steep indeed — the wall is collapsing through its taper
    // while the road merely descends. Comparing a *tilted block's top face*
    // against the wall vertically beneath it therefore reads high by up to
    // 0.12 m on perfectly seated stone: the top face is displaced along the
    // slope, so it is over wall that is lower than the wall its own base sits
    // on. That is trigonometry, not daylight. The base is the honest question,
    // and it is exact: a seated block's lowest vertices sit `COPING_SINK`
    // below the drawn top, to the millimetre.
    const perBlock = bridgeStoneGeometry('coping').getAttribute('position')?.count ?? 0;
    if (perBlock === 0 || copingPos.count % perBlock !== 0) {
      complaints.push(
        `bridge-${crossing.railDistance.toFixed(1)}: its coping mesh has ` +
          `${copingPos.count} vertices, not a whole number of ${perBlock}-vertex ` +
          'authored blocks — the bake has changed shape and this is measuring nothing',
      );
      continue;
    }

    const tolerance = 0.02;
    let worstFloat = 0;
    let worstAt = '';
    let floating = 0;
    let offWall = 0;
    const blocks = copingPos.count / perBlock;
    for (let block = 0; block < blocks; block += 1) {
      // **The centre of the block's base face**, not a corner of it. A corner
      // sits on the very edge of the parapet-top quad it belongs to, so on a
      // curving spine the plan projection can land it on the *neighbouring*
      // quad instead — which is at a slightly different height, and reads as a
      // 3 cm error on a stone that is in fact seated perfectly (measured, seed
      // 5, one block of eighty). The base centre is mid-quad and on the wall
      // line, so it belongs to exactly one triangle and there is nothing to
      // straddle. Loosening the tolerance instead would have been this file's
      // own forbidden move: never weaken an assertion to make a seed pass.
      let lowest = Infinity;
      for (let k = 0; k < perBlock; k += 1) {
        lowest = Math.min(lowest, copingPos.getY(block * perBlock + k));
      }
      let x = 0;
      let z = 0;
      let onBase = 0;
      for (let k = 0; k < perBlock; k += 1) {
        const i = block * perBlock + k;
        if (copingPos.getY(i) - lowest > 1e-3) continue;
        x += copingPos.getX(i);
        z += copingPos.getZ(i);
        onBase += 1;
      }
      if (onBase === 0) continue;
      x /= onBase;
      z /= onBase;

      const surface = wallTopAt(x, z);
      if (surface === null) {
        offWall += 1;
        continue;
      }
      // Seated means exactly `COPING_SINK` below the drawn top. Above that is
      // a floating stone; well below it is a stone buried in its own wall.
      const gap = lowest - (surface - COPING_SINK);
      if (Math.abs(gap) > tolerance) {
        floating += 1;
        if (Math.abs(gap) > Math.abs(worstFloat)) {
          worstFloat = gap;
          worstAt = `(${fmt([x, z])})`;
        }
      }
    }

    if (floating > 0) {
      complaints.push(
        `bridge-${crossing.railDistance.toFixed(1)}: ${floating} of its ${blocks} coping ` +
          `blocks are not seated on their own parapet — worst is ${worstFloat.toFixed(3)} m ` +
          `${worstFloat > 0 ? 'above' : 'below'} where it should sit, at ${worstAt}. ` +
          'A coping block should rest exactly COPING_SINK below the drawn wall top.',
      );
    }
    if (offWall > 0) {
      complaints.push(
        `bridge-${crossing.railDistance.toFixed(1)}: ${offWall} of its ${blocks} coping ` +
          'blocks sit over no parapet top at all — the run has walked off the wall it caps',
      );
    }
  }

  if (bridgesTested === 0) {
    complaints.push(
      'no bridge coping was tested — every crossing on this seed fell back to a ' +
        'level crossing, or the built mesh names have changed, so this proved nothing',
    );
  }

  return complaints;
};

/**
 * **You cannot see through a bridge's parapet.** Issue #489.
 *
 * Jim, 3 September 2026, standing on one: *"bridges have a hole in them and
 * their near side, above the arch where some of the wall is missing"*. The
 * coursed outer face was clamped to the height of the ROAD's crown while the
 * wall carried on up to the parapet top, `PARAPET_HEIGHT + PARAPET_CROWN_LIFT`
 * higher — a 1.17 m band with no outer face on it, on every bridge of every
 * seed. The inner face and the `wallTop` cap were drawn full height and are
 * single-sided, so the camera looked straight through to the grass beyond.
 *
 * **Why a ray and not an arithmetic check.** Nothing derives the drawn face
 * from the wall it is meant to be facing — they are two lists of vertices kept
 * together on purpose — so the only honest question is the player's own: point
 * a camera at the wall and see whether stone stops it. A check that recomputed
 * the course levels would have agreed with the bug, because the bug *was* the
 * course levels.
 *
 * **Its control is built in, and is the reason it cannot pass vacuously.**
 * Each sample fires two rays: one inward at the outer face, one outward from
 * over the roadway at the same wall's inner face. Only samples whose inner ray
 * hits — proof there is masonry at that height — are judged at all. A ray at
 * the wrong height, on the wrong ring or along the wrong normal misses both,
 * and is counted as untested rather than as a pass. The count of judged samples
 * is announced on every run, so "it tested nothing" cannot look like "it found
 * nothing".
 *
 * Two things it deliberately does not flag, both taken from the game rather
 * than from a figure of its own:
 *
 * - Rings below `bridges.ts`'s `PARAPET_GONE_HUMP` (`ParkFacts`'s
 *   `expected: false`), where `parapetHeightFor` removes the wall on purpose
 *   so a wing wall does not sever the path junction a ramp foot lands in.
 * - Ring points themselves. The wall is drawn as chords between rings while the
 *   ring points sit on the arc, so a ray aimed at a ring along its own normal
 *   passes outside both chords and reports a hole in solid stone — the same
 *   fact `ShellGeometry.planEdge` exists for. Samples are taken at the middle
 *   of each face. Measured, probing at rings invented see-through on 9 of 23
 *   bridges and all of it vanished at face middles.
 */
const noBridgeParapetCanBeSeenThrough: Invariant = (facts) => {
  const complaints: string[] = [];
  const raycaster = new Raycaster();
  const from = new Vector3();
  const direction = new Vector3();

  /** How far outside the masonry the probing ray starts. */
  const STANDOFF = 3.0;
  /** How far in over the roadway the control ray starts. */
  const INNER_STANDOFF = 1.2;
  const HIT_SLACK = 0.25;
  const PROBE_STEP = 0.05;
  const PROBE_BOTTOM = 1.5;

  const groups = new Map<string, Object3D>();
  for (const crossing of facts.world.train.crossings) {
    // #493 skipped `fallbackCrossings` here — the crossings that carried no
    // bridge because the planner had fallen back to a level crossing. That tier
    // is deleted (2 Sep 2026): every crossing carries a bridge or the build
    // throws, so there is nothing left to excuse and the exemption is gone
    // rather than reinstated under a new name.
    const name = `bridge-${crossing.railDistance.toFixed(1)}`;
    const group = facts.world.train.group.getObjectByName(name);
    if (group) groups.set(name, group);
  }

  const rings = facts.bridgeParapetRings;
  let judged = 0;
  /** Which bridges actually contributed a judged sample — not which exist. */
  const covered = new Set<string>();
  const seeThrough = new Map<string, { count: number; worst: number; at: string }>();

  for (let i = 0; i + 1 < rings.length; i += 1) {
    const a = rings[i] as (typeof rings)[number];
    // `parkFacts` writes side 0 then side 1 for each ring, so one flank's face
    // joins entries **two** apart — same parity, therefore same side — and a
    // differing bridge name is what marks the end of a bridge's run.
    const next = rings[i + 2] as (typeof rings)[number] | undefined;
    if (!next || next.bridge !== a.bridge) continue;
    if (!a.expected || !next.expected) continue;
    const group = groups.get(a.bridge);
    if (!group) continue;

    // The middle of the face between this ring and the next on the same flank.
    const ox = (a.outer[0] + next.outer[0]) / 2;
    const oz = (a.outer[1] + next.outer[1]) / 2;
    const ix = (a.inner[0] + next.inner[0]) / 2;
    const iz = (a.inner[1] + next.inner[1]) / 2;
    const top = (a.top + next.top) / 2;
    const nx = ox - ix;
    const nz = oz - iz;
    const norm = Math.hypot(nx, nz);
    if (norm < 1e-6) continue;
    const ux = nx / norm;
    const uz = nz / norm;

    const faceHit = (): boolean =>
      raycaster
        .intersectObject(group, true)
        .some((candidate) => candidate.object.name !== 'deck');

    let runFrom: number | null = null;
    let runTo = 0;
    const closeRun = (): void => {
      if (runFrom === null) return;
      const band = runTo - runFrom + PROBE_STEP;
      const found = seeThrough.get(a.bridge) ?? { count: 0, worst: 0, at: '' };
      if (band > found.worst) {
        found.worst = band;
        found.at = `(${ox.toFixed(1)}, ${oz.toFixed(1)}), ${runFrom.toFixed(2)}–${runTo.toFixed(2)} m below the top`;
      }
      seeThrough.set(a.bridge, found);
      runFrom = null;
    };

    for (let drop = 0.03; drop <= PROBE_BOTTOM + 1e-9; drop += PROBE_STEP) {
      const y = top - drop;

      // The control: is there any wall here at all?
      direction.set(ux, 0, uz);
      from.set(ix - ux * INNER_STANDOFF, y, iz - uz * INNER_STANDOFF);
      raycaster.set(from, direction);
      raycaster.far = INNER_STANDOFF + norm + HIT_SLACK;
      if (!faceHit()) {
        closeRun();
        continue;
      }

      // The probe: can it be seen through?
      direction.set(-ux, 0, -uz);
      from.set(ox + ux * STANDOFF, y, oz + uz * STANDOFF);
      raycaster.set(from, direction);
      raycaster.far = STANDOFF + HIT_SLACK;
      judged += 1;
      covered.add(a.bridge);
      if (faceHit()) {
        closeRun();
        continue;
      }
      const found = seeThrough.get(a.bridge) ?? { count: 0, worst: 0, at: '' };
      found.count += 1;
      seeThrough.set(a.bridge, found);
      if (runFrom === null) runFrom = drop;
      runTo = drop;
    }
    closeRun();
  }

  for (const [bridge, found] of seeThrough) {
    complaints.push(
      `${bridge}: ${found.count} places on its parapet have masonry at that height ` +
        `but no outer face on it — you see straight through the wall to the park ` +
        `beyond. Worst run ${found.worst.toFixed(2)} m at ${found.at}. The drawn ` +
        'outer face must reach the top of the wall it is facing (#489).',
    );
  }

  // A green line that implies cover it does not give is how the next agent
  // inherits a false belief — stderr, because vitest hides console output from
  // passing tests, which is exactly the run this note exists for.
  if (judged === 0) {
    complaints.push(
      'no bridge parapet was probed — every crossing on this seed fell back to a ' +
        'level crossing, or the built mesh names have changed, so this asserts nothing',
    );
  } else {
    // **`covered.size`, never `groups.size`.** The first is how many bridges
    // this actually judged a sample on; the second is how many exist. Reporting
    // the second means losing cover on *some* bridges — a renamed mesh on one,
    // a flank whose rings all read as tapered — says nothing at all, because
    // only total-zero trips the clause above. Naming the uncovered ones is the
    // difference between a note that can warn you and one that cannot.
    const missing = [...groups.keys()].filter((name) => !covered.has(name));
    process.stderr.write(
      `noBridgeParapetCanBeSeenThrough: judged ${judged} samples across ` +
        `${covered.size} of ${groups.size} bridge(s) on seed ${facts.seed}` +
        (missing.length > 0
          ? ` — NO SAMPLE JUDGED on ${missing.join(', ')}, which this run therefore asserts nothing about`
          : '') +
        `\n`,
    );
  }

  return complaints;
};

const everyBridgeIsWalkableAndReachable: Invariant = (facts) => {
  const complaints: string[] = [];
  const probe = new Vector3();
  // The *tallest* bridge surface over `(x, z)`, never "the crossing's own
  // bridge" alone — two crossings close enough together can have one
  // bridge's ramp and a neighbour's much taller deck both genuinely cover
  // the same point (`bridges.ts`'s own `bridgeHeightAt` exists for exactly
  // this and every other caller uses it; this probe reimplements the same
  // rule locally rather than importing a module that reaches `paths.ts`
  // into a seed-sensitive test file — see this file's own header on static
  // imports). Asking the wrong bridge for its height here reproduced the
  // exact bug `bridgeHeightAt` was written to fix, just inside the checker
  // instead of the game.
  const heightAt = (x: number, z: number): number | null => {
    let best: number | null = null;
    for (const bridge of facts.world.train.bridges) {
      if (!bridge.covers(x, z)) continue;
      const height = bridge.heightAt(x, z);
      if (best === null || height > best) best = height;
    }
    return best;
  };
  const standableAt = (x: number, z: number, height: number): boolean => {
    probe.set(x, height, z);
    facts.world.collision.resolve(probe, PLAYER_RADIUS);
    return Math.hypot(probe.x - x, probe.z - z) < 1e-3;
  };

  for (const crossing of facts.world.train.crossings) {
    const bridge = facts.world.train.bridges.find((b) => b.deckCovers(crossing.x, crossing.z));
    if (!bridge) continue; // reported by railwayClearanceCoversTheTrainAndItsRiders above
    const deckHeight = heightAt(crossing.x, crossing.z) ?? bridge.deckY;
    // The bridge follows the drawn path's own centreline through the
    // crossing (its recorded spine — see `crossings.ts`), so every walk in
    // here follows the same line: a straight march along `pathDir` would
    // walk off the flank of a curved bridge mid-hump and read the drop off
    // its own side as "a step too tall". On a crossing with no spine (the
    // gate walk) the frame IS the straight line, unchanged.
    const frame = frameFor(crossing);

    if (!facts.reachableFromEntrance(crossing.x, crossing.z, deckHeight)) {
      complaints.push(
        `the bridge deck at (${fmt([crossing.x, crossing.z])}) is not reachable ` +
          'from the entrance on the real nav lattice',
      );
    }
    if (!standableAt(crossing.x, crossing.z, deckHeight)) {
      complaints.push(`the bridge deck at (${fmt([crossing.x, crossing.z])}) is not itself standable`);
    }

    // The deck's own real half-width, walked outward empirically off the
    // built `Bridge` (`deckCovers`) rather than re-imported from
    // `bridgeFootprint.ts`'s own `halfAcross` — that module reaches
    // `./plan` → `./route`/`../coaster/plan`, exactly the seed-dependent
    // static-import trap this file's header warns about, so it stays
    // unimported here the same as everywhere else in this function.
    // 0.25 m resolution, not the old 0.5 — a deck exactly as wide as its
    // own path (Jim, 2026-08-23) has a standable half-width well under a
    // metre, and a half-metre pitch would round it down to a figure the
    // sweep gate below reads as "too narrow to sweep".
    const WIDTH_STEP = 0.25;
    const at0 = frame.pointAt(0);
    let deckHalfAcross = 0;
    for (let w = WIDTH_STEP; w <= 15; w += WIDTH_STEP) {
      const x = crossing.x + at0.acrossX * w;
      const z = crossing.z + at0.acrossZ * w;
      if (!bridge.deckCovers(x, z)) break;
      deckHalfAcross = w;
    }

    // A point partway down each ramp — comfortably on the slope, clear of
    // both the deck and the ordinary ground the ramp joins, so a pass here
    // proves the climb itself rather than either end of it.
    //
    // **Walked to the ramp's own real, built length, never a fixed offset.**
    // A fixed `6 m` here used to fall straight off a short ramp — the deck's
    // own two extremes were measured for `everyBridgeIsWalkableAndReachable`
    // and it never reads the constant `bridgeFootprint.ts`'s `rampRunPos`/
    // `rampRunNeg` truncate down to, so for a ramp truncated shorter than
    // that (the gate-walk crossing on seeds 11/18: ~3.5–3.7 m; a boundary-
    // or plot-cramped ramp on other crossings) the probe landed off the far
    // end (`bridge.heightAt` returns `null` there) and this loop's own
    // `continue` read that as "nothing to probe" — exactly the review's
    // finding on PR #297: **invisible to this check, precisely for the two
    // hard cases it exists to catch.** Fixed by measuring the real ramp's
    // own reach off the *built* `Bridge` itself (`covers`/`deckCovers`),
    // never a re-import of the seed-sensitive planner that built it (this
    // file's own header on static imports of seed-dependent modules) —
    // walked outward from the crossing until `deckCovers` first lets go
    // (the deck's own real half-length, empirically, not the constant) and
    // then again until `covers` lets go (the ramp's own real far edge), so
    // the probe below is genuinely 90% of *this specific ramp's* built
    // length on *this specific side*, whatever `bridgeFootprint.ts` decided
    // it should be. A ramp side truncated to (near) nothing — the correct
    // answer on a side nothing ever walks, per that module's own note on
    // the gate-walk crossing's outward-facing side — has nothing real to
    // probe either, and is skipped for that reason now, not because the
    // probe missed it.
    const STEP = 0.5;
    for (const sign of [1, -1] as const) {
      let deckEdge = 0;
      for (let d = 0; d <= 6; d += STEP) {
        const p = frame.pointAt(d * sign);
        if (!bridge.deckCovers(p.x, p.z)) break;
        deckEdge = d;
      }

      // **Swept across the deck's own real width at this edge, not just
      // its centreline.** The centre-point check above only asks whether
      // the crossing's own track-centre point stands; a deck several
      // metres wide can have that centre clear while an edge, part-way
      // along its forward or backward face, is not. Found live extending
      // PR #297 round 4's width-sweep fix (which closed the identical gap
      // in `truncateForBoundary`'s ramp-length check) to
      // `bridgeFootprint.ts`'s own pass-1 deck-width loop: seed 18's
      // gate-walk crossing has `halfAcross` bottomed out at its hardcoded
      // 1 m floor, and every point along that deck's own forward edge is
      // still only 0.108–0.209 m from `GARDEN_PLAY_BOUNDARY` — real
      // collision pushback up to 0.505 m. Confirmed pre-existing
      // (identical numbers reproduce against `bridgeFootprint.ts` from
      // before that round's fix), not something the width-sweep fix
      // caused — filed as issue #317 rather than silently weakening this
      // check to let seed 18 pass, per this file's own "never weaken an
      // assertion to make a seed pass" rule.
      if (deckHalfAcross > 0.3) {
        for (const t of [-0.9, -0.45, 0, 0.45, 0.9]) {
          const edge = frame.pointAt(deckEdge * sign);
          const ex = edge.x + edge.acrossX * deckHalfAcross * t;
          const ez = edge.z + edge.acrossZ * deckHalfAcross * t;
          const eh = heightAt(ex, ez);
          if (eh === null) continue; // off the deck's own built extent — nothing to probe
          if (!standableAt(ex, ez, eh)) {
            complaints.push(
              `the bridge deck at (${fmt([crossing.x, crossing.z])}) is not standable at ` +
                `(${fmt([ex, ez])}) — ${(t * 100).toFixed(0)}% across its own ${(deckHalfAcross * 2).toFixed(1)} m ` +
                `width at the ${sign > 0 ? 'forward' : 'backward'} edge (see issue #317)`,
            );
          }
        }
      }

      let rampEdge = deckEdge;
      for (let d = deckEdge + STEP; d <= deckEdge + 25; d += STEP) {
        const p = frame.pointAt(d * sign);
        if (!bridge.covers(p.x, p.z)) break;
        rampEdge = d;
      }
      const rampReach = rampEdge - deckEdge;
      // A real failure, not a skip (found by real-browser QA on PR #330: a
      // `continue` here let three bridges on the canonical seed alone ship
      // with a sheer, `BRIDGE_RISE`-tall drop on one side — a 4.7–4.9 m
      // vertical face where the path ran straight into it — because the
      // exact bug this probe exists to catch also made it too short to
      // probe, and "nothing to probe" and "skip" read the same to a loop
      // that never distinguished them. `bridgeFootprint.ts`'s own search now
      // requires {@link WALKABLE_FLOOR} on BOTH sides of every deck it
      // accepts (see that constant's own note), so a real, built bridge
      // reaching this invariant should never have a side this cramped —
      // this is CLAUDE.md's own "break every check deliberately and watch it
      // go red" lesson: a floor that cannot fire on the exact case it was
      // named for is not a floor.
      if (rampReach < 1) {
        complaints.push(
          `the bridge at (${fmt([crossing.x, crossing.z])}) has no usable ramp on its ` +
            `${sign > 0 ? 'forward' : 'backward'} side — built reach ${rampReach.toFixed(2)} m, a sheer drop ` +
            `where the path runs straight into it`,
        );
        continue;
      }
      const probeAlong = deckEdge + rampReach * 0.9;

      // **Swept across the ramp's own real width, not just its
      // centreline** — the exact QA finding this round: PR #297,
      // canonical seed, the crossing at (12.64, 57.02) had its centreline
      // clearing `GARDEN_PLAY_BOUNDARY` by 0.418 m at the worst point
      // while its outer edge, `halfAcross` further across at the same
      // `along`, was still 1.385 m past it — real pushback 2.454 m — and
      // this loop's own single centreline probe had no way to see it.
      // `bridges.ts` carries the hump at one uniform standable width for
      // its whole length (no taper), so the same `deckHalfAcross` measured
      // off the deck above applies here too.
      for (const t of deckHalfAcross > 0.3 ? [-0.9, -0.45, 0, 0.45, 0.9] : [0]) {
        const probe = frame.pointAt(probeAlong * sign);
        const rx = probe.x + probe.acrossX * deckHalfAcross * t;
        const rz = probe.z + probe.acrossZ * deckHalfAcross * t;
        const rampHeight = heightAt(rx, rz);
        if (rampHeight === null) continue; // off the ramp's own built width at this t — nothing to probe
        if (!standableAt(rx, rz, rampHeight)) {
          complaints.push(
            `the ramp at (${fmt([rx, rz])}), ${probeAlong.toFixed(1)} m out from the crossing at ` +
              `(${fmt([crossing.x, crossing.z])}), ${(t * 100).toFixed(0)}% across its width — 90% of its real, ` +
              `built ${rampReach.toFixed(1)} m ramp reach on this side — is not standable`,
          );
        }
      }
    }
  }

  // --- ground-to-ground: the whole bridge, not just each ramp alone -------
  //
  // Everything above proves a real, built ramp reaches {@link WALKABLE_FLOOR}
  // on each side *taken separately* — it does not prove a child can actually
  // walk the bridge, ground to ground, without a step too tall to climb
  // hiding at the seam between two things that were each individually fine.
  // Real-browser QA on PR #330 found exactly that: a bridge whose two sides
  // each "reached" still dropped 4.72 m over 1.5 m at the deck/ramp join —
  // a 1.73 m single riser, nearly three times {@link BUILDING_STEP_UP}
  // (0.62 m, the real per-step limit a walking foot obeys — `NavGrid`'s own
  // `MAX_STEP`) — because nothing had ever walked the join itself as one
  // continuous line. This marches the bridge's own centreline from where
  // the real, built ramp meets the ground on one side, across, to where it
  // meets the ground on the other — `bridge.heightAt` blends all the way to
  // `terrainHeight` at each ramp's own far edge by construction (its own
  // header), so marching *to* that edge already reaches genuine ground
  // without needing to step past it — and fails on the first step too tall
  // to climb, never a `continue`, per this file's own "a check that cannot
  // fail" lesson (see the per-side probe above, same PR, same lesson: `if
  // (rampReach < 1) continue` let three sheer, ramp-less sides through
  // clean).
  //
  // **Bridges only, not a fallback (no-bridge) level crossing** — a level
  // crossing has nothing built to march across at all, and the only figure
  // that names its own extent (`crossing.halfGap`) is measured along the
  // *rail* (`crossings.ts`'s own note), not along `pathDirX`/`pathDirZ`
  // (this march's own axis, roughly perpendicular to the rail) — the two
  // are different quantities on different axes, and marching one crossing's
  // rail-axis spread out along its path-axis direction reaches well past
  // its own real, reserved corridor into ordinary park territory nothing
  // promises to keep clear (found live writing this check: it flagged
  // perfectly ordinary trees and lamps 6–8 m out from three fallback
  // crossings on the canonical seed as "not standable", which they
  // genuinely are not, and never needed to be — ordinary scatter, not a
  // crossing bug). A fallback crossing's own real walkability is
  // `check-park.mts`'s job (`route.unreachable`, hard-gated), which routes
  // it on the real nav lattice rather than a straight geometric line.
  {
    // **The march is the player's own longest stride, not a survey step.**
    //
    // This check was blind to a real, reproducible fall for as long as it
    // marched at 0.5 m and compared each step against `BUILDING_STEP_UP`
    // alone. Both halves of that were wrong, and each one on its own was
    // enough to hide the bug:
    //
    // 1. **0.5 m is not a step she ever takes.** One clamped frame
    //    (`MAX_FRAME_DELTA`, 1/12 s — a slow phone, and the ceiling the engine
    //    itself clamps to) advances a *sprinting* child
    //    `PLAYER_MAX_SPEED × PLAYER_SPRINT_MULTIPLIER × MAX_FRAME_DELTA` =
    //    {@link PLAYER_LONGEST_STEP}, 0.925 m. Sampling at 0.5 m measured a
    //    climb she never makes in one piece and reported 54% of the real one.
    // 2. **`BUILDING_STEP_UP` is not the budget.** `Player.update` passes
    //    `this.position.y` — *last* frame's damped, lagging height — into the
    //    ground sample, and `WalkSurfaces.sample` rejects any surface above
    //    `that + BUILDING_STEP_UP`. Climbing steadily, `damp(y, groundY,
    //    0.04, dt)` never catches up: it retains
    //    `2^(-MAX_FRAME_DELTA / 0.04)` = 0.236 of the gap each frame, so the
    //    lag settles at `retention / (1 - retention)` = 0.309 × the per-frame
    //    climb. She must clear her *own* climb **plus** her lag, so the real
    //    budget is `BUILDING_STEP_UP / 1.309` = 0.474 m, not 0.620 m.
    //
    // Miss the lag and a 0.495 m climb reads as 80% of budget and safe; count
    // it and the same frame needs 0.632 m against 0.620 m and she loses the
    // surface, goes airborne and drops through her own deck into the tunnel.
    // That is not hypothetical: browser QA of PR #352 fell through on 6 of 32
    // sprinted runs, `bridge-262.0` 4 times out of 4 in one direction, ending
    // 3.85 m under the deck and staying there.
    //
    // **Scanned as a sliding window at a fine step, not marched in strides.**
    // Sampling every 0.925 m would make the answer depend on where the march
    // happened to start — a phase offset could straddle the steep stretch and
    // miss it. Every fine sample is compared with the point one full stride
    // ahead of it instead, so a steep metre is caught wherever it falls.
    //
    // The whole term is the game's own: `PLAYER_LONGEST_STEP`,
    // `MAX_FRAME_DELTA` and `BUILDING_STEP_UP` are the engine's constants, and
    // 0.04 is `Player.update`'s own damp half-life. None of it is a generator
    // target, and none of it may be loosened to make a bridge pass — the
    // bridge is what gives way.
    const SAMPLES_PER_STRIDE = 8;
    const MARCH_STEP = PLAYER_LONGEST_STEP / SAMPLES_PER_STRIDE;
    /** What `damp` keeps of the gap across one clamped frame. */
    const DAMP_RETENTION = Math.pow(2, -MAX_FRAME_DELTA / PLAYER_HEIGHT_DAMP_HALF_LIFE);
    /** Steady-state lag, as a multiple of the per-frame climb. */
    const DAMP_LAG = DAMP_RETENTION / (1 - DAMP_RETENTION);
    /** The climb one sprinted clamped frame may make and still be sampled. */
    const CLIMB_BUDGET = BUILDING_STEP_UP / (1 + DAMP_LAG);
    // ⚠️ **Since #358 this is deliberately CONSERVATIVE — it is stricter than
    // the player it describes.** Both terms above were true of the player as
    // she was: one ground sample per frame, taken at the end of the whole
    // frame's movement, asked from her damped height. Neither is true now. The
    // sample rides the same sub-steps `CollisionWorld.resolveMovement` cuts
    // lateral movement into, and is asked from the surface she is standing on,
    // so the rule that actually binds is `BUILDING_STEP_UP` per *sub-step*
    // (0.370 m at worst) rather than per stride, and the damp lag is not in
    // the arithmetic at all. Measured ceiling 0.512 → 1.670:
    // `npm run check:deck-fallthrough`.
    //
    // It is left as it is on purpose, and it is safe to: a bound stricter than
    // reality can only ever refuse geometry that would in fact have worked,
    // never pass geometry that falls. Relaxing it is inseparable from raising
    // `SPRINT_PEAK_GRADE_BUDGET`, which re-plans every bridge on every seed
    // (see that constant's own note), and that is separately measured gameplay
    // work rather than a side effect of a physics fix.
    //
    // **Whoever raises the budget: this is the second place the old model is
    // written down, and it must move in the same PR** — the invariant would
    // otherwise keep refusing exactly the steeper ramps that change is meant
    // to allow, and the tell would be a bridge that fails here while
    // `check:deck-fallthrough` says the same slope is walkable.
    // `NavGrid.ts`'s own `TOP_REFERENCE`, restated rather than imported —
    // it looks like a leaf (its own direct imports are `core/constants`,
    // two type-only imports, and `Collision.ts`), but that last one is not
    // safe: `NavGrid.ts` imports `autoHopClears` from it as a real value,
    // and `Collision.ts` imports `GARDEN_PLAY_BOUNDARY` from `boundary.ts`
    // as a real value too, which reads `PARK_SEED` from `parkManifest.ts`
    // at module load — so a static import of `NavGrid.ts` here pins the
    // park's seed exactly the way this file's own header warns against
    // (found live: every non-canonical seed file threw "asked for seed N
    // but the park built with 20260728" the moment this was imported,
    // canonical only ever passing because 20260728 already *is* the
    // default it was pinned to). `WalkSurfaces.sample`'s own contract is
    // "no more than one step above `y`" with a `ceiling = y + STEP_UP`, so
    // any `y` comfortably above every real height in the park is exactly
    // as good as `NavGrid`'s own probe — a plain, un-imported number.
    const TOP_REFERENCE = 500;
    for (const crossing of facts.world.train.crossings) {
      const bridge = facts.world.train.bridges.find((b) => b.deckCovers(crossing.x, crossing.z));
      if (!bridge) continue;
      // Marches the drawn path's own line, not a straight chord — see the
      // per-crossing `frame` note above.
      const frame = frameFor(crossing);

      const reachOf = (sign: 1 | -1): number => {
        let edge = 0;
        for (let d = 0; d <= 40; d += MARCH_STEP) {
          const p = frame.pointAt(d * sign);
          if (!bridge.covers(p.x, p.z)) break;
          edge = d;
        }
        return edge;
      };
      const farNeg = reachOf(-1);
      const farPos = reachOf(1);
      // Nothing built either side of this crossing at all (both reaches at
      // zero) — nothing to march, and nothing to fail on here; the per-side
      // probe above already covers a bridge with no ramp.
      if (farNeg <= 0 && farPos <= 0) continue;

      // Walk the whole centreline once, keeping the profile, so the sheer-step
      // check and the sprint-climb window below both read the same heights.
      const alongs: number[] = [];
      const heights: number[] = [];
      const exposure: number[] = [];
      for (let along = -farNeg; along <= farPos + 1e-6; along += MARCH_STEP) {
        const p = frame.pointAt(along);
        const x = p.x;
        const z = p.z;
        const bridgeH = heightAt(x, z);
        const groundH = facts.world.building.surfaces.sample(x, z, TOP_REFERENCE);
        const h = bridgeH ?? groundH;
        if (!standableAt(x, z, h)) {
          complaints.push(
            `the crossing at (${fmt([crossing.x, crossing.z])}) is not standable ` +
              `${along.toFixed(1)} m along its own centreline, on the ` +
              `${bridgeH !== null ? 'bridge' : 'ground'}`,
          );
        }
        alongs.push(along);
        heights.push(h);
        // **How far she would actually drop if she lost this surface.**
        // `WalkSurfaces.sample` starts from the terrain and only ever raises
        // its answer with decks, ramps and platforms — the terrain itself is
        // never filtered against the ceiling. So losing the deck does not put
        // her inside the scenery; it puts her on the ground beneath it. Near a
        // ramp foot the deck lies *on* that ground, so losing it is a
        // no-op — which is why the exposure below is part of the question and
        // not a let-off. Sampled with an absurdly low reference so every
        // built surface is rejected and bare terrain is what comes back
        // (`terrainHeight` itself must not be imported here — it reaches
        // `parkManifest` and would pin every seed to the default park).
        const terrainH = facts.world.building.surfaces.sample(x, z, -1e6);
        exposure.push(h - terrainH);
      }

      // A sheer face — a wall or a drop between two neighbouring samples.
      // One complaint per crossing, not one per offending sample: a genuine
      // sheer drop fails every step downstream of it too, and a wall of
      // near-identical complaints obscures the one real finding.
      let reportedStep = false;
      for (let i = 1; i < heights.length; i += 1) {
        const step = Math.abs((heights[i] as number) - (heights[i - 1] as number));
        if (step > BUILDING_STEP_UP && !reportedStep) {
          reportedStep = true;
          complaints.push(
            `the crossing at (${fmt([crossing.x, crossing.z])}) has a ${step.toFixed(2)} m step ` +
              `between ${(alongs[i - 1] as number).toFixed(1)} m and ` +
              `${(alongs[i] as number).toFixed(1)} m along its own ` +
              `centreline — too tall for a real walk (BUILDING_STEP_UP is ` +
              `${BUILDING_STEP_UP.toFixed(2)} m); this is not a walkable crossing, ground to ground`,
          );
        }
      }

      // **One sprinted clamped frame.** The worst climb over any stride-long
      // window, wherever it falls, against the budget her own damp lag leaves
      // her.
      let worstClimb = 0;
      let worstAt = 0;
      let worstDrop = 0;
      for (let i = 0; i + SAMPLES_PER_STRIDE < heights.length; i += 1) {
        const climb = (heights[i + SAMPLES_PER_STRIDE] as number) - (heights[i] as number);
        // Only where losing the surface would genuinely drop her. Below
        // `FALL_THRESHOLD` the game does not even call it a fall.
        const drop = Math.min(exposure[i] as number, exposure[i + SAMPLES_PER_STRIDE] as number);
        if (drop <= FALL_THRESHOLD) continue;
        if (climb > worstClimb) {
          worstClimb = climb;
          worstAt = alongs[i] as number;
          worstDrop = drop;
        }
      }
      if (worstClimb > CLIMB_BUDGET) {
        const needed = worstClimb * (1 + DAMP_LAG);
        complaints.push(
          `the crossing at (${fmt([crossing.x, crossing.z])}) climbs ` +
            `${worstClimb.toFixed(3)} m in one sprinted frame, ` +
            `${worstAt.toFixed(1)} m along its own centreline — a child running up it ` +
            `on a slow device falls through her own deck. One clamped frame ` +
            `(${MAX_FRAME_DELTA.toFixed(4)} s) carries her ` +
            `${PLAYER_LONGEST_STEP.toFixed(3)} m, and WalkSurfaces.sample only reaches ` +
            `BUILDING_STEP_UP (${BUILDING_STEP_UP.toFixed(2)} m) above her own damped ` +
            `height, which lags ${DAMP_LAG.toFixed(3)} x the climb behind her — so she ` +
            `needs ${needed.toFixed(3)} m of a ${BUILDING_STEP_UP.toFixed(2)} m reach and ` +
            `loses the surface. The budget is ${CLIMB_BUDGET.toFixed(3)} m per frame ` +
            `(peak grade ${(CLIMB_BUDGET / PLAYER_LONGEST_STEP).toFixed(3)}); this one ` +
            `needs grade ${(worstClimb / PLAYER_LONGEST_STEP).toFixed(3)}. The deck stands ` +
            `${worstDrop.toFixed(2)} m over the ground there, so that is how far she drops ` +
            `— through the deck, into the tunnel`,
        );
      }
    }
  }

  return complaints;
};

/**
 * **A bridge is exactly as wide as its own path, and the train's corridor
 * under it is genuinely open** — the two measurable halves of Jim's
 * 2026-08-23 bridge feedback, measured off the real, built park.
 *
 * 1. **Width.** The old decks came out 12.9–15.8 m wide over a ~4 m path
 *    ("a giant plywood table"). The standable width of the built bridge —
 *    walked outward from the crossing with the game's own
 *    `collision.resolve` until the parapet stops a real, player-sized body
 *    — must agree with the crossing path's own paved width: no wider than
 *    the paving (`pathHalfWidth`, read off the same samples the path was
 *    drawn from), and no narrower than the paving less the walker's own
 *    body each side (the parapets' collision is what eats that). Both
 *    bounds are game numbers (`PLAYER_RADIUS`), not generator targets.
 * 2. **The rail corridor.** The old geometry stood two support beams
 *    *across the track* (they ran the deck's own length at its outer
 *    edges — i.e. down the rail line either side of the crossing), which
 *    the train would drive straight into. Nothing about a `covers()` or
 *    collider check can see that — it was visible mesh with no collider —
 *    so this raycasts straight up from the track bed, across the train's
 *    own swept width (`TRACK_CLEARANCE` either side), through the built
 *    bridge group: the first thing the ray hits must be at least
 *    `TRAIN_CLEARANCE_Y` above the route's own ground. And over the
 *    crossing itself at least one ray must hit *something* — a bridge
 *    whose arch the rays sail through unhit is a crossing with no bridge
 *    over it, and this check would otherwise pass vacuously (the "check
 *    that cannot fail" trap).
 *
 * Proven red before green (2026-08-23): run against the pre-rework
 * geometry, part 1 fails on both canonical bridges (standable width 6.6
 * and 8.8 m against 2.6 m of paving) and part 2 fails on the support
 * beams (first hit 0.4–4.3 m over the track bed, worst ray 0.42 m).
 */
const bridgesMatchTheirPathAndKeepTheRailClear: Invariant = (facts) => {
  const complaints: string[] = [];
  const train = facts.world.train;
  const route = train.route;
  const probe = new Vector3();
  const standableAt = (x: number, z: number, height: number): boolean => {
    probe.set(x, height, z);
    facts.world.collision.resolve(probe, PLAYER_RADIUS);
    return Math.hypot(probe.x - x, probe.z - z) < 1e-3;
  };
  const heightAt = (x: number, z: number): number | null => {
    let best: number | null = null;
    for (const bridge of train.bridges) {
      if (!bridge.covers(x, z)) continue;
      const height = bridge.heightAt(x, z);
      if (best === null || height > best) best = height;
    }
    return best;
  };

  // Only the bridges' own masonry is judged by the rays — the train
  // itself (which may legitimately be parked on the line) and the fence
  // (which legitimately crosses under every bridge) live in the same
  // scene group and must not read as "something over the track".
  const bridgesGroup = train.group.getObjectByName('railway-bridges');
  if (!bridgesGroup) {
    if (train.bridges.length > 0) {
      complaints.push(
        'no "railway-bridges" group in the built train group to raycast — the group ' +
          'name in bridges.ts has changed and this invariant is measuring nothing',
      );
    }
    return complaints;
  }
  bridgesGroup.updateMatrixWorld(true);
  const raycaster = new Raycaster();
  const up = new Vector3(0, 1, 0);
  const rayOrigin = new Vector3();
  const routePoint = new Vector3();
  const routeTangent = new Vector3();

  for (const crossing of train.crossings) {
    const bridge = train.bridges.find((b) => b.deckCovers(crossing.x, crossing.z));
    if (!bridge) continue;
    const frame = frameFor(crossing);
    const at0 = frame.pointAt(0);

    // --- 1. the standable width, against the path's own paved width -------
    const standableReach = (side: 1 | -1): number => {
      let reach = 0;
      for (let w = 0; w <= 9; w += 0.1) {
        const x = crossing.x + at0.acrossX * w * side;
        const z = crossing.z + at0.acrossZ * w * side;
        const height = heightAt(x, z);
        if (height === null) break; // off the built bridge's own extent
        if (!standableAt(x, z, height)) break; // the parapet's collision
        reach = w;
      }
      return reach;
    };
    const total = standableReach(1) + standableReach(-1);
    const paved = crossing.pathHalfWidth * 2;
    const usableFloor = Math.max(0.2, paved - PLAYER_RADIUS * 2 - 0.3);
    if (total > paved + 0.2) {
      complaints.push(
        `the bridge at (${fmt([crossing.x, crossing.z])}) is ${total.toFixed(1)} m of standable ` +
          `width against a path paved only ${paved.toFixed(1)} m wide — the bridge is wider ` +
          'than the path it carries',
      );
    } else if (total < usableFloor) {
      complaints.push(
        `the bridge at (${fmt([crossing.x, crossing.z])}) leaves only ${total.toFixed(2)} m of ` +
          `standable width on a path paved ${paved.toFixed(1)} m wide — the parapets have ` +
          'closed over the path itself',
      );
    }

    // --- 2. the rail corridor under the bridge is genuinely open ----------
    let anyHitOverCrossing = false;
    let worstClearance = Infinity;
    let worstAt = '';
    for (let offset = -8; offset <= 8 + 1e-6; offset += 0.5) {
      const railDistance = route.wrap(crossing.railDistance + offset);
      route.pointAt(railDistance, routePoint);
      route.tangentAt(railDistance, routeTangent);
      const nx = routeTangent.z;
      const nz = -routeTangent.x;
      for (const lateral of [-TRACK_CLEARANCE, 0, TRACK_CLEARANCE]) {
        rayOrigin.set(
          routePoint.x + nx * lateral,
          routePoint.y + 0.02,
          routePoint.z + nz * lateral,
        );
        raycaster.set(rayOrigin, up);
        raycaster.far = TRAIN_CLEARANCE_Y + 6;
        const hits = raycaster.intersectObject(bridgesGroup, true);
        const first = hits[0];
        if (!first) continue;
        const clearance = first.point.y - routePoint.y;
        if (Math.abs(offset) <= 1.5) anyHitOverCrossing = true;
        if (clearance < worstClearance) {
          worstClearance = clearance;
          worstAt = `${offset.toFixed(1)} m along the rail, ${lateral.toFixed(1)} m off its centre`;
        }
      }
    }
    if (worstClearance < TRAIN_CLEARANCE_Y) {
      complaints.push(
        `the bridge at (${fmt([crossing.x, crossing.z])}) has built geometry only ` +
          `${worstClearance.toFixed(2)} m over the track bed (at ${worstAt}) — the train sweeps ` +
          `to ${TRAIN_CLEARANCE_Y.toFixed(2)} m, so it would drive into or through it`,
      );
    }
    if (!anyHitOverCrossing) {
      complaints.push(
        `no built bridge geometry stands over the rail at the crossing at ` +
          `(${fmt([crossing.x, crossing.z])}) — the rays found nothing to measure, so the ` +
          'clearance above is vacuous',
      );
    }
  }
  return complaints;
};

/**
 * **The park's own paving goes up and over every bridge — one continuous
 * path, never a second floor and never a ribbon left lying in the tunnel.**
 *
 * Jim, 2026-08-24: *"the 'floor' on the bridge should be the normal path
 * texture — it should read as a continuous path that goes over a bridge."*
 * `pathGraph.ts` draws one sandy ribbon and one cream kerb for the whole
 * park, and `World.ts` lifts the stretch a bridge carries onto that
 * bridge's own surface (`drapePathsOverBridges`). That is the *only*
 * mechanism there is, which is exactly why it needs measuring: paths are
 * drawn before the train has solved a loop, so the untouched ribbon lies on
 * the terrain — straight through the arch, under the bridge standing over
 * it.
 *
 * Measured off the built meshes' own vertex buffers, never off the drape
 * call:
 *
 * 1. **Every vertex a bridge carries is on that bridge**, at the layer's
 *    own lift above its surface, to the millimetre. A vertex left on the
 *    terrain here is the ribbon-through-the-tunnel bug.
 * 2. **Both layers are carried alike.** The kerb reaches further out than
 *    the surface it borders, so it is the layer that tears first — the
 *    first build of this carried 161 surface vertices and only 85 kerb
 *    ones, splitting the kerb down the middle of every bridge while the
 *    paving itself looked perfect. So the two counts must agree.
 * 3. **Nothing is left in the tunnel**: no path vertex inside the deck's
 *    own span may sit below the built soffit over it.
 * 4. **It cannot pass vacuously.** A park with bridges must have paving on
 *    them — zero carried vertices is a finding, not a pass, which is the
 *    trap every other bridge check here has had to be written against.
 */
const theDrawnPathRidesOverEveryBridge: Invariant = (facts) => {
  const complaints: string[] = [];
  const bridges = facts.world.train.bridges;
  if (bridges.length === 0) return complaints;

  const layers: { name: string; mesh: Mesh; lift: number }[] = [];
  facts.world.garden.group.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    if (object.name === 'path-surface') layers.push({ name: object.name, mesh: object, lift: PATH_SURFACE_LIFT });
    if (object.name === 'path-kerb') layers.push({ name: object.name, mesh: object, lift: PATH_KERB_LIFT });
  });
  if (layers.length !== 2) {
    complaints.push(
      `expected the garden to hold both drawn path layers to measure, found ` +
        `${layers.length} (${layers.map((l) => l.name).join(', ') || 'none'}) — the mesh names ` +
        'in pathGraph.ts have changed and this invariant is measuring nothing',
    );
    return complaints;
  }

  const carried: Record<string, number> = {};
  for (const { name, mesh, lift } of layers) {
    const position = mesh.geometry.getAttribute('position');
    let count = 0;
    let worstOff = 0;
    let worstAt: readonly [number, number] = [0, 0];
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      let surface: number | null = null;
      for (const bridge of bridges) {
        const here = bridge.pavingHeightAt(x, z);
        if (here !== null && (surface === null || here > surface)) surface = here;
      }
      if (surface === null) continue;
      count += 1;
      const off = Math.abs(y - (surface + lift));
      if (off > worstOff) {
        worstOff = off;
        worstAt = [x, z];
      }
    }
    carried[name] = count;
    // A millimetre: the drape writes the height straight in, so anything
    // bigger than float noise means a vertex was missed, not rounded.
    if (worstOff > 0.001) {
      complaints.push(
        `the drawn ${name} sits ${worstOff.toFixed(3)} m off the bridge carrying it at ` +
          `(${fmt(worstAt)}) — the paving is not riding the hump there, it is draped on ` +
          'whatever was under it when the path was drawn',
      );
    }
  }

  // **Why twice, and not once.** This clause compared the two counts for
  // equality, which was right while the kerb was one ribbon under the surface
  // — same curve, same `divisions`, same vertex count. `pathGraph.ts` now draws
  // the kerb as the **two bands you can actually see** (its middle was a face
  // buried under the path, and `ART_DIRECTION.md` §7 says delete those rather
  // than hold them apart with a lift), so a kerb that is riding its bridge
  // perfectly has exactly twice the vertices. Measured: 92 against 46 on seed
  // 11, and the same 2.000 ratio on every seed that carries a bridge.
  //
  // It is a structural constant of the geometry, not a tolerance — the ±15%
  // beside it is the tolerance, and it is unchanged. A kerb genuinely torn off
  // its paving still fails this.
  const KERB_VERTICES_PER_SURFACE_VERTEX = 2;
  const surfaceCount = carried['path-surface'] ?? 0;
  const kerbCount = carried['path-kerb'] ?? 0;
  if (surfaceCount === 0) {
    complaints.push(
      `${bridges.length} bridge(s) are built and not one vertex of the drawn paving is on any ` +
        'of them — the path does not go over the bridges at all, and every check above ' +
        'passed by having nothing to measure',
    );
  } else if (Math.abs(kerbCount - surfaceCount * KERB_VERTICES_PER_SURFACE_VERTEX) > surfaceCount * 0.15) {
    complaints.push(
      `the bridges carry ${surfaceCount} path-surface vertices but ${kerbCount} path-kerb ones, ` +
        `against the ${KERB_VERTICES_PER_SURFACE_VERTEX}x the kerb's two bands should give — ` +
        'the kerb is torn off the paving it borders somewhere over a bridge',
    );
  }

  // 3. Nothing left lying in a tunnel — stated where the train is, not
  //    where the deck is.
  //
  //    The test is deliberately anchored to the **rail centre line**, not to
  //    the deck's own span. A first attempt used `deckCovers` and fired on
  //    perfectly good paving: the crown's soffit is flat only over
  //    `ARCH_CLEAR_HALF`, and past that the arch's haunch curves down toward
  //    its springing, so a hump's road legitimately runs *below* the crown
  //    soffit's height once it is out over the solid abutment (measured 4.06
  //    m of road under a 4.18 m soffit, 2.4 m along, with nothing wrong at
  //    all). Within the train's own swept half-width of the rail there is no
  //    such ambiguity: paving below the soffit there is paving the train
  //    would drive through.
  const railPoint = { x: 0, z: 0 };
  const route = facts.world.train.route;
  for (const crossing of facts.world.train.crossings) {
    const deckMesh = facts.world.train.group
      .getObjectByName(`bridge-${crossing.railDistance.toFixed(1)}`)
      ?.getObjectByName('deck');
    if (!deckMesh) continue;
    const soffit = new Box3().setFromObject(deckMesh).min.y;
    const bridge = bridges.find((b) => b.deckCovers(crossing.x, crossing.z));
    if (!bridge) continue;
    for (const { name, mesh } of layers) {
      const position = mesh.geometry.getAttribute('position');
      for (let i = 0; i < position.count; i += 1) {
        const x = position.getX(i);
        const z = position.getZ(i);
        if (bridge.pavingHeightAt(x, z) === null) continue;
        route.flatPointAt(route.distanceNear(x, z), railPoint);
        if (Math.hypot(x - railPoint.x, z - railPoint.z) > TRACK_CLEARANCE) continue;
        const y = position.getY(i);
        if (y < soffit) {
          complaints.push(
            `the drawn ${name} passes under the bridge at (${fmt([crossing.x, crossing.z])}): a ` +
              `vertex at (${fmt([x, z])}) sits at ${y.toFixed(2)} m, below the ${soffit.toFixed(2)} m ` +
              'soffit standing over the track — the path is draped through the tunnel',
          );
          break;
        }
      }
    }
  }

  return complaints;
};

/**
 * **Paving a bridge holds up in mid-air has stone under it** (issue #349).
 *
 * Jim, playing `main` just after the entrance bridge landed: *"on entering the
 * park and walking straight to the first bridge, there is some weird item
 * clipping into the bridge"* — sandy, path-coloured geometry projecting out
 * through the masonry below deck level, a flat wedge out of the near spandrel
 * beside the arch.
 *
 * It was the drawn path itself. `bridges.ts` decides which path vertices a
 * bridge lifts onto its hump, and `bridgeFootprint.ts` decides how far out the
 * masonry is swept, and the two were independent sums off the same crossing:
 * the lift reached `roadHalf + PATH_KERB_OVERHANG + PATH_CARRIER_SLACK` while
 * the stone stopped at `roadHalf + BRIDGE_WALL_THICKNESS`, so up to 0.375 m of
 * paving hung 4 m in the air past the parapet with nothing beneath it. The
 * quad joining it back down to the un-lifted terrain vertex beside it is the
 * wedge in the screenshot. CLAUDE.md's "two definitions of one thing, kept in
 * step by hand", and neither of the two existing bridge-width invariants could
 * see it: one measures where a *walker* can stand (inside the parapets, so it
 * never looks outside them), the other that the paving rides the hump at the
 * right *height* (which this paving did — that was the problem).
 *
 * So this asks the one question neither did: of the paving each bridge lifts
 * clear of the ground, is any of it outside that bridge's own masonry in plan?
 * Measured off the built park — the real drawn path meshes against the real
 * swept shell triangles ({@link ParkFacts.bridgePaving}) — never against
 * either module's own arithmetic, which is exactly what agreed with itself
 * while disagreeing with the other.
 *
 * **Deliberately about paving held in the air, not paving past the outline.**
 * `pavingHeightAt` pads along the spine as well as across it, so it claims
 * paving a metre or so beyond the last of the masonry at each ramp foot —
 * where the hump has already come back down to the terrain and the paving is
 * simply lying on the ground, which is correct and invisible. Judging every
 * claimed vertex against the plan outline reports 1.27 m of "overhang" there
 * on the canonical seed and would have had to be loosened to go green; the
 * defect is specifically paving with *daylight* under it.
 *
 * Proven red before green (2026-08-29): against the pre-fix geometry it fires
 * on both canonical bridges — see the fix's own PR for the message.
 */
const bridgePavingIsCarriedByItsOwnMasonry: Invariant = (facts) => {
  const complaints: string[] = [];
  const built = facts.world.train.bridges.length;
  if (built === 0) return complaints;

  if (facts.bridgePaving.length !== built) {
    complaints.push(
      `the park built ${built} bridge(s) but ${facts.bridgePaving.length} were measured for ` +
        'paving overhang — the "railway-bridges" group no longer holds one child group per ' +
        'built bridge, and this invariant is measuring the wrong stone',
    );
    return complaints;
  }

  // Without this the whole check passes vacuously on a park whose paving the
  // bridges never claimed at all — the "check that cannot fail" trap, and the
  // state a `pavingHeightAt` that returned `null` everywhere would leave it in.
  const totalLifted = facts.bridgePaving.reduce((sum, b) => sum + b.liftedClearOfGround, 0);
  if (totalLifted === 0) {
    complaints.push(
      `${built} bridge(s) are built and not one vertex of the drawn paving is lifted clear of ` +
        'the ground by any of them — no bridge is carrying its path, and the overhang check ' +
        'below has nothing to measure',
    );
    return complaints;
  }

  for (const bridge of facts.bridgePaving) {
    if (bridge.unsupported === 0) continue;
    complaints.push(
      `${bridge.name} lifts ${bridge.unsupported} of its ${bridge.liftedClearOfGround} carried ` +
        `paving vertices past its own masonry: the worst (${bridge.worstLayer}) sits ` +
        `${bridge.worstOverhang.toFixed(3)} m outside the stone in plan at ` +
        `(${fmt([bridge.worstAt[0], bridge.worstAt[2]])}), ` +
        `${bridge.worstAboveGround.toFixed(2)} m above the ground under it — that paving is ` +
        'hanging in mid-air past the parapet, and it is what clips through the masonry',
    );
  }

  return complaints;
};

/**
 * **No drawn path ends in mid-air on a bridge** — issue #414.
 *
 * Jim, three times about the same bridge, the third time exactly:
 *
 * > "there is also a path that runs into the side of the bridge — basically
 * > runs into a solid wall"
 *
 * and
 *
 * > "path finding needs to include bridges from the start, not as an
 * > afterthought to add to an existing path layout"
 *
 * A drawn route has two ends. One of them standing on a bridge's paving, well
 * above the ground beneath it, is a path that **stops partway up a ramp or on
 * the deck**: a child follows it and arrives at masonry with nowhere to go.
 * Measured on the canonical seed before the fix, `spur-dodgems` branched off
 * the gate approach at (-22.2, 36.4) — a point on the bridge's own crown, 4.40
 * m in the air — and ran 7 m along the ramp before turning off its side.
 *
 * **This is deliberately unconditional.** It is not scoped to bridges the
 * planner proved, even though scoping it was for a while the only way to make
 * it pass: three of the five seeds were red on it because a bridge had been
 * built where the planner proved none, and narrowing the assertion to hide
 * that is exactly the "never weaken an assertion to make a seed pass" rule.
 * What made it true everywhere was fixing both halves — `paths.ts` keeping off
 * the ground a bridge will stand on, and `bridgeFootprint.ts` refusing to
 * build one where no bridge was ever proven.
 *
 * ## The threshold is the child's own step, not a bridge number
 *
 * A path end at a ramp **foot** is completely correct: the hump has clamped
 * back down to the terrain there, so the paving is lying on the ground and the
 * path simply joins it. Measured, those sit at ~0.06 m. A genuinely stranded
 * end measured 1.13 m to 4.40 m.
 *
 * So the line is {@link BUILDING_STEP_UP} — *the height the game lets a child
 * step up*, from `core/constants.ts`, the same number the walker itself uses.
 * Below it she walks on; above it there is a wall in front of her. Taking the
 * threshold from the player rather than from the generator's own ramp targets
 * is CLAUDE.md's rule, and the lesson `MAX_RAMP_GRADIENT` taught in #375 —
 * that one came from the nav lattice instead of the player, and this whole
 * area went wrong behind it.
 *
 * The two populations are three orders of slack apart, so the invariant does
 * not balance on the constant's exact value.
 */
const noDrawnPathEndsStrandedOnABridge: Invariant = (facts) => {
  const complaints: string[] = [];
  // Not vacuous by construction: a park with no bridges has no way to strand
  // a path end on one, and the seeds that build none are a real outcome now
  // that unproven bridges are refused (seed 2 builds zero). The bridge-side
  // anti-vacuity guard is `bridgePavingIsCarriedByItsOwnMasonry`'s, which
  // already fails if no bridge carries any paving at all.
  for (const end of facts.strandedPathEnds) {
    if (end.aboveGround <= BUILDING_STEP_UP) continue;
    complaints.push(
      `the drawn route "${end.route}" ends at (${fmt(end.at)}) on ${end.bridge}, ` +
        `${end.aboveGround.toFixed(2)} m above the ground beneath it — more than a child's own ` +
        `step-up of ${BUILDING_STEP_UP} m, so the path stops against masonry she cannot get ` +
        'past. A path may cross a bridge; it may not end on one',
    );
  }
  return complaints;
};

/**
 * **The railway is crossed on purpose, and mostly on bridges.**
 *
 * Jim, 23 August 2026: the park is designed around the bridge constraints —
 * `crossingPlan.ts` decides, before a single path is drawn, where the loop
 * can genuinely take a bridge (or, rarely, a deliberate level crossing),
 * and `paths.ts` routes every rail-crossing leg through those sites. This
 * measures the two consequences that matter on the *built* park:
 *
 * 1. **No crossing's fence gap overlaps a station's sealed window.** The
 *    far side of every platform is fenced shut (`fence.ts`'s `stationRun`),
 *    so a crossing inside that window is a paved route walking into a wall
 *    — exactly what stranded 6 waypoints on the canonical seed before the
 *    crossing plan existed (a spur crossed at railDistance 330.1, 3.6 m
 *    from a platform).
 * 2. **At least one real bridge exists** whenever the park has any crossing
 *    at all. This is what keeps the whole invariant honest: with zero
 *    bridges anywhere every per-bridge check above passes vacuously (the
 *    "check that cannot fail" trap), which is precisely the state the three
 *    required seeds were in (0/7, 0/7, 0/5) before the plan-first rework.
 *
 * **What this deliberately no longer asserts, and why** (#349/#392). It used
 * to demand `built >= fallbacks.length` — "real bridges are the rule". That
 * counts the *plan's ambition*, not the park, and CLAUDE.md's rule for this
 * file is to measure the park that was built, never the rules that built it.
 * Two things make it indefensible:
 *
 * - **Its green state on seed 2 was only ever reachable through a defect.**
 *   That seed's two bridges "fitted" solely because the footprint search
 *   modelled a neighbour's parapet as 6.4 m long when the built thing is
 *   ~22 m, so one bridge was built straight through the other's wall. Fixing
 *   that (#349) made the park honest and this clause went red. Measured:
 *   `check:park` on seed 2 reports **33 stranded waypoints on `main` and 3
 *   with the fix** — the "passing" arrangement was stranding thirty
 *   waypoints, and the three that remain are on `main` too.
 * - **It asserts a promise the planner never made.** Seed 2 proves *zero*
 *   bridge sites (canonical proves 4, seeds 5/11 three each, seed 18 one);
 *   all seven of its planned sites are level ones. Demanding bridges there
 *   demands something `crossingPlanSolve.ts` explicitly declined to promise.
 *
 * This is the same correction {@link everyProvenBridgeSiteKeepsItsBridge}
 * already made to its own clause 1 on seed 18 (#374), for the same reason and
 * in the same words: it stopped "asserting a promise the router never made".
 *
 * The promise that *is* made is still enforced, and by the invariant that
 * owns it: every proven bridge site keeps its bridge
 * ({@link everyProvenBridgeSiteKeepsItsBridge}). And the #349 defect itself
 * is caught — red on `main`, green here — by
 * {@link everyBridgeIsWalkableAndReachable}, which found it in the first
 * place. Restating either here would be a second copy of a check, which is
 * the shape of bug this very ticket was about.
 *
 * **A real gap this leaves, deliberately unfilled** (see the issue): nothing
 * asks whether a *level* crossing is walkable. Every per-bridge check in this
 * file iterates `train.bridges` and skips it. A first attempt at closing that
 * here — `standableNear` at the crossing point — went red on five seeds and
 * was wrong twice over: a bridge crossing's point is up on the deck, not on
 * the ground under the arch, and a level crossing's point sits on the track
 * centre-line, which `check:park` separately *requires* to be unstandable
 * (`0/266 centre-line points standable`). Asking it properly means deciding
 * what "walkable across a level crossing" means in height and offset, and a
 * half-thought assertion is worse than a missing one.
 *
 * Thresholds come from the built world (`facts.world.train`) and the
 * fence's own `STATION_GAP` (a leaf-module constant), never from
 * `crossingPlan.ts` itself — importing the plan would both pin the seed
 * (it solves against `PARK_LAYOUT` at module load) and re-measure the
 * rules instead of the park.
 */
/**
 * **No two stations stand in each other.**
 *
 * The stations used to be planned independently — one scored search per seed
 * bearing, neither aware of the other — and on seeds 3 and 23 both searches
 * converged on the same stretch of loop. The park was built with Sunny Side and
 * Bluebell Halt interpenetrating: two decks in one plane over 18 m², two
 * canopy roofs over another 9 m², one smeared station where a child expected
 * two. Nothing caught it. `check:coplanar` found it, which is a rendering check
 * finding a placement bug — so the placement gets its own assertion here, where
 * it belongs.
 *
 * Measured on the park that was built (`facts.world.train.stations`), never on
 * the rule that built it, and the threshold is the game's own: `fence.ts`
 * leaves the lineside fence open for `STATION_GAP` either side of a platform,
 * so two stands closer than a platform's length plus two of those windows are
 * sharing one opening. That is `plan.ts`'s `STATION_SEPARATION`, and it is read
 * from `clearance.ts` rather than restated.
 *
 * Deliberately generous-side-of-honest: the assertion is that they do not
 * *crowd*, at the same distance the planner is scored against, not merely that
 * they do not touch. Two stations 8 m apart would pass a bare overlap test and
 * still be one station as far as a six-year-old is concerned.
 */
const stationsDoNotCrowdEachOther: Invariant = (facts) => {
  const complaints: string[] = [];
  const stations = facts.world.train.stations;
  const needed = PLATFORM_LENGTH + STATION_GAP * 2;

  for (let i = 0; i < stations.length; i += 1) {
    for (let j = i + 1; j < stations.length; j += 1) {
      const a = stations[i];
      const b = stations[j];
      if (!a || !b) continue;
      const gap = Math.hypot(a.standX - b.standX, a.standZ - b.standZ);
      if (gap < needed) {
        complaints.push(
          `${a.name} at (${fmt([a.standX, a.standZ])}) and ${b.name} at ` +
            `(${fmt([b.standX, b.standZ])}) stand ${gap.toFixed(1)} m apart — ` +
            `closer than the ${needed.toFixed(1)} m two platforms need before their ` +
            'fence openings stop being one opening',
        );
      }
    }
  }

  if (stations.length < 2) {
    process.stderr.write(
      `stationsDoNotCrowdEachOther: only ${stations.length} station(s) in this park — ` +
        'asserts nothing\n',
    );
  }

  return complaints;
};

const crossingsArePlannedAndWalkable: Invariant = (facts) => {
  const complaints: string[] = [];
  const train = facts.world.train;
  const route = train.route;
  const crossings = train.crossings;

  for (const crossing of crossings) {
    for (const station of train.stations) {
      const along = Math.abs(
        route.wrap(crossing.railDistance - station.distance + route.length / 2) - route.length / 2,
      );
      const needed = STATION_GAP + crossing.halfGap;
      if (along < needed) {
        complaints.push(
          `the crossing at (${fmt([crossing.x, crossing.z])}) opens its fence gap ` +
            `${along.toFixed(1)} m along the loop from a station platform — its ` +
            `${crossing.halfGap.toFixed(1)} m half-gap overlaps the station's sealed ` +
            `±${STATION_GAP} m window, so the far side of this crossing is a fenced wall`,
        );
      }
    }
  }

  if (crossings.length > 0 && train.bridges.length === 0) {
    complaints.push(
      `the park has ${crossings.length} railway crossing(s) and not one real bridge — ` +
        'every per-bridge check above is passing vacuously',
    );
  }

  return complaints;
};

/**
 * **The walk in from the gate meets the railway only where the crossing
 * planner planned it to — and on a bridge wherever the planner proved one
 * fits.** Issue #339, and the thing that was actually asked for.
 *
 * Jim, on the live park: *"I opened and no bridges."* The park had two,
 * rendering correctly, walkable, 25.7 m and 80.5 m away down side spurs. The
 * one crossing he *did* meet — 19.8 m inside the gate, on the only route
 * anyone walks — was flat, and it was flat because the gate corridor was
 * authored rather than routed and so met the loop wherever the loop happened
 * to be. On the canonical seed that was `railDistance` 148.8, 46 deg off
 * square, **a point `train/crossingPlanSolve.ts` had already marched and
 * rejected for both tiers**: not a bridge site, not even a level site.
 *
 * That is the defect, stated precisely. `crossingPlanSolve.ts`'s promise, in
 * its own words, is that *"`paths.ts` routes every rail-crossing leg through
 * one of these `CROSSING_SITES`, square to the track, so the drawn network
 * only ever meets the railway where a bridge belongs."* Every leg in the park
 * kept that promise except the one every player walks, and nothing could see
 * it: `crossingsArePlannedAndWalkable` asks nothing about *which* crossing a
 * route uses (and, until #349, the clause it did have counted bridges against
 * fallbacks across the whole park, which two bridges against one fallback
 * passed comfortably) — which is exactly the park that produced the bug
 * report. What
 * reaches a player is not the ratio. It is which crossing is on *her* route,
 * and there is only one route every player takes.
 *
 * So this measures that route on the built park — the arch, the esplanade,
 * and the drawn `gate-approach` ribbon, densified to half a metre and marched
 * against the solved loop — and holds it to the same promise as everything
 * else:
 *
 * 1. **Every place she crosses is a planned site.** Within
 *    `crossings.ts`'s own `SITE_SNAP_TOLERANCE`, carried on the facts rather
 *    than restated here. An unplanned crossing at the front door is issue
 *    #339 exactly, and the complaint names the planner's own site lists so
 *    the next reader can see what it went past.
 * 2. **Where that site is a bridge site, a bridge really stands there.** The
 *    planner proving a bridge fits and the park not building one is the
 *    regression that has happened before (`crossings.ts` records the
 *    canonical seed losing "sites 172/228 both"), and at the entrance it is
 *    indistinguishable, to a child, from the park having no bridges at all.
 *
 * **The level tier this note used to describe is gone** (2 Sep 2026: every
 * crossing is a bridge, the ability to plan a level crossing no longer
 * exists). Seed 11's entrance used to land on that tier's railDistance 30;
 * with the tier empty its network re-routes through a proven bridge site
 * and both park gates pass — measured before the deletion
 * (feat/park-warp-solver, measurements/). Clause 1 still holds every seed
 * to the plan, which is
 * the part that was broken.
 *
 * Of the five swept seeds, the canonical one, 5 and 11 cross on the way in
 * and exercise this; 2 and 18 walk in without meeting the track at all.
 */
const GATE_WALK_STRIDE = 0.5;

const theWalkInFromTheGateCrossesWhereItWasPlannedTo: Invariant = (facts) => {
  const complaints: string[] = [];
  const train = facts.world.train;
  const route = train.route;

  const approach = facts.pathEdges.find((edge) => edge.name === 'gate-approach');
  if (!approach) {
    complaints.push(
      'the park drew no `gate-approach` ribbon, so there is no walk in from the gate to ' +
        'measure — every clause below is passing over an empty list',
    );
    return complaints;
  }

  // The arch first, then the drawn ribbon: the few metres between the two are
  // the esplanade, which nothing draws, and they are part of the walk.
  const corners: (readonly [number, number])[] = [
    [ENTRANCE_GATE_X, ENTRANCE_GATE_Z],
    ...approach.points,
  ];
  const walk: (readonly [number, number])[] = [corners[0] as readonly [number, number]];
  for (let i = 1; i < corners.length; i += 1) {
    const a = corners[i - 1] as readonly [number, number];
    const b = corners[i] as readonly [number, number];
    const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(span / GATE_WALK_STRIDE));
    for (let step = 1; step <= steps; step += 1) {
      walk.push([a[0] + ((b[0] - a[0]) * step) / steps, a[1] + ((b[1] - a[1]) * step) / steps]);
    }
  }

  const at = new Vector3();
  const tangent = new Vector3();
  const railSide = (x: number, z: number): number => {
    const distance = route.distanceNear(x, z);
    route.pointAt(distance, at);
    route.tangentAt(distance, tangent);
    return Math.sign(tangent.z * (x - at.x) - tangent.x * (z - at.z)) || 1;
  };
  const alongLoop = (a: number, b: number): number =>
    Math.abs(route.wrap(a - b + route.length / 2) - route.length / 2);
  const nearestOf = (distance: number, sites: readonly number[]): number | null => {
    let best: number | null = null;
    for (const site of sites) {
      if (best === null || alongLoop(distance, site) < alongLoop(distance, best)) best = site;
    }
    return best;
  };
  const list = (sites: readonly number[]): string =>
    sites.length === 0 ? 'none' : sites.map((site) => site.toFixed(1)).join(', ');

  let previous = walk[0] as readonly [number, number];
  let previousSide = railSide(previous[0], previous[1]);
  let walked = 0;
  for (let i = 1; i < walk.length; i += 1) {
    const here = walk[i] as readonly [number, number];
    walked += Math.hypot(here[0] - previous[0], here[1] - previous[1]);
    const side = railSide(here[0], here[1]);
    previous = here;
    if (side === previousSide) continue;
    previousSide = side;

    const midX = (here[0] + (walk[i - 1] as readonly [number, number])[0]) / 2;
    const midZ = (here[1] + (walk[i - 1] as readonly [number, number])[1]) / 2;
    const railDistance = route.distanceNear(midX, midZ);
    const where =
      `at (${fmt([midX, midZ])}), railDistance ${railDistance.toFixed(1)}, ` +
      `${walked.toFixed(1)} m in from the arch`;

    const bridgeSite = nearestOf(railDistance, facts.plannedBridgeSiteDistances);
    const onBridgeSite =
      bridgeSite !== null && alongLoop(railDistance, bridgeSite) <= facts.crossingSiteSnapTolerance;

    if (!onBridgeSite) {
      complaints.push(
        `the walk in from the gate crosses the railway ${where}, and the crossing planner ` +
          `proved no bridge there — its bridge sites are at ${list(facts.plannedBridgeSiteDistances)}, ` +
          'and every crossing must be a bridge (there is no level tier, 2 Sep 2026), so this leg ' +
          'meets the track somewhere `crossingPlanSolve.ts` never proved',
      );
      continue;
    }

    const bridged = train.bridges.some((bridge) => bridge.deckCovers(midX, midZ));
    if (bridged) continue;
    const onTheHump = train.bridges.some((bridge) => bridge.covers(midX, midZ));
    complaints.push(
      `the walk in from the gate crosses the railway ${where}, on site ` +
        `${(bridgeSite as number).toFixed(1)} which the crossing planner proved a bridge fits ` +
        `on, and ` +
        (onTheHump
          ? "a bridge's hump reaches it but its deck does not"
          : 'no bridge deck stands over it') +
        ` (the park has ${train.bridges.length} bridge(s) for ${train.crossings.length} ` +
        'crossing(s)) — this is the one route every player walks, so a flat crossing here is ' +
        'the park having no bridges as far as she is concerned',
    );
  }

  return complaints;
};

/**
 * **Is the cat bus actually in the park?**
 *
 * This is the invariant the repo did not have, and its absence is the whole
 * story of issue #245. The arrival merged on 26 July 2026 as PR #27 — six new
 * files under `world/entrance/`, no `Game.ts`, no `main.ts`, no call site
 * anywhere. `Entrance` was never constructed, `createCatBus` had no importers,
 * and the identifier `cat-bus` did not appear in the shipped bundle at all.
 * Two hundred tests and thirty-odd `check:*` scripts stayed green for twelve
 * days, and all five of those files could have been deleted without a single
 * one of them noticing. Jim found it the only way it could be found: *"I've
 * never seen the cat bus, I don't think it works."*
 *
 * So this asks the one question none of them asked — **is the thing there?** —
 * of the built scene graph, not of the code that was supposed to build it. It
 * goes red if `World` stops constructing `Entrance`, if `Entrance` stops
 * constructing the arrival, if the arrival stops adding the bus to a group that
 * reaches the scene, or if the bus is built with no geometry on it.
 *
 * Thresholds are deliberately loose and physical: this is not a test of where
 * the choreography puts the bus frame by frame (`scripts/check-cat-bus.mts`
 * drives that), it is a test that a bus exists, has a body, has its driver and
 * its passengers, and is standing at the gate rather than at the origin.
 */
/**
 * **A crossing standing on ground the planner proved bridgeable really
 * carries a bridge — and at least one crossing does.** Issue #339.
 *
 * `crossingsArePlannedAndWalkable` above catches a park that built no bridge
 * at all. It does not ever consult the plan — so it cannot see the failure
 * that actually reaches a player: **a crossing quietly sliding off a site
 * `crossingPlanSolve.ts` had already proved a bridge fits on.** That module
 * exists precisely to make that impossible ahead of time; this asks whether
 * the promise was kept afterwards, on the built park.
 *
 * It is the check issue #339 went looking for: a whole class of "the browser
 * built no bridges" failures — the crossing-plan letterbox
 * (`train/crossingPrewarm.ts`) handing back an empty plan, the sliced solve in
 * `boot/parkGeneration.ts` finishing early, `paths.ts` losing its crossing-site
 * lattice edges — all land as *the park's crossings standing on none of the
 * planned sites*, which clause 1 below reports by name rather than by silently
 * making every per-bridge loop in this file iterate over nothing.
 *
 * **How much it covers varies by seed, and it says so on every run** — see the
 * `[proven-site cover]` line it prints. Since #374 tied `MAX_RAMP_GRADIENT` to
 * what a sprinting child can actually climb, fewer sites are provable: across
 * the five seeds the crossings this invariant examines fell from 8 to 4, and on
 * **seed 2 `plannedBridgeSiteDistances` is empty**, so the whole check
 * early-returns and asserts nothing at all. That is not a defect — a park with
 * no proven bridge sites has no promise to keep — but a check that quietly
 * stops checking must announce it, or the next reader takes green for cover.
 *
 * Two clauses:
 *
 * 1. **The plan reached the park at all.** If the planner made any sites, at
 *    least one built crossing stands on one of them. **Every planned site
 *    counts, bridge and level alike**: this clause asks whether the plan
 *    arrived, and `paths.ts` routes legs where the park needs to cross and
 *    takes whichever site is nearest — so a bridge site on a stretch no leg
 *    wants goes unused, and the plan has still arrived perfectly. Demanding a
 *    crossing on a *bridge* site conflated the two, and called seed 18's
 *    perfectly on-plan park (crossings on planned level sites 104.0 and 238.0)
 *    a plan that never arrived.
 * 2. **A crossing on a proven site is bridged.** `bridgeFootprint.ts`'s late,
 *    real, backtracking search is allowed to fall back to a level crossing
 *    where a genuine obstacle arrived after planning — but not on ground the
 *    planner measured as clear against the boundary, the plots, the stations
 *    and the rail's own corridor. That regression has happened before and was
 *    found by eye rather than by a check: `crossings.ts`'s own comment records
 *    the canonical seed losing "sites 172/228 both" to a re-derived
 *    perpendicular jittering a metre or two off the site.
 *
 * A crossing that never stood on a planned bridge site is **not** this
 * invariant's business, and is deliberately not complained about: the walk
 * in from the gate is a fixed corridor rather than a routed leg, so it meets
 * the loop wherever the loop happens to be, and on the canonical seed that
 * is `railDistance` 148.8 — 46° off square, unbridgeable, and correctly a
 * level crossing. Whether the park's front door *should* be exempt from the
 * plan is a design question (issue #339's own finding), not something this
 * file can assert its way out of.
 *
 * Matching is by rail distance, not by position: `crossings.ts` copies a
 * snapped site's `railDistance` across verbatim, so a crossing that really is
 * a planned site carries that site's exact number. The tolerance below is
 * therefore floating-point slack, not a search radius.
 */
const SITE_IDENTITY_TOLERANCE = 0.01;

const everyProvenBridgeSiteKeepsItsBridge: Invariant = (facts) => {
  const complaints: string[] = [];
  const train = facts.world.train;
  const planned = facts.plannedBridgeSiteDistances;

  // **Say how far this check reaches, every run.** Its cover is a function of
  // how many sites the planner could prove, which #374 changed — so a silent
  // pass can mean "every promise kept" or "there were no promises". Printing
  // the reach is what stops the second being read as the first, the way
  // `check:castle` announces its missing-prop assertions on every run.
  const announce = (examined: number): void => {
    const detail =
      planned.length === 0
        ? 'the planner proved NO bridge sites on this seed, so this invariant asserts nothing'
        : `${examined} of ${train.crossings.length} built crossing(s) stand on one of ` +
          `${planned.length} proven bridge site(s)` +
          (examined === 0 ? ' — so clause 2 asserts nothing' : '');
    // `process.stderr` rather than `console.log`: vitest's default reporter
    // hides console output from *passing* tests, and a coverage note nobody
    // sees unless they already suspected something is worth nothing.
    process.stderr.write(`[proven-site cover] ${detail}\n`);
  };

  if (planned.length === 0) {
    announce(0);
    return complaints;
  }

  const onSite = (crossing: { railDistance: number }, sites: readonly number[]): boolean =>
    sites.some((d) => Math.abs(d - crossing.railDistance) <= SITE_IDENTITY_TOLERANCE);

  // **Clause 1 asks whether the plan arrived, so it must count every site the
  // plan made — level as well as bridge.**
  //
  // It used to demand a built crossing on a *bridge* site specifically, which
  // conflates two different things: "the plan reached the park" (what this
  // clause is for, and what the prewarm-letterbox class of failure breaks) and
  // "some leg chose to cross at a bridge site" (which nothing promises).
  // `paths.ts` routes legs where the park needs to cross and takes whichever
  // site is nearest; if no leg happens to want the stretch a bridge site sits
  // on, that site goes unused, and the plan has still arrived perfectly.
  //
  // Found on seed 18 once {@link MAX_RAMP_GRADIENT} started refusing ramps too
  // steep to sprint up (#374): the seed's proven bridge sites fell from three
  // to one, at railDistance 176.0, and its two built crossings sit on the
  // planned *level* sites 104.0 and 238.0 — exactly on plan, and this clause
  // called it "the crossing plan did not reach the park". Widening it to every
  // planned site keeps the failure it exists for — an empty or lost plan puts
  // no crossing on any site at all — while no longer asserting a promise the
  // router never made.
  const allPlanned = planned;
  if (!train.crossings.some((crossing) => onSite(crossing, allPlanned))) {
    complaints.push(
      `the crossing planner proved ${planned.length} bridge site(s) on this loop ` +
        `(at railDistance ${allPlanned.map((d) => d.toFixed(1)).join(', ')}) and not one of the ` +
        `park's ${train.crossings.length} built crossing(s) stands on any of them ` +
        `(they sit at ${train.crossings.map((c) => c.railDistance.toFixed(1)).join(', ') || 'nowhere — there are none'}) — ` +
        'the crossing plan did not reach the park, so every per-bridge check here is ' +
        'iterating over nothing',
    );
    return complaints;
  }

  const onPlannedSite = train.crossings.filter((crossing) => onSite(crossing, planned));
  announce(onPlannedSite.length);

  // **Every crossing, not just the ones on a planned site** — a crossing
  // off every proven site is itself the defect now (there is no level tier
  // for it to be standing on, 2 Sep 2026), and a crossing without a deck
  // is a fence gap onto live rails.
  for (const crossing of train.crossings) {
    const onProven = onSite(crossing, planned);
    const deckOverIt = train.bridges.some((bridge) => bridge.deckCovers(crossing.x, crossing.z));
    if (!onProven || !deckOverIt) {
      complaints.push(
        `the crossing at (${fmt([crossing.x, crossing.z])}), railDistance ` +
          `${crossing.railDistance.toFixed(1)}, ${
            !onProven
              ? 'stands on no site the crossing planner ever proved a bridge fits on'
              : 'stands on a proven site and no built bridge deck covers it'
          } — every crossing must be a bridge; ` +
          `the park has ${train.bridges.length} bridge(s) for ${train.crossings.length} crossing(s)`,
      );
    }
  }

  return complaints;
};

/**
 * **No bridge stands where the crossing planner proved none fits.** The
 * converse of {@link everyProvenBridgeSiteKeepsItsBridge}, and the direction
 * that was missing.
 *
 * `crossingPlanSolve.ts` marches the loop and keeps only ground a deck and
 * both ramps demonstrably fit on (`CROSSING_SITES`); everything else it
 * looked at and rejected. `bridgeFootprint.ts`'s late `planReal` sweep then
 * used to search *every* crossing for a deck regardless of which tier it came
 * from — and where it found one on the rejected tier, it built ramps whose
 * ground nothing had reserved. `paths.ts` keeps other legs off a *proven*
 * site's ramps (it knows their reach from the site); it cannot keep them off
 * ramps at a site that was never proven, because there is no reach to read.
 *
 * What that cost, measured on the canonical seed before the fix: bridges at
 * railDistance 202 and 306, both level sites, their 2 m parapet panels
 * standing across `spur-dodgems`, `spur-stall.dodgems` and
 * `spur-stall.waterFight`, and twenty waypoints stranded on ground a child
 * can otherwise reach — `check:park`'s `poi.stranded: 20`. The paths were
 * routed correctly through those crossings; the bridge built on top of them
 * is what severed them.
 *
 * **Proved red by mutation** when it was written: `LGP_ALLOW_UNPROVEN_BRIDGES=1`
 * restored the old search and this went red on the canonical seed with two
 * bridges named (geometry of that proof: canonical loop 361.8 m, proven
 * sites at railDistance 0, 234, 336, level sites at 70, 116, 166, 202,
 * 306). That reversal lever was deleted with the level tier (2 Sep 2026) —
 * `crossings.ts` now fails the build before an unproven crossing can even
 * reach the bridge search — so this invariant stands as the measured
 * backstop on the built park should that construction ever regress.
 *
 * Measured off the built park (`facts.world.train`), never off the planner:
 * a bridge's deck is asked which built crossing it covers, and that
 * crossing's `railDistance` is compared with the site distances the facts
 * already carry.
 */
const noBridgeStandsWhereNoneWasProven: Invariant = (facts) => {
  const complaints: string[] = [];
  const train = facts.world.train;
  const proven = facts.plannedBridgeSiteDistances;

  // Same announcement discipline as its converse: a seed with no bridges is
  // a silent pass here, and that must not read as "every bridge checked".
  process.stderr.write(
    `[unproven-bridge cover] ${train.bridges.length} built bridge(s) against ` +
      `${proven.length} proven site(s) on this seed` +
      (train.bridges.length === 0 ? ' — this invariant asserts nothing' : '') +
      '\n',
  );

  for (const crossing of train.crossings) {
    const bridged = train.bridges.some((bridge) => bridge.deckCovers(crossing.x, crossing.z));
    if (!bridged) continue;
    const onProvenSite = proven.some(
      (d) => Math.abs(d - crossing.railDistance) <= SITE_IDENTITY_TOLERANCE,
    );
    if (onProvenSite) continue;
    complaints.push(
      `a bridge deck stands over the crossing at (${fmt([crossing.x, crossing.z])}), ` +
        `railDistance ${crossing.railDistance.toFixed(1)}, which is not one of the ` +
        `${proven.length} site(s) the crossing planner proved a bridge fits on ` +
        `(${proven.map((d) => d.toFixed(1)).join(', ') || 'none at all'}) — so its ramps ` +
        'stand on ground nobody measured and nothing reserved, and the paths routed ' +
        'through this crossing are free to be severed by its own parapets',
    );
  }

  return complaints;
};

/**
 * **Is there actually a hole in the wall at the gate?**
 *
 * Issue #195. The gate-gap predicate sat in `entrance/layout.ts` from the day the
 * entrance was written with **zero callers anywhere**, so the gate was a gate in
 * name only: an arch stood over unbroken masonry, with an unbroken collision
 * polygon behind it. `buildBoundaryWall`'s own comment said "the wall is solid",
 * and it was. Jim found it the way it was always going to be found — by
 * watching a bus drive through it.
 *
 * This measures the **built** wall: every block instance the boundary actually
 * placed, against the opening the gate claims to have. A predicate saying "the
 * walkers pass through the gate's angle" is not this, and does not catch it —
 * that stays true whether or not there is any stone in the way, which is
 * precisely how the first version of this guard passed with the gap closed
 * again.
 */
const theGateIsAHoleInTheWall: Invariant = (facts) => {
  const blocks: { x: number; z: number }[] = [];
  const local = new Matrix4();
  const composed = new Matrix4();
  const centre = new Vector3();
  facts.world.garden.group.traverse((object) => {
    if (!(object instanceof InstancedMesh)) return;
    if (!/^boundary-(blocks|pillars)?/.test(object.name) && object.name !== 'boundary-blocks') return;
    for (let i = 0; i < object.count; i += 1) {
      object.getMatrixAt(i, local);
      composed.multiplyMatrices(object.matrixWorld, local);
      centre.setFromMatrixPosition(composed);
      blocks.push({ x: centre.x, z: centre.z });
    }
  });

  if (blocks.length === 0) return ['found no boundary wall blocks at all to measure'];

  const fouls: string[] = [];
  // **Tested at the block's own extent, not its centre — and the extent is
  // derived from the geometry, never from the rule being checked.**
  //
  // This filtered on the centre, blind to the very thing `Garden.ts`'s
  // `DRAWN_BLOCK_GATE_MARGIN` exists to add: a station is where a block's
  // *middle* goes and the block is `BOUNDARY_BLOCK_WIDTH` long lying along the
  // edge, so the last kept block reached into the opening by up to its own
  // half-length and nothing said so.
  //
  // The first attempt at this fix read `DRAWN_BLOCK_GATE_MARGIN` itself, which
  // is worse than useless: zeroing that constant then moved the wall *and this
  // clause together* and the suite stayed at 520/520 with stone back in the
  // doorway. So the expectation is rebuilt here from the two facts about the
  // built wall — how long a block is and how thick the masonry is — and it
  // holds whatever policy `Garden.ts` adopts.
  //
  // Read off `facts`, never imported: a static import of `Garden.ts` into this
  // file loads `parkManifest.ts` before the seed is set and pins every seed to
  // the default park. Measured — it did, and the tell was the *pass* count:
  // 4 files red, **332 skipped**, 188 passed. `parkFacts.ts` reaches Garden
  // through an `await import` after the park exists, which is the whole reason
  // that pattern is there.
  const blockReach = facts.boundaryBlockWidth / 2 + facts.masonryHalfWidth;
  const inGap = blocks.filter((b) => isInEntranceGateOpening(b.x, b.z, blockReach));
  if (inGap.length > 0) {
    const worst = inGap[0];
    fouls.push(
      `${inGap.length} boundary wall blocks stand inside the gate opening, e.g. ` +
        `${fmt([worst?.x ?? 0, worst?.z ?? 0])} — the gate is solid stone (#195)`,
    );
  }

  // And the hole is wide enough to walk through: the nearest stone either side
  // of the gate centre must leave more than a child's width between them.
  let nearest = Infinity;
  for (const b of blocks) {
    nearest = Math.min(nearest, Math.hypot(b.x - 0, b.z - ENTRANCE_GATE_Z));
  }
  if (nearest < PLAYER_RADIUS * 2) {
    fouls.push(
      `the closest wall block sits ${nearest.toFixed(2)} m from the middle of the gate — ` +
        `a child of ${PLAYER_RADIUS} m cannot get through`,
    );
  }
  return fouls;
};

/**
 * **A child can walk in through the front gate.**
 *
 * Issue #481. The gate is the one fixed thing in the park; the railway, the
 * paths, the plots and the scenery are all drawn afresh from the seed. So the
 * front door is exactly where "two definitions of one thing" bites, and it bit:
 * measured on `main` at `bd818210`, the railway's lineside fence ran across the
 * opening 2.3 m inside the arch on pool seed 288, and **through the arch itself
 * on sweep seed 18** — `(-1.13, 59.87) -> (1.43, 58.85)`, a 0.18 m fence, with
 * its 1.3 m track escort 3 m behind it. The obstacle field the loop is grown
 * against (`train/route.ts`'s `trainObstacles`) knew every plot in the park and
 * the Sky Cruiser's dismount point, and had never been told the park had a way
 * in.
 *
 * {@link theGateIsAHoleInTheWall} above is the *other* half of this and does not
 * cover it: it asks whether the boundary masonry leaves a gap, and on both
 * failing seeds it correctly answered yes. The gap was there; something else was
 * standing in it two metres further on.
 *
 * The measurement lives in `entrance/gatewayWalk.ts` rather than here, because
 * `scripts/check-gateway.mts` asks the same question of all sixteen seeds a
 * child can be given — 288 is not one of this suite's five — and shipping the
 * fix for a two-definitions bug as two definitions would be the same mistake.
 *
 * **Never probe the gate line itself**: the soft boundary holds a child inside
 * the park, so a `PLAYER_RADIUS` body on `z = 60` overlaps the outside and reads
 * blocked whatever the gate does — 33 of 33 probes across it on the canonical
 * seed. The walk starts a metre in, and the gate posts are the control that says
 * the probe can see solid ground at all.
 */
const theWalkInFromTheGateIsWalkable: Invariant = (facts) => {
  const walk = measureGatewayWalk((x, z) => facts.isStandable(x, z, PLAYER_RADIUS));
  const fouls: string[] = [];

  // The control first, and asserted rather than printed: if the arch's own
  // posts are not solid, this probe is not measuring the park and the clause
  // below proves nothing.
  const toGate = Math.hypot(ENTRANCE_GATE_X, ENTRANCE_GATE_Z) || 1;
  const inX = -ENTRANCE_GATE_X / toGate;
  const inZ = -ENTRANCE_GATE_Z / toGate;
  // Across the gateway is the perpendicular of the way in, so the posts are
  // found from the gate itself rather than from an assumption that the gate is
  // on the x axis.
  for (const side of [-1, 1] as const) {
    const x = ENTRANCE_GATE_X + inX + -inZ * side * ENTRANCE_GATE_HALF_WIDTH;
    const z = ENTRANCE_GATE_Z + inZ + inX * side * ENTRANCE_GATE_HALF_WIDTH;
    if (facts.isStandable(x, z, PLAYER_RADIUS)) {
      fouls.push(
        `CONTROL: the gate post at ${fmt([x, z])} is not solid — the walkability probe is ` +
          'measuring nothing, so its verdict on the doorway means nothing either',
      );
    }
  }

  if (walk.standableCells === 0) {
    fouls.push(
      `nowhere for a child to stand ${GATE_PROBE_INSET} m inside the arch — the doorway is ` +
        'shut on its own threshold',
    );
  } else if (!walk.open) {
    fouls.push(
      `the walk in from the arch stops ${walk.reachedDepth.toFixed(1)} m inside it; nothing ` +
        `connects that to the ${ENTRANCE_WALK_DEPTH} m mark within the arch's own ` +
        `${(2 * ENTRANCE_GATE_HALF_WIDTH).toFixed(1)} m width. The corridor, ` +
        `'.' walked, 'o' open but cut off, '#' no room:\n${walk.map.join('\n')}`,
    );
  }

  // **On stderr, on every run, including the passing ones** — vitest's default
  // reporter hides console output from passing tests, which is precisely when a
  // coverage note matters. What this does *not* cover: everything past
  // `ENTRANCE_WALK_DEPTH`. The railway may legitimately ring the park between
  // the gate and the plaza and the walk crosses it at a crossing; whether that
  // walk connects all the way is `check:park`'s routing invariant.
  process.stderr.write(
    `[gateway walk] ${walk.standableCells}/${walk.cells} of the corridor standable, ` +
      `walked to ${walk.reachedDepth.toFixed(1)} m of ${ENTRANCE_WALK_DEPTH} m. ` +
      'Asserts nothing about the ground past that, nor about headroom under the arch.\n',
  );

  return fouls;
};

/**
 * **The road reaches the gate, and stays out of the park except through it.**
 *
 * Jim, 7 August 2026: *"it doesn't actually drive up to the park, the road needs
 * to actually go to the park."* There was no road at the entrance at all — the
 * bus pulled up on grass.
 *
 * There is one now (`Entrance.ts`'s `buildEntranceRoad`), and it has to satisfy
 * two things that pull against each other, which is why this is an invariant
 * rather than a one-seed check:
 *
 * 1. **It must reach the gate**, and go *through* it, or the park is somewhere
 *    the road merely stops near.
 * 2. **It must not sprawl into the park** anywhere else. The boundary is a
 *    spline pinned to 60 m on the gate's bearing and bulging to 92 m within 40
 *    degrees of it (#115), so a straight kerb road outside the gate curves back
 *    *inside* the park at both ends of its run. `buildEntranceRoad` walks
 *    outward and stops where that would happen — and how far it gets is
 *    different on every seed, because the spline is different on every seed.
 *    That is exactly the shape of thing that works on the canonical seed and
 *    quietly fails on a sweep one.
 *
 * Measured off the built road's own world vertices. A version comparing
 * `ENTRANCE_BUS_STOP_Z` against itself would pass on a park with no road in it.
 */
const theRoadArrivesAtTheParkAndGoesIn: Invariant = (facts) => {
  const points: { x: number; z: number }[] = [];
  const at = new Vector3();
  facts.world.entrance.group.traverse((object: Object3D) => {
    if (!(object instanceof Mesh)) return;
    if (!object.name.startsWith('entrance-road')) return;
    const position = object.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i += 1) {
      at.set(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(object.matrixWorld);
      points.push({ x: at.x, z: at.z });
    }
  });

  if (points.length === 0) {
    return ['there is no road at the park entrance at all — the cat bus arrives on grass'];
  }

  const fouls: string[] = [];

  let toTheGate = Infinity;
  for (const p of points) {
    toTheGate = Math.min(toTheGate, Math.hypot(p.x - ENTRANCE_GATE_X, p.z - ENTRANCE_GATE_Z));
  }
  // The road's own segment length is the finest resolution a vertex can land
  // at; anything tighter asserts on where the tessellation happened to fall.
  if (toTheGate > ROAD_TILE_METRES / 2) {
    fouls.push(
      `the nearest the road gets to the gate is ${toTheGate.toFixed(1)} m — it does not reach the park`,
    );
  }

  // `facts.boundary`, not a static `PARK_BOUNDARY` import: that constant is
  // solved at module scope from the seed, and importing it here would pin all
  // five seeds to the canonical park — CLAUDE.md's 76-silent-skips trap.
  // `distanceToEdge` is positive inside the park.
  const inside = points.filter((p) => facts.boundary.distanceToEdge(p.x, p.z) > 0);
  if (inside.length === 0) {
    fouls.push('no part of the road is inside the park — it stops at the wall rather than going in');
  }

  // **Everything inside the park runs between the arch's posts.**
  //
  // Measured as perpendicular distance from the gate's own radial axis. This
  // clause worked that out for itself before there was anywhere to put it —
  // the old angular predicate was "the right question at the wall and the wrong
  // one further in: a constant angle is a corridor that narrows as it
  // approaches the plaza, so the spur's far corners, 8 m inside the park and
  // perfectly between the posts, fell outside it by 0.0017 rad". That reasoning
  // is exactly #481's, reached here first; it now reads the one owner
  // (`entranceGateFrame`) rather than being a third hand-rolled copy of the
  // same axis. The posts stand at `ENTRANCE_GATE_HALF_WIDTH` either side, so
  // that is the width the road may not exceed anywhere.
  const offAxis = (p: { x: number; z: number }): number =>
    Math.abs(entranceGateFrame(p.x, p.z).across);
  const trespassing = inside.filter((p) => offAxis(p) > ENTRANCE_GATE_HALF_WIDTH);
  if (trespassing.length > 0) {
    const worst = trespassing[0];
    fouls.push(
      `${trespassing.length} road vertices inside the park stand more than ` +
        `${ENTRANCE_GATE_HALF_WIDTH} m off the gate's axis, e.g. ${fmt([worst?.x ?? 0, worst?.z ?? 0])} at ` +
        `${offAxis(worst ?? { x: 0, z: 0 }).toFixed(2)} m — the road is not going through the arch, it is ` +
        'spilling across the park',
    );
  }

  return fouls;
};

/**
 * **Every child fits in the seat they are sitting in.**
 *
 * `catBus.ts` says, in large friendly letters, that *"the bus is sized by what
 * it has to hold, not by a number picked by eye"*. That was half true: the
 * height was honestly derived from `TALLEST_CHILD_HEIGHT`, and the **seat plan
 * was not derived from anything at all**, because `kid.ts` published no width
 * for anyone to derive from. A real child is 1.53 m across — a chibi rig is
 * almost all head — against a seat pitch of 1.0 m, so all twelve passengers
 * overlapped the child behind them by 0.52 m and stuck through the bodywork.
 * Jim saw it the first time he watched: *"the bus far too small to hold that
 * many child models at their size"*.
 *
 * The old check counted seats and counted occupants, and passed throughout.
 *
 * This measures three things off real models, none of them restated from the
 * constants that positioned them:
 *
 * 1. **`CHILD_FOOTPRINT` still covers a real child**, hair x hats, so adding a
 *    wider hairstyle turns this red rather than quietly shrinking everybody's
 *    personal space. (The sun hat is excluded by design — see the constant.)
 * 2. **Twelve children in the twelve built seats are inside the built cabin**,
 *    measured against the two named shell bands rather than against
 *    `BODY_WIDTH`.
 * 3. **No two of them are inside each other.**
 *
 * Seed-independent — the bus is the same on every seed — but it costs nothing
 * to run here and this is the file CLAUDE.md sends anyone changing the park to.
 */
const childrenFitTheSeatsTheySitIn: Invariant = (facts) => {
  const bus = facts.catBus;
  if (!bus) return [];

  const fouls: string[] = [];

  if (bus.widestRealChild > CHILD_FOOTPRINT) {
    fouls.push(
      `CHILD_FOOTPRINT is ${CHILD_FOOTPRINT} m but the widest bare-headed child the park ` +
        `can build measures ${bus.widestRealChild.toFixed(3)} m — raise it in kid.ts, ` +
        'because the cat bus\u2019s seat plan and the crowd\u2019s separation both derive from it',
    );
  }

  if (bus.worstOccupantProtrusion > 0) {
    fouls.push(
      `a seated child sticks ${bus.worstOccupantProtrusion.toFixed(2)} m out through the cat ` +
        'bus\u2019s own bodywork — the bus is smaller than the children it is documented ' +
        'as being sized around',
    );
  }

  if (bus.worstOccupantOverlap > 0) {
    fouls.push(
      `two children sitting in the cat bus overlap each other by ` +
        `${bus.worstOccupantOverlap.toFixed(2)} m — the seat plan is tighter than a child is wide`,
    );
  }

  return fouls;
};

const theCatBusIsInThePark: Invariant = (facts) => {
  const bus = facts.catBus;
  if (!bus) {
    return [
      'no node named `cat-bus` anywhere in the built scene — the arrival is not wired in. ' +
        'This is exactly the state PR #27 shipped in and nothing caught for twelve days; ' +
        'see `world/entrance/ArrivalSequence.ts`.',
    ];
  }

  const fouls: string[] = [];
  // A bus made of nothing would satisfy "a node called cat-bus exists".
  if (bus.meshCount < 20) {
    fouls.push(`the cat bus has only ${bus.meshCount} meshes on it — that is not a built bus`);
  }
  // Big enough to be a bus, measured against the children who ride in it rather
  // than against a literal — so it stays true if they are ever resized. Jim, on
  // the first version anyone saw: "barely bigger than a child, and smaller
  // vertically than one child with a hat".
  if (bus.height <= TALLEST_CHILD_HEIGHT * 1.4) {
    fouls.push(
      `the cat bus is ${bus.height.toFixed(2)} m tall against a ${TALLEST_CHILD_HEIGHT} m ` +
        'child in a hat — that is a shed, not a bus',
    );
  }
  if (bus.height >= TALLEST_CHILD_HEIGHT * 2.6) {
    fouls.push(`the cat bus is ${bus.height.toFixed(2)} m tall, which is too big even for a bus`);
  }
  if (!bus.hasDriver) fouls.push('the cat bus has nobody driving it');
  // Every seat but hers. Both numbers measured off the built park — the seat
  // count from the bus that was built, the passenger count from how many of the
  // crowd are actually under the arrival's control.
  if (bus.kidCount !== bus.seatCount - 1) {
    fouls.push(
      `expected ${bus.seatCount - 1} other children to arrive with her, found ` +
        `${bus.kidCount} under the arrival\u2019s control`,
    );
  }

  // Waiting on the kerb outside the gate, where the sequence starts. A bus left
  // at the origin is in the middle of the ball pit.
  const kerbGap = Math.hypot(bus.x - ENTRANCE_BUS_ARRIVE_X, bus.z - ENTRANCE_BUS_STOP_Z);
  if (kerbGap > 1) {
    fouls.push(
      `the cat bus starts at ${fmt([bus.x, bus.z])}, ${kerbGap.toFixed(2)} m from the kerb ` +
        `${fmt([ENTRANCE_BUS_ARRIVE_X, ENTRANCE_BUS_STOP_Z])} it is supposed to pull in from`,
    );
  }

  // **And it is outside the park.** Jim, watching the first run: "the bus drives
  // something like 5 m into the park, through a wall". `distanceToEdge` is
  // positive inside the boundary, so anything at or above zero is a bus
  // somewhere a bus has no business being.
  const inside = facts.boundary.distanceToEdge(bus.x, bus.z);
  if (inside >= 0) {
    fouls.push(
      `the cat bus is parked ${inside.toFixed(2)} m INSIDE the park boundary — it belongs on ` +
        'the road outside the gate',
    );
  }
  return fouls;
};

/**
 * **Can the bus actually stop here, and can she actually walk in?**
 *
 * `entrance/layout.ts` has exported `ENTRANCE_CLEAR_X/Z/RADIUS` since the
 * entrance was written, under a comment saying they keep the scatter off the
 * stop and the gate plaza — and **nothing imported them**. The comment
 * described an intention that no code implemented, so trees and bushes were
 * free to grow in the road the bus parks in and on the ground she is set down
 * on. `Scenery.ts` now asks them; this is what proves it kept asking.
 *
 * Measured against the **game's** numbers rather than the generator's target,
 * per this file's rule 2: what has to be true is that a child set down here can
 * stand and walk away, not that the scatter respected some particular radius.
 * The corridor sampled is the real one — from where the bus parks, round to
 * where she is handed the controls.
 *
 * **{@link DROP_OFF_CLEAR} was measured, not guessed.** A bare `PLAYER_RADIUS`
 * was the first threshold written here and it was **vacuous**: with the keep-out
 * deliberately removed, all five seeds still passed, because the nearest bush to
 * her spawn on the canonical seed sits 0.94 m away — clear of her 0.62 m body
 * and therefore, on that reading, fine. It is plainly not fine; she would spawn
 * pressed into a bush. Two of five seeds go red at 1.5 m, which is the same
 * clearance `Scenery.ts` already demands around a ride exit and for the same
 * documented reason: 0.62 m of body plus the 0.85 m widest clump collider this
 * park plants is 1.47 m, so 1.5 m is room to be set down and *step off*, rather
 * than merely to be inserted.
 */
const theEntranceIsClearEnoughToArriveAt: Invariant = (facts) => {
  const fouls: string[] = [];

  // The route she is actually walked along, sampled every half metre, plus
  // where the bus parks and where she ends up standing.
  // From the gate she walks in through, to where the game hands her the
  // controls. The bus itself is outside the park now, so the part of the walk
  // that the scatter can foul is the part inside it.
  const corridor = samplePolyline(
    [
      [0, ENTRANCE_GATE_Z],
      [ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z],
    ],
    0.5,
  );

  const planted: readonly { x: number; z: number; footprint: number; what: string }[] = [
    ...facts.trees.map((tree) => ({
      x: tree.x,
      z: tree.z,
      footprint: tree.footprint,
      what: 'tree',
    })),
    ...facts.bushes.map((bush) => ({
      x: bush.x,
      z: bush.z,
      // A bush publishes the radius of the collider it puts in a walker's way,
      // which is the same thing a tree's `footprint` is, under another name.
      footprint: bush.radius,
      what: 'bush',
    })),
  ];

  // Report the worst offender per plant rather than once per sampled point, or
  // one bush in the road becomes forty near-identical complaints.
  for (const thing of planted) {
    let worst = Infinity;
    let where: readonly [number, number] = [0, 0];
    for (const [x, z] of corridor) {
      const gap = Math.hypot(thing.x - x, thing.z - z) - thing.footprint;
      if (gap < worst) {
        worst = gap;
        where = [x, z];
      }
    }
    if (worst < DROP_OFF_CLEAR) {
      fouls.push(
        `a ${thing.what} at ${fmt([thing.x, thing.z])} reaches to ${worst.toFixed(2)} m of ` +
          `${fmt(where)} on the walk in from the cat bus — a child set down here needs ` +
          `${DROP_OFF_CLEAR} m to stand and step off`,
      );
    }
  }
  return fouls;
};

/**
 * **You can see the bus she arrives on.**
 *
 * The first thing anyone ever sees of this game is a cat bus pulling up at a
 * gate, and in the first run anyone captured its lower-left was behind trees
 * from t = 3 to t = 6. The keep-out that was supposed to prevent that —
 * `ENTRANCE_CLEAR_X/Z/RADIUS` — is a **10 m disc centred on (0, 56)**: a radius
 * chosen for an 11 m bus that is now 18 m long, centred where the bus used to
 * park before it moved outside the gate to z = 69. It has never covered the
 * vehicle it is named after, before or after Stage A finally gave it a
 * consumer. Both halves stale, in the one constant.
 *
 * And the trees actually in the shot were never subject to it anyway. They are
 * `Scenery.ts`'s **treeline** — 540 trees in a band beginning 11.5 m outside a
 * boundary that is 60 m on the gate's bearing, i.e. from z = 71.5, two and a
 * half metres behind the kerb. `buildTreeline` does not go through
 * `isPlantable`, so it asked nothing.
 *
 * This asserts the thing that actually matters — *is the bus visible* — rather
 * than that some radius was respected, per this file's rule 1. The test is
 * exact rather than a tuned distance because the park camera is **orthographic**
 * and so occlusion depends only on its direction: see
 * `entrance/arrivalSightline.ts` for the closed form, and note it takes the
 * camera's angles from `core/constants` rather than restating them, per rule 2.
 *
 * **Scoped to what the scatter owns.** The boundary wall (20 blocks) and the
 * Rail Race's trestles (40-odd parts) also cross this corridor, measured — but
 * neither is scenery and neither can be moved by refusing a spot, so including
 * them would make an assertion that can never be green, which is the same as no
 * assertion at all.
 */
const nothingPlantedHidesTheArrivingBus: Invariant = (facts) => {
  if (facts.hidingTheArrivingBus.length === 0) return [];
  const worst = [...facts.hidingTheArrivingBus].sort((a, b) => b.top - a.top).slice(0, 3);
  return [
    `${facts.hidingTheArrivingBus.length} planted thing(s) stand between the camera and the ` +
      `arriving cat bus — she cannot see the bus she is arriving on. Worst: ` +
      worst
        .map((thing) => `${thing.what} at ${fmt([thing.x, thing.z])} reaching ${thing.top.toFixed(1)} m`)
        .join('; '),
  ];
};

/**
 * Room to be set down by a vehicle and walk away from it, in metres.
 *
 * `PLAYER_RADIUS` (0.62) of body, plus the 0.85 m collider of the widest bush
 * clump this park plants, is 1.47 — so 1.5 m is the point at which a drop-off
 * is somewhere you can *leave*, not merely somewhere you fit. `Scenery.ts`
 * reaches the same number by the same argument for a ride exit.
 */
const DROP_OFF_CLEAR = 1.5;

/** Points every `step` metres along a polyline, corners included. */
function samplePolyline(
  points: readonly (readonly [number, number])[],
  step: number,
): readonly (readonly [number, number])[] {
  const out: (readonly [number, number])[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) continue;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const count = Math.max(1, Math.ceil(length / step));
    for (let n = 0; n <= count; n += 1) {
      const t = n / count;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as const);
    }
  }
  return out;
}

/**
 * The middle of a lane's track, **in three dimensions**, taken from the built
 * rails.
 *
 * {@link railCentreLines} and {@link railCentreLinesByLane} both flatten to the
 * ground — `point.set(x, 0, z)` — and that is not a detail. **Every support
 * check in this file was a plan-view measurement**, and in plan view a post that
 * stops four metres under the track is indistinguishable from one welded to it.
 * That is the whole reason the supports could be confirmed to exist, to be the
 * right thickness, to fork at the right angle and to be spaced correctly, while
 * not one of them reached the track — the fault Jim found by riding it on
 * 7 August after the checks had all gone green.
 *
 * So this keeps `y`, and it is the *middle* of the track rather than a rail:
 * both rails of a lane are meshes named `railRace:rail-{lane}`, and averaging
 * every vertex sharing a `uv.x` across both of them lands exactly halfway
 * between them, at rail-centre height. That is "the middle of the track" as a
 * measurement of the built geometry, not as a restatement of the rule that
 * placed it — `route.pointAt` is the rule, and this file's first commandment is
 * to measure what was built.
 *
 * Returned as **segments**, for the reason {@link railCentreLines} gives: the
 * cross-section rings sit up to ~0.83 m apart along the track, so measuring to
 * the nearest *vertex ring* would report up to 0.42 m of pure resolution noise
 * on a perfectly-placed branch — larger than the tolerance being asserted.
 */
function trackMiddleByLane(ring: BuiltRing): Map<number, Map<string, Segment3[]>> {
  const byLane = new Map<number, Map<string, Segment3[]>>();
  const point = new Vector3();

  // lane -> uv.x key -> running sum, accumulated across *both* of the lane's
  // rail meshes so the average is the midpoint between them.
  const rings = new Map<number, Map<number, { x: number; y: number; z: number; n: number }>>();

  ring.group.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const match = /^railRace:rail-(\d+)$/.exec(child.name);
    if (!match) return;
    const lane = Number(match[1]);
    const position = child.geometry.getAttribute('position');
    const uv = child.geometry.getAttribute('uv');
    if (!position || !uv) return;
    child.updateWorldMatrix(true, false);

    let laneRings = rings.get(lane);
    if (!laneRings) {
      laneRings = new Map();
      rings.set(lane, laneRings);
    }
    for (let i = 0; i < position.count; i += 1) {
      point.set(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(child.matrixWorld);
      const key = Math.round(uv.getX(i) * 1e6);
      const entry = laneRings.get(key);
      if (entry) {
        entry.x += point.x;
        entry.y += point.y;
        entry.z += point.z;
        entry.n += 1;
      } else {
        laneRings.set(key, { x: point.x, y: point.y, z: point.z, n: 1 });
      }
    }
  });

  for (const [lane, laneRings] of rings) {
    const centres = [...laneRings.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, e]) => [e.x / e.n, e.y / e.n, e.z / e.n] as const);
    const grid = new Map<string, Segment3[]>();
    byLane.set(lane, grid);
    for (let i = 0; i < centres.length; i += 1) {
      const a = centres[i]!;
      const b = centres[(i + 1) % centres.length]!;
      const segment: Segment3 = [a[0], a[1], a[2], b[0], b[1], b[2]];
      for (const end of [a, b]) {
        const key = `${Math.floor(end[0])},${Math.floor(end[2])}`;
        const cell = grid.get(key);
        if (cell) cell.push(segment);
        else grid.set(key, [segment]);
      }
    }
  }
  return byLane;
}

/** `[ax, ay, az, bx, by, bz]` — a straight run of centre line in world space. */
type Segment3 = [number, number, number, number, number, number];

/** Shortest distance from a point to a segment, in full 3D. */
function pointToSegment3(p: Vector3, s: Segment3): number {
  const ax = s[0];
  const ay = s[1];
  const az = s[2];
  const dx = s[3] - ax;
  const dy = s[4] - ay;
  const dz = s[5] - az;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  let t = 0;
  if (lengthSquared > 1e-12) {
    t = ((p.x - ax) * dx + (p.y - ay) * dy + (p.z - az) * dz) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
  }
  return Math.hypot(p.x - (ax + t * dx), p.y - (ay + t * dy), p.z - (az + t * dz));
}

/**
 * Nearest distance from `p` to any centre-line segment in `grid`, in 3D.
 *
 * The grid is keyed on ground position, so the search widens in x/z rings while
 * the distance it returns is the true 3D one. It therefore cannot stop as soon
 * as `nearest <= radius` the way the flat {@link nearestRail} does — a segment
 * one cell away horizontally may still be the nearest in 3D once height is
 * counted, and a support four metres below the track is exactly that case. It
 * widens one full ring past the first hit instead.
 */
function nearestTrackMiddle(grid: Map<string, Segment3[]>, p: Vector3): number {
  const cx = Math.floor(p.x);
  const cz = Math.floor(p.z);
  let nearest = Infinity;
  let foundAt = -1;
  for (let radius = 0; radius <= 40; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        if (radius > 0 && Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
        for (const segment of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
          const d = pointToSegment3(p, segment);
          if (d < nearest) {
            nearest = d;
            if (foundAt < 0) foundAt = radius;
          }
        }
      }
    }
    if (foundAt >= 0 && radius > foundAt) return nearest;
  }
  return nearest;
}

/**
 * **Every support actually touches the thing it is holding up.**
 *
 * This replaces `droppersHangUnderRealRails`, and the replacement is the point.
 *
 * ## The fault this exists for
 *
 * Jim, 7 August 2026, having ridden it and approved it and then looked again:
 *
 * > *"actually the track supports don't even join to the track"*
 *
 * Measured on the canonical seed before anything was changed, a trestle's four
 * upper branch tops finished **0.58 m to 4.30 m** below the middle of the lane
 * above them, and the Sky Cruiser's pylon tops sat 0.131–0.152 m under a track
 * whose ties reach only 0.16 m down — about a centimetre of contact at best and
 * none at the far end of that range.
 *
 * ## Why nothing caught it, which is the part worth keeping
 *
 * There were four checks on these supports. They asserted the trestles exist,
 * their thickness, their fork angles, their spacing, that a dropper stands under
 * a rail, that the cruiser has enough pylons, and that a sleeper reaches both
 * rails. **Every single one of them measured in plan view.**
 * `railCentreLines` builds its geometry with `point.set(x, 0, z)`;
 * `skyCruiserStandsOnItsOwnSupports` measured `Math.hypot(on.x - top.x, on.z -
 * top.z)`. Flatten the world onto the ground and a post that stops four metres
 * short is in precisely the right place. The checks were not weak, they were
 * *about the wrong quantity*, and they were all about the wrong quantity in the
 * same way — so agreement between them was worth nothing.
 *
 * So this one measures the **height** as well, against
 * {@link trackMiddleByLane}, and it is deliberately the only support check that
 * does. Anything asserting a support does its job has to go through here.
 *
 * ## The tolerance is the track's own structure, not a number picked to pass
 *
 * A support "reaches" if its tip is inside the band of real structure that hangs
 * under the middle of the track: one rail radius plus half a sleeper's
 * thickness, which is exactly how far `track.ts` drops a sleeper below the rail
 * centre so the rail rests *on* it. Land within that and the tip is inside the
 * sleeper the rails are bolted to. Both terms come from
 * `railRace/trestleGeometry.ts`, scaled by the ring's own size, so this cannot
 * drift from the geometry it is judging.
 */
const supportsMeetWhatTheyCarry: Invariant = (facts) => {
  const complaints: string[] = [];
  const matrix = new Matrix4();

  // --- 1. the Rail Race branches ---------------------------------------------
  for (const ring of builtRings(facts)) {
    const middles = trackMiddleByLane(ring);
    if (middles.size === 0) {
      complaints.push(
        `the ${ring.label} ring has no rails in the built scene to measure its supports against`,
      );
      continue;
    }
    // The depth of structure under the middle of the track, on this ring.
    const reachTolerance =
      (RAIL_RADIUS_AT_PARK_SCALE + SLEEPER_THICKNESS / 2) * ring.scale;

    const branches = ring.group.getObjectByName('railRace:trestle-branches-upper');
    if (!(branches instanceof InstancedMesh)) {
      complaints.push(
        `the ${ring.label} ring has no upper trestle branches in the built scene to measure`,
      );
    } else if (branches.count === 0) {
      complaints.push(`the ${ring.label} ring built no upper trestle branches at all`);
    } else {
      let worst = 0;
      let worstAt = new Vector3();
      for (let i = 0; i < branches.count; i += 1) {
        branches.getMatrixAt(i, matrix);
        // The top of a unit-height cylinder, which is where the branch ends.
        const top = new Vector3(0, 0.5, 0).applyMatrix4(matrix);
        let nearest = Infinity;
        for (const grid of middles.values()) {
          nearest = Math.min(nearest, nearestTrackMiddle(grid, top));
        }
        if (nearest > worst) {
          worst = nearest;
          worstAt = top.clone();
        }
      }
      if (worst > reachTolerance) {
        complaints.push(
          `a trestle branch on the ${ring.label} ring ends at ` +
            `${fmt([worstAt.x, worstAt.z])}, y ${worstAt.y.toFixed(2)} — ` +
            `${worst.toFixed(2)} m from the middle of the nearest lane, over the ` +
            `${reachTolerance.toFixed(2)} m the track's own structure reaches down. ` +
            'It is holding up nothing.',
        );
      }
    }

    // Nothing above the branches. Jim, 7 August: "that vertical section of
    // supports under the rail ride isn't needed" — the branch is the last piece.
    // A mesh reappearing here is the old dropper curtain coming back.
    const droppers = ring.group.getObjectByName('railRace:trestle-droppers');
    if (droppers) {
      complaints.push(
        `the ${ring.label} ring still has a "railRace:trestle-droppers" mesh — the branches are ` +
          'meant to run all the way to the track with no vertical section on top of them',
      );
    }

    // --- 2. the sleepers are not floating either ------------------------------
    //
    // Same fault class, same blind spot: `railRaceSleepersBridgeBothRails`
    // measures the reach *across* to both rails and does it in plan, so a whole
    // ring of sleepers hovering a metre under the track would pass it.
    const sleepers = ring.group.getObjectByName('railRace:sleepers');
    if (sleepers instanceof InstancedMesh && sleepers.count > 0) {
      let worstGap = -Infinity;
      let worstAt = new Vector3();
      // Every 17th, coprime with the per-lane block so the sample walks all four.
      for (let i = 0; i < sleepers.count; i += 17) {
        sleepers.getMatrixAt(i, matrix);
        const centre = new Vector3().setFromMatrixPosition(matrix);
        let nearest = Infinity;
        for (const grid of middles.values()) {
          nearest = Math.min(nearest, nearestTrackMiddle(grid, centre));
        }
        if (nearest > worstGap) {
          worstGap = nearest;
          worstAt = centre.clone();
        }
      }
      if (worstGap > reachTolerance) {
        complaints.push(
          `a sleeper on the ${ring.label} ring sits ${worstGap.toFixed(2)} m from the middle of ` +
            `the track at ${fmt([worstAt.x, worstAt.z])}, over the ${reachTolerance.toFixed(2)} m ` +
            'the track\'s own structure reaches — it is floating, not bridging the rails',
        );
      }
    }
  }

  // --- 3. the Sky Cruiser pylons ---------------------------------------------
  //
  // Straight and vertical, which is Jim's own spec for this ride and is not
  // changed here — only whether the top of one arrives at the track.
  const coaster = facts.world.coaster;
  const pylons = coaster.group.getObjectByName('skyCruiser:pylons');
  if (!(pylons instanceof InstancedMesh) || pylons.count === 0) {
    complaints.push('the Sky Cruiser has no pylons in the built scene to measure');
  } else {
    // One rail radius plus half a tie, owned by `coaster/cruiserDimensions.ts`
    // — the same rule the Rail Race branches are judged by, written from this
    // ride's own numbers rather than copied into the test.
    const CRUISER_STRUCTURE_DEPTH = CRUISER_SUPPORT_REACH_TOLERANCE;
    let worst = 0;
    let worstAt = new Vector3();
    const on = new Vector3();
    // Walked in 3D rather than asked for the nearest point in plan.
    //
    // `route.nearestPoint(x, z)` is a **ground-plane** lookup, and this ride
    // crosses over itself and dives through the castle — so on the canonical
    // seed it answered with a stretch of track 0.89 m away in height that the
    // pylon has nothing to do with, on a pylon whose own track is 0.02 m above
    // it. Using it here would have been the same plan-view mistake this whole
    // invariant exists to correct, one level up. Sampling the route finely and
    // taking the true 3D minimum asks the question actually being asked: is the
    // top of this post touching any part of the track at all?
    const SAMPLES = 4000;
    const step = coaster.route.length / SAMPLES;
    for (let i = 0; i < pylons.count; i += 1) {
      pylons.getMatrixAt(i, matrix);
      const top = new Vector3(0, 0.5, 0).applyMatrix4(matrix);
      let gap = Infinity;
      for (let k = 0; k < SAMPLES; k += 1) {
        coaster.route.pointAt(k * step, on);
        gap = Math.min(gap, on.distanceTo(top));
      }
      if (gap > worst) {
        worst = gap;
        worstAt = top.clone();
      }
    }
    if (worst > CRUISER_STRUCTURE_DEPTH) {
      complaints.push(
        `a Sky Cruiser pylon tops out at ${fmt([worstAt.x, worstAt.z])}, y ` +
          `${worstAt.y.toFixed(2)} — ${worst.toFixed(2)} m from the middle of the track, over ` +
          `the ${CRUISER_STRUCTURE_DEPTH} m its ties reach down. The track is not sitting on it.`,
      );
    }
  }

  return complaints;
};

/**
 * The camera has to keep going forwards while the rider does.
 *
 * Zero would mean "may stall but never reverse", which is the letter of the
 * defect; this asks for a little more, because a camera that drops to a
 * standstill for a few metres reads as a stutter even though it never technically
 * goes backwards. 0.05 m of camera per metre of rider is far below anything
 * deliberate — the rig normally tracks at about 1.3 — and far above the −0.318
 * the pointwise frame produced.
 */
const CAMERA_MIN_FORWARD_PROGRESS = 0.05;

/**
 * **The camera must never slide backwards while the rider runs forwards.**
 *
 * Jim rode this and reported the camera as jerky. Two separate causes, both
 * measured rather than guessed (6 August 2026):
 *
 * 1. The ring's tangents were read off whichever outline segment a resampled
 *    point landed in, making the whole frame a **step function** — 3511
 *    constant-tangent plateaus round one lap. The rig stands ~27.5 m out along
 *    that frame's normal, so every step became a lurch: camera speed ranged
 *    0.003–5.072 m per metre of rider, peak acceleration 81.4.
 * 2. Worse and quite separate: with a ~27.5 m stand-off on a ring whose tightest
 *    bend is ~20 m, the offset curve the camera rides **inverts**. It ran
 *    backwards on 2.6% of every lap, at up to 0.318 m per metre.
 *
 * This guards (2), which is the one a child would name, and it guards it on the
 * **built** ring of every seed — the shape of the boundary is what decides
 * whether it happens at all, so the canonical seed alone is not evidence.
 * `check:rail-race` guards the other side of the same trade (a frame smoothed
 * far enough to fix this stops being square-on to the rider's travel and breaks
 * the side-scroller rule), so the two together pin `CAMERA_GUIDE_WINDOW`
 * between walls that are each about one step away.
 */
const raceCameraNeverRunsBackwards: Invariant = (facts) => {
  const tracking = facts.cameraTracking;
  if (tracking.probes === 0) {
    return ['the race camera could not be walked round the built ring at all'];
  }
  if (tracking.nonFiniteProbes > 0) {
    return [
      `the race camera placed itself at a non-number on ${tracking.nonFiniteProbes} of ` +
        `${tracking.probes} probes. Every reading below is therefore taken over whichever probes ` +
        'happened to survive, so treat the numbers this suite prints about the camera as absent ' +
        "rather than as good news — that is precisely how a NaN hides: it loses every comparison " +
        'it is asked instead of failing one. See RaceCamera.measureZoomCeiling.',
    ];
  }
  if (tracking.leastForwardProgress >= CAMERA_MIN_FORWARD_PROGRESS) return [];
  return [
    `the race camera falls to ${tracking.leastForwardProgress.toFixed(3)} m of camera per metre of ` +
      `rider at ${tracking.worstAt.toFixed(1)} m from the arch, with the rider doing ` +
      `${tracking.worstSpeed.toFixed(0)} m/s (${tracking.backwardsProbes} of ` +
      `${tracking.probes} probes actually run backwards), under the ` +
      `${CAMERA_MIN_FORWARD_PROGRESS} floor — with a ${tracking.standOff.toFixed(1)} m stand-off the ` +
      `rig is riding an offset curve tighter than its own radius, so the picture lurches the wrong ` +
      `way.\n` +
      `      If the worst reading is at speed and the standstill one is fine, the speed zoom is ` +
      `pulling the rig back further than this ring can carry: that is RaceCamera's zoom ceiling ` +
      `failing to bite, not a smoothing problem.\n` +
      `      Do NOT reach for CAMERA_GUIDE_WINDOW, which is what this message used to advise. It ` +
      `is walled in on both sides and both walls are measured: 12 m fails check:rail-race's ` +
      `side-scroller floor at 0.897, and the drift a wider window adds sits at the very same ` +
      `hairpins as the reversal it removes.`,
  ];
};

// ---------------------------------------------------------- supports & sleepers

/**
 * Every lane's rail centre lines, kept apart by lane.
 *
 * {@link railCentreLines} flattens all four lanes into one spatial grid, which
 * is right for "is this post under *a* rail" and useless for "is this thing
 * under **lane 2**". Both rails of a lane share the mesh name
 * `railRace:rail-{lane}`, so the lane is recoverable; the geometry walk is
 * otherwise identical.
 */
function railCentreLinesByLane(ring: BuiltRing): Map<number, Map<string, [number, number, number, number][]>> {
  const byLane = new Map<number, Map<string, [number, number, number, number][]>>();
  const point = new Vector3();

  ring.group.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const match = /^railRace:rail-(\d+)$/.exec(child.name);
    if (!match) return;
    const lane = Number(match[1]);
    const position = child.geometry.getAttribute('position');
    const uv = child.geometry.getAttribute('uv');
    if (!position || !uv) return;
    child.updateWorldMatrix(true, false);

    const rings = new Map<number, { x: number; z: number; n: number }>();
    for (let i = 0; i < position.count; i += 1) {
      point.set(position.getX(i), 0, position.getZ(i)).applyMatrix4(child.matrixWorld);
      const key = Math.round(uv.getX(i) * 1e6);
      const entry = rings.get(key);
      if (entry) {
        entry.x += point.x;
        entry.z += point.z;
        entry.n += 1;
      } else {
        rings.set(key, { x: point.x, z: point.z, n: 1 });
      }
    }
    const centres = [...rings.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, e]) => [e.x / e.n, e.z / e.n] as const);

    let grid = byLane.get(lane);
    if (!grid) {
      grid = new Map();
      byLane.set(lane, grid);
    }
    for (let i = 0; i < centres.length; i += 1) {
      const a = centres[i]!;
      const b = centres[(i + 1) % centres.length]!;
      const segment: [number, number, number, number] = [a[0], a[1], b[0], b[1]];
      for (const end of [a, b]) {
        const key = `${Math.floor(end[0])},${Math.floor(end[1])}`;
        const cell = grid.get(key);
        if (cell) cell.push(segment);
        else grid.set(key, [segment]);
      }
    }
  });
  return byLane;
}

/** Which lane's rails `(x, z)` is nearest to, and how far. */
function nearestLane(
  byLane: Map<number, Map<string, [number, number, number, number][]>>,
  x: number,
  z: number,
): { lane: number; distance: number } {
  let best = { lane: -1, distance: Infinity };
  for (const [lane, grid] of byLane) {
    const d = nearestRail(grid, x, z);
    if (d < best.distance) best = { lane, distance: d };
  }
  return best;
}

/** An instanced part's two ends, in world space. A unit cylinder runs -0.5..+0.5 on Y. */
function strutEnds(
  mesh: InstancedMesh,
  index: number,
): { foot: Vector3; top: Vector3 } {
  const matrix = new Matrix4();
  mesh.getMatrixAt(index, matrix);
  return {
    foot: new Vector3(0, -0.5, 0).applyMatrix4(matrix),
    top: new Vector3(0, 0.5, 0).applyMatrix4(matrix),
  };
}

/**
 * How far a branch top may sit from its lane's centre line and still be carrying
 * that lane, in metres.
 *
 * A branch top stands on the lane's **centre**, so its distance to either of
 * that lane's two rails is half the gauge by construction. What this bounds is
 * how far that reading may stray from half a gauge — slack for the swept tube's
 * own fit to the analytic centre line (documented in `Coaster.ts` as ~20 mm at a
 * far denser sample rate) and for the trestle's arc nudge, and nothing like
 * enough to hide a top under the wrong lane: the lanes are 2.75 m apart on the
 * race ring, seven times this.
 */
const BRANCH_TOP_LANE_TOLERANCE = 0.4;

/**
 * The tightest bend either Rail Race ring turns through, in metres of radius.
 *
 * Measured, not chosen: `raceCameraNeverRunsBackwards` documents this ring's
 * tightest bend as ~20 m — that invariant exists precisely because a 27.5 m
 * camera stand-off rides an inverted offset curve on it. Used here to derive how
 * much a lane offset from the centre line stretches a nominal sleeper spacing.
 */
const RING_TIGHTEST_BEND = 20;

/**
 * The spacing Jim asked for, in metres — **deliberately a literal, and
 * deliberately not `SLEEPER_SPACING`.**
 *
 * Mutation-tested 7 August 2026, and it failed: written against the imported
 * constant, this check doubled its own expectation the moment somebody doubled
 * the constant, so `SLEEPER_SPACING = 2` passed cleanly. That is this repo's own
 * "green can mean incapable of failing" in miniature — a check comparing the
 * builder to itself.
 *
 * The claim being guarded is not "the code did what the constant said", which is
 * a tautology. It is Jim's: "cross-bars like railway sleepers between the tracks
 * at about 1m intervals". So the metre is written here, once, and a constant
 * that walks away from it makes this go red.
 */
const ABOUT_A_METRE = 1;

/**
 * **Every one of the four tracks has a branch under it, and the tree really does
 * fork twice at the angle it claims.**
 *
 * Jim, 5 August 2026: "make the base post 2x thickness, then splitting into two
 * branches at ~30º, which then splits again at 30º to support the 4 tracks."
 * Each clause is a separate assertion here, and each is read off the built
 * instance buffers rather than off `forkPlan`'s intentions — the angles from the
 * struts' own directions, the thickness from the drawn geometry times its
 * instance scale, and the coverage from where the tops actually landed against
 * rails measured out of their own swept vertices.
 *
 * The angle is compared to {@link forkPlan}, which is the one owner of "what
 * angle should this post have got"; the check is that the built tree agrees with
 * it *and* that both generations agree with each other, which is the part a
 * wrong fork height would break while leaving every top in the right place.
 */
const railRaceTrestlesCarryEveryTrack: Invariant = (facts) => {
  const complaints: string[] = [];

  for (const ring of builtRings(facts)) {
    const legs = ring.group.getObjectByName('railRace:trestle-legs');
    const lower = ring.group.getObjectByName('railRace:trestle-branches-lower');
    const upper = ring.group.getObjectByName('railRace:trestle-branches-upper');
    if (!(legs instanceof InstancedMesh) || !(lower instanceof InstancedMesh) || !(upper instanceof InstancedMesh)) {
      complaints.push(`the ${ring.label} ring is missing a trestle mesh — no branching support was built at all`);
      continue;
    }
    const lanes = facts.world.railRace.laneCount;
    const route = ring.label === 'race' ? facts.world.railRace.raceRoute : facts.world.railRace.walkPastRoute;

    // One post, two, then four.
    if (lower.count !== legs.count * 2 || upper.count !== legs.count * lanes) {
      complaints.push(
        `the ${ring.label} ring has ${legs.count} posts but ${lower.count} lower branches and ` +
          `${upper.count} upper — expected ${legs.count * 2} and ${legs.count * lanes}, ` +
          'one post splitting into two and then four',
      );
      continue;
    }

    // Thickness: the drawn radius, not the constant it came from.
    const legGeometry = legs.geometry as { parameters?: { radiusBottom?: number } };
    const drawnFoot = (legGeometry.parameters?.radiusBottom ?? 0) * new Vector3().setFromMatrixScale(
      (() => {
        const m = new Matrix4();
        legs.getMatrixAt(0, m);
        return m;
      })(),
    ).x;
    const wantedFoot = 2 * LEGACY_LEG_FOOT_RADIUS * ring.sizeVsRace;
    if (drawnFoot < wantedFoot - 1e-3) {
      complaints.push(
        `the ${ring.label} ring's base post is ${drawnFoot.toFixed(3)} m across the foot, under the ` +
          `${wantedFoot.toFixed(3)} m that doubling the old ${LEGACY_LEG_FOOT_RADIUS} m leg asks for — ` +
          'the posts Jim called "far too thin" are still thin',
      );
    }

    // The plane `forkPlan` is solved against, rebuilt from the built route the
    // same way `track.ts` does — the lowest any lane ever gets, less BEAM_DROP.
    // Sampled off `route` rather than re-deriving `UNDULATION_REACH`, so it is
    // the ring that was actually built that answers.
    let lowestRailY = Infinity;
    {
      const probe = new Vector3();
      const SAMPLES = 720;
      for (let lane = 0; lane < lanes; lane += 1) {
        for (let k = 0; k < SAMPLES; k += 1) {
          route.pointAt(lane, (k / SAMPLES) * route.length, probe);
          lowestRailY = Math.min(lowestRailY, probe.y);
        }
      }
    }
    const beamY = lowestRailY - BEAM_DROP;

    const byLane = railCentreLinesByLane(ring);
    if (byLane.size !== lanes) {
      complaints.push(
        `the ${ring.label} ring gave ${byLane.size} lanes of rail to measure against, not ${lanes}`,
      );
      continue;
    }

    let worstAngleError = 0;
    let worstAngleAt = '';
    let reportedAngle = 0;
    for (let trestle = 0; trestle < legs.count; trestle += 1) {
      // The four upper branches of one trestle are written consecutively, four
      // per post, in `track.ts`'s placement loop.
      const covered = new Set<number>();
      let worstLaneMiss = 0;
      for (let k = 0; k < lanes; k += 1) {
        const { top } = strutEnds(upper, trestle * lanes + k);
        const near = nearestLane(byLane, top.x, top.z);
        covered.add(near.lane);
        // On the lane's centre line: half a gauge from either of its rails.
        const halfGauge = (RAIL_GAUGE_AT_PARK_SCALE * ring.scale) / 2;
        worstLaneMiss = Math.max(worstLaneMiss, Math.abs(near.distance - halfGauge));
      }
      if (covered.size !== lanes) {
        complaints.push(
          `trestle ${trestle} on the ${ring.label} ring carries only ${covered.size} of ${lanes} ` +
            `lanes — its four branch tops land over lanes {${[...covered].sort().join(', ')}}, so at ` +
            'least one track is held up by nothing',
        );
        break;
      }
      if (worstLaneMiss > BRANCH_TOP_LANE_TOLERANCE) {
        complaints.push(
          `a branch top on trestle ${trestle} of the ${ring.label} ring sits ` +
            `${worstLaneMiss.toFixed(2)} m off its lane's centre line, over the ` +
            `${BRANCH_TOP_LANE_TOLERANCE} m tolerance`,
        );
        break;
      }

      // Both forks, measured from the struts' own directions.
      //
      // **The solved angle is now a ceiling, not a target, and that is Jim's
      // 7 August ruling rather than a relaxation.** Branches end at the middle
      // of their own lane, and at one station the four lanes stand up to 4.38 m
      // apart in height, so four branches off one fork *cannot* share an angle.
      // `track.ts` measures each fork's drop from the **lowest** lane it
      // carries, which gives the design its two testable halves:
      //
      // - the shallowest branch of each generation makes exactly the solved
      //   angle — it is the one carrying the lower lane, whose drop is exactly
      //   what `forkPlan` solved;
      // - no branch is ever *wider* than that; a branch reaching a higher lane
      //   is steeper.
      //
      // Those two halves are one assertion: the **widest** branch of each
      // generation must *equal* the solved angle. Equality is what pins Jim's
      // settled 30.0 deg and 41.6 deg in place — a ceiling alone would be
      // satisfied by a tree whose branches all went vertical, which would lose
      // the fork entirely.
      //
      // Note "widest" is the branch carrying the **lower** lane. `angleOf`
      // measures from vertical, so a branch that has to climb further to a
      // higher lane makes a *smaller* angle, not a larger one.
      const post = strutEnds(legs, trestle);
      const plan = forkPlan(beamY - post.foot.y, route.laneSpacing);
      const angleOf = (mesh: InstancedMesh, index: number): number => {
        const { foot, top } = strutEnds(mesh, index);
        const span = top.clone().sub(foot);
        return Math.atan2(Math.hypot(span.x, span.z), span.y);
      };
      const generations = [
        { name: 'lower', angles: [0, 1].map((k) => angleOf(lower, trestle * 2 + k)) },
        {
          name: 'upper',
          angles: Array.from({ length: lanes }, (_u, k) => angleOf(upper, trestle * lanes + k)),
        },
      ];
      for (const generation of generations) {
        const widest = Math.max(...generation.angles);
        const missed = Math.abs(widest - plan.angle);
        if (missed > worstAngleError) {
          worstAngleError = missed;
          worstAngleAt =
            `the widest ${generation.name} branch of trestle ${trestle} on the ` +
            `${ring.label} ring`;
          reportedAngle = widest;
        }
      }
    }
    // Each generation's widest branch must fork at the angle `forkPlan` solved
    // for this post — see the note above on why it is the widest and not all of
    // them.
    const ANGLE_TOLERANCE = (2 * Math.PI) / 180;
    if (worstAngleError > ANGLE_TOLERANCE) {
      complaints.push(
        `${worstAngleAt} forks at ${((reportedAngle * 180) / Math.PI).toFixed(1)}°, which is ` +
          `${((worstAngleError * 180) / Math.PI).toFixed(1)}° from what forkPlan solved for that post — ` +
          'the built tree and the plan disagree, so one of them is not what is on screen',
      );
    }
  }
  return complaints;
};

/**
 * **The sleepers bridge both of their lane's rails, about a metre apart.**
 *
 * Jim asked for "cross-bars like railway sleepers between the tracks at about 1m
 * intervals". Two claims, so two assertions.
 *
 * The bridging half is the `check:tie-frame` bug in a second ride: the Sky
 * Cruiser once oriented its sleepers by a *minimal* rotation onto the tangent,
 * which pins the along-track axis and leaves the bridging axis free to roll, so
 * the sleepers drifted off the rails on every climb (#112). This measures each
 * sleeper's own gauge points — its local ±X, taken straight off its instance
 * matrix — against rails read out of their own swept vertices.
 */
const railRaceSleepersBridgeBothRails: Invariant = (facts) => {
  const complaints: string[] = [];

  for (const ring of builtRings(facts)) {
    const sleepers = ring.group.getObjectByName('railRace:sleepers');
    if (!(sleepers instanceof InstancedMesh)) {
      complaints.push(`the ${ring.label} ring has no sleepers in the built scene to measure`);
      continue;
    }
    const lanes = facts.world.railRace.laneCount;
    const route = ring.label === 'race' ? facts.world.railRace.raceRoute : facts.world.railRace.walkPastRoute;
    const byLane = railCentreLinesByLane(ring);
    const perLane = Math.floor(sleepers.count / lanes);

    const expected = Math.floor(route.length / ABOUT_A_METRE);
    if (perLane !== expected) {
      complaints.push(
        `the ${ring.label} ring lays ${perLane} sleepers along a ${route.length.toFixed(1)} m lane — ` +
          `expected ${expected}, one about every ${ABOUT_A_METRE} m`,
      );
    }

    const matrix = new Matrix4();
    const halfGauge = (RAIL_GAUGE_AT_PARK_SCALE * ring.scale) / 2;
    let worstReach = 0;
    let worstAt: readonly [number, number] = [0, 0];
    let worstStep = 0;
    // Every 17th, which is coprime with the lane block size so the sample walks
    // all four lanes rather than re-measuring one.
    for (let i = 0; i < sleepers.count; i += 17) {
      sleepers.getMatrixAt(i, matrix);
      const centre = new Vector3().setFromMatrixPosition(matrix);
      // The sleeper's own local X, normalised — the axis it bridges along.
      const across = new Vector3(1, 0, 0)
        .applyMatrix4(new Matrix4().extractRotation(matrix))
        .normalize();
      const near = nearestLane(byLane, centre.x, centre.z);
      for (const side of [-1, 1] as const) {
        const gaugePoint = centre.clone().addScaledVector(across, side * halfGauge);
        const grid = byLane.get(near.lane);
        if (!grid) continue;
        const miss = nearestRail(grid, gaugePoint.x, gaugePoint.z);
        if (miss > worstReach) {
          worstReach = miss;
          worstAt = [gaugePoint.x, gaugePoint.z];
        }
      }
    }
    // The rails are a swept tube fitted through samples, not the analytic line,
    // and the sleeper is a straight box across a curve — so allow the same order
    // of slop `check:tie-frame` does, scaled by how big this ring's parts are.
    const REACH_TOLERANCE = 0.12 * Math.max(ring.sizeVsRace, 0.4) + 0.05;
    if (worstReach > REACH_TOLERANCE) {
      complaints.push(
        `a sleeper on the ${ring.label} ring reaches to ${fmt(worstAt)}, ${worstReach.toFixed(3)} m ` +
          `from the rail it is meant to be bolted to (tolerance ${REACH_TOLERANCE.toFixed(3)} m) — ` +
          'it is not bridging both rails',
      );
    }

    // Spacing, measured between consecutive sleepers of one lane.
    for (let i = 1; i < perLane; i += 1) {
      const a = new Vector3();
      const b = new Vector3();
      sleepers.getMatrixAt(i - 1, matrix);
      a.setFromMatrixPosition(matrix);
      sleepers.getMatrixAt(i, matrix);
      b.setFromMatrixPosition(matrix);
      worstStep = Math.max(worstStep, Math.abs(a.distanceTo(b) - ABOUT_A_METRE));
    }
    // **How far "about a metre" is allowed to stray, and why it is not tight.**
    //
    // Sleepers are laid every `SLEEPER_SPACING` of *centre-line* distance, but
    // each one belongs to a lane offset up to `laneSpan / 2` from that centre —
    // and on a bend an outer lane covers more ground per metre of centre-line
    // than an inner one. The spread is therefore `spacing * halfSpan / bendRadius`
    // by construction, and this ring's tightest bend is about 20 m (measured, and
    // documented in `raceCameraNeverRunsBackwards`, which exists because a 27.5 m
    // camera stand-off inverts on it). On the race ring that is
    // `1 * 4.125 / 20` = 0.21 m, and the built rings measure 0.150–0.208 m across
    // the five seeds — the arithmetic, not slop.
    //
    // Jim asked for "about 1m intervals", so what is worth asserting is that the
    // *built* gap stays inside a band a person would still call about a metre,
    // and that is what this does. A regression that mattered — sleepers at 2 m
    // because someone doubled the constant to save triangles — is a mile outside
    // it.
    const spread = (ABOUT_A_METRE * (route.laneSpan / 2)) / RING_TIGHTEST_BEND;
    const stepTolerance = spread + 0.05;
    if (worstStep > stepTolerance) {
      complaints.push(
        `sleepers on the ${ring.label} ring sit up to ${worstStep.toFixed(3)} m away from the ` +
          `${ABOUT_A_METRE} m Jim asked for, over the ${stepTolerance.toFixed(3)} m a lane ` +
          `${(route.laneSpan / 2).toFixed(2)} m off the centre line can pick up on this ring's ` +
          'tightest bend',
      );
    }
  }
  return complaints;
};

/**
 * **Every racer meets the same number of duck bars, and no two bars touch.**
 *
 * Jim, 7 August 2026: "the head bonk bars all intersect each other - instead of
 * them all appearing at the same spot on the tracks, make them appear one at a
 * time distributed around the track so that each racer has the same total number
 * but not always at the same spots".
 *
 * Two claims and two assertions, both read off the built bars rather than off
 * `planHazards`: which lane a bar is on is decided here by which lane's rails it
 * is nearest to, the same technique the dropper check uses — **not** by its
 * distance from the origin, because this ring stopped being a circle in #216 and
 * its radius now varies by 40 m.
 *
 * The intersection half is arithmetic rather than judgement. A bar reaches
 * `BAR_HALF_SPAN_AT_PARK_SCALE * scale` either side of its lane centre, so two
 * bars whose centres are closer than twice that overlap in the worst case. Four
 * bars stacked at one arc distance — what this replaced — are zero apart.
 */
const duckBarsAreOnePerLaneAndNeverTouch: Invariant = (facts) => {
  const complaints: string[] = [];

  for (const ring of builtRings(facts)) {
    const bars = ring.group.getObjectByName('railRace:duck-bars');
    if (!(bars instanceof InstancedMesh)) {
      complaints.push(`the ${ring.label} ring has no duck bars in the built scene to measure`);
      continue;
    }
    if (bars.count === 0) continue;
    const lanes = facts.world.railRace.laneCount;
    const byLane = railCentreLinesByLane(ring);

    const matrix = new Matrix4();
    const centres: Vector3[] = [];
    const perLane = new Map<number, number>();
    for (let i = 0; i < bars.count; i += 1) {
      bars.getMatrixAt(i, matrix);
      const centre = new Vector3().setFromMatrixPosition(matrix);
      centres.push(centre);
      const near = nearestLane(byLane, centre.x, centre.z);
      perLane.set(near.lane, (perLane.get(near.lane) ?? 0) + 1);
    }

    const counts = Array.from({ length: lanes }, (_unused, lane) => perLane.get(lane) ?? 0);
    if (new Set(counts).size !== 1) {
      complaints.push(
        `the ${ring.label} ring gives its four racers ${counts.join('/')} duck bars — they must meet ` +
          'the same number each, which is what makes the race fair now that they no longer meet ' +
          'them in the same places',
      );
    }

    const barWidth = 2 * BAR_HALF_SPAN_AT_PARK_SCALE * ring.scale;
    let closest = Infinity;
    let closestAt: readonly [number, number] = [0, 0];
    for (let i = 0; i < centres.length; i += 1) {
      for (let j = i + 1; j < centres.length; j += 1) {
        const d = centres[i]!.distanceTo(centres[j]!);
        if (d < closest) {
          closest = d;
          closestAt = [centres[i]!.x, centres[i]!.z];
        }
      }
    }
    if (closest < barWidth) {
      complaints.push(
        `two duck bars on the ${ring.label} ring stand ${closest.toFixed(2)} m apart near ` +
          `${fmt(closestAt)}, inside the ${barWidth.toFixed(2)} m a bar is wide — they intersect, ` +
          'which is the defect Jim reported',
      );
    }
  }
  return complaints;
};

/**
 * How much Sky Cruiser track may run without a support under it, in metres.
 *
 * Not the planner's own attempt spacing (12 m), which would only prove it agrees
 * with itself. This is the span at which a track reads as floating rather than
 * carried, and it is deliberately generous: the route deliberately flies over
 * the castle, plots and paved paths, where a post is genuinely not allowed, so
 * long unsupported stretches are correct and expected. What it catches is the
 * defect actually found — a keep-out rule that banned nearly the whole park and
 * left four posts on a 217 m loop, whose longest gap was over 100 m.
 */
const CRUISER_MAX_UNSUPPORTED_SPAN = 90;

/**
 * ...and how much track there may be per pylon, averaged over the loop.
 *
 * The pair matters more than either alone. A single long gap is legitimate —
 * the route flies over the castle, the plots and the paved paths, and a post is
 * genuinely not allowed in any of them, so seed 18 spans 65 m in one go with
 * eleven pylons elsewhere and looks carried. What is not legitimate is the
 * defect actually found: **four** pylons on a 217 m loop, one per 54 m, which
 * this catches by more than a factor of two while leaving a route that simply
 * has one long crossing alone.
 */
const CRUISER_MAX_TRACK_PER_PYLON = 25;

/**
 * How far a point may sit from the paved network and still count as
 * "explained by the path", for {@link CRUISER_MAX_OPEN_UNSUPPORTED_SPAN}
 * below — the same 2.8 m `coaster/pylons.ts` itself keeps a pylon off paving
 * by (`PATH_CLEARANCE`). Not imported from there: this file measures the
 * built park, and a static import reaching `pylons.ts` → `paths.ts` →
 * `parkManifest.ts` would pin every seed here to whichever one runs first
 * (see this file's header). Kept in step by hand, the one place this rule
 * accepts that (issue #301's fix does not touch this figure, so it is not at
 * live risk of drifting quietly).
 */
const OPEN_SPAN_PATH_CLEARANCE = 2.8;

/**
 * How far a point may sit from a plot's edge and still count as "explained
 * by the plot" — `PLOT_SKIRT` from `coaster/pylons.ts`, kept in step for the
 * same reason as {@link OPEN_SPAN_PATH_CLEARANCE} above.
 */
const OPEN_SPAN_PLOT_SKIRT = 2.4;

/**
 * How low the built rail may stand above the terrain and still count as
 * "explained by the station dip" — `pylons.ts`'s own `MIN_PYLON_HEIGHT`,
 * kept in step for the same reason as {@link OPEN_SPAN_PATH_CLEARANCE} and
 * {@link OPEN_SPAN_PLOT_SKIRT} above.
 *
 * **Found on seed 18, 21 August 2026 (issue #312).** Every candidate this
 * check flagged as an unexplained 16 m gap turned out to sit over the
 * station's own boarding dip, where `planCruiserPylons` never even reaches
 * its foliage-clearing step — every attempted spot in that stretch was
 * refused for being *too low* (0.22-1.57 m of rail above the ground, against
 * a 1.4 m floor), the exact scenario `MIN_PYLON_HEIGHT`'s own comment names:
 * "it is exactly where the track is low ... that a child is most likely to
 * be walking beside it". No tree or bush was ever in play, so issue #301's
 * fix had nothing to do here — a low rail standing near the ground does not
 * read as floating, it reads as *grounded*, which is a third legitimate
 * reason for a gap, the same shape as standing over a plot or the paved
 * network. This check recognised only two of the three; the third is now
 * measured too, from {@link ParkFacts.cruiserRouteGroundClearance} — sampled
 * off the built loop and terrain, not re-derived from `pylons.ts`'s own
 * rule.
 */
const OPEN_SPAN_MIN_PYLON_HEIGHT = 1.4;

/**
 * **No unsupported span may run this far over plain open lawn**, in metres —
 * the second half of issue #301's fix, and the tighter counterpart to
 * {@link CRUISER_MAX_UNSUPPORTED_SPAN} above.
 *
 * That constant is deliberately loose because a long gap over the castle, a
 * plot, the paved network, or the station's own boarding dip is *correct* —
 * a post genuinely may not stand there, or would be clutter where a child is
 * walking. This one is not loose, because open lawn carries no such excuse: if
 * a candidate spot there was refused, the only thing that could have refused
 * it before this PR was a tree or a bush, and issue #301 is exactly Jim
 * finding one of those refusals live — a support-free stretch of track
 * running through a dense tree-and-bush cluster.
 *
 * **Measured, not targeted.** For every gap between two consecutive built
 * pylons, this walks the gap in 1 m steps and finds the longest run that sits
 * outside every plot's `boundingRadius + `{@link OPEN_SPAN_PLOT_SKIRT},
 * outside {@link OPEN_SPAN_PATH_CLEARANCE} of the paved network, and above
 * {@link OPEN_SPAN_MIN_PYLON_HEIGHT} of the terrain — the same three
 * exemptions `planCruiserPylons` itself is allowed to refuse a spot for —
 * then takes the worst such run anywhere on the loop. Measured against both
 * sides of #304, worst run per CI seed (canonical / 2 / 5 / 11 / 18):
 *
 * | | canonical | seed 2 | seed 5 | seed 11 | seed 18 |
 * |---|---|---|---|---|---|
 * | before #304 | 16 m | 15 m | 15 m | **17 m** | 15 m |
 * | after #304  | 15 m | 13 m | 12 m | 13 m | 14 m |
 *
 * 15 sits below the two seeds #304 actually fixed (canonical's 16, seed
 * 11's 17 — the shape of the gap Jim found, a genuinely tree-blocked spot
 * with nothing else standing in the way) and at or above every seed's
 * post-fix worst *at the time*. Seed 18 later measured 16 m against this same
 * 15 m ceiling with none of the three exemptions changed and no code
 * touching the generator or the route in between (issue #312) — the station
 * dip above is what moved it, not a regression, and adding that third
 * exemption is what a genuine, previously-unrecognised "explained" gap
 * deserves rather than a wider number. If a future, legitimate change to the
 * scatter or the route needs more than 15 m of unexplained open lawn between
 * two real supports, that is exactly the kind of seed swap CLAUDE.md asks
 * for, written down rather than silently widened.
 */
const CRUISER_MAX_OPEN_UNSUPPORTED_SPAN = 15;

/**
 * Distance from (x, z) to the nearest paved-path sample, less that sample's
 * own half-width — `paths.ts`'s own `distanceToPath`, recomputed from
 * {@link ParkFacts.pathEdges} rather than by importing `paths.ts`, which
 * reaches `parkManifest.ts` and would pin every seed in this suite to
 * whichever one runs first (see this file's header). `pathEdges[].points` is
 * the same drawn centre line at the same ~0.5 m sampling `distanceToPath`
 * itself scans, so this is the real network, not a re-derivation of it.
 */
function nearestPathClearance(facts: ParkFacts, x: number, z: number): number {
  let best = Infinity;
  for (const edge of facts.pathEdges) {
    for (const [px, pz] of edge.points) {
      const d = Math.hypot(x - px, z - pz) - edge.halfWidth;
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * **The Sky Cruiser stands on something.**
 *
 * There was no invariant of any kind on this ride's supports — the pylon mesh
 * did not even have a name — which is how it came to be flying on four posts
 * with nothing saying so. The slide has `theGinormousSlideStandsOnSomething`;
 * this is the same claim for the cruiser.
 */
const railScratch = new Vector3();
const railTangentScratch = new Vector3();

const skyCruiserStandsOnItsOwnSupports: Invariant = (facts) => {
  const complaints: string[] = [];
  const coaster = facts.world.coaster;
  const pylons = coaster.group.getObjectByName('skyCruiser:pylons');
  if (!(pylons instanceof InstancedMesh)) {
    return ['the Sky Cruiser has no named pylon mesh in the built scene to measure'];
  }
  if (pylons.count === 0) {
    return ['the Sky Cruiser built no supports at all — the whole ride is in the air'];
  }

  const matrix = new Matrix4();
  const point = new Vector3();
  const ats: number[] = [];
  let worstReach = 0;
  let worstAt: readonly [number, number] = [0, 0];

  for (let i = 0; i < pylons.count; i += 1) {
    pylons.getMatrixAt(i, matrix);
    const top = new Vector3(0, 0.5, 0).applyMatrix4(matrix);

    // Its top is under the track, not under fresh air. `nearestPoint` is the
    // route's own answer, so this is the built post against the built route.
    const on = coaster.route.nearestPoint(top.x, top.z);
    const reach = Math.hypot(on.x - top.x, on.z - top.z);
    if (reach > worstReach) {
      worstReach = reach;
      worstAt = [top.x, top.z];
    }

    // Where along the loop it carries, for the gap measurement below.
    let best = 0;
    let bestD = Infinity;
    for (let d = 0; d < coaster.route.length; d += 1) {
      coaster.route.pointAt(d, point);
      const dd = Math.hypot(point.x - top.x, point.z - top.z);
      if (dd < bestD) {
        bestD = dd;
        best = d;
      }
    }
    ats.push(best);
  }

  // A "is the foot on the terrain" assertion deliberately does not live here:
  // `terrainHeight` reaches `parkManifest` through `boundary.ts`, and a static
  // import of it into this file would fix the park's seed before the harness
  // sets it — the 76-silent-skips failure. `parkFacts.ts` reaches terrain
  // through a dynamic `await import` for exactly that reason, and an invariant
  // is synchronous. The planner takes each foot straight from `terrainHeight`
  // anyway; what was never measured, and is measured below, is whether the
  // posts exist and reach the track.
  if (worstReach > 1.5) {
    complaints.push(
      `a Sky Cruiser pylon at ${fmt(worstAt)} tops out ${worstReach.toFixed(2)} m from the route it ` +
        'is meant to be holding up',
    );
  }

  ats.sort((a, b) => a - b);
  let longest = 0;
  let longestAt = 0;
  for (let i = 0; i < ats.length; i += 1) {
    const next = i + 1 < ats.length ? ats[i + 1]! : ats[0]! + coaster.route.length;
    const gap = next - ats[i]!;
    if (gap > longest) {
      longest = gap;
      longestAt = ats[i]!;
    }
  }
  // Track over ground a pylon could never stand on — the railway corridor,
  // the paving, a plot, or a stretch too low to need a post — cannot fairly
  // demand a pylon of its own, so it is discounted from the per-pylon
  // average, using exactly the same legitimacy set the open-span rule below
  // measures with (2026-08-23: a re-rolled seed 2 flew 200.3 m of loop with
  // long stretches over the railway and the statue ring's paving, and the
  // raw average condemned a ride whose every OPEN stretch was carried fine).
  let exemptLength = 0;
  {
    const groundClearanceHere = facts.cruiserRouteGroundClearance;
    for (let d = 0; d < Math.floor(coaster.route.length); d += 1) {
      coaster.route.pointAt(d, point);
      const overPlot = facts.plots.some(
        (plot) =>
          Math.hypot(point.x - plot.x, point.z - plot.z) < plot.boundingRadius + OPEN_SPAN_PLOT_SKIRT,
      );
      const overPath = !overPlot && nearestPathClearance(facts, point.x, point.z) < OPEN_SPAN_PATH_CLEARANCE;
      const overRail = (() => {
        if (overPlot || overPath) return false;
        const trainRoute = facts.world.train.route;
        trainRoute.pointAt(trainRoute.distanceNear(point.x, point.z), railScratch);
        return Math.hypot(railScratch.x - point.x, railScratch.z - point.z) < 5.5;
      })();
      const tooLow =
        !overPlot &&
        !overPath &&
        !overRail &&
        (groundClearanceHere[
          ((d % groundClearanceHere.length) + groundClearanceHere.length) % groundClearanceHere.length
        ] ?? Infinity) < OPEN_SPAN_MIN_PYLON_HEIGHT;
      if (overPlot || overPath || overRail || tooLow) exemptLength += 1;
    }
  }
  const demandingLength = coaster.route.length - exemptLength;
  const trackPerPylon = demandingLength / pylons.count;
  if (trackPerPylon > CRUISER_MAX_TRACK_PER_PYLON) {
    complaints.push(
      `the Sky Cruiser carries ${demandingLength.toFixed(1)} m of pylon-demanding track ` +
        `(${coaster.route.length.toFixed(1)} m loop, ${exemptLength.toFixed(1)} m over ` +
        `rail/paving/plots/low ground) on ${pylons.count} pylons — one every ` +
        `${trackPerPylon.toFixed(1)} m, over the ` +
        `${CRUISER_MAX_TRACK_PER_PYLON} m that reads as a ride standing on something. This is the ` +
        'shape of the four-pylons-on-217-m defect.',
    );
  }
  if (longest > CRUISER_MAX_UNSUPPORTED_SPAN) {
    complaints.push(
      `the Sky Cruiser runs ${longest.toFixed(1)} m without a support, from ${longestAt.toFixed(1)} m ` +
        `along its ${coaster.route.length.toFixed(1)} m loop — over the ` +
        `${CRUISER_MAX_UNSUPPORTED_SPAN} m a track may span and still look carried. It has ` +
        `${pylons.count} pylons in total.`,
    );
  }

  // --- issue #301 (and #312): a gap over plain lawn has no excuse ----------
  //
  // Walks every gap between consecutive built pylons (the same `ats`, already
  // sorted above) and finds the longest run, anywhere on the loop, that is
  // neither over a plot, near the paved network, nor low enough over the
  // ground to be the station's own boarding dip — see
  // {@link CRUISER_MAX_OPEN_UNSUPPORTED_SPAN}'s own comment for why that is
  // the one shape of gap this ride cannot legitimately have.
  const groundClearance = facts.cruiserRouteGroundClearance;
  let worstOpen = 0;
  let worstOpenAt = 0;
  for (let i = 0; i < ats.length; i += 1) {
    const start = ats[i]!;
    const end = i + 1 < ats.length ? ats[i + 1]! : ats[0]! + coaster.route.length;
    let contig = 0;
    let contigStart = start;
    for (let d = start; d < end; d += 1) {
      coaster.route.pointAt(d % coaster.route.length, point);
      const overPlot = facts.plots.some(
        (plot) =>
          Math.hypot(point.x - plot.x, point.z - plot.z) < plot.boundingRadius + OPEN_SPAN_PLOT_SKIRT,
      );
      const overPath = !overPlot && nearestPathClearance(facts, point.x, point.z) < OPEN_SPAN_PATH_CLEARANCE;
      // Over the railway corridor — a fourth legitimate reason, measured
      // off the solved loop (2026-08-23, canonical seed re-rolled by the
      // statue-ring layout rule: the cruiser paralleled the railway for a
      // 16 m stretch, and a pylon can no more stand on the track and its
      // fence box than it can stand on paving). `RAIL_CORRIDOR_CLEARANCE`
      // is the same "how far must a structure stand off the rail" answer
      // the pylon search itself lives by (its foot plus that clearance).
      const overRail = (() => {
        if (overPlot || overPath) return false;
        const trainRoute = facts.world.train.route;
        trainRoute.pointAt(trainRoute.distanceNear(point.x, point.z), railScratch);
        return Math.hypot(railScratch.x - point.x, railScratch.z - point.z) < 5.5;
      })();
      // `d` is always a whole number of metres here (both `ats` and this
      // loop's own step are integers), so this is an exact lookup into
      // `cruiserRouteGroundClearance`'s own 1 m sampling — not a re-derivation
      // of `pylons.ts`'s rule, a read of the built loop against the built
      // terrain (see that field's own comment).
      const tooLowToNeedAPost =
        !overPlot &&
        !overPath &&
        (groundClearance[((d % groundClearance.length) + groundClearance.length) % groundClearance.length] ??
          Infinity) < OPEN_SPAN_MIN_PYLON_HEIGHT;
      if (overPlot || overPath || overRail || tooLowToNeedAPost) {
        contig = 0;
        continue;
      }
      if (contig === 0) contigStart = d;
      contig += 1;
      if (contig > worstOpen) {
        worstOpen = contig;
        worstOpenAt = contigStart;
      }
    }
  }
  if (worstOpen > CRUISER_MAX_OPEN_UNSUPPORTED_SPAN) {
    complaints.push(
      `the Sky Cruiser runs ${worstOpen.toFixed(1)} m without a support over plain open lawn, from ` +
        `${worstOpenAt.toFixed(1)} m along its ${coaster.route.length.toFixed(1)} m loop — clear of every ` +
        `plot and the paved network, so nothing legitimately explains the gap. Over the ` +
        `${CRUISER_MAX_OPEN_UNSUPPORTED_SPAN} m open ground may span unsupported (issue #301: the search ` +
        'should have felled whatever foliage was refusing a spot here rather than skip it).',
    );
  }

  return complaints;
};

/**
 * **The park really is twice the park** — the missing half of #115, added
 * with issue #241. `generateParkBoundary` is handed a target area and solves
 * an outline that hits it in closed form, and for a year of Augusts nothing
 * compared the two: the park was 2x by intention and unmeasured by result.
 * The tolerance is generous against the construction (the sampled polygon
 * differs from the analytic curve by ~0.001%) precisely so that a failure
 * here can only ever mean the construction itself broke.
 */
const parkAreaIsWhatWasAsked: Invariant = (facts) => {
  const drift = Math.abs(facts.boundary.area - facts.boundaryTargetArea) / facts.boundaryTargetArea;
  if (drift < 0.01) return [];
  return [
    `the built boundary encloses ${facts.boundary.area.toFixed(0)} m2 against a target of ` +
      `${facts.boundaryTargetArea.toFixed(0)} m2 — ${(drift * 100).toFixed(2)}% off, over the 1% tolerance`,
  ];
};

/**
 * **Every plot stands wholly inside the park's edge**, with a walkable lane
 * to spare — the constraint that replaced `PLOT_EXTENT_LIMIT = 52` (issue
 * #241), measured on what was built: the solver promises 2.5 m of lane, and
 * this asserts the game's own minimum ({@link WALKABLE_GAP}) so the check
 * only fires when a child genuinely cannot squeeze round the outside.
 */
const plotsStayInsideTheBoundary: Invariant = (facts) => {
  const outside: string[] = [];
  for (const plot of facts.plots) {
    const lane = facts.boundary.distanceToEdge(plot.x, plot.z) - plot.boundingRadius;
    if (lane < WALKABLE_GAP) {
      outside.push(`${plot.id} leaves only ${lane.toFixed(2)} m of lane to the park's edge`);
    }
  }
  return outside;
};

/**
 * **The attractions use the park that exists** — issue #241's whole point,
 * measured as coverage: no walkable point of the park may be desolate, i.e.
 * further from every attraction than half the park's largest span. On the
 * pre-#241 layouts this fails resoundingly (the plots huddled inside the old
 * 52 m circle while the boundary bulged to 100+), which is how the threshold
 * was chosen: the worst desolate distance across the five CI seeds AFTER the
 * spread is 52-61 m; before it, 70-90. 66 splits the two populations with
 * headroom on the honest side, and it is derived from the boundary the seed
 * actually built rather than hand-tuned per seed.
 */
const attractionsUseTheWholePark: Invariant = (facts) => {
  let worst = 0;
  let worstAt: readonly [number, number] = [0, 0];
  for (let x = Math.ceil(facts.boundary.extent.minX); x <= facts.boundary.extent.maxX; x += 4) {
    for (let z = Math.ceil(facts.boundary.extent.minZ); z <= facts.boundary.extent.maxZ; z += 4) {
      if (facts.boundary.distanceToEdge(x, z) < 4) continue;
      let nearest = Infinity;
      for (const plot of facts.plots) {
        const d = Math.hypot(x - plot.x, z - plot.z) - plot.boundingRadius;
        if (d < nearest) nearest = d;
      }
      if (nearest > worst) {
        worst = nearest;
        worstAt = [x, z];
      }
    }
  }
  if (worst < 66) return [];
  return [
    `the lawn at (${worstAt[0]}, ${worstAt[1]}) is ${worst.toFixed(1)} m from the nearest ` +
      'attraction — the park has a desolate quarter, which is what #241 exists to prevent',
  ];
};

/**
 * **The Land Hotel stands close to the castle** — Eleri's requirement,
 * verbatim from issue #236, measured on the built layout. 45 m centre to
 * centre is the widest that still reads as "next to" against the castle's
 * own 19 m bulk: the doormats end up a short walk apart on every seed.
 */
const hotelIsCloseToTheCastle: Invariant = (facts) => {
  const hotel = facts.plots.find((plot) => plot.id === 'hotel');
  const castle = facts.plots.find((plot) => plot.id === 'building');
  if (!hotel) return ['the layout placed no hotel at all'];
  if (!castle) return ['the layout placed no castle at all'];
  const gap = Math.hypot(hotel.x - castle.x, hotel.z - castle.z);
  if (gap < 45) return [];
  return [`the hotel stands ${gap.toFixed(1)} m from the castle — Eleri asked for close`];
};

/**
 * **No two tap targets in the park sit inside a finger of each other, unless
 * they do the same thing** — the tap-spacing rule (`world/tapSpacing.ts`;
 * Jim, live play on a phone, 8 Aug 2026, after a window zone ate every tap
 * aimed at a hotel door). The hotel's fixed rooms are measured by
 * `check:tap-spacing`; this covers what *moves with the seed* — the stalls,
 * the solved train's platforms, and the seeded flower meadow, which keeps its
 * pickable blooms out of both (`Flowers.insideAnyTapKeepOut`).
 *
 * Measured on the built world's own zone list, exactly what a tap is tested
 * against — never on the scatter rules. Same-verb pairs (two flowers, two
 * chairs) are ambiguity without harm and are not complaints.
 *
 * Proven red by disabling the flower keep-out: the canonical seed grew
 * flower 111 within 0.59 m of the water-fight stall's pick edge.
 */
const tapTargetsKeepTheirDistance: Invariant = (facts) => {
  const complaints: string[] = [];
  const zones = facts.world.interactZones();
  for (let a = 0; a < zones.length; a += 1) {
    for (let b = a + 1; b < zones.length; b += 1) {
      const one = zones[a]!;
      const two = zones[b]!;
      if (!sameStorey(one.y, two.y)) continue;
      if (!differentActions(one, two)) continue;
      const separation = zoneSeparation(one, two);
      if (separation >= TAP_FINGER_METRES) continue;
      complaints.push(
        `'${one.id}' and '${two.id}' sit ${Math.max(0, separation).toFixed(2)} m apart beyond ` +
          `the bigger pick radius — a tap aimed at one does the other ` +
          `(rule: ${TAP_FINGER_METRES.toFixed(2)} m, world/tapSpacing.ts)`,
      );
    }
  }
  // …and the walk-through doorways: nothing may eat a tap aimed at a door.
  const bands = [facts.world.hotel.towerDoorBand(), ...facts.world.building.doorBands()];
  for (const zone of zones) {
    for (const band of bands) {
      if (band.ownZoneId === zone.id) continue;
      if (!sameStorey(zone.y, band.y)) continue;
      const clearance = zoneBandClearance(zone, band);
      if (clearance >= TAP_FINGER_METRES) continue;
      complaints.push(
        `'${zone.id}' sits ${clearance.toFixed(2)} m clear of ${band.what} — ` +
          `a tap aimed at the door selects it instead (rule: ${TAP_FINGER_METRES.toFixed(2)} m)`,
      );
    }
  }
  return complaints;
};

/**
 * **The arrival reaches its end, and the controls change hands.**
 *
 * Jim, playing the deployed game, 9 August 2026: *"the cat bus never reached
 * its destination due to there being a cone shaped object in the middle of the
 * road."*
 *
 * A whole feature shipped, and then failed on the first thing a player ever
 * sees, with a dozen checks green over it. Every one of them measured a
 * *property* of the sequence — the 45-degree aisle pan, the composition
 * percentages, the glazing line, twelve seated children, byte-identical parks,
 * the skip offered in both directions — and **not one asked whether the ride
 * finishes.** Both existing director checks reach `readyToHandOver === true` by
 * hand-calling `noteParkReady()` and `noteWarmupReady()` on a bare
 * `JourneyDirector` wired to no scene, no world and no player, which proves
 * three booleans AND together correctly and nothing else at all.
 *
 * This is the assertion whose absence let that happen: the sequence runs, and
 * it ends. See `parkFacts.ts`'s `runTheArrival` for what is real in the run
 * (the director, the journey, the shader queue over this seed's own park scene,
 * the ordering) and the one thing that is not (`renderer.compile` needs a GPU).
 *
 * **Both runs matter.** The overrun — generation outlasting the ride — is a
 * legitimate wait, and `JourneyDirector.overrunning`'s own doc says it is
 * "never true today", which is precisely the kind of claim that needs a run
 * rather than a comment. A bus that idles at the gate for ever is what a stuck
 * child actually experiences.
 */
const theArrivalReachesItsEnd: Invariant = (facts) => {
  const fouls: string[] = [];
  for (const run of [facts.arrivalRuns.onTime, facts.arrivalRuns.overrun]) {
    if (!run.handedOver) {
      fouls.push(
        `the arrival never ended — ${run.what}. It ran ${run.seconds.toFixed(1)} s ` +
          `(${run.frames} frames) to the ${run.ceilingSeconds} s ceiling without ` +
          `\`readyToHandOver\` ever coming true, so the bus idles and the park never ` +
          `takes the screen. Director at the end: ${run.finalState}`,
      );
      continue;
    }
    // A hand-over that fires before the ride has run is not the sequence
    // ending, it is the sequence being skipped — and it would pass a bare
    // "did it finish" question while putting a child in the park mid-shot.
    if (run.handOverSeconds < run.rideSeconds - 1e-6) {
      fouls.push(
        `the arrival ended early at ${run.handOverSeconds.toFixed(2)} s, before the ` +
          `${run.rideSeconds} s ride was over — ${run.what}`,
      );
    }
    // The skip is the child's own way out, and it is the only one she has
    // while the bus is waiting. If it is never offered, an overrun is a trap.
    if (run.skipOfferedSeconds < 0) {
      fouls.push(
        `the arrival ended, but the skip was never offered along the way — ${run.what}. ` +
          `A run that can only end by itself has no way out when it cannot.`,
      );
    }
  }
  return fouls;
};

/**
 * **Nothing stands in the road the cat bus drives up to the park on.**
 *
 * The other half of the same bug. `BusJourney.buildParkAhead` scattered the
 * silhouettes that stand over the park's wall across `x = (rng() - 0.5) * 120`
 * with nothing excluding the carriageway, while `journey-road` runs seventy
 * metres *past* the gate — so a six-metre `ConeGeometry` rooftop stood at
 * `x = -1.46, z = -258.7`, filling the arch. That is the cone Jim saw, and the
 * road ran straight at it for the whole approach.
 *
 * Nothing collides on the journey — the bus's `z` is arithmetic off the ride
 * clock — so this is not a guard against the bus being *stopped*. It is a guard
 * against the lane telling a child something that is not true: that the road
 * she is watching goes nowhere.
 *
 * **The threshold is the game's**, `road.ts`'s `ROAD_HALF_WIDTH`, which is
 * derived from the bus's own width — not `BusJourney`'s `PARK_AHEAD_CLEAR`,
 * which is what the generator aims for. Measuring against the generator's own
 * target would make this a tautology; measuring against the road leaves the
 * 1.6 m of headroom that says the fix has room rather than sitting on the line.
 */
const nothingStandsInTheLanesCarriageway: Invariant = (facts) => {
  return facts.laneCarriageway.map(
    (hit) =>
      `\`${hit.node}\`${hit.instance >= 0 ? ` #${hit.instance}` : ''} stands in the journey ` +
      `lane's carriageway: it reaches ${hit.reach.toFixed(2)} m inside the road edge, at ` +
      `x=${hit.x.toFixed(2)} y=${hit.y.toFixed(2)} z=${hit.z.toFixed(1)}. The road is ` +
      `${(facts.laneRoadHalfWidth * 2).toFixed(2)} m wide and the bus drives down the middle of it.`,
  );
};

/**
 * **The lane's furniture** — the things beside the road that are deliberately
 * not trees, and are therefore allowed not to be built from the park's trees.
 *
 * An allow-list rather than a shape test, and that is the point: adding a new
 * population to the lane goes red until whoever added it either builds it out
 * of `world/treeModel.ts` or comes here and says, in one line, what it is. The
 * pink cones would have had to be declared *"54 rooftop silhouettes"* in
 * writing, next to a road they were standing in.
 *
 * Kept deliberately short. Everything here is a thing that genuinely cannot be
 * a tree.
 */
const LANE_FURNITURE = new Map<string, string>([
  ['journey-road', 'the carriageway itself'],
  ['journey-ground', 'the hills the lane is painted on'],
  ['journey-hedge', 'blobs hugging the kerb, close enough to sell the speed'],
  ['journey-park-wall', "the park's boundary masonry, seen from outside"],
  ['journey-park-gate', 'the arch the road goes through'],
]);

/**
 * **Nothing grows in the lane but the park's own trees.**
 *
 * Jim, 9 August 2026, on the deployed game: *"Can we just remove these mystery
 * items? Use the actual tree models same as the game uses by the side of the
 * road but not on it."*
 *
 * The lane had been growing lookalikes — a cylinder under one
 * `IcosahedronGeometry(1, 1)` ball — beside a population of pink
 * `ConeGeometry` "rooftops" that no player could identify. Both are gone; the
 * lane now plants `world/treeModel.ts`'s trees, the same objects the park's own
 * lawn plants.
 *
 * **This asks about identity, not shape**, and the distinction is the whole
 * value of the check. A hand-built copy of a lollipop tree could be
 * pixel-identical and would still fail here, because what goes wrong with a
 * copy is never how it looks on the day it is written — it is that the original
 * moves on and the copy does not. `FOLIAGE_GEOMETRY`'s three `BufferGeometry`
 * objects are shared by reference, so "is this the park's tree?" has an exact
 * answer and no threshold to argue about.
 *
 * It is also a **no-mystery-items** guard, which is the other half of what Jim
 * asked for: anything drawn in the lane that is neither one of the park's trees
 * nor declared in {@link LANE_FURNITURE} is a foul. A new unexplained shape
 * beside the first road a child ever sees now fails the build instead of
 * reaching production and being mistaken for a traffic cone.
 */
const nothingGrowsInTheLaneButTheParksOwnTrees: Invariant = (facts) => {
  const fouls: string[] = [];

  for (const thing of facts.laneGreenery) {
    if (thing.parkTreeGeometry !== null) continue;
    if (LANE_FURNITURE.has(thing.population)) continue;
    fouls.push(
      `\`${thing.population}\`${thing.node && thing.node !== thing.population ? ` (${thing.node})` : ''} ` +
        `draws ${thing.instances} instance(s) of a \`${thing.geometryType}\` that is not one of the ` +
        `park's own tree shapes. Either plant it with \`rollTree\` from ` +
        `\`world/treeModel.ts\`, so it stays the same tree the park grows, or add it to ` +
        `LANE_FURNITURE saying what it is. A shape a player cannot name, beside the first ` +
        `road she ever sees, is how the pink cones happened.`,
    );
  }

  // The other direction: the lane must actually *be* planted. Without this the
  // check above passes triumphantly on a lane with no trees in it at all —
  // "every tree is the park's own" is trivially true of no trees, which is
  // exactly the shape of green-because-incapable-of-failing this repo keeps
  // being bitten by.
  const planted = facts.laneGreenery
    .filter((thing) => thing.parkTreeGeometry !== null)
    .reduce((total, thing) => total + thing.instances, 0);
  if (planted < 500) {
    fouls.push(
      `the journey lane draws only ${planted} park-tree instances. The verges and the ` +
        `woodland behind the park wall together stand up about 1450 on the canonical seed, ` +
        `so this means the planting has largely stopped happening.`,
    );
  }

  return fouls;
};

const INVARIANTS: readonly (readonly [string, Invariant])[] = [
  ['the arrival reaches its end and hands over', theArrivalReachesItsEnd],
  ['the ginormous slide clears the garden on the castle roof', theSlideClearsTheCastleRoofGarden],
  ['nothing stands in the journey lane carriageway', nothingStandsInTheLanesCarriageway],
  ["nothing grows in the lane but the park's own trees", nothingGrowsInTheLaneButTheParksOwnTrees],
  ['no two tap targets crowd each other or a doorway', tapTargetsKeepTheirDistance],
  ['the park really is twice the park', parkAreaIsWhatWasAsked],
  ['every plot stands wholly inside the boundary', plotsStayInsideTheBoundary],
  ['the attractions use the whole park', attractionsUseTheWholePark],
  ['the Land Hotel stands close to the castle', hotelIsCloseToTheCastle],
  ['no two wall runs cross or crowd each other', wallsDoNotClash],
  ['no wall run stands on the railway', wallsClearTheRailway],
  ['every wall run sits on a grid axis and actually borders something', wallsBorderTheGridSensibly],
  ['every wall run goes alongside a path, and some stand flush against one', wallsRunAlongsideAPath],
  ['no tree stands on the railway', treesClearTheRailway],
  ['no flower grows on the railway', flowersClearTheRailway],
  ['no entrance prop stands on the railway', entrancePropsClearTheRailway],
  ['the train runs through no plot and no stall', trainClearsEveryPlotAndStall],
  ['the park train keeps its turning circle', trainKeepsItsTurningCircle],
  ['no two plots overlap', plotsDoNotOverlap],
  ['no two stations stand in each other', stationsDoNotCrowdEachOther],
  ['every entrance has standable ground', entrancesAreUsable],
  [
    'the park gate arch stands over its gateway, and the gateway stays open',
    theParkGateArchStandsOverItsGateway,
  ],
  ['no two trees interpenetrate', treesDoNotInterpenetrate],
  ['no bush stands on the paving or inside a plot', bushesStandOnOpenGround],
  ['no tree grows into a wall', treesKeepOffWalls],
  ['no bush grows through a wall or out of a tree', bushesGrowThroughNothing],
  ['every path passes near a tree a child can climb', everyPathIsNearAClimbableTree],
  ['no lamp stands in anything', lampsTouchNothing],
  ['every path is lit end to end', everyPathIsLit],
  ['no paved path stops anywhere but a destination', noPathEndsNowhere],
  ['every plot faces exactly the camera axis', buildingsFaceTheCameraAxis],
  ['every paved path runs on grid axes', pathsRunOnGridAxes],
  ['the grid verdict does not depend on which route object carries the paving', gridAxisVerdictsIgnoreTheCarrier],
  ['every street sits on the shared 12 m lattice', streetsShareLatticeLines],
  ['the ring road is one true circle round the statue', ringIsATrueCircleRoundTheStatue],
  ['every place a child can be served is a node in the path graph', everyDestinationIsANode],
  [
    'no two close destinations are left with a wildly disproportionate paved detour',
    detourRatiosStayReasonable,
  ],
  ['every ride exit is clear ground, reachable from the entrance', rideExitsAreUsable],
  ['the Rail Race exit fits the whole party that arrives on it', railRaceExitFitsTheParty],
  ['the Rail Race flies clear of the railway and stands on clear ground', railRaceFliesClear],
  ['every Rail Race duck bar stands over a real trestle leg', duckBarsStandOnRealSupports],
  ['every Rail Race duck bar slows you down where it stands', duckBarsSlowYouWhereTheyStand],
  ['the Rail Race finish rainbow clears every rider', finishRainbowClearsEveryRider],
  ['the Rail Race finish rainbow stands on the ground', finishRainbowStandsOnTheGround],
  ['every support meets the track it carries', supportsMeetWhatTheyCarry],
  [
    'every Rail Race trestle forks twice and carries all four tracks',
    railRaceTrestlesCarryEveryTrack,
  ],
  ['the Rail Race sleepers bridge both rails, a metre apart', railRaceSleepersBridgeBothRails],
  [
    'every racer meets the same number of duck bars, and no two bars touch',
    duckBarsAreOnePerLaneAndNeverTouch,
  ],
  ['the Sky Cruiser stands on its own supports', skyCruiserStandsOnItsOwnSupports],
  ['the Rail Race camera never runs backwards', raceCameraNeverRunsBackwards],
  [
    'both Rail Race rings stand outside the park, built to their own size, ' +
      'and only the walk-past one is solid',
    railRaceRingsStandOutsideThePark,
  ],
  ["the rail-race stall's doormat is standable and reachable", railRaceStallDoormatIsUsable],
  ["every keychain keyring's stand point is standable and reachable", keychainStallStandIsUsable],
  ['the Sky Cruiser flies clear of the whole park', skyCruiserFliesClearOfThePark],
  ['the Sky Cruiser goes round the big wheel', skyCruiserGoesRoundTheBigWheel],
  ['the Sky Cruiser built track turns as gently as it promises', skyCruiserTurnsGently],
  [
    'the ginormous slide goes downhill all the way, lands in the ball pit, ' +
      'and never runs back inside the castle',
    theGinormousSlideIsRideable,
  ],
  [
    'the ginormous slide stands on legs a child can walk between',
    theGinormousSlideStandsOnSomething,
  ],
  [
    'the ginormous slide leaves the castle over the top of the battlements',
    theGinormousSlideLeavesOverTheBattlements,
  ],
  [
    'the ginormous slide does not clip the castle towers',
    theGinormousSlideMissesTheCastleTowers,
  ],
  [
    "the ginormous slide's cameras cover the whole ride and can see it",
    theSlideTracksideCamerasCanSeeTheRide,
  ],
  ['a child boarding the ginormous slide is put down on the chute', theSlideRiderSitsOnTheChute],
  [
    'a child finishing the ginormous slide lands in the balls, clear of the chute',
    theSlideRiderLandsInTheBalls,
  ],
  ['about half the ginormous slide’s chute is see-through', theChuteIsHalfSeeThrough],
  ['the ginormous slide keeps its air from the Sky Cruiser', theSlideKeepsItsAirFromTheCruiser],
  ['the Sky Cruiser fits through the window it cut in the castle', skyCruiserFitsThroughTheCastle],
  ['the Sky Cruiser always flies through the castle', skyCruiserAlwaysFliesThroughTheCastle],
  [
    'the clearance over the railway covers the train and everyone riding it',
    railwayClearanceCoversTheTrainAndItsRiders,
  ],
  ['every railway crossing has a bridge you can walk to, onto and across', everyBridgeIsWalkableAndReachable],
  [
    'nothing a bridge builds hangs into its own tunnel, measured by ray from the rail',
    nothingHangsIntoTheTunnel,
  ],
  [
    'every modelled coping stone sits on the wall it caps',
    everyCopingStoneSitsOnItsWall,
  ],
  [
    'no bridge parapet can be seen through — its outer face reaches the wall top',
    noBridgeParapetCanBeSeenThrough,
  ],
  [
    'every bridge is as wide as its own path, with the rail corridor open beneath',
    bridgesMatchTheirPathAndKeepTheRailClear,
  ],
  [
    "the park's own paving rides over every bridge, and none is left in a tunnel",
    theDrawnPathRidesOverEveryBridge,
  ],
  [
    "every bridge's carried paving has its own masonry under it",
    bridgePavingIsCarriedByItsOwnMasonry,
  ],
  [
    'railway crossings are planned — station-clear, and mostly real bridges',
    crossingsArePlannedAndWalkable,
  ],
  [
    'every crossing on a site the planner proved bridgeable still carries its bridge',
    everyProvenBridgeSiteKeepsItsBridge,
  ],
  ['no drawn path ends in mid-air on a bridge', noDrawnPathEndsStrandedOnABridge],
  [
    'no bridge stands where the crossing planner proved none fits',
    noBridgeStandsWhereNoneWasProven,
  ],
  [
    'the walk in from the gate crosses the railway where the planner planned it to, on a bridge',
    theWalkInFromTheGateCrossesWhereItWasPlannedTo,
  ],
  ['the cat bus is actually in the park, at the gate, with everyone aboard', theCatBusIsInThePark],
  ['every child fits in the cat bus seat they are sitting in', childrenFitTheSeatsTheySitIn],
  ['the boundary wall has a gate you can actually walk through', theGateIsAHoleInTheWall],
  ['a child can walk in through the front gate', theWalkInFromTheGateIsWalkable],
  ['the road arrives at the park and goes in through the gate', theRoadArrivesAtTheParkAndGoesIn],
  [
    'the bus stop and the walk in from it are clear of trees and bushes',
    theEntranceIsClearEnoughToArriveAt,
  ],
  ['you can see the cat bus she arrives on', nothingPlantedHidesTheArrivingBus],
];

/**
 * Registers every invariant for one seed.
 *
 * The park is built **once** per seed in `beforeAll` and shared: it is a few
 * hundred milliseconds of real `World` construction, and building it per
 * assertion would turn a fast suite into a slow one for no extra proof.
 */
export function registerParkInvariants(seed: number, label = `seed ${seed}`): void {
  describe(label, () => {
    let facts: ParkFacts;

    beforeAll(async () => {
      facts = await buildParkFacts(seed);
      // 300 s, up from 120: a park build is solver work, and the cruiser's
      // search legitimately runs tens of seconds on an awkward seed (58 s
      // worst measured locally, PR #253's report) — a 2-3x slower CI runner
      // put seed 5 on the old cliff and it began failing roughly every
      // other run, on branches AND on main (both 8 Aug 2026), with no code
      // at fault either time. The ceiling still exists to catch a genuine
      // hang; it just no longer prosecutes an honest solve. The structural
      // fix is the cruiser's own cost, tracked separately.
    }, 300_000);

    it('built the park it was asked for', () => {
      expect(facts.seed).toBe(seed);
      // A park with no walls, no trees or no lamps would pass every clearance
      // invariant below vacuously. This is the guard against that.
      //
      // Trees get a real floor rather than `> 0`, because thinning the scatter
      // is the cheapest possible way to make a clearance invariant go green and
      // it is not a hypothetical: adding `treesKeepOffWalls` took the canonical
      // seed from 30 trees to 19 until the scatter's attempt budget was raised
      // to buy them back.
      //
      // **This floor cannot catch every thinning, and the number is chosen
      // knowing that.** Measured both ways round — healthy park 26/27/26/30/28
      // across the five seeds, the same park with the budget reverted
      // 19/23/23/27/23 — the two sets *overlap*: seed 11 thinned (27) plants
      // more than the canonical seed healthy (26). So no single floor can
      // separate them everywhere, and any threshold low enough to keep a real
      // park green necessarily lets seed 11's thinning through.
      //
      // 24 is the best a global floor does: it catches 4 of the 5 seeds and
      // still leaves the healthiest-but-lowest real seed two trees of headroom
      // for ordinary seed-to-seed drift. Four suites going red at once is a
      // loud enough signal; running on five seeds is what makes it work, not
      // the cleverness of the number. Raising it to 25 would catch no more and
      // leave one tree of headroom, so it is not worth the false alarms.
      //
      // An anti-vacuity guard, not a placement threshold — the "thresholds come
      // from the game" rule above is about the latter.
      expect(facts.trees.length, 'the park planted almost no trees').toBeGreaterThan(24);
      // Bushes get a floor for the same reason, and they need one more than
      // they used to. The clump count was pinned at exactly 108 by a
      // fill-until-N loop; it is now whatever a fixed budget of candidates
      // passes, which is the price of the scatter being local (see
      // `Scenery.ts`'s `BUSH_BUDGET`). That makes thinning something that can
      // now happen quietly, so it gets a guard.
      //
      // **The table that stood here was the same stale one `Scenery.ts` was
      // carrying** — 149 / 128 / 137 / 142 / 140, a copy kept in step by hand
      // and, by #500, wrong by two to four times. Two definitions of one
      // measurement, which is this repo's most-repeated bug; the owner of what
      // the budget buys is `Scenery.ts`'s `BUSH_BUDGET` comment, and this
      // quotes no numbers of its own beyond the one it asserts.
      //
      // **And 107 had stopped guarding the thing the budget exists for.** It
      // was chosen when every seed planted 108, so it read as "no seed is
      // worse off than before". Today the five parks plant 295 / 266 / 201 /
      // 483 / 456, so a change that halved the scatter — the exact failure
      // `BUSH_BUDGET` was raised to 4200 to prevent, and the cheapest possible
      // way to make a clearance invariant go green — would leave the thinnest
      // park at 100 and this line **still green**. A floor that only fires
      // after a two-thirds collapse is not a floor.
      //
      // So it guards the property the budget was actually chosen for: **no
      // park is thinner than the day before #500**, whose worst park was 203.
      // 180 is that, less about a tenth for ordinary seed-to-seed drift as the
      // geometry moves — the thinnest park today (201) clears it by 21.
      //
      // **What a 50% thinning actually does to it, measured rather than
      // assumed** — the budget halved to 2100 plants 139 / 145 / 98 / 237 /
      // 220 across canonical / 5 / 11 / 24 / 131, so **three of the five go
      // red** at 180 where **one** did at 107. Not all five: seeds 24 and 131
      // sit high enough that halving still leaves them over the bar. A floor
      // is a per-park guard and the parks are not alike, so no single number
      // catches every thinning everywhere — the same thing the tree floor's
      // comment above says about its own 24, and the reason running on five
      // seeds is what does the work rather than the cleverness of the number.
      // Three suites going red at once is a loud enough signal.
      expect(facts.bushes.length, 'the park planted almost no bushes').toBeGreaterThan(180);
      // Climbable trees get their own floor, separate from the walk-distance
      // invariant, because the two fail differently: the distance check goes
      // red when they are badly spread, this one when there are simply too few.
      // A park could in principle satisfy the walk with four well-placed trees
      // and still feel bare.
      //
      // **This is the primary guard on Jim's complaint**, and it tightened a
      // long way when #216 landed. Measured across the five CI seeds at
      // 43 / 40 / 49 / 48 / 48 — up from 8 / 9 / 12 / 12 / 11 before that PR
      // stopped capping planting at 55 m, and from 1 / 2 / 2 / 3 / 5 under the
      // rule that had Jim hunting for a tree at all.
      //
      // The floor is 25: comfortably below the worst seed (40, so 37% of slack
      // for a park that regenerates), and comfortably *above* both earlier
      // populations, so it fails outright if either the old predicate or the
      // old planting cap comes back. It is deliberately not scaled to the
      // current park — a floor that tracks what the park happens to manage
      // catches nothing.
      expect(
        facts.climbableTrees.length,
        'the park planted almost nothing a child can climb',
      ).toBeGreaterThan(24);
      expect(facts.lamps.length, 'the park has no lamps').toBeGreaterThan(0);
      expect(facts.plots.length, 'the park placed no plots').toBeGreaterThan(0);
      expect(facts.exits.length, 'the park has no ride exits').toBeGreaterThan(0);
    });

    // The one place in this file that asserts. See {@link Invariant}.
    for (const [name, check] of INVARIANTS) {
      it(name, () => {
        const complaints = check(facts);
        expect(complaints, describeComplaints(complaints)).toHaveLength(0);
      });
    }
  });
}

// ------------------------------------------------------------------ helpers

/**
 * How many complaints a failure prints before it starts summarising.
 *
 * A badly-placed park can produce hundreds — `treesDoNotInterpenetrate` used to
 * cap its own message at eight for exactly this reason — and a wall of them
 * buries the first one, which is usually the one worth reading.
 */
const MAX_COMPLAINTS_SHOWN = 8;

/** The failure message for a set of complaints, capped so one bad seed does not bury the console. */
function describeComplaints(complaints: readonly string[]): string {
  const shown = complaints.slice(0, MAX_COMPLAINTS_SHOWN);
  const rest = complaints.length - shown.length;
  return rest > 0 ? `${shown.join('\n')}\n…and ${rest} more` : shown.join('\n');
}

function standableNear(facts: ParkFacts, x: number, z: number): boolean {
  if (facts.isStandable(x, z)) return true;
  const rings = 8;
  for (let i = 0; i < rings; i += 1) {
    const angle = (i / rings) * Math.PI * 2;
    const px = x + Math.cos(angle) * SHORTFALL_TOLERANCE;
    const pz = z + Math.sin(angle) * SHORTFALL_TOLERANCE;
    if (facts.isStandable(px, pz)) return true;
  }
  return false;
}

/**
 * How far `point` is from the paved *surface* of every ribbon but `exclude`'s
 * — zero once it is standing on one of them.
 *
 * The surface rather than the centre line: two ribbons have joined when their
 * paving meets, which is what makes a junction something a child can walk
 * through, and a 3.6 m backbone offers 1.8 m of that on either side.
 */
function distanceToOtherPaving(
  facts: ParkFacts,
  exclude: string,
  point: readonly [number, number],
): number {
  let best = Infinity;
  for (const edge of facts.pathEdges) {
    if (edge.name === exclude) continue;
    for (let i = 0; i < edge.points.length - 1; i += 1) {
      const gap = pointToSegment(point, edge.points[i]!, edge.points[i + 1]!) - edge.halfWidth;
      if (gap < best) best = gap;
    }
  }
  // The plaza is paving too, and a disc rather than a ribbon.
  for (const node of facts.pathNodes) {
    if (node.reach <= 0) continue;
    const gap = Math.hypot(point[0] - node.x, point[1] - node.z) - node.reach;
    if (gap < best) best = gap;
  }
  return Math.max(0, best);
}

function fmt(point: readonly [number, number]): string {
  return `${point[0].toFixed(1)}, ${point[1].toFixed(1)}`;
}
