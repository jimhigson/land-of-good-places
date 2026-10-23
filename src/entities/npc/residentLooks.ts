import { PALETTE } from '../../core/palette';
import type { Rng } from '../../core/mathUtils';
import { ART } from '../../art/style/artPalette';
import { KID_SKIN_TONES, type KidOptions } from '../../art/models/kid';
import type { CharacterColours } from '../CharacterModel';

/**
 * **How a resident child looks, and how fast she strolls** — the one owner,
 * for every space that has people living in it.
 *
 * Lifted out of `world/hotel/HotelGuests.ts` for the library's three children
 * (#718), who are residents built exactly as the hotel's guests are: a
 * `CharacterModel` drawn from these lists by a seeded `Rng`, strolling at
 * {@link GUEST_PACE}. Two copies of a wardrobe is CLAUDE.md's "two
 * definitions of one thing" in its most innocent-looking form — the day a
 * colour is added to one, the hotel and the library dress from two different
 * shops and nothing says so.
 *
 * **The order of each list is part of every child's look.** A resident draws
 * from them by index (`rng.pick`), so reordering one, or inserting a colour
 * anywhere but the end, re-dresses every guest in the hotel.
 */

/** Outfit colours, all from the world's own marker set. */
export const OUTFITS: readonly number[] = [
  PALETTE.markerSky,
  PALETTE.markerMint,
  PALETTE.markerLemon,
  PALETTE.markerLilac,
  PALETTE.flowerRed,
  PALETTE.blossomPink,
];

export const HAIRS: readonly number[] = [ART.kidHair, ART.kidHairBlonde, PALETTE.bark, PALETTE.barkDark];

/**
 * Hair a resident may wear.
 *
 * No ponytail: those styles carry a **world-space** simulated chain
 * (`KidHandle.resetHair`'s doc comment), which then wants driving every frame
 * and resetting on every re-parent. A background resident is not worth a
 * second thing that can go visibly wrong, and none of these styles has one.
 */
export const HAIR_STYLES = ['bunches', 'bob', 'short', 'bowl', 'spiky'] as const;

/**
 * Fraction of the house walking pace a resident strolls at.
 *
 * A hotel, or a library, is somewhere people amble; the park is somewhere
 * children run. Half pace is the difference, and it comes out of the same
 * `CharacterIntent` the park's own crowd fills in, so there is no second speed
 * constant anywhere.
 */
export const GUEST_PACE = 0.45;

/**
 * **One resident child's look, drawn from her own seeded stream** — skin,
 * hair, outfit, hair style, backpack and the backpack's colour, in that order.
 * The one owner of the order, because **the order is the child**: swap two of
 * these draws and every guest in the hotel is wearing somebody else's clothes.
 * The hotel's guests (`HotelGuests.ts`) and the library's children
 * (`LibraryKids.ts`) both dress here; their streams are their own.
 */
export function residentLook(rng: Rng): { readonly colours: CharacterColours; readonly options: KidOptions } {
  const skin = (KID_SKIN_TONES[rng.int(0, KID_SKIN_TONES.length - 1)] ?? KID_SKIN_TONES[1])!.colour;
  const hair = rng.pick(HAIRS);
  const outfit = rng.pick(OUTFITS);
  const hairStyle = rng.pick(HAIR_STYLES);
  const backpack = rng.chance(0.5);
  const backpackColour = rng.pick(OUTFITS);
  return {
    // A resident's arms match her shirt — the plain, single-colour look
    // `createKid` gave these children before `CharacterModel` (which asks for
    // both) took over building them.
    colours: { skin, hair, outfit, outfitArms: outfit, shoe: PALETTE.shoe },
    options: { hairStyle, backpack, backpackColour },
  };
}
