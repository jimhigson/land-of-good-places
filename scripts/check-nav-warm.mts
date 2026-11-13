/**
 * **`check:nav-warm` — her route lattice is laid in slices, never as one long
 * task, and the sliced lattice is the one a whole build lays** (step 1b of the
 * 120 fps plan, `docs/perf/FRAME-DROPS-2026-11.md`: the first tap of a session
 * was one 526 ms task, `findRoute → ensureLattice → rebuild`).
 *
 * ```
 * pnpm run check:nav-warm
 * NAV_WARM_MUTATE=sync pnpm run check:nav-warm    # asks a question instead of warming: one long task, must go red
 * NAV_WARM_MUTATE=short pnpm run check:nav-warm   # NOT a red proof — see below
 * ```
 *
 * **Where CI runs it:** behind `check:nav-spaces` (`check:shard-6`), the way
 * `check:crowd` carries the npc checks — the `check:nav-spaces` script entry
 * ends `&& pnpm run check:nav-warm`. It is in no shard by name, so do not add
 * it to one as well: it would then build its park and lattices twice a run.
 * Unwired, `check:chain-coverage` goes red naming it (seen, exit 1, on
 * e427f160).
 *
 * **What is and is not proved red (13 Nov 2026, seed 5 restart 1, commit
 * 051415e6).** `sync` goes red: 10 failures, "1 lattice(s) built as one long
 * task" for each of the three lattices. `short` (the patch's reach scaled to 0
 * after colliders land mid-build) ran **green**: the colliders arrive during
 * the boundary pass, so the build's own later passes stamp them and a short
 * patch has nothing left to get wrong. So the equality clause has never been
 * seen to fail here — it leans on `verifyAgainstWhole`, which `check:library`
 * proves live. It wants a mutation that breaks a slice (skip a band), and
 * colliders dropped during the *levels* pass rather than the third slice.
 *
 * Builds the player's own lattice (`playerNavGrid`, the one `Game` builds) and
 * the park children's over the park by `NavGrid.warm` at the game's own
 * budget, and asserts: no whole build ran as one task; the finished lattice
 * equals a whole rebuild cell for cell and level for level
 * (`NAV_GRID_BUILDS.verify`); and the same when colliders land in the park's
 * middle **while** it is being laid — the case the build's revision stamp
 * exists for. Slice count and the longest slice are reported on stderr, never
 * asserted: this machine's clock is not the player's.
 */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { NAV_GRID_BUILDS, NAV_WARM_BUDGET_MS, NavGrid } from '../src/world/NavGrid.ts';
import { playerNavGrid } from '../src/world/playerLattice.ts';
import { GARDEN_PLAY_BOUNDARY } from '../src/world/boundary.ts';
import { PLAYER_RADIUS } from '../src/core/constants.ts';
import { JUMP_APEX_HEIGHT } from '../src/entities/Player.ts';

const MUTATE = process.env['NAV_WARM_MUTATE'] ?? '';
if (MUTATE !== '' && MUTATE !== 'sync' && MUTATE !== 'short') throw new Error(`NAV_WARM_MUTATE=${MUTATE}: the mutations are 'sync' and 'short'`);

let failures = 0;
const say = (ok: boolean, line: string): void => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${line}`);
};

const { world } = quietly(() => buildHeadlessPark());
const collision = world.collision;
const sample = (x: number, z: number, y: number): number => world.building.surfaces.sample(x, z, y);
if (MUTATE !== '') console.log(`  note: MUTATED on purpose (${MUTATE}) — this run must go red`);

NAV_GRID_BUILDS.verify = true;

/** Warms `grid` to completion at the game's budget; `midway` runs once, after the third slice. */
const lay = (name: string, grid: NavGrid, midway?: () => void): void => {
  const before = { ...NAV_GRID_BUILDS };
  NAV_GRID_BUILDS.mismatches.length = 0;
  NAV_GRID_BUILDS.worstSliceMs = 0;
  let frames = 0;
  if (MUTATE === 'sync') {
    grid.canStandAt(0, 0, 0, sample);
  } else {
    while (!grid.warm(sample, NAV_WARM_BUDGET_MS)) {
      frames += 1;
      if (frames === 3 && midway) midway();
      if (frames > 200_000) break;
    }
  }
  const whole = NAV_GRID_BUILDS.full - before.full;
  const sliced = NAV_GRID_BUILDS.sliced - before.sliced;
  const forced = NAV_GRID_BUILDS.forced - before.forced;
  const slices = NAV_GRID_BUILDS.slices - before.slices;
  const oneTask = whole - sliced + forced;
  say(
    sliced >= 1 && oneTask === 0,
    `${name}: ${whole} whole build(s), ${sliced} of them sliced, ${forced} finished in one go — ${oneTask} lattice(s) built as one long task, must be 0 with at least 1 sliced`,
  );
  say(slices > 1, `${name}: the build took ${slices} slices — more than one, or nothing was sliced`);
  const verified = NAV_GRID_BUILDS.verified - before.verified;
  say(
    verified >= 1 && NAV_GRID_BUILDS.mismatches.length === 0,
    `${name}: the sliced lattice equals a whole rebuild (${verified} comparison(s))` +
      (NAV_GRID_BUILDS.mismatches.length ? `: ${NAV_GRID_BUILDS.mismatches.slice(0, 3).join(' | ')}` : ''),
  );
  process.stderr.write(
    `check:nav-warm ${name} (this machine, Node, not asserted): ${slices} slices at a ${NAV_WARM_BUDGET_MS} ms budget, longest slice ${NAV_GRID_BUILDS.worstSliceMs.toFixed(2)} ms, ` +
      `${(NAV_GRID_BUILDS.fullMs - before.fullMs).toFixed(0)} ms of building in all (the verifier's own rebuild excluded), ${NAV_GRID_BUILDS.patched - before.patched} patch(es) after\n`,
  );
};

lay('her own lattice (playerNavGrid)', playerNavGrid(world));
lay("the park children's lattice", new NavGrid(collision, PLAYER_RADIUS, JUMP_APEX_HEIGHT, world.routeConnectors, world.routeBridgeCovers, GARDEN_PLAY_BOUNDARY));

// Colliders landing while the lattice is being laid: the build is stamped with
// the revision it began at, so these are a patch's to redo.
if (MUTATE === 'short') NAV_GRID_BUILDS.reachScale = 0;
let dropped: number[] = [];
lay('her own lattice, 40 colliders dropped in the park after the third slice', playerNavGrid(world), () => {
  dropped = Array.from({ length: 40 }, (_, i) => collision.addCircle((i % 8) * 6 - 21, Math.floor(i / 8) * 6 - 12, 1.2));
});
say(dropped.length === 40, `CONTROL: the mid-build colliders were really dropped (${dropped.length} of 40) — otherwise the clause above asserts nothing`);
for (const id of dropped) collision.removeCircle(id);
NAV_GRID_BUILDS.reachScale = 1;
NAV_GRID_BUILDS.verify = false;

if (failures > 0) {
  console.error(`check:nav-warm: ${failures} failure(s)`);
  process.exit(1);
}
console.log('check:nav-warm passed');
