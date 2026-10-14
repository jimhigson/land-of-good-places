import type { PaletteKey } from '../../core/palette';
import type { Expression } from '../../art/style/faces';
import type { BalloonKind } from '../../art/models/balloons';
import type { KeychainKind } from '../../art/models/keychains';
import type { BreakfastKind } from '../../art/models/hotelAssets';

/**
 * **The twelve library books** — the one table every word and picture in them
 * comes from (#717, part 3 of the Library epic #714).
 *
 * Jim, 13 October 2026: *"twelve authored short picture books about the park"*,
 * 4–6 pages each, **one sentence and one big picture per page**. Written for a
 * six-year-old who is learning to read, so every rule of GAME_DESIGN.md's
 * BREVITY RULE applies to every line: a title is at most 24 characters, a page
 * is one sentence of at most 50. `pnpm run check:brevity` walks this table
 * (`scripts/check-copy-brevity.mts`), so a page cannot quietly grow.
 *
 * Every other spine on the library's shelves is decoration; these twelve are
 * the ones you can open. They live here, in data, so the family can edit a
 * story without touching the reader — `world/library/reader/` turns a
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
] as const;

/** A model the reader knows how to build for a picture — see {@link PICTURE_MODELS}. */
export type PictureModel = (typeof PICTURE_MODELS)[number];

/**
 * How a creature with arms and legs holds them. Anything without limbs ignores
 * it. `duck` is a rider's: the reader in a `raceCart`, folded under a bar by
 * the Rail Race's own pose (`railRace/duckPose.ts`); a `raceCart` with any
 * other pose has her sitting up.
 */
export type PicturePose = 'stand' | 'armsUp' | 'wave' | 'sit' | 'duck';

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
  /** Which balloon, keychain or breakfast — only read for those three models. */
  readonly variant?: BalloonKind | KeychainKind | BreakfastKind;
  /** A colour for models that take one (the cart, the star, a book). */
  readonly colour?: PaletteKey;
}

/** Little things painted over the picture, the way an illustrator would. */
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
  | 'notes';

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
  /** One sentence, at most 50 characters (BREVITY RULE, measured by `check:brevity`). */
  readonly text: string;
  readonly picture: PagePicture;
}

export interface LibraryBook {
  /** Stable id: the deep link (`/book?id=`), the save key and the cache key all use it. */
  readonly id: string;
  /** At most 24 characters (BREVITY RULE). */
  readonly title: string;
  /** The cover boards' colour, and the bookmark's in the Cute-o-dex. */
  readonly cover: PaletteKey;
  /** The picture on the title page. */
  readonly titlePicture: PagePicture;
  /** Four to six pages — the reader and `check:book-reader` both hold it to that. */
  readonly pages: readonly BookPage[];
}

/** The fewest and most pages a book may have. */
export const BOOK_MIN_PAGES = 4;
export const BOOK_MAX_PAGES = 6;

export const BOOKS: readonly LibraryBook[] = [
  {
    id: 'ripikaBalloon',
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
            { model: 'statue', size: 0.55 },
            { model: 'balloon', variant: 'dalmatian', at: [0.6, 2.4, 0.4] },
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
          cast: [
            { model: 'cart', colour: 'markerPink', turn: 30 },
            { model: 'kid', mood: 'happy', pose: 'wave', at: [1.5, 0, 0.6], turn: -20 },
          ],
          sky: 'skyDayBottom',
          ground: 'grassLight',
        },
      },
      {
        text: 'A bar is coming, so duck down!',
        picture: {
          cast: [
            { model: 'raceCart', colour: 'markerPink', mood: 'surprised', pose: 'duck', turn: 55, at: [-1.1, 0, 0] },
            { model: 'duckBar', turn: 55, at: [1.3, 0, -0.9] },
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
            { model: 'raceCart', colour: 'markerPink', mood: 'happy', pose: 'duck', turn: 55 },
            { model: 'duckBar', turn: 55 },
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
            { model: 'duckBar', turn: 55, at: [-1.6, 0, 1.1] },
            { model: 'raceCart', colour: 'markerPink', mood: 'happy', pose: 'duck', turn: 55 },
            { model: 'duckBar', turn: 55, at: [1.6, 0, -1.1] },
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
            { model: 'statue', size: 0.55 },
            { model: 'star', colour: 'flowerYellow', at: [0.7, 2.3, 0.3], size: 1.3 },
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
            { model: 'kid', mood: 'happy', at: [0.9, 0, 0.3], turn: 70 },
            { model: 'ripika', mood: 'happy', at: [-1.0, 0, 0], turn: 70 },
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
            { model: 'biscuit', mood: 'happy', at: [0.8, 0, 0.2], turn: 70 },
            { model: 'trilla', mood: 'happy', at: [-0.9, 0, 0], turn: 70 },
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
            { model: 'bunny', mood: 'happy', at: [1.3, 0, 0.2], turn: 70 },
            { model: 'kitten', mood: 'happy', at: [0, 0, 0], turn: 70 },
            { model: 'mouse', mood: 'happy', at: [-1.3, 0, -0.2], turn: 70 },
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
          cast: [{ model: 'ripika', mood: 'surprised' }, { model: 'petBed', at: [0, -0.02, 0] }],
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

/** The Cute-o-dex key a read book is filed under — see the file comment. */
export function bookCollectionId(bookId: string): string {
  return `book.${bookId}`;
}

/** The book with this id, or `undefined` for an id nothing in {@link BOOKS} answers to. */
export function bookById(id: string): LibraryBook | undefined {
  return BOOKS.find((book) => book.id === id);
}
