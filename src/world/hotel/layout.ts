import {
  HOTEL_BREAKFAST_Z,
  HOTEL_CORRIDOR_Z,
  HOTEL_GARDEN_Z,
  HOTEL_LOBBY_Z,
  HOTEL_OCEAN_Z,
  HOTEL_ORIGIN_X,
  HOTEL_SUITE_Z,
} from '../../core/constants';
import { PALETTE } from '../../core/palette';
import {
  SPACE_HOTEL_BREAKFAST,
  SPACE_HOTEL_CORRIDOR,
  SPACE_HOTEL_GARDEN,
  SPACE_HOTEL_LOBBY,
  SPACE_HOTEL_OCEAN,
  SPACE_HOTEL_SUITE,
  type SpaceId,
} from '../spaces';
import type { PortalBand } from '../tapSpacing';

/**
 * The Land Hotel's floor plan — rooms as data, in each room's own local
 * metres (origin at the room's centre; +Z is the same world +Z everywhere,
 * so nothing ever rotates between spaces).
 *
 * Eleri's brief (issue #236) mapped onto Jim's ruling that **every room is
 * its own disjoint space**: fifty storeys exist in the fiction — the lift
 * panel, the HUD pill and the tower's window rows all say so — and four
 * rooms exist in the world, which is all a six-year-old ever visits:
 *
 *  - the **lobby** (ground): reception that gives you your key, the giant
 *    RiPika statue with a disco ball above it, and a small café corner;
 *  - the **breakfast room** (Floor 1): the big one — seven tables and a
 *    twelve-metre buffet with somebody serving behind it;
 *  - the **corridor** (floor 50): life-sized statues of the cute pets, and
 *    the door that says "yours";
 *  - **your suite**, behind that door: rainbow walls, its own disco ball,
 *    and three beds to sleep on or go jumpy-jumpy between.
 *
 * **Breakfast is on Floor 1, and Floor 1 is the one above the ground** — the
 * British numbering, which is the numbering the family uses (Jim, 6 August
 * 2026, having played it: *"Breakfast should be on the 1st floor (British: the
 * floor ABOVE ground, not 25)"*). The lobby is therefore storey **0**, and the
 * lift's indicator says "Ground" rather than "Floor 0" while it passes it.
 */

/**
 * A floor's own colours — what makes stepping out of the lift read instantly
 * as *a different floor*.
 *
 * Jim, 6 August 2026: *"each floor gets its own theme, and decorate it
 * accordingly."* Four rooms of pale pink walls and one crystal floor is a
 * hotel where every storey is the same storey, and the lift's whole promise is
 * that it takes you somewhere.
 *
 * Five colours, all from `PALETTE` (ART_DIRECTION §5 — no colour is invented
 * here), and the room shell reads all five: `wall` and `floor` are the plate
 * and the walls, `trim` is the lift alcove you literally step out of, `accent`
 * dresses the soft furnishings and `glow` is what every lamp on that floor
 * burns. Dressing code takes its colours from **here** rather than naming
 * them again, so re-theming a floor is one edit in one place.
 */
export interface HotelTheme {
  readonly wall: number;
  readonly floor: number;
  /** The lift alcove, and anything that frames a way through. */
  readonly trim: number;
  /** Rugs, sofas, planters. */
  readonly accent: number;
  /** Sconces, crystals, lamps. */
  readonly glow: number;
}

/** A wall of a room. `north` is −Z, `west` is −X — the two the camera sees. */
export type WallSide = 'north' | 'south' | 'east' | 'west';

/**
 * The windows in one wall — **declared here, built by
 * `Hotel.buildRoomShell`**.
 *
 * Jim, having played it: *"a room without windows is not inviting"* and *"the
 * windowless building is weird and claustrophobic"*. The first answer to that
 * was one hand-built glowing band nailed to the breakfast room's north wall,
 * which is exactly the shape of problem this repo keeps filing: a fact about
 * a room, written down somewhere that is not the room, that only one room has
 * and no other room can inherit. It is gone. A room now *says* where its
 * windows are and the builder puts them there, so a new floor gets windows by
 * adding four numbers rather than by remembering to copy a block of geometry.
 *
 * The builder clips every pane to the wall's **own solid spans** — the spans
 * it is already computing to leave the doorways out — so a pane can never end
 * up floating across a doorway however carelessly `at` is written. That is the
 * part that makes this data safe to edit: the doorway is not repeated here,
 * it is respected automatically.
 */
export interface WindowWall {
  /**
   * Pane centres along the wall's own axis: x on the north and south walls,
   * z on the east and west ones.
   */
  readonly at: readonly number[];
  /** Pane width along that same axis. */
  readonly width: number;
  /** Bottom and top of the glass, metres above the floor. */
  readonly sill: number;
  readonly head: number;
  /**
   * The pane the wall's "Look out" zone stands at, when the default choice —
   * the middle-most pane a child can stand in front of, kept a finger clear
   * of every doorway band (`world/tapSpacing.ts`) — would land somewhere the
   * tap-spacing rule forbids for reasons the picker cannot see (the lobby's
   * café tables crowd its northern pane). `check:tap-spacing` measures the
   * chosen pane either way, so this cannot be used to break the rule.
   */
  readonly zoneAt?: number;
}

/**
 * A raised upper level inside a room, and the sweeping stair up to it —
 * **declared here, built by `Hotel.buildMezzanine`**, exactly like
 * {@link WindowWall}.
 *
 * Jim, 7 August 2026: *"Make the lobby a double-height room with a sweeping
 * staircase to the mezzanine level."*
 *
 * ## Why it is a raised terrace and not an overhanging balcony
 *
 * `CollisionWorld` is **height-agnostic for everything but a jump**: a collider
 * carries a `topHeight` measured above its *own* local ground, and the height
 * test (`clearsTop`) is fed the player's clearance above *the sampler's*
 * ground. A child on the lobby floor and a child on a balcony 3.2 m up are both
 * at clearance 0, so the two cannot be told apart — which means a balustrade
 * that stops her walking off the balcony is the *same* collider that walls off
 * the lobby floor beneath it, at head height, invisibly. (This is the same law
 * `place.ts` runs into from the other side, where it makes beds soft.)
 *
 * There are only two honest ways out, and the castle takes the other one: its
 * internal deck edges have no collider at all and you fall through them. That
 * is right for a five-storey castle and wrong for a lobby a six-year-old is
 * meant to enjoy standing about on.
 *
 * So the deck sits on a **solid mass** whose front and side faces are real
 * full-height walls: nothing overhangs, there is no space underneath to be
 * invisibly walled off, and the balustrade on top can therefore be as solid as
 * it looks. You go up a sweeping quarter-turn stair; you cannot fall off; and
 * the whole thing is one rectangle plus one arc of numbers.
 */
export interface Mezzanine {
  /** The deck, in room-local metres. Its faces below `height` are solid. */
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** Height of the walking surface. */
  readonly height: number;
  /**
   * The sweeping stair: a quarter-turn arc of chunky treads, swept about
   * `(centreX, centreZ)` from `fromAngle` to `toAngle` (radians, measured the
   * way the rest of this game measures a yaw — 0 is +Z, turning toward −X).
   * The last tread lands level with the deck.
   */
  readonly stair: {
    readonly centreX: number;
    readonly centreZ: number;
    readonly innerRadius: number;
    readonly outerRadius: number;
    readonly fromAngle: number;
    readonly toAngle: number;
    readonly treads: number;
  };
}

export interface HotelRoom {
  readonly space: SpaceId;
  /** This floor's colours. See {@link HotelTheme}. */
  readonly theme: HotelTheme;
  readonly originX: number;
  readonly originZ: number;
  /** Half-extent of the floor plate, local metres. */
  readonly halfX: number;
  readonly halfZ: number;
  /** Wall height. Rooms are open-topped — the iso camera looks in. */
  readonly wallHeight: number;
  /**
   * Height of the **south and east** walls, when they should be lower than the
   * rest. Defaults to {@link wallHeight}.
   *
   * The camera sits at focus + (+X, +Y, +Z) at a fixed 38° pitch, so those two
   * walls are the ones *between it and the room*: a wall of height H hides the
   * floor for 1.28·H metres behind it. At the 3.0–3.4 m every room used to be
   * that is a 4 m shadow you never notice, because you are rarely that close to
   * a near wall. The lobby is 6.4 m tall now (Jim: *"make the lobby a
   * double-height room"*), and 6.4 m of near wall would hide eight metres —
   * which is a child standing in her own hotel and seeing a wall.
   *
   * So the two walls the camera looks *through* stay low and the two it looks
   * *at* go up. That is not a fudge: it is the same rule `windows` and
   * `hangOnWalls` already obey, written down once more for the one dimension
   * that had been assuming every wall was the same.
   */
  readonly nearWallHeight?: number;
  /** Gaps in the walls, per side, as [from, to] along that wall's axis. */
  readonly gaps: Partial<Record<WallSide, readonly [number, number]>>;
  /**
   * Where the daylight comes in. See {@link WindowWall}.
   *
   * The camera sits at focus + (+X, +Y, +Z), so it looks at the inside faces
   * of the **north and west** walls and at the *outside* of the other two —
   * a window on the south or east wall is a window nobody will ever look
   * through. Every room therefore declares north, west, or both, and where
   * one of those two is missing the room's own entry below says why.
   */
  readonly windows: Partial<Record<WallSide, WindowWall>>;
  /** An upper level, if this room has one. See {@link Mezzanine}. */
  readonly mezzanine?: Mezzanine;
  /** Internal walls dividing this room up. See {@link SuitePartition}. */
  readonly partitions?: readonly SuitePartition[];
  /** The lift alcove's centre on the west wall, local Z. */
  readonly liftZ: number | null;
  /** Which lift floor this room answers to (index into HOTEL_FLOORS). */
  readonly liftFloor: number | null;
  /** What the HUD's floor pill says here. */
  readonly floorLabel: string;
}

/** Half-width of every door gap. */
export const DOOR_HALF = 1.3;

/** How far the lift alcove pokes out of the west wall. */
export const LIFT_ALCOVE_DEPTH = 3.4;

/** Where the boarding pose is, out from the west wall. */
export const LIFT_CAR_X = -1.9;

/** **Ground — a grand crystal welcome.** Lilac walls, glass floor, gold lamps. */
const LOBBY_THEME: HotelTheme = {
  wall: PALETTE.flowerViolet,
  floor: PALETTE.glassTint,
  trim: PALETTE.markerLilac,
  accent: PALETTE.markerLilac,
  glow: PALETTE.liftFrame,
};

/**
 * **Floor 1 — a sunny morning.** Cream walls, warm cream floor, honey-gold
 * trim: the colours of toast and butter, which is the entire point of the
 * only room in the hotel you go to in order to eat.
 */
const BREAKFAST_THEME: HotelTheme = {
  wall: PALETTE.signBoard,
  floor: PALETTE.buildingWall,
  trim: PALETTE.liftFrame,
  accent: PALETTE.flowerYellow,
  glow: PALETTE.markerLemon,
};

/**
 * **Floor 50 — up among the clouds.** Sky-blue walls over a deeper sky floor,
 * because fifty storeys up is the one floor whose *number* is the interesting
 * thing about it. Stars and clouds do the rest (`dressCorridor`).
 */
const CORRIDOR_THEME: HotelTheme = {
  wall: PALETTE.skyDayBottom,
  floor: PALETTE.markerSky,
  trim: PALETTE.buildingRoofDeep,
  accent: PALETTE.flowerBlue,
  glow: PALETTE.flowerYellow,
};

/**
 * **Yours — the rainbow room.** Eleri's own spec, and the only theme here she
 * asked for by name: *"the room is rainbow coloured, only for the top room"*.
 * The walls stay near-white on purpose — the rainbow is the stripes, the rug
 * and the blankets, and a rainbow on a coloured wall is a rainbow you cannot
 * see.
 */
const SUITE_THEME: HotelTheme = {
  wall: PALETTE.blossomWhite,
  floor: PALETTE.stonePinkLight,
  trim: PALETTE.markerPink,
  accent: PALETTE.markerPink,
  glow: PALETTE.markerPink,
};

/**
 * **Floor 12 — the garden floor.** Pale meadow-green walls over a mossy
 * blue-green floor, deep-leaf trim, blossom-pink furnishings and sunny lamps:
 * an indoor meadow with planters, trellises and butterflies, twelve storeys
 * up.
 *
 * Jim, 7 August 2026: *"you should be able to go to certain other floors with
 * their own schemes."* The test a scheme has to pass is the one the lift makes
 * a promise about — step out and know instantly that this is **not** the floor
 * you were on — and a floor of grass under a floor of toast passes it before
 * you have looked at a single prop.
 */
const GARDEN_THEME: HotelTheme = {
  wall: PALETTE.grassLight,
  floor: PALETTE.leafBlue,
  trim: PALETTE.leafDeep,
  accent: PALETTE.blossomPink,
  glow: PALETTE.flowerYellow,
};

/**
 * **Floor 33 — the ocean floor.** Bright water-blue walls over the deep, with
 * foam-white trim, mint furnishings and a pale glow like light coming down
 * through the surface. Fish, seaweed and portholes do the rest
 * (`dressOcean`).
 *
 * Thirty-three, and not a rounder number, on purpose: it sits between Floor 12
 * and Floor 50 so the lift's indicator has a proper long count to do in both
 * directions, which is most of what makes a fifty-storey hotel feel tall.
 */
const OCEAN_THEME: HotelTheme = {
  wall: PALETTE.waterTop,
  floor: PALETTE.waterDeep,
  trim: PALETTE.waterFoam,
  accent: PALETTE.markerMint,
  glow: PALETTE.bubbleSkin,
};

/**
 * Where the lobby's raised gallery stands, and how high.
 *
 * Named rather than inlined because four separate things need the same
 * numbers — the deck, its solid front, the stair's landing and the dressing
 * that goes on top — and this is the file that owns them.
 */
export const LOBBY_MEZZANINE_Y = 3.2;

export const LOBBY: HotelRoom = {
  space: SPACE_HOTEL_LOBBY,
  theme: LOBBY_THEME,
  originX: HOTEL_ORIGIN_X,
  originZ: HOTEL_LOBBY_Z,
  halfX: 13,
  // Deepened from 10 by exactly the gallery's own 4.8 m, so the open floor of
  // the lobby is the room it always was and the mezzanine is *added* space
  // rather than space taken off a child.
  halfZ: 12.4,
  // Double height — Jim: *"make the lobby a double-height room with a sweeping
  // staircase to the mezzanine level."* Only the two far walls are this tall;
  // see `nearWallHeight` for why the two the camera looks through are not.
  wallHeight: 6.4,
  nearWallHeight: 3.4,
  // South: the front door back out to the park. West: the lift.
  gaps: { south: [-DOOR_HALF, DOOR_HALF], west: [-1.6, 1.6] },
  // **Clerestory.** Both rows sit above `LOBBY_MEZZANINE_Y`, because the north
  // wall's lower half west of x = 5 is inside the gallery's own solid mass and
  // a pane there would be a lit rectangle buried in a wall. High windows are
  // also simply what a double-height lobby has: they light the gallery from
  // behind and throw the room's brightest band across the top of the statue.
  windows: {
    north: { at: [-11, -6, -1, 4, 9], width: 2.2, sill: 3.9, head: 5.7 },
    // West: only the stretch south of the gallery, for the same reason — plus
    // the lift gap, which `glazeWall` clips these to automatically. The
    // northernmost pane used to sit at -3.8; it moved to -6.6 (8 Aug 2026) so
    // one pane stands a clear finger outside the lift's boarding band, and
    // `zoneAt` pins "Look out" to it — the default picker's other candidates
    // are the pane over the lift band and the pane the café tables crowd.
    west: { at: [-6.6, 3.2, 9.6], width: 1.8, sill: 1.2, head: 3.6, zoneAt: -6.6 },
  },
  mezzanine: {
    minX: -13,
    maxX: 5,
    minZ: -12.4,
    maxZ: -7.6,
    height: LOBBY_MEZZANINE_Y,
    // A quarter turn, swept about a point inside the gallery's south-east
    // corner: the bottom tread faces into the open lobby and the top one lands
    // **on the deck**, so a child walks a curve rather than a ramp. Ten treads
    // over 90° is a 0.32 m rise each — half the game's own `BUILDING_STEP_UP`,
    // so every tread is comfortably walkable up *and* back down.
    //
    // The centre is the load-bearing number and it is worth checking by hand
    // if it ever moves: at `toAngle` the treads sit at
    // `(centreX − r, centreZ)`, which must land inside the deck rectangle, and
    // at `fromAngle` at `(centreX, centreZ + r)`, which must be clear lobby
    // floor. With these, the top tread spans x 2.6–4.4 at z = −8.5 (on the
    // deck, which reaches x ≤ 5 and z ≤ −7.6) and the bottom one x = 6.8 at
    // z −6.1…−4.3 (open floor, and clear of reception at x = 10).
    stair: {
      centreX: 6.8,
      centreZ: -8.5,
      innerRadius: 2.4,
      outerRadius: 4.2,
      fromAngle: 0,
      toAngle: Math.PI / 2,
      treads: 10,
    },
  },
  liftZ: 0,
  liftFloor: 0,
  floorLabel: 'Lobby',
};

/**
 * The breakfast room — the biggest space in the hotel, and on purpose.
 *
 * 24 × 18 m against the lobby's 26 × 20: Jim asked for *"a large room with lots
 * of tables and a buffet with breakfast foods"*, and rooms are disjoint spaces,
 * so floor area here costs nothing anywhere else. The one real bound is
 * `HOTEL_PLAY_RADIUS` (24 m from the room's origin, the circle
 * `Hotel.boundTo` sets): the far corner of this plate is 15 m out and the
 * lift alcove's back wall 15.4 m, both comfortably inside it.
 */
export const BREAKFAST: HotelRoom = {
  space: SPACE_HOTEL_BREAKFAST,
  theme: BREAKFAST_THEME,
  originX: HOTEL_ORIGIN_X,
  originZ: HOTEL_BREAKFAST_Z,
  halfX: 12,
  halfZ: 9,
  wallHeight: 3.0,
  gaps: { west: [-1.6, 1.6] },
  // Seven of them along the north wall, above the buffet — this is the room
  // you eat breakfast in, so it is the room that has to read as *morning*.
  // They replace the one hand-built glowing band that used to be nailed here,
  // and which no other room could have.
  windows: {
    north: { at: [-10, -6.6, -3.2, 0.2, 3.6, 7, 10.4], width: 2.2, sill: 1.5, head: 2.75 },
    west: { at: [-8.1, -3, 2.9, 8.1], width: 1.4, sill: 1.1, head: 2.6 },
  },
  liftZ: 0,
  liftFloor: 1,
  floorLabel: 'Floor 1',
};

export const CORRIDOR: HotelRoom = {
  space: SPACE_HOTEL_CORRIDOR,
  theme: CORRIDOR_THEME,
  originX: HOTEL_ORIGIN_X,
  originZ: HOTEL_CORRIDOR_Z,
  halfX: 11,
  halfZ: 4,
  wallHeight: 3.0,
  // East: the "yours" door into the suite. West: the lift.
  gaps: { east: [-1.1, 1.1], west: [-1.6, 1.6] },
  // Fifty storeys up, so these are the windows with the view — set between the
  // wall's five stars and below them, with a pet statue silhouetted against
  // each. **No west windows**: that wall is 8 m deep, has the lift gap through
  // the middle of it and a sconce in each remaining 2.4 m span, and a pane
  // squeezed into what is left would read as a mistake rather than a window.
  windows: {
    north: { at: [-7.3, -2.5, 2.5, 7.3], width: 2, sill: 0.9, head: 1.95 },
  },
  liftZ: 0,
  liftFloor: 4,
  floorLabel: 'Floor 50',
};

/**
 * The suite's internal partitions — **declared here, built by
 * `Hotel.partitionSuite`**, the same way windows and the mezzanine are.
 *
 * Jim, 7 August 2026: *"four sub-rooms in the ONE suite space — three rainbow
 * bedrooms + a lounge."* One space, four rooms: the partitions are ordinary
 * walls inside it, so nothing about portals, saves or `spaceAt` changes — it
 * is still `hotel.suite` wherever you stand.
 *
 * A partition is a run along one axis with a **doorway** taken out of it, and
 * the doorway is generous (2.4 m) on purpose: a child does not aim, and a
 * standard 1.1 m door that she has to line herself up with is exactly the
 * fiddliness the lift's auto-boarding exists to delete.
 */
export interface SuitePartition {
  /** `'x'` for a wall running along X (so it separates north from south). */
  readonly along: 'x' | 'z';
  /** Where it sits on the other axis. */
  readonly at: number;
  /** Its extent along `along`. */
  readonly from: number;
  readonly to: number;
  /** Doorway centres along `along`. Each is {@link SUITE_DOOR_WIDTH} wide. */
  readonly doors: readonly number[];
}

/** How wide a doorway inside the suite is. Generous — see {@link SuitePartition}. */
export const SUITE_DOOR_WIDTH = 2.4;

/**
 * Where the three beds stand, one per bedroom, in the suite's local metres.
 *
 * **Here rather than in `Hotel.dressSuite`, because two things need them**:
 * the dressing that builds them, and `check:hotel`, which asserts each one is
 * soft (a bed is a walk surface — a collider round its edge would shove a
 * jumping child off it) and standable. The check used to carry its own copy of
 * these three pairs, and the day the suite was split into four rooms all three
 * went stale at once and it failed with six problems about beds that were
 * simply somewhere else. One list, two readers — CLAUDE.md's opening rule.
 *
 * Each bed's own bedroom is the strip of floor between the partitions either
 * side of it, so moving a bed without moving its partition is a bed in a wall;
 * `check:hotel` measures that too.
 */
export const SUITE_BED_SPOTS: readonly (readonly [number, number])[] = [
  [-6.9, -5.2],
  [-0.4, -5.2],
  [7.2, -5.2],
];

/** Where the bedside tables stand — beside each bed, same reasoning as above. */
export const SUITE_BEDSIDE_X: readonly number[] = [-5.4, 1.1, 8.7];
export const SUITE_BEDSIDE_Z = -5.2;

/**
 * How tall the suite's internal partitions are.
 *
 * **Lower than the room's own walls, and that is a camera decision.** At the
 * fixed 38° pitch a wall hides 1.28·H metres of floor behind it, and an
 * internal wall is always between the camera and *something*: at the outer
 * walls' 3.0 m each partition would black out 3.8 m of the room behind it,
 * which in a 6.4 m deep bedroom is most of the bedroom. At 2.2 m it hides
 * 2.8 m, which clears the bed. Partitions in a child's suite reading as
 * room dividers rather than as full walls is also simply truer to what this
 * is — a big room divided up, not a corridor of cells.
 */
export const SUITE_PARTITION_HEIGHT = 2.2;

export const SUITE: HotelRoom = {
  space: SPACE_HOTEL_SUITE,
  theme: SUITE_THEME,
  originX: HOTEL_ORIGIN_X,
  originZ: HOTEL_SUITE_Z,
  // Grown from 8 × 6 to hold four rooms. The far corner is 13.6 m from the
  // origin, well inside `HOTEL_PLAY_RADIUS`'s 24 m.
  halfX: 11,
  halfZ: 8,
  wallHeight: 3.0,
  // West: back out to the corridor.
  gaps: { west: [-1.1, 1.1] },
  // Three bedrooms across the north half, the lounge and the bathroom across
  // the south, and a hall between them that the corridor door opens straight
  // into. The hall is z ±1.7 and the door gap only z ±1.1, so the partitions
  // meeting the west wall leave the doorway untouched.
  //
  // **Every run reaches a wall or a doorway jamb — nothing ends in open
  // air.** The two long runs used to stop at −9.4, 1.6 m short of the west
  // wall, on the theory that this kept the hall clear; what it actually built
  // was a free-standing wall end past which you could see (and walk) around
  // every "room" — Jim, looking at the bedroom: *"The dividing walls don't go
  // to the edge of the space."* `check:hotel` probe 18 now measures every
  // partition end in the hotel against the built walls.
  partitions: [
    { along: 'x', at: -1.7, from: -11, to: 11, doors: [-6.6, 0, 6.6] },
    { along: 'x', at: 1.7, from: -11, to: 11, doors: [-7.6, 4.4] },
    { along: 'z', at: -4.2, from: -8, to: -1.7, doors: [] },
    { along: 'z', at: 3.4, from: -8, to: -1.7, doors: [] },
    // The bathroom's own wall — the south half's answer to the bedroom
    // divider at the same x, so the plan reads as one grid. Its doorway is
    // the one at −7.6 in the run above: you step in off the hall.
    { along: 'z', at: -4.2, from: 1.7, to: 8, doors: [] },
  ],
  // **One per room.** The suite is four rooms now, and a bedroom with no
  // window is the thing Jim objected to in the first place (*"a room without
  // windows is not inviting"*) — so the north wall gets one per bedroom and
  // the west wall keeps the pair flanking your own front door. The rainbow
  // Eleri asked for by name is still painted right across the north and east
  // walls; these three panes are threaded between its bands rather than
  // through them (`dressSuite` lays the stripes to 2.6 m, the sills start at
  // 1.5 m on the wall's own upper half).
  windows: {
    // One per bedroom still, but between each bed and its partition rather
    // than dead over the bed (8 Aug 2026): a pane centred on a bed put the
    // wall's "Look out" zone and the bed's "Sleep" zone a quarter-metre
    // apart, and the tap-spacing rule (`world/tapSpacing.ts`) wants a full
    // finger between different actions.
    // `zoneAt` pins "Look out" to the third bedroom's pane: the middle one's
    // stand spot is blocked (the pet's four-poster lives in that bedroom), so
    // the default picker slid to the first bedroom's pane — 3.04 m from the
    // west wall's painting, inside the tap rule's finger.
    north: { at: [-9.5, -2.9, 9.7], width: 2.2, sill: 1.5, head: 2.6, zoneAt: 9.7 },
    // One pane, lighting the bathroom. The pair that used to flank the front
    // door (±1.95) could not survive the partitions reaching the west wall:
    // the junctions land at z ±1.7, straight through the middle of each old
    // pane, and a wall running into a window is worse than no window. The
    // slot between the door gap (±1.1) and the junction (±1.5) is 0.4 m —
    // no pane fits there — so the west light moves to the one stretch of
    // that wall with room for it, which the bathroom is glad of. Bedroom 1
    // keeps its own north pane like the others.
    west: { at: [5.9], width: 1.5, sill: 0.9, head: 2.6 },
  },
  liftZ: null,
  liftFloor: 4,
  floorLabel: 'Floor 50',
};

/**
 * **Floor 12, the garden floor** — an indoor meadow.
 *
 * Wide and shallow like the breakfast room, because what this floor is *for*
 * is walking through a meadow: a lawn down the middle, planters and trellises
 * either side, and a little pond. Windows on both visible walls — a garden
 * with no sky is a cellar.
 */
export const GARDEN_FLOOR: HotelRoom = {
  space: SPACE_HOTEL_GARDEN,
  theme: GARDEN_THEME,
  originX: HOTEL_ORIGIN_X,
  originZ: HOTEL_GARDEN_Z,
  halfX: 11,
  halfZ: 8,
  wallHeight: 3.2,
  gaps: { west: [-1.6, 1.6] },
  windows: {
    north: { at: [-8.4, -4.2, 0, 4.2, 8.4], width: 2.4, sill: 1.1, head: 2.75 },
    west: { at: [-5.6, 5.6], width: 1.6, sill: 1.1, head: 2.6 },
  },
  liftZ: 0,
  liftFloor: 2,
  floorLabel: 'Floor 12',
};

/**
 * **Floor 33, the ocean floor** — under the sea.
 *
 * Squarer than the garden, so the shoal of fish overhead has somewhere to
 * swim, and the shallowest wall in the hotel apart from the corridor: the
 * things worth seeing here are *above* the wall line, the way Floor 50's
 * clouds are.
 */
export const OCEAN_FLOOR: HotelRoom = {
  space: SPACE_HOTEL_OCEAN,
  theme: OCEAN_THEME,
  originX: HOTEL_ORIGIN_X,
  originZ: HOTEL_OCEAN_Z,
  halfX: 10,
  halfZ: 8.5,
  wallHeight: 3.1,
  gaps: { west: [-1.6, 1.6] },
  // Round portholes are hung over these by `dressOcean` — the pane is the
  // window and the brass ring round it is dressing, one surface each, rather
  // than a second glowing mesh trying to line itself up with the first.
  windows: {
    north: { at: [-7, -2.4, 2.4, 7], width: 1.7, sill: 1.15, head: 2.55 },
    west: { at: [-5.4, 5.4], width: 1.7, sill: 1.15, head: 2.55 },
  },
  liftZ: 0,
  liftFloor: 3,
  floorLabel: 'Floor 33',
};

export const ROOMS: readonly HotelRoom[] = [
  LOBBY,
  BREAKFAST,
  GARDEN_FLOOR,
  OCEAN_FLOOR,
  CORRIDOR,
  SUITE,
];

/**
 * The walk-through trigger bands of every doorway in the hotel — **the** list,
 * in world metres.
 *
 * `Hotel.checkDoorways` and `Hotel.atLiftDoors` fire on exactly these
 * rectangles, and `scripts/check-tap-spacing.mts` holds every interact zone
 * clear of them (the tap-spacing rule, `world/tapSpacing.ts`). They were
 * inline comparisons in `checkDoorways` until 8 August 2026, which meant the
 * only way a check could know where the doors were was to copy the
 * arithmetic — the "two definitions of one thing" trap, resolved the usual
 * way: one owner, everyone else asks.
 */
export interface HotelDoorBand extends PortalBand {
  readonly kind: 'exit' | 'suite-door' | 'corridor-door' | 'lift';
}

export function hotelDoorBands(room: HotelRoom): HotelDoorBand[] {
  const bands: HotelDoorBand[] = [];
  if (room === LOBBY) {
    // The front door out to the park: the south wall's gap, 0.6 m deep.
    bands.push({
      kind: 'exit',
      what: "the lobby's front door",
      centreX: room.originX,
      centreZ: room.originZ + room.halfZ,
      halfAlong: 0.6,
      halfAcross: DOOR_HALF + 0.4,
      yaw: 0,
      y: 0,
    });
  }
  if (room === CORRIDOR) {
    // The "yours" door into the suite. The outer envelope is the refusal
    // band (checkDoorways turns a keyless child away from 1.6 m out); the
    // step-through itself needs the innermost 0.6 m. Its own sign zone is
    // the door's handle and may cover it.
    bands.push({
      kind: 'suite-door',
      what: 'the suite door',
      centreX: room.originX + room.halfX - 0.5,
      centreZ: room.originZ,
      halfAlong: 1.1,
      halfAcross: 1.5,
      yaw: Math.PI / 2,
      y: 0,
      ownZoneId: 'hotel-yours-door',
    });
  }
  if (room === SUITE) {
    bands.push({
      kind: 'corridor-door',
      what: "the suite's door back to the corridor",
      centreX: room.originX - room.halfX,
      centreZ: room.originZ,
      halfAlong: 0.6,
      halfAcross: 1.5,
      yaw: Math.PI / 2,
      y: 0,
    });
  }
  if (room.liftZ !== null) {
    // The lift's auto-boarding band: the alcove and the floor in front of it.
    bands.push({
      kind: 'lift',
      what: `${room.floorLabel}'s lift alcove`,
      centreX: room.originX - room.halfX,
      centreZ: room.originZ + room.liftZ,
      halfAlong: LIFT_ALCOVE_DEPTH,
      halfAcross: 2.6,
      yaw: Math.PI / 2,
      y: 0,
    });
  }
  return bands;
}

export function roomFor(space: SpaceId): HotelRoom | null {
  return ROOMS.find((room) => room.space === space) ?? null;
}

/**
 * The lift's floor list, bottom to top. Fifty storeys in the fiction; the
 * **five** a child can press. "Yours" on the top button is Eleri's own spec:
 * *"it says 'yours' ... on the lift button for your floor"*.
 *
 * `storey` is the number the lift's indicator counts through on the way, and
 * it is **British**: the ground floor is 0, so breakfast on Floor 1 is one
 * above it and the suite is still fifty up. Nothing but the indicator reads
 * these numbers — the rooms themselves are `room`, and the buttons are
 * `glyph` — which is exactly why renumbering the hotel is a data edit.
 *
 * **Every button on this panel is always pressable**, floor 50 included. It
 * used to refuse without the key, which meant a child who had walked past
 * reception met a dead button and no explanation. Jim, 7 August 2026: *"go to
 * level 50 before you have your key but not through the door to the room."*
 * The lift is now transport and the **suite door** is the lock — see
 * `Hotel.checkDoorways`, which turns her away at the door itself, where the
 * sign that tells her what to do next is standing.
 *
 * `liftFloor` on a room is an **index into this array**, so inserting a floor
 * here means fixing the indexes there. They are written out on each room
 * rather than derived so that a room can share a button with another (the
 * suite and its corridor both answer to ★).
 */
export const HOTEL_FLOORS: readonly {
  readonly name: string;
  readonly glyph: string;
  readonly storey: number;
  readonly room: HotelRoom;
}[] = [
  { name: 'Lobby', glyph: 'G', storey: 0, room: LOBBY },
  { name: 'Breakfast · Floor 1', glyph: '1', storey: 1, room: BREAKFAST },
  { name: 'Garden · Floor 12', glyph: '12', storey: 12, room: GARDEN_FLOOR },
  { name: 'Ocean · Floor 33', glyph: '33', storey: 33, room: OCEAN_FLOOR },
  { name: 'Yours! · Floor 50', glyph: '★', storey: 50, room: CORRIDOR },
];
