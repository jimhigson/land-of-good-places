/**
 * **Plugs the build-time park solver into the game's modules** — the only
 * caller of `installParkSolver` (`src/world/prebuilt/solverPort.ts`).
 *
 * Node scripts load it lazily through `scripts/ts-extension-resolver-register.mjs`;
 * a test that builds a park imports it after pinning its seed
 * (`test/procgen/parkFacts.ts`). The game as delivered never reaches it.
 */
import { installParkSolver } from '../src/world/prebuilt/solverPort';
// Installs the boundary's own solver on import (see that module).
import './world/boundaryRadii';
import { createPlanSolver } from './world/planSolver';
import { solveWorldPhase } from './world/worldPhaseSolver';
import { recordBuilt, searchBridgeFootprints } from './world/builtDecisions';
import { planFerrisExit } from './world/ferrisExit';
import { planSlideLegs } from './world/slide/legs';
import { planCruiserPylons } from './world/coaster/pylons';
import { searchRailRacePlan } from './world/railRace/plan';

installParkSolver({
  plan: createPlanSolver,
  worldPhase: solveWorldPhase,
  bridgeFootprints: searchBridgeFootprints,
  ferrisExit: () => recordBuilt('ferrisExit', planFerrisExit()),
  slideLegs: (points, isClear) => recordBuilt('slideLegs', planSlideLegs(points, isClear)),
  cruiserPylons: (route, isClear, clearTreesNear) => recordBuilt('pylons', planCruiserPylons(route, isClear, clearTreesNear)),
  railRacePlan: () => recordBuilt('railRace', searchRailRacePlan()),
});
