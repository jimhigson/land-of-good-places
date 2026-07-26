import { Group, Mesh, TorusGeometry } from 'three';
import { ART } from '../../art/style/artPalette';
import { PALETTE } from '../../core/palette';
import { createFacePatch } from '../../art/style/faces';
import { solid, toonMaterial } from '../../art/style/materials';
import { blob } from '../../art/style/asset';

/**
 * A blob pet, for the two children in the park who brought one.
 *
 * Small, round, four-legless, and hops along behind its child on a lead. Built
 * to ART_DIRECTION §7: origin between the feet, facing +Z, metres, every sphere
 * squashed, one asymmetric feature on the head, painted face rather than eye
 * meshes, `toonMaterial` throughout, and no colour that is not already in
 * `PALETTE` or `ART`.
 *
 * **Note for review:** `src/art/models/pets.ts` exists on `main` but was not in
 * this branch's base. If it has landed by the time this is read, this file
 * should be deleted and {@link createPetBlob} replaced by that factory — the
 * NPC system only needs `root`, `body`, `head` and `height`, which any pet
 * asset satisfying the creature contract already provides.
 */

export interface PetBlobHandle {
  readonly root: Group;
  /** Bob and squash target. */
  readonly body: Group;
  /** Look-at target. Rotating it must not move the body. */
  readonly head: Group;
  readonly height: number;
}

/** Names the NPC system uses to find the joints on an instanced copy. */
export const PET_BODY_NODE = 'pet.body';
export const PET_HEAD_NODE = 'pet.head';

export function createPetBlob(): PetBlobHandle {
  const root = new Group();
  root.name = 'pet.blob';

  const body = new Group();
  body.name = PET_BODY_NODE;
  root.add(body);

  const furMat = toonMaterial(ART.miniLilac);
  const furDarkMat = toonMaterial(ART.miniLilacDark);
  const tummyMat = toonMaterial(ART.cream);
  const collarMat = toonMaterial(PALETTE.markerLemon);

  // --- body: one big squashed sphere sitting low, because low is cute --------
  const belly = blob(0.26, furMat, [1.16, 0.86, 1.02], 20);
  belly.position.y = 0.23;
  body.add(belly);

  // The tummy patch protrudes past the surface — a patch that sits inside the
  // body shows only where it happens to poke through, as a jagged starburst.
  const tummy = blob(0.2, tummyMat, [0.86, 0.66, 0.6], 16);
  tummy.position.set(0, 0.19, 0.16);
  body.add(tummy);

  // Two stubby feet, just enough to keep it from reading as a floating ball.
  for (const side of [-1, 1] as const) {
    const foot = blob(0.1, furDarkMat, [1, 0.66, 1.25], 12);
    foot.position.set(side * 0.13, 0.06, 0.05);
    body.add(foot);
  }

  // --- head ------------------------------------------------------------------
  const head = new Group();
  head.name = PET_HEAD_NODE;
  head.position.y = 0.44;
  body.add(head);

  const skullR = 0.21;
  const skull = blob(skullR, furMat, [1, 0.94, 0.97], 22);
  head.add(skull);

  // One ear up, one ear flopped: the asymmetric feature every character here
  // gets, and the cheapest personality in the game.
  const earUp = blob(0.09, furMat, [0.6, 1.35, 0.5], 12);
  earUp.position.set(-0.13, 0.19, -0.02);
  earUp.rotation.z = 0.28;
  head.add(earUp);

  const earFlop = blob(0.09, furMat, [0.62, 1.2, 0.5], 12);
  earFlop.position.set(0.14, 0.12, -0.02);
  earFlop.rotation.z = 1.15;
  head.add(earFlop);

  const collar = solid(new Mesh(new TorusGeometry(0.15, 0.032, 8, 16), collarMat));
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.3;
  body.add(collar);

  const face = createFacePatch({
    radius: skullR,
    spreadX: 1.8,
    spreadY: 1.7,
    tilt: 0.06,
    size: 256,
    eyeY: 0.44,
    eyeGap: 0.46,
    eyeW: 0.13,
    eyeH: 0.16,
    iris: PALETTE.ink,
    mouth: 'smile',
    mouthW: 0.07,
    mouthDrop: 0.2,
    blush: ART.blush,
    blushStyle: 'soft',
    blushR: 0.11,
  });
  head.add(face.mesh);

  return { root, body, head, height: 0.66 };
}
