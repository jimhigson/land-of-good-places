import { describe, expect, it } from 'vitest';
import { Group, Mesh, Scene } from 'three';
import { DrawnSpaces } from '../../src/world/DrawnSpaces';
import { isDrawn } from '../../src/core/drawn';

/**
 * `DrawnSpaces` (120 fps plan, step 2): a registered root's `visible` is its
 * membership of the scene graph. Everything here is counted off a real
 * three.js graph — the thing the renderer walks — not off the class's own
 * bookkeeping.
 */
function build(): { scene: Scene; spaces: DrawnSpaces; room: Group; chair: Mesh } {
  const scene = new Scene();
  const spaces = new DrawnSpaces(scene);
  const room = new Group();
  room.name = 'a-room';
  room.position.set(600, 0, 600);
  room.visible = false;
  const chair = new Mesh();
  chair.position.set(1, 0, 2);
  room.add(chair);
  spaces.register('room', room);
  return { scene, spaces, room, chair };
}

const reachable = (scene: Scene): number => {
  let n = 0;
  scene.traverse(() => (n += 1));
  return n;
};

describe('DrawnSpaces', () => {
  it('keeps one graph until detaching is switched on — what every headless check measures', () => {
    const { scene, spaces, room, chair } = build();
    expect(room.parent).toBe(scene);
    expect(reachable(scene)).toBe(3);
    expect(isDrawn(chair), 'hidden is still not drawn').toBe(false);
    expect(spaces.detachedRoots()).toEqual([]);
    // And the matrices are real from registration, not the identity of a never-rendered object.
    expect(chair.matrixWorld.elements[12]).toBe(601);
  });

  it('takes an undrawn space out of the graph, and puts it back with current matrices in the same call', () => {
    const { scene, spaces, room, chair } = build();
    spaces.detachUndrawn();
    expect(reachable(scene), 'only the scene itself is left to walk').toBe(1);
    expect(room.parent).toBe(null);
    expect(room.visible).toBe(false);
    expect(spaces.detachedRoots()).toEqual([room]);

    // Something moves while nobody can see it; the owner then says "drawn".
    chair.position.x = 5;
    room.visible = true;
    expect(room.parent).toBe(scene);
    expect(reachable(scene)).toBe(3);
    expect(isDrawn(chair)).toBe(true);
    expect(chair.matrixWorld.elements[12], 'matrices must be current before the iris opens').toBe(605);

    room.visible = false;
    expect(reachable(scene)).toBe(1);
    expect(isDrawn(chair)).toBe(false);
    expect(spaces.census()).toEqual([
      { space: 'room', name: 'a-room', uuid: room.uuid, drawn: false, attached: false, objects: 2 },
    ]);
  });
});
