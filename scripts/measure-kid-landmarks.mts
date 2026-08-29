/**
 * **Where are a child's joints, actually?**
 *
 * ```
 * npm run measure:kid-landmarks
 * ```
 *
 * Prints every landmark on a real `createKid()` that something in the park
 * might be built *on* — the hip a seat is cut to, the shoulder a window sill
 * follows, how high a hand reaches — measured off the built model's own world
 * matrices and visible vertices.
 *
 * **Why this exists.** `kid.ts` published a total height and a shoulder height
 * and nothing else, so anything sizing furniture for a child had no landmark
 * below her neck to size it *from*, and reached for adult proportions scaled
 * down by eye instead. The castle's batch 1 is what that costs: a bench seat at
 * 0.55 m against a 0.36 m hip, and a table top at 1.05 m against a hand that
 * reaches 1.04 m — furniture a child can neither sit on nor reach across, built
 * to a contract, passing every assertion, and wrong. Nobody had the numbers.
 *
 * These are chibi proportions and they defeat intuition completely: more than
 * half of a 2.12 m child is head, her whole leg is 0.36 m, and her whole arm is
 * 0.32 m. Anyone sizing a seat, a counter or a shelf by imagining a small human
 * will be out by a factor of two, and — as the castle found — will not find out
 * until a rendered picture shows a child unable to use the thing.
 *
 * This only prints. The two landmarks that are published as constants,
 * {@link KID_HIP_HEIGHT} and {@link KID_REACH_HEIGHT}, are *asserted* against
 * the built rig by `check:character-parity`, which is in the build chain — so
 * they cannot drift. Run this when you need a landmark that is not published
 * yet, or to see where a published one came from.
 */
import './headless-canvas.mjs';
import { Vector3, type Object3D } from 'three';
import {
  createKid,
  KID_HEIGHT,
  KID_HIP_HEIGHT,
  KID_REACH_HEIGHT,
  KID_SHOULDER_HEIGHT,
} from '../src/art/models/kid.ts';
import { visiblePoints } from '../src/art/style/measure.ts';

const kid = createKid();
const root = kid.root;
root.updateMatrixWorld(true);

/** A named node's world height, in metres. */
function jointY(name: string): number {
  const node: Object3D | undefined = root.getObjectByName(name);
  if (!node) throw new Error(`measure:kid-landmarks: no node named '${name}'.`);
  return node.getWorldPosition(new Vector3()).y;
}

/**
 * The vertical span of one node's own visible geometry, in the kid's frame.
 *
 * `visiblePoints` rather than a bounding box, and in the *root's* frame rather
 * than the node's, so a part measured here reports the same number as the same
 * part measured by any other script in this repo — the rules about which meshes
 * count (hidden ones do not, instances are expanded) live in one place.
 */
function meshSpan(name: string): { bottom: number; top: number } | null {
  const node: Object3D | undefined = root.getObjectByName(name);
  if (!node) return null;
  let top = -Infinity;
  let bottom = Infinity;
  visiblePoints(
    node,
    (p) => {
      if (p.y > top) top = p.y;
      if (p.y < bottom) bottom = p.y;
    },
    root,
  );
  return top === -Infinity ? null : { bottom, top };
}

const hip = jointY('leg-pivot-l');
const armPivot = jointY('arm-pivot-l');
const handRest = jointY('hand-l');
const armLength = armPivot - handRest;
const reach = armPivot + armLength;

let top = -Infinity;
visiblePoints(root, (p) => {
  if (p.y > top) top = p.y;
});

console.log('\nmeasure:kid-landmarks — off a real createKid()\n');

const rows: [string, number, string][] = [
  ['hip pivot (the whole leg)', hip, 'a seat at this height puts her feet on the floor'],
  ['hands, hanging at rest', handRest, 'only 0.04 m above the hip — the arms are tiny'],
  ['arm pivot (shoulder joint)', armPivot, 'what the arm actually swings from'],
  ['reach, arm straight up', reach, `pivot + a ${armLength.toFixed(2)} m arm`],
  ['top of the torso', meshSpan('torso')?.top ?? NaN, `KID_SHOULDER_HEIGHT is ${KID_SHOULDER_HEIGHT}`],
  ['head pivot', jointY('head'), ''],
  ['top of the hair', top, 'this style only; hats go far higher'],
];
for (const [name, value, note] of rows) {
  console.log(`  ${name.padEnd(30)} ${value.toFixed(4)} m${note ? `   — ${note}` : ''}`);
}

console.log('\n  part spans, in the kid’s own frame:');
for (const name of ['foot-l', 'leg-upper-l', 'hand-l', 'torso', 'skull']) {
  const span = meshSpan(name);
  if (span) {
    console.log(`    ${name.padEnd(14)} ${span.bottom.toFixed(4)} .. ${span.top.toFixed(4)} m`);
  }
}

console.log(`\n  published: KID_HIP_HEIGHT ${KID_HIP_HEIGHT}, KID_REACH_HEIGHT ${KID_REACH_HEIGHT},`);
console.log(`             KID_SHOULDER_HEIGHT ${KID_SHOULDER_HEIGHT}, KID_HEIGHT ${KID_HEIGHT}`);
console.log('  check:character-parity asserts the first two against this rig.\n');
