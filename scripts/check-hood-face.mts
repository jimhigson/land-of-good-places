/**
 * **Can you actually see the critter hoods' faces?**
 *
 * ```
 * node \
 *      --import ./scripts/ts-extension-resolver-register.mjs \
 *      scripts/check-hood-face.mts
 * ```
 *
 * RiPika's and Trilla's painted faces were invisible in the running game for a
 * fortnight, and nothing in the build noticed. `check:assets` measured the
 * hats' heights, `check:hat-fit` measured their width against the skull, and
 * both passed the whole time — because the face was *there*, correctly placed,
 * the right size, and simply never rasterised: the patch mesh carrying it was
 * wound the opposite way round from the shell, so its normals pointed at the
 * wearer's skull and `MeshToonMaterial`'s `FrontSide` culled it. Every
 * measurement of where a vertex *is* passes on an inside-out mesh.
 *
 * So this measures something different: **what a camera outside the hat would
 * hit first, and what is painted at that point.** A ray cast is what the depth
 * test does, and `Raycaster` honours `material.side` exactly as the rasteriser
 * does, so a surface that is inside out is invisible to this check too — which
 * is the point.
 *
 * It also holds the pattern in place. A face on a worn item belongs in that
 * item's **own** UV map, not on a second mesh floating in front of it. The
 * assertions below fail if anyone reintroduces the decal patch.
 */
import '../scripts/headless-canvas.mjs';
import { Mesh, Object3D, Raycaster, Vector3, type Material } from 'three';
import {
  createHat,
  RIPIKA_FACE_WINDOW,
  RIPIKA_HOOD_FACE,
  TRILLA_FACE_WINDOW,
  TRILLA_HOOD_FACE,
} from '../src/art/models/hats.ts';
import {
  CHEERY_HOOD,
  hoodShellSampler,
  RIPIKA_HOOD,
  TRILLA_HOOD,
  type HoodFaceWindow,
  type HoodShellSpec,
} from '../src/art/models/hoodShell.ts';
import { FACE_FILL_INSET, type FacePaintOptions } from '../src/art/style/faces.ts';
import type { HatKind } from '../src/art/models/hats.ts';

/** How far the UV under a ray hit may sit from where the feature was painted. */
const UV_TOLERANCE = 0.02;

const failures: string[] = [];
const notes: string[] = [];

function check(ok: boolean, message: string): void {
  if (!ok) failures.push(message);
}

function meshesOf(root: Object3D): Mesh[] {
  const found: Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof Mesh) found.push(object);
  });
  return found;
}

function mapOf(mesh: Mesh): unknown {
  return (mesh.material as Material & { map?: unknown }).map ?? null;
}

/** The group holding the hat's geometry, so head units can be put into world space. */
function fitOf(root: Object3D): Object3D {
  let found: Object3D | null = null;
  root.traverse((object) => {
    if (!found && object.name.endsWith(':fit')) found = object;
  });
  if (!found) throw new Error('hat has no :fit group');
  return found;
}

/**
 * The features `paintFace` will actually draw, as fractions of the canvas —
 * read off the hood's own paint options rather than written down again here, so
 * moving an eye moves what this checks.
 */
function paintedFeatures(paint: FacePaintOptions): [string, number, number][] {
  const eyeY = paint.eyeY ?? 0.46;
  const gap = paint.eyeGap ?? 0.44;
  return [
    ['left eye', 0.5 - gap / 2, eyeY],
    ['right eye', 0.5 + gap / 2, eyeY],
    ['mouth', 0.5, eyeY + (paint.mouthDrop ?? 0.175)],
    ['brow centre', 0.5, eyeY - 0.2],
  ];
}

/**
 * Fires a ray in at a point on the hood and reports the nearest mesh it hits
 * and the UV interpolated there.
 *
 * The ray runs along the horizontal radius, so the hit lands at exactly the
 * azimuth and height asked for whatever the shell's panel-seam relief is doing
 * — the only thing that can change is *which surface* answers.
 */
function shoot(
  hat: Object3D,
  fit: Object3D,
  spec: HoodShellSpec,
  phi: number,
  y: number,
): { mesh: Mesh | null; uv: [number, number] | null } {
  const { surface } = hoodShellSampler(spec);
  const [px, py, pz] = surface(phi, y);
  const world = new Vector3(px, py, pz).applyMatrix4(fit.matrixWorld);
  const outward = new Vector3(world.x, 0, world.z).normalize();
  const ray = new Raycaster(world.clone().addScaledVector(outward, 3), outward.negate(), 0, 10);
  const hits = ray.intersectObjects(meshesOf(hat), false);
  const first = hits[0];
  if (!first) return { mesh: null, uv: null };
  return {
    mesh: first.object as Mesh,
    uv: first.uv ? [first.uv.x, first.uv.y] : null,
  };
}

/** A hood that carries a painted face. */
function checkFacedHood(
  label: string,
  kind: HatKind,
  spec: HoodShellSpec,
  window: HoodFaceWindow,
  paint: FacePaintOptions,
): void {
  const hat = createHat(kind);
  hat.root.updateMatrixWorld(true);
  const fit = fitOf(hat.root);
  const meshes = meshesOf(hat.root);

  // ---- The face lives on the shell, and nothing else carries a texture.
  const shell = meshes.find((mesh) => mesh.name === 'hoodShell');
  check(shell !== undefined, `${label}: no mesh named 'hoodShell'`);
  if (!shell) return;

  check(
    shell.geometry.getAttribute('uv') !== undefined,
    `${label}: the hood shell has no uv attribute — the face cannot be baked into it`,
  );

  const textured = meshes.filter((mesh) => mapOf(mesh) !== null);
  check(
    textured.length === 1 && textured[0] === shell,
    `${label}: expected exactly one textured mesh (the shell); found ${textured.length} ` +
      `[${textured.map((mesh) => mesh.name || 'unnamed').join(', ')}]`,
  );

  // The decal patch this replaced. Named, so its return is unmissable.
  check(
    !meshes.some((mesh) => mesh.name === 'hoodFace'),
    `${label}: a separate 'hoodFace' decal mesh is back. Paint the face into the ` +
      `shell's own texture instead — see HoodFaceWindow in hoodShell.ts`,
  );
  check(
    !meshes.some((mesh) => (mesh.material as Material).transparent && mapOf(mesh) !== null),
    `${label}: a transparent textured mesh is worn on the hood — that is the decal ` +
      `patch pattern this hat exists to demonstrate the end of`,
  );

  // ---- The pole fan clamps to the texture's top border only while this holds.
  check(
    window.yHi < spec.semiY,
    `${label}: face window top ${window.yHi} reaches the crown at ${spec.semiY}; the ` +
      `rings round the pole would wrap the face over the top of the hood`,
  );

  // ---- Every painted feature is on the surface a camera actually sees.
  const span = 1 - 2 * FACE_FILL_INSET;
  for (const [feature, cx, cy] of paintedFeatures(paint)) {
    const phi = Math.PI - (cx - 0.5) * 2 * window.halfX;
    const y = window.yLo + (window.yHi - window.yLo) * (1 - cy);
    const expected: [number, number] = [
      FACE_FILL_INSET + span * cx,
      FACE_FILL_INSET + span * (1 - cy),
    ];
    const hit = shoot(hat.root, fit, spec, phi, y);

    if (hit.mesh !== shell) {
      failures.push(
        `${label}: a ray in at the ${feature} hits ` +
          `${hit.mesh ? `'${hit.mesh.name || 'an unnamed mesh'}'` : 'nothing'} before the hood ` +
          `shell — the face is behind something, or the surface carrying it is inside out`,
      );
      continue;
    }
    if (!hit.uv) {
      failures.push(`${label}: the hood shell has no UV under the ${feature}`);
      continue;
    }
    const off = Math.max(Math.abs(hit.uv[0] - expected[0]), Math.abs(hit.uv[1] - expected[1]));
    check(
      off <= UV_TOLERANCE,
      `${label}: the ${feature} is painted at uv (${expected[0].toFixed(3)}, ` +
        `${expected[1].toFixed(3)}) but the shell shows uv (${hit.uv[0].toFixed(3)}, ` +
        `${hit.uv[1].toFixed(3)}) there — off by ${off.toFixed(3)}`,
    );
    notes.push(`  ${label} — ${feature}: shell first, uv off by ${off.toFixed(4)}`);
  }

  // ---- The back of the hood samples the texture's plain border, not the face.
  const back = shoot(hat.root, fit, spec, 0, 0);
  check(back.mesh === shell, `${label}: the back of the hood is not the shell`);
  if (back.uv) {
    const [u] = back.uv;
    check(
      u < FACE_FILL_INSET || u > 1 - FACE_FILL_INSET,
      `${label}: the back of the hood samples uv u=${u.toFixed(3)}, inside the face ` +
        `rect — the seam is not split and the face is smeared round the hood`,
    );
    notes.push(`  ${label} — back of hood: uv u=${u.toFixed(2)} (clamps to the plain border)`);
  }
}

/**
 * A hood with no face pays nothing for the feature: flat colour, no texture,
 * and a shell built without the extra seam column or the UVs.
 *
 * (Only the *shell* is asserted UV-free. The crown button is a `SphereGeometry`
 * and comes with UVs three.js put there, which is nothing to do with this.)
 */
function checkPlainHood(label: string, kind: HatKind, segments: number, rings: number): void {
  const hat = createHat(kind);
  const meshes = meshesOf(hat.root);
  check(
    !meshes.some((mesh) => mapOf(mesh) !== null),
    `${label}: a faceless hood has grown a texture map — the face texture is meant to ` +
      `be opt-in per hood, not a cost every hat pays`,
  );

  const shell = meshes.find((mesh) => mesh.name === 'hoodShell');
  check(shell !== undefined, `${label}: no mesh named 'hoodShell'`);
  if (!shell) return;

  check(
    shell.geometry.getAttribute('uv') === undefined,
    `${label}: a faceless hood's shell has grown UVs it does not use`,
  );
  // Two poles plus one outer and one inner vertex per ring per column, with the
  // seam column NOT duplicated — i.e. exactly the shell it has always been.
  const expected = 2 + segments * rings * 2;
  const actual = shell.geometry.getAttribute('position')?.count ?? 0;
  check(
    actual === expected,
    `${label}: shell has ${actual} vertices, expected ${expected}. A faceless hood must ` +
      `keep the closed ring — only a face window splits the seam`,
  );
  notes.push(`  ${label}: flat colour, no map, no shell UVs, ${actual} vertices — untouched`);
}

console.log('Hood faces — is the painted face on the surface the camera sees?\n');

checkFacedHood('RiPika cap', 'ripikaHat', RIPIKA_HOOD, RIPIKA_FACE_WINDOW, RIPIKA_HOOD_FACE);
checkFacedHood('Trilla bonnet', 'puff', TRILLA_HOOD, TRILLA_FACE_WINDOW, TRILLA_HOOD_FACE);
checkPlainHood('Cheery Cap', 'cap', CHEERY_HOOD.segments, CHEERY_HOOD.rings);

for (const note of notes) console.log(note);

if (failures.length > 0) {
  console.error(`\n${failures.length} problem(s):\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error(
    '\nThe face on a worn item goes in that item\'s own UV map. Do not fix this by\n' +
      'putting a second mesh in front of the first one — that is the bug this check\n' +
      'was written for.',
  );
  process.exit(1);
}

console.log('\nBoth critter hoods: face baked into the shell\'s own UVs, visible from outside.');
