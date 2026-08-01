import { ConeGeometry, Group, Mesh } from 'three';
import { ART } from '../style/artPalette';
import { addOutline, decal, solid, toonMaterial } from '../style/materials';
import { createBakedFace, type Expression } from '../style/faces';
import { applyWalk, blob, makeLimbs, stub, type CreatureHandle } from '../style/asset';

/**
 * A mini — the little creature that runs up shouting "MINI ATTACK!" in Mayhem
 * mode and grabs your legs.
 *
 * The brief here is delicate: it has to read as *naughty* without being scary,
 * because a six-year-old is playing. The tricks used:
 *  - a grin with two small rounded teeth (rounded, never pointed);
 *  - eyebrows angled inwards — the entire "up to no good" signal lives in two
 *    short strokes, and nothing else about the creature is menacing;
 *  - soft lilac and mint, the least threatening colours available;
 *  - horns that are stubby cream nubs, not spikes;
 *  - arms permanently raised in a grabby pose, which is funny rather than
 *    threatening on something 55 cm tall.
 *
 * Head is the most extreme ratio in the game: after the cartoon pass the skull
 * alone is 67% of the mini's total height.
 */

/** Head scale-up over the original authoring. The one knob for the mini's skull. */
const HEAD = 1.3;
export interface MiniHandle extends CreatureHandle {
  /** Raise/lower the grabby arms. 0 = down, 1 = full "MINI ATTACK!". */
  setGrab(amount: number): void;
}

export function createMini(): MiniHandle {
  const root = new Group();
  root.name = 'mini';
  const body = new Group();
  root.add(body);

  const lilac = toonMaterial(ART.miniLilac);
  const lilacDark = toonMaterial(ART.miniLilacDark);
  const belly = toonMaterial(ART.miniBelly);
  const horn = toonMaterial(ART.miniHorn);

  const limbs = makeLimbs();

  // --- tiny body ---------------------------------------------------------------
  const torso = blob(0.125, lilac, [1.1, 0.95, 0.98]);
  torso.position.y = 0.14;
  body.add(torso);
  addOutline(torso, 0.011);

  // Small and pushed well clear of the torso: a big flattened blob intersects
  // the body and the intersection curve reads as a jagged tear.
  // Must PROTRUDE past the torso surface (z ≈ 0.1225 here). A belly patch whose
  // front sits inside the body only shows where it happens to poke through, and
  // the intersection curve reads as a jagged starburst.
  const tummy = decal(blob(0.075, belly, [1, 1, 0.55], 24));
  tummy.position.set(0, 0.13, 0.1);
  body.add(tummy);

  // --- feet: flat and comically wide -------------------------------------------
  for (const side of [-1, 1] as const) {
    const pivot = side < 0 ? limbs.leftLeg : limbs.rightLeg;
    pivot.position.set(side * 0.07, 0.08, 0);
    body.add(pivot);

    const foot = blob(0.075, lilacDark, [1.05, 0.6, 1.4], 16);
    foot.position.set(0, -0.05, 0.03);
    pivot.add(foot);
    addOutline(foot, 0.009);
  }

  // --- grabby arms ---------------------------------------------------------------
  for (const side of [-1, 1] as const) {
    const pivot = side < 0 ? limbs.leftArm : limbs.rightArm;
    pivot.position.set(side * 0.155, 0.2, 0);
    pivot.rotation.z = side * -0.5;
    body.add(pivot);

    const arm = stub(0.038, 0.075, lilac);
    arm.position.y = -0.055;
    pivot.add(arm);

    const hand = blob(0.05, lilacDark, [1, 1, 1], 12);
    hand.position.y = -0.115;
    pivot.add(hand);
  }

  // --- tail: one cheeky nub -------------------------------------------------------
  const tail = blob(0.05, lilacDark, [0.8, 0.8, 1.5], 12);
  tail.position.set(0, 0.13, -0.15);
  tail.rotation.x = 0.5;
  body.add(tail);

  // --- head ----------------------------------------------------------------------
  const head = new Group();
  head.position.y = 0.4;
  body.add(head);

  const skullR = 0.185 * HEAD;
  const skull = blob(skullR, lilac, [1.1, 0.98, 1], 28);
  head.add(skull);
  addOutline(skull, 0.012);

  // Stubby horns.
  for (const side of [-1, 1] as const) {
    const h = solid(new Mesh(new ConeGeometry(0.038 * HEAD, 0.085 * HEAD, 12, 1), horn));
    h.position.set(side * 0.088 * HEAD, 0.185 * HEAD, -0.01 * HEAD);
    h.rotation.z = side * 0.42;
    head.add(h);
    addOutline(h, 0.008);
  }

  // Big pointy ears sticking out sideways.
  for (const side of [-1, 1] as const) {
    const ear = blob(0.075 * HEAD, lilacDark, [0.42, 1.05, 1.15], 14);
    ear.position.set(side * 0.2 * HEAD, 0.02 * HEAD, -0.02 * HEAD);
    ear.rotation.z = side * 0.35;
    ear.rotation.y = side * -0.3;
    head.add(ear);
    addOutline(ear, 0.009);
  }

  // Baked into the skull's own texture — see ART_DIRECTION.md §3.
  const face = createBakedFace({
    fill: ART.miniLilac,
    spreadX: 1.9,
    spreadY: 1.8,
    tilt: 0.16,
    size: 256,
    eyeY: 0.42,
    eyeGap: 0.45,
    eyeW: 0.118,
    eyeH: 0.138,
    iris: 0xd98f2e,
    mouth: 'grin',
    mouthW: 0.115,
    mouthDrop: 0.185,
    brows: true,
    blush: ART.miniLilacDark,
    blushStyle: 'soft',
    blushR: 0.075,
  });
  face.applyTo(skull);

  const grabBase = 0.5;
  return {
    root,
    body,
    head,
    limbs,
    height: 0.72,
    setExpression: (name: Expression) => face.setExpression(name),
    setWalkPhase: (phase: number, speed: number) => applyWalk(limbs, body, phase, speed, 0.5, 0.1),
    setGrab: (amount: number) => {
      limbs.leftArm.rotation.z = grabBase * -1 - amount * 1.5;
      limbs.rightArm.rotation.z = grabBase + amount * 1.5;
    },
  };
}
