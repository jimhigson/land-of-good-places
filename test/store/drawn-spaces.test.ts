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

  /**
   * `showSpace` — a space of several roots whose owners already use `visible`
   * for themselves (the park: fireflies by day, lamp posts behind the keychain
   * view). Hiding the space must take every root out without overwriting what
   * any owner said, and showing it must put back exactly the ones their owners
   * want — and each root stays a child of the scene, so no path changes.
   *
   * Proved red, 14 Nov 2026, on perf/undrawn-indoors (the graphs built below):
   * with `place` ignoring the hidden space (`belongs = entry.wanted ||
   * !this.detaching`), `1 failed | 3 passed` — "expected { Object (isObject3D,
   * uuid, ...) } to be null", the lamps left in the graph; with the getter
   * reading only the owner's word (`get: () => entry.wanted`), `2 failed | 2
   * passed` — "reads what is drawn: expected true to be false" and the headless
   * case's "expected true to be false".
   */
  it('hides a space of several roots whole, and keeps each owner\'s own word', () => {
    const scene = new Scene();
    const spaces = new DrawnSpaces(scene);
    const lamps = new Group();
    const flies = new Group();
    const tree = new Mesh();
    lamps.add(tree);
    flies.visible = false; // its owner: daytime
    spaces.register('garden', lamps, flies);
    spaces.detachUndrawn();
    expect(lamps.parent).toBe(scene);
    expect(flies.parent, 'its owner hid it').toBe(null);

    spaces.showSpace('garden', false); // she walks into a room
    expect(spaces.isShown('garden')).toBe(false);
    expect(lamps.parent).toBe(null);
    expect(lamps.visible, 'reads what is drawn').toBe(false);
    expect(isDrawn(tree)).toBe(false);

    flies.visible = true; // night falls while she is in the room
    expect(flies.parent, 'its owner may say so, but its space is hidden').toBe(null);

    spaces.showSpace('garden', true); // back out
    expect(lamps.parent).toBe(scene);
    expect(flies.parent, 'what its owner said while she was away').toBe(scene);
    expect(isDrawn(tree)).toBe(true);
    expect(spaces.detachedRoots()).toEqual([]);
  });

  it('hides a space without detaching anything while nothing detaches — a headless check sees it hidden', () => {
    const scene = new Scene();
    const spaces = new DrawnSpaces(scene);
    const lamps = new Group();
    const tree = new Mesh();
    lamps.add(tree);
    spaces.register('garden', lamps);
    spaces.showSpace('garden', false);
    expect(lamps.parent, 'one graph, as every Node check has it').toBe(scene);
    expect(isDrawn(tree)).toBe(false);
    spaces.showSpace('garden', true);
    expect(isDrawn(tree)).toBe(true);
  });
});
