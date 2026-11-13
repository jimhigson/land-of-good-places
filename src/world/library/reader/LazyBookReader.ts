import type { Mesh, PerspectiveCamera, WebGLRenderer } from 'three';
import { bookById, type LibraryBook } from '../books';
import type { BookReader, BookReaderOptions, ReaderFraming } from './BookReader';
import type * as BookReaderModule from './BookReader';
import { chunkPart } from '../../lazyChunks';
import { LIBRARY_ROOM } from '../../interiors';

/** The reader's chunk — a `LazyPart` for its timeout, so a hung fetch lets the held park go. */
const READER = chunkPart<typeof BookReaderModule>('the book reader', 'src/world/library/reader/BookReader.ts', () => import('./BookReader'));
import type { PaintedFace } from './pageFaces';

/**
 * **The book reader, fetched the first time a book is opened** — never at boot.
 *
 * `BookReader` and everything a page is drawn with (`pagePictures.ts`, the
 * story-props kit `storyProps.glb`, `readerAssets.ts`) are a lazy chunk of
 * their own: about 600 KB that a child who never opens a book has no use for,
 * and the thing that, with the rest, pushed the boot chunk past the service
 * worker's precache limit (Jim, 12 Nov 2026: *"all interiors should be loaded
 * on-demand on entering that room, same for all sub-games"*). `check:boot-chunk`
 * fails if anything statically reachable from the boot entry pulls
 * `BookReader.ts` back in.
 *
 * Every road to a book — a shelf's Read chip, a Cute-o-dex bookmark, the
 * `/book?id=` deep link — goes through {@link openBook} here, which answers
 * synchronously (is this a book?) and opens it as soon as the chunk is in.
 * While it is on its way {@link isOpen} is already true, so the park is held
 * exactly as it is under an open book, and a second press cannot start a walk
 * out from under the reader that is about to appear.
 *
 * Once loaded it is a plain pass-through: every member `check:book-reader`
 * reads is forwarded, so the check reads the same object the game does.
 */
export class LazyBookReader {
  private readonly options: BookReaderOptions;
  private reader: BookReader | null = null;
  private loading: Promise<BookReader> | null = null;
  /** The book asked for while the chunk was loading; opened when it lands. */
  private pendingBook: LibraryBook | null = null;
  private disposed = false;

  constructor(options: BookReaderOptions) {
    this.options = options;
  }

  /** True once the reader's chunk has been fetched and built. */
  get loaded(): boolean {
    return this.reader !== null;
  }

  /** Fetches and builds the reader if nobody has yet. Safe to call repeatedly. */
  load(): Promise<BookReader> {
    if (this.loading) return this.loading;
    // The reading room first: a page that pictures the library draws the
    // room's own owl, desk and shelves, which are its chunk's, not the
    // reader's (`pagePictures.ts`'s `libraryArt`).
    this.loading = Promise.all([READER.load(), LIBRARY_ROOM.load()]).then(([{ BookReader }]) => {
      const reader = new BookReader(this.options);
      if (this.disposed) {
        reader.dispose();
      } else {
        this.reader = reader;
      }
      const pending = this.pendingBook;
      this.pendingBook = null;
      if (pending && !this.disposed) reader.openLibraryBook(pending);
      return reader;
    });
    this.loading.catch((error: unknown) => {
      // Offline on a visit that never fetched it: let the park go again rather
      // than holding it under a book that is not coming.
      console.error('Land of Good Places: the book reader failed to load', error);
      this.pendingBook = null;
      this.loading = null;
    });
    return this.loading;
  }

  get isOpen(): boolean {
    return this.pendingBook !== null || (this.reader?.isOpen ?? false);
  }

  /** The reader's own camera — `check:book-reader` projects the pages through it. Null until loaded. */
  get camera(): PerspectiveCamera | null {
    return this.reader?.camera ?? null;
  }

  get bookId(): string | null {
    return this.reader?.bookId ?? this.pendingBook?.id ?? null;
  }

  get spread(): number {
    return this.reader?.spread ?? 0;
  }

  get spreadCount(): number {
    return this.reader?.spreadCount ?? 0;
  }

  get turning(): boolean {
    return this.reader?.turning ?? false;
  }

  get framing(): ReaderFraming {
    return this.reader?.framing ?? 'spread';
  }

  get pagesFit(): boolean {
    return this.reader?.pagesFit ?? true;
  }

  framedFace(): number | null {
    return this.reader?.framedFace() ?? null;
  }

  facesPainted(): readonly (PaintedFace | null)[] {
    return this.reader?.facesPainted() ?? [];
  }

  faceMesh(index: number): Mesh | null {
    return this.reader?.faceMesh(index) ?? null;
  }

  visibleFaces(): { left: number; right: number } {
    return this.reader?.visibleFaces() ?? { left: 0, right: 1 };
  }

  /** Opens `bookId`; false (and nothing happens) if it is not one of the library's books. */
  openBook(bookId: string): boolean {
    const book = bookById(bookId);
    if (!book) return false;
    return this.openLibraryBook(book);
  }

  /** {@link BookReader.openLibraryBook}, once the reader is in. */
  openLibraryBook(book: LibraryBook): boolean {
    if (this.reader) return this.reader.openLibraryBook(book);
    this.pendingBook = book;
    void this.load();
    return true;
  }

  close(): void {
    this.pendingBook = null;
    this.reader?.close();
  }

  next(): void {
    this.reader?.next();
  }

  previous(): void {
    this.reader?.previous();
  }

  steer(moveX: number): void {
    this.reader?.steer(moveX);
  }

  pressFocused(): void {
    this.reader?.pressFocused();
  }

  update(dt: number): void {
    this.reader?.update(dt);
  }

  render(renderer: WebGLRenderer): void {
    this.reader?.render(renderer);
  }

  /**
   * One step of the reader's shader warm-up, once it is loaded — and nothing
   * before then. The bus ride used to warm the reader at boot; it is not
   * fetched at boot any more, so a first book pays its warm-up when it opens
   * (`BookReader.openLibraryBook`'s `ensureWarm`, behind the held park).
   */
  warmStep(): boolean {
    return this.reader?.warmStep() ?? false;
  }

  dispose(): void {
    this.disposed = true;
    this.pendingBook = null;
    this.reader?.dispose();
    this.reader = null;
  }
}
