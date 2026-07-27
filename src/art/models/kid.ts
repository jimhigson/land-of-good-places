import { Color, Group, Mesh, SphereGeometry, TorusGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ART } from '../style/artPalette';
import { addOutline, decal, solid, toonMaterial } from '../style/materials';
import { createFacePatch, type Expression } from '../style/faces';
import {
  applyWalk,
  blob,
  makeLimbs,
  stub,
  type CreatureHandle,
  type CreatureLimbs,
} from '../style/asset';

/**
 * The player kid — Eleri by default.
 *
 * This is the toon restyle of `src/entities/CharacterModel.ts`: toon material,
 * painted face patch instead of sphere eyes, coloured ink outlines, and a little
 * backpack so the "cute things peek out of your bag" feature has somewhere to
 * live.
 *
 * **Cartoon pass (26 July 2026).** The family asked for heads about double the
 * size. The head is authored at {@link HEAD} × the original: 1.5 linear, which
 * is 2.25× the area it covers on screen — that is what "double" looks like once
 * it is rendered. The body was *shortened* rather than left alone, so the kid
 * only grew from 1.86 m to 2.12 m and the head went from 45% of her height to
 * 59%. Shortening matters: a big head on a full-length body reads as a medical
 * problem, a big head on a stumpy body reads as a toy.
 *
 * Every colour is a constructor option so the character creator can drive it.
 */

/**
 * How much bigger the head is than the original authoring.
 *
 * Every number inside the `head` group is written as `x * HEAD`, so this is the
 * one knob. Face patches, hair, ears and the hat anchor all ride along, which is
 * the whole reason the face is painted onto a patch sized from `skullR`.
 */
const HEAD = 1.5;

/**
 * Height of the head pivot above the feet, in metres.
 *
 * Exported because the player's animator nudges `head.position.y` for secondary
 * motion and has to know what to nudge it *around*. It used to hard-code 1.34.
 */
export const KID_HEAD_HEIGHT = 1.36;

/** Total height in metres, measured to the top of the hair. */
export const KID_HEIGHT = 2.12;

/**
 * How far the head is tipped back, in radians (≈ 10°).
 *
 * The game camera looks down at 38°. A head this big, sitting level, presents
 * the player with the top of a hairstyle; tipping it back brings the face — and
 * therefore the eyes, which are 80% of the cuteness — back into view. It also
 * reads as a chin-up, pleased-with-itself pose, which is no bad thing.
 */
const HEAD_TILT = 0.17;

/** One named swatch — a skin tone or an eye colour, ready to drop onto a button. */
export interface ToneSwatch {
  readonly colour: number;
  readonly label: string;
}

/**
 * The character creator's skin-tone swatches — and the range the park's NPC
 * crowd draws from (see `entities/npc/kidCrowd.ts`, which imports this same
 * list rather than keeping its own).
 *
 * Hand-picked, not one base hue scaled darker and lighter: a uniform scale
 * drifts warm skin towards grey at the low end, which is exactly what an
 * inclusive range must not do. Every entry keeps its own warm undertone
 * instead, chosen to sit comfortably in the toon ramp next to `ART.blush`.
 * `Fair` is `ART.kidSkin`, the game's long-standing default, so a save from
 * before this list existed still renders identically.
 */
export const KID_SKIN_TONES: readonly ToneSwatch[] = [
  { colour: 0xffe6d1, label: 'Porcelain' },
  { colour: ART.kidSkin, label: 'Fair' },
  { colour: 0xf0b787, label: 'Honey' },
  { colour: 0xd99b6c, label: 'Caramel' },
  { colour: 0xb97748, label: 'Sienna' },
  { colour: 0x8f5a37, label: 'Umber' },
  { colour: 0x6b4226, label: 'Espresso' },
] as const;

/**
 * The character creator's eye-colour swatches.
 *
 * `Brown`, `Green`, `Blue` and `Violet` (the existing default) are also the
 * four the NPC crowd bakes as instanced face variants (`kidCrowd.ts`'s
 * `EYE_VARIANTS`); `Hazel` and `Grey` only ever paint the player's own,
 * un-instanced face, so they cost nothing beyond this list.
 */
export const KID_EYE_COLOURS: readonly ToneSwatch[] = [
  { colour: ART.kidEyeBrown, label: 'Brown' },
  { colour: 0xa87a4a, label: 'Hazel' },
  { colour: ART.kidEyeGreen, label: 'Green' },
  { colour: ART.kidEyeBlue, label: 'Blue' },
  { colour: 0x8a93a0, label: 'Grey' },
  { colour: ART.kidEye, label: 'Violet' },
] as const;

export interface KidOptions {
  skin?: number;
  hair?: number;
  outfit?: number;
  shoe?: number;
  /** `bunches` (default), `bob`, or `short`. */
  hairStyle?: 'bunches' | 'bob' | 'short';
  backpack?: boolean;
  backpackColour?: number;
  /** Iris colour. Defaults to `ART.kidEye` — every kid but Ethan wears it. */
  eyeColour?: number;
}

export interface KidHandle extends CreatureHandle {
  /** The kid always has all four limbs, so callers need no null check. */
  readonly limbs: CreatureLimbs;
  /** Where a hat sits. Parent hat meshes here. */
  readonly hatAnchor: Group;
  /**
   * Where a single hair accessory sits — a picked flower, say.
   *
   * Offset from `hatAnchor` (the crown centre) rather than sharing it, so a
   * hat and a hair flower can be worn at the same time instead of one
   * replacing the other.
   */
  readonly hairAnchor: Group;
  /** Where a carried toy sits. */
  readonly holdAnchor: Group;
  /** Where a peeking creature's head pops out of the bag. */
  readonly backpackAnchor: Group;
  setSkinColour(colour: number): void;
  setHairColour(colour: number): void;
  setOutfitColour(colour: number): void;
  setShoeColour(colour: number): void;
}

export function createKid(options: KidOptions = {}): KidHandle {
  const {
    skin = ART.kidSkin,
    hair = ART.kidHair,
    outfit = ART.kidOutfit,
    shoe = ART.kidShoe,
    hairStyle = 'bunches',
    backpack = true,
    backpackColour = ART.kidBackpack,
    eyeColour = ART.kidEye,
  } = options;

  const root = new Group();
  root.name = 'kid';
  const body = new Group();
  root.add(body);

  const skinMat = toonMaterial(skin);
  const outfitMat = toonMaterial(outfit);
  const outfitDarkMat = toonMaterial(new Color(outfit).multiplyScalar(0.82).getHex());
  const hairMat = toonMaterial(hair);
  const hairDarkMat = toonMaterial(new Color(hair).multiplyScalar(0.86).getHex());
  const shoeMat = toonMaterial(shoe);
  const bagMat = toonMaterial(backpackColour);
  const bagDarkMat = toonMaterial(new Color(backpackColour).multiplyScalar(0.82).getHex());
  const bobbleMat = toonMaterial(ART.kidBobble);

  const limbs = makeLimbs();

  // --- torso -------------------------------------------------------------------
  // Short and wide. Under a head this big the torso is a dumpling, not a trunk:
  // 0.80 m tall where it used to be 0.88, and the top 0.27 m of it disappears up
  // inside the skull, which is exactly what hides the neck.
  const torso = stub(0.325, 0.15, outfitMat);
  torso.position.y = 0.6;
  torso.scale.set(1.06, 1, 0.92);
  body.add(torso);
  addOutline(torso, 0.02);

  // Neckline. Sits just *below* the bottom of the skull — any higher and the
  // head swallows it whole and the jumper appears to have no opening.
  const collar = solid(new Mesh(new TorusGeometry(0.26, 0.055, 8, 22), outfitDarkMat));
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.71;
  body.add(collar);

  // Skirt hem — a flared ring that stops the torso reading as a plain pill.
  const hem = solid(new Mesh(new TorusGeometry(0.3, 0.075, 8, 24), outfitDarkMat));
  hem.rotation.x = Math.PI / 2;
  hem.position.y = 0.4;
  hem.scale.set(1.06, 1.06, 0.7);
  body.add(hem);

  // --- arms ---------------------------------------------------------------------
  for (const side of [-1, 1] as const) {
    const pivot = side < 0 ? limbs.leftArm : limbs.rightArm;
    // Shoulders set wide and low so the arms swing clear of the skull, and wider
    // than the skirt hem (0.32) so the hands are not swallowed by it — with a
    // torso this short, an arm tucked inside the silhouette simply disappears.
    pivot.position.set(side * 0.38, 0.72, 0);
    body.add(pivot);

    const upper = stub(0.105, 0.16, outfitMat);
    upper.position.y = -0.14;
    pivot.add(upper);

    const hand = blob(0.135, skinMat, [1, 1, 1], 18);
    hand.position.y = -0.32;
    pivot.add(hand);
    addOutline(hand, 0.012);
  }

  const holdAnchor = new Group();
  holdAnchor.position.set(0, -0.42, 0.1);
  limbs.rightArm.add(holdAnchor);

  // --- legs ---------------------------------------------------------------------
  for (const side of [-1, 1] as const) {
    const pivot = side < 0 ? limbs.leftLeg : limbs.rightLeg;
    pivot.position.set(side * 0.155, 0.36, 0);
    body.add(pivot);

    const leg = stub(0.12, 0.1, skinMat);
    leg.position.y = -0.1;
    pivot.add(leg);

    // Big round shoes. Oversized feet read as "toy" from the iso camera — and
    // they carry even more weight now, because they are most of the body.
    const foot = blob(0.175, shoeMat, [1, 0.78, 1.28], 18);
    foot.position.set(0, -0.22, 0.045);
    pivot.add(foot);
    addOutline(foot, 0.014);
  }

  // --- backpack -------------------------------------------------------------------
  const backpackAnchor = new Group();
  if (backpack) {
    // Dropped and pushed back so it still clears the underside of the skull —
    // the head now overhangs to z = -0.65, and a bag tucked under it vanishes.
    const bag = solid(new Mesh(new RoundedBoxGeometry(0.36, 0.32, 0.2, 5, 0.09), bagMat));
    bag.position.set(0, 0.56, -0.32);
    body.add(bag);
    addOutline(bag, 0.016);

    const flap = solid(new Mesh(new RoundedBoxGeometry(0.32, 0.14, 0.17, 4, 0.06), bagDarkMat));
    flap.position.set(0, 0.69, -0.34);
    body.add(flap);

    for (const side of [-1, 1] as const) {
      const strap = solid(new Mesh(new RoundedBoxGeometry(0.07, 0.36, 0.08, 3, 0.03), bagDarkMat));
      strap.position.set(side * 0.17, 0.64, -0.16);
      strap.rotation.x = -0.12;
      body.add(strap);
    }

    backpackAnchor.position.set(0, 0.74, -0.3);
    body.add(backpackAnchor);
  }

  // --- head --------------------------------------------------------------------
  // Everything below is authored at `× HEAD`. The pivot came *down* from 1.34 to
  // 1.36 rather than up by half the extra radius, because the head is meant to
  // sit ON the shoulders like a snowman's — a big head on a visible neck wobbles.
  const head = new Group();
  head.position.y = KID_HEAD_HEIGHT;
  body.add(head);

  // Everything visible hangs off `crown`, which is tilted back a few degrees so
  // the face still points at the ISO CAMERA rather than at the grass. From 38°
  // above, an untilted head this large shows the player nothing but hair.
  const crown = new Group();
  crown.rotation.x = -HEAD_TILT;
  head.add(crown);

  const skullR = 0.44 * HEAD;
  const skull = blob(skullR, skinMat, [1, 0.95, 0.98], 38);
  crown.add(skull);
  addOutline(skull, 0.02);

  const hatAnchor = new Group();
  hatAnchor.position.set(0, 0.42 * HEAD, 0);
  crown.add(hatAnchor);

  // Tucked over the left bunch, clear of the hat anchor's crown-centre mount —
  // a flower worn here reads as "in her hair" alongside a hat rather than
  // fighting it for the same spot.
  const hairAnchor = new Group();
  hairAnchor.position.set(0.32 * HEAD, 0.22 * HEAD, 0.14 * HEAD);
  crown.add(hairAnchor);

  // Hair shell over the crown and back.
  // Hair shell: stops well ABOVE the eye line. Every extra degree of theta here
  // eats forehead, and a character with no forehead has nowhere to put big eyes.
  const cap = solid(
    new Mesh(
      new SphereGeometry(0.455 * HEAD, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.46),
      hairMat,
    ),
  );
  cap.scale.set(1, 1.02, 1);
  cap.position.y = 0.035 * HEAD;
  cap.rotation.x = -0.05;
  crown.add(cap);
  addOutline(cap, 0.018);

  // Fringe: high and shallow, a suggestion of a sweep rather than a curtain.
  const fringe = blob(0.17 * HEAD, hairMat, [1.3, 0.34, 0.48], 18);
  fringe.position.set(0, 0.305 * HEAD, 0.29 * HEAD);
  crown.add(fringe);

  if (hairStyle !== 'short') {
    for (const side of [-1, 1] as const) {
      const long = hairStyle === 'bob';
      const bunch = blob(
        (long ? 0.19 : 0.17) * HEAD,
        hairMat,
        long ? [0.82, 1.5, 0.9] : [0.9, 1.15, 0.9],
        18,
      );
      bunch.position.set(side * 0.42 * HEAD, (long ? -0.1 : 0.04) * HEAD, -0.12 * HEAD);
      crown.add(bunch);
      addOutline(bunch, 0.014);

      if (!long) {
        const bobble = solid(
          new Mesh(new TorusGeometry(0.085 * HEAD, 0.033 * HEAD, 8, 18), bobbleMat),
        );
        bobble.rotation.y = Math.PI / 2;
        bobble.position.set(side * 0.44 * HEAD, 0.14 * HEAD, -0.12 * HEAD);
        crown.add(bobble);
      } else {
        const tie = solid(new Mesh(new TorusGeometry(0.1 * HEAD, 0.03 * HEAD, 8, 18), bobbleMat));
        tie.rotation.y = Math.PI / 2;
        tie.position.set(side * 0.43 * HEAD, -0.2 * HEAD, -0.12 * HEAD);
        crown.add(tie);
      }
    }
  }

  for (const side of [-1, 1] as const) {
    const ear = decal(blob(0.085 * HEAD, skinMat, [0.55, 1, 0.85], 12));
    ear.position.set(side * 0.42 * HEAD, -0.04 * HEAD, 0.02 * HEAD);
    crown.add(ear);
  }

  // Small tuft at the back so the head is not a perfect ball in silhouette.
  const tuft = decal(blob(0.13 * HEAD, hairDarkMat, [1, 0.7, 0.8], 14));
  tuft.position.set(0, 0.16 * HEAD, -0.4 * HEAD);
  crown.add(tuft);

  // --- face ------------------------------------------------------------------
  const face = createFacePatch({
    radius: skullR,
    spreadX: 1.7,
    spreadY: 1.7,
    tilt: 0.03,
    size: 512,
    eyeY: 0.43,
    eyeGap: 0.44,
    eyeW: 0.122,
    eyeH: 0.158,
    iris: eyeColour,
    mouth: 'smile',
    mouthW: 0.075,
    mouthDrop: 0.215,
    blush: ART.blush,
    blushStyle: 'soft',
    blushR: 0.1,
  });
  face.mesh.scale.set(1, 0.95, 0.98);
  crown.add(face.mesh);

  return {
    root,
    body,
    head,
    limbs,
    hatAnchor,
    hairAnchor,
    holdAnchor,
    backpackAnchor,
    height: KID_HEIGHT,
    setExpression: (name: Expression) => face.setExpression(name),
    setWalkPhase: (phase: number, speed: number) => applyWalk(limbs, body, phase, speed, 0.85, 0.09),
    setSkinColour: (colour: number) => skinMat.color.setHex(colour),
    setHairColour: (colour: number) => {
      hairMat.color.setHex(colour);
      hairDarkMat.color.copy(new Color(colour).multiplyScalar(0.86));
    },
    setOutfitColour: (colour: number) => {
      outfitMat.color.setHex(colour);
      outfitDarkMat.color.copy(new Color(colour).multiplyScalar(0.82));
    },
    setShoeColour: (colour: number) => shoeMat.color.setHex(colour),
  };
}
