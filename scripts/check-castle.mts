/**
 * **`check:castle`** — the castle interior's decoration is placed sanely
 * (issue #363).
 *
 * ## Why this is a check script and not a procgen invariant
 *
 * `test/procgen/invariants.ts` owns the *generated* park, and proves things
 * across the canonical seed and four sweep seeds. The castle interior is not
 * generated: it is the same room on every seed, built from fixed layout
 * constants. Running these assertions five times over five identical rooms
 * would cost four extra runs and buy nothing. So it lives here, beside
 * `check:park`, and runs once.
 *
 * ## What it asserts, and the rule every assertion obeys
 *
 * **Measure the room that was built, never the rules that built it.** Every
 * number below is read off a real `THREE.Object3D` — an instanced beam's own
 * matrix, a prop's own bounds — and compared against a threshold taken from
 * the game (`CASTLE_CEILING_CLEAR`, `deckIsSolid`), never against the
 * generator's own intention. An assertion that re-derives the thing it is
 * checking is the "check that cannot fail" this project has been bitten by.
 *
 * Run: `npm run check:castle`
 */
import { Box3, InstancedMesh, Matrix4 } from 'three';
import {
  BUILDING_FLOOR_COUNT,
  CAMERA_PITCH_DEGREES,
  INTERIOR_HALF_X,
  INTERIOR_HALF_Z,
} from '../src/core/constants.ts';
import { deckIsSolid, TOP_DECK } from '../src/world/building/layout.ts';
import {
  BEAM_UNDERSIDE,
  buildCeilingBeams,
  CASTLE_CEILING_CLEAR,
  SCONCE_HEADROOM,
  SCONCE_MOUNT_Y,
} from '../src/world/building/castleFabric.ts';
import { TALLEST_CHILD_HEIGHT } from '../src/art/models/kid.ts';

const failures: string[] = [];

function fail(message: string): void {
  failures.push(message);
}

// ---------------------------------------------------------------------------
// 1. The headroom figure is derived, and it is the figure props are sized to.
// ---------------------------------------------------------------------------

/**
 * Not a re-derivation of `CASTLE_CEILING_CLEAR` — a **bound** on it. The point
 * is that the tallest child in the game must fit under it, so if somebody ever
 * thickens the slab or lowers the storey, this says so rather than letting
 * props be sized to a ceiling nobody can stand under.
 *
 * `TALLEST_CHILD_HEIGHT` is imported from `art/models/kid.ts`, its owner —
 * every hair style crossed with every hat, measured on the real models. The
 * first draft of this script typed `2.97` instead, which is the exact
 * two-definitions bug it exists to catch, in the checker.
 */
const TALLEST_CHILD = TALLEST_CHILD_HEIGHT;
if (CASTLE_CEILING_CLEAR <= TALLEST_CHILD) {
  fail(
    `headroom: the castle's clear ceiling is ${CASTLE_CEILING_CLEAR.toFixed(2)} m, which is ` +
      `not above the tallest child (${TALLEST_CHILD} m in hair and a hat). Every prop in ` +
      `castleAssets is sized against this number.`,
  );
}

// ---------------------------------------------------------------------------
// 2. No ceiling beam hangs over a hole in the deck above it.
// ---------------------------------------------------------------------------

/**
 * A beam is fixed to the underside of the slab above it. Where that slab is
 * punched through — the stairs, the escalator, the lift, the trampoline, the
 * bubble, the helter-skelter — a beam would hang from nothing, and would be
 * visible from the storey above as a plank across an open shaft.
 *
 * `buildCeilingBeams` already asks `deckIsSolid` before placing a segment.
 * This reads the **placed matrices back out** and asks the same question of
 * the answer, which is the only version of the assertion that can catch the
 * builder getting it wrong.
 */
const matrix = new Matrix4();
const localBounds = new Box3();
const worldBounds = new Box3();
let beamsChecked = 0;
/**
 * The lowest and **highest** underside across every built timber.
 *
 * Both, not just the lowest, because a single `Math.min` has a blind spot a
 * reviewer found: one segment of 380 hung *too high* would leave the minimum
 * untouched and pass green. The dangerous direction is caught per-instance by
 * the headroom clause, so this was cosmetic — but a range costs one extra
 * variable and closes it, and `BEAM_UNDERSIDE` is supposed to describe **every**
 * timber, not the worst one.
 */
let lowestBuilt = Infinity;
let highestBuilt = -Infinity;

/**
 * How many points across a segment's own footprint are tested for solid slab.
 *
 * The centre alone is not enough and that was a real hole in this file: the
 * builder rejects a segment unless its centre **and both ends** are over slab,
 * so a checker that only sampled the centre passed 28 segments the builder
 * would never have placed. A reviewer proved it by deleting the builder's hole
 * test outright — 408 segments instead of 380, and this script said OK.
 *
 * So the footprint is sampled from the **measured** world-space box of each
 * placed instance rather than from any knowledge of how long a segment is. A
 * change to `BEAM_SEGMENT` moves the sampling with it.
 */
const FOOTPRINT_SAMPLES = 5;

for (let deck = 0; deck < BUILDING_FLOOR_COUNT; deck += 1) {
  const beams: InstancedMesh | null = buildCeilingBeams(deck);

  if (deck >= TOP_DECK) {
    if (beams) fail(`beams: deck ${deck} is the open roof terrace and must have no ceiling.`);
    continue;
  }
  if (!beams) {
    fail(`beams: deck ${deck} is an enclosed storey and got no ceiling beams at all.`);
    continue;
  }
  if (beams.count === 0) {
    fail(`beams: deck ${deck} built a beam mesh with nothing in it.`);
    continue;
  }

  // **The geometry's own box, not the constants it was built from.** This is
  // the difference between measuring and re-deriving, and the whole reason the
  // previous version of this file could not fail: it computed a half-depth as
  // `(CASTLE_CEILING_CLEAR - BEAM_UNDERSIDE) / 2`, which is algebraically
  // `BEAM_DEPTH / 2` whatever geometry was actually built. Swapping two
  // `BoxGeometry` arguments made every timber 0.70 m deep, hanging 37 cm
  // through a hatted child, and the check stayed green.
  beams.geometry.computeBoundingBox();
  const geometryBox = beams.geometry.boundingBox;
  if (!geometryBox) {
    fail(`beams: deck ${deck} beam geometry has no bounding box to measure.`);
    continue;
  }

  for (let i = 0; i < beams.count; i += 1) {
    beams.getMatrixAt(i, matrix);
    // `Box3.applyMatrix4` transforms all eight corners, so this is correct for
    // the yawed runs along Z as well as the ones along X.
    localBounds.copy(geometryBox);
    worldBounds.copy(localBounds).applyMatrix4(matrix);
    beamsChecked += 1;
    lowestBuilt = Math.min(lowestBuilt, worldBounds.min.y);
    highestBuilt = Math.max(highestBuilt, worldBounds.min.y);

    // --- the segment is fixed to slab that exists, across its whole length ---
    for (let sx = 0; sx < FOOTPRINT_SAMPLES; sx += 1) {
      for (let sz = 0; sz < FOOTPRINT_SAMPLES; sz += 1) {
        const tx = FOOTPRINT_SAMPLES === 1 ? 0.5 : sx / (FOOTPRINT_SAMPLES - 1);
        const tz = FOOTPRINT_SAMPLES === 1 ? 0.5 : sz / (FOOTPRINT_SAMPLES - 1);
        const x = worldBounds.min.x + (worldBounds.max.x - worldBounds.min.x) * tx;
        const z = worldBounds.min.z + (worldBounds.max.z - worldBounds.min.z) * tz;
        if (deckIsSolid(deck + 1, x, z)) continue;
        fail(
          `beams: deck ${deck} segment ${i} covers (${x.toFixed(2)}, ${z.toFixed(2)}), ` +
            `where deck ${deck + 1} has a hole — part of it is fixed to a ceiling that is ` +
            `not there.`,
        );
        sx = FOOTPRINT_SAMPLES;
        break;
      }
    }

    // --- and it is under the ceiling and over a child's head ---------------
    if (worldBounds.max.y > CASTLE_CEILING_CLEAR + 1e-6) {
      fail(
        `beams: deck ${deck} segment ${i} reaches ${worldBounds.max.y.toFixed(3)} m, above ` +
          `the ${CASTLE_CEILING_CLEAR.toFixed(3)} m ceiling — it is inside the slab above it.`,
      );
    }
    if (worldBounds.min.y < TALLEST_CHILD) {
      fail(
        `beams: deck ${deck} segment ${i} hangs down to ${worldBounds.min.y.toFixed(3)} m, ` +
          `which the tallest child (${TALLEST_CHILD} m, art/models/kid.ts) would walk into.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 3. The published constant equals the built thing.
// ---------------------------------------------------------------------------

/**
 * `BEAM_UNDERSIDE` is the number the 3D Artist is told to size wall-standing
 * props against (`HANDOFF-castle-interior-363.md` §4.4). A constant that says
 * 3.08 while the timber actually hangs to 2.60 is the contract lying to the
 * Artist, so it is checked against the mesh rather than trusted.
 *
 * This is the "reported figure equals measured figure" assertion, applied to my
 * own constant. The same shape of check covers the Artist's `TABLE_TOP`,
 * `BENCH_SEAT` and `SCONCE_CUP_OFFSET` when batch 1 lands.
 */
for (const [label, measured] of [
  ['lowest', lowestBuilt],
  ['highest', highestBuilt],
] as const) {
  if (!Number.isFinite(measured)) continue;
  if (Math.abs(measured - BEAM_UNDERSIDE) <= 1e-6) continue;
  fail(
    `BEAM_UNDERSIDE says the timbers hang to ${BEAM_UNDERSIDE.toFixed(3)} m, but the ` +
      `${label} built underside measures ${measured.toFixed(3)} m. The Artist sizes ` +
      `wall-standing props against that constant — fix the constant or fix the geometry.`,
  );
}

// ---------------------------------------------------------------------------
// 4. The wall-plate must not hide the wall torches under it.
// ---------------------------------------------------------------------------

/**
 * **A timber standing proud of a wall casts a sightline shadow down it**, and
 * the wall torches live in exactly that band.
 *
 * At the game's fixed `CAMERA_PITCH_DEGREES`, the ray grazing the plate's
 * room-side edge meets the wall `edgeDistance × tan(pitch)` below the plate's
 * underside. Everything above that point is hidden behind the timber. The first
 * build put the plate 0.9 m off the wall and 0.70 m wide, which hid the wall
 * from **2.10 m upward** — `SCONCE_MOUNT_Y` to within 3 mm, so all forty
 * torches would have been invisible. The 3D Artist caught it by looking; this
 * is what stops it coming back.
 *
 * The edge distance is **measured off the built mesh**, not taken from
 * `PLATE_INSET` and `BEAM_WIDTH`, for the same reason as everything else in
 * this file. The camera angle is imported from `constants.ts`, its owner — if
 * the park ever tilts, this assertion tilts with it and says so.
 */
{
  const pitch = (CAMERA_PITCH_DEGREES * Math.PI) / 180;
  const sconceTop = SCONCE_MOUNT_Y + SCONCE_HEADROOM;
  const plate = buildCeilingBeams(0);
  if (!plate) {
    fail('sightline: deck 0 built no wall-plate to measure.');
  } else {
    plate.geometry.computeBoundingBox();
    const geometryBox = plate.geometry.boundingBox;
    if (!geometryBox) {
      fail('sightline: the wall-plate geometry has no bounding box to measure.');
    } else {
      // The run along the north wall (most negative Z) is representative: every
      // run is the same box, and the walls are symmetric. Its room-side edge is
      // its **greatest** Z.
      let edgeDistance = 0;
      let underside = Infinity;
      for (let i = 0; i < plate.count; i += 1) {
        plate.getMatrixAt(i, matrix);
        worldBounds.copy(geometryBox).applyMatrix4(matrix);
        // Distance from the wall face this segment is fixed to, whichever of
        // the four it is: the box's far edge measured from the wall plane.
        const fromNorth = worldBounds.max.z + INTERIOR_HALF_Z;
        const fromSouth = INTERIOR_HALF_Z - worldBounds.min.z;
        const fromWest = worldBounds.max.x + INTERIOR_HALF_X;
        const fromEast = INTERIOR_HALF_X - worldBounds.min.x;
        edgeDistance = Math.max(
          edgeDistance,
          Math.min(fromNorth, fromSouth, fromWest, fromEast),
        );
        underside = Math.min(underside, worldBounds.min.y);
      }
      const hiddenAbove = underside - edgeDistance * Math.tan(pitch);
      if (hiddenAbove < sconceTop) {
        fail(
          `sightline: the wall-plate stands ${edgeDistance.toFixed(3)} m off the wall, so at ` +
            `${CAMERA_PITCH_DEGREES}° it hides the wall above ${hiddenAbove.toFixed(3)} m. A ` +
            `sconce mounted at ${SCONCE_MOUNT_Y.toFixed(2)} m reaches ` +
            `${sconceTop.toFixed(2)} m and would be behind the timber. Narrow the plate, ` +
            `bring it flush to the wall, or lower SCONCE_MOUNT_Y.`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Nothing built for the inside may claim an exterior masonry name.
// ---------------------------------------------------------------------------

/**
 * The pattern `test/procgen/parkFacts.ts` uses to find the castle's stonework,
 * copied here **on purpose** — the one place in this file that repeats a value
 * rather than importing it.
 *
 * Importing it would be better and is not available: it is an inline literal
 * inside a function in a test-only module, and exporting it would mean editing
 * a shared invariant file to satisfy a checker. So it is duplicated, and this
 * comment is the mitigation: if `parkFacts.ts` ever widens its pattern, widen
 * this one. The failure mode of the copy drifting is a false *pass* here
 * followed by a real `test:procgen` failure, which is loud and diagnosable —
 * the opposite way round from the bug this exists to prevent.
 */
const EXTERIOR_MASONRY_PATTERN = /^(castle-wall-|crenellations$)/;

/**
 * **A `castle-wall-` name on an interior mesh silently breaks a safety
 * invariant, and `npm run build` cannot see it.**
 *
 * `parkFacts.ts` measures the top of the castle's stonework by matching that
 * pattern across the *whole scene*, and the ginormous-slide clearance invariant
 * is built on the result. The wall-plate was called `castle-wall-plate-N` for
 * one afternoon: an interior timber 4.5 m above the real parapet was read as
 * the battlements, `castleMasonryTopY` jumped 10.29 → 14.83 m, and
 * `test:procgen` failed on all five seeds — while `npm run build` stayed green,
 * because that suite is gated separately in CI and is not in the build chain.
 *
 * The pattern is deliberately permissive (the facade has four bands and gained
 * two of them after it was written), so the interior is what must stay clear of
 * it. This makes that a rule with teeth rather than a comment.
 */
for (let deck = 0; deck < BUILDING_FLOOR_COUNT; deck += 1) {
  const built = buildCeilingBeams(deck);
  if (!built) continue;
  if (!EXTERIOR_MASONRY_PATTERN.test(built.name)) continue;
  fail(
    `naming: '${built.name}' is an interior mesh whose name matches the pattern ` +
      `parkFacts.ts uses to find the castle's exterior stonework ` +
      `(${String(EXTERIOR_MASONRY_PATTERN)}). It will be measured as the battlements and ` +
      `will break the ginormous-slide clearance invariant in test:procgen, which ` +
      `npm run build does not run. Name interior parts 'castle-timber-', not 'castle-wall-'.`,
  );
}

// ---------------------------------------------------------------------------
// 6. NOT YET WRITTEN — and said out loud, because the contract depends on it.
// ---------------------------------------------------------------------------

/**
 * **Nothing in this file measures a decorative prop, because there are none
 * yet.** Batch 1 has not been wired into the game.
 *
 * This is stated here, and printed on every run, because
 * `HANDOFF-castle-interior-363.md` §5 tells the 3D Artist that props get no
 * colliders and that "placement is the only protection there is" — and a
 * contract that promises a guard which does not exist is worse than one that
 * admits it does not. §6 of that document briefly claimed these were written.
 * They were not. Both have been corrected.
 *
 * The three that land with batch 1:
 *
 * 1. **No prop intersects a walkable route or a shop stand** — measured XZ
 *    footprint against `dressing.ts`'s `keepOutsFor(deck)` inflated by
 *    `PLAYER_RADIUS`, *and* against the paths children actually walk between
 *    the door and the seven shop stands (`castleAttractions`), not only the
 *    destination discs.
 * 2. **No prop pierces the ceiling** — measured `visibleBounds(root).top` plus
 *    its floor height against `CASTLE_CEILING_CLEAR`, or against
 *    `BEAM_UNDERSIDE` for anything within 1.25 m of a wall. This is the one
 *    that settles the throne's two readings (3.10 m total, or 3.40 m).
 * 3. **Every reported figure equals its measured figure** — `TABLE_TOP`,
 *    `BENCH_SEAT`, `SCONCE_CUP_OFFSET` off the handle against `visibleBounds`.
 *    Assertion 3 above is this same shape, applied to my own `BEAM_UNDERSIDE`,
 *    and is the working proof that the pattern catches things.
 */
const PROP_ASSERTIONS_PENDING =
  'props: NOT CHECKED — batch 1 is not wired yet, so nothing here measures a prop. ' +
  'See the note above assertion 6. Placement is the only protection props get, and it ' +
  'is not yet enforced.';

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\ncheck:castle — ${failures.length} failure(s):\n`);
  for (const message of failures) console.error(`  ✗ ${message}`);
  console.error('');
  process.exit(1);
}

console.log(
  `check:castle OK — ${beamsChecked} ceiling-beam segments across ${TOP_DECK} enclosed ` +
    `storeys, all fixed to real slab across their whole measured footprint, all clear of a ` +
    `${TALLEST_CHILD} m child under a ${CASTLE_CEILING_CLEAR.toFixed(2)} m ceiling, and ` +
    `BEAM_UNDERSIDE agrees with the mesh at ${BEAM_UNDERSIDE.toFixed(3)} m.`,
);
console.log(`check:castle ${PROP_ASSERTIONS_PENDING}`);
