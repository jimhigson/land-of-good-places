import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { ART } from '../../art/style/artPalette';
import { PALETTE } from '../../core/palette';
import { createFacePatch, type FacePatch } from '../../art/style/faces';
import { toonMaterial } from '../../art/style/materials';
import { RAIL_HEIGHT } from './track';
import { CAR_FLOOR_Y, LOCO_BODY_TOP_Y, SEAT_Y } from './trainDimensions';

/**
 * Puffing Percy and her three open carriages.
 *
 * Built to the asset contract in ARCHITECTURE.md: a `Group` with its origin on
 * the ground — the top of the *sleepers*, not the rail head — facing +Z, in
 * metres. `ParkTrain` sets `rotation.y` from the route tangent, so +Z has to be
 * the way she is going.
 *
 * She is a friendly little engine with a painted face, and she is nobody in
 * particular: round face, big eyes low on a domed smokebox, a lamp for a nose.
 * The proportions come from ART_DIRECTION.md's rules for a toy — chunky
 * cylinders, no small parts, everything either the palette's colours or a tint
 * of them.
 */

// The vertical dimensions live in their own leaf module — see
// `trainDimensions.ts` for why (issue #226: three floats that callers should be
// able to read without loading this file's whole module graph). Re-exported so
// every existing importer of `trainModel.ts` keeps working unchanged.
export { CAR_FLOOR_Y, LOCO_BODY_TOP_Y, SEAT_Y } from './trainDimensions';

/** Half the track gauge — where the wheels sit either side of the centre line. */
const WHEEL_OFFSET = 0.55;

export const LOCO_LENGTH = 3.8;
export const CARRIAGE_LENGTH = 2.6;

/** Gap between one car's end and the next one's. */
export const CAR_GAP = 0.42;

const BODY_HALF_WIDTH = 0.8;

/** Bright and different enough that a child can say which one they want. */
export const CARRIAGE_COLOURS = [
  PALETTE.markerLemon,
  PALETTE.markerMint,
  PALETTE.markerLilac,
] as const;

export interface TrainCar {
  readonly root: Group;
  /** Spun by `ParkTrain` from distance travelled, so they never skate. */
  readonly wheels: Object3D[];
  /** Feet positions for riders, in car-local space. */
  readonly seats: Vector3[];
  /**
   * Lamp and lantern materials, brightened after dark.
   *
   * The materials rather than the meshes: `Mesh.material` may be an array, and
   * a caller that only ever wants to change a colour should not have to prove
   * to the type system that this one is not.
   */
  readonly lamps: MeshBasicMaterial[];
}

export interface Locomotive extends TrainCar {
  /** Local position of the top of the funnel — where the chuffs come out. */
  readonly funnelTip: Vector3;
  readonly face: FacePatch;
}

// ---------------------------------------------------------------- locomotive

export function createLocomotive(): Locomotive {
  const root = new Group();
  root.name = 'train-locomotive';

  const bodyMaterial = toonMaterial(ART.jumperRed);
  const trimMaterial = toonMaterial(ART.helmetGold);
  const darkMaterial = toonMaterial(PALETTE.ink);
  const creamMaterial = toonMaterial(ART.cream);

  const wheels: Object3D[] = [];
  const lamps: MeshBasicMaterial[] = [];

  // --- chassis -------------------------------------------------------------
  const chassis = solidMesh(
    new BoxGeometry(BODY_HALF_WIDTH * 2, 0.22, LOCO_LENGTH - 0.2),
    darkMaterial,
  );
  chassis.position.y = CAR_FLOOR_Y - 0.11;
  root.add(chassis);

  // --- boiler --------------------------------------------------------------
  const boiler = solidMesh(new CylinderGeometry(0.55, 0.55, 2.2, 18), bodyMaterial, true);
  boiler.rotation.x = Math.PI / 2;
  boiler.position.set(0, CAR_FLOOR_Y + 0.55, 0.55);
  root.add(boiler);

  // Bands round the boiler, because a plain tube reads as a pipe.
  for (const z of [0, 1.1] as const) {
    const band = solidMesh(new TorusGeometry(0.56, 0.05, 8, 20), trimMaterial);
    band.rotation.y = Math.PI / 2;
    band.rotation.x = Math.PI / 2;
    band.position.set(0, CAR_FLOOR_Y + 0.55, z);
    root.add(band);
  }

  // --- smokebox: the face goes on this ------------------------------------
  const faceRadius = 0.56;
  const smokebox = solidMesh(new SphereGeometry(faceRadius, 20, 14), bodyMaterial, true);
  smokebox.position.set(0, CAR_FLOOR_Y + 0.55, 1.62);
  smokebox.scale.z = 0.86;
  root.add(smokebox);

  const face = createFacePatch({
    radius: faceRadius,
    size: 256,
    // Eyes low and wide, mouth close under them: the whole "friendly engine"
    // read is in those two numbers (ART_DIRECTION.md §3).
    eyeY: 0.44,
    eyeGap: 0.42,
    eyeW: 0.085,
    eyeH: 0.115,
    mouth: 'smile',
    mouthW: 0.13,
    mouthDrop: 0.2,
    blush: ART.blush,
    blushStyle: 'soft',
    blushR: 0.1,
  });
  face.mesh.scale.z = 0.86;
  smokebox.add(face.mesh);

  // --- funnel --------------------------------------------------------------
  const funnel = solidMesh(new CylinderGeometry(0.2, 0.16, 0.62, 14), darkMaterial, true);
  funnel.position.set(0, CAR_FLOOR_Y + 1.4, 1.25);
  root.add(funnel);

  const funnelRim = solidMesh(new CylinderGeometry(0.27, 0.21, 0.16, 14), trimMaterial);
  funnelRim.position.set(0, CAR_FLOOR_Y + 1.72, 1.25);
  root.add(funnelRim);

  const funnelTip = new Vector3(0, LOCO_BODY_TOP_Y, 1.25);

  // --- dome and whistle ----------------------------------------------------
  const dome = solidMesh(new SphereGeometry(0.22, 14, 10), trimMaterial);
  dome.position.set(0, CAR_FLOOR_Y + 1.05, 0.35);
  dome.scale.y = 0.8;
  root.add(dome);

  const whistle = solidMesh(new CylinderGeometry(0.06, 0.07, 0.26, 8), trimMaterial);
  whistle.position.set(0, CAR_FLOOR_Y + 1.22, -0.05);
  root.add(whistle);

  // --- cab -----------------------------------------------------------------
  const cab = solidMesh(new BoxGeometry(BODY_HALF_WIDTH * 2, 1.15, 1.25), creamMaterial, true);
  cab.position.set(0, CAR_FLOOR_Y + 0.58, -1.05);
  root.add(cab);

  const cabRoof = solidMesh(new BoxGeometry(BODY_HALF_WIDTH * 2 + 0.24, 0.14, 1.5), bodyMaterial, true);
  cabRoof.position.set(0, CAR_FLOOR_Y + 1.2, -1.05);
  root.add(cabRoof);

  // A bobble on top, because everything in this park has a bobble on top.
  const bobble = solidMesh(new SphereGeometry(0.14, 12, 9), trimMaterial);
  bobble.position.set(0, CAR_FLOOR_Y + 1.32, -1.05);
  root.add(bobble);

  // --- buffer beam and lamp ------------------------------------------------
  const beam = solidMesh(new BoxGeometry(BODY_HALF_WIDTH * 2 + 0.2, 0.24, 0.18), trimMaterial);
  beam.position.set(0, CAR_FLOOR_Y - 0.02, LOCO_LENGTH / 2 - 0.05);
  root.add(beam);

  // Unlit, like the fairy-light bulbs: a lit material turns a lamp into a grey
  // pebble in daylight and a black one after dark.
  const lampMaterial = new MeshBasicMaterial({ color: ART.cream, fog: true });
  const lamp = new Mesh(new SphereGeometry(0.15, 12, 9), lampMaterial);
  lamp.position.set(0, CAR_FLOOR_Y + 0.35, LOCO_LENGTH / 2 - 0.02);
  root.add(lamp);
  lamps.push(lampMaterial);

  addWheels(root, wheels, darkMaterial, trimMaterial, [-1.2, -0.35, 0.9], 0.26, true);

  return { root, wheels, seats: [], lamps, funnelTip, face };
}

// ----------------------------------------------------------------- carriage

export function createCarriage(colour: number, index: number): TrainCar {
  const root = new Group();
  root.name = `train-carriage-${index}`;

  const bodyMaterial = toonMaterial(colour);
  const trimMaterial = toonMaterial(ART.cream);
  const darkMaterial = toonMaterial(PALETTE.ink);
  const benchMaterial = toonMaterial(PALETTE.wood);

  const wheels: Object3D[] = [];
  const lamps: MeshBasicMaterial[] = [];
  const seats: Vector3[] = [];

  const floor = solidMesh(
    new BoxGeometry(BODY_HALF_WIDTH * 2, 0.16, CARRIAGE_LENGTH - 0.1),
    darkMaterial,
  );
  floor.position.y = CAR_FLOOR_Y - 0.08;
  root.add(floor);

  // Open-topped sides, low enough to see the passengers over.
  const sideHeight = 0.44;
  for (const side of [-1, 1] as const) {
    const wall = solidMesh(
      new BoxGeometry(0.12, sideHeight, CARRIAGE_LENGTH - 0.1),
      bodyMaterial,
      true,
    );
    wall.position.set(side * (BODY_HALF_WIDTH - 0.06), CAR_FLOOR_Y + sideHeight / 2, 0);
    root.add(wall);
  }
  for (const end of [-1, 1] as const) {
    const wall = solidMesh(
      new BoxGeometry(BODY_HALF_WIDTH * 2, sideHeight, 0.12),
      bodyMaterial,
    );
    wall.position.set(0, CAR_FLOOR_Y + sideHeight / 2, end * (CARRIAGE_LENGTH / 2 - 0.06));
    root.add(wall);
  }

  // A cream rubbing strip along the top of each side.
  for (const side of [-1, 1] as const) {
    const strip = solidMesh(
      new BoxGeometry(0.16, 0.08, CARRIAGE_LENGTH - 0.06),
      trimMaterial,
    );
    strip.position.set(side * (BODY_HALF_WIDTH - 0.06), CAR_FLOOR_Y + sideHeight, 0);
    root.add(strip);
  }

  // --- two bench seats, back to back ---------------------------------------
  for (const facing of [-1, 1] as const) {
    const bench = solidMesh(
      new BoxGeometry(BODY_HALF_WIDTH * 2 - 0.18, 0.14, 0.5),
      benchMaterial,
    );
    bench.position.set(0, SEAT_Y - 0.07, facing * 0.52);
    root.add(bench);

    const backRest = solidMesh(
      new BoxGeometry(BODY_HALF_WIDTH * 2 - 0.18, 0.34, 0.1),
      benchMaterial,
    );
    backRest.position.set(0, SEAT_Y + 0.17, facing * 0.78);
    root.add(backRest);

    seats.push(new Vector3(0, SEAT_Y, facing * 0.5));
  }

  // A little lantern on the back corner post.
  const lanternPost = solidMesh(new CylinderGeometry(0.04, 0.04, 0.4, 6), darkMaterial);
  lanternPost.position.set(
    BODY_HALF_WIDTH - 0.1,
    CAR_FLOOR_Y + sideHeight + 0.2,
    -(CARRIAGE_LENGTH / 2 - 0.14),
  );
  root.add(lanternPost);

  const lanternMaterial = new MeshBasicMaterial({ color: PALETTE.fairyWarm, fog: true });
  const lantern = new Mesh(new SphereGeometry(0.1, 10, 8), lanternMaterial);
  lantern.position.set(
    BODY_HALF_WIDTH - 0.1,
    CAR_FLOOR_Y + sideHeight + 0.44,
    -(CARRIAGE_LENGTH / 2 - 0.14),
  );
  root.add(lantern);
  lamps.push(lanternMaterial);

  // No hub caps on the carriages: eight more little cylinders nobody looks at.
  addWheels(root, wheels, darkMaterial, trimMaterial, [-0.78, 0.78], 0.2, false);

  return { root, wheels, seats, lamps };
}

// ------------------------------------------------------------------ helpers

/**
 * A pair of wheels at each of `positions` along the car, with a bright hub cap
 * so the spin is visible from the isometric camera.
 */
function addWheels(
  root: Group,
  wheels: Object3D[],
  tyreMaterial: Material,
  hubMaterial: Material,
  positions: readonly number[],
  radius: number,
  hubs: boolean,
): void {
  const tyreGeometry = new CylinderGeometry(radius, radius, 0.12, 14);
  const hubGeometry = new CylinderGeometry(radius * 0.42, radius * 0.42, 0.14, 10);

  for (const z of positions) {
    for (const side of [-1, 1] as const) {
      const axle = new Group();
      axle.position.set(side * WHEEL_OFFSET, RAIL_HEIGHT + radius, z);
      // Wheels roll about the car's X axis; the cylinder's axis is Y, so it is
      // laid on its side once here and spun on X for the rest of its life.
      const tyre = solidMesh(tyreGeometry, tyreMaterial);
      tyre.rotation.z = Math.PI / 2;
      axle.add(tyre);

      if (hubs) {
        const hub = solidMesh(hubGeometry, hubMaterial);
        hub.rotation.z = Math.PI / 2;
        hub.position.x = side * 0.02;
        axle.add(hub);
      }

      root.add(axle);
      wheels.push(axle);
    }
  }
}

/**
 * A part of the train.
 *
 * `casts` defaults to **false**, and that is the important half of this
 * function. Shadow casting is opt-out, not free: `renderer.info.render.calls`
 * counts the shadow pass, so every caster is drawn twice, and a train made of
 * eighty little cylinders that all cast costs a hundred and sixty draw calls to
 * put one train-shaped shadow on the grass. Only the shapes doing the
 * silhouette's work — the boiler, the cab, the carriage sides — say yes.
 */
function solidMesh(geometry: BufferGeometry, material: Material, casts = false): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.castShadow = casts;
  mesh.receiveShadow = true;
  return mesh;
}
