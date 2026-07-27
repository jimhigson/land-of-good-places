import { Group, Vector3 } from 'three';
import { clamp, damp } from '../core/mathUtils';
import { disposeTree } from '../art/style/materials';
import type { FrameContext, GameSystem } from '../core/types';
import {
  balloonKindFromItemId,
  createBalloon,
  STRING_LENGTH,
  type BalloonHandle,
} from '../art/models/balloons';
import { BalloonString } from './balloonString';
import { gameStore, type GameState, type InventoryItem } from '../state';
import type { Player } from './Player';

/**
 * Every balloon the player owns and has not stowed, held above them on a
 * bending string.
 *
 * A bought balloon used to end up in the parade once something newer took
 * over the player's hands (see `entities/parade/Parade.ts`'s `isOut`, which
 * now excludes `kind: 'balloon'` outright) — walking along the ground on a
 * fixed-height float, exactly like Biscuit or RiPika. A family complaint: a
 * balloon is *held*, not a pet that follows. This system is the fix, and it
 * owns every non-stowed balloon regardless of `carriedUid` — buy three and
 * all three stay up, splayed apart, not just whichever one is "in your
 * hands" this moment (see `CarriedItem.ts`'s balloon carve-out).
 *
 * **Not parented to the hand.** A `holdAnchor.add(balloon.root)` would rotate
 * the balloon with every arm swing of the walk cycle, which reads as the
 * balloon being nailed to the fist rather than floating at the end of a
 * string. Instead every balloon lives in world space (`this.group`, added to
 * the scene once like `Parade.group`), aimed each frame at a float point
 * above the player's head and eased there with `damp()` — the same "gentle
 * lag" the parade's own follow-spring uses — so the balloon visibly catches
 * up rather than teleporting when the child sets off, stops or turns. The
 * gap between the literal (jittery, arm-swinging) hand position and that
 * smoothed float point is exactly what the dynamic string in
 * `balloonString.ts` bends across every frame.
 */

/** How many balloons show at once. Beyond this a bouquet reads as clutter. */
const MAX_HELD = 6;

/** Metres between the centres of two adjacent splayed balloons. */
const SPLAY_X = 0.34;

/** How far behind the hand the float point sits, so a balloon never sits in front of the face. */
const BEHIND_OFFSET = -0.22;

/** How far above the model's own height the knot floats at rest. */
const HEAD_CLEARANCE = 0.3;

/** Seconds for the float point's follow-lag to close most of the gap. */
const FOLLOW_HALF_LIFE = 0.22;

/** Slightly floatier on the vertical axis — helium does not snap to height. */
const VERTICAL_HALF_LIFE = 0.3;

/** Metres of gentle independent wander, so a bouquet of balloons is not a rigid block. */
const DRIFT = 0.06;

/** How strongly the knot's lag behind its float point tips the balloon — a drag lean. */
const LEAN_GAIN = 0.9;

/** Radians either way the lean is clamped to — enough to read, never a cartwheel. */
const MAX_LEAN = 0.5;

/** Hand-to-knot rest length for the dynamic string — longer than the shelf's rigid one (`STRING_LENGTH`) because the knot floats well above the head, not just above the fist. */
const HELD_STRING_LENGTH = STRING_LENGTH * 1.7;

interface HeldEntry {
  readonly uid: string;
  readonly handle: BalloonHandle;
  readonly string: BalloonString;
  readonly position: Vector3;
  /** Per-balloon phase offset for the idle drift, seeded from the uid. */
  readonly seed: number;
  placed: boolean;
}

const handWorld = new Vector3();
const targetScratch = new Vector3();

export class HeldBalloons implements GameSystem {
  readonly name = 'heldBalloons';

  /** Add this to the scene once. Balloons live in world space inside it. */
  readonly group = new Group();

  private readonly player: Player;
  private readonly unsubscribe: () => void;
  private readonly balloons = new Map<string, HeldEntry>();
  /** Signature of the last sync, so a store notification is usually free. */
  private signature = '';

  constructor(player: Player) {
    this.player = player;
    this.group.name = 'heldBalloons';
    this.unsubscribe = gameStore.subscribe((state) => this.sync(state));
  }

  update({ dt, elapsed }: FrameContext): void {
    if (this.balloons.size === 0) return;

    const hand = this.player.model.holdAnchor;
    hand.updateWorldMatrix(true, false);
    hand.getWorldPosition(handWorld);

    const count = this.balloons.size;
    let index = 0;
    for (const entry of this.balloons.values()) {
      this.updateOne(entry, index, count, dt, elapsed);
      index += 1;
    }
  }

  dispose(): void {
    this.unsubscribe();
    for (const entry of this.balloons.values()) this.disposeEntry(entry);
    this.balloons.clear();
  }

  // -------------------------------------------------------------- internals

  private updateOne(entry: HeldEntry, index: number, count: number, dt: number, elapsed: number): void {
    const player = this.player;
    const facing = player.group.rotation.y;
    const cos = Math.cos(facing);
    const sin = Math.sin(facing);

    // Fan out sideways relative to the way the child is FACING, not a fixed
    // world direction — otherwise turning around would sweep the whole
    // bouquet through the player's own head.
    const spread = count > 1 ? (index - (count - 1) / 2) * SPLAY_X : 0;
    const drift = entry.seed;
    const localX = spread + Math.sin(elapsed * 0.5 + drift) * DRIFT;
    const localZ = BEHIND_OFFSET + Math.cos(elapsed * 0.43 + drift * 1.7) * DRIFT;

    targetScratch.set(
      player.position.x + localX * cos + localZ * sin,
      player.position.y + player.model.height + HEAD_CLEARANCE + Math.sin(elapsed * 0.6 + drift) * DRIFT,
      player.position.z - localX * sin + localZ * cos,
    );

    if (!entry.placed) {
      entry.placed = true;
      entry.position.copy(targetScratch);
    } else {
      entry.position.x = damp(entry.position.x, targetScratch.x, FOLLOW_HALF_LIFE, dt);
      entry.position.y = damp(entry.position.y, targetScratch.y, VERTICAL_HALF_LIFE, dt);
      entry.position.z = damp(entry.position.z, targetScratch.z, FOLLOW_HALF_LIFE, dt);
    }

    // Lean: how far behind its own float point the knot currently lags,
    // tipped into a rotation — a balloon dragged forward tips its top back,
    // exactly like a helium balloon towed by its string.
    const lagX = targetScratch.x - entry.position.x;
    const lagZ = targetScratch.z - entry.position.z;
    entry.handle.root.rotation.z = clamp(lagX * LEAN_GAIN, -MAX_LEAN, MAX_LEAN);
    entry.handle.root.rotation.x = clamp(-lagZ * LEAN_GAIN, -MAX_LEAN, MAX_LEAN);
    entry.handle.root.position.copy(entry.position);

    // The balloon's own idle bob/sway, same as ever (see `balloons.ts`'s `bobber`).
    entry.handle.update?.(dt, elapsed);

    entry.string.update(handWorld, entry.position, dt);
  }

  private sync(state: GameState): void {
    const owned = state.inventory
      .filter((item) => isHeldBalloon(item))
      .slice(0, MAX_HELD);

    const signature = owned.map((item) => item.uid).join(',');
    if (signature === this.signature) return;
    this.signature = signature;

    const keep = new Set(owned.map((item) => item.uid));
    for (const [uid, entry] of this.balloons) {
      if (keep.has(uid)) continue;
      this.disposeEntry(entry);
      this.balloons.delete(uid);
    }

    for (const item of owned) {
      if (this.balloons.has(item.uid)) continue;
      const kind = balloonKindFromItemId(item.id);
      if (!kind) continue;
      const handle = createBalloon(kind, { includeString: false });
      this.group.add(handle.root);
      this.balloons.set(item.uid, {
        uid: item.uid,
        handle,
        string: new BalloonString(HELD_STRING_LENGTH),
        position: new Vector3(),
        seed: hashSeed(item.uid),
        placed: false,
      });
      this.group.add(this.balloons.get(item.uid)!.string.group);
    }
  }

  private disposeEntry(entry: HeldEntry): void {
    entry.handle.root.removeFromParent();
    if (entry.handle.dispose) entry.handle.dispose();
    else disposeTree(entry.handle.root);
    entry.string.group.removeFromParent();
    entry.string.dispose();
  }
}

// ------------------------------------------------------------------ helpers

/** Owned, not tucked away, and actually a balloon. */
function isHeldBalloon(item: InventoryItem): boolean {
  return item.kind === 'balloon' && !item.stowed;
}

/** A small, stable per-balloon phase, so a bouquet does not drift in lockstep. */
function hashSeed(uid: string): number {
  let hash = 0;
  for (let i = 0; i < uid.length; i += 1) hash = (hash * 31 + uid.charCodeAt(i)) >>> 0;
  return (hash % 1000) / 1000 * Math.PI * 2;
}
