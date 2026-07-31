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
 * rules from (hidden meshes and meshes under hidden parents do not count —
 * this file hides every hair part by hand below before measuring the bare
 * head, and measuring a hidden bunch anyway would report one that was never
 * meant to be there).
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
// Hair is hidden by hand here, in full, rather than through `setHatWorn`:
// that call no longer touches hair visibility at all (31 July 2026 — hair is
// now always fully drawn regardless of whether a hat is worn; only Mohican's
// crest is handled specially, by a *worn hat* declining to render instead,
// see `art/models/hair.ts`'s `HairPart.hideUnderHat`), and even before that
// change it only ever tucked the spikes, which no longer applies to Spiky at
// all — spiky and a hat are now allowed to overlap, clipping included.
// Bunches were always left alone by it, and they hang out to 1.82 m across —
// comparing a hat's brim against a pair of bunches would say the sun hat is too narrow
// when it is the skull, at the crown, that a hat has to look right against.
// `setHatWorn(true)` is still called, purely so `kid.height` below re-measures.
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

/**
 * How wide a hat may be, as a fraction of the bare head, and how far past her
 * own height a hat may take the wearer.
 *
 * Both bounds are set from the two failures this script was written for, not
 * from taste: the un-scaled hats measured **0.33–0.67** across (a party hat at
 * 0.38 is the "much too small" the family reported), and the old RiPika head
 * took the wearer to **1.72×** her height. The park's real range is now
 * 0.49–1.01 wide and up to 1.38× tall, so every bound below has room for a new
 * hat with its own character and none for either mistake coming back.
 */
const MIN_SPAN = 0.45;
const MAX_SPAN = 1.15;
const MAX_TIP = 1.45;

interface Row {
  readonly kind: HatKind;
  readonly grip: number;
  readonly span: number;
}
const rows: Row[] = [];
const failures: string[] = [];

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
  if (span < MIN_SPAN || span > MAX_SPAN) {
    failures.push(
      `${kind} is ${span.toFixed(2)}× the head wide; hats run ${MIN_SPAN}–${MAX_SPAN}×.`,
    );
  }
  if (tip / kidHeight > MAX_TIP) {
    failures.push(
      `${kind} takes the wearer to ${(tip / kidHeight).toFixed(2)}× her own height ` +
        `(limit ${MAX_TIP}×) — that is a second head, not a hat.`,
    );
  }
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

// `grip` is reported but not gated: a rim narrower than the skull at its own
// height is *buried* in the head, which is how a band grips rather than hovers
// (see `SIT` in `hats.ts`), so under 1 is right and the only question is how
// far under. `span` is the number that says "too small" out loud.
console.log(
  '\nwidth/head = the hat at its lowest ring against the skull there;\n' +
    'grip = that ratio (a rim buries, so ≲ 1); span = widest ÷ bare head.',
);
const loose = rows.reduce((a, b) => (b.grip < a.grip ? b : a));
const narrow = rows.reduce((a, b) => (b.span < a.span ? b : a));
console.log(
  `deepest-buried rim: ${loose.kind} at ${loose.grip.toFixed(2)}×; ` +
    `narrowest hat: ${narrow.kind} at ${narrow.span.toFixed(2)}× the head.`,
);

if (failures.length > 0) {
  console.error(`\nhat fit: ${failures.length} hat(s) do not fit the head:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`hat fit: all ${rows.length} hats fit the head they sit on.`);
}
