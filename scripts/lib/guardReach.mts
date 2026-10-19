/**
 * **Is every guard taller than every jump she can make at it?** — the
 * railway's fences and posts and the bridges' parapets, measured against the
 * highest her feet can actually get over their line (`world/jumpReach.ts`):
 * from every point she can stand within a jump of it, on the side it guards
 * from, at any speed up to her sprint, with the lag a run down falling ground
 * leaves her at. QA on PR #722 found the railings measured only against the
 * deck beside them, and a sprint down a ramp cleared them by half a metre.
 *
 * Exhaustive and analytic — every guard point against every takeoff on a
 * quarter-metre grid — so "from every approach, down-slope from a crown
 * included" is a property of the instrument rather than of which runs a
 * script happened to try. `check:solids` confirms the nearest misses with her
 * own simulated sprint-jumps.
 */
import { Vector3 } from 'three';
import type { CollisionWorld, SolidView } from '../../src/world/Collision.ts';
import { GUARD_OVER_FEET, JUMP_PLAN_REACH, guardRadiusNeeded, riseOverTakeoff, type Takeoff } from '../../src/world/jumpReach.ts';
import { planetRadiusAt } from '../../src/world/terrain.ts';
import { standingHeight } from '../../src/world/standing.ts';

export type GroundSampler = (x: number, z: number, fromY: number) => number;

interface Route {
  distanceNear(x: number, z: number): number;
  pointAt(distance: number, into: Vector3): Vector3;
}

export interface GuardWorld {
  readonly collision: CollisionWorld;
  readonly sample: GroundSampler;
  readonly route: Route;
  /** Can her centre stand on a bridge's deck here (`Bridge.covers`)? */
  readonly onDeck: (x: number, z: number) => boolean;
  /** Is this plan point on or over a bridge's masonry at all (`Bridge.footprintNear`)? */
  readonly onBridge: (x: number, z: number) => boolean;
  /**
   * The waiting train's floor at this plan point, at any station
   * (`ParkTrain.dwellFloors`), or `-Infinity`: a floor she steps onto from the
   * platform and jumps from. The first cut called the parked train's floors
   * no takeoff at all, and her own sprint-jumps off one cleared a station's
   * end cap into the box (seed 8).
   */
  readonly dwellFloorAt: (x: number, z: number) => number;
}

/** What guards what: the fence keeps her off the line from outside it, a parapet keeps her on its deck. */
export const GUARD_KINDS: Readonly<Record<string, 'railway' | 'deck'>> = {
  'railway fence': 'railway',
  'railway fence post': 'railway',
  'bridge parapet': 'deck',
};

export interface GuardPoint {
  readonly solid: SolidView;
  readonly x: number;
  readonly z: number;
  /** The guard's top there, as a radius. */
  readonly top: number;
  /** The radius every jump at it needs it to stand to. */
  readonly need: number;
  /** The takeoff the need came from. */
  readonly from: Takeoff | null;
}

const GRID = 0.25;

/**
 * Every guard point (a quarter-metre along each guard's line; a post's
 * middle) with the radius it stands to and the radius it must, for `tops`
 * (each guard's own top, or a hypothetical one for a control).
 */
/**
 * A top she reached (`check:solids`' census): its solid, and its height as a
 * radius — where a jump at a guard can leave from, as the walk is.
 */
export interface TopTakeoff {
  readonly solid: SolidView;
  readonly radius: number;
}

export function measureGuards(world: GuardWorld, top?: (solid: SolidView, x: number, z: number) => number, tops: readonly TopTakeoff[] = []): GuardPoint[] {
  const { collision, sample, route, onDeck, onBridge, dwellFloorAt } = world;
  const guards: SolidView[] = [];
  collision.forEachSolid((solid) => {
    if (solid.kind in GUARD_KINDS && solid.topIsAbsolute && Number.isFinite(solid.topHeight)) guards.push(solid);
  });
  const rail = new Vector3();
  // Every solid by a 4 m grid, for "is she inside one here?".
  const BUCKET = 4;
  const buckets = new Map<number, SolidView[]>();
  const bucketKey = (i: number, j: number): number => (i + 32768) * 65536 + (j + 32768);
  collision.forEachSolid((solid) => {
    for (let i = Math.floor((solid.centreX - solid.reach) / BUCKET); i <= Math.floor((solid.centreX + solid.reach) / BUCKET); i += 1) {
      for (let j = Math.floor((solid.centreZ - solid.reach) / BUCKET); j <= Math.floor((solid.centreZ + solid.reach) / BUCKET); j += 1) {
        const k = bucketKey(i, j);
        let list = buckets.get(k);
        if (!list) buckets.set(k, (list = []));
        list.push(solid);
      }
    }
  });
  /** Is (x, z) inside a solid that stands over the ground there — nowhere to run? */
  const insideSolid = (x: number, z: number, ground: number): boolean => {
    for (const solid of buckets.get(bucketKey(Math.floor(x / BUCKET), Math.floor(z / BUCKET))) ?? []) {
      if (solid.depthAt(x, z) > 0 && solid.topAt(x, z) > ground + 0.05 && solid.baseAt(x, z) <= ground + 0.05) return true;
    }
    return false;
  };
  const railOffset = (x: number, z: number): { off: number; nx: number; nz: number } => {
    route.pointAt(route.distanceNear(x, z), rail);
    const off = Math.hypot(x - rail.x, z - rail.z);
    return { off, nx: off > 1e-6 ? (x - rail.x) / off : 0, nz: off > 1e-6 ? (z - rail.z) / off : 0 };
  };
  // Where she can run, on a grid over every guard's surroundings: the walk
  // surface itself — the ground, a deck, a platform. A jump from a top beside
  // a guard (a bench, a wall, a crate against the fence) is the census's own
  // question (`solidReach.mts`'s stage 4b, simulated with her real flight,
  // ceilings and all), so this is every run she can make on the walk to a
  // guard. Never the line itself: the corridor between the fences is a
  // closure (`CollisionWorld.closedAt`) — and a station's own stretch, which
  // has none, is where she stands to board. But a bridge's deck over the line
  // is hers: the closure is the ground under it, and the first cut left out
  // every takeoff on the span (seed 4: a sprint along the span and a jump
  // down the ramp went through a railing this instrument called tall enough).
  const cells = new Map<string, { x: number; z: number; radius: number }>();
  const key = (i: number, j: number): string => `${i},${j}`;
  const reach = JUMP_PLAN_REACH + GRID;
  for (const guard of guards) {
    const lo = (v: number): number => Math.floor((v - guard.reach - reach) / GRID);
    const hi = (v: number): number => Math.ceil((v + guard.reach + reach) / GRID);
    for (let i = lo(guard.centreX); i <= hi(guard.centreX); i += 1) {
      for (let j = lo(guard.centreZ); j <= hi(guard.centreZ); j += 1) {
        const k = key(i, j);
        if (cells.has(k)) continue;
        const x = i * GRID;
        const z = j * GRID;
        const ground = Math.max(sample(x, z, 1e3), dwellFloorAt(x, z));
        if (!Number.isFinite(ground)) continue;
        // Not where a solid stands: nobody runs inside a trunk or a booth.
        if ((collision.closedAt(x, z) && !onDeck(x, z)) || standingHeight(ground, collision, x, z, ground) > ground + 1e-6 || insideSolid(x, z, ground)) continue;
        cells.set(k, { x, z, radius: planetRadiusAt(x, ground, z) });
      }
    }
  }
  const takeoffs = new Map<string, Takeoff & { readonly deck: boolean; readonly bridge: boolean; readonly off: number; readonly nx: number; readonly nz: number }>();
  for (const [k, cell] of cells) {
    const [i, j] = k.split(',').map(Number) as [number, number];
    const east = cells.get(key(i + 1, j));
    const west = cells.get(key(i - 1, j));
    const north = cells.get(key(i, j + 1));
    const south = cells.get(key(i, j - 1));
    // The ground's fall where she runs: both one-sided differences, and only
    // where they agree — a kerb or a deck's edge is a step, not a slope.
    const slope = (a: { radius: number } | undefined, b: { radius: number } | undefined): number => {
      if (!a || !b) return 0;
      const ahead = (a.radius - cell.radius) / GRID;
      const behind = (cell.radius - b.radius) / GRID;
      if (Math.sign(ahead) !== Math.sign(behind) || Math.abs(ahead - behind) > 0.25) return 0;
      return (ahead + behind) / 2;
    };
    takeoffs.set(k, { x: cell.x, z: cell.z, radius: cell.radius, slopeX: slope(east, west), slopeZ: slope(north, south), deck: onDeck(cell.x, cell.z), bridge: onBridge(cell.x, cell.z), ...railOffset(cell.x, cell.z) });
  }
  const out: GuardPoint[] = [];
  for (const guard of guards) {
    const role = GUARD_KINDS[guard.kind]!;
    // Its line: the deepest points of its footprint (a post: its middle).
    const line: { x: number; z: number }[] = [];
    if (guard.shape === 'circle') line.push({ x: guard.centreX, z: guard.centreZ });
    else {
      for (let x = guard.centreX - guard.reach; x <= guard.centreX + guard.reach; x += GRID / 2) {
        for (let z = guard.centreZ - guard.reach; z <= guard.centreZ + guard.reach; z += GRID / 2) {
          if (guard.depthAt(x, z) >= guard.halfWidth - GRID / 4) line.push({ x, z });
        }
      }
    }
    for (const p of line) {
      // The takeoffs on the side it guards from, within a jump of it.
      const near: Takeoff[] = [];
      for (let i = Math.floor((p.x - reach) / GRID); i <= Math.ceil((p.x + reach) / GRID); i += 1) {
        for (let j = Math.floor((p.z - reach) / GRID); j <= Math.ceil((p.z + reach) / GRID); j += 1) {
          const q = takeoffs.get(key(i, j));
          if (!q) continue;
          if (guard.depthAt(q.x, q.z) > -0.05) continue;
          if (role === 'deck') {
            if (!q.deck) continue;
          } else {
            // From either side — anywhere she can stand, which the closures
            // already keep off the line inside a box — but off any bridge: a
            // jump from a deck meets its parapet first, which is that guard's
            // own question. A station's far fence is approached across its
            // own track from the platform, and the strip beyond it is ground
            // she could not get back from.
            if (q.bridge) continue;
          }
          near.push(q);
        }
      }
      let need = -Infinity;
      let from: Takeoff | null = null;
      for (const q of near) {
        const n = guardRadiusNeeded([q], p.x, p.z);
        if (n > need) {
          need = n;
          from = q;
        }
      }
      // And from every top she reached, within a jump of it — a railway
      // guard's, never a parapet's (nothing she reaches stands on a deck):
      // the highest her feet get over this point from the nearest of it, a
      // top being level (PR #722's review, round two: a bush 2 m off the
      // fence). Her census found these, by her own simulated jumps, so this
      // half measures the fence against what she does, not what the fence's
      // own builder guessed she could (`reachableTops`).
      if (role === 'railway') {
        for (const t of tops) {
          const apart = Math.max(0, -t.solid.depthAt(p.x, p.z));
          if (apart > JUMP_PLAN_REACH) continue;
          const n = t.radius + riseOverTakeoff(t.solid.centreX, t.solid.centreZ, p.x, p.z, apart) + GUARD_OVER_FEET;
          if (n > need) {
            need = n;
            from = { x: t.solid.centreX, z: t.solid.centreZ, radius: t.radius, slopeX: 0, slopeZ: 0 };
          }
        }
      }
      if (!Number.isFinite(need)) continue;
      const guardTop = top ? top(guard, p.x, p.z) : planetRadiusAt(p.x, guard.topAt(p.x, p.z), p.z);
      out.push({ solid: guard, x: p.x, z: p.z, top: guardTop, need, from });
    }
  }
  return out;
}
