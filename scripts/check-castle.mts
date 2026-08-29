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
import './headless-canvas.mjs';
import { Box3, Group, InstancedMesh, Matrix4, Vector3, type Object3D } from 'three';
import {
  BUILDING_FLOOR_COUNT,
  BUILDING_WALL_THICKNESS,
  CAMERA_PITCH_DEGREES,
  INTERIOR_HALF_X,
  INTERIOR_HALF_Z,
  PLAYER_RADIUS,
} from '../src/core/constants.ts';
import { deckIsSolid, TOP_DECK } from '../src/world/building/layout.ts';
import {
  BEAM_UNDERSIDE,
  BEAM_WIDTH,
  buildCeilingBeams,
  CASTLE_CEILING_CLEAR,
  SCONCE_HEADROOM,
  SCONCE_MOUNT_Y,
} from '../src/world/building/castleFabric.ts';
import { TALLEST_CHILD_HEIGHT } from '../src/art/models/kid.ts';
import {
  CASTLE_TORCH_CUP,
  CastleFire,
  castleTorchAnchors,
} from '../src/world/building/castleLighting.ts';
import { dressCastle } from '../src/world/building/castleDecor.ts';
import { keepOutsFor } from '../src/world/building/dressing.ts';

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
// 6. Every piece of decoration, measured where it was actually placed.
// ---------------------------------------------------------------------------

/**
 * **These are the three assertions this file spent a fortnight announcing it
 * did not have** (issue #376). The note that used to stand here said, on every
 * run, that nothing in `check:castle` measured a prop — which mattered, because
 * `HANDOFF-castle-interior-363.md` §5 tells the 3D Artist that castle props get
 * no colliders and that *placement is the only protection there is.* A contract
 * promising a guard that does not exist is worse than one that admits it.
 *
 * They measure the decoration built by `castleLighting.ts` and `castleDecor.ts`
 * — flames, brackets, soot, braziers, banners, paintings, the rug, the
 * portcullis, the crates, the woodpile, the cat and the mouse — **instance by
 * instance, off each one's own world-space box.** An `InstancedMesh` is
 * expanded through its `instanceMatrix`, because that is where a bug would
 * hide: a mesh whose geometry is fine and whose fortieth matrix is not.
 *
 * The authored batch-1 and batch-2 assets are not wired into the game yet (PR
 * #368 ships bytes and no placement code — see `HANDOFF-castle-interior-376.md`
 * §0). When they are, they land inside these same three assertions for free,
 * because nothing below knows or asks what a prop *is*.
 */

interface Placed {
  readonly label: string;
  readonly box: Box3;
}

/**
 * Every placed thing on a storey, as a world-space box each.
 *
 * Walks the built group rather than asking the builders what they placed, which
 * is this file's governing rule. Anything with no drawable geometry contributes
 * nothing, and an unnamed mesh is labelled by its parent so a failure message
 * still says where to look.
 */
function placedOn(deck: number): Placed[] {
  const floor = new Group();
  new CastleFire().dress(deck, floor);
  dressCastle(deck, floor);
  floor.updateMatrixWorld(true);

  const found: Placed[] = [];
  const geometryBox = new Box3();
  const instanceMatrix = new Matrix4();

  floor.traverse((object: Object3D) => {
    const mesh = object as InstancedMesh & { isMesh?: boolean; isInstancedMesh?: boolean };
    if (mesh.isMesh !== true && mesh.isInstancedMesh !== true) return;
    if (!mesh.geometry) return;
    mesh.geometry.computeBoundingBox();
    const local = mesh.geometry.boundingBox;
    if (!local) return;

    const label = mesh.name || `${mesh.parent?.name ?? 'unnamed'} child`;

    if (mesh.isInstancedMesh === true) {
      for (let i = 0; i < mesh.count; i += 1) {
        mesh.getMatrixAt(i, instanceMatrix);
        // The instance matrix is in the mesh's own space; the mesh may sit
        // inside a positioned group (the mouse hole, the hearthside), so the
        // world matrix has to be applied on top of it or every one of those
        // measures at the origin.
        instanceMatrix.premultiply(mesh.matrixWorld);
        found.push({
          label: `${label}[${i}]`,
          box: geometryBox.copy(local).applyMatrix4(instanceMatrix).clone(),
        });
      }
      return;
    }

    found.push({
      label,
      box: geometryBox.copy(local).applyMatrix4(mesh.matrixWorld).clone(),
    });
  });

  return found;
}

/** How far a box's nearest point is from a point on the floor plan. */
function planDistance(box: Box3, x: number, z: number): number {
  const dx = Math.max(box.min.x - x, 0, x - box.max.x);
  const dz = Math.max(box.min.z - z, 0, z - box.max.z);
  return Math.hypot(dx, dz);
}

/**
 * Flat floor treatment — a rug, a runner — cannot obstruct anybody, and is
 * exempted from the walkable-route assertion **by measuring how tall it is**
 * rather than by knowing what it is called. A name-based exemption is a hole
 * somebody widens later; a 6 cm threshold is a fact about the object.
 */
const FLOOR_TREATMENT_MAX_HEIGHT = 0.1;

/**
 * How far wall furniture may stand off its wall — **the published rule, reused
 * rather than a new threshold invented here.**
 *
 * `HANDOFF-castle-interior-363.md` §5 rule 1: *"Tapestries, sconces, banners
 * and shields project at most 0.45 m from the wall face — less than the wall's
 * own thickness, so nothing narrows a route."* That is exactly the exemption
 * assertion 1 needs, and it already has a reason attached to it, so it is the
 * one used. A coat of arms 6 cm proud of a wall above a doorway is not an
 * obstruction in that doorway, and the measurement that says so is how far it
 * sticks out — not what it is called.
 */
const WALL_FURNITURE_REACH = 0.45;

/**
 * The inner faces of the four walls, which is what a prop stands off.
 *
 * `INTERIOR_HALF_X` is the wall's **centreline**, not its room-side surface:
 * `Shell.ts` extrudes each wall run from `halfX - HALF_WALL` to
 * `halfX + HALF_WALL`. So a tapestry hanging on the wall touches
 * `WALL_FACE_X`, 0.225 m in from `INTERIOR_HALF_X`, and that is the plane its
 * projection has to be measured from. `castleLighting.ts` derives its torch
 * anchors from the identical expression, which is why the torches sit on the
 * masonry rather than 22 cm inside it.
 */
const WALL_FACE_X = INTERIOR_HALF_X - BUILDING_WALL_THICKNESS / 2;
const WALL_FACE_Z = INTERIOR_HALF_Z - BUILDING_WALL_THICKNESS / 2;

/** How far a box's furthest edge reaches from the nearest wall face. */
function reachFromWall(box: Box3): number {
  return Math.min(
    box.max.z + WALL_FACE_Z,
    WALL_FACE_Z - box.min.z,
    box.max.x + WALL_FACE_X,
    WALL_FACE_X - box.min.x,
  );
}

/**
 * The band in which the wall-plate, not the slab, is the ceiling.
 *
 * This **was** a hand-copied `0.4`, with a comment explaining that
 * `BEAM_WIDTH` was private to `castleFabric.ts` and arguing the duplicate was
 * the lesser evil. It was not: `BEAM_WIDTH` was one `export` keyword away from
 * being importable, and it is now exported and imported here. The plate is
 * flush with its wall, so the band it owns is exactly its width — asking its
 * owner means a check that keeps checking the day somebody widens the beam,
 * rather than silently measuring a band that no longer exists.
 */
const PLATE_BAND = BEAM_WIDTH;

/**
 * The plate's room-side edge — the plane the ceiling assertion asks a prop
 * about.
 *
 * **This is deliberately not `WALL_FACE_X`, and the difference is not a
 * slip.** The two assertions in this section ask two different questions about
 * two different planes:
 *
 * - assertion 1 asks *how far does this thing stick out into the room*, which
 *   is measured from the masonry's room-side surface, `WALL_FACE_X`;
 * - assertion 2 asks *is this thing under the timber*, and the timber is not
 *   on the masonry's surface. `castleFabric.ts` puts the plate's centre at
 *   `INTERIOR_HALF_X - PLATE_INSET`, i.e. `BEAM_WIDTH / 2` in from the wall
 *   **centreline**, so the band it roofs runs from `INTERIOR_HALF_X` inward by
 *   `BEAM_WIDTH` — a shade further into the room than the wall face is, and
 *   the plate's own back half is buried in the masonry.
 *
 * So this is derived from `INTERIOR_HALF_X` on purpose, matching where the
 * plate is actually built. A reviewer read the two as an inconsistency, which
 * is fair: they were half a wall thickness apart with nothing saying why. Now
 * each plane is named for the thing it is the surface of, and this note is the
 * why.
 */
const PLATE_ROOM_EDGE_X = INTERIOR_HALF_X - PLATE_BAND;
const PLATE_ROOM_EDGE_Z = INTERIOR_HALF_Z - PLATE_BAND;

let propsChecked = 0;
let exemptFlat = 0;
let exemptOverhead = 0;
let exemptWall = 0;

for (let deck = 0; deck < BUILDING_FLOOR_COUNT; deck += 1) {
  const blocked = keepOutsFor(deck);
  const placed = placedOn(deck);

  for (const { label, box } of placed) {
    propsChecked += 1;
    const size = new Vector3();
    box.getSize(size);

    // --- 1. nothing stands in a route a child walks, or on a shop stand ----
    //
    // Two measured exemptions, both of which are statements about the object
    // rather than about its name. Something entirely above a hatted child
    // cannot be walked into (the portcullis's teeth hang in exactly that band
    // on purpose), and something flatter than an ankle is paint on the floor.
    //
    // `reachFromWall` is a `Math.min` of four **signed** terms, so a box lying
    // entirely beyond one wall face gets a *negative* reach and would sail
    // through the wall-furniture exemption below on a comparison that reads as
    // if it were checking the opposite. No instance does that today (this
    // guard has never fired), and that is exactly when to close it: a silent
    // exemption waiting for a future placement to fall into is the shape of
    // bug this file exists to prevent. Clamping to zero would hide it; failing
    // says which prop, and a prop that far into the masonry is worth knowing
    // about on its own account.
    const reach = reachFromWall(box);
    if (box.min.y > TALLEST_CHILD_HEIGHT) {
      exemptOverhead += 1;
    } else if (size.y <= FLOOR_TREATMENT_MAX_HEIGHT) {
      exemptFlat += 1;
    } else if (reach < 0) {
      fail(
        `props: deck ${deck} '${label}' has a reach from the wall of ${reach.toFixed(3)} m — it ` +
          `lies entirely past a wall face, inside or beyond the masonry. A negative reach is ` +
          `not wall furniture; it would be silently exempted from the keep-out check below ` +
          `because that test is '<= ${WALL_FURNITURE_REACH}'. Place it in the room.`,
      );
    } else if (reach <= WALL_FURNITURE_REACH) {
      exemptWall += 1;
    } else {
      for (const keepOut of blocked) {
        const gap = planDistance(box, keepOut.x, keepOut.z);
        if (gap >= keepOut.radius + PLAYER_RADIUS) continue;
        fail(
          `props: deck ${deck} '${label}' comes within ${gap.toFixed(2)} m of the keep-out at ` +
            `(${keepOut.x.toFixed(1)}, ${keepOut.z.toFixed(1)}) r${keepOut.radius.toFixed(1)}, ` +
            `which needs ${(keepOut.radius + PLAYER_RADIUS).toFixed(2)} m. Castle props get no ` +
            `colliders — a child NPC walks straight through this rather than round it.`,
        );
        break;
      }
    }

    // --- 2. and nothing pierces the ceiling -------------------------------
    //
    // Two ceilings, and the tighter one is easy to miss: the timber wall-plate
    // hangs to BEAM_UNDERSIDE within 0.40 m of a wall, so a prop pushed back
    // against the wall has 22 cm less room than one out in the room.
    const nearWall =
      Math.max(Math.abs(box.min.x), Math.abs(box.max.x)) > PLATE_ROOM_EDGE_X ||
      Math.max(Math.abs(box.min.z), Math.abs(box.max.z)) > PLATE_ROOM_EDGE_Z;
    const ceiling = nearWall ? BEAM_UNDERSIDE : CASTLE_CEILING_CLEAR;
    if (box.max.y > ceiling + 1e-6) {
      fail(
        `props: deck ${deck} '${label}' reaches ${box.max.y.toFixed(3)} m, above the ` +
          `${ceiling.toFixed(2)} m ceiling ${nearWall ? `within ${PLATE_BAND.toFixed(2)} m of a wall` : 'in the room'}.`,
      );
    }
  }
}


// ---------------------------------------------------------------------------
// 7. A torch's fire, its bracket and its soot mark are all on the same torch.
// ---------------------------------------------------------------------------

/**
 * **The reported-versus-measured assertion, pointed at the thing most likely to
 * drift.** Four separate meshes are placed from one anchor list — the bracket,
 * the flame, the flame's core and the soot mark above it — and they are in four
 * different draw calls with four different geometries. Nothing but this says
 * they agree.
 *
 * It also measures the flame against the two limits that decide whether a torch
 * is *visible at all*: `SCONCE_HEADROOM`, the budget published to the 3D
 * Artist, and the wall-plate's real sightline at the game's camera pitch — the
 * fault the Artist caught by looking, before forty torches were placed under a
 * timber that would have hidden every one.
 */
for (let deck = 0; deck < TOP_DECK; deck += 1) {
  const anchors = castleTorchAnchors(deck);
  const floor = new Group();
  new CastleFire().dress(deck, floor);
  floor.updateMatrixWorld(true);

  const brackets = floor.getObjectByName(`castle-torch-bracket-${deck}`) as InstancedMesh | undefined;
  const soot = floor.getObjectByName(`castle-soot-${deck}`) as InstancedMesh | undefined;

  if (anchors.length === 0) {
    fail(`torches: deck ${deck} is an enclosed storey with nowhere at all to put a torch.`);
    continue;
  }
  if (!brackets || !soot) {
    fail(`torches: deck ${deck} has ${anchors.length} anchors but no brackets and/or no soot.`);
    continue;
  }
  if (brackets.count !== anchors.length || soot.count !== anchors.length) {
    fail(
      `torches: deck ${deck} has ${anchors.length} anchors, ${brackets.count} brackets and ` +
        `${soot.count} soot marks. They are placed from one list and must be one each.`,
    );
    continue;
  }

  const bracketMatrix = new Matrix4();
  const sootMatrix = new Matrix4();
  const bracketAt = new Vector3();
  const sootAt = new Vector3();
  for (let i = 0; i < anchors.length; i += 1) {
    brackets.getMatrixAt(i, bracketMatrix);
    soot.getMatrixAt(i, sootMatrix);
    bracketAt.setFromMatrixPosition(bracketMatrix);
    sootAt.setFromMatrixPosition(sootMatrix);

    // Same place on the plan, and the stain above the fire rather than below.
    const drift = Math.hypot(bracketAt.x - sootAt.x, bracketAt.z - sootAt.z);
    if (drift > 0.1) {
      fail(
        `torches: deck ${deck} torch ${i} has its soot mark ${drift.toFixed(2)} m away from its ` +
          `bracket on the plan. They are placed from the same anchor and must not drift.`,
      );
    }
    if (sootAt.y <= bracketAt.y + CASTLE_TORCH_CUP.up) {
      fail(
        `torches: deck ${deck} torch ${i} has its soot mark at ${sootAt.y.toFixed(2)} m, at or ` +
          `below its own flame at ${(bracketAt.y + CASTLE_TORCH_CUP.up).toFixed(2)} m. Soot ` +
          `rises.`,
      );
    }
  }

  // --- and the fire fits in the budget the timber leaves it ---------------
  const flames = floor.getObjectByName(`castle-flame-${deck}`) as InstancedMesh | undefined;
  if (!flames) {
    fail(`torches: deck ${deck} built brackets but no flames to put in them.`);
    continue;
  }
  flames.geometry.computeBoundingBox();
  const flameBox = flames.geometry.boundingBox;
  if (!flameBox) {
    fail(`torches: deck ${deck} flame geometry has no bounding box to measure.`);
    continue;
  }
  const flameMatrix = new Matrix4();
  const flameWorld = new Box3();
  const sootBox = new Box3();
  soot.geometry.computeBoundingBox();
  const sootLocal = soot.geometry.boundingBox;
  let highestWallFlame = -Infinity;
  let highestSoot = -Infinity;
  for (let i = 0; i < anchors.length; i += 1) {
    flames.getMatrixAt(i, flameMatrix);
    flameWorld.copy(flameBox).applyMatrix4(flameMatrix);
    highestWallFlame = Math.max(highestWallFlame, flameWorld.max.y);
    if (!sootLocal) continue;
    soot.getMatrixAt(i, sootMatrix);
    sootBox.copy(sootLocal).applyMatrix4(sootMatrix);
    highestSoot = Math.max(highestSoot, sootBox.max.y);
  }

  const sconceTop = SCONCE_MOUNT_Y + SCONCE_HEADROOM;
  if (highestWallFlame > sconceTop) {
    fail(
      `torches: deck ${deck}'s tallest wall flame reaches ${highestWallFlame.toFixed(3)} m, past ` +
        `the ${sconceTop.toFixed(2)} m budget SCONCE_HEADROOM publishes to the 3D Artist. Either ` +
        `the flame is too tall or the published budget is wrong — do not leave them disagreeing.`,
    );
  }
  if (highestSoot > BEAM_UNDERSIDE) {
    fail(
      `torches: deck ${deck}'s soot reaches ${highestSoot.toFixed(3)} m, past the timber at ` +
        `${BEAM_UNDERSIDE.toFixed(2)} m — its top would be sliced off by a beam, which reads as ` +
        `a broken texture rather than as a stain.`,
    );
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
    `storeys, all fixed to real slab across their whole measured footprint, all clear of a ` +
    `${TALLEST_CHILD} m child under a ${CASTLE_CEILING_CLEAR.toFixed(2)} m ceiling, and ` +
    `BEAM_UNDERSIDE agrees with the mesh at ${BEAM_UNDERSIDE.toFixed(3)} m.`,
);
console.log(
  `check:castle props OK — ${propsChecked} placed instances measured across ` +
    `${BUILDING_FLOOR_COUNT} storeys, none in a walkable route or on a shop stand and none ` +
    `through a ceiling. Route-exempt: ${exemptOverhead} entirely above a ${TALLEST_CHILD} m ` +
    `child, ${exemptFlat} floor treatment under ${FLOOR_TREATMENT_MAX_HEIGHT} m tall, ` +
    `${exemptWall} wall furniture within ${WALL_FURNITURE_REACH} m of its wall. All three ` +
    `exemptions are measured off the object, never taken from its name.`,
);
