import { Vector3 } from 'three';
import { ANCHORS_BY_ID } from '../../world/anchors';
import type { CollisionWorld } from '../../world/Collision';
import { SPACE_GARDEN, spaceAt, type SpaceId } from '../../world/spaces';

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
 * ## What this is *not* for: the player's tap-to-walk
 *
 * This graph answers "which interesting place should a child head for next?".
 * It is deliberately not the map a finger is routed on — that is
 * `world/NavGrid.ts`, a half-metre lattice derived from the finished collision
 * world, and its own file comment gives the three reasons. Keep the two apart:
 * a waypoint is a *destination*, a lattice cell is a *patch of floor*.
 *
 * ## Somewhere a child could stand
 *
 * Three things had to be true of a waypoint, and only two of them were checked.
 *
 * 1. **A character of NPC width fits there.** {@link findClearSpot}, since the
 *    beginning: the scenery is scattered from a seed and nobody hand-checks
 *    forty coordinates against twelve hundred trees.
 * 2. **The straight line to a neighbour is walkable.** The edge pass below,
 *    also since the beginning.
 * 3. **A child can get there from where children are** — and nothing checked
 *    this at all. It is not implied by the other two: the big building's facade
 *    out in the garden is a hollow box of four wall segments with *nothing
 *    registered inside it*, so the resolver happily reports the middle of a
 *    solid tower as clear, and two waypoints in there happily see each other
 *    across the empty interior. That is exactly what two of the three old
 *    `indoors` seeds were — an island of two nodes inside the facade, joined to
 *    each other and to nothing else, saved from being spawn points only by an
 *    authored flag that lied about which space they were in.
 *
 * So the third test is now made, structurally and without knowing what a facade
 * is: keep the **largest connected component in each space**, and mark
 * everything else {@link PoiNode.reachable} `false`. A pocket of waypoints
 * nobody can walk to is a child standing in a bush however many of them there
 * are, and counting one node's neighbours can never see a pocket of two.
 *
 * ## Spaces
 *
 * The park is not one coordinate system: the building's interior is a floor
 * plate six hundred metres away, and Decision 3 gives every castle floor its
 * own origin beyond that. A node's space is therefore **derived** from where it
 * is ({@link spaceAt}), never authored — the one bug this file has actually had
 * was an authored `indoors: true` on three nodes that were in the garden. Edges
 * never join two spaces: {@link lineIsClear} would walk six hundred metres of
 * empty world between them and pronounce it fine. Crossing between spaces is a
 * *portal*, not a walk, and belongs to the building.
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
}

/**
 * The waypoints, as authored.
 *
 * Exported for `scripts/check-waypoints.mts`, which is the build's guard
 * against the one mistake this table has actually made: a coordinate inside a
 * solid building. See that file — it fails a build rather than a child's
 * afternoon.
 */
export const SEEDS: readonly NodeSeed[] = [
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

  // --- the big building: up the spur to the front door, and no further.
  //
  // There used to be three more here, flagged `indoors`, meant to be the lobby
  // and the hall. They were nothing of the sort. The interior is six hundred
  // metres away (`core/constants.ts`'s `INTERIOR_ORIGIN_X`); these three were at
  // x ≈ −30, which is *inside the facade* — the solid scenery tower out here in
  // the garden. Two of them (−29, −27) and (−34, −26) sat behind the lobby's
  // back wall in a part of the model that has no floor and no way in, joined to
  // each other and to nothing else. The third stood in the 1.8 m lobby, which
  // exists only so a child who keeps walking during the iris does not end up
  // inside a solid tower (`Building.registerFacadeCollision`) — an airlock, not
  // a place to loiter.
  //
  // Nothing replaces them. A waypoint is somewhere a child would *choose* to
  // go, and until Decision 3's S2 gives each castle floor its own space there
  // are no such places indoors — and no way for a child to reach them if there
  // were, because crossing the threshold is a six-hundred-metre teleport rather
  // than a walk. When S2 lands, indoor waypoints go in at the floor's own
  // origin and `spaceAt` will label them correctly without anyone saying so.
  { x: -19, z: -15 },
  { x: -23, z: -18 },
  { x: anchor.building.entrance[0], z: anchor.building.entrance[1], interesting: true },

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
  /**
   * Which place this is in — **derived from the coordinates**, never authored.
   *
   * The one bug this table has had was three nodes that claimed to be indoors
   * and were in the garden, inside the facade. A field nobody can write cannot
   * say that.
   */
  readonly space: SpaceId;
  /**
   * Can a child actually walk here from where children are?
   *
   * False for a waypoint stranded off the main body of its own space — see the
   * file comment. Such a node keeps its index (so every other node's
   * `neighbours` stays valid) but is never spawned on, never returned by
   * {@link PoiGraph.nearest}, and named at boot.
   */
  readonly reachable: boolean;
  /** Indices of every node reachable in a straight, unobstructed line. */
  readonly neighbours: number[];
}

/** Mutable while the graph is being assembled; frozen into `PoiNode` after. */
interface BuildingNode {
  readonly index: number;
  readonly x: number;
  readonly z: number;
  readonly interesting: boolean;
  readonly space: SpaceId;
  reachable: boolean;
  readonly neighbours: number[];
}

export class PoiGraph {
  readonly nodes: readonly PoiNode[];

  constructor(collision: CollisionWorld) {
    const probe = new Vector3();
    const nodes: BuildingNode[] = [];

    for (const seed of SEEDS) {
      const clear = findClearSpot(collision, seed.x, seed.z, probe);
      if (!clear) continue;
      nodes.push({
        index: nodes.length,
        x: clear.x,
        z: clear.z,
        interesting: seed.interesting ?? false,
        space: spaceAt(clear.x, clear.z),
        // Decided below, once there are edges to decide it from.
        reachable: false,
        neighbours: [],
      });
    }

    for (let a = 0; a < nodes.length; a += 1) {
      for (let b = a + 1; b < nodes.length; b += 1) {
        const from = nodes[a];
        const to = nodes[b];
        if (!from || !to) continue;
        // Two spaces are hundreds of metres apart with nothing in between, so
        // the clearance walk below would stroll from one to the other and
        // report a lovely wide path. Getting between places is a portal.
        if (from.space !== to.space) continue;
        const dx = to.x - from.x;
        const dz = to.z - from.z;
        if (dx * dx + dz * dz > MAX_EDGE * MAX_EDGE) continue;
        if (!lineIsClear(collision, from.x, from.z, to.x, to.z, probe)) continue;
        from.neighbours.push(b);
        to.neighbours.push(a);
      }
    }

    markReachable(nodes);
    this.nodes = nodes;
    reportStrandedNodes(nodes);
  }

  /** Nodes a child can actually be dropped onto: reachable, and out in the park. */
  spawnNodes(): PoiNode[] {
    return this.nodes.filter((node) => node.reachable && node.space === SPACE_GARDEN);
  }

  node(index: number): PoiNode | undefined {
    return this.nodes[index];
  }

  /**
   * Closest walkable node to a point — used to place a child at spawn, and to
   * put one back on the graph when an activity lets go of them.
   *
   * Confined to the asker's own space, and to nodes a child could walk to. Both
   * matter for the same reason: this is how a child *rejoins* the graph, so
   * handing back a waypoint they cannot reach strands them there until the leg
   * timeout, and handing back one in another place would walk them at a wall
   * six hundred metres away for as long as they were allowed to try.
   */
  nearest(x: number, z: number): PoiNode | null {
    const space = spaceAt(x, z);
    let best: PoiNode | null = null;
    let bestDistance = Infinity;
    for (const node of this.nodes) {
      if (!node.reachable || node.space !== space) continue;
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

/**
 * Marks the largest connected group of waypoints in each space, and only that.
 *
 * This is the "somewhere a child could stand" test the file comment describes,
 * and it is done structurally on purpose: it needs to know nothing about
 * facades, walls or buildings, so it catches the next pocket as readily as the
 * one that prompted it. Flood-filled with an explicit stack — forty-odd nodes,
 * once, at boot, but a recursive walk over a graph read from a table is a stack
 * overflow waiting for somebody to add enough waypoints.
 *
 * "Largest" rather than "connected to a named root" because there is no root to
 * name: the park's shape is authored and its main body is simply whichever
 * group most of the waypoints ended up in. A space whose waypoints genuinely
 * split in two halves would keep the bigger half and report the other, which is
 * the right way round — the reported half is either a mistake or a place that
 * needs a path built to it, and both want saying out loud.
 */
function markReachable(nodes: readonly BuildingNode[]): void {
  const componentOf = new Int32Array(nodes.length).fill(-1);
  /** Size of each component, and which space it belongs to. */
  const sizes: number[] = [];
  const spaces: SpaceId[] = [];
  const stack: number[] = [];

  for (const start of nodes) {
    if (componentOf[start.index] !== -1) continue;
    const component = sizes.length;
    sizes.push(0);
    spaces.push(start.space);

    componentOf[start.index] = component;
    stack.push(start.index);
    while (stack.length > 0) {
      const index = stack.pop();
      if (index === undefined) break;
      sizes[component] = (sizes[component] ?? 0) + 1;
      const node = nodes[index];
      if (!node) continue;
      for (const neighbour of node.neighbours) {
        if (componentOf[neighbour] !== -1) continue;
        componentOf[neighbour] = component;
        stack.push(neighbour);
      }
    }
  }

  /** The winning component in each space: the one with the most waypoints. */
  const mainOf = new Map<SpaceId, number>();
  for (let component = 0; component < sizes.length; component += 1) {
    const space = spaces[component];
    if (space === undefined) continue;
    const best = mainOf.get(space);
    if (best === undefined || (sizes[component] ?? 0) > (sizes[best] ?? 0)) {
      mainOf.set(space, component);
    }
  }

  for (const node of nodes) {
    node.reachable = componentOf[node.index] === mainOf.get(node.space);
  }
}

/**
 * Says out loud that a waypoint has been dropped, and where it was.
 *
 * Dropping it silently is what let three of them sit inside a solid tower for
 * weeks: the crowd looked fine, because a node nobody can reach is a node
 * nobody visits. A line in the console names the coordinate to go and look at.
 * A warning rather than a throw — a child's afternoon must not end because a
 * waypoint drifted into a bush, and the graph is already safe without it.
 * `scripts/check-waypoints.mts` is the half of this that fails a build.
 */
function reportStrandedNodes(nodes: readonly BuildingNode[]): void {
  const stranded = nodes.filter((node) => !node.reachable);
  if (stranded.length === 0) return;
  console.warn(
    `poiGraph: ${stranded.length} waypoint(s) nobody can walk to, and dropped — ` +
      stranded.map((node) => `(${node.x.toFixed(1)}, ${node.z.toFixed(1)})`).join(' ') +
      '. A waypoint stranded off the main path network is usually one that has ' +
      'drifted inside something solid.',
  );
}

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
