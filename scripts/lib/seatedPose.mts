/**
 * **Is a seated child actually sitting down?** — the two tolerances, and the
 * one measurement, every check that seats a child holds her to.
 *
 * Lifted out of `scripts/check-castle.mts` (the banquet's clause, issue #413)
 * for the library's story time (#718), where the player on her cushion and the
 * library's children on theirs are held to the same rule. Two checks with two
 * private copies of "how close is close enough" would drift the first time
 * either was retuned, and the tolerance that drifted would be found by a child
 * with her feet in the air.
 *
 * ## Why the numbers are what they are
 *
 * The rig has **no knee**. A leg rotated about the hip does not bend, it
 * swings, and the whole model pivots about an origin **at her feet** — so the
 * first dining pose, which leaned a diner forward by 0.12 rad at the waist,
 * put the front of her shoe (0.283 m ahead of that origin) **37.6 mm through
 * the floor**, measured on the built banquet, while looking completely normal
 * in a rendered frame. The tolerances are set so that the 37.6 mm case fails,
 * not merely something grosser:
 *
 * - {@link SEAT_TOLERANCE}: her hip pivot is on the seat top, to 3 mm;
 * - {@link FLOOR_TOLERANCE}: the lowest point actually drawn for her is on the
 *   floor, to 15 mm (the shoe's own sole sits a few millimetres proud of it).
 *
 * A seat is cut to `KID_HIP_HEIGHT` precisely because that is the one height at
 * which a *vertical* leg lands a foot on the floor; if a pose breaks either
 * tolerance, the pose moves — never the tolerance.
 */
import { BackSide, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Vector3, type BufferAttribute, type Object3D } from 'three';

/** Her hip pivot against the seat top, in metres. See the header. */
export const SEAT_TOLERANCE = 0.003;

/** The lowest point drawn for her against the floor, in metres. See the header. */
export const FLOOR_TOLERANCE = 0.015;

/**
 * What {@link seatedErrors} measures: the rig a seated child is posed on.
 * `CharacterModel` (the player, and every `characterModelAvatar` resident)
 * and `NpcRig` both satisfy it.
 */
export interface SeatedBody {
  /** The model's root — everything drawn for her hangs under it. */
  readonly root: Object3D;
  /** Her left hip pivot: the joint the leg hangs from, the one a seat height is chosen for. */
  readonly leftLeg: Object3D;
}

/** One seated child, measured — every value world-space, in metres. */
export interface SeatedErrors {
  /** World y of the lowest drawn vertex: visible, and never an ink outline. Her shoe soles. */
  readonly lowestY: number;
  /** World y of her hip pivot (`leftLeg`). */
  readonly hipY: number;
  /** `|lowestY − floorY|` — held to {@link FLOOR_TOLERANCE}. */
  readonly floor: number;
  /** `|hipY − seatTop|` — held to {@link SEAT_TOLERANCE}. */
  readonly seat: number;
}

/** An ink outline — the inverted hull `addOutline` draws round a shape — rather than the shape. */
function isOutline(mesh: Mesh): boolean {
  const material = mesh.material;
  return material instanceof MeshBasicMaterial && material.side === BackSide;
}

/**
 * **How far a seated child is from sitting properly**: her lowest drawn vertex
 * against `floorY`, and her hip pivot against `seatTop`.
 *
 * "Lowest drawn vertex" is the `measurePlan` rule (`art/models/libraryAssets.ts`, #716):
 * every visible vertex of every painted part, walked one by one — never a
 * bounding box, which a rotated part inflates — and **never an outline**, whose
 * hull sits a centimetre and a half outside the shape it inks. A mesh counts
 * only if it and every ancestor up to `root` are visible (a hidden hair style
 * is not her), and an `InstancedMesh` is expanded per instance.
 *
 * Measured in world space, from a fresh `updateWorldMatrix`, so a child seated
 * anywhere in any space can be asked about directly. A model with nothing
 * drawn reads `lowestY = Infinity`, and so a `floor` error of Infinity: a
 * check that measured nobody fails rather than passing.
 *
 * **What `floor` cannot see: one foot.** It is the lowest vertex of the whole
 * child, so a pose that lifts *one* leg leaves the other sole on the floor and
 * reads the same. Measured on a `CharacterModel` posed `'listening'` at y 3.0
 * with a 3.36 seat: as built, floor 3.5 mm, seat 0.0 mm; left leg alone at
 * −0.7, floor still 3.5 mm (passes); both legs at −0.7, floor 44.5 mm (fails).
 * So a red proof of a clause built on this rotates **both** legs. The
 * fairground `'seated'` pose fails here on the hip instead (seat 16.1 mm:
 * its 0.3 rad body lean lowers the hip pivot), floor 0.9 mm.
 */
export function seatedErrors(model: SeatedBody, floorY: number, seatTop: number): SeatedErrors {
  model.root.updateWorldMatrix(true, true);
  const point = new Vector3();
  const instance = new Matrix4();
  const combined = new Matrix4();
  let lowestY = Infinity;

  model.root.traverse((node) => {
    if (!(node instanceof Mesh) || isOutline(node)) return;
    for (let up: Object3D | null = node; up && up !== model.root; up = up.parent) if (!up.visible) return;
    const position = node.geometry.getAttribute('position') as BufferAttribute | undefined;
    if (!position) return;
    const instances = node instanceof InstancedMesh ? node.count : 1;
    for (let n = 0; n < instances; n += 1) {
      if (node instanceof InstancedMesh) {
        node.getMatrixAt(n, instance);
        combined.multiplyMatrices(node.matrixWorld, instance);
      } else {
        combined.copy(node.matrixWorld);
      }
      for (let i = 0; i < position.count; i += 1) {
        const y = point.fromBufferAttribute(position, i).applyMatrix4(combined).y;
        if (y < lowestY) lowestY = y;
      }
    }
  });

  const hipY = model.leftLeg.getWorldPosition(point).y;
  return {
    lowestY,
    hipY,
    floor: Math.abs(lowestY - floorY),
    seat: Math.abs(hipY - seatTop),
  };
}
