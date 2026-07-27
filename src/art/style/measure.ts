import { InstancedMesh, Matrix4, Mesh, Vector3, type BufferAttribute, type Object3D } from 'three';

/** The lowest and highest visible points of a model, in metres about its origin. */
export interface VisibleBounds {
  /** Distance from the origin to the lowest visible vertex. Negative if below. */
  readonly bottom: number;
  /** Distance from the origin to the highest visible vertex. */
  readonly top: number;
}

/**
 * The vertical extent of everything visible in `root`, measured in its own
 * space — so `top` is the model's real height and `bottom` says whether its
 * origin is where the asset contract promises (ARCHITECTURE.md: 1 unit = 1 m,
 * origin at the feet).
 *
 * Measured rather than tabulated, because a written-down height is a claim and
 * a measured one is a fact. Three separate bugs came from trusting the claim;
 * the worst had every pet scaled from a "natural height" that stopped at the
 * top of the skull, leaving a bunny 2.12 m tall for weeks.
 *
 * Only *visible* meshes count, and only if every ancestor is visible too: the
 * crowd's prototype carries every hairstyle at once, and measuring the hidden
 * ones would report the spikes' height for a child in a bowl cut.
 *
 * **Vertices, not bounding boxes.** The obvious implementation — transform each
 * geometry's `boundingBox` by its world matrix — takes the axis-aligned box of
 * an axis-aligned box, and every rotation in the chain inflates it. On the kid,
 * whose hair sits inside a crown tipped back ten degrees, that reported 2.26 m
 * for a character who is actually 2.11 m: a name label floating a hand's width
 * above her head. Walking the position attribute is exact, and this runs at
 * construction or in a check script, never per frame.
 *
 * `InstancedMesh` is expanded per instance. A pet's ears are one instanced mesh
 * of two mirrored copies, and the copies live in `instanceMatrix`, not in the
 * geometry — walk the geometry alone and a bunny loses its ears, which is the
 * precise shape of the bug this exists to catch.
 */
export function visibleBounds(root: Object3D): VisibleBounds {
  root.updateMatrixWorld(true);
  const point = new Vector3();
  const instance = new Matrix4();
  const combined = new Matrix4();
  let bottom = Number.POSITIVE_INFINITY;
  let top = Number.NEGATIVE_INFINITY;

  const parentInverse = new Matrix4().copy(root.matrixWorld).invert();

  root.traverse((object) => {
    if (!(object instanceof Mesh) || !object.visible) return;
    for (let node = object.parent; node; node = node.parent) {
      if (!node.visible) return;
    }
    const position = object.geometry.getAttribute('position');
    if (!position) return;

    const instances = object instanceof InstancedMesh ? object.count : 1;
    for (let n = 0; n < instances; n += 1) {
      if (object instanceof InstancedMesh) {
        object.getMatrixAt(n, instance);
        combined.multiplyMatrices(object.matrixWorld, instance);
      } else {
        combined.copy(object.matrixWorld);
      }
      // Back into the root's own space, so a model measured while parented to
      // a moving ride reports the same numbers as one measured on the bench.
      combined.premultiply(parentInverse);
      for (let i = 0; i < position.count; i += 1) {
        point.fromBufferAttribute(position as BufferAttribute, i).applyMatrix4(combined);
        if (point.y < bottom) bottom = point.y;
        if (point.y > top) top = point.y;
      }
    }
  });

  if (top === Number.NEGATIVE_INFINITY) return { bottom: 0, top: 0 };
  return { bottom, top };
}

/**
 * The tallest visible point of a model, in metres above its origin — never
 * negative, so a name label placed from it always sits above the ground.
 *
 * See {@link visibleBounds} for how it is measured and why.
 */
export function visibleTop(root: Object3D): number {
  const { top } = visibleBounds(root);
  return top > 0 ? top : 0;
}
