import { HOTEL_INSIDE_GLB_BASE64 } from '../assets/hotelInsideGlb';
import { base64ToArrayBuffer, readGlbParts } from '../style/glb';
import { registerHotelParts } from './hotelAssets';

/**
 * **The hotel's inside kit** — its furniture, staircases, chandelier and
 * television, cut out of `hotel.glb` at pack time (`hotelKitSplit.ts`) so that
 * they load with the interior, not at boot.
 *
 * Imported only by `world/hotel/interior.ts`, which is a lazy chunk
 * (`world/interiors.ts`'s `HOTEL_INTERIOR`); `check:boot-chunk` fails if this
 * or its bytes ever reach the boot. {@link loadHotelInsideKit} is idempotent and
 * is called before the interior builds anything.
 */
let loaded = false;

export function loadHotelInsideKit(): void {
  if (loaded) return;
  loaded = true;
  registerHotelParts(readGlbParts(base64ToArrayBuffer(HOTEL_INSIDE_GLB_BASE64)));
}
