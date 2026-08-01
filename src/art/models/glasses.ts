import { CapsuleGeometry, Group, Mesh, TorusGeometry, type BufferGeometry } from 'three';
import { ART } from '../style/artPalette';
import { visibleTop } from '../style/measure';
import { addOutline, decal, solid, toonMaterial } from '../style/materials';
import { heartGeometry, starGeometry } from '../style/shapes';
import { blob, type AssetHandle } from '../style/asset';
import { KID_HEAD_SCALE, kidEyeCentre } from './kid';

/**
 * Glasses for the character creator: sunglasses, star glasses, heart glasses —
 * plus the existing "none" default, which needs no asset at all and is not a
 * {@link GlassesKind}.
 *
 * Modelled on `hats.ts`'s `createHat(kind)`: the same toon materials, the same
 * ink outlines, and the same "geometry authored in head units, converted once
 * by a `fit` group" convention — see that file's header for why a worn item
 * must never carry its own copy of the head's scale-up. `KID_HEAD_SCALE` took
 * every hat in the shop to two thirds of the head it sat on for two days
 * because one file held it and another didn't (ART-AGENT-NOTES.md §2); this
 * file imports it rather than repeating a number.
 *
 * ## Transparent lenses
 *
 * Every lens is **worn glass, not a blindfold** — tinted and see-through, so
 * the painted eyes underneath still read even through the sunglasses' dark
 * tint. `toonMaterial`'s own `transparent`/`opacity` options are the game's
 * existing glass convention — `ferrisWheel/gondola.ts`'s cabin windows and,
 * closer to this asset, `balloons.ts`'s flying-corgi goggles (a torus rim plus
 * a flattened, tinted, transparent lens `blob`) — so this follows that rather
 * than inventing a new transparency approach. The sunglasses below are built
 * with that exact recipe; see {@link createSunglasses}.
 */
export type GlassesKind = 'sunglasses' | 'star' | 'heart';

export const GLASSES_KINDS: readonly GlassesKind[] = ['sunglasses', 'star', 'heart'];

/** Head units → metres. See `hats.ts`'s identical `FIT` for why this exists. */
const FIT = KID_HEAD_SCALE;

/**
 * Half the distance between the wearer's painted eyes, in **head units** — the
 * raw, unscaled-by-`HEAD` space this file's geometry is authored in, the same
 * space `hats.ts` authors against a 0.44 skull.
 *
 * Derived from `kid.ts`'s {@link kidEyeCentre} (already in metres, `HEAD`
 * baked in) divided back out by {@link FIT}, rather than a second, hand-typed
 * fraction of the head — so a lens always centres on the eye under it however
 * the face or the head scale is retuned. `check:glasses-fit` proves this
 * against the built kid's own eyes, not against this formula.
 */
const EYE_HALF_GAP = kidEyeCentre(1).x / FIT;

/** A glasses' two groups — see `hats.ts`'s identical `hatGroups`. */
function glassesGroups(name: string): { root: Group; fit: Group } {
  const root = new Group();
  root.name = name;
  const fit = new Group();
  fit.name = `${name}:fit`;
  fit.scale.setScalar(FIT);
  root.add(fit);
  return { root, fit };
}

function finish(root: Group): AssetHandle {
  return { root, height: visibleTop(root) };
}

/**
 * How far in front of the eye line the lenses stand, in head units — proud of
 * the face surface so nothing z-fights the skin, and shallow enough that a
 * pair of glasses reads as worn rather than floating.
 */
const STANDOFF = 0.026;

/** A small bridge piece over the nose, shared by every kind. */
function bridgePiece(fit: Group, colour: number): void {
  const piece = blob(0.024, toonMaterial(colour), [1.25, 0.55, 0.62], 10);
  piece.position.set(0, -0.008, STANDOFF * 0.5);
  fit.add(piece);
}

/**
 * One temple arm, running back from a lens toward the ear it is worn over.
 *
 * A short capsule is enough to read as "glasses, not goggles" from the game's
 * 38° iso camera — it does not need to reach the ear exactly, only to break
 * the lens's silhouette on its outer edge the way a real temple would.
 */
function temple(fit: Group, side: -1 | 1, lensX: number, colour: number): void {
  const arm = solid(new Mesh(new CapsuleGeometry(0.012, 0.15, 4, 8), toonMaterial(colour)));
  // The capsule's own axis runs local +Y; rotating it onto Z lays it back
  // toward the ear, and the small extra yaw angles the tip in rather than
  // leaving it dead straight, which reads as "hinged" instead of "welded on".
  arm.rotation.set(Math.PI / 2, side * 0.16, 0, 'YXZ');
  arm.position.set(side * (lensX + 0.095), 0.006, -0.03);
  fit.add(arm);
}

/**
 * Sunglasses: a torus rim and a flattened, tinted, transparent lens per eye —
 * `balloons.ts`'s flying-corgi goggles, at the scale this head wants. The lens
 * tint is deliberately the darkest of the three kinds (opacity 0.6), because
 * these are the one pair meant to read as *shades*, but it is still glass: the
 * painted eyes show through it, never blacked out.
 */
function createSunglasses(): AssetHandle {
  const { root, fit } = glassesGroups('glasses.sunglasses');

  const rimMat = toonMaterial(ART.glassesSunFrame);
  const lensMat = toonMaterial(ART.glassesSunLens, { transparent: true, opacity: 0.6 });

  bridgePiece(fit, ART.glassesSunFrame);

  for (const side of [-1, 1] as const) {
    const x = side * EYE_HALF_GAP;

    const rim = solid(new Mesh(new TorusGeometry(0.1, 0.019, 8, 22), rimMat));
    rim.position.set(x, 0, STANDOFF);
    fit.add(rim);
    addOutline(rim, 0.009);

    const lens = decal(blob(0.092, lensMat, [1, 0.86, 0.3], 16));
    lens.position.set(x, 0, STANDOFF - 0.004);
    fit.add(lens);

    temple(fit, side, EYE_HALF_GAP, ART.glassesSunFrame);
  }

  return finish(root);
}

/**
 * One star- or heart-shaped lens: a solid frame shape sitting just behind a
 * smaller, transparent, tinted copy of the same shape — the frame shows as a
 * rim round the lens's edge, the same way the sunglasses' torus does, without
 * needing a star- or heart-shaped torus. Both shapes come from
 * `style/shapes.ts` (already used for the crown's jewel and Biscuit's jumper),
 * so there is no hand-rolled triangulation here to get the winding order of
 * wrong — the exact trap ART-AGENT-NOTES.md §4 warns about.
 */
function shapedLensPair(
  fit: Group,
  geometry: (size: number, depth: number) => BufferGeometry,
  frameColour: number,
  lensColour: number,
  frameSize: number,
  lensSize: number,
): void {
  const frameMat = toonMaterial(frameColour);
  const lensMat = toonMaterial(lensColour, { transparent: true, opacity: 0.55 });

  for (const side of [-1, 1] as const) {
    const x = side * EYE_HALF_GAP;

    const frame = solid(new Mesh(geometry(frameSize, 0.016), frameMat));
    frame.position.set(x, 0, STANDOFF - 0.008);
    fit.add(frame);
    addOutline(frame, 0.008);

    const lens = decal(new Mesh(geometry(lensSize, 0.012), lensMat));
    lens.position.set(x, 0, STANDOFF + 0.006);
    fit.add(lens);
  }
}

/** Star glasses: a five-point star lens over each eye, gold-rimmed. */
function createStarGlasses(): AssetHandle {
  const { root, fit } = glassesGroups('glasses.star');

  bridgePiece(fit, ART.glassesStarFrame);
  shapedLensPair(fit, starGeometry, ART.glassesStarFrame, ART.glassesStarLens, 0.235, 0.19);
  for (const side of [-1, 1] as const) temple(fit, side, EYE_HALF_GAP, ART.glassesStarFrame);

  return finish(root);
}

/** Heart glasses: a heart-shaped lens over each eye, pink-rimmed. */
function createHeartGlasses(): AssetHandle {
  const { root, fit } = glassesGroups('glasses.heart');

  bridgePiece(fit, ART.heartPink);
  shapedLensPair(fit, heartGeometry, ART.heartPink, ART.glassesHeartLens, 0.22, 0.175);
  for (const side of [-1, 1] as const) temple(fit, side, EYE_HALF_GAP, ART.heartPink);

  return finish(root);
}

const BUILDERS: Readonly<Record<GlassesKind, () => AssetHandle>> = {
  sunglasses: createSunglasses,
  star: createStarGlasses,
  heart: createHeartGlasses,
};

/** A fresh pair of glasses. Parent it to `kid.glassesAnchor` or a shop stand. */
export function createGlasses(kind: GlassesKind): AssetHandle {
  return BUILDERS[kind]();
}
