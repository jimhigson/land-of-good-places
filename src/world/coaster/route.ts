import { CatmullRomCurve3, Vector3 } from 'three';
import { Rng, TAU } from '../../core/mathUtils';
import { PARK_SEED } from '../parkManifest';
import { PARK_LAYOUT, placedEntry } from '../parkLayout';
import { terrainHeight } from '../terrain';
import { circleBoundary } from '../rail/boundary';
import { type RouteBrief, type SolvedRailRoute, solveRailRoute } from '../rail/generate';
import { type Pose2, type SegmentKind, type Vec2, turnVocabulary } from '../rail/segments';

/**
 * The coaster's track — grown, not authored (Decision 4 C4 on Decision 5's
 * generated park).
 *
 * A closed loop in the park's middle, elevated so it flies over lawns, paths,
 * stalls and the train, and steered *horizontally* around the two things too
 * tall to fly over — the castle and the ferris wheel. The height profile is
 * seeded hills over a cruise floor, with a dip to boarding height at the
 * station, which sits beside the old rail racer stall: that booth is now the
 * way onto the real ride.
 *
 * Everything here is solved from the layout, so moving the manifest re-grows
 * the coaster along with everything else.
 *
 * ### The horizontal solve moved out (issue #112)
 *
 * The loop used to be a **radius per bearing** — 240 spokes about the origin,
 * relaxed until none of them landed in the castle. That representation had two
 * problems, and the second one shipped a visible bug.
 *
 * It could only express star-shaped loops. A track that doubles back, or runs
 * beside itself, or leaves the middle of the park at all, is not a function of
 * bearing and could not be said.
 *
 * Worse, the relaxation **smoothed the radii after pushing them out of the
 * obstacles, and never re-measured** (the old lines 139-143). Smoothing a spoke
 * that had just been pushed clear of the castle pulled it back in, and nothing
 * downstream checked: the horizontal side had no equivalent of the vertical
 * pipeline's measure-the-finished-curve repair loop, and no test measured
 * castle clearance at all. That is issue #113 — the cruiser has been clipping
 * the castle in plain sight.
 *
 * Now the plan-view shape comes from `rail/generate.ts`, which lays pieces of
 * track end to end and **rejects a piece that hits something** rather than
 * placing it and smoothing afterwards. There is no post-hoc smoothing step to
 * undo the avoidance, because avoidance is a precondition of a piece existing.
 *
 * ### What stayed
 *
 * The vertical pipeline, which was always the well-tested half: cruise floor,
 * seeded hills, the station carve, and the repair loop that measures the built
 * curve and lifts control points under any sag. It is unchanged in substance,
 * but it is now authored **along arc length** instead of along bearing. That
 * deletes a whole class of bug rather than fixing one: the carve used to have
 * to convert a bearing window into metres at an assumed radius, and got it
 * wrong for a station pulled further out. Arc length is already metres.
 */

/** Cruise floor: above trees (~4 m), garlands (≤5.2 m) and the train (2.6 m). */
export const CRUISE_FLOOR = 6.2;

/** Boarding height at the station, and the flat length either side. */
export const STATION_HEIGHT = 1.1;
const STATION_FLAT = 9;
const STATION_RAMP = 26;

/**
 * How far out the loop may reach.
 *
 * The train owns the 48-58 m band and the Rail Race rings the park at 53.5 m,
 * so the coaster's centre line stops well short of both. The generator keeps a
 * corridor's width inside this, so the track edge lands at about the 43 m the
 * old polar band clamped to.
 */
const OUTER_RADIUS = 47;

/** Half-width kept clear either side of the centre line. */
const CORRIDOR_RADIUS = 3;

/** How close the loop may come to an earlier part of itself. */
const SELF_CLEARANCE = 7;

/**
 * Tightest turn the ride will make.
 *
 * The old polar solve produced a **1.7 m** minimum radius — a hairpin, at
 * cruise speed, measured on the built curve by `scripts/measure-rail-radii.mts`.
 * Nothing asserted it because nothing measured it. Twelve metres is a turn a
 * six-year-old enjoys rather than one that throws them at the restraint, and
 * it keeps the family's "Sky Cruiser is the tightest of the three" ordering
 * comfortably (the Rail Race ring is 57 m).
 */
const MIN_TURN_RADIUS = 12;

/** Metres of track wanted. The old loop came out at 221 m; this holds that. */
const DESIRED_LENGTH = 220;

/** Roughly this far apart, in metres, along the loop. */
const CONTROL_SPACING = 3;

interface TallObstacle {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/**
 * The two things the coaster cannot fly over.
 *
 * Unlike the old code, the track's own width is *not* baked in here — the
 * generator is told the corridor radius separately, so an obstacle stays an
 * obstacle and a corridor stays a corridor. The sum is the same 22 m about the
 * castle it always was.
 */
function tallObstacles(): TallObstacle[] {
  const castle = placedEntry('building');
  const wheel = placedEntry('ferrisWheel');
  return [
    { x: castle.x, z: castle.z, radius: castle.boundingRadius },
    { x: wheel.x, z: wheel.z, radius: wheel.boundingRadius },
  ];
}

/** Is the ground at (x, z) free of every plot? Layout only, no scene. */
function groundClearOfPlots(x: number, z: number, radius: number, exceptId?: string): boolean {
  for (const entry of PARK_LAYOUT.entries.values()) {
    // A station's own booth is the thing it is parked next to, not something
    // to keep away from; the ring the candidate sits on is what keeps the
    // track out of the booth itself.
    if (entry.id === exceptId) continue;
    if (Math.hypot(x - entry.x, z - entry.z) < entry.boundingRadius + radius) return false;
  }
  return true;
}

/** The pieces the Sky Cruiser is built from. `MIN_TURN_RADIUS` lives here. */
const CRUISER_VOCABULARY: readonly SegmentKind[] = turnVocabulary(
  [
    { name: 'tight', minRadius: MIN_TURN_RADIUS, maxRadius: 18, minLength: 14, maxLength: 24 },
    { name: 'sweep', minRadius: 18, maxRadius: 30, minLength: 18, maxLength: 30 },
    { name: 'easy', minRadius: 30, maxRadius: 55, minLength: 20, maxLength: 34 },
  ],
  { minLength: 16, maxLength: 28 },
);

export interface CoasterRouteOptions {
  /** Seed salt, so two coasters in one park grow different loops. */
  readonly salt: number;
  /** The stall whose booth is this ride's station. */
  readonly stationStallId: string;
  /** How far out the loop may reach. Defaults to {@link OUTER_RADIUS}. */
  readonly outerRadius?: number;
  /** Metres of track wanted. Defaults to {@link DESIRED_LENGTH}. */
  readonly desiredLength?: number;
  /**
   * Another coaster to keep clear of.
   *
   * This is now a term in the generator's collision predicate rather than a
   * push applied during a relaxation, which means a piece that would run too
   * close to the other loop is simply never placed. The old comment here
   * claimed `checkCoasterClearances` asserted the gap afterwards; it never did.
   */
  readonly avoid?: CoasterRoute | null;
}

/**
 * Candidate stations, best first.
 *
 * The station is where the loop **starts and ends**, so choosing it is the
 * outermost level of the generator's search: when no loop can be grown from
 * one station, the next is tried. `train/plan.ts` does the same thing when
 * `clearStationDistance` slides a station along the track until its platform
 * stands on clear ground — a station's position is a thing to search for, not
 * a thing to assume.
 *
 * A candidate only qualifies if the **ground through the station window is
 * clear**. Everywhere else the coaster flies at `CRUISE_FLOOR` and only the two
 * tall obstacles matter, but at the station it is down at 1.1 m, in among the
 * scenery, where every plot is in its way. Putting that constraint on the start
 * pose keeps the plan-view search itself simple and purely horizontal.
 */
function stationPoses(stallId: string, rng: Rng, boundary: ReturnType<typeof circleBoundary>): Pose2[] {
  const stall = placedEntry(stallId);
  const poses: { pose: Pose2; key: number }[] = [];
  // Beside the booth, not a walk away from it: the old solve put the track
  // about 4.5 m out from the stall, and a station much further than that stops
  // reading as the thing the booth boards. It also has to stay inside the
  // loop's own outer limit, and the cruiser's stall is already 34 m from the
  // middle of the park, so there is not much room to spare on the outward side.
  //
  // Offering plenty of candidates is not generosity, it is the thing that makes
  // this solve at all: a first cut offered six and the search failed on every
  // one. Each is cheap to propose and the search abandons a bad one quickly.
  for (let ring = 0; ring < 8; ring += 1) {
    const distance = 5 + ring;
    for (let i = 0; i < 48; i += 1) {
      const angle = (i / 48) * TAU;
      const x = stall.x + Math.cos(angle) * distance;
      const z = stall.z + Math.sin(angle) * distance;
      // Two headings per spot: the track may run past the booth either way.
      for (const sign of [1, -1] as const) {
        const hx = -Math.sin(angle) * sign;
        const hz = Math.cos(angle) * sign;
        const pose: Pose2 = { x, z, hx, hz };
        if (stationWindowIsClear(pose, boundary, stallId)) poses.push({ pose, key: rng.unit() });
      }
    }
  }
  // Seeded order, so a different salt prefers a different station and the
  // search is still deterministic.
  poses.sort((a, b) => a.key - b.key);
  return poses.map((entry) => entry.pose);
}

/**
 * Is the low, flat run through a candidate station on clear ground?
 *
 * Checked along the pose's heading in both directions: the loop leaves the
 * station along that heading and — because closure matches the tangent —
 * arrives along it too, so a straight line is a fair stand-in for the track
 * either side of the platform.
 */
function stationWindowIsClear(
  pose: Pose2,
  boundary: ReturnType<typeof circleBoundary>,
  ownStallId: string,
): boolean {
  // The boarding flat, plus a little of the ramp either side. Not the whole
  // ramp: by the far end of it the track is already climbing clear of the
  // scenery, and demanding 26 m of empty ground each way rejects every station
  // this park can actually offer.
  const reach = STATION_FLAT + 2;
  for (let along = -reach; along <= reach; along += 2) {
    const x = pose.x + pose.hx * along;
    const z = pose.z + pose.hz * along;
    if (!groundClearOfPlots(x, z, CORRIDOR_RADIUS - 1.5, ownStallId)) return false;
    if (boundary.distanceToEdge(x, z) < CORRIDOR_RADIUS) return false;
  }
  return true;
}

export class CoasterRoute {
  readonly curve: CatmullRomCurve3;
  readonly length: number;
  /** Metres along the loop of the station's centre. */
  readonly stationDistance: number;
  /** Highest crest height above ground, for the chain-lift feel. */
  readonly crestY: number;
  /** The solved plan-view centre line, kept for diagnostics and the asserts. */
  readonly plan: SolvedRailRoute;

  private readonly scratch = new Vector3();

  constructor(options: CoasterRouteOptions) {
    const rng = new Rng(PARK_SEED ^ options.salt);
    const stall = placedEntry(options.stationStallId);
    const obstacles = tallObstacles();
    const other = options.avoid ?? null;
    const boundary = circleBoundary(options.outerRadius ?? OUTER_RADIUS);

    // --- horizontal: the generator solves the plan view --------------------
    const brief: RouteBrief = {
      // A stream of its own, so changing how many random draws the height
      // profile takes cannot silently reshape the loop.
      seed: PARK_SEED ^ options.salt ^ 0x5a17,
      vocabulary: CRUISER_VOCABULARY,
      desiredLength: options.desiredLength ?? DESIRED_LENGTH,
      closed: true,
      startPoses: stationPoses(options.stationStallId, rng, boundary),
      clear: (x, z, radius) => {
        for (const tall of obstacles) {
          if (Math.hypot(x - tall.x, z - tall.z) < tall.radius + radius) return false;
        }
        if (other) {
          const nearest = other.nearestPoint(x, z);
          if (Math.hypot(nearest.x - x, nearest.z - z) < 5 + radius) return false;
        }
        return true;
      },
      boundary,
      corridorRadius: CORRIDOR_RADIUS,
      selfClearance: SELF_CLEARANCE,
      minRadius: MIN_TURN_RADIUS,
      budgets: { perJoint: 16, restarts: 90 },
    };
    const plan = solveRailRoute(brief);
    this.plan = plan;

    const controls = Math.max(24, Math.round(plan.length / CONTROL_SPACING));
    const flat: Vec2[] = [];
    const probe2: Vec2 = { x: 0, z: 0 };
    for (let i = 0; i < controls; i += 1) {
      plan.pointAt((i / controls) * plan.length, probe2);
      flat.push({ x: probe2.x, z: probe2.z });
    }

    // Where along the plan the station sits — measured, not assumed to be zero,
    // even though the loop starts there.
    let stationS = 0;
    let bestToStall = Infinity;
    for (let d = 0; d < plan.length; d += 1) {
      plan.pointAt(d, probe2);
      const toStall = Math.hypot(probe2.x - stall.x, probe2.z - stall.z);
      if (toStall < bestToStall) {
        bestToStall = toStall;
        stationS = d;
      }
    }

    // --- vertical: seeded hills over the cruise floor ----------------------
    // Authored along **arc length**, in metres. Integer harmonics of the loop
    // fraction, so the profile closes seamlessly where the loop meets itself —
    // a fractional harmonic would leave a step at the join that the swept rail
    // would have to smooth over and the physics would feel as a kink.
    const heights = new Float64Array(controls);
    const hillPhase = rng.range(0, TAU);
    for (let i = 0; i < controls; i += 1) {
      const angle = (i / controls) * TAU;
      const hills =
        Math.max(0, Math.sin(angle * 3 + hillPhase)) * 3.4 +
        Math.max(0, Math.sin(angle * 5 + hillPhase * 1.7)) * 1.4;
      heights[i] = CRUISE_FLOOR + hills;
    }
    // The station carve. No bearing-to-metres conversion any more: `along` is
    // already the metres of track between this control and the platform.
    for (let i = 0; i < controls; i += 1) {
      const s = (i / controls) * plan.length;
      const raw = Math.abs(s - stationS);
      const along = Math.min(raw, plan.length - raw);
      if (along < STATION_FLAT) heights[i] = STATION_HEIGHT;
      else if (along < STATION_FLAT + STATION_RAMP) {
        const t = (along - STATION_FLAT) / STATION_RAMP;
        const eased = t * t * (3 - 2 * t);
        heights[i] = STATION_HEIGHT + (heights[i]! - STATION_HEIGHT) * eased;
      }
    }

    const makeCurve = (): CatmullRomCurve3 => {
      const points: Vector3[] = [];
      for (let i = 0; i < controls; i += 1) {
        const spot = flat[i]!;
        points.push(
          new Vector3(spot.x, terrainHeight(spot.x, spot.z) + (heights[i] ?? CRUISE_FLOOR), spot.z),
        );
      }
      const curve = new CatmullRomCurve3(points, true, 'catmullrom', 0.5);
      curve.arcLengthDivisions = 1600;
      return curve;
    };

    const stationOn = (curve: CatmullRomCurve3, length: number): number => {
      let best = 0;
      let bestDistance = Infinity;
      const probe = new Vector3();
      for (let d = 0; d < length; d += 1) {
        curve.getPointAt(d / length, probe);
        const toStall = Math.hypot(probe.x - stall.x, probe.z - stall.z);
        if (toStall < bestDistance) {
          bestDistance = toStall;
          best = d;
        }
      }
      return best;
    };

    // --- vertical repair: measure the finished curve, not the plan ---------
    // Control-point heights are claims; between them the spline interpolates
    // while the terrain does what it likes, so a rise between two samples can
    // eat the cruise floor. Scan exactly the way the boot assert will (but with
    // a slightly narrower station exemption, so everything the assert measures
    // is either exempt or repaired), raise the control points under any
    // deficit, and re-measure until the track really clears.
    let curve = makeCurve();
    let length = curve.getLength();
    let station = stationOn(curve, length);
    const probe = new Vector3();
    for (let pass = 0; pass < 10; pass += 1) {
      // Worst deficit per control point, so a run of low samples under one
      // control raises it once by what it needs, not once per sample. The same
      // sweep records how close to the station each control's track actually
      // runs — measured on the curve, because a control's own nominal position
      // along the loop drifts once height is added to it.
      const lifts = new Map<number, number>();
      const ownsStationTrack = new Map<number, number>();
      for (let d = 0; d < length; d += 2) {
        curve.getPointAt(d / length, probe);
        const toStation = Math.min(Math.abs(d - station), length - Math.abs(d - station));
        const control = Math.round((d / length) * controls) % controls;
        ownsStationTrack.set(
          control,
          Math.min(ownsStationTrack.get(control) ?? Infinity, toStation),
        );
        if (toStation < STATION_FLAT + STATION_RAMP) continue;
        const above = probe.y - terrainHeight(probe.x, probe.z);
        if (above >= CRUISE_FLOOR) continue;
        const lift = CRUISE_FLOOR - above + 0.4;
        lifts.set(control, Math.max(lifts.get(control) ?? 0, lift));
      }
      // Never lift a control that owns boarding-flat or early-ramp track — a
      // half-lift bleeding onto the platform would tilt it. Mid-ramp and beyond
      // is fair game: steepening the ramp's tail is exactly how a sag just past
      // the window gets fixed.
      const liftable = (index: number): boolean =>
        (ownsStationTrack.get(index) ?? Infinity) > STATION_FLAT + STATION_RAMP * 0.65;
      for (const [control, lift] of lifts) {
        if (liftable(control)) heights[control] = (heights[control] ?? CRUISE_FLOOR) + lift;
        for (const side of [-1, 1]) {
          const neighbour = (control + side + controls) % controls;
          if (liftable(neighbour))
            heights[neighbour] = (heights[neighbour] ?? CRUISE_FLOOR) + lift * 0.5;
        }
      }
      if (lifts.size === 0) break;
      curve = makeCurve();
      length = curve.getLength();
      station = stationOn(curve, length);
    }

    this.curve = curve;
    this.length = length;
    this.stationDistance = station;

    let crest = 0;
    for (let d = 0; d < length; d += 1) {
      curve.getPointAt(d / length, probe);
      const above = probe.y - terrainHeight(probe.x, probe.z);
      if (above > crest) crest = above;
    }
    this.crestY = crest;
  }

  pointAt(distance: number, target = this.scratch): Vector3 {
    return this.curve.getPointAt(this.wrap(distance) / this.length, target);
  }

  tangentAt(distance: number, target = new Vector3()): Vector3 {
    return this.curve.getTangentAt(this.wrap(distance) / this.length, target).normalize();
  }

  wrap(distance: number): number {
    let value = distance % this.length;
    if (value < 0) value += this.length;
    return value;
  }

  /** Height above the ground directly below `distance` along the loop. */
  clearanceAt(distance: number): number {
    const point = this.pointAt(distance, new Vector3());
    return point.y - terrainHeight(point.x, point.z);
  }

  /** Nearest point on this loop to (x, z), for the other coaster's solve. */
  nearestPoint(x: number, z: number): Vector3 {
    const probe = new Vector3();
    const best = new Vector3();
    let bestDistance = Infinity;
    for (let d = 0; d < this.length; d += 2) {
      this.pointAt(d, probe);
      const gap = Math.hypot(probe.x - x, probe.z - z);
      if (gap < bestDistance) {
        bestDistance = gap;
        best.copy(probe);
      }
    }
    return best;
  }
}

/**
 * Boot assert (the claim-versus-fact rule): cruise really clears, the station
 * segment really is low and on clear ground, the loop really goes round the
 * castle and the ferris wheel rather than through them, and everywhere the
 * coaster passes over the train there is 5.5 m of air.
 *
 * Reports; the caller decides what to do about it. Never adjusts.
 *
 * The castle and wheel checks are new (issue #113). Their absence is the whole
 * reason the cruiser could clip the castle for weeks with a green build: the
 * avoidance lived in the solver and *nothing measured the finished curve*. The
 * horizontal gap is now measured the same way the vertical one always was.
 */
export function checkCoasterClearances(
  route: CoasterRoute,
  trainPointNear: (x: number, z: number) => { y: number; distance: number },
): string[] {
  const complaints: string[] = [];
  const point = new Vector3();
  const obstacles = tallObstacles();
  const worst = new Map<string, number>();
  for (let d = 0; d < route.length; d += 2) {
    route.pointAt(d, point);
    const above = point.y - terrainHeight(point.x, point.z);
    const nearStation =
      Math.min(
        Math.abs(d - route.stationDistance),
        route.length - Math.abs(d - route.stationDistance),
      ) <
      STATION_FLAT + STATION_RAMP + 4;
    if (!nearStation && above < CRUISE_FLOOR - 1.2) {
      complaints.push(
        `coaster at ${d.toFixed(0)} m is only ${above.toFixed(1)} m above ground outside the station window`,
      );
    }
    const train = trainPointNear(point.x, point.z);
    if (train.distance < 3 && point.y - train.y < 5.5) {
      complaints.push(
        `coaster crosses the train with ${(point.y - train.y).toFixed(1)} m of air at (${point.x.toFixed(0)}, ${point.z.toFixed(0)}) — Decision 4 wants 5.5`,
      );
    }
    // The two things it cannot fly over. Recorded as a worst-case per obstacle
    // rather than one complaint per sample, so a loop that does clip says so
    // once, with the number, instead of a hundred times.
    for (let i = 0; i < obstacles.length; i += 1) {
      const tall = obstacles[i]!;
      const gap = Math.hypot(point.x - tall.x, point.z - tall.z) - tall.radius;
      const key = i === 0 ? 'the castle' : 'the ferris wheel';
      worst.set(key, Math.min(worst.get(key) ?? Infinity, gap));
    }
  }
  for (const [what, gap] of worst) {
    if (gap < CORRIDOR_RADIUS) {
      complaints.push(
        `coaster passes ${gap.toFixed(1)} m from ${what} — the track is ${CORRIDOR_RADIUS} m wide, so it clips`,
      );
    }
  }
  return complaints;
}
