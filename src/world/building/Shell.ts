import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Shape,
  SphereGeometry,
  Vector3,
} from 'three';
import {
  BUILDING_FLOOR_COUNT,
  BUILDING_FLOOR_HEIGHT,
  BUILDING_HALF_X,
  BUILDING_HALF_Z,
  BUILDING_PARAPET,
  BUILDING_SLAB,
  BUILDING_WALL_THICKNESS,
} from '../../core/constants';
import { PALETTE } from '../../core/palette';
import {
  castAndReceive,
  cuteSign,
  extrudePlan,
  glassMaterial,
  interiorMaterial,
  planHole,
  planRect,
  segmentsMinusGaps,
  softMaterial,
} from './parts';
import {
  DECK_HOLES,
  ENTRANCE_MAX_X,
  ENTRANCE_MIN_X,
  ENTRANCE_RAMP,
  LIFT_DOOR_MAX_Z,
  LIFT_DOOR_MIN_Z,
  SLIDE_DOOR_MAX_X,
  SLIDE_DOOR_MIN_X,
  TOP_DECK,
} from './layout';

/** Decoration that takes light but is not worth a slot in the shadow pass. */
function receiveOnly(mesh: Mesh): Mesh {
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

const HALF_WALL = BUILDING_WALL_THICKNESS / 2;
const OUTER_X = BUILDING_HALF_X + HALF_WALL;
const OUTER_Z = BUILDING_HALF_Z + HALF_WALL;
/** Header band under each deck, so the glass stops short of the ceiling. */
const GLASS_TOP = BUILDING_FLOOR_HEIGHT - 0.34;

/**
 * The tower itself: five decks, their walls, the roof and the front door.
 *
 * Each deck is one extruded slab with its stair, escalator, bubble, trampoline
 * and helter-skelter shafts punched straight through it, so however many holes a
 * floor has it still costs a single draw call. Walls work the same way: a run of
 * plan rectangles with the doorways left out as gaps, all extruded together.
 *
 * Every floor lives in its own `Group` (see {@link floorGroups}) because the
 * cutaway camera fades them one at a time. Other builders drop their content
 * into the right group rather than into the scene.
 */
export class BuildingShell {
  readonly group = new Group();
  /** One per deck, plus a final group for the roof. */
  readonly floorGroups: Group[] = [];
  readonly roofGroup = new Group();

  constructor() {
    this.group.name = 'building-shell';

    for (let deck = 0; deck < BUILDING_FLOOR_COUNT; deck += 1) {
      const floor = new Group();
      floor.name = `building-floor-${deck}`;
      floor.position.y = deck * BUILDING_FLOOR_HEIGHT;
      this.floorGroups.push(floor);
      this.group.add(floor);

      floor.add(buildDeck(deck));
      floor.add(buildWalls(deck, BUILDING_PARAPET, 0, wallColour(deck)));
      floor.add(buildGlass(deck));
      floor.add(buildTrimBand(deck));
      floor.add(buildCornerPillars());
      for (const mesh of buildWindows(deck)) floor.add(mesh);
    }

    this.roofGroup.name = 'building-roof';
    this.roofGroup.position.y = BUILDING_FLOOR_COUNT * BUILDING_FLOOR_HEIGHT;
    buildRoof(this.roofGroup);
    this.group.add(this.roofGroup);

    // Ground-level dressing: the plinth, the steps and the welcoming canopy.
    const ground = this.floorGroups[0];
    if (ground) {
      ground.add(buildPlinth());
      ground.add(buildEntranceSteps());
      buildEntranceCanopy(ground);
    }
  }
}

// ------------------------------------------------------------------- decks

function buildDeck(deck: number): Mesh {
  const slab = planRect(-OUTER_X, OUTER_X, -OUTER_Z, OUTER_Z);
  for (const hole of DECK_HOLES) {
    if (hole.decks.includes(deck)) slab.holes.push(planHole(hole.region));
  }

  const mesh = new Mesh(
    extrudePlan([slab], BUILDING_SLAB),
    interiorMaterial(deck % 2 === 0 ? PALETTE.buildingFloor : PALETTE.buildingFloorAlt, 0.82),
  );
  mesh.receiveShadow = true;
  // Only the ground slab casts: the ones above it are hidden by the cutaway
  // whenever you could possibly see their shadow.
  mesh.castShadow = deck === 0;
  mesh.name = `deck-${deck}`;
  // The slab hangs below the walking surface, which sits at the group origin.
  mesh.position.y = -BUILDING_SLAB;
  return mesh;
}

// ------------------------------------------------------------------- walls

/** Plan rectangles for one storey's walls, doorways left out. */
function wallShapes(deck: number): Shape[] {
  const shapes: Shape[] = [];

  // North face: never interrupted.
  shapes.push(planRect(-OUTER_X, OUTER_X, -OUTER_Z, -BUILDING_HALF_Z + HALF_WALL));

  // South face: the front door downstairs, the ginormous slide's mouth upstairs.
  const southGaps: [number, number][] = [];
  if (deck === 0) southGaps.push([ENTRANCE_MIN_X, ENTRANCE_MAX_X]);
  if (deck === TOP_DECK) southGaps.push([SLIDE_DOOR_MIN_X, SLIDE_DOOR_MAX_X]);
  for (const [start, end] of segmentsMinusGaps(-OUTER_X, OUTER_X, southGaps)) {
    shapes.push(planRect(start, end, BUILDING_HALF_Z - HALF_WALL, OUTER_Z));
  }

  // East face: the way into the glass lift, on every deck.
  for (const [start, end] of segmentsMinusGaps(-BUILDING_HALF_Z + HALF_WALL, BUILDING_HALF_Z - HALF_WALL, [
    [LIFT_DOOR_MIN_Z, LIFT_DOOR_MAX_Z],
  ])) {
    shapes.push(planRect(BUILDING_HALF_X - HALF_WALL, OUTER_X, start, end));
  }

  // West face.
  shapes.push(
    planRect(
      -OUTER_X,
      -BUILDING_HALF_X + HALF_WALL,
      -BUILDING_HALF_Z + HALF_WALL,
      BUILDING_HALF_Z - HALF_WALL,
    ),
  );

  return shapes;
}

function wallColour(deck: number): number {
  return deck % 2 === 0 ? PALETTE.buildingWall : PALETTE.buildingWallDark;
}

function buildWalls(deck: number, height: number, baseY: number, colour: number): Mesh {
  const mesh = castAndReceive(
    new Mesh(extrudePlan(wallShapes(deck), height), softMaterial(colour, 0.78)),
  );
  mesh.name = `walls-${deck}`;
  mesh.position.y = baseY;
  return mesh;
}

function buildGlass(deck: number): Mesh {
  const mesh = new Mesh(
    extrudePlan(wallShapes(deck), GLASS_TOP - BUILDING_PARAPET),
    glassMaterial(0.22),
  );
  mesh.name = `glass-${deck}`;
  mesh.position.y = BUILDING_PARAPET;
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  return mesh;
}

function buildTrimBand(deck: number): Mesh {
  const mesh = new Mesh(
    extrudePlan(wallShapes(deck), BUILDING_FLOOR_HEIGHT - GLASS_TOP),
    softMaterial(deck % 2 === 0 ? PALETTE.buildingTrim : PALETTE.buildingTrimDeep, 0.7),
  );
  mesh.receiveShadow = true;
  mesh.name = `trim-${deck}`;
  mesh.position.y = GLASS_TOP;
  return mesh;
}

interface WindowSlot {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  /** Along-the-wall coordinate, used to keep windows out of doorways. */
  readonly along: number;
}

const WINDOW_WIDTH = 1.8;
const WINDOW_HEIGHT = 1.15;
const WINDOW_Y = 0.95;

/**
 * Chunky windows punched into the painted wall.
 *
 * Two instanced meshes a floor — frames and panes — which is what turns a flat
 * pastel slab into something that reads as a building people are inside. They
 * step round the doorways rather than being punched through the wall geometry:
 * far cheaper, and at this camera distance nobody can tell.
 */
function buildWindows(deck: number): InstancedMesh[] {
  const slots: WindowSlot[] = [];
  const outward = 0.09;

  const southGaps: [number, number][] = [];
  if (deck === 0) southGaps.push([ENTRANCE_MIN_X, ENTRANCE_MAX_X]);
  if (deck === TOP_DECK) southGaps.push([SLIDE_DOOR_MIN_X, SLIDE_DOOR_MAX_X]);

  for (const x of spread(BUILDING_HALF_X, 3.4)) {
    slots.push({ x, z: -OUTER_Z - outward, yaw: 0, along: x });
    if (!blocked(x, southGaps)) slots.push({ x, z: OUTER_Z + outward, yaw: Math.PI, along: x });
  }
  for (const z of spread(BUILDING_HALF_Z, 3.2)) {
    slots.push({ x: -OUTER_X - outward, z, yaw: Math.PI / 2, along: z });
    if (!blocked(z, [[LIFT_DOOR_MIN_Z, LIFT_DOOR_MAX_Z]])) {
      slots.push({ x: OUTER_X + outward, z, yaw: -Math.PI / 2, along: z });
    }
  }

  const warm = deck % 2 === 0;
  const frames = new InstancedMesh(
    new BoxGeometry(WINDOW_WIDTH + 0.3, WINDOW_HEIGHT + 0.3, 0.16),
    softMaterial(warm ? PALETTE.buildingTrim : PALETTE.buildingTrimDeep, 0.72),
    slots.length,
  );
  const panes = new InstancedMesh(
    new BoxGeometry(WINDOW_WIDTH, WINDOW_HEIGHT, 0.18),
    softMaterial(warm ? PALETTE.buildingWindow : PALETTE.buildingWindowWarm, 0.35),
    slots.length,
  );
  frames.name = `window-frames-${deck}`;
  panes.name = `window-panes-${deck}`;
  // Applied decoration a few centimetres proud of a wall that already casts:
  // making these shadow casters doubles their draw calls and changes nothing.
  for (const mesh of [frames, panes]) {
    mesh.castShadow = false;
    mesh.receiveShadow = true;
  }

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const axis = new Vector3(0, 1, 0);
  const scale = new Vector3(1, 1, 1);
  const position = new Vector3();

  slots.forEach((slot, index) => {
    rotation.setFromAxisAngle(axis, slot.yaw);
    position.set(slot.x, WINDOW_Y, slot.z);
    matrix.compose(position, rotation, scale);
    frames.setMatrixAt(index, matrix);
    panes.setMatrixAt(index, matrix);
  });
  frames.instanceMatrix.needsUpdate = true;
  panes.instanceMatrix.needsUpdate = true;
  return [frames, panes];
}

/** Evenly spaced positions across a wall, leaving room at the corners. */
function spread(halfExtent: number, spacing: number): number[] {
  const usable = halfExtent - 1.6;
  const count = Math.max(1, Math.floor((usable * 2) / spacing) + 1);
  const step = count > 1 ? (usable * 2) / (count - 1) : 0;
  const values: number[] = [];
  for (let i = 0; i < count; i += 1) values.push(-usable + step * i);
  return values;
}

function blocked(along: number, gaps: readonly (readonly [number, number])[]): boolean {
  const half = WINDOW_WIDTH / 2 + 0.3;
  return gaps.some(([start, end]) => along + half > start && along - half < end);
}

/** Chunky candy-stick columns at the four corners, one instanced mesh a floor. */
function buildCornerPillars(): InstancedMesh {
  const pillars = new InstancedMesh(
    new BoxGeometry(0.82, BUILDING_FLOOR_HEIGHT, 0.82),
    softMaterial(PALETTE.buildingTrim, 0.7),
    4,
  );
  pillars.name = 'corner-pillars';
  pillars.castShadow = false;
  pillars.receiveShadow = true;

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  const position = new Vector3();
  let index = 0;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      position.set(sx * OUTER_X, BUILDING_FLOOR_HEIGHT / 2, sz * OUTER_Z);
      matrix.compose(position, rotation, scale);
      pillars.setMatrixAt(index, matrix);
      index += 1;
    }
  }
  pillars.instanceMatrix.needsUpdate = true;
  return pillars;
}

// -------------------------------------------------------------------- roof

function buildRoof(roof: Group): void {
  // A roof terrace rather than a blue lid: from a 38° camera the top of the
  // tower is most of its silhouette, and a flat slab of one colour dominates
  // everything around it.
  const slab = castAndReceive(
    new Mesh(
      extrudePlan([planRect(-OUTER_X - 0.5, OUTER_X + 0.5, -OUTER_Z - 0.5, OUTER_Z + 0.5)], 0.4),
      softMaterial(PALETTE.stonePinkLight, 0.85),
    ),
  );
  slab.position.y = -0.4;
  roof.add(slab);

  // A little pavilion at the west end, to break up the terrace.
  const pavilion = castAndReceive(
    new Mesh(new BoxGeometry(7.6, 2.7, 6.4), softMaterial(PALETTE.buildingWall, 0.78)),
  );
  pavilion.position.set(-6.5, 1.35, -1);
  roof.add(pavilion);

  // ConeGeometry with four segments is a pyramid, and its radius is the
  // *circum*radius — size it off the box's diagonal or it swamps the roof.
  const pavilionRoof = castAndReceive(
    new Mesh(new ConeGeometry(5.2, 2.2, 4), softMaterial(PALETTE.buildingRoofDeep, 0.72)),
  );
  pavilionRoof.position.set(-6.5, 3.75, -1);
  pavilionRoof.rotation.y = Math.PI / 4;
  roof.add(pavilionRoof);

  // A parapet all the way round, so the top reads as a roof terrace.
  const lip = receiveOnly(
    new Mesh(
      extrudePlan(
        [
          planRect(-OUTER_X - 0.5, OUTER_X + 0.5, -OUTER_Z - 0.5, -OUTER_Z + 0.1),
          planRect(-OUTER_X - 0.5, OUTER_X + 0.5, OUTER_Z - 0.1, OUTER_Z + 0.5),
          planRect(-OUTER_X - 0.5, -OUTER_X + 0.1, -OUTER_Z + 0.1, OUTER_Z - 0.1),
          planRect(OUTER_X - 0.1, OUTER_X + 0.5, -OUTER_Z + 0.1, OUTER_Z - 0.1),
        ],
        0.85,
      ),
      softMaterial(PALETTE.buildingRoofDeep, 0.72),
    ),
  );
  roof.add(lip);

  // Every building in this park has a bobble on top.
  const mast = receiveOnly(
    new Mesh(new CylinderGeometry(0.12, 0.16, 3.4, 8), softMaterial(PALETTE.woodLight, 0.85)),
  );
  mast.position.set(0, 1.7, 0);
  roof.add(mast);

  const bobble = receiveOnly(
    new Mesh(new SphereGeometry(0.62, 18, 14), softMaterial(PALETTE.markerPink, 0.5)),
  );
  bobble.position.set(0, 3.7, 0);
  roof.add(bobble);

  roof.add(buildRoofBobbles());
}

/** A ring of pastel bobbles so the roof is not a blank blue field from above. */
function buildRoofBobbles(): InstancedMesh {
  const count = 12;
  const bobbles = new InstancedMesh(
    new SphereGeometry(0.5, 12, 9),
    softMaterial(PALETTE.markerMint, 0.55),
    count,
  );
  bobbles.castShadow = false;
  bobbles.receiveShadow = true;

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const scale = new Vector3(1, 0.8, 1);
  const position = new Vector3();
  for (let i = 0; i < count; i += 1) {
    const t = (i / count) * Math.PI * 2;
    position.set(Math.cos(t) * (OUTER_X - 1.4), 0.3, Math.sin(t) * (OUTER_Z - 1.4));
    matrix.compose(position, rotation, scale);
    bobbles.setMatrixAt(i, matrix);
  }
  bobbles.instanceMatrix.needsUpdate = true;
  return bobbles;
}

// ---------------------------------------------------------------- entrance

/** A wide skirt of pastel stone the whole tower stands on. */
function buildPlinth(): Mesh {
  const mesh = castAndReceive(
    new Mesh(
      extrudePlan([planRect(-OUTER_X - 0.6, OUTER_X + 0.6, -OUTER_Z - 0.6, OUTER_Z + 0.6)], 2.4),
      softMaterial(PALETTE.stonePinkDark, 0.9),
    ),
  );
  mesh.name = 'plinth';
  // Buried in the hill: only the top 0.3 m or so shows, whatever the ground does.
  mesh.position.y = -2.4 - BUILDING_SLAB;
  return mesh;
}

/**
 * Fat steps up to the front door.
 *
 * Their tops trace {@link ENTRANCE_RAMP}, which is the surface the player
 * actually walks on — the geometry only has to agree with it, not define it.
 */
function buildEntranceSteps(): InstancedMesh {
  const { footprint, from, to, yFrom, yTo } = ENTRANCE_RAMP;
  const count = 4;
  const depth = (from - to) / count;
  const width = footprint.maxX - footprint.minX + 1.4;

  const steps = new InstancedMesh(
    new BoxGeometry(1, 1, depth * 1.02),
    softMaterial(PALETTE.stonePinkLight, 0.88),
    count,
  );
  steps.name = 'entrance-steps';
  steps.castShadow = true;
  steps.receiveShadow = true;

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const scale = new Vector3();
  const position = new Vector3();
  const centreX = (footprint.minX + footprint.maxX) / 2;

  for (let i = 0; i < count; i += 1) {
    const z = from - depth * (i + 0.5);
    const t = (z - from) / (to - from);
    const top = yFrom + (yTo - yFrom) * t;
    const height = top + 1.6;
    scale.set(width, height, 1);
    position.set(centreX, top - height / 2, z);
    matrix.compose(position, rotation, scale);
    steps.setMatrixAt(i, matrix);
  }
  steps.instanceMatrix.needsUpdate = true;
  return steps;
}

function buildEntranceCanopy(parent: Group): void {
  const centreX = (ENTRANCE_MIN_X + ENTRANCE_MAX_X) / 2;
  const canopy = new Group();
  canopy.name = 'entrance-canopy';
  canopy.position.set(centreX, 0, BUILDING_HALF_Z + 1.3);
  parent.add(canopy);

  const roof = castAndReceive(
    new Mesh(new BoxGeometry(7.4, 0.32, 3.4), softMaterial(PALETTE.markerPink, 0.7)),
  );
  roof.position.y = 3.05;
  canopy.add(roof);

  const valance = receiveOnly(
    new Mesh(new BoxGeometry(7.4, 0.5, 0.26), softMaterial(PALETTE.blossomWhite, 0.75)),
  );
  valance.position.set(0, 2.68, 1.66);
  canopy.add(valance);

  const posts = new InstancedMesh(
    new CylinderGeometry(0.17, 0.2, 2.9, 10),
    softMaterial(PALETTE.buildingTrimDeep, 0.7),
    2,
  );
  posts.castShadow = false;
  posts.receiveShadow = true;
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  const position = new Vector3();
  [-3.4, 3.4].forEach((x, index) => {
    position.set(x, 1.45, 1.5);
    matrix.compose(position, rotation, scale);
    posts.setMatrixAt(index, matrix);
  });
  posts.instanceMatrix.needsUpdate = true;
  canopy.add(posts);

  const sign = cuteSign({
    title: 'The Big Building',
    subtitle: 'come in and look around!',
    glyph: '🏬',
    accent: PALETTE.markerSky,
    width: 5.2,
  });
  // Facing +Z, out towards the park and the default camera angle.
  sign.position.set(0, 4.6, 1.75);
  canopy.add(sign);
}
