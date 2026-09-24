/**
 * **Plugs the build-time park solver into the game's modules** — the only
 * caller of `installParkSolver` (`src/world/prebuilt/solverPort.ts`).
 *
 * Node scripts load it lazily through `scripts/ts-extension-resolver-register.mjs`;
 * a test that builds a park imports it after pinning its seed
 * (`test/procgen/parkFacts.ts`). The game as delivered never reaches it.
 */
import { installParkSolver } from '../src/world/prebuilt/solverPort';
import { createPlanSolver } from './world/planSolver';
import { solveWorldPhase } from './world/worldPhaseSolver';

installParkSolver({ plan: createPlanSolver, worldPhase: solveWorldPhase });
