import {
  Box3,
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
import { visibleBounds } from '../style/measure';
import { addOutline, decal, solid, toonMaterial } from '../style/materials';
import { starGeometry } from '../style/shapes';
import { blob, type AssetHandle } from '../style/asset';
import { buildRipikaHead } from './ripika';
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
 * Brims therefore hang *below* y = 0: the anchor is the top of a 0.44 m skull,
 * and a brim drawn at y = 0 would float above the hair.
 *
 * `height` is measured from the origin to the tip, which is what a name label
 * or a display plinth needs; the negative part of a brim is never more than a
 * few centimetres.
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

/** How deep a hat sinks onto the skull, so the band grips rather than hovers. */
const SIT = -0.1;

function ring(radius: number, tube: number, colour: number): Mesh {
  const mesh = solid(new Mesh(new TorusGeometry(radius, tube, 8, 20), toonMaterial(colour)));
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

function createPartyHat(): AssetHandle {
  const root = new Group();
  root.name = 'hat.party';

  const cone = solid(new Mesh(new ConeGeometry(0.26, 0.42, 18), toonMaterial(PALETTE.markerPink)));
  cone.position.y = SIT + 0.21;
  root.add(cone);
  addOutline(cone, 0.011);

  const stripe = ring(0.19, 0.028, PALETTE.markerLemon);
  stripe.position.y = SIT + 0.13;
  root.add(stripe);

  const pom = blob(0.075, toonMaterial(ART.cream), [1, 0.9, 1], 14);
  pom.position.y = SIT + 0.44;
  root.add(pom);

  return { root, height: SIT + 0.52 };
}

function createCrown(): AssetHandle {
  const root = new Group();
  root.name = 'hat.crown';

  // Five points, made by squashing a five-sided cone — a crown is a pentagon
  // with the top pulled up, and one cone is cheaper than five spikes.
  const band = solid(
    new Mesh(new CylinderGeometry(0.26, 0.27, 0.16, 20), toonMaterial(ART.helmetGold)),
  );
  band.position.y = SIT + 0.08;
  root.add(band);
  addOutline(band, 0.011);

  const points = solid(new Mesh(new ConeGeometry(0.27, 0.2, 5), toonMaterial(ART.helmetGold)));
  points.position.y = SIT + 0.24;
  root.add(points);

  const jewel = decal(new Mesh(starGeometry(0.13, 0.03), toonMaterial(PALETTE.markerPink)));
  jewel.position.set(0, SIT + 0.09, 0.26);
  root.add(jewel);

  return { root, height: SIT + 0.36 };
}

function createBobbleHat(): AssetHandle {
  const root = new Group();
  root.name = 'hat.bobble';

  const dome = solid(
    new Mesh(
      new SphereGeometry(0.28, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.58),
      toonMaterial(PALETTE.markerSky),
    ),
  );
  dome.position.y = SIT + 0.02;
  dome.scale.set(1, 1.1, 1);
  root.add(dome);
  addOutline(dome, 0.012);

  const brim = ring(0.265, 0.055, PALETTE.blossomWhite);
  brim.position.y = SIT + 0.01;
  root.add(brim);

  const pom = blob(0.1, toonMaterial(PALETTE.blossomWhite), [1, 0.92, 1], 16);
  pom.position.y = SIT + 0.33;
  root.add(pom);

  return { root, height: SIT + 0.43 };
}

function createSunHat(): AssetHandle {
  const root = new Group();
  root.name = 'hat.sun';

  const brim = solid(
    new Mesh(new CylinderGeometry(0.46, 0.46, 0.05, 24), toonMaterial(PALETTE.flowerYellow)),
  );
  brim.position.y = SIT + 0.02;
  // Nothing is plumb: a sun hat worn at a slight angle reads as jaunty rather
  // than as a dinner plate.
  brim.rotation.z = 0.08;
  root.add(brim);
  addOutline(brim, 0.01);

  const dome = solid(
    new Mesh(
      new SphereGeometry(0.24, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55),
      toonMaterial(PALETTE.flowerYellow),
    ),
  );
  dome.position.y = SIT + 0.04;
  dome.scale.set(1, 0.9, 1);
  root.add(dome);

  const ribbon = ring(0.235, 0.032, PALETTE.blossomPink);
  ribbon.position.y = SIT + 0.07;
  root.add(ribbon);

  return { root, height: SIT + 0.28 };
}

function createCap(): AssetHandle {
  const root = new Group();
  root.name = 'hat.cap';

  const dome = solid(
    new Mesh(
      new SphereGeometry(0.27, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.54),
      toonMaterial(PALETTE.markerMint),
    ),
  );
  dome.position.y = SIT + 0.01;
  dome.scale.set(1, 0.92, 1);
  root.add(dome);
  addOutline(dome, 0.012);

  // The peak: a flattened disc pushed out over the eyes.
  const peak = solid(
    new Mesh(new CylinderGeometry(0.24, 0.24, 0.04, 18, 1, false, 0, Math.PI), toonMaterial(PALETTE.leafMid)),
  );
  peak.position.set(0, SIT + 0.02, 0.16);
  peak.rotation.y = Math.PI;
  peak.rotation.x = -0.12;
  peak.scale.set(1, 1, 1.15);
  root.add(peak);

  const button = blob(0.045, toonMaterial(PALETTE.leafMid), [1, 0.8, 1], 12);
  button.position.y = SIT + 0.26;
  root.add(button);

  return { root, height: SIT + 0.31 };
}

function createFlowerCrown(): AssetHandle {
  const root = new Group();
  root.name = 'hat.flower';

  const band = ring(0.27, 0.05, PALETTE.leafMid);
  band.position.y = SIT + 0.02;
  root.add(band);
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
  root.add(blooms);

  const heart = blob(0.045, toonMaterial(PALETTE.flowerYellow), [1, 0.7, 1], 10);
  heart.position.set(0, SIT + 0.09, 0.27);
  root.add(heart);

  return { root, height: SIT + 0.16 };
}

/**
 * How much bigger than a *real* RiPika's own head this hat's head is built at
 * (RiPika itself uses 1.32 — see `ripika.ts`). The family asked for "a large
 * head of RiPika on the wearer's head", so this deliberately dwarfs every
 * other hat in the shop.
 *
 * It can go this big safely because of *where* a hat sinks, not how big it
 * is: every hat here sinks onto the skull by the same `SIT`, and the wearer's
 * eyes sit a long way further down the skull than that — a hat only grows
 * upward from `SIT`, so no amount of extra scale brings it anywhere near the
 * face. What has to stay in check is width more than height, which is why
 * this is 2.1×, not larger still: wide enough to read as "RiPika's actual
 * head", not so wide it reads as a blob eating the wearer's silhouette.
 */
const RIPIKA_HAT_SCALE = 2.1;

function createRipikaHat(): AssetHandle {
  const root = new Group();
  root.name = 'hat.ripikaHat';

  const ripikaHead = buildRipikaHead(RIPIKA_HAT_SCALE);
  // buildRipikaHead's group is centred on RiPika's own skull centre. Its
  // lowest point is the underside of the skull, at `-skullR * 0.97` (the
  // blob's own y-squash) — sink that point to `SIT`, exactly like every other
  // hat's brim/band, so it grips the wearer's crown rather than floating.
  ripikaHead.group.position.y = SIT + ripikaHead.skullR * 0.97;
  root.add(ripikaHead.group);

  // Measured to the actual top (ear tips lean outward under rotation, so the
  // exact offset isn't a clean formula) rather than hand-guessed, the same
  // way every asset's `height` must reach the real highest point.
  root.updateMatrixWorld(true);
  const height = new Box3().setFromObject(root).max.y;

  return { root, height };
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
  const puff = createPuffCreature({ variant: 'hat' });
  puff.root.name = 'hat.puff';

  // The ball's real extent, walked off its vertices — outline hull, curl and
  // all. Both numbers below used to be guessed from `PUFF_BALL_RADIUS * 0.92`,
  // a stand-in for the ball's own y-squash that missed the 12 mm outline the
  // ball wears, so the hat declared 0.358 m and built 0.492 m and sat 30 mm off
  // the crown instead of settling into the hair.
  const { bottom, top } = visibleBounds(puff.root);

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
  puff.root.add(mount);
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
    root: puff.root,
    // Measured to the real tip and carried across the same shift, so `height`
    // runs from this hat's origin — the crown — to the top of the curl.
    height: top + mount.position.y,
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
