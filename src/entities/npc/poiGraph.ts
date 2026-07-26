import { Vector3 } from 'three';
import { ANCHORS_BY_ID } from '../../world/anchors';
import type { CollisionWorld } from '../../world/Collision';

/**
 * Where the children go, and how they get there.
 *
 * NPCs do **not** steer at a destination and hope. Nothing in this game has a
 * navmesh, and a dozen children homing on the fountain across a park full of
 * tree trunks produces exactly what you would expect: half of them stuck on a
 * trunk, vibrating, forever.
 *
 * Instead they walk a small graph of waypoints. The nodes are authored to
 * follow the real path network in `world/paths.ts` — the ring road, the plaza,
 * and a spur to each anchor — so a child crossing the park walks the paving a
 * child would actually walk. Edges are **not** authored: every candidate pair
 * is walked at build time and kept only if a character of NPC width fits along
 * the whole straight line. Plant a new tree across a shortcut and the shortcut
 * removes itself.
 *
 * The nodes marked `interesting` are the destinations worth stopping at — the
 * fountain, the ball pit lip, the building door, the plots where the rides are
 * coming. The rest are junctions to pass through.
 *
 * Known follow-up: the ring-road coordinates below mirror the `main-loop` route
 * in `paths.ts`, which does not export its control points. Exporting them and
 * deriving these would be the tidy fix; the validation pass means a drift shows
 * up as dropped edges rather than as children walking through a hedge.
 */

const anchor = ANCHORS_BY_ID;

/** Longest straight line between two waypoints. Keeps chords near the paving. */
const MAX_EDGE = 13;

/** Half-width a waypoint route is tested against — a little wider than an NPC. */
const CLEARANCE = 0.7;

/** Metres between clearance samples along a candidate edge. */
const SAMPLE_STEP = 0.55;

interface NodeSeed {
  readonly x: number;
  readonly z: number;
  /** Somewhere worth stopping and looking at, rather than a junction. */
  readonly interesting?: boolean;
  /** Inside the building. Used to keep most of the crowd outdoors. */
  readonly indoors?: boolean;
}

const SEEDS: readonly NodeSeed[] = [
  // --- the ring road, with midpoints so a straight chord stays on the paving
  { x: 0, z: -21 },
  { x: 7.5, z: -21 },
  { x: 15, z: -20 },
  { x: 24, z: -12 },
  { x: 25, z: -5 },
  { x: 25, z: 2 },
  { x: 22, z: 8.8 },
  { x: 18, z: 15 },
  { x: 11, z: 19.2 },
  { x: 4, z: 22 },
  { x: -4, z: 22.5 },
  { x: -12, z: 22 },
  { x: -23, z: 13 },
  { x: -24.5, z: 5 },
  { x: -24, z: -3 },
  { x: -17, z: -16 },
  { x: -9, z: -19 },

  // --- the fountain plaza: the busiest place in the park
  { x: 0, z: -15 },
  { x: 0, z: -9, interesting: true },
  { x: 7, z: -5, interesting: true },
  { x: 8, z: 3, interesting: true },
  { x: 0, z: 8, interesting: true },
  { x: -8, z: 3, interesting: true },
  { x: -7, z: -5, interesting: true },

  // --- grass shortcuts off the plaza. Dropped automatically if a tree is in
  //     the way, which is why they can be optimistic.
  { x: 13, z: 8 },
  { x: -13, z: 9 },

  // --- the ball pit lip
  { x: -2, z: -16 },
  { x: -4, z: -12 },
  { x: anchor.ballPit.entrance[0], z: anchor.ballPit.entrance[1], interesting: true },
  { x: -8, z: -8.5, interesting: true },

  // --- the big building: up the spur, through the front door, into the hall
  { x: -19, z: -15 },
  { x: -23, z: -18 },
  { x: anchor.building.entrance[0], z: anchor.building.entrance[1], interesting: true },
  { x: -29, z: -23, indoors: true },
  { x: -29, z: -27, interesting: true, indoors: true },
  { x: -34, z: -26, interesting: true, indoors: true },

  // --- the plots where the rides are coming
  { x: 24, z: -11 },
  { x: anchor.ferrisWheel.entrance[0], z: anchor.ferrisWheel.entrance[1], interesting: true },
  { x: 29, z: -19, interesting: true },
  { x: 19, z: 13 },
  { x: anchor.dodgems.entrance[0], z: anchor.dodgems.entrance[1], interesting: true },
  { x: 26, z: 17, interesting: true },
  { x: -19, z: 17 },
  { x: anchor.waterFight.entrance[0], z: anchor.waterFight.entrance[1], interesting: true },
  { x: -25, z: 20, interesting: true },
];

export interface PoiNode {
  readonly index: number;
  readonly x: number;
  readonly z: number;
  readonly interesting: boolean;
  readonly indoors: boolean;
  /** Indices of every node reachable in a straight, unobstructed line. */
  readonly neighbours: number[];
}

export class PoiGraph {
  readonly nodes: readonly PoiNode[];

  constructor(collision: CollisionWorld) {
    const probe = new Vector3();
    const nodes: PoiNode[] = [];

    for (const seed of SEEDS) {
      const clear = findClearSpot(collision, seed.x, seed.z, probe);
      if (!clear) continue;
      nodes.push({
        index: nodes.length,
        x: clear.x,
        z: clear.z,
        interesting: seed.interesting ?? false,
        indoors: seed.indoors ?? false,
        neighbours: [],
      });
    }

    for (let a = 0; a < nodes.length; a += 1) {
      for (let b = a + 1; b < nodes.length; b += 1) {
        const from = nodes[a];
        const to = nodes[b];
        if (!from || !to) continue;
        const dx = to.x - from.x;
        const dz = to.z - from.z;
        if (dx * dx + dz * dz > MAX_EDGE * MAX_EDGE) continue;
        if (!lineIsClear(collision, from.x, from.z, to.x, to.z, probe)) continue;
        from.neighbours.push(b);
        to.neighbours.push(a);
      }
    }

    // A node nobody can reach is a child standing in a bush. Drop them, but
    // keep the indices stable by leaving the entries in place and never
    // choosing one as a spawn point (see `spawnNodes`).
    this.nodes = nodes;
  }

  /** Nodes a child can actually be dropped onto: connected, and outdoors. */
  spawnNodes(): PoiNode[] {
    return this.nodes.filter((node) => node.neighbours.length > 0 && !node.indoors);
  }

  node(index: number): PoiNode | undefined {
    return this.nodes[index];
  }

  /** Closest connected node to a point — used to place a child at spawn. */
  nearest(x: number, z: number): PoiNode | null {
    let best: PoiNode | null = null;
    let bestDistance = Infinity;
    for (const node of this.nodes) {
      if (node.neighbours.length === 0) continue;
      const dx = node.x - x;
      const dz = node.z - z;
      const distance = dx * dx + dz * dz;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = node;
      }
    }
    return best;
  }
}

// ------------------------------------------------------------------ helpers

/** Rings searched around a blocked waypoint before giving up on it. */
const NUDGES: readonly (readonly [number, number])[] = [
  [0, 0],
  [1.1, 0],
  [-1.1, 0],
  [0, 1.1],
  [0, -1.1],
  [0.8, 0.8],
  [-0.8, 0.8],
  [0.8, -0.8],
  [-0.8, -0.8],
  [2.2, 0],
  [-2.2, 0],
  [0, 2.2],
  [0, -2.2],
];

/**
 * The nearest spot to (x, z) where a character of NPC width actually fits.
 *
 * Authored waypoints are approximate — the scenery is scattered from a seed and
 * nobody hand-checks forty coordinates against twelve hundred trees. A metre or
 * two of search turns "that one is inside a bush" into "that one is beside a
 * bush", which is where a child would have stood anyway.
 */
function findClearSpot(
  collision: CollisionWorld,
  x: number,
  z: number,
  probe: Vector3,
): { x: number; z: number } | null {
  for (const [dx, dz] of NUDGES) {
    if (isClear(collision, x + dx, z + dz, probe)) return { x: x + dx, z: z + dz };
  }
  return null;
}

/** Would a character standing here be pushed out of something? */
function isClear(collision: CollisionWorld, x: number, z: number, probe: Vector3): boolean {
  probe.set(x, 0, z);
  collision.resolve(probe, CLEARANCE);
  const dx = probe.x - x;
  const dz = probe.z - z;
  return dx * dx + dz * dz < 1e-6;
}

/** Walks the straight line between two points, testing clearance as it goes. */
function lineIsClear(
  collision: CollisionWorld,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  probe: Vector3,
): boolean {
  const length = Math.hypot(x2 - x1, z2 - z1);
  const steps = Math.max(1, Math.ceil(length / SAMPLE_STEP));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    if (!isClear(collision, x1 + (x2 - x1) * t, z1 + (z2 - z1) * t, probe)) return false;
  }
  return true;
}
