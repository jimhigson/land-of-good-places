import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Shape,
  SphereGeometry,
  TorusGeometry,
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
  INTERIOR_HALF_X,
  INTERIOR_HALF_Z,
  INTERIOR_PLAZA_DROP,
  INTERIOR_PLAZA_RADIUS,
} from '../../core/constants';
import { PALETTE } from '../../core/palette';
import {
  CASTLE_WINDOWS,
  WINDOW_HEAD_Y,
  WINDOW_SILL_Y,
} from '../coaster/castleWindows';
import {
  castAndReceive,
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
  FACADE_SLIDE_DOOR_MAX_X,
  FACADE_SLIDE_DOOR_MIN_X,
  INTERIOR_DOOR_MAX_X,
  INTERIOR_DOOR_MIN_X,
  LIFT_DOOR_MAX_Z,
  LIFT_DOOR_MIN_Z,
  ROOF_PAVILION_HALF_X,
  ROOF_PAVILION_HALF_Z,
  ROOF_PAVILION_X,
  ROOF_PAVILION_Z,
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
/** Header band under each deck, so the glass stops short of the ceiling. */
const GLASS_TOP = BUILDING_FLOOR_HEIGHT - 0.34;

/** How high the roof terrace's parapet stands. Low enough to see over at 38°. */
const ROOF_PARAPET = 1.05;

/**
 * The two shells this game builds.
 *
 * `interior` is the place you walk about in — big floor plate, holes for the
 * shafts, and a roof terrace on top that is open to the sky. `facade` is the
 * castle standing in the garden (GAME_DESIGN.md item 31): continuous walls, a
 * courtyard, corner towers, a battlement, a grand arch and a rose window over
 * the front door. It is scenery — the door you go in through, and nothing
 * more — and shares nothing structurally with `interior` beyond the plan
 * footprint and the door coordinates, because item 30c means it never has to:
 * the two are disconnected worlds, and this file is the seam between them.
 */
export type ShellKind = 'interior' | 'facade';

interface ShellPlan {
  readonly halfX: number;
  readonly halfZ: number;
  /** Decks that get walls, glass and windows. The rest is open terrace. */
  readonly enclosedDecks: number;
  readonly doorMinX: number;
  readonly doorMaxX: number;
  readonly holes: boolean;
  /** Where the ginormous slide leaves the top storey, if it leaves one at all. */
  readonly slideGap: readonly [number, number] | null;
}

function planFor(kind: ShellKind): ShellPlan {
  return kind === 'interior'
    ? {
        halfX: INTERIOR_HALF_X,
        halfZ: INTERIOR_HALF_Z,
        // Everything below the roof is enclosed; the roof itself is outdoors.
        enclosedDecks: TOP_DECK,
        doorMinX: INTERIOR_DOOR_MIN_X,
        doorMaxX: INTERIOR_DOOR_MAX_X,
        holes: true,
        // The roof has no walls; its gap is cut in the parapet instead.
        slideGap: null,
      }
    : {
        halfX: BUILDING_HALF_X,
        halfZ: BUILDING_HALF_Z,
        enclosedDecks: BUILDING_FLOOR_COUNT,
        doorMinX: ENTRANCE_MIN_X,
        doorMaxX: ENTRANCE_MAX_X,
        holes: false,
        slideGap: [FACADE_SLIDE_DOOR_MIN_X, FACADE_SLIDE_DOOR_MAX_X],
      };
}

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
 *
 * **The top deck of the interior is the roof.** It gets no walls and no glass —
 * a parapet, a pavilion and the sky, which is what the family asked for. Sunlight
 * lands on it because there is nothing above it to stop the sun.
 */
export class BuildingShell {
  readonly group = new Group();
  /** One per deck. The last one is the roof terrace on an interior shell. */
  readonly floorGroups: Group[] = [];

  constructor(readonly kind: ShellKind = 'interior') {
    const plan = planFor(kind);
    this.group.name = kind === 'interior' ? 'building-shell' : 'building-facade';

    if (kind === 'facade') {
      // The castle has no decks at all — it is a single storybook shape, not
      // five stacked storeys (item 31). `floorGroups` stays empty; nothing
      // outside this file ever reads a facade shell's floors (see `Building`,
      // which only ever touches `facade.group`).
      buildCastle(plan, this.group);
      return;
    }

    for (let deck = 0; deck < BUILDING_FLOOR_COUNT; deck += 1) {
      const floor = new Group();
      floor.name = `${this.group.name}-floor-${deck}`;
      floor.position.y = deck * BUILDING_FLOOR_HEIGHT;
      this.floorGroups.push(floor);
      this.group.add(floor);

      floor.add(buildDeck(plan, deck));

      if (deck < plan.enclosedDecks) {
        floor.add(buildWalls(plan, deck, BUILDING_PARAPET));
        floor.add(buildGlass(plan, deck));
        floor.add(buildTrimBand(plan, deck));
        floor.add(buildCornerPillars(plan));
        for (const mesh of buildWindows(plan, deck)) floor.add(mesh);
      } else {
        buildRoofTerrace(plan, floor);
      }
    }

    const ground = this.floorGroups[0];
    if (ground) buildInteriorPorch(plan, ground);
    this.group.add(buildInteriorPlaza());
  }
}

// ------------------------------------------------------------------- decks

function outerX(plan: ShellPlan): number {
  return plan.halfX + HALF_WALL;
}

function outerZ(plan: ShellPlan): number {
  return plan.halfZ + HALF_WALL;
}

function buildDeck(plan: ShellPlan, deck: number): Mesh {
  const ox = outerX(plan);
  const oz = outerZ(plan);
  const slab = planRect(-ox, ox, -oz, oz);
  if (plan.holes) {
    for (const hole of DECK_HOLES) {
      if (hole.decks.includes(deck)) slab.holes.push(planHole(hole.region));
    }
  }

  const mesh = new Mesh(
    extrudePlan([slab], BUILDING_SLAB),
    interiorMaterial(deck === TOP_DECK && plan.holes ? PALETTE.stonePinkLight : storeyColours(deck).floor, 0.82),
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
function wallShapes(plan: ShellPlan, deck: number): Shape[] {
  const shapes: Shape[] = [];
  const ox = outerX(plan);
  const oz = outerZ(plan);

  // North face: never interrupted.
  shapes.push(planRect(-ox, ox, -oz, -plan.halfZ + HALF_WALL));

  // South face: the front door downstairs.
  const southGaps: [number, number][] = [];
  if (deck === 0) southGaps.push([plan.doorMinX, plan.doorMaxX]);
  if (deck === TOP_DECK && plan.slideGap) southGaps.push([...plan.slideGap]);
  for (const [start, end] of segmentsMinusGaps(-ox, ox, southGaps)) {
    shapes.push(planRect(start, end, plan.halfZ - HALF_WALL, oz));
  }

  // East face: the way into the glass lift, on every deck.
  for (const [start, end] of segmentsMinusGaps(-plan.halfZ + HALF_WALL, plan.halfZ - HALF_WALL, [
    [LIFT_DOOR_MIN_Z, LIFT_DOOR_MAX_Z],
  ])) {
    shapes.push(planRect(plan.halfX - HALF_WALL, ox, start, end));
  }

  // West face.
  shapes.push(
    planRect(-ox, -plan.halfX + HALF_WALL, -plan.halfZ + HALF_WALL, plan.halfZ - HALF_WALL),
  );

  return shapes;
}

/**
 * The layer-cake: storeys alternate between a cream one and a blossom-pink one,
 * and the trim, floor plate and window glazing all flip with them.
 *
 * One function so a storey can never end up with cream walls and the pink
 * storey's trim. Every colour comes from `PALETTE`, which is the world's colour
 * bible — `ART` only ever *adds* colours for specific cute things, and the
 * building's are already named here (ART_DIRECTION.md §5).
 */
interface StoreyColours {
  readonly wall: number;
  readonly trim: number;
  readonly floor: number;
  readonly glazing: number;
}

function storeyColours(deck: number): StoreyColours {
  return deck % 2 === 0
    ? {
        wall: PALETTE.buildingWall,
        trim: PALETTE.buildingTrim,
        floor: PALETTE.buildingFloor,
        glazing: PALETTE.buildingWindow,
      }
    : {
        wall: PALETTE.buildingWallDark,
        trim: PALETTE.buildingTrimDeep,
        floor: PALETTE.buildingFloorAlt,
        glazing: PALETTE.buildingWindowWarm,
      };
}

function buildWalls(plan: ShellPlan, deck: number, height: number): Mesh {
  const mesh = castAndReceive(
    new Mesh(
      extrudePlan(wallShapes(plan, deck), height),
      softMaterial(storeyColours(deck).wall, 0.78),
    ),
  );
  mesh.name = `walls-${deck}`;
  return mesh;
}

function buildGlass(plan: ShellPlan, deck: number): Mesh {
  const mesh = new Mesh(
    extrudePlan(wallShapes(plan, deck), GLASS_TOP - BUILDING_PARAPET),
    glassMaterial(0.22),
  );
  mesh.name = `glass-${deck}`;
  mesh.position.y = BUILDING_PARAPET;
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  return mesh;
}

function buildTrimBand(plan: ShellPlan, deck: number): Mesh {
  const mesh = new Mesh(
    extrudePlan(wallShapes(plan, deck), BUILDING_FLOOR_HEIGHT - GLASS_TOP),
    softMaterial(storeyColours(deck).trim, 0.7),
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
function buildWindows(plan: ShellPlan, deck: number): InstancedMesh[] {
  const slots: WindowSlot[] = [];
  const outward = 0.09;
  const ox = outerX(plan);
  const oz = outerZ(plan);

  const southGaps: [number, number][] = [];
  if (deck === 0) southGaps.push([plan.doorMinX, plan.doorMaxX]);
  if (deck === TOP_DECK && plan.slideGap) southGaps.push([...plan.slideGap]);

  for (const x of spread(plan.halfX, 3.4)) {
    slots.push({ x, z: -oz - outward, yaw: 0 });
    if (!blocked(x, southGaps)) slots.push({ x, z: oz + outward, yaw: Math.PI });
  }
  for (const z of spread(plan.halfZ, 3.2)) {
    slots.push({ x: -ox - outward, z, yaw: Math.PI / 2 });
    if (!blocked(z, [[LIFT_DOOR_MIN_Z, LIFT_DOOR_MAX_Z]])) {
      slots.push({ x: ox + outward, z, yaw: -Math.PI / 2 });
    }
  }

  const storey = storeyColours(deck);
  const frames = new InstancedMesh(
    new BoxGeometry(WINDOW_WIDTH + 0.3, WINDOW_HEIGHT + 0.3, 0.16),
    softMaterial(storey.trim, 0.72),
    slots.length,
  );
  // The panes are applied decoration on a painted wall, not see-through glass,
  // so they are toon like the rest of the fabric — a hint of self-light keeps
  // them looking lit from inside once the sun is down.
  const panes = new InstancedMesh(
    new BoxGeometry(WINDOW_WIDTH, WINDOW_HEIGHT, 0.18),
    interiorMaterial(storey.glazing, 0.35),
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
function buildCornerPillars(plan: ShellPlan): InstancedMesh {
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
      position.set(sx * outerX(plan), BUILDING_FLOOR_HEIGHT / 2, sz * outerZ(plan));
      matrix.compose(position, rotation, scale);
      pillars.setMatrixAt(index, matrix);
      index += 1;
    }
  }
  pillars.instanceMatrix.needsUpdate = true;
  return pillars;
}

// ----------------------------------------------------------- roof terrace

/**
 * The roof: an actual outdoor terrace, and the top floor of the building.
 *
 * "The top floor is the roof" was the family's fifth note, and it changes what
 * the top of the tower is for. There is no storey above it, so the sky backdrop,
 * the sun and the fairy-lit night all reach it; the parapet is low enough to see
 * over at the camera's 38°; and the ginormous slide launches out of the gap in
 * the south parapet, over the garden, into the ball pit.
 */
function buildRoofTerrace(plan: ShellPlan, roof: Group): void {
  const ox = outerX(plan);
  const oz = outerZ(plan);

  // A parapet all the way round, with a gap where the slide leaves and another
  // where you step out of the lift.
  const shapes: Shape[] = [];
  shapes.push(planRect(-ox, ox, -oz, -oz + 0.6));
  for (const [start, end] of segmentsMinusGaps(-ox, ox, [[SLIDE_DOOR_MIN_X, SLIDE_DOOR_MAX_X]])) {
    shapes.push(planRect(start, end, oz - 0.6, oz));
  }
  shapes.push(planRect(-ox, -ox + 0.6, -oz + 0.6, oz - 0.6));
  for (const [start, end] of segmentsMinusGaps(-oz + 0.6, oz - 0.6, [
    [LIFT_DOOR_MIN_Z, LIFT_DOOR_MAX_Z],
  ])) {
    shapes.push(planRect(ox - 0.6, ox, start, end));
  }

  const lip = castAndReceive(
    new Mesh(extrudePlan(shapes, ROOF_PARAPET), softMaterial(PALETTE.buildingRoofDeep, 0.72)),
  );
  lip.name = 'roof-parapet';
  roof.add(lip);

  // A pavilion at the west end, to break up the terrace and give the roof a
  // shady corner. Same silhouette it always had, only bigger and standing on a
  // floor you can now walk about on.
  const pavilion = castAndReceive(
    new Mesh(
      new BoxGeometry(ROOF_PAVILION_HALF_X * 2, 2.9, ROOF_PAVILION_HALF_Z * 2),
      softMaterial(PALETTE.buildingWall, 0.78),
    ),
  );
  pavilion.position.set(ROOF_PAVILION_X, 1.45, ROOF_PAVILION_Z);
  roof.add(pavilion);

  // ConeGeometry with four segments is a pyramid, and its radius is the
  // *circum*radius — size it off the box's diagonal or it swamps the roof.
  const pavilionRoof = castAndReceive(
    new Mesh(
      new ConeGeometry(Math.hypot(ROOF_PAVILION_HALF_X, ROOF_PAVILION_HALF_Z) + 0.5, 2.4, 4),
      softMaterial(PALETTE.buildingRoofDeep, 0.72),
    ),
  );
  pavilionRoof.position.set(ROOF_PAVILION_X, 4.1, ROOF_PAVILION_Z);
  pavilionRoof.rotation.y = Math.PI / 4;
  roof.add(pavilionRoof);

  // Every building in this park has a bobble on top.
  const mast = receiveOnly(
    new Mesh(new CylinderGeometry(0.12, 0.16, 3.4, 8), softMaterial(PALETTE.woodLight, 0.85)),
  );
  mast.position.set(ROOF_PAVILION_X, 6.6, ROOF_PAVILION_Z);
  roof.add(mast);

  const bobble = receiveOnly(
    new Mesh(new SphereGeometry(0.62, 18, 14), softMaterial(PALETTE.markerPink, 0.5)),
  );
  bobble.position.set(ROOF_PAVILION_X, 8.5, ROOF_PAVILION_Z);
  roof.add(bobble);

  roof.add(buildRoofPlanters(plan));
}

/** A ring of pastel planters so the terrace is not a blank field from above. */
function buildRoofPlanters(plan: ShellPlan): InstancedMesh {
  const count = 18;
  const planters = new InstancedMesh(
    new SphereGeometry(0.62, 12, 9),
    softMaterial(PALETTE.markerMint, 0.55),
    count,
  );
  planters.name = 'roof-planters';
  planters.castShadow = false;
  planters.receiveShadow = true;

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const scale = new Vector3(1, 0.8, 1);
  const position = new Vector3();
  for (let i = 0; i < count; i += 1) {
    const t = (i / count) * Math.PI * 2;
    position.set(
      Math.cos(t) * (outerX(plan) - 2.2),
      0.35,
      Math.sin(t) * (outerZ(plan) - 2.2),
    );
    matrix.compose(position, rotation, scale);
    planters.setMatrixAt(i, matrix);
  }
  planters.instanceMatrix.needsUpdate = true;
  return planters;
}

/**
 * The interior's own ground: a soft green disc a metre below deck zero, with a
 * skirt round its rim so you can never see under it.
 *
 * The building's space has no terrain — it is not on the hilltop, it is not
 * anywhere. Without this the windows look out on a void and the roof terrace
 * floats over nothing.
 *
 * It is a **disc**, and the radius matters, for exactly the reason the garden is
 * a diorama on a hilltop (see `constants.ts`): the camera is orthographic, so an
 * endless ground plane fills the frame forever and the sky is never seen. The
 * top floor of this building is the roof and it is supposed to be *outdoors* —
 * so the ground has to stop somewhere inside the view, and it stops at roughly
 * the soft play boundary, by which distance the fog has already dissolved its
 * edge into the horizon colour. Stand at the north-west parapet and there is
 * open sky above the rim, whatever time of day it is.
 */
function buildInteriorPlaza(): Group {
  const group = new Group();
  group.name = 'interior-plaza';
  group.position.y = -INTERIOR_PLAZA_DROP;

  const ground = new MeshStandardMaterial({
    color: PALETTE.grassLight,
    metalness: 0,
    roughness: 1,
  });

  const disc = new Mesh(new CircleGeometry(INTERIOR_PLAZA_RADIUS, 56), ground);
  disc.rotation.x = -Math.PI / 2;
  disc.receiveShadow = true;
  group.add(disc);

  // The cut edge, dropped far enough that the 38° camera never sees its bottom.
  const skirt = new Mesh(
    new CylinderGeometry(INTERIOR_PLAZA_RADIUS, INTERIOR_PLAZA_RADIUS, 22, 56, 1, true),
    new MeshStandardMaterial({ color: PALETTE.grassDark, metalness: 0, roughness: 1 }),
  );
  skirt.position.y = -11;
  group.add(skirt);

  return group;
}

// -------------------------------------------------------------- the castle

/** Height of the front doorway, before the wall closes up solid above it. */
const CASTLE_DOOR_HEIGHT = 3.6;
/** Total height of the curtain wall, battlement included. One number, one
 * colour, the whole way round — which is what stops it reading as storeys. */
const CASTLE_WALL_HEIGHT = 8.8;

const CASTLE_MERLON_WIDTH = 0.85;
const CASTLE_MERLON_DEPTH = 0.5;
const CASTLE_MERLON_HEIGHT = 1.05;
const CASTLE_MERLON_PITCH = 1.7;

const TOWER_RADIUS = 2.05;
const TOWER_HEIGHT = 10.6;
const TOWER_ROOF_HEIGHT = 4.2;

const DOOR_CENTRE_X = (ENTRANCE_MIN_X + ENTRANCE_MAX_X) / 2;
const DOOR_ARCH_RADIUS = (ENTRANCE_MAX_X - ENTRANCE_MIN_X) / 2 + 0.4;
const DOOR_ARCH_TUBE = 0.42;

/** Width of the stone band framing a cruiser window, and how deep it stands. */
const SURROUND_BAND = 0.55;
const SURROUND_DEPTH = 0.3;
/** How far a surround block bites into the wall, so it never floats off it. */
const SURROUND_BITE = 0.08;
/** Nominal height of one quoin up a jamb. */
const SURROUND_COURSE = 0.62;

const ROSE_WINDOW_RADIUS = 1.35;
const ROSE_WINDOW_Y = CASTLE_DOOR_HEIGHT + DOOR_ARCH_RADIUS + 1.9;

/**
 * The castle: what actually stands in the garden (GAME_DESIGN.md item 31).
 *
 * One continuous curtain wall — a solid band below the doorway's height and
 * another, equally solid, above it, both the same colour — four corner towers
 * with conical roofs and pennants, a battlement along the top, a big stone
 * arch framing the front door, and a rose window over it. No deck, no
 * storey-by-storey window rows: the family's repeated complaint about the old
 * "layer cake" look (item 31) was specifically that it read as stacked floors,
 * so nothing here is authored per floor at all. What is actually inside the
 * castle is a different place entirely (item 30c) and none of it has to agree
 * with this shape — which is exactly why this function never touches
 * `floorGroups`.
 */
function buildCastle(plan: ShellPlan, group: Group): void {
  group.add(buildPlinth(plan));
  group.add(buildEntranceSteps());
  group.add(buildCourtyard(plan));
  group.add(buildCastleWalls(plan));
  group.add(buildCruiserWindows(plan));
  group.add(buildCrenellations(plan));
  group.add(buildCornerTowers(plan));
  group.add(buildEntranceArch(plan));
  group.add(buildRoseWindow(plan));
}

/**
 * Gaps to leave in a ring of wall, per run.
 *
 * `south` is the doorway, and predates everything else. `east` and `west` are
 * the Sky Cruiser's windows (#113) — spans of **z**, not x, because those runs
 * lie along z. They exist per-run rather than as one shared list precisely
 * because the two openings are cut wherever the solved loop crossed, and it
 * crosses the two side walls at slightly different places.
 */
interface RingGaps {
  readonly south: readonly (readonly [number, number])[];
  readonly east: readonly (readonly [number, number])[];
  readonly west: readonly (readonly [number, number])[];
}

const NO_GAPS: RingGaps = { south: [], east: [], west: [] };

/** One ring of four walls in plan, with the given gaps left in each run. */
function ringShapes(plan: ShellPlan, gaps: RingGaps): Shape[] {
  const shapes: Shape[] = [];
  const ox = outerX(plan);
  const oz = outerZ(plan);
  const runMinZ = -plan.halfZ + HALF_WALL;
  const runMaxZ = plan.halfZ - HALF_WALL;

  shapes.push(planRect(-ox, ox, -oz, runMinZ));
  for (const [start, end] of segmentsMinusGaps(-ox, ox, gaps.south)) {
    shapes.push(planRect(start, end, runMaxZ, oz));
  }
  for (const [start, end] of segmentsMinusGaps(runMinZ, runMaxZ, gaps.east)) {
    shapes.push(planRect(plan.halfX - HALF_WALL, ox, start, end));
  }
  for (const [start, end] of segmentsMinusGaps(runMinZ, runMaxZ, gaps.west)) {
    shapes.push(planRect(-ox, -plan.halfX + HALF_WALL, start, end));
  }

  return shapes;
}

/**
 * The curtain wall itself, in two solid extrusions rather than one per floor:
 * a lower band with the doorway gap, and an upper band with no gaps at all,
 * both the same wall colour. That seam is exactly as tall as the doorway and
 * invisible, because nothing about it changes — no trim band, no window row,
 * no colour flip — which is what turns "two extrusions" into "one wall" to
 * the eye.
 */
function buildCastleWalls(plan: ShellPlan): Group {
  const group = new Group();
  group.name = 'castle-walls';

  const band = (name: string, shapes: Shape[], fromY: number, toY: number): void => {
    const mesh = castAndReceive(
      new Mesh(extrudePlan(shapes, toY - fromY), softMaterial(PALETTE.buildingWall, 0.78)),
    );
    mesh.name = name;
    mesh.position.y = fromY;
    group.add(mesh);
  };

  const doorGaps: RingGaps = {
    south: [[plan.doorMinX, plan.doorMaxX]],
    east: [],
    west: [],
  };
  band('castle-wall-lower', ringShapes(plan, doorGaps), 0, CASTLE_DOOR_HEIGHT);

  // No loop through the castle on this seed, so no holes: the wall is the two
  // bands it has always been, built by exactly the code that always built them.
  if (CASTLE_WINDOWS.length === 0) {
    band('castle-wall-upper', ringShapes(plan, NO_GAPS), CASTLE_DOOR_HEIGHT, CASTLE_WALL_HEIGHT);
    return group;
  }

  // Three bands instead of one, split at the sill and the head. Cheaper and far
  // less fragile than punching a hole through a single extrusion: the doorway
  // has always been a *gap between wall segments* rather than a cut-out (see
  // `ringShapes`), and this is the same trick turned on its side, so a window is
  // made of the same operation the front door is.
  const windowGaps: RingGaps = {
    south: [],
    east: CASTLE_WINDOWS.filter((w) => w.wall === 'east').map((w) => [w.minZ, w.maxZ] as const),
    west: CASTLE_WINDOWS.filter((w) => w.wall === 'west').map((w) => [w.minZ, w.maxZ] as const),
  };
  band('castle-wall-upper', ringShapes(plan, NO_GAPS), CASTLE_DOOR_HEIGHT, WINDOW_SILL_Y);
  band('castle-wall-window', ringShapes(plan, windowGaps), WINDOW_SILL_Y, WINDOW_HEAD_Y);
  band('castle-wall-lintel', ringShapes(plan, NO_GAPS), WINDOW_HEAD_Y, CASTLE_WALL_HEIGHT);

  return group;
}

/**
 * A chunky stone surround around each opening: quoined jambs, a lintel and a
 * projecting sill, standing **proud of the wall face** on both sides.
 *
 * Decoration around a plain rectangular hole, exactly as the entrance arch is
 * decoration around the plain rectangular doorway — that idiom is already the
 * castle's, and re-using it is what makes a window the coaster made look like
 * part of the building rather than damage to it. An arched head was the first
 * thing tried and the wall is not tall enough for one: the rider's eye sits
 * 1.55 m above the track, so the head cannot come below 7.65 m, and a
 * semicircular arch over a 3.2 m opening would then break through the
 * battlements — which the issue's own "fully within a wall panel" assert
 * forbids. Alternating quoin depths do the "this is masonry" work instead.
 *
 * Both faces get one. The outer face is what the park sees; the inner face is
 * what a rider sees for the half-second they are inside the courtyard, and a
 * hole framed on one side only reads as a mistake from precisely the viewpoint
 * this whole feature exists for.
 */
function buildCruiserWindows(plan: ShellPlan): Group {
  const group = new Group();
  group.name = 'cruiser-windows';
  if (CASTLE_WINDOWS.length === 0) return group;

  const blocks: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [];
  const ox = outerX(plan);
  const innerX = plan.halfX - HALF_WALL;

  for (const window of CASTLE_WINDOWS) {
    const side = window.wall === 'east' ? 1 : -1;
    const faces: readonly (readonly [number, number])[] = [
      [side * ox, side], // outer face, standing outwards
      [side * innerX, -side], // inner face, standing into the courtyard
    ];
    for (const [faceX, out] of faces) {
      const x = faceX + out * (SURROUND_DEPTH / 2 - SURROUND_BITE);
      const minZ = window.minZ - SURROUND_BAND;
      const maxZ = window.maxZ + SURROUND_BAND;
      const minY = WINDOW_SILL_Y - SURROUND_BAND;
      const maxY = WINDOW_HEAD_Y + SURROUND_BAND;

      // Jambs, as a stack of quoins with every other one standing a little
      // further out — the cheapest thing that reads as cut stone rather than a
      // picture frame, and it costs instances, not draw calls.
      const runY = maxY - minY;
      const courses = Math.max(2, Math.round(runY / SURROUND_COURSE));
      const course = runY / courses;
      for (let i = 0; i < courses; i += 1) {
        const proud = i % 2 === 0 ? SURROUND_DEPTH : SURROUND_DEPTH * 0.72;
        const y = minY + course * (i + 0.5);
        for (const z of [minZ + SURROUND_BAND / 2, maxZ - SURROUND_BAND / 2]) {
          blocks.push({
            x: faceX + out * (proud / 2 - SURROUND_BITE),
            y,
            z,
            sx: proud,
            sy: course * 0.92,
            sz: SURROUND_BAND,
          });
        }
      }

      // Lintel over the top and a deeper sill under the bottom.
      blocks.push({
        x,
        y: maxY - SURROUND_BAND / 2,
        z: (minZ + maxZ) / 2,
        sx: SURROUND_DEPTH,
        sy: SURROUND_BAND,
        sz: maxZ - minZ,
      });
      blocks.push({
        x: faceX + out * (SURROUND_DEPTH * 1.3 / 2 - SURROUND_BITE),
        y: minY + SURROUND_BAND / 2,
        z: (minZ + maxZ) / 2,
        sx: SURROUND_DEPTH * 1.3,
        sy: SURROUND_BAND,
        sz: maxZ - minZ + SURROUND_BAND,
      });
    }
  }

  const stones = new InstancedMesh(
    new BoxGeometry(1, 1, 1),
    softMaterial(PALETTE.buildingTrim, 0.72),
    blocks.length,
  );
  stones.name = 'cruiser-window-stones';
  stones.castShadow = true;
  stones.receiveShadow = true;
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const position = new Vector3();
  const scale = new Vector3();
  blocks.forEach((b, index) => {
    position.set(b.x, b.y, b.z);
    scale.set(b.sx, b.sy, b.sz);
    matrix.compose(position, rotation, scale);
    stones.setMatrixAt(index, matrix);
  });
  stones.instanceMatrix.needsUpdate = true;
  group.add(stones);

  return group;
}

/**
 * The courtyard: a plain pavement filling the footprint, well below the wall
 * top.
 *
 * The castle has no lid — a flat cap across the whole footprint is exactly
 * the "top of a building" look this rebuild removes. Without *something* down
 * here, though, glancing over the battlement from the camera's 38° would show
 * empty air where the old top storey used to be; a courtyard floor is what a
 * curtain wall like this actually encloses in a real castle, so it is a
 * better answer than a lid, not just a cheaper one.
 */
function buildCourtyard(plan: ShellPlan): Group {
  const group = new Group();
  group.name = 'castle-courtyard';
  const ox = outerX(plan);
  const oz = outerZ(plan);

  const floor = new Mesh(
    extrudePlan([planRect(-ox, ox, -oz, oz)], BUILDING_SLAB),
    interiorMaterial(PALETTE.stonePinkLight, 0.85),
  );
  floor.name = 'castle-courtyard-floor';
  floor.position.y = -BUILDING_SLAB;
  floor.receiveShadow = true;
  floor.castShadow = false;
  group.add(floor);

  const emblem = receiveOnly(
    new Mesh(new CylinderGeometry(2.6, 2.6, 0.1, 28), softMaterial(PALETTE.buildingTrim, 0.7)),
  );
  emblem.name = 'castle-courtyard-emblem';
  emblem.position.y = 0.03;
  group.add(emblem);

  return group;
}

/** Slots for {@link buildCrenellations}: one instance per merlon, right round the wall. */
function crenellationSlots(plan: ShellPlan): WindowSlot[] {
  const slots: WindowSlot[] = [];
  const ox = outerX(plan);
  const oz = outerZ(plan);
  // Kept well clear of the corner towers, which stand outside this ring.
  for (const x of spread(plan.halfX - 0.9, CASTLE_MERLON_PITCH)) {
    slots.push({ x, z: -oz, yaw: 0 });
    slots.push({ x, z: oz, yaw: 0 });
  }
  for (const z of spread(plan.halfZ - 0.9, CASTLE_MERLON_PITCH)) {
    slots.push({ x: -ox, z, yaw: Math.PI / 2 });
    slots.push({ x: ox, z, yaw: Math.PI / 2 });
  }
  return slots;
}

/** The battlement: a merlon standing on top of the wall at every slot, one draw call. */
function buildCrenellations(plan: ShellPlan): InstancedMesh {
  const slots = crenellationSlots(plan);
  const merlons = new InstancedMesh(
    new BoxGeometry(CASTLE_MERLON_WIDTH, CASTLE_MERLON_HEIGHT, CASTLE_MERLON_DEPTH),
    softMaterial(PALETTE.buildingTrim, 0.72),
    slots.length,
  );
  merlons.name = 'crenellations';
  merlons.castShadow = true;
  merlons.receiveShadow = true;

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const axis = new Vector3(0, 1, 0);
  const scale = new Vector3(1, 1, 1);
  const position = new Vector3();

  slots.forEach((slot, index) => {
    rotation.setFromAxisAngle(axis, slot.yaw);
    position.set(slot.x, CASTLE_WALL_HEIGHT + CASTLE_MERLON_HEIGHT / 2, slot.z);
    matrix.compose(position, rotation, scale);
    merlons.setMatrixAt(index, matrix);
  });
  merlons.instanceMatrix.needsUpdate = true;
  return merlons;
}

/**
 * Four corner towers, each a cylinder, a conical roof, a little mast and a
 * flag — the part of the silhouette that reads as "castle" from clear across
 * the garden, well above the battlement line.
 */
function buildCornerTowers(plan: ShellPlan): Group {
  const group = new Group();
  group.name = 'castle-towers';

  const corners: readonly (readonly [number, number])[] = [
    [-outerX(plan), -outerZ(plan)],
    [outerX(plan), -outerZ(plan)],
    [-outerX(plan), outerZ(plan)],
    [outerX(plan), outerZ(plan)],
  ];
  const flagColours = [
    PALETTE.markerPink,
    PALETTE.markerSky,
    PALETTE.markerLemon,
    PALETTE.markerLilac,
  ];

  const bodies = new InstancedMesh(
    new CylinderGeometry(TOWER_RADIUS, TOWER_RADIUS * 1.08, TOWER_HEIGHT, 16),
    softMaterial(PALETTE.buildingWall, 0.78),
    corners.length,
  );
  bodies.name = 'tower-bodies';
  bodies.castShadow = true;
  bodies.receiveShadow = true;

  // A true cone (16 segments), unlike the roof pavilion's four-sided pyramid —
  // this one is meant to read as a proper witch's-hat tower roof up close.
  const roofs = new InstancedMesh(
    new ConeGeometry(TOWER_RADIUS + 0.4, TOWER_ROOF_HEIGHT, 16),
    softMaterial(PALETTE.buildingRoofDeep, 0.72),
    corners.length,
  );
  roofs.name = 'tower-roofs';
  roofs.castShadow = true;
  roofs.receiveShadow = true;

  const masts = new InstancedMesh(
    new CylinderGeometry(0.07, 0.09, 1.6, 8),
    softMaterial(PALETTE.woodLight, 0.85),
    corners.length,
  );
  masts.name = 'tower-masts';
  masts.castShadow = false;
  masts.receiveShadow = false;

  const finials = new InstancedMesh(
    new SphereGeometry(0.26, 14, 10),
    softMaterial(PALETTE.markerLemon, 0.55),
    corners.length,
  );
  finials.name = 'tower-finials';
  finials.castShadow = false;
  finials.receiveShadow = false;

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  const position = new Vector3();
  const roofTopY = TOWER_HEIGHT + TOWER_ROOF_HEIGHT;

  corners.forEach(([x, z], index) => {
    position.set(x, TOWER_HEIGHT / 2, z);
    matrix.compose(position, rotation, scale);
    bodies.setMatrixAt(index, matrix);

    position.set(x, TOWER_HEIGHT + TOWER_ROOF_HEIGHT / 2, z);
    matrix.compose(position, rotation, scale);
    roofs.setMatrixAt(index, matrix);

    position.set(x, roofTopY + 0.8, z);
    matrix.compose(position, rotation, scale);
    masts.setMatrixAt(index, matrix);

    position.set(x, roofTopY + 1.65, z);
    matrix.compose(position, rotation, scale);
    finials.setMatrixAt(index, matrix);

    const flag = buildPennant(flagColours[index % flagColours.length] ?? PALETTE.markerPink);
    flag.position.set(x, roofTopY + 1.15, z);
    group.add(flag);
  });

  bodies.instanceMatrix.needsUpdate = true;
  roofs.instanceMatrix.needsUpdate = true;
  masts.instanceMatrix.needsUpdate = true;
  finials.instanceMatrix.needsUpdate = true;

  group.add(bodies, roofs, masts, finials);
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

/** One flag flying from a mast. Double-sided: a flag has no "back" worth hiding. */
function buildPennant(colour: number): Mesh {
  const material = softMaterial(colour, 0.6);
  material.side = DoubleSide;
  const mesh = new Mesh(pennantGeometry(0.85, 0.55), material);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.position.y -= 0.3;
  return mesh;
}

/**
 * The grand entrance: a stone half-arch over the doorway and a pillar either
 * side, so the door reads as one grand surround rather than a hole in a wall
 * with a rainbow stuck above it. The doorway opening itself stays the plain
 * rectangle {@link ringShapes} already cuts — this is decoration standing
 * proud of it, not a re-shaped hole.
 */
function buildEntranceArch(plan: ShellPlan): Group {
  const group = new Group();
  group.name = 'entrance-arch';
  const oz = outerZ(plan);
  const pillarHeight = CASTLE_DOOR_HEIGHT + DOOR_ARCH_RADIUS;

  // `TorusGeometry`'s ring lies in the XY plane and its arc sweeps from +X
  // through +Y — exactly the top half of a ring, i.e. an arch — when `arc` is
  // Ï€, with no rotation needed to face the camera (see the rose window, same
  // trick, full circle).
  const arch = castAndReceive(
    new Mesh(
      new TorusGeometry(DOOR_ARCH_RADIUS, DOOR_ARCH_TUBE, 10, 24, Math.PI),
      softMaterial(PALETTE.buildingTrim, 0.72),
    ),
  );
  arch.name = 'entrance-arch-ring';
  arch.position.set(DOOR_CENTRE_X, CASTLE_DOOR_HEIGHT, oz + 0.05);
  group.add(arch);

  const pillars = new InstancedMesh(
    new CylinderGeometry(0.32, 0.37, pillarHeight, 10),
    softMaterial(PALETTE.buildingTrimDeep, 0.7),
    2,
  );
  pillars.name = 'entrance-pillars';
  pillars.castShadow = false;
  pillars.receiveShadow = true;
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  const position = new Vector3();
  [plan.doorMinX - 0.55, plan.doorMaxX + 0.55].forEach((x, index) => {
    position.set(x, pillarHeight / 2, oz - 0.1);
    matrix.compose(position, rotation, scale);
    pillars.setMatrixAt(index, matrix);
  });
  pillars.instanceMatrix.needsUpdate = true;
  group.add(pillars);

  return group;
}

/**
 * A rose window over the door: a ring, a tinted glass disc and four spokes
 * through the centre — cute stained-glass tracery rather than a hole
 * punched in the wall, and the one touch that says "storybook palace" as
 * clearly as the towers do.
 */
function buildRoseWindow(plan: ShellPlan): Group {
  const group = new Group();
  group.name = 'rose-window';
  const z = outerZ(plan) + 0.06;

  const ring = castAndReceive(
    new Mesh(
      new TorusGeometry(ROSE_WINDOW_RADIUS, 0.16, 10, 28),
      softMaterial(PALETTE.buildingTrim, 0.72),
    ),
  );
  ring.position.set(DOOR_CENTRE_X, ROSE_WINDOW_Y, z);
  group.add(ring);

  const glass = new Mesh(
    new CircleGeometry(ROSE_WINDOW_RADIUS - 0.14, 28),
    glassMaterial(0.42),
  );
  glass.position.set(DOOR_CENTRE_X, ROSE_WINDOW_Y, z - 0.05);
  glass.receiveShadow = false;
  glass.castShadow = false;
  group.add(glass);

  const spokeCount = 4;
  const spokes = new InstancedMesh(
    new BoxGeometry(ROSE_WINDOW_RADIUS * 1.9, 0.12, 0.1),
    softMaterial(PALETTE.buildingTrim, 0.72),
    spokeCount,
  );
  spokes.name = 'rose-window-spokes';
  spokes.castShadow = false;
  spokes.receiveShadow = false;
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const axis = new Vector3(0, 0, 1);
  const scale = new Vector3(1, 1, 1);
  const position = new Vector3();
  for (let i = 0; i < spokeCount; i += 1) {
    rotation.setFromAxisAngle(axis, (Math.PI / spokeCount) * i);
    position.set(DOOR_CENTRE_X, ROSE_WINDOW_Y, z - 0.02);
    matrix.compose(position, rotation, scale);
    spokes.setMatrixAt(i, matrix);
  }
  spokes.instanceMatrix.needsUpdate = true;
  group.add(spokes);

  return group;
}

/*
 * The castle used to name itself on a board beside its door, the roof terrace
 * on another, and the way out on a third. All three went with every other sign
 * in the park on 28 July 2026 (the family: they are hard to read). The stone
 * arch is the grand thing over the doorway, and it says "castle" without a
 * word on it.
 */

// ---------------------------------------------------------------- entrance

/** A wide skirt of pastel stone the whole tower stands on. */
function buildPlinth(plan: ShellPlan): Mesh {
  const ox = outerX(plan);
  const oz = outerZ(plan);
  const mesh = castAndReceive(
    new Mesh(
      extrudePlan([planRect(-ox - 0.6, ox + 0.6, -oz - 0.6, oz + 0.6)], 2.4),
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

/**
 * The way back out of the interior: a little porch outside its own south door,
 * with a sign so a child knows which way home is.
 */
function buildInteriorPorch(plan: ShellPlan, parent: Group): void {
  const porch = new Group();
  porch.name = 'interior-porch';
  porch.position.set(0, 0, plan.halfZ + 1.4);
  parent.add(porch);

  const mat = castAndReceive(
    new Mesh(new BoxGeometry(9, 0.12, 4.2), softMaterial(PALETTE.stonePinkLight, 0.86)),
  );
  mat.position.y = -0.06;
  porch.add(mat);

  const roof = castAndReceive(
    new Mesh(new BoxGeometry(9, 0.32, 4.2), softMaterial(PALETTE.markerPink, 0.7)),
  );
  roof.position.y = 3.05;
  porch.add(roof);

  const posts = new InstancedMesh(
    new CylinderGeometry(0.18, 0.22, 2.9, 10),
    softMaterial(PALETTE.buildingTrimDeep, 0.7),
    2,
  );
  posts.castShadow = false;
  posts.receiveShadow = true;
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  const position = new Vector3();
  [-4, 4].forEach((x, index) => {
    position.set(x, 1.45, 1.8);
    matrix.compose(position, rotation, scale);
    posts.setMatrixAt(index, matrix);
  });
  posts.instanceMatrix.needsUpdate = true;
  porch.add(posts);

}
