#!/usr/bin/env node
/**
 * Numeric proof for architecture-review S1: no shop counter (a height-blind
 * collision wall) overlaps any other shop's sunken forecourt in plan.
 *
 * Mirrors the real formulas in `src/world/building/layout.ts` and
 * `src/world/building/ShopUnits.ts` (counter half-width `1.75 * SCALE`,
 * forecourt half-width `FORECOURT_HALF_X * SCALE`) rather than importing
 * them, so this stays a plain Node script with no build step. If the source
 * constants ever drift from the numbers copied in here, that is exactly what
 * this script is for catching — re-copy them and re-run.
 *
 * **This duplication is a known cost, and #403 paid it.** Halving the plate's
 * area had to be typed twice, here and in `constants.ts`. Kept anyway: an
 * independent restatement is the only thing that can catch the source being
 * wrong, which is the whole point of the check. Noted in `layout.ts`'s
 * `onPlate` doc as one of the resize's findings.
 *
 * ## What changed for #403
 *
 * Two things, and both make the check see *more* than it did:
 *
 * - the units are now compared as real **rectangles in interior-local
 *   metres**, not as intervals along whichever wall they happen to be on. The
 *   interval form could only compare two units on the same wall, and asserted
 *   without proof that "north and west walls occupy disjoint regions of the
 *   plate". On a plate half the size that assumption is worth testing rather
 *   than asserting, and the west wall now carries three units instead of two.
 * - the toilet-room clearance is a real 2D overlap test against every unit,
 *   rather than one hand-picked comparison of `stickerPet`'s right edge
 *   against `TOILET_ROOM.minX`. The room moved corners (#403), so the
 *   hand-picked pair stopped being the binding one; a general test cannot go
 *   stale that way.
 *
 * Run with: node scripts/checkShopSpacing.mjs
 */

const PLATE_SHRINK = Math.SQRT1_2; // half the AREA — see constants.ts, #403
const INTERIOR_HALF_X = 30 * PLATE_SHRINK; // 21.213
const INTERIOR_HALF_Z = 22 * PLATE_SHRINK; // 15.556
const NORTH_WALL_Z = -INTERIOR_HALF_Z + 0.5;
const WEST_WALL_X = -INTERIOR_HALF_X + 0.5;
const EAST_WALL_X = INTERIOR_HALF_X - 0.5;

const SHOP_SCALE_XZ = 1.6;
const COUNTER_HALF_X = 1.75 * SHOP_SCALE_XZ; // 2.8
const FORECOURT_HALF_X = 2.9 * SHOP_SCALE_XZ; // 4.64
/** Forecourt depth into the room, unit-local, scaled. */
const FORECOURT_NEAR_Z = 0.25 * SHOP_SCALE_XZ; // 0.4
const FORECOURT_FAR_Z = 3.2 * SHOP_SCALE_XZ; // 5.12
/** How far a counter reaches into the room from its wall. */
const COUNTER_DEPTH = 1.2;

// Toilet room, deck 1 only. Moved to the south-east for #403; the north strip
// cannot carry four shops and a 7.4 m room on a 42.43 m wall.
const TOILET_ROOM = {
  minX: INTERIOR_HALF_X - 6 - 7.4,
  maxX: INTERIOR_HALF_X - 6,
  minZ: INTERIOR_HALF_Z - 0.5 - 7.1,
  maxZ: INTERIOR_HALF_Z - 0.5,
};

const units = [
  { id: 'toy', deck: 0, x: EAST_WALL_X, z: -1.5, wall: 'east' },
  { id: 'balloon', deck: 0, x: WEST_WALL_X, z: -6.5, wall: 'west' },
  { id: 'candyFloss', deck: 1, x: 5.06, z: NORTH_WALL_Z, wall: 'north' },
  { id: 'iceCream', deck: 1, x: WEST_WALL_X, z: 9.9, wall: 'west' },
  { id: 'hat', deck: 2, x: -15.5, z: NORTH_WALL_Z, wall: 'north' },
  { id: 'stickerPet', deck: 2, x: 15.34, z: NORTH_WALL_Z, wall: 'north' },
  { id: 'surpriseEgg', deck: 3, x: -5.22, z: NORTH_WALL_Z, wall: 'north' },
];

function hasForecourt(unit) {
  return unit.deck > 0;
}

/**
 * A unit's counter and forecourt as **interior-local rectangles**.
 *
 * A north-wall unit faces +Z, so its along-wall axis is X and it reaches into
 * the room in +Z. A west-wall unit faces +X, so its along-wall axis is Z and
 * it reaches into the room in +X. Mirrors `shopLocalToBuilding` for the two
 * yaws the layout actually uses.
 */
function rects(unit) {
  const along = (half) =>
    unit.wall === 'north'
      ? { minX: unit.x - half, maxX: unit.x + half }
      : { minZ: unit.z - half, maxZ: unit.z + half };
  const sign = unit.wall === 'east' ? -1 : 1;
  const into = (near, far) =>
    unit.wall === 'north'
      ? { minZ: unit.z + near, maxZ: unit.z + far }
      : sign > 0
        ? { minX: unit.x + near, maxX: unit.x + far }
        : { minX: unit.x - far, maxX: unit.x - near };

  const counter = { ...along(COUNTER_HALF_X), ...into(0, COUNTER_DEPTH) };
  const forecourt = hasForecourt(unit)
    ? { ...along(FORECOURT_HALF_X), ...into(FORECOURT_NEAR_Z, FORECOURT_FAR_Z) }
    : null;
  return { counter, forecourt };
}

function overlaps(a, b) {
  return a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
}

const fmt = (r) =>
  r
    ? `x[${r.minX.toFixed(2)}, ${r.maxX.toFixed(2)}] z[${r.minZ.toFixed(2)}, ${r.maxZ.toFixed(2)}]`
    : '(none, deck 0)';

console.log(`Plate: ${(INTERIOR_HALF_X * 2).toFixed(2)} x ${(INTERIOR_HALF_Z * 2).toFixed(2)} m`);
console.log('Computed rectangles, interior-local metres:\n');
for (const unit of units) {
  const { counter, forecourt } = rects(unit);
  console.log(
    `  ${unit.id.padEnd(12)} deck ${unit.deck}  ${unit.wall.padEnd(5)}  ` +
      `counter ${fmt(counter)}  forecourt ${fmt(forecourt)}`,
  );
}

let failures = 0;
const fail = (message) => {
  console.error(`FAIL: ${message}`);
  failures += 1;
};

// 1. No counter overlaps another shop's forecourt. Every pair, both walls —
//    the old form could only compare units that shared a wall.
for (const a of units) {
  for (const b of units) {
    if (a === b) continue;
    const ia = rects(a);
    const ib = rects(b);
    if (ib.forecourt && overlaps(ia.counter, ib.forecourt)) {
      fail(`${a.id}'s counter ${fmt(ia.counter)} overlaps ${b.id}'s forecourt ${fmt(ib.forecourt)}`);
    }
    if (ia.forecourt && ib.forecourt && overlaps(ia.forecourt, ib.forecourt) && a.id < b.id) {
      fail(`${a.id} and ${b.id} share forecourt floor`);
    }
  }
}

// 2. Nothing a shop builds may leave the plate.
const plate = {
  minX: -INTERIOR_HALF_X,
  maxX: INTERIOR_HALF_X,
  minZ: -INTERIOR_HALF_Z,
  maxZ: INTERIOR_HALF_Z,
};
const inside = (r) =>
  r.minX >= plate.minX && r.maxX <= plate.maxX && r.minZ >= plate.minZ && r.maxZ <= plate.maxZ;
for (const unit of units) {
  const { counter, forecourt } = rects(unit);
  if (!inside(counter)) fail(`${unit.id}'s counter ${fmt(counter)} leaves the plate`);
  if (forecourt && !inside(forecourt)) {
    fail(`${unit.id}'s forecourt ${fmt(forecourt)} leaves the plate`);
  }
}

// 3. Nothing a shop builds may reach the toilet room, on any deck — collision
//    and floor-plan overlap do not care which storey a thing is on.
for (const unit of units) {
  const { counter, forecourt } = rects(unit);
  if (overlaps(counter, TOILET_ROOM)) fail(`${unit.id}'s counter reaches the toilet room`);
  if (forecourt && overlaps(forecourt, TOILET_ROOM)) {
    fail(`${unit.id}'s forecourt reaches the toilet room`);
  }
}

// 4. A forecourt is a hole in the slab, so it must not open into a shaft that
//    already is one — that is architecture review S5's fault class, and the
//    west wall only started carrying three units because of #403.
const ONP = PLATE_SHRINK;
const shafts = {
  stairwell: { minX: -23.05 * ONP - 2.45, maxX: -23.05 * ONP + 2.45, minZ: 0.2 * ONP - 2.9, maxZ: 0.2 * ONP + 2.5 },
  escalator: { minX: -12.05 * ONP - 1.55, maxX: -12.05 * ONP + 1.55, minZ: 0.2 * ONP - 3.1, maxZ: 0.2 * ONP + 3.1 },
  trampoline: { minX: 8 * ONP - 2.5, maxX: 8 * ONP + 2.5, minZ: 0.4 * ONP - 2.5, maxZ: 0.4 * ONP + 2.5 },
  helter: { minX: 20 * ONP - 3.5, maxX: 20 * ONP + 3.5, minZ: -6.4 * ONP - 3.1, maxZ: -6.4 * ONP + 3.9 },
};
for (const unit of units) {
  const { forecourt } = rects(unit);
  if (!forecourt) continue;
  for (const [name, shaft] of Object.entries(shafts)) {
    if (overlaps(forecourt, shaft)) fail(`${unit.id}'s forecourt opens into the ${name} shaft`);
  }
}

// 5. A forecourt must not open under a perimeter ceiling beam: the beam below
//    it is fixed to a slab that is not there. `check:castle`'s assertion 2
//    measures this on the built scene; this catches it before the build runs.
const BEAM_HALF = 0.4;
const beamLines = [
  { minX: -INTERIOR_HALF_X, maxX: INTERIOR_HALF_X, minZ: -INTERIOR_HALF_Z, maxZ: -INTERIOR_HALF_Z + BEAM_HALF * 2 },
  { minX: -INTERIOR_HALF_X, maxX: INTERIOR_HALF_X, minZ: INTERIOR_HALF_Z - BEAM_HALF * 2, maxZ: INTERIOR_HALF_Z },
  { minX: -INTERIOR_HALF_X, maxX: -INTERIOR_HALF_X + BEAM_HALF * 2, minZ: -INTERIOR_HALF_Z, maxZ: INTERIOR_HALF_Z },
  { minX: INTERIOR_HALF_X - BEAM_HALF * 2, maxX: INTERIOR_HALF_X, minZ: -INTERIOR_HALF_Z, maxZ: INTERIOR_HALF_Z },
];
for (const unit of units) {
  const { forecourt } = rects(unit);
  if (!forecourt) continue;
  for (const beam of beamLines) {
    if (overlaps(forecourt, beam)) fail(`${unit.id}'s forecourt opens under a perimeter ceiling beam`);
  }
}

if (failures === 0) {
  const gaps = [];
  for (const wall of ['north', 'west', 'east']) {
    const onWall = units
      .filter((u) => u.wall === wall)
      .sort((a, b) => (wall === 'north' ? a.x - b.x : a.z - b.z));
    for (let i = 0; i + 1 < onWall.length; i += 1) {
      const a = onWall[i];
      const b = onWall[i + 1];
      const av = wall === 'north' ? a.x : a.z;
      const bv = wall === 'north' ? b.x : b.z;
      const need =
        (hasForecourt(a) ? FORECOURT_HALF_X : COUNTER_HALF_X) +
        (hasForecourt(b) ? FORECOURT_HALF_X : COUNTER_HALF_X);
      gaps.push(`${a.id}->${b.id} ${(bv - av).toFixed(2)}m (needs ${need.toFixed(2)})`);
    }
  }
  console.log('\nAlong-wall centre spacing: ' + gaps.join(', '));
  console.log('\nPASS: no counter overlaps any other shop\'s forecourt or the toilets.');
} else {
  console.log(`\n${failures} FAILURE(S)`);
}
process.exit(failures === 0 ? 0 : 1);
