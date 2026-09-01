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
import { Box3, Group, InstancedMesh, Matrix4, Mesh, Raycaster, Vector3, type Object3D, type Texture } from 'three';
import { CASTLE_FLOORS, CASTLE_ROOF, FLOOR_SPACE_SPACING } from '../src/world/building/floors.ts';
import { createRoofClouds } from '../src/world/building/roofClouds.ts';
import {
  BUILDING_FLOOR_COUNT,
  BUILDING_FLOOR_HEIGHT,
  BUILDING_WALL_THICKNESS,
  CAMERA_PITCH_DEGREES,
  CAMERA_YAW_DEGREES,
  INTERIOR_HALF_X,
  INTERIOR_HALF_Z,
  PLAYER_RADIUS,
} from '../src/core/constants.ts';
import { castleCoursingTexture, castleFlagstoneTexture } from '../src/core/textures.ts';
import { BuildingShell } from '../src/world/building/Shell.ts';
import {
  insideInterior,
  regionContains,
  LIFT_CAR_X,
  LIFT_DOOR_Z,
  LIFT_OUT_YAW,
  LIFT_WALL_X,
  TOP_DECK,
} from '../src/world/building/layout.ts';
import { LiftAlcove } from '../src/world/lift/LiftAlcove.ts';
import {
  CASTLE_BENCH_HALF_WIDTH,
  CASTLE_BENCH_SEAT,
  CASTLE_PLINTH_TOP,
  CASTLE_SCONCE_CUP,
  CASTLE_TABLE_TOP,
} from '../src/art/models/castleAssets.ts';
import {
  CASTLE_GREAT_HALL_DECK,
  castleFurnitureGroupName,
  DINER_TABLE_GAP,
  greatHallPetPlaces,
  greatHallSeats,
  SIT_PICK_RADIUS,
} from '../src/world/building/castleFurniture.ts';
import {
  banquetGroupName,
  GreatHallBanquet,
} from '../src/world/building/greatHallBanquet.ts';
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
  CASTLE_HEARTH,
  CASTLE_HEARTH_FLAME_COUNT,
  CASTLE_HEARTH_OPENING,
  CASTLE_TORCH_CUP,
  CastleFire,
  castleHearthSurroundName,
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
 * A beam is fixed to the underside of this storey's ceiling. That ceiling used
 * to be punched through — the stairs, the escalator, the lift, the trampoline
 * and the helter-skelter — and a beam over one of those hung from nothing,
 * visible from the storey above as a plank across an open shaft.
 *
 * Since the floors became separate spaces (#377/#380) there are no shafts and
 * no deck above, so the question narrows to "is this segment over the floor
 * plate at all?" — but it is still worth asking, because the plate can be
 * resized (#403 halved its area) and a run laid from the old half-extents
 * would overhang into space.
 *
 * `buildCeilingBeams` already asks `insideInterior` before placing a segment.
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
 * Where each storey's wall-plate ended up along X, so the loop below can prove
 * the floors are **actually a floor apart**.
 *
 * This is the wrong-parenting test, moved axis. It used to compare each plate's
 * world `y` against `deck * BUILDING_FLOOR_HEIGHT + BEAM_UNDERSIDE`, which
 * worked while five storeys were stacked in one coordinate system and height
 * was what told a correctly-parented plate from one hung on the wrong floor
 * group. Since #377/#380 they step sideways and every ceiling is at the same
 * height, so that comparison can no longer fail and a plate on the wrong floor
 * would sail through it.
 */
const plateCentreX: number[] = [];

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
        if (insideInterior(x, z)) continue;
        fail(
          `beams: floor ${deck} segment ${i} covers (${x.toFixed(2)}, ${z.toFixed(2)}), ` +
            `which is off the floor plate — part of it is fixed to a ceiling that is ` +
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
/**
 * Storeys that actually yielded decoration — **counted, not assumed.**
 *
 * The summary line used to report this figure as `BUILDING_FLOOR_COUNT`, which
 * is the number of storeys the loop *visits*, not the number it found anything
 * on. That is the same shape of defect assertion 8 exists to close: a constant
 * printed where a reader will take it for a measurement, and therefore a figure
 * that stays reassuringly at 5 on the day `dressCastle` stops placing anything.
 */
let storeysDressed = 0;

for (let deck = 0; deck < BUILDING_FLOOR_COUNT; deck += 1) {
  const blocked = keepOutsFor(deck);
  const placed = placedOn(deck);
  if (placed.length > 0) storeysDressed += 1;

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
// 8. The castle a child walks into — measured on the assembled scene graph.
// ---------------------------------------------------------------------------

/**
 * **Everything above this line calls a builder itself and measures what came
 * back. None of it asks whether the running game ever puts that mesh in the
 * scene.**
 *
 * Assertions 1–5 call `buildCeilingBeams(deck)`; 6 and 7 dress a fresh `Group`
 * with `CastleFire` and `dressCastle`. All of them are measuring real
 * `Object3D`s, which is this file's governing rule and is right — but the thing
 * they measure is a *factory's return value*, and `BuildingShell` is what
 * decides whether any of it reaches the room.
 *
 * That gap was proved, not guessed (`HANDOFF-castle-visibility.md`, 29 August
 * 2026). With two mutations in `Shell.ts` — `void beams;` in place of
 * `floor.add(beams)`, and `interiorMaterial(...)` in place of
 * `isCastleFloor ? castleFloorMaterial(colour) : ...` — the game had no ceiling
 * timbers anywhere and no flagstones at all, and this script still printed
 * `check:castle OK — 416 ceiling-beam segments across 4 enclosed storeys` and
 * exited 0. It would have blessed a castle with no ceiling and no floor, which
 * is very nearly what a QA report claimed to be looking at.
 *
 * So this section builds the thing the game builds — a real
 * `BuildingShell('interior')` — and **counts what it finds in the tree**. Every
 * number it contributes to the summary is a count of a mesh that was found, so
 * a mesh that stops being added, a material that stops being applied, or a plate
 * parented to the wrong storey makes a printed number go down rather than
 * leaving it untouched.
 *
 * The one thing it deliberately does not do is re-derive the plate's position:
 * it asks whether the mesh is *where the storey it was found in puts it*, which
 * is `deck × BUILDING_FLOOR_HEIGHT` above the underside assertion 3 already
 * measured. A plate added to floor 2's group is then a failure that names the
 * storey it landed in.
 */

/** The `map` a mesh's material actually carries, or `null`. Arrays never occur here. */
function mapOf(object: Object3D): Texture | null {
  if (!(object instanceof Mesh)) return null;
  const material = object.material;
  if (Array.isArray(material)) return null;
  return (material as { map?: Texture | null }).map ?? null;
}

function findInFloor(floor: Object3D, name: string): Object3D | null {
  let found: Object3D | null = null;
  floor.traverse((child) => {
    if (found === null && child.name === name) found = child;
  });
  return found;
}

/** Storeys whose ceiling timbers **and** flagstone floor were both found in the tree. */
let storeysSeen = 0;
/** Wall-plate segments counted in the assembled shell, not in a factory's return value. */
let platedSegmentsInScene = 0;
let flagstonedDecksInScene = 0;
let coursedWallsInScene = 0;

{
  const shell = new BuildingShell('interior');
  shell.group.updateWorldMatrix(false, true);
  const flagstones = castleFlagstoneTexture();
  const coursing = castleCoursingTexture();
  const shellBounds = new Box3();

  if (shell.floorGroups.length !== BUILDING_FLOOR_COUNT) {
    fail(
      `scene: BuildingShell('interior') built ${shell.floorGroups.length} storeys, not the ` +
        `${BUILDING_FLOOR_COUNT} the game expects.`,
    );
  }

  for (let deck = 0; deck < shell.floorGroups.length; deck += 1) {
    const floor = shell.floorGroups[deck];
    if (!floor) continue;
    const enclosed = deck < TOP_DECK;

    // --- the floor a child stands on is flagstoned -------------------------
    const slab = findInFloor(floor, `deck-${deck}`);
    if (!slab) {
      fail(`scene: storey ${deck} has no 'deck-${deck}' slab anywhere in the built shell.`);
    } else if (enclosed) {
      if (mapOf(slab) === flagstones) {
        flagstonedDecksInScene += 1;
      } else {
        fail(
          `scene: the deck-${deck} slab in the built shell carries no flagstone map — ` +
            `castleFloorMaterial's texture never reached the floor a child stands on, so ` +
            `storey ${deck} renders as a flat untextured plate. Nothing above this line can ` +
            `see that, because nothing above this line looks at the scene.`,
        );
      }
    }

    // --- and the walls round it are coursed --------------------------------
    if (enclosed) {
      const walls = findInFloor(floor, `walls-${deck}`);
      if (!walls) {
        fail(`scene: storey ${deck} is enclosed but has no 'walls-${deck}' mesh in the shell.`);
      } else if (mapOf(walls) === coursing) {
        coursedWallsInScene += 1;
      } else {
        fail(
          `scene: the walls-${deck} mesh in the built shell carries no coursing map — ` +
            `castleWallMaterial's ashlar never reached storey ${deck}'s walls.`,
        );
      }
    }

    // --- and there is a ceiling over it ------------------------------------
    const plate = findInFloor(floor, `castle-timber-plate-${deck}`);
    if (!enclosed) {
      if (plate) {
        fail(
          `scene: storey ${deck} is the open roof terrace, but a wall-plate ` +
            `'castle-timber-plate-${deck}' was found under it.`,
        );
      }
      continue;
    }
    if (!plate) {
      fail(
        `scene: storey ${deck} is an enclosed storey with no ceiling — ` +
          `'castle-timber-plate-${deck}' was built but never added to the shell, so the room ` +
          `has no timbers in it however many segments buildCeilingBeams returns.`,
      );
      continue;
    }
    if (!(plate instanceof InstancedMesh) || plate.count === 0) {
      fail(`scene: storey ${deck}'s wall-plate is in the tree but carries no instances.`);
      continue;
    }

    // `setFromObject` walks the instance matrices *and* every parent transform,
    // so this is the box in world space — the storey offset included.
    shellBounds.setFromObject(plate);

    // **The wrong-parenting test moved axis with the floors.**
    //
    // It used to compare the plate's world `y` against `deck *
    // BUILDING_FLOOR_HEIGHT + BEAM_UNDERSIDE`: five storeys stacked in one
    // coordinate system, so height was what told a correctly-parented plate
    // from one hung on the wrong floor group. Since #377/#380 the floors step
    // sideways instead, and **every storey's ceiling is at the same height** —
    // so the old comparison is no longer able to fail, and a plate on the wrong
    // floor would sail through it.
    //
    // So it is now two clauses, and between them they are strictly stronger
    // than the one they replace: the height must be right *and* the plate must
    // be standing over its own floor's plate.
    if (Math.abs(shellBounds.min.y - BEAM_UNDERSIDE) > 1e-3) {
      fail(
        `scene: storey ${deck}'s wall-plate hangs to ${shellBounds.min.y.toFixed(3)} m in the ` +
          `assembled shell, but every storey puts its ceiling at ` +
          `${BEAM_UNDERSIDE.toFixed(3)} m.`,
      );
      continue;
    }
    // Which floor group it is under, recorded rather than asserted here: the
    // check builds `BuildingShell('interior')` on its own, unparented, so world
    // x is the *shell's* frame and not the game's. Asserting an absolute origin
    // would bake in whether the shell happens to be mounted, which is not what
    // this is about. The spacing **between** floors is frame-independent, so
    // that is what gets asserted, once, after the loop.
    plateCentreX[deck] = (shellBounds.min.x + shellBounds.max.x) / 2;

    platedSegmentsInScene += plate.count;
    if (slab && mapOf(slab) === flagstones) storeysSeen += 1;
  }

  if (storeysSeen === 0) {
    fail(
      'scene: not one enclosed storey in the built castle has both a ceiling and a flagstone ' +
        'floor. The summary line has nothing true to report.',
    );
  }
}

// --- and the floors really are a floor apart ------------------------------

/**
 * **The split itself, asserted on the built shell.**
 *
 * Two storeys' wall-plates `FLOOR_SPACE_SPACING` apart is the whole of
 * "disjoint spaces without overlap" as it appears in geometry. If a floor group
 * were ever built at the wrong offset — or at no offset, which is what the
 * pre-split code did — the floors would be standing inside each other and every
 * height-blind collider on one would be an invisible wall on the others. That
 * is the exact bug this work exists to make impossible, so it gets an
 * assertion rather than a comment.
 */
{
  const built = plateCentreX.filter((x) => x !== undefined);
  if (built.length < 2) {
    fail(
      `floors: only ${built.length} storey wall-plate(s) were measured, so nothing can be said ` +
        `about whether the floors are separated at all.`,
    );
  }
  for (let deck = 1; deck < plateCentreX.length; deck += 1) {
    const here = plateCentreX[deck];
    const below = plateCentreX[deck - 1];
    if (here === undefined || below === undefined) continue;
    const gap = here - below;
    if (Math.abs(gap - FLOOR_SPACE_SPACING) > 1e-3) {
      fail(
        `floors: storey ${deck}'s wall-plate is ${gap.toFixed(3)} m from storey ${deck - 1}'s ` +
          `along X, but the floors are meant to be ${FLOOR_SPACE_SPACING} m apart. Two floors ` +
          `closer than that share coordinates, and indoor collision is height-blind — a ` +
          `counter on one would be an invisible wall on the other.`,
      );
    }
  }
  process.stderr.write(
    `check:castle — floors: ${plateCentreX.filter((x) => x !== undefined).length} storeys, ` +
      `each ${FLOOR_SPACE_SPACING} m from the last. Disjoint by construction.\n`,
  );
}

// ---------------------------------------------------------------------------
// 9. Every prop stands on its own floor's plate.
// ---------------------------------------------------------------------------

/**
 * **The shaft assertion that stood here is gone, and so is the bug class it
 * guarded.**
 *
 * It asserted that no prop stood inside one of `BUILDING_SHAFTS`, on any
 * storey. The reasoning was sound and worth keeping on the record: `deckIsSolid`
 * answered a different question — *is there floor here* — and on deck 0 it
 * answered "yes" everywhere, because the ground floor had no holes. But a shaft
 * was not only a hole: it was a stair, an escalator, a trampoline or a
 * helter-skelter, and those structures came all the way down to the floor a
 * child walked in on. The great hall's feast benches cleared every keep-out in
 * `keepOutsFor(0)` and this file was green three assertions deep, and the
 * helter-skelter came down through them — found by looking at a screenshot, not
 * by a check, because `keepOutsFor` only added the helter's disc on
 * `HELTER_DECK`, which is where you get *on*, not where the tube is.
 *
 * **Since #377/#380 there are no shafts.** Every floor is its own space, one
 * unbroken slab, and nothing comes down through anything. The assertion cannot
 * fail because the situation cannot arise, and a check that cannot fail is
 * worse than no check — so it is replaced rather than kept as decoration.
 *
 * What replaces it is the live risk on a castle whose plate has just halved its
 * area (#403): a prop **left at a coordinate from the larger plate**, standing
 * off the edge of the floor in mid-air over the plaza disc. That is exactly the
 * class of thing `onPlate` exists to prevent and exactly what a future resize
 * will threaten again.
 */
let plateProps = 0;
const plateStoreys = new Set<number>();
for (let deck = 0; deck < BUILDING_FLOOR_COUNT; deck += 1) {
  const floor = CASTLE_FLOORS[deck];
  if (!floor) continue;
  for (const { label, box } of placedOn(deck)) {
    if (box.min.y > TALLEST_CHILD_HEIGHT) continue;
    plateProps += 1;
    plateStoreys.add(deck);
    // Five by five over the prop's real footprint, so a prop whose corner alone
    // hangs off the plate is caught — sampling the centre would miss it, which
    // is the same reason the shaft test sampled a grid.
    for (let i = 0; i <= 4; i += 1) {
      for (let j = 0; j <= 4; j += 1) {
        const x = box.min.x + ((box.max.x - box.min.x) * i) / 4;
        const z = box.min.z + ((box.max.z - box.min.z) * j) / 4;
        // The props are built in floor-local metres inside their floor group,
        // so the box is already floor-local: `insideInterior` is the right
        // frame. A small margin, because a wall-hung tapestry legitimately
        // sits flush with the plate's own edge.
        if (insideInterior(x, z, 0.6)) continue;
        fail(
          `plate: floor ${deck} '${label}' reaches (${x.toFixed(2)}, ${z.toFixed(2)}), ` +
            `which is off a plate that is ${(floor.halfX * 2).toFixed(2)} x ` +
            `${(floor.halfZ * 2).toFixed(2)} m — it is standing in mid-air over the plaza.`,
        );
        i = 5;
        j = 5;
      }
    }
  }
}

process.stderr.write(
  `check:castle — plate: ${plateProps} props measured across ${plateStoreys.size} floors. ` +
    `The shaft assertion this replaces is retired because there are no shafts left ` +
    `(#377): every floor is its own space and one unbroken slab.\n`,
);

// ---------------------------------------------------------------------------
// 10. Every figure the asset contract publishes, against the built furniture.
// ---------------------------------------------------------------------------

/**
 * **`HANDOFF-castle-interior-363.md` §4.4's protocol, with teeth** — the third
 * of the three prop assertions this file spent a fortnight announcing it did
 * not have.
 *
 * §4.4 lists the numbers the 3D Artist and the Engineer must agree on exactly,
 * and its rule is that neither side copies the other's figure by hand: every
 * one is either exported from the game or **measured off the built mesh and
 * asserted against the reported one**. §3 above is already this shape applied
 * to the Engineer's own `BEAM_UNDERSIDE`. This is the same shape pointed at the
 * Artist's figures.
 *
 * ## It measures the furniture where it was placed, not the file it came from
 *
 * The weak version re-reads `castle.glb` and compares it to `castleAssets.ts`,
 * which re-derives the same quantity from the same bytes by the same route and
 * can only ever agree with itself. This walks the great hall `dressCastle`
 * actually built and measures the table standing in it — so it also catches a
 * placement that is right about the geometry and wrong about what it did with
 * it.
 *
 * ## Own geometry, never descendants
 *
 * `addOutline` attaches the inverted hull as a **child** of the mesh it
 * outlines, scaled outward by the outline's thickness. So `Box3.setFromObject`
 * on the table reports 0.693 m for a 0.675 m table: the 18 mm is
 * `table-top`'s own outline, drawn behind it and invisible from in front.
 * Measuring that would fail every published figure by its outline thickness and
 * send somebody hunting for a bug in the asset.
 */

/** The world-space box of one named node's **own** geometry, outline excluded. */
function surfaceOf(root: Object3D, name: string): Box3 | null {
  const node = root.getObjectByName(name);
  if (!node) return null;
  const mesh = node as Object3D & {
    isMesh?: boolean;
    geometry?: { boundingBox: Box3 | null; computeBoundingBox(): void };
  };
  if (mesh.isMesh !== true || !mesh.geometry) return null;
  mesh.geometry.computeBoundingBox();
  const local = mesh.geometry.boundingBox;
  if (!local) return null;
  node.updateMatrixWorld(true);
  return local.clone().applyMatrix4(node.matrixWorld);
}

/** Every node of a given name in the built tree, own geometry only. */
function allSurfacesOf(root: Object3D, name: string): Box3[] {
  const found: Box3[] = [];
  root.traverse((object) => {
    if (object.name !== name) return;
    const mesh = object as Object3D & {
      isMesh?: boolean;
      geometry?: { boundingBox: Box3 | null; computeBoundingBox(): void };
    };
    if (mesh.isMesh !== true || !mesh.geometry) return;
    mesh.geometry.computeBoundingBox();
    const local = mesh.geometry.boundingBox;
    if (!local) return;
    object.updateMatrixWorld(true);
    found.push(local.clone().applyMatrix4(object.matrixWorld));
  });
  return found;
}

/**
 * How far two figures that are meant to be the *same number* may differ.
 *
 * A millimetre. This is not a fit with slack in it — a table top and the height
 * the feast is stood at are one quantity, and anything above float noise means
 * two definitions have drifted.
 */
const CONTRACT_TOLERANCE = 1e-3;

const hallFloor = new Group();
dressCastle(CASTLE_GREAT_HALL_DECK, hallFloor);
hallFloor.updateMatrixWorld(true);

const hall = hallFloor.getObjectByName(castleFurnitureGroupName(CASTLE_GREAT_HALL_DECK));
let contractChecked = 0;

if (!hall) {
  fail(
    `contract: deck ${CASTLE_GREAT_HALL_DECK} built no ` +
      `'${castleFurnitureGroupName(CASTLE_GREAT_HALL_DECK)}' group, so batch 1's furniture is in ` +
      `no scene and nothing below measured anything. This is the state PR #368 was in for a ` +
      `fortnight — bytes that regenerate perfectly and no player who can see them — and it must ` +
      `not be reachable silently.`,
  );
} else {
  for (const { node, published, name, whatStandsOnIt } of [
    {
      node: 'table-top',
      published: CASTLE_TABLE_TOP,
      name: 'CASTLE_TABLE_TOP',
      whatStandsOnIt: 'the feast',
    },
    {
      node: 'bench-plank',
      published: CASTLE_BENCH_SEAT,
      name: 'CASTLE_BENCH_SEAT',
      whatStandsOnIt: 'a sitting child',
    },
  ]) {
    const surface = surfaceOf(hall, node);
    if (!surface) {
      fail(`contract: the great hall contains no '${node}' to measure ${name} against.`);
      continue;
    }
    contractChecked += 1;
    if (Math.abs(surface.max.y - published) > CONTRACT_TOLERANCE) {
      fail(
        `contract: ${name} publishes ${published.toFixed(4)} m but the '${node}' standing in the ` +
          `great hall measures ${surface.max.y.toFixed(4)} m. ${whatStandsOnIt} is placed from ` +
          `the published figure, so these being different is that thing floating or sunk by ` +
          `${((surface.max.y - published) * -1000).toFixed(0)} mm.`,
      );
    }
  }

  // The figure agreeing with the mesh is only half of it. §4.4's reason for
  // caring is that "a table that is 3 cm short leaves fourteen goblets
  // floating" — so this measures the goblets, which is the fault itself rather
  // than the number behind it. A placement that reads the right constant and
  // then adds an offset of its own fails here and passes everything above.
  const tableTop = surfaceOf(hall, 'table-top');
  if (tableTop) {
    for (const kind of ['goblet', 'roast', 'loaf', 'pie']) {
      for (const prop of allSurfacesOf(hall, `feast-${kind}`)) {
        contractChecked += 1;
        const gap = prop.min.y - tableTop.max.y;
        if (Math.abs(gap) > CONTRACT_TOLERANCE) {
          fail(
            `contract: a '${kind}' sits ${(gap * 1000).toFixed(0)} mm ` +
              `${gap > 0 ? 'above' : 'below'} the table it is laid on — its base is at ` +
              `${prop.min.y.toFixed(4)} m and the table top measures ` +
              `${tableTop.max.y.toFixed(4)} m.`,
          );
        }
      }
    }
  }

  // The same question asked of the knight on his plinth, which is the other
  // place in this room where one authored asset stands on another.
  const plinth = surfaceOf(hall, 'plinth-block');
  if (plinth) {
    contractChecked += 1;
    if (Math.abs(plinth.max.y - CASTLE_PLINTH_TOP) > CONTRACT_TOLERANCE) {
      fail(
        `contract: CASTLE_PLINTH_TOP publishes ${CASTLE_PLINTH_TOP.toFixed(4)} m and the built ` +
          `plinth measures ${plinth.max.y.toFixed(4)} m.`,
      );
    }
    for (const armour of allSurfacesOf(hall, 'armour-plate')) {
      contractChecked += 1;
      const gap = armour.min.y - plinth.max.y;
      if (Math.abs(gap) > CONTRACT_TOLERANCE) {
        fail(
          `contract: a suit of armour stands ${(gap * 1000).toFixed(0)} mm ` +
            `${gap > 0 ? 'above' : 'below'} its own plinth.`,
        );
      }
    }
  }
}

// `castleLighting.ts` owns where a flame sits and the sconce is authored to
// land on it. This is the assertion behind that sentence. The direction of this
// contract was reversed by #376 precisely because the old arrangement — the
// Artist reports, the Engineer types "provisionally" — went stale within a day,
// and the reconciliation log had to say out loud that the typed copy must not
// be used.
for (const [axis, measured, owned] of [
  ['out from the wall', CASTLE_SCONCE_CUP.out, CASTLE_TORCH_CUP.out],
  ['up from the mount', CASTLE_SCONCE_CUP.up, CASTLE_TORCH_CUP.up],
] as const) {
  contractChecked += 1;
  if (Math.abs(measured - owned) > CONTRACT_TOLERANCE) {
    fail(
      `contract: the authored sconce's cup mouth measures ${measured.toFixed(4)} m ${axis} and ` +
        `castleLighting.ts places the flame at ${owned.toFixed(4)} m. Every torch in the castle ` +
        `would burn ${(Math.abs(measured - owned) * 100).toFixed(1)} cm off its own cup.`,
    );
  }
}

// ---------------------------------------------------------------------------
// 9. The fire is in a fireplace, and the fireplace has a fire in it.
// ---------------------------------------------------------------------------

/**
 * **This is the assertion #412 says nobody had.**
 *
 * When the great hall changed storeys, the hearth's *fire* was left behind on
 * the mall's plate: `castle-hearth-logs-0` burning at x = 600 in the middle of
 * the market while the stone it belongs to stood 300 m away in the hall. Every
 * check in this file was green, and the issue's own words are that **"a fire
 * without a fireplace breaks no assertion."**
 *
 * It does now, and in both directions — a fireplace with nothing burning in it
 * fails too, because an assertion that only says "no flame is outside the
 * opening" is perfectly satisfied by a hearth that has gone out.
 *
 * Measured off the built group, instance by instance, like everything else
 * here. Nothing below asks a builder what it meant to place.
 */
let hearthFlamesInside = 0;
let hearthSurroundsFound = 0;

/** The firebox, in the floor group's own frame — built from the fire's own constant. */
const openingBox = new Box3(
  new Vector3(
    CASTLE_HEARTH.x - CASTLE_HEARTH_OPENING.halfWidth,
    0,
    -(INTERIOR_HALF_Z - BUILDING_WALL_THICKNESS / 2),
  ),
  new Vector3(
    CASTLE_HEARTH.x + CASTLE_HEARTH_OPENING.halfWidth,
    CASTLE_HEARTH_OPENING.height,
    -(INTERIOR_HALF_Z - BUILDING_WALL_THICKNESS / 2) + CASTLE_HEARTH_OPENING.depth,
  ),
);

/**
 * How far from the hearth a flame has to be before it is somebody else's flame.
 *
 * A wall torch three metres along the same wall is not a hearth fire that has
 * escaped, and must not be reported as one. Beyond this radius a flame is
 * assumed to belong to a bracket or a brazier and is left to assertion 7.
 */
const HEARTH_CLAIM_RADIUS = CASTLE_HEARTH_OPENING.halfWidth + 1.5;

for (let deck = 0; deck < BUILDING_FLOOR_COUNT; deck += 1) {
  const floor = new Group();
  new CastleFire().dress(deck, floor);
  floor.updateMatrixWorld(true);

  const surround = floor.getObjectByName(castleHearthSurroundName(deck));
  if (surround) hearthSurroundsFound += 1;

  // The two halves must be on the same storey. This is the 300 m bug stated as
  // a question about the built scene rather than about anybody's intention.
  const logs = floor.getObjectByName(`castle-hearth-logs-${deck}`);
  if (deck === CASTLE_HEARTH.deck) {
    if (!surround) {
      fail(
        `hearth: deck ${deck} is CASTLE_HEARTH.deck and has no ` +
          `'${castleHearthSurroundName(deck)}'. There is a fire on this storey with no ` +
          `fireplace round it — the exact state #412 found and no assertion objected to.`,
      );
    }
    if (!logs) {
      fail(`hearth: deck ${deck} built a fireplace with no log pile in it.`);
    }
  } else if (surround || logs) {
    fail(
      `hearth: deck ${deck} is not CASTLE_HEARTH.deck (${CASTLE_HEARTH.deck}) and yet built ` +
        `${surround ? 'a fireplace' : ''}${surround && logs ? ' and ' : ''}${logs ? 'a log pile' : ''}. ` +
        `The stone and the fire are emitted from one block so that they cannot separate; this ` +
        `says they have.`,
    );
  }

  if (deck !== CASTLE_HEARTH.deck) continue;

  // **What burns is measured as well as the flames**, and that is not padding.
  // The log pile turned each log up to 1.1 rad off the opening's axis, so a 2 m
  // log projected a metre front-to-back: measured, the pile spanned
  // z -15.84..-13.70 against a firebox of -15.33..-14.23 — half a metre through
  // the back of the chimney and half a metre out over the hearthstone. It was
  // visible in the very first screenshot of the finished fireplace, and it had
  // been wrong for as long as the log pile had existed; there was simply no
  // fireplace for it to stick out of before.
  if (logs) {
    const pile = logs as InstancedMesh;
    pile.geometry.computeBoundingBox();
    const pileLocal = pile.geometry.boundingBox;
    if (pileLocal) {
      const pileMatrix = new Matrix4();
      const pileWorld = new Box3();
      for (let i = 0; i < pile.count; i += 1) {
        pile.getMatrixAt(i, pileMatrix);
        pileWorld.copy(pileLocal).applyMatrix4(pileMatrix.premultiply(pile.matrixWorld));
        if (openingBox.containsBox(pileWorld)) continue;
        fail(
          `hearth: the log pile spans x ${pileWorld.min.x.toFixed(2)}..` +
            `${pileWorld.max.x.toFixed(2)}, y ${pileWorld.min.y.toFixed(2)}..` +
            `${pileWorld.max.y.toFixed(2)}, z ${pileWorld.min.z.toFixed(2)}..` +
            `${pileWorld.max.z.toFixed(2)}, which leaves the firebox ` +
            `(${openingBox.min.x.toFixed(2)}..${openingBox.max.x.toFixed(2)} x, ` +
            `0..${openingBox.max.y.toFixed(2)} y, ${openingBox.min.z.toFixed(2)}..` +
            `${openingBox.max.z.toFixed(2)} z). A log through the back of the chimney or out ` +
            `across the hearthstone is a fire that is not in its fireplace.`,
        );
      }
    }
  }

  const flames = floor.getObjectByName(`castle-hearthfire-${deck}`) as InstancedMesh | undefined;
  if (!flames) {
    fail(`hearth: deck ${deck} has a fireplace and no 'castle-hearthfire-${deck}' burning in it.`);
    continue;
  }
  flames.geometry.computeBoundingBox();
  const flameLocal = flames.geometry.boundingBox;
  if (!flameLocal) continue;

  const matrix = new Matrix4();
  const world = new Box3();
  const centre = new Vector3();
  for (let i = 0; i < flames.count; i += 1) {
    flames.getMatrixAt(i, matrix);
    world.copy(flameLocal).applyMatrix4(matrix.premultiply(flames.matrixWorld));
    world.getCenter(centre);
    if (Math.hypot(centre.x - CASTLE_HEARTH.x, centre.z - CASTLE_HEARTH.z) > HEARTH_CLAIM_RADIUS) {
      continue;
    }
    if (openingBox.containsBox(world)) {
      hearthFlamesInside += 1;
      continue;
    }
    fail(
      `hearth: flame ${i} burns from (${world.min.x.toFixed(2)}, ${world.min.y.toFixed(2)}, ` +
        `${world.min.z.toFixed(2)}) to (${world.max.x.toFixed(2)}, ${world.max.y.toFixed(2)}, ` +
        `${world.max.z.toFixed(2)}), which is outside its own fireplace ` +
        `(${openingBox.min.x.toFixed(2)}..${openingBox.max.x.toFixed(2)} x, ` +
        `0..${openingBox.max.y.toFixed(2)} y, ${openingBox.min.z.toFixed(2)}..` +
        `${openingBox.max.z.toFixed(2)} z). A fire that has left its hearth is either too big ` +
        `for the opening or standing somewhere the stone is not.`,
    );
  }
}

if (hearthSurroundsFound !== 1) {
  fail(
    `hearth: ${hearthSurroundsFound} fireplaces were built across the whole castle. There is ` +
      `exactly one hearth, and it is on deck ${CASTLE_HEARTH.deck}.`,
  );
}
if (hearthFlamesInside < CASTLE_HEARTH_FLAME_COUNT) {
  fail(
    `hearth: ${hearthFlamesInside} of the ${CASTLE_HEARTH_FLAME_COUNT} flames the hearth ` +
      `publishes were found burning inside the fireplace. A fireplace with no fire in it is the ` +
      `other half of #412 and would satisfy every assertion above this line.`,
  );
}

// ---------------------------------------------------------------------------
// 10. A child at the banquet is actually sitting down.
// ---------------------------------------------------------------------------

/**
 * **The measurement issue #413 asks for, and it exists because of a fault no
 * screenshot would have shown.**
 *
 * The first dining pose leaned each child forward at the waist by 0.12 rad. The
 * rig's legs hang off `body` and the model pivots about an origin **at her
 * feet**, so the front of her shoe — 0.283 m ahead of that origin — went
 * *through the floor* by `0.283 × sin(0.12)` = 34 mm. Measured on the built
 * banquet the lowest drawn point was **37.6 mm** below the storey's floor. It
 * looks completely normal in a rendered frame and it is wrong.
 *
 * So this measures two things per diner, and the tolerances are set so that
 * **the 37.6 mm case fails**, not merely something grosser:
 *
 * - her hip pivot is on the bench top, `CASTLE_BENCH_SEAT`, to 3 mm;
 * - the lowest point **actually drawn** for her is on the floor, to 15 mm.
 *
 * The second is deliberately taken off the crowd's own `InstancedMesh`
 * matrices rather than off her skeleton. The skeleton is what the pose is
 * written to; the instance buffer is what the GPU is handed. Those are one step
 * apart, and this file's rule is to measure the further-downstream one.
 *
 * ## Why the seat height cannot simply be tuned to fit
 *
 * Because **the rig has no knee.** A leg rotated about the hip does not bend;
 * 0.36 m is `KID_HIP_HEIGHT`, and therefore the single height at which a
 * vertical leg lands a foot on the floor. If a pose breaks this, the pose moves.
 */
const SEAT_TOLERANCE = 0.003;
const FLOOR_TOLERANCE = 0.015;

let dinersChecked = 0;
let worstSeat = 0;
let worstFloor = 0;

{
  const seats = greatHallSeats(CASTLE_GREAT_HALL_DECK);
  /** #449's blank spaces — the places the Sit chip is offered on. */
  const freePlaces = seats.filter((seat) => seat.free);
  const floor = new Group();
  const banquet = new GreatHallBanquet();
  // Dressed and never updated, exactly as a check should: `dress` poses the
  // diners itself precisely so that a scene nobody drove a frame of still shows
  // children sitting down. If that ever stops being true this reads a T-pose
  // and says so.
  banquet.dress(CASTLE_GREAT_HALL_DECK, floor);
  floor.updateMatrixWorld(true);

  const group = floor.getObjectByName(banquetGroupName(CASTLE_GREAT_HALL_DECK));
  if (seats.length === 0) {
    fail(
      `banquet: the great hall offers no seats at all, so #413's "lots of other children eating ` +
        `at the tables" is an empty room. greatHallSeats is derived from the benches, so this ` +
        `means the feast laid out nothing.`,
    );
  } else if (!group) {
    fail(
      `banquet: deck ${CASTLE_GREAT_HALL_DECK} has ${seats.length} seats and no ` +
        `'${banquetGroupName(CASTLE_GREAT_HALL_DECK)}' group. Nobody is at the table.`,
    );
  } else {
    // **Every taken place has a child in it, and every free one is empty.**
    // Not `seated.length === seats.length` any more: since #449 a few places
    // are deliberately blank, so the accounting is against the seats that are
    // *not* free rather than against all of them. That is the same total stated
    // exactly once — `greatHallSeats` owns which places are free, and both the
    // crowd and the Sit chips read it — rather than a tolerance that would let
    // a child vanish quietly.
    const taken = seats.filter((seat) => !seat.free);
    if (banquet.seated.length !== taken.length) {
      fail(
        `banquet: ${taken.length} of ${seats.length} places were laid for a child and ` +
          `${banquet.seated.length} children sat down.`,
      );
    }
    if (banquet.seated.some((diner) => diner.seat.free)) {
      fail(
        `banquet: a child is sitting in one of #449's free places. Nothing may seat a diner on ` +
          `a seat whose 'free' is true — that place is the one the player is offered.`,
      );
    }
    if (freePlaces.length === 0) {
      fail(
        `banquet: the banquet lays ${seats.length} places and leaves none of them free, so ` +
          `#449's "no free spaces for the player to sit" is still true.`,
      );
    }

    // Every instance the crowd will actually draw, gathered per member.
    const drawn = new Map<number, Box3>();
    const matrix = new Matrix4();
    group.traverse((object: Object3D) => {
      const mesh = object as InstancedMesh & { isInstancedMesh?: boolean };
      if (mesh.isInstancedMesh !== true || !mesh.geometry) return;
      mesh.geometry.computeBoundingBox();
      const local = mesh.geometry.boundingBox;
      if (!local) return;
      for (let i = 0; i < mesh.count; i += 1) {
        mesh.getMatrixAt(i, matrix);
        // `InstancedCrowd` hides a part by giving it a zero matrix. A zero box
        // at the origin would drag every diner's floor measurement to 0 and make
        // this assertion incapable of failing — which is the one outcome this
        // file exists to prevent.
        if (matrix.elements[0] === 0 && matrix.elements[5] === 0 && matrix.elements[10] === 0) {
          continue;
        }
        matrix.premultiply(mesh.matrixWorld);
        const box = local.clone().applyMatrix4(matrix);
        const seen = drawn.get(i);
        if (seen) seen.union(box);
        else drawn.set(i, box);
      }
    });

    const hip = new Vector3();
    for (const diner of banquet.seated) {
      dinersChecked += 1;

      // Her hip pivot: the joint the leg hangs from, which is the joint the
      // bench height was chosen for.
      diner.avatar.rig.leftLeg.getWorldPosition(hip);
      const seatError = Math.abs(hip.y - CASTLE_BENCH_SEAT);
      worstSeat = Math.max(worstSeat, seatError);
      if (seatError > SEAT_TOLERANCE) {
        fail(
          `banquet: a diner's hip pivot is at ${hip.y.toFixed(4)} m against a bench top of ` +
            `${CASTLE_BENCH_SEAT.toFixed(4)} m — she is ${(seatError * 1000).toFixed(0)} mm ` +
            `${hip.y > CASTLE_BENCH_SEAT ? 'above' : 'below'} the seat, so she is ` +
            `${hip.y > CASTLE_BENCH_SEAT ? 'floating over' : 'sunk into'} it.`,
        );
      }

      const box = drawn.get(diner.avatar.member.index);
      if (!box) {
        fail(`banquet: a diner was seated but nothing of her is drawn.`);
        continue;
      }
      const floorError = Math.abs(box.min.y);
      worstFloor = Math.max(worstFloor, floorError);
      if (floorError > FLOOR_TOLERANCE) {
        fail(
          `banquet: the lowest point drawn for a diner is at ${box.min.y.toFixed(4)} m, ` +
            `${(floorError * 1000).toFixed(1)} mm ${box.min.y < 0 ? 'below' : 'above'} the floor ` +
            `of the storey. The rig has no knee, so a seated child's legs can only hang ` +
            `vertically; anything that turns them — a lean at the waist turns them too, because ` +
            `the model pivots about her feet — puts her toes through the floor or her feet in ` +
            `the air.`,
        );
      }

      // And she is in the gap, rather than inside the table or beside the bench.
      const offset = Math.abs(diner.seat.x - hip.x);
      if (offset > 0.001) {
        fail(`banquet: a diner's hips are ${offset.toFixed(3)} m off her own seat on the plan.`);
      }
    }
  }
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 9. The lift is a lift, and you can see the child inside it.
// ---------------------------------------------------------------------------

/**
 * **Issue #450, and the two ways it went wrong.**
 *
 * First there was no car at all: `GlassLift` was deleted with the floor split
 * (#377/#380) and nothing replaced it, so the lift glided a six-year-old out
 * through a hole in a wall and held her in open air for the whole ride. Every
 * check was green — because every check measured *props*, and the one place she
 * actually stands had nothing standing in it to measure.
 *
 * Then, with the hotel's car finally hung in the castle's **east** wall, she
 * boarded and **disappeared**: the park's camera is fixed at 45° looking along
 * −X−Z, so an east-wall alcove points away from it and the car's own back panel
 * stood between the camera and the rider. Also green, and also only findable by
 * riding it, which is how Jim found the first one.
 *
 * So this measures both, off the built objects:
 *
 *  1. the rider's spot is **inside** a lift car, and
 *  2. the line from her out to the camera **leaves that car**, at head, chest
 *     and waist height.
 *
 * (2) is the one that cannot be satisfied by an alcove in the wrong wall — at
 * any opacity, with any amount of hiding — which is why the wall moved rather
 * than the car being faded. Only the **car** is tested: the doors are meant to
 * shut in front of her, and the architrave is the hole she is seen through.
 */
{
  const alcove = new LiftAlcove({
    wallX: LIFT_WALL_X,
    wallZ: LIFT_DOOR_Z,
    yaw: LIFT_OUT_YAW,
    topOfScale: CASTLE_FLOORS.length - 1,
    labels: CASTLE_FLOORS.map((floor) => ({ at: floor.index, text: floor.glyph })),
  });
  alcove.root.updateMatrixWorld(true);

  const carParts: Mesh[] = [];
  const carBoxes: Box3[] = [];
  alcove.root.traverse((object: Object3D) => {
    const mesh = object as Mesh;
    if (mesh.isMesh !== true || !mesh.geometry) return;
    const named = mesh.name || (mesh.parent?.name ?? '');
    if (!named.startsWith('lift-car')) return;
    carParts.push(mesh);
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    if (box) carBoxes.push(box.clone().applyMatrix4(mesh.matrixWorld));
  });

  if (carBoxes.length === 0) {
    fail(
      'check:castle lift: the alcove built no lift car at all — nothing for a rider to stand in.',
    );
  }

  // Where the ride actually poses her (`liftRide.ts`), in the alcove's frame.
  const rider = new Vector3(LIFT_CAR_X, 0, LIFT_DOOR_Z);
  const inCar = carBoxes.some(
    (box) =>
      rider.x >= box.min.x && rider.x <= box.max.x && rider.z >= box.min.z && rider.z <= box.max.z,
  );
  if (!inCar) {
    fail(
      `check:castle lift: the rider stands at local (${LIFT_CAR_X.toFixed(2)}, ` +
        `${LIFT_DOOR_Z.toFixed(2)}) and no part of the car covers it — she would ride in mid-air.`,
    );
  }

  // Out towards the camera: the game's own fixed yaw and pitch, never a
  // direction written down here.
  const pitch = (CAMERA_PITCH_DEGREES * Math.PI) / 180;
  const yaw = (CAMERA_YAW_DEGREES * Math.PI) / 180;
  const toCamera = new Vector3(
    Math.cos(pitch) * Math.sin(yaw),
    Math.sin(pitch),
    Math.cos(pitch) * Math.cos(yaw),
  ).normalize();

  // Head, chest and waist — the same three heights `check:hotel` and
  // `check:statue-occlusion` use, because her head clearing an obstruction
  // while her body does not is still "she cannot be seen".
  //
  // **A real ray against real triangles**, not a bounding-box march: the shell
  // is a hollow box, so its bounding box contains the whole inside of the car
  // and every sightline out of it would "hit" immediately. The first draft did
  // exactly that and reported two obstructions in a lift you can plainly see
  // into — a check that cannot pass, which is the same disease as one that
  // cannot fail.
  const heights = [TALLEST_CHILD * 0.95, TALLEST_CHILD * 0.7, TALLEST_CHILD * 0.45];
  let blocked = 0;
  for (const height of heights) {
    const from = new Vector3(rider.x, height, rider.z);
    const ray = new Raycaster(from, toCamera, 0.02, 12);
    const hit = ray.intersectObjects(carParts, false)[0];
    if (hit) {
      blocked += 1;
      fail(
        `check:castle lift: at ${height.toFixed(2)} m up her body the line to the camera meets ` +
          `'${hit.object.name}' ${hit.distance.toFixed(2)} m out — the car is between the ` +
          `camera and the child riding in it, which is #450.`,
      );
    }
  }

  alcove.dispose();
  console.log(
    // Never the word OK on a run that just failed: the summary is a
    // measurement, and one that congratulates itself while the failure list
    // fills up is the "check that cannot fail" wearing a rosette.
    `check:castle lift ${blocked === 0 && inCar ? 'OK' : 'FAILED'} — ${carBoxes.length} ` +
      `car part(s) built at the ` +
      `${LIFT_WALL_X < 0 ? 'west' : 'east'} wall; the rider's spot is ` +
      `${inCar ? 'inside' : 'NOT inside'} them, and ` +
      `${heights.length} sightlines cast out to the camera from head, chest and waist found ` +
      `${blocked} obstruction(s). Both facts are read off a built LiftAlcove, not off the ` +
      `constants that placed it.`,
  );
}

// ---------------------------------------------------------------------------
// 10. The roof garden stands in open sky, with weather going past it.
// ---------------------------------------------------------------------------

/**
 * **Issue #455 — the green floor, and the clouds that replaced it.**
 *
 * Jim, riding the lift up: *"There is a green floor for some reason below the
 * roof garden — it is supposed to be high in the air."* It was `Shell.ts`'s
 * `interior-plaza`, correct for the stacked building it was written for and
 * wrong the day the floors became separate spaces at one `y` (#377/#380).
 *
 * Three things are asserted here, and the third is the one worth having:
 *
 * 1. **Straight down, beyond the parapet, on the roof: nothing.** Cast off the
 *    built shell, not off a constant — a `buildInteriorPlaza()` call creeping
 *    back into the roof's branch would be caught by geometry.
 * 2. **The same rays on the mall: something.** Without this pair the first
 *    assertion is one deleted `if` away from being a check that cannot fail —
 *    delete the plaza everywhere and the roof still "passes", while the mall's
 *    windows look out on a void. It is also what stops the fix over-reaching.
 * 3. **No cloud ever hangs over the garden — at any point in its drift.** The
 *    clouds live in the roof's own space and the only thing keeping them
 *    outside the terrace is `roofClouds.ts`'s claim that a puff's inward reach
 *    is smaller than its cloud's stand-off. That is arithmetic in a comment
 *    until something measures it, so every puff is stepped a whole lap round
 *    the building and its **drawn extent** — centre minus radius — is checked
 *    against the plate on every step. A grey blob over the meadow is exactly
 *    what the first build did.
 */
{
  const shell = new BuildingShell('interior');
  shell.group.updateMatrixWorld(true);

  /** Straight down from well above the deck, at a ring of points off the plate. */
  function groundUnder(floor: Object3D, radius: number, bearing: number): boolean {
    const origin = new Vector3(
      floor.position.x + Math.cos(bearing) * radius,
      20,
      Math.sin(bearing) * radius,
    );
    const ray = new Raycaster(origin, new Vector3(0, -1, 0), 0.02, 200);
    return ray.intersectObject(floor, true).length > 0;
  }

  // Beyond the plate's own corner (26.6 m) and inside where the disc used to
  // stop (52 m): the band a child sees when she looks over the rim.
  const RADII = [30, 38, 46, 50];
  const BEARINGS = 16;
  const roof = shell.floorGroups[CASTLE_ROOF.index];
  const mall = shell.floorGroups[0];
  let roofHits = 0;
  let mallHits = 0;
  let cast = 0;
  for (let i = 0; i < BEARINGS; i += 1) {
    const bearing = (i / BEARINGS) * Math.PI * 2;
    for (const radius of RADII) {
      cast += 1;
      if (roof && groundUnder(roof, radius, bearing)) roofHits += 1;
      if (mall && groundUnder(mall, radius, bearing)) mallHits += 1;
    }
  }
  if (roofHits > 0) {
    fail(
      `roof: ${roofHits} of ${cast} rays dropped straight down past the roof garden's parapet ` +
        `landed on something. The roof garden is supposed to be fifty metres up in open sky ` +
        `(#455) — this is the green floor coming back.`,
    );
  }
  if (mallHits < cast) {
    fail(
      `roof: only ${mallHits} of ${cast} rays dropped past the *mall's* edge found ground. ` +
        `The enclosed floors keep their plaza disc — their windows have to look out on ` +
        `something — so removing the roof's must not have removed theirs.`,
    );
  }

  // --- and no cloud ever drifts over the terrace -------------------------
  // The rail's height is read off the built parapet, never typed here: the
  // number this compares against has to be the one the child actually looks
  // over.
  const parapetMesh = roof ? findInFloor(roof, 'roof-parapet') : null;
  const parapetTop = parapetMesh ? new Box3().setFromObject(parapetMesh).max.y : 0;
  if (!parapetMesh) fail('roof: no roof-parapet in the built roof garden to measure against.');
  const clouds = createRoofClouds(CASTLE_ROOF.halfX, CASTLE_ROOF.halfZ);
  const puffs = clouds.root.children[0] as InstancedMesh | undefined;
  let overGarden = 0;
  let closest = Infinity;
  let aboveTheRail = 0;
  let belowTheDeck = 0;
  let steps = 0;
  if (!puffs?.isInstancedMesh) {
    fail('roof: createRoofClouds built no InstancedMesh, so nothing drifts past the parapet.');
  } else {
    const matrix = new Matrix4();
    // Long enough that even the slowest cloud on the shortest lap goes all the
    // way round and then some: 400 steps of 1.2 s at the slowest 0.55 m/s is
    // 264 m against a shortest lap of about 170 m. The seeded starting
    // arrangement is one out of thousands and proves nothing on its own — the
    // claim is about all of them.
    const STEP_SECONDS = 1.2;
    for (let step = 0; step < 400; step += 1) {
      steps += 1;
      for (let i = 0; i < puffs.count; i += 1) {
        puffs.getMatrixAt(i, matrix);
        const e = matrix.elements;
        const x = e[12] as number;
        const y = e[13] as number;
        const z = e[14] as number;
        // The geometry is a unit sphere, so the length of the matrix's first
        // column *is* the drawn radius in metres — and x and z share a scale.
        const radius = Math.hypot(e[0] as number, e[1] as number, e[2] as number);
        // How far the *drawn* puff stays outside the plate: the true distance
        // from the rectangle, not the worse of the two axes. Per-axis was tried
        // first and is wrong at the corners — it under-reports a diagonal
        // stand-off by up to 30%, so it condemned puffs that clear the plate
        // perfectly well. `dx`/`dz` are zero on an axis the puff overlaps, so
        // outside gives a real distance and inside gives zero.
        const dx = Math.max(Math.abs(x) - CASTLE_ROOF.halfX, 0);
        const dz = Math.max(Math.abs(z) - CASTLE_ROOF.halfZ, 0);
        const clear = Math.hypot(dx, dz) - radius;
        if (clear < closest) closest = clear;
        if (clear < 0) overGarden += 1;
        if (y > parapetTop) aboveTheRail += 1;
        if (y < -2) belowTheDeck += 1;
      }
      clouds.update(STEP_SECONDS, step * STEP_SECONDS);
    }
  }
  if (overGarden > 0) {
    fail(
      `roof: ${overGarden} cloud puff(s) reached back over the roof garden as the field ` +
        `drifted — worst by ${(-closest).toFixed(2)} m. A cloud belongs outside the parapet; ` +
        `inside it is a grey blob on the meadow (#455).`,
    );
  }
  if (aboveTheRail === 0 || belowTheDeck === 0) {
    fail(
      `roof: the cloud field has ${aboveTheRail} puff-frames above the parapet and ` +
        `${belowTheDeck} below the deck. It needs both — the ones at head height are what ` +
        `she sees drift past, the ones below are what say she is high up.`,
    );
  }
  clouds.dispose();

  console.log(
    `check:castle roof ${roofHits === 0 && mallHits === cast && overGarden === 0 ? 'OK' : 'FAILED'}` +
      ` — ${cast} rays down past the roof's rim hit ground ${roofHits} time(s) and the same ` +
      `rays past the mall's hit it ${mallHits} time(s); ${puffs?.count ?? 0} cloud puffs stepped ` +
      `round ${steps} positions of a full lap stayed clear of the terrace by ` +
      `${Number.isFinite(closest) ? closest.toFixed(2) : '—'} m at their worst.`,
  );
}

// 11. The blank places are reachable, and the pets' table is one a pet can
//     reach and the camera can see.
// ---------------------------------------------------------------------------

/**
 * **Issue #449, both halves, measured off what was built.**
 *
 * Jim, on #422's preview: *"Great hall only has one table and no free spaces
 * for the player to sit … There should also be a small pets table for the pets
 * to eat at, and they go there when the player sits."*
 *
 * Assertion 10 already proves that every place laid for a child has a child in
 * it and that she is genuinely sitting down. What it cannot see is the four
 * things this ticket added, each of which fails silently and none of which a
 * screenshot of the empty hall would catch:
 *
 * 1. **There are two runs**, not one. Counted off the built tables' own X
 *    positions, so a change that quietly collapses them back onto one axis —
 *    the exact regression #449 is a fix for — is loud.
 * 2. **A free place can be stood at.** Its stand spot has to be far enough
 *    from the seat to be outside the bench and near enough to be inside the
 *    zone's own pick radius. Too far and the chip exists and never comes in
 *    range, which is the fault the hotel's window zones were found to have
 *    (`Hotel.standSpotFor`'s own note).
 * 3. **A pet can reach its bowl.** The pets' table is short *for a reason* —
 *    the animals are 0.3–0.6 m tall — so its top is asserted against the feast
 *    tables' rather than against a number typed here.
 * 4. **Every bowl has somebody at it, and every pet has a bowl.** One list
 *    owns both, so this is really asking whether that is still true.
 */
/**
 * How far a pet standing at its place may be from the nearest bowl, in metres.
 *
 * A pet's own body plus its nose: `PARADE_MEMBER_RADIUS` is what the parade
 * spaces the line with, and the stand-off is built from it, so this is that
 * plus the half-table it has to lean over. Generous, because the failure it
 * exists to catch is not "a centimetre out" — it is a bowl laid from one list
 * and a place taken from another, which is metres out or nothing.
 */
const PET_REACH = 1.5;

/**
 * How far from her seat the nearest pet may be and still be on screen, in
 * metres.
 *
 * **Read off the running game, not chosen.** At the mouth of the aisle the
 * nearest pet was 12.2 m from the nearest free place and sat exactly on the
 * bottom edge of the frame — the cat walked out of the picture. The roundel's
 * near edge, about 13 m away, was the last thing visible at the screen's
 * corner in the same shot. So 8 m is comfortably inside frame with the walk
 * itself visible, and 12 m is known to be too far.
 */
const PET_TABLE_IN_SHOT = 8;

/**
 * **The fewest runs of tables #449 will accept.** Two.
 *
 * Jim asked first for *"two big tables"* and then, having seen them, for *"as
 * many tables as is needed to fill the space"* — so the hall now derives its
 * own count from the plate and this is a floor rather than a target. What it
 * still catches is the thing he actually reported: a single run of assets end
 * to end, which reads from the sofa as one long table.
 *
 * Written here rather than read from `castleFurniture.ts`, and that is the
 * whole point of it: an earlier draft compared the tables in the scene against
 * the list the furniture was placed from, so collapsing the runs onto one axis
 * moved both sides of the comparison together and the assertion sailed through
 * green. Proved by mutation, not by reading. The number a check asserts has to
 * come from the requirement, never from the code under test.
 */
const FEAST_RUNS_ASKED_FOR = 2;

{
  // So the summary below cannot announce a hall it has just failed. Every
  // earlier assertion here prints its OK line unconditionally, which reads
  // oddly enough on a red run to be worth not repeating.
  const failuresBefore = failures.length;
  const seats = greatHallSeats(CASTLE_GREAT_HALL_DECK);
  const free = seats.filter((seat) => seat.free);
  const places = greatHallPetPlaces(CASTLE_GREAT_HALL_DECK);
  const petTable = greatHallPetTable(CASTLE_GREAT_HALL_DECK);

  // --- 1. two runs ---------------------------------------------------------
  const tableXs = new Set<string>();
  hall?.traverse((object: Object3D) => {
    if (!object.name.startsWith('castle.feastTable')) return;
    tableXs.add(object.position.x.toFixed(2));
  });
  if (tableXs.size < FEAST_RUNS_ASKED_FOR) {
    fail(
      `banquet places: the hall built feast tables on ${tableXs.size} axis/axes ` +
        `(${[...tableXs].join(', ')}), fewer than the ${FEAST_RUNS_ASKED_FOR} #449 asks for. ` +
        `A run of assets end to end reads as one long table, which is what Jim saw.`,
    );
  }

  // --- 2. a free place can be stood at -------------------------------------
  for (const seat of free) {
    const reach = Math.hypot(seat.standX - seat.x, seat.standZ - seat.z);
    if (reach <= CASTLE_BENCH_HALF_WIDTH * 2) {
      fail(
        `banquet places: a free place's stand spot is ${reach.toFixed(2)} m from the seat, ` +
          `which is inside its own ${(CASTLE_BENCH_HALF_WIDTH * 2).toFixed(2)} m bench plank. ` +
          `She would be walked into the furniture to sit down on it.`,
      );
    }
    if (reach >= SIT_PICK_RADIUS) {
      fail(
        `banquet places: a free place's stand spot is ${reach.toFixed(2)} m from the seat, ` +
          `outside the zone's own ${SIT_PICK_RADIUS.toFixed(2)} m pick radius. The chip would ` +
          `exist and never come into range — the fault the hotel's window zones had.`,
      );
    }
  }

  // --- 3 and 4. the pets' table --------------------------------------------
  if (!petTable || places.length === 0) {
    fail(
      `banquet places: the great hall laid no pets' table, so #449's "a small pets table for ` +
        `the pets to eat at" is not there and nothing has anywhere to go when she sits.`,
    );
  } else {
    const tops: number[] = [];
    const bowls: Vector3[] = [];
    const box = new Box3();
    hall?.traverse((object: Object3D) => {
      if (object.name === 'castle-pet-table-top') tops.push(box.setFromObject(object).max.y);
      if (object.name.startsWith('hotel.petBowl')) {
        bowls.push(object.getWorldPosition(new Vector3()));
      }
    });
    if (tops.length !== 1) {
      fail(`banquet places: ${tops.length} pets' table tops were built, not 1.`);
    }
    const top = tops[0] ?? 0;
    if (top >= CASTLE_TABLE_TOP) {
      fail(
        `banquet places: the pets' table top is at ${top.toFixed(3)} m, no lower than the ` +
          `feast tables' own ${CASTLE_TABLE_TOP.toFixed(3)} m. The pets are 0.3–0.6 m tall; a ` +
          `bowl up there is over every one of their heads.`,
      );
    }
    if (bowls.length === 0) {
      fail(
        `banquet places: the pets' table has ${places.length} places laid at it and no bowls ` +
          `on it at all, so every animal sent there stands at bare wood.`,
      );
    }
    for (const place of places) {
      const nearest = bowls.reduce(
        (best, bowl) => Math.min(best, Math.hypot(bowl.x - place.x, bowl.z - place.z)),
        Infinity,
      );
      if (nearest > PET_REACH) {
        fail(
          `banquet places: a pet's place is ${nearest.toFixed(2)} m from the nearest bowl, ` +
            `beyond the ${PET_REACH.toFixed(2)} m it can reach. It would stand there eating air.`,
        );
      }
    }
    // Its whole point is that she watches it happen from where she is sitting.
    const farthest = free.reduce(
      (worst, seat) =>
        Math.max(
          worst,
          places.reduce(
            (best, place) => Math.min(best, Math.hypot(place.x - seat.x, place.z - seat.z)),
            Infinity,
          ),
        ),
      0,
    );
    if (farthest > PET_TABLE_IN_SHOT) {
      fail(
        `banquet places: from the worst free place the nearest pet is ${farthest.toFixed(1)} m ` +
          `away, past the ${PET_TABLE_IN_SHOT.toFixed(1)} m that stays in frame at this camera. ` +
          `#449's whole point is that she *watches* her cat go and eat; at the mouth of the ` +
          `aisle it was 12 m off and the animal walked off the bottom of the picture.`,
      );
    }
  }

  if (failures.length > failuresBefore) {
    console.error(
      `check:castle places — ${failures.length - failuresBefore} of #449's own assertions ` +
        `failed, so nothing about the blank places or the pets' table is being claimed here.`,
    );
  } else console.log(
    `check:castle places OK — ${tableXs.size} feast runs built, ${free.length} of ` +
      `${seats.length} places left free for the player, each with a stand spot ` +
      `${Math.min(...free.map((s) => Math.hypot(s.standX - s.x, s.standZ - s.z))).toFixed(2)} m ` +
      `back — outside its own ${(CASTLE_BENCH_HALF_WIDTH * 2).toFixed(2)} m bench and inside ` +
      `the chip's ${SIT_PICK_RADIUS.toFixed(2)} m reach. The pets' table stands at ` +
      `${top_(petTable)} with ${places.length} places and a bowl at every one, its top below ` +
      `the feast's own, and the farthest of them ${farthest_(free, places).toFixed(1)} m from ` +
      `the worst free place — so she watches it happen from her seat.`,
  );
}

/** Where the pets' table ended up, for the line above. */
function top_(table: { readonly x: number; readonly z: number } | null): string {
  return table ? `(${table.x.toFixed(1)}, ${table.z.toFixed(1)})` : 'nowhere';
}

/** The worst free-place-to-nearest-pet distance, for the line above. */
function farthest_(
  free: readonly { readonly x: number; readonly z: number }[],
  places: readonly { readonly x: number; readonly z: number }[],
): number {
  let worst = 0;
  for (const seat of free) {
    let best = Infinity;
    for (const place of places) {
      best = Math.min(best, Math.hypot(place.x - seat.x, place.z - seat.z));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\ncheck:castle — ${failures.length} failure(s):\n`);
  for (const message of failures) console.error(`  ✗ ${message}`);
  console.error('');
  process.exit(1);
}

// **Every number in these three lines is counted, never a constant dressed up as
// a finding.** The first line used to say "across ${TOP_DECK} enclosed storeys",
// which was a constant printed as though something had gone and looked — so it
// read identically on a castle with no ceiling at all. `storeysSeen`,
// `platedSegmentsInScene`, `flagstonedDecksInScene` and `coursedWallsInScene` are
// incremented only when a mesh was found in a built `BuildingShell('interior')`,
// and `storeysDressed` only when a storey actually yielded placed decoration, so
// each of them goes down when the castle does.
console.log(
  `check:castle OK — ${beamsChecked} ceiling-beam segments built, and in an assembled ` +
    `BuildingShell('interior') ${storeysSeen} storeys were found with both a ceiling and a ` +
    `flagstone floor (${platedSegmentsInScene} plate segments in the tree, ` +
    `${flagstonedDecksInScene} flagstoned decks, ${coursedWallsInScene} coursed wall runs). ` +
    `Every segment is fixed to real slab across its whole measured footprint and clear of a ` +
    `${TALLEST_CHILD} m child under a ${CASTLE_CEILING_CLEAR.toFixed(2)} m ceiling, and ` +
    `BEAM_UNDERSIDE agrees with the mesh at ${BEAM_UNDERSIDE.toFixed(3)} m.`,
);
console.log(
  `check:castle props OK — ${propsChecked} placed instances measured across ` +
    `${storeysDressed} storeys, none in a walkable route or on a shop stand and none ` +
    `through a ceiling. Route-exempt: ${exemptOverhead} entirely above a ${TALLEST_CHILD} m ` +
    `child, ${exemptFlat} floor treatment under ${FLOOR_TREATMENT_MAX_HEIGHT} m tall, ` +
    `${exemptWall} wall furniture within ${WALL_FURNITURE_REACH} m of its wall. All three ` +
    `exemptions are measured off the object, never taken from its name.`,
);
console.log(
  `check:castle plate OK — ${plateProps} floor-standing props on ${plateStoreys.size} floor(s), ` +
    `every one of them over its own floor's plate rather than hanging in mid-air over the plaza. ` +
    `This replaces the shaft assertion, which is retired because #377 removed every shaft: the ` +
    `structure that used to come down through a solid floor no longer exists. Every figure here ` +
    `is counted, not the size of a list.`,
);
console.log(
  `check:castle contract OK — ${contractChecked} published figures measured against the ` +
    `furniture standing in the great hall: TABLE_TOP ${CASTLE_TABLE_TOP.toFixed(3)} m, ` +
    `BENCH_SEAT ${CASTLE_BENCH_SEAT.toFixed(3)} m, PLINTH_TOP ${CASTLE_PLINTH_TOP.toFixed(3)} m, ` +
    `and the sconce's cup on the flame's own placement. Every one measured off the built object, ` +
    `outline excluded, never re-read from the file it came from.`,
);
console.log(
  `check:castle hearth OK — ${hearthSurroundsFound} fireplace built, on deck ` +
    `${CASTLE_HEARTH.deck}, with ${hearthFlamesInside} flames measured burning inside its own ` +
    `${(CASTLE_HEARTH_OPENING.halfWidth * 2).toFixed(1)} x ` +
    `${CASTLE_HEARTH_OPENING.height.toFixed(1)} m opening and none outside it. Both halves are ` +
    `emitted from one block so they cannot separate; this is the assertion #412 found missing ` +
    `when the fire burned 300 m from its own surround with every check green.`,
);
console.log(
  `check:castle banquet OK — ${dinersChecked} children measured seated at the feast. Worst hip ` +
    `off the ${CASTLE_BENCH_SEAT.toFixed(3)} m bench top: ${(worstSeat * 1000).toFixed(1)} mm ` +
    `(tolerance ${(SEAT_TOLERANCE * 1000).toFixed(0)} mm). Worst lowest-drawn-point off the ` +
    `floor: ${(worstFloor * 1000).toFixed(1)} mm (tolerance ` +
    `${(FLOOR_TOLERANCE * 1000).toFixed(0)} mm) — read off the crowd's instance matrices, not ` +
    `off the skeleton the pose was written to. Each sits on the inner face of a ` +
    `${(CASTLE_BENCH_HALF_WIDTH * 2).toFixed(2)} m plank, in the ` +
    `${DINER_TABLE_GAP.toFixed(2)} m of floor between that face and the table's edge.`,
);
