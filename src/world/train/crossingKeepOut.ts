import {
  CROSSING_STATION_CLEARANCE,
  CROSSING_STATION_STRUCTURE_CLEARANCE,
  STATION_GAP,
} from './clearance';
import { DECK_HALF_LENGTH } from './bridgeFootprint';
import { SITE_RAMP_IDEAL } from './bridgeFit';

/**
 * **The loop's own chosen crossing, as ground a station may not stand on.**
 *
 * Issue #427 grows the railway from a pose where a bridge provably fits — rail
 * distance 0 — so that a park with no bridgeable crossing stops being something
 * the generator can produce. Two things can take that guarantee away again
 * afterwards, and both are about stations:
 *
 * - a station landing **on the crossing along the loop** (seed 2, measured at
 *   d = -2.0 m: the park came out with no bridge at all), and
 * - a station landing **near it in space** while a hundred metres away around
 *   the circuit, its canopy posts blocking the deck (seeds 2 and 15).
 *
 * `clearance.ts` owns the two distances. This module owns **the test**, for the
 * same reason and in the same shape: it is asked from two directions.
 *
 * - `train/plan.ts` asks it of every candidate station distance, and scores a
 *   conflicting one far below any other fault, so the placer avoids the
 *   crossing whenever its window contains anywhere that can.
 * - `train/route.ts`'s `satisfies` backstop asks whether the window contains
 *   such a place **at all** — because when it does not, the placer has no move
 *   that helps, and the loop itself is the thing that has to be rejected. A
 *   penalty cannot discriminate when every candidate carries it (seed 15).
 *
 * Those two questions must be the same question. Written twice they would be
 * two rules kept in step by hand, which is precisely how the crossing and the
 * station came to disagree in the first place.
 *
 * There is no three.js here and no `TrainRoute`: the callers hold routes of two
 * different types (a `TrainRoute` on one side, a bare `SolvedRailRoute` that has
 * only just closed on the other), so the route arrives as a sampling function.
 */

/** The least a caller has to say about a point. */
export interface FlatPoint {
  x: number;
  z: number;
}

/**
 * The strip of ground the chosen crossing's bridge will occupy: its centre, the
 * axis its deck and ramps run along, and how far along that axis they reach.
 *
 * The axis is square to the track, because `crossingPoses.ts` builds the start
 * pose that way; the reach is the deck's own half-length plus the longest ramp
 * the planner ever probes, because `crossingPlanSolve.ts` asks its station test
 * about **every** probe point out to there, not only about the deck.
 */
export interface CrossingCorridor {
  readonly centreX: number;
  readonly centreZ: number;
  readonly axisX: number;
  readonly axisZ: number;
  readonly halfLength: number;
}

/** The corridor about the loop's own chosen crossing, at rail distance 0. */
export function chosenCrossingCorridor(centre: FlatPoint, tangent: FlatPoint): CrossingCorridor {
  return {
    centreX: centre.x,
    centreZ: centre.z,
    axisX: tangent.z,
    axisZ: -tangent.x,
    halfLength: DECK_HALF_LENGTH + SITE_RAMP_IDEAL,
  };
}

/**
 * How a station at `stationDistance` conflicts with the chosen crossing — as
 * two separate answers, because they are two separate rules (one measured along
 * the loop, one across the park) and the placer scores them separately.
 */
export interface CrossingConflict {
  /** Within {@link CROSSING_STATION_CLEARANCE} of the crossing along the loop. */
  readonly alongLoop: boolean;
  /** Platform window within reach of the crossing's corridor, in space. */
  readonly inSpace: boolean;
}

/** True when neither rule is broken — the station leaves the crossing alone. */
export function crossingIsClear(conflict: CrossingConflict): boolean {
  return !conflict.alongLoop && !conflict.inSpace;
}

/**
 * Does a station platform centred at `stationDistance` stand on the loop's own
 * chosen crossing?
 *
 * `flatPointAt` is asked only for distances already folded into `[0, length)`.
 */
export function stationCrossingConflict(
  stationDistance: number,
  routeLength: number,
  corridor: CrossingCorridor,
  flatPointAt: (distance: number) => FlatPoint,
): CrossingConflict {
  const wrap = (distance: number): number => {
    const wrapped = distance % routeLength;
    return wrapped < 0 ? wrapped + routeLength : wrapped;
  };

  const half = routeLength / 2;
  const alongLoop =
    Math.abs(wrap(stationDistance + half) - half) < CROSSING_STATION_CLEARANCE;

  let inSpace = false;
  for (let w = -STATION_GAP; w <= STATION_GAP && !inSpace; w += 2) {
    const window = flatPointAt(wrap(stationDistance + w));
    const dx = window.x - corridor.centreX;
    const dz = window.z - corridor.centreZ;
    const along = Math.max(
      -corridor.halfLength,
      Math.min(corridor.halfLength, dx * corridor.axisX + dz * corridor.axisZ),
    );
    const nearestX = corridor.centreX + corridor.axisX * along;
    const nearestZ = corridor.centreZ + corridor.axisZ * along;
    if (
      Math.hypot(window.x - nearestX, window.z - nearestZ) <
      CROSSING_STATION_STRUCTURE_CLEARANCE
    ) {
      inSpace = true;
    }
  }

  return { alongLoop, inSpace };
}

/**
 * **The window the station placer searches**, either way along the loop from a
 * station seed's ideal bearing.
 *
 * Owned here rather than in `plan.ts` because `satisfies` has to ask about
 * exactly the same window: "is there anywhere in here that clears the
 * crossing?" is only the right question if "here" is the ground the placer will
 * really look at.
 */
export const STATION_SEARCH_WINDOW = 60;
/** Pitch the window is searched at. */
export const STATION_SEARCH_STEP = 2;

/**
 * **Can a station seeded at `target` be placed clear of the chosen crossing at
 * all?**
 *
 * The placer scores every candidate in the window and takes the lowest, with a
 * conflict costing 5000 against a worst case of about 1600 for every other
 * fault put together — so whenever one crossing-clear candidate exists, the
 * station lands on a crossing-clear candidate. When none exists the placer has
 * no move at all, which is the case this answers.
 */
export function crossingSurvivesStationAt(
  target: number,
  routeLength: number,
  corridor: CrossingCorridor,
  flatPointAt: (distance: number) => FlatPoint,
): boolean {
  for (
    let offset = -STATION_SEARCH_WINDOW;
    offset <= STATION_SEARCH_WINDOW;
    offset += STATION_SEARCH_STEP
  ) {
    const conflict = stationCrossingConflict(
      target + offset,
      routeLength,
      corridor,
      flatPointAt,
    );
    if (crossingIsClear(conflict)) return true;
  }
  return false;
}
