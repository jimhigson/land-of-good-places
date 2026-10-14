import { beforeEach, describe, expect, it } from 'vitest';
import type { SaveFile, SavedFlags } from '../../src/state/save.ts';

/**
 * **Does `arrivedByBus` actually survive a trip to disk and back?**
 *
 * Nothing anywhere in this repo tested `save.ts` before this file. Not the
 * write, not the read, not one field — which is how the park came to ship a
 * save file that faithfully persisted a flag recording whether the player had
 * seen a cat bus **that could not exist**, for twelve days, while
 * `arrivedByBus` appeared twelve times in the shipped bundle and `cat-bus`
 * appeared not at all. The bookkeeping shipped; the thing it books did not.
 *
 * That flag is now load-bearing: it is the one mechanism deciding whether the
 * arrival plays (`world/entrance/ArrivalSequence.ts`'s `arrivalIsDue`), so a
 * round trip that silently dropped it would either replay the arrival forever
 * or suppress it forever, and both look like the original bug from outside.
 *
 * The tests below drive the **real** `writeSave`/`loadSave`/`clearSave` against
 * a real `JSON.stringify`, through a `localStorage` stand-in, rather than
 * asserting that a setter set something.
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
});

/** Imported lazily, after `window` exists, since the module reads it on use. */
async function saveModule() {
  return import('../../src/state/save.ts');
}

describe('the save file carries the cat-bus flag', () => {
  it('round-trips arrivedByBus: false', async () => {
    const { writeSave, loadSave, SAVE_KEY } = await saveModule();
    const wrote = writeSave(fileWithFlags({ createdCharacter: true, arrivedByBus: false }));
    expect(wrote, 'writeSave reported failure').toBe(true);

    // It genuinely reached storage, and as JSON — not merely "no exception".
    const raw = storage.raw(SAVE_KEY);
    expect(raw, 'nothing was written to localStorage at all').not.toBeNull();
    expect(JSON.parse(raw ?? '{}')).toMatchObject({ flags: { arrivedByBus: false } });

    const read = loadSave();
    expect(read, 'loadSave could not read back what writeSave just wrote').not.toBeNull();
    expect(read?.flags.arrivedByBus).toBe(false);
  });

  it('round-trips arrivedByBus: true', async () => {
    const { writeSave, loadSave } = await saveModule();
    writeSave(fileWithFlags({ createdCharacter: true, arrivedByBus: true }));
    expect(loadSave()?.flags.arrivedByBus).toBe(true);
  });

  /**
   * The case that decides whether a brand-new player gets the arrival at all.
   *
   * A save written before the flag existed has no `arrivedByBus` key. It must
   * read back as **absent**, so that `SaveFlags.hydrate` leaves its `false`
   * default alone and the arrival plays — rather than reading back as some
   * truthy thing and silently suppressing the sequence for ever, which is
   * indistinguishable from the bug this whole feature is a fix for.
   */
  it('leaves a missing arrivedByBus missing, so the default survives', async () => {
    const { writeSave, loadSave } = await saveModule();
    writeSave(fileWithFlags({ createdCharacter: true }));
    const read = loadSave();
    expect(read?.flags.arrivedByBus).toBeUndefined();

    const { saveFlags } = await import('../../src/state/flags.ts');
    saveFlags.hydrate(read?.flags ?? {});
    expect(saveFlags.arrivedByBus, 'an old save must not suppress the arrival').toBe(false);
  });

  it('a cleared save reads back as nothing, so a new game arrives by bus', async () => {
    const { writeSave, loadSave, clearSave } = await saveModule();
    writeSave(fileWithFlags({ createdCharacter: true, arrivedByBus: true }));
    clearSave();
    expect(loadSave()).toBeNull();
  });

  it('survives garbage in storage rather than throwing', async () => {
    const { loadSave, SAVE_KEY } = await saveModule();
    storage.setItem(SAVE_KEY, '{not json at all');
    expect(loadSave()).toBeNull();
  });
});

describe('markArrived is what closes the sequence', () => {
  it('flips the flag and bumps the revision the autosave watches', async () => {
    const { saveFlags } = await import('../../src/state/flags.ts');
    saveFlags.hydrate({ arrivedByBus: false });
    const before = saveFlags.revision;
    expect(saveFlags.arrivedByBus).toBe(false);

    saveFlags.markArrived();
    expect(saveFlags.arrivedByBus).toBe(true);
    expect(
      saveFlags.revision,
      'the autosave never notices, so the arrival replays on next load',
    ).toBeGreaterThan(before);
  });
});

/**
 * **The library's read books (#717) ride the save's own collection.**
 *
 * A book read to its last page is a `book` `CuteThing` (`book.<id>`), and the
 * every-book prize is a one-time flag, `bookPrizeSeen`. Neither is a new
 * mechanism — so what needs proving is that the existing one carries them, and
 * that a save from before the library still loads exactly as it did.
 */
describe('the library books ride the save (#717)', () => {
  it('round-trips a read book and the book prize', async () => {
    const { writeSave, loadSave } = await saveModule();
    writeSave({
      ...fileWithFlags({ createdCharacter: true, bookPrizeSeen: true }),
      game: {
        collection: {
          'book.catBusDay': {
            id: 'book.catBusDay',
            name: "The Cat Bus's Long Day",
            category: 'book',
            count: 1,
            placement: 'backpack',
            discovered: true,
          },
        },
      },
    });
    const read = loadSave();
    expect(read?.game.collection?.['book.catBusDay']?.category).toBe('book');
    expect(read?.game.collection?.['book.catBusDay']?.discovered).toBe(true);
    expect(read?.flags.bookPrizeSeen).toBe(true);

    const { saveFlags } = await import('../../src/state/flags.ts');
    saveFlags.hydrate(read?.flags ?? {});
    expect(saveFlags.bookPrizeSeen).toBe(true);
  });

  it('loads a save from before the library with nothing read and no prize seen', async () => {
    const { writeSave, loadSave } = await saveModule();
    writeSave({
      ...fileWithFlags({ createdCharacter: true }),
      game: {
        collection: {
          'secret.dust': {
            id: 'secret.dust',
            name: 'Dust cloud',
            category: 'secret',
            count: 1,
            placement: 'backpack',
            discovered: true,
          },
        },
      },
    });
    const read = loadSave();
    expect(read, 'a pre-library save must still load').not.toBeNull();
    expect(Object.keys(read?.game.collection ?? {})).toEqual(['secret.dust']);
    expect(read?.flags.bookPrizeSeen).toBeUndefined();
  });

  /**
   * What an *older* build does with a newer save is the same rule, from the
   * other side: it does not know the word `book`, so it drops those entries
   * and loads everything else. Shown here with a category this build does not
   * know either — the tolerance is per entry, never all-or-nothing.
   */
  it('drops an entry whose category it does not know, and keeps the rest', async () => {
    const { writeSave, loadSave } = await saveModule();
    writeSave({
      ...fileWithFlags({ createdCharacter: true }),
      game: {
        collection: {
          'book.fireflies': {
            id: 'book.fireflies',
            name: 'Fireflies at Night',
            category: 'book',
            count: 1,
            placement: 'backpack',
            discovered: true,
          },
          'future.thing': {
            id: 'future.thing',
            name: 'Something from next year',
            category: 'notYetInvented' as never,
            count: 1,
            placement: 'backpack',
            discovered: true,
          },
        },
      },
    });
    const read = loadSave();
    expect(Object.keys(read?.game.collection ?? {})).toEqual(['book.fireflies']);
  });
});

/** A minimal but *real* `SaveFile`, so `writeSave` is exercised as it is used. */
function fileWithFlags(flags: SavedFlags): SaveFile {
  return {
    v: 1,
    at: 1_754_000_000_000,
    purchases: 0,
    game: {},
    flags,
  };
}
