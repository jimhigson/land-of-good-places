import type { LibraryBook } from '../books';

/**
 * **Duck, Sir Hopsalot!** — chapter book 1 on the big readers' shelf (slot
 * 13). The words are the editor's, verbatim: `docs/library-build/chapter-books/final.json`
 * `books[0]`. The pictures follow that file's page notes, drawn only with
 * `PICTURE_MODELS` (see `chapterBooks/index.ts`).
 *
 * Sir Hopsalot is the `bunny`. A pet riding a Rail Race cart sits in a `cart`
 * at `size` 0.4 — the bare cart is drawn at the race's `RIDE_SCALE` (2.5), so
 * 0.4 is the cart's own size, the one the reader's `raceCart` seats her at —
 * {@link ON_SEAT} up. A pet "ducking" is the same pet sunk into the tub
 * ({@link DUCKED}): the pets have no limbs to fold and their ears cannot fold
 * either, so sinking is the fold. One duck bar gate spans both lanes, as the
 * race's bars do, at the race's own height for it, so a pet sitting up meets
 * it with its ear tips and a sunk one passes under.
 */

/**
 * Where a pet riding a cart stands, in the picture: on the seat. A stage
 * direction placed by eye on the rendered page, like every `at` in a book.
 * The race's own figure is `railRace/cart.ts`'s `SEAT_HEIGHT`, which a book
 * cannot import: that module's imports reach the race's ring path, which reads
 * `PARK_BOUNDARY` — a seed's park, built at import time — and a book must load
 * anywhere (Node checks, vitest) without a park. See this branch's handoff,
 * "For the join".
 */
const ON_SEAT = 0.96;

/** A pet sunk low in a cart's tub, ducking: only its ears and the top of its head show over the rim. */
const DUCKED = ON_SEAT - 0.5;

/** Ducking just enough to show how, eyes still over the rim: RiPika teaching him (page 7). */
const HALF_DUCKED = ON_SEAT - 0.18;

export const sirHopsalot: LibraryBook = {
  id: 'sirHopsalot',
  kind: 'chapter',
  title: 'Duck, Sir Hopsalot!',
  cover: 'markerSky',
  titlePicture: {
    cast: [
      { model: 'cart', colour: 'markerSky', size: 0.4, turn: 25 },
      { model: 'bunny', mood: 'happy', at: [0, ON_SEAT, 0], turn: 25 },
      { model: 'rubberDuck', size: 1.4, at: [1.05, 0, 0.9], turn: -25 },
    ],
    sky: 'skyDayBottom',
    ground: 'grassLight',
    decor: ['sparkles'],
  },
  pages: [
    {
      text: 'Sir Hopsalot was the grandest bunny in the Land of Good Places. His ears were the tallest, his tail was the fluffiest, and he never stopped telling everybody about it. He even told the trees.',
      picture: {
        cast: [
          { model: 'lollipopTree', size: 0.75, at: [1.5, 0, -0.6] },
          { model: 'bunny', mood: 'happy', at: [0.25, 0, 0.2], turn: 55 },
          { model: 'ripika', mood: 'blink', at: [-0.85, 0, 0], turn: 35 },
          { model: 'mouse', mood: 'blink', at: [-1.7, 0, 0.15], turn: 40 },
        ],
        sky: 'skyDayBottom',
        ground: 'grassLight',
        decor: ['sparkles'],
      },
    },
    {
      text: 'One sunny morning, RiPika was waiting in the queue for the Rail Race. Sir Hopsalot hopped straight past everybody. ‘Make way for the magnificent Sir Hopsalot!’ he announced.',
      picture: {
        cast: [
          { model: 'queuePosts', at: [-0.5, 0, -0.75] },
          { model: 'mouse', mood: 'surprised', at: [0.45, 0, -0.05], turn: 45 },
          { model: 'biscuit', mood: 'frown', at: [-0.5, 0, -0.05], turn: 45 },
          { model: 'ripika', mood: 'surprised', at: [-1.45, 0, -0.05], turn: 45 },
          { model: 'bunny', mood: 'happy', at: [1.55, 0.3, 0.45], turn: 35 },
        ],
        sky: 'skyDayBottom',
        ground: 'pathSand',
        decor: ['speed'],
      },
    },
    {
      text: 'RiPika frowned. ‘That’s pushing in!’ ‘Nonsense,’ sniffed Sir Hopsalot. ‘I challenge you to a race, small yellow person. Whoever loses must say the winner is magnificent.’ ‘Deal,’ said RiPika, climbing into her cart.',
      picture: {
        cast: [
          { model: 'cart', colour: 'markerPink', size: 0.4, at: [-0.8, 0, 0], turn: 15 },
          { model: 'ripika', mood: 'frown', at: [-0.8, ON_SEAT, 0], turn: 50 },
          { model: 'cart', colour: 'markerSky', size: 0.4, at: [0.8, 0, 0], turn: -15 },
          { model: 'bunny', mood: 'happy', at: [0.8, ON_SEAT, 0], turn: -10 },
        ],
        sky: 'skyDayBottom',
        ground: 'grassLight',
      },
    },
    {
      text: 'The carts whooshed off. ‘DUCK!’ called RiPika, ducking under the first striped bar. ‘A duck? Where?’ said Sir Hopsalot. BONK! His ears went wibble-wobble. It didn’t hurt, but his cart slowed down.',
      picture: {
        cast: [
          { model: 'duckBar', turn: 45 },
          { model: 'cart', colour: 'markerPink', size: 0.4, at: [-0.67, 0, 0.67], turn: 45 },
          { model: 'ripika', mood: 'happy', at: [-0.67, DUCKED, 0.67], turn: 45 },
          { model: 'cart', colour: 'markerSky', size: 0.4, at: [0.67, 0, -0.67], turn: 45 },
          { model: 'bunny', mood: 'surprised', at: [0.67, ON_SEAT, -0.67], turn: 70 },
        ],
        sky: 'skyDayBottom',
        ground: 'grassLight',
        decor: ['speed'],
      },
    },
    {
      text: 'At the second bar, Sir Hopsalot was ready. ‘This time I shall spot that duck!’ He peered left. He peered right. He peered up. BONK! ‘Still no duck,’ he grumbled.',
      picture: {
        cast: [
          { model: 'duckBar', turn: 50 },
          { model: 'cart', colour: 'markerSky', size: 0.4, turn: 50 },
          { model: 'bunny', mood: 'frown', at: [0, ON_SEAT, 0], turn: 50 },
          { model: 'cart', colour: 'markerPink', size: 0.4, at: [3.4, 0, -10], turn: 110 },
          { model: 'ripika', mood: 'happy', at: [3.4, DUCKED, -10], turn: 110 },
        ],
        sky: 'skyDayBottom',
        ground: 'grassLight',
        decor: ['speed'],
      },
    },
    {
      text: 'Sir Hopsalot’s ears drooped. ‘Everybody keeps shouting about ducks,’ he wailed, ‘and there are no ducks anywhere!’ RiPika gasped. He didn’t know! Nobody had ever told him what ducking was.',
      picture: {
        cast: [
          { model: 'cart', colour: 'markerSky', size: 0.4, at: [-1.0, 0, 0.2], turn: 60 },
          { model: 'bunny', mood: 'sad', at: [-1.0, ON_SEAT, 0.2], turn: 40 },
          { model: 'cart', colour: 'markerPink', size: 0.4, at: [1.0, 0, -0.4], turn: 60 },
          { model: 'ripika', mood: 'surprised', at: [1.0, ON_SEAT, -0.4], turn: -50 },
        ],
        sky: 'skyDayBottom',
        ground: 'grassLight',
      },
    },
    {
      text: 'The biggest bar of all was next, right before the finish. RiPika could win easily, but she slowed down beside him. ‘Duck means get down low, like this! Fold your ears!’',
      picture: {
        cast: [
          { model: 'rainbowArch', at: [0, 0, -11] },
          { model: 'duckBar', at: [0, 0, -7] },
          { model: 'cart', colour: 'markerPink', size: 0.4, at: [-0.75, 0, 0], turn: 180 },
          { model: 'ripika', mood: 'happy', at: [-0.75, HALF_DUCKED, 0], turn: 30 },
          { model: 'cart', colour: 'markerSky', size: 0.4, at: [0.75, 0, -0.1], turn: 180 },
          { model: 'bunny', mood: 'surprised', at: [0.75, ON_SEAT, -0.1], turn: -50 },
        ],
        sky: 'skyDayBottom',
        ground: 'grassLight',
      },
    },
    {
      text: 'Sir Hopsalot folded his magnificent ears and bent down low. WHOOSH! Under the bar they went, side by side, and over the finish line in a shower of confetti.',
      picture: {
        cast: [
          { model: 'rainbowArch', size: 0.9, at: [0, 0, -3.5], turn: 25 },
          { model: 'duckBar', turn: 25 },
          { model: 'cart', colour: 'markerPink', size: 0.4, at: [-0.86, 0, 0.36], turn: 25 },
          { model: 'ripika', mood: 'happy', at: [-0.86, DUCKED, 0.36], turn: 25 },
          { model: 'cart', colour: 'markerSky', size: 0.4, at: [0.86, 0, -0.36], turn: 25 },
          { model: 'bunny', mood: 'happy', at: [0.86, DUCKED, -0.36], turn: 25 },
        ],
        sky: 'skyDayBottom',
        ground: 'grassLight',
        decor: ['speed', 'confetti'],
      },
    },
    {
      text: 'RiPika won by the tip of her nose! ‘You are magnificent,’ said Sir Hopsalot. ‘So are you!’ said RiPika. ‘No, YOU are!’ They argued about it all the way to the ice cream parlour.',
      picture: {
        cast: [
          { model: 'rainbowArch', size: 0.55, at: [0, 0, -2.5] },
          { model: 'ripika', mood: 'happy', pose: 'armsUp', at: [-0.5, 0, 0.6], turn: 30 },
          { model: 'bunny', mood: 'happy', at: [0.5, 0, 0.6], turn: -30 },
        ],
        sky: 'skyDayBottom',
        ground: 'grassLight',
        decor: ['confetti', 'hearts'],
      },
    },
    {
      text: 'The next day, Sir Hopsalot said sorry for pushing in and gave RiPika a yellow rubber duck. ‘At last,’ laughed RiPika, ‘a duck!’ Then he hopped to the back of the queue, like everybody else.',
      picture: {
        cast: [
          { model: 'queuePosts', at: [-0.3, 0, -0.9] },
          { model: 'mouse', mood: 'happy', at: [1.7, 0, -0.1], turn: 45 },
          { model: 'biscuit', mood: 'happy', at: [0.6, 0, -0.1], turn: 45 },
          { model: 'ripika', mood: 'happy', pose: 'wave', at: [-0.5, 0, 0.1], turn: 25 },
          { model: 'rubberDuck', size: 1.1, at: [-0.08, 0.42, 0.35], turn: -15 },
          { model: 'bunny', mood: 'happy', at: [-1.8, 0, -0.1], turn: 45 },
        ],
        sky: 'skyDayBottom',
        ground: 'pathSand',
        decor: ['hearts'],
      },
    },
  ],
};
