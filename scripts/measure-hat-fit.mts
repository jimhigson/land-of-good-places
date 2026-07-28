/**
 * **Does each hat actually fit the head it is worn on?**
 *
 * ```
 * node --experimental-strip-types \
 *      --import ./scripts/ts-extension-resolver-register.mjs \
 *      scripts/measure-hat-fit.mts
 * ```
 *
 * `check:assets` already guards a hat's *declared* height against its built
 * one. Nothing guarded the thing the family actually complained about: how big
 * a hat is **next to the head it sits on**. Hats are authored in
 * `art/models/hats.ts` in absolute metres; the kid's skull is authored in
 * `art/models/kid.ts` as `0.44 * HEAD`. When the cartoon pass took `HEAD` to
 * 1.5 every head-mounted thing scaled with it — hair, ears, face patch, the
 * hat anchor itself — except the hats, which are in another file and carry no
 * reference to it. So every hat shrank to two thirds of its intended fit
 * overnight and no check noticed.
 *
 * This builds the real kid and the real hats and measures both, then prints
 * the one number that says whether a hat fits: **width ratio**, the hat's
 * widest horizontal span over the wearer's bare head's widest span, both
 * measured about the same vertical axis (the hat anchor's), so a tilted sun
 * brim is measured where it really is rather than through an axis-aligned box.
 *
 * Vertices, not bounding boxes, and instanced meshes expanded — same reasons
 * as `art/style/measure.ts`, whose `visibleBounds` this borrows the traversal
 * rules from (hidden meshes and meshes under hidden parents do not count: the
 * kid tucks her hair away under a hat, and measuring it would report a bunch).
 */
import '../scripts/headless-canvas.mjs';
import { InstancedMesh, Matrix4, Mesh, Object3D, Vector3, type BufferAttribute } from 'three';
import { createKid } from '../src/art/models/kid.ts';
import { createHat, HAT_KINDS, type HatKind } from '../src/art/models/hats.ts';

/** Horizontal and vertical extent of a model, about some other object's axes. */
interface Extent {
  /** Widest span across the frame's vertical axis, in metres. */
  readonly width: number;
  /** Highest visible point above the frame's origin, in metres. */
  readonly top: number;
  /** Lowest visible point, in metres. Negative below the frame's origin. */
  readonly bottom: number;
}

/**
 * Every visible vertex of `root`, expressed in `frame`'s space.
 *
 * Vertices, not bounding boxes, and instanced meshes expanded per instance —
 * the sun hat is worn at a tilt and the flower crown's six blooms live in an
 * `instanceMatrix`, so either shortcut would report a different hat.
 */
function pointsIn(root: Object3D, frame: Object3D, visit: (point: Vector3) => void): void {
  root.updateMatrixWorld(true);
  frame.updateMatrixWorld(true);
  const toFrame = new Matrix4().copy(frame.matrixWorld).invert();
  const point = new Vector3();
  const instance = new Matrix4();
  const combined = new Matrix4();

  root.traverse((object) => {
    if (!(object instanceof Mesh) || !object.visible) return;
    for (let node = object.parent; node; node = node.parent) {
      if (!node.visible) return;
    }
    const position = object.geometry.getAttribute('position');
    if (!position) return;

    const instances = object instanceof InstancedMesh ? object.count : 1;
    for (let n = 0; n < instances; n += 1) {
      if (object instanceof InstancedMesh) {
        object.getMatrixAt(n, instance);
        combined.multiplyMatrices(object.matrixWorld, instance);
      } else {
        combined.copy(object.matrixWorld);
      }
      combined.premultiply(toFrame);
      for (let i = 0; i < position.count; i += 1) {
        visit(point.fromBufferAttribute(position as BufferAttribute, i).applyMatrix4(combined));
      }
    }
  });
}

function extentIn(root: Object3D, frame: Object3D): Extent {
  let radius = 0;
  let top = Number.NEGATIVE_INFINITY;
  let bottom = Number.POSITIVE_INFINITY;
  pointsIn(root, frame, (point) => {
    radius = Math.max(radius, Math.hypot(point.x, point.z));
    top = Math.max(top, point.y);
    bottom = Math.min(bottom, point.y);
  });
  if (top === Number.NEGATIVE_INFINITY) return { width: 0, top: 0, bottom: 0 };
  return { width: radius * 2, top, bottom };
}

/** How wide `root` is in a thin horizontal slice at `y`, in `frame`'s space. */
function widthAt(root: Object3D, frame: Object3D, y: number, band = 0.04): number {
  let radius = 0;
  pointsIn(root, frame, (point) => {
    if (Math.abs(point.y - y) > band) return;
    radius = Math.max(radius, Math.hypot(point.x, point.z));
  });
  return radius * 2;
}

// The bare head: skull, ears and face patch, with every hair part hidden.
//
// Hair is excluded deliberately rather than left to `setHatWorn(true)`, which
// only tucks the parts that would spear *through* a hat (the spikes). Bunches
// stay, and they hang out to 1.82 m across — comparing a hat's brim against a
// pair of bunches would say the sun hat is too narrow when it is the skull, at
// the crown, that a hat has to look right against.
const kid = createKid();
kid.setHatWorn(true);
for (const part of kid.hairParts) part.mesh.visible = false;
const head = extentIn(kid.head, kid.hatAnchor);
const kidHeight = kid.height;

console.log(`kid: ${kidHeight.toFixed(3)} m tall, bare head ${head.width.toFixed(3)} m wide`);
console.log(`hat anchor (crown): ${kid.hatAnchorHeight.toFixed(3)} m above the feet\n`);

const header = [
  'hat'.padEnd(12),
  'width'.padStart(7),
  'head'.padStart(7),
  'grip'.padStart(6),
  'span'.padStart(6),
  'rise'.padStart(7),
  'tip'.padStart(7),
  'of kid'.padStart(7),
].join(' ');
console.log(header);
console.log('-'.repeat(header.length));

interface Row {
  readonly kind: HatKind;
  readonly grip: number;
  readonly span: number;
}
const rows: Row[] = [];

for (const kind of HAT_KINDS) {
  const hat = createHat(kind);
  kid.hatAnchor.add(hat.root);
  const worn = extentIn(hat.root, kid.hatAnchor);
  // Where the hat's band or brim meets the skull, and how wide the skull is
  // right there. **This** is fit: a band narrower than the skull it sits on
  // has the head bulging out through it, and no amount of overall width makes
  // up for it. Overall width only says how far a brim reaches past the ears.
  const bandY = worn.bottom;
  const band = widthAt(hat.root, kid.hatAnchor, bandY);
  const skull = widthAt(kid.head, kid.hatAnchor, bandY);
  kid.hatAnchor.remove(hat.root);

  const grip = skull > 0 ? band / skull : 0;
  const span = worn.width / head.width;
  rows.push({ kind, grip, span });

  // `tip` is where the top of the whole child ends up, and `of kid` is that as
  // a multiple of her bare height — a hat that adds three quarters of a child
  // is not a hat, whatever its width says.
  const tip = kid.hatAnchorHeight + worn.top;
  console.log(
    [
      kind.padEnd(12),
      band.toFixed(3).padStart(7),
      skull.toFixed(3).padStart(7),
      grip.toFixed(2).padStart(6),
      span.toFixed(2).padStart(6),
      worn.top.toFixed(3).padStart(7),
      tip.toFixed(3).padStart(7),
      (tip / kidHeight).toFixed(2).padStart(7),
    ].join(' '),
  );
}

console.log(
  '\nwidth/head = the hat at its band; grip = band ÷ skull there (want ≳ 1);\n' +
    'span = widest part ÷ bare head width; rise/tip in metres.',
);
const loose = rows.reduce((a, b) => (b.grip < a.grip ? b : a));
console.log(`worst grip: ${loose.kind} at ${loose.grip.toFixed(2)}×.`);
