import { beforeEach, describe, expect, it } from 'vitest';
import { shopItem } from '../../src/world/building/shops/catalogue';

/**
 * **A save written before RiPika became a pet still loads, and she still
 * works.**
 *
 * `toy.ripika` became `pet.ripika` with `kind: 'pet'` on 30 August 2026. An id
 * is the one thing the save reader's tolerance cannot absorb, because
 * `readInventoryItem` rebuilds an item from the *save file* rather than from
 * the catalogue: an old RiPika therefore survives being read, and is then
 * silently skipped forever by `Parade`'s `if (!catalogue) continue`. What a
 * child would have seen is a pet in her Cute-o-dex that could not walk, could
 * not be carried and could not be re-collected, with `pet.ripika` sitting
 * undiscovered next to it.
 *
 * Jim ruled: migrate on load, lose nothing. This proves that against a real
 * v1 blob rather than against the code path — the failure mode is a
 * six-year-old opening the game to a pet that will not follow her, and
 * "it compiles" is worth nothing against that.
 *
 * Note what is asserted besides the rename: **the Cute-o-dex is a second
 * register**, keyed by catalogue id and carrying the id again inside each
 * entry, so migrating the inventory alone would leave her filed under Toys and
 * `pet.ripika` never found. And `egg.prize.ripika` — "Tiny RiPika", a
 * different catalogue entry that did *not* move — must come through untouched,
 * which is what stops the migration being a substring rename.
 */

/** A save of exactly the shape the game wrote before the rename. */
function v1Save() {
  return {
    v: 1,
    at: 1756400000000,
    purchases: 3,
    game: {
      mode: 'normal',
      money: 120,
      inventory: [
        {
          uid: 'toy.ripika#1',
          id: 'toy.ripika',
          kind: 'toy',
          displayName: 'RiPika',
          icon: '⚡',
          category: 'toy',
          shopId: 'toy',
          acquiredAt: { day: 0, timeOfDay: 0.3 },
          carryable: true,
          paradeable: true,
          stowed: false,
        },
        {
          uid: 'egg.prize.ripika#2',
          id: 'egg.prize.ripika',
          kind: 'toy',
          displayName: 'Tiny RiPika',
          icon: '⚡',
          category: 'egg',
          shopId: 'surpriseEgg',
          acquiredAt: { day: 0, timeOfDay: 0.5 },
          carryable: true,
          paradeable: true,
          stowed: true,
        },
      ],
      collection: {
        'toy.ripika': {
          id: 'toy.ripika',
          name: 'RiPika',
          category: 'toy',
          count: 1,
          placement: 'parade',
          discovered: true,
        },
        'egg.prize.ripika': {
          id: 'egg.prize.ripika',
          name: 'Tiny RiPika',
          category: 'egg',
          count: 1,
          placement: 'backpack',
          discovered: true,
        },
      },
      // A pointer *at* the uid, which is why the migration leaves uids alone.
      carriedUid: 'toy.ripika#1',
    },
    flags: { createdCharacter: true },
  };
}

/** The node test env has no `window`; `save.ts` reaches for `localStorage` on it.
 *  Same stand-in as `save-flags-round-trip.test.ts`, for the same reason. */
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
}

let storage: MemoryStorage;

/** Imported lazily, after `window` exists, since the module reads it on use. */
async function saveModule() {
  return import('../../src/state/save.ts');
}

async function writeRaw(value: unknown): Promise<void> {
  const { SAVE_KEY } = await saveModule();
  storage.setItem(SAVE_KEY, JSON.stringify(value));
}

async function load() {
  const { loadSave } = await saveModule();
  return loadSave();
}

describe('a v1 save, written before RiPika became a pet', () => {
  beforeEach(() => {
    storage = new MemoryStorage();
    (globalThis as { window?: unknown }).window = { localStorage: storage };
  });

  it('loads at all, and comes back stamped at the current version', async () => {
    await writeRaw(v1Save());
    const save = await load();
    const { SAVE_VERSION } = await saveModule();
    expect(save).not.toBeNull();
    expect(save?.v).toBe(SAVE_VERSION);
  });

  it('still has RiPika, now as a pet the catalogue knows', async () => {
    await writeRaw(v1Save());
    const save = await load();
    const ripika = save?.game.inventory?.find((item) => item.id === 'pet.ripika');

    expect(ripika, 'she must survive the migration').toBeDefined();
    expect(ripika?.kind).toBe('pet');
    expect(ripika?.category).toBe('pet');
    // The whole point: the id now resolves, so the parade will not skip her.
    expect(shopItem(ripika!.id)).not.toBeNull();
  });

  it('leaves her walking and carryable, and does not break the pointer at her', async () => {
    await writeRaw(v1Save());
    const save = await load();
    const ripika = save?.game.inventory?.find((item) => item.id === 'pet.ripika');

    expect(ripika?.paradeable).toBe(true);
    expect(ripika?.stowed).toBe(false);
    expect(ripika?.carryable).toBe(true);
    // The uid is deliberately not rewritten — `carriedUid` points at it, and
    // tidying an invisible string is not worth dropping what is in her hands.
    expect(ripika?.uid).toBe('toy.ripika#1');
    expect(save?.game.carriedUid).toBe(ripika?.uid);
  });

  it('moves her Cute-o-dex entry too, so she still reads as found', async () => {
    await writeRaw(v1Save());
    const save = await load();
    const collection = save?.game.collection ?? {};

    expect(collection['toy.ripika'], 'the old key must be gone').toBeUndefined();
    const found = collection['pet.ripika'];
    expect(found, 'she must be filed under the new id').toBeDefined();
    expect(found?.discovered).toBe(true);
    // The entry carries the id a second time inside itself.
    expect(found?.id).toBe('pet.ripika');
    expect(found?.category).toBe('pet');
  });

  it('leaves Tiny RiPika, a different catalogue entry, completely alone', async () => {
    await writeRaw(v1Save());
    const save = await load();

    const tiny = save?.game.inventory?.find((item) => item.id === 'egg.prize.ripika');
    expect(tiny?.kind).toBe('toy');
    expect(tiny?.category).toBe('egg');
    expect(save?.game.collection?.['egg.prize.ripika']?.category).toBe('egg');
  });

  it('passes through a v1 save that never had a RiPika, rather than throwing', async () => {
    const bare = v1Save();
    bare.game.inventory = [];
    bare.game.collection = {} as (typeof bare)['game']['collection'];
    delete (bare.game as Partial<(typeof bare)['game']>).carriedUid;
    await writeRaw(bare);

    const save = await load();
    const { SAVE_VERSION } = await saveModule();
    expect(save).not.toBeNull();
    expect(save?.v).toBe(SAVE_VERSION);
    expect(save?.game.inventory).toEqual([]);
  });

  it('survives a v1 save whose game object is missing entirely', async () => {
    await writeRaw({ v: 1, at: 1, purchases: 0, flags: { createdCharacter: true } });
    const save = await load();
    const { SAVE_VERSION } = await saveModule();
    expect(save).not.toBeNull();
    expect(save?.v).toBe(SAVE_VERSION);
  });
});
