import { CatmullRomCurve3, Vector3 } from 'three';
import { BUILDING_HALF_X, BUILDING_HALF_Z } from '../../core/constants';
import { edgeRadiusAt, PARK_BOUNDARY } from '../boundary';
import { COASTER_PLANS } from '../coaster/plan';
import { RAIL_OVER_RAIL_AIR } from '../coaster/route';
import { BUILDING_CENTRE_X, BUILDING_CENTRE_Z } from '../building/layout';
import { ANCHORS_BY_ID } from '../anchors';
import { PARK_LAYOUT } from '../parkLayout';
import { FENCE_OFFSET } from './fence';
import { BALL_PIT_RADIUS, BALL_PIT_X, BALL_PIT_Z } from '../building/layout';
import { terrainHeight } from '../terrain';
import { cachedSolve } from '../../core/solveCache';
import { PARK_SEED } from '../parkManifest';

/**
 * Where the park train's track goes.
 *
 * The route is **solved at boot, not authored**, for the same reason the NPC
 * waypoint graph validates its own edges (`entities/npc/poiGraph.ts`): the thing
 * it has to fit between is a park that other people are still building, and a
 * hand-typed list of control points is a list that silently stops being true.
 *
 * ### Why it has to be solved
 *
 * "A closed loop round the edge of the park, outside the attractions and inside
 * the boundary" is a much tighter brief than it sounds. Measured off
 * `world/anchors.ts` and `core/constants.ts`, the five plots and the boundary
 * wall leave this much room, as bands of distance from the park centre:
 *
 * The park's edge is a spline, 57-odd metres at its pinch and 100+ at its
 * bulge, re-rolled per seed — and since issue #241 the plots are placed by a
 * solver that spreads them across all of it, unpinned, so there is no fixed
 * table of "where the plots are" to write here any more. Any bearing may
 * have a plot inside the loop, beyond it, or several stacked radially with a
 * corridor between. The loop therefore reasons in per-bearing *free
 * intervals* rather than a single lo/hi pair, and hugs the wall wherever the
 * wall happens to be on that bearing.
 *
 * Two notes on what counts as an obstacle:
 *
 * - The building's **plot rectangle cannot be honoured**: its corner is at
 *   r = 63.7, outside the boundary wall itself. `Building` hides that
 *   placeholder, so the real shell is what the route respects. Same for the ball
 *   pit, which is built at r = 6 rather than its 7.5 m marker.
 * - The three plots nobody has built into yet are honoured as *marked out*,
 *   because a train through a "coming soon" sign is exactly as wrong as a train
 *   through the ride that replaces it.
 *
 * ### How it is solved
 *
 * The loop is a radius per bearing — a shape that can bulge out to hug the wall
 * and pull back in towards the park, but never doubles back on itself.
 *
 * 1. Cast a ray from the park centre at each of {@link BEARINGS} bearings.
 *    Every obstacle the ray crosses blocks a radial interval (plus the plot
 *    clearance); what is left between {@link INNER_FLOOR} and the wall on
 *    that bearing is the bearing's list of *free intervals*.
 * 2. Relax a profile across those bearings — Laplacian smoothing for gentle
 *    curves, a gentle pull towards the wall less {@link RIM_STANDOFF} so the
 *    train hugs the park's real edge, and a Euclidean repair step, because
 *    snapping a *radius* still leaves the track too close to a plot's
 *    *corner*. Each pass ends by snapping into the nearest free interval, so
 *    the profile threads gaps rather than clamping into a plot.
 * 3. Nudge whatever is left off the trees and bushes, by asking the finished
 *    collision world — `resolve()` used as a query, the trick `poiGraph` uses to
 *    check its edges.
 *
 * What comes out is a few hundred metres of track riding the park's rim,
 * clearing every plot by at least a metre, crossing no path at all (the
 * path network tops out at r ≈ 37), with its tightest bend where it hooks round
 * the back corner of the building.
 *
 * ### What it costs — measured, not promised
 *
 * **~41 ms on the canonical seed** (40.4–41.3 ms over three runs, 8 Aug 2026,
 * M-series laptop, idle) for the whole train stage: this solve, the curve
 * build and the station planning together. That is the *incremental* cost —
 * what importing `train/plan.ts` adds once boundary, layout and the cruiser
 * are already loaded, which is how every stage is billed. Re-measure it
 * rather than trusting this prose:
 *
 *     npm run check:solve-cost          # asserts it against a budget
 *     node --experimental-transform-types --no-warnings \
 *       --import ./scripts/ts-extension-resolver-register.mjs \
 *       scripts/measure-procgen.mts --no-world     # per-stage breakdown
 *
 * A *bare* import of `train/plan.ts` costs ~1.5 s — that is the cruiser
 * stage (`COASTER_PLANS`, ~1.3 s) being pulled in as a dependency, not the
 * train. The Land Hotel merge (#241) doubled the obstacle census this solver
 * scans and took the stage from ~44 ms to ~153 ms unnoticed; the per-bearing
 * shortlists below bought it back. `scripts/fingerprint-train.mts` is how a
 * change here is proved not to have moved the route.
 */

/** Bearings the profile is solved on. 1° ≈ 0.85 m of track at this radius. */
const BEARINGS = 360;

/**
 * Half the track's width plus a little.
 *
 * The train is 1.5 m across the buffers; this is what every obstacle is held
 * away from the *centre line*.
 */
export const TRACK_CLEARANCE = 1.3;

/**
 * Clearance to *plots* is much larger than to walls and trees: the fence
 * stands 2 m off the rails, and a walkable lane must survive between fence
 * and plot or anything whose doormat faces that lane is sealed into a
 * sliver (seed 2 stranded a stall stand exactly that way). 2.0 fence +
 * 1.9 lane + 0.3 breathing room.
 */
export const TRACK_PLOT_CLEARANCE = 4.2;

/**
 * How far inside the boundary wall the loop settles when nothing pushes it
 * elsewhere — the modern reading of the old `NOMINAL_RADIUS = 56.2` against a
 * 59.55 m wall. The loop now follows the wall **per bearing** (issue #241):
 * with attractions spread across a spline-bounded park whose edge runs 57 m at
 * the pinch to 100+ at the bulge, a loop parked at any single radius is
 * *inside* the plots on one bearing and marooned in empty grass on another.
 * Hugging the edge wherever the edge is keeps the brief's promise — out past
 * the attractions, with the boundary wall for company — on every bearing of
 * every seed.
 */
const RIM_STANDOFF = 3.35;

/**
 * The loop never enters the plaza's heart, whatever the gaps between plots
 * invite. The fountain and its clearance block the true centre on most
 * bearings anyway; this floor is what says so on the bearings they miss.
 */
const INNER_FLOOR = 20;

/**
 * The wall's own collision half-width (`Garden.ts`'s
 * `BOUNDARY_WALL_COLLISION_HALF`, restated rather than imported:
 * `Garden -> paths -> train/plan -> train/route` is a real import cycle).
 */
const WALL_COLLISION_HALF = 0.45;

/** Per-bearing outer clamp: the wall's inner face, less the track's own width. */
function wallInnerRadiusAt(angle: number): number {
  return edgeRadiusAt(PARK_BOUNDARY, angle) - WALL_COLLISION_HALF - TRACK_CLEARANCE;
}

/** Relaxation: passes, smoothing weight, and the pull towards the target. */
const RELAX_PASSES = 700;
const SMOOTHING = 0.35;
const PULL = 0.006;

/**
 * How far in the loop dives when a gap between plots lets it (Decision 4:
 * "hugging the wall behind the four big plots and diving inward through the
 * gaps"). The dip floor sits inside the stall band on purpose — the track
 * weaving between the stalls is what makes the railway part of the park
 * rather than a fence around it — and every dip still respects the
 * per-bearing lower bound, so it can never touch a plot.
 */
const DIP_RADIUS = 38;

/** A bearing only dips if the way in is clear this far past the dip floor. */
const DIP_HEADROOM = 2.5;

/** Bearings of guard either side of an obstacle before a dip is allowed. */
const DIP_GUARD = 5;

/** Control points the finished curve is built from — every 5°. */
const CONTROL_STRIDE = 5;

interface RectObstacle {
  readonly centreX: number;
  readonly centreZ: number;
  readonly halfX: number;
  readonly halfZ: number;
}

interface CircleObstacle {
  readonly centreX: number;
  readonly centreZ: number;
  readonly radius: number;
  /** Clearance the loop keeps from this obstacle. Plots get the full
   * fence-plus-lane {@link TRACK_PLOT_CLEARANCE}; the Sky Cruiser's low
   * corridor needs only the track kept out from under it. */
  readonly clearance?: number;
}

/** The solved loop, and everything the train and the stations ask of it. */
export class TrainRoute {
  readonly curve: CatmullRomCurve3;
  readonly length: number;

  /** Smallest gap between the centre line and anything it must miss. */
  readonly minClearance: number;

  private readonly sampleX: Float64Array;
  private readonly sampleZ: Float64Array;
  private readonly sampleDistance: Float64Array;
  private readonly scratch = new Vector3();

  constructor() {
    // The profile is a pure function of the seed's layout and boundary, so
    // it caches with them (core/solveCache): a reload of a park already
    // visited skips the 700-pass relaxation entirely.
    const radii = cachedSolve(
      'train-profile',
      `${PARK_SEED}`,
      () => [...solveProfile()],
      (value) => value,
      (raw) => {
        const list = raw as number[];
        if (!Array.isArray(list) || list.length !== BEARINGS) throw new Error('stale profile');
        return list;
      },
    );

    const points: Vector3[] = [];
    for (let i = 0; i < BEARINGS; i += CONTROL_STRIDE) {
      const angle = (i / BEARINGS) * Math.PI * 2;
      const radius = radii[i] ?? INNER_FLOOR;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      points.push(new Vector3(x, terrainHeight(x, z), z));
    }

    this.curve = new CatmullRomCurve3(points, true, 'catmullrom', 0.5);
    // The default 200 divisions across 325 m puts the arc-length table 1.6 m
    // apart, which makes the train visibly surge on the tighter bends.
    this.curve.arcLengthDivisions = 1600;
    this.length = this.curve.getLength();

    // A lookup table for "where along the loop is this point?" — used to place
    // the stations and to send a child to the nearest one.
    const samples = BEARINGS;
    this.sampleX = new Float64Array(samples);
    this.sampleZ = new Float64Array(samples);
    this.sampleDistance = new Float64Array(samples);
    const point = new Vector3();
    for (let i = 0; i < samples; i += 1) {
      const t = i / samples;
      this.curve.getPointAt(t, point);
      this.sampleX[i] = point.x;
      this.sampleZ[i] = point.z;
      this.sampleDistance[i] = t * this.length;
    }

    this.minClearance = measureClearance(this.sampleX, this.sampleZ);
  }

  /** Position on the centre line, `distance` metres along. Wraps both ways. */
  pointAt(distance: number, target = this.scratch): Vector3 {
    return this.curve.getPointAt(this.wrap(distance) / this.length, target);
  }

  /** Unit tangent, pointing the way the train travels. */
  tangentAt(distance: number, target = new Vector3()): Vector3 {
    return this.curve.getTangentAt(this.wrap(distance) / this.length, target).normalize();
  }

  /** Distance along the loop of the point nearest (x, z). */
  distanceNear(x: number, z: number): number {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < this.sampleX.length; i += 1) {
      const dx = (this.sampleX[i] ?? 0) - x;
      const dz = (this.sampleZ[i] ?? 0) - z;
      const squared = dx * dx + dz * dz;
      if (squared < bestDistance) {
        bestDistance = squared;
        best = this.sampleDistance[i] ?? 0;
      }
    }
    return best;
  }

  /** Folds any distance into [0, length). */
  wrap(distance: number): number {
    const wrapped = distance % this.length;
    return wrapped < 0 ? wrapped + this.length : wrapped;
  }

  /**
   * Signed gap from `from` to `to` going *forwards*, in metres. Always in
   * [0, length), so "how far to the next stop" never comes back negative.
   */
  forwardGap(from: number, to: number): number {
    return this.wrap(to - from);
  }
}

// ------------------------------------------------------------------ solving

function solveProfile(): Float64Array {
  const anchors = ANCHORS_BY_ID;

  const rects: RectObstacle[] = [
    // The building, as built — see the note at the top of the file.
    {
      centreX: BUILDING_CENTRE_X,
      centreZ: BUILDING_CENTRE_Z,
      halfX: BUILDING_HALF_X,
      halfZ: BUILDING_HALF_Z,
    },
  ];
  const circles: CircleObstacle[] = [
    { centreX: BALL_PIT_X, centreZ: BALL_PIT_Z, radius: BALL_PIT_RADIUS + 0.45 },
  ];

  // Every plot still waiting for its ride, as marked out on the grass.
  for (const id of ['dodgems', 'waterFight', 'ferrisWheel'] as const) {
    const anchor = anchors[id];
    const [centreX, centreZ] = anchor.position;
    if (anchor.footprint.kind === 'rect') {
      rects.push({
        centreX,
        centreZ,
        halfX: anchor.footprint.halfX,
        halfZ: anchor.footprint.halfZ,
      });
    } else {
      circles.push({ centreX, centreZ, radius: anchor.footprint.radius });
    }
  }

  // Now the loop dives inside the park (Decision 4), everything the layout
  // placed is an obstacle — the stalls and the fountain plaza were never in
  // this list because the old wall-hugging loop could not reach them.
  for (const entry of PARK_LAYOUT.entries.values()) {
    if (entry.id in anchors || entry.id === 'building') continue;
    circles.push({ centreX: entry.x, centreZ: entry.z, radius: entry.boundingRadius + 1.5 });
  }

  // The Sky Cruiser's LOW corridor — its station flat and ramps, wherever
  // this seed put them. The cruiser solves first and cannot know the train;
  // the train solves second and treats what the cruiser actually built as
  // ground truth (Decision 6: publish what you solved, the next system
  // dodges it). Anywhere the cruiser's rail is too low for a train to pass
  // under with Decision 4's {@link RAIL_OVER_RAIL_AIR} becomes a small
  // no-go disc; at cruise height it is not an obstacle at all, and the
  // crossing rule is satisfied by the cruise floor itself.
  // The cruiser's DISMOUNT POINT too: the exit is chosen before the train
  // exists (solve order), so the avoidance lives here — a fence across the
  // spot a ride sets a child down is the seed-18 failure shape.
  circles.push({
    centreX: COASTER_PLANS.cruiser.exitX,
    centreZ: COASTER_PLANS.cruiser.exitZ,
    radius: 1.6,
    clearance: 4.0,
  });

  {
    const cruiser = COASTER_PLANS.cruiser.route;
    const probe = new Vector3();
    const lowCeiling = RAIL_OVER_RAIL_AIR + 0.4; // railhead sits ~0.3 above terrain
    for (let d = 0; d < cruiser.length; d += 2) {
      cruiser.pointAt(d, probe);
      if (probe.y - terrainHeight(probe.x, probe.z) >= lowCeiling) continue;
      // Clearance covers the FENCE the track carries, not just the track:
      // rails at r means fence pickets at r + 2.0, and the cruiser's car is
      // 1.45 m half-wide — 2.2 left the fence inside the car on seed 18.
      circles.push({ centreX: probe.x, centreZ: probe.z, radius: 1.6, clearance: 4.0 });
    }
  }

  // Per-bearing free intervals of radius (issue #241). The old bound-pair —
  // "outside the furthest obstacle exit, inside one wall radius" — assumed
  // every plot sits inside the loop and the wall is a circle. Neither is true
  // any more: plots spread to the spline, so a bearing can have a plot
  // *beyond* the loop (the loop passes inside it) or several plots stacked
  // radially (the loop threads a gap). So each bearing gets the honest list
  // of free intervals between [INNER_FLOOR, the wall on that bearing], and
  // the solver keeps the profile inside whichever interval it is nearest —
  // greedy continuity, smoothed by the same relaxation as ever.
  const walls = new Float64Array(BEARINGS);
  const dirXs = new Float64Array(BEARINGS);
  const dirZs = new Float64Array(BEARINGS);
  const free: Interval[][] = [];
  for (let i = 0; i < BEARINGS; i += 1) {
    const angle = (i / BEARINGS) * Math.PI * 2;
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    dirXs[i] = dirX;
    dirZs[i] = dirZ;
    walls[i] = wallInnerRadiusAt(angle);

    const blocked: Interval[] = [];
    for (const rect of rects) {
      const span = rectSpan(dirX, dirZ, rect);
      if (span) blocked.push([span[0] - TRACK_PLOT_CLEARANCE, span[1] + TRACK_PLOT_CLEARANCE]);
    }
    for (const circle of circles) {
      const span = circleSpan(dirX, dirZ, circle);
      const keep = circle.clearance ?? TRACK_PLOT_CLEARANCE;
      if (span) blocked.push([span[0] - keep, span[1] + keep]);
    }
    free.push(freeIntervals(blocked, INNER_FLOOR, walls[i] as number));
  }

  // Per-bearing obstacle shortlists — a speed-up that provably cannot move
  // the route. {@link repair} runs RELAX_PASSES × BEARINGS = 252,000 times,
  // and used to measure every obstacle every time: 37 obstacles on the
  // canonical seed (the Land Hotel merge roughly doubled the census — more
  // layout entries, a longer cruiser low corridor) ≈ 9.3M distance
  // evaluations, which a CPU profile put at 108 ms of the train stage's
  // 153. But an obstacle can only raise repair's deficit when the probed
  // point comes within that obstacle's own clearance of it, and every probe
  // on bearing i lies on that bearing's ray inside [lo, hi] — so an
  // obstacle whose clearance disc the whole segment misses contributes
  // d ≤ 0 to a running max that starts at 0, and dropping it cannot change
  // the max's value. The rare probe pushed beyond the segment is handled in
  // repair itself, by re-running the full scan (see the guard there).
  let wallMax = 0;
  for (let i = 0; i < BEARINGS; i += 1) wallMax = Math.max(wallMax, walls[i] ?? 0);
  const probeLo = INNER_FLOOR - PROBE_MARGIN;
  const probeHi = wallMax + PROBE_MARGIN;
  const near: NearObstacles[] = [];
  for (let i = 0; i < BEARINGS; i += 1) {
    const dirX = dirXs[i] ?? 0;
    const dirZ = dirZs[i] ?? 0;
    near.push({
      lo: probeLo,
      hi: probeHi,
      rects: rects.filter((rect) =>
        segmentReaches(
          dirX,
          dirZ,
          probeLo,
          probeHi,
          rect.centreX,
          rect.centreZ,
          // The rect fits inside its corner-circumscribing circle, so its
          // clearance disc fits inside that circle grown by the clearance.
          Math.hypot(rect.halfX, rect.halfZ) + TRACK_PLOT_CLEARANCE,
        ),
      ),
      circles: circles.filter((circle) =>
        segmentReaches(
          dirX,
          dirZ,
          probeLo,
          probeHi,
          circle.centreX,
          circle.centreZ,
          circle.radius + (circle.clearance ?? TRACK_PLOT_CLEARANCE),
        ),
      ),
    });
  }

  // The per-bearing target: the wall behind plots, the dip floor in gaps.
  // A bearing counts as a gap only when it and its neighbours all have free
  // ground right through the dip window, so the run-in to every dip starts
  // on open grass rather than scraping a plot corner.
  const target = new Float64Array(BEARINGS);
  for (let i = 0; i < BEARINGS; i += 1) {
    let clearForDip = true;
    for (let w = -DIP_GUARD; w <= DIP_GUARD && clearForDip; w += 1) {
      const j = (i + w + BEARINGS) % BEARINGS;
      if (!coversWindow(free[j] as Interval[], DIP_RADIUS - DIP_HEADROOM, DIP_RADIUS + DIP_HEADROOM)) {
        clearForDip = false;
      }
    }
    target[i] = clearForDip ? DIP_RADIUS : (walls[i] as number) - RIM_STANDOFF;
  }
  // Soften the square edges of the target so the pull draws smooth S-bends.
  for (let pass = 0; pass < 40; pass += 1) {
    for (let i = 0; i < BEARINGS; i += 1) {
      const before = target[(i - 1 + BEARINGS) % BEARINGS] ?? 0;
      const after = target[(i + 1) % BEARINGS] ?? 0;
      target[i] = (target[i] ?? 0) * 0.5 + (before + after) * 0.25;
    }
  }

  let radii = new Float64Array(BEARINGS);
  for (let i = 0; i < BEARINGS; i += 1) {
    radii[i] = snapToFree(free[i] as Interval[], target[i] ?? INNER_FLOOR);
  }

  for (let pass = 0; pass < RELAX_PASSES; pass += 1) {
    const next = new Float64Array(BEARINGS);
    for (let i = 0; i < BEARINGS; i += 1) {
      const before = radii[(i - 1 + BEARINGS) % BEARINGS] ?? 0;
      const here = radii[i] ?? 0;
      const after = radii[(i + 1) % BEARINGS] ?? 0;

      // Averaging the two neighbours alone (weight 0.5) leaves the alternating
      // high-low mode untouched — it is an eigenvector with eigenvalue -1 and
      // flips sign forever instead of decaying. Keep the weight below a half.
      // Dips pull much harder than the wall does: a dip is a narrow angular
      // window, and at the wall's gentle pull the smoothing term wins and
      // the loop never leaves the wall at all (measured: zero dips).
      const want = target[i] ?? INNER_FLOOR;
      const wall = walls[i] as number;
      const pull = want < wall - RIM_STANDOFF - 1 ? PULL * 5 : PULL;
      let radius = here + SMOOTHING * (before + after - 2 * here) + pull * (want - here);

      const dirX = dirXs[i] ?? 0;
      const dirZ = dirZs[i] ?? 0;
      radius = repair(radius, dirX, dirZ, rects, circles, free[i] as Interval[], near[i]);

      next[i] = snapToFree(free[i] as Interval[], radius);
    }
    radii = next;
  }

  // The route no longer bends around trees — it cannot, because it is solved
  // before any tree exists (`train/plan.ts` runs at module load, so paths and
  // scenery can treat the railway as a given). The dependency now points the
  // right way: `Scenery.isPlantable` keeps trees off the rail corridor.
  return radii;
}

// ------------------------------------------------------------- intervals

/** A closed radial interval [from, to] along one bearing's ray. */
type Interval = readonly [number, number];

/** The free intervals inside [floor, ceiling] once `blocked` is cut out. */
function freeIntervals(blocked: Interval[], floor: number, ceiling: number): Interval[] {
  if (ceiling <= floor) return [];
  const sorted = [...blocked].sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  let cursor = floor;
  for (const [from, to] of sorted) {
    if (to <= cursor) continue;
    if (from > ceiling) break;
    if (from > cursor) out.push([cursor, Math.min(from, ceiling)]);
    cursor = Math.max(cursor, to);
    if (cursor >= ceiling) break;
  }
  if (cursor < ceiling) out.push([cursor, ceiling]);
  // A sliver the track cannot actually sit in is not a choice — and "the
  // track" is the fenced railway, not the centre line.
  //
  // This filter used to say `>= 1`, which let a **1.7 m** gap between the Sky
  // Cruiser's low corridor and the park wall count as somewhere the railway
  // could go. On seed 2 the profile duly put itself in that sliver at bearings
  // 169-170 and back in the inner interval by 175; the curve is built from
  // every fifth bearing (`CONTROL_STRIDE`), so the Catmull-Rom ran straight
  // through the blocked band between them, and the lineside fence — 2 m off
  // the rails, and taller than the ballast — ended up inside the cruiser's car
  // at 1.10 m. The invariant reported it as the *cruiser* striking the fence,
  // which is the last place anyone would look for a bug in the train's profile.
  //
  // `FENCE_OFFSET` either side is what the railway genuinely occupies, so a
  // gap narrower than that cannot hold one however the centre line is drawn.
  // Taken from `fence.ts` rather than typed again here: the two numbers used to
  // agree by coincidence, and that is what this whole failure is made of.
  const usable = out.filter(([from, to]) => to - from >= FENCE_OFFSET * 2);
  // Never hand back nothing: a bearing with no interval at all throws in
  // `snapToFree`, and a too-narrow gap is still better than a sealed park.
  return usable.length > 0 ? usable : out.filter(([from, to]) => to - from >= 1);
}

/** Is [from, to] wholly inside one free interval? */
function coversWindow(free: readonly Interval[], from: number, to: number): boolean {
  for (const [lo, hi] of free) {
    if (lo <= from && to <= hi) return true;
  }
  return false;
}

/**
 * The nearest point to `value` that lies in a free interval.
 *
 * **Nearest, and nothing else.** This is called once per bearing per relaxation
 * pass and is given no memory of what the previous bearing chose, so if
 * smoothing walks `value` across a blocked band it will happily snap into the
 * interval on the far side. The profile can hop.
 *
 * That matters because the curve is built from every {@link CONTROL_STRIDE}th
 * bearing, so a hop between two control bearings is interpolated *straight
 * through the obstacle between them* — which is how seed 2 put the lineside
 * fence inside the Sky Cruiser's car, and how the invariant came to report it
 * as the cruiser's fault.
 *
 * This doc used to claim the opposite — "greedy continuity: the profile stays
 * in whichever gap it is already in, and only jumps when a gap closes entirely
 * between bearings" — which was never true of the code below and sent at least
 * one reader looking for the seed 2 bug everywhere except here. A comment
 * describing a property the code does not have is the same two-definitions
 * disease as a duplicated constant, in prose.
 *
 * What actually keeps the profile honest today is {@link freeIntervals}
 * refusing to offer a gap too narrow for a fenced railway, so there is no
 * tempting sliver on the far side of an obstacle to hop into. **That removes
 * the temptation, not the capability.** A profile that genuinely cannot hop —
 * one that tracks which interval it is in and may only change where two
 * intervals merge — is the real fix, and is not written yet.
 */
function snapToFree(free: readonly Interval[], value: number): number {
  if (free.length === 0) {
    // A bearing with no free interval at all would silently unconstrain the
    // profile here and fail three invariants later as an unexplained red.
    // Name it at the source instead (reviewer finding 6 on PR #247).
    throw new Error(
      'train route: a bearing has no free radial interval at all — the plots have ' +
        'sealed the park annulus shut on this seed; loosen the manifest or re-roll',
    );
  }
  let best = value;
  let bestGap = Infinity;
  for (const [lo, hi] of free) {
    const snapped = value < lo ? lo : value > hi ? hi : value;
    const gap = Math.abs(snapped - value);
    if (gap < bestGap) {
      bestGap = gap;
      best = snapped;
    }
  }
  return best;
}

/**
 * How far past its normal range ({@link INNER_FLOOR} to the outermost wall)
 * a bearing's probe segment extends for the {@link NearObstacles} shortlist.
 * The value entering {@link repair} is a near-convex blend of snapped radii
 * (all inside [INNER_FLOOR, wall]) plus the pull term (bounded by a few
 * metres), and each repair attempt then moves it by one deficit — usually
 * under {@link TRACK_PLOT_CLEARANCE}, more only when a probe lands *inside*
 * an obstacle. 16 m absorbs all of that in practice; the guard in repair
 * catches the pathological remainder exactly rather than by argument.
 */
const PROBE_MARGIN = 16;

/**
 * One bearing's shortlist for {@link repair}: the obstacles whose clearance
 * disc the bearing's probe segment [lo, hi]·dir can enter at all. Everything
 * else measures d ≤ 0 at every probe on this bearing and can never change
 * repair's running max.
 */
interface NearObstacles {
  readonly lo: number;
  readonly hi: number;
  readonly rects: readonly RectObstacle[];
  readonly circles: readonly CircleObstacle[];
}

/**
 * Can a point r·(dirX, dirZ), r ∈ [lo, hi], come within `reach` of
 * (centreX, centreZ)? The direction is unit, so the nearest r is the plain
 * dot product clamped into the segment. The `+ 1e-6` keeps the test
 * conservative: a borderline obstacle is kept on the shortlist, which costs
 * one extra scan and can change nothing.
 */
function segmentReaches(
  dirX: number,
  dirZ: number,
  lo: number,
  hi: number,
  centreX: number,
  centreZ: number,
  reach: number,
): boolean {
  const along = Math.min(hi, Math.max(lo, dirX * centreX + dirZ * centreZ));
  return Math.hypot(dirX * along - centreX, dirZ * along - centreZ) < reach + 1e-6;
}

/**
 * Pushes a radius until the *point* clears everything, not just the bearing.
 *
 * A plot corner sticks into the corridor diagonally: the ray along a bearing can
 * leave the rectangle a comfortable distance out and still pass within a few
 * centimetres of the corner itself.
 *
 * `near`, when given, is this bearing's precomputed shortlist: the scan runs
 * over only the obstacles that any probe on this bearing could measure a
 * positive deficit against — same maxima, same arithmetic, ~5x fewer terms.
 * A probe outside the shortlist's segment falls back to the full scan,
 * re-run from the original arguments so its answer is the one the full scan
 * always gave.
 */
function repair(
  radius: number,
  dirX: number,
  dirZ: number,
  rects: readonly RectObstacle[],
  circles: readonly CircleObstacle[],
  free: readonly Interval[],
  near?: NearObstacles,
): number {
  let value = radius;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (near && (value < near.lo || value > near.hi)) {
      // The shortlist only vouches for probes on its own segment. Replaying
      // from the original radius with the full lists costs one redundant
      // walk of the in-range prefix (identical by the shortlist's own
      // guarantee) and then continues soundly wherever the probe went.
      return repair(radius, dirX, dirZ, rects, circles, free);
    }
    const scanRects = near ? near.rects : rects;
    const scanCircles = near ? near.circles : circles;
    const x = dirX * value;
    const z = dirZ * value;

    // The wall needs no attention here: every free interval is already
    // capped at the per-bearing wall radius, and the caller snaps into one
    // after each repair. This loop only fixes 2D corner deficits — an
    // obstacle whose corner pokes into the corridor diagonally, which a
    // purely radial clamp cannot see. Each obstacle demands its own
    // clearance: plots the fence-and-lane figure, the cruiser's low
    // corridor just enough to keep the track out from under it.
    let deficit = 0;
    for (const rect of scanRects) {
      const d = TRACK_PLOT_CLEARANCE - rectDistance(x, z, rect);
      if (d > deficit) deficit = d;
    }
    for (const circle of scanCircles) {
      const keep = circle.clearance ?? TRACK_PLOT_CLEARANCE;
      const d = keep - (Math.hypot(x - circle.centreX, z - circle.centreZ) - circle.radius);
      if (d > deficit) deficit = d;
    }
    if (deficit <= 0) break;

    // Too close to something's corner. The old rule pushed *outward* always,
    // which was right while every plot lived inside the loop; now a plot can
    // sit beyond it (issue #241), so try both ways and keep whichever lands
    // on free ground — nearest first, so the profile deforms minimally.
    const outward = value + deficit;
    const inward = value - deficit;
    const outFree = snapToFree(free, outward) === outward;
    const inFree = snapToFree(free, inward) === inward;
    if (outFree && (!inFree || outward - value <= value - inward)) value = outward;
    else if (inFree) value = inward;
    else value = outward;
  }
  return value;
}

// ------------------------------------------------------------------ geometry

/** Where a ray from the origin is inside a rectangle, or null if it misses. */
function rectSpan(dirX: number, dirZ: number, rect: RectObstacle): Interval | null {
  let enter = -Infinity;
  let exit = Infinity;

  const slabs: readonly (readonly [number, number, number])[] = [
    [dirX, rect.centreX, rect.halfX],
    [dirZ, rect.centreZ, rect.halfZ],
  ];
  for (const [direction, centre, half] of slabs) {
    const low = centre - half;
    const high = centre + half;
    if (Math.abs(direction) < 1e-9) {
      // Parallel to this slab: the origin is either inside it or the ray misses.
      if (0 < low || 0 > high) return null;
      continue;
    }
    const first = low / direction;
    const second = high / direction;
    enter = Math.max(enter, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
  }

  if (exit < enter || exit <= 0) return null;
  return [Math.max(0, enter), exit];
}

/** Where a ray from the origin is inside a circle, or null if it misses. */
function circleSpan(dirX: number, dirZ: number, circle: CircleObstacle): Interval | null {
  const along = dirX * circle.centreX + dirZ * circle.centreZ;
  const offset =
    circle.centreX * circle.centreX + circle.centreZ * circle.centreZ - circle.radius * circle.radius;
  const discriminant = along * along - offset;
  if (discriminant <= 0) return null;
  const half = Math.sqrt(discriminant);
  const exit = along + half;
  if (exit <= 0) return null;
  return [Math.max(0, along - half), exit];
}

/** Distance from a point to a rectangle. Negative inside. */
function rectDistance(x: number, z: number, rect: RectObstacle): number {
  const dx = Math.abs(x - rect.centreX) - rect.halfX;
  const dz = Math.abs(z - rect.centreZ) - rect.halfZ;
  if (dx > 0 || dz > 0) return Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
  return Math.max(dx, dz);
}

/** Smallest gap between the finished centre line and the wall. For reporting. */
function measureClearance(xs: Float64Array, zs: Float64Array): number {
  let best = Infinity;
  for (let i = 0; i < xs.length; i += 1) {
    const x = xs[i] ?? 0;
    const z = zs[i] ?? 0;
    const gap = wallInnerRadiusAt(Math.atan2(z, x)) + TRACK_CLEARANCE - Math.hypot(x, z);
    if (gap < best) best = gap;
  }
  return best;
}

