import type { Group, Object3D } from 'three';
import { clamp01 } from '../../core/mathUtils';
import { disposeTree } from '../../art/style/materials';
import { visiblePoints } from '../../art/style/measure';
import type { AssetHandle, CreatureHandle } from '../../art/style/asset';
import { shopItem } from '../../world/building/shops/catalogue';

/**
 * "They stick their heads out of the top from time to time." — GAME_DESIGN.md
 *
 * Everything the player owns that is not walking in the parade and not in her
 * hands is in the backpack, and the backpack is not a silent box. Every few
 * seconds one of them climbs up, has a look at the park, and ducks back in.
 *
 * It is the whole reason a child bothers to *own* the boring things. A sheet of
 * heart stickers cannot walk behind you, but it can pop out of your bag and
 * waggle, and that is enough.
 *
 * One at a time, always — two heads out at once reads as a bag full of trouble
 * rather than a bag full of friends. The models are built on demand and thrown
 * away when they duck back down, so a player who owns forty things is still only
 * ever paying for one.
 *
 * The kid model already carries a bag (`createKid` builds one by default) and
 * publishes `backpackAnchor` at the opening, so this mounts as an accessory and
 * needs no change to `art/models/kid.ts`.
 */

/** Feet height, in anchor-local metres, while tucked down inside the bag. */
const DOWN_Y = -0.4;

/**
 * Feet height while having a look around.
 *
 * Deliberately still below the rim: two thirds of the peeker shows and the rest
 * stays in the bag, which is what makes it read as *climbing out of* the
 * backpack rather than standing on top of it.
 */
const UP_Y = -0.14;

/**
 * How tall a peeker is scaled to be. Bag-sized, whatever the model started as.
 *
 * Sized against the cartoon-pass head, which is enormous and overhangs the
 * shoulders: much smaller than this and the peeker is lost in the player's hair.
 *
 * Exported so `check-backpack-peek.mts` measures every catalogue item against
 * the real target rather than a copied-out number.
 */
export const PEEK_HEIGHT = 0.4;

/**
 * How far to one side the peeker leans out, in metres.
 *
 * Straight up the middle it is invisible. The cartoon-pass head is 1.3 m across
 * and overhangs the backpack completely, so anything rising out of the bag comes
 * up *underneath the skull*. Climbing out at an angle brings it past the edge of
 * her hair where the camera can see it — and a small creature craning round
 * somebody's head to get a look at the park is the exact gesture this whole
 * feature is for. The far edge still overlaps the bag, so it reads as coming out
 * of it rather than floating alongside.
 */
const LEAN = 0.3;

const RISE_SECONDS = 0.42;
const LOOK_SECONDS = 1.9;
const DUCK_SECONDS = 0.34;

/** Gap between peeks. Long enough that spotting one still feels like a treat. */
const WAIT_MIN = 4.5;
const WAIT_RANGE = 7;

type Phase = 'waiting' | 'rising' | 'looking' | 'ducking';

export class BackpackPeek {
  private readonly anchor: Group;

  /** Catalogue ids currently sitting in the bag. Refreshed by the parade. */
  private candidates: readonly string[] = [];

  private handle: AssetHandle | null = null;
  private creature: CreatureHandle | null = null;
  private lastId: string | null = null;
  /** {@link footprint} of the current `handle`, measured once in {@link begin}. */
  private size = PEEK_HEIGHT;

  private phase: Phase = 'waiting';
  /** Which shoulder this one is craning round. Re-rolled for every peek. */
  private lean = LEAN;
  private timer = 0;
  /** Seconds to sit still before the next peek. Re-rolled after every one. */
  private waitFor = 2.5;

  /** `anchor` is the character's `backpackAnchor` — the mouth of the bag. */
  constructor(anchor: Group) {
    this.anchor = anchor;
  }

  /**
   * Tells the peeker what is in the bag.
   *
   * Called by the parade whenever the inventory changes, because the parade is
   * the thing that knows who is *out* — everything else, by definition, is in.
   */
  setCandidates(ids: readonly string[]): void {
    this.candidates = ids;
    // The last one bought is stowed and we are showing it? Fine. But if what is
    // on show has just been taken out of the bag, put it away at once.
    if (this.lastId && !ids.includes(this.lastId) && this.phase !== 'waiting') {
      this.phase = 'ducking';
      this.timer = 0;
    }
  }

  update(dt: number, elapsed: number): void {
    if (dt <= 0) return;
    this.timer += dt;

    switch (this.phase) {
      case 'waiting':
        if (this.timer < this.waitFor) return;
        this.begin();
        return;

      case 'rising': {
        const t = clamp01(this.timer / RISE_SECONDS);
        this.place(easeOutBack(t), t);
        if (t >= 1) this.advance('looking');
        return;
      }

      case 'looking': {
        this.place(1, 1);
        this.lookAround(elapsed);
        if (this.timer >= LOOK_SECONDS) this.advance('ducking');
        return;
      }

      case 'ducking': {
        const t = clamp01(this.timer / DUCK_SECONDS);
        this.place(1 - t, 1 - t);
        if (t >= 1) {
          this.clear();
          this.advance('waiting');
        }
        return;
      }
    }
  }

  dispose(): void {
    this.clear();
  }

  // -------------------------------------------------------------- internals

  private advance(phase: Phase): void {
    this.phase = phase;
    this.timer = 0;
    if (phase === 'waiting') this.waitFor = WAIT_MIN + Math.random() * WAIT_RANGE;
  }

  /** Picks somebody and builds their model. */
  private begin(): void {
    this.clear();
    const id = this.pick();
    if (!id) {
      // Empty bag. Try again shortly rather than every frame.
      this.advance('waiting');
      return;
    }

    const item = shopItem(id);
    if (!item) {
      this.advance('waiting');
      return;
    }

    const handle = item.model();
    // Scaled to the bag rather than to itself: a teddy and a sticker sheet both
    // have to fit through the same opening. Bounded by width as well as height
    // — a hat's defining dimension is often its brim, not its crown (the sun
    // hat is 0.38 m tall but 2.33 m wide), and sizing by height alone barely
    // shrinks a wide, flat item: it erupted from the backpack almost life
    // size, overlapping the player, instead of coming out bag-sized. See
    // {@link footprint}.
    this.size = footprint(handle.root);
    handle.root.scale.setScalar(PEEK_HEIGHT / Math.max(0.12, this.size));
    this.lean = Math.random() < 0.5 ? -LEAN : LEAN;
    handle.root.position.set(0, DOWN_Y, 0);
    this.anchor.add(handle.root);

    this.handle = handle;
    this.creature = hasHead(handle) ? handle : null;
    this.creature?.setExpression('happy');
    this.lastId = id;
    this.advance('rising');
  }

  /**
   * Somebody different from last time, when there is anybody different.
   *
   * A bag with two things in it should alternate, not flip a coin and show the
   * bunny four times running.
   */
  private pick(): string | null {
    const { candidates } = this;
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0]!;
    const others = candidates.filter((id) => id !== this.lastId);
    const pool = others.length > 0 ? others : candidates;
    return pool[Math.floor(Math.random() * pool.length)] ?? null;
  }

  /** `rise` 0..1 lifts it out of the bag; `pop` 0..1 scales it in. */
  private place(rise: number, pop: number): void {
    const handle = this.handle;
    if (!handle) return;
    const base = PEEK_HEIGHT / Math.max(0.12, this.size);
    handle.root.position.set(this.lean * rise, DOWN_Y + (UP_Y - DOWN_Y) * rise, 0);
    // Tipped the way it is leaning, so it looks like it is holding on to the
    // strap and craning out rather than levitating sideways.
    handle.root.rotation.z = -this.lean * rise * 1.1;
    handle.root.scale.setScalar(base * Math.max(0.001, pop));
    handle.root.visible = pop > 0.01;
  }

  private lookAround(elapsed: number): void {
    const handle = this.handle;
    if (!handle) return;
    // Left, right, and a curious little tip of the head. A creature turns its
    // head; anything else — a sticker sheet, an ice cream — waggles all over.
    const sway = Math.sin(elapsed * 3.1);
    if (this.creature) {
      this.creature.head.rotation.y = sway * 0.62;
      this.creature.head.rotation.z = Math.sin(elapsed * 2.2) * 0.1;
    } else {
      handle.root.rotation.y = sway * 0.5;
      // Added to the lean rather than replacing it — `place` set that this frame.
      handle.root.rotation.z = -this.lean * 1.1 + Math.sin(elapsed * 2.6) * 0.12;
    }
  }

  private clear(): void {
    const handle = this.handle;
    if (!handle) return;
    handle.root.removeFromParent();
    if (handle.dispose) handle.dispose();
    else disposeTree(handle.root);
    this.handle = null;
    this.creature = null;
  }
}

function hasHead(handle: AssetHandle): handle is CreatureHandle {
  return typeof (handle as Partial<CreatureHandle>).setWalkPhase === 'function';
}

/**
 * How big a model reads at a glance: the larger of its vertical extent and its
 * horizontal width, in metres.
 *
 * `AssetHandle.height` (used everywhere else a size is needed, e.g. name-label
 * placement) is vertical extent alone, which is a fair stand-in for a
 * creature's or a held item's overall size but not for a hat, whose bulk can
 * be mostly sideways — a wide brim on a short crown. Scaling *only* by height
 * let the sun hat (0.38 m tall, 2.33 m wide) through this feature almost at
 * full size: `PEEK_HEIGHT / height` came out to ≈1.0 instead of shrinking it,
 * so it erupted from the backpack overlapping the player. Bounding by both
 * axes keeps every peeker inside the same roughly-`PEEK_HEIGHT`-sized box
 * regardless of which axis its bulk sits on.
 *
 * Exported for the same reason as {@link PEEK_HEIGHT}: `check-backpack-peek.mts`
 * calls this directly so it is checking the formula that actually runs, not a
 * second copy of it that could drift out of step.
 */
export function footprint(root: Object3D): number {
  let top = 0;
  let bottom = 0;
  let radius = 0;
  visiblePoints(root, (point) => {
    if (point.y > top) top = point.y;
    if (point.y < bottom) bottom = point.y;
    radius = Math.max(radius, Math.hypot(point.x, point.z));
  });
  return Math.max(top - bottom, radius * 2);
}

/** Overshoots a little at the top, like a head popping up too eagerly. */
function easeOutBack(t: number): number {
  const s = 1.7;
  const u = t - 1;
  return u * u * ((s + 1) * u + s) + 1;
}
