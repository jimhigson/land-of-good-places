import { RIM_OUTSET_START } from '../../core/constants';
import { PARK_BOUNDARY, TERRAIN_APRON } from '../boundary';
import { RingPath } from '../railRace/ringPath';
import { CAT_BUS_LENGTH } from './catBus';
import { ENTRANCE_ANGLE } from './layout';
import { ROAD_HALF_WIDTH } from './road';

/**
 * **Where the road outside the gate actually goes — the one owner of its line.**
 *
 * ## Why this file exists at all
 *
 * The road used to be a straight chord: a ribbon along `x` at
 * `ENTRANCE_BUS_STOP_Z` (the wall plus nine metres), which the cat bus drove
 * along. Jim, 3 September 2026, on two separate faults that turned out to be
 * the same fault:
 *
 * > *"the road outside the park (which should also be grey) just stops - it
 * > should continue away from the park as far as the game renders when fully
 * > zoomed out"*
 *
 * > *"the bus shouldn't clip through the rail race supports - route the road
 * > properly to avoid them"*
 *
 * ### The measurement that decided the shape
 *
 * Measured on **all sixteen pool seeds** (`scripts/measure-entrance-road.mts`),
 * the old straight kerb had **two to eight** Rail Race trestle legs standing
 * inside the bus's swept body, every seed, worst intrusion 2.51 m. That is not
 * bad luck on one park, and no amount of moving the straight line fixes it:
 *
 * - Trestle feet stand at `NOMINAL_OUTSET` — **6.5 m beyond the park's own
 *   edge** — all the way round, on every seed. `route.ts` boxes that number
 *   into `[6.15, 6.92]` (inner: the innermost rail must clear the masonry;
 *   outer: the outermost rail must stay inside {@link RIM_OUTSET_START}), so it
 *   cannot move.
 * - A road `2 * ROAD_HALF_WIDTH` = 7.78 m wide needs its centre at outset
 *   ≥ `ROAD_HALF_WIDTH` to stay out of the park, and ≤ `RIM_OUTSET_START -
 *   ROAD_HALF_WIDTH` (8.11) to stay off a 17 m hillside.
 * - To clear a leg at 6.5 that centre must be **≥ 4.4 m** away from it — outset
 *   ≤ 2.1 or ≥ 10.9.
 *
 * **Those two bands do not intersect.** There is no outset, straight *or*
 * curved, at which a road running *along* the wall clears a support. A road
 * *crossing* the trestle line is fine — `TRESTLE_SPACING` is 12 m against a
 * 7.78 m road — it is only a road parallel to it that cannot fit.
 *
 * So the road stops being a chord and becomes a **corridor with one owner**,
 * declared here, which two things then read:
 *
 * - `Entrance.ts` builds the ribbons from it.
 * - `railRace/track.ts`'s `groundIsClear` refuses to stand a leg in it, exactly
 *   as it already refuses ground near a path, near the rail corridor, and near
 *   a `PARK_LAYOUT` entry. The road was simply **missing from that list**,
 *   which is CLAUDE.md's "a generator that only checks itself against a
 *   hand-picked obstacle list will silently miss whatever a sibling system
 *   placed there" by name. `World.ts` builds `RailRace` before `Entrance`, and
 *   nothing here depends on the ride, so the ordering works: the ride's own
 *   `RADIAL_NUDGES` search moves its feet clear of the road. Nothing is deleted
 *   and nothing is hand-placed.
 *
 * ## The shape, in three parts
 *
 * 1. **The kerb** — the park's own edge pushed out along its normal by
 *    {@link ENTRANCE_ROAD_OUTSET}, so the road hugs the wall at a *constant*
 *    distance instead of a straight line's varying one. This is what the bus
 *    stands and drives on. It is a curve, and it has to be: a straight kerb
 *    close enough to the wall at the gate is **inside the park** by x ≈ +12,
 *    because the boundary spline bulges to 92 m a few degrees off the gate's
 *    bearing.
 * 2. **Two tails** — at each end the road turns away from the park, climbing
 *    from the kerb's outset out to {@link ENTRANCE_ROAD_TAIL_OUTSET}, crossing
 *    under the ride and over the hilltop's brow.
 * 3. It **ends where the drawn ground ends**, not at a length somebody liked:
 *    `TERRAIN_APRON` is how far past the park the terrain disc is built, so
 *    that is how far a road can go before there is nothing under it.
 *
 * ## What "as far as the game renders" turned out to mean
 *
 * The zoom-out extent is owned by `IsoCamera.frustumBase()` and is
 * **aspect-dependent** — at `CAMERA_ZOOM_MIN` a 16:9 desktop reaches 29.0 m of
 * ground up-screen and a 390x844 portrait phone 47.8 m — so nothing here copies
 * a number out of it. `scripts/check-entrance-road.mts` calls that function for
 * a spread of aspects and reports the road's reach against it, which is the
 * only honest way to state a fact about a frustum a world-build cannot see.
 *
 * The park is a hilltop diorama, so past the brow there is no ground at all:
 * the road ends by going over it, which is what a road leaving a hilltop does
 * and is genuinely as far as the game draws in that direction.
 */

/**
 * How far the boundary masonry stands proud of the park's own edge line.
 *
 * `Garden.ts` lays 0.7 m-deep blocks centred on the outline, so the outer face
 * is half of that out; the pillars are fatter again. Stated here so the road's
 * inner kerb can be put against the wall rather than through it.
 */
const BOUNDARY_MASONRY_REACH = 0.6;

/**
 * **The road's centre line, as metres beyond the park's edge.**
 *
 * As near the wall as a road can be laid — its inner kerb ends up
 * {@link BOUNDARY_MASONRY_REACH} clear of the masonry's outer face — and that
 * is the point. Every metre the road sits further out is a metre of the Rail
 * Race's own apron it takes, and a bigger radial nudge the ride's trestle
 * search has to find. Hugging the wall is the cheapest place for it to be.
 */
export const ENTRANCE_ROAD_OUTSET = ROAD_HALF_WIDTH + BOUNDARY_MASONRY_REACH;

/**
 * How far out the tails run before the road is off the edge of the world.
 *
 * `TERRAIN_APRON` is `boundary.ts`'s own answer to "how much ground is built
 * outside the park", so the road reaches the terrain disc's cut edge and stops
 * because the ground stops — never at a distance chosen to look right.
 */
export const ENTRANCE_ROAD_TAIL_OUTSET = TERRAIN_APRON;

/**
 * How much straight-ish kerb there is either side of the gate before the road
 * turns away.
 *
 * **Derived from the bus, not chosen.** The bus has to roll in, stand with its
 * door at the arch, and roll out again, and it is `CAT_BUS_LENGTH` long — so a
 * run of one bus-length each way is the least that lets it arrive and leave
 * without either end of it already being on the turn. Longer would be prettier
 * and costs the ride a trestle slot per twelve metres, which is the trade this
 * number is really making.
 */
export const ENTRANCE_ROAD_KERB_HALF_RUN = CAT_BUS_LENGTH;

/**
 * The arc a tail takes to climb from the kerb's outset to the terrain's edge.
 *
 * Sized so the road crosses the trestle line **steeply**: at this run the
 * centre line makes about 55° to the ring, so a 7.78 m road occupies about
 * 9.6 m of the ring's arc — inside `TRESTLE_SPACING`'s 12 m, so the crossing
 * costs at most one slot per ring, and that slot's own `ARC_NUDGES` (which are
 * free, unlike radial ones) can usually step round it.
 */
export const ENTRANCE_ROAD_TAIL_RUN = 14;

/** One station on the road's centre line. */
export interface RoadStation {
  readonly x: number;
  readonly z: number;
  /** Metres along the road, zero at the gate, negative one way and positive the other. */
  readonly at: number;
  /** Unit heading along the road in the direction of increasing {@link at}. */
  readonly headingX: number;
  readonly headingZ: number;
}

/** Roughly one station per metre — fine enough for a UV seam and a bus to drive. */
const STATION_SPACING = 1;

const KERB_PATH = new RingPath(ENTRANCE_ROAD_OUTSET);
const GATE_AT = KERB_PATH.distanceAtBearing(ENTRANCE_ANGLE);

/** How far out the tail has climbed, `distance` metres from the gate along the kerb. */
function tailOutset(distance: number): number {
  const past = Math.abs(distance) - ENTRANCE_ROAD_KERB_HALF_RUN;
  if (past <= 0) return 0;
  const t = Math.min(1, past / ENTRANCE_ROAD_TAIL_RUN);
  // Smooth at the join so the bus does not turn a corner, linear afterwards so
  // the crossing angle stays steep rather than easing off into the ring.
  const eased = t * t * (3 - 2 * t);
  return eased * (ENTRANCE_ROAD_TAIL_OUTSET - ENTRANCE_ROAD_OUTSET);
}

let stationCache: readonly RoadStation[] | null = null;

/**
 * **The road's centre line**, gate-centred, from one tail's end to the other.
 *
 * Built once and shared. Everything that needs to know where the road is —
 * the ribbons, the bus, the trestle search, the checks — reads this, so there
 * is never a second description of the same road to keep in step.
 */
export function entranceRoadStations(): readonly RoadStation[] {
  if (stationCache) return stationCache;

  const halfRun = ENTRANCE_ROAD_KERB_HALF_RUN + ENTRANCE_ROAD_TAIL_RUN;
  const count = Math.round(halfRun / STATION_SPACING);
  const points: { x: number; z: number; along: number }[] = [];
  for (let i = -count; i <= count; i += 1) {
    const along = i * STATION_SPACING;
    const sample = KERB_PATH.sampleAt(KERB_PATH.wrap(GATE_AT + along));
    const extra = tailOutset(along);
    points.push({
      x: sample.x + sample.normalX * extra,
      z: sample.z + sample.normalZ * extra,
      along,
    });
  }

  // Arc length is measured on the built polyline, never assumed to be `along`:
  // the tails push sideways as well as forwards, so a tail metre of `along` is
  // more than a metre of road. A bus driving by `along` would speed up on the
  // turn.
  const stations: RoadStation[] = [];
  let travelled = 0;
  let gateAt = 0;
  for (let i = 0; i < points.length; i += 1) {
    const here = points[i] as { x: number; z: number; along: number };
    if (i > 0) {
      const previous = points[i - 1] as { x: number; z: number };
      travelled += Math.hypot(here.x - previous.x, here.z - previous.z);
    }
    if (here.along === 0) gateAt = travelled;
    const ahead = points[Math.min(points.length - 1, i + 1)] as { x: number; z: number };
    const behind = points[Math.max(0, i - 1)] as { x: number; z: number };
    const hx = ahead.x - behind.x;
    const hz = ahead.z - behind.z;
    const length = Math.hypot(hx, hz) || 1;
    stations.push({ x: here.x, z: here.z, at: travelled, headingX: hx / length, headingZ: hz / length });
  }

  stationCache = stations.map((station) => ({ ...station, at: station.at - gateAt }));
  return stationCache;
}

/** The road's own extent, in metres either side of the gate. */
export function entranceRoadExtent(): { readonly from: number; readonly to: number } {
  const stations = entranceRoadStations();
  return {
    from: (stations[0] as RoadStation).at,
    to: (stations[stations.length - 1] as RoadStation).at,
  };
}

/** Where the road is, `at` metres from the gate. Clamped to the road's own ends. */
export function entranceRoadAt(at: number): RoadStation {
  const stations = entranceRoadStations();
  const first = stations[0] as RoadStation;
  const last = stations[stations.length - 1] as RoadStation;
  if (at <= first.at) return first;
  if (at >= last.at) return last;
  // Stations are near enough evenly spaced in `at`; find the bracketing pair by
  // scan rather than by index arithmetic, because the tails stretch the spacing.
  for (let i = 1; i < stations.length; i += 1) {
    const b = stations[i] as RoadStation;
    if (b.at < at) continue;
    const a = stations[i - 1] as RoadStation;
    const t = (at - a.at) / Math.max(1e-6, b.at - a.at);
    const hx = a.headingX + (b.headingX - a.headingX) * t;
    const hz = a.headingZ + (b.headingZ - a.headingZ) * t;
    const length = Math.hypot(hx, hz) || 1;
    return {
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      at,
      headingX: hx / length,
      headingZ: hz / length,
    };
  }
  return last;
}

/**
 * **How far this point is from the middle of the road**, in metres.
 *
 * The query `railRace/track.ts` asks before it stands a leg, and the same one
 * the checks ask. Perpendicular distance to the centre *line*, not to a
 * station, so a leg cannot slip between two samples — the segment version of
 * the same trap CLAUDE.md's `bandCrossed` note describes for trigger bands.
 */
export function distanceToEntranceRoad(x: number, z: number): number {
  const stations = entranceRoadStations();
  let nearest = Infinity;
  for (let i = 1; i < stations.length; i += 1) {
    const a = stations[i - 1] as RoadStation;
    const b = stations[i] as RoadStation;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSquared = dx * dx + dz * dz;
    const t =
      lengthSquared < 1e-9
        ? 0
        : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lengthSquared));
    nearest = Math.min(nearest, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
  }
  return nearest;
}

/**
 * **Is this ground inside the road's corridor?** — the road's half width plus
 * whatever the thing being placed measures across.
 *
 * One predicate rather than a comparison spelled out at each call site: the
 * ride asks it, the checks ask it, and neither gets to hold its own idea of how
 * wide the road is.
 */
export function isInEntranceRoad(x: number, z: number, radius = 0): boolean {
  return distanceToEntranceRoad(x, z) < ROAD_HALF_WIDTH + radius;
}

/** How far the road reaches from the gate, for the checks to compare against a frustum. */
export function entranceRoadReach(): number {
  const { from, to } = entranceRoadExtent();
  return Math.min(Math.abs(from), Math.abs(to));
}

/** Where the boundary edge sits, for anything wanting the road's outset back. */
export function entranceRoadOutsetAt(x: number, z: number): number {
  return -PARK_BOUNDARY.distanceToEdge(x, z);
}
