import { CatmullRomCurve3, Vector3 } from 'three';
import {
  BUILDING_CENTRE_X,
  BUILDING_CENTRE_Z,
  BUILDING_HALF_X,
  BUILDING_HALF_Z,
} from '../../core/constants';
import { ANCHORS } from '../../world/anchors';
import type { CollisionWorld } from '../../world/Collision';
import { PLAZA, ROUTES, type RouteDefinition } from '../../world/paths';
import { STALL_STANDS } from '../../minigames/stallPlacement';
import { SPACE_GARDEN, spaceAt, type SpaceId } from '../../world/spaces';

/**
 * Where the children go, and how they get there.
 *
 * NPCs do **not** steer at a destination and hope. Nothing in this game has a
 * navmesh, and a dozen children homing on the fountain across a park full of
 * tree trunks produces exactly what you would expect: half of them stuck on a
 * trunk, vibrating, forever.
 *
 * Instead they walk a small graph of waypoints. The nodes **follow the real
 * path network in `world/paths.ts`** — the ring road, the plaza, and a spur to
 * each anchor — so a child crossing the park walks the paving a child would
 * actually walk. Nothing here is a typed-in coordinate: the seeds are *derived*
 * from the same exports the park is built from (see {@link SEEDS}). Edges are
 * not authored either: every candidate pair is walked at build time and kept
 * only if a character of NPC width fits along the whole straight line. Plant a
 * new tree across a shortcut and the shortcut removes itself.
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
 * ## Nothing here is typed in
 *
 * This table used to be forty hand-written coordinates that *traced* the path
 * network: ring-road nodes copied off the `main-loop` route, spur nodes copied
 * off each anchor's entrance. That is a copy, and a copy goes stale silently.
 *
 * ARCHITECTURE-DECISIONS **Decision 5** makes the park procedurally generated —
 * `ANCHORS` keeps its interface but its positions come from a solver, `ROUTES`
 * keeps its shape but its control points are grown, and the plaza moves to
 * wherever the fountain is placed. Every one of those forty coordinates would
 * have become a node in a hedge: not a crash, just children slowly walking
 * nowhere, which is exactly the bug class that cost a night in July.
 *
 * So the seeds are **built from the layout's own exports**, at module load,
 * before any of it is generated: {@link PLAZA} for the plaza ring,
 * {@link ROUTES} for the paving, {@link ANCHORS} for the entrances, and
 * `minigames/stallPlacement.ts` for the stall stands. Nothing changes here when
 * the generator lands, because there is nothing here to change.
 */

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
  readonly interesting: boolean;
}

/** Metres between waypoints sampled along a path. Comfortably under {@link MAX_EDGE}. */
const ROUTE_SPACING = 7;

/** How many waypoints ring the fountain. Six is what the plaza has always had. */
const PLAZA_RING_NODES = 6;

/** How far inside the plaza kerb its ring of waypoints sits. */
const PLAZA_EDGE_INSET = 0.8;

/**
 * Two seeds closer than this are the same place, and the first one wins.
 *
 * A spur's last sample and the entrance it arrives at land within a metre of
 * each other; so do a kiosk's stand point and the anchor entrance it stands on
 * (the ferris wheel's ticket booth *is* the anchor's entrance). Keeping both
 * would put two nodes in one patch of paving, which is a child choosing between
 * two identical destinations.
 */
const MERGE_DISTANCE = 1.2;

/**
 * The waypoints — **derived from the park's own layout exports**, never typed.
 *
 * Four sources, in the order they are added, which is also the order of
 * precedence when two land on the same spot (see {@link MERGE_DISTANCE}):
 *
 * 1. **The plaza kerb.** A ring just inside {@link PLAZA}'s edge. The fountain
 *    is in the middle, so a ring is the only shape that works, and this is the
 *    busiest place in the park — every one of them is `interesting`.
 * 2. **Every anchor entrance**, from {@link ANCHORS}. This is where a path spur
 *    arrives and where the sign stands: the place a child goes.
 * 3. **Every stall stand**, from `minigames/stallPlacement.ts` — the patch of
 *    grass in front of a counter, derived there from the booth's position and
 *    facing rather than measured off a map.
 * 4. **The paving itself.** Every route in {@link ROUTES} is sampled along its
 *    curve every {@link ROUTE_SPACING} metres, which gives the junctions
 *    between all of the above. Samples, not control points: a Catmull-Rom curve
 *    bows away from its controls on a bend, and control points on the ring road
 *    can be fifteen metres apart — further than an edge is allowed to be. The
 *    curve is rebuilt with the same parameters `paths.ts` builds it with, which
 *    is what `ui/ParkMap.ts` does to draw the same centreline.
 *
 * One thing is dropped, and it is the one thing nothing downstream can catch:
 * a sample inside the **facade**. The building's spur runs its last control
 * point into the solid scenery tower the front door is cut into, and that tower
 * is registered as four wall segments with *nothing inside*, so the collision
 * resolver reports its middle as clear and two waypoints in there happily see
 * each other across it. That is the mistake `scripts/check-waypoints.mts` fails
 * a build over, and {@link insideFacade} below tests the same rectangle from
 * the same four constants the checker uses — so what is seeded and what the
 * checker accepts cannot drift apart.
 *
 * Nothing else is filtered. An anchor's plot is *not* excluded: the ring road
 * runs straight through the ball pit's footprint, the dodgems' and the water
 * fight's entrances sit inside their own plots by design, and everything those
 * plots will eventually have built on them is real collision that the edge pass
 * can see for itself.
 *
 * Everything past this point is validated anyway — a seed inside a bush is
 * nudged or dropped by {@link findClearSpot}, an edge through a hedge never
 * forms, and a pocket nobody can walk to is marked unreachable and named at
 * boot. Deriving the seeds does not replace any of that; it stops the *inputs*
 * from silently describing last week's park.
 *
 * Exported for `scripts/check-waypoints.mts`, which is the build's guard
 * against the one mistake this table has actually made: a coordinate inside a
 * solid building. See that file — it fails a build rather than a child's
 * afternoon.
 */
export const SEEDS: readonly NodeSeed[] = buildSeeds();

function buildSeeds(): NodeSeed[] {
  const seeds: NodeSeed[] = [];

  const add = (x: number, z: number, interesting: boolean): void => {
    for (const seed of seeds) {
      const dx = seed.x - x;
      const dz = seed.z - z;
      if (dx * dx + dz * dz < MERGE_DISTANCE * MERGE_DISTANCE) return;
    }
    seeds.push({ x, z, interesting });
  };

  // 1. The plaza kerb, starting at the fountain approach (-Z) and going round.
  const plazaRadius = PLAZA.radius - PLAZA_EDGE_INSET;
  for (let i = 0; i < PLAZA_RING_NODES; i += 1) {
    const angle = -Math.PI / 2 + (i / PLAZA_RING_NODES) * Math.PI * 2;
    add(PLAZA.x + Math.cos(angle) * plazaRadius, PLAZA.z + Math.sin(angle) * plazaRadius, true);
  }

  // 2. Where each attraction is entered.
  for (const anchor of ANCHORS) add(anchor.entrance[0], anchor.entrance[1], true);

  // 3. Where a child stands to be served at each stall.
  for (const stand of STALL_STANDS) add(stand.x, stand.z, true);

  // 4. The paving between them.
  for (const route of ROUTES) {
    for (const point of sampleRoute(route)) {
      if (insideFacade(point.x, point.z)) continue;
      add(point.x, point.z, false);
    }
  }

  return seeds;
}

/**
 * Points every {@link ROUTE_SPACING} metres along a route's centreline.
 *
 * The curve is rebuilt exactly as `paths.ts` builds the ribbon it draws —
 * centripetal-ish Catmull-Rom, tension 0.4, closed for the ring road — so these
 * points are on the paving rather than near it. A closed route stops one sample
 * short of the end, which is where it started.
 */
function sampleRoute(route: RouteDefinition): { x: number; z: number }[] {
  const vectors = route.points.map(([x, z]) => new Vector3(x, 0, z));
  const curve = new CatmullRomCurve3(vectors, route.closed, 'catmullrom', 0.4);
  const steps = Math.max(1, Math.round(curve.getLength() / ROUTE_SPACING));
  const last = route.closed ? steps - 1 : steps;
  const point = new Vector3();
  const points: { x: number; z: number }[] = [];
  for (let i = 0; i <= last; i += 1) {
    curve.getPoint(i / steps, point);
    points.push({ x: point.x, z: point.z });
  }
  return points;
}

/**
 * Is this inside the big building's solid facade?
 *
 * The one place in the park where "a character fits here" is a lie: the facade
 * is four wall segments with nothing registered between them, so the resolver
 * finds the middle of a solid tower perfectly clear. The building's path spur
 * ends *inside* it — the last control point is the doorway approach seen from
 * the model's side — so sampling that route without this test seeds a waypoint
 * in a wall, which is precisely what `scripts/check-waypoints.mts` fails a
 * build for. Same four constants, same rectangle, so the two agree by
 * construction rather than by somebody keeping them in step.
 */
function insideFacade(x: number, z: number): boolean {
  return (
    x >= BUILDING_CENTRE_X - BUILDING_HALF_X &&
    x <= BUILDING_CENTRE_X + BUILDING_HALF_X &&
    z >= BUILDING_CENTRE_Z - BUILDING_HALF_Z &&
    z <= BUILDING_CENTRE_Z + BUILDING_HALF_Z
  );
}

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
