import { BoxGeometry, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import {
  BUILDING_FLOOR_HEIGHT,
  BUILDING_SLAB,
  INTERIOR_HALF_X,
  INTERIOR_HALF_Z,
} from '../../core/constants';
import { PALETTE } from '../../core/palette';
import { castleCoursingTexture, castleFlagstoneTexture } from '../../core/textures';
import { interiorMaterial, softMaterial } from './parts';
import { deckIsSolid, TOP_DECK } from './layout';
import { TALLEST_CHILD_HEIGHT } from '../../art/models/kid';

/**
 * **The castle's inside, as fabric** (issue #363).
 *
 * Jim, 29 August 2026: *"style the inside of the castle like a castle.
 * Currently it is a generic box."*
 *
 * This module owns the three things that make the room read as a castle
 * before a single prop is placed in it — the floor, the walls and the
 * ceiling — because they are the three largest surfaces in frame and none of
 * them needs Blender. Props (armour, tapestries, a throne) come from the 3D
 * Artist through the `.glb` pipeline and are placed elsewhere; see
 * `HANDOFF-castle-interior-363.md`.
 *
 * ## Why fabric first, and why it is nearly free
 *
 * The floor plate is 60 × 44 m — 2 640 m², the largest single surface
 * anywhere in the game — and it was one flat colour. So was 208 m of wall
 * per storey.
 *
 * **The two textures are genuinely free**: no extra draw calls and no extra
 * triangles, because they hang off meshes that were already being drawn.
 *
 * **The wall-plate is not, and the first version of this comment implied it
 * was.** Measured: **+4 geometries, +4 draw calls, 4 560 triangles, and 0 in
 * the shadow pass.** That is cheap — one instanced mesh per enclosed storey,
 * none of it shadow-casting — but it is not nothing, and a performance claim
 * that rounds itself down is how a budget stops meaning anything.
 *
 * ## The colours are the facade's, deliberately
 *
 * The castle already stands in the garden (`buildCastle` in `Shell.ts`) in
 * `PALETTE.buildingWall` cream over a `stonePinkLight` courtyard. The inside
 * uses that same masonry family. GAME_DESIGN item 30c means the two are
 * disconnected worlds and *structurally* need not agree — but a child walks
 * through one door into the other, and swapping material worlds across a
 * threshold is exactly what made the inside read as a different building.
 */

/**
 * **Clear headroom on any castle storey: 3.30 m.**
 *
 * The storey is `BUILDING_FLOOR_HEIGHT` tall and the slab above it hangs
 * `BUILDING_SLAB` down into it, so this is what is actually left for a child
 * and for anything standing on the floor.
 *
 * Exported and derived rather than written down because it is the number the
 * Artist's assets are sized against (the throne is the one at risk of it) and
 * the number `check:castle` measures every prop against. A second, typed copy
 * of "3.3" in an asset script is precisely the two-definitions bug this repo
 * hits more than any other — read it from here.
 */
export const CASTLE_CEILING_CLEAR = BUILDING_FLOOR_HEIGHT - BUILDING_SLAB;

/**
 * The floor of a castle storey: flagstones.
 *
 * `ExtrudeGeometry`'s top-face UVs are the plan coordinates in metres, so the
 * flagstone map tiles across the plate in real metres with no UV work at all
 * — and meets the wall's coursing at the skirting for free, because that is
 * generated in metres too. See `castleFlagstoneTexture`.
 *
 * The colour underneath the map stays the storey's own, which is what keeps
 * the layer-cake reading the family liked: the stones are the same stones on
 * every floor, and the floor they are laid on is a different tint per storey.
 */
export function castleFloorMaterial(colour: number) {
  return interiorMaterial(colour, 0.82, castleFlagstoneTexture());
}

/** The walls of a castle storey: coursed ashlar over the storey's own tint. */
export function castleWallMaterial(colour: number) {
  return softMaterial(colour, 0.78, castleCoursingTexture());
}

// ------------------------------------------------------------------- beams

/**
 * A beam's cross-section — **wide and shallow, and that is the whole design.**
 *
 * The first cut was 0.45 wide by 0.40 deep, which `check:castle` immediately
 * failed: it hung to 2.90 m and {@link TALLEST_CHILD_HEIGHT} is 2.97, so the
 * tallest child in the game walked through every beam in the room with her hat.
 *
 * There is not much room to give. The ceiling is only
 * {@link CASTLE_CEILING_CLEAR} (3.30 m) and a tall child needs 2.97 of it, so a
 * beam gets 0.33 m to live in and no more. Rather than shave the depth until a
 * beam is a pencil line, the beam gets its bulk **across** instead of **down**:
 * 0.70 m wide by 0.22 m deep, hanging to {@link BEAM_UNDERSIDE}. Seen from the
 * 38° camera you are looking at a ceiling timber's *width* far more than its
 * depth, so a wide shallow beam reads chunkier than a narrow deep one — which
 * is ART_DIRECTION §4's "recognisable beats measured" pointed at a cross
 * section.
 */
const BEAM_WIDTH = 0.7;
const BEAM_DEPTH = 0.22;

/**
 * How low the beams hang: 3.08 m, which is {@link TALLEST_CHILD_HEIGHT} plus
 * 11 cm.
 *
 * Exported because `check:castle` asserts it against the built matrices, and
 * because it is the ceiling for **anything else that ever hangs in this room**
 * — a chandelier, a banner, a hanging sign. Ask for this number; do not write
 * 3.08 down a second time.
 */
export const BEAM_UNDERSIDE = CASTLE_CEILING_CLEAR - BEAM_DEPTH;
/**
 * Beams are cut into segments this long so a beam can stop at the edge of a
 * hole in the ceiling above it rather than sailing across the open shaft.
 *
 * They are instanced, so segments are very nearly free — the whole run is one
 * draw call however many pieces it is in.
 */
const BEAM_SEGMENT = 2;

/**
 * How far in from the wall face the plate sits, in metres.
 *
 * Far enough that it is a timber *on* the wall rather than a stripe painted
 * into the corner, and not so far that it starts to overhang the room.
 */
const PLATE_INSET = 0.9;

/**
 * **A timber wall-plate round the top of the room**, on corbels — the castle's
 * roof structure, read from the only angle this camera can show it from.
 *
 * ## Why this is not a ceiling full of beams, which is what it started as
 *
 * The first cut ran beams straight across the hall every 4 m, the way a real
 * hall's do. Photographed in the running game it was plainly wrong, and the
 * reason is the **cutaway**: the storey above you is faded out so you can see
 * in, so there is no ceiling for a beam to be fixed to. Fifteen timbers hung
 * in mid-air over an open room, cut across the floor at the camera's 38° and
 * hid the flagstones and the roundel behind a set of floating planks. It is a
 * good illustration of a rule this repo keeps re-learning: the thing looked
 * correct in the code and in the geometry, and only a rendered frame could say
 * it was wrong.
 *
 * A wall-plate has the same job — say "this room is built of timber, and it has
 * a top" — from a position the cutaway does not delete: **against the wall**,
 * where a child's eye already is, crossing nothing and hiding nothing.
 *
 * ## They stop at the holes, and that is the whole subtlety
 *
 * The plate is fixed to the underside of the slab above, and that slab is
 * punched through by the stairs, the escalator, the lift, the trampoline, the
 * bubble and the helter-skelter (`DECK_HOLES`) — several of which reach the
 * wall. A run of plate over one of those is fixed to a ceiling that is not
 * there.
 *
 * So the plate is laid as short segments and **every segment asks the deck
 * above whether there is actually a slab there** (`deckIsSolid`) — measuring
 * the floor that was built rather than re-deriving the hole list, which is this
 * repo's standing rule for exactly this kind of question. A shaft that moves
 * takes the plate with it, for free, and no second copy of the hole plan lives
 * here to fall out of step.
 *
 * ## It clears the tallest child in the game
 *
 * Not the *average* one. `TALLEST_CHILD_HEIGHT` is every hair style crossed
 * with every hat, measured on the real models, and it is 2.97 m against a
 * 3.30 m ceiling — so the plate has 33 cm to exist in. See {@link BEAM_DEPTH}.
 *
 * One `InstancedMesh` per storey. Returns `null` for the roof terrace, which is
 * outdoors and has no ceiling to plate.
 */
export function buildCeilingBeams(deck: number): InstancedMesh | null {
  if (deck >= TOP_DECK) return null;

  if (BEAM_UNDERSIDE <= TALLEST_CHILD_HEIGHT) {
    throw new Error(
      `castleFabric: the wall-plate would hang to ${BEAM_UNDERSIDE.toFixed(2)} m, at or below ` +
        `the tallest child (${TALLEST_CHILD_HEIGHT} m). Make BEAM_DEPTH shallower, or raise ` +
        `the storey — do not ship a ceiling children walk through.`,
    );
  }

  const above = deck + 1;
  const y = BEAM_UNDERSIDE + BEAM_DEPTH / 2;
  const spots: { x: number; z: number; alongZ: boolean }[] = [];

  /** Keeps a segment on solid slab at both ends as well as in the middle. */
  const solidRun = (x: number, z: number, alongZ: boolean): boolean => {
    const half = BEAM_SEGMENT / 2;
    const dx = alongZ ? 0 : half;
    const dz = alongZ ? half : 0;
    return (
      deckIsSolid(above, x, z) &&
      deckIsSolid(above, x - dx, z - dz) &&
      deckIsSolid(above, x + dx, z + dz)
    );
  };

  // The two long walls, running along X.
  for (const z of [-INTERIOR_HALF_Z + PLATE_INSET, INTERIOR_HALF_Z - PLATE_INSET]) {
    for (let x = -INTERIOR_HALF_X + BEAM_SEGMENT / 2; x < INTERIOR_HALF_X; x += BEAM_SEGMENT) {
      if (solidRun(x, z, false)) spots.push({ x, z, alongZ: false });
    }
  }
  // The two short walls, running along Z. Started one segment in from each end
  // so the runs meet at the corner rather than crossing through it.
  for (const x of [-INTERIOR_HALF_X + PLATE_INSET, INTERIOR_HALF_X - PLATE_INSET]) {
    for (
      let z = -INTERIOR_HALF_Z + PLATE_INSET + BEAM_SEGMENT / 2;
      z < INTERIOR_HALF_Z - PLATE_INSET;
      z += BEAM_SEGMENT
    ) {
      if (solidRun(x, z, true)) spots.push({ x, z, alongZ: true });
    }
  }

  const beams = new InstancedMesh(
    // Authored running along X; the Z runs are the same box, yawed.
    new BoxGeometry(BEAM_SEGMENT, BEAM_DEPTH, BEAM_WIDTH),
    softMaterial(PALETTE.woodDark, 0.8),
    Math.max(1, spots.length),
  );
  // **`castle-timber-`, never `castle-wall-`.** `test/procgen/parkFacts.ts`
  // measures the top of the castle's stonework by matching every mesh in the
  // scene against `/^(castle-wall-|crenellations$)/`, and feeds it to the
  // invariant that the ginormous slide leaves over the battlements. This mesh
  // was called `castle-wall-plate-N` for one afternoon and fell straight into
  // that pattern: an interior timber 4.5 m higher than the real parapet was
  // read as the castle's stonework, `castleMasonryTopY` jumped 10.29 → 14.83 m,
  // and `npm run test:procgen` failed on all five seeds.
  //
  // The fix is this name, not a narrower pattern. That prefix is **deliberately
  // permissive**: the facade already has four bands (`-lower`, `-upper`,
  // `-window`, `-lintel`), two of them added long after the invariant was
  // written, and they were picked up for free. Enumerating them instead would
  // make the check fail *unsafe* — a fifth band would be silently excluded, the
  // measured masonry top would read low, and a slide that really does clip the
  // battlements would pass. Over-measuring only ever costs a false failure;
  // under-measuring costs a child hitting a wall.
  //
  // So: **nothing built for the castle's inside may take a `castle-wall-`
  // name.** `check:castle` asserts exactly that, so this cannot recur silently.
  beams.name = `castle-timber-plate-${deck}`;
  // Never a shadow caster. Issue #251 has the shadow pass at 57% of draw
  // calls, and a timber pressed against the ceiling it is lit through would
  // buy a stripe of acne rather than a shadow.
  beams.castShadow = false;
  beams.receiveShadow = true;
  beams.count = spots.length;

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const axis = new Vector3(0, 1, 0);
  const scale = new Vector3(1, 1, 1);
  const position = new Vector3();
  spots.forEach((spot, index) => {
    rotation.setFromAxisAngle(axis, spot.alongZ ? Math.PI / 2 : 0);
    position.set(spot.x, y, spot.z);
    matrix.compose(position, rotation, scale);
    beams.setMatrixAt(index, matrix);
  });
  beams.instanceMatrix.needsUpdate = true;
  return beams;
}
