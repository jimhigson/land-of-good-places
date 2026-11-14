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
 *
 * And the one place her lattice *is* laid whole on purpose: a boot with no bus
 * ride (`layHerLatticeNow`, before the first frame of a continued save or a
 * deep link). Restored into a room, it must lay the garden's lattice as well
 * as the room's, so her first way out finds the park on the shelf, ready on
 * the first frame and equal to a whole rebuild, instead of laying it a slice
 * a frame while she walks out unrouted. Proved red on 14 Nov 2026 (seed 5
 * restart 1) with the garden's lay taken out of `layHerLatticeNow`: see the
 * PR (#782) for the transcript.
 */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { NAV_GRID_BUILDS, NAV_WARM_BUDGET_MS, NavGrid } from '../src/world/NavGrid.ts';
import { layHerLatticeNow, playerNavGrid } from '../src/world/playerLattice.ts';
import { GARDEN_PLAY_BOUNDARY } from '../src/world/boundary.ts';
import { CASTLE_MALL } from '../src/world/building/floors.ts';
import { castleFloorBounds } from '../src/world/building/floorBounds.ts';
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

// **A boot with no bus ride, restored into a room** (`layHerLatticeNow`, which
// `Game.layNavigationNow` runs before the first frame of a continued save or a
// deep link). Her lattice is laid whole at boot: that is the point, since a
// long task there costs nothing. The garden's lattice must be laid with it,
// left on the shelf behind the room's, so that on her first way out the park
// comes down ready on the first frame instead of being laid a slice a frame
// while she walks out unrouted (about 10 s on the 4× phone stand-in, measured
// 14 Nov 2026). The garden's must also equal a whole rebuild.
{
  const grid = playerNavGrid(world);
  collision.setPlayBounds(castleFloorBounds(CASTLE_MALL));
  const before = { full: NAV_GRID_BUILDS.full, unshelved: NAV_GRID_BUILDS.unshelved, mismatches: NAV_GRID_BUILDS.mismatches.length };
  layHerLatticeNow(grid, collision, sample);
  const wholeAtBoot = NAV_GRID_BUILDS.full - before.full;
  // Her first way out: the first frame's warm, at the game's own budget.
  collision.setPlayBounds(GARDEN_PLAY_BOUNDARY);
  const readyAtOnce = grid.warm(sample, NAV_WARM_BUDGET_MS);
  const cameDown = NAV_GRID_BUILDS.unshelved - before.unshelved;
  const laidAgain = NAV_GRID_BUILDS.full - before.full - wholeAtBoot;
  (grid as unknown as { verifyAgainstWhole(boundary: unknown, sample: unknown): void }).verifyAgainstWhole(GARDEN_PLAY_BOUNDARY, sample);
  const differs = NAV_GRID_BUILDS.mismatches.slice(before.mismatches);
  say(wholeAtBoot === 2, `a boot restored into a room laid ${wholeAtBoot} lattice(s) whole before the first frame — must be 2, the room's and the garden's`);
  say(
    readyAtOnce && cameDown === 1 && laidAgain === 0 && differs.length === 0,
    `…and on her first way out the garden's came off the shelf ${cameDown} time(s), ready on the first frame: ${readyAtOnce}, laid again ${laidAgain} time(s), ` +
      `equal to a whole rebuild: ${differs.length === 0}` + (differs.length ? ` (${differs.slice(0, 2).join(' | ')})` : ''),
  );
}
NAV_GRID_BUILDS.verify = false;

if (failures > 0) {
  console.error(`check:nav-warm: ${failures} failure(s)`);
  process.exit(1);
}
console.log('check:nav-warm passed');
