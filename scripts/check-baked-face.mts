/**
 * **Is each character's painted face on the surface the camera actually sees,
 * where it was painted?**
 *
 * ```
 * node \
 *      --import ./scripts/ts-extension-resolver-register.mjs \
 *      scripts/check-baked-face.mts
 * ```
 *
 * The sibling of `check:hood-face`, for heads rather than hats, and it works
 * the same way: cast a ray in from outside at each painted feature and look at
 * what comes back. A ray cast is what the depth test does, and `Raycaster`
 * honours `material.side` exactly as the rasteriser does, so a surface that is
 * inside out is invisible to this check too.
 *
 * **Note what this is and is not.** The hood faces had a real bug — a
 * hand-rolled patch wound the wrong way round (CLAUDE.md). The head faces did
 * not: they were built from three.js's own `SphereGeometry`, whose winding the
 * library guarantees. Baking them into the skull was a consistency change, not
 * a repair. What this script is for is keeping it that way, and in particular
 * catching the two things that *can* silently go wrong with a UV bake:
 *
 * 1. **The UV seam drifting into the face.** three.js puts a full sphere's seam
 *    90° round from `+Z`. Nothing stops a future face window widening past it,
 *    and the failure mode is the whole texture smeared across one column of
 *    triangles — which no vertex-position measurement would notice.
 * 2. **The face landing somewhere other than where it was painted**, if the
 *    window a head is remapped with ever stops matching the window its paint
 *    options were authored for.
 */
import '../scripts/headless-canvas.mjs';
import { Mesh, Object3D, Raycaster, SphereGeometry, Vector3, type Material } from 'three';
import { createKid, KID_FACE } from '../src/art/models/kid.ts';
import { buildRipikaHead } from '../src/art/models/ripika.ts';
import { createRipikaStatue } from '../src/art/models/ripikaStatue.ts';
import { createMini } from '../src/art/models/mini.ts';
import { createBiscuit } from '../src/art/models/biscuit.ts';
import {
  drawFacePaint,
  FACE_FILL_INSET,
  FACE_PAINT_DESIGNS,
  isBakedFaceMesh,
  type FacePaintOptions,
} from '../src/art/style/faces.ts';

/** How far the UV under a ray hit may sit from where the feature was painted. */
const UV_TOLERANCE = 0.02;

const failures: string[] = [];
const notes: string[] = [];

function check(ok: boolean, message: string): void {
  if (!ok) failures.push(message);
}

/** three.js leaves an unset `map` as `null`, not `undefined`. */
function hasMap(mesh: Mesh): boolean {
  return Boolean((mesh.material as Material & { map?: unknown }).map);
}

function meshesOf(root: Object3D): Mesh[] {
  const found: Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof Mesh) found.push(object);
  });
  return found;
}

/**
 * three.js's own sphere UV layout, asserted rather than assumed.
 *
 * `remapSphereFaceUv` is an affine rewrite of this, so if three.js ever moved
 * its seam or flipped `v`, every baked face in the game would silently land
 * somewhere else. One probe here is cheaper than finding that in a screenshot.
 */
function checkSphereConvention(): void {
  const geometry = new SphereGeometry(1, 38, 29);
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');

  let front = 0;
  let best = Infinity;
  let top = -1;
  let bottom = -1;
  for (let i = 0; i < position.count; i += 1) {
    const d = Math.hypot(position.getX(i), position.getY(i), position.getZ(i) - 1);
    if (d < best) {
      best = d;
      front = i;
    }
    if (position.getY(i) > 0.999) top = uv.getY(i);
    if (position.getY(i) < -0.999) bottom = uv.getY(i);
  }
  check(
    Math.abs(uv.getX(front) - 0.25) < 0.02,
    `three.js sphere UVs have moved: +Z is at u=${uv.getX(front).toFixed(3)}, not 0.25. ` +
      `Every baked face is an affine remap of this and would land wrong.`,
  );
  check(top === 1 && bottom === 0, `three.js sphere v is no longer 1 at the top pole and 0 at the bottom`);
  notes.push(`  three.js sphere: +Z at u=${uv.getX(front).toFixed(3)}, seam 90° round the side, v 1→0 top→bottom`);
}

/** The features `paintFace` will draw, as fractions of the canvas. */
function paintedFeatures(paint: FacePaintOptions): [string, number, number][] {
  const eyeY = paint.eyeY ?? 0.46;
  const gap = paint.eyeGap ?? 0.44;
  const features: [string, number, number][] = [
    ['left eye', 0.5 - gap / 2, eyeY],
    ['right eye', 0.5 + gap / 2, eyeY],
  ];
  if (paint.mouth !== 'none') features.push(['mouth', 0.5, eyeY + (paint.mouthDrop ?? 0.175)]);
  return features;
}

interface Head {
  readonly label: string;
  readonly root: Object3D;
  /** The mesh the face is baked into. */
  readonly skull: Mesh;
  readonly window: { spreadX: number; spreadY: number; tilt: number };
  readonly paint: FacePaintOptions;
}

/**
 * Fires a ray in at a point on the head and reports the nearest mesh hit and
 * the UV interpolated there.
 *
 * The ray runs along the outward direction of the point it is aimed at, so it
 * arrives square-on rather than glancing, and the only thing that can vary is
 * *which surface answers*.
 */
function shoot(head: Head, azimuth: number, polar: number): { mesh: Mesh | null; uv: [number, number] | null } {
  head.root.updateMatrixWorld(true);
  // The point on the unit sphere, in the skull's own space, then out to world.
  const local = new Vector3(
    Math.sin(azimuth) * Math.sin(polar),
    Math.cos(polar),
    Math.cos(azimuth) * Math.sin(polar),
  );
  const world = local.clone().applyMatrix4(head.skull.matrixWorld);
  const centre = new Vector3().applyMatrix4(head.skull.matrixWorld);
  const outward = world.clone().sub(centre).normalize();
  const ray = new Raycaster(world.clone().addScaledVector(outward, 5), outward.clone().negate(), 0, 20);
  const hits = ray.intersectObjects(meshesOf(head.root), false);
  const first = hits[0];
  if (!first) return { mesh: null, uv: null };
  return { mesh: first.object as Mesh, uv: first.uv ? [first.uv.x, first.uv.y] : null };
}

function checkHead(head: Head): void {
  const meshes = meshesOf(head.root);

  check(
    head.skull.geometry.getAttribute('uv') !== undefined,
    `${head.label}: the skull has no uv attribute — nothing to bake a face into`,
  );
  check(
    hasMap(head.skull),
    `${head.label}: the skull carries no texture map`,
  );
  check(
    !meshes.some((mesh) => mesh.name === 'facePatch'),
    `${head.label}: a separate 'facePatch' mesh is back. Faces on a unique head go ` +
      `into the head's own UV — see createBakedFace. (The instanced crowd is the ` +
      `documented exception and does not come through here.)`,
  );

  const span = 1 - 2 * FACE_FILL_INSET;
  for (const [feature, cu, cvTop] of paintedFeatures(head.paint)) {
    // Canvas fraction -> the sphere angles the remap sends it to.
    const azimuth = -head.window.spreadX / 2 + cu * head.window.spreadX;
    const polar = Math.PI / 2 - head.window.spreadY / 2 + head.window.tilt + cvTop * head.window.spreadY;
    const expected: [number, number] = [
      FACE_FILL_INSET + span * cu,
      FACE_FILL_INSET + span * (1 - cvTop),
    ];

    const hit = shoot(head, azimuth, polar);
    if (hit.mesh !== head.skull) {
      failures.push(
        `${head.label}: a ray in at the ${feature} hits ` +
          `${hit.mesh ? `'${hit.mesh.name || 'an unnamed mesh'}'` : 'nothing'} before the skull ` +
          `— the face is behind something`,
      );
      continue;
    }
    if (!hit.uv) {
      failures.push(`${head.label}: no UV under the ${feature}`);
      continue;
    }
    const off = Math.max(Math.abs(hit.uv[0] - expected[0]), Math.abs(hit.uv[1] - expected[1]));
    check(
      off <= UV_TOLERANCE,
      `${head.label}: the ${feature} is painted at uv (${expected[0].toFixed(3)}, ` +
        `${expected[1].toFixed(3)}) but the skull shows uv (${hit.uv[0].toFixed(3)}, ` +
        `${hit.uv[1].toFixed(3)}) there — off by ${off.toFixed(3)}`,
    );
    notes.push(`  ${head.label} — ${feature}: skull first, uv off by ${off.toFixed(4)}`);
  }

  // The back of the head must sample the plain border, not a smeared face.
  const back = shoot(head, Math.PI, Math.PI / 2);
  if (back.mesh === head.skull && back.uv) {
    const [u] = back.uv;
    check(
      u < FACE_FILL_INSET || u > 1 - FACE_FILL_INSET,
      `${head.label}: the back of the head samples uv u=${u.toFixed(3)}, inside the face ` +
        `rect — the face window has grown past three.js's UV seam and the texture is ` +
        `smeared round the head`,
    );
    notes.push(`  ${head.label} — back of head: uv u=${u.toFixed(2)} (the plain border)`);
  }
}

/** The mesh a baked face was applied to — flagged by `applyTo`, not guessed. */
function skullOf(root: Object3D, label: string): Mesh {
  const found = meshesOf(root).find((mesh) => isBakedFaceMesh(mesh));
  if (!found) {
    throw new Error(
      `${label}: no mesh carries the baked-face flag, so no face was baked into any ` +
        `surface on this character.`,
    );
  }
  return found;
}

/**
 * **Does every face-paint design still land where it landed before the bake?**
 *
 * This exists because it went wrong. Baking the paint into the face's canvas
 * moved every design up by the difference between the two windows' tilts, and
 * the cat whiskers ended up drawn across the kid's eyes. It was reported as
 * verified, because the check made at the time compared the new cheek position
 * against a landmark computed from the *same new* numbers — which is a
 * tautology, not a test.
 *
 * So this compares against **the space the designs were authored in**, which is
 * the thing that must not change, and it checks every design rather than one
 * family of them.
 */
function checkFacePaintPlacement(): void {
  const SIZE = 512;
  const AUTHORED = { spreadX: 1.7, spreadY: 1.7, tilt: 0.1 };
  const host = { spreadX: KID_FACE.spreadX, spreadY: KID_FACE.spreadY, tilt: KID_FACE.tilt };
  const skullR = 0.44 * 1.5;

  const angles = (cu: number, cv: number, w: typeof AUTHORED): [number, number] => [
    -w.spreadX / 2 + cu * w.spreadX,
    Math.PI / 2 - w.spreadY / 2 + w.tilt + cv * w.spreadY,
  ];

  /** The coordinates a design really draws at, with the canvas transform folded in. */
  const capture = (design: (typeof FACE_PAINT_DESIGNS)[number], w: typeof AUTHORED): [number, number][] => {
    const canvas = document.createElement('canvas') as HTMLCanvasElement & { ops?: unknown[] };
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    drawFacePaint(ctx, SIZE, design, w);
    const ops = (canvas.ops ?? []) as { op: string; a: number[] }[];
    const points: [number, number][] = [];
    let tx = 0;
    let ty = 0;
    let sx = 1;
    let sy = 1;
    for (const o of ops) {
      if (o.op === 'translate') [tx, ty] = [o.a[0] as number, o.a[1] as number];
      else if (o.op === 'scale') [sx, sy] = [o.a[0] as number, o.a[1] as number];
      else if (['ellipse', 'arc', 'moveTo', 'lineTo'].includes(o.op)) {
        points.push([tx + (o.a[0] as number) * sx, ty + (o.a[1] as number) * sy]);
      }
    }
    return points;
  };

  let worst = 0;
  for (const design of FACE_PAINT_DESIGNS) {
    const before = capture(design, AUTHORED);
    const after = capture(design, host);
    if (before.length !== after.length) {
      failures.push(`face paint '${design}': draws a different number of points in a hosted canvas`);
      continue;
    }
    for (let i = 0; i < before.length; i += 1) {
      const [az0, po0] = angles((before[i] as [number, number])[0] / SIZE, (before[i] as [number, number])[1] / SIZE, AUTHORED);
      const [az1, po1] = angles((after[i] as [number, number])[0] / SIZE, (after[i] as [number, number])[1] / SIZE, host);
      worst = Math.max(worst, Math.hypot(az0 - az1, po0 - po1) * skullR * 1000);
    }
  }
  check(
    worst < 0.5,
    `face paint has moved ${worst.toFixed(2)} mm from where it was authored to sit on the head. ` +
      `A design is transformed onto a face window, never re-read against a different one — see ` +
      `FACE_PAINT_AUTHORED in faces.ts.`,
  );
  notes.push(`  face paint: all ${FACE_PAINT_DESIGNS.length} designs land within ${worst.toFixed(4)} mm of where they were authored`);
}

console.log('Baked faces — is each face on the surface the camera sees?\n');

checkSphereConvention();
checkFacePaintPlacement();

const kid = createKid({});
checkHead({
  label: 'player kid',
  root: kid.root,
  skull: skullOf(kid.head, 'player kid'),
  window: { spreadX: KID_FACE.spreadX, spreadY: KID_FACE.spreadY, tilt: KID_FACE.tilt },
  paint: { eyeY: KID_FACE.eyeY, eyeGap: KID_FACE.eyeGap, mouth: 'smile', mouthDrop: 0.215 },
});

const ripika = buildRipikaHead(1);
checkHead({
  label: 'RiPika',
  root: ripika.group,
  skull: skullOf(ripika.group, 'RiPika'),
  window: { spreadX: 1.85, spreadY: 1.85, tilt: 0.2 },
  paint: { eyeY: 0.44, eyeGap: 0.46, mouth: 'cat', mouthDrop: 0.235 },
});

const mini = createMini();
checkHead({
  label: 'Mini',
  root: mini.root,
  skull: skullOf(mini.head, 'Mini'),
  window: { spreadX: 1.9, spreadY: 1.8, tilt: 0.16 },
  paint: { eyeY: 0.42, eyeGap: 0.45, mouth: 'grin', mouthDrop: 0.185 },
});

const biscuit = createBiscuit();
checkHead({
  label: 'Biscuit',
  root: biscuit.root,
  skull: skullOf(biscuit.head, 'Biscuit'),
  window: { spreadX: 1.8, spreadY: 1.8, tilt: 0.12 },
  paint: { eyeY: 0.4, eyeGap: 0.46, mouth: 'none' },
});

// The fountain statue. Same head builder and same face window as RiPika above,
// but it reaches them by the OTHER bake path — `applyStaticBakedFace`, the
// one-canvas route for a face that never changes expression — so the remap it
// does is genuinely separate code and needs its own ray cast.
//
// Checked as the whole assembled statue rather than a bare head, which also
// buys the assertion that nothing the statue owns stands in front of its face:
// it is posed with a raised arm and mounted on a plinth, and "a ray in at the
// eye hits the skull first" is exactly the property that would catch a pose
// putting a paw across the face.
const statue = createRipikaStatue();
checkHead({
  label: 'RiPika statue',
  root: statue.root,
  skull: skullOf(statue.root, 'RiPika statue'),
  window: { spreadX: 1.85, spreadY: 1.85, tilt: 0.2 },
  paint: { eyeY: 0.44, eyeGap: 0.46, mouth: 'cat', mouthDrop: 0.235 },
});

// The crowd's prototype must KEEP its patch — see `KidOptions.facePatch`.
const crowdKid = createKid({ facePatch: true });
const crowdMeshes = meshesOf(crowdKid.root);
check(
  crowdMeshes.some((mesh) => mesh.name === 'facePatch'),
  `the crowd prototype has lost its 'facePatch' mesh. kidCrowd.ts finds the face by ` +
    `that name to give it its twelve material variants, and an instanced skull cannot ` +
    `carry a baked face — skin tone reaches it as an instanceColor multiply.`,
);
check(
  !crowdMeshes.some((mesh) => mesh.name !== 'facePatch' && hasMap(mesh)),
  `the crowd prototype has a textured mesh that is not the face patch — its skull must ` +
    `stay flat white so instanceColor can tint it per child`,
);
notes.push('  crowd prototype: separate facePatch kept, skull untextured — instancing intact');

for (const note of notes) console.log(note);

if (failures.length > 0) {
  console.error(`\n${failures.length} problem(s):\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log('\nEvery baked face is on its own head, where it was painted.');
