import {
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  type MeshToonMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { PALETTE, Rng } from '../style/bridge';
import { ART } from '../style/artPalette';
import { visiblePoints, visibleTop } from '../style/measure';
import { addOutline, decal, inkTint, markShared, solid, toonMaterial } from '../style/materials';
import { starGeometry } from '../style/shapes';
import { css, FACE_FILL_INSET, paintFaceOnFill, type FacePaintOptions } from '../style/faces';
import { createPuffNotes, createSongScheduler, playPuffMelody } from '../effects/puffSong';
import { blob, type AssetHandle } from '../style/asset';
import { KID_HEAD_SCALE, kidEyeTopAt } from './kid';
import {
  CHEERY_HOOD,
  CHEERY_PEAK,
  hoodFaceUv,
  hoodHemRollGeometry,
  hoodPeakGeometry,
  hoodPeakLiningGeometry,
  hoodShellGeometry,
  mirrorEar,
  plushEarGeometry,
  RIPIKA_HOOD,
  RIPIKA_PEAK,
  TRILLA_HOOD,
  TRILLA_PEAK,
  type HoodFaceWindow,
  type HoodShellSpec,
  type PlushEarSpec,
} from './hoodShell';

/**
 * The hat shop's stock — and, from build step 5 onwards, what the player wears.
 *
 * These follow the asset contract with one deliberate reading of it: a hat's
 * **origin is the point that sits on `hatAnchor`**, which is the crown of the
 * head, not the ground. Everything else holds — forward is +Z, `root.scale` is
 * left at 1, colours come from PALETTE/ART — so mounting one later is
 *
 * ```ts
 * kid.hatAnchor.add(createHat('crown').root);   // no offset maths
 * ```
 *
 * and standing one on a shop display is the same group parented to a stand.
 * Brims therefore hang *below* y = 0: the anchor is the top of the skull, and a
 * brim drawn at y = 0 would float above the hair.
 *
 * `height` is measured from the origin to the tip, which is what a name label
 * or a display plinth needs; the negative part of a brim is never more than a
 * few centimetres.
 *
 * ## Every number in this file is in *head units*, not metres
 *
 * A hat is only ever the right size relative to the head under it, so the
 * geometry below is authored against a skull of radius 0.44 — the kid's, as
 * `art/models/kid.ts` first wrote it — and {@link FIT} converts that into
 * metres at the end. Change the kid's head and every hat follows.
 *
 * This is not a stylistic preference; it is the bug. `kid.ts`'s cartoon pass
 * took `KID_HEAD_SCALE` from 1 to 1.5 and everything mounted on the head grew
 * with it — hair, ears, face patch, the hat anchor. The hats, sitting in this
 * file with the raw 0.44-skull numbers still in them, did not. Measured
 * (`scripts/measure-hat-fit.mts`) each hat's band came out 0.64–0.72× as wide
 * as the skull it was gripping: the head bulged straight out through every
 * band, which is what "the hats are all much too small" looks like from a
 * sofa. One `FIT` group per hat fixes the lot and keeps them fixed.
 */
export type HatKind = 'party' | 'crown' | 'bobble' | 'sun' | 'cap' | 'flower' | 'ripikaHat' | 'puff';

export const HAT_KINDS: readonly HatKind[] = [
  'party',
  'crown',
  'bobble',
  'sun',
  'cap',
  'flower',
  'ripikaHat',
  'puff',
];

/**
 * Head units → metres. See the header: this is the kid's own head knob, so a
 * hat is always the size the head it sits on wants it to be.
 *
 * It scales {@link SIT} along with the geometry, which is the point — how deep
 * a band sinks is a fraction of a skull, not a fixed number of centimetres.
 */
const FIT = KID_HEAD_SCALE;

/**
 * **How much bigger than life the family wants their hats** (31 July 2026).
 *
 * Live-testing session, in Jim's words: *"totally fine, but make all hats 50%
 * bigger"*, and then *"make crown and cherry cap 30% bigger again"*. So every
 * hat is ×1.5, and the Sparkly Crown and the Cheery Cap take a further ×1.3 on
 * top of that ({@link HAT_SIZE_EXTRA}) for ≈×1.95. The two critter hoods are
 * named in neither instruction and get the plain ×1.5.
 *
 * This is a **design decision, not a fudge factor**: hats in this park are
 * deliberately, comically oversized, the way a dressing-up box is. It lived for
 * one afternoon as a `// TEMPORARY: for testing` edit to {@link FIT}, was never
 * written down as a requirement, and was therefore lost the moment the Cheery
 * Cap and the two critter hoods were rebuilt on `hoodShell.ts` — which is why
 * it is a named constant with the quote attached rather than a number folded
 * into `FIT`. `check:hat-fit`'s `MIN_SPAN` now fails if it goes missing again.
 *
 * Kept separate from `FIT` because the two mean different things and drift
 * apart on purpose: `FIT` is the head's own scale, and a hat must track it
 * exactly or it stops fitting; this is taste, and only the family moves it.
 */
export const HAT_SIZE = 1.5;

/**
 * The further ×1.3 on the Sparkly Crown and the Cheery Cap. See {@link HAT_SIZE}.
 *
 * **Worth knowing before you retune it:** the ×1.3 was approved by eye against
 * the *old* Cheery Cap — a squashed sphere with a half-cylinder peak, 0.94× the
 * bare head across. The cap was rebuilt on `hoodShell.ts` afterwards and is
 * 1.09× across before any of this is applied, so ×1.95 lands somewhere the
 * family has not actually seen. It is the number they asked for; whether it is
 * the *cap* they asked for is a question for the sofa.
 */
const HAT_SIZE_EXTRA: Partial<Record<HatKind, number>> = { crown: 1.3, cap: 1.3 };

/** The total scale-up for one hat: {@link HAT_SIZE}, plus its own extra. */
function hatSize(kind: HatKind): number {
  return HAT_SIZE * (HAT_SIZE_EXTRA[kind] ?? 1);
}

/**
 * **How far apart the hat shop stands its display stands**, in metres.
 *
 * Lives here rather than in `world/building/shops/fitouts.ts`, which lays the
 * row out, because {@link hatDisplayScale} is derived from it and the two were
 * separately-written copies of `0.85`. `check:hat-fit` asserts the widest two
 * hats in the shop clear each other at this spacing.
 */
export const HAT_STAND_SPACING = 0.85;

/**
 * The head a hat is shown against on a stand, in metres — see
 * {@link hatDisplayScale}. Tuned, and then asserted: at 0.85 the widest two
 * hats overlap.
 */
const HAT_DISPLAY_HEAD = 0.77;

/**
 * How big a hat is shown on a shop stand, as a fraction of life size.
 *
 * Exported so `fitouts.ts` does not have to know about {@link FIT}: a life-size
 * sun hat is 2.1 m across on stands {@link HAT_STAND_SPACING} apart, so showing
 * them life size would have each brim sawing through its neighbours. A stand
 * instead shows every hat as though it were sitting on a 0.77 m head.
 *
 * **Per kind, dividing out {@link hatSize}** — which is the part that is easy to
 * get wrong. A worn hat's size is a matter of family taste and moves when they
 * say so; a shop display's size is a matter of the stands being 0.85 m apart
 * and does not. Fold the two together and the 31 July ×1.5, and the crown and
 * cap's further ×1.3, walk straight into the neighbouring stands — measured,
 * the ×1.95 Cheery Cap overlapped the sun hat beside it by 109 mm. Dividing it
 * out means the shop looks the same however big the family want to wear them.
 *
 * 0.77 rather than the 0.85 this used to be written as: the RiPika cap and the
 * Trilla bonnet were *already* overlapping by 9 mm before any of this, which
 * nothing measured. `check:hat-fit` measures it now.
 */
export function hatDisplayScale(kind: HatKind): number {
  return HAT_DISPLAY_HEAD / (FIT * hatSize(kind));
}

/** How deep a hat sinks onto the skull, so the band grips rather than hovers. */
const SIT = -0.1;

/**
 * A hat's two groups: the `root` the contract talks about, left at scale 1 for
 * the caller's pop-in, and the `fit` group inside it that every piece of
 * geometry goes into, holding the one conversion from head units to metres.
 *
 * Two groups rather than writing `FIT` onto `root`, because the contract
 * reserves `root.scale` for the caller — `entities/WornHat.ts` pops a new hat
 * in by writing it, and `check:assets` fails any asset that has spent it.
 *
 * {@link HAT_SIZE} is deliberately *not* applied here: it goes on in
 * {@link finish}, once the geometry exists to measure. See there for why.
 */
function hatGroups(name: string): { root: Group; fit: Group } {
  const root = new Group();
  root.name = name;
  const fit = new Group();
  fit.name = `${name}:fit`;
  fit.scale.setScalar(FIT);
  root.add(fit);
  return { root, fit };
}

/**
 * The lowest a hat comes **in front of the wearer's eyes**, in metres about the
 * hat anchor — its brow line. `null` if nothing it is made of crosses the eyes
 * at all (a flower crown very nearly does not).
 *
 * Per azimuth, against {@link kidEyeTopAt}, for the reason that function gives:
 * an eye is an ellipse with no height at all at its outer corner, so the lowest
 * point *anywhere* in the eyes' azimuth range is not a fair comparison.
 */
function browLine(root: Group): number | null {
  const TAU = Math.PI * 2;
  const buckets = 360;
  const lowest = new Array<number>(buckets).fill(Number.POSITIVE_INFINITY);
  visiblePoints(root, (point) => {
    if (point.z <= 0) return;
    const bucket = Math.floor(((Math.atan2(point.x, point.z) + Math.PI) / TAU) * buckets);
    lowest[bucket] = Math.min(lowest[bucket] as number, point.y);
  });
  let brow = Number.POSITIVE_INFINITY;
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const hat = lowest[bucket] as number;
    if (!Number.isFinite(hat)) continue;
    if (kidEyeTopAt(((bucket + 0.5) / buckets) * TAU - Math.PI) === null) continue;
    brow = Math.min(brow, hat);
  }
  return Number.isFinite(brow) ? brow : null;
}

/**
 * Finishes a hat: **grows it to {@link HAT_SIZE}**, then measures its `height`
 * off the geometry, never hand-written.
 *
 * ## A hat grows about its own brow line
 *
 * The `fit` group's origin *is* the hat anchor, the crown of the skull. So the
 * obvious way to make a hat bigger — multiply `fit.scale` — scales it about the
 * crown, which makes it ×1.5 wider **and sinks its hem ×1.5 further down the
 * wearer's face**. Measured on the built hats, the ×1.95 Cheery Cap's peak came
 * out 62 mm *below* the top of her eyes: a hat pulled down over a child's face,
 * against GAME_DESIGN.md's standing rule that a critter hood never covers it
 * and against `hoodShell.ts`'s own peak-height table. That is what the one
 * afternoon of `// TEMPORARY` scaling would have shipped.
 *
 * So the scale is applied about the **brow line** — the lowest the hat comes in
 * front of the eyes — instead of about the crown:
 *
 * ```
 * y ↦ brow + k · (y − brow)
 * ```
 *
 * which is `fit.scale × k` plus a lift of `−(k−1) · brow`. Every point above
 * the brow rises and every point below it is the brow itself, so **a hat gets
 * bigger upward and outward and never comes one millimetre further down her
 * face than the version the designer fitted**. It needs no threshold and no
 * tuning: whatever clearance a hat has today it still has at any size, so a
 * future hat, or a future number from the sofa, cannot quietly reintroduce this.
 *
 * The band still grips: it stays at the height its designer chose, which is the
 * point. It is a *loose* grip afterwards — a ×1.5 hat on an unchanged head must
 * stand proud of it — and that is what an oversized dressing-up hat looks like.
 *
 * Four hats used to carry a hand-written height and four had an entry in
 * `check:assets`'s KNOWN_DRIFT to match (crown −20 mm, sun −24 mm, flower
 * −38 mm, the RiPika hat −28 mm). Multiplying a hand-written number by `FIT`
 * would only have multiplied its error, so all four are measured now and all
 * four entries are gone — and this is why the growth happens *here*, after the
 * geometry exists, rather than in {@link hatGroups} before there is anything to
 * measure.
 */
function finish(root: Group, fit: Group, kind: HatKind): AssetHandle {
  const k = hatSize(kind);
  const brow = browLine(root);
  fit.scale.multiplyScalar(k);
  // No brow line means nothing this hat is made of crosses her eyes, so there
  // is nothing to hold still and it simply grows about the crown.
  fit.position.y -= (k - 1) * (brow ?? 0);
  return { root, height: visibleTop(root) };
}

function ring(radius: number, tube: number, colour: number): Mesh {
  const mesh = solid(new Mesh(new TorusGeometry(radius, tube, 8, 20), toonMaterial(colour)));
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

function createPartyHat(): AssetHandle {
  const { root, fit } = hatGroups('hat.party');

  const cone = solid(new Mesh(new ConeGeometry(0.26, 0.42, 18), toonMaterial(PALETTE.markerPink)));
  cone.position.y = SIT + 0.21;
  fit.add(cone);
  addOutline(cone, 0.011);

  const stripe = ring(0.19, 0.028, PALETTE.markerLemon);
  stripe.position.y = SIT + 0.13;
  fit.add(stripe);

  const pom = blob(0.075, toonMaterial(ART.cream), [1, 0.9, 1], 14);
  pom.position.y = SIT + 0.44;
  fit.add(pom);

  return finish(root, fit, 'party');
}

function createCrown(): AssetHandle {
  const { root, fit } = hatGroups('hat.crown');

  // Five points, made by squashing a five-sided cone — a crown is a pentagon
  // with the top pulled up, and one cone is cheaper than five spikes.
  const band = solid(
    new Mesh(new CylinderGeometry(0.26, 0.27, 0.16, 20), toonMaterial(ART.helmetGold)),
  );
  band.position.y = SIT + 0.08;
  fit.add(band);
  addOutline(band, 0.011);

  const points = solid(new Mesh(new ConeGeometry(0.27, 0.2, 5), toonMaterial(ART.helmetGold)));
  points.position.y = SIT + 0.24;
  fit.add(points);

  const jewel = decal(new Mesh(starGeometry(0.13, 0.03), toonMaterial(PALETTE.markerPink)));
  jewel.position.set(0, SIT + 0.09, 0.26);
  fit.add(jewel);

  return finish(root, fit, 'crown');
}

function createBobbleHat(): AssetHandle {
  const { root, fit } = hatGroups('hat.bobble');

  const dome = solid(
    new Mesh(
      new SphereGeometry(0.28, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.58),
      toonMaterial(PALETTE.markerSky),
    ),
  );
  dome.position.y = SIT + 0.02;
  dome.scale.set(1, 1.1, 1);
  fit.add(dome);
  addOutline(dome, 0.012);

  const brim = ring(0.265, 0.055, PALETTE.blossomWhite);
  brim.position.y = SIT + 0.01;
  fit.add(brim);

  const pom = blob(0.1, toonMaterial(PALETTE.blossomWhite), [1, 0.92, 1], 16);
  pom.position.y = SIT + 0.33;
  fit.add(pom);

  return finish(root, fit, 'bobble');
}

function createSunHat(): AssetHandle {
  const { root, fit } = hatGroups('hat.sun');

  const brim = solid(
    new Mesh(new CylinderGeometry(0.46, 0.46, 0.05, 24), toonMaterial(PALETTE.flowerYellow)),
  );
  brim.position.y = SIT + 0.02;
  // Nothing is plumb: a sun hat worn at a slight angle reads as jaunty rather
  // than as a dinner plate.
  brim.rotation.z = 0.08;
  fit.add(brim);
  addOutline(brim, 0.01);

  const dome = solid(
    new Mesh(
      new SphereGeometry(0.24, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55),
      toonMaterial(PALETTE.flowerYellow),
    ),
  );
  dome.position.y = SIT + 0.04;
  dome.scale.set(1, 0.9, 1);
  fit.add(dome);

  const ribbon = ring(0.235, 0.032, PALETTE.blossomPink);
  ribbon.position.y = SIT + 0.07;
  fit.add(ribbon);

  return finish(root, fit, 'sun');
}

/**
 * How far round the wearer's head the cap is knocked, in radians.
 *
 * ART_DIRECTION.md §4: nothing is plumb, and every head needs one asymmetric
 * feature or it reads as a placeholder. The two critter hoods get theirs from
 * things hung on them — the RiPika cap's droopier left ear, Trilla's off-centre
 * curl — and a plain cap has nothing to hang. So it is simply **worn slightly
 * crooked**, the way a cap on a six-year-old always is.
 *
 * A *yaw* specifically, and not the tilt the sun hat uses. Tilting lifts one
 * side of the band off a skull the hem is cut to hug, opening a three-centimetre
 * gap; rotating about the vertical moves the band along its own contact ring and
 * costs nothing. It is also free in `check:hat-fit`, which measures span as
 * `hypot(x, z)` about that same axis.
 */
const CAP_JAUNT = 0.11;

/**
 * The Cheery Cap.
 *
 * The plain one, and the last hat that was still a squashed sphere with a
 * half-cylinder stuck on the front for a peak. It is now cut from the same
 * `hoodShell.ts` surface as the two critter hoods and has the anatomy they do —
 * a six-panel crown with creased seams, a band rolled along the hem, a peak on
 * its own plane below the crown, and a button on top — with nothing added.
 *
 * The one thing worth knowing is the **colour split**, because it is what makes
 * the shape legible rather than decoration. Peak and band started out both in
 * `leafMid`, the cap's existing green, and at the game's 38° camera they merged
 * into a single green bowl with a mint dome sitting in it. The RiPika cap does
 * not have this problem because its band is cream against a yellow peak. So the
 * band here is the crown's own mint — a self-fabric sweatband, which is what a
 * plain cap has anyway — leaving the green peak as the only accent and the
 * only thing breaking the silhouette forward. The band still reads from behind:
 * it is a rolled tube, so it carries its own shading.
 */
function createCap(): AssetHandle {
  const { root, fit } = hatGroups('hat.cap');
  fit.rotation.y = CAP_JAUNT;

  const shell = hoodPart(hoodShellGeometry(CHEERY_HOOD), PALETTE.markerMint);
  shell.name = 'hoodShell';
  fit.add(shell);
  addOutline(shell, 0.013);

  const peak = hoodPart(hoodPeakGeometry(CHEERY_HOOD, CHEERY_PEAK), PALETTE.leafMid);
  fit.add(peak);
  addOutline(peak, 0.011);

  // Both sides, for the same reason the RiPika cap's is: a child looking up at
  // a friend sees the underside of the bill and nothing else of it.
  const lining = decal(
    new Mesh(hoodPeakLiningGeometry(CHEERY_HOOD, CHEERY_PEAK), toonMaterial(PALETTE.markerMint)),
  );
  (lining.material as MeshToonMaterial).side = DoubleSide;
  fit.add(lining);

  const band = hoodPart(hoodHemRollGeometry(CHEERY_HOOD, 0.03), PALETTE.markerMint);
  fit.add(band);

  const button = blob(0.044, toonMaterial(PALETTE.leafMid), [1, 0.72, 1], 14);
  button.position.y = CHEERY_HOOD.semiY + 0.013;
  fit.add(button);

  return finish(root, fit, 'cap');
}

function createFlowerCrown(): AssetHandle {
  const { root, fit } = hatGroups('hat.flower');

  const band = ring(0.27, 0.05, PALETTE.leafMid);
  band.position.y = SIT + 0.02;
  fit.add(band);
  addOutline(band, 0.01);

  // Six blooms round the band as one instanced mesh — the same geometry six
  // times over is exactly what instancing is for, even at this small a count.
  const blooms = new InstancedMesh(
    new SphereGeometry(0.075, 12, 9),
    toonMaterial(PALETTE.blossomPink),
    6,
  );
  blooms.castShadow = false;
  blooms.receiveShadow = true;
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const scale = new Vector3(1, 0.78, 1);
  const position = new Vector3();
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    position.set(Math.cos(angle) * 0.27, SIT + 0.06, Math.sin(angle) * 0.27);
    matrix.compose(position, rotation, scale);
    blooms.setMatrixAt(i, matrix);
  }
  blooms.instanceMatrix.needsUpdate = true;
  fit.add(blooms);

  const heart = blob(0.045, toonMaterial(PALETTE.flowerYellow), [1, 0.7, 1], 10);
  heart.position.set(0, SIT + 0.09, 0.27);
  fit.add(heart);

  return finish(root, fit, 'flower');
}

// =============================================================================
// The two critter hoods.
//
// Both used to be the creature itself, shrunk: `createRipikaHat` called
// `buildRipikaHead()` and `createPuffHat` called `createPuffCreature()`, and
// each perched the result on the crown. The family read it as uncanny rather
// than cute, and rightly — a hat shaped like an animal and a shrunken live
// animal are different objects. What a child wears is a **character cap**: a
// crown with panel seams, a peak, a band, sewn-on ears, and the animal's face
// appliquéd onto the front. `hoodShell.ts` owns the surface those are cut from
// and carries the design notes; this file assembles and paints them.
//
// Neither hood ever comes down over the wearer's face — GAME_DESIGN.md's rule
// for the RiPika hat, and both peaks clear the wearer's eyes by 0.15 head units
// (0.23 m). See the peak-height table in HANDOFF/hoodShell.
// =============================================================================

/** A hood part: solid, toon-shaded, one colour. */
function hoodPart(geometry: BufferGeometry, colour: number): Mesh {
  return solid(new Mesh(geometry, toonMaterial(colour)));
}

/**
 * A hood's skin: its base colour with the animal's face painted into it.
 *
 * There is no separate face mesh. The face is baked into the shell's **own**
 * texture, at the shell's own UVs — see `HoodFaceWindow` in `hoodShell.ts` for
 * why, and for the bug that caused the change. The texture is opaque: no
 * `transparent`, no `alphaTest`, no `renderOrder`, nothing to sort.
 *
 * Cached per key and `markShared`, so the shop stand's copy and the worn copy
 * paint one canvas between them and `disposeTree` leaves it alone. A hat is
 * worn and taken off constantly in the character creator, and a fresh 512²
 * canvas per try-on is exactly the leak `ownTextures` was added to stop.
 */
const hoodSkins = new Map<string, ReturnType<typeof paintFaceOnFill>>();
function hoodSkinTexture(
  key: string,
  fill: number,
  paint: FacePaintOptions,
  under?: (ctx: CanvasRenderingContext2D, size: number) => void,
): ReturnType<typeof paintFaceOnFill> {
  const cached = hoodSkins.get(key);
  if (cached) return cached;
  const texture = markShared(paintFaceOnFill(fill, paint, under));
  hoodSkins.set(key, texture);
  return texture;
}

/** A hood shell wearing its face, outlined in its own colour rather than white. */
function facedHoodShell(
  spec: HoodShellSpec,
  window: HoodFaceWindow,
  colour: number,
  texture: ReturnType<typeof paintFaceOnFill>,
): Mesh {
  // White, because the map carries the colour — including the hood's own base
  // colour, which is the texture's background fill. The outline would otherwise
  // be tinted from white and come out grey, so it is given the real colour.
  const mesh = solid(new Mesh(hoodShellGeometry(spec, window), toonMaterial(0xffffff, { map: texture })));
  mesh.name = 'hoodShell';
  addOutline(mesh, 0.013, inkTint(colour));
  return mesh;
}

/**
 * A pair of sewn plush ears, splayed outward and canted back.
 *
 * `rotation` order is **ZXY**: the splay has to happen before the cant, or the
 * cant tips the ear sideways instead of backwards. And the splay is `-side`,
 * because a positive rotation about Z carries `+y` towards `−x` — getting that
 * sign wrong made both ears lean inwards and cross over the crown.
 */
function addPlushEars(
  fit: Group,
  ear: PlushEarSpec,
  place: { x: number; y: number; z: number; splay: number; cant: number; droop: number },
  shaftColour: number,
  tipColour: number,
): void {
  const right = plushEarGeometry(ear);
  const left = { shaft: mirrorEar(right.shaft), tip: mirrorEar(right.tip) };
  for (const side of [-1, 1] as const) {
    const group = new Group();
    group.name = `hoodEar${side < 0 ? 'L' : 'R'}`;
    group.position.set(side * place.x, place.y, place.z);
    // One ear droops further than the other: the asymmetric feature every head
    // in this game has to have (ART_DIRECTION.md §4).
    group.rotation.set(place.cant, 0, -side * (place.splay + (side < 0 ? place.droop : 0)), 'ZXY');
    const parts = side < 0 ? left : right;
    const shaft = hoodPart(parts.shaft, shaftColour);
    group.add(shaft);
    addOutline(shaft, 0.011);
    const tip = hoodPart(parts.tip, tipColour);
    group.add(tip);
    addOutline(tip, 0.009);
    fit.add(group);
  }
}

/** RiPika's face, appliquéd. Its own disc cheeks, cocoa nose and "w" mouth. */
export const RIPIKA_HOOD_FACE: FacePaintOptions = {
  size: 512,
  eyeY: 0.46,
  // Much wider than RiPika's own 0.46, because the window this is mapped onto
  // is wider than it is tall — a cap's front panel is, and the eyes have to
  // land at ±21° off the front to sit where a character cap's do.
  eyeGap: 0.6,
  eyeW: 0.1,
  eyeH: 0.15,
  mouth: 'cat',
  mouthW: 0.072,
  mouthDrop: 0.235,
  nose: ART.ripikaTip,
  blush: ART.ripikaCheek,
  blushStyle: 'disc',
  blushR: 0.095,
};

/** Where that face sits on the cap — the window of the shell it is painted into. */
export const RIPIKA_FACE_WINDOW: HoodFaceWindow = { halfX: 0.62, yLo: -0.15, yHi: 0.24 };

/**
 * The RiPika cap.
 *
 * A neat six-panel plush snapback in RiPika's yellow: deep-yellow peak with a
 * cream lining, a cream hem roll for the band, a crown button, and RiPika's own
 * painted face across the front.
 *
 * The ears are the design's main argument that this is a hat rather than a
 * head. RiPika's own are round tapered cones standing up off the skull; these
 * are **short, wide, blunt paddles, flattened front-to-back** — appliqué, the
 * proportions a sewn ear actually has, and deliberately not the long thin
 * spikes of the character-cap genre's most famous example.
 */
function createRipikaHat(): AssetHandle {
  const { root, fit } = hatGroups('hat.ripikaHat');

  const shell = facedHoodShell(
    RIPIKA_HOOD,
    RIPIKA_FACE_WINDOW,
    ART.ripikaYellow,
    hoodSkinTexture('hood.ripika', ART.ripikaYellow, RIPIKA_HOOD_FACE),
  );
  fit.add(shell);

  const peak = hoodPart(hoodPeakGeometry(RIPIKA_HOOD, RIPIKA_PEAK), ART.ripikaYellowDeep);
  fit.add(peak);
  addOutline(peak, 0.011);

  // The peak's lining is an open sheet, so it needs both sides: a child looking
  // up at a friend sees the underside of the bill and nothing else of it.
  const lining = decal(
    new Mesh(
      hoodPeakLiningGeometry(RIPIKA_HOOD, RIPIKA_PEAK),
      toonMaterial(ART.ripikaBelly),
    ),
  );
  (lining.material as MeshToonMaterial).side = DoubleSide;
  fit.add(lining);

  const band = hoodPart(hoodHemRollGeometry(RIPIKA_HOOD, 0.04), ART.ripikaBelly);
  fit.add(band);

  const button = blob(0.044, toonMaterial(ART.ripikaYellowDeep), [1, 0.72, 1], 14);
  button.position.y = RIPIKA_HOOD.semiY + 0.013;
  fit.add(button);

  addPlushEars(
    fit,
    { base: 0.122, length: 0.315, flat: 0.66, curve: 0.58, taper: 0.46, split: 0.7 },
    { x: 0.185, y: 0.17, z: -0.035, splay: 0.42, cant: -0.22, droop: 0.1 },
    ART.ripikaYellow,
    ART.ripikaTip,
  );

  return finish(root, fit, 'ripikaHat');
}

/** Trilla's face. The puff's own big eyes and soft blush, no nose. */
export const TRILLA_HOOD_FACE: FacePaintOptions = {
  size: 256,
  eyeY: 0.46,
  eyeGap: 0.58,
  eyeW: 0.115,
  eyeH: 0.18,
  mouth: 'cat',
  mouthW: 0.062,
  mouthDrop: 0.205,
  blush: PALETTE.cheek,
  blushStyle: 'soft',
  blushR: 0.11,
};

export const TRILLA_FACE_WINDOW: HoodFaceWindow = { halfX: 0.58, yLo: -0.185, yHi: 0.195 };

/**
 * The bonnet's bib: a sewn-on lozenge of pale fabric under the face.
 *
 * It was a second decal mesh (`hoodBibGeometry`), wound inside out and so never
 * once drawn in the game. It is painted into the hood's own texture now, under
 * the face, for exactly the reasons the face is — one surface, nothing to keep
 * in step. It is drawn in the *face window's* canvas coordinates, so it goes
 * through `hoodFaceUv` like everything else rather than being placed by eye.
 *
 * A rectangle of a second colour reads as a rendering seam, so the width tapers
 * away top and bottom into a rounded lozenge — the same taper the mesh had, and
 * the reason it reads as something someone sewed on.
 */
const TRILLA_BIB = { halfX: 0.56, yLo: -0.18, yHi: -0.02 };

function drawTrillaBib(ctx: CanvasRenderingContext2D, size: number): void {
  const win = TRILLA_FACE_WINDOW;
  const steps = 48;
  /** One edge of the lozenge at height fraction `t`, in canvas pixels. */
  const edge = (t: number, side: -1 | 1): [number, number] => {
    const y = TRILLA_BIB.yLo + (TRILLA_BIB.yHi - TRILLA_BIB.yLo) * t;
    const taper = 0.35 + 0.65 * Math.sqrt(Math.max(0, 1 - ((2 * t - 1) * 0.92) ** 2));
    const phi = Math.PI - side * TRILLA_BIB.halfX * taper;
    const [u, v] = hoodFaceUv(win, phi, y);
    // Back out of the canvas inset: `under` is drawn in the face window's own
    // 0…size box, which `paintFaceOnFill` then insets as one piece.
    const span = 1 - 2 * FACE_FILL_INSET;
    return [((u - FACE_FILL_INSET) / span) * size, (1 - (v - FACE_FILL_INSET) / span) * size];
  };

  ctx.fillStyle = css(PALETTE.stonePinkLight);
  ctx.beginPath();
  for (let i = 0; i <= steps; i += 1) {
    const [x, y] = edge(i / steps, -1);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let i = steps; i >= 0; i -= 1) {
    const [x, y] = edge(i / steps, 1);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

/** How often the hood bursts into song, in seconds. Rarer than the pet's. */
const TRILLA_SONG = { min: 12, max: 22, nearSpeedup: 1 };

/**
 * The Trilla bonnet — the singing puff, worn.
 *
 * Deliberately a different *kind* of hat from the RiPika cap, so the shop's two
 * critter hoods do not read as one design in two colours: a soft round bonnet
 * with **earflaps** that hang beside the wearer's ears, a small pale brim, a
 * pale bib above it, and Trilla's own heart-pink curl worn as the topknot.
 * Trilla has no ears of its own, so the flaps carry the silhouette instead —
 * and a flap is a hem that dives at ±90°, which is the whole reason
 * `hoodShell.ts` is a parametric surface rather than a stack of blobs.
 *
 * **It still sings.** The old builder got the melody, the note burst, the
 * singing face and the jiggle for free by reusing `createPuffCreature`, and
 * losing them would have been a real regression, so they are rebuilt here on
 * top of the hood. The jiggle rides a `mount` group rather than `root`: the
 * contract reserves `root.scale` for the caller's pop-in (`entities/WornHat.ts`
 * writes it) and `check:assets` fails any asset that has spent it.
 */
function createPuffHat(): AssetHandle {
  const { root, fit } = hatGroups('hat.puff');

  const mount = new Group();
  mount.name = 'hat.puff:mount';
  fit.add(mount);

  const neutralFace = hoodSkinTexture(
    'hood.trilla',
    PALETTE.blossomPink,
    TRILLA_HOOD_FACE,
    drawTrillaBib,
  );
  const shell = facedHoodShell(TRILLA_HOOD, TRILLA_FACE_WINDOW, PALETTE.blossomPink, neutralFace);
  mount.add(shell);
  const faceMaterial = shell.material as MeshToonMaterial;

  const peak = hoodPart(hoodPeakGeometry(TRILLA_HOOD, TRILLA_PEAK), PALETTE.stonePinkLight);
  mount.add(peak);
  addOutline(peak, 0.011);

  const band = hoodPart(hoodHemRollGeometry(TRILLA_HOOD, 0.036), ART.heartPink);
  mount.add(band);

  // The curl: the puff's own asymmetric feature, off-centre and leaning, worn
  // as the bonnet's knot. Built from the same swept ear the cap's are, wound
  // most of the way round — a curl is an ear with the bend turned up.
  const curl = plushEarGeometry({
    base: 0.082,
    length: 0.3,
    flat: 0.88,
    curve: 1.95,
    taper: 0.6,
    split: 0.98,
  });
  const knot = hoodPart(curl.shaft, ART.heartPink);
  knot.position.set(0.062, TRILLA_HOOD.semiY - 0.05, -0.035);
  knot.rotation.set(0.24, 0, -0.44, 'ZXY');
  mount.add(knot);
  addOutline(knot, 0.011);
  curl.tip.dispose();

  // Singing is a swap of the whole hood skin now rather than of a face decal —
  // same two canvases, same swap, one fewer mesh.
  const singingFace = hoodSkinTexture(
    'hood.trilla.singing',
    PALETTE.blossomPink,
    {
      ...TRILLA_HOOD_FACE,
      eyeStyle: 'archHappy',
      mouth: 'oh',
      mouthW: (TRILLA_HOOD_FACE.mouthW ?? 0.062) * 1.25,
    },
    drawTrillaBib,
  );

  // Measured before the notes join it: a burst of floating notes is not part of
  // how tall a hat is, and the name label sits at `height + 0.42`.
  const handle = finish(root, fit, 'puff');

  // --------------------------------------------------------------- singing
  const rng = new Rng(0x7211a + puffHatCount * 7919);
  puffHatCount += 1;
  const notes = createPuffNotes(0x7211a + puffHatCount * 104729);
  mount.add(notes.root);
  const scheduler = createSongScheduler(rng, TRILLA_SONG);
  const mouthY = TRILLA_FACE_WINDOW.yLo + (TRILLA_FACE_WINDOW.yHi - TRILLA_FACE_WINDOW.yLo) * 0.3;
  const mouthZ = TRILLA_HOOD.shellR * TRILLA_HOOD.depth;
  const breathePhase = rng.range(0, Math.PI * 2);
  let singing = false;
  let singRemaining = 0;

  return {
    ...handle,
    update(dt: number, elapsed: number) {
      if (scheduler.update(dt, false) && !singing) {
        const song = playPuffMelody(rng, 0.8);
        singing = true;
        singRemaining = song.duration;
        faceMaterial.map = singingFace;
        faceMaterial.needsUpdate = true;
        notes.burst(0, mouthY, mouthZ, song.noteCount);
      }
      if (singing) {
        singRemaining -= dt;
        if (singRemaining <= 0) {
          singing = false;
          faceMaterial.map = neutralFace;
          faceMaterial.needsUpdate = true;
        }
      }
      notes.update(dt);

      // A gentle breathing squash, livelier while it is singing along.
      const amount = singing ? 0.055 : 0.03;
      const breathe = Math.sin(elapsed * 1.7 + breathePhase) * amount;
      mount.scale.set(1 + breathe * 0.6, 1 - breathe, 1 + breathe * 0.6);
    },
    dispose() {
      notes.root.removeFromParent();
      notes.dispose();
    },
  };
}

/** Staggers each bonnet's jiggle and song, deterministically — never `Math.random()`. */
let puffHatCount = 0;

const BUILDERS: Readonly<Record<HatKind, () => AssetHandle>> = {
  party: createPartyHat,
  crown: createCrown,
  bobble: createBobbleHat,
  sun: createSunHat,
  cap: createCap,
  flower: createFlowerCrown,
  ripikaHat: createRipikaHat,
  puff: createPuffHat,
};

/** A fresh hat. Parent it to `hatAnchor` (head) or to a shop stand. */
export function createHat(kind: HatKind): AssetHandle {
  return BUILDERS[kind]();
}
