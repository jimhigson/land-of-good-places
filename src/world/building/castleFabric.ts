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
 * per storey. Two shared canvas textures fix both, and cost **no extra draw
 * calls and no extra triangles at all**: they hang off meshes that were
 * already being drawn. The beams are the only new geometry here, and they
 * are one `InstancedMesh` per storey.
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

/** How far apart the beams march along the hall, in metres. */
const BEAM_PITCH = 4;
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
 * **Timber beams across the ceiling.** A hall reads as a hall from its
 * ceiling, and this room had nothing up there at all.
 *
 * They run **across the short span** (along Z), the way a real hall's do,
 * marching every {@link BEAM_PITCH} metres down the long axis.
 *
 * ## They stop at the holes, and that is the whole subtlety
 *
 * The ceiling of storey `deck` is the underside of storey `deck + 1`'s slab,
 * and that slab is punched through by the stairs, the escalator, the lift,
 * the trampoline, the bubble and the helter-skelter (`DECK_HOLES`). A beam
 * drawn straight across one of those would hang in mid-air over an open
 * shaft with nothing holding it up, and would be visible from the storey
 * above looking down.
 *
 * So each beam is laid as short segments and **every segment asks the deck
 * above whether there is actually a slab there** (`deckIsSolid`) — measuring
 * the floor that was built rather than re-deriving the hole list, which is
 * this repo's standing rule for exactly this kind of question. A shaft that
 * moves takes the beams with it, for free, and no second copy of the hole
 * plan exists here to fall out of step.
 *
 * ## They clear the tallest child in the game
 *
 * Not the *average* one. `TALLEST_CHILD_HEIGHT` is every hair style crossed
 * with every hat, measured on the real models, and it is 2.97 m against a
 * 3.30 m ceiling — so a beam has 33 cm to exist in. See {@link BEAM_DEPTH}.
 *
 * Returns `null` for the roof terrace, which is outdoors and has no ceiling.
 */
export function buildCeilingBeams(deck: number): InstancedMesh | null {
  if (deck >= TOP_DECK) return null;

  const above = deck + 1;
  const y = BEAM_UNDERSIDE + BEAM_DEPTH / 2;
  if (BEAM_UNDERSIDE <= TALLEST_CHILD_HEIGHT) {
    throw new Error(
      `castleFabric: beams would hang to ${BEAM_UNDERSIDE.toFixed(2)} m, at or below the ` +
        `tallest child (${TALLEST_CHILD_HEIGHT} m). Make BEAM_DEPTH shallower, or raise the ` +
        `storey — do not ship a ceiling children walk through.`,
    );
  }
  const spots: { x: number; z: number }[] = [];

  // Start half a pitch in from the wall, so the run is symmetric about the
  // middle of the hall rather than crowding one end.
  for (let x = -INTERIOR_HALF_X + BEAM_PITCH / 2; x < INTERIOR_HALF_X; x += BEAM_PITCH) {
    for (
      let z = -INTERIOR_HALF_Z + BEAM_SEGMENT / 2;
      z < INTERIOR_HALF_Z;
      z += BEAM_SEGMENT
    ) {
      // Both ends as well as the middle, so a segment never pokes out over
      // the lip of a hole it is only just clear of.
      if (!deckIsSolid(above, x, z)) continue;
      if (!deckIsSolid(above, x, z - BEAM_SEGMENT / 2)) continue;
      if (!deckIsSolid(above, x, z + BEAM_SEGMENT / 2)) continue;
      spots.push({ x, z });
    }
  }

  const beams = new InstancedMesh(
    new BoxGeometry(BEAM_WIDTH, BEAM_DEPTH, BEAM_SEGMENT),
    softMaterial(PALETTE.woodDark, 0.8),
    Math.max(1, spots.length),
  );
  beams.name = `castle-ceiling-beams-${deck}`;
  // Never a shadow caster. Issue #251 has the shadow pass at 57% of draw
  // calls, and a beam pressed against the ceiling it is lit through would
  // buy a stripe of acne rather than a shadow.
  beams.castShadow = false;
  beams.receiveShadow = true;
  beams.count = spots.length;

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  const position = new Vector3();
  spots.forEach((spot, index) => {
    position.set(spot.x, y, spot.z);
    matrix.compose(position, rotation, scale);
    beams.setMatrixAt(index, matrix);
  });
  beams.instanceMatrix.needsUpdate = true;
  return beams;
}
