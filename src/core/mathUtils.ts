/** Small, dependency-light maths helpers shared across systems. */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Maps `value` from [inMin, inMax] into [outMin, outMax], clamped. */
export function remap(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  if (inMax === inMin) return outMin;
  return lerp(outMin, outMax, clamp01((value - inMin) / (inMax - inMin)));
}

/** Hermite smoothstep. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1));
  return t * t * (3 - 2 * t);
}

/**
 * Frame-rate independent exponential smoothing.
 *
 * `halfLife` is the time in seconds for the remaining distance to halve, which
 * is far easier to reason about than a per-frame lerp factor. Always prefer
 * this over `lerp(a, b, 0.1)` inside an update loop.
 */
export function damp(current: number, target: number, halfLife: number, dt: number): number {
  if (halfLife <= 0) return target;
  return target + (current - target) * Math.pow(2, -dt / halfLife);
}

/** Shortest signed angular difference from `a` to `b`, in radians. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Rotates `current` towards `target` by at most `maxDelta` radians. */
export function turnTowards(current: number, target: number, maxDelta: number): number {
  const delta = angleDelta(current, target);
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

/** Ping-pongs `t` in the range [0, length]. */
export function pingPong(t: number, length: number): number {
  const m = ((t % (length * 2)) + length * 2) % (length * 2);
  return m > length ? length * 2 - m : m;
}

/**
 * Deterministic pseudo-random generator (mulberry32).
 *
 * The whole world is generated procedurally, so we seed everything from a fixed
 * number: the park looks identical every reload, which makes bugs reproducible
 * and stops the layout wobbling between playtests.
 */
export function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Convenience wrapper giving a seeded RNG a friendlier surface. */
export class Rng {
  private readonly next: () => number;

  constructor(seed: number) {
    this.next = createRandom(seed);
  }

  /** Float in [0, 1). */
  unit(): number {
    return this.next();
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Picks an element from a non-empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty array');
    return items[Math.floor(this.next() * items.length)] as T;
  }
}

/**
 * A stream of its very own for candidate `index` of a rejection sampler.
 *
 * ### The bug this exists to make impossible
 *
 * A rejection sampler that draws from one long-lived {@link Rng} consumes a
 * *different number of draws* depending on whether a candidate was accepted.
 * `Scenery`'s tree scatter is the worst case: a rejected candidate costs 2-3
 * draws, an accepted one 10-20. So the moment anything upstream flips one
 * candidate from accepted to rejected, every later object on that stream
 * shifts — the sampler is still deterministic, but it is now deterministic
 * about a different park.
 *
 * That is not a theoretical hazard. Lengthening one stall's path spur by a few
 * metres paves a little more ground, `isOnPath` refuses one tree that used to
 * fit, and a garden wall lands across the *ferris wheel kiosk's* line of sight
 * on the far side of the park, stranding its waypoint. The two have nothing to
 * do with each other except a shared draw counter. It cost an engineer a sweep
 * of all 344 legal booth positions — every one of which stranded the same
 * waypoint — before the mechanism was identified. See `parkManifest.ts`.
 *
 * ### What this fixes, and what it does not
 *
 * Seeding per candidate makes candidate *k*'s proposal a pure function of *k*
 * and the seed, so **rejecting candidate *k-1* cannot move candidate *k***.
 * Distant scenery stops caring how long a path is.
 *
 * It does **not** make the scatter immune to geometry, and it should not:
 * a candidate whose footprint now overlaps the path is still refused — it
 * disappears rather than relocating — and a candidate that used to clash with
 * a now-refused neighbour may newly appear, at its own index-fixed spot. The
 * guarantee is *locality*: a change here cannot move scenery over there.
 *
 * Note that `generateStoneRuns` has always been immune, by accident rather
 * than design — it draws a fixed five values per attempt and tests last. That
 * is the shape this helper generalises.
 *
 * `index` is multiplied by the 32-bit golden-ratio constant before it reaches
 * the seed, so that neighbouring indices land far apart in seed space rather
 * than relying on mulberry32's finaliser alone to decorrelate `n` from `n + 1`.
 * Consecutive candidates supply a scatter's angle *and* radius, so a
 * correlation between them would show up as trees in visible stripes.
 */
export function candidateRng(salt: number, index: number): Rng {
  return new Rng((salt ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
}
