import { Vector3 } from 'three';
import type { TrainRoute } from './route';
import { CROSSING_SITES, type CrossingSite } from './crossingPlan';
import { ENTRANCE_GATE_X, ENTRANCE_GATE_Z } from '../entrance/layout';

/**
 * **The crossing predicate, alone, so everyone who needs it can have it.**
 *
 * This lives apart from `crossings.ts` for one reason: **import direction.**
 * `crossings.ts` imports `pathGraph.ts` (for the drawn samples), which imports
 * `paths.ts` — so the router could never have asked it a question without a
 * cycle. That is why the check could only ever run *after* the graph was
 * committed, and why a park that could not be built announced itself three
 * systems later from scenery planting.
 *
 * Depending only on {@link TrainRoute} and {@link CROSSING_SITES}, it can be
 * asked by the router at the point of decision, by the generator's task at
 * commit time, and by `computeCrossings` at construction time — **one owner,
 * three askers.**
 */

/** How close a path sample must be to the rail for a side flip between it
 * and its neighbour to count as a crossing of the rail. */
const TOUCH_DISTANCE = 3.2;

/** Consecutive samples further apart than this belong to different drawn runs;
 * a side flip is only ever measured *within* one run, so two paths hugging
 * opposite sides of the fence cannot read as a crossing between them. */
const RUN_BREAK = 3;

/** How far (along the loop) a measured crossing may sit from a planned site and
 * still be recognised as that site. */
export const SITE_SNAP_TOLERANCE = 8;

/**
 * **The one owner of "do these drawn samples cross the railway, and where?"**
 *
 * A crossing is a *side flip*: two consecutive samples of one drawn run landing
 * on opposite sides of the rail centre line, with at least one of them within
 * {@link TOUCH_DISTANCE} of it. That definition, the {@link RUN_BREAK} stride
 * guard that keeps two paths hugging opposite sides of the fence from reading
 * as a crossing between them, and the {@link SITE_SNAP_TOLERANCE} snap to a
 * planned site, are **one predicate with two askers**:
 *
 * - {@link computeCrossings}, at construction time, which turns the flips into
 *   the decks and fence gaps the park draws;
 * - the generator's `pathGraph` task, at **commit** time, which asks the same
 *   question of the same drawn samples *before* the graph is published, so a
 *   path crossing off-site is a refused decision naming the edge rather than a
 *   throw from scenery planting three systems later.
 *
 * **It must stay one function.** A second "does this cross off-site?" written
 * beside the router would be two definitions of one thing kept in step by hand
 * — this repo's most expensive habit — and the copy would be found wrong by a
 * park that fails to build, which is exactly how seed 288 was found.
 *
 * Stateful rather than a pure function over an array because the callers feed
 * it from different places: `computeCrossings` walks `pathCentreline()` and
 * then marches the esplanade, and the task walks the graph's edges. Both need
 * "these samples are one run, those are another", which is what
 * {@link CrossingScan.breakRun} says.
 */
export interface CrossingScan {
  /** Offer the next sample of the current run. `run` identifies the drawn
   *  route it came from, so a foul can name the edge that drew it. */
  consider(x: number, z: number, run?: number): void;
  /** End the current run: the next sample starts a new one and cannot flip
   *  against the last. */
  breakRun(): void;
  /** Every flip found so far, as distances along the loop, ascending. */
  flips(): number[];
  /** The same flips, each with the run that drew it (-1 when unknown). */
  flipsWithRun(): { railDistance: number; run: number }[];
}

export function createCrossingScan(route: TrainRoute): CrossingScan {
  const point = new Vector3();
  const tangent = new Vector3();
  const found: { railDistance: number; run: number }[] = [];
  let previous: { x: number; z: number; railDistance: number; side: number; perp: number } | null =
    null;
  return {
    consider(x: number, z: number, run = -1): void {
      const railDistance = route.distanceNear(x, z);
      route.pointAt(railDistance, point);
      route.tangentAt(railDistance, tangent);
      const perp = Math.hypot(point.x - x, point.z - z);
      const side = Math.sign(tangent.z * (x - point.x) - tangent.x * (z - point.z)) || 1;
      const current = { x, z, railDistance, side, perp };
      if (previous) {
        const stride = Math.hypot(x - previous.x, z - previous.z);
        if (
          stride < RUN_BREAK &&
          side !== previous.side &&
          Math.min(perp, previous.perp) <= TOUCH_DISTANCE
        ) {
          const half = route.length / 2;
          const delta = route.wrap(railDistance - previous.railDistance + half) - half;
          found.push({ railDistance: route.wrap(previous.railDistance + delta / 2), run });
        }
      }
      previous = current;
    },
    breakRun(): void {
      previous = null;
    },
    flips(): number[] {
      return found.map((f) => f.railDistance).sort((a, b) => a - b);
    },
    flipsWithRun(): { railDistance: number; run: number }[] {
      return [...found].sort((a, b) => a.railDistance - b.railDistance);
    },
  };
}

/**
 * The planned site a flip at this rail distance belongs to, or `null` if none
 * is within {@link SITE_SNAP_TOLERANCE} — i.e. the path crosses the railway
 * somewhere no bridge was ever proven.
 *
 * The other half of the predicate above, and the half that decides whether a
 * crossing is legal. Both askers use it, so "off-site" means the same thing at
 * commit time and at construction time.
 */
export function siteForFlip(route: TrainRoute, railDistance: number): CrossingSite | null {
  for (const site of CROSSING_SITES) {
    const along = Math.abs(
      route.wrap(railDistance - site.railDistance + route.length / 2) - route.length / 2,
    );
    if (along <= SITE_SNAP_TOLERANCE) return site;
  }
  return null;
}

/** One drawn crossing that snapped to no proven bridge site. */
export interface OffSiteCrossing {
  /** Where along the loop the path crossed. */
  readonly railDistance: number;
  /** Where that is in the park, for a message somebody has to act on. */
  readonly x: number;
  readonly z: number;
  /** Which drawn route laid the samples that crossed — the producer to blame. */
  readonly run: number;
}

/** What {@link screenDrawnPathsForOffSiteCrossings} found, and how hard it looked. */
export interface CrossingScreenResult {
  readonly fouls: readonly OffSiteCrossing[];
  /**
   * **How many drawn samples were actually scanned.**
   *
   * Reported on every run, and it is not decoration. A screen that scans zero
   * samples and a screen that scans six thousand both report "no fouls", and
   * this number is the only thing that tells them apart at a glance. That is
   * not hypothetical: the first attempt at this screen was very nearly wired
   * where `pathCentreline()` is still empty — `buildPaths()` fills it at
   * world-build time, long after the generator's `pathGraph` task — and it
   * would have passed every seed including the one known to be broken, while
   * describing nothing at all.
   */
  readonly samplesScanned: number;
}

/**
 * **The esplanade: the arch to wherever the drawn network takes over.**
 *
 * The one owner of the walk-in march that both `computeCrossings` (at build
 * time) and {@link screenDrawnPathsForOffSiteCrossings} (at plan time) scan
 * for side flips. Its first sample stands far from the last path sample, so
 * the RUN_BREAK stride guard keeps the seam between them from ever reading as
 * a flip.
 *
 * This used to march a flat 32 m straight in from the arch on the radial,
 * regardless of what was drawn there, and that is what put a level crossing
 * at the park's own front door and kept it there. `paths.ts`'s gate corridor
 * now stops short of the railway and hands the walk to the street lattice,
 * which crosses only at a planned site (issue #339) — but a hand-sampled
 * straight line ploughing on to `z = 28` still flipped sides at the track, so
 * `computeCrossings` minted the crossing anyway. The honest span is the bit of
 * the walk that really is un-drawn: from the arch to the first point where the
 * drawn network is under her feet. The march still runs its full 32 m when
 * nothing drawn comes near.
 *
 * **The march overlaps the drawn ribbon rather than stopping dead at it.** A
 * side flip is only ever measured between two *consecutive* samples, and the
 * drawn ribbon's samples are a different run — so a loop crossing in the seam
 * between the last esplanade sample and the ribbon's own first point would be
 * invisible to both, and the fence would seal with no gap where a child walks.
 * Found on seed 11: the loop cut `x = 0` at `z = 54.3`, six metres in from the
 * arch, in exactly that seam.
 */
export function esplanadeSamples(
  drawn: readonly { readonly x: number; readonly z: number; readonly halfWidth: number }[],
): { x: number; z: number }[] {
  const inX = -ENTRANCE_GATE_X / Math.hypot(ENTRANCE_GATE_X, ENTRANCE_GATE_Z);
  const inZ = -ENTRANCE_GATE_Z / Math.hypot(ENTRANCE_GATE_X, ENTRANCE_GATE_Z);
  const onDrawnPath = (x: number, z: number): boolean => {
    for (const sample of drawn) {
      if (Math.hypot(sample.x - x, sample.z - z) <= sample.halfWidth + 0.4) return true;
    }
    return false;
  };
  const ESPLANADE_OVERLAP = 4;
  const out: { x: number; z: number }[] = [];
  let sinceDrawn = -1;
  for (let step = 0; step <= 32; step += 1) {
    const x = ENTRANCE_GATE_X + inX * step;
    const z = ENTRANCE_GATE_Z + inZ * step;
    if (sinceDrawn >= 0) sinceDrawn += 1;
    else if (step > 0 && onDrawnPath(x, z)) sinceDrawn = 0;
    if (sinceDrawn > ESPLANADE_OVERLAP) break;
    out.push({ x, z });
  }
  return out;
}
