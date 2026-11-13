import type { Object3D } from 'three';
import { isDrawn } from '../core/drawn';

/**
 * **Which spaces are drawn — the one owner** (120 fps plan, steps 2 and 3).
 *
 * The game is several places that are never seen together: the park, the
 * castle's decks, the hotel, the library, the Reptile House. Each used to stay
 * in the scene graph for the whole session with `visible = false` on its root,
 * and three.js recurses into an invisible subtree to update its matrices
 * anyway: measured in the park, 6,411 of 8,943 scene objects were hidden
 * interiors and `scene.updateMatrixWorld` was 2.0 ms of every frame.
 *
 * ## The rule, and why there is no second definition
 *
 * Every space already says whether it is drawn, in exactly one way: its owner
 * writes `visible` on its root (`Building.interiorRoot`, `Hotel.hotelRoot`,
 * `Library.roomRoot`, `ReptileHouse.hallRoot` …), behind the closed iris, at
 * every way in and every way out. That statement is kept and nothing is added
 * beside it. A root handed to {@link register} has its `visible` turned into
 * **membership of the graph**: written `false` it is removed from the scene,
 * written `true` it is added back with its matrices brought up to date in the
 * same call. There is no list of "current spaces" to fall out of step with
 * the roots — the write that used to hide a space is the write that detaches
 * it, so every door, lift, deep link, restored save and ride that was right
 * about `visible` is right about this without knowing it exists.
 *
 * The read side is {@link isDrawn} (`core/drawn.ts`): visible all the way up
 * to a `Scene`. A detached root has no parent, so it and everything under it
 * answer "not drawn", and that is what gates a simulation (`Building.update`'s
 * banquet and roof garden). Ask that; never keep a flag.
 *
 * ## Attach is immediate, so nothing is ever seen empty
 *
 * `visible = true` attaches and runs one `updateMatrixWorld(true)` before it
 * returns. A space change runs inside `SpaceManager.changeTo`'s midpoint with
 * the iris shut, and the camera snap, label placement and any raycast that
 * follow in the same call see a root that is in the graph with current
 * matrices — not one that will be attached "next frame".
 *
 * ## What must not depend on a root being attached
 *
 * Colliders, the NavGrid, interact zones, audio and saves are built from
 * numbers, not from the graph, and none is touched here. `getWorldPosition`
 * walks up the parents itself and is right on a detached root (the root keeps
 * its own position; the scene above it is at identity). A bare read of
 * `matrixWorld` under a detached root reads what it was when the root was
 * last attached — and {@link register} computes it once at registration, so
 * it is never the identity a never-rendered object would have.
 *
 * ## Detaching is switched on by the live game, not by construction
 *
 * {@link detachUndrawn} is called once, by `Game`. A headless `World` built by
 * a check (`scripts/park-harness.mts`) never calls it, so every root stays in
 * the one graph and the Node checks that walk `scene` to find an interior —
 * the park digest, `check:hotel`, `check:castle`, the coplanar sweep — measure
 * what they always measured. The *rule* is the same in both: `visible` is the
 * statement, `isDrawn` is the question.
 */
export class DrawnSpaces {
  private readonly scene: Object3D;
  private readonly entries: SpaceRoot[] = [];
  private detaching = false;

  constructor(scene: Object3D) {
    this.scene = scene;
  }

  /**
   * Puts `roots` in the scene — this replaces the `scene.add` — as belonging
   * to `space`, and from here on their `visible` is their membership.
   *
   * `space` is a label for the guard's report (`check:drawn-spaces`) and for
   * {@link census}; nothing branches on it.
   */
  register(space: string, ...roots: Object3D[]): void {
    for (const root of roots) {
      if (this.entries.some((entry) => entry.root === root)) continue;
      const entry: SpaceRoot = { space, root, wanted: root.visible };
      this.entries.push(entry);
      this.scene.add(root);
      // Once, so nothing under a root that starts undrawn (they all do) ever
      // reads an identity `matrixWorld` — today the first render computed it.
      root.updateMatrixWorld(true);
      // `visible` is an own data property on every `Object3D`; replacing it
      // with an accessor on this one instance is what makes the owner's
      // existing writes the mechanism, rather than a call somebody has to
      // remember to make beside each of them.
      Object.defineProperty(root, 'visible', {
        configurable: true,
        enumerable: true,
        get: () => entry.wanted,
        set: (value: boolean) => {
          entry.wanted = value;
          this.place(entry);
        },
      });
      this.place(entry);
    }
  }

  /**
   * From now on an undrawn root is out of the graph. Called once by `Game`;
   * see the class note for why a headless `World` does not.
   */
  detachUndrawn(): void {
    this.detaching = true;
    for (const entry of this.entries) this.place(entry);
  }

  /** Whether undrawn roots are being taken out of the graph. */
  get isDetaching(): boolean {
    return this.detaching;
  }

  /**
   * Every registered root that is out of the graph right now.
   *
   * For the callers that have to reach a space nobody is in: the shader
   * warm-up (`boot/shaderWarmup.ts`), which compiles every root behind the
   * bus and can no longer find these by walking the scene.
   */
  detachedRoots(): Object3D[] {
    return this.entries.filter((entry) => entry.root.parent !== this.scene).map((entry) => entry.root);
  }

  /**
   * One row per registered root: is it drawn, is it in the graph, and how many
   * objects hang under it. The guard reads this and then counts the scene
   * itself, so a root this reports as detached is checked against the graph
   * the renderer walks rather than against this class's opinion of it.
   */
  census(): SpaceCensusRow[] {
    return this.entries.map((entry) => {
      let objects = 0;
      entry.root.traverse(() => {
        objects += 1;
      });
      return {
        space: entry.space,
        name: entry.root.name,
        uuid: entry.root.uuid,
        drawn: isDrawn(entry.root),
        attached: entry.root.parent === this.scene,
        objects,
      };
    });
  }

  private place(entry: SpaceRoot): void {
    const { root } = entry;
    const belongs = entry.wanted || !this.detaching;
    if (belongs) {
      if (root.parent === this.scene) return;
      this.scene.add(root);
      // Before anything else in the same call reads it: the camera snap and
      // the labels of a space change run straight after the write that got us
      // here, with the iris still shut.
      root.updateMatrixWorld(true);
    } else if (root.parent === this.scene) {
      this.scene.remove(root);
    }
  }
}

interface SpaceRoot {
  readonly space: string;
  readonly root: Object3D;
  /** What the space's owner last wrote to `visible`. */
  wanted: boolean;
}

/** A row of {@link DrawnSpaces.census}. */
export interface SpaceCensusRow {
  readonly space: string;
  readonly name: string;
  readonly uuid: string;
  readonly drawn: boolean;
  readonly attached: boolean;
  readonly objects: number;
}
