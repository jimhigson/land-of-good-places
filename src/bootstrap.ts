// First, before anything evaluates a Math function: see core/deterministicMath.ts.
import './core/installDeterministicMath';
// The game's styles, here and not only in main.ts: the update gate and the
// park-unavailable card are shown by this module when main never loads.
import './style.css';
import { setupUpdateGate } from './updateGateSetup';
import { loadPrebuiltPark } from './boot/prebuiltPark';
import { showBootFailure } from './ui/bootFailure';
import { parkFileMissingReason } from './world/prebuilt/parkFileStore';
import { ParkUnavailable } from './world/prebuilt/parkUnavailable';
import { parkSeedAsked } from './world/parkSeedPool';

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
 * 3. The game (`main.ts`) — only when the park file arrived. When it did not
 *    (an unsupported seed, a missing or stale file, a failed download), the
 *    `ParkUnavailable` card is shown instead, before the character creator or
 *    anything else she could put work into.
 */
const uiRoot = document.getElementById('ui-root');
if (uiRoot) setupUpdateGate(uiRoot);

await loadPrebuiltPark();
// No usable park file: say so now, before the game loads. Loading it would put
// the character creator up first, and a character made for a park that cannot
// open is a character thrown away (QA on #705, `/?seed=99`).
const missing = parkFileMissingReason();
if (missing !== null) {
  showBootFailure(new ParkUnavailable(parkSeedAsked(), missing));
} else {
  try {
    await import('./main');
  } catch (error) {
    showBootFailure(error);
  }
}
