/**
 * **A part of the game that is fetched when she goes into it, not at boot.**
 *
 * Every interior's furnishings and every heavy kit it is drawn from is a lazy
 * chunk of its own (Jim, 12 Nov 2026: *"all interiors should be loaded
 * on-demand on entering that room"*). One of these wraps the dynamic `import()`
 * of such a chunk, so that every road in — a door, a deep link, a save that
 * restores inside the room, a Node check — asks the same object, and the module
 * is fetched once however many ask.
 *
 * Three ways it gets loaded, one per kind of caller:
 *
 * - **A door**, at play: `load()` behind the closing iris
 *   (`SpaceManager.changeTo`'s `ready`), which holds shut until it lands.
 * - **The boot**, for a save that restores inside a room or a deep link that
 *   starts in one: `main.ts` awaits `load()` before `new Game`, so the building
 *   finds it {@link loaded} and furnishes the room in its constructor, exactly
 *   as it always did.
 * - **Node**, where every check builds the whole park: `provide()` hands over a
 *   statically imported module (`scripts/lib/eagerInteriors.mts`), so a
 *   headless build is furnished synchronously and measures what it always
 *   measured.
 */
export class LazyPart<T> {
  readonly name: string;
  private readonly loader: () => Promise<T>;
  private value: T | null = null;
  private pending: Promise<T> | null = null;

  constructor(name: string, loader: () => Promise<T>) {
    this.name = name;
    this.loader = loader;
  }

  /** The module, once it is here; `null` until then. */
  get loaded(): T | null {
    return this.value;
  }

  /** Fetches the module (once — every later call gets the same promise). A failed fetch can be retried. */
  load(): Promise<T> {
    if (this.value) return Promise.resolve(this.value);
    if (!this.pending) {
      const pending = this.loader().then(
        (value) => {
          this.value = value;
          return value;
        },
        (error: unknown) => {
          this.pending = null;
          throw error;
        },
      );
      this.pending = pending;
    }
    return this.pending;
  }

  /** Hands over a module imported statically — Node's checks, which build every room up front. */
  provide(value: T): void {
    this.value = value;
  }
}
