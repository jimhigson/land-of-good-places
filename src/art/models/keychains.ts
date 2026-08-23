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
 * Six of them, all procedural, all tiny: a charm about 11 cm tall, a short
 * chain, and a split ring on top. At game zoom a keychain is a few dozen
 * pixels, so every one of them is built to read as a **silhouette plus one
 * colour** — a star, a strawberry, an arc of rainbow, a doll of Rumi —
 * rather than as a detailed model shrunk down.
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
 * Four of the six have eyes; the rainbow and the heart do not. `shopItems.ts`
 * already settled the principle for props this size — "a face patch would be a
 * whole canvas for a 30 cm prop; two ink dots and a blush do the same job" —
 * and a keychain is a third of that again. So no `createFacePatch` anywhere in
 * this file: a canvas texture per charm would cost more than the charm.
 */

export type KeychainKind = 'ripika' | 'star' | 'strawberry' | 'rainbow' | 'heart' | 'rumi';

/**
 * How big a charm is once it is actually **worn** on the bag, versus the
 * ~11-20cm the model itself measures at (see the file header). Jim, 22 August
 * 2026: *"make the keyrings once on the bag 2.5x their current size."*
 *
 * One owner for both places a worn charm is drawn — `entities/WornKeychain.ts`
 * (the real one) and the character-creation preview's own mirror of it — for
 * the same reason {@link KEYCHAIN_SWAY_Z} below is: the picker must not show
 * a smaller charm than the one she is about to actually wear. The shop's own
 * display rack (`world/KeychainShop.ts`) is a separate, smaller "1.5x" scale
 * of its own — a display stand, not a worn charm, so it does not use this.
 */
export const KEYCHAIN_WORN_SCALE = 2.5;

/**
 * How far a worn charm's lowest point must clear the ground, in metres, once
 * it is scaled up by {@link KEYCHAIN_WORN_SCALE}.
 *
 * At the old, unscaled size (~20cm) every `CHARM_HANGS` anchor
 * (`art/models/backpacks.ts`, 0.43-0.56m above the feet) had metres of slack
 * below it. At 2.5x a charm reaches 0.5-0.6m down from its ring, which is
 * *more* than most of those anchors sit above the ground — hung literally
 * from the same point, several of the five charms would drag their tip
 * through the terrain on several of the five bags. {@link keychainWornLift}
 * is the fix: not a bigger anchor number (that stays what it always was, the
 * bag's own clip point, still checked against real geometry by
 * `check:charm-hang`), but a per-equip vertical lift, computed from the
 * actual worn charm's own measured height, that only ever pulls the ring
 * *up* off the bag's exact corner — and only as far as the ground makes it,
 * never further.
 */
const KEYCHAIN_GROUND_CLEARANCE = 0.08;

/**
 * How far above the charm anchor a worn charm's pivot must sit so its tip
 * clears the ground at {@link KEYCHAIN_WORN_SCALE}, in the anchor's own local
 * frame (where Y is height above the feet — see `art/models/kid.ts`).
 *
 * `anchorHeight` is `CHARM_HANGS`' own Y for the bag actually worn;
 * `charmHeight` is the un-scaled charm's own measured `AssetHandle.height`.
 * Zero whenever the bag already has enough headroom on its own (nothing
 * moves); otherwise exactly enough to put the tip at
 * {@link KEYCHAIN_GROUND_CLEARANCE} — never more, so a charm that fits stays
 * clipped to the bag's own corner precisely where `CHARM_HANGS` says, and one
 * that would not fit rides no higher than it has to.
 */
export function keychainWornLift(anchorHeight: number, charmHeight: number): number {
  const scaledDrop = charmHeight * KEYCHAIN_WORN_SCALE;
  return Math.max(0, scaledDrop + KEYCHAIN_GROUND_CLEARANCE - anchorHeight);
}

/**
 * How a hung charm sways when nothing is driving it dynamically — used by
 * **both** places a worn charm dangles, again. The character-creation
 * preview's picker has no player movement to swing its charm, so this is the
 * whole of its motion; the real worn charm (`entities/WornKeychain.ts`)
 * layers the same two sines *under* its motion-driven pendulum springs,
 * because springs alone left a standing charm frozen rigid at exactly 0°
 * (Jim, 23 August 2026 — a hung thing never quite stops). One set of
 * constants for both, for the reason {@link KEYCHAIN_WORN_SCALE} is: the
 * picker must not show a livelier dangle than the bag delivers.
 *
 * Deliberately not the same rate on both axes: matched rates read as a rigid
 * thing rocking, and two that drift in and out of phase read as something on
 * a string. The sideways swing is the bigger one because that is the axis a
 * walking child's bag actually rocks about.
 */
export const KEYCHAIN_SWAY_Z = 0.16;
export const KEYCHAIN_SWAY_Z_RATE = 2.1;
export const KEYCHAIN_SWAY_X = 0.07;
export const KEYCHAIN_SWAY_X_RATE = 1.37;

export const KEYCHAIN_KINDS: readonly KeychainKind[] = [
  'ripika',
  'star',
  'strawberry',
  'rainbow',
  'heart',
  'rumi',
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

  // Open-ended: the base cap is buried inside the shoulders blob so it never
  // draws, and — the real reason — `addOutline` pushes every vertex of the
  // geometry it is handed, so a capped cone grows a dark cap *disc* floating
  // `thickness` beyond its base. At the modelled 20 cm that disc hid inside
  // the shoulders; at `KEYCHAIN_WORN_SCALE` it poked out as a detached dark
  // ring around the berry's top (Jim's screenshot, 23 August 2026). No cap,
  // no disc.
  const body = solid(new Mesh(new ConeGeometry(0.05, 0.085, 14, 1, true), red));
  // Turned over so the point hangs downwards, which is which way up a
  // strawberry is.
  body.rotation.x = Math.PI;
  body.position.y = 0.0425;
  charm.add(body);
  addOutline(body, 0.008);

  const shoulders = blob(0.05, red, [1, 0.5, 1], 16);
  shoulders.position.y = 0.085;
  charm.add(shoulders);
  // The shoulders are the berry's widest point, so they own part of the
  // silhouette — outlined too, or the cone's own outline rim shows as a dark
  // line standing proud of un-outlined red where the two shapes meet.
  addOutline(shoulders, 0.008);

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

/**
 * A doll of Rumi, the pinned NPC — `entities/npc/NpcSystem.ts`'s `RUMI` is
 * the look being miniaturised: lilac hair in a ponytail, honey skin, and
 * everything else ink. The same relationship the RiPika charm has to
 * `ripika.ts`: a likeness in this file's own silhouette-plus-one-colour
 * budget, not a scaled copy of the full `CharacterModel`.
 */
function rumiCharm(): Group {
  const charm = new Group();
  // Rumi's own colours: `ART.miniLilac` hair, `PALETTE.ink` for the all-black
  // outfit, and 'Honey' skin (`KID_SKIN_TONES[2]`, the literal NpcSystem's
  // RUMI spec also carries).
  const lilac = toonMaterial(ART.miniLilac);
  const lilacDark = toonMaterial(ART.miniLilacDark);
  const ink = toonMaterial(PALETTE.ink);
  const skin = toonMaterial(0xf0b787);

  // The dress: an A-line cone, point up under the head.
  const dress = solid(new Mesh(new ConeGeometry(0.036, 0.062, 12), ink));
  dress.position.y = 0.031;
  charm.add(dress);
  addOutline(dress, 0.008);

  // Two little ink shoes peeking out under the hem.
  for (const side of [-1, 1] as const) {
    const shoe = solid(new Mesh(new SphereGeometry(0.009, 8, 6), ink));
    shoe.scale.set(0.9, 0.7, 1.2);
    shoe.position.set(side * 0.013, 0.006, 0.008);
    charm.add(shoe);
  }

  const head = blob(0.031, skin, [1, 0.95, 0.95], 16);
  head.position.y = 0.088;
  charm.add(head);
  addOutline(head, 0.008);

  // The hair: a slightly bigger dome sat back off the face, so the front of
  // the skull shows skin — the same one-blob hair every doll this size gets.
  const hair = blob(0.034, lilac, [1.02, 0.96, 0.98], 16);
  hair.position.set(0, 0.095, -0.008);
  charm.add(hair);
  addOutline(hair, 0.008);

  // The ponytail: a tie bobble high on the back of the head, and a tapered
  // swish falling behind the dress — the one thing that says "Rumi" at a
  // dozen pixels, so it gets real length.
  const tie = solid(new Mesh(new SphereGeometry(0.009, 8, 6), lilacDark));
  tie.position.set(0, 0.112, -0.036);
  charm.add(tie);

  const tail = solid(new Mesh(new CylinderGeometry(0.006, 0.011, 0.075, 8), lilac));
  tail.position.set(0, 0.068, -0.042);
  tail.rotation.x = -0.18;
  charm.add(tail);

  const tailTip = solid(new Mesh(new SphereGeometry(0.011, 8, 6), lilac));
  tailTip.position.set(0, 0.028, -0.049);
  charm.add(tailTip);

  addTinyFace(charm, 0.088, 0.031, 0.013, 0.023);
  return charm;
}

const CHARMS: Readonly<Record<KeychainKind, () => Group>> = {
  ripika: ripikaCharm,
  star: starCharm,
  strawberry: strawberryCharm,
  rainbow: rainbowCharm,
  heart: heartCharm,
  rumi: rumiCharm,
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
