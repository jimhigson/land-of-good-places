import type { Vector3 } from 'three';

/**
 * The breadcrumb trail: where the player has just been.
 *
 * This is the whole reason the parade works, and it is worth being clear about
 * why it is a *path* and not a formation. If each toy simply steered towards a
 * point one metre behind the player, the line would cut every corner — round the
 * fountain the tail would swing through the water, and through a doorway the
 * back half of the parade would walk into the wall. Following the ground the
 * player actually covered means a toy can only ever go somewhere the player has
 * already been, which is somewhere walkable, by definition. Corners, doorways,
 * stairs and the escalator all come out right for free.
 *
 * Samples are stored with their **cumulative arc length**, so "1.8 metres back
 * along the line" is a lookup rather than a search through positions. `y` is
 * recorded too — it is the height of the surface the player was standing on at
 * that point, which is exactly the hint the walk-surface sampler needs to put a
 * follower on the same step, deck or slope rather than on the ground beneath it.
 */

/** Distance between crumbs. Small enough to round a corner, big enough to be cheap. */
const STEP = 0.12;

/** How much history to keep, in metres. Eight followers need about five. */
const MAX_LENGTH = 30;

/**
 * A gap bigger than this did not happen by walking.
 *
 * Rides, the lift and `teleport` move the character in one frame. Joining the
 * two ends would lay a straight line of crumbs through whatever is in between,
 * and the parade would follow it through a wall. The trail is dropped and
 * restarted instead, so the toys catch up across open space and then fall in.
 */
const TELEPORT_GAP = 3;

interface Crumb {
  x: number;
  y: number;
  z: number;
  /** Cumulative distance walked when this crumb was dropped. */
  at: number;
}

export class PlayerTrail {
  private readonly crumbs: Crumb[] = [];
  private travelled = 0;

  /** True once there is enough history for anybody to follow. */
  get ready(): boolean {
    return this.crumbs.length > 1;
  }

  /** Total distance the player has walked since the last break in the trail. */
  get length(): number {
    return this.crumbs.length === 0 ? 0 : this.travelled - this.crumbs[0]!.at;
  }

  /** Throws the history away — used when the character is moved, not walked. */
  reset(x: number, y: number, z: number): void {
    this.crumbs.length = 0;
    this.travelled = 0;
    this.crumbs.push({ x, y, z, at: 0 });
  }

  /** Call once a frame with the player's feet. */
  push(x: number, y: number, z: number): void {
    const last = this.crumbs[this.crumbs.length - 1];
    if (!last) {
      this.reset(x, y, z);
      return;
    }

    const moved = Math.hypot(x - last.x, z - last.z);
    if (moved > TELEPORT_GAP) {
      this.reset(x, y, z);
      return;
    }
    // Standing still leaves no crumbs, which is what stops the parade drifting
    // into the player's back while she waits at a shop counter.
    if (moved < STEP) return;

    this.travelled += moved;
    this.crumbs.push({ x, y, z, at: this.travelled });

    // Drop history nobody can still be standing on.
    while (this.crumbs.length > 2 && this.travelled - this.crumbs[1]!.at > MAX_LENGTH) {
      this.crumbs.shift();
    }
  }

  /**
   * The point `behind` metres back along the trail, written into `out`.
   *
   * Returns false when there is no trail yet. Asking for more history than
   * exists — which every follower does for the first few steps of a new game —
   * gives the oldest crumb, so the line forms up from a standstill instead of
   * appearing all at once.
   */
  sample(behind: number, out: Vector3): boolean {
    const crumbs = this.crumbs;
    if (crumbs.length === 0) return false;
    if (crumbs.length === 1) {
      const only = crumbs[0]!;
      out.set(only.x, only.y, only.z);
      return true;
    }

    const target = this.travelled - Math.max(0, behind);
    const oldest = crumbs[0]!;
    if (target <= oldest.at) {
      out.set(oldest.x, oldest.y, oldest.z);
      return true;
    }

    // Binary search for the segment containing `target`. Followers are spread
    // along the trail, so a shared cursor would thrash; this is O(log n) and
    // runs eight times a frame.
    let low = 0;
    let high = crumbs.length - 1;
    while (high - low > 1) {
      const mid = (low + high) >> 1;
      if (crumbs[mid]!.at <= target) low = mid;
      else high = mid;
    }

    const a = crumbs[low]!;
    const b = crumbs[high]!;
    const span = b.at - a.at;
    const t = span > 1e-6 ? (target - a.at) / span : 0;
    out.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
    return true;
  }
}
