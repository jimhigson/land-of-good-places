/**
 * **The world phase: every remaining park feature through the one driver.**
 *
 * The plan phase (`parkPlan.ts`) decides the layout, the rides' routes, the
 * crossings, the paths and the road. Everything else that stands on the lawn
 * — the fountain, the walls, the trees and bushes, the fairy-light poles, the
 * lamp posts, the rail race's trestles — is decided here, by a second
 * {@link ParkSolve} over the same claims registry, after the fixed structures
 * (castle, hotel, stalls, railway, coaster, entrance) have registered their
 * colliders. Jim, 16 Sep 2026: *"each feature being based around a generic
 * feature builder interface that provides advancing, going back, and
 * retrying … all features have a small degree of 'correction' built-in, eg
 * if colliding with a tree, simply moving the tree to a different location
 * before continuing, same for lamp posts, walls etc."*
 *
 * Nothing is drawn here. Each builder decides positions and claims; the
 * `World` then constructs the meshes and colliders from the decisions, in
 * one pass, so a decision that was unwound never left a collider behind.
 *
 * Not here, and why: **flowers**. A flower has no collider, respawns at
 * runtime and re-seats itself against the finished park
 * (`Flowers.settleAgainstTheFinishedPark`) — a living system, not a placed
 * feature, so it is constructed after the phase's colliders exist, as before.
 */

import type { CollisionWorld } from './Collision';
import type { GroundClaims, Claim } from '../boot/groundClaims';
import { ParkSolve, type SolveStats } from '../boot/parkSolve';
import { refusal, type FeatureBuilder } from '../boot/featureBuilder';
import { PARK_SEED } from './parkManifest';
import { PLAZA } from './paths';
import { FOUNTAIN_RIM_RADIUS } from './Fountain';
import { FOUNTAIN_RIM_COLLIDER_HALF } from '../core/constants';
import {
  bushBuilder,
  treeBuilder,
  wallBuilder,
  type BushDecision,
  type SceneryDecisions,
  type TreeDecision,
  type WallRun,
} from './Scenery';
import { lampBuilder, type LampDecision } from './LampPosts';
import { fairyPoleBuilder, type FairyChain } from './FairyLights';
import { RailRace } from './railRace/RailRace';
import { TrestleRefusal } from './railRace/track';
import { RAIL_RACE_FEATURE } from './railRace/feature';
import { ROAD_FEATURE } from './entrance/roadCorridor';

export interface WorldPhase {
  readonly scenery: SceneryDecisions;
  readonly lamps: readonly (readonly [number, number])[];
  readonly fairyPoles: readonly FairyChain[];
  readonly railRace: RailRace;
  readonly stats: SolveStats;
  readonly trace: readonly string[];
}

let lastTrace: readonly string[] = [];
let lastStats: SolveStats | null = null;

/** The world phase's trace, for the digest and the boot's stats. Empty until a World has been built. */
export function worldSolveTrace(): readonly string[] {
  return lastTrace;
}

export function worldSolveStats(): SolveStats | null {
  return lastStats;
}

/** The fountain: one increment, the basin's footprint at the plaza. It is first in order and never moves. */
function fountainBuilder(claims: GroundClaims): FeatureBuilder {
  let placed = false;
  return {
    name: 'fountain',
    deps: [],
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
    deps: ['fountain', 'walls', 'trees', 'bushes', 'fairyLights', 'lamps'],
    *advance() {
      if (built) return 'done';
      let ride: RailRace;
      try {
        ride = new RailRace(collision, claims);
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

/** Decide every world-time feature. Synchronous: the World constructor drains it. */
export function solveWorldPhase(collision: CollisionWorld, claims: GroundClaims): WorldPhase {
  const trees: TreeDecision[] = [];
  const bushes: BushDecision[] = [];
  const walls: (WallRun | null)[] = [];
  const lamps: LampDecision[] = [];
  const poles: FairyChain[] = [];
  let railRace: RailRace | null = null;
  const builders: FeatureBuilder[] = [
    fountainBuilder(claims),
    wallBuilder(claims, walls),
    treeBuilder(collision, claims, () => walls, () => bushes, trees),
    bushBuilder(collision, claims, () => walls, () => trees, bushes),
    fairyPoleBuilder(claims, poles),
    lampBuilder(collision, claims, lamps),
    railRaceBuilder(collision, claims, (ride) => {
      railRace = ride;
    }),
  ];
  const solve = new ParkSolve(PARK_SEED, builders, claims);
  for (const _turn of solve.run()) {
    // drained
  }
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
        `unwinds=${stats.unwinds} trees=${trees.length} bushes=${bushes.length} walls=${walls.filter(Boolean).length}/${walls.length} ` +
        `lamps=${lamps.filter((l) => l !== 'forgone').length}/${lamps.length} poles=${poles.reduce((n, chain) => n + chain.slots.filter(Boolean).length, 0)}/${poles.reduce((n, chain) => n + chain.slots.length, 0)} chains=${poles.length}\n`,
    );
  } catch {
    // no stderr in a browser
  }
  if (!railRace) throw new Error('world phase: the rail race was never built — the driver finished without it');
  return {
    scenery: { trees, bushes, walls },
    lamps: lamps.flatMap((lamp) => (lamp === 'forgone' ? [] : [[lamp.x, lamp.z] as const])),
    fairyPoles: poles,
    railRace,
    stats: solve.stats,
    trace: solve.trace,
  };
}
