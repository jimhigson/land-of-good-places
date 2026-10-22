import type { PaletteKey } from '../../core/palette';
import type { Expression } from '../../art/style/faces';
import type { BalloonKind } from '../../art/models/balloons';
import type { KeychainKind } from '../../art/models/keychains';
import type { BreakfastKind } from '../../art/models/hotelAssets';
import type { FlossFlavour } from '../../art/models/shopItems';
import type { TreeVariant } from '../../art/models/props';
import type { BookKind } from './bookKinds';
import { CHAPTER_BOOKS } from './chapterBooks';

export type { BookKind } from './bookKinds';

/**
 * **The library's books** — the one table every word and picture in them comes
 * from (#717, part 3 of the Library epic #714), in two kinds ({@link BookKind}).
 *
 * **Picture books** ({@link PICTURE_BOOKS}, here). Jim, 13 October 2026:
 * *"twelve authored short picture books about the park"*, 4–6 pages each,
 * **one sentence and one big picture per page**. Written for a six-year-old who
 * is learning to read, so every rule of GAME_DESIGN.md's BREVITY RULE applies
 * to every line: a title is at most 24 characters, a page is one sentence of
 * at most 50.
 *
 * **Chapter books** ({@link CHAPTER_BOOKS}, one file each under
 * `chapterBooks/`, listed in shelf order by `chapterBooks/index.ts`). Jim,
 * 14 October 2026: *"we also need some more grown-up books, these are ok for a
 * 3 year old, so keep them, but add more that have ~30 words per page and more
 * involved story lines with jokes, adventure, adversaries, conflict, but
 * resolve well. A 6 year old advanced reader needs a bit more."* So 8–10 pages,
 * each a picture and a paragraph of 20–40 words whose every sentence is at
 * most 120 characters — the BREVITY RULE's own written exception for them. The
 * picture books stay exactly as they were.
 *
 * `pnpm run check:brevity` walks {@link BOOKS} (`scripts/check-copy-brevity.mts`)
 * and holds each page to its own kind's limits, keyed by the book's `kind` and
 * nothing else, so a page cannot quietly grow.
 *
 * Every other spine on the library's shelves is decoration; these are the ones
 * you can open, each on its own readable slot (`layout.ts`'s
 * `LIBRARY_READABLE_SLOTS`: slot `i` holds `BOOKS[i]`, the chapter books on the
 * big readers' shelf). They live here, in data, so the family can edit a story
 * without touching the reader — `world/library/reader/` turns a
 * {@link LibraryBook} into paper, and nothing in it knows a single word.
 *
 * ## The pictures are the park's own models
 *
 * Jim: *"render the 3d models to textures, and then use those mapped onto the
 * pages."* So a {@link PagePicture} is not an image — it is a little stage
 * direction: who is in it ({@link PictureActor}), where they stand, which face
 * they pull, and what colour the sky behind them is. The reader builds those
 * models with the game's own factories (`createPet`, `createBiscuit`,
 * `createCatBus`, …), renders them to a texture with the game's toon materials,
 * and paints the result onto the page. A RiPika in a book is *the* RiPika.
 *
 * `kid` is whoever is reading: the reader builds her from the player's own look
 * (`gameStore`'s `player`), so the girl in the pictures is the one holding the
 * book. Several stories say "you" for exactly that reason.
 *
 * ## Read-tracking
 *
 * A book counts as read when its last page is reached. That is recorded as a
 * Cute-o-dex entry, `book.<id>` ({@link bookCollectionId}), through the same
 * `gameStore.collect` path a secret uses — so it is saved, restored and counted
 * like every other thing in the book with no new save field.
 *
 * Importable from Node: nothing here touches the DOM, and every `art/` import
 * is `import type`, which is erased.
 */

/**
 * Every model the reader knows how to build for a picture — see
 * `reader/pagePictures.ts`, whose `buildActor` has one branch for each, and
 * which warms every one's shader programs before a book is ever opened. A
 * list rather than only a type, so that warming can walk it.
 *
 * `cart` is the Rail Race cart on its own, at the size the race draws it
 * beside a child on foot; `raceCart` is the cart **with the reader riding in
 * it**, both at park scale exactly as the race seats a rider, under duck bars
 * (`duckBar`) hung at the race's own height for them.
 *
 * **Nothing in a picture is built from three.js primitives.** Jim, 22 October
 * 2026: *"model in Blender as much as is needed, in preference to coding
 * geometric primitives to create items in the world"*. A page names a model
 * from this list — the park's own factories, or the 3D Artist's story-props
 * kit below — and a thing neither has is a request to the Artist, never a
 * shape typed into a page (the one-time `prop` actor built of primitive
 * `parts` went for that reason). A sprite is not a model: confetti, raindrops
 * and drips are {@link PictureDecor}.
 *
 * **The chapter books' park models** (track D of #714), each one of the park's
 * own factories, at its park size, standing on the ground at the origin like
 * every model here:
 *
 * - `mini` — the lilac mini (`createMini`); {@link PictureActor.grab} lifts its
 *   grabby arms;
 * - `pinkWall` — two segments of the park's pink stone wall (`createPinkWall`);
 * - `tortoise` — a Reptile House tortoise, Grandpa Tock (`createTortoise`):
 *   mood `blink` is asleep, `neutral` drowsy (eyes half shut), any other wide
 *   awake; pose `stretch` pushes his head right out (his poke), `tuck` pulls
 *   it into his shell;
 * - `owl` — the owl librarian (`createLibraryOwl`): her faces are neutral,
 *   blink, happy and her shush, which mood `surprised` shows;
 * - `candyFloss` — on its stick (`createCandyFloss`), `variant` its flavour;
 *   `flossStick` — the bare stick once the floss is eaten (`createFlossStick`);
 * - `jetpack` — a jet pack on its own (`createJetpack`); to put one on the
 *   reader or a pet, give that actor {@link PictureActor.jetpack} instead;
 * - `discoBall` — the hotel's (`createDiscoBall`), set down to stand on its
 *   lowest point rather than hanging from its chain;
 * - `lollipopTree` — a park tree (`createLollipopTree`), `variant` its kind;
 * - `surpriseEgg` — a surprise egg (`createSurpriseEgg`): `colour` its shell,
 *   {@link PictureActor.accent} its spots;
 * - `alienSaucer` — the friendly alien from the Space Ferris Wheel's sky
 *   (`createAlienSaucer`), fully arrived; it is 5 m across, so give it a `size`;
 * - `libraryDesk`, `readingLamp`, `bookcase` — the library's own desk and
 *   reading lamp, and a wall case full of spines (`art/models/libraryAssets.ts`;
 *   the spines stocked by the reading room's own rule, `furnish.ts`'s
 *   `shelveFace`), for the pages set in the library.
 *
 * **The story-props kit** (`reader/storyProps.ts`, the Artist's
 * `src/art/assets/storyProps.glb`, ASSET_MANIFEST.md §42): everything the six
 * chapter books' pictures need that the park had no model for, each at the
 * kit's own size, standing on the ground at the origin; a page lifts it with
 * `at` and scales it with `size`. The editor's page notes
 * (`docs/library-build/chapter-books/final.json`) call these "prop: …"; this
 * is what each of those lines names:
 *
 * - `stormCloud` — Nimbus, the storm cloud of *Biscuit and the Storm*: a face
 *   puff in a ring of puffs, its moods the house five (`frown` cross, `sad`
 *   hungry, `surprised` the burp, `happy` fed), grey unless `colour` says
 *   otherwise (`blossomWhite` once she is fed); `fluffyCloud` — long, low and
 *   faceless (*Catch That Chicken!* p5), so nobody takes it for Nimbus;
 * - `rainbowArch` — the Rail Race's finish, its bands `ART.rainbow`'s colours
 *   (*Hopsalot* p7–9, *Footprints* p10, *Storm* p8);
 * - `queuePosts` — two gold posts and a red rope (*Hopsalot* p2, p10);
 *   `rubberDuck` — the yellow duck Sir Hopsalot says sorry with (p10);
 * - `parkBench` — a plank seat on two end boards, open underneath, its seat at
 *   `KID_HIP_HEIGHT` (*Detective* p1, *Footprints* p4);
 * - `magnifyingGlass` — standing on its handle; a page turns it up to an eye
 *   (*Detective* p2, p3, p7);
 * - `pancakeFootprint` — the mini's flat wide print, three toes; a page
 *   scatters eight (*Detective* p3, p4); `giantFootprint` — a dinner-plate
 *   print with four stubby toes (*Footprints* p1–p6);
 * - `spoon`, `flatStone`, `stick` — the hidey-hole's small things (*Detective*
 *   p8; the spoons again in the nest, *Chicken* p6);
 * - `openBook` — lying open, pages curving up, `colour` its cover (*Shush* p2,
 *   p4); `loosePage` — one page fluttering free (p4); and the closed `book`
 *   above is the kit's too, `colour` its cover — Mrs Crumpet's pile is three
 *   at `size` 3, as the picture books draw a pile (*Shush*, *Storm* p4);
 * - `flower` — a storybook flower, `colour` its petals (`blossomPink`,
 *   `flowerBlue`), {@link PictureActor.nibbled} the bare stalk (*Footprints*
 *   p3); `petal` — one petal, `colour`, the yellow one on Grandpa Tock's nose
 *   (p6);
 * - `picnicBlanket`, `sandwich`, `sandwichTower` (sixteen, taller than
 *   Biscuit), `sandwichHeap` (Nimbus's forty-one, every one of them),
 *   `jamTart`, `cake` — the Grand Fountain Picnic (*Storm* p1–p3, p9, p10);
 * - `puddle` (*Storm* p4), `windowFrame` (p5), `umbrellaInsideOut` (p7),
 *   `battlement` — a run of the castle roof's wall at `CASTLE_MERLON_HEIGHT`
 *   (p8);
 * - `storyWheel` — the Space Ferris Wheel as a toy, dark with its star bracket
 *   plainly empty; {@link PictureActor.lit} puts the golden star back in the
 *   bracket and lights the rim (*Chicken* p1, p9);
 * - `feather` — lying on the grass, white, or `colour` (`flowerRed`) for
 *   Chicken-looter's (*Chicken* p2); `twigNest` — the hoard on the hotel roof
 *   (p6–p8); `biscuitTreat` — a biscuit to eat, not Biscuit the bear (p6, p8).
 */
export const PICTURE_MODELS = [
  'kid',
  'ripika',
  'trilla',
  'biscuit',
  'bunny',
  'kitten',
  'mouse',
  'catBus',
  'statue',
  'cart',
  'raceCart',
  'balloon',
  'keychain',
  'bowl',
  'petBed',
  'star',
  'dragon',
  'book',
  'duckBar',
  'mini',
  'pinkWall',
  'tortoise',
  'owl',
  'candyFloss',
  'flossStick',
  'jetpack',
  'discoBall',
  'lollipopTree',
  'surpriseEgg',
  'alienSaucer',
  'libraryDesk',
  'readingLamp',
  'bookcase',
  'stormCloud',
  'fluffyCloud',
  'rainbowArch',
  'queuePosts',
  'rubberDuck',
  'parkBench',
  'magnifyingGlass',
  'pancakeFootprint',
  'giantFootprint',
  'spoon',
  'flatStone',
  'stick',
  'openBook',
  'loosePage',
  'flower',
  'petal',
  'picnicBlanket',
  'sandwich',
  'sandwichTower',
  'sandwichHeap',
  'jamTart',
  'cake',
  'puddle',
  'windowFrame',
  'umbrellaInsideOut',
  'battlement',
  'storyWheel',
  'feather',
  'twigNest',
  'biscuitTreat',
] as const;

/** A model the reader knows how to build for a picture — see {@link PICTURE_MODELS}. */
export type PictureModel = (typeof PICTURE_MODELS)[number];

/**
 * How a creature with arms and legs holds them. Anything without limbs ignores
 * it. `duck` is a rider's: the reader in a `raceCart`, folded under a bar by
 * the Rail Race's own pose (`railRace/duckPose.ts`); a `raceCart` with any
 * other pose has her sitting up. `stretch` and `tuck` are the tortoise's: his
 * head pushed right out, or pulled into his shell.
 */
export type PicturePose = 'stand' | 'armsUp' | 'wave' | 'sit' | 'duck' | 'stretch' | 'tuck';

/** One model on a page, and how it stands. Everything optional has a sensible default. */
export interface PictureActor {
  readonly model: PictureModel;
  /** Where it stands, in metres: x across, y up, z towards the reader. Default the origin. */
  readonly at?: readonly [number, number, number];
  /** Degrees about the vertical; 0 faces the reader, 90 turns it to face the right. */
  readonly turn?: number;
  /** Uniform scale. Default 1, which is the model's own size in the park. */
  readonly size?: number;
  readonly mood?: Expression;
  readonly pose?: PicturePose;
  /** Which balloon, keychain, breakfast, candy floss or tree — only read for those models. */
  readonly variant?: BalloonKind | KeychainKind | BreakfastKind | FlossFlavour | TreeVariant;
  /**
   * A colour for models that take one: the cart, the star, a `book`'s or an
   * `openBook`'s cover, the egg's shell, the cloud, a `flower`'s petals, a
   * `petal`, a `feather`, and the star a lit `storyWheel` carries.
   */
  readonly colour?: PaletteKey;
  /** A second colour, for a model that takes two: the surprise egg's spots. */
  readonly accent?: PaletteKey;
  /** The mini's grabby arms, 0 down to 1 a full "MINI ATTACK!". Only read for the mini. Default 0. */
  readonly grab?: number;
  /**
   * A jet pack on her back, firing (`on`) or not (`off`) — the reader (on her
   * own `jetpackAnchor`, as she wears one in the park) or a pet (a smaller one,
   * on the middle of its back). Omitted for none.
   */
  readonly jetpack?: 'on' | 'off';
  /** `false` takes the keyring off the reader's bag for this picture (she wears whatever she has on today otherwise). Only read for `kid`. */
  readonly keyring?: false;
  /** `flower` only: nibbled down to its bare stalk — *The Giant Footprints*' yellow ones. */
  readonly nibbled?: true;
  /**
   * `storyWheel` only: `true` puts the golden star back in the bracket on the
   * hub (in `colour`, yellow by default) and turns the ring of lights on.
   * Omitted, the wheel is dark and the bracket plainly empty — the star is
   * missing, which is the whole of *Catch That Chicken!*.
   */
  readonly lit?: true;
}

/**
 * Little things painted over the picture, the way an illustrator would — in
 * 2D on the page, never built (a particle is not a model). `confetti` is a
 * shower of flat squares in the park's marker colours (the Rail Race finish);
 * `rain` is streaks of falling rain over everything; `splash` is a few drops
 * low in the picture (a fountain, or the drips off a soaked bear).
 */
export type PictureDecor =
  | 'stars'
  | 'moon'
  | 'sun'
  | 'clouds'
  | 'fireflies'
  | 'hearts'
  | 'sparkles'
  | 'zzz'
  | 'speed'
  | 'splash'
  | 'notes'
  | 'confetti'
  | 'rain';

export interface PagePicture {
  readonly cast: readonly PictureActor[];
  /** The backdrop's colour, top of the picture. */
  readonly sky: PaletteKey;
  /** A soft hill under their feet, or omitted for none (a picture in the air). */
  readonly ground?: PaletteKey;
  /** Moonlight instead of sunshine. Never black — plum and blue, per ART_DIRECTION. */
  readonly night?: boolean;
  readonly decor?: readonly PictureDecor[];
}

export interface BookPage {
  /**
   * A picture book's page: one sentence, at most 50 characters. A chapter
   * book's: a paragraph of 20–40 words, each sentence at most 120 characters.
   * Both measured by `check:brevity`, by the book's {@link LibraryBook.kind}.
   */
  readonly text: string;
  readonly picture: PagePicture;
}

export interface LibraryBook {
  /** Stable id: the deep link (`/book?id=`), the save key and the cache key all use it. */
  readonly id: string;
  /**
   * A picture book (one sentence a page) or a chapter book (a paragraph a
   * page). Every rule that differs between them asks this and nothing else:
   * the page count ({@link BOOK_PAGE_COUNTS}), the brevity limits, the
   * reader's page layout, the prizes, and which books story time may read
   * ({@link storyTimeMayRead}).
   */
  readonly kind: BookKind;
  /** At most 24 characters (BREVITY RULE). */
  readonly title: string;
  /** The cover boards' colour, and the bookmark's in the Cute-o-dex. */
  readonly cover: PaletteKey;
  /** The picture on the title page. */
  readonly titlePicture: PagePicture;
  /** Within its kind's {@link BOOK_PAGE_COUNTS} — `check:book-reader` holds every book to it. */
  readonly pages: readonly BookPage[];
}

/**
 * The fewest and most pages a book of each kind may have: a picture book is
 * short (4–6), a chapter book is a proper read (8–10).
 */
export const BOOK_PAGE_COUNTS: Readonly<Record<BookKind, { readonly min: number; readonly max: number }>> = {
  picture: { min: 4, max: 6 },
  chapter: { min: 8, max: 10 },
};

/** The most pages any book has, of either kind — what one open book's caches must hold. */
export const BOOK_MOST_PAGES = Math.max(...Object.values(BOOK_PAGE_COUNTS).map((count) => count.max));

/**
 * **The twelve picture books**, in shelf order (slots 0–11). Kept exactly as
 * they were written for #717 — Jim, 14 October 2026: *"these are ok for a 3
 * year old, so keep them"*.
 */
export const PICTURE_BOOKS: readonly LibraryBook[] = [
  {
    id: 'ripikaBalloon',
    kind: 'picture',
    title: "RiPika's Balloon",
    cover: 'blossomPink',
    titlePicture: {
      cast: [{ model: 'ripika', mood: 'happy' }, { model: 'balloon', variant: 'dalmatian', at: [0.9, 1.3, 0] }],
      sky: 'skyDayBottom',
      ground: 'grassLight',
    },
    pages: [
      {
        text: 'RiPika has a spotty balloon.',
        picture: {
          cast: [
            { model: 'ripika', mood: 'happy', pose: 'wave' },
            { model: 'balloon', variant: 'dalmatian', at: [0.85, 1.25, 0] },
          ],
          sky: 'skyDayBottom',
          ground: 'grassLight',
          decor: ['sun'],
        },
      },
      {
        text: 'Whoosh, the wind takes it away!',
        picture: {
          cast: [
            { model: 'ripika', mood: 'surprised', pose: 'armsUp' },
            { model: 'balloon', variant: 'dalmatian', at: [1.5, 2.6, -0.4], turn: -20 },
          ],
          sky: 'skyDayBottom',
          ground: 'grassLight',
          decor: ['clouds', 'speed'],
        },
      },
      {
        text: 'It floats over the big fountain.',
        picture: {
          cast: [
            { model: 'statue', size: 0.45, at: [-0.5, 0, 0] },
            { model: 'balloon', variant: 'dalmatian', at: [0.9, 1.6, 0.6] },
          ],
          sky: 'skyDayBottom',
          ground: 'waterTop',
          decor: ['clouds', 'splash'],
        },
      },
      {
        text: 'Trilla jumps up and grabs it.',
        picture: {
          cast: [
            { model: 'trilla', mood: 'happy', at: [0, 0.4, 0] },
            { model: 'balloon', variant: 'dalmatian', at: [0.35, 1.8, 0] },
          ],
          sky: 'skyDayBottom',
          ground: 'grassLight',
          decor: ['sparkles'],
        },
      },
      {
        text: 'Now RiPika and Trilla share it!',
        picture: {
          cast: [
            { model: 'ripika', mood: 'happy', at: [-0.8, 0, 0], turn: 20 },
            { model: 'trilla', mood: 'happy', at: [0.8, 0, 0], turn: -20 },
            { model: 'balloon', variant: 'dalmatian', at: [0, 1.9, -0.3] },
          ],
          sky: 'skyDayBottom',
          ground: 'grassLight',
          decor: ['hearts'],
        },
      },
    ],
  },
  {
    id: 'biscuitBreakfast',
    kind: 'picture',
    title: "Biscuit's Breakfast",
    cover: 'flowerYellow',
    titlePicture: {
      cast: [{ model: 'biscuit', mood: 'happy' }],
      sky: 'buildingFloor',
      ground: 'woodLight',
    },
    pages: [
      {
        text: 'Biscuit wakes up very hungry.',
        picture: {
          cast: [{ model: 'biscuit', mood: 'surprised', pose: 'armsUp' }],
          sky: 'skyDawnBottom',
          ground: 'woodLight',
          decor: ['sun'],
        },
      },
      {
        text: 'Down to the hotel for breakfast!',
        picture: {
          cast: [{ model: 'biscuit', mood: 'happy', pose: 'wave' }],
          sky: 'buildingFloor',
          ground: 'woodLight',
          decor: ['notes'],
        },
      },
      {
        text: 'Cheerios or Shreddies or yoghurt?',
        picture: {
          cast: [
            { model: 'bowl', variant: 'cheerios', at: [-0.45, 0, 0], size: 2.4 },
            { model: 'bowl', variant: 'shreddies', at: [0, 0, 0.1], size: 2.4 },
            { model: 'bowl', variant: 'yoghurt', at: [0.45, 0, 0], size: 2.4 },
          ],
          sky: 'buildingFloor',
          ground: 'woodLight',
        },
      },
      {
        text: 'He has all three, the greedy bear!',
        picture: {
          cast: [
            { model: 'biscuit', mood: 'happy', pose: 'armsUp' },
            { model: 'bowl', variant: 'cheerios', at: [-0.55, 0, 0.45], size: 1.6 },
            { model: 'bowl', variant: 'shreddies', at: [0, 0, 0.6], size: 1.6 },
            { model: 'bowl', variant: 'yoghurt', at: [0.55, 0, 0.45], size: 1.6 },
          ],
          sky: 'buildingFloor',
          ground: 'woodLight',
          decor: ['sparkles'],
        },
      },
      {
        text: 'Now his tummy is round and happy.',
        picture: {
          cast: [{ model: 'biscuit', mood: 'blink', pose: 'sit' }],
          sky: 'buildingFloor',
          ground: 'woodLight',
          decor: ['hearts'],
        },
      },
    ],
  },
  {
    id: 'trillaHigh',
    kind: 'picture',
    title: 'Trilla Goes Up High',
    cover: 'flowerViolet',
    titlePicture: {
      cast: [{ model: 'trilla', mood: 'happy' }],
      sky: 'skyDayBottom',
      decor: ['clouds'],
    },
    pages: [
      {
        text: 'Trilla loves the big wheel.',
        picture: {
          cast: [{ model: 'trilla', mood: 'happy' }],
          sky: 'skyDayBottom',
          ground: 'grassLight',
          decor: ['hearts'],
        },
      },
      {
        text: 'Round and round and up she goes.',
        picture: {
          cast: [{ model: 'trilla', mood: 'surprised', turn: 25 }],
          sky: 'skySunsetBottom',
          decor: ['clouds', 'speed'],
        },
      },
      {
        text: 'At the top she can see the stars.',
        picture: {
          cast: [{ model: 'trilla', mood: 'surprised' }],
          sky: 'skyNightBottom',
          night: true,
          decor: ['stars'],
        },
      },
      {
        text: 'Trilla waves hello to the moon.',
        picture: {
          cast: [{ model: 'trilla', mood: 'happy', turn: -15 }],
          sky: 'skyNightBottom',
          night: true,
          decor: ['moon', 'stars'],
        },
      },
      {
        text: 'Then down she comes for a nap.',
        picture: {
          cast: [{ model: 'trilla', mood: 'blink' }, { model: 'petBed', at: [0, -0.02, 0] }],
          sky: 'skyDawnBottom',
          ground: 'grassLight',
          decor: ['zzz'],
        },
      },
    ],
  },
  {
    id: 'catBusDay',
    kind: 'picture',
    title: "The Cat Bus's Long Day",
    cover: 'slideChute',
    titlePicture: {
      cast: [{ model: 'catBus', turn: 35 }],
      sky: 'skyDayBottom',
      ground: 'grassLight',
    },
    pages: [
      {
        text: 'The cat bus wakes up and purrs.',
        picture: {
          cast: [{ model: 'catBus', turn: 30 }],
          sky: 'skyDawnBottom',
          ground: 'grassLight',
          decor: ['sun', 'notes'],
        },
      },
      {
        text: 'It brings kids to the park gate.',
        picture: {
          cast: [
            { model: 'catBus', turn: 40, at: [-0.6, 0, -1.5] },
            { model: 'kid', mood: 'happy', pose: 'wave', at: [2.4, 0, 1.6], turn: -20 },
          ],
          sky: 'skyDayBottom',
          ground: 'grassLight',
          decor: ['clouds'],
        },
      },
      {
        text: 'Beep beep, says the cat bus.',
        picture: {
          cast: [{ model: 'catBus', turn: -30 }],
          sky: 'skyDayBottom',
          ground: 'pathSand',
          decor: ['notes', 'speed'],
        },
      },
      {
        text: 'It drives and drives all day long.',
        picture: {
          cast: [{ model: 'catBus', turn: 90 }],
          sky: 'skySunsetBottom',
          ground: 'pathSand',
          decor: ['speed', 'sun'],
        },
      },
      {
        text: 'At night it curls up to sleep.',
        picture: {
          cast: [{ model: 'catBus', turn: 20 }],
          sky: 'skyNightBottom',
          ground: 'grassDark',
          night: true,
          decor: ['moon', 'zzz'],
        },
      },
    ],
  },
  {
    id: 'duckBars',
    kind: 'picture',
    title: 'Duck, Duck, Duck!',
    cover: 'markerLemon',
    titlePicture: {
      cast: [{ model: 'cart', colour: 'markerPink', turn: 30 }],
      sky: 'skyDayBottom',
      ground: 'grassLight',
    },
    pages: [
      {
        text: 'Hop in the cart for the Rail Race.',
        picture: {
          cast: [{ model: 'raceCart', colour: 'markerPink', mood: 'happy', turn: 30 }],
          sky: 'skyDayBottom',
          ground: 'grassLight',
          decor: ['sparkles'],
        },
      },
      {
        text: 'A bar is coming, so duck down!',
        picture: {
          cast: [
            { model: 'raceCart', colour: 'markerPink', mood: 'surprised', turn: 60, at: [-1.2, 0, 0.3] },
            { model: 'duckBar', turn: 60, at: [2.2, 0, -1.6] },
          ],
          sky: 'skyDayBottom',
          ground: 'grassLight',
          decor: ['speed'],
        },
      },
      {
        text: 'Whoosh, under the bar we go.',
        picture: {
          cast: [
            { model: 'raceCart', colour: 'markerPink', mood: 'happy', pose: 'duck', turn: 35 },
            { model: 'duckBar', turn: 35 },
          ],
          sky: 'skyDayBottom',
          ground: 'grassLight',
          decor: ['speed', 'clouds'],
        },
      },
      {
        text: 'Duck, duck, duck again!',
        picture: {
          cast: [
            { model: 'duckBar', turn: 35, at: [1.15, 0, -1.6] },
            { model: 'raceCart', colour: 'markerPink', mood: 'happy', pose: 'duck', turn: 35 },
            { model: 'duckBar', turn: 35, at: [-1.15, 0, 1.6] },
          ],
          sky: 'skyDayBottom',
          ground: 'grassLight',
          decor: ['sparkles'],
        },
      },
      {
        text: 'We win the race, hooray!',
        picture: {
          cast: [
            { model: 'kid', mood: 'happy', pose: 'armsUp' },
            { model: 'star', colour: 'flowerYellow', at: [1.0, 1.4, 0], size: 2.2 },
          ],
          sky: 'skyDayBottom',
          ground: 'grassLight',
          decor: ['sparkles', 'hearts'],
        },
      },
    ],
  },
  {
    id: 'bookDragon',
    kind: 'picture',
    title: 'The Dragon Who Reads',
    cover: 'leafDeep',
    titlePicture: {
      cast: [{ model: 'dragon', mood: 'happy' }],
      sky: 'skyDawnBottom',
      ground: 'woodLight',
    },
    pages: [
      {
        text: 'Once there was a tiny dragon.',
        picture: {
          cast: [{ model: 'dragon', mood: 'happy' }],
          sky: 'skyDawnBottom',
          ground: 'grassLight',
          decor: ['sparkles'],
        },
      },
      {
        text: 'He did not want shiny gold stars.',
        picture: {
          cast: [
            { model: 'dragon', mood: 'frown', turn: -30 },
            { model: 'star', colour: 'flowerYellow', at: [0.9, 0.2, 0.2], size: 1.4 },
          ],
          sky: 'skyDawnBottom',
          ground: 'grassLight',
          decor: ['sparkles'],
        },
      },
      {
        text: 'He wanted books, lots of books!',
        picture: {
          cast: [
            { model: 'dragon', mood: 'surprised', pose: 'armsUp' },
            { model: 'book', colour: 'markerPink', at: [-0.8, 0, 0.3], turn: 20 },
            { model: 'book', colour: 'markerSky', at: [0.8, 0, 0.3], turn: -25 },
            { model: 'book', colour: 'markerLemon', at: [0, 0, 0.75], turn: 5 },
          ],
          sky: 'skyDawnBottom',
          ground: 'grassLight',
          decor: ['hearts'],
        },
      },
      {
        text: 'He sat on a pile and read all day.',
        picture: {
          cast: [
            { model: 'book', colour: 'markerMint', at: [0, 0, 0], size: 1.6 },
            { model: 'book', colour: 'markerLilac', at: [0, 0.2, 0], size: 1.5, turn: 15 },
            { model: 'book', colour: 'markerPink', at: [0, 0.4, 0], size: 1.4, turn: -10 },
            { model: 'dragon', mood: 'happy', pose: 'sit', at: [0, 0.6, 0] },
          ],
          sky: 'skyDawnBottom',
          ground: 'woodLight',
          decor: ['notes'],
        },
      },
      {
        text: 'His best book was all about you!',
        picture: {
          cast: [
            { model: 'dragon', mood: 'happy', at: [-0.7, 0, 0], turn: 25 },
            { model: 'kid', mood: 'happy', pose: 'wave', at: [0.8, 0, 0], turn: -25 },
          ],
          sky: 'skyDawnBottom',
          ground: 'grassLight',
          decor: ['hearts'],
        },
      },
    ],
  },
  {
    id: 'foreverSlide',
    kind: 'picture',
    title: 'The Forever Slide',
    cover: 'slideRail',
    titlePicture: {
      cast: [{ model: 'kid', mood: 'happy', pose: 'armsUp' }],
      sky: 'skyDayBottom',
      decor: ['clouds'],
    },
    pages: [
      {
        text: 'This slide is very, very tall.',
        picture: {
          cast: [{ model: 'kid', mood: 'surprised', turn: 15 }],
          sky: 'skyDayBottom',
          ground: 'grassLight',
          decor: ['clouds'],
        },
      },
      {
        text: 'Down you go, round and round.',
        picture: {
          cast: [{ model: 'kid', mood: 'happy', pose: 'armsUp', turn: -25 }],
          sky: 'skyDayBottom',
          decor: ['speed', 'clouds'],
        },
      },
      {
        text: 'You slide right past the clouds.',
        picture: {
          cast: [{ model: 'kid', mood: 'surprised', pose: 'sit', turn: 30 }],
          sky: 'skyDayBottom',
          decor: ['clouds', 'speed'],
        },
      },
      {
        text: 'Still sliding, and still sliding.',
        picture: {
          cast: [{ model: 'kid', mood: 'blink', pose: 'sit', turn: -30 }],
          sky: 'skySunsetBottom',
          decor: ['speed', 'zzz'],
        },
      },
      {
        text: 'At last you land with a bump!',
        picture: {
          cast: [{ model: 'kid', mood: 'happy', pose: 'armsUp' }],
          sky: 'skyDayBottom',
          ground: 'pathSand',
          decor: ['sparkles', 'splash'],
        },
      },
    ],
  },
  {
    id: 'fireflies',
    kind: 'picture',
    title: 'Fireflies at Night',
    cover: 'markerLilac',
    titlePicture: {
      cast: [{ model: 'ripika', mood: 'happy' }],
      sky: 'skyNightBottom',
      ground: 'grassDark',
      night: true,
      decor: ['fireflies'],
    },
    pages: [
      {
        text: 'The sun goes down in the park.',
        picture: {
          cast: [{ model: 'kid', mood: 'blink', at: [-0.6, 0, 0], turn: 20 }, { model: 'ripika', at: [0.8, 0, 0.2], turn: -20 }],
          sky: 'skySunsetBottom',
          ground: 'grassLight',
          decor: ['sun'],
        },
      },
      {
        text: 'Tiny lights come out to play.',
        picture: {
          cast: [{ model: 'ripika', mood: 'surprised' }],
          sky: 'skyNightBottom',
          ground: 'grassDark',
          night: true,
          decor: ['fireflies'],
        },
      },
      {
        text: 'They are fireflies, glowing bright!',
        picture: {
          cast: [{ model: 'kid', mood: 'happy', pose: 'armsUp' }],
          sky: 'skyNightBottom',
          ground: 'grassDark',
          night: true,
          decor: ['fireflies', 'stars'],
        },
      },
      {
        text: 'RiPika tries to count them all.',
        picture: {
          cast: [{ model: 'ripika', mood: 'happy', pose: 'wave' }],
          sky: 'skyNightBottom',
          ground: 'grassDark',
          night: true,
          decor: ['fireflies', 'moon'],
        },
      },
      {
        text: 'One, two, three, too many to count!',
        picture: {
          cast: [
            { model: 'kid', mood: 'happy', at: [-0.7, 0, 0], turn: 20 },
            { model: 'ripika', mood: 'happy', at: [0.8, 0, 0.2], turn: -20 },
          ],
          sky: 'skyNightBottom',
          ground: 'grassDark',
          night: true,
          decor: ['fireflies', 'stars'],
        },
      },
    ],
  },
  {
    id: 'fountainWish',
    kind: 'picture',
    title: 'The Fountain Wish',
    cover: 'waterTop',
    titlePicture: {
      cast: [{ model: 'statue', size: 0.55 }],
      sky: 'skyDayBottom',
      ground: 'waterTop',
      decor: ['sparkles'],
    },
    pages: [
      {
        text: 'There is a statue in the fountain.',
        picture: {
          cast: [{ model: 'statue', size: 0.55 }],
          sky: 'skyDayBottom',
          ground: 'waterTop',
          decor: ['splash'],
        },
      },
      {
        text: 'You close your eyes and make a wish.',
        picture: {
          cast: [{ model: 'kid', mood: 'blink' }],
          sky: 'skyDayBottom',
          ground: 'pathSand',
          decor: ['sparkles'],
        },
      },
      {
        text: 'Up, up goes your wish, like a star!',
        picture: {
          cast: [
            { model: 'statue', size: 0.45, at: [-0.4, 0, 0] },
            { model: 'star', colour: 'flowerYellow', at: [1.0, 3.0, 0.8], size: 2.2 },
          ],
          sky: 'skyDayBottom',
          ground: 'waterTop',
          decor: ['sparkles', 'clouds'],
        },
      },
      {
        text: 'What did you wish for?',
        picture: {
          cast: [{ model: 'kid', mood: 'surprised' }],
          sky: 'skyDayBottom',
          ground: 'pathSand',
          decor: ['sparkles', 'hearts'],
        },
      },
      {
        text: 'A day in the park with friends!',
        picture: {
          cast: [
            { model: 'kid', mood: 'happy', pose: 'armsUp' },
            { model: 'ripika', mood: 'happy', at: [-1.3, 0, 0.3], turn: 25 },
            { model: 'biscuit', mood: 'happy', at: [1.3, 0, 0.3], turn: -25 },
          ],
          sky: 'skyDayBottom',
          ground: 'grassLight',
          decor: ['hearts'],
        },
      },
    ],
  },
  {
    id: 'keychainStall',
    kind: 'picture',
    title: 'The Keychain Stall',
    cover: 'stonePink',
    titlePicture: {
      cast: [{ model: 'keychain', variant: 'ripika', size: 6 }],
      sky: 'stonePinkLight',
      decor: ['sparkles'],
    },
    pages: [
      {
        text: 'The stall has lots of keychains.',
        picture: {
          cast: [
            { model: 'keychain', variant: 'star', at: [-0.5, 0, 0], size: 5 },
            { model: 'keychain', variant: 'heart', at: [0, 0, 0.1], size: 5 },
            { model: 'keychain', variant: 'strawberry', at: [0.5, 0, 0], size: 5 },
          ],
          sky: 'stonePinkLight',
          decor: ['sparkles'],
        },
      },
      {
        text: 'There is a star and a heart.',
        picture: {
          cast: [
            { model: 'keychain', variant: 'star', at: [-0.4, 0, 0], size: 6 },
            { model: 'keychain', variant: 'heart', at: [0.4, 0, 0], size: 6 },
          ],
          sky: 'stonePinkLight',
          decor: ['hearts'],
        },
      },
      {
        text: 'There is a little RiPika too!',
        picture: {
          cast: [{ model: 'keychain', variant: 'ripika', size: 7 }],
          sky: 'stonePinkLight',
          decor: ['sparkles'],
        },
      },
      {
        text: 'You pick one for your bag.',
        picture: {
          cast: [
            { model: 'kid', mood: 'happy', turn: 150 },
          ],
          sky: 'stonePinkLight',
          ground: 'pathSand',
          decor: ['hearts'],
        },
      },
      {
        text: 'Jingle, jingle, off you go!',
        picture: {
          cast: [{ model: 'kid', mood: 'happy', pose: 'wave', turn: -20 }],
          sky: 'skyDayBottom',
          ground: 'pathSand',
          decor: ['notes', 'sparkles'],
        },
      },
    ],
  },
  {
    id: 'bigParade',
    kind: 'picture',
    title: 'The Big Parade',
    cover: 'fairyPink',
    titlePicture: {
      cast: [
        { model: 'ripika', mood: 'happy', at: [-0.9, 0, 0] },
        { model: 'biscuit', mood: 'happy', at: [0.9, 0, 0] },
      ],
      sky: 'skyDayBottom',
      ground: 'grassLight',
    },
    pages: [
      {
        text: 'Everybody line up for the parade!',
        picture: {
          cast: [{ model: 'kid', mood: 'happy', pose: 'armsUp' }],
          sky: 'skyDayBottom',
          ground: 'pathSand',
          decor: ['notes'],
        },
      },
      {
        text: 'First comes you, then RiPika.',
        picture: {
          cast: [
            { model: 'kid', mood: 'happy', at: [0.9, 0, 0.3], turn: 35 },
            { model: 'ripika', mood: 'happy', at: [-1.0, 0, 0], turn: 35 },
          ],
          sky: 'skyDayBottom',
          ground: 'pathSand',
          decor: ['notes'],
        },
      },
      {
        text: 'Then Biscuit, then Trilla too.',
        picture: {
          cast: [
            { model: 'biscuit', mood: 'happy', at: [0.8, 0, 0.2], turn: 35 },
            { model: 'trilla', mood: 'happy', at: [-0.9, 0, 0], turn: 35 },
          ],
          sky: 'skyDayBottom',
          ground: 'pathSand',
          decor: ['notes'],
        },
      },
      {
        text: 'Then a bunny, a kitten and a mouse!',
        picture: {
          cast: [
            { model: 'bunny', mood: 'happy', at: [1.3, 0, 0.2], turn: 35 },
            { model: 'kitten', mood: 'happy', at: [0, 0, 0], turn: 35 },
            { model: 'mouse', mood: 'happy', at: [-1.3, 0, -0.2], turn: 35 },
          ],
          sky: 'skyDayBottom',
          ground: 'pathSand',
          decor: ['notes'],
        },
      },
      {
        text: 'What a long and happy line!',
        picture: {
          cast: [
            { model: 'kid', mood: 'happy', at: [1.8, 0, 0.6], turn: -20 },
            { model: 'ripika', mood: 'happy', at: [0.4, 0, 0.2], turn: -10 },
            { model: 'biscuit', mood: 'happy', at: [-0.9, 0, -0.2], turn: 10 },
            { model: 'trilla', mood: 'happy', at: [-2.1, 0, -0.5], turn: 20 },
          ],
          sky: 'skyDayBottom',
          ground: 'pathSand',
          decor: ['hearts', 'sparkles'],
        },
      },
    ],
  },
  {
    id: 'goodnightPark',
    kind: 'picture',
    title: 'Goodnight, Park',
    cover: 'skyNightBottom',
    titlePicture: {
      cast: [{ model: 'ripika', mood: 'blink' }],
      sky: 'skyNightBottom',
      ground: 'grassDark',
      night: true,
      decor: ['moon', 'stars'],
    },
    pages: [
      {
        text: 'The park is getting sleepy now.',
        picture: {
          cast: [{ model: 'kid', mood: 'blink' }],
          sky: 'skySunsetBottom',
          ground: 'grassLight',
          decor: ['sun'],
        },
      },
      {
        text: 'Goodnight, slide and big wheel.',
        picture: {
          cast: [{ model: 'kid', mood: 'happy', pose: 'wave', turn: 160 }],
          sky: 'skyNightBottom',
          ground: 'grassDark',
          night: true,
          decor: ['stars'],
        },
      },
      {
        text: 'Goodnight, cat bus and fountain.',
        picture: {
          cast: [{ model: 'catBus', turn: 25 }],
          sky: 'skyNightBottom',
          ground: 'grassDark',
          night: true,
          decor: ['moon', 'zzz'],
        },
      },
      {
        text: 'RiPika yawns a great big yawn.',
        picture: {
          cast: [{ model: 'ripika', mood: 'surprised', at: [0, 0, 0.35] }, { model: 'petBed', at: [0, -0.02, -0.1] }],
          sky: 'skyNightBottom',
          ground: 'grassDark',
          night: true,
          decor: ['stars'],
        },
      },
      {
        text: 'Goodnight, you, and sleep tight.',
        picture: {
          cast: [
            { model: 'kid', mood: 'blink', at: [-0.6, 0, 0], turn: 15 },
            { model: 'ripika', mood: 'blink', at: [0.8, 0, 0.3], turn: -15 },
          ],
          sky: 'skyNightBottom',
          ground: 'grassDark',
          night: true,
          decor: ['moon', 'zzz', 'stars'],
        },
      },
    ],
  },
];

export { CHAPTER_BOOKS };

/**
 * **Every library book, in shelf order**: the picture books, then the chapter
 * books. Slot `i` of `layout.ts`'s `LIBRARY_READABLE_SLOTS` holds `BOOKS[i]`,
 * and every count of books in the game derives from this list's length —
 * never a typed twelve.
 */
export const BOOKS: readonly LibraryBook[] = [...PICTURE_BOOKS, ...CHAPTER_BOOKS];

// Each list holds only its own kind, and no two books share an id (the deep
// link, the save key and the slot pairing all key on it). Loud at load, so a
// book filed in the wrong list never reaches a shelf.
{
  const problems: string[] = [];
  for (const [list, kind] of [
    [PICTURE_BOOKS, 'picture'],
    [CHAPTER_BOOKS, 'chapter'],
  ] as const) {
    for (const book of list) {
      if (book.kind !== kind) problems.push(`'${book.id}' is a ${book.kind} book in the ${kind} books' list`);
    }
  }
  const seen = new Set<string>();
  for (const book of BOOKS) {
    if (seen.has(book.id)) problems.push(`two books share the id '${book.id}'`);
    seen.add(book.id);
  }
  if (problems.length > 0) throw new Error(`library books: ${problems.join('; ')}`);
}

/**
 * **Which books story time may read aloud** — the one owner of that rule
 * (#718's story time, plan Step 9): picture books only. The owl reads a book
 * one page per speech bubble, and a speech bubble holds one short line; a
 * chapter page is a whole paragraph, far too long for one. Story time picks
 * its book (the recommended one, or the next in its order) from the books this
 * says yes to.
 */
export function storyTimeMayRead(book: LibraryBook): boolean {
  return book.kind === 'picture';
}

/** The Cute-o-dex key a read book is filed under — see the file comment. */
export function bookCollectionId(bookId: string): string {
  return `book.${bookId}`;
}

/** The book with this id, or `undefined` for an id nothing in {@link BOOKS} answers to. */
export function bookById(id: string): LibraryBook | undefined {
  return BOOKS.find((book) => book.id === id);
}
