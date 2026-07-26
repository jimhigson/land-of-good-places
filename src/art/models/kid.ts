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
 * This is the toon restyle of `src/entities/CharacterModel.ts`. Proportions are
 * unchanged (1.86 m total, head 47% of height) because the camera, the collision
 * radius and the name-label height are all tuned to them. What changes is the
 * surface: toon material, painted face patch instead of sphere eyes, coloured
 * ink outlines, and a little backpack so the "cute things peek out of your bag"
 * feature has somewhere to live.
 *
 * Every colour is a constructor option so the character creator can drive it.
 */
export interface KidOptions {
  skin?: number;
  hair?: number;
  outfit?: number;
  shoe?: number;
  /** `bunches` (default), `bob`, or `short`. */
  hairStyle?: 'bunches' | 'bob' | 'short';
  backpack?: boolean;
  backpackColour?: number;
}

export interface KidHandle extends CreatureHandle {
  /** The kid always has all four limbs, so callers need no null check. */
  readonly limbs: CreatureLimbs;
  /** Where a hat sits. Parent hat meshes here. */
  readonly hatAnchor: Group;
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
  const torso = stub(0.31, 0.26, outfitMat);
  torso.position.y = 0.66;
  torso.scale.set(1.06, 1, 0.92);
  body.add(torso);
  addOutline(torso, 0.02);

  const collar = solid(new Mesh(new TorusGeometry(0.24, 0.055, 8, 22), outfitDarkMat));
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.94;
  body.add(collar);

  // Skirt hem — a flared ring that stops the torso reading as a plain pill.
  const hem = solid(new Mesh(new TorusGeometry(0.29, 0.075, 8, 24), outfitDarkMat));
  hem.rotation.x = Math.PI / 2;
  hem.position.y = 0.44;
  hem.scale.set(1.06, 1.06, 0.7);
  body.add(hem);

  // --- arms ---------------------------------------------------------------------
  for (const side of [-1, 1] as const) {
    const pivot = side < 0 ? limbs.leftArm : limbs.rightArm;
    pivot.position.set(side * 0.34, 0.86, 0);
    body.add(pivot);

    const upper = stub(0.105, 0.2, outfitMat);
    upper.position.y = -0.16;
    pivot.add(upper);

    const hand = blob(0.125, skinMat, [1, 1, 1], 18);
    hand.position.y = -0.34;
    pivot.add(hand);
    addOutline(hand, 0.012);
  }

  const holdAnchor = new Group();
  holdAnchor.position.set(0, -0.42, 0.1);
  limbs.rightArm.add(holdAnchor);

  // --- legs ---------------------------------------------------------------------
  for (const side of [-1, 1] as const) {
    const pivot = side < 0 ? limbs.leftLeg : limbs.rightLeg;
    pivot.position.set(side * 0.15, 0.42, 0);
    body.add(pivot);

    const leg = stub(0.115, 0.12, skinMat);
    leg.position.y = -0.14;
    pivot.add(leg);

    // Big round shoes. Oversized feet read as "toy" from the iso camera.
    const foot = blob(0.17, shoeMat, [1, 0.78, 1.28], 18);
    foot.position.set(0, -0.3, 0.04);
    pivot.add(foot);
    addOutline(foot, 0.014);
  }

  // --- backpack -------------------------------------------------------------------
  const backpackAnchor = new Group();
  if (backpack) {
    const bag = solid(new Mesh(new RoundedBoxGeometry(0.34, 0.34, 0.2, 5, 0.09), bagMat));
    bag.position.set(0, 0.72, -0.3);
    body.add(bag);
    addOutline(bag, 0.016);

    const flap = solid(new Mesh(new RoundedBoxGeometry(0.3, 0.14, 0.17, 4, 0.06), bagDarkMat));
    flap.position.set(0, 0.86, -0.32);
    body.add(flap);

    for (const side of [-1, 1] as const) {
      const strap = solid(new Mesh(new RoundedBoxGeometry(0.07, 0.42, 0.08, 3, 0.03), bagDarkMat));
      strap.position.set(side * 0.17, 0.8, -0.14);
      strap.rotation.x = -0.12;
      body.add(strap);
    }

    backpackAnchor.position.set(0, 0.92, -0.28);
    body.add(backpackAnchor);
  }

  // --- head --------------------------------------------------------------------
  const head = new Group();
  head.position.y = 1.34;
  body.add(head);

  const skullR = 0.44;
  const skull = blob(skullR, skinMat, [1, 0.95, 0.98], 34);
  head.add(skull);
  addOutline(skull, 0.018);

  const hatAnchor = new Group();
  hatAnchor.position.set(0, 0.42, 0);
  head.add(hatAnchor);

  // Hair shell over the crown and back.
  // Hair shell: stops well ABOVE the eye line. Every extra degree of theta here
  // eats forehead, and a character with no forehead has nowhere to put big eyes.
  const cap = solid(
    new Mesh(new SphereGeometry(0.455, 30, 22, 0, Math.PI * 2, 0, Math.PI * 0.46), hairMat),
  );
  cap.scale.set(1, 1.02, 1);
  cap.position.y = 0.035;
  cap.rotation.x = -0.05;
  head.add(cap);
  addOutline(cap, 0.016);

  // Fringe: high and shallow, a suggestion of a sweep rather than a curtain.
  const fringe = blob(0.17, hairMat, [1.3, 0.34, 0.48], 18);
  fringe.position.set(0, 0.305, 0.29);
  head.add(fringe);

  if (hairStyle !== 'short') {
    for (const side of [-1, 1] as const) {
      const long = hairStyle === 'bob';
      const bunch = blob(long ? 0.19 : 0.17, hairMat, long ? [0.82, 1.5, 0.9] : [0.9, 1.15, 0.9], 18);
      bunch.position.set(side * 0.42, long ? -0.1 : 0.04, -0.12);
      head.add(bunch);
      addOutline(bunch, 0.013);

      if (!long) {
        const bobble = solid(new Mesh(new TorusGeometry(0.085, 0.033, 8, 18), bobbleMat));
        bobble.rotation.y = Math.PI / 2;
        bobble.position.set(side * 0.44, 0.14, -0.12);
        head.add(bobble);
      } else {
        const tie = solid(new Mesh(new TorusGeometry(0.1, 0.03, 8, 18), bobbleMat));
        tie.rotation.y = Math.PI / 2;
        tie.position.set(side * 0.43, -0.2, -0.12);
        head.add(tie);
      }
    }
  }

  for (const side of [-1, 1] as const) {
    const ear = decal(blob(0.085, skinMat, [0.55, 1, 0.85], 12));
    ear.position.set(side * 0.42, -0.04, 0.02);
    head.add(ear);
  }

  // Small tuft at the back so the head is not a perfect ball in silhouette.
  const tuft = decal(blob(0.13, hairDarkMat, [1, 0.7, 0.8], 14));
  tuft.position.set(0, 0.16, -0.4);
  head.add(tuft);

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
    iris: 0x6f4b9a,
    mouth: 'smile',
    mouthW: 0.075,
    mouthDrop: 0.215,
    blush: ART.blush,
    blushStyle: 'soft',
    blushR: 0.1,
  });
  face.mesh.scale.set(1, 0.95, 0.98);
  head.add(face.mesh);

  return {
    root,
    body,
    head,
    limbs,
    hatAnchor,
    holdAnchor,
    backpackAnchor,
    height: 1.86,
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
