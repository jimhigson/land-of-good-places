/**
 * **At a slot the trestle search gives up on, what refuses every candidate?**
 * (#488)
 *
 * With the entrance-road clause finally testing the post that is *drawn* rather
 * than a taller one it imagined (see `track.ts`'s `TrestleTree`), the ride stops
 * finding ground for about five consecutive slots where the road runs alongside
 * it, and drops those legs — leaving the walk-past ring unsupported for 61–64 m
 * against a 40 m invariant.
 *
 * Dropping a leg is not a decision, it is a shrug. Before writing a cleverer
 * search it is worth knowing whether a cleverer search could win at all, so this
 * sweeps a failing slot's whole neighbourhood — far wider than any nudge list —
 * and reports, for each candidate, **which predicate refused it**. If the road
 * clause refuses every one of them, no search finds ground there and the
 * trestle's own shape is what has to give.
 *
 * ```
 * LGP_SEED=20260728 node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scripts/probe-slot-search.mts
 * ```
 */
import './headless-canvas.mjs';
import { Vector3 } from 'three';

const { buildHeadlessPark } = await import('./park-harness.mts');
const { PARK_SEED } = await import('../src/world/parkManifest.ts');
const { isInEntranceRoad, distanceToEntranceCorridor, entranceRoadOutsetAt } = await import(
  '../src/world/entrance/roadRoute.ts'
);
const { CAT_BUS_BODY_TOP_Y } = await import('../src/world/entrance/catBus.ts');
const { distanceToPath } = await import('../src/world/pathGraph.ts');
const { distanceToRailCorridor } = await import('../src/world/train/plan.ts');
const { PARK_LAYOUT } = await import('../src/world/parkLayout.ts');
const { terrainHeight } = await import('../src/world/terrain.ts');
const { forkPlan, POST_FOOT_RADIUS, BEAM_DROP } = await import(
  '../src/world/railRace/trestleGeometry.ts'
);
const { LANE_COUNT, UNDULATION_REACH } = await import('../src/world/railRace/route.ts');

const { ROAD_HALF_WIDTH } = await import('../src/world/entrance/road.ts');
const { CAT_BUS_WIDTH, CAT_BUS_LENGTH } = await import('../src/world/entrance/catBus.ts');
const { entranceRoadAt: stationAt, entranceRoadExtent } = await import(
  '../src/world/entrance/roadRoute.ts'
);

/**
 * How far **across** the road a point sits, at the station whose bus-length box
 * contains it — i.e. the same measurement `distanceToEntranceCorridor` makes,
 * but reporting the across distance instead of collapsing everything inside to
 * zero. That is the number that says whether a narrower corridor would help.
 */
function distanceToEntranceRoadCentre(x: number, z: number): number {
  const { from, to } = entranceRoadExtent();
  let nearest = Infinity;
  for (let at = from; at <= to; at += 0.2) {
    const station = stationAt(at);
    const dx = x - station.x;
    const dz = z - station.z;
    const along = Math.abs(dx * station.headingX + dz * station.headingZ);
    if (along > CAT_BUS_LENGTH / 2) continue;
    nearest = Math.min(nearest, Math.abs(dx * -station.headingZ + dz * station.headingX));
  }
  return nearest;
}

const park = buildHeadlessPark();

// The walk-past ring is the one the invariants complain about and the one a
// child stands beside. Its route is what the search was run against.
const ride = park.world as unknown as { railRace?: unknown };
void ride;

/**
 * The rings are not exported for inspection, so the route is recovered from the
 * ride the world built. `RailRace` keeps its rings; this reaches the walk-past
 * one by name rather than by index so it cannot silently measure the other.
 */
interface RouteLike {
  readonly length: number;
  readonly base: number;
  readonly laneSpacing: number;
  readonly startDistance: number;
  readonly path: { sampleAt(at: number): { x: number; z: number; normalX: number; normalZ: number } };
  wrap(at: number): number;
  pointAt(lane: number, at: number, out: Vector3): Vector3;
}

const found: { name: string; route: RouteLike; footRadius: number }[] = [];
const seen = new Set<unknown>();
const walk = (value: unknown, depth: number): void => {
  if (depth > 6 || value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  const record = value as Record<string, unknown>;
  const route = record['route'];
  if (route && typeof route === 'object' && 'laneSpacing' in (route as object) && 'pointAt' in (route as object)) {
    found.push({
      name: String(record['name'] ?? found.length),
      route: route as unknown as RouteLike,
      footRadius: POST_FOOT_RADIUS * Number(record['ringSizeVsRace'] ?? 1),
    });
  }
  for (const key of Object.keys(record)) walk(record[key], depth + 1);
};
walk(park.world, 0);

if (found.length === 0) {
  process.stdout.write('no route reachable from the world object — inspect by hand\n');
  process.exit(1);
}

const TRESTLE_SPACING = 12;

for (const ring of found) {
  const { route, footRadius } = ring;
  const count = Math.floor(route.length / TRESTLE_SPACING);
  const beamY = route.base - UNDULATION_REACH - BEAM_DROP;

  /** The drawn trunk top for a foot at (x, z) — the same solve `trestleTreeAt` does. */
  const trunkTopAt = (at: number, footX: number, footZ: number): { x: number; y: number; z: number } => {
    const ground = terrainHeight(footX, footZ);
    const plan = forkPlan(beamY - ground, route.laneSpacing);
    const tops: Vector3[] = [];
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      tops.push(route.pointAt(lane, at, new Vector3()));
    }
    const forks = [0, 1].map((half) => {
      const a = tops[half * 2]!;
      const b = tops[half * 2 + 1]!;
      return new Vector3().copy(a).lerp(b, 0.5).setY(Math.min(a.y, b.y) - plan.upper);
    });
    const top = new Vector3()
      .copy(forks[0]!)
      .lerp(forks[1]!, 0.5)
      .setY(Math.min(forks[0]!.y, forks[1]!.y) - plan.lower);
    return { x: top.x, y: top.y - ground, z: top.z };
  };

  /** Which clause refuses this candidate — the first one that does. */
  const refusedBy = (at: number, x: number, z: number): string | null => {
    const collision = (park.world as unknown as { collision: { isClearCircle(x: number, z: number, r: number): boolean } })
      .collision;
    if (!collision.isClearCircle(x, z, 1.1)) return 'collision';
    if (distanceToPath(x, z) < 2.8) return 'path';
    if (distanceToRailCorridor(x, z) < 2.4) return 'railway';
    const top = trunkTopAt(at, x, z);
    if (top.y > 0) {
      const reach = Math.min(1, CAT_BUS_BODY_TOP_Y / top.y);
      const lean = Math.hypot(top.x - x, top.z - z);
      const steps = Math.max(1, Math.ceil((lean * reach) / 0.25));
      for (let i = 0; i <= steps; i += 1) {
        const t = (i / steps) * reach;
        if (isInEntranceRoad(x + (top.x - x) * t, z + (top.z - z) * t, footRadius)) return 'road';
      }
    } else if (isInEntranceRoad(x, z, footRadius)) {
      return 'road';
    }
    for (const entry of PARK_LAYOUT.entries.values()) {
      if (Math.hypot(x - entry.x, z - entry.z) < entry.boundingRadius + 2.4) return 'entry';
    }
    return null;
  };

  // For every slot: the smallest radial deviation from the ring's own line at
  // which *any* candidate is clear.
  //
  // **The interesting answer is not "is there ground", it is "how far".**
  // `RADIAL_NUDGES` reaches 5 m and `MANDATORY_RADIAL_NUDGES` stops at 4,
  // capped deliberately — a support that drifts from the duck bar it holds up
  // is itself a visual bug, and that cap is the fix for one (see its doc
  // comment). So a slot whose nearest clear ground is eleven metres off the
  // ring's line has no *usable* placement, however wide a search is written.
  const nearest: (number | null)[] = [];
  for (let i = 0; i < count; i += 1) {
    const atArch0 = (i / count) * route.length;
    let best: number | null = null;
    for (let dr = 0; dr <= 20 && best === null; dr += 0.5) {
      for (const signed of dr === 0 ? [0] : [-dr, dr]) {
        for (let da = -6; da <= 6; da += 1) {
          const at = route.wrap(route.startDistance + atArch0 + da);
          const sample = route.path.sampleAt(at);
          if (!refusedBy(at, sample.x + sample.normalX * signed, sample.z + sample.normalZ * signed)) {
            best ??= Math.abs(signed);
          }
        }
      }
    }
    nearest.push(best);
  }
  const beyondReach = nearest
    .map((dr, i) => ({ dr, i }))
    .filter((entry) => entry.dr === null || entry.dr > 5);

  process.stdout.write(
    `\nseed ${PARK_SEED} ring "${ring.name}" (foot radius ${footRadius.toFixed(3)}): ` +
      `${count} slots, ${beyondReach.length} whose nearest clear ground is beyond ` +
      `RADIAL_NUDGES' 5 m reach\n`,
  );
  for (const entry of beyondReach) {
    process.stdout.write(
      `  slot ${String(entry.i).padStart(3)}: nearest clear ground ` +
        `${entry.dr === null ? '>20' : entry.dr.toFixed(1)} m off the ring's line\n`,
    );
  }
  if (beyondReach.length === 0) continue;
  const slot = beyondReach[0]!.i;
  const atArch0 = (slot / count) * route.length;

  // And the geometry that decides it: where is the ring, where is the road?
  const at = route.wrap(route.startDistance + atArch0);
  const sample = route.path.sampleAt(at);
  const top = trunkTopAt(at, sample.x, sample.z);
  process.stdout.write(
    `\n  slot ${slot}: centre-line outset ${entranceRoadOutsetAt(sample.x, sample.z).toFixed(2)} m, ` +
      `trunk rises ${top.y.toFixed(2)} m, bus body reaches ${CAT_BUS_BODY_TOP_Y.toFixed(2)} m ` +
      `(${((CAT_BUS_BODY_TOP_Y / top.y) * 100).toFixed(0)}% of the way up the trunk)\n` +
      `  trunk top is ${distanceToEntranceCorridor(top.x, top.z).toFixed(2)} m outside the corridor\n` +
      // **How much of the corridor is the bus, and how much is paint?** The
      // corridor is a ROAD_HALF_WIDTH box because a leg standing on the road
      // looks wrong even where the bus would miss it; the bus itself is only
      // CAT_BUS_WIDTH across. If the trunk top were between the two, narrowing
      // the corridor to what the bus actually sweeps would free the slot — so
      // this says plainly whether that cheaper answer is available.
      `  trunk top is ${distanceToEntranceRoadCentre(top.x, top.z).toFixed(2)} m from the road's centre line ` +
      `(road half width ${ROAD_HALF_WIDTH.toFixed(2)}, bus half width ${(CAT_BUS_WIDTH / 2).toFixed(2)})\n`,
  );
}
