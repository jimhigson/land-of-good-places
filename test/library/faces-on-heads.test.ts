import { describe, expect, it } from 'vitest';
import { Mesh, Raycaster, Vector3, type Object3D } from 'three';

// Painting a face needs a canvas, which Node does not have.
const HEADLESS_CANVAS = '../../scripts/headless-canvas.mjs';
await import(/* @vite-ignore */ HEADLESS_CANVAS);
const { createTortoise } = await import('../../src/art/models/reptiles.ts');
const { createPuffCreature } = await import('../../src/art/models/pets.ts');

/**
 * **A face is seen from in front** (the chapter books' review, Oct 2026).
 *
 * Two park models wore their faces where nobody could see them, and the
 * chapter books' pictures — which draw both — showed it on page after page:
 * Grandpa Tock's eyes sat 0.077 m inside his head (*The Giant Footprints*
 * p6–p8, and the Reptile House's tortoise), and Trilla's face patch sat 5.6 mm
 * inside her squashed ball with her tummy over the lower half of it (*The
 * Loudest Shush*, *Catch That Chicken!*, and every puff pet in the park).
 *
 * Both are asked the same way: a ray from far in front, straight back, at
 * each face point — the first thing it meets must be the face, not the head.
 * Proved red on the code before the fix (tortoise: 8 of 10 hidden; puff: the
 * ball or the tummy first at every point).
 */

const ray = new Raycaster();
const BACK = new Vector3(0, 0, -1);

function firstHit(root: Object3D, at: Vector3): Object3D | undefined {
  const meshes: Mesh[] = [];
  root.traverse((object) => {
    // The ink outlines are back-faced hulls: a ray from in front sees through them.
    if (object instanceof Mesh && object.visible && !Array.isArray(object.material) && object.material.side !== 1) meshes.push(object);
  });
  ray.set(at.clone().add(new Vector3(0, 0, 5)), BACK);
  return ray.intersectObjects(meshes, false)[0]?.object;
}

describe('faces on their heads', () => {
  it("Grandpa Tock's every face part is the first thing seen from in front", () => {
    const tortoise = createTortoise(0x70c4);
    tortoise.root.updateMatrixWorld(true);
    const head = tortoise.root.getObjectByName('rr-tortoise-head') as Mesh;
    const face = head.children.find((child) => child.type === 'Group');
    expect(face, 'the tortoise has a face group on its head').toBeDefined();
    const parts = face!.children.filter((child): child is Mesh => child instanceof Mesh);
    expect(parts.length).toBe(10);
    const hidden: string[] = [];
    for (const [index, part] of parts.entries()) {
      const centre = part.getWorldPosition(new Vector3());
      const hit = firstHit(tortoise.root, centre);
      // The w-mouth's arcs are rings a centre ray passes through: the head is
      // then hit, and the arc must be in front of where it was.
      if (hit === part) continue;
      if (hit === head && index >= 8) {
        ray.set(centre.clone().add(new Vector3(0, 0, 5)), BACK);
        const surface = ray.intersectObject(head, false)[0]?.point.z ?? Infinity;
        if (surface <= centre.z) continue;
      }
      hidden.push(`part ${index} at z ${centre.z.toFixed(3)} (first hit ${hit?.name || hit?.type})`);
    }
    expect(hidden, `of ${parts.length} face parts, hidden`).toEqual([]);
  });

  it("Trilla's face patch is in front of her ball and her tummy across the face", () => {
    const puff = createPuffCreature({ variant: 'pet', seed: 1 });
    puff.root.updateMatrixWorld(true);
    let patch: Mesh | undefined;
    puff.root.traverse((object) => {
      if (object.name === 'facePatch' && object instanceof Mesh) patch = object;
    });
    expect(patch, 'the puff wears a face patch').toBeDefined();
    const head = patch!.parent!;
    // The face's span on the ball, in the head's frame: the eye row and the
    // middle, either side — where the painted eyes and mouth are.
    const R = 0.2;
    const points: [number, number][] = [
      [0, 0],
      [-0.2 * R, 0.1 * R],
      [0.2 * R, 0.1 * R],
      [-0.25 * R, 0.25 * R],
      [0.25 * R, 0.25 * R],
      [0, -0.1 * R],
    ];
    const misses: string[] = [];
    for (const [x, y] of points) {
      const at = head.localToWorld(new Vector3(x, y, 0));
      const hit = firstHit(puff.root, at);
      if (hit !== patch) misses.push(`(${(x / R).toFixed(2)}R, ${(y / R).toFixed(2)}R): first hit ${hit?.name || 'unnamed mesh'}`);
    }
    expect(misses, `of ${points.length} face points, not the face`).toEqual([]);
  });
});
