import { CatmullRomCurve3, Vector3 } from 'three';
import {
  BUILDING_CENTRE_X,
  BUILDING_CENTRE_Z,
  BUILDING_HALF_X,
  BUILDING_HALF_Z,
  GARDEN_HALF_SIZE,
} from '../../core/constants';
import { ANCHORS_BY_ID } from '../anchors';
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

/** Where the profile settles when nothing is pushing it outwards. */
const NOMINAL_RADIUS = 48;

/** Inner face of the pink boundary wall (see `Garden.buildBoundaryWall`). */
const WALL_INNER_RADIUS = GARDEN_HALF_SIZE - 2 - 0.45;

/** Relaxation: passes, smoothing weight, and the pull towards the nominal. */
const RELAX_PASSES = 700;
const SMOOTHING = 0.35;
const PULL = 0.003;

/**
 * Beyond this radius the collision probe is skipped.
 *
 * Two reasons, and both matter. `Scenery` plants nothing past r = 55, so there
 * is nothing out there to dodge; and `CollisionWorld.resolve` also applies the
 * `GARDEN_PLAY_RADIUS` clamp, which would drag the wall-hugging sections back in
 * and undo the only part of the route that has no slack.
 */
const PROBE_LIMIT = 56;

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

  let radii = new Float64Array(BEARINGS);
  for (let i = 0; i < BEARINGS; i += 1) {
    radii[i] = clamp(NOMINAL_RADIUS, lower[i] ?? 0, upper[i] ?? NOMINAL_RADIUS);
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
      let radius = here + SMOOTHING * (before + after - 2 * here) + PULL * (NOMINAL_RADIUS - here);

      const angle = (i / BEARINGS) * Math.PI * 2;
      const dirX = Math.cos(angle);
      const dirZ = Math.sin(angle);
      radius = repair(radius, dirX, dirZ, rects, circles);

      next[i] = clamp(radius, lower[i] ?? 0, upper[i] ?? radius);
    }
    radii = next;
  }

  nudgeOffScenery(radii, collision);
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
function nudgeOffScenery(radii: Float64Array, collision: CollisionWorld): void {
  const probe = new Vector3();

  for (let round = 0; round < 24; round += 1) {
    let moved = false;

    for (let i = 0; i < BEARINGS; i += 1) {
      const radius = radii[i] ?? 0;
      if (radius >= PROBE_LIMIT) continue;

      const angle = (i / BEARINGS) * Math.PI * 2;
      const dirX = Math.cos(angle);
      const dirZ = Math.sin(angle);
      const x = dirX * radius;
      const z = dirZ * radius;

      probe.set(x, 0, z);
      collision.resolve(probe, TRACK_CLEARANCE);
      const pushX = probe.x - x;
      const pushZ = probe.z - z;
      if (pushX * pushX + pushZ * pushZ < 1e-6) continue;

      // Only the radial component is available to us: the loop is a radius per
      // bearing, so sideways is not a direction it can move in. A push that is
      // almost entirely sideways still gets a shove outwards, which on the next
      // round becomes a radial one.
      const radial = pushX * dirX + pushZ * dirZ;
      radii[i] = radius + (Math.abs(radial) > 0.05 ? radial : Math.hypot(pushX, pushZ));
      moved = true;
    }

    if (!moved) break;

    for (let smooth = 0; smooth < 2; smooth += 1) {
      const before = Float64Array.from(radii);
      for (let i = 0; i < BEARINGS; i += 1) {
        const a = before[(i - 1 + BEARINGS) % BEARINGS] ?? 0;
        const b = before[i] ?? 0;
        const c = before[(i + 1) % BEARINGS] ?? 0;
        radii[i] = b + 0.3 * (a + c - 2 * b);
      }
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
