// First, before anything evaluates a Math function: see core/deterministicMath.ts.
import './core/installDeterministicMath';
import { setupUpdateGate } from './updateGateSetup';
import { loadPrebuiltPark } from './boot/prebuiltPark';
import { showBootFailure } from './ui/bootFailure';

/**
 * **The page's entry: updates first, then the park's file, then the game.**
 *
 * 1. The update gate, before anything that can fail — a new version of the
 *    code must reach the family even on the day this version cannot open its
 *    park (`updateGateSetup.ts`).
 * 2. The park's file (`boot/prebuiltPark.ts`, `docs/design/PREBUILT-PARKS.md`),
 *    **before** the game's modules load: several of them ask about the park —
 *    its edge, its ring road — at module scope, and the game has no solver, so
 *    the only answer is the file. It is precached with this bundle, so this is
 *    a cache hit on an installed game. The file also names the restart of
 *    the seed to build (`parkRestart.ts`), which the park's modules read at
 *    load, so it is set here, before they load — and so nothing this module
 *    imports statically may import the park (`check:prebuilt-park`).
 * 3. The game (`main.ts`). If the park cannot be had, importing it fails with
 *    `ParkUnavailable`, and that is shown rather than lost.
 */
const uiRoot = document.getElementById('ui-root');
if (uiRoot) setupUpdateGate(uiRoot);

await loadPrebuiltPark();
try {
  await import('./main');
} catch (error) {
  showBootFailure(error);
}
