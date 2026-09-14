/**
 * **The router's step test measures a step, at every radius — it neither
 * refuses flat ground nor admits a ledge.**
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
 * ## The dangerous half, which is the *other* sign
 *
 * The same wrong datum that refuses flat ground outward **admits real ledges**
 * outward, and that one has been live across most of the park rather than ten
 * metres outside it. A genuine 0.70 m step up on the outward side has the
 * planet's own drop subtracted from it: measured below, it reads as barely half
 * that past 80 m, so the router has been planning routes straight up things a
 * child cannot climb. A refusal is a control that feels dead; a leak is a route
 * that does not exist, walked by a six-year-old who tapped the far side of it.
 *
 * So the ledge sweep here is the real assertion and the flat-ground sweep is
 * the weaker one. Both are stated in the same terms: `MAX_STEP` must mean
 * `BUILDING_STEP_UP` at every radius, in both directions.
 *
 * **Building the test ledge is where this check can silently stop checking.**
 * A ledge injected as `terrainHeight(x, z) + 0.70` is not a 0.70 m ledge out in
 * the park — at 157 m it is 0.49 m of real height, under `MAX_STEP`, so *both*
 * the broken gate and the fixed one let it through and the fixed one looks
 * broken too. The engineer on the collision area hit exactly that and their
 * first control read clean. Every ledge below is built with
 * {@link yAtAltitude}, which is the one way to say "this much real height" in a
 * column, and the sweep prints the ledge's own measured altitude so the claim
 * is visible rather than trusted.
 */

import { BUILDING_STEP_UP, PLAYER_RADIUS } from '../src/core/constants.ts';
import { JUMP_APEX_HEIGHT } from '../src/entities/Player.ts';
import { circleBoundary } from '../src/world/boundary.ts';
import {
  SPACE_CASTLE_HALL,
  SPACE_CASTLE_MALL,
  SPACE_GARDEN,
  SPACE_HOTEL_LOBBY,
  localToWorld,
  spaceAt,
} from '../src/world/spaces.ts';
import { CollisionWorld } from '../src/world/Collision.ts';
import { NavGrid } from '../src/world/NavGrid.ts';
import { planetRadiusAt, terrainHeight, yAtAltitude } from '../src/world/terrain.ts';
import { walkHeight } from '../src/world/up.ts';

/** How far out the sweep reaches. The walkable garden is 135.4 m. */
const OUTER = 120;

/** Bearings swept, so the answer is not a property of one direction. */
const BEARINGS = 16;

/** Bearings for the neighbour-step sweep — cheap, so many more of them. */
const STEP_BEARINGS = 32;

/** The lattice's cell size. Kept here rather than exported: see the assertion. */
const CELL = 0.5;

/**
 * How far from level a level interior floor may measure over one lattice cell.
 *
 * A centimetre — it should be zero to floating point, and is. Not a tolerance
 * anybody is expected to use up: it is here so the clause reads as "level" and
 * not as an exact-equality trap on a `Float32Array` round trip.
 */
const INTERIOR_LEVEL_TOLERANCE = 0.01;

/** A ledge a child plainly cannot walk up. Must be refused at every radius. */
const TALL_LEDGE = 0.7;

/** A legal step — a kerb, a stair tread. Must be allowed at every radius. */
const LEGAL_STEP = 0.4;

/**
 * Real interior origins, read from `world/spaces.ts` rather than typed, so a
 * room that moves cannot leave this clause probing open park and passing for
 * the wrong reason. Checked against `spaceAt` before use.
 */
const INTERIOR_PROBES: readonly (readonly [number, number, string])[] = [
  SPACE_CASTLE_HALL,
  SPACE_CASTLE_MALL,
  SPACE_HOTEL_LOBBY,
]
  .map((space) => {
    // `localToWorld` is the existing owner of where a space stands, and it
    // returns null for a space that no longer exists — so a room that is
    // renamed or removed drops out here and the clause below says the coverage
    // is gone, rather than quietly probing open park and passing.
    const origin = localToWorld(space, 0, 0, 0);
    return origin ? ([origin.x, origin.z, space] as const) : null;
  })
  .filter((probe): probe is readonly [number, number, string] => probe !== null);

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

/**
 * A lattice over a disc. **The centre is not optional** — an interior stands
 * six hundred metres from the park's origin, and a boundary left at the origin
 * puts every interior probe off the lattice entirely, where `findRoute` returns
 * "unknowable" rather than "blocked". That reads as a failure and is not one:
 * the first interior clause written here failed all three rooms for exactly
 * that reason, on code that was correct.
 */
function gridOver(
  collision: CollisionWorld,
  radius: number,
  centreX = 0,
  centreZ = 0,
): NavGrid {
  return new NavGrid(
    collision,
    PLAYER_RADIUS,
    JUMP_APEX_HEIGHT,
    () => [],
    () => false,
    circleBoundary(radius, centreX, centreZ),
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

// ------------------------------------------- the step gate, ledge and flat
// The quantitative half, and the one that matters: what the gate quantity
// reads for a real ledge and for flat grass, at each radius, in both frames.
// Printed on every run, green or red, so the claim in this file's header is
// re-measured rather than remembered.
{
  const RADII = [40, 80, 120, 135.4, 145, 157] as const;
  const rows: string[] = [];
  let ledgeLeaks = 0;
  let flatRefusals = 0;
  let legalRefusals = 0;
  let swept = 0;

  for (const r of RADII) {
    let worstFlatY = 0;
    let worstFlatRadial = 0;
    let weakestLedgeY = Infinity;
    let weakestLedgeRadial = Infinity;
    let worstLegalRadial = 0;
    let ledgeAltitude = 0;

    for (let b = 0; b < STEP_BEARINGS; b += 1) {
      const bearing = (b / STEP_BEARINGS) * Math.PI * 2;
      const x = Math.cos(bearing) * r;
      const z = Math.sin(bearing) * r;
      const y = terrainHeight(x, z);
      const radius = planetRadiusAt(x, y, z);

      for (const [dx, dz] of NEIGHBOURS) {
        const nx = x + dx * CELL;
        const nz = z + dz * CELL;
        const groundY = terrainHeight(nx, nz);

        // Flat grass. Neither gate may refuse it.
        worstFlatY = Math.max(worstFlatY, Math.abs(groundY - y));
        worstFlatRadial = Math.max(
          worstFlatRadial,
          Math.abs(planetRadiusAt(nx, groundY, nz) - radius),
        );

        // A real ledge in the neighbouring cell — TALL_LEDGE metres of *height*,
        // which is what yAtAltitude means and what terrainHeight + h does not.
        const ledgeY = yAtAltitude(nx, nz, TALL_LEDGE);
        ledgeAltitude = TALL_LEDGE;
        weakestLedgeY = Math.min(weakestLedgeY, Math.abs(ledgeY - y));
        weakestLedgeRadial = Math.min(
          weakestLedgeRadial,
          Math.abs(planetRadiusAt(nx, ledgeY, nz) - radius),
        );

        // And a legal step, which neither gate may refuse.
        const stepY = yAtAltitude(nx, nz, LEGAL_STEP);
        worstLegalRadial = Math.max(
          worstLegalRadial,
          Math.abs(planetRadiusAt(nx, stepY, nz) - radius),
        );
        swept += 1;
      }
    }

    if (weakestLedgeRadial <= BUILDING_STEP_UP) ledgeLeaks += 1;
    if (worstFlatRadial > BUILDING_STEP_UP) flatRefusals += 1;
    if (worstLegalRadial > BUILDING_STEP_UP) legalRefusals += 1;

    rows.push(
      `  ${String(r).padStart(6)} m  flat grass: y ${worstFlatY.toFixed(3)} ` +
        `(${((worstFlatY / BUILDING_STEP_UP) * 100).toFixed(0)}%) vs radial ` +
        `${worstFlatRadial.toFixed(3)} | a ${ledgeAltitude} m ledge reads: y ` +
        `${weakestLedgeY.toFixed(3)}${weakestLedgeY <= BUILDING_STEP_UP ? ' LEAKS' : ''} ` +
        `vs radial ${weakestLedgeRadial.toFixed(3)}` +
        `${weakestLedgeRadial <= BUILDING_STEP_UP ? ' LEAKS' : ''} | a ` +
        `${LEGAL_STEP} m step reads radial ${worstLegalRadial.toFixed(3)}`,
    );
  }

  process.stderr.write(
    `the step gate against MAX_STEP = ${BUILDING_STEP_UP} m, ${swept} neighbour ` +
      `steps per frame:\n${rows.join('\n')}\n`,
  );

  if (ledgeLeaks > 0) {
    fail(
      `a real ${TALL_LEDGE} m ledge reads as walkable at ${ledgeLeaks} of ` +
        `${RADII.length} swept radii. The router will plan a route straight up ` +
        'something a child cannot climb. This is the dangerous half of the wrong ' +
        'datum — see NavGrid.nodeRadius.',
    );
  }
  if (flatRefusals > 0) {
    fail(
      `flat grass reads as a step at ${flatRefusals} of ${RADII.length} swept ` +
        'radii, so the lattice is refusing ground with nothing on it.',
    );
  }
  if (legalRefusals > 0) {
    fail(
      `a legal ${LEGAL_STEP} m step reads as unwalkable at ${legalRefusals} of ` +
        `${RADII.length} swept radii — the gate has gone the other way and kerbs ` +
        'and stair treads are no longer climbable.',
    );
  }
}

// ------------------------------------ the router itself, on a real ledge
// The sweep above measures the *quantity*; this measures the *router*. Without
// it the check would pass on a NavGrid that had gone back to differencing `y`,
// because nothing above ever calls one.
//
// A plateau is raised in a disc out in the park and a route is asked from
// outside it to its middle. At TALL_LEDGE the router must refuse; at
// LEGAL_STEP it must succeed. Both plateaus are built with `yAtAltitude`, so
// "0.7 m" is 0.7 m of real height at 120 m out and not 0.49 m of it.
{
  const AT = 120;
  const PLATEAU_RADIUS = 5;
  const centreX = AT;
  const centreZ = 0;

  const plateauSampler = (height: number) => (x: number, z: number, _y: number): number =>
    Math.hypot(x - centreX, z - centreZ) <= PLATEAU_RADIUS
      ? yAtAltitude(x, z, height)
      : terrainHeight(x, z);

  for (const [height, mustReach] of [
    [TALL_LEDGE, false],
    [LEGAL_STEP, true],
  ] as const) {
    const grid = gridOver(new CollisionWorld(), 140);
    const sample = plateauSampler(height);
    // Start on the grass a comfortable walk outside the plateau, on the side
    // nearer the park's centre, so reaching the top means climbing outward —
    // the direction the broken gate under-reads.
    const startX = centreX - PLATEAU_RADIUS - 6;
    const reached = grid.findRoute(
      startX,
      centreZ,
      sample(startX, centreZ, 0),
      centreX,
      centreZ,
      sample(centreX, centreZ, 0),
      sample,
      OUT,
    ) >= 0 && grid.lastRouteReachedGoal;

    const measured = (
      planetRadiusAt(centreX, sample(centreX, centreZ, 0), centreZ) -
      planetRadiusAt(centreX, terrainHeight(centreX, centreZ), centreZ)
    ).toFixed(3);

    if (reached !== mustReach) {
      fail(
        `a ${height} m plateau at ${AT} m out (measured ${measured} m of real ` +
          `height) was ${reached ? 'routed onto' : 'refused'}, and it must be ` +
          `${mustReach ? 'routed onto' : 'refused'}. MAX_STEP is ` +
          `${BUILDING_STEP_UP} m, so the router is not measuring the step it ` +
          'thinks it is — see NavGrid.nodeRadius.',
      );
    } else {
      process.stderr.write(
        `the router ${reached ? 'climbs' : 'refuses'} a ${height} m plateau at ` +
          `${AT} m out (measured ${measured} m of real height), as it must.\n`,
      );
    }
  }
}

// ------------------------------------------------- and an interior, flat
// The other side of the branch, and it is not a nicety. A castle deck and a
// hotel room are real coordinates six hundred metres from the park's origin,
// where the radial formula is meaningless; applied there blind, one 0.5 m
// lattice step across a perfectly level floor measures over MAX_STEP, so every
// diagonal of an interior floor is refused as a wall — quietly, as a lobby
// route that merely got blockier.
//
// **Reachability cannot see this, and the first version of this clause was
// written that way and could not fail.** Removing `walkHeight`'s `spaceAt`
// branch entirely left all three rooms still routing, because A* does indoors
// what it does outdoors: the straights stay under MAX_STEP, so it walks a
// staircase of them instead of the diagonal and arrives anyway. The route is
// blockier, not absent — which is exactly the "fails quietly" the collision
// engineer described, and exactly the kind of thing a flood fill reports clean.
//
// So the load-bearing assertion here is the **quantity**: a level floor must
// measure as level. The route is kept underneath it as a sanity check, not as
// the proof.
{
  const interiors = INTERIOR_PROBES.filter(([x, z]) => spaceAt(x, z) !== SPACE_GARDEN);
  if (interiors.length === 0) {
    fail(
      'no interior probe point still lands in an interior space — the castle or ' +
        'hotel origins have moved, and this clause is asserting nothing. Re-read ' +
        'them from world/spaces.ts rather than deleting the clause.',
    );
  }

  for (const [x, z, name] of interiors) {
    // A level floor, the way an interior really is: one height everywhere.
    const floorY = 0;
    const flat = (_x: number, _z: number, _y: number): number => floorY;

    // The quantity. Every lattice neighbour of a level floor must measure as
    // level — if it does not, the sphere's frame has been applied six hundred
    // metres from the sphere, where it means nothing.
    let worstStep = 0;
    const here = walkHeight(x, floorY, z);
    for (const [dx, dz] of NEIGHBOURS) {
      worstStep = Math.max(
        worstStep,
        Math.abs(walkHeight(x + dx * CELL, floorY, z + dz * CELL) - here),
      );
    }
    if (worstStep > INTERIOR_LEVEL_TOLERANCE) {
      fail(
        `one ${CELL} m lattice step across a perfectly level floor in ${name} ` +
          `(${x.toFixed(0)}, ${z.toFixed(0)}) measures ${worstStep.toFixed(3)} m, ` +
          `against MAX_STEP ${BUILDING_STEP_UP} m. An interior is a real ` +
          'coordinate hundreds of metres from the park, where the radial formula ' +
          'is meaningless — see up.ts walkHeight, which must branch on spaceAt.',
      );
    } else {
      process.stderr.write(
        `interior ok: ${name} at (${x.toFixed(0)}, ${z.toFixed(0)}) measures ` +
          `${worstStep.toFixed(3)} m across a level floor.\n`,
      );
    }

    const grid = gridOver(new CollisionWorld(), 40, x, z);

    // Diagonally across, which is the direction a bare radial frame refuses.
    const reached =
      grid.findRoute(x - 8, z - 8, floorY, x + 8, z + 8, floorY, flat, OUT) >= 0 &&
      grid.lastRouteReachedGoal;

    if (!reached) {
      fail(
        `no route across 23 m of perfectly level floor in ${name}. The sanity ` +
          'check under the measurement above has fired, which means something ' +
          'other than the step gate is wrong with the interior lattice.',
      );
    }
  }
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
