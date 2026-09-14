/**
 * **Tap-to-move can path outward across the park.**
 *
 * The narrowest possible instrument for the narrowest possible bug, and it
 * needs no park at all: an empty {@link CollisionWorld}, the real terrain as
 * the ground under it, and a route asked from one patch of open grass to
 * another further out. Nothing is in the way. If a route cannot be found, the
 * lattice itself refused, and that is the whole finding.
 *
 * ## What it is for, and what the measurement actually said
 *
 * `NavGrid` classifies a neighbouring cell as steppable when the height change
 * to it is at most `MAX_STEP` (0.62 m, `BUILDING_STEP_UP`). Read as a world
 * `y` that is a comparison against a datum that leans: the ground is a sphere
 * of radius 220 m tangent at the park's origin, so its radial gradient reaches
 * **1.02 m of `y` per metre travelled outward** at the park's 157 m reach. A
 * lattice diagonal is 0.707 m in plan, so an outward diagonal changes `y` by
 * 0.72 m out there, against a 0.62 m allowance, and stops being an edge.
 *
 * **`RADIAL-INVENTORY.md` drew the conclusion "tap-to-move refuses to path
 * outward", and this instrument was written to prove it and did not.** Measured
 * (the sweep below prints it every run): the worst neighbour step over 32
 * bearings is 0.562 m at the walkable garden's 135.4 m edge — *inside* the
 * allowance — and only crosses it at **145 m**, which is 10 m outside anywhere
 * a child can stand. And even past that, only the *diagonals* fail: a straight
 * outward cell is 0.5 m in plan and still clears at the rim, so A* walks a
 * staircase of straights instead and the route is found anyway, a little
 * longer and a little kinkier. **Nobody is refused.** The honest statement of
 * the bug is that the step test was 91% spent on the planet at the garden's
 * edge and had 10 m of headroom left before it broke outright.
 *
 * It is fixed regardless, because a test that is 91% measuring the wrong thing
 * is a test that is about to start giving wrong answers, and because the park's
 * own furniture (the Rail Race rings) already stands at 157 m where 40 of 256
 * swept neighbour steps are over the line. But the inventory's ranking of it as
 * a thing Eleri meets today was wrong, and this docblock says so rather than
 * letting a green run imply it was ever red.
 *
 * ## Two controls, run before the measurement, because a flood fill that is
 * measuring the wrong thing gives clean and confident wrong answers
 *
 * 1. **The instrument can say no.** The same probe is run with the collision
 *    world walled off — a ring of solid wall between start and goal — and must
 *    report the route failing. An instrument that always finds a route would
 *    pass this check on any code at all.
 * 2. **The instrument can say yes.** The same probe is run entirely *inside*
 *    the flat centre of the park, where the ground barely leans and the bug
 *    cannot exist, and must report the route succeeding. An instrument that
 *    never finds a route would also report a clean "fixed" on broken code, by
 *    failing the outward probe for its own unrelated reason.
 *
 * Only if both controls behave does the outward sweep mean anything.
 *
 * ## The one thing the fix gives up, asserted rather than assumed
 *
 * Measuring the step in altitude makes the ground's own **waves** invisible to
 * the lattice: `altitudeAt` takes its datum from `terrainHeight` in the same
 * column, so the terrain's altitude is **identically zero** and every patch of
 * open park is perfectly flat as far as the step test is concerned. That is
 * right — `MAX_STEP` asks "can she walk up this *thing*", and a deck, a kerb or
 * a ball pit's lip still measures its true height above the grass — but it is
 * only harmless while the waves are gentler than the step they replaced.
 *
 * So the sweep below asserts that, and it asserts it against
 * {@link groundWaves} rather than against an altitude. **Written the obvious
 * way it would have been a check that cannot fail**: the altitude of a terrain
 * point is zero by construction, so "the worst altitude step over the terrain"
 * is 0.000 at every radius on any terrain whatsoever, waves or cliffs. It was
 * written that way first, printed 0.000 six times, and only the printing caught
 * it. The wave field is the quantity that was dropped, so the wave field is the
 * quantity guarded, against {@link WAVE_BUDGET}.
 */

import { BUILDING_STEP_UP, PLAYER_RADIUS } from '../src/core/constants.ts';
import { JUMP_APEX_HEIGHT } from '../src/entities/Player.ts';
import { circleBoundary } from '../src/world/boundary.ts';
import { CollisionWorld } from '../src/world/Collision.ts';
import { NavGrid } from '../src/world/NavGrid.ts';
import { altitudeAt, groundWaves, terrainHeight } from '../src/world/terrain.ts';

/** How far out the sweep reaches. The walkable garden is 135.4 m. */
const OUTER = 120;

/** Bearings swept, so the answer is not a property of one direction. */
const BEARINGS = 16;

/** Bearings for the neighbour-step sweep — cheap, so many more of them. */
const STEP_BEARINGS = 32;

/** The lattice's cell size. Kept here rather than exported: see the assertion. */
const CELL = 0.5;

/**
 * How much of `MAX_STEP` the terrain's own undulation may use up.
 *
 * Half. The waves measure 0.08 m at their worst over a cell today, so this is
 * eight times the headroom they need — a tripwire on a retune, not a tight
 * bound. Past it, "the ground is flat to the lattice" stops being true and the
 * altitude step test would let a route climb something a child could not.
 */
const WAVE_BUDGET = BUILDING_STEP_UP / 2;

/** The eight lattice neighbours, straights then diagonals. */
const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/** Route buffer: generous, the router writes (x, y, z) triples. */
const OUT = new Float32Array(4096);

/** The park's real ground, sampled the way `Player` samples it outdoors. */
const sampler = (x: number, z: number, _y: number): number => terrainHeight(x, z);

function gridOver(collision: CollisionWorld, radius: number): NavGrid {
  return new NavGrid(
    collision,
    PLAYER_RADIUS,
    JUMP_APEX_HEIGHT,
    () => [],
    () => false,
    circleBoundary(radius),
  );
}

interface Probe {
  readonly reached: boolean;
  readonly points: number;
}

function route(
  grid: NavGrid,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
): Probe {
  const points = grid.findRoute(
    fromX,
    fromZ,
    terrainHeight(fromX, fromZ),
    toX,
    toZ,
    terrainHeight(toX, toZ),
    sampler,
    OUT,
  );
  return { reached: grid.lastRouteReachedGoal, points };
}

let failures = 0;
const fail = (message: string): void => {
  failures += 1;
  console.error(`FAIL  ${message}`);
};

// ---------------------------------------------------------------- control 1
// A wall across the way. The instrument must be able to report a refusal.
{
  const walled = new CollisionWorld();
  // A wall straight across the outward path and wider than the whole lattice,
  // so there is genuinely no way round it — a wall the router could walk round
  // would make this control pass on a broken instrument.
  walled.addWall(-400, 60, 400, 60, 0.5);
  const grid = gridOver(walled, 140);
  const probe = route(grid, 0, 0, 0, 110);
  if (probe.reached) {
    fail(
      'control 1: a route was found from (0, 0) to (0, 110) straight through a ' +
        'wall at z = 60 that spans the entire lattice. The instrument cannot ' +
        'report a refusal, so its passes below mean nothing.',
    );
  } else {
    process.stderr.write(
      'control 1 ok: the walled probe was refused, so this instrument can fail.\n',
    );
  }
}

// ---------------------------------------------------------------- control 2
// The flat centre of the park. The instrument must be able to report success.
{
  const grid = gridOver(new CollisionWorld(), 140);
  const probe = route(grid, -6, -6, 6, 6);
  if (!probe.reached) {
    fail(
      'control 2: no route across 17 m of empty, near-flat grass at the park’s ' +
        'centre. The instrument is broken in the other direction — it would ' +
        'report the outward sweep red whatever the router did.',
    );
  } else {
    process.stderr.write(
      `control 2 ok: the flat centre routes in ${probe.points} points.\n`,
    );
  }
}

// -------------------------------------------- the neighbour step, by radius
// The quantitative half: how much of MAX_STEP the planet is eating, and where
// it finally eats all of it. Printed on every run, green or red, so the claim
// in this file's header is re-measured rather than remembered.
{
  const RADII = [40, 80, 120, 135.4, 145, 157] as const;
  let firstBroken = Infinity;
  let worstWave = 0;
  const rows: string[] = [];

  for (const r of RADII) {
    let worstY = 0;
    let worstAltitude = 0;
    /** The part of the step that is the wave field rather than the cap. */
    let worstWaveStep = 0;
    let over = 0;
    let swept = 0;

    for (let b = 0; b < STEP_BEARINGS; b += 1) {
      const bearing = (b / STEP_BEARINGS) * Math.PI * 2;
      const x = Math.cos(bearing) * r;
      const z = Math.sin(bearing) * r;
      const y = terrainHeight(x, z);
      const altitude = altitudeAt(x, y, z);
      const wave = groundWaves(x, z);

      for (const [dx, dz] of NEIGHBOURS) {
        const nx = x + dx * CELL;
        const nz = z + dz * CELL;
        const ny = terrainHeight(nx, nz);
        const stepY = Math.abs(ny - y);
        const stepAltitude = Math.abs(altitudeAt(nx, ny, nz) - altitude);
        worstY = Math.max(worstY, stepY);
        worstAltitude = Math.max(worstAltitude, stepAltitude);
        worstWaveStep = Math.max(worstWaveStep, Math.abs(groundWaves(nx, nz) - wave));
        swept += 1;
        if (stepY > BUILDING_STEP_UP) over += 1;
      }
    }

    worstWave = Math.max(worstWave, worstWaveStep);
    if (over > 0) firstBroken = Math.min(firstBroken, r);
    rows.push(
      `  ${String(r).padStart(6)} m   worst step in y ${worstY.toFixed(3)} m ` +
        `(${((worstY / BUILDING_STEP_UP) * 100).toFixed(0)}% of MAX_STEP, ` +
        `${over}/${swept} over) | in altitude ${worstAltitude.toFixed(3)} m ` +
        `(zero by construction — the guarded number is the wave step, ` +
        `${worstWaveStep.toFixed(3)} m)`,
    );
  }

  process.stderr.write(
    `the neighbour step against MAX_STEP = ${BUILDING_STEP_UP} m:\n${rows.join('\n')}\n`,
  );

  if (worstWave > WAVE_BUDGET) {
    fail(
      `the terrain's own undulation reaches ${worstWave.toFixed(3)} m over one ` +
        `${CELL} m cell, past the ${WAVE_BUDGET.toFixed(3)} m this check allows ` +
        'it. The lattice measures its step in altitude, which is blind to the ' +
        'waves by construction, and that is only safe while the waves are much ' +
        'gentler than a step. Either retune them back or stop taking the datum ' +
        'from terrainHeight.',
    );
  }

  process.stderr.write(
    firstBroken === Infinity
      ? 'no swept radius out to 157 m breaks MAX_STEP in world y.\n'
      : `read in world y, the step first breaks MAX_STEP at ${firstBroken} m — ` +
          'outside the 135.4 m walkable garden, which is why no route was ever ' +
          'actually refused. See this file\'s header.\n',
  );
}

// ------------------------------------------------------- the routes themselves
{
  const grid = gridOver(new CollisionWorld(), 140);
  let refused = 0;
  let worstBearing = -1;

  for (let i = 0; i < BEARINGS; i += 1) {
    const bearing = (i / BEARINGS) * Math.PI * 2;
    const x = Math.cos(bearing) * OUTER;
    const z = Math.sin(bearing) * OUTER;

    const out = route(grid, 0, 0, x, z);
    if (!out.reached) {
      refused += 1;
      if (worstBearing < 0) worstBearing = i;
    }

    const back = route(grid, x, z, 0, 0);
    if (!back.reached) {
      fail(
        `inward route from (${x.toFixed(1)}, ${z.toFixed(1)}) to the park's ` +
          'centre was refused. Inward diagonals were always passable; this is a ' +
          'regression in the other direction.',
      );
    }
  }

  const drop = terrainHeight(OUTER, 0) - terrainHeight(0, 0);
  if (refused > 0) {
    fail(
      `${refused} of ${BEARINGS} outward routes to ${OUTER} m were refused over ` +
        `completely empty ground (first at bearing index ${worstBearing}). The ` +
        `ground falls ${(-drop).toFixed(1)} m over that leg. This has never been ` +
        'red, on the fixed router or the flat one — see the header — so a ' +
        'failure here is something new.',
    );
  } else {
    console.log(
      `check:outward-routing: ${BEARINGS}/${BEARINGS} outward routes to ${OUTER} m ` +
        `and ${BEARINGS}/${BEARINGS} back, over empty ground that falls ` +
        `${(-drop).toFixed(1)} m along the way. Both controls behaved.`,
    );
  }
}

if (failures > 0) {
  console.error(`check:outward-routing: ${failures} failure(s).`);
  process.exit(1);
}
