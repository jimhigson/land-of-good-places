import { describe, expect, it } from 'vitest';
import { gameStore, type CharacterCreationChoice } from '../../src/state';
import { shopItem } from '../../src/world/building/shops/catalogue';

/**
 * `completeCharacterCreation` used to run exactly once per page load. The
 * "Look" pill now runs it again on every visit, over a save that already
 * exists, which turned two latent shortcuts into real bugs:
 *
 * - it filed a *fresh* hat and pet each time (`grantFree` mints a new uid and
 *   never matched what was already owned), so repeated visits stacked up
 *   duplicates — five taps, five identical pets in the parade;
 * - it wrote `wornHatUid` directly rather than going through `setWornHat`, so
 *   the Cute-o-dex's `placement` bookkeeping was never refreshed. That was
 *   survivable only while changing your look reloaded the page, because the
 *   reload laundered the whole store through `hydrate` on the way back in.
 *
 * These assert the *store's* behaviour, which is where both bugs live — no
 * DOM, no renderer, no `Game`.
 */

const HAT_A = 'hat.party';
const HAT_B = 'hat.crown';
const PET = 'pet.bunny';

function specFor(id: string) {
  const item = shopItem(id);
  if (!item) throw new Error(`test fixture missing from the catalogue: ${id}`);
  return item;
}

/** A complete, valid choice — only the two fields under test ever vary. */
function choiceWith(hatId: string | null, name = 'Wren'): CharacterCreationChoice {
  return {
    name,
    skinColour: 0xffccaa,
    hairColour: 0x4b2e19,
    hairStyle: 'bob',
    outfitColour: 0xff8844,
    outfitArmsColour: 0xff8844,
    eyeColour: 0x3355aa,
    backpackKind: 'satchel',
    backpackColour: 0x44aa88,
    shoeKind: 'plain',
    shoeColour: 0xffffff,
    glassesKind: null,
    hat: hatId === null ? null : specFor(hatId),
    pet: specFor(PET),
  };
}

/** Every inventory entry for a catalogue id. */
function ownedCopies(id: string) {
  return gameStore.get().inventory.filter((item) => item.id === id);
}

function dexEntryFor(id: string) {
  return gameStore.get().collection[id];
}

describe('completeCharacterCreation, run more than once (the "Look" pill)', () => {
  it('does not stack up duplicate hats and pets', () => {
    gameStore.completeCharacterCreation(choiceWith(HAT_A));

    expect(ownedCopies(HAT_A)).toHaveLength(1);
    expect(ownedCopies(PET)).toHaveLength(1);

    // Four more visits, as a child pressing a shiny pill would.
    for (let visit = 0; visit < 4; visit += 1) {
      gameStore.completeCharacterCreation(choiceWith(HAT_A));
    }

    expect(ownedCopies(HAT_A), 'the same hat must not be re-granted').toHaveLength(1);
    expect(ownedCopies(PET), 'the same pet must not be re-granted').toHaveLength(1);
  });

  it('keeps the Cute-o-dex placement honest when the hat changes', () => {
    gameStore.completeCharacterCreation(choiceWith(HAT_A));
    expect(dexEntryFor(HAT_A)?.placement, 'the chosen hat is on her head').toBe('worn');

    // Swap to a different hat: the old one comes off, the new one goes on, and
    // *both* entries have to be re-derived. The bare `wornHatUid` write only
    // ever left the incoming one looking right.
    gameStore.completeCharacterCreation(choiceWith(HAT_B));

    expect(dexEntryFor(HAT_B)?.placement, 'the new hat is worn').toBe('worn');
    expect(dexEntryFor(HAT_A)?.placement, 'the old hat is no longer worn').not.toBe('worn');
  });

  /**
   * A **guard, not a regression test** — worth being explicit, because I first
   * reported all three of these as failing against the pre-fix code and they
   * do not. This one exercises the `else` branch, which already went through
   * `setWornHat(null)` before any of these changes, so it passes either way.
   * It earns its place by pinning the behaviour against future edits to
   * `completeCharacterCreation`; it proves nothing about the fixes above it.
   */
  it('takes the hat off when an exclusive hair style leaves no hat chosen', () => {
    gameStore.completeCharacterCreation(choiceWith(HAT_A));
    expect(gameStore.get().wornHatUid).not.toBeNull();

    gameStore.completeCharacterCreation(choiceWith(null));

    expect(gameStore.get().wornHatUid, 'no hat chosen means bare-headed').toBeNull();
    expect(dexEntryFor(HAT_A)?.placement, 'and the dex agrees').not.toBe('worn');
  });
});
