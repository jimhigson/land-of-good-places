import { PARK_BOUNDARY, edgeRadiusAt } from '../boundary';
import { forEachPavedDisc } from '../paving';
import type { Claim } from '../../boot/groundClaims';
import { CAT_BUS_LENGTH } from './catBus';
import { ROAD_HALF_WIDTH } from './road';
import {
  ENTRANCE_BUS_ARRIVE_X,
  ENTRANCE_BUS_STOP_Z,
  ENTRANCE_BUS_VANISH_X,
  ENTRANCE_GATE_X,
  ENTRANCE_STOP_Z,
} from './layout';

/**
 * **Where the entrance road runs — the one owner of its centreline.**
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
 * ## Neither end of this road is a constant, and that is the point
 *
 * It reads as two straight ribbons, so it is tempting to write the four numbers
 * down. Three of them are measured against the park as it stands:
 *
 * - The **kerb**'s two ends come from {@link kerbReach}, which marches outward
 *   from the gate axis and stops where the road's *inner* edge would re-enter
 *   the park. `PARK_BOUNDARY` is a spline pinned to 60 m on the gate's bearing
 *   and bulging to 92 m a few degrees either side (#115), so a straight kerb
 *   dives back inside the park at both ends of its run, at a different `x` on
 *   every seed.
 * - The **spur**'s inner end comes from {@link spurReach}, which walks in from
 *   the gate and stops the moment the plaza's own paving is already underneath
 *   it. That is #472's fix: the spur used to run on to `ENTRANCE_STOP_Z`, so
 *   its last five and a half metres were a road slab drawn 5 mm under a path
 *   slab — 24 m² of shared plane, the fourth-worst seam in the game. The
 *   paving is generated per seed, so this line moves per seed too.
 *
 * ## The ordering fact a caller has to know
 *
 * {@link spurReach} asks `world/paving.ts`, and **paving is published by
 * `buildPaths()`, which `Garden` runs inside `new World(...)`** — after park
 * generation has entirely finished. So this function answers differently
 * depending on when it is called, and honestly so:
 *
 * - **During generation** (the `roadCorridor` scheduler task) no paving is
 *   published, `forEachPavedDisc` reports nothing is known, and the spur is
 *   claimed all the way in to `ENTRANCE_STOP_Z`. That is the road's full
 *   ground, which is the conservative and correct thing to claim while the
 *   park is still being decided.
 * - **At build time** (`Entrance.ts`, and the `roadCorridor` re-commit beside
 *   it) the paving is live, and the answer is the road that is actually drawn.
 *
 * This is not two definitions kept in step — it is one definition asked twice
 * about two different parks. What must never happen is a *cached* answer: the
 * pre-paving result baked in and served later would make the drawn road longer
 * than it is today, which is a park that changed. There is deliberately no
 * memoisation here for that reason.
 */

/** Which world axis a ribbon runs across, and which along. */
export interface RoadSegment {
  /** The mesh name `Entrance.ts` gives this ribbon. */
  readonly name: string;
  readonly from: { readonly x: number; readonly z: number };
  readonly to: { readonly x: number; readonly z: number };
  /** Which world axis runs across the carriageway. */
  readonly across: 'x' | 'z';
  /** Which world axis runs along it. */
  readonly along: 'x' | 'z';
  /** Where the centre line sits on the `across` axis. */
  readonly centre: number;
}

/** The feature name the road commits its ground under. */
export const ROAD_FEATURE = 'road';

/**
 * How far along the kerb the road can run, in `direction`, before its inner
 * edge is inside the park.
 *
 * Asks `PARK_BOUNDARY` itself rather than restating a number once derived from
 * it — the same reason `ENTRANCE_BUS_ARRIVE_X` is a measured number rather than
 * a symmetrical one.
 */
function kerbReach(direction: -1 | 1): number {
  // The road's inner edge is the part that would enter the park first.
  const edgeZ = ENTRANCE_BUS_STOP_Z - ROAD_HALF_WIDTH;
  let reach = 0;
  for (let x = 0; x <= 60; x += 0.5) {
    const at = direction * x;
    if (Math.hypot(at, edgeZ) < edgeRadiusAt(PARK_BOUNDARY, Math.atan2(edgeZ, at))) break;
    reach = x;
  }
  return reach;
}

/**
 * How far in through the gate the spur runs before the park's own paving is
 * already under it.
 *
 * The road's centre is the part that reaches the paving first, because the path
 * arrives head-on; stopping the whole ribbon there therefore keeps its wings off
 * the paving too. Nothing walkable is lost — the paving carries on from the
 * exact line the road stops at.
 *
 * Reads `forEachPavedDisc` rather than `pathGraph`'s own `distanceToPath` for
 * the reason `paving.ts` exists: importing `pathGraph` *runs the whole path
 * solve*, and neither the road's builder nor its claim may be the thing that
 * triggers it.
 */
function spurReach(): number {
  const from = ENTRANCE_BUS_STOP_Z - ROAD_HALF_WIDTH;
  for (let z = from; z >= ENTRANCE_STOP_Z; z -= 0.1) {
    let paved = false;
    const known = forEachPavedDisc((x, discZ, radius) => {
      if (Math.hypot(ENTRANCE_GATE_X - x, z - discZ) < radius) paved = true;
    });
    // Nothing published — generation time, or an interior harness with no
    // garden. Claim/build the whole way in, which is what the road was before
    // #472 trimmed it back off the paving.
    if (!known) return ENTRANCE_STOP_Z;
    if (paved) return z;
  }
  // No paving reaches the gate on this seed: run the whole way in.
  return ENTRANCE_STOP_Z;
}

/**
 * **The road, as two straight runs of centreline.** Everything that draws or
 * claims the entrance road reads this and nothing else.
 *
 * 1. The **kerb**, along the bus's own stopping line outside the wall. Long
 *    enough to cover the whole run the bus drives so it is never on grass —
 *    `ENTRANCE_BUS_ARRIVE_X` in, `ENTRANCE_BUS_VANISH_X` out, plus half a bus
 *    either end for its own length — clipped to what the boundary allows.
 * 2. The **spur**, from the kerb's **inner** edge in through the gate opening.
 *    Starting at the inner rather than the outer edge is #472's other half: an
 *    outer-edge start ran the spur straight across the full 7.78 m width of the
 *    kerb, a 48 m² slab of road on another slab of road 0.08 mm apart, and the
 *    single worst coplanar seam in the game. The two abut exactly at
 *    `ENTRANCE_BUS_STOP_Z - ROAD_HALF_WIDTH`, so the surface is still
 *    traceable from outside the wall to inside it, which is the thing this road
 *    exists to do.
 */
export function entranceRoadSegments(): readonly RoadSegment[] {
  const halfBus = CAT_BUS_LENGTH / 2;
  const kerbTo = Math.min(kerbReach(1), ENTRANCE_BUS_ARRIVE_X + halfBus);
  const kerbFrom = -Math.min(kerbReach(-1), Math.abs(ENTRANCE_BUS_VANISH_X) + halfBus);
  return [
    {
      name: 'entrance-road-kerb',
      from: { x: kerbFrom, z: ENTRANCE_BUS_STOP_Z },
      to: { x: kerbTo, z: ENTRANCE_BUS_STOP_Z },
      across: 'z',
      along: 'x',
      centre: ENTRANCE_BUS_STOP_Z,
    },
    {
      name: 'entrance-road-gateway',
      from: { x: ENTRANCE_GATE_X, z: ENTRANCE_BUS_STOP_Z - ROAD_HALF_WIDTH },
      to: { x: ENTRANCE_GATE_X, z: spurReach() },
      across: 'x',
      along: 'z',
      centre: ENTRANCE_GATE_X,
    },
  ];
}

/**
 * The road's ground, as claims for the registry — one `corridor` capsule per
 * run of centreline, at the carriageway's own half-width.
 *
 * `corridor` rather than `footprint` because a road is a thing that travels:
 * paths and stand spots are welcome on it, another corridor may only meet it at
 * a declared crossing, and nothing solid may share it. Two claims rather than
 * one because the road turns a corner at the gate, and a capsule is a straight
 * segment.
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
      halfWidth: ROAD_HALF_WIDTH,
    },
  }));
}
