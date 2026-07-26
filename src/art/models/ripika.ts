import { CylinderGeometry, Group, Mesh } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ART } from '../style/artPalette';
import { addOutline, decal, solid, toonMaterial } from '../style/materials';
import { createFacePatch, type Expression } from '../style/faces';
import { applyWalk, blob, makeLimbs, stub, type CreatureHandle } from '../style/asset';

/**
 * RiPika — the park's electric yellow mouse. Eleri's favourite.
 *
 * Design notes (why it looks the way it does, for anyone making a variant):
 *  - Head is 62% of the total height. That is extreme even for this game, and
 *    it is the reason RiPika reads as "cute" from three metres away in the iso
 *    camera while a realistic mouse would read as "rodent".
 *  - The ears are short-for-their-kind and rounded at the tip, with cocoa caps.
 *    Long needle ears look sharp and sharp is not cute.
 *  - The tail is a soft zig-zag "flash" of three rounded slabs, warming from
 *    yellow to amber at the tip — a lightning shape without a lightning edge.
 *  - The cheeks are painted, not modelled: solid tomato discs on the face patch,
 *    big enough to touch the eyes. Modelled cheeks catch shadow and go muddy.
 *  - A cream tummy and a cream collar flash break up the yellow so the body does
 *    not read as one undifferentiated blob at distance.
 *
 * **Cartoon pass (26 July 2026).** The head is authored at {@link HEAD} × its
 * original size. RiPika did not get the kid's full 1.5×: it started at half its
 * own height in skull alone, and a literal doubling leaves a mouse with no room
 * for a mouse. 1.32× puts the skull at 62% of the total and the ears still fit
 * on the screen.
 */

/** Head scale-up over the original authoring. The one knob for RiPika's skull. */
const HEAD = 1.32;
export interface RipikaOptions {
  /** Adds the astronaut helmet for the space ferris wheel show. */
  space?: boolean;
}

export interface RipikaHandle extends CreatureHandle {
  /** Wags when RiPika is happy. */
  readonly tail: Group;
}

export function createRipika(options: RipikaOptions = {}): RipikaHandle {
  const root = new Group();
  root.name = 'ripika';
  const body = new Group();
  root.add(body);

  const yellow = toonMaterial(ART.ripikaYellow);
  const yellowDeep = toonMaterial(ART.ripikaYellowDeep);
  const belly = toonMaterial(ART.ripikaBelly);
  const cocoa = toonMaterial(ART.ripikaTip);
  const amber = toonMaterial(ART.ripikaBolt);

  const limbs = makeLimbs();

  // --- torso: a pear, wider at the bottom -----------------------------------
  const torso = blob(0.245, yellow, [1.02, 1.08, 0.94]);
  torso.position.y = 0.33;
  body.add(torso);
  addOutline(torso, 0.014);

  const tummy = decal(blob(0.155, belly, [0.98, 1.02, 0.5]));
  tummy.position.set(0, 0.28, 0.17);
  body.add(tummy);

  // Cream collar flash — the one graphic marking on the body.
  const collar = decal(blob(0.1, belly, [1.5, 0.38, 0.55]));
  collar.position.set(0, 0.47, 0.16);
  body.add(collar);

  // --- legs: short, with oversized rounded feet ------------------------------
  for (const side of [-1, 1] as const) {
    const pivot = side < 0 ? limbs.leftLeg : limbs.rightLeg;
    pivot.position.set(side * 0.125, 0.19, 0);
    body.add(pivot);

    const thigh = stub(0.072, 0.06, yellowDeep);
    thigh.position.y = -0.05;
    pivot.add(thigh);

    const foot = blob(0.105, cocoa, [1, 0.72, 1.32], 18);
    foot.position.set(0, -0.12, 0.035);
    pivot.add(foot);
    addOutline(foot, 0.011);
  }

  // --- arms: little mitten stubs --------------------------------------------
  for (const side of [-1, 1] as const) {
    const pivot = side < 0 ? limbs.leftArm : limbs.rightArm;
    pivot.position.set(side * 0.235, 0.4, 0);
    body.add(pivot);

    const arm = stub(0.062, 0.075, yellow);
    arm.position.y = -0.06;
    arm.rotation.z = side * 0.28;
    pivot.add(arm);

    const paw = blob(0.075, cocoa, [1, 0.92, 1], 16);
    paw.position.set(side * 0.035, -0.14, 0.01);
    pivot.add(paw);
  }

  // --- tail: a soft zig-zag flash -------------------------------------------
  // Mounted on the HIP, not the spine, and canted so the zig-zag fans across the
  // screen. A tail tucked behind the body is invisible at every camera angle the
  // game ever uses, and RiPika without its flash is just a yellow mouse.
  const tail = new Group();
  tail.position.set(-0.25, 0.24, -0.02);
  tail.rotation.set(0.08, 0.1, 1.05);
  tail.scale.setScalar(1.15);
  body.add(tail);

  const slab = (w: number, h: number, mat: typeof yellow): Mesh =>
    solid(new Mesh(new RoundedBoxGeometry(w, h, 0.075, 4, 0.032), mat));

  const t1 = slab(0.1, 0.2, yellowDeep);
  t1.position.y = 0.09;
  t1.rotation.z = 0.42;
  tail.add(t1);

  const t2 = slab(0.13, 0.21, yellow);
  t2.position.set(-0.1, 0.19, 0);
  t2.rotation.z = -0.5;
  tail.add(t2);

  const t3 = slab(0.19, 0.19, amber);
  t3.position.set(0.03, 0.19, 0);
  t3.rotation.z = 0.55;
  t2.add(t3);
  addOutline(t3, 0.012);
  addOutline(t2, 0.012);
  addOutline(t1, 0.012);

  // --- head ------------------------------------------------------------------
  const head = new Group();
  head.position.y = 0.75;
  body.add(head);

  const skullR = 0.315 * HEAD;
  const skull = blob(skullR, yellow, [1.06, 0.97, 1], 32);
  head.add(skull);
  addOutline(skull, 0.014);

  // Cowlick — one little tuft so the silhouette is not a perfect circle.
  const tuft = blob(0.07 * HEAD, yellowDeep, [0.7, 1.25, 0.7], 14);
  tuft.position.set(-0.05 * HEAD, 0.31 * HEAD, -0.03 * HEAD);
  tuft.rotation.z = -0.45;
  head.add(tuft);

  // Ears: chunky tapered cones with rounded cocoa caps. Built from a tapered
  // CYLINDER rather than a cone so the tip has width — a needle-sharp ear point
  // is the fastest way to make a cute creature look spiky.
  for (const side of [-1, 1] as const) {
    const ear = new Group();
    ear.position.set(side * 0.185 * HEAD, 0.235 * HEAD, -0.02 * HEAD);
    ear.rotation.z = side * 0.44;
    ear.rotation.x = -0.14;
    head.add(ear);

    const shaft = solid(new Mesh(new CylinderGeometry(0.036 * HEAD, 0.105 * HEAD, 0.24 * HEAD, 18, 1), yellow));
    shaft.position.y = 0.11 * HEAD;
    ear.add(shaft);
    addOutline(shaft, 0.011);

    const base = blob(0.1 * HEAD, yellow, [1, 0.75, 1], 16);
    ear.add(base);

    const tipCone = solid(new Mesh(new CylinderGeometry(0.014 * HEAD, 0.038 * HEAD, 0.1 * HEAD, 16, 1), cocoa));
    tipCone.position.y = 0.27 * HEAD;
    ear.add(tipCone);
    addOutline(tipCone, 0.009);

    const tipBall = solid(blob(0.016 * HEAD, cocoa, [1, 1, 1], 10));
    tipBall.position.y = 0.318 * HEAD;
    ear.add(tipBall);
  }

  // --- face ------------------------------------------------------------------
  const face = createFacePatch({
    radius: skullR,
    spreadX: 1.85,
    spreadY: 1.85,
    tilt: 0.2,
    size: 512,
    eyeY: 0.44,
    eyeGap: 0.46,
    eyeW: 0.118,
    eyeH: 0.15,
    mouth: 'cat',
    mouthW: 0.082,
    mouthDrop: 0.235,
    nose: ART.ripikaTip,
    blush: ART.ripikaCheek,
    blushStyle: 'disc',
    blushR: 0.105,
  });
  face.mesh.scale.set(1.06, 0.97, 1);
  head.add(face.mesh);

  if (options.space) {
    const helmet = new Mesh(
      face.mesh.geometry.clone(),
      toonMaterial(0xffffff, { transparent: true, opacity: 0.34 }),
    );
    helmet.scale.setScalar(1.55);
    helmet.name = 'spaceHelmet';
    head.add(helmet);
  }

  const handle: RipikaHandle = {
    root,
    body,
    head,
    tail,
    limbs,
    // Measured to the ear tips, not the skull — the name label must clear them.
    height: 1.46,
    setExpression: (name: Expression) => face.setExpression(name),
    setWalkPhase: (phase: number, speed: number) => {
      applyWalk(limbs, body, phase, speed, 0.7, 0.06);
      tail.rotation.z = Math.sin(phase * Math.PI * 4) * 0.18 * speed;
    },
  };
  return handle;
}
