/**
 * **`check:hot-path-churn` — per-frame garbage and material re-validation,
 * counted** (120 fps plan, item 16 / step 18; issue #763).
 *
 * Counts, not timings, so it means the same thing on a loaded laptop and in
 * CI. Runs on Node with no browser. Three questions:
 *
 * 1. **The slide chute** — no part of a `SlideRide` is a material three.js
 *    draws in two passes (`transparent`, `DoubleSide`, not `forceSinglePass`).
 *    Each such mesh costs two `material.needsUpdate` a frame for as long as it
 *    is on screen. And the two meshes that replace it are in back-then-front
 *    creation order, which is what keeps the picture what it was.
 * 2. **`sampleSpine` is three.js's own answer** — bit for bit the point
 *    `getPointAt` and the tangent `getTangentAt` give.
 * 3. **A snake's `update` does not allocate through its spine** — no
 *    targetless `getPoint` at all, three evaluations a segment for a crawler,
 *    and none for a snake that is lying still.
 *
 * What it does **not** cover, said on every run: it measures the slide and the
 * snake only. Bytes per second in the running game are the sampling heap
 * profiler's, in a browser.
 */
import './headless-canvas.mjs';
import { CatmullRomCurve3, DoubleSide, Material, Mesh, Vector3 } from 'three';
import { createSnake, sampleSpine } from '../src/art/models/snake.ts';
import { SlideRide } from '../src/world/building/SlideRide.ts';

const failures: string[] = [];
const say = (line: string): void => {
  process.stderr.write(`[hot-path-churn] ${line}\n`);
};

// --- 1. the slide chute ---------------------------------------------------
const slide = new SlideRide(
  [new Vector3(0, 12, 0), new Vector3(6, 9, 2), new Vector3(12, 5, -2), new Vector3(18, 1, 0)],
  { name: 'probe-slide' },
);
let slideMeshes = 0;
let twoPass = 0;
const clear: Mesh[] = [];
slide.group.traverse((node) => {
  if (!(node instanceof Mesh)) return;
  slideMeshes += 1;
  const materials: Material[] = Array.isArray(node.material) ? node.material : [node.material];
  for (const material of materials) {
    if (material.transparent && material.side === DoubleSide && !material.forceSinglePass) {
      twoPass += 1;
      failures.push(
        `slide mesh "${node.name}" has a transparent DoubleSide material: three.js re-validates it twice a frame (#763)`,
      );
    }
    if (material.transparent) clear.push(node);
  }
});
say(`slide: ${slideMeshes} meshes, ${twoPass} two-pass materials (2 material re-validations a frame each), ${clear.length} see-through meshes`);
if (slideMeshes < 4) failures.push(`the probe slide has ${slideMeshes} meshes — expected the chute, its see-through half and two rails; this check is measuring nothing`);
if (clear.length !== 2) {
  failures.push(`the see-through chute is ${clear.length} meshes, expected 2 (far wall, near wall)`);
} else {
  const [far, near] = clear as [Mesh, Mesh];
  const sides = [(far.material as Material).side, (near.material as Material).side];
  // BackSide = 1, FrontSide = 0.
  if (sides[0] !== 1 || sides[1] !== 0) failures.push(`the see-through chute's sides are [${sides.join(', ')}], expected [1 (BackSide), 0 (FrontSide)] in creation order`);
  if (far.id >= near.id) failures.push(`the far-wall mesh (id ${far.id}) must be created before the near-wall mesh (id ${near.id}): equal depth sorts by id`);
  if (far.geometry !== near.geometry) failures.push('the two see-through meshes must share one geometry, or the walls can drift apart');
  if (far.castShadow || near.castShadow) failures.push('a see-through chute section casts a shadow');
  slide.setCastsShadow(true);
  if (far.castShadow || near.castShadow) failures.push('setCastsShadow(true) made a see-through chute section cast a shadow');
}

// --- 2. sampleSpine against three.js ---------------------------------------
const curve = new CatmullRomCurve3(
  [new Vector3(0, 0, 0), new Vector3(1, 0.2, 2), new Vector3(-1.5, 0.1, 3), new Vector3(0.5, 0.4, 5), new Vector3(2, 0, 6)],
  false,
  'centripetal',
);
const p = new Vector3();
const t = new Vector3();
const wantP = new Vector3();
const wantT = new Vector3();
let compared = 0;
let differing = 0;
let worst = 0;
for (let i = 0; i <= 500; i += 1) {
  const u = i / 500;
  sampleSpine(curve, u, p, t);
  curve.getPointAt(u, wantP);
  curve.getTangentAt(u, wantT);
  compared += 1;
  const d = Math.max(p.distanceTo(wantP), t.distanceTo(wantT));
  worst = Math.max(worst, d);
  if (!(d === 0)) differing += 1;
}
say(`sampleSpine: ${compared} samples compared with getPointAt/getTangentAt, ${differing} differ (worst ${worst} m)`);
if (differing > 0) failures.push(`sampleSpine differs from three.js at ${differing} of ${compared} samples (worst ${worst} m) — it must be bit-identical`);

// --- 3. spline evaluations per snake update ---------------------------------
const proto = CatmullRomCurve3.prototype;
const original = proto.getPoint;
let calls = 0;
let targetless = 0;
proto.getPoint = function counted(this: CatmullRomCurve3, at: number, target?: Vector3): Vector3 {
  calls += 1;
  if (!target) targetless += 1;
  return original.call(this, at, target);
};
const FRAMES = 10;
const measure = (label: string, crawl: number | null, perSegmentBudget: number): void => {
  const options = {
    length: 3.2,
    radius: 0.2,
    colourway: 'rainbow' as const,
    seed: 101,
    path: [new Vector3(-1, 0, -1), new Vector3(1, 0, -1), new Vector3(1, 0, 1), new Vector3(-1, 0, 1)],
  };
  const snake = createSnake(crawl === null ? options : { ...options, crawl });
  calls = 0;
  targetless = 0;
  for (let frame = 0; frame < FRAMES; frame += 1) snake.update(1 / 120, frame / 120);
  const perSegment = calls / FRAMES / snake.segmentCount;
  say(`${label}: ${snake.segmentCount} segments, ${calls / FRAMES} spline evaluations a frame (${perSegment} a segment), ${targetless / FRAMES} of them allocating a Vector3`);
  if (snake.segmentCount < 4) failures.push(`${label}: only ${snake.segmentCount} segments — measuring nothing`);
  if (targetless > 0) failures.push(`${label}: ${targetless / FRAMES} targetless getPoint calls a frame — each allocates a Vector3`);
  if (perSegment > perSegmentBudget) failures.push(`${label}: ${perSegment} spline evaluations a segment a frame, budget ${perSegmentBudget}`);
};
measure('crawling snake', 0.18, 3);
measure('resting snake', null, 0);
proto.getPoint = original;

say('covers the slide chute and the snake spine only; bytes per second in the running game are not measured here');

if (failures.length > 0) {
  console.error(`\ncheck:hot-path-churn FAILED:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log('check:hot-path-churn: no two-pass slide material, sampleSpine matches three.js, and no snake allocates through its spine.');
