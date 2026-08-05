import { Vector3 } from 'three';
import {
  BALL_PIT_RADIUS,
  BALL_PIT_X,
  BALL_PIT_Z,
  BUILDING_BASE_Y,
  BUILDING_CENTRE_X,
  BUILDING_CENTRE_Z,
  FACADE_SLIDE_DOOR_MAX_X,
  FACADE_SLIDE_DOOR_MIN_X,
  TOP_DECK,
  deckY,
} from '../building/layout';
import {
  BUILDING_HALF_X,
  BUILDING_HALF_Z,
  GARDEN_PLAY_RADIUS,
  PLAYER_RADIUS,
} from '../../core/constants';
import { TAU } from '../../core/mathUtils';
import { PARK_LAYOUT } from '../parkLayout';
import { PARK_SEED } from '../parkManifest';
import { COASTER_PLANS } from '../coaster/plan';
import { circleBoundary } from '../rail/boundary';
import { type OpenRouteBrief, type SolvedRailRoute, solveRailRoute } from '../rail/generate';
import { type Pose2, type SegmentKind, turnVocabulary } from '../rail/segments';
import { terrainHeight } from '../terrain';

/**
 * **The ginormous slide, as a plan.**
 *
 * Solved at module load from the park layout alone, exactly like
 * `coaster/plan.ts` and `train/plan.ts` — `paths.ts` needs this ride's exit to
 * be a node in the walk graph before any scene object exists.
 *
 * ### What was wrong with it before (#118)
 *
 * The slide was twelve hand-authored **absolute world coordinates**. The castle
 * moves per seed; those numbers did not. On the canonical seed eight of the
 * twelve sat inside the castle's own footprint, including the first and the
 * last, and the last one landed behind a solid wall segment — so a six-year-old
 * finished the ride sealed inside the tower with no way out.
 *
 * Nothing here is a coordinate anyone typed. The start is derived from the
 * facade's slide door, the end from the ball pit, and the shape between them
 * from the shared rail generator. Move the castle and the slide moves with it.
 *
 * ### Why it is an open route
 *
 * Every other rail ride here is a loop that returns to its station. A slide is
 * the one ride that manifestly does not: you get on at the top and you are
 * somewhere else at the bottom. That is why `rail/generate.ts` grew open-route
 * support, and why an open brief must name its `endPoses` — "where does this
 * ride put you down" is the exact question #118 was the answer going wrong.
 */

/** Half-width of chute to keep clear of things. The trough is ±0.95 m plus rails. */
const CORRIDOR_RADIUS = 1.45;

/**
 * Gentlest turn the chute may make.
 *
 * This is a comfort limit rather than a structural one, and it is paired with
 * {@link GIANT_SLIDE_SPEED}: what a rider feels sideways is v²/r, so the two
 * numbers only mean anything together. At 8 m/s round an 11 m bend it is 0.59 g
 * — a swooping helter-skelter a child enjoys. The old 12 m/s would have made
 * the same bend 1.33 g, which is a fairground ride you endure, and this one is
 * now ridden **first person**, where that lands in the inner ear rather than
 * the stomach.
 *
 * It is also what makes the route solvable at all. Wrapping the castle's
 * south-east corner from the parapet door round to the ball pit is a 180° turn
 * that has about 12.8 m of lateral room, so a 20 m minimum radius — tried
 * first — cannot physically fit, whatever else is or is not in the way.
 */
const MIN_TURN_RADIUS = 5;

/**
 * How close the chute may come to an earlier part of itself, in plan view.
 *
 * Kept deliberately generous. A slide *descends monotonically*, so unlike a
 * coaster its two passes over the same spot are at known, ordered heights and
 * crossing itself would in principle be safe. It is forbidden anyway: the
 * chute is a solid trough with hand-rails, not a thin rail, and one passing a
 * few metres over another reads as a mess from the ground.
 */
const SELF_CLEARANCE = 6;

/**
 * How fast a rider travels down the ginormous slide, in metres per second.
 *
 * Its own figure rather than `SLIDE_SPEED` (12 m/s), which the little
 * helter-skelter indoors keeps. 12 m/s is 43 km/h: fine over the gentle indoor
 * curve, watched from outside, and much too fast for this one now that it is
 * ridden from the rider's own eyes round a bend that wraps a castle. 8 m/s is
 * 29 km/h — still a proper rush down a 13.75 m drop, and it is what lets the
 * turns be tight enough to fit the park without throwing the camera about.
 */
export const GIANT_SLIDE_SPEED = 6.5;

/**
 * Metres of chute wanted, and the hard ceiling on it.
 *
 * An open route overshoots `desiredLength` far more than a loop does, and for a
 * structural reason: a loop is *finished* by a biarc back to a start pose it has
 * been steering at for a third of its length, whereas an open route's finisher
 * only fires when a legal biarc to the pit happens to exist, and grows until it
 * does. Asked for 68 m it produced 140.
 *
 * That is not merely long, it is the wrong ride: the drop is fixed at 13.75 m,
 * so length *is* gradient. Over 140 m the steepest part of the chute was 8°,
 * which is a lazy river with hand-rails. {@link MAX_LENGTH} is therefore
 * enforced as a rejection in this ride's own clearance predicate — a sample
 * further along than that is simply not a legal place to be, so the search
 * backtracks instead of wandering — and it gives roughly 14° average and 21°
 * steepest, which reads as a slide from the ground and rides like one.
 */
const DESIRED_LENGTH = 60;

/** The ceiling. See {@link DESIRED_LENGTH}. */
const MAX_LENGTH = 92;

/**
 * How far behind the pit the search lines itself up, in metres.
 *
 * The generator's own default is 38 m, which is a reasonable fraction of the
 * Sky Cruiser's 216 m loop and most of this 60 m slide — aiming that far behind
 * the pit leaves the head steering at a point it has already gone past, and the
 * biarcs home then want radii tighter than the ride allows. Measured: it cost
 * 900,000 rejected pieces and never solved.
 */
const APPROACH_DISTANCE = 12;

/** Metres of unobstructed run-in a landing must have, right at the pit. */
const FINAL_RUN_IN = 9;

/**
 * The level lip: the fraction of the chute that runs flat out of the parapet
 * before the drop begins.
 *
 * A slide off a tower has a lip at the top — you sit on the level bit, shuffle
 * forward, and *then* the floor goes away. So this is the shape the thing wants
 * anyway, but it is here for a measured reason as well.
 *
 * The chute crosses the Sky Cruiser's loop shortly after leaving the door, and
 * has to be {@link CRUISER_AIR} above it when it does. Descending from the
 * first metre it arrived over the crossing with 5.6 m of air against 5.5 m
 * required — which solves, barely, and only for some lengths, so the search
 * thrashed against a constraint it kept only just failing. Holding roof height
 * over the crossing turns a coin-toss into headroom.
 *
 * Smoothstep has zero gradient at its own start, so the flat lip meets the drop
 * with no kink: the join is smooth by construction rather than by tuning.
 *
 * It makes the ride better, too. The same 13.75 m of drop now happens over 82%
 * of the chute instead of all of it, so the steep part is steeper — nearer 23°
 * than 19° — and it is a plunge rather than a ramp.
 */
const LIP_FRACTION = 0.18;

/**
 * Air kept between the chute and the Sky Cruiser's centre line.
 *
 * Decision 4's rail-over-rail figure, and the same number
 * `test/procgen/invariants.ts` holds the rides to.
 *
 * This is a *derived* constraint, deliberately. The Sky Cruiser is being routed
 * through the castle by another engineer, and the honest way for two rides to
 * stay out of each other's way is not for either to hard-code the other's
 * numbers — that is precisely the mistake that produced #118. The slide asks
 * the cruiser's solved route where it actually is and routes around whatever it
 * finds, so it stays correct when that route changes.
 */
const CRUISER_AIR = 5.5;

/**
 * How close the two must be **horizontally** before that air is owed at all.
 *
 * The sum of the two rides' half-widths: this chute's {@link CORRIDOR_RADIUS}
 * and the coaster cart's 0.75 m. Two rides side by side with their edges apart
 * are not passing over one another and owe each other nothing; the 5.5 m is
 * *air over*, for where one genuinely crosses above the other.
 *
 * This mirrors what `test/procgen/invariants.ts` already asserts of the Rail
 * Race over the railway — it gates on the two being within `TRACK_CLEARANCE * 2`
 * (2.6 m) horizontally and only then demands `RAIL_OVER_RAIL` of height.
 *
 * Getting this wrong is not a rounding error, it decides whether the ride
 * exists. Demanding 5.5 m of air across a 7.2 m horizontal band — tried first,
 * and wrong — walls off the entire corridor between the castle and the ball
 * pit, because the cruiser crests at 10.71 m and the slide starts at 14.84 m,
 * so it is only ever 4.13 m above the coaster at its highest and could never
 * pass over it anywhere. The slide became unsolvable for a clearance nobody
 * required.
 */
const CRUISER_OVERLAP = CORRIDOR_RADIUS + 0.75;

/** Where the rider's eyeline starts, and where it ends up. */
const START_Y = deckY(TOP_DECK);
const END_Y = terrainHeight(BALL_PIT_X, BALL_PIT_Z) + 0.9;
const SLIDE_DROP = START_Y - END_Y;

/**
 * Distance the start pose stands off the facade's south wall.
 *
 * The generated route is required to stay out of the castle's footprint
 * entirely — that is the whole fix — so it cannot begin *on* the wall. It
 * begins just outside, and {@link DOOR_STUB} carries the chute back through the
 * hole so it does not appear to start in mid-air.
 */
const WALL_STANDOFF = CORRIDOR_RADIUS + 0.6;

/** How far back through the parapet gap the chute's mouth is carried. */
const DOOR_STUB = 2.6;

/** Metres between the points handed to the chute's curve. */
const POINT_SPACING = 1.6;

const SOUTH_WALL_Z = BUILDING_CENTRE_Z + BUILDING_HALF_Z;

/**
 * The two plots this ride deliberately joins.
 *
 * `clearOfPlots` rejects every point on the line between the castle and the
 * ball pit, and every point on a ring around the pit. That is not a bug in it:
 * the castle's plot bounding radius is 19 m, the pit's is 9 m, and their
 * centres are only 23 m apart, so the two bounding circles overlap. A ride
 * whose entire purpose is to join those two plots can never satisfy the
 * standard predicate.
 *
 * So the slide exempts exactly the two plots it joins, and honours every other
 * one. The castle is then re-imposed far more precisely than a bounding circle
 * ever could, as its actual footprint rectangle — which is what keeps the chute
 * out of the tower instead of merely away from it.
 */
const JOINED_PLOTS: ReadonlySet<string> = new Set(['building', 'ballPit']);


/** Is (x, z) inside the facade's own footprint, padded by `radius`? */
export function insideCastle(x: number, z: number, radius: number): boolean {
  return (
    Math.abs(x - BUILDING_CENTRE_X) < BUILDING_HALF_X + radius &&
    Math.abs(z - BUILDING_CENTRE_Z) < BUILDING_HALF_Z + radius
  );
}

/**
 * The Sky Cruiser's centre line, flattened to plain numbers once.
 *
 * `CoasterRoute.nearestPoint` walks its whole length evaluating a Catmull-Rom
 * spline, and allocates two vectors doing it. The search asks about clearance
 * for every sample of every candidate piece — over a million times — and that
 * alone took a solve to 225 seconds. Sampling the coaster once here and
 * scanning plain numbers is the same curve read the same way, just not read
 * again for every question asked about it.
 */
const CRUISER_LINE: readonly { readonly x: number; readonly y: number; readonly z: number }[] =
  (() => {
    const route = COASTER_PLANS.cruiser.route;
    const samples: { x: number; y: number; z: number }[] = [];
    const probe = new Vector3();
    for (let d = 0; d < route.length; d += 1.5) {
      route.pointAt(d, probe);
      samples.push({ x: probe.x, y: probe.y, z: probe.z });
    }
    return samples;
  })();

/**
 * Would a post standing at (x, z) between `fromY` and `toY` run through the
 * Sky Cruiser?
 *
 * A support is a *column*, not a point: the slide passes over the coaster, so
 * a leg dropped straight down from that stretch is the obvious way to spear it.
 * Tested against the whole height the post occupies rather than against the
 * chute's height at the top of it.
 */
export function cruiserCrossesColumn(
  x: number,
  z: number,
  fromY: number,
  toY: number,
): boolean {
  const low = Math.min(fromY, toY);
  const high = Math.max(fromY, toY);
  for (const point of CRUISER_LINE) {
    const dx = point.x - x;
    const dz = point.z - z;
    if (dx * dx + dz * dz > CRUISER_OVERLAP * CRUISER_OVERLAP) continue;
    if (point.y > low - CRUISER_AIR && point.y < high + CRUISER_AIR) return true;
  }
  return false;
}

/** Does a point at (x, y, z) keep {@link CRUISER_AIR} from the Sky Cruiser? */
function clearsCruiser(x: number, y: number, z: number): boolean {
  for (const point of CRUISER_LINE) {
    const dx = point.x - x;
    const dz = point.z - z;
    if (dx * dx + dz * dz > CRUISER_OVERLAP * CRUISER_OVERLAP) continue;
    if (Math.abs(point.y - y) < CRUISER_AIR) return false;
  }
  return true;
}

/**
 * Is a corridor of `radius` about (x, z), `distanceAlong` metres into the ride,
 * somewhere the chute may go?
 *
 * `nominalLength` is what the chute's total length is currently believed to be,
 * which is what turns `distanceAlong` into a height. See {@link planSlide} for
 * why that is a fixed point rather than a known number.
 */
function chuteMayPass(
  x: number,
  z: number,
  radius: number,
  distanceAlong: number,
  nominalLength: number,
): boolean {
  // Length is gradient on a ride whose drop is fixed, so an over-long chute is
  // as wrong as one that goes through a wall. Rejecting the sample rather than
  // trimming afterwards makes the search back up and find a tidier way round.
  if (distanceAlong > MAX_LENGTH) return false;
  if (insideCastle(x, z, radius)) return false;
  {
    for (const [id, entry] of PARK_LAYOUT.entries) {
      if (JOINED_PLOTS.has(id)) continue;
      if (Math.hypot(x - entry.x, z - entry.z) < entry.boundingRadius + radius) return false;
    }
  }

  // Whatever the Sky Cruiser turns out to be, stay out of its air — but only
  // where the two are actually near each other in *three* dimensions. The slide
  // crosses the cruiser's loop while still up at roof height and passes over
  // the top of it; forbidding the crossing outright would leave about 2 m
  // between the castle's east wall and the cruiser to thread a 3.4 m chute
  // through, which is no route at all.
  return clearsCruiser(x, heightAtArc(distanceAlong, nominalLength), z);
}

/**
 * The chute's vocabulary: gentler and longer-limbed than the Sky Cruiser's.
 *
 * A slide wants long sweeping arcs, not the cruiser's tight direction changes —
 * you are lying in it looking straight ahead, and a sharp turn is a lurch
 * rather than a thrill.
 */
const SLIDE_VOCABULARY: readonly SegmentKind[] = turnVocabulary(
  [
    { name: 'wrap', minRadius: MIN_TURN_RADIUS, maxRadius: 12, minLength: 6, maxLength: 12 },
    { name: 'sweep', minRadius: 17, maxRadius: 30, minLength: 10, maxLength: 20 },
    { name: 'easy', minRadius: 30, maxRadius: 60, minLength: 12, maxLength: 24 },
  ],
  { minLength: 8, maxLength: 18 },
);

/**
 * Where the chute may leave the tower, best first.
 *
 * Derived from the facade's own slide door rather than stated: the gap in the
 * parapet is `FACADE_SLIDE_DOOR_MIN_X … MAX_X` on the south wall, so the chute
 * leaves from within that gap, pointing out of it. A spread of headings is
 * offered because the door constrains *where* the slide starts, not which way
 * it then sweeps, and the search needs somewhere to go when the first choice
 * dead-ends.
 */
function doorPoses(): Pose2[] {
  const poses: Pose2[] = [];
  const centreLocal = (FACADE_SLIDE_DOOR_MIN_X + FACADE_SLIDE_DOOR_MAX_X) / 2;
  const halfGap = (FACADE_SLIDE_DOOR_MAX_X - FACADE_SLIDE_DOOR_MIN_X) / 2;
  // Straight out of the door first, then progressively more angled, alternating
  // sides so neither direction is systematically preferred.
  // Out to ±72°: the door fixes where the chute leaves the tower, not which way
  // it sweeps once it is out, and the wrap around the corner wants to start
  // turning almost immediately.
  const yaws: number[] = [0];
  for (let step = 1; step <= 8; step += 1) {
    yaws.push((step * TAU) / 40, (-step * TAU) / 40);
  }
  for (const acrossFraction of [0, -0.5, 0.5, -0.85, 0.85]) {
    const x = BUILDING_CENTRE_X + centreLocal + halfGap * acrossFraction;
    const z = SOUTH_WALL_Z + WALL_STANDOFF;
    for (const yaw of yaws) {
      // Heading is +Z (out of the south face), rotated by `yaw`.
      poses.push({ x, z, hx: Math.sin(yaw), hz: Math.cos(yaw) });
    }
  }
  return poses;
}

/**
 * Where the chute may finish, best first: on the rim of the ball pit, pointing
 * into it.
 *
 * The park has been asking for this since before the slide was built —
 * `anchors.ts` gives the pit the sign subtitle "the ginormous slide lands
 * here!" and the manifest keeps it within a slide's reach of the castle. The
 * old slide stopped 22 m short of it, inside the tower.
 *
 * Bearings are ordered by how well they agree with simply arriving from the
 * castle, so the search tries the natural landing first and works outward.
 */
function pitPoses(): Pose2[] {
  const fromCastle = Math.atan2(BALL_PIT_Z - BUILDING_CENTRE_Z, BALL_PIT_X - BUILDING_CENTRE_X);
  // The whole rim, ordered outward from the castle-facing side. Restricting it
  // to the near half looks obviously right and is not: which side the chute can
  // enter by is decided by where the route has got to after wrapping the tower,
  // and forbidding the far side simply removes the answers.
  const offsets: number[] = [0];
  for (let step = 1; step <= 8; step += 1) {
    offsets.push((step * TAU) / 16, (-step * TAU) / 16);
  }
  const poses: Pose2[] = [];
  const rejected: Pose2[] = [];
  for (const offset of offsets) {
    // The bearing from the pit's centre out to where the chute's mouth sits.
    const bearing = fromCastle + Math.PI + offset;
    // Both options overhang the balls. A mouth that stops short of the rim
    // leaves a child stepping down onto grass instead of dropping into the pit,
    // which is the whole reward for going down it.
    for (const radius of [BALL_PIT_RADIUS - 1, BALL_PIT_RADIUS - 2.5, BALL_PIT_RADIUS - 4]) {
      const x = BALL_PIT_X + Math.cos(bearing) * radius;
      const z = BALL_PIT_Z + Math.sin(bearing) * radius;
      // Facing the middle of the pit, so a rider is delivered into the balls.
      const pose: Pose2 = { x, z, hx: -Math.cos(bearing), hz: -Math.sin(bearing) };
      if (approachIsClear(pose)) poses.push(pose);
      else rejected.push(pose);
    }
  }
  // Every bearing's run-in was blocked. Hand back the unfiltered list rather
  // than an empty one: the generator's own diagnostic on failure is far more
  // use than "no admissible end poses", and a pit that has genuinely been
  // walled in is something the procgen invariant should say out loud.
  return poses.length > 0 ? poses : rejected;
}

/**
 * Can the chute actually get to this mouth pose in a straight-ish line?
 *
 * The search does not steer at the mouth, it steers at a corridor
 * {@link APPROACH_DISTANCE} metres behind it, and then joins the two with a
 * biarc. So a mouth whose run-in is blocked is worse than useless: the search
 * spends its whole budget steering at a point it can never occupy, and every
 * biarc it then tries has to turn tighter than the ride allows.
 *
 * That is not hypothetical — it is what was happening. On the canonical seed
 * the run-in for most of the pit's rim lands *inside the castle*, and the rest
 * lands inside the Sky Cruiser's loop. Half a million biarcs were rejected for
 * curvature, from a search aiming at somewhere unreachable.
 *
 * The Sky Cruiser has the same idea in `stationPoses`: a start is only offered
 * if the ground through the station window is clear. This is that, at the other
 * end of an open route.
 */
function approachIsClear(mouth: Pose2): boolean {
  // The last few metres in, which the chute physically occupies...
  for (let back = 0; back <= FINAL_RUN_IN; back += 1.5) {
    if (!openGround(mouth.x - mouth.hx * back, mouth.z - mouth.hz * back)) return false;
  }
  // ...and the corridor point itself, which the search has to be able to reach.
  // Requiring the whole straight line between them to be clear as well is a
  // stricter test than the ride needs — the route arrives on a curve, not a
  // ruler — and it threw away workable landings on seeds where the coaster
  // happens to weave across the run-in.
  return openGround(
    mouth.x - mouth.hx * APPROACH_DISTANCE,
    mouth.z - mouth.hz * APPROACH_DISTANCE,
  );
}

/** Clear of the castle, of every plot but the two being joined, and in bounds. */
function openGround(x: number, z: number): boolean {
  if (insideCastle(x, z, CORRIDOR_RADIUS)) return false;
  if (Math.hypot(x, z) > GARDEN_PLAY_RADIUS - CORRIDOR_RADIUS) return false;
  for (const [id, entry] of PARK_LAYOUT.entries) {
    if (JOINED_PLOTS.has(id)) continue;
    if (Math.hypot(x - entry.x, z - entry.z) < entry.boundingRadius + CORRIDOR_RADIUS) {
      return false;
    }
  }
  return true;
}

/**
 * Height along the chute: a single smoothstep from the parapet to the pit.
 *
 * `u` is the fraction of the way along. Smoothstep is monotone on [0, 1] and
 * flat at both ends, which gives exactly the three things a slide needs and a
 * straight ramp does not: it leaves the door level rather than over a cliff
 * edge, it is at its steepest in the middle where the drop is the fun, and it
 * flattens into a runout so a child is *delivered* into the ball pit rather
 * than fired into it.
 *
 * That it never rises is a property of the function, not of the seed — which is
 * what makes it something `test/procgen/invariants.ts` can hold every seed to.
 */
function heightAt(u: number): number {
  const clamped = u < 0 ? 0 : u > 1 ? 1 : u;
  if (clamped <= LIP_FRACTION) return START_Y;
  const after = (clamped - LIP_FRACTION) / (1 - LIP_FRACTION);
  const eased = after * after * (3 - 2 * after);
  return START_Y - SLIDE_DROP * eased;
}

/** {@link heightAt}, addressed by metres travelled rather than by fraction. */
function heightAtArc(distanceAlong: number, totalLength: number): number {
  return heightAt(distanceAlong / (totalLength || 1));
}

/**
 * The chute's centre line in world space, from the parapet gap to the pit.
 *
 * The first point is carried back through the door along the start tangent so
 * the chute emerges from the hole in the wall rather than beginning in mid-air.
 * It is collinear with the route's own start heading, so it cannot kink and
 * there is no second formula tracking the wall's surface — extend the curve
 * backwards along itself and it stays correct however the door moves.
 */
function chutePoints(route: SolvedRailRoute): Vector3[] {
  const points: Vector3[] = [];
  const flat = { x: 0, z: 0 };

  route.pointAt(0, flat);
  const startX = flat.x;
  const startZ = flat.z;
  route.tangentAt(0, flat);
  points.push(
    new Vector3(startX - flat.x * DOOR_STUB, START_Y, startZ - flat.z * DOOR_STUB),
  );

  const steps = Math.max(8, Math.round(route.length / POINT_SPACING));
  for (let i = 0; i <= steps; i += 1) {
    const u = i / steps;
    route.pointAt(u * route.length, flat);
    points.push(new Vector3(flat.x, heightAt(u), flat.z));
  }
  return points;
}

/**
 * Where a rider is put down (GAME_DESIGN.md's EXIT rule).
 *
 * Beside the ball pit, on ground a child of `PLAYER_RADIUS` can actually stand
 * on — you climb out of the balls onto the grass. Searched outward from the
 * pit's own rim rather than stated, so it survives the pit moving.
 */
function planExit(): { exitX: number; exitZ: number } {
  const fromCastle = Math.atan2(BALL_PIT_Z - BUILDING_CENTRE_Z, BALL_PIT_X - BUILDING_CENTRE_X);
  const bearings: number[] = [0];
  for (let step = 1; step <= 12; step += 1) {
    bearings.push((step * TAU) / 24, (-step * TAU) / 24);
  }
  const clearance = PLAYER_RADIUS + 0.5;
  for (let distance = BALL_PIT_RADIUS + 1.2; distance <= BALL_PIT_RADIUS + 12; distance += 0.5) {
    for (const offset of bearings) {
      // Out from the pit on the far side from the castle first: that is where a
      // child is facing when they land, and it keeps the exit off the chute.
      const bearing = fromCastle + offset;
      const x = BALL_PIT_X + Math.cos(bearing) * distance;
      const z = BALL_PIT_Z + Math.sin(bearing) * distance;
      if (Math.hypot(x, z) > GARDEN_PLAY_RADIUS - 2) continue;
      if (insideCastle(x, z, clearance)) continue;
      let blocked = false;
      for (const [id, entry] of PARK_LAYOUT.entries) {
        if (JOINED_PLOTS.has(id)) continue;
        if (Math.hypot(x - entry.x, z - entry.z) < entry.boundingRadius + clearance) {
          blocked = true;
          break;
        }
      }
      if (!blocked) return { exitX: x, exitZ: z };
    }
  }
  // Nothing clear anywhere around the pit. Hand back the nearest try rather
  // than nothing: `world/dismount.ts` is the runtime safety net for exactly
  // this, and the procgen invariant is the loud way to hear about it long
  // before a child does.
  return {
    exitX: BALL_PIT_X + Math.cos(fromCastle) * (BALL_PIT_RADIUS + 1.2),
    exitZ: BALL_PIT_Z + Math.sin(fromCastle) * (BALL_PIT_RADIUS + 1.2),
  };
}

export interface PlannedSlide {
  readonly name: string;
  /** The solved plan-view centre line, for measuring and for tests. */
  readonly route: SolvedRailRoute;
  /** The chute's centre line in world space, ready for `SlideRide`. */
  readonly points: readonly Vector3[];
  /** Where a rider is put down (GAME_DESIGN.md's EXIT rule). */
  readonly exitX: number;
  readonly exitZ: number;
  /** Height at the top of the chute, and at its mouth over the pit. */
  readonly startY: number;
  readonly endY: number;
}

/**
 * How many metres the solved length may differ from the length its own
 * clearance test assumed before it is worth solving again.
 *
 * A metre and a half of arc moves the height profile by under 15 cm anywhere on
 * it, which is a tenth of the air being kept from the cruiser.
 */
const LENGTH_SETTLED = 1.5;

/** Passes allowed for the length to settle. It has always taken two. */
const MAX_PASSES = 5;

/**
 * Solves the chute, then checks the answer against the thing it actually built.
 *
 * There is a circularity here worth naming: how high the chute is at a point
 * depends on how far along it that point is *as a fraction of the whole*, and
 * the whole is not known until the route is solved — yet the height is needed
 * during the solve, to know whether the chute clears the Sky Cruiser. So the
 * length is a fixed point: solve with the best estimate, and if the answer
 * disagrees with the estimate, solve again with the answer. It settles in two
 * passes because each solve is a small perturbation of the last.
 *
 * A fixed point that has converged is still only an argument, so it is not
 * trusted: {@link assertClearsCruiser} then measures the **built** curve, in
 * three dimensions, against the cruiser's own built curve. If the ride that was
 * actually produced is not clear, this throws at module load rather than
 * shipping a slide that flies through a roller coaster.
 */
function planSlide(): PlannedSlide {
  const boundary = circleBoundary(GARDEN_PLAY_RADIUS);
  let nominalLength = DESIRED_LENGTH;
  let route = null as SolvedRailRoute | null;

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const assumed = nominalLength;
    const brief: OpenRouteBrief = {
      // A stream of its own, so the slide's shape cannot shift because some
      // other ride changed how many random draws it takes.
      seed: PARK_SEED ^ 0x511de,
      vocabulary: SLIDE_VOCABULARY,
      desiredLength: DESIRED_LENGTH,
      closed: false,
      startPoses: doorPoses(),
      endPoses: pitPoses(),
      clear: (x, z, radius, distanceAlong) =>
        chuteMayPass(x, z, radius, distanceAlong, assumed),
      boundary,
      corridorRadius: CORRIDOR_RADIUS,
      selfClearance: SELF_CLEARANCE,
      minRadius: MIN_TURN_RADIUS,
      // The default 38 m is most of this ride. See `RouteBrief.approachDistance`.
      approachDistance: APPROACH_DISTANCE,
      budgets: { perJoint: 16, restarts: 700 },
    };
    route = solveRailRoute(brief);
    if (Math.abs(route.length - assumed) <= LENGTH_SETTLED) break;
    nominalLength = route.length;
  }
  if (!route) throw new Error('the ginormous slide did not solve');

  const points = chutePoints(route);
  assertClearsCruiser(points);
  const { exitX, exitZ } = planExit();
  return {
    name: 'ginormousSlide',
    route,
    points,
    exitX,
    exitZ,
    startY: START_Y,
    endY: END_Y,
  };
}

/**
 * The boot assert: the chute that was built keeps its air from the coaster that
 * was built. Measured in 3D off both finished curves, so it cannot be fooled by
 * the estimate the search ran on.
 */
function assertClearsCruiser(points: readonly Vector3[]): void {
  const cruiser = COASTER_PLANS.cruiser.route;
  let worst = Infinity;
  let worstAt: Vector3 | null = null;
  for (const point of points) {
    const near = cruiser.nearestPoint(point.x, point.z);
    const horizontal = Math.hypot(near.x - point.x, near.z - point.z);
    const vertical = Math.abs(near.y - point.y);
    // Only a point that is close horizontally is a candidate for fouling at
    // all; where it is, the vertical gap is what has to be big enough.
    if (horizontal > CRUISER_OVERLAP) continue;
    if (vertical < worst) {
      worst = vertical;
      worstAt = point;
    }
  }
  if (worstAt && worst < CRUISER_AIR) {
    throw new Error(
      `the ginormous slide fouls the Sky Cruiser: only ${worst.toFixed(2)} m of air ` +
        `at (${worstAt.x.toFixed(1)}, ${worstAt.y.toFixed(1)}, ${worstAt.z.toFixed(1)}), ` +
        `against ${CRUISER_AIR} m required.`,
    );
  }
}

/** The plan. Import this; never re-solve — the same rule as `TRAIN_PLAN`. */
export const SLIDE_PLAN: PlannedSlide = planSlide();

/** Where the chute's points sit relative to the building's plot group. */
export const SLIDE_GROUP_ORIGIN = {
  x: BUILDING_CENTRE_X,
  y: BUILDING_BASE_Y,
  z: BUILDING_CENTRE_Z,
} as const;
