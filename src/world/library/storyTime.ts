import { discoverSecret } from '../../state/secrets';
import type { NpcCharacter } from '../../entities/npc/NpcCharacter';
import { bookById, storyTimeMayRead, type LibraryBook } from './books';
import { RECOMMENDATION_ORDER } from './recommendation';
import { LIBRARY_LINES } from './libraryLines';
import type { LibraryOwl } from './LibraryOwl';
import type { LibraryKidDriver } from './libraryKidDriver';
import { LIBRARY_FLOOR_Y } from './layout';

/**
 * **Story time** (#718, plan Step 9) — Jim, 13 October 2026: the owl librarian
 * *"holds story time with library children on the rug where the player can
 * sit too"*.
 *
 * Every so often the owl calls *"Come and sit on the rug for story time!"* and
 * flies over the bookcases to the big armchair; the library's three children
 * walk down the aisles and sit on their cushions, facing her; she reads a whole
 * picture book aloud, a page a bubble; then everyone wanders off and she flies
 * home. Sitting on a story cushion from before her first word to her last
 * earns the **Story listener** card.
 *
 * ## The clock
 *
 * {@link STORY_FIRST_AFTER} seconds into a visit, then every
 * {@link STORY_EVERY} — counted only while she is inside the library (the
 * reading room or its den), and begun at once by {@link requestStoryTime}
 * (the `/library?story=now` link). The call waits for the owl to finish
 * whatever script she is in (a card being handed over). Leaving the library
 * abandons a story ({@link abort}) and the next visit's clock starts again.
 *
 * ## Phases
 *
 * - `idle` — the clock runs.
 * - `gathering` — the call is said, the owl flies to the chair, and every
 *   child is summoned (`LibraryKidDriver.summon`). A child at her cushion's
 *   edge hops onto it ({@link STORY_SIT_SECONDS}, `NpcCharacter.beginSeated`:
 *   her root on the **floor**, the dining rule) facing the chair. When every
 *   child is seated or has settled where she was held, and the owl has
 *   perched — or after {@link GATHER_TIMEOUT} — the reading begins.
 * - `reading` — the owl says the title line, the book's own pages (already
 *   held to the brevity rule by the books' own check) and the ending. A child
 *   still arriving sits when she gets there.
 * - `dispersing` — when the owl falls quiet: the Story listener card if she
 *   sat through it, every child hops off her cushion and walks back to her
 *   aisle (`dismiss`), and the owl flies home; once she has landed, `idle`.
 *
 * ## Which book
 *
 * Picture books only — `storyTimeMayRead` (`books.ts`, the one owner of that
 * rule: a chapter page is a paragraph, too long for a bubble). **A different
 * story every time:** the book the owl is recommending, if it may be read and
 * no story has read it yet this round; otherwise the first of her one seeded
 * order (`RECOMMENDATION_ORDER`) that may be read and has not been yet this
 * round. A round ends when every such book has been read to its end once;
 * the next begins again at the top of her order, never with the book the
 * last story read. (The plan's `recommended ?? ORDER[storiesTold % 12]` read
 * the glowing book at every story time for as long as it glowed, and after a
 * recommended story could pick the very book just read — measured in
 * `check:library`'s CLOCK: "Fireflies at Night" twice running.)
 *
 * Constructed by `Library`, stepped first in its `update` (before the owl, so
 * a story begun this frame flies this frame), which `World` runs before the
 * crowd.
 */

/** Seconds into a visit before the first story. */
export const STORY_FIRST_AFTER = 40;
/** Seconds between one story's end and the next one's call. */
export const STORY_EVERY = 150;
/** The longest the gathering waits before the reading begins regardless (seconds). */
export const GATHER_TIMEOUT = 40;
/** How long a child's hop onto her cushion, or off it, takes (seconds): a hop, never a metre's snap. */
export const STORY_SIT_SECONDS = 0.4;
/** Each listener sways on her own clock: child `i`'s pose phase (radians). */
export const STORY_SITTER_PHASE = 1.7;
/** The Cute-o-dex card for sitting through a whole story (`state/secrets.ts`). */
export const STORY_LISTENER_SECRET_ID = 'secret.storyTime';
/** How many warm sparkles rise over her when she earns it. */
const LISTENER_SPARKLES = 8;
/** They rise from this far over her feet (metres) — over her head. */
const SPARKLES_OVER = 2.3;

export type StoryPhase = 'idle' | 'gathering' | 'reading' | 'dispersing';

/** One of the library's children, as story time asks of her: her driver and her body. */
export interface StoryChild {
  readonly driver: LibraryKidDriver;
  readonly body: NpcCharacter;
}

/** What story time asks of the room about her, the player. */
export interface StoryListenerView {
  /** On one of her story cushions right now. */
  readonly seated: boolean;
  /** Where her feet are, room-local — for the sparkles. */
  readonly feet: { readonly x: number; readonly y: number; readonly z: number };
}

export class StoryTime {
  private readonly owl: LibraryOwl;
  private readonly children: () => readonly StoryChild[];
  private readonly listener: () => StoryListenerView;
  private phaseValue: StoryPhase = 'idle';
  private clock = STORY_FIRST_AFTER;
  private gatherFor = 0;
  private storiesTold = 0;
  /** The books read to their end this round — none is read again until every one story time may read has been. */
  private readonly heard = new Set<string>();
  /** The book the last story read to its end: never the next story's, a new round or not. */
  private lastHeardId: string | null = null;
  private bookValue: LibraryBook | null = null;
  private wanted = false;
  /** She has sat on a story cushion since before the reading began, every frame of it. */
  private listenedThrough = false;
  private awarded = false;
  private held = false;

  constructor(owl: LibraryOwl, children: () => readonly StoryChild[], listener: () => StoryListenerView) {
    this.owl = owl;
    this.children = children;
    this.listener = listener;
  }

  get phase(): StoryPhase {
    return this.phaseValue;
  }

  /** The book being read, or about to be — null while idle. */
  get book(): LibraryBook | null {
    return this.bookValue;
  }

  /** How many stories have been read to their end this session. */
  get told(): number {
    return this.storiesTold;
  }

  /** Seconds until the next story's call, while idle. */
  get nextIn(): number {
    return this.clock;
  }

  /** Whether the last story to end earned her the Story listener card on this telling. */
  get lastAwarded(): boolean {
    return this.awarded;
  }

  /** A story now — the `/library?story=now` link: begun on the first frame she is inside and the owl is free. */
  requestStoryTime(): void {
    this.wanted = true;
  }

  /**
   * **Holds the clock** (or lets it go): held, it does not count down, so no
   * story calls itself — a requested one ({@link requestStoryTime}) still
   * begins. For whoever needs the room without a story starting under them
   * for a while: `check:library`'s clauses about the owl and the children,
   * which measure other things over minutes of the room's time.
   */
  holdClock(hold: boolean): void {
    this.held = hold;
  }

  /** One frame. `inside`: she is in the library (the room or its den) — the clock counts only then. */
  update(dt: number, inside: boolean): void {
    if (!inside) return;
    switch (this.phaseValue) {
      case 'idle':
        if (!this.held) this.clock -= dt;
        // Never over her own words: a card being handed over, or a book being
        // recommended, is finished first (the call waits for the owl).
        if ((this.wanted || this.clock <= 0) && this.owl.atDesk && !this.owl.midScript) this.begin();
        return;
      case 'gathering':
        this.gatherFor += dt;
        this.seatArrivals();
        if (this.gatherFor >= GATHER_TIMEOUT || (this.owl.perched && this.children().every((kid) => kid.driver.seated || kid.driver.gaveUp))) this.read();
        return;
      case 'reading':
        this.seatArrivals();
        this.listenedThrough &&= this.listener().seated;
        if (!this.owl.speaking) this.disperse();
        return;
      case 'dispersing':
        if (!this.owl.flying && this.owl.atDesk) {
          this.phaseValue = 'idle';
          this.storiesTold += 1;
          if (this.bookValue) {
            this.heard.add(this.bookValue.id);
            this.lastHeardId = this.bookValue.id;
          }
          this.bookValue = null;
          this.clock = STORY_EVERY;
        }
        return;
    }
  }

  /**
   * **She has left the library mid-story** (`Library.standOutside`): nobody is
   * left sitting — each child is set down where her walk to the rug ended, out
   * of her cushion (the room is hidden, so it is not seen) — and sent back to
   * her aisle; the owl is put back behind her desk by her own `leave`; the
   * next visit's clock starts again.
   */
  abort(): void {
    this.wanted = false;
    this.clock = STORY_FIRST_AFTER;
    if (this.phaseValue === 'idle') return;
    for (const kid of this.children()) {
      if (kid.body.seated) {
        const spot = kid.driver.standingSpot;
        kid.body.endSeated();
        if (Number.isFinite(spot.x) && Number.isFinite(spot.z)) kid.body.setDown(spot.x, LIBRARY_FLOOR_Y, spot.z);
      }
      kid.driver.dismiss();
    }
    this.phaseValue = 'idle';
    this.bookValue = null;
  }

  /**
   * The book this story reads (the class doc's "Which book"): the recommended
   * one if story time may read it and has not this round, else the first of
   * the owl's order that it may and has not. Every one heard, a new round —
   * holding back the one just heard, unless it is the only one.
   */
  private pickBook(): LibraryBook | null {
    const readable = RECOMMENDATION_ORDER.filter(storyTimeMayRead);
    const unheard = (book: LibraryBook): boolean => !this.heard.has(book.id);
    if (!readable.some(unheard)) {
      this.heard.clear();
      if (this.lastHeardId !== null && readable.length > 1) this.heard.add(this.lastHeardId);
    }
    const recommendedId = this.owl.recommendedBookId;
    const recommended = recommendedId === null ? undefined : bookById(recommendedId);
    if (recommended && storyTimeMayRead(recommended) && unheard(recommended)) return recommended;
    return readable.find(unheard) ?? null;
  }

  /** The call, the flight, the summons. */
  private begin(): void {
    this.wanted = false;
    const book = this.pickBook();
    if (!book) {
      this.clock = STORY_EVERY;
      return;
    }
    this.bookValue = book;
    this.phaseValue = 'gathering';
    this.gatherFor = 0;
    this.awarded = false;
    this.owl.tell([LIBRARY_LINES.owl.storyCall]);
    this.owl.flyTo(false);
    for (const kid of this.children()) kid.driver.summon();
  }

  /** Every child at her cushion's edge hops onto it, facing the storyteller. */
  private seatArrivals(): void {
    this.children().forEach((kid, i) => {
      if (!kid.driver.arrived) return;
      kid.body.beginSeated(kid.driver.seat.x, LIBRARY_FLOOR_Y, kid.driver.seat.z, kid.driver.seatFacing, i * STORY_SITTER_PHASE, STORY_SIT_SECONDS);
      kid.driver.markSeated();
    });
  }

  /** The title, the book's own pages, the ending — one script. */
  private read(): void {
    const book = this.bookValue;
    if (!book) return;
    this.phaseValue = 'reading';
    this.listenedThrough = this.listener().seated;
    const owl = LIBRARY_LINES.owl;
    this.owl.tell([owl.storyBegin(book.title), ...book.pages.map((page) => page.text), ...owl.storyEnd]);
  }

  /** The story is over: her card if she listened through it, everyone up and away, the owl home. */
  private disperse(): void {
    const listener = this.listener();
    if (this.listenedThrough && listener.seated) {
      discoverSecret(STORY_LISTENER_SECRET_ID);
      this.awarded = true;
      this.owl.sparkleOver(listener.feet.x, listener.feet.y + SPARKLES_OVER, listener.feet.z, LISTENER_SPARKLES);
    }
    for (const kid of this.children()) {
      if (kid.body.seated) {
        const spot = kid.driver.standingSpot;
        if (Number.isFinite(spot.x) && Number.isFinite(spot.z)) kid.body.endSeated(spot.x, spot.z, STORY_SIT_SECONDS);
        else kid.body.endSeated();
      }
      kid.driver.dismiss();
    }
    this.owl.flyTo(true);
    this.phaseValue = 'dispersing';
  }
}
