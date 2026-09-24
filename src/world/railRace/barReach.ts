import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import { cartAssetPart } from '../../art/models/cartAsset';
import { duckBarAssetGeometry } from '../../art/models/duckBarAsset';
import { tiltToSphere } from '../terrain';
import { CART_PARTS } from './cart';
import { DUCK_CLEARANCE_AT_PARK_SCALE } from './hazards';
import { LANE_COUNT, RIDE_SCALE, type RailRaceRoute } from './route';
import {
  RAIL_GAUGE_AT_PARK_SCALE,
  RAIL_RADIUS_AT_PARK_SCALE,
  SLEEPER_OVERHANG,
  SLEEPER_THICKNESS,
} from './trestleGeometry';

/**
 * **Does a duck bar reach into somebody else's lane?** The one owner of that
 * question, asked by the planner before a bar is placed (`simulate.ts`'s
 * `barPlanDecision`) and by `test/procgen/invariants.ts` of the bars the park
 * actually built — so the rule a bar is refused by and the rule it is judged by
 * are one function, not two that agree.
 *
 * ### Why it can
 *
 * A bar belongs to one lane, but it is 2.30 m long at park scale
 * (its ends reach 1.15 m either side of its lane's centre, the asset's own
 * half-length) and the lanes are one cart apart, 1.10 m. So a bar's ends
 * always stand over its neighbours' rails in plan. Whether that is harmless is
 * decided by **height**: every lane undulates on its own phase and the lanes
 * stand up to ~4.4 m apart at one station, so a neighbour can be low enough to
 * pass under the bar's end, high enough to pass over it — or right at its
 * height. Measured on seed 4 (restart 2), walk-past ring: bar 37 over lane 2,
 * lane 3 at station ~205 standing 2.85 m above lane 2 — exactly the bar's
 * height — so the bar's end sat inside lane 3's track bed, 0.34 m from a
 * sleeper, and a cart on lane 3 would have driven through it
 * (`check:coplanar`'s `duck-bars` against `trestle-branches-upper` seam).
 *
 * ### What a lane's envelope is
 *
 * Measured in the ring's **chart** frame (see `RailRaceRoute.unlean`), where a
 * lane is a line at a lateral offset and a height, so the question is two
 * intervals:
 *
 * - **across**: half the wider of the drawn sleeper and the cart, either side
 *   of the lane's centre;
 * - **up**: from the bottom of the drawn sleeper (rail radius + sleeper
 *   thickness below the rail head, or the cart's underside if lower) to the
 *   top of the cart, read off the cart
 *   asset's own parts rather than a written-down number.
 *
 * The rider is **not** in the envelope. Her head sits 2.84 m over the rail at
 * park scale and the bar's underside at 2.55 m, so a level neighbour's rider
 * passes under the end of every bar at her own height; that is a design fact of
 * bars wider than a lane, reported by the invariant's coverage note rather than
 * ruled on here.
 */

/** A lane's no-go box, in the chart, relative to its own centre and rail head. */
export interface LaneEnvelope {
  /** Half-width across the lane. */
  readonly halfWidth: number;
  /** How far below the rail head the drawn track reaches (the sleeper's bottom). */
  readonly below: number;
  /** How far above the rail head a cart reaches. */
  readonly above: number;
}

let cartBoxMemo: Box3 | null = null;
/** The cart asset's own box, at park scale, in the frame `placeRaceCart` puts on the rail head. */
function cartBox(): Box3 {
  if (cartBoxMemo) return cartBoxMemo;
  const box = new Box3();
  const partBox = new Box3();
  const transform = new Matrix4();
  for (const name of CART_PARTS) {
    const part = cartAssetPart(name);
    const local = boxOf(part.geometry);
    transform.compose(part.position, part.quaternion, part.scale);
    partBox.copy(local).applyMatrix4(transform);
    box.union(partBox);
  }
  return (cartBoxMemo = box);
}

/** A geometry's bounding box without touching the shared geometry's own field. */
function boxOf(geometry: { clone(): { computeBoundingBox(): void; boundingBox: Box3 | null } }): Box3 {
  const copy = geometry.clone();
  copy.computeBoundingBox();
  return copy.boundingBox ?? new Box3();
}

/** The envelope of any lane on a ring built at `scale` (a route's `scale`). */
export function laneEnvelope(scale: number): LaneEnvelope {
  const ringSizeVsRace = scale / RIDE_SCALE;
  // Exactly the numbers `track.ts` builds the rails and sleepers from.
  const railGauge = RAIL_GAUGE_AT_PARK_SCALE * scale;
  const sleeperLength = railGauge + SLEEPER_OVERHANG * 2 * ringSizeVsRace;
  const railRadius = RAIL_RADIUS_AT_PARK_SCALE * scale;
  const sleeperThickness = SLEEPER_THICKNESS * ringSizeVsRace;
  // A cart group is scaled by its ring's own scale (`RailRace.setActiveRing`).
  const cart = cartBox();
  const cartHalfWidth = Math.max(Math.abs(cart.min.x), Math.abs(cart.max.x)) * scale;
  return {
    halfWidth: Math.max(sleeperLength / 2, cartHalfWidth),
    // The drawn sleeper's bottom, or the cart's own underside if that hangs lower.
    below: Math.max(railRadius + sleeperThickness, -cart.min.y * scale),
    above: cart.max.y * scale,
  };
}

/** Where a bar hangs, as `track.ts` hangs it. */
export interface DuckBarPose {
  /** The rail point under the bar's middle, on its own lane. */
  readonly point: Vector3;
  /** The ring's outward direction there (the axis the bar lies across). */
  readonly outward: Vector3;
  /** The tilt that leans the whole gantry with the track. */
  readonly tilt: Quaternion;
  /** The bar instance's own matrix. */
  readonly matrix: Matrix4;
}

const ACROSS = new Vector3(1, 0, 0);

/**
 * **The one owner of where a duck bar hangs**: `track.ts` draws the bar with
 * this matrix, and the planner asks {@link duckBarIntrusions} of the very same
 * matrix before it lets a bar take a slot.
 *
 * `archAt` is arch-relative, as `DuckBar.at` is.
 */
export function duckBarPose(route: RailRaceRoute, lane: number, archAt: number): DuckBarPose {
  const ringSizeVsRace = route.scale / RIDE_SCALE;
  const duckClearance = DUCK_CLEARANCE_AT_PARK_SCALE * route.scale;
  const at = route.wrap(route.startDistance + archAt);
  const outward = route.outwardAt(at, new Vector3());
  const point = route.pointAt(lane, at, new Vector3());
  const tilt = new Quaternion();
  tiltToSphere(point.x, point.y, point.z, tilt);
  const rotation = new Quaternion().setFromUnitVectors(ACROSS, outward).premultiply(tilt);
  const position = new Vector3(0, duckClearance, 0).applyQuaternion(tilt).add(point);
  const matrix = new Matrix4().compose(
    position,
    rotation,
    new Vector3(ringSizeVsRace, ringSizeVsRace, ringSizeVsRace),
  );
  return { point, outward, tilt, matrix };
}

/** One lane a bar reaches into, and by how much. */
export interface BarIntrusion {
  /** The lane whose envelope the bar reaches into. */
  readonly lane: number;
  /** The deepest any sampled point of the bar gets inside it, in metres. */
  readonly depth: number;
  /** That point's arc length (route coordinate) and chart position relative to the intruded lane. */
  readonly station: number;
  readonly across: number;
  readonly aboveRail: number;
}

let barBoxMemo: Box3 | null = null;
function barBox(): Box3 {
  return (barBoxMemo ??= boxOf(duckBarAssetGeometry('bar')));
}

/**
 * How finely the bar is sampled along its length, in the asset's own metres
 * (race-ring size). 0.05 m at race size is 2 cm on the walk-past ring: far
 * below any envelope dimension, so a real intrusion cannot fall between two
 * samples.
 */
const BAR_SAMPLE_STEP = 0.05;

const _local = new Vector3();
const _world = new Vector3();
const _chart = new Vector3();

/**
 * Every **other** lane of `route` that the bar drawn by `matrix` reaches into,
 * with the depth of the worst sampled point. Empty is the healthy answer.
 *
 * Samples the bar's box every {@link BAR_SAMPLE_STEP} along its length, at the
 * four long edges (top and bottom, front and back — against a box-shaped
 * envelope the extremes are on the edges), takes each sample into the chart,
 * and asks whether it stands inside another lane's {@link laneEnvelope} there.
 *
 * **One station per bar.** The chart is found at the bar's own centre
 * (`stationOf`, the expensive search) and every sample is unleant there, its
 * own station read off its along-track offset in that frame. A bar is a few
 * tenths of a metre thick along the track, so this is exact to the slope times
 * that — millimetres — and it is what lets the planner ask it of every slot of
 * every lane on both rings at boot.
 */
export function duckBarIntrusions(route: RailRaceRoute, barLane: number, matrix: Matrix4): BarIntrusion[] {
  const box = barBox();
  const envelope = laneEnvelope(route.scale);
  const worst = new Map<number, BarIntrusion>();
  _world.setFromMatrixPosition(matrix);
  const centreStation = route.stationOf(_world);
  const centreSample = route.path.sampleAt(centreStation);
  const steps = Math.max(1, Math.ceil((box.max.x - box.min.x) / BAR_SAMPLE_STEP));
  for (let i = 0; i <= steps; i += 1) {
    const x = box.min.x + ((box.max.x - box.min.x) * i) / steps;
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        _world.copy(_local.set(x, y, z)).applyMatrix4(matrix);
        route.unlean(centreStation, _world, _chart);
        const dx = _chart.x - centreSample.x;
        const dz = _chart.z - centreSample.z;
        const offset = dx * centreSample.normalX + dz * centreSample.normalZ;
        const station = route.wrap(centreStation + dx * centreSample.tangentX + dz * centreSample.tangentZ);
        for (let lane = 0; lane < LANE_COUNT; lane += 1) {
          if (lane === barLane) continue;
          const across = offset - (route.laneOffsets[lane] ?? 0);
          const aboveRail = _chart.y - route.heightAt(lane, station);
          const depth = Math.min(
            envelope.halfWidth - Math.abs(across),
            aboveRail + envelope.below,
            envelope.above - aboveRail,
          );
          if (depth <= 0) continue;
          const previous = worst.get(lane);
          if (!previous || depth > previous.depth) {
            worst.set(lane, { lane, depth, station, across, aboveRail });
          }
        }
      }
    }
  }
  return [...worst.values()];
}
