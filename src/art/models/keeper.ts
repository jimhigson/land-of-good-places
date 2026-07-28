import { CylinderGeometry, Group, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import { PALETTE } from '../style/bridge';
import { ART } from '../style/artPalette';
import { visibleBounds } from '../style/measure';
import { addOutline, solid, toonMaterial } from '../style/materials';
import { sharedFacePatch } from '../style/sharedFace';
import type { Expression } from '../style/faces';
import { blob, type CreatureHandle } from '../style/asset';

/**
 * The friendly blob who runs a shop.
 *
 * Not a `createKid()`: seven kids behind seven counters would be roughly 240
 * draw calls and thirty-five face canvases for characters who never leave a
 * two-metre alcove and are visible from the waist up. This is the same house
 * style — squashed spheres, painted face, ink outlines, head wider than the
 * body — in eight meshes, with one face texture set shared by all seven.
 *
 * Origin at the feet, facing +Z, so it stands behind a counter with
 * `keeper.root.position.set(x, 0, z)` and nothing else.
 */
export interface KeeperOptions {
  /** Apron / body colour. Give each shop its own accent. */
  readonly colour: number;
  /** Hair-tuft colour. */
  readonly hair?: number;
  readonly skin?: number;
}

export interface KeeperHandle extends CreatureHandle {
  /** Both hands, so a shop can wave one. Instanced, hence one group. */
  readonly hands: Group;
}

const HAND_GEOMETRY = new CylinderGeometry(0.085, 0.085, 0.16, 10);

/** A shopkeeper. `update` is left to the caller — see `Shops.update`. */
export function createKeeper(options: KeeperOptions): KeeperHandle {
  const { colour, hair = PALETTE.hair, skin = PALETTE.skin } = options;

  const root = new Group();
  root.name = 'shopkeeper';
  // A keeper is a legless bust: nothing is modelled below the bottom of the
  // apron, which the torso puts 99 mm up. That is not origin-at-the-feet, and
  // the moment one stands anywhere but behind a counter it hovers. `stand`
  // carries the correction, measured at the end of this function — it cannot go
  // on `body`, whose `position.y` is the shopkeeper's bob, nor on `root`, which
  // the contract leaves to the caller.
  const stand = new Group();
  stand.name = 'shopkeeper:stand';
  root.add(stand);
  const body = new Group();
  stand.add(body);

  const skinMat = toonMaterial(skin);

  // Tall enough to be seen. A kiosk counter top is at 1.02 m, so a keeper any
  // shorter than this is a hat floating behind a plank.
  const torso = blob(0.35, toonMaterial(colour), [1, 1.15, 0.92], 20);
  torso.position.y = 0.52;
  body.add(torso);
  addOutline(torso, 0.016);

  const hands = new Group();
  body.add(hands);
  const handMesh = new InstancedMesh(HAND_GEOMETRY, skinMat, 2);
  handMesh.castShadow = false;
  handMesh.receiveShadow = true;
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const axis = new Vector3(0, 0, 1);
  const scale = new Vector3(1, 1, 1);
  const position = new Vector3();
  [-1, 1].forEach((side, index) => {
    rotation.setFromAxisAngle(axis, side * 0.5);
    position.set(side * 0.37, 0.62, 0.1);
    matrix.compose(position, rotation, scale);
    handMesh.setMatrixAt(index, matrix);
  });
  handMesh.instanceMatrix.needsUpdate = true;
  hands.add(handMesh);

  const head = new Group();
  head.position.y = 1.06;
  body.add(head);

  const skullR = 0.32;
  const skull = blob(skullR, skinMat, [1, 0.95, 0.97], 26);
  head.add(skull);
  addOutline(skull, 0.016);

  // One asymmetric tuft, so the head is not a perfect circle in silhouette.
  const tuft = blob(0.13, toonMaterial(hair), [1.5, 0.72, 1], 14);
  tuft.position.set(0.05, 0.29, -0.03);
  tuft.rotation.z = -0.3;
  head.add(tuft);

  const cap = solid(
    new Mesh(new CylinderGeometry(0.2, 0.22, 0.11, 16), toonMaterial(ART.cream)),
  );
  cap.position.set(-0.02, 0.3, 0.02);
  cap.rotation.z = 0.12;
  head.add(cap);

  const face = sharedFacePatch('keeper', {
    radius: skullR,
    size: 256,
    spreadX: 1.7,
    spreadY: 1.7,
    tilt: 0.04,
    eyeY: 0.45,
    eyeGap: 0.42,
    eyeW: 0.12,
    eyeH: 0.155,
    mouth: 'smile',
    mouthW: 0.075,
    mouthDrop: 0.2,
    blush: ART.blush,
    blushStyle: 'soft',
    blushR: 0.095,
  });
  head.add(face.mesh);

  // Both halves of the contract, from the same measurement: drop the bust onto
  // the floor, and report the height it actually built rather than the
  // hand-written 1.42 it had been claiming against a real 1.456.
  const { bottom, top } = visibleBounds(body);
  stand.position.y = -bottom;

  return {
    root,
    body,
    head,
    hands,
    limbs: null,
    height: top - bottom,
    setExpression: (name: Expression) => face.setExpression(name),
    // Shopkeepers never walk, but the contract says every creature can, and a
    // gentle bob on the spot is exactly what `applyWalk` produces at low speed.
    setWalkPhase: (phase: number, speed: number) => {
      body.position.y = Math.abs(Math.sin(phase * Math.PI * 2)) * 0.03 * speed;
    },
  };
}
