import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { PALETTE } from '../../core/palette';
import { softMaterial } from './parts';
import {
  CASTLE_MERLON_HEIGHT,
  TOWER_BASE_FLARE,
  TOWER_RADIUS,
  TOWER_ROOF_HEIGHT,
  TOWER_ROOF_OVERHANG,
} from './layout';

export { CASTLE_TURRET_FOOTPRINT_RADIUS } from './layout';

/**
 * **The castle's masonry kit — the one owner of what a battlement and a corner
 * turret are made of** (issue #462).
 *
 * Jim, having walked the roof garden after #457/#461: *"It needs the rooftop's
 * near side to look like the external of the castle … turrets in the corner,
 * ramparts, walls reaching down, same colour as the castle viewed from the
 * outside. **Re-use code and/or models as much as possible.**"*
 *
 * ## Why a module rather than a second set of numbers
 *
 * The castle exists twice. `Shell.ts`'s `buildCastle` puts a curtain wall,
 * four corner towers and a battlement in the garden; the roof garden is the
 * *top of that same castle* seen from on it, and since #377/#380 the two are
 * **disjoint spaces 300 m apart** (`floors.ts`), so nothing about them can be
 * shared as a position. What can be shared — and what this file is — is the
 * masonry itself: a merlon's dimensions, a turret's radius, taper, cone and
 * pennant, and the two palette colours the facade wears.
 *
 * A second merlon 0.9 m wide on the roof, or a turret in a slightly different
 * cream, is precisely the defect this repo names most often (CLAUDE.md, *"Two
 * definitions of one thing, kept in step by hand"*). There is one definition
 * here and both callers ask it.
 *
 * ## Names are load-bearing, so callers pass their own
 *
 * `test/procgen/parkFacts.ts` finds the castle's **exterior** stonework by
 * matching mesh names — `/^(castle-wall-|crenellations$)/` for the masonry top
 * the ginormous slide has to clear, and `/^tower-(bodies|roofs)$/` for the
 * towers it has to miss. An interior mesh that falls into either pattern
 * silently redirects a safety invariant; that has happened once already
 * (`castleFabric.ts`'s note on `castle-timber-`) and `check:castle` now has a
 * clause about it.
 *
 * So every builder here takes the name it is to publish. The facade passes the
 * names those patterns expect; the roof garden passes `roof-battlement-*` and
 * `roof-turret-*`, which fall into neither.
 */

/**
 * A merlon: the tooth of a battlement. Chunky and low, so the gap beside it —
 * the crenel — is a real hole a six-year-old can see sky through rather than a
 * groove.
 */
export const CASTLE_MERLON_WIDTH = 0.85;
export const CASTLE_MERLON_DEPTH = 0.5;
/** Centre-to-centre along the wall. Roughly two merlons per crenel. */
export const CASTLE_MERLON_PITCH = 1.7;

/** The two colours the castle wears from the park. Wall cream, trim on top. */
export const CASTLE_STONE = PALETTE.buildingWall;
export const CASTLE_TRIM_STONE = PALETTE.buildingTrim;
/** The witch's-hat cone on a corner turret. */
export const CASTLE_TURRET_ROOF = PALETTE.buildingRoofDeep;

/**
 * Evenly spaced positions along one half-extent, kept clear of the corners.
 *
 * Moved here from `Shell.ts` unchanged, because the battlement is now laid out
 * on two different plates and the *rule* for where a run of merlons stops is
 * part of the kit. The 1.6 m it holds back at each end is what keeps the run
 * from crashing into a corner turret — 2.05 m of radius standing on the corner
 * — and it was always doing that job for the facade.
 */
export function spread(halfExtent: number, spacing: number): number[] {
  const usable = halfExtent - 1.6;
  const count = Math.max(1, Math.floor((usable * 2) / spacing) + 1);
  const step = count > 1 ? (usable * 2) / (count - 1) : 0;
  const values: number[] = [];
  for (let i = 0; i < count; i += 1) values.push(-usable + step * i);
  return values;
}

/** Where one merlon stands, in its plate's own local metres. */
export interface MerlonSlot {
  readonly x: number;
  readonly z: number;
  /** 0 for a run along X, `π/2` for a run along Z. */
  readonly yaw: number;
}

/**
 * A merlon at every slot, right round a wall — one draw call however many.
 *
 * `baseY` is the surface they stand on: the top of the curtain wall out in the
 * garden, the top of the parapet kerb on the roof garden. The caller owns that
 * height because the two plates are different spaces; the merlon itself is the
 * same stone in both.
 */
export function buildMerlons(
  name: string,
  slots: readonly MerlonSlot[],
  baseY: number,
): InstancedMesh {
  const merlons = new InstancedMesh(
    new BoxGeometry(CASTLE_MERLON_WIDTH, CASTLE_MERLON_HEIGHT, CASTLE_MERLON_DEPTH),
    softMaterial(CASTLE_TRIM_STONE, 0.72),
    Math.max(1, slots.length),
  );
  merlons.name = name;
  merlons.castShadow = true;
  merlons.receiveShadow = true;
  merlons.count = slots.length;

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const axis = new Vector3(0, 1, 0);
  const scale = new Vector3(1, 1, 1);
  const position = new Vector3();

  slots.forEach((slot, index) => {
    rotation.setFromAxisAngle(axis, slot.yaw);
    position.set(slot.x, baseY + CASTLE_MERLON_HEIGHT / 2, slot.z);
    matrix.compose(position, rotation, scale);
    merlons.setMatrixAt(index, matrix);
  });
  merlons.instanceMatrix.needsUpdate = true;
  return merlons;
}

/**
 * A run of merlons along all four edges of a rectangle, the way both castles
 * want them.
 *
 * One function so the facade's battlement and the roof garden's cannot end up
 * at different pitches or held back from the corners by different amounts.
 *
 * **Two rectangles, not one, and that is deliberate.** `edgeX`/`edgeZ` say
 * where the merlons *stand* — the outer face of the wall — while
 * `runHalfX`/`runHalfZ` say how far along each face the run reaches, which is
 * the wall's own centre line rather than its outer corner. On the facade those
 * differ by half a wall thickness, and collapsing them to one pair moves every
 * merlon by 0.225 m. That was the first cut of this function, and the facade is
 * unchanged only because they are separate.
 */
export function rectangleMerlonSlots(
  edgeX: number,
  edgeZ: number,
  runHalfX: number,
  runHalfZ: number,
): MerlonSlot[] {
  const slots: MerlonSlot[] = [];
  for (const x of spread(runHalfX - 0.9, CASTLE_MERLON_PITCH)) {
    slots.push({ x, z: -edgeZ, yaw: 0 });
    slots.push({ x, z: edgeZ, yaw: 0 });
  }
  for (const z of spread(runHalfZ - 0.9, CASTLE_MERLON_PITCH)) {
    slots.push({ x: -edgeX, z, yaw: Math.PI / 2 });
    slots.push({ x: edgeX, z, yaw: Math.PI / 2 });
  }
  return slots;
}

/** Where one turret stands. */
export interface TurretSpot {
  readonly x: number;
  readonly z: number;
}

export interface TurretOptions {
  /**
   * Prefix for the four instanced meshes: `<prefix>-bodies`, `-roofs`,
   * `-masts`, `-finials`. See this file's header — `tower` is reserved for the
   * facade, because `parkFacts.ts` measures the slide's clearance against
   * `tower-bodies` and `tower-roofs` by name.
   */
  readonly prefix: string;
  readonly spots: readonly TurretSpot[];
  /** Where the turret's shaft begins. Its body rises from here. */
  readonly baseY: number;
  /**
   * How far the shaft rises above {@link baseY} before the cone starts —
   * i.e. where the eaves are.
   */
  readonly bodyHeight: number;
  /**
   * How far the shaft is carried **below** {@link baseY}. The facade's towers
   * stand on the ground and take 0; the roof garden's carry on down the
   * outside of the castle, so its wall has something at the corners rather
   * than being a flat cliff.
   */
  readonly bodyBelow?: number;
}

/**
 * Four (or however many) corner turrets: a flared cylinder, a conical roof, a
 * little mast, a finial and a pennant.
 *
 * Four instanced meshes plus one small pennant mesh per turret — the same cost
 * the facade always paid, now paid once for a shape two places use.
 */
export function buildCastleTurrets(options: TurretOptions): Group {
  const { prefix, spots, baseY, bodyHeight } = options;
  const bodyBelow = options.bodyBelow ?? 0;
  const group = new Group();
  group.name = `${prefix}s`;

  const flagColours = [
    PALETTE.markerPink,
    PALETTE.markerSky,
    PALETTE.markerLemon,
    PALETTE.markerLilac,
  ];

  // The shaft runs from `baseY - bodyBelow` up to `baseY + bodyHeight`, and its
  // taper is the facade's: a little wider at the foot, which is what stops a
  // plain cylinder reading as a drainpipe.
  const shaft = bodyHeight + bodyBelow;
  const bodies = new InstancedMesh(
    new CylinderGeometry(TOWER_RADIUS, TOWER_RADIUS * TOWER_BASE_FLARE, shaft, 16),
    softMaterial(CASTLE_STONE, 0.78),
    Math.max(1, spots.length),
  );
  bodies.name = `${prefix}-bodies`;
  bodies.castShadow = true;
  bodies.receiveShadow = true;
  bodies.count = spots.length;

  // A true cone (16 segments), unlike the roof pavilion's four-sided pyramid —
  // this one is meant to read as a proper witch's-hat tower roof up close.
  const roofs = new InstancedMesh(
    new ConeGeometry(TOWER_RADIUS + TOWER_ROOF_OVERHANG, TOWER_ROOF_HEIGHT, 16),
    softMaterial(CASTLE_TURRET_ROOF, 0.72),
    Math.max(1, spots.length),
  );
  roofs.name = `${prefix}-roofs`;
  roofs.castShadow = true;
  roofs.receiveShadow = true;
  roofs.count = spots.length;

  const masts = new InstancedMesh(
    new CylinderGeometry(0.07, 0.09, 1.6, 8),
    softMaterial(PALETTE.woodLight, 0.85),
    Math.max(1, spots.length),
  );
  masts.name = `${prefix}-masts`;
  masts.castShadow = false;
  masts.receiveShadow = false;
  masts.count = spots.length;

  const finials = new InstancedMesh(
    new SphereGeometry(0.26, 14, 10),
    softMaterial(PALETTE.markerLemon, 0.55),
    Math.max(1, spots.length),
  );
  finials.name = `${prefix}-finials`;
  finials.castShadow = false;
  finials.receiveShadow = false;
  finials.count = spots.length;

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  const position = new Vector3();
  const eaves = baseY + bodyHeight;
  const roofTopY = eaves + TOWER_ROOF_HEIGHT;

  spots.forEach((spot, index) => {
    position.set(spot.x, eaves - shaft / 2, spot.z);
    matrix.compose(position, rotation, scale);
    bodies.setMatrixAt(index, matrix);

    position.set(spot.x, eaves + TOWER_ROOF_HEIGHT / 2, spot.z);
    matrix.compose(position, rotation, scale);
    roofs.setMatrixAt(index, matrix);

    position.set(spot.x, roofTopY + 0.8, spot.z);
    matrix.compose(position, rotation, scale);
    masts.setMatrixAt(index, matrix);

    position.set(spot.x, roofTopY + 1.65, spot.z);
    matrix.compose(position, rotation, scale);
    finials.setMatrixAt(index, matrix);

    const flag = buildPennant(flagColours[index % flagColours.length] ?? PALETTE.markerPink);
    flag.position.set(spot.x, roofTopY + 1.15, spot.z);
    group.add(flag);
  });

  for (const mesh of [bodies, roofs, masts, finials]) {
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }

  return group;
}

/** A little three-cornered pennant, big enough to read from across the garden. */
function pennantGeometry(width: number, height: number): BufferGeometry {
  const geometry = new BufferGeometry();
  const positions = new Float32Array([0, 0, 0, 0, height, 0, width, height * 0.5, 0]);
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex([0, 1, 2]);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * One flag flying from a mast. Double-sided: a flag has no "back" worth hiding.
 * Moved here with the turret it belongs to.
 */
function buildPennant(colour: number): Mesh {
  const material = softMaterial(colour, 0.6);
  material.side = DoubleSide;
  const mesh = new Mesh(pennantGeometry(0.85, 0.55), material);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.position.y -= 0.3;
  return mesh;
}
