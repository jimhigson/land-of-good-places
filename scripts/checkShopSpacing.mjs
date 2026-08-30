#!/usr/bin/env node
/**
 * Numeric proof for architecture-review S1, re-shaped for the market (#403).
 *
 * Mirrors the real formulas in `src/world/building/layout.ts` rather than
 * importing them, so this stays a plain Node script with no build step. If the
 * source constants drift from the numbers copied in here, that is exactly what
 * this is for catching — re-copy them and re-run.
 *
 * ## Why this had to be rewritten twice
 *
 * It began as **intervals along a wall**, which could only ever compare two
 * units that shared a wall. Halving the plate (#403) moved a unit to a
 * different wall and the check could not express the question, so it was
 * rewritten to compare real interior-local **rectangles** — and immediately
 * caught two shops meeting in a corner, which the interval form had been
 * structurally unable to see.
 *
 * Then the shops became a **market of free-standing stalls**, and rectangles
 * on their own stopped being enough again: a stall has no wall to be "along",
 * and its aisle is the whole point. So this now asserts the things a market
 * has and a parade of shopfronts does not — that the aisle is walkable, that
 * every serving spot is *in* its aisle rather than behind its own stall, and
 * that no stall stands in a shaft or the toilets.
 *
 * **The lesson worth keeping: seven cells were clear by footprint and six were
 * clear once the queue keep-out was measured.** A check that cannot express
 * the arrangement it is checking passes vacuously, which is the failure this
 * project keeps paying for. If the layout changes shape again, change this
 * check's shape with it rather than leaving it green and blind.
 *
 * Run with: node scripts/checkShopSpacing.mjs
 */

const PLATE_SHRINK = Math.SQRT1_2;
const INTERIOR_HALF_X = 30 * PLATE_SHRINK; // 21.213
const INTERIOR_HALF_Z = 22 * PLATE_SHRINK; // 15.556
const PLAYER_RADIUS = 0.62;
/** `TAP_FINGER_METRES` — two UI units through the QA phone's camera. */
const TAP_FINGER = 1.13;
/** A shop tap target's pick radius (`interactZones.ts`). */
const SHOP_PICK = 2.3;

const STALL = 2.8;
const WALK_AISLE = 2 * PLAYER_RADIUS + 1.2;
const PITCH_X = STALL + WALK_AISLE;
const ROW_SEP = Math.max(PITCH_X, SHOP_PICK + SHOP_PICK + TAP_FINGER);
const AISLE = ROW_SEP - STALL;
const BEAM = 0.8;

const ESCALATOR_MAX_Z = 0.2 * PLATE_SHRINK + 3.1;
const NORTH_Z = -INTERIOR_HALF_Z + 1.8 + STALL / 2;
const SOUTH_Z = ESCALATOR_MAX_Z + 1.6 + STALL / 2;

const cell = (aisle, row, col) => [
  -INTERIOR_HALF_X + BEAM + STALL / 2 + col * PITCH_X,
  (aisle === 'north' ? NORTH_Z : SOUTH_Z) + row * ROW_SEP,
];

/** The seating plan, mirroring `MARKET_PLAN`. */
const plan = [
  { id: 'toy', deck: 0, seat: ['north', 0, 0] },
  { id: 'balloon', deck: 0, seat: ['north', 1, 0] },
  { id: 'candyFloss', deck: 1, seat: ['north', 1, 1] },
  { id: 'iceCream', deck: 1, seat: ['north', 1, 2] },
  { id: 'hat', deck: 2, seat: ['north', 1, 3] },
  { id: 'stickerPet', deck: 2, seat: ['south', 0, 0] },
  { id: 'surpriseEgg', deck: 3, seat: ['south', 1, 0] },
];

const units = plan.map((u) => {
  const [aisle, row, col] = u.seat;
  const [x, z] = cell(aisle, row, col);
  // Row 0 faces +Z into its aisle; row 1 faces -Z.
  const face = row === 0 ? 1 : -1;
  return { ...u, aisle, row, col, x, z, face };
});

const stallRect = (u) => ({
  minX: u.x - STALL / 2,
  maxX: u.x + STALL / 2,
  minZ: u.z - STALL / 2,
  maxZ: u.z + STALL / 2,
});
/**
 * The **tap target** sits on the counter itself, 1.15 m in front of the
 * stall's centre (`interactZones.ts`) — inside the stall's own 1.4 m half, and
 * rightly so: you tap the counter.
 */
const tapPoint = (u) => ({ x: u.x, z: u.z + u.face * 1.15 });
/**
 * The **serving spot** is where the child actually stands: `SHOP_STAND_Z`,
 * which is `2.4 * SHOP_SCALE_XZ` = 1.92 m, so it is 0.52 m clear of the stall
 * and in the aisle. That distinction is the one this check exists to hold: a
 * stall whose stand spot fell inside its own body would ask a child to walk
 * into the counter to be served.
 */
const SHOP_STAND_Z = 2.4 * 0.8;
const standPoint = (u) => ({ x: u.x, z: u.z + u.face * SHOP_STAND_Z });

const overlaps = (a, b) => a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
const fmt = (r) =>
  `x[${r.minX.toFixed(2)}, ${r.maxX.toFixed(2)}] z[${r.minZ.toFixed(2)}, ${r.maxZ.toFixed(2)}]`;

console.log(`Plate ${(INTERIOR_HALF_X * 2).toFixed(2)} x ${(INTERIOR_HALF_Z * 2).toFixed(2)} m`);
console.log(
  `Market: stall ${STALL} m, along-row pitch ${PITCH_X.toFixed(2)} m, ` +
    `row separation ${ROW_SEP.toFixed(2)} m, aisle ${AISLE.toFixed(2)} m\n`,
);
for (const u of units) {
  console.log(
    `  ${u.id.padEnd(12)} deck ${u.deck}  ${u.aisle} aisle r${u.row}c${u.col}  ` +
      `${fmt(stallRect(u))}  faces ${u.face > 0 ? '+Z' : '-Z'}`,
  );
}

let failures = 0;
const fail = (m) => {
  console.error(`FAIL: ${m}`);
  failures += 1;
};

// 1. No two stalls occupy the same floor. Height-blind collision, so this is
//    every pair regardless of storey.
for (let i = 0; i < units.length; i += 1) {
  for (let j = i + 1; j < units.length; j += 1) {
    if (overlaps(stallRect(units[i]), stallRect(units[j]))) {
      fail(`${units[i].id} and ${units[j].id} occupy the same floor`);
    }
  }
}

// 2. The aisle is walkable: two children abreast between facing rows.
for (const aisle of ['north', 'south']) {
  const r0 = units.filter((u) => u.aisle === aisle && u.row === 0);
  const r1 = units.filter((u) => u.aisle === aisle && u.row === 1);
  if (!r0.length || !r1.length) {
    fail(`the ${aisle} aisle has stalls on only one side — that is a parade, not an aisle`);
    continue;
  }
  const gap = Math.min(...r1.map((u) => u.z - STALL / 2)) - Math.max(...r0.map((u) => u.z + STALL / 2));
  if (gap < 2 * PLAYER_RADIUS) {
    fail(`the ${aisle} aisle is ${gap.toFixed(2)} m — a child is ${(2 * PLAYER_RADIUS).toFixed(2)} m across`);
  } else {
    console.log(`\n  ${aisle} aisle walkable: ${gap.toFixed(2)} m clear`);
  }
}

// 3. Every serving spot is IN its aisle, not behind its own stall — the thing
//    that makes a stall face the child rather than the wall.
for (const u of units) {
  const t = standPoint(u);
  const dot = { minX: t.x - 0.01, maxX: t.x + 0.01, minZ: t.z - 0.01, maxZ: t.z + 0.01 };
  for (const other of units) {
    if (overlaps(dot, stallRect(other))) {
      fail(
        other === u
          ? `${u.id}'s serving spot is inside its own stall`
          : `${u.id}'s serving spot is inside ${other.id}`,
      );
    }
  }
  const intoAisle = (t.z - u.z) * u.face;
  if (intoAisle <= STALL / 2) fail(`${u.id}'s serving spot is not in its aisle`);
}

// 4. No two tap targets crowd each other — including across an aisle, which is
//    the pairing a grid creates and a wall never did.
for (let i = 0; i < units.length; i += 1) {
  for (let j = i + 1; j < units.length; j += 1) {
    const a = tapPoint(units[i]);
    const b = tapPoint(units[j]);
    const gap = Math.hypot(a.x - b.x, a.z - b.z) - SHOP_PICK;
    if (gap < TAP_FINGER) {
      fail(
        `${units[i].id} and ${units[j].id} tap targets sit ${gap.toFixed(2)} m apart beyond the pick ` +
          `radius — a tap aimed at one does the other (rule: ${TAP_FINGER} m)`,
      );
    }
  }
}

// 5. Nothing leaves the plate or stands under a perimeter ceiling beam.
for (const u of units) {
  const r = stallRect(u);
  if (
    r.minX < -INTERIOR_HALF_X + BEAM ||
    r.maxX > INTERIOR_HALF_X - BEAM ||
    r.minZ < -INTERIOR_HALF_Z + BEAM ||
    r.maxZ > INTERIOR_HALF_Z - BEAM
  ) {
    fail(`${u.id} ${fmt(r)} leaves the plate or stands under a perimeter beam`);
  }
}

// 6. No stall stands in a shaft or in the toilets.
const shafts = {
  stairwell: { minX: -23.05 * PLATE_SHRINK - 2.45, maxX: -23.05 * PLATE_SHRINK + 2.45, minZ: 0.2 * PLATE_SHRINK - 2.9, maxZ: 0.2 * PLATE_SHRINK + 2.5 },
  escalator: { minX: -12.05 * PLATE_SHRINK - 1.55, maxX: -12.05 * PLATE_SHRINK + 1.55, minZ: 0.2 * PLATE_SHRINK - 3.1, maxZ: ESCALATOR_MAX_Z },
  trampoline: { minX: 8 * PLATE_SHRINK - 2.5, maxX: 8 * PLATE_SHRINK + 2.5, minZ: 0.4 * PLATE_SHRINK - 2.5, maxZ: 0.4 * PLATE_SHRINK + 2.5 },
  helter: { minX: 20 * PLATE_SHRINK - 3.5, maxX: 20 * PLATE_SHRINK + 3.5, minZ: -6.4 * PLATE_SHRINK - 3.1, maxZ: -6.4 * PLATE_SHRINK + 3.9 },
  toilets: { minX: INTERIOR_HALF_X - 6 - 7.4, maxX: INTERIOR_HALF_X - 6, minZ: INTERIOR_HALF_Z - 0.5 - 7.1, maxZ: INTERIOR_HALF_Z - 0.5 },
};
for (const u of units) {
  for (const [name, s] of Object.entries(shafts)) {
    if (overlaps(stallRect(u), s)) fail(`${u.id} stands in the ${name}`);
  }
}

console.log(
  failures === 0
    ? `\nPASS: ${units.length} stalls, two walkable aisles, every serving spot in its aisle.`
    : `\n${failures} FAILURE(S)`,
);
process.exit(failures === 0 ? 0 : 1);
