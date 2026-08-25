import { Group, Quaternion, Vector3 } from 'three';
import { clamp, clamp01 } from '../core/mathUtils';
import { Spring } from '../core/Spring';
import { disposeTree } from '../art/style/materials';
import type { AssetHandle } from '../art/style/asset';
import {
  KEYCHAIN_SWAY_X,
  KEYCHAIN_SWAY_X_RATE,
  KEYCHAIN_SWAY_Z,
  KEYCHAIN_SWAY_Z_RATE,
  KEYCHAIN_WORN_SCALE,
  keychainWornLift,
} from '../art/models/keychains';
import { SHOP_ITEMS } from '../world/building/shops/catalogue';
import type { FrameContext, GameSystem } from '../core/types';
import { gameStore, type GameState } from '../state';

/**
 * The keychain dangling off the player's backpack.
 *
 * `WornJetpack.ts`'s twin — a store subscriber rather than something told
 * directly, so "which keyring am I wearing?" is a fact about the save rather than
 * a side effect of a button press. Everything that changes it
 * (`gameStore.setWornKeychain`, from the stall's picker or from tapping one in
 * the backpack drawer) needed no line of this file.
 *
 * ## Where it hangs, and why there is a pivot in the middle
 *
 * `anchor` is the character's `keychainAnchor`, which
 * `art/models/backpacks.ts` moves to the clip point of whichever bag is
 * actually worn (`KEYRING_HANGS`) — so switching bags moves the keyring with no
 * help from here.
 *
 * Between the anchor and the keyring sits a **pivot** that this file owns. The
 * keyring models are built origin-at-the-base and standing up (the asset
 * contract grants the `'anchor'` origin reading only to `hat.` ids), so hanging
 * one means pushing it *down* by its own measured height and swinging it about
 * the top. Rotating the anchor instead would swing the bag; rotating the
 * keyring's own root would spin it about its feet, which is not what a thing on a
 * string does.
 *
 * ## Size, and why the pivot also lifts
 *
 * The keyring is drawn at `KEYCHAIN_WORN_SCALE` (2.5x its modelled ~20cm) —
 * Jim, 22 August 2026. At that size several keyrings reach further down than
 * their bag's own `KEYRING_HANGS` anchor sits above the ground, so
 * `keychainWornLift` (`art/models/keychains.ts`) nudges the pivot *up* off
 * the bag's exact corner, only as far as the ground makes it — see that
 * function's own doc for the full reasoning. `pivot.position.y` carries that
 * lift; `pivot.rotation` (below) is the swing, and the two are independent.
 *
 * ## Swing: a driven pendulum, not a fixed sway
 *
 * This used to be two sines and a comment explaining why that was enough at
 * 20cm. Jim, 22 August 2026: *"apply physics so they swing around."* It now
 * drives two `Spring`s (`core/Spring.ts` — the same "boing" primitive the
 * Spooky House uses for its face, moved out to be a shared thing rather than
 * invented twice) toward a target proportional to the **anchor's own
 * acceleration**, resolved into the anchor's own local axes so "sideways"
 * and "forward" always mean *relative to the bag*, not the world. That one
 * mechanism covers both halves of the ask with no special-casing:
 *
 * - **Walking, starting, stopping**: the anchor's world position accelerates
 *   forward/back and side-to-side with every stride (`Player.ts`'s own walk
 *   bob feeds this too), so the spring is continually nudged and never quite
 *   settles while she's moving — an actual swing, not a loop.
 * - **Turning**: `keyringAnchor` sits off to the side of the character's own
 *   pivot (`KEYRING_HANGS`' x), so spinning in place — even with zero
 *   translation — sweeps the anchor through an arc in world space exactly
 *   like a mass on the end of a rotating arm. No separate "is she turning?"
 *   check is needed; the physics already sees it as acceleration.
 *
 * A teleport (a ride's finish, a door, `/spawn`) is detected the same way
 * `PonytailChain`/`BalloonString` detect one — a one-frame jump bigger than
 * any real footstep — and resets the spring to rest instead of flinging the
 * keyring across the anchor's stale-to-fresh gap.
 *
 * ## …plus the idle dangle underneath it
 *
 * The springs alone made a *standing* keyring perfectly rigid — frozen at
 * exactly 0° the instant she stops, which read as glued-on rather than hung
 * (Jim, 23 August 2026). So the picker's own gentle two-sine idle sway
 * (`KEYCHAIN_SWAY_*`, the pre-physics motion this file used to have) is
 * layered **additively** under the spring value every frame: at rest it is
 * the whole of the motion, a soft ±9° dangle; while she moves the springs'
 * far larger driven swing simply rides on top of it, untouched. One sum, no
 * "is she idle?" state to get stuck on, and the picker and the bag agree
 * about what a hanging keyring does when nobody is swinging it.
 */

/** Seconds the pop-in takes, same beat as `WornHat`/`WornJetpack` and a purchase. */
const POP_SECONDS = 0.3;

/** How snappy the swing spring is pulled back towards hanging straight down. */
const SWING_STIFFNESS = 55;
/** How quickly the swing spring's own oscillation dies out. */
const SWING_DAMPING = 9;
/** Radians of target swing per m/s² of the anchor's own local acceleration. */
const SWING_ACCEL_GAIN = 0.045;
/**
 * Hard clamp on the swing *target* (not the displayed angle — the underdamped
 * spring can overshoot it by roughly 10%), so a hard stop or a bad frame
 * cannot aim the keyring anywhere near horizontal, let alone fling it past it.
 */
const SWING_MAX_ANGLE = 0.9;
/** An anchor jump bigger than this in one frame is a teleport, not real motion. */
const TELEPORT_DISTANCE = 2.5;

export class WornKeychain implements GameSystem {
  readonly name = 'wornKeychain';

  private readonly anchor: Group;
  private readonly unsubscribe: () => void;

  /** Owned by this file — see the header. Added to `anchor` only while worn. */
  private readonly pivot = new Group();

  private handle: AssetHandle | null = null;
  private currentUid: string | null = null;
  private pop = 1;

  // --- swing physics state, all scratch/reused so `update` allocates nothing.
  private readonly swingZ = new Spring();
  private readonly swingX = new Spring();
  private readonly worldPos = new Vector3();
  private readonly worldQuat = new Quaternion();
  private readonly previousPos = new Vector3();
  private readonly previousVelocity = new Vector3();
  private readonly scratchAccel = new Vector3();
  private swingStarted = false;

  /** `anchor` is the character's `keychainAnchor`. */
  constructor(anchor: Group) {
    this.anchor = anchor;
    this.pivot.name = 'keychainPivot';
    this.unsubscribe = gameStore.subscribe((state) => this.sync(state));
  }

  /** True while there is actually a keyring on the bag, this frame. */
  get isWorn(): boolean {
    return this.handle !== null;
  }

  update({ dt, elapsed }: FrameContext): void {
    if (!this.handle) return;
    this.handle.update?.(dt, elapsed);

    this.updateSwing(dt);

    // Spring (driven swing) + sine (idle dangle) — see the class header. The
    // pivot's rotation is written here and only here, every worn frame, so
    // neither half can leave a stale angle behind for the other.
    this.pivot.rotation.z =
      this.swingZ.value + Math.sin(elapsed * KEYCHAIN_SWAY_Z_RATE) * KEYCHAIN_SWAY_Z;
    this.pivot.rotation.x =
      this.swingX.value + Math.sin(elapsed * KEYCHAIN_SWAY_X_RATE) * KEYCHAIN_SWAY_X;

    if (this.pop >= 1) return;
    this.pop = clamp01(this.pop + dt / POP_SECONDS);
    // Same overshoot-then-settle pop every purchase and pick uses.
    const eased = 1 + Math.sin(this.pop * Math.PI) * 0.35;
    this.handle.root.scale.setScalar(eased * this.pop * KEYCHAIN_WORN_SCALE);
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
    // Hung from the top: the keyring stands up from its own base, so drop it by
    // its measured height (scaled up to worn size) and the pivot ends up at
    // its ring rather than its feet. `height` is measured off the finished
    // model, never written down.
    handle.root.position.y = -handle.height * KEYCHAIN_WORN_SCALE;
    this.pop = 0;
    handle.root.scale.setScalar(0.001);
    this.pivot.position.set(0, keychainWornLift(this.anchor.position.y, handle.height), 0);
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.add(handle.root);
    this.anchor.add(this.pivot);
    this.handle = handle;

    // A freshly-equipped keyring starts hanging straight down, not mid-swing
    // from whatever the last one was doing.
    this.resetSwing();
  }

  private clear(): void {
    if (!this.handle) return;
    this.pivot.remove(this.handle.root);
    this.anchor.remove(this.pivot);
    disposeTree(this.handle.root);
    this.handle.dispose?.();
    this.handle = null;
  }

  /**
   * One frame of the swing pendulum. Reads the anchor's own world-space
   * acceleration, resolves it into the anchor's local axes, and drives the
   * two swing springs towards it — see the class header for why this one
   * mechanism covers walking, stopping and turning without a special case
   * for any of them.
   */
  private updateSwing(dt: number): void {
    this.anchor.getWorldPosition(this.worldPos);

    if (!this.swingStarted) {
      this.previousPos.copy(this.worldPos);
      this.previousVelocity.set(0, 0, 0);
      this.swingStarted = true;
      return;
    }

    if (dt <= 0) return;

    const jump = this.worldPos.distanceTo(this.previousPos);
    if (jump > TELEPORT_DISTANCE) {
      // A ride, a door, a debug spawn — the anchor moved further in one
      // frame than any real step could. Snap to rest rather than fling the
      // keyring across the gap (`PonytailChain`'s `TELEPORT_DISTANCE` is the
      // same idiom for the same reason).
      this.resetSwing();
      return;
    }

    // Acceleration from the last two frames' worth of anchor velocity —
    // cheap and, for something this light and this small, indistinguishable
    // from anything fancier.
    const invDt = 1 / dt;
    const vx = (this.worldPos.x - this.previousPos.x) * invDt;
    const vy = (this.worldPos.y - this.previousPos.y) * invDt;
    const vz = (this.worldPos.z - this.previousPos.z) * invDt;
    const ax = (vx - this.previousVelocity.x) * invDt;
    const ay = (vy - this.previousVelocity.y) * invDt;
    const az = (vz - this.previousVelocity.z) * invDt;
    this.previousPos.copy(this.worldPos);
    this.previousVelocity.set(vx, vy, vz);

    // Into the anchor's own local frame, so "sideways" always means relative
    // to whichever way the bag currently faces rather than the world — this
    // is what makes a turn-in-place swing the keyring outward the same way a
    // sideways step does, with no separate handling for either.
    this.anchor.getWorldQuaternion(this.worldQuat).invert();
    this.scratchAccel.set(ax, ay, az).applyQuaternion(this.worldQuat);

    this.swingZ.target = clamp(-this.scratchAccel.x * SWING_ACCEL_GAIN, -SWING_MAX_ANGLE, SWING_MAX_ANGLE);
    this.swingX.target = clamp(this.scratchAccel.z * SWING_ACCEL_GAIN, -SWING_MAX_ANGLE, SWING_MAX_ANGLE);
    this.swingZ.update(dt, SWING_STIFFNESS, SWING_DAMPING);
    this.swingX.update(dt, SWING_STIFFNESS, SWING_DAMPING);
  }

  /** Hangs the keyring straight down and forgets any motion so far, with no catch-up snap. */
  private resetSwing(): void {
    this.anchor.getWorldPosition(this.previousPos);
    this.previousVelocity.set(0, 0, 0);
    this.swingStarted = true;
    this.swingZ.value = 0;
    this.swingZ.velocity = 0;
    this.swingZ.target = 0;
    this.swingX.value = 0;
    this.swingX.velocity = 0;
    this.swingX.target = 0;
  }
}
