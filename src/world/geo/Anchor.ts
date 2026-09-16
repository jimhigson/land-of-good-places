import { Object3D } from 'three';
import type { Frame } from './Frame';

/**
 * **The one and only translation from the sphere to Cartesian, and it happens
 * at scene-graph attachment — not at the render.**
 *
 * Jim asked for the translation to orthogonal coordinates to be "the last
 * step". This is the sharp version of that, and it is more useful than "at the
 * render" because it puts the boundary somewhere a check can stand.
 *
 * **Rule: nothing is ever added to a scene root with a computed world position.
 * Everything hangs off an `Anchor`.**
 *
 * ## Why this line, and why it retires ~90 defects as a class
 *
 * Because three.js's matrix composition *below* an Anchor is already exactly
 * correct tangent-space arithmetic. A model authored flat — with its own local
 * offsets, its own `rotation.x = -PI/2` discs, its own child hierarchy — is
 * **correct without modification** once its parent carries the geodesic frame.
 *
 * That is not a theory. It is the observed difference between the two clearest
 * cases in `RADIAL-INVENTORY.md`:
 *
 * - `LampPosts.ts` does `glowGeometry.rotateX(-Math.PI / 2)` — a flat disc in
 *   the XZ plane — and is **correct**, because every instance goes through
 *   `instanceAt`, which leans it per lamp.
 * - `art/models/tapMarker.ts` does the identical thing and is **wrong**,
 *   because its root goes straight to the scene and callers only ever set
 *   `position`.
 *
 * Same code, opposite outcomes, and the only difference is whether something
 * leaned it downstream. The Anchor makes "something leaned it downstream"
 * universal and mandatory.
 *
 * ## Safe every frame
 *
 * {@link setFrame} writes the quaternion outright rather than pre-multiplying a
 * tilt onto what was there. That distinction is worth the sentence: a per-frame
 * pre-multiply compounds its own tilt until the thing tumbles — measured on the
 * player at the park's boundary, 10.5° of lean and then `(1.11, 3.14)` a second
 * later. **A per-frame tilt is never a pre-multiply.**
 */
export class Anchor extends Object3D {
  constructor(frame?: Readonly<Frame>) {
    super();
    if (frame) this.setFrame(frame);
  }

  /**
   * Put this anchor where the frame is, facing the way the frame faces.
   *
   * Safe to call every frame: it assigns rather than composes, so nothing
   * accumulates. Children keep their own local transforms untouched, which is
   * the point — they were authored flat and they stay authored flat.
   */
  setFrame(frame: Readonly<Frame>): this {
    frame.at.toWorld(this.position);
    this.quaternion.copy(frame.q);
    return this;
  }
}
