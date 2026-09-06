/**
 * Reachability instrument for issue #549: **do the new tower colliders block
 * anywhere a child has to be able to stand?**
 *
 * A collider that stops her walking through stone is only half the job. CLAUDE.md
 * is explicit that solidity must never cost a doorway, a ride's stand spot, or a
 * seat she is invited to sit in — and that two agents got clean, decisive,
 * entirely wrong answers from instruments that were measuring the wrong thing,
 * caught only by running a control first.
 *
 * So this asks two different questions, and each has its own control:
 *
 * 1. **Does any stand spot now sit inside a tower?** Every `InteractZone` the
 *    built park publishes carries a `standX`/`standZ` — the one owner of where
 *    the character is put when she is invited to use that thing. Any of them
 *    inside `radiusBottom + PLAYER_RADIUS` of a tower axis is a spot she can no
 *    longer occupy. This is a *differential* measurement: it names exactly the
 *    points this change newly forbids, rather than re-deriving reachability
 *    from scratch.
 *
 * 2. **Can she still get in the front door?** A stand spot can be clear while
 *    the walk to it is walled off, so the doorway is also marched at for real.
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

const park = buildHeadlessPark();
const collision = park.world.collision;

const towers = CASTLE_TOWERS.filter((t) => t.name.startsWith('tower-body-'));
/** How close to a tower axis a player-sized body may stand. */
const forbidden = (x: number, z: number): { name: string; gap: number } | null => {
  for (const t of towers) {
    const limit = t.radiusBottom + PLAYER_RADIUS;
    const d = Math.hypot(x - t.x, z - t.z);
    if (d < limit) return { name: t.name, gap: limit - d };
  }
  return null;
};

let problems = 0;

// ---------------------------------------------------------------------------
// Control on question 1: the test must be capable of saying "blocked".
// A point placed deliberately on a tower's axis MUST come back forbidden; a
// point 30 m away MUST come back clear. Without this, "no stand spot blocked"
// could equally mean the predicate never fires.
// ---------------------------------------------------------------------------
const first = towers[0];
if (!first) throw new Error('no tower bodies to measure');
const controlInside = forbidden(first.x, first.z);
const controlOutside = forbidden(first.x + 30, first.z + 30);
console.log(
  `  CONTROL predicate: a point on ${first.name}'s axis reads ` +
    `${controlInside ? `FORBIDDEN (${controlInside.gap.toFixed(2)} m inside)` : 'clear <-- BROKEN'}; ` +
    `a point 30 m away reads ${controlOutside ? 'FORBIDDEN <-- BROKEN' : 'clear'}`,
);
if (!controlInside || controlOutside) {
  console.error('  the containment predicate is not measuring what it claims');
  problems += 1;
}

// ---------------------------------------------------------------------------
// 1. Every stand spot in the built park.
// ---------------------------------------------------------------------------
const zones = park.world.interactZones();
let blocked = 0;
let nearest = { id: '(none)', clearance: Infinity };
for (const zone of zones) {
  const hit = forbidden(zone.standX, zone.standZ);
  if (hit) {
    blocked += 1;
    console.error(
      `  BLOCKED: "${zone.id}" stands at (${zone.standX.toFixed(2)}, ${zone.standZ.toFixed(2)}), ` +
        `${hit.gap.toFixed(2)} m inside ${hit.name}'s new collider — she is invited somewhere ` +
        'she can no longer stand',
    );
  }
  // How close the nearest surviving spot comes, so a future change that moves a
  // tower or a stall can see the margin shrinking before it goes negative.
  for (const t of towers) {
    const clearance =
      Math.hypot(zone.standX - t.x, zone.standZ - t.z) - (t.radiusBottom + PLAYER_RADIUS);
    if (clearance >= 0 && clearance < nearest.clearance) {
      nearest = { id: zone.id, clearance };
    }
  }
}
if (blocked > 0) problems += 1;
console.log(
  `  ${zones.length} interact zones checked, ${blocked} blocked; closest surviving stand spot is ` +
    `"${nearest.id}" at ${nearest.clearance === Infinity ? 'n/a' : `${nearest.clearance.toFixed(2)} m`} clear`,
);

// ---------------------------------------------------------------------------
// 2. The castle's own front door, marched at for real.
//
// Control: the same march aimed at the middle of the facade's SOLID south wall
// must be stopped. If the doorway march succeeds and the solid-wall march also
// succeeds, the instrument is not measuring collision and the "door is open"
// result means nothing.
// ---------------------------------------------------------------------------
// `frontDoor` is the castle's own entrance zone — the one thing on this facade
// a child is positively invited to walk to, and the nearest such spot to the
// two southern towers.
const castleDoor = zones.find((z) => z.id === 'frontDoor');
collision.setPlayBounds({ radius: 1e6, distanceToEdge: () => 1e6 });

const marchTo = (tx: number, tz: number, fromX: number, fromZ: number): number => {
  const probe = new Vector3(fromX, 0, fromZ);
  const total = Math.hypot(tx - fromX, tz - fromZ);
  const ux = (tx - fromX) / total;
  const uz = (tz - fromZ) / total;
  const step = PLAYER_LONGEST_STEP;
  let closest = Infinity;
  for (let travelled = 0; travelled < total + 4; travelled += step) {
    collision.resolveMovement(probe, ux * step, uz * step, PLAYER_RADIUS, 0, MAX_FRAME_DELTA);
    closest = Math.min(closest, Math.hypot(probe.x - tx, probe.z - tz));
  }
  return closest;
};

if (!castleDoor) {
  // Not "assert nothing and pass": the castle has a front door, so failing to
  // find it means this clause has silently stopped covering the thing it
  // exists for.
  console.error(
    '  the `frontDoor` interact zone is missing from the built park, so the doorway clause ' +
      'asserted nothing — find what it is called now rather than deleting this',
  );
  problems += 1;
} else {
  const { standX, standZ } = castleDoor;
  // Approach from 20 m further out along the door's own outward normal.
  const centreX = towers.reduce((a, t) => a + t.x, 0) / towers.length;
  const centreZ = towers.reduce((a, t) => a + t.z, 0) / towers.length;
  const outX = standX - centreX;
  const outZ = standZ - centreZ;
  const outLen = Math.hypot(outX, outZ) || 1;
  const doorReach = marchTo(standX, standZ, standX + (outX / outLen) * 20, standZ + (outZ / outLen) * 20);

  // The control: the same march, at the same depth, 7 m along the facade —
  // solid wall rather than the opening.
  //
  // **This has to be at the door's own depth**, which the first cut got wrong
  // and the control itself caught. Offsetting along the outward normal as well
  // put the target 0.55 m clear of the wall plane, so the probe stopped
  // correctly at the stone and the assertion read that 0.38 m gap as a
  // penetration. The instrument was right and the control's geometry was
  // wrong — exactly the failure this control exists to expose, pointed at
  // itself.
  const sideX = standX + (-outZ / outLen) * 7;
  const sideZ = standZ;
  const wallReach = marchTo(sideX, sideZ, sideX + (outX / outLen) * 20, sideZ + (outZ / outLen) * 20);

  console.log(
    `  CONTROL doorway: marching at solid facade 7 m to the side stops ${wallReach.toFixed(2)} m ` +
      `short${wallReach < 0.5 ? ' <-- BROKEN, it walked into the wall' : ''}`,
  );
  console.log(
    `  the castle door ("${castleDoor.id}"): a player-sized body reached ${doorReach.toFixed(2)} m ` +
      `of its stand spot`,
  );
  if (wallReach < 0.5) problems += 1;
  if (doorReach > PLAYER_RADIUS) {
    console.error(
      `  BLOCKED: the castle's own doorway is not reachable — the march stopped ` +
        `${doorReach.toFixed(2)} m short of where she is invited to stand`,
    );
    problems += 1;
  }
}

console.log(problems === 0 ? '\nNothing a child must reach is blocked.' : `\n${problems} problem(s).`);
process.exit(problems === 0 ? 0 : 1);
