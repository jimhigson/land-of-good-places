/**
 * **check:castle-towers — the castle's four corner turrets are solid, and
 * solidity has not cost anyone a place to stand.** (Issue #549.)
 *
 * The facade's own collider is a 24 x 18 m rectangle. The towers stand
 * *outside* it: their axes sit half a wall thickness beyond each corner and
 * their flared feet bulge 2.21 m further out again. So there was about 2.1 m of
 * drawn stone at each of four corners with nothing behind it, and a child
 * walked into a turret and came out the other side. Measured before the fix, on
 * 48 bearings at two strides, all four towers: a player-sized body reached
 * **0.60 m** of the axis of a 2.214 m turret.
 *
 * Nothing was missing from a list. `CASTLE_TOWERS` existed and was correct,
 * `slide/plan.ts` routed around it, and a procgen invariant measured it — the
 * collision world had simply never been told the towers were there. That is
 * CLAUDE.md's opening rule and its stated cause: scenery built with no collider
 * at all. This is the check that would have caught it.
 *
 * ## Why it marches rather than reading the collider list
 *
 * The hotel is the worked example (9 Aug 2026): its collider list was long, the
 * crystals were drawn, the code read plausibly, and six 1.49 m gaps stood open
 * round the building against a 1.24 m-wide child. `check:hotel` had twenty
 * probes about the *inside* and none about walking up to it. Asserting that
 * `addCircle` was called proves a call was made; marching a player-sized body
 * at the thing and asserting where it stops is the only kind of check that can
 * see the class of bug. Two strides are used because a gap you cannot walk into
 * at 5 cm a step you may still tunnel into at `PLAYER_LONGEST_STEP`.
 *
 * ## Every clause carries a control
 *
 * CLAUDE.md records two agents getting clean, decisive, entirely wrong answers
 * from instruments that were measuring the wrong thing, caught only by a
 * control. So the solidity sweep is bracketed by a march at known-solid stone
 * and a march across known-open lawn, and the stand-spot test is bracketed by a
 * point known to be inside a tower and one known to be far away. If a control
 * misbehaves this check fails, because every other number in it would then be
 * meaningless.
 *
 * One park build serves both halves — `checks.yml` runs at 25 minutes against a
 * 30-minute cap, so a second build here would be real cost for nothing.
 */
import './headless-canvas.mjs';
import { Vector3 } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import {
  PLAYER_RADIUS,
  PLAYER_LONGEST_STEP,
  MAX_FRAME_DELTA,
} from '../src/core/constants.ts';
import { CASTLE_TOWERS } from '../src/world/building/layout.ts';
import { PARK_LAYOUT } from '../src/world/parkLayout.ts';

const problems: string[] = [];
const said: string[] = [];

const park = buildHeadlessPark();
const collision = park.world.collision;
const zones = park.world.interactZones();

const towers = CASTLE_TOWERS.filter((t) => t.name.startsWith('tower-body-'));
if (towers.length === 0) {
  console.error(
    'check:castle-towers: CASTLE_TOWERS publishes no tower bodies, so this check measured ' +
      'nothing at all. It has stopped covering the castle rather than passing.',
  );
  process.exit(1);
}
const first = towers[0] as (typeof towers)[number];

// The park's own leash would stop a march before any stone did; this check is
// about the masonry, not the boundary.
collision.setPlayBounds({ radius: 1e6, distanceToEdge: () => 1e6 });

/** Marches a player-sized body at (tx, tz) from `from` m out; closest approach. */
const marchAt = (tx: number, tz: number, bearing: number, step: number, from: number): number => {
  const probe = new Vector3(tx + Math.sin(bearing) * from, 0, tz + Math.cos(bearing) * from);
  let closest = Infinity;
  for (let travelled = 0; travelled < from + 4; travelled += step) {
    collision.resolveMovement(
      probe,
      -Math.sin(bearing) * step,
      -Math.cos(bearing) * step,
      PLAYER_RADIUS,
      0,
      MAX_FRAME_DELTA,
    );
    closest = Math.min(closest, Math.hypot(probe.x - tx, probe.z - tz));
  }
  return closest;
};

const BEARINGS = 48;
const STEPS = [0.05, PLAYER_LONGEST_STEP] as const;
const sweep = (tx: number, tz: number, from: number): number => {
  let worst = Infinity;
  for (let i = 0; i < BEARINGS; i += 1) {
    const bearing = (i / BEARINGS) * Math.PI * 2;
    for (const step of STEPS) worst = Math.min(worst, marchAt(tx, tz, bearing, step, from));
  }
  return worst;
};

const centreX = towers.reduce((a, t) => a + t.x, 0) / towers.length;
const centreZ = towers.reduce((a, t) => a + t.z, 0) / towers.length;

// ---------------------------------------------------------- controls: marching
const positive = sweep(centreX, centreZ, 24);
const negative = sweep(centreX + 150, centreZ + 150, 20);
said.push(
  `CONTROL march: known-solid castle centre stops at ${positive.toFixed(2)} m; known-open lawn ` +
    `150 m out reaches ${negative.toFixed(2)} m`,
);
if (positive < 1) {
  problems.push(
    `the control march at the castle's own solid centre reached ${positive.toFixed(2)} m — this ` +
      'check is not consulting collision, so every tower result below is meaningless',
  );
}
if (negative > 0.5) {
  problems.push(
    `the control march across open lawn stopped ${negative.toFixed(2)} m out — something is ` +
      'blocking this probe that it has not named, so a "solid" verdict would be an artefact',
  );
}

// ------------------------------------------------- 1. every turret is solid
let solidChecked = 0;
for (const tower of towers) {
  const expected = tower.radiusBottom + PLAYER_RADIUS;
  const worst = sweep(tower.x, tower.z, 14);
  solidChecked += 1;
  if (worst < tower.radiusBottom) {
    problems.push(
      `${tower.name} at (${tower.x.toFixed(2)}, ${tower.z.toFixed(2)}) is not solid: a ` +
        `player-sized body marched at it from ${BEARINGS} bearings reached ${worst.toFixed(2)} m ` +
        `of the axis, inside its own ${tower.radiusBottom.toFixed(3)} m stone. She walks into ` +
        'the turret and comes out the other side (Building.ts registerCastleTowerCollision)',
    );
  } else if (worst < expected - 0.01) {
    problems.push(
      `${tower.name} stops a child at ${worst.toFixed(2)} m from its axis but its collider ` +
        `should hold her at ${expected.toFixed(2)} m — she is ${(expected - worst).toFixed(2)} m ` +
        'inside the drawn stone',
    );
  }
}
said.push(
  `${solidChecked} turrets marched at from ${BEARINGS} bearings x ${STEPS.length} strides ` +
    `(${STEPS.map((s) => s.toFixed(2)).join(' m, ')} m)`,
);

// --------------------------- 2. solidity has cost nobody a place to stand
const forbidden = (x: number, z: number): { name: string; gap: number } | null => {
  for (const t of towers) {
    const limit = t.radiusBottom + PLAYER_RADIUS;
    const d = Math.hypot(x - t.x, z - t.z);
    if (d < limit) return { name: t.name, gap: limit - d };
  }
  return null;
};

const controlInside = forbidden(first.x, first.z);
const controlOutside = forbidden(first.x + 30, first.z + 30);
said.push(
  `CONTROL stand spots: a point on ${first.name}'s axis reads ` +
    `${controlInside ? 'forbidden' : 'CLEAR'}; one 30 m away reads ` +
    `${controlOutside ? 'FORBIDDEN' : 'clear'}`,
);
if (!controlInside || controlOutside) {
  problems.push(
    'the stand-spot containment test is not measuring what it claims — "no stand spot blocked" ' +
      'below would mean only that the predicate never fires',
  );
}

let blocked = 0;
let nearest = { id: '(none)', clearance: Infinity };
for (const zone of zones) {
  const hit = forbidden(zone.standX, zone.standZ);
  if (hit) {
    blocked += 1;
    problems.push(
      `"${zone.id}" invites a child to stand at (${zone.standX.toFixed(2)}, ` +
        `${zone.standZ.toFixed(2)}), ${hit.gap.toFixed(2)} m inside ${hit.name}'s collider — ` +
        'solidity must never cost a doorway, a stand spot or a seat (CLAUDE.md)',
    );
  }
  for (const t of towers) {
    const clearance =
      Math.hypot(zone.standX - t.x, zone.standZ - t.z) - (t.radiusBottom + PLAYER_RADIUS);
    if (clearance >= 0 && clearance < nearest.clearance) nearest = { id: zone.id, clearance };
  }
}
said.push(
  `${zones.length} interact zones checked, ${blocked} blocked; closest surviving stand spot ` +
    `"${nearest.id}" at ${nearest.clearance === Infinity ? 'n/a' : nearest.clearance.toFixed(2) + ' m'} clear`,
);

// ------------------------------- 3. the castle's own doorway is still open
const marchTo = (tx: number, tz: number, fromX: number, fromZ: number): number => {
  const probe = new Vector3(fromX, 0, fromZ);
  const total = Math.hypot(tx - fromX, tz - fromZ) || 1;
  const ux = (tx - fromX) / total;
  const uz = (tz - fromZ) / total;
  let closest = Infinity;
  for (let travelled = 0; travelled < total + 4; travelled += PLAYER_LONGEST_STEP) {
    collision.resolveMovement(
      probe,
      ux * PLAYER_LONGEST_STEP,
      uz * PLAYER_LONGEST_STEP,
      PLAYER_RADIUS,
      0,
      MAX_FRAME_DELTA,
    );
    closest = Math.min(closest, Math.hypot(probe.x - tx, probe.z - tz));
  }
  return closest;
};

const castleDoor = zones.find((z) => z.id === 'frontDoor');
if (!castleDoor) {
  // Not "assert nothing and pass": the castle has a front door, so failing to
  // find it means this clause has silently stopped covering what it exists for.
  problems.push(
    'the `frontDoor` interact zone is missing from the built park, so the doorway clause ' +
      'asserted nothing — find what it is called now rather than deleting this clause',
  );
} else {
  const { standX, standZ } = castleDoor;
  // **Straight out through the door, from the edge of the castle's own
  // ground.** The door's outward line is the zone's own: from where she stands
  // inside the threshold to the chip out on the steps.
  //
  // This march used to start 20 m out along the line from the castle's centre,
  // which put its first metres on open lawn, past the castle's `boundingRadius`
  // — ground the scatter builders own and are right to use. On seed 2 (restart
  // 0, the shipped park) it stalled at (-42.64, 48.48) on a knee-high garden
  // wall and a fairy-light pole about 25 m from the building anchor, and
  // reported the door "18.67 m short": a child walks round a wall on the lawn;
  // the door was open. Whether she can get from the park gate to this door at
  // all is `check:park`'s `route.unreachable` (the front door is one of its
  // destinations), an acceptance measure. What this clause owns is narrower —
  // that making the turrets solid did not shut the doorway — so it walks only
  // the castle's own ground: from where the building anchor's
  // `boundingRadius` (which every scatter builder keeps out of) crosses the
  // door's line, straight in.
  const building = PARK_LAYOUT.entries.get('building');
  if (!building) throw new Error("check:castle-towers: the park layout has no 'building' entry");
  const outLen = Math.hypot(castleDoor.x - standX, castleDoor.z - standZ) || 1;
  const outX = (castleDoor.x - standX) / outLen;
  const outZ = (castleDoor.z - standZ) / outLen;
  // |stand + t·out − anchor| = boundingRadius, the far root.
  const relX = standX - building.x;
  const relZ = standZ - building.z;
  const along = relX * outX + relZ * outZ;
  const disc = along * along - (relX * relX + relZ * relZ - building.boundingRadius ** 2);
  const approach = disc > 0 ? -along + Math.sqrt(disc) : NaN;
  if (!(approach > 0)) {
    throw new Error(
      `check:castle-towers: the front door's stand spot (${standX.toFixed(2)}, ${standZ.toFixed(2)}) ` +
        `is not inside the building's ${building.boundingRadius} m bounding circle — the doorway march has no start`,
    );
  }
  const doorReach = marchTo(standX, standZ, standX + outX * approach, standZ + outZ * approach);
  // The control aims at the same depth, 7 m along the facade — solid wall.
  // It must be at the door's own depth: offsetting along the outward normal
  // too puts the target clear of the wall plane, and the probe's correct stop
  // at the stone then reads as a penetration. That mistake was made and caught
  // by this very control.
  const sideX = standX - outZ * 7;
  const sideZ = standZ + outX * 7;
  const wallReach = marchTo(sideX, sideZ, sideX + outX * approach, sideZ + outZ * approach);
  said.push(
    `CONTROL doorway: solid facade 7 m along stops ${wallReach.toFixed(2)} m short; the door ` +
      `itself lets a child to ${doorReach.toFixed(2)} m of her stand spot, marched ` +
      `${approach.toFixed(2)} m in from the building's ${building.boundingRadius} m bounding circle`,
  );
  if (wallReach < 0.5) {
    problems.push(
      `the control march at solid facade reached ${wallReach.toFixed(2)} m of its target — the ` +
        'doorway result cannot be trusted',
    );
  }
  if (doorReach > PLAYER_RADIUS) {
    problems.push(
      `the castle's front door is not reachable: a player-sized body stopped ` +
        `${doorReach.toFixed(2)} m short of where she is invited to stand`,
    );
  }
}

for (const line of said) console.log(`  ${line}`);
if (problems.length > 0) {
  console.error(`\ncheck:castle-towers FAILED — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\ncheck:castle-towers OK — every corner turret is solid from every bearing, and no ' +
  'doorway or stand spot was lost to making it so.');
