import { Vector3 } from 'three';
import {
  BALL_PIT_RADIUS,
  BALL_PIT_X,
  BALL_PIT_Z,
  BUILDING_CENTRE_X,
  BUILDING_CENTRE_Z,
  CASTLE_TOWERS,
  TOP_DECK,
  deckY,
  distanceOutsideTower,
} from '../building/layout';
import {
  BUILDING_HALF_X,
  BUILDING_HALF_Z,
  GARDEN_PLAY_RADIUS,
  INTERIOR_HALF_Z,
  PLAYER_RADIUS,
} from '../../core/constants';
import { TAU } from '../../core/mathUtils';
import { PARK_LAYOUT } from '../parkLayout';
import { PARK_SEED } from '../parkManifest';
import { COASTER_PLANS } from '../coaster/plan';
import { circleBoundary } from '../boundary';
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

/**
 * Half-width of chute to keep clear of things. The trough is ±0.95 m plus rails.
 *
 * Exported because the hole in the wall is derived from it (see
 * {@link SLIDE_DOOR_HALF_WIDTH}) and `test/procgen/invariants.ts` asks whether
 * the chute that was built actually fits through the hole that was cut.
 */
export const CORRIDOR_RADIUS = 1.45;

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
 * The longest route that is still the ride we asked for, in metres.
 *
 * {@link MAX_LENGTH} is the per-piece hard stop: a sample further along than
 * that is not a legal place to be, so the search backs up. This is the softer
 * one, asked of a finished route, and it exists because the search now keeps
 * looking until a route is *safe* rather than taking what it is given. Safety
 * and length pull in opposite directions — a longer route is higher everywhere,
 * so it clears the coaster more easily — and with nothing pushing back the
 * search was answering "is it safe?" with 83-87 m rides on a brief that asked
 * for 60.
 *
 * The drop is fixed at 13.75 m, so length is gradient: at 87 m the canonical
 * seed's chute also ran too flat and too far to stand on legs. Both complaints
 * have the same cure, which is why this is one number rather than two.
 *
 * Kept above {@link DESIRED_LENGTH} by a wide margin on purpose. An open route
 * overshoots what it is asked for — see {@link DESIRED_LENGTH} — so a ceiling
 * near 60 would reject nearly everything and put the boot time straight back.
 */
const MAX_RIDEABLE_LENGTH = 75;

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

/**
 * How far *past* the wall plane the chute's mouth is carried, in metres.
 *
 * A depth rather than a length, because the two are only the same when the
 * chute leaves square-on. A fixed 2.6 m stub measured **along the tangent**
 * covers 2.6·cos θ of southward progress, so once the exit angle passes about
 * 38° it no longer reaches the wall at all and the chute begins in mid-air
 * outside the castle — which is exactly what seed 5 started doing the moment
 * the towers pushed the search onto steeper exits.
 */
const DOOR_INSET = 0.55;

/**
 * Masonry left either side of the chute where it passes through the wall.
 *
 * The hole has to be wider than the thing going through it, or the trough
 * scrapes its own doorway. This is that margin, and it is the only authored
 * number in the door's width.
 */
const DOOR_SHOULDER = 0.65;

/**
 * Half the width of the hole the chute leaves the tower through.
 *
 * **Derived from what has to fit through it, never authored.** The chute
 * occupies {@link CORRIDOR_RADIUS} either side of its centre line, so the gap
 * is that plus a {@link DOOR_SHOULDER} of masonry. Before this the hole was two
 * hand-written coordinates in `building/layout.ts` that happened to agree with
 * the chute's width, and nothing anywhere checked that they still did — widen
 * the chute and the hole would simply have stayed where it was.
 */
export const SLIDE_DOOR_HALF_WIDTH = CORRIDOR_RADIUS + DOOR_SHOULDER;

/**
 * Where along the facade's south wall the door is offered, facade-local.
 *
 * One position, which every candidate start pose is measured from. This is the
 * constant that pins the slide's exit to a single spot on the wall and so
 * forces the route to contort to reach it — widening it to the whole wall is a
 * separate, visible change, because it relocates a hole in the castle.
 */
const DOOR_OFFER_CENTRE = 9.5;

/**
 * Where a child stands on the **interior** roof terrace to board, and how wide
 * the gap in the interior parapet beside them is.
 *
 * Interior-local, and deliberately a different frame from the facade's: the
 * interior is a far larger space than the castle you see from the garden
 * (`Shell.ts` calls them "disconnected worlds") and the chute itself is a
 * garden object hung off the facade, so there is no scale that maps one gap
 * onto the other. What *is* real is that the gap in the parapet is the one you
 * walk out through, so it is centred on the boarding pad rather than stated
 * separately — those were two numbers that had to be 20 at the same time, kept
 * in step by hand and by nothing else.
 */
const ROOF_ENTRY_X = 20;

/**
 * How far in from the roof's south edge you stand to board, in metres.
 *
 * Jim, 6 August 2026: *"the entrance to the slide needs to be closer to the
 * edge of the roof, like 1m from the edge of the roof, not coming several
 * meters into the roof"*. It was at `z = 13` against a terrace edge at 22 —
 * **9.2 m in**, so you crossed most of the roof to reach a marker, and the gap
 * in the parapet was an unexplained notch somewhere off in front of you.
 *
 * Written as an inset from the edge rather than as a coordinate, because "1 m
 * from the edge" is the thing Jim actually specified: if the interior is ever
 * resized, a hard `21` silently becomes several metres in again, whereas this
 * stays what he asked for. Taken as approximate — he said "like 1m", and the
 * point is that it reads as being *at* the edge.
 *
 * **This is interior-local and cannot move the garden chute.** `START_Y` is
 * `deckY(TOP_DECK)` and the ride's start pose comes from the facade's south
 * wall via `doorPoses()`; neither reads this. That separation is what lets the
 * boarding point go to the edge without touching the 3.44 m of air over the
 * battlements that `theGinormousSlideLeavesOverTheBattlements` holds open.
 */
const ROOF_ENTRY_INSET = 1;
const ROOF_ENTRY_Z = INTERIOR_HALF_Z - ROOF_ENTRY_INSET;

/**
 * Half the gap in the interior roof parapet.
 *
 * Wide enough to walk out through without brushing the masonry: a child is
 * `PLAYER_RADIUS` at the waist, and this leaves better than three of her
 * side by side, which is what makes it read as a way out rather than a slot.
 */
const ROOF_DOOR_HALF_WIDTH = 2.5;

/**
 * Metres between the points handed to the chute's curve.
 *
 * 0.9 rather than 1.6 because the curve is a Catmull-Rom **through** these
 * points, and a smoothstep sampled too coarsely is not reproduced by one. At
 * 1.6 m the spline overshot the lip-to-drop junction by 2.5 mm *upwards* — a
 * slide that briefly goes uphill, which is the one thing {@link heightAt} is
 * written to make impossible. Sampling finely enough to represent the height
 * function is the fix; widening `SLIDE_MAY_RISE` to accept the overshoot would
 * have been changing the test to match the artefact.
 */
const POINT_SPACING = 0.9;

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


/**
 * Does a chute of `radius`, passing (x, z) at height `y`, clear every corner
 * tower?
 *
 * **The fix for the bug Jim found by riding it.** {@link insideCastle} keeps
 * the chute out of the facade's footprint *rectangle*, which is a far more
 * precise re-imposition than the bounding circle this ride has to exempt — and
 * it does not contain the towers. They stand at `(±outerX, ±outerZ)`, outside
 * that rectangle by half a wall, and bulge 2.05–2.45 m further out again, so
 * the one solid the chute passes closest to was the one nothing checked. The
 * exemption was never the bug; what stood in for the castle was.
 *
 * Height matters and is used: the roof cone tapers to nothing, so a chute
 * leaving the parapet at 14.84 m may pass far closer to a tower's tip than it
 * ever could to its body. Testing against the widest the tower ever gets would
 * forbid routes that are perfectly clear.
 */
function clearsTowers(x: number, z: number, y: number, radius: number): boolean {
  for (const tower of CASTLE_TOWERS) {
    if (distanceOutsideTower(tower, x, z, y) < radius) return false;
  }
  return true;
}

/**
 * The same question at ground level, for the landing run-in and the exit.
 *
 * Those are chosen in plan view with no height to hand, and they sit on the
 * ground, where a tower is at its widest. Taking the widest radius of each
 * solid is therefore both correct and the conservative direction to err in.
 */
function clearsTowersOnTheGround(x: number, z: number, radius: number): boolean {
  for (const tower of CASTLE_TOWERS) {
    const widest = Math.max(tower.radiusBottom, tower.radiusTop);
    if (Math.hypot(x - tower.x, z - tower.z) < widest + radius) return false;
  }
  return true;
}

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
const CRUISER_SAMPLE_SPACING = 1.5;

/**
 * Residual padding for the difference between the cruiser's spline and the
 * polyline {@link CRUISER_LINE} stands in for.
 *
 * The scan below measures distance to the **segments** between samples, not to
 * the samples themselves, so the only error left is the spline's sagitta across
 * one 1.5 m chord — `h²/8r`, which is 28 mm on a 10 m bend and smaller on
 * anything gentler. 50 mm covers it with room to spare.
 *
 * Measuring to points rather than segments is what caused the trouble here:
 * `assertClearsCruiser` uses the exact `nearestPoint`, so a scan that could be
 * up to half a spacing optimistic reported clear air where the boot assert
 * found a foul, and seed 5 stopped solving the moment the towers pushed its
 * route into that gap. The fix is to measure the right thing, not to pad the
 * wrong thing — an earlier attempt inflated the exclusion zone by half a
 * spacing instead, which made every seed's search 15 to 40 times slower and
 * still left seed 11 unsolvable.
 */
const CRUISER_SAGITTA = 0.05;

const CRUISER_LINE: readonly { readonly x: number; readonly y: number; readonly z: number }[] =
  (() => {
    const route = COASTER_PLANS.cruiser.route;
    const samples: { x: number; y: number; z: number }[] = [];
    const probe = new Vector3();
    for (let d = 0; d < route.length; d += CRUISER_SAMPLE_SPACING) {
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

/**
 * A uniform grid over the cruiser's segments, so a clearance query looks at the
 * two or three that could possibly be near instead of all 144.
 *
 * The search asks about clearance for every sample of every candidate piece —
 * millions of times — and the scan is by far the most expensive thing it does:
 * measured, disabling it took a seed-5 solve from 53.8 s to 1.6 s. Adding the
 * towers as obstacles made the search work harder, which multiplied that cost
 * straight through into **game boot**, where `SLIDE_PLAN` solves at module load.
 * A 45-second freeze before a six-year-old can play is not a trade worth making
 * for correct geometry when both are available.
 *
 * Each segment is filed into every cell its bounding box touches **after being
 * grown by `reach`**, so any segment within `reach` of a query point is
 * guaranteed to be in that point's own cell. One lookup, no neighbour walk, and
 * no chance of missing a segment that a 3×3 scan of undersized cells would.
 */
const CRUISER_CELL = 4;

function cruiserCellKey(x: number, z: number): number {
  // Packed into one integer rather than a string: this is the hottest lookup in
  // the solve, and building a `${cx},${cz}` key per query allocates millions of
  // short-lived strings for no benefit.
  const cx = Math.floor(x / CRUISER_CELL);
  const cz = Math.floor(z / CRUISER_CELL);
  return (cx + 4096) * 8192 + (cz + 4096);
}

const CRUISER_GRID: ReadonlyMap<number, readonly number[]> = (() => {
  const grid = new Map<number, number[]>();
  const reach = CRUISER_OVERLAP + CRUISER_SAGITTA;
  const count = CRUISER_LINE.length;
  for (let i = 0; i < count; i += 1) {
    const a = CRUISER_LINE[i]!;
    const b = CRUISER_LINE[(i + 1) % count]!;
    const minX = Math.min(a.x, b.x) - reach;
    const maxX = Math.max(a.x, b.x) + reach;
    const minZ = Math.min(a.z, b.z) - reach;
    const maxZ = Math.max(a.z, b.z) + reach;
    for (let cx = Math.floor(minX / CRUISER_CELL); cx <= Math.floor(maxX / CRUISER_CELL); cx += 1) {
      for (let cz = Math.floor(minZ / CRUISER_CELL); cz <= Math.floor(maxZ / CRUISER_CELL); cz += 1) {
        const key = (cx + 4096) * 8192 + (cz + 4096);
        const bucket = grid.get(key);
        if (bucket) bucket.push(i);
        else grid.set(key, [i]);
      }
    }
  }
  return grid;
})();

/** Does a point at (x, y, z) keep {@link CRUISER_AIR} from the Sky Cruiser? */
function clearsCruiser(x: number, y: number, z: number): boolean {
  const reach = CRUISER_OVERLAP + CRUISER_SAGITTA;
  const reach2 = reach * reach;
  const air = CRUISER_AIR + CRUISER_SAGITTA;
  const nearby = CRUISER_GRID.get(cruiserCellKey(x, z));
  if (!nearby) return true;
  const count = CRUISER_LINE.length;
  for (const i of nearby) {
    const a = CRUISER_LINE[i]!;
    // The cruiser is a closed loop, so the last sample joins back to the first.
    // Leaving that segment out puts a 1.5 m blind spot in the ride's own air.
    const b = CRUISER_LINE[(i + 1) % count]!;
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz;
    let t = len2 <= 1e-12 ? 0 : ((x - a.x) * abx + (z - a.z) * abz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = a.x + abx * t - x;
    const dz = a.z + abz * t - z;
    if (dx * dx + dz * dz > reach2) continue;
    // Height interpolated to the same place along the segment, so a climbing
    // stretch is not read at the height of whichever end happened to be sampled.
    if (Math.abs(a.y + (b.y - a.y) * t - y) < air) return false;
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
  const height = heightAtArc(distanceAlong, nominalLength);
  // The castle is a rectangle *plus* four towers. Neither alone is the castle.
  if (!clearsTowers(x, z, height, radius)) return false;
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
  return clearsCruiser(x, height, z);
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
 * The gap in the parapet is no longer read from `building/layout.ts` — it is
 * the other way round now. These poses say where the chute may leave, the
 * search picks one, and the hole in the masonry is cut wherever that turned out
 * to be. A spread of headings is offered because the door constrains *where*
 * the slide starts, not which way it then sweeps, and the search needs
 * somewhere to go when the first choice dead-ends.
 */
function doorPoses(): Pose2[] {
  const poses: Pose2[] = [];
  const centreLocal = DOOR_OFFER_CENTRE;
  const halfGap = SLIDE_DOOR_HALF_WIDTH;
  // Straight out of the door first, then progressively more angled, alternating
  // sides so the *offers* are generated even-handedly.
  //
  // **What survives is not even-handed, and that is correct.** This comment used
  // to claim neither direction was systematically preferred, which
  // `doorFitsTheWall` made false: of the 45 offers that survive out of 85,
  // measured, **34 have positive yaw against 8 negative** (plus 3 straight), and
  // the widest surviving negative is −36° against +72° the other way. The filter
  // is right to do it — `DOOR_OFFER_CENTRE` (9.5) sits only 2.5 m from a wall
  // ending at 12, so turning that way runs the opening off the end of the face —
  // but the asymmetry is the filter's, not this loop's, and the search inherits
  // it. Worth knowing before reading anything into which way the chute sweeps.
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
      const pose: Pose2 = { x, z, hx: Math.sin(yaw), hz: Math.cos(yaw) };
      // An offer whose hole would run off the end of the wall is not an offer.
      // See {@link doorFitsTheWall}: how wide the opening has to be depends on
      // how angled the exit is, so this cannot be decided by spacing alone.
      if (doorFitsTheWall(pose)) poses.push(pose);
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
  if (!clearsTowersOnTheGround(x, z, CORRIDOR_RADIUS)) return false;
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
 * The shallowest southward heading a door is allowed to have.
 *
 * Below this the chute is running almost along the wall rather than out of it,
 * and both numbers derived from the crossing — how long the stub must be, and
 * how wide the hole has to be cut — go to infinity as the heading turns
 * parallel. Clamping keeps them finite; the pose itself is rejected elsewhere.
 */
const MIN_DOOR_HEADING_Z = 0.25;

/** How long a stub must be, along a tangent whose z-component is `headingZ`. */
function doorStubLength(headingZ: number): number {
  return (WALL_STANDOFF + DOOR_INSET) / Math.max(headingZ, MIN_DOOR_HEADING_Z);
}

/**
 * Where the chute's centre crosses the facade's south wall, and how wide the
 * hole there has to be — facade-local.
 *
 * **Not the route's start point.** That sits {@link WALL_STANDOFF} metres
 * *outside* the wall, so on any angled exit it is displaced sideways from where
 * the chute actually goes through, and a hole cut there leaves one edge of the
 * trough buried in masonry. Measured: on the canonical seed the two were 0.67 m
 * apart, enough to overhang the opening.
 *
 * The width follows from the same angle. A chute of half-width `w` crossing a
 * plane at θ off the normal needs `w / cos θ` of opening along the wall — the
 * hole is a slanted slice through it, not a square one.
 */
function doorCrossing(route: SolvedRailRoute): { localX: number; halfWidth: number } {
  const at = { x: 0, z: 0 };
  const tangent = { x: 0, z: 0 };
  route.pointAt(0, at);
  route.tangentAt(0, tangent);
  return crossingOf(at.x, tangent.x, tangent.z);
}

/**
 * {@link doorCrossing}, as arithmetic on a pose rather than on a solved route.
 *
 * Split out so the poses that are *offered* and the hole that is finally *cut*
 * cannot disagree. They did: `doorPoses` spaced its offers by
 * {@link SLIDE_DOOR_HALF_WIDTH}, the 2.10 m a square-on chute needs, while the
 * hole an angled exit actually gets is `CORRIDOR_RADIUS / headingZ +
 * DOOR_SHOULDER`, which grows without bound as the exit turns along the wall.
 * At 18° off the normal that is 2.18 m, and the outermost offer plus that ran
 * to facade-local 12.34 against a wall ending at 12.00 — a hole with its far
 * edge past the corner of the building, leaving a notch in the masonry. Seed 5
 * did exactly that.
 *
 * Two numbers describing one opening, kept in step by hand and by nothing else,
 * is the same shape of bug commit 1 removed from `layout.ts`. Now there is one
 * formula, and {@link doorFitsTheWall} asks it.
 */
function crossingOf(
  startX: number,
  tangentX: number,
  tangentZ: number,
): { localX: number; halfWidth: number } {
  const headingZ = Math.max(tangentZ, MIN_DOOR_HEADING_Z);
  const back = WALL_STANDOFF / headingZ;
  return {
    localX: startX - tangentX * back - BUILDING_CENTRE_X,
    halfWidth: CORRIDOR_RADIUS / headingZ + DOOR_SHOULDER,
  };
}

/**
 * Would the hole this pose implies fit inside the south wall?
 *
 * The wall runs facade-local ±{@link BUILDING_HALF_X}. A hole that runs past
 * either end is not a doorway, it is a missing corner — and it is cheaper to
 * decline the pose than to solve a whole route through it and throw that away.
 */
function doorFitsTheWall(pose: Pose2): boolean {
  const { localX, halfWidth } = crossingOf(pose.x, pose.hx, pose.hz);
  return localX - halfWidth >= -BUILDING_HALF_X && localX + halfWidth <= BUILDING_HALF_X;
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
  // Extend backwards far enough along the route's own heading to land
  // DOOR_INSET past the wall, however steeply it leaves. Still collinear with
  // the start tangent, so the chute cannot kink at the join.
  const stub = doorStubLength(flat.z);
  // Subdivided at the same {@link POINT_SPACING} as the rest of the chute, not
  // emitted as one long jump back to the wall.
  //
  // The curve through these points is a Catmull-Rom, and its tangent at a point
  // is set by that point's neighbours. A single stub leaves the second point
  // with one neighbour 2.6 m behind and the next 1.6 m ahead, and the resulting
  // asymmetric tangent makes the curve sag and recover across the flat lip —
  // a rise of about a millimetre, on a stretch whose design height is a
  // constant. Uniform spacing removes the asymmetry, so the lip comes out as
  // flat as `heightAt` says it is instead of needing an allowance for not
  // being. Measured: it is what took seed 18 back under `SLIDE_MAY_RISE`.
  const stubSteps = Math.max(1, Math.round(stub / POINT_SPACING));
  for (let i = stubSteps; i >= 1; i -= 1) {
    const back = (stub * i) / stubSteps;
    points.push(new Vector3(startX - flat.x * back, START_Y, startZ - flat.z * back));
  }

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
  /**
   * Where the chute crosses the facade's south wall plane, in facade-local x,
   * as a span the width of the chute. **Diagnostic only — this cuts nothing.**
   *
   * Measured off the solved route rather than the offered poses, so it is a fair
   * record of where the ride leaves, and `measure:slide-fingerprint` prints it
   * to prove the route has not moved. But it is not a description of the
   * building: the slide crosses this plane *above* the castle, clearing the
   * battlements by 3.44 m under its own floor, so there is no opening in the
   * masonry and none is wanted. The `ShellPlan.slideGap` field these used to
   * feed was dead on both readers and has been deleted.
   * `theGinormousSlideLeavesOverTheBattlements` is what holds that air open.
   */
  readonly facadeDoorMinX: number;
  readonly facadeDoorMaxX: number;
  /** The gap in the interior roof parapet you walk out through, interior-local. */
  readonly roofDoorMinX: number;
  readonly roofDoorMaxX: number;
  /** Where a child stands on the interior roof terrace to board, interior-local. */
  readonly entryX: number;
  readonly entryZ: number;
}

/**
 * Solves the chute, and lets the search itself throw out any route whose
 * **built** height is unsafe.
 *
 * ### The circularity, and why it is no longer paid for with whole solves
 *
 * How high the chute is at a point depends on how far along it that point is
 * *as a fraction of the whole*, and the whole is not known until the route is
 * solved — yet the height is needed **during** the solve, to know whether the
 * chute clears the Sky Cruiser and the castle's towers. So the per-piece test
 * necessarily runs on an assumed length, and the answer may disagree with the
 * assumption.
 *
 * This used to be chased with an outer loop: solve, compare, feed the solved
 * length back in as the next assumption, repeat. **That loop could not
 * converge, because the length map is not a contraction.** It has no attractive
 * fixed point: measured on seed 11 it wandered the full 50–92 m range for 28
 * passes, and on seed 5 it settled into a clean two-cycle, alternating 92 m and
 * 59 m forever with both ends fouling the coaster. Every lap was a complete
 * search thrown away, which is what made game boot a multiple of one solve
 * rather than one solve.
 *
 * It was wrong in the other direction too, and that is the one that shipped a
 * bug. The loop fell out of its pass limit and handed back whatever the last
 * pass produced, whose clearance had been checked against a *different*
 * length's height profile. On seed 11 the search verified an 86 m ride and
 * built a 64.4 m one, putting the chute 1.15 m inside the Sky Cruiser's air at
 * a spot the search had checked and passed — at a height the chute never
 * reached. Nothing was wrong with the search; it was answering a question about
 * a different ride.
 *
 * ### What replaces it
 *
 * `satisfies` — #213's machinery, which exists for exactly this shape of
 * question. It is asked about a **finished route**, so it knows that route's own
 * length and can build the real chute and measure it in three dimensions. There
 * is no assumption left to be wrong about.
 *
 * A route that fails it is set aside and the search moves to its next attempt,
 * the same as a dead end. So the backtracking happens **inside one search**,
 * over the candidates it was already going to generate, instead of by running
 * the whole search again from the top on a different guess. The assumed length
 * handed to `chuteMayPass` is now only a cheap prefilter, and it is allowed to
 * be approximate precisely because it is no longer the thing being trusted.
 *
 * A slide that flies through a roller coaster is not something to ship anyway,
 * so unlike the Sky Cruiser this ride does not accept the unsatisfied fallback:
 * if every attempt was unsafe, this throws and says what was wrong with the one
 * it got. `the ginormous slide keeps its air from the Sky Cruiser` in
 * `test/procgen/invariants.ts` asks the same question of every seed, so a
 * regression shows up as a red test rather than as a park that will not boot.
 *
 * ### Why the brief is its own function
 *
 * It used to be a local inside `planSlide`. It is exported now so that
 * something which is **not** the module owning `SLIDE_PLAN` can build it and
 * solve it a slice at a time — importing that module is precisely what runs the
 * three-and-a-half-second solve, so the loading screen could not otherwise get
 * at the brief without paying for the thing it is trying to spread out. See
 * `slide/plan.ts` for why the ownership splits this way round.
 *
 * It is **pure and safe to call twice**: there is no randomness anywhere in
 * this file outside the search itself, so every pose, filter and constant here
 * is a deterministic function of the layout and the seed. That is what makes
 * "solve it both ways in one process and compare the hashes" a legitimate proof
 * rather than a coincidence, and `check:park-boot` is built on it.
 */
export function slideRouteBrief(): OpenRouteBrief {
  const boundary = circleBoundary(GARDEN_PLAY_RADIUS);
  return {
    // A stream of its own, so the slide's shape cannot shift because some
    // other ride changed how many random draws it takes.
    seed: PARK_SEED ^ 0x511de,
    vocabulary: SLIDE_VOCABULARY,
    desiredLength: DESIRED_LENGTH,
    closed: false,
    startPoses: doorPoses(),
    endPoses: pitPoses(),
    // The cheap per-piece prefilter, on the length the ride asks for. Exact
    // enough to keep the search away from the castle and out of the coaster's
    // general area; `satisfies` below is what actually decides.
    clear: (x, z, radius, distanceAlong) =>
      chuteMayPass(x, z, radius, distanceAlong, DESIRED_LENGTH),
    satisfies: (candidate) => unrideableComplaint(candidate) === null,
    boundary,
    corridorRadius: CORRIDOR_RADIUS,
    selfClearance: SELF_CLEARANCE,
    minRadius: MIN_TURN_RADIUS,
    // The default 38 m is most of this ride. See `RouteBrief.approachDistance`.
    approachDistance: APPROACH_DISTANCE,
    budgets: { perJoint: 16, restarts: 700 },
  };
}

/**
 * Everything after the search: the chute, the guard, the doorway and the exit.
 *
 * Takes the solved route rather than solving one, so the route can have come
 * from either cadence — {@link planSlide}'s straight-through call or the
 * loading screen's sliced one — and be finished by **this** code either way.
 * The order of the calls below is the order `planSlide` has always made them in
 * and is deliberately preserved; nothing here draws randomness, but keeping one
 * sequence means there is no second one to drift.
 */
export function finishSlidePlan(route: SolvedRailRoute): PlannedSlide {
  const points = chutePoints(route);
  // `satisfies` cannot fail a park on its own — the generator hands back the
  // first route that solved if none satisfied. For a coaster that is the right
  // trade; for a slide through a roller coaster it is not, so what the search
  // was asked is asked again here, of the route it actually handed back.
  //
  // **The same function, deliberately.** This guard used to re-check only the
  // height half of a two-clause `satisfies`, so a fallback route could come
  // back over-length and be accepted: measured at **90.28 m against a 75 m
  // cap** with `satisfied: false`. That is the identical shape of bug this
  // whole rewrite exists to kill — a check reporting success about something
  // it is not describing — and it arrived the identical way, by a second copy
  // of a condition drifting from the first. There is now one owner and nothing
  // to keep in step.
  const complaint = unrideableComplaint(route);
  if (complaint) {
    throw new Error(
      `the ginormous slide never solved to a chute a child could ride: ` +
        `after ${route.report.satisfyRejects} rejected routes across ` +
        `${route.report.startPoseCount} attempts, the best on offer ${complaint}.`,
    );
  }

  const { exitX, exitZ } = planExit();

  // Where the chute actually goes through the wall, read back off the solved
  // route. Asking the route rather than re-deriving the pose is the whole
  // point: there is then one answer to "where is the door", and the masonry and
  // the ride are both reading it rather than each holding their own copy.
  const crossing = doorCrossing(route);

  return {
    name: 'ginormousSlide',
    route,
    points,
    exitX,
    exitZ,
    startY: START_Y,
    endY: END_Y,
    facadeDoorMinX: crossing.localX - crossing.halfWidth,
    facadeDoorMaxX: crossing.localX + crossing.halfWidth,
    roofDoorMinX: ROOF_ENTRY_X - ROOF_DOOR_HALF_WIDTH,
    roofDoorMaxX: ROOF_ENTRY_X + ROOF_DOOR_HALF_WIDTH,
    entryX: ROOF_ENTRY_X,
    entryZ: ROOF_ENTRY_Z,
  };
}

/**
 * **Is this a slide worth building?** The single owner of that question.
 *
 * Returns a description of the first thing wrong, or null if the route is good.
 * Both the search's {@link RouteBrief.satisfies} and `planSlide`'s post-solve
 * guard ask *this function* — which is the whole point of it existing. They used
 * to hold two different copies of the condition: `satisfies` tested length **and**
 * height, the guard re-tested height alone. So when the generator's unsatisfied
 * fallback fired, an over-length route walked straight past the guard —
 * reproduced at **90.28 m against a 75 m cap**, `satisfied: false`, no throw.
 *
 * A second copy of a rule is a second place for it to rot. One function, asked
 * twice, cannot disagree with itself.
 *
 * ### Why these three, and no others
 *
 * **Length** is not height-sensitive, but it is the other half of what makes a
 * ride rideable rather than a lazy river, and it is checked here so that the
 * answer has one home. See {@link MAX_RIDEABLE_LENGTH}.
 *
 * **Cruiser air** and **tower clearance** qualify because both `clearsCruiser`
 * and `clearsTowers` take the height as an argument, so during the search both
 * were answered against an *estimated* length. Everything else the search checks
 * — the castle rectangle, the park's other plots, the boundary, the chute
 * against itself — is decided in plan view and cannot have been changed by the
 * length coming out somewhere else.
 *
 * Measured in 3D off the finished curves, so it cannot be fooled by the estimate
 * the search ran on. The Sky Cruiser check uses the exact `nearestPoint` rather
 * than the sampled polyline the search uses for speed.
 */
function unrideableComplaint(route: SolvedRailRoute): string | null {
  if (route.length > MAX_RIDEABLE_LENGTH) {
    return (
      `is ${route.length.toFixed(2)} m long against a ${MAX_RIDEABLE_LENGTH} m ` +
      `ceiling — at that length the drop of ${(START_Y - END_Y).toFixed(2)} m is ` +
      'spread so thin the ride is a lazy river a child stops halfway down'
    );
  }

  const points = chutePoints(route);
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
    return (
      `fouls the Sky Cruiser, only ${worst.toFixed(2)} m of air ` +
      `at (${worstAt.x.toFixed(1)}, ${worstAt.y.toFixed(1)}, ${worstAt.z.toFixed(1)}) ` +
      `against ${CRUISER_AIR} m required`
    );
  }

  for (const point of points) {
    if (clearsTowers(point.x, point.z, point.y, CORRIDOR_RADIUS)) continue;
    return (
      `runs into a castle tower at (${point.x.toFixed(1)}, ${point.y.toFixed(1)}, ` +
      `${point.z.toFixed(1)}), which needs ${CORRIDOR_RADIUS} m of clearance`
    );
  }

  return null;
}

/**
 * **Solves the ginormous slide, start to finish, right now.**
 *
 * The straight-through cadence: `slide/plan.ts` calls this when nothing has
 * pre-warmed a plan, which is every context except the game's own boot — the
 * park harness, `check:park`, `test:procgen`, the fingerprint scripts. It is
 * still one synchronous call that returns a finished plan, so none of them
 * changed.
 *
 * The loading screen's cadence calls {@link slideRouteBrief},
 * {@link railRouteSearch} and {@link finishSlidePlan} itself, advancing the
 * middle one a few milliseconds at a time. **Both cadences run the same three
 * steps in the same order over the same brief**, which is why they cannot
 * produce two different slides — and `check:park-boot` proves it by running
 * both in one process and comparing a hash of the finished chute.
 */
export function planSlide(): PlannedSlide {
  return finishSlidePlan(solveRailRoute(slideRouteBrief()));
}

/**
 * The chute is built in **world space**, at park level, so there is no origin
 * to offset it by. `SLIDE_GROUP_ORIGIN` used to live here and is gone with the
 * reparent — it described a frame the slide no longer hangs in, and a constant
 * describing the wrong frame is worse than none.
 */
