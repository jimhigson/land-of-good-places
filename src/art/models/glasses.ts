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
function temple(fit: Group, side: -1 | 1, lensX: number, colour: number, hingeOffset = 0.095): void {
  const arm = solid(new Mesh(new CapsuleGeometry(0.012, 0.15, 4, 8), toonMaterial(colour)));
  // The capsule's own axis runs local +Y; rotating it onto Z lays it back
  // toward the ear, and the small extra yaw angles the tip in rather than
  // leaving it dead straight, which reads as "hinged" instead of "welded on".
  arm.rotation.set(Math.PI / 2, side * 0.16, 0, 'YXZ');
  arm.position.set(side * (lensX + hingeOffset), 0.006, -0.03);
  fit.add(arm);
}

/**
 * Sunglasses lens radius, in head units, fed to the `blob()` that makes the
 * lens — literally Jim's ask ("about double their current size"): the shipped
 * pair's lens blob was `0.092`, so this is that number doubled.
 *
 * {@link SUN_RIM_RADIUS} and {@link SUN_RIM_TUBE} scale up alongside it rather
 * than staying put, on purpose: a doubled lens inside the old, normal-sized
 * rim would read as lenses awkwardly bulging out of a frame built for a
 * smaller face, not as one deliberately oversized pair of shades. Scaling the
 * whole silhouette together is what makes it read as "giant novelty
 * sunglasses" rather than "sunglasses with a rendering bug" — the exaggerated,
 * theatrical look that was actually asked for (1 August 2026).
 */
const SUN_LENS_RADIUS = 0.092 * 2;
/** Torus radius (rim centreline). Chosen so the rim's outer edge comfortably
 * contains the doubled lens (see {@link SUN_LENS_RADIUS}) while its inner
 * hole still leaves a real gap over the nose bridge — the two rims sit close
 * together for the oversized look but never touch or cross the centreline;
 * `check:glasses-fit`'s span and centre checks and a visual pass both confirm
 * this at this radius. */
const SUN_RIM_RADIUS = 0.16;
/** Rim tube radius — thicker than the original `0.019` so the frame itself
 * reads as chunkier and more theatrical, not just a bigger hole. */
const SUN_RIM_TUBE = 0.034;
/** Outline thickness for the rim, scaled up from the original `0.009` by the
 * same ratio as {@link SUN_RIM_TUBE} grew over the original tube radius, so
 * the ink line stays proportionate to the frame it outlines rather than
 * looking thin on a much chunkier rim. Lands inside ART_DIRECTION.md §2's
 * 0.016–0.022 "props" outline range. */
const SUN_RIM_OUTLINE = 0.016;
/** How far out the temple hinge sits from the lens centre, in head units —
 * scaled up from the original `0.095` by the same ratio the rim's own outer
 * radius grew, so the hinge still lands on the rim's surface instead of
 * either floating past its edge or burying itself inside it. */
const SUN_TEMPLE_HINGE = 0.095 * ((SUN_RIM_RADIUS + SUN_RIM_TUBE) / (0.1 + 0.019));

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

    const rim = solid(new Mesh(new TorusGeometry(SUN_RIM_RADIUS, SUN_RIM_TUBE, 8, 22), rimMat));
    rim.position.set(x, 0, STANDOFF);
    fit.add(rim);
    addOutline(rim, SUN_RIM_OUTLINE);

    const lens = decal(blob(SUN_LENS_RADIUS, lensMat, [1, 0.86, 0.3], 16));
    lens.position.set(x, 0, STANDOFF - 0.004);
    fit.add(lens);

    temple(fit, side, EYE_HALF_GAP, ART.glassesSunFrame, SUN_TEMPLE_HINGE);
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
 *
 * Unlike the sunglasses' torus rim, a star or heart frame is a **filled**
 * shape, left-right symmetric about its own centre — so the distance it
 * reaches out toward the ear and the distance it reaches in toward the nose
 * are the same number. There is no separate "inner hole radius" to hold
 * steady the way `SUN_RIM_RADIUS`/`SUN_RIM_TUBE` did while the outer edge
 * grew; growing `frameSize` pushes the near-nose edge in exactly as far as it
 * pushes the outer edge out. That is why {@link STAR_FRAME_SIZE} and
 * {@link HEART_FRAME_SIZE} below grow by very different ratios from their own
 * baselines — each is sized against how far its own shape's centre can move
 * out before its near-nose edge reaches the other lens's, not against a
 * shared percentage.
 */
function shapedLensPair(
  fit: Group,
  geometry: (size: number, depth: number) => BufferGeometry,
  frameColour: number,
  lensColour: number,
  frameSize: number,
  lensSize: number,
  outline: number,
): void {
  const frameMat = toonMaterial(frameColour);
  const lensMat = toonMaterial(lensColour, { transparent: true, opacity: 0.55 });

  for (const side of [-1, 1] as const) {
    const x = side * EYE_HALF_GAP;

    const frame = solid(new Mesh(geometry(frameSize, 0.016), frameMat));
    frame.position.set(x, 0, STANDOFF - 0.008);
    fit.add(frame);
    addOutline(frame, outline);

    const lens = decal(new Mesh(geometry(lensSize, 0.012), lensMat));
    lens.position.set(x, 0, STANDOFF + 0.006);
    fit.add(lens);
  }
}

/**
 * Star lens/frame size, in head units, grown to match the sunglasses'
 * 1 August 2026 "exaggerated and theatrical" scale-up (see
 * {@link SUN_LENS_RADIUS}'s doc comment). The shipped pair used `0.235`.
 *
 * A star's points reach much further from its own centre, relative to this
 * `size` parameter, than the sunglasses' torus does from *its* centre
 * (`halfWidth ≈ 0.556 × size`, measured off the built geometry) — so unlike
 * the sunglasses, which could double their lens and still keep a ~10 cm gap
 * over the nose bridge, a star frame this size is already most of the way to
 * the centreline before any growth at all (original gap ≈ 8.8 cm at kid
 * scale). `0.27` is as far as this shape can grow and still clear the other
 * eye's star with a real, checked margin: ~30 mm at kid scale between the two
 * frames' near-nose edges (`EYE_HALF_GAP` 0.1601 − frame half-width 0.1502,
 * ×2 sides ×`KID_HEAD_SCALE`), well short of the point (`size` ≈ 0.288) where
 * they would touch. Past that the two stars overlap across the nose — this
 * is a real ceiling from the shape's own geometry, not a stylistic choice to
 * grow less than the sunglasses did.
 */
const STAR_FRAME_SIZE = 0.27;
/** Kept at the shipped pair's lens-to-frame ratio (~0.81), so the visible
 * gold "rim" stays proportionate to the frame it borders as both grow. */
const STAR_LENS_SIZE = 0.218;
/** Outline thickness, raised from the shipped `0.008` into
 * ART_DIRECTION.md §2's 0.016–0.022 "props" range — the same range the
 * sunglasses' rim outline was raised into for the same "chunkier, more
 * theatrical" read, rather than left thin while the frame it borders grows. */
const STAR_OUTLINE = 0.016;
/** Temple hinge offset, scaled up from the shared `temple()` default `0.095`
 * by the same ratio {@link STAR_FRAME_SIZE} grew over the shipped `0.235`, so
 * the arm still meets the frame's own edge instead of drifting off it as the
 * frame grows — the same reasoning as {@link SUN_TEMPLE_HINGE}. */
const STAR_TEMPLE_HINGE = 0.095 * (STAR_FRAME_SIZE / 0.235);

/**
 * How far back from each spike to round it, in `starGeometry`'s own
 * pre-`size`-scale units (see that function's `pointRadius` doc comment) — a
 * fixed fraction of a spike edge's own length (≈0.68 units at this star's
 * `outer`/`inner` radii), not of {@link STAR_FRAME_SIZE}, so the rounding
 * reads the same "friendlier, cartoonish" amount whatever size the star ends
 * up drawn at, rather than getting proportionally sharper as the frame grows.
 * Jim: the star's points read as "sharp/pointy" and needed softening without
 * losing the star silhouette — this rounds a visible corner off each tip
 * while leaving most of each spike's edge straight.
 */
const STAR_POINT_RADIUS = 0.16;

/**
 * `starGeometry`'s default puts one point straight down (see that function's
 * `rotation` doc comment) — not how a five-point star is normally drawn.
 * Jim asked for the classic "one point straight up" layout on the glasses
 * specifically, so this flips it by half a turn; every other caller of
 * `starGeometry` is untouched.
 */
const STAR_ROTATION = Math.PI;

/** `starGeometry`, pre-bent to this file's rounded-tip, point-up look — see
 * {@link STAR_POINT_RADIUS} and {@link STAR_ROTATION}. Passed to
 * `shapedLensPair` in place of the bare `starGeometry` import so the frame
 * and lens (built at two different sizes) both pick up the same treatment. */
function starLensGeometry(size: number, depth: number): BufferGeometry {
  return starGeometry(size, depth, 5, STAR_POINT_RADIUS, STAR_ROTATION);
}

/** Star glasses: a five-point star lens over each eye, gold-rimmed. */
function createStarGlasses(): AssetHandle {
  const { root, fit } = glassesGroups('glasses.star');

  bridgePiece(fit, ART.glassesStarFrame);
  shapedLensPair(
    fit,
    starLensGeometry,
    ART.glassesStarFrame,
    ART.glassesStarLens,
    STAR_FRAME_SIZE,
    STAR_LENS_SIZE,
    STAR_OUTLINE,
  );
  for (const side of [-1, 1] as const) {
    temple(fit, side, EYE_HALF_GAP, ART.glassesStarFrame, STAR_TEMPLE_HINGE);
  }

  return finish(root);
}

/**
 * Heart lens/frame size, in head units — grown to match the sunglasses' new
 * scale the same way {@link STAR_FRAME_SIZE} was. The shipped pair used
 * `0.22`.
 *
 * A heart's own `halfWidth ≈ 0.42 × size` (measured off the built geometry) —
 * narrower relative to its `size` than the star's `0.556×`, so it starts with
 * far more headroom over the nose bridge (original gap ≈ 20 cm at kid scale)
 * and can grow much further before its near-nose edge reaches the other
 * lens's. `0.36` leaves a checked ~26 mm margin at kid scale (`EYE_HALF_GAP`
 * 0.1601 − frame half-width 0.1514, ×2 ×`KID_HEAD_SCALE`) — comparable in
 * absolute terms to the star's own margin above, even though it is a much
 * bigger jump from this shape's own baseline (+64% vs. the star's +15%),
 * because this shape had far more room to give.
 */
const HEART_FRAME_SIZE = 0.36;
/** Kept at the shipped pair's lens-to-frame ratio (~0.80). */
const HEART_LENS_SIZE = 0.286;
/** Same reasoning as {@link STAR_OUTLINE}: raised from the shipped `0.008`
 * into ART_DIRECTION.md §2's props range, matching the sunglasses' rim. */
const HEART_OUTLINE = 0.016;
/** Same reasoning as {@link STAR_TEMPLE_HINGE}, scaled by how far
 * {@link HEART_FRAME_SIZE} grew over the shipped `0.22`. */
const HEART_TEMPLE_HINGE = 0.095 * (HEART_FRAME_SIZE / 0.22);

/** Heart glasses: a heart-shaped lens over each eye, pink-rimmed. */
function createHeartGlasses(): AssetHandle {
  const { root, fit } = glassesGroups('glasses.heart');

  bridgePiece(fit, ART.heartPink);
  shapedLensPair(
    fit,
    heartGeometry,
    ART.heartPink,
    ART.glassesHeartLens,
    HEART_FRAME_SIZE,
    HEART_LENS_SIZE,
    HEART_OUTLINE,
  );
  for (const side of [-1, 1] as const) {
    temple(fit, side, EYE_HALF_GAP, ART.heartPink, HEART_TEMPLE_HINGE);
  }

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
