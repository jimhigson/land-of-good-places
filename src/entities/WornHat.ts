import type { Group } from 'three';
import { clamp01 } from '../core/mathUtils';
import { disposeTree } from '../art/style/materials';
import type { FrameContext, GameSystem } from '../core/types';
import { gameStore, type GameState } from '../state';
import { shopItem } from '../world/building/shops/catalogue';

/**
 * Whatever hat the player is wearing on their head.
 *
 * Mirrors `WornFlower.ts` on purpose: a store subscriber, not something told
 * directly, so "which hat is worn" is a fact about the save rather than a side
 * effect of a button press. Two things set `wornHatUid`: the character creator
 * (`gameStore.completeCharacterCreation`) picks the starting hat, and tapping a
 * hat in the backpack drawer (`gameStore.setWornHat`) swaps it thereafter.
 * Neither needed a line of this file — it already draws whatever `wornHatUid`
 * names, which is the point of the arrangement.
 *
 * Parented to `hatAnchor` — the crown of the head, see `art/models/kid.ts` —
 * at the model's own natural scale: `art/models/hats.ts`'s own doc comment
 * promises "no offset maths" for exactly this attachment.
 */

/** Seconds the pop-in takes, same beat as `WornFlower`'s and a purchase's. */
const POP_SECONDS = 0.3;

export class WornHat implements GameSystem {
  readonly name = 'wornHat';

  private readonly anchor: Group;
  private readonly unsubscribe: () => void;
  private readonly onWornChange: ((worn: boolean) => void) | null;

  private mesh: Group | null = null;
  private currentUid: string | null = null;
  private currentHeight: number | null = null;
  private pop = 1;
  /** The last value {@link onWornChange} was told. See {@link update}. */
  private notifiedWorn = false;

  /**
   * `anchor` is the character's `hatAnchor`.
   *
   * `onWornChange` is told whenever a hat appears or disappears, so the model
   * can tuck away hair that would spear straight through one — see
   * `art/models/hair.ts`. Optional, because a hat worn on a character with no
   * hair opinions (a display stand, a future NPC) needs no such courtesy.
   */
  constructor(anchor: Group, onWornChange?: (worn: boolean) => void) {
    this.anchor = anchor;
    this.onWornChange = onWornChange ?? null;
    this.unsubscribe = gameStore.subscribe((state) => this.sync(state));
  }

  /**
   * The currently-worn hat's own `height` (`art/models/hats.ts`, measured
   * from `hatAnchor` to the tip) — or `null` bare-headed. The name label adds
   * this to `CharacterModel.hatAnchorHeight` to clear whatever is worn; see
   * `Player`.
   */
  get hatHeight(): number | null {
    return this.currentHeight;
  }

  update({ dt }: FrameContext): void {
    // Deliberately here, and deliberately derived from `this.mesh` rather than
    // fired from inside `sync`: `sync` has several early returns (an item that
    // has gone from the inventory, a catalogue entry that no longer exists),
    // and it is about to be rewritten by the backpack "wear this" route, which
    // will put hats on and take them off far more often than the character
    // creator ever did. A one-boolean-compare-per-frame edge detector cannot
    // be broken by any of that; a notification threaded through five exit
    // paths in somebody else's file certainly can.
    const worn = this.mesh !== null;
    if (worn !== this.notifiedWorn) {
      this.notifiedWorn = worn;
      this.onWornChange?.(worn);
    }

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
    if (state.wornHatUid === this.currentUid) return;
    this.currentUid = state.wornHatUid;
    this.clear();
    if (!state.wornHatUid) return;

    const owned = state.inventory.find((item) => item.uid === state.wornHatUid);
    if (!owned) return;
    const catalogue = shopItem(owned.id);
    if (!catalogue) return;

    const asset = catalogue.model();
    this.pop = 0;
    asset.root.scale.setScalar(0.001);
    this.anchor.add(asset.root);
    this.mesh = asset.root;
    this.currentHeight = asset.height;
  }

  private clear(): void {
    this.currentHeight = null;
    if (!this.mesh) return;
    this.anchor.remove(this.mesh);
    disposeTree(this.mesh);
    this.mesh = null;
  }
}
