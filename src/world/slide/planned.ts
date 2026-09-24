import { registerPlanCache } from '../../boot/planCaches';

import { COASTER_PLANS } from '../coaster/plan';
import { Vector3 } from 'three';
import { BUILDING_CENTRE_X, BUILDING_CENTRE_Z } from '../building/layout';
import { BUILDING_HALF_X, BUILDING_HALF_Z } from '../../core/constants';
import { drawnOnSphere, railFrameAt, type RailFrame } from '../rail/sweptRail';
import { crossSection } from '../coaster/clearance';
import { cartEnvelopePoint } from '../coaster/cart';
import { type SolvedRailRoute } from '../rail/generate';
/**
 * **The ginormous slide as decided** — the plan's type, its speed, and the
 * clearance questions its legs ask of the finished park. Shared by the game
 * (which reads a slide from the park file) and `procgen/` (which searches
 * for one).
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
 * How fast a rider travels down the ginormous slide, in metres per second.
 *
 * Its own figure rather than `SLIDE_SPEED` (12 m/s), which the little
 * helter-skelter indoors keeps. 12 m/s is 43 km/h: fine over the gentle indoor
 * curve, watched from outside, and much too fast for this one now that it is
 * ridden from the rider's own eyes round a bend that wraps a castle. 8 m/s is
 * 29 km/h — still a proper rush down an 11–17 m drop, and it is what lets the
 * turns be tight enough to fit the park without throwing the camera about.
 */
export const GIANT_SLIDE_SPEED = 6.5;


/** Is (x, z) inside the facade's own footprint, padded by `radius`? */
export function insideCastle(x: number, z: number, radius: number): boolean {
  return (
    Math.abs(x - BUILDING_CENTRE_X) < BUILDING_HALF_X + radius &&
    Math.abs(z - BUILDING_CENTRE_Z) < BUILDING_HALF_Z + radius
  );
}


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
  for (const point of CRUISER_LINE()) {
    const dx = point.x - x;
    const dz = point.z - z;
    if (dx * dx + dz * dz > CRUISER_OVERLAP * CRUISER_OVERLAP) continue;
    if (point.y > low - CRUISER_AIR && point.y < high + CRUISER_AIR) return true;
  }
  return false;
}


/**
 * Metres between the drawn car's sampled positions along the loop, for
 * {@link carSweepsColumn}.
 */
const CAR_SWEEP_STEP = 0.5;

function drawnCar(): Float64Array {
  if (drawnCarPoints) return drawnCarPoints;
  const route = COASTER_PLANS.cruiser.route;
  const drawn = drawnOnSphere(route);
  const section = crossSection();
  const frame: RailFrame = {
    position: new Vector3(),
    forward: new Vector3(),
    side: new Vector3(),
    up: new Vector3(),
  };
  const out: number[] = [];
  const point = new Vector3();
  for (let d = 0; d < route.length; d += CAR_SWEEP_STEP) {
    railFrameAt(drawn, d, frame);
    for (const [lateral, rise] of section) {
      cartEnvelopePoint(frame, lateral, rise, point);
      out.push(point.x, point.y, point.z);
    }
  }
  drawnCarPoints = Float64Array.from(out);
  return drawnCarPoints;
}


/**
 * The most any point of the car's surface can be from its nearest sample: half
 * a {@link CAR_SWEEP_STEP} along the loop, and half the widest gap between
 * neighbouring cross-section points across and up it (0.75 m and 0.85 m).
 */
const CAR_SAMPLE_PAD = Math.hypot(CAR_SWEEP_STEP / 2, 0.75 / 2, 0.85 / 2);


/**
 * **Would the Sky Cruiser's drawn car pass through a post of `radius` standing
 * at (x, z) from `bottomY` to `topY`?**
 *
 * {@link cruiserCrossesColumn} asks the question of the route's *flat* centre
 * line, and the ride is drawn leant onto the sphere — the car's top swings
 * sideways by its height times the lean, a third of a metre and more out where
 * the slide lands. On seed 131 (#663) that let a leg stand 2.12 m from the flat
 * line and the car still ran through it (`the Sky Cruiser flies clear of the
 * whole park`). This asks of the car that is drawn, the same sweep the invariant
 * makes, padded by {@link CAR_SAMPLE_PAD} so the sampling cannot step past a
 * post.
 */
export function carSweepsColumn(
  x: number,
  z: number,
  bottomY: number,
  topY: number,
  radius: number,
): boolean {
  const points = drawnCar();
  const reach = radius + CAR_SAMPLE_PAD;
  const reach2 = reach * reach;
  const low = Math.min(bottomY, topY) - CAR_SAMPLE_PAD;
  const high = Math.max(bottomY, topY) + CAR_SAMPLE_PAD;
  for (let i = 0; i < points.length; i += 3) {
    const dx = (points[i] as number) - x;
    if (dx > reach || dx < -reach) continue;
    const dz = (points[i + 2] as number) - z;
    if (dz > reach || dz < -reach) continue;
    if (dx * dx + dz * dz > reach2) continue;
    const y = points[i + 1] as number;
    if (y >= low && y <= high) return true;
  }
  return false;
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
export const CRUISER_AIR = 5.5;


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
export const CRUISER_OVERLAP = CORRIDOR_RADIUS + 0.75;


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


export function cruiserlineNow() {
    const route = COASTER_PLANS.cruiser.route;
    const samples: { x: number; y: number; z: number }[] = [];
    const probe = new Vector3();
    for (let d = 0; d < route.length; d += CRUISER_SAMPLE_SPACING) {
      route.pointAt(d, probe);
      samples.push({ x: probe.x, y: probe.y, z: probe.z });
    }
    return samples;
  }

/** Memoised, and forgotten when the park's driver re-decides what it derives from. */
export function CRUISER_LINE(): ReturnType<typeof cruiserlineNow> {
  return (CRUISER_LINE_MEMO ??= cruiserlineNow());
}


/**
 * **The Sky Cruiser's car as it is drawn**, sampled once: the cross-section
 * points `coaster/clearance.ts` sweeps (`crossSection`), placed with the same
 * `drawnOnSphere` + `railFrameAt` + `cartEnvelopePoint` that sweep uses, every
 * {@link CAR_SWEEP_STEP} metres. Flat `x, y, z` triples.
 *
 * Built lazily: only the slide's legs ask, once the chute is planned.
 */
export let drawnCarPoints: Float64Array | null = null;
// Derived from a decision the park's driver may unwind: forgotten with it.
registerPlanCache(() => {
  drawnCarPoints = null;
});

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


export let CRUISER_LINE_MEMO: ReturnType<typeof cruiserlineNow> | null = null;
registerPlanCache(() => {
  CRUISER_LINE_MEMO = null;
});
