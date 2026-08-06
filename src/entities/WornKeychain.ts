import { Group } from 'three';
import { clamp01 } from '../core/mathUtils';
import { disposeTree } from '../art/style/materials';
import type { AssetHandle } from '../art/style/asset';
import { SHOP_ITEMS } from '../world/building/shops/catalogue';
import type { FrameContext, GameSystem } from '../core/types';
import { gameStore, type GameState } from '../state';

/**
 * The keychain dangling off the player's backpack.
 *
 * `WornJetpack.ts`'s twin — a store subscriber rather than something told
 * directly, so "which charm am I wearing?" is a fact about the save rather than
 * a side effect of a button press. Everything that changes it
 * (`gameStore.setWornKeychain`, from the stall's picker or from tapping one in
 * the backpack drawer) needed no line of this file.
 *
 * ## Where it hangs, and why there is a pivot in the middle
 *
 * `anchor` is the character's `keychainAnchor`, which
 * `art/models/backpacks.ts` moves to the clip point of whichever bag is
 * actually worn (`CHARM_HANGS`) — so switching bags moves the charm with no
 * help from here.
 *
 * Between the anchor and the charm sits a **pivot** that this file owns. The
 * charm models are built origin-at-the-base and standing up (the asset
 * contract grants the `'anchor'` origin reading only to `hat.` ids), so hanging
 * one means pushing it *down* by its own measured height and swinging it about
 * the top. Rotating the anchor instead would swing the bag; rotating the
 * charm's own root would spin it about its feet, which is not what a thing on a
 * string does.
 *
 * The sway is two sines and no physics. A pendulum solver here would be a
 * second thing that can be wrong, would need the player's velocity plumbed in,
 * and would look very nearly identical at this size — the charm is 20 cm of a
 * character a child sees from four metres away.
 */

/** Seconds the pop-in takes, same beat as `WornHat`/`WornJetpack` and a purchase. */
const POP_SECONDS = 0.3;

/**
 * Sway, in radians and radians per second.
 *
 * Deliberately not the same rate on both axes: matched rates read as a rigid
 * thing rocking, and two that drift in and out of phase read as something on a
 * string. The sideways swing is the bigger one because that is the axis a
 * walking child's bag actually rocks about.
 */
const SWAY_Z = 0.16;
const SWAY_Z_RATE = 2.1;
const SWAY_X = 0.07;
const SWAY_X_RATE = 1.37;

export class WornKeychain implements GameSystem {
  readonly name = 'wornKeychain';

  private readonly anchor: Group;
  private readonly unsubscribe: () => void;

  /** Owned by this file — see the header. Added to `anchor` only while worn. */
  private readonly pivot = new Group();

  private handle: AssetHandle | null = null;
  private currentUid: string | null = null;
  private pop = 1;

  /** `anchor` is the character's `keychainAnchor`. */
  constructor(anchor: Group) {
    this.anchor = anchor;
    this.pivot.name = 'keychainPivot';
    this.unsubscribe = gameStore.subscribe((state) => this.sync(state));
  }

  /** True while there is actually a charm on the bag, this frame. */
  get isWorn(): boolean {
    return this.handle !== null;
  }

  update({ dt, elapsed }: FrameContext): void {
    if (!this.handle) return;
    this.handle.update?.(dt, elapsed);

    this.pivot.rotation.z = Math.sin(elapsed * SWAY_Z_RATE) * SWAY_Z;
    this.pivot.rotation.x = Math.sin(elapsed * SWAY_X_RATE) * SWAY_X;

    if (this.pop >= 1) return;
    this.pop = clamp01(this.pop + dt / POP_SECONDS);
    // Same overshoot-then-settle pop every purchase and pick uses.
    const eased = 1 + Math.sin(this.pop * Math.PI) * 0.35;
    this.handle.root.scale.setScalar(eased * this.pop);
  }

  dispose(): void {
    this.unsubscribe();
    this.clear();
  }

  // -------------------------------------------------------------- internals

  private sync(state: GameState): void {
    if (state.wornKeychainUid === this.currentUid) return;
    this.currentUid = state.wornKeychainUid;
    this.clear();
    if (!state.wornKeychainUid) return;

    const owned = state.inventory.find((item) => item.uid === state.wornKeychainUid);
    if (!owned) return;
    // Built through the catalogue rather than from the id, so there is one
    // place that knows which model a `keychain.*` entry means.
    const entry = SHOP_ITEMS.find((item) => item.id === owned.id);
    if (!entry) return;

    const handle = entry.model();
    // Hung from the top: the charm stands up from its own base, so drop it by
    // its measured height and the pivot ends up at its ring rather than its
    // feet. `height` is measured off the finished model, never written down.
    handle.root.position.y = -handle.height;
    this.pop = 0;
    handle.root.scale.setScalar(0.001);
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.add(handle.root);
    this.anchor.add(this.pivot);
    this.handle = handle;
  }

  private clear(): void {
    if (!this.handle) return;
    this.pivot.remove(this.handle.root);
    this.anchor.remove(this.pivot);
    disposeTree(this.handle.root);
    this.handle.dispose?.();
    this.handle = null;
  }
}
