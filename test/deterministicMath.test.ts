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
