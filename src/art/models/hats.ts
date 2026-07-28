import {
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { PALETTE } from '../style/bridge';
import { ART } from '../style/artPalette';
import { visibleBounds, visibleTop } from '../style/measure';
import { addOutline, decal, solid, toonMaterial } from '../style/materials';
import { starGeometry } from '../style/shapes';
import { blob, type AssetHandle } from '../style/asset';
import { KID_HEAD_SCALE } from './kid';
import { buildRipikaHead, RIPIKA_HEAD_SCALE } from './ripika';
import { createPuffCreature } from './pets';

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
 * How big a hat is shown on a shop stand, as a fraction of life size.
 *
 * Exported so `world/building/shops/fitouts.ts` does not have to know about
 * {@link FIT}: the stands are 0.85 m apart, and a life-size sun hat is 1.4 m
 * across, so displaying them at life size would have each brim slicing through
 * its neighbours. Written as a fraction of `FIT` so the stands keep the size
 * they have always shown whatever the head does next.
 */
export const HAT_DISPLAY_SCALE = 0.85 / FIT;

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
 * Finishes a hat: its `height` measured off the geometry just built, never
 * hand-written.
 *
 * Four of these used to carry a hand-written height and four had an entry in
 * `check:assets`'s KNOWN_DRIFT to match (crown −20 mm, sun −24 mm, flower
 * −38 mm, the RiPika hat −28 mm). Multiplying a hand-written number by `FIT`
 * would only have multiplied its error, so all four are measured now and all
 * four entries are gone.
 */
function finish(root: Group): AssetHandle {
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

  return finish(root);
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

  return finish(root);
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

  return finish(root);
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

  return finish(root);
}

function createCap(): AssetHandle {
  const { root, fit } = hatGroups('hat.cap');

  const dome = solid(
    new Mesh(
      new SphereGeometry(0.27, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.54),
      toonMaterial(PALETTE.markerMint),
    ),
  );
  dome.position.y = SIT + 0.01;
  dome.scale.set(1, 0.92, 1);
  fit.add(dome);
  addOutline(dome, 0.012);

  // The peak: a flattened disc pushed out over the eyes.
  const peak = solid(
    new Mesh(new CylinderGeometry(0.24, 0.24, 0.04, 18, 1, false, 0, Math.PI), toonMaterial(PALETTE.leafMid)),
  );
  peak.position.set(0, SIT + 0.02, 0.16);
  peak.rotation.y = Math.PI;
  peak.rotation.x = -0.12;
  peak.scale.set(1, 1, 1.15);
  fit.add(peak);

  const button = blob(0.045, toonMaterial(PALETTE.leafMid), [1, 0.8, 1], 12);
  button.position.y = SIT + 0.26;
  fit.add(button);

  return finish(root);
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

  return finish(root);
}

/**
 * The RiPika hat: RiPika's own head, at RiPika's own size, worn on top of
 * yours. GAME_DESIGN.md §"Hat shop" — "a large RiPika head worn on top of the
 * wearer's own head" — so it stays on the crown like every other hat here, and
 * never comes down over the face.
 *
 * **It used to be built at 2.1× instead**, chosen so the ball came out as wide
 * as the wearer's whole head. That is not a hat, it is a second head: a ball
 * 1.43 m across whose ear tips stood 1.67 m above the crown, taking a 2.12 m
 * child to 3.65 m — 1.72× her own height — which is the "the RiPika head is
 * too large" half of the family's report. A ball worn on top of a head rises
 * by its own diameter no matter where you sink it, so the only honest fix is a
 * smaller ball.
 *
 * `RIPIKA_HEAD_SCALE` is the size it should have been all along, and it is a
 * derived number rather than a tuned one: this *is* a RiPika head, so it is
 * exactly as big as the one on RiPika walking past you in the park. The
 * wearer's own head still reads clearly underneath, and the hat is still by
 * some way the biggest in the shop.
 *
 * The division by {@link FIT} is only the unit conversion — `buildRipikaHead`
 * works in metres and the `fit` group is in head units.
 */
function createRipikaHat(): AssetHandle {
  const { root, fit } = hatGroups('hat.ripikaHat');

  const ripikaHead = buildRipikaHead(RIPIKA_HEAD_SCALE / FIT);
  // buildRipikaHead's group is centred on RiPika's own skull centre. Its
  // lowest point is the underside of the skull, at `-skullR * 0.97` (the
  // blob's own y-squash) — sink that point to `SIT`, exactly like every other
  // hat's brim/band, so it grips the wearer's crown rather than floating.
  ripikaHead.group.position.y = SIT + ripikaHead.skullR * 0.97;
  fit.add(ripikaHead.group);

  // Measured to the actual top — the ear tips lean outward under two
  // rotations, so there is no clean formula — and by walking the vertices
  // rather than by `Box3`, which takes the axis-aligned box of an
  // already-rotated ear and reported the tips 28 mm higher than they are.
  return finish(root);
}

/**
 * The singing puff, worn as a hat.
 *
 * Reuses `createPuffCreature` from `pets.ts` wholesale rather than building a
 * second copy — same ball, same jiggle, same song, just settled onto the
 * head instead of standing on its own paws. The one thing this wrapper does
 * is the origin translation every hat needs: `createPuffCreature` puts the
 * ground at y = 0 the way every creature does, but a hat's origin is the
 * point that sits on `hatAnchor` (the crown), with the model sinking a
 * little *below* that the way every other hat's base does (see `SIT`). So
 * the whole puff is shifted down by exactly the depth of its own paws —
 * measured off the built ball, not guessed at from its radius.
 */
function createPuffHat(): AssetHandle {
  const { root, fit } = hatGroups('hat.puff');
  const puff = createPuffCreature({ variant: 'hat' });

  // How deep the ball's own paws are, walked off its vertices — outline hull
  // and all. It used to be guessed from `PUFF_BALL_RADIUS * 0.92`, a stand-in
  // for the ball's y-squash that missed the 12 mm outline the ball wears, and
  // the hat sat 30 mm off the crown instead of settling into the hair.
  const { bottom } = visibleBounds(puff.root);

  // Every other hat in this file leaves `root` at the origin and draws itself
  // relative to `SIT`, because `root` *is* the crown anchor — `WornHat` parents
  // it straight onto `hatAnchor` and pops it by writing `root.scale`, which
  // scales about that origin. This one was shifting `root.position.y` instead,
  // which put the hat's declared height and its geometry in two different
  // spaces (and popped it from a point inside the wearer's skull). The shift
  // goes on a group of its own between root and body: `body` cannot hold it,
  // because the puff's jiggle rewrites `body.position` and `body.scale` every
  // frame.
  const mount = new Group();
  mount.name = 'hat.puff:mount';
  mount.add(puff.body);
  // Into `fit`, not `puff.root`: the puff is authored in metres for the pet
  // pen, and everything worn on a head belongs in head units. It grows with
  // the head exactly as the sewn hats do — a ball that looked right on the
  // old skull is a marble on this one (0.33× the head, measured).
  fit.add(mount);
  // Settle it the same shallow depth into the hair that the bobble hat's rim
  // and the cap's dome do (SIT + ~0.02), rather than the full SIT a brim uses.
  mount.position.y = SIT + 0.02 - bottom;

  // `puff.update`/`puff.dispose` are typed as possibly-`undefined` because
  // `AssetHandle` declares them optional — but with `exactOptionalPropertyTypes`
  // an optional property must be OMITTED rather than explicitly set to
  // `undefined`. `createPuffCreature` always supplies both in practice, so
  // build the object conditionally instead of assigning the (statically)
  // possibly-undefined value straight through.
  return {
    ...finish(root),
    ...(puff.update && { update: puff.update }),
    ...(puff.dispose && { dispose: puff.dispose }),
  };
}

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
