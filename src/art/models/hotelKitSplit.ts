/**
 * **Which of the hotel's authored parts load at boot, and which load when she
 * walks in** — the one owner of that split.
 *
 * `hotel.glb` is one Blender build, but since #749 every interior is fetched on
 * entry (Jim, 12 Nov 2026: *"all interiors should be loaded on-demand on
 * entering that room"*), and the tower in the park is not an interior. So
 * `pack:hotel` cuts the file in two at pack time, by this list:
 *
 * - **the boot kit** (`hotelGlb.ts`) — the tower and its front doors, which
 *   stand in the park, plus the parts other places borrow: the lift (the
 *   castle's alcove, `world/lift/LiftAlcove.ts`), the pet bowl (the castle's
 *   pets), and the pet bed, breakfast bowls and disco ball (the book reader's
 *   pictures). A part one lazy chunk shares with another must live in the boot,
 *   or a failed fetch of one strands the other (`check:boot-chunk` rule 4).
 * - **the inside kit** (`hotelInsideGlb.ts`) — everything else, loaded with the
 *   hotel's interior (`world/hotel/interior.ts`) and registered by
 *   `hotelInsideKit.ts`.
 *
 * Read by `scripts/pack-hotel-asset.mts` (to cut the file) and by
 * `hotelAssets.ts` (to say which kit a missing part belongs to). Nothing else
 * may decide it.
 */
export const HOTEL_BOOT_PART_PREFIXES = [
  'tower-',
  'entrance-door-',
  'lift-',
  'petbowl-',
  'petbed-',
  'food-',
  'disco-',
] as const;

/** True for a part of the boot kit; false for one of the inside kit. */
export function isHotelBootPart(name: string): boolean {
  return HOTEL_BOOT_PART_PREFIXES.some((prefix) => name.startsWith(prefix));
}
