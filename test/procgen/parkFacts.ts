/**
 * **A built park, reduced to the facts an invariant can be stated about.**
 *
 * This is the vitest side of the philosophy `scripts/check-park.mts` is built
 * on: *a number an author writes down is a claim; a number derived from the
 * built object is a fact*. Nothing here describes what the generators are
 * supposed to do. Every field below is read back off a real `World` — the wall
 * runs `Scenery` actually stood up, the trees it actually planted, the curve
 * the train actually solved — so an invariant that passes has been proved
 * against the park, not against the rules that were meant to produce it.
 *
 * It complements `check:park` rather than replacing it. That script owns the
 * six invariants about whether the park *works* — routing, the waypoint graph,
 * rail exclusion — and holds them to a ratchet on one canonical seed. This
 * suite owns the invariants about whether the park's scattered furniture is
 * *placed sanely*, and holds them across many seeds with no allowances at all.
 */
import { Vector3 } from 'three';
import type { World } from '../../src/world/World.ts';

/** A wall run flattened to what a clearance test needs. */
export interface WallFact {
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  readonly halfWidth: number;
  /** Runs sharing this are one deliberately-joined structure (an L-piece). */
  readonly piece: number;
  readonly kind: string;
}

/**
 * A tree's true planar footprint.
 *
 * `FoliageOccluder.radius` is only the *widest single blob*, which for a
 * lollipop understates the tree: the small ball tucked beside the main canopy
 * sits `0.7 × radius` off the trunk and carries its own radius on top of that.
 * So the footprint is derived by walking every part the tree is actually built
 * from and taking the furthest that any of them reaches.
 */
export interface TreeFact {
  readonly x: number;
  readonly z: number;
  readonly footprint: number;
}

export interface PlotFact {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly boundingRadius: number;
}

/** A place a visitor must be able to stand: a doormat or a stall counter. */
export interface EntranceFact {
  readonly id: string;
  readonly x: number;
  readonly z: number;
}

/** One drawn path, sampled along its centre line. */
export interface RouteFact {
  readonly name: string;
  readonly length: number;
  /** Points every ~0.5 m along the centre line. */
  readonly points: readonly (readonly [number, number])[];
}

export interface ParkFacts {
  readonly seed: number;
  readonly world: World;
  readonly walls: readonly WallFact[];
  readonly trees: readonly TreeFact[];
  readonly lamps: readonly (readonly [number, number])[];
  readonly plots: readonly PlotFact[];
  readonly entrances: readonly EntranceFact[];
  readonly routes: readonly RouteFact[];
  /**
   * Pairs of plot ids the manifest deliberately puts close together, so the
   * overlap invariant can exempt exactly those and nothing else. See
   * `ManifestEntry.near` — "relations exist precisely to put things
   * deliberately close".
   */
  readonly nearPairs: ReadonlySet<string>;
  /** Distance from a point to the solved rail centre line. */
  readonly distanceToRail: (x: number, z: number) => number;
  /** Can a walker of `radius` stand here without being pushed out? */
  readonly isStandable: (x: number, z: number, radius?: number) => boolean;
  readonly buildMs: number;
}

/** Key for {@link ParkFacts.nearPairs}, order-independent. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Builds the park for `seed` and reads the facts back off it.
 *
 * The seed reaches `parkManifest.ts` the only way it can — through
 * `LGP_SEED`, which that file reads once at module load — so everything below
 * is imported *dynamically*, after the variable is set. That in turn means
 * **each seed needs its own module registry**, which is why the seeds are one
 * test file each and why `vitest.config.ts` keeps `isolate` on. The guard
 * below exists because getting that wrong is silent: a stale module cache
 * would hand every seed the same park and six green suites would be measuring
 * one park six times.
 */
export async function buildParkFacts(seed: number): Promise<ParkFacts> {
  process.env['LGP_SEED'] = String(seed);

  const { buildHeadlessPark } = await import('../../scripts/park-harness.mts');
  const { PARK_SEED, PARK_MANIFEST } = await import('../../src/world/parkManifest.ts');

  if (PARK_SEED !== seed) {
    throw new Error(
      `parkFacts: asked for seed ${seed} but the park built with ${PARK_SEED}. ` +
        'The module registry was reused across seeds — check that vitest is ' +
        'still isolating test files (vitest.config.ts) and that each seed has ' +
        'a file of its own.',
    );
  }

  const { world, buildMs } = buildHeadlessPark();

  const { PARK_LAYOUT } = await import('../../src/world/parkLayout.ts');
  const { ANCHORS } = await import('../../src/world/anchors.ts');
  const { ROUTES } = await import('../../src/world/paths.ts');
  const { STALL_STANDS } = await import('../../src/minigames/stallPlacement.ts');
  const { CatmullRomCurve3 } = await import('three');

  const walls: WallFact[] = world.scenery.wallRuns.map((run) => ({
    from: run.from,
    to: run.to,
    halfWidth: run.halfWidth,
    piece: run.piece,
    kind: run.kind,
  }));

  const trees: TreeFact[] = world.scenery.foliageOccluders.map((tree) => {
    let footprint = 0;
    for (const part of tree.parts) {
      if (part.kind === 'trunk') continue;
      const offset = Math.hypot(part.position.x - tree.x, part.position.z - tree.z);
      const reach = offset + Math.max(part.scale.x, part.scale.z);
      if (reach > footprint) footprint = reach;
    }
    return { x: tree.x, z: tree.z, footprint };
  });

  const plots: PlotFact[] = [...PARK_LAYOUT.entries.values()].map((entry) => ({
    id: entry.id,
    x: entry.x,
    z: entry.z,
    boundingRadius: entry.boundingRadius,
  }));

  const nearPairs = new Set<string>();
  for (const entry of PARK_MANIFEST) {
    if (entry.near) nearPairs.add(pairKey(entry.id, entry.near.id));
  }

  const entrances: EntranceFact[] = [
    ...ANCHORS.map((anchor) => ({
      id: `anchor:${anchor.id}`,
      x: anchor.entrance[0],
      z: anchor.entrance[1],
    })),
    ...STALL_STANDS.map((stand) => ({ id: `stall:${stand.id}`, x: stand.x, z: stand.z })),
  ];

  const routes: RouteFact[] = ROUTES.map((route) => {
    const curve = new CatmullRomCurve3(
      route.points.map(([x, z]) => new Vector3(x, 0, z)),
      route.closed,
      'catmullrom',
      0.4,
    );
    const length = curve.getLength();
    const steps = Math.max(8, Math.ceil(length / 0.5));
    const points: [number, number][] = [];
    for (let i = 0; i <= steps; i += 1) {
      const point = curve.getPointAt(i / steps);
      points.push([point.x, point.z]);
    }
    return { name: route.name, length, points };
  });

  // The *solved* curve, not the control points and not the corridor Scenery
  // planned against — those are what the fix used, so measuring them would
  // only restate the fix. `world.train.route` is what the train runs on, and
  // it exists whether the route is solved inside `ParkTrain` or handed to it
  // by a plan module.
  const route = world.train.route;
  const scratch = new Vector3();
  const distanceToRail = (x: number, z: number): number => {
    const point = route.pointAt(route.distanceNear(x, z), scratch);
    return Math.hypot(point.x - x, point.z - z);
  };

  const probe = new Vector3();
  const isStandable = (x: number, z: number, radius = 0.62): boolean => {
    probe.set(x, 0, z);
    world.collision.resolve(probe, radius);
    return Math.hypot(probe.x - x, probe.z - z) < 1e-3;
  };

  return {
    seed,
    world,
    walls,
    trees,
    lamps: world.lampPosts.positions.map((p) => [p.x, p.z] as const),
    plots,
    entrances,
    routes,
    nearPairs,
    distanceToRail,
    isStandable,
    buildMs,
  };
}

// ------------------------------------------------------------------ geometry

/** Closest approach between two segments. Zero if they cross. */
export function segmentDistance(
  a1: readonly [number, number],
  a2: readonly [number, number],
  b1: readonly [number, number],
  b2: readonly [number, number],
): number {
  if (segmentsCross(a1, a2, b1, b2)) return 0;
  return Math.min(
    pointToSegment(a1, b1, b2),
    pointToSegment(a2, b1, b2),
    pointToSegment(b1, a1, a2),
    pointToSegment(b2, a1, a2),
  );
}

function segmentsCross(
  a1: readonly [number, number],
  a2: readonly [number, number],
  b1: readonly [number, number],
  b2: readonly [number, number],
): boolean {
  const side = (
    p: readonly [number, number],
    q: readonly [number, number],
    r: readonly [number, number],
  ): number => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return (
    side(b1, b2, a1) !== side(b1, b2, a2) && side(a1, a2, b1) !== side(a1, a2, b2)
  );
}

export function pointToSegment(
  p: readonly [number, number],
  s1: readonly [number, number],
  s2: readonly [number, number],
): number {
  const dx = s2[0] - s1[0];
  const dz = s2[1] - s1[1];
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 1e-12) return Math.hypot(p[0] - s1[0], p[1] - s1[1]);
  let t = ((p[0] - s1[0]) * dx + (p[1] - s1[1]) * dz) / lengthSquared;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p[0] - (s1[0] + dx * t), p[1] - (s1[1] + dz * t));
}

/** Samples along a run, for tests that need distance-to-a-curve. */
export function alongRun(
  from: readonly [number, number],
  to: readonly [number, number],
  spacing = 0.4,
): (readonly [number, number])[] {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const steps = Math.max(2, Math.ceil(length / spacing));
  const points: (readonly [number, number])[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    points.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
  }
  return points;
}
