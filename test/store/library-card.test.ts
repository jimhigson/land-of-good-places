import { beforeEach, describe, expect, it } from 'vitest';
import type { SaveFile } from '../../src/state/save.ts';
import { gameStore } from '../../src/state/index.ts';
import { CUTE_CATEGORIES, INVENTORY_KINDS, type InventoryItem } from '../../src/state/types.ts';
import { giveLibraryCard, hasLibraryCard, LIBRARY_CARD } from '../../src/world/library/libraryCard.ts';

/**
 * **The library card is hers once, and it survives a trip to disk.**
 *
 * The owl hands every child a library card (#718). It is an inventory item —
 * kind and category `card` — and the inventory is the one owner of "has she
 * got it" (`world/library/libraryCard.ts`; there is no flag beside it). So the
 * promises worth testing are all about the store and the save file, and they
 * are driven here through the **real** `gameStore.grantKeepsakeOnce` and the
 * real `writeSave`/`loadSave`, against a real `JSON.stringify`, through a
 * `localStorage` stand-in — the shape of `save-flags-round-trip.test.ts`.
 *
 * The card can only fail a child in two quiet ways, and each has a case:
 * a second press filing a second card (case 1), and the save validator not
 * knowing the word `card` and silently dropping it on the next load (case 2 —
 * `state/save.ts` drops an item whose kind it does not know, by design, which
 * is case 4).
 */

/** The node test env has no `window`; `save.ts` reaches for `localStorage` on it. */
class MemoryStorage {
  private readonly entries = new Map<string, string>();

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  /** Lets a test see exactly what reached "disk", bytes and all. */
  raw(key: string): string | null {
    return this.getItem(key);
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  (globalThis as { window?: unknown }).window = { localStorage: storage };
  // A brand-new park: `hydrate` overlays an empty save onto a fresh initial
  // state, so every test starts with an empty backpack and the clock at its
  // default, whatever the test before it granted.
  gameStore.hydrate({ v: 2, at: 0, purchases: 0, game: {}, flags: {} });
});

/** Imported lazily, after `window` exists, since the module reads it on use. */
async function saveModule() {
  return import('../../src/state/save.ts');
}

/** The save the autosave would write right now — `SaveSystem.write`'s own shape. */
async function currentSave(): Promise<SaveFile> {
  const { SAVE_VERSION } = await saveModule();
  return { v: SAVE_VERSION, at: 1_760_000_000_000, purchases: gameStore.purchases, game: gameStore.savedGame(), flags: {} };
}

/** Every library card she owns — there must only ever be one. */
function cards(): InventoryItem[] {
  return gameStore.get().inventory.filter((item) => item.id === LIBRARY_CARD.id);
}

describe('the library card', () => {
  /** Case 1. */
  it('is granted once, however often the owl is asked, and keeps the day she first got it', () => {
    gameStore.setTimeOfDay(0.3, 0, false);
    const first = gameStore.grantKeepsakeOnce(LIBRARY_CARD);
    const firstAt = { ...first.acquiredAt };

    // Two days later she presses the chip again — twice, by both doors.
    gameStore.setTimeOfDay(0.75, 2, true);
    const second = gameStore.grantKeepsakeOnce(LIBRARY_CARD);
    const third = giveLibraryCard();

    expect(cards(), 'a second press filed a second card').toHaveLength(1);
    expect(second.uid).toBe(first.uid);
    expect(third.uid).toBe(first.uid);
    const card = cards()[0]!;
    expect(card.acquiredAt, 'acquiredAt moved to the later press').toEqual(firstAt);
    expect(card.acquiredAt).toEqual({ day: 0, timeOfDay: 0.3 });
    expect(card.kind).toBe('card');
    expect(card.category).toBe('card');
    // …and both are words the save file's validator knows, which is the whole
    // of what keeps the card from being dropped on the next load (case 2).
    expect(INVENTORY_KINDS as readonly string[], "'card' is not an inventory kind the save knows").toContain(card.kind);
    expect(CUTE_CATEGORIES as readonly string[], "'card' is not a category the save knows").toContain(card.category);
    expect(card.stowed, 'a keepsake lives in the backpack').toBe(true);
    expect(card.paradeable, 'a card does not walk behind her').toBe(false);
    expect(hasLibraryCard(gameStore.get())).toBe(true);
  });

  /** Case 2. */
  it('survives writeSave and loadSave, item and Cute-o-dex entry both', async () => {
    const { writeSave, loadSave, SAVE_KEY } = await saveModule();
    giveLibraryCard();
    expect(writeSave(await currentSave()), 'writeSave reported failure').toBe(true);

    // It genuinely reached storage, as JSON.
    const raw = storage.raw(SAVE_KEY);
    expect(raw, 'nothing was written to localStorage at all').not.toBeNull();
    expect(raw).toContain('"card.library"');

    const read = loadSave();
    expect(read, 'loadSave could not read back what writeSave just wrote').not.toBeNull();
    const saved = (read?.game.inventory ?? []).filter((item) => item.id === LIBRARY_CARD.id);
    expect(saved, 'the card was dropped on load').toHaveLength(1);
    expect(saved[0]?.kind).toBe('card');
    expect(saved[0]?.category).toBe('card');
    const entry = read?.game.collection?.[LIBRARY_CARD.id];
    expect(entry, "the card's collection entry was dropped on load").toBeDefined();
    expect(entry?.category).toBe('card');

    // And a park restored from it still knows she has her card.
    gameStore.hydrate(read!);
    expect(hasLibraryCard(gameStore.get()), 'the restored park lost the card').toBe(true);
    expect(cards()).toHaveLength(1);
  });

  /** Case 3. */
  it('is absent from a save written before the library existed', async () => {
    const { loadSave, SAVE_KEY } = await saveModule();
    // Exactly what a v2 build wrote before #718: a pet and a toy, no card, no `card` word anywhere.
    storage.setItem(
      SAVE_KEY,
      JSON.stringify({
        v: 2,
        at: 1_757_000_000_000,
        purchases: 2,
        game: {
          collection: {
            'pet.ripika': { id: 'pet.ripika', name: 'RiPika', category: 'pet', count: 1, placement: 'parade', discovered: true },
            'toy.bunny': { id: 'toy.bunny', name: 'Bunny', category: 'toy', count: 1, placement: 'backpack', discovered: true },
          },
          inventory: [
            savedItem('pet.ripika#1', 'pet.ripika', 'pet', 'pet', true, false),
            savedItem('toy.bunny#2', 'toy.bunny', 'toy', 'toy', true, true),
          ],
        },
        flags: { createdCharacter: true },
      }),
    );

    const read = loadSave();
    expect(read, 'an old save would not load at all').not.toBeNull();
    gameStore.hydrate(read!);
    expect(hasLibraryCard(gameStore.get()), 'an old save came back holding a library card').toBe(false);
    expect(gameStore.get().inventory.map((item) => item.uid)).toEqual(['pet.ripika#1', 'toy.bunny#2']);
  });

  /** Case 4. */
  it("drops an item of an unknown kind ('cardz') and keeps the rest of the inventory", async () => {
    const { loadSave, SAVE_KEY } = await saveModule();
    storage.setItem(
      SAVE_KEY,
      JSON.stringify({
        v: 2,
        at: 1_760_000_000_000,
        purchases: 3,
        game: {
          inventory: [
            savedItem('pet.ripika#1', 'pet.ripika', 'pet', 'pet', true, false),
            savedItem('card.mystery#2', 'card.mystery', 'cardz', 'card', false, true),
            savedItem('toy.bunny#3', 'toy.bunny', 'toy', 'toy', true, true),
          ],
        },
        flags: {},
      }),
    );

    const read = loadSave();
    expect(read, 'one unknown item failed the whole load').not.toBeNull();
    const uids = (read?.game.inventory ?? []).map((item) => item.uid);
    expect(uids, "the 'cardz' item was kept, or its neighbours were lost").toEqual(['pet.ripika#1', 'toy.bunny#3']);
  });
});

/** One inventory entry, exactly as `JSON.stringify` writes an `InventoryItem`. */
function savedItem(
  uid: string,
  id: string,
  kind: string,
  category: string,
  paradeable: boolean,
  stowed: boolean,
): Record<string, unknown> {
  return {
    uid,
    id,
    kind,
    displayName: id,
    icon: '✨',
    category,
    shopId: 'test',
    acquiredAt: { day: 0, timeOfDay: 0.4 },
    carryable: false,
    paradeable,
    stowed,
  };
}
