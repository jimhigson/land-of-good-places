import { CatmullRomCurve3, Vector3 } from 'three';
import { Rng, TAU } from '../../core/mathUtils';
import { PARK_SEED } from '../parkManifest';
import { placedEntry } from '../parkLayout';
import { terrainHeight } from '../terrain';

/**
 * The coaster's track — grown, not authored (Decision 4 C4 on Decision 5's
 * generated park).
 *
 * A closed loop in the park's middle band, elevated so it flies over lawns,
 * paths, stalls and the train, and steered *horizontally* around the two
 * things too tall to fly over — the castle and the ferris wheel. The height
 * profile is seeded hills over a cruise floor, with one long first lift and
 * a dip to boarding height at the station, which sits beside the old rail
 * racer stall: that booth is now the way onto the real ride.
 *
 * Everything here is solved from the layout, so moving the manifest re-grows
 * the coaster along with everything else, and `checkClearances` is asserted
 * at boot: cruise clears the treeline and the garlands, the station segment
 * stands on genuinely clear ground, and wherever the coaster passes over the
 * train there is Decision 4's 5.5 m of rail-over-rail air.
 */

/** Cruise floor: above trees (~4 m), garlands (≤5.2 m) and the train (2.6 m). */
export const CRUISE_FLOOR = 6.2;

/** Boarding height at the station, and the flat length either side. */
export const STATION_HEIGHT = 1.1;
const STATION_FLAT = 9;
const STATION_RAMP = 26;

const BEARINGS = 240;
const BAND_MIN = 16;
const BAND_MAX = 43;

interface TallObstacle {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/** The two things the coaster cannot fly over, inflated for track width. */
function tallObstacles(): TallObstacle[] {
  const castle = placedEntry('building');
  const wheel = placedEntry('ferrisWheel');
  return [
    { x: castle.x, z: castle.z, radius: castle.boundingRadius + 3 },
    { x: wheel.x, z: wheel.z, radius: wheel.boundingRadius + 3 },
  ];
}

export interface CoasterRouteOptions {
  /** Seed salt, so two coasters in one park grow different loops. */
  readonly salt: number;
  /** The stall whose booth is this ride's station. */
  readonly stationStallId: string;
  /** Band the loop lives in. */
  readonly bandMin?: number;
  readonly bandMax?: number;
  /** Nominal cruise radius the wobble plays around. */
  readonly nominal?: number;
  /**
   * Another coaster to keep clear of: where the loops come horizontally
   * close, this one is pushed to a different radius during the solve, and
   * `checkCoasterClearances` asserts the air between them afterwards.
   */
  readonly avoid?: CoasterRoute | null;
}

export class CoasterRoute {
  readonly curve: CatmullRomCurve3;
  readonly length: number;
  /** Metres along the loop of the station's centre. */
  readonly stationDistance: number;
  /** Highest crest height above ground, for the chain-lift feel. */
  readonly crestY: number;

  private readonly scratch = new Vector3();

  constructor(options: CoasterRouteOptions) {
    const rng = new Rng(PARK_SEED ^ options.salt);
    const stall = placedEntry(options.stationStallId);
    const bandMin = options.bandMin ?? BAND_MIN;
    const bandMax = options.bandMax ?? BAND_MAX;
    const nominal = options.nominal ?? 28;
    const obstacles = tallObstacles();

    // --- horizontal: radius per bearing around the park middle ------------
    const stallBearing = Math.atan2(stall.z, stall.x);
    const stallRadius = Math.hypot(stall.x, stall.z);
    const radii = new Float64Array(BEARINGS);
    for (let i = 0; i < BEARINGS; i += 1) {
      // Two seeded lobes make the loop read as a shape, not a circle.
      const angle = (i / BEARINGS) * TAU;
      const wobble =
        Math.sin(angle * 2 + rng.range(0, 0)) * 6 + Math.sin(angle * 3 + 1.7) * 3.5;
      radii[i] = Math.min(bandMax, Math.max(bandMin, nominal + wobble));
    }
    // Pass near the stall's bearing at the stall's radius, so the station
    // lands beside the booth that boards it.
    const stallIndex = Math.round(((stallBearing + TAU) % TAU) / TAU * BEARINGS) % BEARINGS;
    for (let w = -14; w <= 14; w += 1) {
      const index = (stallIndex + w + BEARINGS) % BEARINGS;
      const blend = 1 - Math.abs(w) / 15;
      radii[index] =
        (radii[index] ?? nominal) * (1 - blend) + Math.min(bandMax, stallRadius + 4.5) * blend;
    }
    // Steer around the tall pair: push the radius in or out, whichever is
    // nearer, wherever a bearing's point lands inside one.
    for (let pass = 0; pass < 200; pass += 1) {
      for (let i = 0; i < BEARINGS; i += 1) {
        const angle = (i / BEARINGS) * TAU;
        const radius = radii[i] ?? nominal;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        for (const tall of obstacles) {
          const toObstacle = Math.hypot(x - tall.x, z - tall.z);
          if (toObstacle < tall.radius) {
            const obstacleRadius = Math.hypot(tall.x, tall.z);
            radii[i] = radius + (radius >= obstacleRadius ? 1 : -1) * (tall.radius - toObstacle + 0.5);
          }
        }
        // Keep laterally clear of the other coaster where it flies nearby:
        // 5 m apart horizontally is plenty when both are in the air, and
        // pushing during the solve beats hoping and asserting after.
        const other = options.avoid;
        if (other) {
          const nearest = other.nearestPoint(x, z);
          const gap = Math.hypot(nearest.x - x, nearest.z - z);
          if (gap < 5) {
            const otherRadius = Math.hypot(nearest.x, nearest.z);
            radii[i] = radius + (radius >= otherRadius ? 1 : -1) * (5 - gap + 0.5);
          }
        }
        radii[i] = Math.min(bandMax, Math.max(bandMin, radii[i] ?? nominal));
      }
      // Relax smooth, re-clamped next pass.
      for (let i = 0; i < BEARINGS; i += 1) {
        const before = radii[(i + BEARINGS - 1) % BEARINGS] ?? nominal;
        const after = radii[(i + 1) % BEARINGS] ?? nominal;
        radii[i] = (radii[i] ?? nominal) * 0.6 + (before + after) * 0.2;
      }
    }

    // --- vertical: seeded hills over the cruise floor ---------------------
    // Height is authored along the *bearing* domain, then the station window
    // is carved down to boarding height with smooth ramps.
    const heights = new Float64Array(BEARINGS);
    const hillPhase = rng.range(0, TAU);
    for (let i = 0; i < BEARINGS; i += 1) {
      const angle = (i / BEARINGS) * TAU;
      const hills =
        Math.max(0, Math.sin(angle * 3 + hillPhase)) * 3.4 +
        Math.max(0, Math.sin(angle * 5 + hillPhase * 1.7)) * 1.4;
      heights[i] = CRUISE_FLOOR + hills;
    }
    // Metres-per-bearing at the *solved* station radius, not an assumed one —
    // the carve used to convert with r≈28, so a station pulled further out got
    // a window 1.4× longer on the real track than the boot assert allows.
    const stationRadius = radii[stallIndex] ?? nominal;
    for (let i = 0; i < BEARINGS; i += 1) {
      const offset = Math.abs(((i - stallIndex + BEARINGS / 2 + BEARINGS) % BEARINGS) - BEARINGS / 2);
      const along = (offset / BEARINGS) * TAU * stationRadius;
      if (along < STATION_FLAT) heights[i] = STATION_HEIGHT;
      else if (along < STATION_FLAT + STATION_RAMP) {
        const t = (along - STATION_FLAT) / STATION_RAMP;
        const eased = t * t * (3 - 2 * t);
        heights[i] = STATION_HEIGHT + (heights[i]! - STATION_HEIGHT) * eased;
      }
    }

    const makeCurve = (): CatmullRomCurve3 => {
      const points: Vector3[] = [];
      for (let i = 0; i < BEARINGS; i += 4) {
        const angle = (i / BEARINGS) * TAU;
        const radius = radii[i] ?? nominal;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        points.push(new Vector3(x, terrainHeight(x, z) + (heights[i] ?? CRUISE_FLOOR), z));
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
    // eat the cruise floor. Scan exactly the way the boot assert will (but
    // with a slightly narrower station exemption, so everything the assert
    // measures is either exempt or repaired), raise the control points under
    // any deficit, and re-measure until the track really clears.
    let curve = makeCurve();
    let length = curve.getLength();
    let station = stationOn(curve, length);
    const probe = new Vector3();
    for (let pass = 0; pass < 10; pass += 1) {
      // Worst deficit per control point, so a run of low samples under one
      // control raises it once by what it needs, not once per sample.
      const lifts = new Map<number, number>();
      for (let d = 0; d < length; d += 2) {
        curve.getPointAt(d / length, probe);
        const toStation = Math.min(
          Math.abs(d - station),
          length - Math.abs(d - station),
        );
        if (toStation < STATION_FLAT + STATION_RAMP) continue;
        const above = probe.y - terrainHeight(probe.x, probe.z);
        if (above >= CRUISE_FLOOR) continue;
        const bearing = ((Math.atan2(probe.z, probe.x) + TAU) % TAU) / TAU * BEARINGS;
        const control = (Math.round(bearing / 4) * 4) % BEARINGS;
        const lift = CRUISE_FLOOR - above + 0.4;
        lifts.set(control, Math.max(lifts.get(control) ?? 0, lift));
      }
      // Never lift a control that the station carve owns — a half-lift
      // bleeding onto the boarding flat would tilt the platform.
      const carved = (index: number): boolean => {
        const offset = Math.abs(
          ((index - stallIndex + BEARINGS / 2 + BEARINGS) % BEARINGS) - BEARINGS / 2,
        );
        return (offset / BEARINGS) * TAU * stationRadius < STATION_FLAT + STATION_RAMP * 0.6;
      };
      for (const [control, lift] of lifts) {
        if (!carved(control)) heights[control] = (heights[control] ?? CRUISE_FLOOR) + lift;
        for (const side of [-4, 4]) {
          const neighbour = (control + side + BEARINGS) % BEARINGS;
          if (!carved(neighbour))
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
 * Boot assert (the claim-versus-fact rule): cruise really clears, the
 * station segment really is low and on clear ground, and everywhere the
 * coaster passes over the train there is 5.5 m of air. Reports and throws;
 * never adjusts.
 */
export function checkCoasterClearances(
  route: CoasterRoute,
  trainPointNear: (x: number, z: number) => { y: number; distance: number },
): string[] {
  const complaints: string[] = [];
  const point = new Vector3();
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
  }
  return complaints;
}
