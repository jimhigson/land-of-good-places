import { Mesh, type BufferGeometry, type Material } from 'three';
import { KID_GLB_BASE64 } from '../assets/kidGlb';
import { base64ToArrayBuffer, readGlbParts, type GlbPart } from '../style/glb';
import { markShared } from '../style/materials';
import type { KidBodyPart } from './kid';

/**
 * The player kid's authored body and head, read once at module load.
 *
 * ## What this is
 *
 * Stage A of HANDOFF-character-modelling.md. Every mesh the kid's body and head
 * are made of now lives in `art/assets/kid.glb` — geometry and UVs together, in
 * one file — instead of being computed by a formula at run time. The Stage A
 * geometry is *today's* geometry, produced by the very code it replaces
 * (`npm run export:kid`), so parity is exact by construction and provable
 * rather than a matter of taste. Stage B changes what is in the file; nothing
 * here has to change with it.
 *
 * ## The point of it
 *
 * The face's UV map used to be computed by `remapSphereFaceUv` — a second
 * description of the skull's surface, kept in step with the first by hand. That
 * shape of thing has now caused three separate bugs on this project (the
 * invisible hood faces, the 72 mm face-paint drift, the whiskers across the
 * eyes). The asset carries the UVs, so there is no second description left to
 * disagree.
 *
 * ## Shared, on purpose
 *
 * There is one geometry per part for the whole game, `markShared` so
 * `disposeTree` leaves it alone. Today every `createKid()` re-tessellates
 * fourteen spheres, capsules and tori, and the character creator does that on
 * **every tap**; the crowd does it per prototype. Sharing is both cheaper and
 * what the asset naturally gives us — the five mirrored pairs already share one
 * geometry inside the file.
 *
 * The one thing that used to mutate a kid's own skull geometry — the face UV
 * remap — is exactly what the asset makes unnecessary, so nothing writes to
 * these buffers any more. `outlineGeometry` clones before it pushes vertices,
 * and `createBakedFace` now refuses to remap an authored head rather than
 * quietly rewriting a buffer every other child is looking at.
 */
const parts: Map<string, GlbPart> = readGlbParts(base64ToArrayBuffer(KID_GLB_BASE64));

for (const part of parts.values()) markShared(part.geometry);

/** One authored part, by name. Throws rather than returning a hole. */
export function kidAssetPart(name: KidBodyPart): GlbPart {
  const part = parts.get(name);
  if (!part) {
    throw new Error(
      `kidAsset: the asset has no part named '${name}'. Either \`KID_BODY_PARTS\` has ` +
        `grown and \`npm run export:kid\` has not been re-run, or a node lost its name ` +
        `on the way through Blender.`,
    );
  }
  return part;
}

/** Every part name the asset actually contains — for checks, not for the game. */
export function kidAssetPartNames(): readonly string[] {
  return [...parts.keys()];
}

/** The authored geometry for one part. Shared: never mutate it. */
export function kidAssetGeometry(name: KidBodyPart): BufferGeometry {
  return kidAssetPart(name).geometry;
}

/**
 * A mesh of one authored part, placed where the asset says it goes.
 *
 * The transform comes from the asset as well as the shape, because a part's
 * shape and where that shape sits are one decision made in one place. That the
 * numbers still agree with the ones written in `createKid` is asserted by
 * `check:character-parity` rather than assumed — they are the same numbers
 * today, and Stage B is allowed to move them.
 */
export function kidAssetMesh(name: KidBodyPart, material: Material): Mesh {
  const part = kidAssetPart(name);
  const mesh = new Mesh(part.geometry, material);
  mesh.name = name;
  mesh.position.copy(part.position);
  mesh.quaternion.copy(part.quaternion);
  mesh.scale.copy(part.scale);
  return mesh;
}
