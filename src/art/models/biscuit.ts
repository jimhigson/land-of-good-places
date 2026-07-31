import { Group, Mesh, TorusGeometry } from 'three';
import { ART } from '../style/artPalette';
import { addOutline, decal, solid, toonMaterial } from '../style/materials';
import {
  createBakedFace,
  paintFaceOnFill,
  remapSphereFaceUv,
  type Expression,
} from '../style/faces';
import { heartGeometry } from '../style/shapes';
import { applyWalk, blob, makeLimbs, stub, type CreatureHandle } from '../style/asset';

/**
 * Biscuit — the teddy bear in the red jumper with two hearts on it.
 *
 * Eleri specified the jumper and the hearts, so those are load-bearing: the
 * hearts are real bevelled geometry sitting proud of the chest, not a painted
 * decal, because at the iso camera angle a painted heart flattens out and a
 * modelled one keeps catching the light.
 *
 * Everything else follows the bear rules: honey fur, a cream muzzle that sticks
 * out far enough to throw a little shadow, round ears with pink insides set
 * WIDE apart on top of the skull (close-set ears look like a cat), a button
 * nose, and short stubby arms held slightly out from the body — a teddy that
 * hangs its arms straight down looks sad.
 *
 * **Cartoon pass (26 July 2026).** Head authored at {@link HEAD} × the original,
 * which puts the skull at 65% of his height. The muzzle and its mouth patch ride
 * along, because a doubled skull with the original snout turns a teddy into a
 * pug.
 */

/** Head scale-up over the original authoring. The one knob for Biscuit's skull. */
const HEAD = 1.32;
export interface BiscuitHandle extends CreatureHandle {
  /** Recolours the jumper — the hat/clothes shop will want this. */
  setJumperColour(colour: number): void;
}

export function createBiscuit(): BiscuitHandle {
  const root = new Group();
  root.name = 'biscuit';
  const body = new Group();
  root.add(body);

  const fur = toonMaterial(ART.biscuitFur);
  const furDark = toonMaterial(ART.biscuitFurDark);
  const muzzleMat = toonMaterial(ART.biscuitMuzzle);
  const innerEar = toonMaterial(ART.biscuitInnerEar);
  const noseMat = toonMaterial(ART.biscuitNose);
  const jumper = toonMaterial(ART.jumperRed);
  const jumperDark = toonMaterial(ART.jumperRedDark);
  const heartMat = toonMaterial(ART.heartPink);
  const heartEdge = toonMaterial(ART.heartCream);

  const limbs = makeLimbs();

  // --- torso, wearing the jumper ---------------------------------------------
  const torso = blob(0.235, fur, [1.04, 1.06, 0.95]);
  torso.position.y = 0.32;
  body.add(torso);

  const top = blob(0.245, jumper, [1.05, 0.9, 0.98]);
  top.position.y = 0.36;
  body.add(top);
  addOutline(top, 0.014);

  // Ribbed hem and collar: two flattened rings in the darker red.
  const hem = solid(new Mesh(new TorusGeometry(0.198, 0.028, 8, 24), jumperDark));
  hem.rotation.x = Math.PI / 2;
  hem.position.y = 0.205;
  hem.scale.set(1.02, 1.02, 0.78);
  body.add(hem);

  const collar = solid(new Mesh(new TorusGeometry(0.145, 0.034, 8, 22), jumperDark));
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.53;
  body.add(collar);

  // --- the two hearts ---------------------------------------------------------
  for (const side of [-1, 1] as const) {
    const heart = solid(new Mesh(heartGeometry(0.115, 0.03), heartMat));
    heart.position.set(side * 0.095, 0.38, 0.215);
    heart.rotation.y = side * 0.34;
    heart.rotation.z = side * -0.16;
    body.add(heart);

    const rim = decal(new Mesh(heartGeometry(0.142, 0.018), heartEdge));
    rim.position.z = -0.014;
    heart.add(rim);
  }

  // --- arms: short, held out, cream paw pads ---------------------------------
  for (const side of [-1, 1] as const) {
    const pivot = side < 0 ? limbs.leftArm : limbs.rightArm;
    pivot.position.set(side * 0.225, 0.44, 0);
    body.add(pivot);

    const arm = stub(0.076, 0.1, jumper);
    arm.position.y = -0.08;
    arm.rotation.z = side * 0.34;
    pivot.add(arm);

    const paw = blob(0.083, fur, [1, 0.95, 1], 16);
    paw.position.set(side * 0.055, -0.17, 0.01);
    pivot.add(paw);
    addOutline(paw, 0.011);

    const pad = decal(blob(0.05, muzzleMat, [1, 0.9, 0.42], 12));
    pad.position.set(0, -0.01, 0.062);
    paw.add(pad);
  }

  // --- legs -------------------------------------------------------------------
  for (const side of [-1, 1] as const) {
    const pivot = side < 0 ? limbs.leftLeg : limbs.rightLeg;
    pivot.position.set(side * 0.115, 0.2, 0);
    body.add(pivot);

    const leg = stub(0.082, 0.04, furDark);
    leg.position.y = -0.05;
    pivot.add(leg);

    const foot = blob(0.108, fur, [1, 0.74, 1.3], 18);
    foot.position.set(0, -0.12, 0.04);
    pivot.add(foot);
    addOutline(foot, 0.011);

    const sole = decal(blob(0.062, muzzleMat, [1, 0.62, 0.9], 14));
    sole.position.set(0, -0.005, 0.075);
    foot.add(sole);
  }

  // --- head --------------------------------------------------------------------
  const head = new Group();
  head.position.y = 0.74;
  body.add(head);

  const skullR = 0.29 * HEAD;
  const skull = blob(skullR, fur, [1.06, 0.98, 1], 32);
  head.add(skull);
  addOutline(skull, 0.014);

  // Ears: wide apart, flattened, pink inside.
  for (const side of [-1, 1] as const) {
    const ear = new Group();
    ear.position.set(side * 0.245 * HEAD, 0.19 * HEAD, -0.02 * HEAD);
    ear.rotation.z = side * 0.22;
    head.add(ear);

    const shell = blob(0.098 * HEAD, fur, [1, 1, 0.62], 18);
    ear.add(shell);
    addOutline(shell, 0.012);

    const inner = decal(blob(0.06 * HEAD, innerEar, [1, 1, 0.5], 14));
    inner.position.z = 0.035 * HEAD;
    ear.add(inner);
  }

  // Muzzle: sticks out a good way. It is what makes a bear a bear.
  const muzzle = blob(0.135 * HEAD, muzzleMat, [1.18, 0.86, 0.86], 22);
  muzzle.position.set(0, -0.09 * HEAD, 0.235 * HEAD);
  head.add(muzzle);
  addOutline(muzzle, 0.011);

  const nose = solid(blob(0.05 * HEAD, noseMat, [1.25, 0.9, 0.85], 16));
  nose.position.set(0, 0.035 * HEAD, 0.115 * HEAD);
  muzzle.add(nose);
  addOutline(nose, 0.008);

  // The mouth is painted into the muzzle's own texture. It never changes and
  // has no expressions, so it uses the plain `paintFaceOnFill` + UV remap rather
  // than a `createBakedFace` that would paint five canvases for one static
  // smile. The old note here — that the patch must not re-apply the muzzle's
  // squash, or the smile sinks into the snout — stops applying: the muzzle IS
  // the surface now, so it carries its own squash exactly once.
  const mouthTexture = paintFaceOnFill(ART.biscuitMuzzle, {
    size: 256,
    eyes: false,
    mouth: 'smile',
    mouthW: 0.19,
    eyeY: 0.3,
    mouthDrop: 0.3,
  });
  remapSphereFaceUv(muzzle.geometry, { spreadX: 1.7, spreadY: 1.7, tilt: 0.18 });
  muzzle.material = toonMaterial(0xffffff, { map: mouthTexture });

  // --- eyes ---------------------------------------------------------------------
  // Baked into the skull's own texture — see ART_DIRECTION.md §3.
  const face = createBakedFace({
    fill: ART.biscuitFur,
    spreadX: 1.8,
    spreadY: 1.8,
    tilt: 0.12,
    size: 512,
    eyeY: 0.4,
    eyeGap: 0.46,
    eyeW: 0.115,
    eyeH: 0.142,
    iris: 0x7a4f3a,
    mouth: 'none',
    blush: ART.blush,
    blushStyle: 'soft',
    blushR: 0.1,
  });
  face.applyTo(skull);

  return {
    root,
    body,
    head,
    limbs,
    height: 1.15,
    setExpression: (name: Expression) => face.setExpression(name),
    setWalkPhase: (phase: number, speed: number) => applyWalk(limbs, body, phase, speed, 0.6, 0.05),
    setJumperColour: (colour: number) => {
      jumper.color.setHex(colour);
    },
  };
}
