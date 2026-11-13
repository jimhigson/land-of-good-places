import { describe, expect, it } from 'vitest';
import { DETERMINISTIC_MATH, NATIVE_MATH } from '../src/core/deterministicMath';

/**
 * The ports in `src/core/deterministicMath.ts` against V8's own functions.
 *
 * What this can and cannot show: determinism *across platforms* is measured
 * by the park-identity workflow, which hashes both sets on x64 and arm64 and
 * fails on any difference in the ports. This file checks that the ports are
 * *right*: within an ulp or so of native over a broad sweep, and exactly
 * native on every special value (±0, ±Infinity, NaN, domain edges).
 */

type Name = keyof typeof DETERMINISTIC_MATH;

const bits = new BigInt64Array(1);
const asFloat = new Float64Array(bits.buffer);
/** A double's position on the number line, as an integer, so ulps are a subtraction. */
const ordinal = (x: number): bigint => {
  asFloat[0] = x;
  const v = bits[0]!;
  return v < 0n ? -(v & 0x7fffffffffffffffn) : v;
};
const ulps = (a: number, b: number): number => {
  if (Number.isNaN(a) && Number.isNaN(b)) return 0;
  if (Object.is(a, b)) return 0;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  const d = ordinal(a) - ordinal(b);
  return Number(d < 0n ? -d : d);
};

let state = 0x2545f491;
const random = (): number => {
  state ^= state << 13;
  state >>>= 0;
  state ^= state >>> 17;
  state ^= state << 5;
  state >>>= 0;
  return state / 4294967296;
};
/** Magnitudes spread over many decades, both signs. */
const wide = (decades: number, below: number): number => (random() - 0.5) * 2 * 10 ** (random() * decades - below);

const SPECIALS = [0, -0, 1, -1, 0.5, -0.5, 2, -2, Infinity, -Infinity, NaN, Math.PI, -Math.PI, Math.PI / 2, Math.PI / 4, 1e-300, 5e-324, 1e300, 710, -710, -745.2, 22, -22, 2 ** -28, 2 ** 31, 2 ** 64, 823_549, 823_551];

const SAMPLES = 100_000;
const sample: Record<Name, () => number[]> = {
  sin: () => [wide(40, 10)],
  cos: () => [wide(40, 10)],
  tan: () => [wide(40, 10)],
  atan: () => [wide(20, 10)],
  atan2: () => [wide(12, 6), wide(12, 6)],
  asin: () => [random() * 2 - 1],
  acos: () => [random() * 2 - 1],
  exp: () => [(random() - 0.5) * (random() < 0.5 ? 2 : 1400)],
  expm1: () => [(random() - 0.5) * (random() < 0.5 ? 2 : 1400)],
  log: () => [Math.abs(wide(40, 20))],
  pow: () => [random() < 0.8 ? Math.abs(wide(8, 4)) : Math.round(wide(3, 0)), random() < 0.3 ? Math.round((random() - 0.5) * 20) : (random() - 0.5) * 20],
  sinh: () => [(random() - 0.5) * (random() < 0.5 ? 2 : 1400)],
  cosh: () => [(random() - 0.5) * (random() < 0.5 ? 2 : 1400)],
  tanh: () => [(random() - 0.5) * (random() < 0.5 ? 2 : 50)],
};

/**
 * Largest disagreement with native, in ulps. Native is not the truth either:
 * at the worst tanh point the port is 1.9 ulp from the 50-digit answer and
 * native 0.6, inside fdlibm's own bound for the hyperbolics.
 */
const TOLERANCE: Record<Name, number> = { sin: 1, cos: 1, tan: 1, atan: 1, atan2: 1, asin: 1, acos: 1, exp: 1, expm1: 1, log: 1, pow: 1, cosh: 1, sinh: 2, tanh: 3 };

describe('deterministic Math', () => {
  it('is what the suite runs on (installed by the vitest setup file)', () => {
    for (const [name, fn] of Object.entries(DETERMINISTIC_MATH)) {
      expect((Math as unknown as Record<string, unknown>)[name], `Math.${name}`).toBe(fn);
    }
  });

  for (const name of Object.keys(DETERMINISTIC_MATH) as Name[]) {
    it(`${name} agrees with native to ${TOLERANCE[name]} ulp, and exactly on special values`, () => {
      const port = DETERMINISTIC_MATH[name] as (...args: number[]) => number;
      const native = NATIVE_MATH[name];
      const two = name === 'atan2' || name === 'pow';
      for (const a of SPECIALS) {
        for (const b of two ? SPECIALS : [0]) {
          const args = two ? [a, b] : [a];
          const got = port(...args);
          const want = native(...args);
          // At a domain edge or a non-finite value the answer is exact, not approximate.
          if (!Number.isFinite(want) || !Number.isFinite(got) || want === 0 || Math.abs(want) === 1) {
            expect(Object.is(got, want) || (Number.isNaN(got) && Number.isNaN(want)), `${name}(${args.join(', ')}) = ${got}, native ${want}`).toBe(true);
          } else {
            expect(ulps(got, want), `${name}(${args.join(', ')}) = ${got}, native ${want}`).toBeLessThanOrEqual(TOLERANCE[name]);
          }
        }
      }
      let worst = 0;
      let worstArgs: number[] = [];
      for (let i = 0; i < SAMPLES; i += 1) {
        const args = sample[name]();
        const u = ulps(port(...args), native(...args));
        if (u > worst) {
          worst = u;
          worstArgs = args;
        }
      }
      expect(worst, `${name}: worst ${worst} ulp at (${worstArgs.join(', ')})`).toBeLessThanOrEqual(TOLERANCE[name]);
    });
  }
});

/**
 * **The ports' exact outputs, pinned.** Agreeing with native to an ulp is not
 * enough here: every prebuilt park was solved with these functions, so a
 * change that moves any output by one bit — a refactor for speed, say — is a
 * different park on some seed. This hashes each function's 64-bit answers over
 * a fixed sweep and compares them with the digests recorded from the shipped
 * implementation. A digest may only change together with a deliberate change
 * to what the functions compute, never as a side effect of how.
 *
 * The inputs are built from integer operations only (random bit patterns, and
 * integers scaled by exact powers of two), so they are the same doubles on
 * every platform; NaN answers hash as one canonical NaN, because the sign of a
 * NaN that `x - x` produces is the CPU's choice, not fdlibm's.
 *
 * Recorded against `origin/main` at 9b5e89e3, before the step-6 allocation
 * rewrite, and re-proved after it: 188 million calls compared old against new
 * bit for bit, 0 differing, with a one-sign mutant of `remPio2` as the control
 * (1,138,280 differing). The same mutant turns this test red on `sin`, `cos`
 * and `tan` and leaves the other eleven digests alone.
 */
describe('deterministic Math: outputs are pinned bit for bit', () => {
  const words = new Uint32Array(2);
  const asDouble = new Float64Array(words.buffer);
  let seed = 0x6a09e667;
  const next32 = (): number => {
    seed ^= seed << 13;
    seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return seed;
  };
  /** Any double at all: every exponent, subnormals, ±0, ±Infinity, NaN. */
  const anyDouble = (): number => {
    words[0] = next32();
    words[1] = next32();
    return asDouble[0]!;
  };
  /**
   * A signed 32-bit integer scaled into (-2^shift, 2^shift): exact, so
   * platform-free. The scale is built by halving, not with `**` (V8's own pow).
   */
  const scaled = (shift: number): number => {
    let scale = 1;
    for (let k = 0; k < 31 - shift; k += 1) scale /= 2;
    return (next32() | 0) * scale;
  };

  const N = 20_000;
  const inputs = (name: Name): number[][] => {
    seed = 0x6a09e667;
    const out: number[][] = [];
    for (let i = 0; i < N; i += 1) {
      const pick = i % 4;
      const x = pick === 0 ? anyDouble() : pick === 1 ? scaled(1) : pick === 2 ? scaled(5) : scaled(21);
      const y = pick === 0 ? anyDouble() : scaled(3);
      out.push(name === 'atan2' || name === 'pow' ? [x, y] : [x]);
    }
    return out;
  };
  const digest = (name: Name): string => {
    const fn = DETERMINISTIC_MATH[name] as (...args: number[]) => number;
    // Two FNV-1a streams over the answer's two 32-bit words, read in opposite
    // orders: 64 bits of digest from integer arithmetic alone.
    let a = 0x811c9dc5;
    let b = 0x01000193;
    const cell = new Float64Array(1);
    const cellWords = new Uint32Array(cell.buffer);
    for (const args of inputs(name)) {
      const r = fn(...args);
      cell[0] = r;
      if (r !== r) {
        // Canonical quiet NaN: the sign of `x - x`'s NaN is the CPU's choice.
        cellWords[1] = 0x7ff80000;
        cellWords[0] = 0;
      }
      a = Math.imul(a ^ cellWords[0]!, 0x01000193) >>> 0;
      a = Math.imul(a ^ cellWords[1]!, 0x01000193) >>> 0;
      b = Math.imul(b ^ cellWords[1]!, 0x811c9dc5 | 1) >>> 0;
      b = Math.imul(b ^ cellWords[0]!, 0x811c9dc5 | 1) >>> 0;
    }
    return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
  };

  const PINNED: Record<Name, string> = {
    sin: '8779d7ab390e9055',
    cos: '73dd18621a472554',
    tan: 'c44634b764880165',
    atan: '70efe38f25d40199',
    atan2: 'f40516175dcc72cd',
    asin: '2811f20f04a6e007',
    acos: 'b75d310f4a4aa801',
    exp: '35b6a5fc52d4eb70',
    log: '2ce7fc297c1e6d31',
    pow: '35f36a67f14d9fb1',
    expm1: '580edffdd6975179',
    sinh: '77b1575af15df3c4',
    cosh: '51a140303bbc3bd0',
    tanh: '1bfba8ce4d109f5e',
  };

  it('every function', () => {
    const got = Object.fromEntries((Object.keys(DETERMINISTIC_MATH) as Name[]).map((name) => [name, digest(name)]));
    process.stderr.write(`deterministic Math digests: ${JSON.stringify(got)}\n`);
    expect(got).toEqual(PINNED);
  });
});
