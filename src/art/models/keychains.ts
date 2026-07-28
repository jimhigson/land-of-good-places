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

/**
 * Keychains — the little charms that dangle off the player's backpack.
 *
 * Five of them, all procedural, all tiny: a charm about 11 cm tall, a short
 * chain, and a split ring on top. At game zoom a keychain is a few dozen
 * pixels, so every one of them is built to read as a **silhouette plus one
 * colour** — a star, a strawberry, an arc of rainbow — rather than as a
 * detailed model shrunk down.
 *
 * ## Origin, and why it is at the bottom
 *
 * A hat's origin is its mount point (`art/models/hats.ts`), which is the
 * obvious thing to do for something that hangs. These do the opposite: origin
 * at the **base**, in the ordinary asset contract, with the split ring at the
 * top. That is not a style choice — `scripts/check-asset-contract.mts` walks
 * the whole shop catalogue and grants the `'anchor'` reading only to ids
 * beginning `hat.`, so a keychain built upside-down would fail the build as a
 * model whose geometry starts 20 cm above its own origin.
 *
 * `entities/WornKeychain.ts` therefore hangs one by dropping it its own
 * `height`, which puts the ring exactly on the backpack's anchor. One line,
 * in one place, and the shop's display rack can stand the same model on a
 * shelf with no offset maths at all.
 *
 * ## Faces
 *
 * Three of the five have eyes; the rainbow and the heart do not. `shopItems.ts`
 * already settled the principle for props this size — "a face patch would be a
 * whole canvas for a 30 cm prop; two ink dots and a blush do the same job" —
 * and a keychain is a third of that again. So no `createFacePatch` anywhere in
 * this file: a canvas texture per charm would cost more than the charm.
 */

export type KeychainKind = 'ripika' | 'star' | 'strawberry' | 'rainbow' | 'heart';

export const KEYCHAIN_KINDS: readonly KeychainKind[] = [
  'ripika',
  'star',
  'strawberry',
  'rainbow',
  'heart',
];

// --- the hardware ----------------------------------------------------------
//
// Shared by every charm so the five read as a matched set from one rack.

/** Length of the little chain between the charm and the ring, in metres. */
const CHAIN_LENGTH = 0.036;
/** Radius of the split ring, centre to tube middle. */
const RING_RADIUS = 0.024;
const RING_TUBE = 0.0075;

/**
 * Adds the chain and the split ring above a charm whose top is at `charmTop`,
 * and returns the whole thing's height.
 *
 * The ring is a full torus lying in the XZ-facing plane (that is, upright and
 * facing the camera), because the one thing a child must be able to see from
 * the isometric camera is that this object *hangs* — a ring edge-on reads as a
 * stray line.
 */
function addHardware(root: Group, charmTop: number): void {
  const metal = toonMaterial(ART.cream);

  const chain = solid(
    new Mesh(new CylinderGeometry(0.006, 0.006, CHAIN_LENGTH, 6), metal),
  );
  chain.position.y = charmTop + CHAIN_LENGTH / 2;
  root.add(chain);

  const ring = solid(
    new Mesh(new TorusGeometry(RING_RADIUS, RING_TUBE, 6, 14), metal),
  );
  ring.position.y = charmTop + CHAIN_LENGTH + RING_RADIUS;
  root.add(ring);
}

/**
 * Drops a charm so its lowest visible point sits on y = 0, and reports where
 * its top ended up.
 *
 * Measured rather than worked out by hand: several of these charms are built
 * from cones and half-tori whose extents are easy to get a centimetre wrong,
 * and a centimetre is a tenth of a keychain.
 */
function seat(charm: Group): number {
  const bounds = visibleBounds(charm);
  charm.position.y -= bounds.bottom;
  return bounds.top - bounds.bottom;
}

/** Two ink dots and a pair of blush discs — the whole of a charm's face. */
function addTinyFace(
  charm: Group,
  y: number,
  z: number,
  eyeGap: number,
  blushGap: number,
  blushColour: number = ART.blush,
): void {
  for (const side of [-1, 1] as const) {
    const eye = decal(new Mesh(new SphereGeometry(0.009, 8, 6), toonMaterial(ART.ink)));
    eye.position.set(side * eyeGap, y, z);
    eye.scale.set(0.8, 1.15, 0.5);
    charm.add(eye);

    const cheek = decal(new Mesh(new SphereGeometry(0.011, 8, 6), toonMaterial(blushColour)));
    cheek.position.set(side * blushGap, y - 0.012, z - 0.002);
    cheek.scale.set(1, 0.65, 0.3);
    charm.add(cheek);
  }
}

// --- the charms ------------------------------------------------------------

/** A RiPika head, small enough to fit in a fist. */
function ripikaCharm(): Group {
  const charm = new Group();
  const yellow = toonMaterial(ART.ripikaYellow);
  const cocoa = toonMaterial(ART.ripikaTip);

  const skull = blob(0.05, yellow, [1.06, 0.95, 0.9], 18);
  charm.add(skull);
  addOutline(skull, 0.008);

  // Tapered cylinders rather than cones: a needle-sharp ear is the fastest way
  // to make a cute creature look spiky, which `ripika.ts` learned first.
  for (const side of [-1, 1] as const) {
    const ear = solid(new Mesh(new CylinderGeometry(0.008, 0.019, 0.055, 8), yellow));
    ear.position.set(side * 0.032, 0.062, -0.004);
    ear.rotation.z = side * 0.42;
    charm.add(ear);

    const tip = solid(new Mesh(new SphereGeometry(0.011, 8, 6), cocoa));
    tip.position.set(side * 0.045, 0.085, -0.006);
    charm.add(tip);
  }

  addTinyFace(charm, 0.004, 0.046, 0.019, 0.034, ART.ripikaCheek);
  return charm;
}

/** A chunky five-pointed star, the same shape the plush star toy is cut from. */
function starCharm(): Group {
  const charm = new Group();
  const star = solid(new Mesh(starGeometry(0.115, 0.028), toonMaterial(PALETTE.flowerYellow)));
  charm.add(star);
  addOutline(star, 0.008);
  addTinyFace(charm, 0.004, 0.026, 0.018, 0.032);
  return charm;
}

/** A strawberry: a little red cone with a leafy green top and seeds. */
function strawberryCharm(): Group {
  const charm = new Group();
  const red = toonMaterial(PALETTE.flowerRed);
  const green = toonMaterial(PALETTE.leafMid);

  const body = solid(new Mesh(new ConeGeometry(0.05, 0.085, 14), red));
  // Turned over so the point hangs downwards, which is which way up a
  // strawberry is.
  body.rotation.x = Math.PI;
  body.position.y = 0.0425;
  charm.add(body);
  addOutline(body, 0.008);

  const shoulders = blob(0.05, red, [1, 0.5, 1], 16);
  shoulders.position.y = 0.085;
  charm.add(shoulders);

  // Six seeds as one instanced mesh — they are the only repeated geometry on
  // the charm and they are what makes a red cone read as a strawberry.
  const seedCount = 6;
  const seeds = new InstancedMesh(new SphereGeometry(0.006, 6, 4), toonMaterial(ART.cream), seedCount);
  seeds.castShadow = false;
  seeds.receiveShadow = false;
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const scale = new Vector3(1, 1.3, 0.5);
  const position = new Vector3();
  for (let i = 0; i < seedCount; i += 1) {
    const angle = i * 2.4;
    const level = i % 2 === 0 ? 0.05 : 0.028;
    const radius = 0.05 * (1 - level / 0.11);
    position.set(Math.sin(angle) * radius, level, Math.cos(angle) * radius);
    rotation.setFromUnitVectors(new Vector3(0, 0, 1), position.clone().normalize());
    matrix.compose(position, rotation, scale);
    seeds.setMatrixAt(i, matrix);
  }
  seeds.instanceMatrix.needsUpdate = true;
  charm.add(seeds);

  // The calyx: five flattened leaves, splayed.
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2;
    const leaf = solid(new Mesh(new SphereGeometry(0.016, 8, 6), green));
    leaf.scale.set(1, 0.35, 1.6);
    leaf.position.set(Math.sin(angle) * 0.026, 0.1, Math.cos(angle) * 0.026);
    leaf.rotation.y = -angle;
    charm.add(leaf);
  }

  addTinyFace(charm, 0.052, 0.045, 0.016, 0.028);
  return charm;
}

/** Four bands of rainbow springing out of two little clouds. */
function rainbowCharm(): Group {
  const charm = new Group();
  const bands = [PALETTE.markerPink, PALETTE.flowerYellow, PALETTE.markerMint, PALETTE.markerSky];

  bands.forEach((colour, index) => {
    const radius = 0.078 - index * 0.017;
    const arc = solid(
      new Mesh(new TorusGeometry(radius, 0.0085, 5, 14, Math.PI), toonMaterial(colour)),
    );
    charm.add(arc);
    if (index === 0) addOutline(arc, 0.006);
  });

  for (const side of [-1, 1] as const) {
    const cloud = blob(0.024, toonMaterial(ART.cream), [1.3, 0.8, 0.9], 12);
    cloud.position.set(side * 0.066, 0.004, 0);
    charm.add(cloud);
  }

  return charm;
}

/** A plump heart. No face — it is already a feeling. */
function heartCharm(): Group {
  const charm = new Group();
  const pink = toonMaterial(PALETTE.markerPink);

  const point = solid(new Mesh(new ConeGeometry(0.052, 0.078, 12), pink));
  point.rotation.x = Math.PI;
  point.position.y = 0.039;
  charm.add(point);
  addOutline(point, 0.008);

  for (const side of [-1, 1] as const) {
    const lobe = blob(0.032, pink, [1, 0.95, 0.8], 14);
    lobe.position.set(side * 0.026, 0.081, 0);
    charm.add(lobe);
  }

  // One shine dot, the way every glossy thing in the park is lit.
  const shine = decal(new Mesh(new SphereGeometry(0.009, 8, 6), toonMaterial(ART.cream)));
  shine.scale.set(1.4, 0.9, 0.4);
  shine.position.set(-0.024, 0.088, 0.026);
  charm.add(shine);

  return charm;
}

const CHARMS: Readonly<Record<KeychainKind, () => Group>> = {
  ripika: ripikaCharm,
  star: starCharm,
  strawberry: strawberryCharm,
  rainbow: rainbowCharm,
  heart: heartCharm,
};

/**
 * One keychain, origin at the base, facing +Z, `height` measured off the
 * finished object rather than written down.
 */
export function createKeychain(kind: KeychainKind): AssetHandle {
  const root = new Group();
  root.name = `keychain.${kind}`;

  const charm = CHARMS[kind]();
  root.add(charm);
  addHardware(root, seat(charm));

  return { root, height: visibleTop(root) };
}
