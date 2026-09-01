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
 * that no stall stands in the toilets.
 *
 * ## And then the floors split (#377/#380), which is the fourth reshaping
 *
 * The market ran as **two** aisles because the great hall's hearth and the
 * stairwell's pick radius were on the same deck as it and had to be worked
 * around. Both are somewhere else now — the hall is its own space and the
 * stairwell does not exist — so it is one aisle of four stalls facing three,
 * and the shaft clause is deleted because there are no shafts.
 *
 * The clause that replaces it is the one that matters most now: **every stall
 * is on the same floor.** They were on decks 0, 1, 2 and 3, which is why no
 * floor ever showed more than two of them and the grid read as a kiosk rather
 * than a market. That was invisible to every assertion here, because
 * height-blind collision made the deck irrelevant to spacing — so the check
 * happily proved a well-spaced market that a child could never see.
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
const BEAM = 0.8;

/**
 * The **serving spot** is where the child actually stands: `SHOP_STAND_Z`,
 * which is `2.4 * SHOP_SCALE_XZ` = 1.92 m, so it is 0.52 m clear of the stall
 * and in the aisle. That distinction is the one this check exists to hold: a
 * stall whose stand spot fell inside its own body would ask a child to walk
 * into the counter to be served.
 */
const SHOP_STAND_Z = 2.4 * 0.8;
/** `MARKET_QUEUE_DEPTH` — how far a served child sticks out into the lane. */
const QUEUE_DEPTH = SHOP_STAND_Z - STALL / 2 + PLAYER_RADIUS;
/** `MARKET_SIDE_LANE` — stalls down one side: one served, two walking past. */
const SIDE_LANE = QUEUE_DEPTH + WALK_AISLE;
/** `MARKET_AISLE_WIDTH` — two served facing each other, two walking between. */
const AISLE = Math.max(2 * QUEUE_DEPTH + WALK_AISLE, SHOP_PICK + SHOP_PICK + TAP_FINGER - STALL);
const ROW_SEP = STALL + AISLE;
/** `MARKET_PITCH_X` — the same, so the grid is square. */
const PITCH_X = STALL + AISLE;

/** `MALL_DECK` — every stall is on it. */
const MALL_DECK = 0;

/** `MARKET_WALL_STANDOFF`, and the back wall it puts a rank against. */
const WALL_STANDOFF = BEAM + STALL / 2 + 0.3;
const BACK_Z = -(INTERIOR_HALF_Z - WALL_STANDOFF);
const NORTH_Z = BACK_Z + STALL + SIDE_LANE;
const SOUTH_Z = NORTH_Z + ROW_SEP;
const AISLE_Z = NORTH_Z + ROW_SEP / 2;

/**
 * `MARKET_ROWS` — three ranks, each with its own z, facing and columns
 * (in pitches either side of the market's mid-line). `face` is +1 for a rank
 * that looks along +Z.
 */
const rows = [
  { z: BACK_Z, face: 1, cols: [-1.5, 1.5] },
  { z: NORTH_Z, face: 1, cols: [-1, 0, 1] },
  { z: SOUTH_Z, face: -1, cols: [-0.5, 0.5] },
];

/** Mirroring `marketCell`. */
const cell = (row, col) => [rows[row].cols[col] * PITCH_X, rows[row].z];

/** The seating plan, mirroring `MARKET_PLAN`. */
const plan = [
  { id: 'toy', deck: MALL_DECK, seat: [1, 0] },
  { id: 'balloon', deck: MALL_DECK, seat: [2, 0] },
  { id: 'candyFloss', deck: MALL_DECK, seat: [2, 1] },
  { id: 'iceCream', deck: MALL_DECK, seat: [1, 1] },
  { id: 'hat', deck: MALL_DECK, seat: [1, 2] },
  { id: 'stickerPet', deck: MALL_DECK, seat: [0, 0] },
  { id: 'surpriseEgg', deck: MALL_DECK, seat: [0, 1] },
];

const units = plan.map((u) => {
  const [row, col] = u.seat;
  const [x, z] = cell(row, col);
  return { ...u, row, col, x, z, face: rows[row].face };
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
    `  ${u.id.padEnd(12)} floor ${u.deck}  r${u.row}c${u.col}  ` +
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

// 2. **Every rank has a lane in front of it, and at least one pair of ranks
//    faces across a shared one.**
//
//    The market is three ranks now, not two (#446), so "the gap between row 0
//    and row 1" stopped being the question. Two things are asked instead, and
//    both are the arrangement rather than the arithmetic:
//
//    - Each rank's lane is measured to whatever is actually in front of it —
//      the next rank's near face, or the plate wall if there is none — and has
//      to hold everyone who has to be in it: this rank's served child, two more
//      walking past, and the facing rank's served child if there is one. That
//      is `MARKET_SIDE_LANE` for a one-sided lane and `MARKET_AISLE_WIDTH` for
//      a shared one, both from `PLAYER_RADIUS` and `SHOP_STAND_Z`.
//    - At least one pair of ranks must face each other. #403 is Jim's own
//      ruling and "spread them out" is exactly the change that could delete it
//      by accident, leaving seven stalls scattered round a room.
{
  const ranks = rows
    .map((row, index) => ({ ...row, index, members: units.filter((u) => u.row === index) }))
    .filter((r) => r.members.length);

  let facingPairs = 0;
  for (const rank of ranks) {
    // What this rank looks at: the nearest rank in front of it, or the wall.
    const ahead = ranks
      .filter((o) => o !== rank && (o.z - rank.z) * rank.face > 0)
      .sort((a, b) => Math.abs(a.z - rank.z) - Math.abs(b.z - rank.z))[0];
    const facesBack = ahead ? ahead.face === -rank.face : false;
    if (facesBack && rank.face > 0) facingPairs += 1;

    const wallZ = rank.face > 0 ? INTERIOR_HALF_Z - BEAM : -(INTERIOR_HALF_Z - BEAM);
    const front = rank.z + rank.face * (STALL / 2);
    const blocker = ahead ? ahead.z - rank.face * (STALL / 2) : wallZ;
    const gap = (blocker - front) * rank.face;
    // A millimetre of tolerance, and only that: the layout derives these gaps
    // from the same terms this recomputes, so the difference is float
    // association, never design margin.
    const wanted = QUEUE_DEPTH + WALK_AISLE + (facesBack ? QUEUE_DEPTH : 0) - 0.001;
    const what = ahead ? `the ${facesBack ? 'aisle' : 'lane'} in front of` : 'the lane between';
    const against = ahead ? `rank ${ahead.index}` : 'the wall';
    if (gap < wanted) {
      fail(
        `${what} rank ${rank.index} and ${against} is ${gap.toFixed(2)} m — it has to hold a child ` +
          `being served (${QUEUE_DEPTH.toFixed(2)} m)${facesBack ? ' on each side' : ''} plus two ` +
          `walking past (${WALK_AISLE.toFixed(2)} m), so ${wanted.toFixed(2)} m`,
      );
    } else {
      console.log(
        `\n  rank ${rank.index} (${rank.members.length} stalls, faces ${rank.face > 0 ? '+Z' : '-Z'}): ` +
          `${gap.toFixed(2)} m to ${against}, needs ${wanted.toFixed(2)} m`,
      );
    }
  }

  if (facingPairs === 0) {
    fail('no two ranks face each other across a lane — that is a scatter of kiosks, not an aisle');
  }
}

// 2b. **Every stall is on the same floor.** The clause that would have caught
//     the market nobody could see: seven stalls spread over four decks are
//     perfectly spaced and never appear together in a frame.
{
  const floors = [...new Set(units.map((u) => u.deck))];
  if (floors.length !== 1) {
    fail(
      `the market is spread over ${floors.length} floors (${floors.join(', ')}) — no floor shows ` +
        `more than a couple of stalls, which is a kiosk, not a market`,
    );
  } else {
    console.log(`  all ${units.length} stalls on floor ${floors[0]}: one room, one market`);
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

// 6. No stall stands in the toilets.
//
//    The four shafts — stairwell, escalator, trampoline, helter — were listed
//    here too. All four are gone with #377: there is nothing left on the mall
//    for a stall to stand inside except the loo.
const fixtures = {
  toilets: {
    minX: INTERIOR_HALF_X - 6 - 7.4,
    maxX: INTERIOR_HALF_X - 6,
    minZ: INTERIOR_HALF_Z - 0.5 - 7.1,
    maxZ: INTERIOR_HALF_Z - 0.5,
  },
};
for (const u of units) {
  for (const [name, s] of Object.entries(fixtures)) {
    if (overlaps(stallRect(u), s)) fail(`${u.id} stands in the ${name}`);
  }
}

// 7. **No stall stands on the roundel, or on its ring of planters.**
//
//    New with #446, and it is the constraint the spread actually ran into: the
//    market grew southwards until the only thing left in its way was the floor
//    medallion by the front door, which is a disc rather than a rectangle and
//    so could not be expressed as a fixture above. The planters are props, and
//    a castle prop gets no collider (indoor collision is height-blind), so
//    placement is the only thing keeping a stall from growing through one.
{
  /**
   * `dressing.ts`: `ROUNDEL_X/Z/RADIUS`. The planter ring is measured, not
   * assumed: its pots sit at `ROUNDEL_RADIUS - 0.9` = 5.1 m carrying a 0.55 m
   * bush, reaching 5.65 m — **inside** the disc, so the disc is the whole
   * obstacle and there is no second radius to keep in step.
   */
  const ROUNDEL = { x: -6 * PLATE_SHRINK, z: INTERIOR_HALF_Z - 0.8 - 6, radius: 6 };
  const reach = ROUNDEL.radius;
  for (const u of units) {
    const r = stallRect(u);
    const dx = Math.max(r.minX - ROUNDEL.x, 0, ROUNDEL.x - r.maxX);
    const dz = Math.max(r.minZ - ROUNDEL.z, 0, ROUNDEL.z - r.maxZ);
    const clear = Math.hypot(dx, dz) - reach;
    if (clear < 0) {
      fail(
        `${u.id} ${fmt(r)} overlaps the roundel (centre ${ROUNDEL.x.toFixed(2)}, ` +
          `${ROUNDEL.z.toFixed(2)}, reach ${reach.toFixed(2)} m) by ${(-clear).toFixed(2)} m`,
      );
    }
  }
}

console.log(
  failures === 0
    ? `\nPASS: ${units.length} stalls on one floor, every rank with a lane in front of it, ` +
        `at least one facing pair, every serving spot in a lane.`
    : `\n${failures} FAILURE(S)`,
);
process.exit(failures === 0 ? 0 : 1);
