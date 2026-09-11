import { forEachPavedDisc } from '../paving';
import type { Claim } from '../../boot/groundClaims';
import { PATH_KERB_OVERHANG } from '../../core/constants';
import { ROAD_HALF_WIDTH } from './road';
import { entranceRoadInnerEdge, entranceRoadStations } from './roadRoute';
import { ENTRANCE_GATE_X, ENTRANCE_STOP_Z } from './layout';

/**
 * **What the entrance road *is* to everyone else — the one owner of its
 * segments and of the ground it claims.**
 *
 * The road is drawn by `Entrance.ts` and *claimed* by the round-robin
 * generator's `roadCorridor` task (`boot/parkGeneration.ts`). Before this
 * module existed there was nowhere for those two to agree: the centreline was
 * computed inside `buildEntranceRoad()`, a private function, so a claim could
 * only ever have been a second copy of it — CLAUDE.md's most expensive bug
 * shape, and the one thing `docs/DESIGN-round-robin-generation.md` exists to
 * stop. The builder and the claim now call {@link entranceRoadSegments} and use
 * what it returns verbatim; neither re-derives an endpoint.
 *
 * ## Two roads met, and this is the seam where they were closed
 *
 * This file and `roadRoute.ts` were written in parallel — step 1 of the
 * round-robin rework on `main`, #498's curved road on the sphere branch — and
 * for a few days the park had two descriptions of one road. Jim ruled the
 * resolution on 6 September 2026 (`docs/DESIGN-round-robin-generation.md`,
 * "Two roads met"): **one road, this file's shape, `roadRoute.ts`'s geometry.**
 *
 * So the division of labour is:
 *
 * - **`roadRoute.ts` owns where the road goes.** Its outset, its curve, its
 *   tails, the stations the bus drives along, its inner edge. Nothing about
 *   that line is restated here.
 * - **This file owns what that line means to the rest of the park**: the runs
 *   it breaks into, the ground each run occupies, and the claims committed to
 *   the registry.
 *
 * That is a chain with one owner at each link, not two definitions kept in
 * step by hand. The step-1 brief anticipated it in as many words — *"if it
 * lands later the claim follows its owner"* — which is why closing it moved no
 * geometry: the fourteen-seed park digest is unchanged across the merge.
 *
 * ## Why a curved road is many claims and not two
 *
 * A `capsule` claim is a straight segment swept by a half-width, and the kerb
 * is an arc. It is therefore sampled at the road's own station spacing — one
 * run per consecutive pair of {@link entranceRoadStations} — rather than at
 * some tolerance somebody typed. **There is deliberately no simplification
 * pass here.** A coarser polyline is a chord across the arc, and a chord's
 * capsule does not cover the ground the ribbon is actually drawn on; the
 * error would be invisible, small, and exactly where a child walks off the bus.
 * The stations are the road's own resolution, so claiming at that resolution
 * is exact by construction and costs a list rather than a decision.
 *
 * ## The ordering fact a caller has to know
 *
 * {@link entranceGatewayReach} asks `world/paving.ts`, and **paving is
 * published by `buildPaths()`, which `Garden` runs inside `new World(...)`** —
 * after park generation has entirely finished. So this function answers
 * differently depending on when it is called, and honestly so:
 *
 * - **During generation** (the `roadCorridor` scheduler task) no paving is
 *   published, `forEachPavedDisc` reports nothing is known, and the gateway is
 *   claimed all the way in to `ENTRANCE_STOP_Z`. That is the approach's full
 *   ground, which is the conservative and correct thing to claim while the
 *   park is still being decided.
 * - **At build time** (`Entrance.ts`, and the `roadCorridor` re-commit beside
 *   it) the paving is live, and the answer is the ground actually drawn on.
 *
 * This is not two definitions kept in step — it is one definition asked twice
 * about two different parks. What must never happen is a *cached* answer: the
 * pre-paving result baked in and served later would make the drawn approach
 * longer than it is today, which is a park that changed. There is deliberately
 * no memoisation here for that reason.
 */

/**
 * One straight run of the entrance road's ground.
 *
 * **Generalised from an axis-aligned run to an arbitrary `from → to`** when the
 * curved road landed: the pair of `across`/`along` axes and a `centre`
 * coordinate could only describe a ribbon parallel to a world axis, which the
 * kerb has not been since #498. A capsule claim was always an arbitrary
 * segment; this is the shape catching up with it.
 */
export interface RoadSegment {
  /** The mesh name `Entrance.ts` gives the ribbon this run belongs to. */
  readonly name: string;
  readonly from: { readonly x: number; readonly z: number };
  readonly to: { readonly x: number; readonly z: number };
  /** How far either side of the centreline this run's ground reaches. */
  readonly halfWidth: number;
}

/** The feature name the road commits its ground under. */
export const ROAD_FEATURE = 'road';

/** Where the run in from the road stops, and how wide the paving it meets is. */
export interface GatewayReach {
  readonly z: number;
  /** Half-width of the narrowest path covering the gate axis there. */
  readonly halfWidth: number;
}

/**
 * Fallback width for the run in through the gate on a seed whose paving never
 * reaches the gate (and in an interior harness with no garden at all), where
 * there is no path to take a width from. The park's own streets are 2.6 to
 * 3.6 m across, so this is one of them rather than a number of its own.
 */
const GATEWAY_PATH_FALLBACK_HALF_WIDTH = 1.6;

/**
 * **How far in through the gate the approach runs, and how wide it is.**
 *
 * The run used to go all the way to `ENTRANCE_STOP_Z`, which is inside the
 * plaza's paving — so its last five and a half metres were a slab drawn 5 mm
 * under a path slab, 24 m² of shared plane and the fourth-worst seam in the
 * game (#472). The paving wins that argument anyway (`path-surface` carries
 * `polygonOffset: -2`), so the surface under it is a hidden face, and
 * `ART_DIRECTION.md` §7's answer to a hidden face is to not draw it.
 *
 * The stopping line is *asked for*, not written down: a hard-coded `z` here
 * would be CLAUDE.md's "two definitions of one thing, kept in step by hand",
 * because the paths are generated per seed and this line moves with them. It
 * reads `forEachPavedDisc` rather than `pathGraph`'s own `distanceToPath` for
 * the reason that module exists: importing `pathGraph` *runs the whole path
 * solve*, and neither the road's builder nor its claim may be the thing that
 * triggers it.
 *
 * The centre of the run is the part that reaches the paving first, because the
 * path arrives head-on; stopping here therefore keeps the whole width off the
 * paving, and `Entrance.ts` then trims each column of it back further still
 * against the surface that column would otherwise lie on. **Every column stops
 * at or before this `z`**, which is what lets the claim below be exact rather
 * than approximate: this is the deepest ground the approach can occupy.
 */
export function entranceGatewayReach(): GatewayReach {
  const from = entranceRoadInnerEdge(0).z;
  for (let z = from; z >= ENTRANCE_STOP_Z; z -= 0.1) {
    let met: number | null = null;
    const known = forEachPavedDisc((x, discZ, radius) => {
      if (Math.hypot(ENTRANCE_GATE_X - x, z - discZ) < radius) {
        // The narrowest path covering the axis here, because that is the one
        // whose width the gateway path should match: joining a 1.3 m-wide
        // street with a ribbon sized off the plaza would step out at the seam.
        if (met === null || radius < met) met = radius;
      }
    });
    // Nothing published — generation time, or an interior harness with no
    // garden. Claim/build the whole way in, which is what the run was before
    // #472 trimmed it back off the paving.
    if (!known) return { z: ENTRANCE_STOP_Z, halfWidth: GATEWAY_PATH_FALLBACK_HALF_WIDTH };
    if (met !== null) return { z, halfWidth: met };
  }
  // No paving reaches the gate on this seed: run the whole way in, as before.
  return { z: ENTRANCE_STOP_Z, halfWidth: GATEWAY_PATH_FALLBACK_HALF_WIDTH };
}

/**
 * **The road, as straight runs of centreline.** Everything that draws or claims
 * the entrance road's ground reads this and nothing else.
 *
 * 1. The **kerb**, one run per pair of `roadRoute.ts`'s stations. It is a
 *    curve at a constant outset from the park's own edge, with a tail at each
 *    end climbing away over the brow of the hill — see `roadRoute.ts` for why
 *    a straight kerb cannot exist at any outset without a Rail Race trestle
 *    standing in the bus.
 * 2. The **gateway approach**, from the kerb's inner edge on the gate's axis in
 *    through the arch, stopping where the park's own paving already is.
 *
 * The second is drawn as an ordinary park path rather than as road (Jim,
 * 3 September 2026: *"the small run of path from the road into the park should
 * be just a normal path"*), but the ground it occupies is still the entrance's
 * to claim, and it is still the ground a child crosses between the bus and the
 * gate — so it stays a run of this corridor. Its half-width is the path's own
 * plus its kerb's overhang, which is the full width `Entrance.ts` draws.
 */
export function entranceRoadSegments(): readonly RoadSegment[] {
  const stations = entranceRoadStations();
  const segments: RoadSegment[] = [];
  for (let i = 1; i < stations.length; i += 1) {
    const previous = stations[i - 1] as { x: number; z: number };
    const here = stations[i] as { x: number; z: number };
    segments.push({
      name: 'entrance-road-kerb',
      from: { x: previous.x, z: previous.z },
      to: { x: here.x, z: here.z },
      halfWidth: ROAD_HALF_WIDTH,
    });
  }
  const gateway = entranceGatewayReach();
  segments.push({
    name: 'entrance-gateway-path',
    from: { x: ENTRANCE_GATE_X, z: entranceRoadInnerEdge(0).z },
    to: { x: ENTRANCE_GATE_X, z: gateway.z },
    halfWidth: gateway.halfWidth + PATH_KERB_OVERHANG,
  });
  return segments;
}

/**
 * The road's ground, as claims for the registry — one `corridor` capsule per
 * run of centreline, at that run's own half-width.
 *
 * `corridor` rather than `footprint` because a road is a thing that travels:
 * paths and stand spots are welcome on it, another corridor may only meet it at
 * a declared crossing, and nothing solid may share it.
 */
export function entranceRoadClaims(): readonly Claim[] {
  return entranceRoadSegments().map((segment) => ({
    kind: 'corridor' as const,
    shape: {
      shape: 'capsule' as const,
      x1: segment.from.x,
      z1: segment.from.z,
      x2: segment.to.x,
      z2: segment.to.z,
      halfWidth: segment.halfWidth,
    },
  }));
}
