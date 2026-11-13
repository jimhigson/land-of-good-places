/**
 * **`check:nav-spaces` — a room furnished in another space never rebuilds the
 * park's route lattice** (step 1 follow-up of the 120 fps plan,
 * `docs/perf/FRAME-DROPS-2026-11.md`).
 *
 * ```
 * pnpm run check:nav-spaces
 * NAV_SPACES_MUTATE=whole pnpm run check:nav-spaces   # patching off (every change rebuilds whole): must go red
 * ```
 *
 * Every interior is a lazy room now: its colliders are registered the moment
 * she first walks in, hundreds of them in one burst, 279 m or more from the
 * park. QA on #759 measured what that did: a **459–517 ms** frame about 3.4 s
 * after she first entered the castle, when a park child's next route plan found
 * the park lattice behind the collision world's revision and rebuilt the whole
 * park (`NavGrid.ensureLattice`). The floors are disjoint spaces; a solid in one
 * changes nothing in another.
 *
 * So: build the park children's lattice exactly as `JourneyPlanner` builds it,
 * register a real room's worth of colliders where that room stands (copied from
 * the reptile house's own solids — same count, same footprints, same place), ask
 * the lattice a question as a route plan would, and assert **0 whole rebuilds**
 * and a lattice identical to a whole rebuild. Then the control: the same
 * colliders moved into the park must be seen — the lattice must change — or
 * this check could not see anything at all.
 */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { NAV_GRID_BUILDS, NavGrid } from '../src/world/NavGrid.ts';
import { GARDEN_PLAY_BOUNDARY } from '../src/world/boundary.ts';
import { PLAYER_RADIUS } from '../src/core/constants.ts';
import { JUMP_APEX_HEIGHT } from '../src/entities/Player.ts';

const MUTATE = process.env['NAV_SPACES_MUTATE'] ?? '';
if (MUTATE !== '' && MUTATE !== 'whole') throw new Error(`NAV_SPACES_MUTATE=${MUTATE}: the only mutation is 'whole'`);

let failures = 0;
const say = (ok: boolean, line: string): void => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${line}`);
};

const { world } = quietly(() => buildHeadlessPark());
const collision = world.collision;
const sample = (x: number, z: number, y: number): number => world.building.surfaces.sample(x, z, y);

// The room: every solid the reptile house registered, as its footprint.
const room: { x: number; z: number; r: number }[] = [];
collision.forEachSolid((solid) => {
  if (solid.owner === 'reptile house' && !solid.moving) room.push({ x: solid.centreX, z: solid.centreZ, r: Math.max(0.05, solid.reach) });
});
const roomX = room.reduce((s, c) => s + c.x, 0) / Math.max(1, room.length);
const roomZ = room.reduce((s, c) => s + c.z, 0) / Math.max(1, room.length);
const edge = GARDEN_PLAY_BOUNDARY.distanceToEdge(roomX, roomZ);
console.log(
  `check:nav-spaces: the room is the reptile house's ${room.length} solids, centred (${roomX.toFixed(0)}, ${roomZ.toFixed(0)}), ` +
    `${(-edge).toFixed(0)} m outside the park's edge`,
);
say(room.length > 0, `the room has solids to register (${room.length}) — otherwise this check asserts nothing`);

const parkGrid = (): NavGrid => new NavGrid(collision, PLAYER_RADIUS, JUMP_APEX_HEIGHT, world.routeConnectors, world.routeBridgeCovers, GARDEN_PLAY_BOUNDARY);
const ask = (grid: NavGrid): void => {
  grid.canStandAt(0, 0, 0, sample);
};

if (MUTATE === 'whole') {
  NAV_GRID_BUILDS.patching = false;
  console.log('  note: PATCHING TURNED OFF on purpose — every collider change rebuilds whole, as before; this run must go red');
}
NAV_GRID_BUILDS.verify = true;

// ── The room, furnished in its own space. ──
const park = parkGrid();
ask(park);
const before = { full: NAV_GRID_BUILDS.full, patched: NAV_GRID_BUILDS.patched, fullMs: NAV_GRID_BUILDS.fullMs, patchMs: NAV_GRID_BUILDS.patchMs };
NAV_GRID_BUILDS.mismatches.length = 0;
const revisionBefore = collision.revision;
const added = room.map((c) => collision.addCircle(c.x, c.z, c.r));
const moved = collision.revision - revisionBefore;
ask(park);
// The lattice's own time, whole build or patch — never the verifier's whole rebuild beside it.
const tookMs = NAV_GRID_BUILDS.fullMs - before.fullMs + (NAV_GRID_BUILDS.patchMs - before.patchMs);
const whole = NAV_GRID_BUILDS.full - before.full;
say(
  whole === 0,
  `furnishing the room (${moved} revisions, ${added.length} colliders) then planning in the park rebuilt the park's lattice whole ${whole} time(s) — must be 0`,
);
say(
  NAV_GRID_BUILDS.mismatches.length === 0,
  `the park's lattice after it equals a whole rebuild` + (NAV_GRID_BUILDS.mismatches.length ? `: ${NAV_GRID_BUILDS.mismatches.slice(0, 3).join(' | ')}` : ''),
);
process.stderr.write(
  `check:nav-spaces timing (this machine, Node, not asserted): the park's next plan after the room took ${tookMs.toFixed(1)} ms to bring its lattice up to date ` +
    `(${whole > 0 ? 'a whole rebuild' : 'no whole rebuild'}; the verifier's own rebuild excluded), against an 8.3 ms frame\n`,
);
for (const id of added) collision.removeCircle(id);

// ── The control: the same colliders in the park must be seen. ──
NAV_GRID_BUILDS.patching = true;
const control = parkGrid();
ask(control);
const controlBefore = { full: NAV_GRID_BUILDS.full, cells: NAV_GRID_BUILDS.patchedCells };
const inPark = room.slice(0, 40).map((c, i) => collision.addCircle((i % 8) * 6 - 21, Math.floor(i / 8) * 6 - 12, Math.min(c.r, 1.2)));
ask(control);
const seen = NAV_GRID_BUILDS.full - controlBefore.full + (NAV_GRID_BUILDS.patchedCells - controlBefore.cells);
say(seen > 0, `CONTROL: ${inPark.length} of the same colliders dropped in the park's middle are seen by its lattice (${seen} whole build(s) plus patched cells) — the instrument can see a change`);
for (const id of inPark) collision.removeCircle(id);
NAV_GRID_BUILDS.verify = false;

if (failures > 0) {
  console.error(`check:nav-spaces: ${failures} failure(s)`);
  process.exit(1);
}
console.log('check:nav-spaces passed');
