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
