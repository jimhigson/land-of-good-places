import type { Object3D } from 'three';
import { PALETTE } from '../../core/palette';
import { Rng } from '../../core/mathUtils';
import { KID_SKIN_TONES } from '../../art/models/kid';
import { CharacterModel } from '../../entities/CharacterModel';
import { characterModelAvatar, type ResidentSpec } from '../../entities/npc';
import { PLAYER_SEPARATION, SEPARATION } from '../../entities/npc/NpcSystem';
import { GUEST_PACE, HAIR_STYLES, HAIRS, OUTFITS } from '../../entities/npc/residentLooks';
import { LibraryKidDriver } from './libraryKidDriver';
import {
  LIBRARY_FLOOR_Y,
  LIBRARY_KID_PLANS,
  LIBRARY_ORIGIN_X,
  LIBRARY_ORIGIN_Z,
  LIBRARY_PLAYER_SEATS,
  libraryCushion,
  libraryKidCircuit,
  type LibraryKidPlan,
} from './layout';

/**
 * **The library's three children** (#718, plan Step 8): who they are, and how
 * they are handed to the crowd.
 *
 * They are residents in exactly the hotel's sense (`HotelGuests.ts`,
 * `NpcSystem`'s `ResidentSpec`): a `CharacterModel` each, dressed from the one
 * resident wardrobe (`entities/npc/residentLooks.ts`) by a seeded stream of
 * her own, parented into the Library's identity root so she appears and
 * vanishes with the room, and walked by `NpcCharacter` — the same body, walk
 * cycle, collision and push-apart as every child in the park. What differs is
 * the decision layer, which `ResidentSpec.driver` lets a space hand in: a
 * {@link LibraryKidDriver}, which strolls her aisle and answers story time.
 *
 * **Three**, for the canvas budget: each individually-rendered child paints
 * five expression canvases (the hotel's note), and the Library's own creatures
 * paint more. The lever is a plan line in `layout.ts`'s `LIBRARY_KID_PLANS`.
 *
 * **Seeds are disjoint from the hotel's** (`0x6035 + i·977`), the diners',
 * the books' and the park's, so nobody here moves a hotel guest or a park
 * child by a millimetre, and the draws come **in the hotel's fixed order** —
 * skin, hair, outfit, hair style, backpack, backpack colour — because the
 * order is the look.
 *
 * **The seats are asserted apart as this module loads**: every child's cushion
 * at least `SEPARATION` from every other child's and `PLAYER_SEPARATION` from
 * both cushions the player is offered. Nearer, and the crowd's push-apart
 * would shove one sitter off her seat the moment the other sat down — found
 * by a build failure here, never by a six-year-old.
 */

/** The first child's seed; the i-th child's is this plus `i` strides. */
export const LIBRARY_KID_SEED = 0x0b00c5;
export const LIBRARY_KID_SEED_STRIDE = 997;

/** One of the children, as built: her plan, her model, her spec for the crowd, and — once the crowd has built it — her driver. */
export interface LibraryResident {
  readonly plan: LibraryKidPlan;
  readonly model: CharacterModel;
  readonly spec: ResidentSpec;
  /**
   * Set by the spec's `driver` factory when `NpcSystem` builds her body; null
   * until then. It is how `Library.attachNpcs` tells which of the crowd's
   * bodies are its children.
   */
  driver: LibraryKidDriver | null;
}

/**
 * Builds the library's children, ready for `World` to hand to `NpcSystem`.
 *
 * @param parent  the node every child's model is added to — `Library.kidsRoot`,
 *   which must have an **identity transform**: an `NpcCharacter` writes world
 *   positions straight onto its model's root (the hotel's rule, for the same
 *   reason), and the reading room's own root stands at (−600, −600).
 */
export function libraryResidents(parent: Object3D): LibraryResident[] {
  return LIBRARY_KID_PLANS.map((plan, i): LibraryResident => {
    const seed = LIBRARY_KID_SEED + i * LIBRARY_KID_SEED_STRIDE;
    const rng = new Rng(seed);
    // Drawn in this order, one statement each, because the order is the child.
    const skin = (KID_SKIN_TONES[rng.int(0, KID_SKIN_TONES.length - 1)] ?? KID_SKIN_TONES[1])!.colour;
    const hair = rng.pick(HAIRS);
    const outfit = rng.pick(OUTFITS);
    const model = new CharacterModel(
      {
        skin,
        hair,
        outfit,
        // A resident's arms match her shirt — the hotel's plain, single-colour look.
        outfitArms: outfit,
        shoe: PALETTE.shoe,
      },
      {
        hairStyle: rng.pick(HAIR_STYLES),
        backpack: rng.chance(0.5),
        backpackColour: rng.pick(OUTFITS),
      },
    );
    model.root.name = `library.kid.${plan.name}`;
    parent.add(model.root);
    const resident: LibraryResident = {
      plan,
      model,
      driver: null,
      spec: {
        name: plan.name,
        avatar: characterModelAvatar(model),
        // Her circuit in world metres; the body starts on its first point, the exit node.
        waypoints: libraryKidCircuit(plan).map((point) => ({ x: LIBRARY_ORIGIN_X + point.x, z: LIBRARY_ORIGIN_Z + point.z })),
        seed,
        pace: GUEST_PACE,
        floorY: LIBRARY_FLOOR_Y,
        // The crowd hands in the stream the default driver would have had, at
        // the same point in it; her facing and walk phase are drawn after.
        driver: (stream) => {
          const driver = new LibraryKidDriver(stream, plan);
          resident.driver = driver;
          return driver;
        },
      },
    };
    return resident;
  });
}

// The seats, held apart as the module loads — see the header.
{
  const seatOf = (plan: LibraryKidPlan): { readonly x: number; readonly z: number } => libraryCushion(plan.seat).at;
  for (let i = 0; i < LIBRARY_KID_PLANS.length; i += 1) {
    const a = LIBRARY_KID_PLANS[i]!;
    for (let j = i + 1; j < LIBRARY_KID_PLANS.length; j += 1) {
      const b = LIBRARY_KID_PLANS[j]!;
      const apart = Math.hypot(seatOf(a).x - seatOf(b).x, seatOf(a).z - seatOf(b).z);
      if (apart < SEPARATION) {
        throw new Error(
          `Library: ${a.name}'s seat ${a.seat} and ${b.name}'s seat ${b.seat} are ${apart.toFixed(2)} m apart; two children need SEPARATION (${SEPARATION.toFixed(2)} m) or one shoves the other off her cushion`,
        );
      }
    }
    for (const playerSeat of LIBRARY_PLAYER_SEATS) {
      const seat = libraryCushion(playerSeat).at;
      const apart = Math.hypot(seatOf(a).x - seat.x, seatOf(a).z - seat.z);
      if (apart < PLAYER_SEPARATION) {
        throw new Error(
          `Library: ${a.name}'s seat ${a.seat} is ${apart.toFixed(2)} m from the player's ${playerSeat}; a child and the player need PLAYER_SEPARATION (${PLAYER_SEPARATION.toFixed(2)} m) or one shoves the other off her cushion`,
        );
      }
    }
  }
}
