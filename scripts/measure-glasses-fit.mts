/**
 * **Do the glasses actually sit on the face they are worn on?**
 *
 * ```
 * node --experimental-strip-types \
 *      --import ./scripts/ts-extension-resolver-register.mjs \
 *      scripts/measure-glasses-fit.mts
 * ```
 *
 * The twin of `measure-hat-fit.mts`, for the same reason: a hat's brow line is
 * checked against the head's own eyes rather than trusted by eye, and glasses
 * are worn *on* those same eyes, so the same discipline applies — build the
 * real kid and the real glasses and measure both, never recompute the rule
 * that placed them.
 *
 * Three numbers say whether a pair fits:
 *
 * - **span** — the glasses' own **left-right** extent (`max x − min x`) over
 *   the bare head's own left-right extent. Too narrow and the lenses sit
 *   inside the skull's silhouette; too wide and they read as a prop held in
 *   front of the face rather than worn on it.
 *
 *   Deliberately `max x − min x`, not `measure-hat-fit.mts`'s
 *   `hypot(x, z)`-based "diameter". That measure is right for a hat: a dome
 *   or a brim wraps most of the way round the skull's own vertical axis, so
 *   its horizontal reach really is however far any point sits from that axis
 *   in *any* direction. Glasses are the opposite shape — flat, forward-facing,
 *   and worn well proud of that axis (`kid.glassesAnchor` sits at the eyes'
 *   own depth, out at the eye line) — so a point's distance from the axis is
 *   dominated by how far *forward* it is, not how far *apart* the two lenses
 *   are. An early version of this script measured exactly that and reported
 *   both a 2.53 m bare head and, separately, glasses 1.14× the head's own
 *   `measure-hat-fit.mts` width — two different distortions of the same
 *   mistake, one inflating the head, the other inflating the glasses,
 *   because `hypot(x, z)` about either anchor pulls in whichever object sits
 *   forward of that anchor's own Z. `max x − min x` has no such term: X is a
 *   pure left-right measurement wherever the frame's Z origin is, because
 *   every anchor here is a plain *translated* child of `crown`, never a
 *   rotated one.
 * - **centre offset** — how far the glasses' own horizontal centre drifts from
 *   `kid.glassesAnchor`, which is itself derived from the painted eyes
 *   (`kid.ts`'s `kidEyeCentre`). Should be at, or extremely close to, zero: a
 *   symmetric pair of glasses built about its own local origin and parented to
 *   the anchor with no extra offset has nothing that could move it sideways.
 * - **eye clearance** — the glasses' own vertical centre against the eyes'
 *   real height, both measured, neither assumed.
 */
import '../scripts/headless-canvas.mjs';
import { InstancedMesh, Matrix4, Mesh, Object3D, Vector3, type BufferAttribute } from 'three';
import { createKid } from '../src/art/models/kid.ts';
import { createGlasses, GLASSES_KINDS, type GlassesKind } from '../src/art/models/glasses.ts';

/** Horizontal and vertical extent of a model, about some other object's axes. */
interface Extent {
  /** `max x − min x` — a genuine left-right span, whatever the frame's own Z is. */
  readonly xSpan: number;
  readonly top: number;
  readonly bottom: number;
  /** Horizontal centre of the leftmost/rightmost points, signed — 0 is dead on-axis. */
  readonly centreX: number;
}

/** Every visible vertex of `root`, expressed in `frame`'s space — see `measure-hat-fit.mts`. */
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
  let top = Number.NEGATIVE_INFINITY;
  let bottom = Number.POSITIVE_INFINITY;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  pointsIn(root, frame, (point) => {
    top = Math.max(top, point.y);
    bottom = Math.min(bottom, point.y);
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
  });
  if (top === Number.NEGATIVE_INFINITY) return { xSpan: 0, top: 0, bottom: 0, centreX: 0 };
  return { xSpan: maxX - minX, top, bottom, centreX: (minX + maxX) / 2 };
}

// The bare head's own left-right extent — hair hidden, so a pair of bunches
// (1.82 m across) is never mistaken for what glasses have to fit against. Any
// of the head-mounted anchors gives the same X figures (see the header), so
// `glassesAnchor` is used throughout for one fewer frame in play.
const kid = createKid();
kid.setHatWorn(true);
for (const part of kid.hairParts) part.mesh.visible = false;
const head = extentIn(kid.head, kid.glassesAnchor);
console.log(`kid: bare head ${head.xSpan.toFixed(3)} m across, left ear to right ear\n`);

const header = [
  'glasses'.padEnd(12),
  'span'.padStart(6),
  'centreX'.padStart(8),
  'eyeY off'.padStart(8),
  'halfSpan'.padStart(8),
].join(' ');
console.log(header);
console.log('-'.repeat(header.length));

/**
 * How wide a pair of glasses may be, as a fraction of the bare head, and how
 * far its own centre may drift off the anchor.
 *
 * `MIN_SPAN`/`MAX_SPAN` bracket "worn on the face" the same way
 * `measure-hat-fit.mts`'s do for a hat, with headroom above the three built
 * kinds (0.60–0.64×) for a future one rather than a bound shrink-wrapped to
 * today's numbers. `MAX_CENTRE_DRIFT` is tight because there is no reason for
 * it to be anything but ~0: a symmetric asset parented with no offset has
 * nothing that could move it sideways.
 */
const MIN_SPAN = 0.3;
const MAX_SPAN = 0.72;
const MAX_CENTRE_DRIFT = 0.01;

/**
 * How far a lens's own centre may sit from the eye it is meant to cover, in
 * metres — measured against `kidEyeCentre`, not against this file's own idea
 * of where a lens landed.
 */
const MAX_LENS_OFFSET = 0.05;

const failures: string[] = [];

for (const kind of GLASSES_KINDS as readonly GlassesKind[]) {
  const glasses = createGlasses(kind);
  kid.glassesAnchor.add(glasses.root);
  const worn = extentIn(glasses.root, kid.glassesAnchor);
  kid.glassesAnchor.remove(glasses.root);

  const span = worn.xSpan / head.xSpan;
  const centreY = (worn.top + worn.bottom) / 2;

  console.log(
    [
      kind.padEnd(12),
      span.toFixed(2).padStart(6),
      worn.centreX.toFixed(4).padStart(8),
      `${centreY * 1000 >= 0 ? '+' : ''}${(centreY * 1000).toFixed(1)}mm`.padStart(8),
      (worn.xSpan / 2).toFixed(3).padStart(8),
    ].join(' '),
  );

  if (span < MIN_SPAN || span > MAX_SPAN) {
    failures.push(`${kind} is ${span.toFixed(2)}× the head wide; glasses run ${MIN_SPAN}–${MAX_SPAN}×.`);
  }
  if (Math.abs(worn.centreX) > MAX_CENTRE_DRIFT) {
    failures.push(
      `${kind} is centred ${(worn.centreX * 1000).toFixed(1)} mm off the glasses anchor ` +
        `(limit ${(MAX_CENTRE_DRIFT * 1000).toFixed(0)} mm) — not worn straight.`,
    );
  }
  if (Math.abs(centreY) > MAX_LENS_OFFSET) {
    failures.push(
      `${kind}'s lenses sit ${(centreY * 1000).toFixed(0)} mm from the eyes' own height ` +
        `(limit ${(MAX_LENS_OFFSET * 1000).toFixed(0)} mm).`,
    );
  }
}

if (failures.length > 0) {
  console.error(`\nglasses fit: ${failures.length} problem(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`\nglasses fit: all ${GLASSES_KINDS.length} pairs sit correctly on the face.`);
}
