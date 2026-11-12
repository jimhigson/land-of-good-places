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
 *
 * Exported so `check:hotel`'s probe 3d can teleport by an amount this file
 * agrees is a teleport, rather than carrying its own copy of the number: the
 * check would otherwise silently stop exercising the thing it is named for the
 * day this moves.
 */
export const TELEPORT_GAP = 3;

/**
 * Crumbs the ring holds, at most. `MAX_LENGTH / STEP` = 250 can be live at
 * once; a power of two so the wrap is a mask.
 *
 * **A ring, not an array that is pushed and shifted** (#745's review): a tapped
 * dash (`entities/tapDash.ts`) runs at up to ~85 m/s and drops a crumb every
 * stride, ~700 a second against ~60 walking. An object per crumb and an
 * `Array.shift()` over ~250 entries per crumb was garbage and copying at
 * exactly the moment frames are tightest. Four flat columns, written in place,
 * allocate nothing after construction.
 */
const CAPACITY = 512;
const MASK = CAPACITY - 1;

export class PlayerTrail {
  private readonly xs = new Float64Array(CAPACITY);
  private readonly ys = new Float64Array(CAPACITY);
  private readonly zs = new Float64Array(CAPACITY);
  /** Cumulative distance walked when each crumb was dropped. */
  private readonly ats = new Float64Array(CAPACITY);
  /** Ring index of the oldest crumb. */
  private head = 0;
  /** Crumbs held. */
  private size = 0;
  private travelled = 0;

  /** Ring index of the `i`th crumb, oldest first. */
  private slot(i: number): number {
    return (this.head + i) & MASK;
  }

  /** True once there is enough history for anybody to follow. */
  get ready(): boolean {
    return this.size > 1;
  }

  /** Total distance the player has walked since the last break in the trail. */
  get length(): number {
    return this.size === 0 ? 0 : this.travelled - (this.ats[this.head] ?? 0);
  }

  /** Throws the history away — used when the character is moved, not walked. */
  reset(x: number, y: number, z: number): void {
    this.head = 0;
    this.size = 1;
    this.travelled = 0;
    this.xs[0] = x;
    this.ys[0] = y;
    this.zs[0] = z;
    this.ats[0] = 0;
  }

  /**
   * Call once a frame with the player's feet — or once a stride, during a
   * dash (`Parade.followStride`).
   *
   * **Returns true on the frame the character was *moved* rather than walked**
   * — the deep link into a hotel room, a ride setting her down, anything that
   * puts her somewhere instead of taking her there. This class already had to
   * know (a trail spliced across a 640 m jump is a line through everything in
   * between, which is why {@link TELEPORT_GAP} exists); saying so out loud is
   * what lets {@link Parade} act on it, and keeps "was that a teleport?" a
   * question with **one owner** rather than a second threshold somewhere else
   * that has to be kept in step with this one.
   */
  push(x: number, y: number, z: number): boolean {
    if (this.size === 0) {
      // The very first crumb of a run. Nobody was anywhere to be moved *from*,
      // so this is a start, not a teleport.
      this.reset(x, y, z);
      return false;
    }

    const last = this.slot(this.size - 1);
    const moved = Math.hypot(x - (this.xs[last] ?? 0), z - (this.zs[last] ?? 0));
    if (moved > TELEPORT_GAP) {
      this.reset(x, y, z);
      return true;
    }
    // Standing still leaves no crumbs, which is what stops the parade drifting
    // into the player's back while she waits at a shop counter.
    if (moved < STEP) return false;

    this.travelled += moved;
    if (this.size === CAPACITY) {
      // Full: the oldest crumb makes room. Never reached in practice — the
      // length rule below keeps ~250 — but a ring must not overwrite its head.
      this.head = (this.head + 1) & MASK;
      this.size -= 1;
    }
    const next = this.slot(this.size);
    this.xs[next] = x;
    this.ys[next] = y;
    this.zs[next] = z;
    this.ats[next] = this.travelled;
    this.size += 1;

    // Drop history nobody can still be standing on.
    while (this.size > 2 && this.travelled - (this.ats[this.slot(1)] ?? 0) > MAX_LENGTH) {
      this.head = (this.head + 1) & MASK;
      this.size -= 1;
    }
    return false;
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
    if (this.size === 0) return false;
    const { xs, ys, zs, ats } = this;
    const oldest = this.head;
    if (this.size === 1) {
      out.set(xs[oldest] ?? 0, ys[oldest] ?? 0, zs[oldest] ?? 0);
      return true;
    }

    const target = this.travelled - Math.max(0, behind);
    if (target <= (ats[oldest] ?? 0)) {
      out.set(xs[oldest] ?? 0, ys[oldest] ?? 0, zs[oldest] ?? 0);
      return true;
    }

    // Binary search for the segment containing `target`. Followers are spread
    // along the trail, so a shared cursor would thrash; this is O(log n) and
    // runs eight times a frame.
    let low = 0;
    let high = this.size - 1;
    while (high - low > 1) {
      const mid = (low + high) >> 1;
      if ((ats[this.slot(mid)] ?? 0) <= target) low = mid;
      else high = mid;
    }

    const a = this.slot(low);
    const b = this.slot(high);
    const aAt = ats[a] ?? 0;
    const span = (ats[b] ?? 0) - aAt;
    const t = span > 1e-6 ? (target - aAt) / span : 0;
    const ax = xs[a] ?? 0;
    const ay = ys[a] ?? 0;
    const az = zs[a] ?? 0;
    out.set(ax + ((xs[b] ?? 0) - ax) * t, ay + ((ys[b] ?? 0) - ay) * t, az + ((zs[b] ?? 0) - az) * t);
    return true;
  }

  /**
   * **How far this body is from the line at all**, in metres on the plan — the
   * shortest distance to any point of the trail, not to one follower's own
   * sample of it. `Infinity` when there is no trail to be near.
   *
   * This is the question "is this pet still following, or has it been put
   * somewhere?" — issue #605, Jim: *"the pets should ALWAYS use normal path
   * finding by default to get to where they need to go"*. A pet that is
   * following is **on** the ground the player covered, so it is safe to keep
   * steering it straight at the next bit of that ground; a pet that has just
   * stood up out of a bed in another room is not, and a straight line from
   * there goes through a wall.
   *
   * **Distance to the path, never distance to the sample.** The follow spring
   * lags, and measured on the built suite that lag is large — median 0.87 m,
   * peaking at 1.41 m — so a follower is routinely a metre from the point it
   * is aiming at while being exactly on the line. The lag is *along* the
   * trail, not away from it, which is the whole reason this is the honest
   * instrument and a distance-to-target test is not. Measured over the same
   * walk: 0.00 m median and **0.366 m worst** while following, against 2.44 m
   * at p99 and **5.93 m worst** while re-forming after a nap. Two populations
   * a threshold can sit six times clear of, in both directions.
   *
   * Cost is one pass over the crumbs — at most `MAX_LENGTH / STEP` = 250 of
   * them — per follower per frame, which is the only per-frame arithmetic
   * #605 adds. No allocation, and no route is planned unless this says the
   * body has left the line.
   */
  distanceTo(x: number, z: number): number {
    if (this.size === 0) return Number.POSITIVE_INFINITY;
    const { xs, zs } = this;
    if (this.size === 1) {
      return Math.hypot(x - (xs[this.head] ?? 0), z - (zs[this.head] ?? 0));
    }

    let best = Number.POSITIVE_INFINITY;
    for (let index = 1; index < this.size; index += 1) {
      const a = this.slot(index - 1);
      const b = this.slot(index);
      const ax = xs[a] ?? 0;
      const az = zs[a] ?? 0;
      const abx = (xs[b] ?? 0) - ax;
      const abz = (zs[b] ?? 0) - az;
      const lengthSq = abx * abx + abz * abz;
      // Crumbs are STEP apart, so a zero-length segment cannot arise from
      // walking — but a reset leaves one crumb and a teleport can coincide.
      const t =
        lengthSq > 1e-9
          ? Math.max(0, Math.min(1, ((x - ax) * abx + (z - az) * abz) / lengthSq))
          : 0;
      const dx = x - (ax + abx * t);
      const dz = z - (az + abz * t);
      const distance = Math.hypot(dx, dz);
      if (distance < best) best = distance;
    }
    return best;
  }
}
