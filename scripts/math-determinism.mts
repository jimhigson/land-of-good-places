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
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

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

const fns: Record<string, (i: number) => number> = {
  sin: (i) => Math.sin(inputs[i]!),
  cos: (i) => Math.cos(inputs[i]!),
  tan: (i) => Math.tan(inputs[i]!),
  atan: (i) => Math.atan(inputs[i]!),
  atan2: (i) => Math.atan2(inputs[i]!, inputs[(i * 7 + 3) % N]!),
  asin: (i) => Math.asin(unit[i]!),
  acos: (i) => Math.acos(unit[i]!),
  exp: (i) => Math.exp(unit[i]! * 20),
  log: (i) => Math.log(positive[i]!),
  pow: (i) => Math.pow(positive[i]!, unit[i]! * 3),
  powOp: (i) => positive[i]! ** (unit[i]! * 3),
  cbrt: (i) => Math.cbrt(inputs[i]!),
  hypot2: (i) => Math.hypot(inputs[i]!, inputs[(i * 7 + 3) % N]!),
  hypot3: (i) => Math.hypot(inputs[i]!, inputs[(i * 7 + 3) % N]!, inputs[(i * 13 + 5) % N]!),
  sqrt: (i) => Math.sqrt(positive[i]!),
  sinh: (i) => Math.sinh(unit[i]! * 5),
  tanh: (i) => Math.tanh(unit[i]! * 5),
  log2: (i) => Math.log2(positive[i]!),
  expm1: (i) => Math.expm1(unit[i]!),
  fround: (i) => Math.fround(inputs[i]!),
};

const view = new DataView(new ArrayBuffer(8));
const result: Record<string, string> = {};
for (const [name, fn] of Object.entries(fns)) {
  const hash = createHash('sha256');
  for (let i = 0; i < N; i += 1) {
    view.setFloat64(0, fn(i));
    hash.update(new Uint8Array(view.buffer));
  }
  result[name] = hash.digest('hex').slice(0, 16);
}
writeFileSync(out, `${JSON.stringify({ platform: `${process.platform}-${process.arch}`, node: process.version, v8: process.versions.v8, result }, null, 1)}\n`);
process.stderr.write(`math-determinism: ${Object.keys(result).length} functions hashed -> ${out}\n`);
