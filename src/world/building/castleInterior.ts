import type { Group, Object3D } from 'three';
import type { CollisionWorld } from '../Collision';
import type { PetTablePlace } from '../../entities/parade/ParadeMember';
import { CASTLE_TABLE_TOP, createCastleFeastProp, type FeastProp } from '../../art/models/castleAssets';
import { CastleFire } from './castleLighting';
import { dressCastle } from './castleDecor';
import { GreatHallBanquet } from './greatHallBanquet';
import {
  CASTLE_GREAT_HALL_DECK,
  greatHallPetPlaces,
  greatHallSeats,
  greatHallSolids,
  SIT_PICK_RADIUS,
  type CastleDecorSolid,
  type GreatHallSeat,
} from './castleFurniture';
import { CASTLE_FLOORS, CASTLE_HALL, floorX, floorZ, type CastleFloor } from './floors';
import { BUILDING_BASE_Y } from './layout';

/**
 * **The castle's interior, furnished** — the fire, the cloth and the clutter on
 * every storey, the great hall's banquet, and the solids all of it stands as —
 * fetched when she first walks in, not at boot.
 *
 * It is a lazy chunk (`world/interiors.ts`'s `CASTLE_INTERIOR`), the reptile
 * hall's shape (`reptileHouse/hall.ts`): `castle.glb` and every module that
 * measures it at load (`castleAssets.ts`'s `CASTLE_TABLE_TOP` and the rest,
 * `castleFurniture.ts`'s seating plan) come in with it, so a child who never
 * goes in pays for none of it. `Building` keeps the outside, the shell and its
 * walls, the lift, the shops, the toilets, the trampoline, the deck benches
 * and planters (`dressing.ts`, which never touches the kit), the roof's
 * animals and the slide.
 *
 * Everything is solid the moment it exists: the banquet's runs and every
 * prop `dressCastle` stood on a floor are registered here, in the same call
 * that builds them. The door holds its iris shut until this has run
 * (`SpaceManager.changeToFurnished`), so she never stands in a storey before
 * its solids are there.
 */
export interface CastleInteriorContent {
  /** Every torch, brazier and hearth — a per-frame life, so `Building` holds it. */
  readonly fire: CastleFire;
  /** The children eating at the great hall's banquet (#413). */
  readonly banquet: GreatHallBanquet;
  /** Every place at the banquet, taken and free alike (`greatHallSeats`). */
  readonly seats: readonly GreatHallSeat[];
  /** How close a tap must land to a blank place to mean it (`SIT_PICK_RADIUS`). */
  readonly seatPickRadius: number;
  /** Where the pets eat, in world metres (`greatHallPetPlaces`, mapped once). */
  readonly petTablePlaces: readonly PetTablePlace[];
  /** The dish she chose, built and stood on the table's measured top in front of `seat`. */
  feastDish(kind: FeastProp, seat: GreatHallSeat, reach: number): Object3D;
}

/**
 * Furnishes every storey's floor group (`Shell.floorGroups`, indexed by deck)
 * and registers what was stood there. Call inside the castle's
 * `collision.ownedBy`, as the rest of the building is built.
 */
export function furnishCastle(collision: CollisionWorld, floorGroups: readonly Group[]): CastleInteriorContent {
  const fire = new CastleFire();
  const banquet = new GreatHallBanquet();
  const decorSolids: CastleDecorSolid[][] = [];
  floorGroups.forEach((floor, deck) => {
    // Fire, cloth, paint and the things that reward looking twice (#376).
    fire.dress(deck, floor);
    decorSolids[deck] = dressCastle(deck, floor);
    // After `dressCastle`, because the benches the diners sit on are placed
    // by it — `greatHallSeats` reads the same bench list, so a hall that laid
    // out no furniture seats nobody rather than seating people in mid-air.
    banquet.dress(deck, floor);
  });

  // **The banquet is solid** (#453). Jim, having walked the hall: *"you can
  // walk straight through the tables — they should be solid."* Per floor,
  // off `greatHallSolids`, which returns nothing on a storey that is not the
  // great hall — so a hall that ever moves storey brings its collision with it.
  for (const floor of CASTLE_FLOORS) registerHallCollision(collision, floor);
  // **And everything the dressing stood on the floor** (17 Oct 2026): the
  // crates in the corners, the woodpile, the roof's troughs, the throne on its
  // dais, the armour on its plinths, the chest, the fireside bench. Each solid
  // is the one its drawer handed back — see `CastleDecorSolid`.
  for (const floor of CASTLE_FLOORS) registerDecorCollision(collision, floor, decorSolids[floor.index] ?? []);

  return {
    fire,
    banquet,
    seats: greatHallSeats(CASTLE_GREAT_HALL_DECK),
    seatPickRadius: SIT_PICK_RADIUS,
    petTablePlaces: greatHallPetPlaces(CASTLE_GREAT_HALL_DECK).map((place) => ({
      x: floorX(CASTLE_HALL, place.x),
      y: BUILDING_BASE_Y,
      z: floorZ(CASTLE_HALL, place.z),
      facing: place.facing,
    })),
    feastDish(kind, seat, reach) {
      const dish = createCastleFeastProp(kind);
      // On the table's measured top, `reach` towards it from her seat — which
      // is where she is looking, because `seat.yaw` is the way she turned to
      // sit down.
      dish.root.position.set(
        seat.x + Math.sin(seat.yaw) * reach,
        CASTLE_TABLE_TOP,
        seat.z + Math.cos(seat.yaw) * reach,
      );
      return dish.root;
    },
  };
}

/**
 * How far the banquet's collider walls are inset from the drawn footprint —
 * half their thickness — in metres.
 *
 * The same 0.2 m `hotel/place.ts` uses, and for its reason rather than for
 * symmetry: `CollisionWorld.maxSafeStep` divides the **thinnest** collider in
 * the whole world into sub-steps for every mover in it, so a hair-thin table
 * edge would make the park's collision loop run more sub-steps per frame for
 * ever. 0.2 m is already the park's own thinnest (the entrance's rope posts),
 * so nothing here lowers it.
 */
const HALL_SOLID_HALF_THICKNESS = 0.2;

/**
 * **The banquet's furniture is solid** (#453) — the tables, the benches either
 * side of them, and the pets' table.
 *
 * `castleFurniture.ts`'s {@link greatHallSolids} owns the footprints (and says
 * at length why they may exist at all now, and why one rectangle per *run*);
 * this owns only the registration. Two details are load-bearing:
 *
 * - **The half-extents are inset by the wall's own half-thickness**, so the
 *   face a child's body meets is the footprint she can see rather than 0.2 m
 *   outside it. `hotel/place.ts`'s rule: generous-light, never generous-heavy.
 * - **`topIsAbsolute`, with the prop's real top.** Solid to feet on the
 *   flagstones, air to feet in a jump, and still there beneath the feet
 *   standing on it. The default `Infinity` would make a 0.675 m table an
 *   invisible pillar to the ceiling — the bug the hotel's furniture already
 *   paid for once.
 */
export function registerHallCollision(collision: CollisionWorld, floor: CastleFloor): void {
  for (const solid of greatHallSolids(floor.index)) {
    const cx = floorX(floor, solid.x);
    const cz = floorZ(floor, solid.z);
    const top = BUILDING_BASE_Y + solid.top;

    // The edges, crisp: four thin walls on the footprint the eye can see.
    collision.kinded(solid.kind, () =>
      collision.addRectangle(
        cx,
        cz,
        solid.halfX - HALL_SOLID_HALF_THICKNESS,
        solid.halfZ - HALL_SOLID_HALF_THICKNESS,
        HALL_SOLID_HALF_THICKNESS,
        top,
        false,
        true,
      ),
    );
  }
}

/**
 * **The castle's dressing is solid** — whatever `dressCastle` stood on this
 * floor and handed back ({@link CastleDecorSolid}), one filled box each at its
 * real top, so a crate is a crate she climbs and the armour a knight she
 * bumps. A filled box has no hollow middle (`Collision.ts`'s `BoxCollider`),
 * so nothing here can trap a body inside it.
 */
export function registerDecorCollision(
  collision: CollisionWorld,
  floor: CastleFloor,
  solids: readonly CastleDecorSolid[],
): void {
  for (const solid of solids) {
    collision.kinded(solid.kind, () =>
      collision.addBox(
        floorX(floor, solid.x),
        floorZ(floor, solid.z),
        solid.halfX,
        solid.halfZ,
        -solid.yaw,
        0,
        BUILDING_BASE_Y + solid.top,
        false,
        true,
      ),
    );
  }
}
