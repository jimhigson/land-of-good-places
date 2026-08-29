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
import { InstancedMesh, Matrix4, Vector3 } from 'three';
import { BUILDING_FLOOR_COUNT } from '../src/core/constants.ts';
import { deckIsSolid, TOP_DECK } from '../src/world/building/layout.ts';
import {
  BEAM_UNDERSIDE,
  buildCeilingBeams,
  CASTLE_CEILING_CLEAR,
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
const position = new Vector3();
let beamsChecked = 0;

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

  for (let i = 0; i < beams.count; i += 1) {
    beams.getMatrixAt(i, matrix);
    position.setFromMatrixPosition(matrix);
    beamsChecked += 1;

    if (!deckIsSolid(deck + 1, position.x, position.z)) {
      fail(
        `beams: deck ${deck} beam segment ${i} sits at (${position.x.toFixed(2)}, ` +
          `${position.z.toFixed(2)}), where deck ${deck + 1} has a hole — it is fixed to a ` +
          `ceiling that is not there.`,
      );
    }

    // Under the ceiling, not through it, and above nothing that walks.
    // Half-depths come off `BEAM_UNDERSIDE` and the ceiling rather than being
    // typed, so a change to the beam's cross-section moves the assertion with
    // it instead of quietly loosening it.
    const halfDepth = (CASTLE_CEILING_CLEAR - BEAM_UNDERSIDE) / 2;
    const top = position.y + halfDepth;
    if (top > CASTLE_CEILING_CLEAR + 1e-6) {
      fail(
        `beams: deck ${deck} beam segment ${i} reaches ${top.toFixed(3)} m, above the ` +
          `${CASTLE_CEILING_CLEAR.toFixed(3)} m ceiling — it is inside the slab above it.`,
      );
    }
    const bottom = position.y - halfDepth;
    if (bottom < TALLEST_CHILD) {
      fail(
        `beams: deck ${deck} beam segment ${i} hangs down to ${bottom.toFixed(3)} m, which ` +
          `the tallest child (${TALLEST_CHILD} m, art/models/kid.ts) would walk into.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\ncheck:castle — ${failures.length} failure(s):\n`);
  for (const message of failures) console.error(`  ✗ ${message}`);
  console.error('');
  process.exit(1);
}

console.log(
  `check:castle OK — ${beamsChecked} ceiling-beam segments across ${TOP_DECK} enclosed ` +
    `storeys, all fixed to real slab, all clear of a ${TALLEST_CHILD} m child under a ` +
    `${CASTLE_CEILING_CLEAR.toFixed(2)} m ceiling.`,
);
