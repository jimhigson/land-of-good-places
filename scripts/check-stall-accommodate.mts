/**
 * **Proves a stall will actually step aside, and that stepping aside costs
 * nothing.**
 *
 * Jim, 16 Sep 2026: *"maybe a stall would move, but this would be on the class
 * that does the stall placement to decide to move it to a position to
 * acoomodate a feature that needs the space more."* `world/stallsFeature.ts`
 * is that class. Measured over every seed in the pool and over 0..15, **no
 * seed refuses anything against a stall** — the layout keeps five metres of
 * walkable ground between plots, so nothing in the world phase ever needs a
 * booth's square metre. The capability was asked for regardless, and a
 * mechanism no seed exercises is a mechanism nobody would notice breaking.
 *
 * So this constructs the case instead: a real built park, the **real** stalls
 * builder the world phase just drove (`worldSolveStallBuilder()`), the real
 * registry and the real collision world — and a synthetic refused claim laid
 * across a booth's front wall, which is exactly what the driver hands
 * `accommodate` when a lamp or a trestle is refused by one.
 *
 * ## The control comes first
 *
 * CLAUDE.md is emphatic about this and it is why the reachability instrument
 * is exercised **before** it is trusted: "two agents got clean, decisive,
 * entirely wrong answers from flood fills that were measuring the wrong
 * thing, and only the control caught it." So the flood is asked two questions
 * whose answers are known before it is asked anything that matters — a point
 * a child certainly can reach, and a point she certainly cannot — and the run
 * is **VOID** rather than green if it gets either wrong.
 *
 * ## What it then asserts
 *
 * 1. **It moves.** A booth asked to clear a claim across its own counter
 *    returns an increment, not a refusal.
 * 2. **It really cleared the asker.** None of the booth's new claims overlaps
 *    the claim it was asked to clear.
 * 3. **Mesh, collider and claim moved together.** The prop's group is at the
 *    new spot; every new claim has a matching wall collider in the built
 *    world; the old walls are gone (the wall count is unchanged).
 * 4. **The counter still works.** The new stand point has room for a
 *    `PLAYER_RADIUS` body and is still reachable from the park entrance on a
 *    lattice rebuilt over the moved booth.
 * 5. **The refusal path leaves nothing half-moved.** Asked to clear something
 *    it cannot clear, the booth refuses *and* is exactly where it was —
 *    position, claims and colliders — which is the failure mode that would
 *    otherwise ship a booth whose collider is a metre from its mesh.
 *
 * Run: `pnpm run check:stall-accommodate` (`LGP_SEED=n` for any seed).
 */
import './headless-canvas.mjs';
import { buildHeadlessPark } from './park-harness.mts';
import { NavGrid, MAX_ROUTE_WAYPOINTS } from '../src/world/NavGrid.ts';
import { PLAYER_RADIUS } from '../src/core/constants.ts';
import { JUMP_APEX_HEIGHT } from '../src/entities/Player.ts';
import { ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z } from '../src/world/entrance/layout.ts';
import { worldSolveStallBuilder } from '../src/world/worldPhase.ts';
import { isRefusal } from '../src/boot/featureBuilder.ts';
import { shapesOverlap, type Claim } from '../src/boot/groundClaims.ts';
import { boothBoxFor } from '../src/minigames/boothFootprint.ts';
import { STALL_PLACEMENTS, STALL_STANDS_BY_ID } from '../src/minigames/stallPlacement.ts';

const failures: string[] = [];
const fail = (message: string): void => {
  failures.push(message);
  console.log(`FAIL  ${message}`);
};
const pass = (message: string): void => {
  console.log(`ok    ${message}`);
};
const die = (message: string): never => {
  console.log(`VOID  ${message}`);
  process.exit(2);
};

const seed = process.env['LGP_SEED'] ?? 'canonical';
const { world, scene, sample } = buildHeadlessPark();
const collision = world.collision;
const claims = world.groundClaims;

console.log(`check:stall-accommodate — seed ${seed}`);

// --------------------------------------------------------------- instrument

const routeBuffer = new Float32Array(MAX_ROUTE_WAYPOINTS * 2);
/**
 * The real nav lattice, built the way `check:park` and `Game` build one, so
 * "reachable" here means what it means in play. Rebuilt from scratch whenever
 * the world has changed under it — a lattice is a snapshot of the colliders it
 * was made over, and a booth that moved makes the old one a description of a
 * park that no longer exists.
 */
function reachabilityFromEntrance(): (x: number, z: number) => boolean {
  const grid = new NavGrid(collision, PLAYER_RADIUS, JUMP_APEX_HEIGHT, undefined, (x, z) =>
    world.train.bridges.some((bridge) => bridge.covers(x, z)),
  );
  return (x: number, z: number): boolean => {
    const count = grid.findRoute(
      ENTRANCE_PLAYER_X,
      ENTRANCE_PLAYER_Z,
      sample(ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z, 0),
      x,
      z,
      0,
      sample,
      routeBuffer,
    );
    if (count === 0) return false;
    const endX = routeBuffer[(count - 1) * 2] ?? Infinity;
    const endZ = routeBuffer[(count - 1) * 2 + 1] ?? Infinity;
    return Math.hypot(endX - x, endZ - z) < 1.5;
  };
}

// ------------------------------------------------- CONTROL, before anything

{
  const reachable = reachabilityFromEntrance();
  // Known yes: the spot the entrance itself stands a child on.
  if (!reachable(ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z)) {
    die(
      'the reachability instrument says the park entrance cannot reach itself — it is measuring ' +
        'something other than what a child can walk to, and every answer below would be worthless',
    );
  }
  // Known no: a spot far outside the boundary wall, where no child can stand.
  const outside = 400;
  if (reachable(outside, outside)) {
    die(
      `the reachability instrument says (${outside}, ${outside}) — hundreds of metres outside the ` +
        'park — is reachable from the entrance. It cannot say no, so its yes means nothing',
    );
  }
  pass('control: the reachability instrument says yes to the entrance and no to 400 m outside the park');
}

// ------------------------------------------------------- the booth to drive

const builder = worldSolveStallBuilder();
if (!builder || !builder.accommodate) {
  die('the world phase exposed no stalls builder with an accommodate — nothing to prove');
}
const accommodate = builder.accommodate.bind(builder);

/** Where a booth's prop is actually drawn, off the scene graph. */
function drawnAt(id: string): { x: number; z: number } {
  const names: Record<string, string> = { facePaint: 'facePaintStall', keychain: 'keychainShop' };
  const group = scene.getObjectByName(names[id] ?? `stall:${id}`);
  if (!group) die(`no scene group for stall '${id}' — the park did not build the booth`);
  group.updateMatrixWorld(true);
  const m = group.matrixWorld.elements;
  return { x: m[12] as number, z: m[14] as number };
}

/** This booth's four wall claims, found in the registry by where it is drawn. */
function wallClaimsOf(id: string): { claim: Claim; index: number }[] {
  const box = boothBoxFor(id);
  const at = drawnAt(id);
  const reach = Math.hypot(box.halfWidth, Math.max(box.front, -box.back)) + 1e-3;
  const out: { claim: Claim; index: number }[] = [];
  claims.claimsOf('stalls').forEach((claim, index) => {
    const shape = claim.shape;
    if (claim.kind !== 'footprint' || shape.shape !== 'capsule') return;
    const midX = (shape.x1 + shape.x2) / 2;
    const midZ = (shape.z1 + shape.z2) / 2;
    if (Math.hypot(midX - at.x, midZ - at.z) <= reach) out.push({ claim, index });
  });
  return out;
}

function wallCount(): number {
  let count = 0;
  collision.forEachWall(() => {
    count += 1;
  });
  return count;
}

function hasMatchingCollider(claim: Claim): boolean {
  const shape = claim.shape;
  if (shape.shape !== 'capsule') return false;
  let found = false;
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-3;
  collision.forEachWall((x1, z1, x2, z2, halfThickness) => {
    if (found || !near(halfThickness, shape.halfWidth)) return;
    if (
      (near(x1, shape.x1) && near(z1, shape.z1) && near(x2, shape.x2) && near(z2, shape.z2)) ||
      (near(x1, shape.x2) && near(z1, shape.z2) && near(x2, shape.x1) && near(z2, shape.z1))
    ) {
      found = true;
    }
  });
  return found;
}

/**
 * The claim a refused feature would hand over: a lamp-sized disc sitting on the
 * middle of this booth's front wall. Nothing about it is special — it is the
 * shape of every `keepClearOf` the driver passes.
 */
function askerClaimOn(wall: Claim): Claim {
  const shape = wall.shape as { x1: number; z1: number; x2: number; z2: number };
  return {
    kind: 'footprint',
    shape: { shape: 'disc', x: (shape.x1 + shape.x2) / 2, z: (shape.z1 + shape.z2) / 2, radius: 0.5 },
  };
}

// The six mini-game booths are the ones that move; `facePaint` and `keychain`
// are built from world coordinates in too many places and answer "no" by
// design, which clause 5 below covers.
//
// **Every one of the six is asked, not just the first that says yes.** The
// first cut stopped at the first booth that moved, which meant the ferris
// kiosk — the one booth placed by relation to the wheel rather than on a plot
// of its own, and so the one whose spur end is found by a different route —
// was never exercised at all. Asking all six also reaches the branch where a
// booth tries every ring and refuses, which is the one place a booth could be
// left with its mesh and its colliders apart.
const movableIds = Object.keys(STALL_PLACEMENTS).filter((id) => id !== 'facePaint' && id !== 'keychain');

let proved = false;
let movedCount = 0;
let refusedAfterSearch = 0;
for (const id of movableIds) {
  const before = drawnAt(id);
  const mine = wallClaimsOf(id);
  if (mine.length !== 4) {
    fail(`'${id}': the registry holds ${mine.length} wall claims where it is drawn, not 4`);
    continue;
  }
  const front = mine[0] as { claim: Claim; index: number };
  const asker = askerClaimOn(front.claim);
  const wallsBefore = wallCount();

  const outcome = accommodate(front.index, 1, [asker]);
  if (isRefusal(outcome)) {
    refusedAfterSearch += 1;
    console.log(`      '${id}' refused: ${outcome.reason}`);
    // A refusal must leave the booth exactly as it was — clause 5, run here
    // because a refusal is what we have in hand.
    const after = drawnAt(id);
    const moved = Math.hypot(after.x - before.x, after.z - before.z);
    if (moved > 1e-6) {
      fail(`'${id}' refused to move and moved ${moved.toFixed(3)} m anyway`);
    } else if (wallCount() !== wallsBefore) {
      fail(
        `'${id}' refused to move and the world went from ${wallsBefore} walls to ${wallCount()} — ` +
          'its colliders were taken out and not put back',
      );
    } else if (!mine.every(({ claim }) => hasMatchingCollider(claim))) {
      fail(`'${id}' refused to move and one of its original walls is no longer solid`);
    } else {
      pass(`'${id}' refused and is exactly where it was: ${wallsBefore} walls, all four still solid`);
    }
    continue;
  }

  // The driver commits the returned increment into the section it moved.
  const section = claims.sectionOfClaim('stalls', front.index);
  claims.commitSection('stalls', section, { claims: outcome.claims });

  const after = drawnAt(id);
  const shift = Math.hypot(after.x - before.x, after.z - before.z);
  if (shift <= 1e-6) {
    fail(`'${id}' returned an increment but its prop is still at (${before.x.toFixed(2)}, ${before.z.toFixed(2)})`);
    continue;
  }
  pass(
    `'${id}' stepped aside ${shift.toFixed(2)} m: (${before.x.toFixed(2)}, ${before.z.toFixed(2)}) → ` +
      `(${after.x.toFixed(2)}, ${after.z.toFixed(2)}) — ${outcome.label ?? ''}`,
  );

  // 2. it actually cleared the thing it was asked to clear
  const stillFouling = outcome.claims.filter((claim) => shapesOverlap(claim.shape, asker.shape));
  if (stillFouling.length > 0) {
    fail(`'${id}' moved but ${stillFouling.length} of its claims still sit on the claim it was asked to clear`);
  } else {
    pass(`'${id}' is clear of the asker's claim it was refused against`);
  }

  // 3. mesh, collider and claim moved together
  const nowWalls = outcome.claims.filter((claim) => claim.kind === 'footprint');
  const unsolid = nowWalls.filter((claim) => !hasMatchingCollider(claim));
  if (unsolid.length > 0) {
    fail(`'${id}' moved and ${unsolid.length} of its four new walls have no collider — drawn but not solid`);
  } else {
    pass(`'${id}': all ${nowWalls.length} new wall claims have a matching collider in the built world`);
  }
  if (wallCount() !== wallsBefore) {
    fail(`'${id}' moved and the world went from ${wallsBefore} walls to ${wallCount()} — old walls left behind`);
  } else {
    pass(`'${id}': the world still has ${wallsBefore} walls — the old four were taken back`);
  }
  const claimedNear = wallClaimsOf(id);
  if (claimedNear.length !== 4) {
    fail(`'${id}' moved and the registry holds ${claimedNear.length} wall claims where it is now drawn, not 4`);
  } else {
    pass(`'${id}': the registry describes the booth at its new spot`);
  }

  // 4a. room to stand at the new counter, now; the walk to it is asked once
  // at the end, over the world every booth has finished moving in.
  const stand = STALL_STANDS_BY_ID.get(id);
  if (!stand) {
    fail(`'${id}' moved and has no stand point at all`);
  } else if (!collision.isClearCircle(stand.x, stand.z, PLAYER_RADIUS)) {
    fail(
      `'${id}' moved and its stand point (${stand.x.toFixed(2)}, ${stand.z.toFixed(2)}) has no room ` +
        `for a ${PLAYER_RADIUS} m body`,
    );
  } else {
    pass(`'${id}': its counter at (${stand.x.toFixed(2)}, ${stand.z.toFixed(2)}) has room to stand`);
  }
  movedCount += 1;
  proved = true;
}

if (!proved) {
  fail(
    'no booth in the park would step aside for a claim laid across its own counter — the ' +
      'mechanism is unexercised, so nothing above proves it works',
  );
}

// 4b. **Every stall's counter is still walkable to**, on one lattice rebuilt
// over the world as all the moves left it — not per booth, because a lattice
// is a snapshot and the interesting question is the finished park.
{
  const reachable = reachabilityFromEntrance();
  const ids = Object.keys(STALL_PLACEMENTS);
  // Counted, not assumed: the summary line below may only claim the counters
  // it actually reached. It used to be printed unconditionally after the loop,
  // so a run with a stranded counter said both "FAIL … can no longer be walked
  // to" and "ok every one of the 8 counters is still walkable" — a green line
  // claiming cover it had not got, which is the fault CLAUDE.md gives a whole
  // section to.
  let walkable = 0;
  for (const id of ids) {
    const stand = STALL_STANDS_BY_ID.get(id);
    if (!stand) {
      fail(`'${id}' has no stand point at all`);
      continue;
    }
    if (reachable(stand.x, stand.z)) {
      walkable += 1;
      continue;
    }
    fail(
      `'${id}': its counter at (${stand.x.toFixed(2)}, ${stand.z.toFixed(2)}) can no longer be ` +
        'walked to from the park entrance after the booths moved',
    );
  }
  if (walkable === ids.length) {
    pass(
      `every one of the ${ids.length} counters is still walkable to from the entrance with ` +
        `${movedCount} booth(s) moved`,
    );
  } else {
    console.log(`      ${walkable} of ${ids.length} counters are still walkable to from the entrance`);
  }
}

// **Coverage, said out loud on every run** — CLAUDE.md: a check that stops
// covering something must say so, on stderr, where a passing run still shows
// it. `refusedAfterSearch` is the branch where a booth tried every ring, found
// nothing and put itself back; it is the one place a booth could be left with
// its mesh and its colliders apart, so a run where it never fired must not
// read as though it proved that path.
process.stderr.write(
  `  check:stall-accommodate seed ${seed}: ${movedCount} of ${movableIds.length} movable booths ` +
    `stepped aside; ${refusedAfterSearch} exhausted every ring and restored itself` +
    (refusedAfterSearch === 0
      ? ' — so the EXHAUSTED-SEARCH RESTORE PATH WAS NOT EXERCISED by this run, and nothing above ' +
        'covers it. It needs a test of its own.'
      : '.') +
    '\n',
);

// ------------------------------------------- clause 5: the two that say no

for (const id of ['facePaint', 'keychain']) {
  const mine = wallClaimsOf(id);
  if (mine.length !== 4) {
    fail(`'${id}': the registry holds ${mine.length} wall claims where it is drawn, not 4`);
    continue;
  }
  const before = drawnAt(id);
  const wallsBefore = wallCount();
  const outcome = accommodate((mine[0] as { index: number }).index, 1, [askerClaimOn((mine[0] as { claim: Claim }).claim)]);
  const after = drawnAt(id);
  if (!isRefusal(outcome)) {
    fail(`'${id}' says it does not move and then moved`);
  } else if (Math.hypot(after.x - before.x, after.z - before.z) > 1e-6 || wallCount() !== wallsBefore) {
    fail(`'${id}' refused and something about it changed anyway`);
  } else {
    pass(`'${id}' refuses and stays put: ${outcome.reason}`);
  }
}

console.log(
  failures.length === 0
    ? `\ncheck:stall-accommodate seed ${seed}: PASS`
    : `\ncheck:stall-accommodate seed ${seed}: ${failures.length} FAILURE(S)`,
);
process.exit(failures.length === 0 ? 0 : 1);
