import { type TrainRoute } from '../../../src/world/train/route';
import { Vector3 } from 'three';
import { createCrossingScan, esplanadeSamples, siteForFlip, type CrossingScreenResult, type OffSiteCrossing } from '../../../src/world/train/crossingPredicate';
/**
 * **The drawn paths' off-site crossing screen** the plan's path builder asks.
 * Moved verbatim from `src/world/train/crossingPredicate.ts`. Build-time only.
 */

/**
 * **Do these drawn paths cross the railway anywhere no bridge was proven?**
 *
 * The commit-time asker of the predicate above. The generator's `pathGraph`
 * task calls this on the *candidate* graph's drawn samples before publishing
 * it, so a path crossing off-site becomes a refused decision naming the edge
 * rather than a throw out of scenery planting three systems later.
 *
 * Same scanner, same snap, same tolerances as {@link computeCrossings} — one
 * predicate with two askers. If these ever diverge, the generator would be
 * approving graphs the builder then refuses to build, which is seed 288.
 */
export function screenDrawnPathsForOffSiteCrossings(
  route: TrainRoute,
  samples: readonly { readonly x: number; readonly z: number; readonly run?: number }[],
  options: {
    /**
     * The whole drawn network, when `samples` is it: the walk in from the
     * arch to wherever that network takes over is then marched too, exactly as
     * {@link computeCrossings} marches it. Omitted for a partial candidate (one
     * spur's tail), whose esplanade is not yet knowable.
     */
    readonly esplanadeOver?: readonly { readonly x: number; readonly z: number; readonly halfWidth: number }[];
  } = {},
): CrossingScreenResult {
  const scan = createCrossingScan(route);
  for (const sample of samples) scan.consider(sample.x, sample.z, sample.run ?? -1);
  if (options.esplanadeOver) {
    for (const sample of esplanadeSamples(options.esplanadeOver)) scan.consider(sample.x, sample.z, -2);
  }
  const point = new Vector3();
  const fouls: OffSiteCrossing[] = [];
  for (const flip of scan.flipsWithRun()) {
    if (siteForFlip(route, flip.railDistance)) continue;
    route.pointAt(flip.railDistance, point);
    fouls.push({ railDistance: flip.railDistance, x: point.x, z: point.z, run: flip.run });
  }
  return { fouls, samplesScanned: samples.length };
}
