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
  CAMERA_PITCH_DEGREES,
  BUILDING_WALL_THICKNESS,
  INTERIOR_HALF_X,
  INTERIOR_HALF_Z,
  INTERIOR_PLAZA_DROP,
  INTERIOR_PLAZA_RADIUS,
  PLAYER_RADIUS,
} from '../../core/constants';
import { KID_HEIGHT } from '../../art/models/kid';
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
  planRect,
  softMaterial,
} from './parts';
import { segmentsMinusGaps } from '../wallRuns';
import { buildCeilingBeams, castleFloorMaterial, castleWallMaterial } from './castleFabric';
import {
  buildCastleTurrets,
  buildMerlons,
  CASTLE_MERLON_WIDTH,
  CASTLE_STONE,
  rectangleMerlonSlots,
  spread,
  type MerlonSlot,
} from './castleMasonry';
import { FLOOR_SPACE_SPACING } from './floors';
import { CASTLE_MERLON_HEIGHT, CASTLE_WALL_HEIGHT } from './layout';
import {
  ENTRANCE_MAX_X,
  ENTRANCE_MIN_X,
  ENTRANCE_RAMP,
  INTERIOR_DOOR_MAX_X,
  INTERIOR_DOOR_MIN_X,
  LIFT_DOOR_MAX_Z,
  LIFT_DOOR_MIN_Z,
  LIFT_SHAFT,
  ROOF_PAVILION_HALF_X,
  ROOF_PAVILION_HALF_Z,
  ROOF_PAVILION_HEIGHT,
  ROOF_PAVILION_X,
  ROOF_PAVILION_Z,
  CASTLE_TURRET_FOOTPRINT_RADIUS,
  ROOF_PARAPET_THICKNESS,
  roofTurretSpots,
  TOP_DECK,
  TOWER_HEIGHT,
} from './layout';
import { SLIDE_PLAN } from '../slide/plan';
import { CHUTE_ENVELOPE, SlideRide } from './SlideRide';

/** Decoration that takes light but is not worth a slot in the shadow pass. */
function receiveOnly(mesh: Mesh): Mesh {
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

const HALF_WALL = BUILDING_WALL_THICKNESS / 2;
/** Header band under each deck, so the glass stops short of the ceiling. */
const GLASS_TOP = BUILDING_FLOOR_HEIGHT - 0.34;


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
}
// There was a `slideGap` here, for a hole in the top storey's south wall that
// the ginormous slide would leave through. It was dead — its only readers were
// interior-only builders that the facade's `buildCastle` early-return never
// reaches, while the interior always passed `null` — and it was dead for a
// good reason: the slide crosses that wall plane *above* the castle, clearing
// the crenellations by 3.44 m under its own floor. Deleted rather than
// documented; `theGinormousSlideLeavesOverTheBattlements` holds the air open.

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
      }
    : {
        halfX: BUILDING_HALF_X,
        halfZ: BUILDING_HALF_Z,
        enclosedDecks: BUILDING_FLOOR_COUNT,
        doorMinX: ENTRANCE_MIN_X,
        doorMaxX: ENTRANCE_MAX_X,
        holes: false,
      };
}

/**
 * The tower itself: five decks, their walls, the roof and the front door.
 *
 * Each deck is one extruded slab with its stair, escalator, trampoline
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

  readonly kind: ShellKind;

  constructor(kind: ShellKind = 'interior') {
    this.kind = kind;
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
      // **Sideways, not upwards.** This was `position.y = deck *
      // BUILDING_FLOOR_HEIGHT` — five slabs stacked in one coordinate system,
      // told apart by height. Since #377/#380 each floor is its own space, so
      // each group steps `FLOOR_SPACE_SPACING` along +X instead and every
      // floor's walking surface sits at the same `y`.
      //
      // Everything *inside* a floor group is untouched by that: a prop at
      // floor-local (x, z) is still at floor-local (x, z), which is why the
      // dressing, the shops, the toilets and `check:castle` all index by deck
      // exactly as before. The offset is the group's, not theirs — the same
      // reason moving the whole interior six hundred metres cost almost no
      // code, applied one level down.
      floor.position.x = deck * FLOOR_SPACE_SPACING;
      this.floorGroups.push(floor);
      this.group.add(floor);

      floor.add(buildDeck(plan, deck));

      if (deck < plan.enclosedDecks) {
        // A plaza disc per *enclosed* floor, because each one now floats over
        // its own patch of nothing and its windows have to look out on
        // something. There used to be one for the whole stack, and — until
        // #455 — one for the roof garden too. See {@link buildInteriorPlaza}
        // for why the roof is now the exception.
        floor.add(buildInteriorPlaza());
        floor.add(buildWalls(plan, deck, BUILDING_PARAPET));
        floor.add(buildGlass(plan, deck));
        floor.add(buildTrimBand(plan, deck));
        floor.add(buildCornerPillars(plan));
        for (const mesh of buildWindows(plan, deck)) floor.add(mesh);
        const beams = buildCeilingBeams(deck);
        if (beams) floor.add(beams);
      } else {
        buildRoofTerrace(plan, floor);
      }
    }

    const ground = this.floorGroups[0];
    if (ground) buildInteriorPorch(plan, ground);
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
  // **No holes.** Every floor is one unbroken slab now: the shafts the stairs,
  // the escalator, the trampoline and the helter-skelter needed are gone with
  // them, and the lift does not travel through anything. `parts.ts`'s
  // `planHole` lost its last caller with them.
  const slab = planRect(-ox, ox, -oz, oz);
  // **The lift alcove's own floor, part of the same slab.** The alcove hangs
  // off the west wall, past the plate — so before #450 there was simply nothing
  // under it, and the lift's car (whose own floor plate is only 2.2 m deep and
  // starts 0.62 m out from the wall) would have stood over a 0.40 m slot of
  // open sky at its threshold. One more rectangle in the same extrusion rather
  // than a separate mesh: same material, same draw call, and no seam where two
  // plates meet. `LIFT_SHAFT` is the footprint `LIFT_PIT` already registers as
  // walkable, so the floor you can see and the floor you can stand on are the
  // same rectangle by construction. It starts at the wall's *outer* face
  // rather than at `LIFT_SHAFT.maxX`, so the two rectangles abut instead of
  // overlapping — two coplanar top faces in one extrusion z-fight.
  //
  // **The roof deck is cut back to where its curtain wall begins** (#467) —
  // see {@link roofDeckShapes}. Everything else is the plain slab.
  const isRoof = plan.holes && deck === TOP_DECK;
  const plate = isRoof ? roofDeckShapes(plan) : [slab];
  const shapes = plan.holes
    ? [...plate, planRect(LIFT_SHAFT.minX, -ox, LIFT_SHAFT.minZ, LIFT_SHAFT.maxZ)]
    : plate;

  // `plan.holes` is true only for the interior — the facade out in the garden
  // is a solid block and takes none of this. The roof terrace is genuinely
  // outdoors, so it keeps its plain pink paving rather than being flagged.
  const isCastleFloor = plan.holes && deck !== TOP_DECK;
  const colour =
    deck === TOP_DECK && plan.holes ? PALETTE.stonePinkLight : storeyColours(deck).floor;
  const mesh = new Mesh(
    extrudePlan(shapes, BUILDING_SLAB),
    isCastleFloor ? castleFloorMaterial(colour) : interiorMaterial(colour, 0.82),
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
  for (const [start, end] of segmentsMinusGaps(-ox, ox, southGaps)) {
    shapes.push(planRect(start, end, plan.halfZ - HALF_WALL, oz));
  }

  // East face: never interrupted since the lift moved off it (#450).
  shapes.push(
    planRect(plan.halfX - HALF_WALL, ox, -plan.halfZ + HALF_WALL, plan.halfZ - HALF_WALL),
  );

  // West face: the way into the lift, on every floor. It is the **far** wall
  // from the fixed camera, which is the whole reason the lift is in it — see
  // `layout.ts`'s `LIFT_WALL_X`.
  for (const [start, end] of segmentsMinusGaps(-plan.halfZ + HALF_WALL, plan.halfZ - HALF_WALL, [
    [LIFT_DOOR_MIN_Z, LIFT_DOOR_MAX_Z],
  ])) {
    shapes.push(planRect(-ox, -plan.halfX + HALF_WALL, start, end));
  }

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
  const colour = storeyColours(deck).wall;
  const mesh = castAndReceive(
    new Mesh(
      extrudePlan(wallShapes(plan, deck), height),
      // Coursed stone inside the castle; the facade keeps its flat paint,
      // which is what makes it read as one storybook mass from across the
      // park rather than as a wall with a texture on it.
      plan.holes ? castleWallMaterial(colour) : softMaterial(colour, 0.78),
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

  for (const x of spread(plan.halfX, 3.4)) {
    slots.push({ x, z: -oz - outward, yaw: 0 });
    if (!blocked(x, southGaps)) slots.push({ x, z: oz + outward, yaw: Math.PI });
  }
  for (const z of spread(plan.halfZ, 3.2)) {
    if (!blocked(z, [[LIFT_DOOR_MIN_Z, LIFT_DOOR_MAX_Z]])) {
      slots.push({ x: -ox - outward, z, yaw: Math.PI / 2 });
    }
    slots.push({ x: ox + outward, z, yaw: -Math.PI / 2 });
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
 * **The one opening in the roof garden's south (+Z) edge** — where the
 * ginormous slide leaves.
 *
 * Four things step round it: the parapet kerb, the merlons standing on the
 * kerb, the curtain wall falling away below it, and the deck plate itself
 * ({@link roofDeckShapes}), which has to *fill* the gap the other three leave.
 * They used to say it four times over in their own inline literals; a moved
 * doorway now moves all four, which is what CLAUDE.md's "one owner; everyone
 * else asks" is for.
 */
const ROOF_SLIDE_GAPS: readonly (readonly [number, number])[] = [
  [SLIDE_PLAN.roofDoorMinX, SLIDE_PLAN.roofDoorMaxX],
];

/**
 * **The roof deck's plate, stopping where the curtain wall starts** (#467).
 *
 * Jim, on the roof garden: *"the roof has an issue we've seen before of
 * coplanar faces upsetting z-index — in this case the edges of the floor and
 * the walls. But really the floor doesn't need edges rendered."*
 *
 * The deck is a 0.3 m slab hanging under the walking surface, and
 * {@link buildRoofCurtainWalls} hangs 18 m of wall off the same two edges,
 * its top at the same `y = 0`. So along the east and south runs the slab's
 * outer 0.6 m sat **inside** the wall: their outer faces were the same plane
 * facing the same way, and the depth buffer picked a different winner as the
 * camera moved. That strobing 0.3 m strip under the battlement is what a child
 * sees.
 *
 * So the plate stops at the wall's inner face and the wall itself fills the
 * band — no offset to maintain, and the deleted faces were never visible
 * (ART_DIRECTION §7). Measured after the cut: the roof's four
 * `deck-2`/`roof-curtain-wall` coplanar pairs are gone.
 *
 * The two runs the wall does *not* cover keep their full plate: the north and
 * west edges have only the parapet standing on them, and nothing below to
 * argue with.
 */
function roofDeckShapes(plan: ShellPlan): Shape[] {
  const ox = outerX(plan);
  const oz = outerZ(plan);
  const band = ROOF_PARAPET_THICKNESS;
  const shapes = [planRect(-ox, ox - band, -oz, oz - band)];
  // Where the wall steps aside for the slide there is nothing to hide the
  // plate — and nothing to stand on either, so the plate carries on to the
  // edge rather than leaving a notch in the floor at the slide's mouth. Read
  // from the list the wall steps round, so the two cannot disagree.
  for (const [start, end] of ROOF_SLIDE_GAPS) {
    shapes.push(planRect(Math.max(start, -ox), Math.min(end, ox - band), oz - band, oz));
  }
  return shapes;
}

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
  const band = ROOF_PARAPET_THICKNESS;
  shapes.push(planRect(-ox, ox, -oz, -oz + band));
  for (const [start, end] of segmentsMinusGaps(-ox, ox, ROOF_SLIDE_GAPS)) {
    shapes.push(planRect(start, end, oz - band, oz));
  }
  for (const [start, end] of segmentsMinusGaps(-oz + band, oz - band, [
    [LIFT_DOOR_MIN_Z, LIFT_DOOR_MAX_Z],
  ])) {
    shapes.push(planRect(-ox, -ox + band, start, end));
  }
  shapes.push(planRect(ox - band, ox, -oz + band, oz - band));

  // **The parapet is a battlement now** (#462). Jim, standing on the roof
  // garden: *"it needs the rooftop's near side to look like the external of the
  // castle … ramparts, same colour as the castle viewed from the outside."*
  //
  // The lip is the same ring it always was, in the facade's own wall cream
  // rather than its roof colour, but it is cut down to {@link ROOF_CRENEL_BASE}
  // and merlons stand on it — the *same* merlons the curtain wall out in the
  // garden wears, from `castleMasonry.ts`, so the two cannot drift.
  //
  // **The battlement's top ends up 0.7 m higher than the plain lip did and she
  // can see out better, not worse.** The crenels between the merlons run right
  // down to 0.55 m, where the old parapet was solid to 1.05 m — so there is
  // more sky and more cloud (#455) through the gaps than there was over the
  // top, and the silhouette gains the thing that says "castle" at a glance.
  const lip = castAndReceive(
    new Mesh(extrudePlan(shapes, ROOF_CRENEL_BASE), softMaterial(CASTLE_STONE, 0.78)),
  );
  lip.name = 'roof-parapet-lip';

  // Grouped under the name `check:castle` measures, because the question it
  // asks — *how high is the rail she looks over* — is answered by the merlons
  // now, not by the kerb they stand on. `Box3.setFromObject` walks children, so
  // one group is one honest answer rather than two half ones.
  const parapet = new Group();
  parapet.name = 'roof-parapet';
  parapet.add(lip);
  parapet.add(
    buildMerlons(
      'roof-battlement',
      // The merlon run keeps off the slide's gap and the lift's, the same two
      // openings the kerb below it steps round — asked of `segmentsMinusGaps`
      // rather than restated, so a moved doorway takes its merlons with it.
      roofMerlonSlots(plan),
      ROOF_CRENEL_BASE,
    ),
  );
  roof.add(parapet);

  // Turrets at the corners, and the castle's own wall dropping away below them.
  roof.add(buildRoofTurrets());
  roof.add(buildRoofCurtainWalls(plan));

  // A pavilion at the west end, to break up the terrace and give the roof a
  // shady corner. Same silhouette it always had, only bigger and standing on a
  // floor you can now walk about on.
  const pavilion = buildRoofPavilion(1);
  pavilion.position.set(ROOF_PAVILION_X, 0, ROOF_PAVILION_Z);
  roof.add(pavilion);

  roof.add(buildSlideMouth(plan));

  roof.add(
    buildRoofPlanters(plan, 1, {
      x: ROOF_PAVILION_X,
      z: ROOF_PAVILION_Z,
      halfX: ROOF_PAVILION_HALF_X,
      halfZ: ROOF_PAVILION_HALF_Z,
    }),
  );
}

/**
 * How high the solid kerb under the merlons stands.
 *
 * Low enough that a crenel is a real hole a six-year-old sees sky through —
 * which is the whole point of #455's clouds — and high enough that the edge of
 * the deck still reads as stone rather than as a row of loose teeth. Just over
 * half a merlon.
 */
const ROOF_CRENEL_BASE = 0.55;

/**
 * The merlon slots round the roof garden's parapet, stepping round the two
 * openings in it.
 *
 * The openings are asked of the same numbers the kerb steps round, so a merlon
 * can never end up standing in the slide's doorway.
 */
function roofMerlonSlots(plan: ShellPlan): MerlonSlot[] {
  const ox = outerX(plan);
  const oz = outerZ(plan);
  const slots = rectangleMerlonSlots(ox, oz, plan.halfX, plan.halfZ);
  const half = CASTLE_MERLON_WIDTH / 2;
  const clearOf = (
    along: number,
    gaps: readonly (readonly [number, number])[],
  ): boolean => !gaps.some(([start, end]) => along + half > start && along - half < end);
  return slots.filter((slot) => {
    // The slide leaves through the south (+Z) run; the lift door is in the
    // west (−X) one.
    if (slot.z === oz) return clearOf(slot.x, ROOF_SLIDE_GAPS);
    if (slot.x === -ox) return clearOf(slot.z, [[LIFT_DOOR_MIN_Z, LIFT_DOOR_MAX_Z]]);
    return true;
  });
}

/**
 * **Where a roof-garden turret's cone starts** — at the top of the battlement.
 *
 * The first cut stood the shaft on the paving and carried it up past the
 * tallest child in the game, because she could walk under the cone. She cannot
 * any more — {@link roofTurretSpots} pushes the turret out past the parapet's
 * inner face — and the number that binds is now what *reads* rather than what
 * clears her hat.
 *
 * The eaves sit exactly on the merlons' tops, so the turret grows out of the
 * rampart the way a corner tower does rather than standing behind it on the
 * floor. It is also 1.8 m less cone hanging over the garden, and that is the
 * point: at the fixed isometric a solid this size hides `height × 1.28` metres
 * of floor up-frame of itself, and the taller version swallowed a child five
 * metres inboard of the corner. Measured on screen, not reasoned about.
 */
const ROOF_TURRET_EAVES = ROOF_CRENEL_BASE + CASTLE_MERLON_HEIGHT;

/**
 * **How tall a roof-garden turret's cone is — decided by the camera, not by
 * taste.**
 *
 * At the fixed isometric a solid hides everything within `height ÷ tan(38°)`
 * up-frame of itself, and up-frame from a corner turret is the corner of the
 * garden a child walks to in order to lean on the rampart. The facade's own
 * 4.2 m cone put her whole body behind it from eight metres away; that was
 * measured on screen, twice, and it is the second time this exact defect has
 * been found here (the enterable pavilion was reverted for it).
 *
 * So the height is derived from the thing that must stay visible. The nearest
 * floor to a turret is {@link CASTLE_TURRET_FOOTPRINT_RADIUS} plus her own
 * radius from its middle; a camera ray grazing the turret's tip passes over
 * that spot at `tip − distance × tan(38°)`; and her head has to be above it.
 * Rearranged, that caps the tip, and the cone is what is left after the eaves.
 *
 * It comes out a little under three metres — a stubby witch's hat rather than
 * the facade's tall one, which is right for something seen from ten metres
 * instead of a hundred.
 *
 * **The cone's apex has to *be* the tip for this to hold**, which is why these
 * turrets carry no mast (`withMast: false`). The first version kept the
 * facade's mast and finial, 1.9 m of them above the apex, and the finial was
 * measured drawn across a child's chest at 8.12 m — the cap was correct and it
 * was capping the wrong thing.
 */
const ROOF_TURRET_ROOF = (() => {
  const nearestFloor = CASTLE_TURRET_FOOTPRINT_RADIUS + PLAYER_RADIUS;
  const tipCap = nearestFloor * Math.tan((CAMERA_PITCH_DEGREES * Math.PI) / 180) + KID_HEIGHT;
  return Math.max(1.2, tipCap - ROOF_TURRET_EAVES);
})();

/**
 * How far the roof garden's curtain wall — and the turret shafts standing in
 * it — carry on down past the deck.
 *
 * Far enough that its foot is never in frame: from a child's eye at the
 * parapet the camera's 38° sight line reaches the bottom of an 18 m drop some
 * 23 m out, and the orthographic frame is only about 12 m of half-width
 * (measured in #455). `roofClouds.ts`'s deep tier drifts from −9 m to −26 m
 * across the same band, so what a child actually sees at the bottom of the
 * wall is weather.
 */
const ROOF_CURTAIN_DROP = 18;

/**
 * Corner turrets on the roof garden — the same turret the facade wears, on the
 * plate a child is standing on.
 *
 * Their shafts carry on {@link ROOF_CURTAIN_DROP} below the deck, so the wall
 * falling away outside has something at its corners rather than being a flat
 * cliff of cream.
 */
function buildRoofTurrets(): Group {
  const group = buildCastleTurrets({
    prefix: 'roof-turret',
    spots: roofTurretSpots(),
    baseY: 0,
    bodyHeight: ROOF_TURRET_EAVES,
    bodyBelow: ROOF_CURTAIN_DROP,
    roofHeight: ROOF_TURRET_ROOF,
    withMast: false,
  });
  group.name = 'roof-turrets';
  return group;
}

/**
 * **The castle wall, falling away below the roof garden's near edges** (#462).
 *
 * Jim asked for *"walls reaching down"*, and only for the side he can see:
 * *"the far side being hidden can be ignored"*. The camera is a fixed
 * isometric looking from +X +Z, so those two runs — the east (+X) and south
 * (+Z) faces — are the ones a child looks down over. The −X and −Z faces are at
 * the *top* of the frame with their own parapet in front of them, so a wall
 * there could never be drawn into a single frame; building it would be two more
 * extrusions of nothing.
 *
 * Flat paint in the facade's own `buildingWall` cream rather than the interior's
 * coursed ashlar, because this is the castle *seen from outside* — the same
 * decision `buildWalls` makes for the facade, and the reason the castle reads as
 * one storybook mass from across the park.
 */
function buildRoofCurtainWalls(plan: ShellPlan): Mesh {
  const ox = outerX(plan);
  const oz = outerZ(plan);
  const shapes: Shape[] = [
    // The east face, full depth.
    planRect(ox - ROOF_PARAPET_THICKNESS, ox, -oz, oz),
    // The south face, stepping round the gap the ginormous slide leaves
    // through — the same numbers the parapet above it steps round.
    ...segmentsMinusGaps(-ox, ox - ROOF_PARAPET_THICKNESS, ROOF_SLIDE_GAPS).map(([start, end]) =>
      planRect(start, end, oz - ROOF_PARAPET_THICKNESS, oz),
    ),
  ];

  const wall = new Mesh(
    extrudePlan(shapes, ROOF_CURTAIN_DROP),
    softMaterial(CASTLE_STONE, 0.78),
  );
  wall.name = 'roof-curtain-wall';
  // Below everything, lit but never a caster: a shadow from an 18 m cliff falls
  // on nothing at all, and the shadow pass is already 57% of draw calls (#251).
  wall.castShadow = false;
  wall.receiveShadow = true;
  wall.position.y = -ROOF_CURTAIN_DROP;
  return wall;
}

/**
 * **The roof garden's pavilion — one builder, two castles** (#462).
 *
 * Jim: *"when out in the park there should be a roof on the castle with a few
 * of the features from the actual roof garden on top of it … maybe just the
 * floor of the roof garden and the pavilion."*
 *
 * So the same shape stands in two places, and the two are **disjoint spaces**
 * (#377/#380) — the roof garden's plate is 300 m from the facade's. Nothing
 * about a position can be shared between them; the *shape* can, and this is it.
 * A second pavilion modelled on the facade is precisely the defect CLAUDE.md
 * names most often.
 *
 * `scale` is the only thing that differs. The facade's plate is 24 × 18 m
 * against the interior's 42.4 × 31.1 (GAME_DESIGN item 30c: they are different
 * worlds at different sizes), so the facade's copy is cut down by that same
 * ratio and reads as the same building rather than as a shed that has swallowed
 * a castle. See {@link FACADE_SCALE}.
 *
 * **A filled block, and it stays one** (#459). Jim: *"Why does the roof
 * garden have a big shed-like building on it that you can run through?"* —
 * so it is solid, `registerPavilionCollision` off these same numbers. It was
 * tried as four walls with a doorway, so the shady corner would be somewhere
 * she could stand *in*, and that is a bigger job than it looks: the pyramid
 * roof is opaque from beneath and a child who walks inside simply
 * **disappears** under it. Making her visible in there means the hotel's
 * `overhangFader`, which is a feature rather than a collider, and Jim's own
 * words were *"the pavilion is fine but should be solid"*. So it is solid, and
 * an enterable pavilion is its own ticket.
 *
 * Origin at the pavilion's own base, centred in plan, so a caller sets
 * `position` and nothing else — ART_DIRECTION §7's rule for an asset, applied
 * to a piece of world geometry for the same reason.
 */
export function buildRoofPavilion(scale: number, withMast = true): Group {
  const group = new Group();
  group.name = 'roof-pavilion-group';

  const pavilion = castAndReceive(
    new Mesh(
      new BoxGeometry(
        ROOF_PAVILION_HALF_X * 2 * scale,
        ROOF_PAVILION_HEIGHT * scale,
        ROOF_PAVILION_HALF_Z * 2 * scale,
      ),
      softMaterial(PALETTE.buildingWall, 0.78),
    ),
  );
  pavilion.name = 'roof-pavilion';
  pavilion.position.y = (ROOF_PAVILION_HEIGHT / 2) * scale;
  group.add(pavilion);

  // ConeGeometry with four segments is a pyramid, and its radius is the
  // *circum*radius — size it off the box's diagonal or it swamps the roof.
  const pavilionRoof = castAndReceive(
    new Mesh(
      new ConeGeometry(
        (Math.hypot(ROOF_PAVILION_HALF_X, ROOF_PAVILION_HALF_Z) + 0.5) * scale,
        2.4 * scale,
        4,
      ),
      softMaterial(PALETTE.buildingRoofDeep, 0.72),
    ),
  );
  pavilionRoof.name = 'roof-pavilion-roof';
  pavilionRoof.position.y = 4.1 * scale;
  pavilionRoof.rotation.y = Math.PI / 4;
  group.add(pavilionRoof);

  // Every building in this park has a bobble on top — except the copy on the
  // castle's own roof out in the garden, which is why this is optional.
  //
  // That castle is 24 m across and its battlements top out at
  // `CASTLE_MASONRY_TOP`; the ginormous slide's air begins 3.44 m above them,
  // and `theGinormousSlideLeavesOverTheBattlements` holds it open on every
  // seed. A mast and a bobble scaled for a 42 m roof garden would stand 5 m
  // over the parapet — the tallest thing on the castle, poking into a ride's
  // envelope, to say something the pyramid roof already says. The roof garden's
  // own pavilion keeps both.
  if (!withMast) return group;

  const mast = receiveOnly(
    new Mesh(
      new CylinderGeometry(0.12 * scale, 0.16 * scale, 3.4 * scale, 8),
      softMaterial(PALETTE.woodLight, 0.85),
    ),
  );
  mast.name = 'roof-pavilion-mast';
  mast.position.y = 6.6 * scale;
  group.add(mast);

  const bobble = receiveOnly(
    new Mesh(new SphereGeometry(0.62 * scale, 18, 14), softMaterial(PALETTE.markerPink, 0.5)),
  );
  bobble.name = 'roof-pavilion-bobble';
  bobble.position.y = 8.5 * scale;
  group.add(bobble);

  return group;
}

/**
 * **The top of the ginormous slide, joined to the edge of the roof.**
 *
 * Jim, having ridden it on 5 August 2026: *"getting on the slide should look
 * like the start of the slide attached to the edge of the roof, not just a
 * circle to walk onto"*. It was exactly a circle to walk onto — an
 * `entrancePad` cylinder at `SLIDE_PLAN.entryX/entryZ` and, nine metres further
 * south, an unexplained notch in the parapet. Nothing joined the two, so
 * boarding read as standing on a marker and being teleported.
 *
 * ### Why the answer is not "move the chute's start"
 *
 * The obvious reading of Jim's note is that the garden chute should begin lower,
 * at the battlements rather than 3.44 m over them. It should not, and
 * `theGinormousSlideLeavesOverTheBattlements` is the reason: that air is what
 * keeps the ride out of the masonry, it is measured on every seed, and lowering
 * `START_Y` to meet the stonework is the one change that invariant exists to
 * refuse.
 *
 * The thing Jim is *looking at* when he boards is not the garden chute at all.
 * The roof he steps off is the **interior's** roof — `Shell.ts` calls the two
 * "disconnected worlds", and the launch is deliberately a change of space (see
 * `Building.startGiantSlide`). So the fix belongs on the side he can see: give
 * the interior terrace the slide's own top, running from the boarding pad out
 * through the gap in the parapet and tipping over the edge. The ride then reads
 * as one continuous thing — you get into the top of a slide and it takes you
 * away — without moving a single metre of the garden chute or touching the air
 * the invariant holds open.
 *
 * ### One owner for the gap
 *
 * The mouth is centred on `SLIDE_PLAN.roofDoorMinX/MaxX` — the **same** numbers
 * that cut the notch in the parapet a few lines above — rather than on
 * `entryX`, which is where they both come from. Two things that must line up
 * read one source, so the mouth cannot end up beside its own doorway.
 */
function buildSlideMouth(plan: ShellPlan): Group {
  const oz = outerZ(plan);
  const x = (SLIDE_PLAN.roofDoorMinX + SLIDE_PLAN.roofDoorMaxX) / 2;
  // **Behind** the pad, not in front of it. Jim moved the boarding point to
  // roughly a metre from the edge (`ROOF_ENTRY_INSET`), so there is no longer
  // any roof left to put a chute on *south* of the pad — the lip has to come up
  // to meet her from inboard and carry her straight out over the parapet.
  //
  // Far enough back that the pad still reads as the marked spot you stand on
  // rather than being swallowed: the pad is 1.2 m in radius and the trough
  // floor sits above it, so a lip starting under the pad's own centre would
  // hide the "press here" cue completely.
  const startZ = SLIDE_PLAN.entryZ - 1.6;

  // The trough floor sits `CHUTE_ENVELOPE.below` under the centre line, so a
  // centre line at this height puts the floor just on the terrace deck rather
  // than sunk into it or hovering over it.
  const deck = CHUTE_ENVELOPE.below + 0.14;

  const mouth = new SlideRide(
    [
      // A flat lip you step into, level all the way to the parapet…
      new Vector3(x, deck, startZ),
      new Vector3(x, deck, SLIDE_PLAN.entryZ),
      new Vector3(x, deck, oz - 0.3),
      // …then it tips as it leaves the gap in the parapet…
      new Vector3(x, deck - 0.9, oz + 1.2),
      // …and falls away over the edge, which is what makes it read as attached
      // to the roof rather than sitting on it.
      new Vector3(x, deck - 3.2, oz + 2.7),
      new Vector3(x, deck - 6.2, oz + 3.9),
    ],
    { name: 'slide-roof-mouth' },
  );
  return mouth.group;
}

/**
 * A ring of pastel planters so the terrace is not a blank field from above.
 *
 * Sized entirely off the plan it is handed, which is what lets the castle's own
 * roof (#462) take the same ring at facade scale without a second set of
 * numbers — the ellipse simply comes out 24 × 18 m instead of 42 × 31.
 *
 * `pavilion` is the footprint to step round, in the same local metres. On the
 * roof garden the ring misses the pavilion by 0.7 m and this filter drops
 * nothing; on the facade's much tighter plate it would otherwise stand two mint
 * spheres inside the shed. Asked rather than assumed, because "it happens to
 * miss" is not a mechanism.
 */
function buildRoofPlanters(
  plan: ShellPlan,
  scale: number,
  pavilion: { x: number; z: number; halfX: number; halfZ: number },
): InstancedMesh {
  const count = 18;
  const spots: Vector3[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = (i / count) * Math.PI * 2;
    const x = Math.cos(t) * (outerX(plan) - 2.2 * scale);
    const z = Math.sin(t) * (outerZ(plan) - 2.2 * scale);
    const clear =
      Math.abs(x - pavilion.x) > pavilion.halfX + 0.62 * scale ||
      Math.abs(z - pavilion.z) > pavilion.halfZ + 0.62 * scale;
    if (clear) spots.push(new Vector3(x, 0.35 * scale, z));
  }

  const planters = new InstancedMesh(
    new SphereGeometry(0.62 * scale, 12, 9),
    softMaterial(PALETTE.markerMint, 0.55),
    Math.max(1, spots.length),
  );
  planters.name = 'roof-planters';
  planters.castShadow = false;
  planters.receiveShadow = true;
  planters.count = spots.length;

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const scaling = new Vector3(1, 0.8, 1);
  spots.forEach((position, index) => {
    matrix.compose(position, rotation, scaling);
    planters.setMatrixAt(index, matrix);
  });
  planters.instanceMatrix.needsUpdate = true;
  return planters;
}

/**
 * The interior's own ground: a soft green disc a metre below deck zero, with a
 * skirt round its rim so you can never see under it.
 *
 * The building's space has no terrain — it is not on the hilltop, it is not
 * anywhere. Without this the enclosed floors' windows look out on a void.
 *
 * It is a **disc**, and the radius matters, for exactly the reason the garden is
 * a diorama on a hilltop (see `constants.ts`): the camera is orthographic, so an
 * endless ground plane fills the frame forever and the sky is never seen. So the
 * ground stops at roughly the soft play boundary, by which distance the fog has
 * already dissolved its edge into the horizon colour.
 *
 * ## The roof garden does not get one — issue #455
 *
 * It used to. Jim, riding the lift up: *"There is a green floor for some reason
 * below the roof garden — it is supposed to be high in the air."* He was looking
 * at this disc: a metre and a bit under a terrace that is meant to be fifty
 * metres up, filling the whole lower half of the frame the moment the camera
 * cleared the parapet, and leaving no sky in shot for the day/night cycle to
 * show itself in.
 *
 * The paragraph that used to stand here claimed the opposite — *"stand at the
 * north-west parapet and there is open sky above the rim"* — and it was true of
 * the stacked building it was written for, where the roof was five storeys over
 * this disc and the drop did the work. Since #377/#380 every floor stands at the
 * same `y` in its own space, so the roof sat one metre over its own lawn.
 *
 * What replaces it is **nothing plus weather**: sky under the parapet, and
 * `building/roofClouds.ts` drifting past below and beside it. Nothing walkable
 * changes — `registerInteriorCollision` walls the roof's whole perimeter, so the
 * disc was scenery and only ever scenery there.
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

// A merlon's width, depth and pitch now live in `castleMasonry.ts` with the
// battlement builder itself, because the roof garden wears the same one (#462).

// TOWER_RADIUS, TOWER_HEIGHT, TOWER_ROOF_HEIGHT, TOWER_ROOF_OVERHANG and
// TOWER_BASE_FLARE now live in `layout.ts`. `slide/plan.ts` has to route the
// ginormous slide around these solids and cannot import this file — this file
// imports the plan, so it would be a cycle. See `CASTLE_TOWERS` there.

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
  group.add(buildCastleRoofGarden(plan));
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

/**
 * **How much smaller the castle in the garden is than the space inside it.**
 *
 * The facade's plate is 24 m across; the interior's is 42.43 (GAME_DESIGN item
 * 30c — they are disconnected worlds, and the inside is deliberately far bigger
 * than the outside). Anything copied from the roof garden onto the castle's own
 * roof is cut by this, so it reads as the same object seen from further away
 * rather than as furniture that has outgrown the building.
 *
 * Derived from the two plates rather than eyeballed: shrink either and the
 * pavilion on the roof moves with it.
 */
const FACADE_SCALE = BUILDING_HALF_X / INTERIOR_HALF_X;

/**
 * **The castle wears its roof garden** (issue #462).
 *
 * Jim, having stood on the roof garden: *"when out in the park there should be
 * a roof on the castle with a few of the features from the actual roof garden
 * on top of it, if not a perfect reproduction. Maybe just the floor of the roof
 * garden and the pavilion."*
 *
 * So: the garden's pink paving, its pavilion and its ring of mint planters,
 * standing on a deck level with the top of the curtain wall. Three things, all
 * of them **the roof garden's own builders** rather than new models — which is
 * the point of the ticket as much as the look is.
 *
 * ## Where the deck sits, and why that is the wall top exactly
 *
 * Level with {@link CASTLE_WALL_HEIGHT}, so the merlons that were already there
 * become this roof's parapet and nothing new has to be invented to edge it.
 * That is also the same relationship the roof garden has with its own
 * battlement, which is what makes the two read as the same place.
 *
 * Two things it has to stay clear of, both measured rather than asserted:
 *
 * - **the battlements stand proud of it**, so `parkFacts.castleMasonryTopY`
 *   still measures the crenellations and the ginormous slide's clearance
 *   invariant is unmoved. The deck's top is `CASTLE_MERLON_HEIGHT` below the
 *   merlons' tops;
 * - **the Sky Cruiser flies underneath.** Its openings' head is at 7.65 m
 *   (`castleWindows.ts`, which asserts there that it is below the wall), and
 *   this slab's underside is `BUILDING_SLAB` below the wall top — 8.50 m. The
 *   coaster passes through the courtyard with the roof over it, exactly as it
 *   passed through the open courtyard before.
 *
 * ## It is not the "lid" this castle was rebuilt to get rid of
 *
 * {@link buildCourtyard}'s note says a flat cap across the whole footprint is
 * "the top of a building look this rebuild removes", and it was right about a
 * *flat cap*. What stands here is a garden — paving, a pavilion with a mast and
 * a bobble on it, and a ring of planters — seen over a crenellated wall. The
 * courtyard floor stays where it is underneath, because the coaster still flies
 * through that space and wants a floor beneath it.
 */
function buildCastleRoofGarden(plan: ShellPlan): Group {
  const group = new Group();
  group.name = 'castle-roof-garden';

  // Inside the wall faces, so the slab meets the masonry rather than poking
  // out through it.
  const innerX = plan.halfX - HALF_WALL;
  const innerZ = plan.halfZ - HALF_WALL;

  // The roof garden's own paving, in the roof garden's own colour — `buildDeck`
  // gives the top deck `stonePinkLight`, and this is that same floor.
  const deck = new Mesh(
    extrudePlan([planRect(-innerX, innerX, -innerZ, innerZ)], BUILDING_SLAB),
    interiorMaterial(PALETTE.stonePinkLight, 0.82),
  );
  // **Never `castle-wall-`.** `parkFacts.ts` matches that prefix to find the
  // top of the castle's stonework; a deck that fell into it would be measured
  // as the battlements. See `castleFabric.ts` for the afternoon that cost.
  deck.name = 'castle-roof-deck';
  deck.receiveShadow = true;
  deck.castShadow = false;
  deck.position.y = CASTLE_WALL_HEIGHT - BUILDING_SLAB;
  group.add(deck);

  // The pavilion, at the same *relative* spot on the plate it occupies
  // upstairs — the position is mapped, never copied, because these two plates
  // are different sizes and 300 m apart.
  const pavilionX = (ROOF_PAVILION_X / INTERIOR_HALF_X) * innerX;
  const pavilionZ = (ROOF_PAVILION_Z / INTERIOR_HALF_Z) * innerZ;
  const pavilion = buildRoofPavilion(FACADE_SCALE, false);
  pavilion.position.set(pavilionX, CASTLE_WALL_HEIGHT, pavilionZ);
  group.add(pavilion);

  const planters = buildRoofPlanters(plan, FACADE_SCALE, {
    x: pavilionX,
    z: pavilionZ,
    halfX: ROOF_PAVILION_HALF_X * FACADE_SCALE,
    halfZ: ROOF_PAVILION_HALF_Z * FACADE_SCALE,
  });
  planters.name = 'castle-roof-planters';
  planters.position.y = CASTLE_WALL_HEIGHT;
  group.add(planters);

  return group;
}

/**
 * The battlement: a merlon standing on top of the wall at every slot, one draw
 * call.
 *
 * The merlon itself, its pitch and the 1.6 m each run is held back from the
 * corner towers all live in `castleMasonry.ts` now, because the roof garden
 * wears the same battlement (#462) and a second set of those numbers is this
 * repo's most-cited defect. **The name stays `crenellations`** — that exact
 * string is what `test/procgen/parkFacts.ts` matches to find the top of the
 * castle's stonework, which the ginormous slide's clearance invariant is built
 * on.
 */
function buildCrenellations(plan: ShellPlan): InstancedMesh {
  return buildMerlons(
    'crenellations',
    rectangleMerlonSlots(outerX(plan), outerZ(plan), plan.halfX, plan.halfZ),
    CASTLE_WALL_HEIGHT,
  );
}

/**
 * Four corner towers, each a cylinder, a conical roof, a little mast and a
 * flag — the part of the silhouette that reads as "castle" from clear across
 * the garden, well above the battlement line.
 *
 * Built from `castleMasonry.ts`'s shared turret so that the ones standing at
 * the corners of the roof garden are the same object (#462). **The mesh names
 * stay `tower-bodies` / `tower-roofs`**: `parkFacts.ts` matches those to find
 * the solids the ginormous slide has to miss.
 */
function buildCornerTowers(plan: ShellPlan): Group {
  const ox = outerX(plan);
  const oz = outerZ(plan);
  const group = buildCastleTurrets({
    prefix: 'tower',
    spots: [
      { x: -ox, z: -oz },
      { x: ox, z: -oz },
      { x: -ox, z: oz },
      { x: ox, z: oz },
    ],
    baseY: 0,
    bodyHeight: TOWER_HEIGHT,
  });
  group.name = 'castle-towers';
  return group;
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
