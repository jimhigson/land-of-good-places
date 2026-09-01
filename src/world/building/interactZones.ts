import {
  PRIMARY_ACTION,
  pressAction,
  pressZone,
  type InteractZone,
  type ZoneAction,
} from '../interact';
import type { FeastProp } from '../../art/models/castleAssets';
import { CASTLE_GREAT_HALL_DECK, greatHallSeats, SIT_PICK_RADIUS } from './castleFurniture';
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
import { CASTLE_FLOORS, CASTLE_HALL, CASTLE_ROOF, floorX, floorZ } from './floors';

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

/**
 * **What is on the menu at the banquet** — #449's "the action to sit and eat".
 *
 * The castle's own laid meal, `FEAST_PROPS`, rather than a new list of foods:
 * a roast, a pie and a loaf are already on that table in front of her, so
 * these chips name things she can see. `'goblet'` is left off — a goblet is a
 * drink, and "Have a goblet" as an *eat* chip is the kind of near-miss a
 * six-year-old notices.
 *
 * The hotel breakfast room's `BREAKFASTS` is the shape this copies: a small
 * closed list of nameable things, each with its own glyph, offered as a row of
 * chips once she is sitting down.
 */
const FEAST_FOODS: readonly { kind: FeastProp; label: string; glyph: string }[] = [
  { kind: 'roast', label: 'Big roast dinner', glyph: '🍗' },
  { kind: 'pie', label: 'A whole pie', glyph: '🥧' },
  { kind: 'loaf', label: 'Warm bread', glyph: '🍞' },
];

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

  /**
   * Which blank place at the banquet she is sitting in, or `null` — the same
   * mechanism the hotel's `seatedAt` is, and for the same reason: it is what
   * turns one chip ("Sit down to eat") into the row she gets once she is
   * down (the food, and the way back up).
   */
  readonly banquetSeat: number | null;
  /** Sit down in free place `index` of `greatHallSeats`. */
  sitAtFeast(index: number): void;
  /** Have some of `kind`, wherever she is sitting. */
  eatAtFeast(kind: FeastProp): void;
  /** Get up, and call the pets back off their table. */
  leaveFeast(): void;
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

  // **The blank places at the banquet** (#449). Jim: *"no free spaces for the
  // player to sit … the action to sit and eat on the blank spaces."*
  //
  // Shaped on the hotel breakfast room's chair zone, which has solved
  // walk-to-a-free-chair-and-sit since #276 — down to the two details that
  // are easy to leave out and expensive to leave out:
  //
  //  - **`selectableWhileRiding`.** Sitting is a ride as far as the engine
  //    cares, and a zone is not offered while riding unless it says so. Without
  //    it, sitting down eats every chip *including the way back up*, and a
  //    child is stuck at the table for ever.
  //  - **The chip says what leaving *this* is.** "Leave the feast", not "Hop
  //    down" — Jim's own correction on the breakfast room (7 Aug 2026): a child
  //    sitting at a table reads "Hop down" as another thing to do at the table
  //    rather than as the way out of it.
  //
  // Only the free places get a zone at all. A place with a child already in it
  // offers nothing, which is the same mechanism the hotel's `chair.taken` is:
  // a chip that appears and then refuses teaches a six-year-old that chips
  // sometimes lie.
  greatHallSeats(CASTLE_GREAT_HALL_DECK).forEach((seat, index) => {
    if (!seat.free) return;
    zones.push({
      id: `banquet-seat-${index}`,
      label: 'A place at the feast',
      x: floorX(CASTLE_HALL, seat.x),
      // Chest height on a seated child, so the tap target is her place at the
      // table rather than the flagstones under the bench.
      y: BUILDING_BASE_Y + 1,
      z: floorZ(CASTLE_HALL, seat.z),
      pickRadius: SIT_PICK_RADIUS,
      // The seating plan's own stand spot — measured out past the bench plank
      // it belongs to, rather than a fixed distance guessed here. See
      // `castleFurniture.ts`'s `SIT_STAND_BACK`.
      standX: floorX(CASTLE_HALL, seat.standX),
      standZ: floorZ(CASTLE_HALL, seat.standZ),
      standRadius: 2.2,
      selectableWhileRiding: true,
      verb: 'Sit',
      actions: () =>
        state.banquetSeat === index
          ? [
              ...FEAST_FOODS.map((food) => ({
                id: `feast-${food.kind}`,
                label: food.label,
                glyph: food.glyph,
                run: () => state.eatAtFeast(food.kind),
              })),
              { id: 'leave-feast', label: 'Leave the feast', run: () => state.leaveFeast() },
            ]
          : pressAction('Sit down and eat', () => state.sitAtFeast(index), '🍽️'),
    });
  });

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
