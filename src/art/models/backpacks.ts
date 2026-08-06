import { Group, Mesh, type Material, type Object3D } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { addOutline, decal, solid } from '../style/materials';
import { blob } from '../style/asset';
import { heartGeometry } from '../style/shapes';
import { buildRipikaHead } from './ripika';
import { createPuffCreature } from './pets';

/**
 * What the child wears on her back.
 *
 * The backpack used to be four meshes written straight into `createKid` — one
 * bag, one flap, two straps, one shape forever. It is not a detail: it is the
 * thing every cute creature she owns climbs out of (`entities/parade/BackpackPeek.ts`),
 * so it is on screen behind her for the whole game, and it was the only part of
 * the character the creator did not let her choose.
 *
 * This file is the shape catalogue, and it is deliberately built like
 * `art/models/hair.ts` rather than like `art/models/hats.ts`:
 *
 *  - a hat is a **separate asset** mounted on an anchor, because hats are sold
 *    in a shop, stood on display stands and swapped mid-game;
 *  - a backpack is **part of the body**, chosen once in the creator, never
 *    bought and never taken off — the same relationship hair has with the head.
 *
 * So, exactly as with hair: every piece is tagged with the kinds that show it,
 * one kid can be built carrying *several* kinds at once (which is how the NPC
 * crowd gets more than one silhouette out of one instanced prototype), and
 * {@link BackpackRig.setKind} shows one and hides the rest.
 *
 * ## Everything here is in metres, in the kid's `body` space
 *
 * Unlike `hats.ts` — which is authored in head units because a hat is only ever
 * the right size relative to the skull under it — a backpack is sized against a
 * *back*, and the torso is not scaled by anything. The numbers below are
 * therefore the same metres the old inline block used, and the sewn `satchel`
 * is that block, moved rather than redrawn: a child who has played before must
 * find her own bag unchanged.
 */

export type BackpackKind = 'satchel' | 'bubble' | 'heart' | 'ripikaHead' | 'trillaHead';

export const BACKPACK_KINDS: readonly BackpackKind[] = [
  'satchel',
  'bubble',
  'heart',
  'ripikaHead',
  'trillaHead',
];

/**
 * The kinds a **background child** can wear.
 *
 * The two creature heads are deliberately absent, and this is the same cost
 * decision — with the same shape of reasoning — as `CROWD_HAIR_STYLES` leaving
 * the simulated ponytail out of the crowd:
 *
 *  - The crowd is one instanced draw call **per mesh on the prototype**, whether
 *    one child wears that mesh or nobody does. Measured, by counting
 *    `InstancedCrowd.partCount` with each list in turn: the three sewn shapes
 *    take the crowd from 44 draw calls to 48, and adding the two creature heads
 *    takes it to **65** — a 48% increase in what the park's children cost to
 *    draw, permanently, for a 0.3 m prop on the back of somebody the player is
 *    not looking at.
 *  - Both carry a painted **face patch**, and `entities/npc/kidCrowd.ts` finds
 *    *the* face of the model by name in order to bake its expression variants.
 *    A model with two faces on it is a different feature, not a free one.
 *
 * The player — the one character the camera actually follows — gets all five.
 * The crowd gets three shapes across five bag colours, which is fifteen
 * different backpacks walking round the park.
 */
export const CROWD_BACKPACK_KINDS: readonly BackpackKind[] = BACKPACK_KINDS.filter(
  (kind) => kind !== 'ripikaHead' && kind !== 'trillaHead',
);

/** One built piece of backpack, and the kinds that show it. */
export interface BackpackPart {
  readonly mesh: Object3D;
  readonly kinds: readonly BackpackKind[];
}

export interface BackpackOptions {
  /** The kid's `body` group. Every piece is parented here, like the old block. */
  readonly body: Group;
  /** The bag colour the child chose. */
  readonly bagMaterial: Material;
  /** Its 0.82× shade — flaps, straps, pockets. Derived by the caller. */
  readonly bagDarkMaterial: Material;
  /** Which kind is worn. */
  readonly kind: BackpackKind;
  /** Which kinds are *built*, if more than the one worn. Defaults to `[kind]`. */
  readonly kinds?: readonly BackpackKind[];
}

export interface BackpackRig {
  readonly parts: readonly BackpackPart[];
  /**
   * Where a peeking creature climbs out — the mouth of whatever is currently
   * worn (ART_DIRECTION.md §7's `backpackAnchor`).
   *
   * One anchor that **moves** rather than one per kind, because
   * `entities/parade/BackpackPeek.ts` holds the group it was handed for the
   * lifetime of the character: a second anchor appearing under a different
   * bag would leave the peeker climbing out of the shape she used to wear.
   */
  readonly anchor: Group;
  /**
   * Where a worn keychain clips on — the low outer corner of whatever bag is
   * currently worn (see {@link CHARM_HANGS}).
   *
   * A second anchor rather than a reuse of {@link anchor}: that one is the
   * bag's *mouth*, where a peeking creature's head comes out, and a charm hung
   * there would dangle over that head. It **moves** on `setKind` for the same
   * reason `anchor` does — `entities/WornKeychain.ts` holds the group it was
   * handed for the lifetime of the character, so a charm must follow the bag
   * the child switches to rather than stay clipped to the one she took off.
   */
  readonly charmAnchor: Group;
  /**
   * Shows one kind and hides the rest, and moves {@link anchor} to its mouth
   * and {@link charmAnchor} to its charm corner.
   */
  setKind(kind: BackpackKind): void;
  /**
   * Hides the bag altogether — straps and all — and puts it back.
   *
   * There is exactly one thing that asks: a **jet pack**
   * (`entities/WornJetpack.ts`). You cannot strap two things to one back, and a
   * rocket floating 25 cm proud of a bubble rucksack reads as detached rather
   * than worn. Same shape of courtesy as `hair.ts`'s `setHatWorn`, which tucks
   * away a fall of hair that a hat would otherwise spear straight through.
   *
   * {@link anchor} deliberately does **not** move: `entities/parade/BackpackPeek.ts`
   * holds the group it was handed for the lifetime of the character, and a
   * peeking bunny looking over the top of a jet pack is exactly right anyway.
   *
   * Nothing is destroyed, so taking the jet pack off brings the child's own
   * chosen bag straight back — the creator's choice is never lost.
   */
  setHidden(hidden: boolean): void;
}

/**
 * Where the mouth of each bag is, in `body` metres.
 *
 * A sewn bag opens at its own top rim; a creature-head bag opens at the top of
 * the head, which is both higher and further back — so a peeking bunny climbs
 * out from behind RiPika's ears rather than out of her forehead.
 */
const MOUTHS: Readonly<Record<BackpackKind, readonly [number, number]>> = {
  satchel: [0.74, -0.3],
  bubble: [0.76, -0.32],
  heart: [0.78, -0.3],
  ripikaHead: [0.84, -0.34],
  trillaHead: [0.82, -0.34],
};

/**
 * Where a keychain clips on, per shape — the low outer corner of the bag's own
 * mass, in `body` metres. `[x, y, z]`, mirrored to the other side by nothing:
 * one charm, one side.
 *
 * **Measured off each built shape, not guessed**, and each one sits inside that
 * bag's own body (excluding the straps, which reach forward to z ≈ -0.10 and
 * would hang a charm off the child's shoulder). The bag bodies measure:
 *
 * ```
 * satchel     x±0.196  y 0.384..0.736  z -0.436..-0.204
 * bubble      x±0.215  y 0.377..0.783  z -0.525..-0.155
 * heart       x±0.193  y 0.365..0.779  z -0.584..-0.076
 * ripikaHead  x±0.215  y 0.423..0.945  z -0.563..-0.157
 * trillaHead  x±0.212  y 0.405..0.867  z -0.586..-0.140
 * ```
 *
 * This lives here, beside {@link MOUTHS} and beside the shapes themselves, for
 * the reason the whole file exists: a single constant in `art/models/kid.ts`
 * would be a second definition of geometry it cannot see. There was one — the
 * keychain work of 28 July measured `(0.17, 0.5, -0.3)` against the single bag
 * the model had then, and by the time five authored shapes landed it was too
 * high for every one of them and too far forward for the deep ones. A sixth
 * shape adds a row here; it cannot silently invalidate a number somewhere else.
 */
const CHARM_HANGS: Readonly<Record<BackpackKind, readonly [number, number, number]>> = {
  satchel: [0.19, 0.43, -0.32],
  bubble: [0.2, 0.43, -0.34],
  // The odd one out, and measured rather than patterned: a heart tapers to a
  // point at the bottom, so the low outer corner every other bag uses is 0.12 m
  // outside its surface — a charm hanging in mid-air. Its widest lateral reach
  // is also further back (z ≈ -0.48, not mid-depth), because the lobes bulge
  // rearward. Hung on the lobe instead, half way up, where there is real
  // geometry to clip to.
  heart: [0.19, 0.56, -0.45],
  ripikaHead: [0.2, 0.47, -0.36],
  trillaHead: [0.2, 0.46, -0.36],
};

/** Centre of the bag mass on the back, shared by every shape. */
const BAG_Y = 0.56;
const BAG_Z = -0.32;

export function buildBackpacks(options: BackpackOptions): BackpackRig {
  const { body, bagMaterial: bag, bagDarkMaterial: bagDark, kind } = options;
  const wanted = new Set(options.kinds ?? [kind]);

  const parts: BackpackPart[] = [];

  /**
   * Builds a piece, but **only if some wanted kind uses it**.
   *
   * Lazy for the same reason `hair.ts`'s `add` is: the character creator
   * rebuilds the entire kid on every single tap of every single swatch, and a
   * version of this that built all five shapes and hid four would extrude a
   * heart, a RiPika head and a singing puff on every tap, on a phone, forever.
   * Only the NPC crowd ever asks for more than one.
   */
  const add = (kinds: readonly BackpackKind[], make: () => Object3D): void => {
    if (!kinds.some((k) => wanted.has(k))) return;
    const mesh = make();
    body.add(mesh);
    parts.push({ mesh, kinds });
  };

  // --- the straps ------------------------------------------------------------
  // Built once and worn by every kind: they are what makes any of these read as
  // a *backpack* rather than as a thing floating behind a child. They also carry
  // the chosen colour on the two creature heads, which keep their own.
  for (const side of [-1, 1] as const) {
    add(BACKPACK_KINDS, () => {
      const strap = solid(new Mesh(new RoundedBoxGeometry(0.07, 0.36, 0.08, 3, 0.03), bagDark));
      strap.position.set(side * 0.17, 0.64, -0.16);
      strap.rotation.x = -0.12;
      return strap;
    });
  }

  // --- satchel: the bag this game has always had -----------------------------
  add(['satchel'], () => {
    // Dropped and pushed back so it still clears the underside of the skull —
    // the head overhangs to z = -0.65, and a bag tucked under it vanishes.
    const box = solid(new Mesh(new RoundedBoxGeometry(0.36, 0.32, 0.2, 5, 0.09), bag));
    // Named so `check:hair` can find the thing a fall of hair has to clear
    // without a second copy of these numbers living in a script.
    box.name = 'backpack';
    box.position.set(0, BAG_Y, BAG_Z);
    addOutline(box, 0.016);
    return box;
  });
  add(['satchel'], () => {
    const flap = solid(new Mesh(new RoundedBoxGeometry(0.32, 0.14, 0.17, 4, 0.06), bagDark));
    flap.position.set(0, 0.69, -0.34);
    return flap;
  });

  // --- bubble: a soft round rucksack -----------------------------------------
  add(['bubble'], () => {
    const ball = solid(blob(0.2, bag, [1, 0.94, 0.86], 20));
    ball.position.set(0, BAG_Y + 0.02, BAG_Z - 0.02);
    addOutline(ball, 0.016);
    return ball;
  });
  add(['bubble'], () => {
    // The front pocket, pushed proud of the ball's own surface — a marking that
    // sits flush reads as an intersection, not a pocket (ART_DIRECTION.md §5).
    const pocket = decal(blob(0.11, bagDark, [1, 0.9, 0.55], 14));
    pocket.position.set(0, 0.52, -0.47);
    return pocket;
  });

  // --- heart: a heart-shaped bag ---------------------------------------------
  add(['heart'], () => {
    const shape = solid(new Mesh(heartGeometry(0.42, 0.17), bag));
    shape.position.set(0, BAG_Y + 0.01, BAG_Z - 0.01);
    // The extrusion faces +Z; turned so the plump front of the heart points
    // away from her back, which is the side anybody ever sees.
    shape.rotation.y = Math.PI;
    addOutline(shape, 0.016);
    return shape;
  });
  add(['heart'], () => {
    const clasp = decal(blob(0.055, bagDark, [1, 0.85, 0.7], 12));
    clasp.position.set(0, 0.5, -0.44);
    return clasp;
  });

  // --- RiPika's head, worn as a bag ------------------------------------------
  // Her actual head, from `ripika.ts` — the same reuse `hats.ts`'s RiPika hat
  // makes, at bag scale instead of hat scale. Building a second yellow ball here
  // would be a copy that drifts the first time anybody retunes her ears.
  add(['ripikaHead'], () => {
    // 0.6 × RiPika's own head: a 0.19 m skull, so the bag is the width of the
    // satchel it replaces rather than a second head on the child's back.
    const head = buildRipikaHead(0.6);
    renameFacePatch(head.group);
    head.group.position.set(0, BAG_Y + 0.06, BAG_Z - 0.04);
    // Facing away from the wearer, so she is looking back down the path behind
    // you rather than into the child's spine.
    head.group.rotation.y = Math.PI;
    return head.group;
  });
  add(['ripikaHead'], () => collar(bag));

  // --- Trilla, worn as a bag -------------------------------------------------
  // `createPuffCreature`'s `hat` variant, for the same reason the puff hat uses
  // it: it is the size that sits on a person rather than the size that stands in
  // a pet pen. Deliberately never `update`d — `entities/WornHat.ts` does not
  // drive a worn puff's song either, and a bag that sang while you walked would
  // be a different (and much noisier) feature.
  add(['trillaHead'], () => {
    const puff = createPuffCreature({ variant: 'hat' });
    renameFacePatch(puff.body);
    // `body`, not `root`: the hat variant leaves the puff standing on its own
    // paws at the root, and its `head` group is the ball, 0.225 m up.
    const mount = new Group();
    mount.name = 'backpack.trilla';
    mount.add(puff.body);
    mount.position.set(0, BAG_Y + 0.04 - 0.225, BAG_Z - 0.04);
    mount.rotation.y = Math.PI;
    return mount;
  });
  add(['trillaHead'], () => collar(bag));

  // --- the anchor ------------------------------------------------------------
  const anchor = new Group();
  anchor.name = 'backpackAnchor';
  body.add(anchor);

  const charmAnchor = new Group();
  charmAnchor.name = 'keychainAnchor';
  body.add(charmAnchor);

  // The kind currently chosen, so `setHidden(false)` can put back exactly the
  // bag that was there rather than the one this rig was built with.
  let worn: BackpackKind = kind;
  let hidden = false;

  const apply = (): void => {
    for (const part of parts) part.mesh.visible = !hidden && part.kinds.includes(worn);
    const [y, z] = MOUTHS[worn];
    anchor.position.set(0, y, z);
    const [charmX, charmY, charmZ] = CHARM_HANGS[worn];
    charmAnchor.position.set(charmX, charmY, charmZ);
  };

  const setKind = (next: BackpackKind): void => {
    worn = next;
    apply();
  };
  const setHidden = (next: boolean): void => {
    hidden = next;
    apply();
  };
  apply();

  return { parts, anchor, charmAnchor, setKind, setHidden };
}

/**
 * The chunky ring a creature-head bag sits in.
 *
 * It is what the colour swatches paint on those two: RiPika is yellow and
 * Trilla is pink, and repainting either of them purple would not be a purple
 * RiPika, it would be somebody else. So the *bag* part of a creature bag — the
 * collar it is strapped into — takes the colour, and the creature stays herself.
 */
function collar(material: Material): Mesh {
  const ring = solid(blob(0.16, material, [1, 0.42, 0.72], 16));
  ring.position.set(0, BAG_Y - 0.1, BAG_Z + 0.02);
  addOutline(ring, 0.014);
  return ring;
}

/**
 * Renames a creature bag's face so it is not mistaken for the child's own.
 *
 * `createFacePatch` names every face it builds `facePatch`, and two things look
 * one up by that name on a whole character: the creator's preview, to frame the
 * `face` close-up (`ui/characterCreationPreview.ts`), and the NPC crowd, to bake
 * its expression variants (`entities/npc/kidCrowd.ts`). Both take the *first*
 * one they find, and the backpack hangs off `body` before the head does — so
 * without this, choosing the RiPika bag would point the eye-colour close-up at
 * the back of the child's own neck.
 */
function renameFacePatch(root: Object3D): void {
  root.traverse((object) => {
    if (object.name === 'facePatch') object.name = 'backpack.facePatch';
  });
}
