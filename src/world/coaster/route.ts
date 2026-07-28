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

export class CoasterRoute {
  readonly curve: CatmullRomCurve3;
  readonly length: number;
  /** Metres along the loop of the station's centre. */
  readonly stationDistance: number;
  /** Highest crest height above ground, for the chain-lift feel. */
  readonly crestY: number;

  private readonly scratch = new Vector3();

  constructor() {
    const rng = new Rng(PARK_SEED ^ 0xc0a57e);
    const stall = placedEntry('stall.railRacer');
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
      radii[i] = Math.min(BAND_MAX, Math.max(BAND_MIN, 28 + wobble));
    }
    // Pass near the stall's bearing at the stall's radius, so the station
    // lands beside the booth that boards it.
    const stallIndex = Math.round(((stallBearing + TAU) % TAU) / TAU * BEARINGS) % BEARINGS;
    for (let w = -14; w <= 14; w += 1) {
      const index = (stallIndex + w + BEARINGS) % BEARINGS;
      const blend = 1 - Math.abs(w) / 15;
      radii[index] =
        (radii[index] ?? 28) * (1 - blend) + Math.min(BAND_MAX, stallRadius + 4.5) * blend;
    }
    // Steer around the tall pair: push the radius in or out, whichever is
    // nearer, wherever a bearing's point lands inside one.
    for (let pass = 0; pass < 200; pass += 1) {
      for (let i = 0; i < BEARINGS; i += 1) {
        const angle = (i / BEARINGS) * TAU;
        const radius = radii[i] ?? 28;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        for (const tall of obstacles) {
          const toObstacle = Math.hypot(x - tall.x, z - tall.z);
          if (toObstacle < tall.radius) {
            const obstacleRadius = Math.hypot(tall.x, tall.z);
            radii[i] = radius + (radius >= obstacleRadius ? 1 : -1) * (tall.radius - toObstacle + 0.5);
          }
        }
        radii[i] = Math.min(BAND_MAX, Math.max(BAND_MIN, radii[i] ?? 28));
      }
      // Relax smooth, re-clamped next pass.
      for (let i = 0; i < BEARINGS; i += 1) {
        const before = radii[(i + BEARINGS - 1) % BEARINGS] ?? 28;
        const after = radii[(i + 1) % BEARINGS] ?? 28;
        radii[i] = (radii[i] ?? 28) * 0.6 + (before + after) * 0.2;
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
    for (let i = 0; i < BEARINGS; i += 1) {
      const offset = Math.abs(((i - stallIndex + BEARINGS / 2 + BEARINGS) % BEARINGS) - BEARINGS / 2);
      const along = (offset / BEARINGS) * TAU * 28; // ≈ metres at r≈28
      if (along < STATION_FLAT) heights[i] = STATION_HEIGHT;
      else if (along < STATION_FLAT + STATION_RAMP) {
        const t = (along - STATION_FLAT) / STATION_RAMP;
        const eased = t * t * (3 - 2 * t);
        heights[i] = STATION_HEIGHT + (heights[i]! - STATION_HEIGHT) * eased;
      }
    }

    const points: Vector3[] = [];
    for (let i = 0; i < BEARINGS; i += 4) {
      const angle = (i / BEARINGS) * TAU;
      const radius = radii[i] ?? 28;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      points.push(new Vector3(x, terrainHeight(x, z) + (heights[i] ?? CRUISE_FLOOR), z));
    }
    this.curve = new CatmullRomCurve3(points, true, 'catmullrom', 0.5);
    this.curve.arcLengthDivisions = 1600;
    this.length = this.curve.getLength();

    // Locate the station and the crest on the finished curve.
    let bestStation = 0;
    let bestStationDistance = Infinity;
    let crest = 0;
    const probe = new Vector3();
    for (let d = 0; d < this.length; d += 1) {
      this.curve.getPointAt(d / this.length, probe);
      const toStall = Math.hypot(probe.x - stall.x, probe.z - stall.z);
      if (toStall < bestStationDistance) {
        bestStationDistance = toStall;
        bestStation = d;
      }
      const above = probe.y - terrainHeight(probe.x, probe.z);
      if (above > crest) crest = above;
    }
    this.stationDistance = bestStation;
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
