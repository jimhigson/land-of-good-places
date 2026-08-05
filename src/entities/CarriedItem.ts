import type { Group } from 'three';
import { clamp01 } from '../core/mathUtils';
import { disposeTree } from '../art/style/materials';
import type { AssetHandle } from '../art/style/asset';
import { shopItem } from '../world/building/shops/catalogue';
import { gameStore, type GameState } from '../state';

/**
 * Whatever the player is holding.
 *
 * The rule the game plays by: **the most recent carryable purchase is in your
 * hands**, one at a time, and the backpack drawer can swap it for any other
 * thing you own. It is the whole of "purchases are visible immediately" until
 * the parade arrives in build step 5.
 *
 * It is a store subscriber, not something the shop tells directly. That means a
 * held item is a *fact about the save*, not a side effect of a button press:
 * whoever changes `carriedUid` — a shop, the drawer, later the Cute-o-dex or a
 * ride that makes you put your ice cream down — gets the same behaviour.
 *
 * Models come from the shop catalogue at their `heldScale`, so the toy in your
 * hand is the same asset as the toy on the shelf.
 *
 * **Balloons opt out.** A freshly-bought balloon is `carryable`, so it still
 * becomes `carriedUid` same as any other purchase — but held forward at arm's
 * length, tipped like a toy, is wrong for something on a string: a balloon is
 * *held*, floating above the player on a bending string, whether or not it
 * happens to be the newest purchase. `entities/HeldBalloon.ts` owns every
 * balloon the player has not stowed unconditionally, so this class simply
 * declines to also render whichever one is `carriedUid`; without that carve-out
 * the same balloon would be drawn twice, once at each system's idea of where
 * it belongs.
 */

/** Seconds the pop-in takes. Long enough to notice, short enough not to wait. */
const POP_SECONDS = 0.3;

export class CarriedItem {
  /** Read live, not captured once — see {@link rebind} and `WornHat`'s own
   *  doc comment on the identical field. */
  private readonly anchor: () => Group;
  private readonly unsubscribe: () => void;

  private handle: AssetHandle | null = null;
  private currentUid: string | null = null;
  private scale = 1;
  private pop = 1;
  /** See {@link setVisible} — kept here so a swap mid-munch stays hidden too. */
  private visible = true;

  /** `anchor` resolves to the character's current `holdAnchor` — the right hand. */
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

  /** The catalogue id in the player's hands, or null. */
  get itemId(): string | null {
    return this.handle?.root.name ?? null;
  }

  /**
   * Hides whatever is in the hand without letting go of it.
   *
   * There is one hand and it can only hold one thing at a time, but *two*
   * systems parent models to `holdAnchor`: this one, and
   * `entities/EatenTreat.ts` while a treat is being eaten. Without this a
   * child holding her teddy who then eats an ice cream would hold both, in the
   * same fist, overlapping. Deliberately a visibility flag rather than
   * `setCarried(null)`: what she is carrying has not changed, and she should
   * still be holding it when the ice cream is finished.
   */
  setVisible(visible: boolean): void {
    this.visible = visible;
    if (this.handle) this.handle.root.visible = visible;
  }

  update(dt: number, elapsed: number): void {
    const handle = this.handle;
    if (!handle) return;

    if (this.pop < 1) {
      this.pop = clamp01(this.pop + dt / POP_SECONDS);
      // Overshoot then settle: the same squash-and-stretch the buttons use.
      const eased = 1 + Math.sin(this.pop * Math.PI) * 0.35;
      handle.root.scale.setScalar(this.scale * eased * this.pop);
    }

    handle.update?.(dt, elapsed);
  }

  dispose(): void {
    this.unsubscribe();
    this.clear();
  }

  // -------------------------------------------------------------- internals

  private sync(state: GameState): void {
    if (state.carriedUid === this.currentUid) return;
    this.currentUid = state.carriedUid;
    this.clear();
    if (!state.carriedUid) return;

    const owned = state.inventory.find((entry) => entry.uid === state.carriedUid);
    if (!owned) return;
    // Balloons are `HeldBalloon.ts`'s job entirely — see the class doc comment.
    if (owned.kind === 'balloon') return;
    const item = shopItem(owned.id);
    if (!item) return;

    const handle = item.model();
    handle.root.name = item.id;
    this.scale = item.heldScale;
    this.pop = 0;
    handle.root.scale.setScalar(0.001);
    // Turned to face the way the character does, and tipped forward a touch so
    // it reads as being carried rather than balanced on a palm.
    handle.root.rotation.set(0.12, 0, 0);
    handle.root.visible = this.visible;
    this.anchor().add(handle.root);
    this.handle = handle;
  }

  private clear(): void {
    const handle = this.handle;
    if (!handle) return;
    this.anchor().remove(handle.root);
    if (handle.dispose) handle.dispose();
    else disposeTree(handle.root);
    this.handle = null;
  }
}
