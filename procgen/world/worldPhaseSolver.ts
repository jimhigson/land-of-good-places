/**
 * **The world phase's search** — the second backtracking drive, over the stalls,
 * fountain, walls, trees, bushes, fairy-light poles, lamp posts and the rail
 * race's trestles. Build-time Node code only (`docs/design/PREBUILT-PARKS.md`):
 * the game hydrates these decisions from the park file
 * (`src/world/worldPhase.ts`). Moved here verbatim from that file, save that it
 * now also returns the decisions a park file records.
 */
import type { CollisionWorld } from '../../src/world/Collision';
import type { GroundClaims, Claim } from '../../src/boot/groundClaims';
import { ParkSolve, type SolveStats } from '../boot/parkSolve';
import { refusal, type FeatureBuilder } from '../boot/featureBuilder';
import { PARK_SEED } from '../../src/world/parkManifest';
import type { CoasterRoute } from '../../src/world/coaster/route';
import { PLAZA } from '../../src/world/paths';
import { FOUNTAIN_RIM_RADIUS } from '../../src/world/Fountain';
import { FOUNTAIN_RIM_COLLIDER_HALF } from '../../src/core/constants';
import { type BushDecision, type TreeDecision, type WallRun } from '../../src/world/Scenery';
import { bushBuilder, treeBuilder, wallBuilder } from './sceneryBuilders';
import { type LampDecision } from '../../src/world/LampPosts';
import { lampBuilder } from './lampBuilder';
import { type FairyChain } from '../../src/world/FairyLights';
import { fairyPoleBuilder } from './fairyPoleBuilder';
import { type BoothRelocator } from '../../src/world/stallsFeature';
import { stallBuilder } from './stallBuilder';
import { RailRace } from '../../src/world/railRace/RailRace';
import { TrestleRefusal, trestleSpots } from './railRace/trestleSearch';
import { RAIL_RACE_FEATURE } from '../../src/world/railRace/feature';
import { ROAD_FEATURE } from '../../src/world/entrance/roadCorridor';
import { STALL_PLACEMENTS, stallShift } from '../../src/minigames/stallPlacement';
import { worldPhaseFrom, type WorldDecisions, type WorldPhase } from '../../src/world/worldPhase';

let lastTrace: readonly string[] = [];
let lastStats: SolveStats | null = null;
let lastStallBuilder: FeatureBuilder | null = null;

/** The world phase's trace, for the digest and the boot's stats. Empty until a World has been built. */
export function worldSolveTrace(): readonly string[] {
  return lastTrace;
}

export function worldSolveStats(): SolveStats | null {
  return lastStats;
}

/**
 * The stalls builder the last world phase used — **the same object the driver
 * drove**, not a copy of it.
 *
 * `scripts/check-stall-accommodate.mts` needs it: no seed in the pool ever
 * refuses anything against a stall, so the only way to prove the mechanism
 * works is to ask a real booth, in a real built park, against the real
 * registry and the real collision world. A transcript of a hand-run would go
 * stale the moment the geometry moved (CLAUDE.md: "a red-run transcript is a
 * measurement, and measurements go stale"); a check cannot.
 */
export function worldSolveStallBuilder(): FeatureBuilder | null {
  return lastStallBuilder;
}

/** The fountain: one increment, the basin's footprint at the plaza. It never moves. */
function fountainBuilder(claims: GroundClaims): FeatureBuilder {
  let placed = false;
  return {
    name: 'fountain',
    deps: ['stalls'],
    *advance() {
      if (placed) return 'done';
      const claim: Claim = {
        kind: 'footprint',
        shape: { shape: 'disc', x: PLAZA.x, z: PLAZA.z, radius: FOUNTAIN_RIM_RADIUS + FOUNTAIN_RIM_COLLIDER_HALF },
      };
      const blockers = claims.blockers('fountain', [claim]).map((b) => b.feature);
      if (blockers.length > 0) {
        return refusal(`fountain: the plaza basin is refused by ${blockers.join(', ')}`, { blockers, claims: [claim] });
      }
      placed = true;
      return { claims: [claim], label: `basin at (${PLAZA.x.toFixed(1)}, ${PLAZA.z.toFixed(1)})` };
    },
    back() {
      placed = false;
    },
    supply: () => 1,
    reset() {
      placed = false;
    },
  };
}

/**
 * The rail race: one coarse increment — both rings' trestles, each slot found
 * against the registry by `track.ts`. A duck bar with no support is a refusal
 * naming the features that refused its candidates, so a tree or bush in the
 * way is asked to step aside and the ride is tried again; a refusal by
 * nothing movable (the road, the lean bound) is the build's own failure, as
 * it always was.
 */
function railRaceBuilder(
  collision: CollisionWorld,
  claims: GroundClaims,
  keep: (ride: RailRace) => void,
): FeatureBuilder {
  let built = false;
  return {
    name: RAIL_RACE_FEATURE,
    deps: ['stalls', 'fountain', 'walls', 'trees', 'bushes', 'fairyLights', 'lamps'],
    *advance() {
      if (built) return 'done';
      let ride: RailRace;
      try {
        ride = new RailRace(collision, claims, trestleSpots);
      } catch (error) {
        if (!(error instanceof TrestleRefusal)) throw error;
        const blockers = error.refusedBy.filter((name) => name !== ROAD_FEATURE);
        if (blockers.length === 0) throw error;
        return refusal(error.message, { blockers, claims: error.refusedClaims });
      }
      built = true;
      keep(ride);
      return {
        claims: [...ride.supportClaims.walkPast, ...ride.supportClaims.race],
        label: `${ride.supportClaims.walkPast.length + ride.supportClaims.race.length} trestle claims`,
      };
    },
    back() {
      // Nothing comes after the ride in the order, so this is never reached in
      // practice; the ride's colliders would stay registered if it were.
      built = false;
    },
    supply: () => 1,
    reset() {
      built = false;
    },
  };
}

/**
 * Decide every world-time feature. Synchronous: the World constructor drains it.
 *
 * `booths` is how a stall steps aside: the `World` hands in a way to reach the
 * booths it has already built, and `stallsFeature.ts` drives it. A caller with
 * no booths to move (there is none today) passes one that answers `null`, and
 * every stall then simply refuses to accommodate.
 */
export function solveWorldPhase(
  collision: CollisionWorld,
  claims: GroundClaims,
  cruiserRoute: CoasterRoute | null,
  booths: BoothRelocator,
): WorldPhase {
  const featureNames: string[] = [];
  // Where each booth was last put — a park file records the exact spot, not
  // the shift, because base + shift need not round to the same number.
  const boothsMovedTo = new Map<string, readonly [number, number]>();
  const recordingBooths: BoothRelocator = (id) => {
    const booth = booths(id);
    if (!booth) return null;
    return {
      withdrawCollision: () => booth.withdrawCollision(),
      placeAt: (x, z) => {
        boothsMovedTo.set(id, [x, z]);
        booth.placeAt(x, z);
      },
    };
  };
  const trees: TreeDecision[] = [];
  const bushes: BushDecision[] = [];
  const walls: (WallRun | null)[] = [];
  const lamps: LampDecision[] = [];
  const poles: FairyChain[] = [];
  let railRace: RailRace | null = null;
  const builders: FeatureBuilder[] = [
    // **Stalls first.** Their ground is the most constrained in this phase and
    // everything after wants to know where it is; and, being first, the
    // driver's own precedence would let nothing ask one to move — which is why
    // the stalls builder is `movable` and decides for itself (Jim: "this would
    // be on the class that does the stall placement to decide").
    stallBuilder(collision, claims, recordingBooths),
    fountainBuilder(claims),
    wallBuilder(claims, walls),
    treeBuilder(collision, claims, () => walls, () => bushes, trees),
    bushBuilder(collision, claims, () => walls, () => trees, bushes),
    fairyPoleBuilder(claims, poles, cruiserRoute),
    lampBuilder(collision, claims, lamps),
    railRaceBuilder(collision, claims, (ride) => {
      railRace = ride;
    }),
  ];
  lastStallBuilder = builders[0] as FeatureBuilder;
  featureNames.push(...builders.map((builder) => builder.name));
  const solve = new ParkSolve(PARK_SEED, builders, claims);
  // **How long this phase took, printed with what it produced.**
  //
  // The line below has always carried the phase's *counts* and never its
  // *cost*, which made a builder getting slower invisible at the point it was
  // paid — `check:park-boot` cannot see it either, because every work unit it
  // slices is a plan-phase solver and the world phase runs outside any
  // budgeted slice (#694). Measuring a world-phase change therefore meant
  // timing a whole park build, in which seed 7's plan phase alone is minutes
  // and would average any regression away to nothing.
  const startedAt = Date.now();
  for (const _turn of solve.run()) {
    // drained
  }
  const elapsedMs = Date.now() - startedAt;
  lastTrace = solve.trace;
  lastStats = solve.stats;
  try {
    const nodeProcess = (globalThis as { process?: { stderr?: { write: (s: string) => unknown } } }).process;
    const stats = solve.stats;
    for (const line of solve.trace) {
      if (!/^placed |^done /.test(line)) nodeProcess?.stderr?.write(`world-solve:   ${line}\n`);
    }
    nodeProcess?.stderr?.write(
      `world-solve: seed=${PARK_SEED} increments=${stats.increments} refusals=${stats.refusals} ` +
        `accommodations=${stats.accommodations}/${stats.accommodationRefusals}-refused forgone=${stats.forgone} ` +
        `unwinds=${stats.unwinds} ms=${elapsedMs} trees=${trees.length} bushes=${bushes.length} walls=${walls.filter(Boolean).length}/${walls.length} ` +
        `lamps=${lamps.filter((l) => l !== 'forgone').length}/${lamps.length} poles=${poles.reduce((n, chain) => n + chain.slots.filter(Boolean).length, 0)}/${poles.reduce((n, chain) => n + chain.slots.length, 0)} chains=${poles.length}\n`,
    );
  } catch {
    // no stderr in a browser
  }
  if (!railRace) throw new Error('world phase: the rail race was never built — the driver finished without it');
  const ride: RailRace = railRace;
  const names = new Set(featureNames);
  const decisions: WorldDecisions = {
    stallMoves: Object.keys(STALL_PLACEMENTS).flatMap((id) => {
      const [dx, dz] = stallShift(id);
      if (dx === 0 && dz === 0) return [];
      const at = boothsMovedTo.get(id);
      if (!at) throw new Error(`world phase: stall ${id} carries a shift but was never placed`);
      return [[id, dx, dz, at[0], at[1]] as const];
    }),
    walls,
    trees,
    bushes,
    fairyPoles: poles,
    lamps,
    trestles: ride.trestles,
    claims: claims
      .featuresInCommitOrder()
      .filter((feature) => names.has(feature))
      .map((feature) => ({ feature, sections: claims.contributionsOf(feature) })),
  };
  lastDecisions = decisions;
  return worldPhaseFrom(decisions, ride);
}

let lastDecisions: WorldDecisions | null = null;

/** The last searched world phase's decisions — what `build:parks` writes into a park file. */
export function worldPhaseDecisions(): WorldDecisions | null {
  return lastDecisions;
}
