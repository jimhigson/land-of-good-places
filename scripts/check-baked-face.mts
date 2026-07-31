/**
 * **Is each character's painted face on the surface the camera actually sees,
 * where it was painted?**
 *
 * ```
 * node --experimental-strip-types \
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
import { createMini } from '../src/art/models/mini.ts';
import { createBiscuit } from '../src/art/models/biscuit.ts';
import { FACE_FILL_INSET, type FacePaintOptions } from '../src/art/style/faces.ts';

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

/** The mesh a baked face was applied to — named by `applyTo`, not guessed. */
function skullOf(root: Object3D, label: string): Mesh {
  const found = meshesOf(root).find((mesh) => mesh.name === 'bakedFace');
  if (!found) {
    throw new Error(
      `${label}: no mesh named 'bakedFace'. Either the face is not baked, or the head ` +
        `mesh already had a name and \`applyTo\` left it alone.`,
    );
  }
  return found;
}

console.log('Baked faces — is each face on the surface the camera sees?\n');

checkSphereConvention();

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
