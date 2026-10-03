/**
 * **Does the cat bus arrival actually play, and are the children still there
 * afterwards?**
 *
 * ```
 * npm run check:cat-bus
 * ```
 *
 * The park's invariant suite asks the other half of this question — *is there a
 * node called `cat-bus` in the built scene?* — and goes red if the wiring from
 * `World` to `Entrance` to `ArrivalSequence` breaks anywhere along its length.
 * That is the check whose absence let PR #27 ship a whole feature as dead code
 * on 26 July 2026 and sit unnoticed for twelve days.
 *
 * ## What changed on 7 August, and why this file was rewritten
 *
 * The previous version drove a bare `new ArrivalSequence()` with a recording
 * stub for a player, and asserted things like *"twelve seats exist and eleven
 * have a child parented into them"*. Every one of those assertions passed on the
 * build Jim then watched, in which:
 *
 * - the children **vanished** the moment the sequence ended;
 * - they walked at 1.5 m/s in a park whose walking speed is 2.55;
 * - they **overlapped each other**, because the push-apart was overwritten by
 *   the next frame's curve evaluation before it could ever be seen;
 * - twelve children sat in a bus **0.52 m inside one another** and 0.10-0.24 m
 *   through its bodywork;
 * - the camera opened on the middle of the park.
 *
 * A check that counts seats cannot see any of that. So this one:
 *
 * 1. drives the **real `World`**, built by `buildHeadlessPark()` — the same
 *    wiring the game runs, including `World.update`'s ordering, the real
 *    `NpcSystem`, and the real 24-strong crowd the eleven passengers come from;
 * 2. keeps running for a further **thirty seconds after the arrival ends**, and
 *    measures the children then. "Are they still here, and are they behaving
 *    like the park's other children?" is the question the old check could not
 *    even ask, because its children were not the park's;
 * 3. takes every threshold from a **measured** property of the built model —
 *    `CHILD_FOOTPRINT`, `NPC_WALK_SPEED` — never from a literal.
 *
 * Everything asserted here is read back off the built objects. The door angle is
 * `door-hinge`'s own `rotation.y`, not the argument passed to `setDoorOpen`.
 */
import './headless-canvas.mjs';
import { buildHeadlessPark } from './park-harness.mts';
import { ACCEPTANCE_SCOPE, exitVoid } from './lib/checkScope.mts';
import { catBus } from './lib/catBus.mts';

// The check is `lib/catBus.mts`'s, one owner with the acceptance loop.
const result = await catBus(() => buildHeadlessPark());
if (result.voids.length > 0) exitVoid();
for (const note of result.notes) console.log(`  ${note}`);
// Under the acceptance scope (`lib/checkScope.mts`) only decision clauses fail;
// in CI every clause does.
if (ACCEPTANCE_SCOPE) {
  for (const line of result.code) console.log(`  CODE (outside acceptance: fixed at cause, never restarted around) ${line}`);
}
const failures = [...result.decisions, ...(ACCEPTANCE_SCOPE ? [] : result.code)];
if (failures.length > 0) {
  console.error('\nFAIL: the cat bus arrival did not play as it should.');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\ncat bus arrival OK');
