import { Group } from 'three';
import { attachFacePaint, type KidHandle } from '../art/models/kid';
import { createGlasses } from '../art/models/glasses';
import { KEYCHAIN_WORN_SCALE, keychainWornLift } from '../art/models/keychains';
import { FACE_PAINT_DESIGNS, type FacePaintDesign } from '../art/style/faces';
import type { FacePaintId, GlassesKind } from '../state';
import { shopItem } from '../world/building/shops/catalogue';

/**
 * **What a kid wears over her body, put on a kid who is standing still** —
 * the one owner of dressing a freshly built `createKid` for a picture of her:
 * the character creator's live preview (and the stalls' previews that share
 * it), and the library's picture books, whose girl is the one holding the book
 * (#717).
 *
 * In the park the same things go on through `WornHat`, `WornKeychain` and the
 * face-paint stall's `attachFacePaint`, which also animate them on and swing
 * them about. This is the still version of exactly those attachments, so a
 * preview and a picture show the hat, the keyring and the face paint she
 * really walks about in — drawn by one piece of code, not three that agree
 * today.
 */
export interface KidDressing {
  /** The face-paint design, or `null` for a clean face. */
  readonly facePaint: FacePaintDesign | null;
  /** A hat's catalogue id, or `''` for none — the creator's "nothing chosen" sentinel. */
  readonly hatId: string;
  readonly glasses: GlassesKind | null;
  /** A keyring's catalogue id, or `''` for none. */
  readonly keychainId: string;
}

/** True when `value` is one of the face-paint stall's designs (a saved id may be stale). */
export function isFacePaintDesign(value: FacePaintId): value is FacePaintDesign {
  return value !== null && (FACE_PAINT_DESIGNS as readonly string[]).includes(value);
}

/**
 * Dresses `kid` in `dressing`. `keychainPivot` is what the keyring hangs from —
 * a caller that sways it (the preview) passes its own and keeps it; it is
 * emptied and re-hung here either way.
 */
export function dressKid(kid: KidHandle, dressing: KidDressing, keychainPivot: Group = new Group()): void {
  // The face paint, if any — built by the very same call the face-painting
  // stall makes on the real player (`attachFacePaint`), so the design shown is
  // the design she walks away wearing.
  if (dressing.facePaint) attachFacePaint(kid).setDesign(dressing.facePaint);

  // Same attachment every worn hat uses in the real game — see
  // `art/models/hats.ts`'s doc comment: no offset maths needed. Gated on
  // `!kid.hairHidesHat`: the freshly-built kid already knows whether the
  // chosen hair style (Mohican, today) cannot coexist with a worn hat, and
  // if so the *hat* is the one that does not get attached — hair is never
  // the thing that hides any more, see `art/models/hair.ts`'s
  // `HairPart.hideUnderHat`.
  const hatAsset = kid.hairHidesHat ? undefined : shopItem(dressing.hatId)?.model();
  if (hatAsset) kid.hatAnchor.add(hatAsset.root);
  // Same courtesy `entities/WornHat.ts` does in the park: tell the model a
  // hat's attachment just changed, so its measured height re-checks. Not
  // "is a hat worn" any more — see `KidHandle.setHatWorn`'s doc comment.
  kid.setHatWorn(hatAsset !== undefined);

  // Glasses — hats and glasses coexist cleanly (separate anchors, a hat's
  // brim already contractually clears the eye line: see `art/models/
  // kid.ts`'s `glassesAnchor` doc comment), so unlike the hat there is no
  // hiding check here, and no `setXWorn` remeasure call: glasses do not
  // change `height`. `null` ("None" in the creator) attaches nothing.
  if (dressing.glasses) kid.glassesAnchor.add(createGlasses(dressing.glasses).root);

  // The worn keychain, hung exactly the way `entities/WornKeychain.ts` hangs
  // the real one: the keyring models stand up from their own base (the asset
  // contract grants the `'anchor'` origin reading only to `hat.` ids), so it
  // is dropped by its own measured `height` (at `KEYCHAIN_WORN_SCALE`, and
  // lifted the same `keychainWornLift` amount off the bag's exact corner)
  // and swung about the top rather than about its feet — a preview must not
  // show a smaller keyring than the one she is about to actually wear.
  keychainPivot.clear();
  keychainPivot.removeFromParent();
  const keychainAsset = dressing.keychainId ? shopItem(dressing.keychainId)?.model() : undefined;
  if (keychainAsset) {
    keychainAsset.root.position.y = -keychainAsset.height * KEYCHAIN_WORN_SCALE;
    keychainAsset.root.scale.setScalar(KEYCHAIN_WORN_SCALE);
    keychainPivot.position.set(0, keychainWornLift(kid.keychainAnchor.position.y, keychainAsset.height), 0);
    keychainPivot.add(keychainAsset.root);
    kid.keychainAnchor.add(keychainPivot);
  }
}
