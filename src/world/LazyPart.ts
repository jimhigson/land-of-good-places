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
/**
 * How long a fetch may take before it counts as failed, in milliseconds.
 *
 * Every chunk is precached, so a real load is a disk read; this is not a
 * budget for slow networks. It exists so that a fetch which **hangs** — never
 * resolving and never rejecting — turns into the failure path every caller
 * already has (the iris opens on her where she was, the curtain opens on the
 * park, the held park is let go) rather than a door, a curtain or a book that
 * waits for ever with nothing she can press.
 */
export const LAZY_PART_TIMEOUT_MS = 20_000;

/**
 * After a failed fetch, how long before another `load()` may try again, in
 * milliseconds. Until then `load()` answers with the same failure at once.
 *
 * Callers ask freely — the Reptile House asks every frame she is near its
 * door — so without this a failed room would refetch sixty times a second.
 */
export const LAZY_PART_RETRY_AFTER_MS = 4_000;

/** How a `LazyPart` is built. */
export interface LazyPartOptions<T> {
  /** {@link LAZY_PART_TIMEOUT_MS} unless a test needs it shorter. */
  readonly timeoutMs?: number;
  /** {@link LAZY_PART_RETRY_AFTER_MS} unless a test needs it shorter. */
  readonly retryAfterMs?: number;
  /**
   * **How to fetch it again after a failure, so the fetch really happens.**
   *
   * A browser remembers a failed `import()` for the life of the page and
   * answers every later `import()` of that URL with the same failure, without
   * a request (QA on #749: Chromium 151 and WebKit 26.5 both, three imports and
   * one request). So retrying the same `loader` can never recover — a room
   * that failed once was gone until a reload. This is called instead for every
   * attempt after a real failure, with the attempt number, and must fetch the
   * module under a URL the browser has not seen: `lazyChunks.ts`'s
   * `refetchChunk` does, from the module's source path.
   */
  readonly refetch?: (attempt: number) => Promise<T>;
}

export class LazyPart<T> {
  readonly name: string;
  private readonly loader: () => Promise<T>;
  private readonly timeoutMs: number;
  private readonly retryAfterMs: number;
  private readonly refetch: ((attempt: number) => Promise<T>) | null;
  private value: T | null = null;
  private pending: Promise<T> | null = null;
  /** Fetches that have failed so far; the next attempt after one goes through {@link refetch}. */
  private failures = 0;
  /** The last failure, and when another attempt may be made. */
  private lastError: unknown = null;
  private retryAt = 0;

  constructor(name: string, loader: () => Promise<T>, options: LazyPartOptions<T> = {}) {
    this.name = name;
    this.loader = loader;
    this.timeoutMs = options.timeoutMs ?? LAZY_PART_TIMEOUT_MS;
    this.retryAfterMs = options.retryAfterMs ?? LAZY_PART_RETRY_AFTER_MS;
    this.refetch = options.refetch ?? null;
  }

  /** The module, once it is here; `null` until then. */
  get loaded(): T | null {
    return this.value;
  }

  /**
   * Fetches the module, once: every caller while it is on its way gets the
   * same promise. It rejects on a failed fetch or one still not here after
   * {@link LAZY_PART_TIMEOUT_MS}. A later call tries again — but not until
   * {@link LAZY_PART_RETRY_AFTER_MS} has passed (before that it rejects at
   * once with the same failure), and then under a fresh URL ({@link
   * LazyPartOptions.refetch}), because the browser will not fetch the old one
   * again.
   */
  load(): Promise<T> {
    if (this.value) return Promise.resolve(this.value);
    if (this.pending) return this.pending;
    if (this.failures > 0 && Date.now() < this.retryAt) return Promise.reject(this.lastError);
    const attempt = this.failures;
    // After a timeout the first fetch may still be on its way, and the plain
    // loader then joins it rather than fetching a second copy; after a real
    // failure it rejects at once and the fresh URL is tried.
    const fetchIt = (): Promise<T> => {
      if (attempt === 0 || !this.refetch) return this.loader();
      const refetch = this.refetch;
      return this.loader().catch(() => refetch(attempt));
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${this.name} did not arrive within ${this.timeoutMs} ms`)), this.timeoutMs);
    });
    const pending = Promise.race([Promise.resolve().then(fetchIt), timeout])
      .finally(() => clearTimeout(timer))
      .then(
        (value) => {
          this.value = value;
          this.pending = null;
          return value;
        },
        (error: unknown) => {
          this.pending = null;
          this.failures += 1;
          this.lastError = error;
          this.retryAt = Date.now() + this.retryAfterMs;
          throw error;
        },
      );
    this.pending = pending;
    return pending;
  }

  /** Hands over a module imported statically — Node's checks, which build every room up front. */
  provide(value: T): void {
    this.value = value;
  }
}
