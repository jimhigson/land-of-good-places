/**
 * **The control on `check:coplanar`'s instrument.**
 *
 * `CLAUDE.md`: *"a check that never runs is worse than a check that fails"*,
 * and *"green can mean incapable of failing"*. The coplanar sweep is a
 * geometry instrument reporting a number nobody can eyeball, on a park with
 * 1.8 million triangles in it — exactly the shape of tool that has been wrong
 * and confident five times on this project in a week. So before it is believed
 * about the game, it is asked about eight scenes whose right answer is known
 * by construction.
 *
 * Each case is one thing the sweep claims to do, and half of them are cases it
 * must **not** report — a detector that says yes to everything is as useless as
 * one that says no. In particular:
 *
 * - **Tiles meeting at an edge are how every floor in this game is built.** A
 *   proximity test would call each of them a defect; only an *area* overlap
 *   distinguishes a floor from a fault.
 * - **Two faces in one plane pointing away from the camera never fight**,
 *   because back-face culling draws one of them. Dropping those is what keeps
 *   the real list readable, and it has to be shown actually dropping them.
 * - **A box standing on a floor is not a coplanar pair.** Its bottom face and
 *   the floor are in one plane and *do* overlap — but they point in opposite
 *   directions, so this is the same rule again, in the shape the game meets
 *   it in most often.
 * - **The tolerance decides the count** (#472: 31 pairs at 1 cm, 19 at
 *   0.1 mm), so a 5 mm stand-off must appear at one tolerance and vanish at
 *   the other. If it appeared at both, the two figures the gate reports would
 *   be one figure printed twice.
 * - **600 m from the origin the answer must not change.** The hotel is out
 *   there and the castle's floors are 300 m apart; a 32-bit float resolves
 *   about 6/100 mm at that distance, which is coarser than the tight tolerance
 *   itself. This case is what fails if anyone ever "optimises" the sweep's
 *   `Float64Array`s down to `Float32Array`, and it would fail *silently* in
 *   exactly the spaces the last two of these bugs were found in.
 *
 * The last case is the defect from #467 itself, in miniature: a floor plate's
 * edge sitting flush inside the wall that rises from it.
 */
import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry, Scene } from 'three';
import { DEFAULT_TOLERANCES, sweepCoplanar } from '../../scripts/coplanar-sweep.mts';

/** A scene holding `build`'s meshes, ready to sweep. */
function scene(name: string, build: (group: Group) => void): Scene {
  const root = new Scene();
  const group = new Group();
  group.name = name;
  build(group);
  root.add(group);
  return root;
}

/** A 2 x 2 m plate lying flat, face up, at `y`. */
function slab(name: string, y = 0): Mesh {
  const mesh = new Mesh(new PlaneGeometry(2, 2), new MeshStandardMaterial());
  mesh.name = name;
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  return mesh;
}

const sweep = (root: Scene) => sweepCoplanar(root, DEFAULT_TOLERANCES).pairs;

describe('the coplanar sweep, on scenes whose answer is known', () => {
  it('says nothing about two tiles meeting at an edge', () => {
    const root = scene('clean', (group) => {
      for (const x of [-1, 1]) {
        const tile = slab(`tile${x}`);
        tile.position.x = x;
        group.add(tile);
      }
    });
    expect(sweep(root)).toHaveLength(0);
  });

  it('finds two faces sharing a plane, and measures the whole overlap', () => {
    const root = scene('fighting', (group) => group.add(slab('a'), slab('b')));
    const pairs = sweep(root);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.area).toBeCloseTo(4, 6);
    expect(pairs[0]?.separation).toBe(0);
  });

  it('ignores a coplanar pair that faces away from the one camera', () => {
    const root = scene('away', (group) => {
      for (const name of ['a', 'b']) {
        const tile = slab(name);
        tile.rotation.x = Math.PI / 2;
        group.add(tile);
      }
    });
    expect(sweep(root)).toHaveLength(0);
  });

  it('ignores a back-to-back pair, which culling resolves for free', () => {
    const root = scene('back-to-back', (group) => {
      const down = slab('down');
      down.rotation.x = Math.PI / 2;
      group.add(slab('up'), down);
    });
    expect(sweep(root)).toHaveLength(0);
  });

  it('ignores a box standing on a floor', () => {
    const root = scene('box-on-floor', (group) => {
      const floor = new Mesh(new PlaneGeometry(10, 10), new MeshStandardMaterial());
      floor.name = 'floor';
      floor.rotation.x = -Math.PI / 2;
      const box = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
      box.name = 'box';
      box.position.y = 0.5;
      group.add(floor, box);
    });
    expect(sweep(root)).toHaveLength(0);
  });

  it('reports a 5 mm stand-off at 1 cm and drops it at 0.1 mm', () => {
    const root = scene('stand-off', (group) => group.add(slab('a'), slab('b', 0.005)));
    const near = sweepCoplanar(root, DEFAULT_TOLERANCES).pairs;
    expect(near).toHaveLength(1);
    expect(near[0]?.separation).toBeCloseTo(0.005, 6);
    const tight = sweepCoplanar(root, { fighting: 1e-4, near: 1e-4 }).pairs;
    expect(tight).toHaveLength(0);
  });

  it('resolves a fifth of a millimetre 600 m from the origin', () => {
    const root = scene('far', (group) => {
      group.position.set(-600, 0, 1375);
      group.add(slab('a'), slab('b', 0.0002));
    });
    const pairs = sweep(root);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.separation).toBeCloseTo(0.0002, 8);
  });

  it("finds #467's own shape: a floor edge flush inside its wall", () => {
    const root = scene('flush', (group) => {
      const wall = new Mesh(new PlaneGeometry(10, 4), new MeshStandardMaterial());
      wall.name = 'wall';
      wall.position.set(0, 2, 0);
      const edge = new Mesh(new PlaneGeometry(3, 3), new MeshStandardMaterial());
      edge.name = 'floor-edge';
      edge.position.set(0, 1.5, 0);
      group.add(wall, edge);
    });
    const pairs = sweep(root);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.area).toBeCloseTo(9, 6);
  });
});
