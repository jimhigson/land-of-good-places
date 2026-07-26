import {
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  TorusGeometry,
  Vector3,
  type Object3D,
} from 'three';
import { ART } from '../style/artPalette';
import { addOutline, decal, solid, toonMaterial } from '../style/materials';
import { createFacePatch, type Expression } from '../style/faces';
import { starGeometry } from '../style/shapes';
import { blob, type AssetHandle } from '../style/asset';

/**
 * The three balloons from the balloon shop.
 *
 * They are animal-shaped helium balloons, so the rules bend a little: no legs,
 * no walk cycle, a teardrop body, and a tie-knot at the bottom. The origin is at
 * the **bottom of the string** — the point the player's hand holds — so
 * attaching one is `kid.holdAnchor.add(balloon.root)` with no offset maths.
 *
 * They bob and sway on their own via `update()`, because a balloon that hangs
 * dead still looks like a lamp.
 */
export type BalloonKind = 'dalmatian' | 'corgi' | 'chicken';

export interface BalloonHandle extends AssetHandle {
  readonly balloon: Group;
  setExpression(name: Expression): void;
}

const STRING_LENGTH = 0.95;

const TMP_POS = new Vector3();
const TMP_NORMAL = new Vector3();
const FORWARD = new Vector3(0, 0, 1);

/**
 * Lays a flat decal (a spot, a patch of fur) onto the surface of an ellipsoid
 * so it hugs the curve instead of floating off it.
 *
 * `lon` is around the body from +Z, `lat` is up from the equator, both radians.
 */
function stickOnEllipsoid(
  mesh: Object3D,
  a: number,
  b: number,
  c: number,
  lon: number,
  lat: number,
): void {
  const cl = Math.cos(lat);
  TMP_POS.set(a * cl * Math.sin(lon), b * Math.sin(lat), c * cl * Math.cos(lon));
  mesh.position.copy(TMP_POS).multiplyScalar(0.985);
  TMP_NORMAL.set(TMP_POS.x / (a * a), TMP_POS.y / (b * b), TMP_POS.z / (c * c)).normalize();
  mesh.quaternion.setFromUnitVectors(FORWARD, TMP_NORMAL);
}

function makeString(parent: Group): void {
  const string = decal(
    new Mesh(new CylinderGeometry(0.008, 0.008, STRING_LENGTH, 6), toonMaterial(ART.balloonString)),
  );
  string.position.y = STRING_LENGTH / 2;
  parent.add(string);
}

/** Shared shell: string, knot, teardrop body and the floaty bob. */
function balloonBase(name: string, colour: number): {
  root: Group;
  balloon: Group;
  bodyMesh: Mesh;
} {
  const root = new Group();
  root.name = `balloon.${name}`;
  makeString(root);

  const balloon = new Group();
  balloon.position.y = STRING_LENGTH;
  root.add(balloon);

  const knot = solid(new Mesh(new ConeGeometry(0.05, 0.09, 12), toonMaterial(colour)));
  knot.position.y = 0.03;
  knot.rotation.x = Math.PI;
  balloon.add(knot);

  const bodyMesh = blob(0.27, toonMaterial(colour), [1, 1.16, 1], 30);
  bodyMesh.position.y = 0.33;
  balloon.add(bodyMesh);
  addOutline(bodyMesh, 0.014);

  return { root, balloon, bodyMesh };
}

function bobber(balloon: Group, seed: number): (dt: number, elapsed: number) => void {
  return (_dt, elapsed) => {
    const t = elapsed + seed;
    balloon.position.y = STRING_LENGTH + Math.sin(t * 1.3) * 0.04;
    balloon.rotation.z = Math.sin(t * 0.9) * 0.09;
    balloon.rotation.x = Math.cos(t * 0.7) * 0.06;
  };
}

/** The fire-fighting dalmatian pup. */
export function createDalmatianBalloon(): BalloonHandle {
  const { root, balloon } = balloonBase('dalmatian', ART.dalmatianWhite);
  const white = toonMaterial(ART.dalmatianWhite);
  const spot = toonMaterial(ART.dalmatianSpot);
  const earMat = toonMaterial(ART.dalmatianEar);
  const red = toonMaterial(ART.helmetRed);
  const gold = toonMaterial(ART.helmetGold);

  const head = new Group();
  head.position.y = 0.33;
  balloon.add(head);

  // Spots — placed by hand in (lon, lat) so none of them land on the face.
  const spots: [number, number, number][] = [
    [-2.2, 0.35, 0.058],
    [2.1, -0.15, 0.05],
    [-1.15, -0.75, 0.044],
    [1.0, 0.7, 0.062],
    [3.1, 0.05, 0.052],
  ];
  for (const [lon, lat, r] of spots) {
    const s = decal(blob(r, spot, [1, 1, 0.34], 12));
    stickOnEllipsoid(s, 0.27, 0.313, 0.27, lon, lat);
    head.add(s);
  }

  // Floppy ears.
  for (const side of [-1, 1] as const) {
    const ear = blob(0.1, earMat, [0.62, 1.5, 0.75], 16);
    ear.position.set(side * 0.25, 0.02, -0.02);
    ear.rotation.z = side * 0.24;
    head.add(ear);
    addOutline(ear, 0.011);
  }

  // Muzzle + nose.
  const muzzle = blob(0.11, white, [1.2, 0.82, 0.8], 18);
  muzzle.position.set(0, -0.11, 0.21);
  head.add(muzzle);
  const nose = solid(blob(0.045, toonMaterial(ART.dalmatianSpot), [1.2, 0.9, 0.85], 14));
  nose.position.set(0, 0.03, 0.098);
  muzzle.add(nose);

  // Fire helmet: dome, brim, badge.
  const helmet = new Group();
  helmet.position.set(0, 0.17, -0.01);
  helmet.rotation.x = -0.12;
  head.add(helmet);

  const dome = blob(0.235, red, [1, 0.78, 1.02], 24);
  helmet.add(dome);
  addOutline(dome, 0.013);

  const crest = solid(new Mesh(new TorusGeometry(0.06, 0.028, 8, 16, Math.PI), red));
  crest.rotation.y = Math.PI / 2;
  crest.position.y = 0.17;
  helmet.add(crest);

  const brim = solid(new Mesh(new ConeGeometry(0.33, 0.075, 26, 1, true), red));
  brim.position.set(0, 0.01, -0.04);
  brim.scale.set(1, 1, 1.25);
  helmet.add(brim);

  const badge = decal(new Mesh(starGeometry(0.11, 0.02), gold));
  badge.position.set(0, 0.06, 0.2);
  badge.rotation.x = 0.35;
  helmet.add(badge);

  const face = createFacePatch({
    radius: 0.27,
    spreadX: 1.6,
    spreadY: 1.5,
    tilt: 0.02,
    size: 512,
    eyeY: 0.44,
    eyeGap: 0.44,
    eyeW: 0.108,
    eyeH: 0.134,
    mouth: 'none',
    blush: ART.blush,
    blushR: 0.092,
  });
  face.mesh.scale.set(1, 1.16, 1);
  head.add(face.mesh);

  return {
    root,
    balloon,
    height: STRING_LENGTH + 0.72,
    setExpression: (n) => face.setExpression(n),
    update: bobber(balloon, 0),
  };
}

/** The small flying corgi with pink flying glasses. */
export function createCorgiBalloon(): BalloonHandle {
  const { root, balloon } = balloonBase('corgi', ART.corgiTan);
  const tan = toonMaterial(ART.corgiTan);
  const cream = toonMaterial(ART.corgiCream);
  const goggle = toonMaterial(ART.gogglePink);
  const glass = toonMaterial(ART.goggleGlass, { transparent: true, opacity: 0.72 });
  const wing = toonMaterial(ART.wingWhite);

  const head = new Group();
  head.position.y = 0.33;
  balloon.add(head);

  // Cream chest blaze and brow flashes — the corgi's signature markings.
  const blaze = decal(blob(0.13, cream, [1.05, 1.35, 0.35], 18));
  blaze.position.set(0, -0.17, 0.23);
  head.add(blaze);

  // Big upright ears.
  for (const side of [-1, 1] as const) {
    const ear = new Group();
    ear.position.set(side * 0.19, 0.2, -0.01);
    ear.rotation.z = side * 0.3;
    head.add(ear);

    const shell = solid(new Mesh(new ConeGeometry(0.095, 0.26, 16, 1), tan));
    shell.position.y = 0.1;
    ear.add(shell);
    addOutline(shell, 0.012);

    const inner = decal(new Mesh(new ConeGeometry(0.06, 0.17, 12, 1), toonMaterial(ART.blush)));
    inner.position.set(0, 0.09, 0.045);
    ear.add(inner);

    // Little wings, because it flies.
    const w = blob(0.1, wing, [0.5, 1.05, 1.5], 16);
    w.position.set(side * 0.27, -0.02, -0.14);
    w.rotation.z = side * 0.6;
    w.rotation.y = side * 0.5;
    head.add(w);
    addOutline(w, 0.01);
  }

  const muzzle = blob(0.105, cream, [1.2, 0.8, 0.82], 18);
  muzzle.position.set(0, -0.11, 0.215);
  head.add(muzzle);
  const nose = solid(blob(0.042, toonMaterial(ART.biscuitNose), [1.2, 0.9, 0.85], 14));
  nose.position.set(0, 0.035, 0.095);
  muzzle.add(nose);

  // Pink flying glasses, pushed up onto the forehead.
  const strap = solid(new Mesh(new TorusGeometry(0.265, 0.032, 8, 28), goggle));
  strap.position.set(0, 0.12, 0);
  strap.rotation.x = Math.PI / 2 - 0.24;
  strap.scale.set(1, 1, 1.05);
  head.add(strap);

  for (const side of [-1, 1] as const) {
    const rim = solid(new Mesh(new TorusGeometry(0.082, 0.03, 8, 20), goggle));
    rim.position.set(side * 0.1, 0.14, 0.215);
    rim.rotation.x = 0.28;
    head.add(rim);
    addOutline(rim, 0.008);

    const lens = decal(blob(0.076, glass, [1, 1, 0.28], 16));
    lens.position.set(side * 0.1, 0.14, 0.212);
    head.add(lens);
  }

  const face = createFacePatch({
    radius: 0.27,
    spreadX: 1.6,
    spreadY: 1.5,
    tilt: 0.05,
    size: 512,
    eyeY: 0.47,
    eyeGap: 0.44,
    eyeW: 0.106,
    eyeH: 0.13,
    eyeStyle: 'open',
    mouth: 'none',
    blush: ART.blush,
    blushR: 0.094,
  });
  face.mesh.scale.set(1, 1.16, 1);
  head.add(face.mesh);

  return {
    root,
    balloon,
    height: STRING_LENGTH + 0.68,
    setExpression: (n) => face.setExpression(n),
    update: bobber(balloon, 2.1),
  };
}

/** Chicken-looter: white and red, and up to no good. */
export function createChickenBalloon(): BalloonHandle {
  const { root, balloon } = balloonBase('chicken', ART.chickenWhite);
  const white = toonMaterial(ART.chickenWhite);
  const shade = toonMaterial(ART.chickenShade);
  const red = toonMaterial(ART.chickenComb);
  const beakMat = toonMaterial(ART.chickenBeak);
  const sackMat = toonMaterial(ART.chickenSack);

  const head = new Group();
  head.position.y = 0.33;
  balloon.add(head);

  // Comb: three blobs in a row along the crown.
  for (let i = 0; i < 3; i += 1) {
    const c = solid(blob(0.062 - Math.abs(i - 1) * 0.012, red, [0.6, 1.25, 1], 14));
    c.position.set(0, 0.29 - Math.abs(i - 1) * 0.02, (i - 1) * 0.085);
    head.add(c);
    addOutline(c, 0.009);
  }

  // Beak: two short cones, pointing forward.
  const beakTop = solid(new Mesh(new ConeGeometry(0.062, 0.14, 14), beakMat));
  beakTop.position.set(0, -0.05, 0.26);
  beakTop.rotation.x = Math.PI / 2;
  head.add(beakTop);
  addOutline(beakTop, 0.01);

  const beakBottom = solid(new Mesh(new ConeGeometry(0.05, 0.09, 14), toonMaterial(0xe89b2f)));
  beakBottom.position.set(0, -0.1, 0.24);
  beakBottom.rotation.x = Math.PI / 2 - 0.18;
  head.add(beakBottom);

  // Wattles under the beak.
  for (const side of [-1, 1] as const) {
    const w = solid(blob(0.035, red, [0.8, 1.3, 0.8], 12));
    w.position.set(side * 0.045, -0.16, 0.21);
    head.add(w);
  }

  // Tail feathers.
  for (let i = -1; i <= 1; i += 1) {
    const f = solid(blob(0.09, shade, [0.32, 1.15, 0.75], 14));
    f.position.set(i * 0.075, 0.06 + Math.abs(i) * -0.03, -0.26);
    f.rotation.x = -0.7;
    f.rotation.z = i * 0.3;
    head.add(f);
    addOutline(f, 0.009);
  }

  // Little wings.
  for (const side of [-1, 1] as const) {
    const w = blob(0.1, shade, [0.3, 1, 1.25], 14);
    w.position.set(side * 0.255, -0.05, 0);
    w.rotation.z = side * 0.2;
    head.add(w);
  }

  // The loot: a small swag sack clutched underneath.
  const sack = solid(blob(0.11, sackMat, [1, 1.1, 1], 16));
  sack.position.set(0.16, -0.28, 0.06);
  head.add(sack);
  addOutline(sack, 0.01);
  const tie = solid(new Mesh(new TorusGeometry(0.04, 0.016, 6, 12), toonMaterial(ART.jumperRed)));
  tie.position.set(0.16, -0.17, 0.06);
  tie.rotation.x = Math.PI / 2;
  head.add(tie);

  // Sly eyes: it is a looter, after all. Still friendly enough for a six-year-old.
  const face = createFacePatch({
    radius: 0.27,
    spreadX: 1.6,
    spreadY: 1.5,
    tilt: 0.0,
    size: 512,
    eyeY: 0.42,
    eyeGap: 0.44,
    eyeW: 0.1,
    eyeH: 0.124,
    mouth: 'none',
    blush: ART.blush,
    blushR: 0.092,
  });
  face.mesh.scale.set(1, 1.16, 1);
  head.add(face.mesh);

  return {
    root,
    balloon,
    height: STRING_LENGTH + 0.7,
    setExpression: (n) => face.setExpression(n),
    update: bobber(balloon, 4.4),
  };
}

export function createBalloon(kind: BalloonKind): BalloonHandle {
  if (kind === 'dalmatian') return createDalmatianBalloon();
  if (kind === 'corgi') return createCorgiBalloon();
  return createChickenBalloon();
}
