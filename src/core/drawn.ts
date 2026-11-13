import type { Object3D, Scene } from 'three';

/**
 * **Will the next render draw this?** — the question every "don't animate
 * what nobody can see" gate asks (120 fps plan, step 3).
 *
 * Answered by the one owner there is: three.js's own rule. The renderer walks
 * the scene from the top and skips any subtree whose root is not `visible`,
 * so an object is drawn exactly when it and every ancestor are visible **and**
 * the chain reaches a `Scene`. Nothing here keeps a second record of which
 * space she is in — a flag set on the way into a room has as many ways to go
 * wrong as there are ways out of it — it reads the graph the renderer reads.
 *
 * The `Scene` clause is not decoration: an interior detached from the graph
 * while she is elsewhere (the plan's step 2) is not drawn either, and a test
 * that merely walked up to a parentless root and found everything visible
 * would call it drawn.
 *
 * Says nothing about the frustum: an object behind the camera is still
 * "drawn" here. That is deliberate — this gates whole spaces, which are either
 * on or off, and a frustum test belongs to the renderer (plan step 4).
 *
 * Cost: a walk up the parents, a handful of hops, once per gated system per
 * frame.
 */
export function isDrawn(object: Object3D): boolean {
  for (let node: Object3D | null = object; node; node = node.parent) {
    if (!node.visible) return false;
    if ((node as Scene).isScene) return true;
  }
  return false;
}
