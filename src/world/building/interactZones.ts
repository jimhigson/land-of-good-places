import { PRIMARY_ACTION, pressAction, pressZone, type InteractZone, type ZoneAction } from '../interact';
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
  LIFT_DOOR_Z,
  LIFT_PICK_X,
  LIFT_STAND_X,
  SHOP_UNITS,
  STAIR_STAND_X,
  STAIR_STAND_Z,
  TOILET_DECK,
  TOILET_STAND_X,
  TOILET_STAND_Z,
  TOP_DECK,
  TRAMPOLINE_RADIUS,
  TRAMPOLINE_X,
  TRAMPOLINE_Z,
  deckY,
  facadeX,
  facadeZ,
  shopLocalToBuilding,
  worldX,
  worldZ,
} from './layout';
import { SHOP_STAND_Z } from './shops/Shops';
import { BUILDING_FLOOR_COUNT, BUILDING_HALF_Z } from '../../core/constants';

/**
 * Everything in the building a finger can point at.
 *
 * See `world/interact.ts` for why these exist. The numbers all come from
 * `layout.ts`, so a tap target can never drift away from the thing it names.
 *
 * Almost all of these are in the building's *own* space, hundreds of metres from
 * the park. Exactly one is not — the facade's front door out in the garden,
 * which is how you get in. Zones are picked by world position, so the two sets
 * can never be mistaken for one another.
 */

export interface BuildingZoneState {
  /** Current top surface of the floating bubble, in world units. */
  readonly bubbleSurfaceY: number;
  /** Current top surface of the trampoline pad, in world units. */
  readonly trampolineSurfaceY: number;
  /** Ground height at the facade's front door, out in the garden. */
  readonly doorstepY: number;
  /** "Come here, please." The lift's own summon — see `liftRide.ts`. */
  callLift(): void;
}

export function buildingInteractZones(state: BuildingZoneState): InteractZone[] {
  const zones: InteractZone[] = [];

  // Allocated once per call rather than once per deck: five decks share one
  // stairwell chip and one lift chip, and an action list is immutable.
  const callAction: readonly ZoneAction[] = [
    { id: PRIMARY_ACTION, label: 'Call', glyph: '🛗', run: () => state.callLift() },
  ];
  const stairsAction: readonly ZoneAction[] = pressAction('Climb!', '🪜');

  // The way in, out in the garden. A tap on the tower walks a child to the top
  // of the front steps, and stepping over the threshold does the rest.
  zones.push({
    id: 'frontDoor',
    label: 'The Big Building',
    x: facadeX(1.5),
    y: state.doorstepY,
    z: facadeZ(BUILDING_HALF_Z + 1.4),
    pickRadius: 3.4,
    standX: facadeX(1.5),
    standZ: facadeZ(BUILDING_HALF_Z - 0.7),
  });

  // The lift doors and the stairs, once per deck: whichever one you can see is
  // the one you are standing next to, and the height tolerance in
  // `pickInteractZone` keeps the other four out of the way.
  for (let deck = 0; deck < BUILDING_FLOOR_COUNT; deck += 1) {
    // The lift's one action is its call button, which is the same `call()` the
    // brushed-metal panel's own big round button fires (`ui/LiftPanel.ts`). So
    // tapping the lift from across the lobby walks her over and summons the car
    // in one gesture, and the panel — a far better affordance than any chip
    // once she is standing there — takes over from the doors onwards.
    zones.push({
      id: `lift-${deck}`,
      label: 'Glass lift',
      x: worldX(LIFT_PICK_X),
      y: deckY(deck),
      z: worldZ(LIFT_DOOR_Z),
      pickRadius: 2.8,
      standX: worldX(LIFT_STAND_X),
      standZ: worldZ(LIFT_DOOR_Z),
      actions: () => callAction,
    });

    // Tapping the stairs walks you to the foot of the flight and then fires
    // `interact`, which opens the Climb / Descend menu. The whole point is that
    // the flights themselves are never walked by hand.
    zones.push({
      id: `stairs-${deck}`,
      label: 'Stairs',
      x: worldX(STAIR_STAND_X),
      y: deckY(deck),
      z: worldZ(STAIR_STAND_Z - 2.4),
      // Wide: the target is a whole stairwell, and it is the one thing in the
      // building a child should be able to hit without aiming.
      pickRadius: 4.2,
      standX: worldX(STAIR_STAND_X),
      standZ: worldZ(STAIR_STAND_Z),
      actions: () => stairsAction,
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
    // Landing on it is the interaction, so it offers no chip — and, by the
    // SELECTION RULE, is never outlined either.
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
  });

  zones.push({
    id: 'giantSlide',
    label: 'Ginormous slide',
    x: worldX(GIANT_SLIDE_ENTRY_X),
    y: deckY(TOP_DECK),
    z: worldZ(GIANT_SLIDE_ENTRY_Z),
    pickRadius: 2.4,
    standX: worldX(GIANT_SLIDE_ENTRY_X),
    standZ: worldZ(GIANT_SLIDE_ENTRY_Z),
  });

  // Tapping the loo walks her *in* and then presses — `TOILET_STAND` is now a
  // spot inside `TOILET_ROOM` rather than one in the corridor outside it, so
  // the tap route and the walk-up-and-press route both end up in the room,
  // which is the only place the press is accepted (see `Building`).
  zones.push(
    pressZone(
      {
        id: 'toilets',
        label: 'Toilets',
        x: worldX(TOILET_STAND_X),
        y: deckY(TOILET_DECK),
        z: worldZ(TOILET_STAND_Z),
        pickRadius: 3.2,
        standX: worldX(TOILET_STAND_X),
        standZ: worldZ(TOILET_STAND_Z),
      },
      '🚽',
    ),
  );

  // The seven shops. Tapping a counter walks you to the serving spot and then
  // fires `interact` on arrival, which is the same thing the E key does when a
  // keyboard player walks up — one shop-opening path, two ways in.
  for (const unit of SHOP_UNITS) {
    const [counterX, counterZ] = shopLocalToBuilding(unit, 0, 1.15);
    const [standX, standZ] = shopLocalToBuilding(unit, 0, SHOP_STAND_Z);
    zones.push(
      pressZone(
        {
          id: `shop-${unit.id}`,
          label: unit.title,
          x: worldX(counterX),
          y: deckY(unit.deck),
          z: worldZ(counterZ),
          // Wide enough to take a tap anywhere on the kiosk — counter, shelves
          // or the awning above it — without reaching the next shop along.
          pickRadius: 2.3,
          standX: worldX(standX),
          standZ: worldZ(standZ),
        },
        '🛍️',
      ),
    );
  }

  zones.push(
    pressZone(
      {
        id: 'grownUp',
        label: 'Ask a grown-up along',
        x: worldX(GROWN_UP_X),
        y: deckY(TOP_DECK),
        z: worldZ(GROWN_UP_Z),
        pickRadius: 1.7,
        // Stand in front of them rather than inside them.
        standX: worldX(GROWN_UP_X),
        standZ: worldZ(GROWN_UP_Z + 1.4),
      },
      '🧑',
    ),
  );

  return zones;
}
