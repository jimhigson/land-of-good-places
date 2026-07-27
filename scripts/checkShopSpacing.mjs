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
 * Run with: node scripts/checkShopSpacing.mjs
 */

const INTERIOR_HALF_X = 30;
const INTERIOR_HALF_Z = 22;
const NORTH_WALL_Z = -INTERIOR_HALF_Z + 0.5; // -21.5
const WEST_WALL_X = -INTERIOR_HALF_X + 0.5; // -29.5

const SHOP_SCALE_XZ = 1.6;
const COUNTER_HALF_X = 1.75 * SHOP_SCALE_XZ; // 2.8
const FORECOURT_HALF_X = 2.9 * SHOP_SCALE_XZ; // 4.64

// Toilet room, deck 1 only, but shares the north wall's z-band.
const TOILET_ROOM = { minX: 21.2, maxX: 28.6, minZ: -21.5, maxZ: -14.4 };

const units = [
  { id: 'toy', deck: 0, x: WEST_WALL_X, z: -9, wall: 'west' },
  { id: 'balloon', deck: 0, x: -3.72, z: NORTH_WALL_Z, wall: 'north' },
  { id: 'candyFloss', deck: 1, x: 4.72, z: NORTH_WALL_Z, wall: 'north' },
  { id: 'iceCream', deck: 1, x: WEST_WALL_X, z: 9, wall: 'west' },
  { id: 'hat', deck: 2, x: -22.44, z: NORTH_WALL_Z, wall: 'north' },
  { id: 'stickerPet', deck: 2, x: 15, z: NORTH_WALL_Z, wall: 'north' },
  { id: 'surpriseEgg', deck: 3, x: -12.16, z: NORTH_WALL_Z, wall: 'north' },
];

function hasForecourt(unit) {
  return unit.deck > 0;
}

/** Counter / forecourt intervals in the axis that runs along each unit's own wall. */
function intervals(unit) {
  // On the north wall the wall runs along x; on the west wall it runs along z.
  const along = unit.wall === 'north' ? unit.x : unit.z;
  return {
    counter: [along - COUNTER_HALF_X, along + COUNTER_HALF_X],
    forecourt: hasForecourt(unit) ? [along - FORECOURT_HALF_X, along + FORECOURT_HALF_X] : null,
  };
}

function overlaps(a, b) {
  return a[0] < b[1] && b[0] < a[1];
}

console.log('Computed intervals (unit-local metres along each unit\'s own wall axis):\n');
for (const unit of units) {
  const { counter, forecourt } = intervals(unit);
  const fc = forecourt ? `[${forecourt[0].toFixed(2)}, ${forecourt[1].toFixed(2)}]` : '(none, deck 0)';
  console.log(
    `  ${unit.id.padEnd(12)} deck ${unit.deck}  ${unit.wall.padEnd(5)}  counter ${'['
      + counter[0].toFixed(2) + ', ' + counter[1].toFixed(2) + ']'}  forecourt ${fc}`,
  );
}

let failures = 0;

// Only units on the same wall can possibly collide (north and west walls
// occupy disjoint regions of the plate — see layout.ts's own reasoning).
for (const wall of ['north', 'west']) {
  const onWall = units.filter((u) => u.wall === wall);
  for (const a of onWall) {
    for (const b of onWall) {
      if (a === b) continue;
      const ia = intervals(a);
      const ib = intervals(b);
      if (ib.forecourt && overlaps(ia.counter, ib.forecourt)) {
        console.error(
          `FAIL: ${a.id}'s counter [${ia.counter.map((v) => v.toFixed(2))}] overlaps `
            + `${b.id}'s forecourt [${ib.forecourt.map((v) => v.toFixed(2))}]`,
        );
        failures += 1;
      }
    }
  }
}

// East-end clearance: the north wall's east-most forecourt (stickerPet) must
// not reach the toilet room, which shares its z-band (deck 1 vs deck 2, but
// collision and floor-plan overlap don't care about deck).
const stickerPet = units.find((u) => u.id === 'stickerPet');
const stickerForecourt = intervals(stickerPet).forecourt;
if (stickerForecourt[1] >= TOILET_ROOM.minX) {
  console.error(
    `FAIL: stickerPet's forecourt right edge (${stickerForecourt[1].toFixed(2)}) `
      + `reaches TOILET_ROOM (starts at ${TOILET_ROOM.minX})`,
  );
  failures += 1;
} else {
  console.log(
    `\nstickerPet forecourt clears TOILET_ROOM by ${(TOILET_ROOM.minX - stickerForecourt[1]).toFixed(2)} m.`,
  );
}

// West-end clearance: hat's forecourt must not reach the west wall (x = -30).
const hat = units.find((u) => u.id === 'hat');
const hatForecourt = intervals(hat).forecourt;
const westWallX = -INTERIOR_HALF_X;
if (hatForecourt[0] <= westWallX) {
  console.error(`FAIL: hat's forecourt left edge (${hatForecourt[0].toFixed(2)}) reaches the west wall`);
  failures += 1;
} else {
  console.log(`hat forecourt clears the west wall by ${(hatForecourt[0] - westWallX).toFixed(2)} m.`);
}

console.log(failures === 0 ? '\nPASS: no counter overlaps any other shop\'s forecourt.' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
