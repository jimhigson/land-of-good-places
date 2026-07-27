import { CylinderGeometry, Group, Mesh, SphereGeometry } from 'three';
import { PALETTE } from '../style/bridge';
import { addOutline, decal, solid, toonMaterial } from '../style/materials';
import { createFacePatch, type Expression } from '../style/faces';
import { applyWalk, blob, makeLimbs, type CreatureHandle } from '../style/asset';

/**
 * Space Bulba-squirt — an original park creature, built for the ferris wheel's
 * space show: a round, friendly toon turtle with a leafy sprout budding on its
 * shell.
 *
 * **Original design, on purpose.** This is not a portrait of anything else —
 * same brief as Space RiPika (ART_DIRECTION.md, "an original take"). The shape
 * language stays entirely this park's own: a squashed-sphere shell in the toy
 * palette (`PALETTE.markerMint`, the same mint every fairground marker in this
 * game uses), paddle flippers instead of legs, and — the one part that could
 * have gone wrong — a **flower bud**, not a bulb, on its back. A sac-shaped
 * plant growing out of a creature's shoulders belongs to somebody else's
 * design; a stem with a couple of leaves and a little blossom is just a plant,
 * the way real turtles occasionally grow a bit of pond-weed.
 *
 * It never touches the ground, so unlike every other creature in the park it
 * has no legs to plant a name label over — `setWalkPhase` drives four paddling
 * flippers instead of a walk cycle, reusing the house `applyWalk` swing so it
 * still reads as a member of the same toy family.
 */

export interface SpaceTurtleHandle extends CreatureHandle {
  /** The sprout on its shell — nodding gently is all it ever needs to do. */
  readonly sprout: Group;
}

/** Home-grown colours for this one creature, kept here rather than ART.ts —
 *  nothing else in the park needs a turtle shell green. */
const SHELL = PALETTE.markerMint;
const SHELL_DEEP = PALETTE.leafDeep;
const SKIN = 0xdcf5e2;
const SKIN_DEEP = 0xb9e6c6;
const BUD = PALETTE.markerLilac;

export function createSpaceTurtle(): SpaceTurtleHandle {
  const root = new Group();
  root.name = 'spaceTurtle';
  const body = new Group();
  root.add(body);

  const shellMat = toonMaterial(SHELL);
  const shellDeepMat = toonMaterial(SHELL_DEEP);
  const skinMat = toonMaterial(SKIN);
  const skinDeepMat = toonMaterial(SKIN_DEEP);

  // --- torso: a round, cream-green tummy, mostly hidden under the shell -----
  const torso = blob(0.19, skinMat, [1, 0.92, 1.05], 22);
  torso.position.y = 0.22;
  body.add(torso);
  addOutline(torso, 0.012);

  // --- the shell: a dome sitting high and a little back, so it silhouettes
  // above the head from the front the way a real one does ------------------
  const shell = blob(0.225, shellMat, [1.12, 0.72, 1.18], 26);
  shell.position.set(0, 0.34, -0.02);
  body.add(shell);
  addOutline(shell, 0.013);

  const shellRim = blob(0.235, shellDeepMat, [1.14, 0.36, 1.2], 22);
  shellRim.position.set(0, 0.2, -0.02);
  body.add(shellRim);

  // Shell plates: small domes that protrude past the shell surface
  // (ART_DIRECTION §2 — a marking that sits flush reads as a jagged seam).
  const plateOffsets: [number, number][] = [
    [0, 0.155],
    [0.13, 0.04],
    [-0.13, 0.04],
    [0.09, -0.09],
    [-0.09, -0.09],
  ];
  for (const [px, pz] of plateOffsets) {
    const plate = decal(new Mesh(new SphereGeometry(0.075, 14, 10), shellDeepMat));
    plate.position.set(px, 0.4, pz - 0.02);
    plate.scale.set(1, 0.62, 1);
    body.add(plate);
  }

  // --- the sprout on its back: a stem, two leaves and a little flower bud —
  // a plant, never a bulb ------------------------------------------------------
  const sprout = new Group();
  sprout.position.set(-0.03, 0.5, -0.06);
  sprout.rotation.z = 0.12;
  body.add(sprout);

  const stem = solid(new Mesh(new CylinderGeometry(0.02, 0.026, 0.16, 8), shellDeepMat));
  stem.position.y = 0.08;
  sprout.add(stem);

  for (const [side, tilt] of [
    [-1, 0.55],
    [1, 0.7],
  ] as const) {
    const leaf = blob(0.075, toonMaterial(side < 0 ? PALETTE.leafMid : PALETTE.leafLight), [1.7, 0.32, 0.85], 14);
    leaf.position.set(side * 0.06, 0.1 + (side < 0 ? 0.01 : -0.01), 0);
    leaf.rotation.z = side * tilt;
    sprout.add(leaf);
  }

  const bud = blob(0.045, toonMaterial(BUD), [1, 1.1, 1], 14);
  bud.position.y = 0.19;
  sprout.add(bud);

  // --- head -------------------------------------------------------------------
  const head = new Group();
  head.position.set(0, 0.32, 0.19);
  body.add(head);

  const skullR = 0.135;
  const skull = blob(skullR, skinMat, [1.02, 0.95, 0.9], 24);
  head.add(skull);
  addOutline(skull, 0.011);

  const face = createFacePatch({
    radius: skullR,
    spreadX: 1.8,
    spreadY: 1.85,
    tilt: 0.14,
    size: 256,
    eyeY: 0.46,
    eyeGap: 0.44,
    eyeW: 0.13,
    eyeH: 0.165,
    mouth: 'smile',
    mouthW: 0.075,
    mouthDrop: 0.21,
    blush: PALETTE.cheek,
    blushStyle: 'soft',
    blushR: 0.095,
  });
  face.mesh.scale.set(1.02, 0.95, 1);
  head.add(face.mesh);

  // --- limbs: four flat paddle flippers, no feet ------------------------------
  const limbs = makeLimbs();
  const flipperPositions: [Group, number, number, boolean][] = [
    [limbs.leftArm, -0.18, 0.28, true],
    [limbs.rightArm, 0.18, 0.28, true],
    [limbs.leftLeg, -0.15, -0.14, false],
    [limbs.rightLeg, 0.15, -0.14, false],
  ];
  for (const [pivot, x, z, front] of flipperPositions) {
    pivot.position.set(x, 0.22, z);
    body.add(pivot);

    const flipper = blob(
      front ? 0.1 : 0.085,
      skinDeepMat,
      front ? [1.5, 0.36, 0.95] : [1.25, 0.34, 0.85],
      14,
    );
    flipper.position.set(x < 0 ? -0.06 : 0.06, -0.02, 0);
    pivot.add(flipper);
  }

  // A little tail nub, mostly for character — turtles need one even when it
  // never gets looked at.
  const tail = decal(new Mesh(new SphereGeometry(0.05, 10, 8), skinDeepMat));
  tail.position.set(0, 0.2, -0.24);
  tail.scale.set(1, 0.8, 1.1);
  body.add(tail);

  return {
    root,
    body,
    head,
    limbs,
    sprout,
    height: 0.52,
    setExpression: (name: Expression) => face.setExpression(name),
    setWalkPhase: (phase: number, speed: number) => {
      // A gentle paddle rather than a stride: less swing, more bob, because
      // this creature is floating, not walking.
      applyWalk(limbs, body, phase, speed, 0.55, 0.045);
      sprout.rotation.x = Math.sin(phase * Math.PI * 4) * 0.08 * speed;
    },
  };
}
