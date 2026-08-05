import { CylinderGeometry, Group, Mesh, SphereGeometry } from 'three';
import { clamp01 } from '../core/mathUtils';
import { PALETTE } from '../core/palette';
import { addOutline, disposeTree, solid, toonMaterial } from '../art/style/materials';
import type { FrameContext, GameSystem } from '../core/types';
import { FLOWER_HEX, gameStore, type FlowerColour, type GameState } from '../state';

/**
 * Whatever flower the player is wearing in their hair.
 *
 * Mirrors `CarriedItem.ts` on purpose: a store subscriber, not something the
 * flower system tells directly, so "which flower is worn" is a fact about the
 * save rather than a side effect of a button press. The wearing rule itself
 * is simple and lives in `gameStore.collectFlower` — picking a flower wears
 * it immediately, and the most recently picked one always wins. A future
 * Cute-o-dex toggle only has to call `gameStore.setWornFlower(uid)`; this
 * class does not need to change.
 *
 * Parented to `hairAnchor`, not `hatAnchor` — see `art/models/kid.ts` — so a
 * hat and a hair flower show up together instead of one replacing the other.
 */

/** Seconds the pop-in takes, same beat as `CarriedItem`'s purchase pop. */
const POP_SECONDS = 0.3;

export class WornFlower implements GameSystem {
  readonly name = 'wornFlower';

  /** Read live, not captured once — see {@link rebind}, `WornHat`'s own doc
   *  comment on the identical field explains why. */
  private readonly anchor: () => Group;
  private readonly unsubscribe: () => void;

  private mesh: Group | null = null;
  private currentUid: string | null = null;
  private pop = 1;

  /** `anchor` resolves to the character's current `hairAnchor`. */
  constructor(anchor: () => Group) {
    this.anchor = anchor;
    this.unsubscribe = gameStore.subscribe((state) => this.sync(state));
  }

  /** The player's model was just rebuilt — see `WornHat.rebind`'s doc comment. */
  rebind(): void {
    this.clear();
    this.currentUid = null;
    this.sync(gameStore.get());
  }

  update({ dt }: FrameContext): void {
    if (!this.mesh || this.pop >= 1) return;
    this.pop = clamp01(this.pop + dt / POP_SECONDS);
    // Same overshoot-then-settle pop every purchase and pick uses.
    const eased = 1 + Math.sin(this.pop * Math.PI) * 0.35;
    this.mesh.scale.setScalar(eased * this.pop);
  }

  dispose(): void {
    this.unsubscribe();
    this.clear();
  }

  // -------------------------------------------------------------- internals

  private sync(state: GameState): void {
    if (state.wornFlowerUid === this.currentUid) return;
    this.currentUid = state.wornFlowerUid;
    this.clear();
    if (!state.wornFlowerUid) return;

    const owned = state.inventory.find((item) => item.uid === state.wornFlowerUid);
    if (!owned || !owned.flowerColour) return;

    const mesh = buildHairFlower(owned.flowerColour);
    this.pop = 0;
    mesh.scale.setScalar(0.001);
    this.anchor().add(mesh);
    this.mesh = mesh;
  }

  private clear(): void {
    if (!this.mesh) return;
    this.anchor().remove(this.mesh);
    disposeTree(this.mesh);
    this.mesh = null;
  }
}

/** A tiny stem-and-bloom, small enough to tuck into a hairline. */
function buildHairFlower(colour: FlowerColour): Group {
  const root = new Group();
  root.name = `hairFlower.${colour}`;

  const stem = solid(
    new Mesh(new CylinderGeometry(0.012, 0.017, 0.09, 6), toonMaterial(PALETTE.leafDeep)),
  );
  stem.position.y = -0.045;
  root.add(stem);

  const head = solid(new Mesh(new SphereGeometry(0.078, 12, 9), toonMaterial(FLOWER_HEX[colour])));
  head.scale.set(1, 0.55, 1);
  head.position.y = 0.018;
  root.add(head);
  addOutline(head, 0.008);

  return root;
}
