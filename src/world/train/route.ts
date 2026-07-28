import { CatmullRomCurve3, Vector3 } from 'three';
import {
  BUILDING_CENTRE_X,
  BUILDING_CENTRE_Z,
  BUILDING_HALF_X,
  BUILDING_HALF_Z,
  GARDEN_HALF_SIZE,
} from '../../core/constants';
import { ANCHORS_BY_ID } from '../anchors';
import { PARK_LAYOUT } from '../parkLayout';
import { BALL_PIT_RADIUS, BALL_PIT_X, BALL_PIT_Z } from '../building/layout';
import { terrainHeight } from '../terrain';
import type { CollisionWorld } from '../Collision';

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
 * | | occupies | on bearings |
 * | --- | --- | --- |
 * | dodgems plot | 23.7 – 54.6 | 14° – 56° |
 * | water fight plot | 23.6 – 56.1 | 118° – 162° |
 * | the building | 27.1 – 56.6 | 208° – 247° |
 * | ferris wheel plot | 30.1 – 52.1 | 303° – 334° |
 * | ball pit | 11.1 – 23.9 | 214° – 264° |
 * | boundary wall (inner face) | 59.55 | everywhere |
 *
 * Going round the *inside* is impossible: on the south-west bearings the ball
 * pit ends at 23.9 and the building starts at 27.1, and the corridor between
 * them is the main path ring. So the train goes round the *outside* of every
 * plot — which fits, but only just. Behind the building there are 2.95 metres
 * between its corner and the wall, and the train is 1.5 m wide.
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
 * 1. Cast a ray from the park centre at each of {@link BEARINGS} bearings. The
 *    furthest point at which it leaves any obstacle gives `lo(θ)`: the smallest
 *    radius that is clear of the plots. `hi(θ)` is the wall, less the same
 *    clearance.
 * 2. Relax a profile between those bounds — Laplacian smoothing for gentle
 *    curves, a gentle pull towards {@link NOMINAL_RADIUS} so the train comes in
 *    off the wall wherever there is room, and a Euclidean repair step, because
 *    clamping a *radius* still leaves the track too close to a plot's *corner*.
 * 3. Nudge whatever is left off the trees and bushes, by asking the finished
 *    collision world — `resolve()` used as a query, the trick `poiGraph` uses to
 *    check its edges.
 *
 * What comes out is 325-odd metres of track, 48 to 58 m from the middle of the
 * park, clearing every plot by at least a metre, crossing no path at all (the
 * path network tops out at r ≈ 37), with its tightest bend where it hooks round
 * the back corner of the building.
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
 * Where the profile settles when nothing is pushing it outwards.
 *
 * Deliberately past 55, and that is the single most useful number in this file:
 * `Scenery.isPlantable` refuses to plant anything more than 55 m from the middle
 * of the park, and the treeline outside the wall starts at 63. So a loop that
 * stays out here is **tree-free by construction** — no dodging, no swerves, no
 * rail bent round a bush that a later scatter will move anyway. It also puts the
 * train exactly where the brief wants it: out at the edge, past the attractions,
 * with the boundary wall for company.
 *
 * The dodge below is kept as a safety net for whatever the next builder plants.
 */
const NOMINAL_RADIUS = 56.2;

/** Inner face of the pink boundary wall (see `Garden.buildBoundaryWall`). */
const WALL_INNER_RADIUS = GARDEN_HALF_SIZE - 2 - 0.45;

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
const DIP_RADIUS = 33;

/** A bearing only dips if the way in is clear this far past the dip floor. */
const DIP_HEADROOM = 3.5;

/** Bearings of guard either side of an obstacle before a dip is allowed. */
const DIP_GUARD = 8;

/**
 * Beyond this radius the collision probe is skipped.
 *
 * `CollisionWorld.resolve` also applies the `GARDEN_PLAY_RADIUS` clamp — it is
 * written for walkers, and the train is not one — which above 56.7 would drag
 * the wall-hugging sections back in and undo the only part of the route with no
 * slack in it. Nothing is planted out there anyway.
 */
const PROBE_LIMIT = 56.7;

/** Control points the finished curve is built from — every 5°. */
const CONTROL_STRIDE = 5;

/** Steps the swerve-round-a-tree search takes, and how far it will go. */
const SEARCH_STEP = 0.25;
const SEARCH_LIMIT = 5;

/**
 * Bearings either side of a tree the swerve is spread over.
 *
 * At r ≈ 48 one bearing is 0.84 m of track, so twelve of them is a ten-metre
 * run-in and a ten-metre run-out for a two-metre sidestep. Anything much
 * tighter and the rail has a visible kink in it.
 */
const SWERVE_WIDTH = 12;

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

  constructor(collision: CollisionWorld) {
    const radii = solveProfile(collision);

    const points: Vector3[] = [];
    for (let i = 0; i < BEARINGS; i += CONTROL_STRIDE) {
      const angle = (i / BEARINGS) * Math.PI * 2;
      const radius = radii[i] ?? NOMINAL_RADIUS;
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

function solveProfile(collision: CollisionWorld): Float64Array {
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

  const lower = new Float64Array(BEARINGS);
  const upper = new Float64Array(BEARINGS);
  for (let i = 0; i < BEARINGS; i += 1) {
    const angle = (i / BEARINGS) * Math.PI * 2;
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);

    let exit = 0;
    for (const rect of rects) exit = Math.max(exit, rectExitRadius(dirX, dirZ, rect));
    for (const circle of circles) exit = Math.max(exit, circleExitRadius(dirX, dirZ, circle));

    lower[i] = exit > 0 ? exit + TRACK_CLEARANCE : NOMINAL_RADIUS * 0.5;
    upper[i] = WALL_INNER_RADIUS - TRACK_CLEARANCE;
  }

  // The per-bearing target: the wall behind plots, the dip floor in gaps.
  // A bearing counts as a gap only when it and its neighbours are all clear
  // well past the dip floor, so the run-in to every dip starts on open grass
  // rather than scraping a plot corner.
  const target = new Float64Array(BEARINGS);
  for (let i = 0; i < BEARINGS; i += 1) {
    let clearForDip = true;
    for (let w = -DIP_GUARD; w <= DIP_GUARD && clearForDip; w += 1) {
      const j = (i + w + BEARINGS) % BEARINGS;
      if ((lower[j] ?? 0) + DIP_HEADROOM > DIP_RADIUS) clearForDip = false;
    }
    target[i] = clearForDip ? DIP_RADIUS : NOMINAL_RADIUS;
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
    radii[i] = clamp(target[i] ?? NOMINAL_RADIUS, lower[i] ?? 0, upper[i] ?? NOMINAL_RADIUS);
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
      let radius =
        here + SMOOTHING * (before + after - 2 * here) + PULL * ((target[i] ?? NOMINAL_RADIUS) - here);

      const angle = (i / BEARINGS) * Math.PI * 2;
      const dirX = Math.cos(angle);
      const dirZ = Math.sin(angle);
      radius = repair(radius, dirX, dirZ, rects, circles);

      next[i] = clamp(radius, lower[i] ?? 0, upper[i] ?? radius);
    }
    radii = next;
  }

  // Every later pass has to go back through the same bounds. Smoothing a
  // profile that was legal is not: a swerve round a tree averaged out with its
  // neighbours drifts back inside the plot it was clamped out of, which is
  // exactly how the track first ended up crossing a corner of the dodgems.
  const constrain = (index: number, radius: number): number => {
    const angle = (index / BEARINGS) * Math.PI * 2;
    const repaired = repair(radius, Math.cos(angle), Math.sin(angle), rects, circles);
    return clamp(repaired, lower[index] ?? 0, upper[index] ?? repaired);
  };

  nudgeOffScenery(radii, collision, constrain);
  return radii;
}

/**
 * Pushes a radius until the *point* clears everything, not just the bearing.
 *
 * A plot corner sticks into the corridor diagonally: the ray along a bearing can
 * leave the rectangle a comfortable distance out and still pass within a few
 * centimetres of the corner itself.
 */
function repair(
  radius: number,
  dirX: number,
  dirZ: number,
  rects: readonly RectObstacle[],
  circles: readonly CircleObstacle[],
): number {
  let value = radius;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const x = dirX * value;
    const z = dirZ * value;

    let worst = WALL_INNER_RADIUS - value;
    let fromWall = true;
    for (const rect of rects) {
      const gap = rectDistance(x, z, rect);
      if (gap < worst) {
        worst = gap;
        fromWall = false;
      }
    }
    for (const circle of circles) {
      const gap = Math.hypot(x - circle.centreX, z - circle.centreZ) - circle.radius;
      if (gap < worst) {
        worst = gap;
        fromWall = false;
      }
    }

    if (worst >= TRACK_CLEARANCE) break;
    // Too close to the wall means come in; too close to anything else means the
    // only way past is further out, because the plots reach the park centre.
    value += fromWall ? -(TRACK_CLEARANCE - worst) : TRACK_CLEARANCE - worst;
  }
  return value;
}

/**
 * Bends the finished profile around whatever the collision world knows about —
 * in practice a handful of trees and bushes on the inner, tree-planted stretches.
 *
 * `resolve()` is a query here, not a movement: put a probe where the track wants
 * to be, ask the world to push it out of anything solid, and take the radial
 * part of however far it moved. Two passes of light smoothing between rounds
 * keep the dodge a gentle swerve rather than a kink in the rail.
 */
function nudgeOffScenery(
  radii: Float64Array,
  collision: CollisionWorld,
  constrain: (index: number, radius: number) => number,
): void {
  const probe = new Vector3();

  /** Is the track clear of everything solid at this radius on this bearing? */
  const isClear = (index: number, radius: number): boolean => {
    if (radius >= PROBE_LIMIT) return true;
    const angle = (index / BEARINGS) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    probe.set(x, 0, z);
    collision.resolve(probe, TRACK_CLEARANCE);
    const pushX = probe.x - x;
    const pushZ = probe.z - z;
    return pushX * pushX + pushZ * pushZ < 1e-6;
  };

  /**
   * The nearest radius on this bearing that clears everything, searched
   * outwards first.
   *
   * Following the push out of a collider looks like the obvious thing and is
   * not: `resolve` leaves by the *nearest* edge, so a track sample wedged
   * between two bushes is shoved back and forth between them for ever. A search
   * commits to a direction and arrives somewhere, and preferring outwards keeps
   * the swerve on the side where there is a boundary wall's worth of room.
   */
  const findClear = (index: number, radius: number): number => {
    if (isClear(index, radius)) return radius;
    for (let step = SEARCH_STEP; step <= SEARCH_LIMIT; step += SEARCH_STEP) {
      for (const direction of [1, -1] as const) {
        const candidate = constrain(index, radius + direction * step);
        if (candidate !== radius && isClear(index, candidate)) return candidate;
      }
    }
    return radius;
  };

  for (let round = 0; round < 14; round += 1) {
    const bumps = new Float64Array(BEARINGS);
    let blocked = false;

    for (let i = 0; i < BEARINGS; i += 1) {
      const radius = radii[i] ?? 0;
      if (isClear(i, radius)) continue;
      blocked = true;

      // Move the whole neighbourhood, not the one bearing that is fouled.
      // Displacing a single sample leaves a step in the rail — and a step is
      // both ugly and, measured as curvature, a hairpin. A raised cosine
      // spread over SWERVE_WIDTH bearings is a swerve a train could take.
      const delta = findClear(i, radius) - radius;
      for (let j = -SWERVE_WIDTH; j <= SWERVE_WIDTH; j += 1) {
        const index = (i + j + BEARINGS) % BEARINGS;
        const falloff = 0.5 * (1 + Math.cos((Math.PI * j) / SWERVE_WIDTH));
        const bump = delta * falloff;
        // Overlapping swerves take the largest, rather than adding up into a
        // detour nobody asked for.
        const existing = bumps[index] ?? 0;
        if (Math.abs(bump) > Math.abs(existing)) bumps[index] = bump;
      }
    }

    if (!blocked) break;

    for (let i = 0; i < BEARINGS; i += 1) {
      radii[i] = constrain(i, (radii[i] ?? 0) + (bumps[i] ?? 0));
    }
  }
}

// ------------------------------------------------------------------ geometry

/** How far along a ray from the origin it finally leaves a rectangle. */
function rectExitRadius(dirX: number, dirZ: number, rect: RectObstacle): number {
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
      if (0 < low || 0 > high) return 0;
      continue;
    }
    const first = low / direction;
    const second = high / direction;
    enter = Math.max(enter, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
  }

  return exit < enter || exit <= 0 ? 0 : exit;
}

function circleExitRadius(dirX: number, dirZ: number, circle: CircleObstacle): number {
  const along = dirX * circle.centreX + dirZ * circle.centreZ;
  const offset =
    circle.centreX * circle.centreX + circle.centreZ * circle.centreZ - circle.radius * circle.radius;
  const discriminant = along * along - offset;
  if (discriminant <= 0) return 0;
  const exit = along + Math.sqrt(discriminant);
  return exit > 0 ? exit : 0;
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
    const gap = WALL_INNER_RADIUS - Math.hypot(xs[i] ?? 0, zs[i] ?? 0);
    if (gap < best) best = gap;
  }
  return best;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}
