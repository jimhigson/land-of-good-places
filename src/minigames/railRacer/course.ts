import {
  BoxGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { PALETTE } from '../../core/palette';
import { Rng, clamp01, lerp } from '../../core/mathUtils';
import { addOutline, decal, solid, toonMaterial } from '../../art/style/materials';
import { HAZARDS, HAZARD_CLEARANCE, TRACK_LENGTH, railHeight, railPitch, type Hazard } from './track';

/**
 * Everything the race runs *through*: four parallel rails, their posts, the
 * grass they cross, the hazards and the two arches.
 *
 * The rails are swept along the same `railHeight` the riders read, so the
 * geometry and the gameplay cannot disagree — the trap `SlideRide` in the park
 * avoids, for the same reason.
 *
 * **Why four rails and not one.** Four riders sharing a line would spend the
 * race inside each other, and rubber-banding keeps them deliberately close. A
 * lane each, stepped back in Z and viewed with a little pitch on the camera,
 * puts them on four clearly separate rows of the picture while keeping the
 * flat, side-on, storybook read.
 *
 * Hazard telegraphing is the whole teaching mechanism of this game and it lives
 * here: as you come up on a gate its lamps swell and go amber, and the moment
 * you are actually slow enough to duck under it they turn mint. A child learns
 * "let go when it goes orange, hold again when it goes green" in about two
 * hazards, without a word of instruction.
 */

/**
 * Z of each lane, far to near. The player rides the nearest one — the bottom
 * row of the picture, where nothing can ever be drawn in front of them.
 */
export const LANES: readonly number[] = [-4.8, -1.6, 1.6, 4.8];

/** The lane the player rides. */
export const PLAYER_LANE = LANES.length - 1;

/** Half-width of the hazard bars: they cross every lane at once. */
const SPAN = 7.2;

export interface HazardProp {
  readonly hazard: Hazard;
  /** `closeness` is 0 (far) to 1 (right there); `safe` is "slow enough now". */
  setAlert(closeness: number, safe: boolean, elapsed: number): void;
}

export interface Course {
  readonly root: Group;
  readonly hazards: readonly HazardProp[];
  dispose(): void;
}

export function createCourse(): Course {
  const root = new Group();
  root.name = 'railracer:course';
  const disposables: { dispose(): void }[] = [];
  const track = (item: { dispose(): void }): void => {
    disposables.push(item);
  };

  const grassMaterial = toonMaterial(PALETTE.grass);
  const grassLightMaterial = toonMaterial(PALETTE.grassLight);
  const railMaterial = toonMaterial(PALETTE.liftFrame);
  const woodMaterial = toonMaterial(PALETTE.wood);
  const leafMaterial = toonMaterial(PALETTE.leafMid);
  for (const material of [grassMaterial, grassLightMaterial, railMaterial, woodMaterial, leafMaterial]) {
    track(material);
  }

  const start = -40;
  const end = TRACK_LENGTH + 60;
  const length = end - start;
  const centre = (start + end) / 2;

  // --- the ground -----------------------------------------------------------
  const ground = solid(new Mesh(new BoxGeometry(length, 8, 40), grassMaterial));
  ground.position.set(centre, -4, -6);
  root.add(ground);
  track(ground.geometry);

  // A mown strip under the rails, so the ground is not one flat field of green.
  const verge = solid(new Mesh(new BoxGeometry(length, 0.2, 13.5), grassLightMaterial));
  verge.position.set(centre, -0.02, 0);
  root.add(verge);
  track(verge.geometry);

  // --- the rails ------------------------------------------------------------
  const spine: Vector3[] = [];
  for (let x = start; x <= end; x += 4) spine.push(new Vector3(x, railHeight(x), 0));

  for (const lane of LANES) {
    const curve = new CatmullRomCurve3(
      spine.map((point) => new Vector3(point.x, point.y, lane)),
      false,
      'catmullrom',
      0.5,
    );
    const geometry = new TubeGeometry(curve, Math.round(length / 3), 0.13, 6, false);
    const rail = solid(new Mesh(geometry, railMaterial));
    root.add(rail);
    track(geometry);
  }

  // --- posts ----------------------------------------------------------------
  const perLane = Math.floor(length / 9);
  const postGeometry = new CylinderGeometry(0.17, 0.22, 1, 8);
  const posts = new InstancedMesh(postGeometry, woodMaterial, perLane * LANES.length);
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const position = new Vector3();
  let index = 0;
  for (const lane of LANES) {
    for (let i = 0; i < perLane; i += 1) {
      const x = start + i * 9 + 4;
      const top = railHeight(x) - 0.2;
      position.set(x, top / 2, lane);
      matrix.compose(position, quaternion, new Vector3(1, top, 1));
      posts.setMatrixAt(index, matrix);
      index += 1;
    }
  }
  posts.instanceMatrix.needsUpdate = true;
  root.add(posts);
  track(postGeometry);

  // --- bushes along the line -------------------------------------------------
  const rng = new Rng(0x5cede);
  const bushCount = 170;
  const bushGeometry = new IcosahedronGeometry(1, 1);
  bushGeometry.computeVertexNormals();
  const bushes = new InstancedMesh(bushGeometry, leafMaterial, bushCount);
  const colour = new Color();
  const greens = [PALETTE.leafMid, PALETTE.leafLight, PALETTE.leafDeep, PALETTE.blossomPink];
  for (let i = 0; i < bushCount; i += 1) {
    const x = start + rng.range(0, length);
    const z = rng.chance(0.6) ? rng.range(-16, -8) : rng.range(7.5, 11);
    const radius = rng.range(0.55, 1.5);
    position.set(x, radius * 0.7, z);
    quaternion.setFromAxisAngle(UP, rng.range(0, Math.PI * 2));
    matrix.compose(position, quaternion, new Vector3(radius, radius * 0.85, radius));
    bushes.setMatrixAt(i, matrix);
    colour.setHex(rng.pick(greens));
    bushes.setColorAt(i, colour);
  }
  quaternion.identity();
  bushes.instanceMatrix.needsUpdate = true;
  if (bushes.instanceColor) bushes.instanceColor.needsUpdate = true;
  root.add(bushes);
  track(bushGeometry);

  // --- the arches -------------------------------------------------------------
  root.add(buildArch(0, PALETTE.markerMint, 'start', track));
  root.add(buildArch(TRACK_LENGTH, PALETTE.markerPink, 'finish', track));

  // --- hazards ----------------------------------------------------------------
  const hazardProps: HazardProp[] = [];
  for (const hazard of HAZARDS) {
    const built = hazard.kind === 'gate' ? buildGate(hazard, track) : buildBranch(hazard, track);
    root.add(built.group);
    hazardProps.push(built.handle);
  }

  return {
    root,
    hazards: hazardProps,
    dispose(): void {
      for (const item of disposables) item.dispose();
    },
  };
}

// ---------------------------------------------------------------- internals

const UP = new Vector3(0, 1, 0);

type Track = (item: { dispose(): void }) => void;

/** The colours a hazard's lamps run through: calm cream, amber warning, mint safe. */
const CALM = new Color(PALETTE.signBoard);
const WARN = new Color(PALETTE.fairyWarm);
const SAFE = new Color(PALETTE.markerMint);

/**
 * The shared "warning lamp" behaviour.
 *
 * Colour says *what to do* and size says *how soon* — two channels for one
 * idea, so it still reads for a child who cannot tell amber from mint.
 */
function makeAlert(
  lamps: readonly Mesh[],
  materials: readonly MeshBasicMaterial[],
): HazardProp['setAlert'] {
  const tint = new Color();
  return (closeness: number, safe: boolean, elapsed: number): void => {
    const level = clamp01(closeness);
    tint.copy(CALM).lerp(safe ? SAFE : WARN, level);
    for (const material of materials) material.color.copy(tint);

    const pulse = 1 + Math.sin(elapsed * (safe ? 7 : 13)) * 0.16 * level;
    const size = lerp(0.85, 1.35, level) * pulse;
    for (const lamp of lamps) lamp.scale.setScalar(size);
  };
}

/** A sparking gate: a low bar across every lane, with lamps at both ends. */
function buildGate(hazard: Hazard, track: Track): { group: Group; handle: HazardProp } {
  const group = new Group();
  group.position.set(hazard.x, railHeight(hazard.x), 0);
  group.rotation.z = railPitch(hazard.x);

  const frameMaterial = toonMaterial(PALETTE.buildingTrim);
  const barMaterial = toonMaterial(PALETTE.slideRail);
  track(frameMaterial);
  track(barMaterial);

  const postHeight = HAZARD_CLEARANCE + 0.9;
  const postGeometry = new CylinderGeometry(0.16, 0.19, postHeight, 8);
  track(postGeometry);
  for (const side of [-1, 1] as const) {
    const post = solid(new Mesh(postGeometry, frameMaterial));
    post.position.set(0, postHeight / 2 - 0.4, side * SPAN);
    group.add(post);
    addOutline(post, 0.02);
  }

  const bar = solid(new Mesh(new BoxGeometry(0.4, 0.34, SPAN * 2), barMaterial));
  bar.position.set(0, HAZARD_CLEARANCE, 0);
  group.add(bar);
  addOutline(bar, 0.022);
  track(bar.geometry);

  // Stubby bristles hanging off the bar. They are what tells a child it is the
  // *height* that matters, before they have ever hit one.
  const bristleGeometry = new CylinderGeometry(0.055, 0.035, 0.36, 6);
  track(bristleGeometry);
  const bristles = 19;
  for (let i = 0; i < bristles; i += 1) {
    const bristle = decal(new Mesh(bristleGeometry, barMaterial));
    bristle.position.set(0, HAZARD_CLEARANCE - 0.3, -SPAN + 0.4 + (i * (SPAN * 2 - 0.8)) / (bristles - 1));
    group.add(bristle);
  }

  const lamps: Mesh[] = [];
  const materials: MeshBasicMaterial[] = [];
  const lampGeometry = new SphereGeometry(0.2, 12, 9);
  track(lampGeometry);
  for (const side of [-1, 1] as const) {
    for (const height of [-0.2, HAZARD_CLEARANCE + 0.42]) {
      const material = new MeshBasicMaterial({ color: PALETTE.signBoard, toneMapped: false });
      materials.push(material);
      track(material);
      const lamp = decal(new Mesh(lampGeometry, material));
      lamp.position.set(0, height, side * SPAN);
      group.add(lamp);
      lamps.push(lamp);
    }
  }

  return { group, handle: { hazard, setAlert: makeAlert(lamps, materials) } };
}

/** A low branch: a friendly tree leaning right across the track. */
function buildBranch(hazard: Hazard, track: Track): { group: Group; handle: HazardProp } {
  const group = new Group();
  group.position.set(hazard.x, railHeight(hazard.x), 0);
  group.rotation.z = railPitch(hazard.x);

  const barkMaterial = toonMaterial(PALETTE.bark);
  const leafMaterial = toonMaterial(PALETTE.leafDeep);
  track(barkMaterial);
  track(leafMaterial);

  const trunkGeometry = new CylinderGeometry(0.42, 0.58, 5.6, 9);
  track(trunkGeometry);
  const trunk = solid(new Mesh(trunkGeometry, barkMaterial));
  trunk.position.set(0.3, 1.4, -SPAN - 1.6);
  trunk.rotation.z = 0.09;
  group.add(trunk);
  addOutline(trunk, 0.022);

  const armLength = SPAN * 2 + 1.6;
  const armGeometry = new CylinderGeometry(0.2, 0.28, armLength, 8);
  track(armGeometry);
  const arm = solid(new Mesh(armGeometry, barkMaterial));
  arm.rotation.x = Math.PI / 2;
  arm.position.set(0.15, HAZARD_CLEARANCE, -SPAN - 1.6 + armLength / 2);
  group.add(arm);
  addOutline(arm, 0.02);

  const canopyGeometry = new IcosahedronGeometry(1, 1);
  canopyGeometry.computeVertexNormals();
  track(canopyGeometry);
  const canopyRng = new Rng(0xbea11 + Math.round(hazard.x));
  for (let i = 0; i < 7; i += 1) {
    const radius = canopyRng.range(1.1, 1.9);
    const blob = solid(new Mesh(canopyGeometry, leafMaterial));
    blob.scale.set(radius, radius * 0.85, radius);
    blob.position.set(
      canopyRng.range(-0.7, 0.7),
      HAZARD_CLEARANCE + canopyRng.range(0.7, 2),
      canopyRng.range(-SPAN - 2, -1.5),
    );
    group.add(blob);
  }

  // Glowing berries dangling at head height: the gate's warning lamps, dressed
  // as fruit, so both hazards speak the same language.
  const lamps: Mesh[] = [];
  const materials: MeshBasicMaterial[] = [];
  const berryGeometry = new SphereGeometry(0.19, 12, 9);
  track(berryGeometry);
  for (let i = 0; i < 7; i += 1) {
    const material = new MeshBasicMaterial({ color: PALETTE.signBoard, toneMapped: false });
    materials.push(material);
    track(material);
    const berry = decal(new Mesh(berryGeometry, material));
    berry.position.set(0, HAZARD_CLEARANCE - 0.3, -SPAN + 0.6 + i * 2.1);
    group.add(berry);
    lamps.push(berry);
  }

  return { group, handle: { hazard, setAlert: makeAlert(lamps, materials) } };
}

/** A striped arch over the whole track, with a hanging banner. */
function buildArch(x: number, accent: number, kind: 'start' | 'finish', track: Track): Group {
  const group = new Group();
  group.position.set(x, railHeight(x), 0);

  const accentMaterial = toonMaterial(accent);
  const creamMaterial = toonMaterial(PALETTE.buildingWall);
  track(accentMaterial);
  track(creamMaterial);

  const legHeight = 8.5;
  const legGeometry = new CylinderGeometry(0.3, 0.38, legHeight, 10);
  track(legGeometry);
  const ringGeometry = new TorusGeometry(0.36, 0.11, 6, 14);
  track(ringGeometry);

  for (const side of [-1, 1] as const) {
    const leg = solid(new Mesh(legGeometry, creamMaterial));
    leg.position.set(0, legHeight / 2 - 2.4, side * (SPAN + 1.2));
    group.add(leg);
    addOutline(leg, 0.024);

    // Barber rings, exactly as on the stall's posts, so the mini-game plainly
    // belongs to the same fairground.
    for (let i = 0; i < 6; i += 1) {
      const ring = decal(new Mesh(ringGeometry, accentMaterial));
      ring.rotation.y = Math.PI / 2;
      ring.position.set(0, -2 + i * 1.3, side * (SPAN + 1.2));
      group.add(ring);
    }
  }

  const beamGeometry = new BoxGeometry(0.7, 0.7, SPAN * 2 + 3.4);
  track(beamGeometry);
  const beam = solid(new Mesh(beamGeometry, accentMaterial));
  beam.position.set(0, 5.9, 0);
  group.add(beam);
  addOutline(beam, 0.024);

  // Chequered flags for the finish, plain bunting for the start.
  const flagGeometry = new BoxGeometry(0.1, 0.85, 0.85);
  track(flagGeometry);
  const dark = toonMaterial(kind === 'finish' ? PALETTE.ink : PALETTE.markerLemon);
  track(dark);
  const flags = 17;
  for (let i = 0; i < flags; i += 1) {
    const flag = decal(new Mesh(flagGeometry, i % 2 === 0 ? creamMaterial : dark));
    flag.position.set(0, 5.1, -SPAN - 1 + (i * (SPAN * 2 + 2)) / (flags - 1));
    group.add(flag);
  }

  return group;
}
