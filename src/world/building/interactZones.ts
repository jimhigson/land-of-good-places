import { PRIMARY_ACTION, pressZone, type InteractZone, type ZoneAction } from '../interact';
import { SLIDE_PLAN } from '../slide/plan';
import {
  BUILDING_BASE_Y,
  GROWN_UP_X,
  GROWN_UP_Z,
  LIFT_DOOR_Z,
  LIFT_PICK_X,
  LIFT_STAND_X,
  SHOP_UNITS,
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
import { BUILDING_HALF_Z } from '../../core/constants';
import { CASTLE_FLOORS, CASTLE_ROOF, floorX, floorZ } from './floors';

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
  /** Current top surface of the trampoline pad, in world units. */
  readonly trampolineSurfaceY: number;
  /** Ground height at the facade's front door, out in the garden. */
  readonly doorstepY: number;
  /** "Come here, please." The lift's own summon — see `liftRide.ts`. */
  callLift(): void;
  /** Show the Climb / Descend menu for `deck`'s stairwell. */
  /** Use the loo. Re-checks that she is actually in the room. */
  useToilets(): void;
  /** "Please come with me" / "never mind" — toggles the grown-up. */
  askGrownUp(): void;
  /** Open shop unit `unitId`'s purchase panel. */
  openShop(unitId: string): void;
}

export function buildingInteractZones(state: BuildingZoneState): InteractZone[] {
  const zones: InteractZone[] = [];
  /** One immutable action list per deck, built on first use. */

  // Allocated once per call rather than once per deck: five decks share one
  // lift chip, and an action list is immutable. The stairs cannot be shared any
  // more — since issue #122 each deck's chip carries *which* stairwell it is,
  // rather than firing an unaddressed press for `Building` to work out.
  const callAction: readonly ZoneAction[] = [
    { id: PRIMARY_ACTION, label: 'Call the lift', glyph: '🛗', run: () => state.callLift() },
  ];

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

  // The lift doors, once per floor. Each floor's alcove is at the same
  // floor-local spot but in that floor's **own space**, hundreds of metres from
  // the others, so there is no longer any need for the height tolerance in
  // `pickInteractZone` to keep four other decks' worth of zones out of the way:
  // only one of these is ever within reach at all.
  for (const floor of CASTLE_FLOORS) {
    // The lift's one action is its call button, which is the same `call()` the
    // brushed-metal panel's own big round button fires (`ui/LiftPanel.ts`). So
    // tapping the lift from across the lobby walks her over and summons the car
    // in one gesture, and the panel — a far better affordance than any chip
    // once she is standing there — takes over from the doors onwards.
    zones.push({
      id: `lift-${floor.index}`,
      label: 'Lift',
      x: floorX(floor, LIFT_PICK_X),
      y: BUILDING_BASE_Y,
      z: floorZ(floor, LIFT_DOOR_Z),
      pickRadius: 2.8,
      standX: floorX(floor, LIFT_STAND_X),
      standZ: floorZ(floor, LIFT_DOOR_Z),
      actions: () => callAction,
    });

  }

  zones.push({
    id: 'trampoline',
    label: 'Bouncy trampoline',
    x: floorX(CASTLE_ROOF, TRAMPOLINE_X),
    y: state.trampolineSurfaceY,
    z: floorZ(CASTLE_ROOF, TRAMPOLINE_Z),
    pickRadius: TRAMPOLINE_RADIUS + 0.5,
    standX: floorX(CASTLE_ROOF, TRAMPOLINE_X),
    standZ: floorZ(CASTLE_ROOF, TRAMPOLINE_Z),
    // Landing on it is the interaction, so it offers no chip — and, by the
    // SELECTION RULE, is never outlined either.
  });

  zones.push({
    id: 'giantSlide',
    label: 'Ginormous slide',
    x: floorX(CASTLE_ROOF, SLIDE_PLAN.entryX),
    y: BUILDING_BASE_Y,
    z: floorZ(CASTLE_ROOF, SLIDE_PLAN.entryZ),
    pickRadius: 2.4,
    standX: floorX(CASTLE_ROOF, SLIDE_PLAN.entryX),
    standZ: floorZ(CASTLE_ROOF, SLIDE_PLAN.entryZ),
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
      () => state.useToilets(),
      '🚽',
      'Use the toilet',
    ),
  );

  // The seven shops. Tapping a counter walks you to the serving spot and opens
  // *that* counter on arrival — the chip names the unit, so the walk and the
  // key press cannot end up at different tills (issue #122).
  //
  // The chip says what the stall *sells* ("Toys", "Pets") rather than "Go
  // shopping!": seven stalls in a row all offering the same three words told a
  // child nothing about which one she was standing at. The words come from the
  // shop's own definition (`unit.sells`), so a new stall arrives with its own
  // prompt and there is no list here to forget to update.
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
        () => state.openShop(unit.id),
        '🛍️',
        unit.sells,
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
      () => state.askGrownUp(),
      '🧑',
      'Ask them along',
    ),
  );

  return zones;
}
