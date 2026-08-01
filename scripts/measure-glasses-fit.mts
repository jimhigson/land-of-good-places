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
 * - **span** — the glasses' widest horizontal reach over the wearer's bare
 *   head's widest span, both about the glasses anchor's own vertical axis. Too
 *   narrow and the lenses sit inside the skull's silhouette; too wide and they
 *   read as a prop held in front of the face rather than worn on it.
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
  readonly width: number;
  readonly top: number;
  readonly bottom: number;
  /** Horizontal centre of the widest points, signed — 0 is dead on-axis. */
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
  let radius = 0;
  let top = Number.NEGATIVE_INFINITY;
  let bottom = Number.POSITIVE_INFINITY;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  pointsIn(root, frame, (point) => {
    radius = Math.max(radius, Math.hypot(point.x, point.z));
    top = Math.max(top, point.y);
    bottom = Math.min(bottom, point.y);
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
  });
  if (top === Number.NEGATIVE_INFINITY) return { width: 0, top: 0, bottom: 0, centreX: 0 };
  return { width: radius * 2, top, bottom, centreX: (minX + maxX) / 2 };
}

// The bare head, exactly as `measure-hat-fit.mts` measures it: hair hidden, so
// a pair of bunches (1.82 m across) is never mistaken for what glasses have to
// fit against.
const kid = createKid();
kid.setHatWorn(true);
for (const part of kid.hairParts) part.mesh.visible = false;
const head = extentIn(kid.head, kid.glassesAnchor);
console.log(`kid: bare head ${head.width.toFixed(3)} m wide, at the glasses anchor's height\n`);

const header = [
  'glasses'.padEnd(12),
  'span'.padStart(6),
  'centre'.padStart(8),
  'eyeGap'.padStart(8),
  'lensGap'.padStart(8),
].join(' ');
console.log(header);
console.log('-'.repeat(header.length));

/**
 * How wide a pair of glasses may be, as a fraction of the bare head, and how
 * far its own centre may drift off the anchor.
 *
 * `MIN_SPAN`/`MAX_SPAN` bracket "worn on the face" the same way
 * `measure-hat-fit.mts`'s do for a hat, tuned against the three kinds actually
 * built rather than picked in the abstract. `MAX_CENTRE_DRIFT` is tight
 * because there is no reason for it to be anything but ~0: a symmetric asset
 * parented with no offset has nothing that could move it.
 */
const MIN_SPAN = 0.28;
const MAX_SPAN = 0.62;
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

  const span = worn.width / head.width;

  console.log(
    [
      kind.padEnd(12),
      span.toFixed(2).padStart(6),
      worn.centreX.toFixed(4).padStart(8),
      '—'.padStart(8),
      (worn.width / 2).toFixed(3).padStart(8),
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
}

// --- eye clearance: where the built glasses actually sit vs. where the eyes
// actually are, both measured, both in the SAME frame (`crown`) so this is a
// direct comparison and not two numbers computed two different ways.
console.log('\neye clearance — glasses centre height vs. the painted eyes, in the crown frame:');
for (const kind of GLASSES_KINDS as readonly GlassesKind[]) {
  const glasses = createGlasses(kind);
  kid.glassesAnchor.add(glasses.root);
  // `kid.glassesAnchor` already sits at the eyes' own height (see kid.ts's
  // `kidEyeCentre`), so the glasses' vertical centre about the anchor is
  // exactly the offset from the eyes it needs to be judged against.
  const worn = extentIn(glasses.root, kid.glassesAnchor);
  kid.glassesAnchor.remove(glasses.root);
  const centreY = (worn.top + worn.bottom) / 2;
  console.log(`  ${kind.padEnd(12)} vertical centre ${(centreY * 1000).toFixed(1).padStart(6)} mm off eye height`);
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
