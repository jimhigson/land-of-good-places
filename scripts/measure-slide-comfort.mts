/**
 * What the ginormous slide feels like, per seed.
 *
 * The tightest bend and the sideways load it puts on a rider are the numbers
 * that decide whether a first-person ride is a swoop or a lurch, and they are
 * coupled (load is v²/r) — so they are reported together, never alone.
 *
 * Run across the procgen seeds with `LGP_SEED`, and keep the output: this is
 * the evidence for whether loosening a constraint actually bought comfort,
 * rather than whether it felt like it should have.
 */
import { Vector3 } from 'three';
import { GIANT_SLIDE_SPEED, SLIDE_PLAN } from '../src/world/slide/plan';

const points = SLIDE_PLAN.points as Vector3[];

let length = 0;
const along: number[] = [0];
for (let i = 1; i < points.length; i += 1) {
  length += points[i]!.distanceTo(points[i - 1]!);
  along.push(length);
}

// Menger curvature over consecutive built points, in plan view — the same way
// `invariants.ts` measures the Sky Cruiser's turns.
let tightest = Infinity;
let at = 0;
let where = points[0]!;
for (let i = 2; i < points.length; i += 1) {
  const a = points[i - 2]!;
  const b = points[i - 1]!;
  const c = points[i]!;
  const ab = Math.hypot(b.x - a.x, b.z - a.z);
  const bc = Math.hypot(c.x - b.x, c.z - b.z);
  const ca = Math.hypot(a.x - c.x, a.z - c.z);
  const twiceArea = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z));
  if (twiceArea < 1e-9) continue;
  const radius = (ab * bc * ca) / (2 * twiceArea);
  if (radius < tightest) {
    tightest = radius;
    at = along[i - 1]!;
    where = b;
  }
}

const g = GIANT_SLIDE_SPEED ** 2 / tightest / 9.81;
const seed = process.env['LGP_SEED'] ?? 'canonical';

console.log(
  `seed ${String(seed).padEnd(9)} ` +
    `${length.toFixed(1)} m, ${(length / GIANT_SLIDE_SPEED).toFixed(1)} s  |  ` +
    `tightest ${tightest.toFixed(2)} m -> ${g.toFixed(2)} g  ` +
    `at ${at.toFixed(1)} m (${((at / length) * 100).toFixed(0)}%), ` +
    `y=${where.y.toFixed(1)}, ${(at / GIANT_SLIDE_SPEED).toFixed(1)} s in`,
);
