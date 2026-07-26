import { Group, InstancedMesh, Matrix4, Mesh, Quaternion, SphereGeometry, Vector3 } from 'three';
import { PALETTE } from '../style/bridge';
import { ART } from '../style/artPalette';
import { addOutline, decal, solid, toonMaterial } from '../style/materials';
import { sharedFacePatch } from '../style/sharedFace';
import type { Expression } from '../style/faces';
import { applyWalk, blob, type CreatureHandle } from '../style/asset';

/**
 * The little pets in the sticker & pet shop's pen — and, once the parade exists
 * (build step 5), the ones that trot along behind you.
 *
 * They are deliberately blob-creatures rather than full rigs: two squashed
 * spheres, a pair of ears and a tail. At 0.5 m tall on a shop counter that is
 * all the detail the camera can resolve, and it keeps a pen of three pets down
 * to the draw calls of a single hero character.
 *
 * They implement {@link CreatureHandle} in full, so the parade can drive them
 * with the same code it drives RiPika with. There is no follow or AI logic in
 * here — assets never contain it (ART_DIRECTION.md §7).
 */
export type PetKind = 'bunny' | 'kitten' | 'mouse';

export const PET_KINDS: readonly PetKind[] = ['bunny', 'kitten', 'mouse'];

interface PetRecipe {
  readonly fur: number;
  readonly belly: number;
  readonly ear: number;
  /** Ear size and lean: a bunny's tower up, a kitten's are little triangles. */
  readonly earScale: readonly [number, number, number];
  readonly earLift: number;
  readonly earTilt: number;
  readonly tail: 'puff' | 'long';
  readonly displayName: string;
}

const RECIPES: Readonly<Record<PetKind, PetRecipe>> = {
  bunny: {
    fur: PALETTE.blossomWhite,
    belly: ART.cream,
    ear: PALETTE.blossomPink,
    earScale: [0.42, 1.45, 0.5],
    earLift: 0.22,
    earTilt: 0.16,
    tail: 'puff',
    displayName: 'Bunny',
  },
  kitten: {
    fur: ART.corgiTan,
    belly: ART.cream,
    ear: PALETTE.cheek,
    earScale: [0.6, 0.75, 0.4],
    earLift: 0.13,
    earTilt: 0.3,
    tail: 'long',
    displayName: 'Kitten',
  },
  mouse: {
    fur: PALETTE.markerLilac,
    belly: ART.cream,
    ear: PALETTE.blossomPink,
    earScale: [0.85, 0.85, 0.28],
    earLift: 0.14,
    earTilt: 0.42,
    tail: 'long',
    displayName: 'Mouse',
  },
};

export interface PetHandle extends CreatureHandle {
  readonly kind: PetKind;
  readonly displayName: string;
}

/** One small blob pet. Origin at the paws, facing +Z. */
export function createPet(kind: PetKind): PetHandle {
  const recipe = RECIPES[kind];
  const root = new Group();
  root.name = `pet.${kind}`;
  const body = new Group();
  root.add(body);

  const furMat = toonMaterial(recipe.fur);

  const torso = blob(0.16, furMat, [1, 0.86, 1.02], 20);
  torso.position.y = 0.15;
  body.add(torso);
  addOutline(torso, 0.011);

  const tummy = decal(blob(0.1, toonMaterial(recipe.belly), [1, 0.86, 0.5], 12));
  tummy.position.set(0, 0.14, 0.115);
  body.add(tummy);

  const head = new Group();
  head.position.y = 0.3;
  body.add(head);

  const skullR = 0.155;
  const skull = blob(skullR, furMat, [1, 0.94, 0.96], 22);
  head.add(skull);
  addOutline(skull, 0.012);

  // Both ears in one instanced mesh: identical geometry, mirrored placement.
  const ears = new InstancedMesh(new SphereGeometry(0.09, 12, 9), toonMaterial(recipe.ear), 2);
  ears.castShadow = false;
  ears.receiveShadow = true;
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const axis = new Vector3(0, 0, 1);
  const scale = new Vector3(recipe.earScale[0], recipe.earScale[1], recipe.earScale[2]);
  const position = new Vector3();
  [-1, 1].forEach((side, index) => {
    rotation.setFromAxisAngle(axis, -side * recipe.earTilt);
    position.set(side * 0.09, 0.1 + recipe.earLift, -0.01);
    matrix.compose(position, rotation, scale);
    ears.setMatrixAt(index, matrix);
  });
  ears.instanceMatrix.needsUpdate = true;
  head.add(ears);

  const tail =
    recipe.tail === 'puff'
      ? blob(0.062, toonMaterial(recipe.belly), [1, 0.9, 0.9], 12)
      : blob(0.038, furMat, [0.7, 0.7, 2.4], 12);
  tail.position.set(0, recipe.tail === 'puff' ? 0.14 : 0.17, -0.18);
  body.add(tail);

  // One shared 256² face across every pet of every kind — see `sharedFace.ts`.
  const face = sharedFacePatch('pet', {
    radius: skullR,
    size: 256,
    spreadX: 1.8,
    spreadY: 1.8,
    tilt: 0.06,
    eyeY: 0.47,
    eyeGap: 0.42,
    eyeW: 0.125,
    eyeH: 0.16,
    mouth: 'cat',
    mouthW: 0.06,
    mouthDrop: 0.19,
    blush: ART.blush,
    blushStyle: 'soft',
    blushR: 0.085,
  });
  head.add(face.mesh);

  const feet = solid(new Mesh(new SphereGeometry(0.055, 10, 8), furMat));
  feet.position.set(0, 0.045, 0.09);
  feet.scale.set(2.1, 0.7, 1.2);
  body.add(feet);

  return {
    root,
    body,
    head,
    kind,
    displayName: recipe.displayName,
    limbs: null,
    height: 0.52,
    setExpression: (name: Expression) => face.setExpression(name),
    setWalkPhase: (phase: number, speed: number) => applyWalk(null, body, phase, speed, 0.85, 0.075),
  };
}
