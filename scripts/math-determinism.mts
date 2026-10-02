/**
 * **Which of JavaScript's `Math` functions answer differently on this machine?**
 *
 * The park-identity comparison found Linux x64 and Mac arm64 making different
 * world-phase decisions from identical inputs (seeds 0, 2, 4, 8, 11). JS
 * `+ - * /` and `Math.sqrt` are correctly rounded IEEE operations on every
 * platform; the transcendental functions are not required to be, and an engine
 * built for arm64 can differ from one built for x64 by an ulp. This hashes each
 * function's exact bits over a fixed input sweep, so two platforms' outputs
 * can be compared function by function. Writes JSON to the path given.
 *
 * It hashes two sets. `native` is V8's own, which is the control: it must keep
 * showing the platforms differ, or this measurement can no longer see the
 * difference the ports exist to remove. `deterministic` is
 * `src/core/deterministicMath.ts`, which must come out identical. The
 * park-identity workflow compares both and fails if a deterministic hash
 * differs.
 *
 * Run it **without** the resolver `--import`: that installs the ports on the
 * global `Math`, and the native set would then be hashing the ports twice.
 * The script checks this and refuses.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { DETERMINISTIC_MATH, NATIVE_MATH } from '../src/core/deterministicMath.ts';

const out = process.argv[2];
if (!out) throw new Error('usage: math-determinism.mts <out.json>');

// A fixed xorshift stream: identical inputs on every platform (integer ops only).
let state = 0x9e3779b9;
const next = (): number => {
  state ^= state << 13;
  state >>>= 0;
  state ^= state >>> 17;
  state ^= state << 5;
  state >>>= 0;
  return state / 4294967296;
};
const N = 200_000;
const inputs = Array.from({ length: N }, () => (next() - 0.5) * 400);
const unit = Array.from({ length: N }, () => next() * 2 - 1);
const positive = Array.from({ length: N }, () => next() * 300 + 1e-6);

if (Math.sin === DETERMINISTIC_MATH.sin) {
  throw new Error('math-determinism: the ports are already on the global Math, so the native control would measure them; run without the resolver --import');
}

type MathSet = { readonly [K in keyof typeof NATIVE_MATH]: (...args: number[]) => number };
const sweep = (M: MathSet): Record<string, (i: number) => number> => ({
  sin: (i) => M.sin(inputs[i]!),
  cos: (i) => M.cos(inputs[i]!),
  // Angles from 1e-10 to 1e29, so the huge-argument reduction is measured too.
  sinWide: (i) => M.sin(inputs[i]! * 10 ** ((i % 40) - 12)),
  cosWide: (i) => M.cos(inputs[i]! * 10 ** ((i % 40) - 12)),
  tan: (i) => M.tan(inputs[i]!),
  atan: (i) => M.atan(inputs[i]!),
  atan2: (i) => M.atan2(inputs[i]!, inputs[(i * 7 + 3) % N]!),
  asin: (i) => M.asin(unit[i]!),
  acos: (i) => M.acos(unit[i]!),
  exp: (i) => M.exp(unit[i]! * 20),
  log: (i) => M.log(positive[i]!),
  pow: (i) => M.pow(positive[i]!, unit[i]! * 3),
  powOp: (i) => positive[i]! ** (unit[i]! * 3), // the operator: V8's own pow whichever set
  cosh: (i) => M.cosh(unit[i]! * 5),
  cbrt: (i) => Math.cbrt(inputs[i]!),
  hypot2: (i) => Math.hypot(inputs[i]!, inputs[(i * 7 + 3) % N]!),
  hypot3: (i) => Math.hypot(inputs[i]!, inputs[(i * 7 + 3) % N]!, inputs[(i * 13 + 5) % N]!),
  sqrt: (i) => Math.sqrt(positive[i]!),
  sinh: (i) => M.sinh(unit[i]! * 5),
  tanh: (i) => M.tanh(unit[i]! * 5),
  log2: (i) => Math.log2(positive[i]!),
  expm1: (i) => M.expm1(unit[i]!),
  fround: (i) => Math.fround(inputs[i]!),
});

const view = new DataView(new ArrayBuffer(8));
const hashAll = (fns: Record<string, (i: number) => number>): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const [name, fn] of Object.entries(fns)) {
    const hash = createHash('sha256');
    for (let i = 0; i < N; i += 1) {
      view.setFloat64(0, fn(i));
      hash.update(new Uint8Array(view.buffer));
    }
    result[name] = hash.digest('hex').slice(0, 16);
  }
  return result;
};
const native = hashAll(sweep(NATIVE_MATH));
const deterministic = hashAll(sweep(DETERMINISTIC_MATH as unknown as MathSet));
writeFileSync(
  out,
  `${JSON.stringify({ platform: `${process.platform}-${process.arch}`, node: process.version, v8: process.versions.v8, native, deterministic }, null, 1)}\n`,
);
process.stderr.write(`math-determinism: ${Object.keys(native).length} functions hashed twice (native, deterministic) -> ${out}\n`);
