import type { InteractZone } from '../interact';
import {
  BUBBLE_RADIUS,
  BUBBLE_X,
  BUBBLE_Z,
  GIANT_SLIDE_ENTRY_X,
  GIANT_SLIDE_ENTRY_Z,
  GROWN_UP_X,
  GROWN_UP_Z,
  HELTER_DECK,
  HELTER_ENTRY_X,
  HELTER_ENTRY_Z,
  SHOP_UNITS,
  TOP_DECK,
  TRAMPOLINE_RADIUS,
  TRAMPOLINE_X,
  TRAMPOLINE_Z,
  deckY,
  shopLocalToBuilding,
  worldX,
  worldZ,
} from './layout';
import { SHOP_STAND_Z } from './shops/Shops';
import { BUILDING_FLOOR_COUNT, BUILDING_HALF_X } from '../../core/constants';

/**
 * Everything in the building a finger can point at.
 *
 * See `world/interact.ts` for why these exist. The numbers all come from
 * `layout.ts`, so a tap target can never drift away from the thing it names.
 */

/**
 * Where you wait for the lift: just inside the east doorway, on the building
 * side of the threshold.
 *
 * Deliberately *not* inside the car. The car is only at one deck at a time, and
 * the shaft below it is a five-storey drop — walking a six-year-old into an open
 * lift shaft because they tapped the pretty glass box is not the game we are
 * making. Standing here calls the car (`Building.callLiftIfWaiting`) and the
 * arriving interact press cuts short its wait at wherever it was.
 */
const LIFT_STAND_X = BUILDING_HALF_X - 1.1;
const LIFT_PICK_X = BUILDING_HALF_X + 0.6;
const LIFT_DOOR_Z = 5;

export interface BuildingZoneState {
  /** Current top surface of the floating bubble, in world units. */
  readonly bubbleSurfaceY: number;
  /** Current top surface of the trampoline pad, in world units. */
  readonly trampolineSurfaceY: number;
}

export function buildingInteractZones(state: BuildingZoneState): InteractZone[] {
  const zones: InteractZone[] = [];

  // The lift doors, once per deck: whichever one you can see is the one you are
  // standing next to, and the height tolerance in `pickInteractZone` keeps the
  // other four out of the way.
  for (let deck = 0; deck < BUILDING_FLOOR_COUNT; deck += 1) {
    zones.push({
      id: `lift-${deck}`,
      label: 'Glass lift',
      x: worldX(LIFT_PICK_X),
      y: deckY(deck),
      z: worldZ(LIFT_DOOR_Z),
      pickRadius: 2.8,
      standX: worldX(LIFT_STAND_X),
      standZ: worldZ(LIFT_DOOR_Z),
      pressInteract: true,
    });
  }

  zones.push({
    id: 'trampoline',
    label: 'Bouncy trampoline',
    x: worldX(TRAMPOLINE_X),
    y: state.trampolineSurfaceY,
    z: worldZ(TRAMPOLINE_Z),
    pickRadius: TRAMPOLINE_RADIUS + 0.5,
    standX: worldX(TRAMPOLINE_X),
    standZ: worldZ(TRAMPOLINE_Z),
    // Landing on it is the interaction.
    pressInteract: false,
  });

  zones.push({
    id: 'bubble',
    label: 'Floating bubble',
    x: worldX(BUBBLE_X),
    y: state.bubbleSurfaceY,
    z: worldZ(BUBBLE_Z),
    pickRadius: BUBBLE_RADIUS + 0.4,
    standX: worldX(BUBBLE_X),
    standZ: worldZ(BUBBLE_Z),
    pressInteract: false,
  });

  zones.push({
    id: 'helter',
    label: 'Helter-skelter',
    x: worldX(HELTER_ENTRY_X),
    y: deckY(HELTER_DECK),
    z: worldZ(HELTER_ENTRY_Z),
    pickRadius: 1.9,
    standX: worldX(HELTER_ENTRY_X),
    standZ: worldZ(HELTER_ENTRY_Z),
    pressInteract: false,
  });

  zones.push({
    id: 'giantSlide',
    label: 'Ginormous slide',
    x: worldX(GIANT_SLIDE_ENTRY_X),
    y: deckY(TOP_DECK),
    z: worldZ(GIANT_SLIDE_ENTRY_Z),
    pickRadius: 2.1,
    standX: worldX(GIANT_SLIDE_ENTRY_X),
    standZ: worldZ(GIANT_SLIDE_ENTRY_Z),
    pressInteract: false,
  });

  // The seven shops. Tapping a counter walks you to the serving spot and then
  // fires `interact` on arrival, which is the same thing the E key does when a
  // keyboard player walks up — one shop-opening path, two ways in.
  for (const unit of SHOP_UNITS) {
    const [counterX, counterZ] = shopLocalToBuilding(unit, 0, 1.15);
    const [standX, standZ] = shopLocalToBuilding(unit, 0, SHOP_STAND_Z);
    zones.push({
      id: `shop-${unit.id}`,
      label: unit.title,
      x: worldX(counterX),
      y: deckY(unit.deck),
      z: worldZ(counterZ),
      // Wide enough to take a tap anywhere on the kiosk — counter, shelves or
      // the awning above it — without reaching the next shop along.
      pickRadius: 2.3,
      standX: worldX(standX),
      standZ: worldZ(standZ),
      pressInteract: true,
    });
  }

  zones.push({
    id: 'grownUp',
    label: 'Ask a grown-up along',
    x: worldX(GROWN_UP_X),
    y: deckY(TOP_DECK),
    z: worldZ(GROWN_UP_Z),
    pickRadius: 1.7,
    // Stand in front of them rather than inside them.
    standX: worldX(GROWN_UP_X),
    standZ: worldZ(GROWN_UP_Z + 1.4),
    pressInteract: true,
  });

  return zones;
}
