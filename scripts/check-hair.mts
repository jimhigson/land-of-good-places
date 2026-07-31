/**
 * **Is the hair still one piece, and still off her face and out of her hands?**
 *
 * ```
 * node --experimental-strip-types \
 *      --import ./scripts/ts-extension-resolver-register.mjs \
 *      scripts/check-hair.mts
 * ```
 *
 * The hair has now been reported broken twice by the family — "long sideburns
 * on a mullet", then a second pass that closed the gaps but still read wrong —
 * and both times the failure was *geometric* and *visible from the first
 * frame*, which is exactly the kind of thing a check can hold. Since 31 July
 * the shape is a Blender-modelled shell (`src/art/models/hairShell.ts`), so
 * this guards the four properties that shape exists to have.
 *
 * **1. It is the surface that was approved.** The Blender session wrote out a
 * sample of its vertices to `hair-blender-probe.json`; the runtime builder has
 * to reproduce them. Blender is a design tool here, not a build step, so
 * nothing else would notice the two drifting apart.
 *
 * **2. It is one closed piece.** Every edge is shared by exactly two triangles.
 * A hairstyle assembled from blobs cannot state that; this one can, and it is
 * the property the family's bug report was about. It also matters for the ink
 * outline: `addOutline` pushes an inverted hull along the vertex normals, and a
 * hull with a hole in it shows the hole.
 *
 * **3. Every fringe stops above the eyes.** Read from `KID_FACE`, the same
 * numbers `createFacePatch` is given, so retuning the face moves the bound.
 * ART_DIRECTION.md §3: the eyes are 80% of the cuteness.
 *
 * **4. Nothing hangs where the arms swing or the backpack sits.** Measured
 * against the real `backpack` and `hand` meshes on a real `createKid`, not
 * against numbers copied out of it.
 *
 * **5. The spikes are actually spikes** (added 31 July, second pass). The
 * family reported `spiky` as a bumpy texture rather than as hair, and the
 * measurement agreed: it built to 2.087 m, *exactly* what `short` builds to on
 * the same shell — nine cones and not one millimetre of extra silhouette,
 * because they were leaning over far enough to stay under the crown. A style
 * whose entire point is its outline needs its outline held, so this asserts
 * both halves of it: the points stand **proud** of the head, and all nine are
 * still **rooted in** it.
 *
 * Thresholds come from the model, never from the generator's own targets — the
 * same rule `test/procgen/invariants.ts` sets out.
 */
import '../scripts/headless-canvas.mjs';
import { readFileSync } from 'node:fs';
import {
  Box3,
  DoubleSide,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Raycaster,
  Vector3,
} from 'three';
import { TAU } from '../src/core/mathUtils.ts';
import { createKid, KID_FACE, KID_HEAD_SCALE, SKULL_RADIUS } from '../src/art/models/kid.ts';
import {
  HAIR_SHELLS,
  hairShellGeometry,
  SHELL_FIRST_VERTEX,
  SHELL_SKINS,
} from '../src/art/models/hairShell.ts';
import { HAIR_STYLES, type HairStyle } from '../src/art/models/hair.ts';

const probes = JSON.parse(
  readFileSync(new URL('./hair-blender-probe.json', import.meta.url), 'utf8'),
) as Record<string, { vertices: number; triangles: number; probes: number[][] }>;

const failures: string[] = [];
const notes: string[] = [];

function check(ok: boolean, message: string): void {
  if (!ok) failures.push(message);
}

// ---------------------------------------------------------------- 1 + 2. shells

/** The crown's tip-back, undone: the shell is authored in the un-tilted frame. */
const HEAD_TILT = 0.17;

for (const [name, spec] of Object.entries(HAIR_SHELLS)) {
  const geometry = hairShellGeometry(spec, SKULL_RADIUS);
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  if (!index) {
    failures.push(`${name}: shell has no index buffer`);
    continue;
  }
  const expected = probes[name];
  if (!expected) {
    failures.push(`${name}: no Blender probe recorded — re-run dump_vertices()`);
    continue;
  }

  check(
    position.count === expected.vertices,
    `${name}: ${position.count} vertices, Blender modelled ${expected.vertices}`,
  );
  check(
    index.count / 3 === expected.triangles,
    `${name}: ${index.count / 3} triangles, Blender modelled ${expected.triangles}`,
  );

  let worstProbe = 0;
  for (const [i, x, y, z] of expected.probes as [number, number, number, number][]) {
    if (i >= position.count) continue;
    worstProbe = Math.max(
      worstProbe,
      Math.abs(position.getX(i) - x),
      Math.abs(position.getY(i) - y),
      Math.abs(position.getZ(i) - z),
    );
  }
  check(worstProbe < 1e-6, `${name}: drifted ${worstProbe.toFixed(9)} m from the Blender model`);

  // Watertight: every edge used by exactly two triangles, in opposite directions.
  const edges = new Map<string, number>();
  for (let t = 0; t < index.count; t += 3) {
    const tri = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
    for (let e = 0; e < 3; e += 1) {
      const a = tri[e] as number;
      const b = tri[(e + 1) % 3] as number;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      edges.set(key, (edges.get(key) ?? 0) + (a < b ? 1 : -1));
    }
  }
  const open = [...edges.values()].filter((v) => v !== 0).length;
  check(open === 0, `${name}: ${open} edge(s) not shared by exactly two facing triangles`);

  let nan = 0;
  for (let i = 0; i < position.count; i += 1) {
    if (!Number.isFinite(position.getX(i) + position.getY(i) + position.getZ(i))) nan += 1;
  }
  check(nan === 0, `${name}: ${nan} non-finite vertices`);

  check(spec.tuckPow >= 1, `${name}: tuckPow ${spec.tuckPow} < 1 creases the shell right round`);

  notes.push(
    `  ${name.padEnd(5)} ${String(position.count).padStart(5)} verts  ` +
      `${String(index.count / 3).padStart(5)} tris  probe drift ${worstProbe.toExponential(1)}`,
  );
}

// ---------------------------------------------------------------- 3. the eyes
//
// The face patch is a sphere sector: `spreadY` of polar angle starting
// `π/2 − spreadY/2 + tilt` from the top of the skull, with the eye band `eyeY`
// of the way down it, and the eyes themselves two ellipses in that sector.
// Those are `createFacePatch`'s own numbers, imported rather than copied.
//
// Measured **per azimuth**, not as one box. An eye is an ellipse: at its outer
// corner it has no height at all, so comparing the lowest hair anywhere in the
// eye's azimuth range against the eye's tallest point fails every style that
// correctly frames a face, which is what the first version of this did.
const eyeTheta =
  Math.PI / 2 - KID_FACE.spreadY / 2 + KID_FACE.tilt + KID_FACE.eyeY * KID_FACE.spreadY;
/** Eye centre azimuth, and the eye's half-width and half-height in radians. */
const eyeCentre = (KID_FACE.eyeGap / 2) * KID_FACE.spreadX;
const eyeHalfW = (KID_FACE.eyeW / 2) * KID_FACE.spreadX;
const eyeHalfH = (KID_FACE.eyeH / 2) * KID_FACE.spreadY;
/** The eye must keep this much clear air above it. An eye with hair on its
 *  lashes reads as a fringe in her eyes, not as a fringe above them. */
const EYE_MARGIN = 0.02;

/** Top of the eye at azimuth `a`, in the shell's own un-tilted frame. */
function eyeTopAt(a: number): number | null {
  const offset = Math.abs(Math.abs(a) - eyeCentre) / eyeHalfW;
  if (offset >= 1) return null;
  const theta = eyeTheta - eyeHalfH * Math.sqrt(1 - offset * offset);
  const y = SKULL_RADIUS * Math.cos(theta);
  const z = SKULL_RADIUS * Math.sin(theta) * Math.cos(a);
  return y * Math.cos(HEAD_TILT) + z * Math.sin(HEAD_TILT);
}

for (const [name, spec] of Object.entries(HAIR_SHELLS)) {
  const position = hairShellGeometry(spec, SKULL_RADIUS).getAttribute('position');
  /** Lowest hair, per azimuth bucket, outer skin only. */
  const BUCKETS = 180;
  const lowest = new Array<number>(BUCKETS).fill(Infinity);
  for (let i = SHELL_FIRST_VERTEX; i < position.count; i += SHELL_SKINS) {
    const x = position.getX(i);
    const z = position.getZ(i);
    if (z <= 0) continue;
    const a = Math.atan2(x, z);
    const bucket = Math.floor(((a + Math.PI) / TAU) * BUCKETS);
    lowest[bucket] = Math.min(lowest[bucket] as number, position.getY(i));
  }
  let worst = Infinity;
  for (let bucket = 0; bucket < BUCKETS; bucket += 1) {
    const hair = lowest[bucket] as number;
    if (!Number.isFinite(hair)) continue;
    const a = ((bucket + 0.5) / BUCKETS) * TAU - Math.PI;
    const top = eyeTopAt(a);
    if (top === null) continue;
    worst = Math.min(worst, hair - (top + EYE_MARGIN));
  }
  check(
    worst > 0,
    `${name}: hair comes ${(-worst * 1000).toFixed(0)} mm below the top of an eye — ` +
      `the fringe is in her eyes`,
  );
  notes.push(`  ${name.padEnd(5)} fringe clears the eyes by ${(worst * 1000).toFixed(0)} mm`);
}

// ------------------------------------------------- 4. the backpack and the hands

function find(root: Object3D, name: string): Object3D[] {
  const found: Object3D[] = [];
  root.traverse((node) => {
    if (node.name === name) found.push(node);
  });
  return found;
}

for (const style of HAIR_STYLES) {
  if (style === 'ponytail' || style === 'longPonytail') continue;
  const kid = createKid({ hairStyle: style, backpack: true });
  kid.root.updateMatrixWorld(true);

  const shells = find(kid.root, `hair.shell.long`)
    .concat(find(kid.root, 'hair.shell.bob'))
    .concat(find(kid.root, 'hair.shell.bowl'))
    .concat(find(kid.root, 'hair.shell.crop'))
    .filter((mesh) => mesh.visible);
  check(shells.length === 1, `${style}: ${shells.length} shell(s) visible, expected exactly 1`);

  const hairPoints: Vector3[] = [];
  for (const shell of shells) {
    const geometry = (shell as Mesh).geometry;
    const position = geometry.getAttribute('position');
    // Outer skin only. A hand tucked inside the cavity is a hand *under* her
    // hair, which is correct; only a hand that reaches the outside is coming
    // through it.
    for (let i = SHELL_FIRST_VERTEX; i < position.count; i += SHELL_SKINS) {
      hairPoints.push(
        new Vector3(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(
          shell.matrixWorld,
        ),
      );
    }
  }

  const bag = find(kid.root, 'backpack')[0];
  if (bag) {
    const box = new Box3().setFromObject(bag);
    const inside = hairPoints.filter((p) => box.containsPoint(p)).length;
    check(inside === 0, `${style}: ${inside} hair vertices inside the backpack`);
  }

  // The hands swing on a fixed arc about the shoulder. Sweep it and keep the
  // closest approach: a fist through a curtain of hair is what makes long hair
  // on a walk cycle look broken, and it is invisible in a still pose. The
  // amplitude is `applyWalk`'s own default swing, at full speed.
  const WALK_SWING = 0.85;
  let closestHand = Infinity;
  for (const hand of find(kid.root, 'hand')) {
    const pivot = hand.parent;
    if (!pivot) continue;
    const rest = hand.position.clone();
    for (let step = -12; step <= 12; step += 1) {
      pivot.rotation.x = (step / 12) * WALK_SWING;
      pivot.updateMatrixWorld(true);
      const centre = rest.clone().applyMatrix4(pivot.matrixWorld);
      for (const p of hairPoints) closestHand = Math.min(closestHand, p.distanceTo(centre));
    }
    pivot.rotation.x = 0;
    pivot.updateMatrixWorld(true);
  }
  // The hand's own radius, measured off the built mesh rather than copied.
  const handMesh = find(kid.root, 'hand')[0] as Mesh | undefined;
  const handBox = handMesh
    ? new Box3().setFromBufferAttribute(handMesh.geometry.getAttribute('position') as never)
    : null;
  const handRadius = handBox ? Math.max(handBox.max.x, handBox.max.y, handBox.max.z) : 0.135;
  check(
    closestHand > handRadius,
    `${style}: a hand passes ${((handRadius - closestHand) * 1000).toFixed(0)} mm through the ` +
      `outside of the hair on the walk cycle`,
  );
  notes.push(
    `  ${style.padEnd(8)} hand clearance ${((closestHand - handRadius) * 1000).toFixed(0)} mm`,
  );

  kid.dispose?.();
}

// ------------------------------------------------------------- 5. spiky is spiky

/** Every visible vertex of `root`, in world space. */
function worldPoints(root: Object3D): Vector3[] {
  root.updateMatrixWorld(true);
  const points: Vector3[] = [];
  root.traverse((node) => {
    if (!(node instanceof Mesh) || !node.visible) return;
    for (let up = node.parent; up; up = up.parent) if (!up.visible) return;
    const position = node.geometry.getAttribute('position');
    if (!position) return;
    for (let i = 0; i < position.count; i += 1) {
      points.push(
        new Vector3(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(
          node.matrixWorld,
        ),
      );
    }
  });
  return points;
}

{
  const kid = createKid({ hairStyle: 'spiky' });
  kid.root.updateMatrixWorld(true);
  const spikeParts = kid.hairParts.filter((part) => part.hideUnderHat);
  check(spikeParts.length === 1, `spiky: ${spikeParts.length} spike mesh(es), expected exactly 1`);

  const shell = find(kid.root, 'hair.shell.crop')[0] as Mesh | undefined;
  const spikes = spikeParts[0]?.mesh;

  if (shell && spikes) {
    // **Proud.** The bare crop shell is the same head `short` wears, so the
    // difference between the two is the spikes and nothing else. A point that
    // rises less than a quarter of a skull above the head it grows from is a
    // bump; the threshold is a skull radius (the game's number, from `kid.ts`)
    // rather than anything the spike builder knows about itself.
    const MIN_PROMINENCE = 0.25 * SKULL_RADIUS;
    const crown = Math.max(...worldPoints(shell).map((p) => p.y));
    const tip = Math.max(...worldPoints(spikes).map((p) => p.y));
    check(
      tip - crown > MIN_PROMINENCE,
      `spiky: the spikes stand only ${((tip - crown) * 1000).toFixed(0)} mm above the crown ` +
        `(need ${(MIN_PROMINENCE * 1000).toFixed(0)} mm) — that is a bumpy head, not a spiky one`,
    );
    notes.push(
      `  spiky    stands ${((tip - crown) * 1000).toFixed(0)} mm proud of the crown, ` +
        `kid ${kid.height.toFixed(3)} m`,
    );

    // **Rooted.** Classify every spike vertex inside/outside the shell by ray
    // parity — legitimate here precisely because check 2 above has already
    // proved the shell is closed — and then ask the one question that matters:
    // **is there anywhere round the head where the spikes stop going into it?**
    //
    // Measured as the widest gap in azimuth between one buried vertex and the
    // next. Rooted spikes leave only the gaps *between* neighbouring bases; a
    // spike that has lifted off leaves a hole the width of two of those plus
    // its own base, which no amount of vertex density can disguise. Counting
    // the roots directly was tried first and is not robust — a cone this
    // coarse buries its vertices in a scatter, not a contiguous arc.
    //
    // It has to be re-proved on every tilt change: standing a spike up out of a
    // scalp that slopes away lifts its base straight off, which is exactly what
    // `spikeBury` in `hair.ts` exists to stop and this is the proof of it.
    const solidShell = new Mesh(shell.geometry.clone(), new MeshBasicMaterial({ side: DoubleSide }));
    solidShell.applyMatrix4(shell.matrixWorld);
    solidShell.updateMatrixWorld(true);
    const raycaster = new Raycaster();
    const direction = new Vector3(0.371, 0.743, 0.557).normalize(); // nothing axis-aligned
    const toShell = new Matrix4().copy(shell.matrixWorld).invert();
    const spikePoints = worldPoints(spikes);
    const buried: number[] = [];
    for (const point of spikePoints) {
      raycaster.set(point, direction);
      if (raycaster.intersectObject(solidShell, false).length % 2 === 0) continue;
      const local = point.clone().applyMatrix4(toShell);
      buried.push(Math.atan2(local.x, local.z));
    }
    buried.sort((a, b) => a - b);
    let widest = 0;
    for (let i = 0; i < buried.length; i += 1) {
      const next = i === buried.length - 1 ? (buried[0] as number) + TAU : (buried[i + 1] as number);
      widest = Math.max(widest, next - (buried[i] as number));
    }
    // Nine spikes sit 40° apart, so the gaps between neighbouring buried bases
    // run to about 15°. Losing one root opens a gap past 55°; the bound sits
    // between the two, nearer the failure, and is measured off the built model
    // rather than taken off the spacing the builder aimed at.
    const MAX_ROOT_GAP = (30 / 180) * Math.PI;
    check(
      buried.length > 0 && widest < MAX_ROOT_GAP,
      `spiky: ${((widest * 180) / Math.PI).toFixed(0)}° of head with no spike going into it ` +
        `(limit ${((MAX_ROOT_GAP * 180) / Math.PI).toFixed(0)}°) — a spike has come loose ` +
        `from the shell it grows out of`,
    );
    notes.push(
      `  spiky    ${buried.length}/${spikePoints.length} spike vertices buried, ` +
        `widest unrooted gap ${((widest * 180) / Math.PI).toFixed(0)}°`,
    );
    solidShell.geometry.dispose();
  }

  kid.dispose?.();
}

// ------------------------------------------------------------------------ report

console.log(`check:hair — 4 shells, ${HAIR_STYLES.length - 2} styles, skull ${SKULL_RADIUS.toFixed(3)} m (HEAD ${KID_HEAD_SCALE})`);
for (const note of notes) console.log(note);

if (failures.length > 0) {
  console.error(`\nhair: ${failures.length} problem(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('hair: one piece, off her face, clear of her hands.');
