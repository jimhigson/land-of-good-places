import {
  HOTEL_BREAKFAST_Z,
  HOTEL_CORRIDOR_Z,
  HOTEL_LOBBY_Z,
  HOTEL_ORIGIN_X,
  HOTEL_SUITE_Z,
} from '../../core/constants';
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
 *    RiPika statue with a disco ball above it, and the breakfast tables;
 *  - the **breakfast room** (floor 25 — "in the middle you can have
 *    breakfast", so you can have it up here too);
 *  - the **corridor** (floor 50): life-sized statues of the cute pets, and
 *    the door that says "yours";
 *  - **your suite**, behind that door: rainbow walls, its own disco ball,
 *    and three beds to sleep on or go jumpy-jumpy between.
 */

export interface HotelRoom {
  readonly space: SpaceId;
  readonly originX: number;
  readonly originZ: number;
  /** Half-extent of the floor plate, local metres. */
  readonly halfX: number;
  readonly halfZ: number;
  /** Wall height. Rooms are open-topped — the iso camera looks in. */
  readonly wallHeight: number;
  /** Gaps in the walls, per side, as [from, to] along that wall's axis. */
  readonly gaps: Partial<Record<'north' | 'south' | 'east' | 'west', readonly [number, number]>>;
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

export const LOBBY: HotelRoom = {
  space: SPACE_HOTEL_LOBBY,
  originX: HOTEL_ORIGIN_X,
  originZ: HOTEL_LOBBY_Z,
  halfX: 13,
  halfZ: 10,
  wallHeight: 3.4,
  // South: the front door back out to the park. West: the lift.
  gaps: { south: [-DOOR_HALF, DOOR_HALF], west: [-1.6, 1.6] },
  liftZ: 0,
  liftFloor: 0,
  floorLabel: 'Lobby',
};

export const BREAKFAST: HotelRoom = {
  space: SPACE_HOTEL_BREAKFAST,
  originX: HOTEL_ORIGIN_X,
  originZ: HOTEL_BREAKFAST_Z,
  halfX: 9,
  halfZ: 7,
  wallHeight: 3.0,
  gaps: { west: [-1.6, 1.6] },
  liftZ: 0,
  liftFloor: 1,
  floorLabel: 'Floor 25',
};

export const CORRIDOR: HotelRoom = {
  space: SPACE_HOTEL_CORRIDOR,
  originX: HOTEL_ORIGIN_X,
  originZ: HOTEL_CORRIDOR_Z,
  halfX: 11,
  halfZ: 4,
  wallHeight: 3.0,
  // East: the "yours" door into the suite. West: the lift.
  gaps: { east: [-1.1, 1.1], west: [-1.6, 1.6] },
  liftZ: 0,
  liftFloor: 2,
  floorLabel: 'Floor 50',
};

export const SUITE: HotelRoom = {
  space: SPACE_HOTEL_SUITE,
  originX: HOTEL_ORIGIN_X,
  originZ: HOTEL_SUITE_Z,
  halfX: 8,
  halfZ: 6,
  wallHeight: 3.0,
  // West: back out to the corridor.
  gaps: { west: [-1.1, 1.1] },
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
 */
export const HOTEL_FLOORS: readonly {
  readonly name: string;
  readonly glyph: string;
  readonly storey: number;
  readonly room: HotelRoom;
}[] = [
  { name: 'Lobby', glyph: 'G', storey: 1, room: LOBBY },
  { name: 'Breakfast · Floor 25', glyph: '25', storey: 25, room: BREAKFAST },
  { name: 'Yours! · Floor 50', glyph: '★', storey: 50, room: CORRIDOR },
];
