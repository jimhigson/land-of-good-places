import { Vector3 } from 'three';
import {
  BUILDING_HALF_X,
  BUILDING_HALF_Z,
  CASTLE_TURRET_BASE_RADIUS,
  CASTLE_TURRET_CORNERS,
} from '../../core/constants';
import { BUILDING_CENTRE_X, BUILDING_CENTRE_Z } from '../../world/building/layout';
import { ANCHORS } from '../../world/anchors';
import { PLAZA, type RouteDefinition } from '../../world/paths';
import { ROUTES, routeCurve } from '../../world/pathGraph';
import { STALL_STANDS } from '../../minigames/stallPlacement';
import { TRAIN_PLAN } from '../../world/train/plan';
import { SPACE_GARDEN, spaceAt, type SpaceId } from '../../world/spaces';
import { ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z } from '../../world/entrance/layout';
import { TOP_REFERENCE, type NavGrid } from '../../world/NavGrid';
import type { GroundSampler } from '../Player';

/**
 * Where the children go.
 *
 * A small table of waypoints — the plaza kerb, every attraction's door, every
 * stall's stand, the stations, and the paving between them — that answers two
 * questions at boot: **where may a child be put down**, and **which waypoint
 * is nearest when she rejoins the crowd**. Nothing here is a typed-in
 * coordinate: the seeds are *derived* from the same exports the park is built
 * from (see {@link SEEDS}), so a waypoint cannot describe last week's park.
 *
 * ## One owner of "can a child get there"
 *
 * A waypoint is only worth standing a child on if she can walk from it to
 * the rest of the park, and the rest of the park to it. Until 6 September
 * 2026 this file decided that with an instrument of its own: straight chords
 * between nearby nodes, walked against the collision world at 0.7 m
 * clearance, then the largest connected component per space. Nobody walked
 * those chords — since #350 every child is routed by the player's own
 * `NavGrid` (`journey.ts`) — so the graph could, and did, disagree with the
 * feet it was classifying for. Measured on seed 13: **83 of 224 waypoints
 * "stranded"**, every one of them reachable by every child, because the
 * chords crossed the lineside fence and the bridge parapets while NavGrid
 * walked round the railway's western end on grass. Seed 15: a whole spur
 * cut where its lane crossed a ramp sideways, while NavGrid rode the bridge
 * lengthwise and stepped off the ramp's toe.
 *
 * So there is one instrument now, the Architect's ruling of 6 September:
 * **`reachable` is `NavGrid.reachableFrom` the entrance, on the very grid the
 * `JourneyPlanner` routes the children on**, and a node *stands* wherever
 * `NavGrid.nearestStandable` puts it. NPC-reachable ⊇ player-reachable holds
 * by construction — it is the same flood — and `check:park`'s `poi.stranded`
 * means exactly "the children's own planner cannot reach this waypoint",
 * which is a defect in the drawn park every time it fires: a route sample
 * standing inside a bridge's side wall, a lane laid on the railway with no
 * deck under it, a station stand inside the fence's stamp. Those are what it
 * reports on seeds 6 and 13 today, by coordinate.
 *
 * ## What this is *not* for: the player's tap-to-walk
 *
 * This graph answers "where can a child legitimately stand, and which stand
 * is nearest?". It is deliberately not the map a finger is routed on — that
 * is `world/NavGrid.ts` itself, a half-metre lattice derived from the
 * finished collision world; this file only *asks* it. A waypoint is a
 * *destination*, a lattice cell is a *patch of floor*.
 *
 * ## Spaces
 *
 * The park is not one coordinate system: the building's interior is a floor
 * plate six hundred metres away, and Decision 3 gives every castle floor its
 * own origin beyond that. A node's space is therefore **derived** from where it
 * is ({@link spaceAt}), never authored — the one bug this file has actually had
 * was an authored `indoors: true` on three nodes that were in the garden.
 * Every seed below is a garden seed by construction (the one seed source that
 * could stray, a route sample inside the facade, is filtered), and the flood
 * is the garden's, from the entrance; a seed that turned out to be elsewhere
 * would need its own space's grid and its own root, so it is a thrown
 * programming error rather than a quiet misclassification.
 *
 * ## Nothing here is typed in
 *
 * This table used to be forty hand-written coordinates that *traced* the path
 * network. That is a copy, and a copy goes stale silently. ARCHITECTURE-
 * DECISIONS **Decision 5** makes the park procedurally generated, so the seeds
 * are **built from the layout's own exports**, at module load: {@link PLAZA}
 * for the plaza ring, {@link ROUTES} for the paving, {@link ANCHORS} for the
 * entrances, `minigames/stallPlacement.ts` for the stall stands, and the train
 * plan for the stations.
 */

/**
 * How far from its seed a waypoint may be moved to find somewhere to stand.
 *
 * Authored waypoints are approximate — the scenery is scattered from a seed and
 * nobody hand-checks forty coordinates against twelve hundred trees. A metre or
 * two of search turns "that one is inside a bush" into "that one is beside a
 * bush", which is where a child would have stood anyway. Exported so
 * `check:park` describes the same reach it was measured with.
 */
export const NUDGE_REACH = 2.2;

interface NodeSeed {
  readonly x: number;
  readonly z: number;
  /** Somewhere worth stopping and looking at, rather than a junction. */
  readonly interesting: boolean;
}

/**
 * Metres between waypoints sampled along a path. Four, so that a spur's last
 * sample lands within a doormat's reach and every junction gets a node of its
 * own — a child rejoining the crowd is handed the *nearest* node, and a sparse
 * spur hands her one a long walk back down it.
 */
const ROUTE_SPACING = 4;

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
 * Five sources, in the order they are added, which is also the order of
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
 * 4. **The train stations**: the stand (a place worth waiting at) and its
 *    approach point.
 * 5. **The paving itself.** Every route in {@link ROUTES} is sampled along its
 *    curve every {@link ROUTE_SPACING} metres, which gives the junctions
 *    between all of the above. Samples, not control points: a Catmull-Rom curve
 *    bows away from its controls on a bend. The curve is rebuilt with the same
 *    parameters `paths.ts` builds it with, which is what `ui/ParkMap.ts` does
 *    to draw the same centreline.
 *
 * One thing is dropped, and it is the one thing nothing downstream can catch:
 * a sample inside the **facade**. The building's spur runs its last control
 * point into the solid scenery tower the front door is cut into, and that tower
 * is registered as four wall segments with *nothing inside*, so a probe reports
 * its middle as clear. That is the mistake `scripts/check-waypoints.mts` fails
 * a build over, and {@link insideFacade} below tests the same rectangle from
 * the same four constants the checker uses — so what is seeded and what the
 * checker accepts cannot drift apart.
 *
 * Nothing else is filtered. An anchor's plot is *not* excluded: the ring road
 * runs straight through the ball pit's footprint, the dodgems' and the water
 * fight's entrances sit inside their own plots by design, and everything those
 * plots will eventually have built on them is real collision the grid can see
 * for itself.
 *
 * Exported for `scripts/check-waypoints.mts` and `scripts/check-park.mts`.
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

  // 4. The train stations: the stand (a place worth waiting at) and its
  // approach point, where the spur turns onto the platform.
  for (const station of TRAIN_PLAN.stations) {
    add(station.approachX, station.approachZ, false);
    add(station.standX, station.standZ, true);
  }

  // 5. The paving between them.
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
 * `routeCurve` is the one owner of the drawn shape (fillets included) —
 * sampling anything else would seed waypoints beside the real paving. A closed
 * route stops one sample short of the end, which is where it started.
 */
function sampleRoute(route: RouteDefinition): { x: number; z: number }[] {
  const curve = routeCurve(route);
  const point = new Vector3();
  const steps = Math.max(1, Math.round(curve.getLength() / ROUTE_SPACING));
  const last = route.closed ? steps - 1 : steps;
  const points: { x: number; z: number }[] = [];
  for (let i = 0; i <= last; i += 1) {
    // getPointAt, not getPoint: parameter-uniform sampling gives each control
    // segment the same number of samples however long it is, and one long
    // segment on an otherwise-knotty spur went 27 m with no waypoint in it.
    // Arc-length sampling makes "every ROUTE_SPACING metres" actually true.
    curve.getPointAt(i / steps, point);
    points.push({ x: point.x, z: point.z });
  }
  return points;
}

/**
 * Is this inside the big building's solid stonework — its facade **or one of
 * its four corner turrets**?
 *
 * The building's path spur ends *inside* the facade (its last control point is
 * the doorway approach seen from the model's side), so sampling that route
 * without this test seeds a waypoint in a wall, which is what
 * `scripts/check-waypoints.mts` fails a build for.
 *
 * **The turrets are here because of #549, and their absence used to be
 * invisible.** This tested the 24 x 18 rectangle alone, and the turrets stand
 * *outside* it — so a path sample beside one was seeded as a waypoint. Nothing
 * complained, because the turrets had no collider: the graph asked "does a
 * child fit here?", the resolver said yes, and she would have been standing
 * inside drawn stone. The moment the turrets became solid, that seed had
 * nowhere within 2.2 m a child fits and `check:park-pool` failed pool seed 5
 * with `poi.nospot: 1` — measured, the seed sat **0.57 m from tower-body-3's
 * axis**, well inside its 2.214 m stone.
 *
 * That is the same omission as the missing collider and as the layout solver's
 * doormat-in-a-turret, in a third place. All of them now ask one owner:
 * `CASTLE_TURRET_CORNERS` and `CASTLE_TURRET_BASE_RADIUS`.
 */
function insideFacade(x: number, z: number): boolean {
  const inRectangle =
    x >= BUILDING_CENTRE_X - BUILDING_HALF_X &&
    x <= BUILDING_CENTRE_X + BUILDING_HALF_X &&
    z >= BUILDING_CENTRE_Z - BUILDING_HALF_Z &&
    z <= BUILDING_CENTRE_Z + BUILDING_HALF_Z;
  if (inRectangle) return true;
  for (const [cx, cz] of CASTLE_TURRET_CORNERS) {
    const dx = x - (BUILDING_CENTRE_X + cx);
    const dz = z - (BUILDING_CENTRE_Z + cz);
    if (dx * dx + dz * dz < CASTLE_TURRET_BASE_RADIUS * CASTLE_TURRET_BASE_RADIUS) return true;
  }
  return false;
}

export interface PoiNode {
  readonly index: number;
  readonly x: number;
  readonly z: number;
  /** The standing height the grid placed this node at. */
  readonly y: number;
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
   * Can a child actually walk here from the entrance, on the grid the
   * children route on? False is a defect in the drawn park (see the file
   * comment). Such a node keeps its index but is never spawned on, never
   * returned by {@link PoiGraph.nearest}, and named at boot.
   */
  readonly reachable: boolean;
}

/**
 * What a `PoiGraph` places and classifies its waypoints with: **the grid the
 * children route on**, and the ground sampler it was built with. Handed in
 * by `NpcSystem` from its `JourneyPlanner` and by `check:park` from the grid
 * it routes the attractions with, so the graph can never hold an opinion
 * about reachability that the feet it serves do not share.
 */
export interface PoiReach {
  readonly grid: NavGrid;
  readonly sample: GroundSampler;
}

export class PoiGraph {
  readonly nodes: readonly PoiNode[];
  /**
   * Seeds with nowhere to stand within {@link NUDGE_REACH} — dropped before a
   * node was made, and reported by coordinate rather than as a count. A seed
   * lands here when the drawn paving it was sampled from is itself inside a
   * collider: `check:park`'s `poi.nospot`.
   */
  readonly noSpot: readonly NodeSeed[];

  constructor(reach: PoiReach) {
    const { grid, sample } = reach;

    // The flood: everything a child can walk to from where children start.
    // One pass over the lattice, then a predicate — measured at 7 ms on seed
    // 13 against 1.4 s of per-waypoint routes, and identical to them.
    const entranceY = sample(ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z, TOP_REFERENCE);
    const reachable = grid.reachableFrom(ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z, entranceY, sample);
    if (!reachable) {
      throw new Error(
        `poiGraph: nowhere to stand at the entrance (${ENTRANCE_PLAYER_X}, ${ENTRANCE_PLAYER_Z}) — ` +
          'the garden has no lattice, so no waypoint can be classified',
      );
    }

    const nodes: PoiNode[] = [];
    const noSpot: NodeSeed[] = [];
    for (const seed of SEEDS) {
      const space = spaceAt(seed.x, seed.z);
      if (space !== SPACE_GARDEN) {
        throw new Error(
          `poiGraph: seed (${seed.x.toFixed(1)}, ${seed.z.toFixed(1)}) is in space '${space}', ` +
            "but this graph floods the garden's grid from the entrance — a seed elsewhere needs " +
            'its own grid and its own root',
        );
      }
      // Stand it where the grid says a child can stand, preferring a spot the
      // flood reaches; failing that the nearest standable spot, which is then
      // an honestly stranded node; failing that, nowhere.
      const y = sample(seed.x, seed.z, TOP_REFERENCE);
      const spot = grid.nearestStandable(seed.x, seed.z, y, sample, NUDGE_REACH, reachable);
      if (!spot) {
        noSpot.push(seed);
        continue;
      }
      nodes.push({
        index: nodes.length,
        x: spot.x,
        z: spot.z,
        y: spot.y,
        interesting: seed.interesting,
        space,
        reachable: reachable(spot.x, spot.z, spot.y),
      });
    }

    this.nodes = nodes;
    this.noSpot = noSpot;
    reportStrandedNodes(nodes, noSpot);
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

/**
 * Says out loud that a waypoint has been dropped or stranded, and where it was.
 *
 * Dropping it silently is what let three of them sit inside a solid tower for
 * weeks: the crowd looked fine, because a node nobody can reach is a node
 * nobody visits. A line in the console names the coordinate to go and look at.
 * A warning rather than a throw — a child's afternoon must not end because a
 * waypoint drifted into a bush, and the graph is already safe without it.
 * `scripts/check-park.mts` is the half of this that fails a build.
 */
function reportStrandedNodes(nodes: readonly PoiNode[], noSpot: readonly NodeSeed[]): void {
  const stranded = nodes.filter((node) => !node.reachable);
  if (stranded.length > 0) {
    console.warn(
      `poiGraph: ${stranded.length} waypoint(s) the children's grid cannot reach from the entrance, ` +
        'and dropped — ' +
        stranded.map((node) => `(${node.x.toFixed(1)}, ${node.z.toFixed(1)})`).join(' ') +
        '. A waypoint no route reaches is standing on drawn paving that is inside something ' +
        'solid — a bridge side, the railway, a fence.',
    );
  }
  if (noSpot.length > 0) {
    console.warn(
      `poiGraph: ${noSpot.length} waypoint seed(s) had nowhere to stand within ${NUDGE_REACH} m — ` +
        noSpot.map((seed) => `(${seed.x.toFixed(1)}, ${seed.z.toFixed(1)})`).join(' '),
    );
  }
}
