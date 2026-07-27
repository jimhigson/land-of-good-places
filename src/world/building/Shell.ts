import {
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
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
  INTERIOR_HALF_X,
  INTERIOR_HALF_Z,
  INTERIOR_PLAZA_DROP,
  INTERIOR_PLAZA_RADIUS,
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
 * tower standing in the garden: the same layer-cake look, solid all the way up,
 * with the plinth, the front steps and the welcoming canopy. It is the door you
 * go in through, and nothing more.
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

    if (kind === 'facade') {
      // A lid, because the facade's top deck is not somewhere you ever stand.
      const lid = new Group();
      lid.name = 'facade-roof';
      lid.position.y = BUILDING_FLOOR_COUNT * BUILDING_FLOOR_HEIGHT;
      buildFacadeRoof(plan, lid);
      this.group.add(lid);

      const ground = this.floorGroups[0];
      if (ground) {
        ground.add(buildPlinth(plan));
        ground.add(buildEntranceSteps());
        buildEntranceCanopy(ground);
      }
    } else {
      const ground = this.floorGroups[0];
      if (ground) buildInteriorPorch(plan, ground);
      this.group.add(buildInteriorPlaza());
    }
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

  const sign = cuteSign({
    title: 'The Roof!',
    subtitle: 'mind the sky',
    glyph: '☁️',
    accent: PALETTE.markerSky,
    width: 4.2,
  });
  sign.position.set(0, 2.4, -oz + 0.9);
  roof.add(sign);
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

// -------------------------------------------------------------- facade roof

function buildFacadeRoof(plan: ShellPlan, roof: Group): void {
  const ox = outerX(plan);
  const oz = outerZ(plan);

  const slab = castAndReceive(
    new Mesh(
      extrudePlan([planRect(-ox - 0.5, ox + 0.5, -oz - 0.5, oz + 0.5)], 0.4),
      softMaterial(PALETTE.stonePinkLight, 0.85),
    ),
  );
  slab.position.y = -0.4;
  roof.add(slab);

  const pavilion = castAndReceive(
    new Mesh(new BoxGeometry(7.6, 2.7, 6.4), softMaterial(PALETTE.buildingWall, 0.78)),
  );
  pavilion.position.set(-6.5, 1.35, -1);
  roof.add(pavilion);

  const pavilionRoof = castAndReceive(
    new Mesh(new ConeGeometry(5.2, 2.2, 4), softMaterial(PALETTE.buildingRoofDeep, 0.72)),
  );
  pavilionRoof.position.set(-6.5, 3.75, -1);
  pavilionRoof.rotation.y = Math.PI / 4;
  roof.add(pavilionRoof);

  const lip = receiveOnly(
    new Mesh(
      extrudePlan(
        [
          planRect(-ox - 0.5, ox + 0.5, -oz - 0.5, -oz + 0.1),
          planRect(-ox - 0.5, ox + 0.5, oz - 0.1, oz + 0.5),
          planRect(-ox - 0.5, -ox + 0.1, -oz + 0.1, oz - 0.1),
          planRect(ox - 0.1, ox + 0.5, -oz + 0.1, oz - 0.1),
        ],
        0.85,
      ),
      softMaterial(PALETTE.buildingRoofDeep, 0.72),
    ),
  );
  roof.add(lip);

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
}

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

  const sign = cuteSign({
    title: 'Way Out',
    subtitle: 'back to the garden',
    glyph: '🌳',
    accent: PALETTE.markerMint,
    width: 4.4,
  });
  // Facing +Z like every other sign in the game: the boards are painted on one
  // face, so turning one round to "face into the room" shows its back and reads
  // as mirror writing.
  sign.position.set(0, 4.3, 1.9);
  porch.add(sign);
}
