import { lazyView } from '../../boot/lazyView';
import { EXIT_INSIDE_EDGE } from '../boundary';
import { RailRaceRoute, type ArchStation } from './route';
import type { BarPlanDecision } from './hazards';
import { planPart } from '../parkPlan';
// **Straight from the leaf, not through `route.ts`'s re-export.** The read
// below is inside a function today, so the re-export would serve it — but a
// re-export does not rescue a module-scope reader, and it is order-*dependent*:
// it works until somebody reorders an import. Importing the leaf is
// order-independent by construction, so the next `const` added to this file
// cannot quietly reintroduce `Cannot access 'RIDE_SCALE' before initialization`.
import { RIDE_SCALE } from './dimensions';

/**
 * How far inside the park's edge a rider must be set down, in metres.
 *
 * A distance from the **edge**, which is the thing that actually matters — a
 * child stepping off wants ground under her and the boundary wall in front of
 * her, not behind. Two metres is what the old `GARDEN_PLAY_RADIUS - 2` clamp
 * meant back when subtracting from a radius was the same statement.
 *
 * **Exported so `check:rail-race` can verify the clamp against this number
 * rather than a second copy of it.** It was unexported, and the checker's
 * "mirror" had already drifted to a hand-typed `> 1` — so the check could pass
 * on a plan that broke the planner's own rule, which is the entire failure it
 * exists to catch. Same number declared twice is this week's most-repeated bug;
 * one owner, one import.
 *
 * It now *lives* in `boundary.ts` and is re-exported here, because the Sky
 * Cruiser's exit wants the same rule and importing it from this module would
 * close a cycle: `coaster/plan -> railRace/plan -> train/plan -> coaster/plan`.
 * `tsc` is perfectly happy with that cycle; Node is not, and it fails at module
 * load with "Cannot access 'COASTER_PLANS' before initialization". The number
 * belongs to the boundary anyway — it is a statement about how far inside the
 * park's edge a person can stand.
 */
export { EXIT_INSIDE_EDGE };

export interface PlannedRailRace {
  /** Matches `PlannedCoaster.name` — `paths.ts` names the exit node with it. */
  readonly name: string;
  /**
   * The ring the rival kids idle round all day, at park scale. Always built,
   * always visible, and the only one of the two that registers collision.
   */
  readonly walkPastRing: RailRaceRoute;
  /**
   * The ring a race is actually run on, at `RIDE_SCALE`. Built at load like
   * its sibling — never regenerated when a race starts, which would mean a
   * mesh rebuild and a collection pause in the middle of the game — and simply
   * shown or hidden.
   */
  readonly raceRing: RailRaceRoute;
  /**
   * The race ring, under the name every arc-length consumer already used.
   *
   * Both rings share `length`, `startDistance` and the whole undulation, so
   * anything asking the route a question about *distance* (`simulate.ts`'s
   * hazard schedule, `RACE_DISTANCE`, `stepRider`'s gradient) gets the same
   * answer from either and does not need to know there are two.
   */
  readonly route: RailRaceRoute;
  readonly stationStallId: string;
  /** Where a rider is put down afterwards (GAME_DESIGN.md's EXIT rule). */
  readonly exitX: number;
  readonly exitZ: number;
}

/** The booth that boards the ride. The id is a save key; it does not move. */
export const RAIL_RACE_STATION_STALL_ID = 'stall.railRacer';

/**
 * **The Rail Race as its plan decided it** — the arch station (`archChoice`,
 * and where on the ring that is) and the ride's exit, from which both rings are
 * built with no search, and where the duck bars may go on them. Made by the
 * plan's `railRaceBars` builder in build tooling (`procgen/world/planSolver.ts`,
 * which chose the arch station where every duck bar has a legal slot) and read
 * from the park file in the game.
 */
export interface RailRaceDecision {
  /** Which clear arch station — `procgen/world/railRace/plan.ts`'s `archStation`; 0 is the arch as it always stood. */
  readonly archChoice: number;
  readonly plan: PlannedRailRace;
  /** Where the duck bars may go on that ring — `simulate.ts`'s `barPlanDecision`. */
  readonly bars: BarPlanDecision;
}

/** The Rail Race's rings, given its exit and where its arch stands. Pure: no search. */
export function railRacePlanFrom(exitX: number, exitZ: number, arch: ArchStation): PlannedRailRace {
  const walkPastRing = new RailRaceRoute(1, arch);
  const raceRing = new RailRaceRoute(RIDE_SCALE, arch);
  return {
    name: 'railRace',
    walkPastRing,
    raceRing,
    route: raceRing,
    stationStallId: RAIL_RACE_STATION_STALL_ID,
    exitX,
    exitZ,
  };
}

/**
 * **The Rail Race the park's plan decided** — the `railRaceBars` decision.
 * Import this; never re-solve — the same rule as `TRAIN_PLAN`. A view: when the
 * driver re-decides the layout, cruiser, railway or the arch, this follows on
 * the next read.
 */
export const RAIL_RACE_PLAN: PlannedRailRace = lazyView(() => planPart('railRaceBars').plan);
