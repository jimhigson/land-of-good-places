import type { Group } from 'three';
import { clamp01 } from '../core/mathUtils';
import { disposeTree } from '../art/style/materials';
import { createJetpack, type JetpackHandle } from '../art/models/jetpack';
import type { FrameContext, GameSystem } from '../core/types';
import { gameStore, type GameState } from '../state';

/**
 * The jet pack strapped to the player's back.
 *
 * `WornHat.ts`'s twin, deliberately: a store subscriber rather than something
 * told directly, so "am I wearing a jet pack?" is a fact about the save rather
 * than a side effect of a button press. Two things set `wornJetpackUid` —
 * buying one (`gameStore.buy` puts it straight on; see the note there) and
 * tapping it in the backpack drawer (`gameStore.setWornJetpack`) — and neither
 * needed a line of this file.
 *
 * Parented to `jetpackAnchor` — the middle of her back, see `art/models/kid.ts`
 * — at the model's own natural scale: `art/models/jetpack.ts` promises "no
 * offset maths" for exactly this attachment.
 *
 * ## Two things read this rather than the store
 *
 * `Player` asks {@link isWorn} whether flight is allowed at all — the jet pack
 * has no button of its own any more, just the ordinary jump button held past a
 * beat, see `Player.ts`'s "THE JET PACK" comment — and calls {@link setThrust}
 * so the painted flames light when she is actually climbing. Going through the
 * system rather than the store means the answer can never be "she owns one"
 * when what is on screen is a bare back — there is one model and one flag, and
 * they are the same object.
 */

/** Seconds the pop-in takes, same beat as `WornHat`'s and a purchase's. */
const POP_SECONDS = 0.3;

export class WornJetpack implements GameSystem {
  readonly name = 'wornJetpack';

  /** Read live, not captured once — see {@link rebind} and `WornHat`'s own
   *  doc comment on the identical field. */
  private readonly anchor: () => Group;
  private readonly unsubscribe: () => void;
  private readonly onWornChange: ((worn: boolean) => void) | null;

  private handle: JetpackHandle | null = null;
  private currentUid: string | null = null;
  private pop = 1;
  /** The last value {@link onWornChange} was told. See {@link update}. */
  private notifiedWorn = false;
  private thrust = 0;

  /**
   * `anchor` is the character's `jetpackAnchor`.
   *
   * `onWornChange` is told whenever the pack appears or disappears, so the
   * model can put its own backpack away — see `art/models/backpacks.ts`'s
   * `setHidden`. Optional, for a wearer with no bag to move.
   */
  constructor(anchor: () => Group, onWornChange?: (worn: boolean) => void) {
    this.anchor = anchor;
    this.onWornChange = onWornChange ?? null;
    this.unsubscribe = gameStore.subscribe((state) => this.sync(state));
  }

  /**
   * The player's model was just rebuilt — see `WornHat.rebind`'s doc comment,
   * including why `notifiedWorn` must be forgotten too. Here that matters even
   * more than it does for the hat: `onWornChange` is what puts the model's own
   * backpack away (`setJetpackWorn` → `backpacks.ts`'s `setHidden`), so
   * skipping it leaves the freshly-built model wearing its bag *and* the jet
   * pack — the two-things-on-one-back this class exists to prevent.
   */
  rebind(): void {
    this.clear();
    this.currentUid = null;
    this.notifiedWorn = false;
    this.sync(gameStore.get());
  }

  /** True while there is actually a jet pack on her back, this frame. */
  get isWorn(): boolean {
    return this.handle !== null;
  }

  /**
   * How hard it is firing, 0..1. Written by `Player` every frame it is flying;
   * silently ignored when nothing is worn, so the caller needs no null check.
   */
  setThrust(amount: number): void {
    this.thrust = clamp01(amount);
    this.handle?.setThrust(this.thrust);
  }

  update({ dt, elapsed }: FrameContext): void {
    // Deliberately here rather than fired from inside `sync`, for the reason
    // `WornHat` sets out at length: `sync` has several early returns, and a
    // one-boolean-compare-per-frame edge detector cannot be broken by any of
    // them.
    const worn = this.handle !== null;
    if (worn !== this.notifiedWorn) {
      this.notifiedWorn = worn;
      this.onWornChange?.(worn);
    }

    if (!this.handle) return;
    this.handle.update?.(dt, elapsed);

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
    if (state.wornJetpackUid === this.currentUid) return;
    this.currentUid = state.wornJetpackUid;
    this.clear();
    if (!state.wornJetpackUid) return;

    const owned = state.inventory.find((item) => item.uid === state.wornJetpackUid);
    if (!owned) return;

    const handle = createJetpack();
    this.pop = 0;
    handle.root.scale.setScalar(0.001);
    // A pack that was firing when it was swapped must not light up the new one
    // on its first frame; `Player` writes the real value again this frame.
    handle.setThrust(0);
    this.anchor().add(handle.root);
    this.handle = handle;
  }

  private clear(): void {
    if (!this.handle) return;
    this.anchor().remove(this.handle.root);
    disposeTree(this.handle.root);
    this.handle = null;
    this.thrust = 0;
  }
}
