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
 */

/** Seconds the pop-in takes. Long enough to notice, short enough not to wait. */
const POP_SECONDS = 0.3;

export class CarriedItem {
  private readonly anchor: Group;
  private readonly unsubscribe: () => void;

  private handle: AssetHandle | null = null;
  private currentUid: string | null = null;
  private scale = 1;
  private pop = 1;

  /** `anchor` is the character's `holdAnchor` — the right hand. */
  constructor(anchor: Group) {
    this.anchor = anchor;
    this.unsubscribe = gameStore.subscribe((state) => this.sync(state));
  }

  /** The catalogue id in the player's hands, or null. */
  get itemId(): string | null {
    return this.handle?.root.name ?? null;
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
    this.anchor.add(handle.root);
    this.handle = handle;
  }

  private clear(): void {
    const handle = this.handle;
    if (!handle) return;
    this.anchor.remove(handle.root);
    if (handle.dispose) handle.dispose();
    else disposeTree(handle.root);
    this.handle = null;
  }
}
