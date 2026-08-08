import {
  HOTEL_BREAKFAST_Z,
  HOTEL_CORRIDOR_Z,
  HOTEL_LOBBY_Z,
  HOTEL_ORIGIN_X,
  HOTEL_SUITE_Z,
} from '../../core/constants';
import { PALETTE } from '../../core/palette';
import {
  SPACE_HOTEL_BREAKFAST,
  SPACE_HOTEL_CORRIDOR,
  SPACE_HOTEL_LOBBY,
  SPACE_HOTEL_SUITE,
  type SpaceId,
} from '../spaces';

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

export const LOBBY: HotelRoom = {
  space: SPACE_HOTEL_LOBBY,
  theme: LOBBY_THEME,
  originX: HOTEL_ORIGIN_X,
  originZ: HOTEL_LOBBY_Z,
  halfX: 13,
  halfZ: 10,
  wallHeight: 3.4,
  // South: the front door back out to the park. West: the lift.
  gaps: { south: [-DOOR_HALF, DOOR_HALF], west: [-1.6, 1.6] },
  // Tall crystal lights the full height of a grand lobby, threaded between the
  // sconces and the pictures already hung on these two walls.
  windows: {
    north: { at: [-12, -2.4, 1.4, 4, 7.6, 11.8], width: 1.8, sill: 0.9, head: 2.9 },
    west: { at: [-8.6, -3.8, 6.6], width: 1.8, sill: 0.9, head: 2.9 },
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
  liftFloor: 2,
  floorLabel: 'Floor 50',
};

export const SUITE: HotelRoom = {
  space: SPACE_HOTEL_SUITE,
  theme: SUITE_THEME,
  originX: HOTEL_ORIGIN_X,
  originZ: HOTEL_SUITE_Z,
  halfX: 8,
  halfZ: 6,
  wallHeight: 3.0,
  // West: back out to the corridor.
  gaps: { west: [-1.1, 1.1] },
  // Two, flanking your own front door. **No north windows**: that wall — and
  // the east one — is the rainbow Eleri asked for by name, painted right
  // across it, and a rainbow with a hole cut in it is not a rainbow. The
  // suite gets its brightness from the west pair, its disco ball and the open
  // sky overhead instead.
  windows: {
    west: { at: [-1.95, 1.95], width: 1.5, sill: 0.9, head: 2.6 },
  },
  liftZ: null,
  liftFloor: 2,
  floorLabel: 'Floor 50',
};

export const ROOMS: readonly HotelRoom[] = [LOBBY, BREAKFAST, CORRIDOR, SUITE];

export function roomFor(space: SpaceId): HotelRoom | null {
  return ROOMS.find((room) => room.space === space) ?? null;
}

/**
 * The lift's floor list, bottom to top. Fifty storeys in the fiction; the
 * three a child can press. "Yours" on the top button is Eleri's own spec:
 * *"it says 'yours' ... on the lift button for your floor"*.
 *
 * `storey` is the number the lift's indicator counts through on the way, and
 * it is **British**: the ground floor is 0, so breakfast on Floor 1 is one
 * above it and the suite is still fifty up. Nothing but the indicator reads
 * these numbers — the rooms themselves are `room`, and the buttons are
 * `glyph` — which is exactly why renumbering the hotel is a data edit.
 */
export const HOTEL_FLOORS: readonly {
  readonly name: string;
  readonly glyph: string;
  readonly storey: number;
  readonly room: HotelRoom;
}[] = [
  { name: 'Lobby', glyph: 'G', storey: 0, room: LOBBY },
  { name: 'Breakfast · Floor 1', glyph: '1', storey: 1, room: BREAKFAST },
  { name: 'Yours! · Floor 50', glyph: '★', storey: 50, room: CORRIDOR },
];
