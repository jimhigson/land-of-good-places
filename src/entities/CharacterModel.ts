import {
  CapsuleGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { PALETTE } from '../core/palette';
import { TAU } from '../core/mathUtils';

/**
 * The cute placeholder character, built entirely from three.js primitives.
 *
 * Proportions are the whole trick. The head is about 45% of the total height
 * and nearly as wide as the body — Pokémon/chibi rules, where "cute" comes from
 * a big round head, short limbs, and eyes set low and wide. Everything is
 * spheres and capsules; there is not a single hard edge on the character.
 *
 * The class exposes the parts the animator needs (head, arms, legs, eyes) so
 * {@link Player} can pose them without digging through the scene graph.
 */
export interface CharacterColours {
  readonly skin: number;
  readonly hair: number;
  readonly outfit: number;
  readonly shoe: number;
}

export class CharacterModel {
  /** Root of the whole character. Position this at the feet. */
  readonly root = new Group();
  /** Everything that bobs and squashes when walking. */
  readonly body = new Group();
  readonly head = new Group();
  readonly leftArm = new Group();
  readonly rightArm = new Group();
  readonly leftLeg = new Group();
  readonly rightLeg = new Group();
  /** Eye parts, scaled on the Y axis to blink. */
  readonly eyes: Object3D[] = [];

  /** Total height in metres — used to place the name label. */
  readonly height = 1.86;

  private readonly outfitMaterial: MeshStandardMaterial;
  private readonly hairMaterials: MeshStandardMaterial[] = [];

  constructor(colours: CharacterColours) {
    this.root.name = 'character';

    const skinMaterial = softMaterial(colours.skin);
    this.outfitMaterial = softMaterial(colours.outfit);
    const outfitDarkMaterial = softMaterial(
      new Color(colours.outfit).multiplyScalar(0.82).getHex(),
    );
    const hairMaterial = softMaterial(colours.hair);
    this.hairMaterials.push(hairMaterial);
    const shoeMaterial = softMaterial(colours.shoe);
    const eyeWhiteMaterial = softMaterial(PALETTE.eyeWhite, 0.35);
    const eyeDarkMaterial = softMaterial(PALETTE.eyeDark, 0.25);
    const cheekMaterial = softMaterial(PALETTE.cheek);

    this.root.add(this.body);

    // --- torso -------------------------------------------------------------
    // Short and round: a capsule wider than it is tall above the waist.
    const torso = new Mesh(new CapsuleGeometry(0.31, 0.26, 6, 18), this.outfitMaterial);
    torso.position.y = 0.66;
    torso.scale.set(1.06, 1, 0.92);
    castAndReceive(torso);
    this.body.add(torso);

    // A little collar so the head doesn't look glued on.
    const collar = new Mesh(new TorusGeometry(0.24, 0.055, 8, 20), outfitDarkMaterial);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.94;
    castAndReceive(collar);
    this.body.add(collar);

    // --- arms --------------------------------------------------------------
    // Pivots sit at the shoulder so a rotation swings the whole arm.
    for (const side of [-1, 1] as const) {
      const pivot = side < 0 ? this.leftArm : this.rightArm;
      pivot.position.set(side * 0.34, 0.86, 0);
      this.body.add(pivot);

      const upper = new Mesh(new CapsuleGeometry(0.105, 0.2, 5, 12), this.outfitMaterial);
      upper.position.y = -0.16;
      castAndReceive(upper);
      pivot.add(upper);

      const hand = new Mesh(new SphereGeometry(0.125, 14, 11), skinMaterial);
      hand.position.y = -0.34;
      castAndReceive(hand);
      pivot.add(hand);
    }

    // --- legs --------------------------------------------------------------
    for (const side of [-1, 1] as const) {
      const pivot = side < 0 ? this.leftLeg : this.rightLeg;
      pivot.position.set(side * 0.15, 0.42, 0);
      this.body.add(pivot);

      const leg = new Mesh(new CapsuleGeometry(0.115, 0.12, 5, 12), outfitDarkMaterial);
      leg.position.y = -0.14;
      castAndReceive(leg);
      pivot.add(leg);

      // Big round shoes. Oversized feet read as "toy" from the iso camera.
      const shoe = new Mesh(new SphereGeometry(0.17, 14, 11), shoeMaterial);
      shoe.position.set(0, -0.3, 0.04);
      shoe.scale.set(1, 0.78, 1.28);
      castAndReceive(shoe);
      pivot.add(shoe);
    }

    // --- head --------------------------------------------------------------
    this.head.position.y = 1.34;
    this.body.add(this.head);

    const skull = new Mesh(new SphereGeometry(0.44, 24, 18), skinMaterial);
    skull.scale.set(1, 0.95, 0.98);
    castAndReceive(skull);
    this.head.add(skull);

    // Hair: a shell cap over the top and back, plus a fringe and two bunches.
    const cap = new Mesh(
      new SphereGeometry(0.455, 24, 18, 0, TAU, 0, Math.PI * 0.56),
      hairMaterial,
    );
    cap.scale.set(1, 0.98, 1);
    cap.position.y = 0.01;
    cap.rotation.x = -0.12;
    castAndReceive(cap);
    this.head.add(cap);

    // Kept high and shallow: a heavier fringe swallowed the forehead and the
    // face stopped reading at gameplay zoom.
    const fringe = new Mesh(new SphereGeometry(0.2, 14, 11), hairMaterial);
    fringe.position.set(0, 0.26, 0.32);
    fringe.scale.set(1.34, 0.48, 0.56);
    castAndReceive(fringe);
    this.head.add(fringe);

    for (const side of [-1, 1] as const) {
      const bunch = new Mesh(new SphereGeometry(0.17, 14, 11), hairMaterial);
      bunch.position.set(side * 0.42, 0.04, -0.12);
      bunch.scale.set(0.9, 1.15, 0.9);
      castAndReceive(bunch);
      this.head.add(bunch);

      const ear = new Mesh(new SphereGeometry(0.085, 12, 9), skinMaterial);
      ear.position.set(side * 0.42, -0.04, 0.02);
      ear.scale.set(0.55, 1, 0.85);
      castAndReceive(ear);
      this.head.add(ear);
    }

    // --- face ---------------------------------------------------------------
    // Eyes sit low and wide — the single biggest lever on "cute".
    for (const side of [-1, 1] as const) {
      const eye = new Group();
      eye.position.set(side * 0.165, -0.03, 0.33);
      this.head.add(eye);
      this.eyes.push(eye);

      const white = new Mesh(new SphereGeometry(0.115, 16, 12), eyeWhiteMaterial);
      white.scale.set(0.92, 1.12, 0.62);
      eye.add(white);

      const pupil = new Mesh(new SphereGeometry(0.082, 14, 11), eyeDarkMaterial);
      pupil.position.set(side * 0.008, -0.012, 0.055);
      pupil.scale.set(0.95, 1.08, 0.65);
      eye.add(pupil);

      const shine = new Mesh(new SphereGeometry(0.03, 8, 6), eyeWhiteMaterial);
      shine.position.set(side * -0.03, 0.04, 0.095);
      eye.add(shine);

      const smallShine = new Mesh(new SphereGeometry(0.016, 8, 6), eyeWhiteMaterial);
      smallShine.position.set(side * 0.035, -0.045, 0.09);
      eye.add(smallShine);
    }

    for (const side of [-1, 1] as const) {
      const cheek = new Mesh(new SphereGeometry(0.095, 12, 9), cheekMaterial);
      cheek.position.set(side * 0.3, -0.14, 0.27);
      cheek.scale.set(1.1, 0.72, 0.32);
      this.head.add(cheek);
    }

    // A smile: the lower half of a thin torus.
    const smile = new Mesh(new TorusGeometry(0.062, 0.018, 6, 14, Math.PI), eyeDarkMaterial);
    smile.position.set(0, -0.18, 0.41);
    smile.rotation.z = Math.PI;
    smile.scale.set(1.25, 1, 1);
    this.head.add(smile);

    const nose = new Mesh(new SphereGeometry(0.038, 10, 8), softMaterial(PALETTE.cheek));
    nose.position.set(0, -0.09, 0.42);
    nose.scale.set(1, 0.8, 0.7);
    this.head.add(nose);
  }

  /** Recolours the outfit — used by the character creator in a later step. */
  setOutfitColour(colour: number): void {
    this.outfitMaterial.color.setHex(colour);
  }

  /** Recolours the hair. */
  setHairColour(colour: number): void {
    for (const material of this.hairMaterials) material.color.setHex(colour);
  }
}

/**
 * The house material: matte, unmetallic, and just glossy enough to catch a
 * highlight. Anything shinier starts to look like plastic tat rather than a toy.
 */
function softMaterial(colour: number, roughness = 0.62): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: colour,
    roughness,
    metalness: 0,
  });
}

function castAndReceive(mesh: Mesh): void {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
}
