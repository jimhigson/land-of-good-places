import type { InstancedMesh, Object3D } from 'three';

/**
 * The highlight registry — the data half of GAME_DESIGN.md's HIGHLIGHT RULE:
 * *everything you can interact with is outlined in a rainbow when it is about
 * to be used*.
 *
 * The rule is absolute, so the machinery is built to make forgetting it
 * impossible rather than merely easy to remember:
 *
 *  - **Every registered interactable is highlighted whether or not it says how.**
 *    An {@link InteractZone} already knows where it is (`x/y/z`) and how big it
 *    is (`pickRadius`), and that is enough to draw a rainbow ring on the ground
 *    around it. So a zone that supplies nothing still lights up, and anything
 *    added to the park later inherits the rule for free.
 *  - **Supplying a target upgrades the ring to a real outline.** A zone that
 *    hands over the `Object3D` it stands for gets an inverted-hull rainbow shell
 *    hugging its actual silhouette — the same technique as the ink outlines in
 *    ART_DIRECTION, in rainbow, animated.
 *
 * That is the whole surface. One optional field on the zone; see
 * `world/Highlights.ts` for what draws it.
 *
 * ### Instancing
 *
 * The crowd, the trees and the flowers are `InstancedMesh`es, where "the thing"
 * is one instance rather than one object. {@link highlightInstance} names that
 * case explicitly, and the renderer shares a single shell geometry across every
 * instance of a mesh — highlighting flower #212 costs no more than highlighting
 * a stall.
 *
 * ### What it must never do
 *
 * Never scale anything to produce an outline. `root.scale` is reserved for
 * gameplay squash-and-stretch and `body.scale` is written every frame by
 * `applyWalk` (ASSET_MANIFEST.md's asset contract), so the shell is a separate
 * mesh carrying a *copy* of the target's world matrix — it never touches, adds
 * to, or reparents anything the animators own.
 */
export interface HighlightTarget {
  /** The mesh or group the rainbow should hug. */
  readonly object: Object3D;
  /** Set only for an `InstancedMesh`: which instance is "the thing". */
  readonly instanceId?: number;
}

/** Highlights a mesh or a whole group — the common case. */
export function highlightObject(object: Object3D): HighlightTarget {
  return { object };
}

/**
 * Highlights one instance of an `InstancedMesh` (a flower, a tree, a child in
 * the crowd). The instance's own matrix is read fresh every frame, so a target
 * that grows, sways or walks keeps its outline on it.
 */
export function highlightInstance(mesh: InstancedMesh, instanceId: number): HighlightTarget {
  return { object: mesh, instanceId };
}

/** A stable cache key for a target — one shell geometry per object, shared by every instance. */
export function highlightKey(target: HighlightTarget): string {
  return target.object.uuid;
}
