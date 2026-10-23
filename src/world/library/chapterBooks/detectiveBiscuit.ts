import type { LibraryBook } from '../books';

/**
 * **Detective Biscuit** — chapter book 2 on the big readers' shelf (slot 14).
 * The words are the editor's, verbatim: `docs/library-build/chapter-books/final.json`
 * `books[1]`. The pictures follow that file's page notes, drawn only with
 * `PICTURE_MODELS` (see `chapterBooks/index.ts`).
 *
 * The thief is the `mini` (its `grab` lifts its grabby arms), and its
 * footprints are the kit's `pancakeFootprint`. The pink wall is drawn at
 * {@link WALL} on every page, so it is the same wall each time: still taller
 * than the mini, as the story needs (it cannot reach over it).
 */

/** The pink wall's size on every page: its two segments, scaled so the wall does not swallow the cast. */
const WALL = 0.6;

export const detectiveBiscuit: LibraryBook = {
  id: 'detectiveBiscuit',
  kind: 'chapter',
  title: 'Detective Biscuit',
  cover: 'wood',
  titlePicture: {
    cast: [
      { model: 'biscuit', mood: 'frown', pose: 'wave', turn: 15 },
      { model: 'magnifyingGlass', at: [0.42, 0.42, 0.2], turn: 15 },
      { model: 'pancakeFootprint', size: 2.2, at: [-0.55, 0, 0.85], turn: 160 },
      { model: 'pancakeFootprint', size: 2.2, at: [0.05, 0, 1.2], turn: 170 },
      { model: 'pancakeFootprint', size: 2.2, at: [0.6, 0, 1.55], turn: 160 },
    ],
    sky: 'skyDayBottom',
    ground: 'grassLight',
  },
  pages: [
    {
      text: 'On Monday, RiPika’s spotty balloon came untied from a bench and vanished. On Tuesday, the strawberry keyring fell off your bag and vanished too. Somebody in the Land of Good Places was taking things!',
      picture: {
        cast: [
          { model: 'statue', size: 0.35, at: [-0.4, 0, -5.5] },
          { model: 'kid', mood: 'surprised', keyring: false, at: [-1.35, 0, 0.1], turn: 60 },
          { model: 'ripika', mood: 'sad', at: [0.25, 0, 0.25], turn: 40 },
          { model: 'parkBench', at: [1.4, 0, -0.2], turn: -10 },
        ],
        sky: 'skyDayBottom',
        ground: 'pathSand',
        decor: ['sun'],
      },
    },
    {
      text: 'On Wednesday, Biscuit put his breakfast bowl down by the pink wall and forgot it. It vanished, spoon and all! So he picked up a magnifying glass. ‘Detective Biscuit,’ he announced, ‘is on the case!’',
      picture: {
        cast: [
          { model: 'pinkWall', size: WALL, at: [0, 0, -2.0] },
          { model: 'biscuit', mood: 'frown', pose: 'wave', at: [0.1, 0, 0.3], turn: 15 },
          { model: 'magnifyingGlass', at: [0.52, 0.42, 0.5], turn: 15 },
        ],
        sky: 'skyDayBottom',
        ground: 'pathSand',
        decor: ['sparkles'],
      },
    },
    {
      text: 'Biscuit searched the whole park. By the fountain he found tiny footprints, flat and wide like pancakes. By the ice cream parlour he found more. ‘Our thief,’ he said, ‘has very funny feet.’',
      picture: {
        cast: [
          { model: 'biscuit', mood: 'surprised', at: [-1.3, 0, -0.35], turn: 60 },
          { model: 'magnifyingGlass', at: [-0.8, 0.12, 0.0], turn: 60 },
          { model: 'pancakeFootprint', size: 2.0, at: [-0.54, 0, 0.21], turn: 58 },
          { model: 'pancakeFootprint', size: 2.0, at: [-0.23, 0, 0.66], turn: 58 },
          { model: 'pancakeFootprint', size: 2.0, at: [0.31, 0, 0.74], turn: 58 },
          { model: 'pancakeFootprint', size: 2.0, at: [0.61, 0, 1.19], turn: 58 },
          { model: 'pancakeFootprint', size: 2.0, at: [1.16, 0, 1.26], turn: 58 },
          { model: 'pancakeFootprint', size: 2.0, at: [1.46, 0, 1.72], turn: 58 },
          { model: 'pancakeFootprint', size: 2.0, at: [2.00, 0, 1.79], turn: 58 },
        ],
        sky: 'skyDayBottom',
        ground: 'grassLight',
      },
    },
    {
      text: '‘The thief is small,’ said Biscuit, ‘has funny feet and loves breakfast.’ Everyone looked at Biscuit. ‘Not me!’ he cried. ‘My feet aren’t funny!’ Everyone looked at his feet. They were, a bit.',
      picture: {
        cast: [
          { model: 'ripika', mood: 'frown', at: [-1.35, 0, -0.1], turn: 40 },
          { model: 'biscuit', mood: 'surprised', pose: 'armsUp', at: [0, 0, 0.3] },
          { model: 'kid', mood: 'neutral', at: [1.45, 0, -0.1], turn: -40 },
          { model: 'pancakeFootprint', size: 2.2, at: [-0.4, 0, 0.85], turn: 10 },
          { model: 'pancakeFootprint', size: 2.2, at: [0.42, 0, 0.9], turn: -10 },
        ],
        sky: 'skyDayBottom',
        ground: 'grassLight',
      },
    },
    {
      text: 'So Biscuit set a trap. He left a shiny gold star on the path, and everyone hid behind the fountain. Biscuit’s tummy rumbled. ‘Shh!’ said RiPika. ‘I can’t shush a tummy!’ whispered Biscuit.',
      picture: {
        cast: [
          { model: 'statue', size: 0.42, at: [0, 0, -1.0] },
          { model: 'biscuit', mood: 'surprised', at: [-0.95, 0, -1.4], turn: 35 },
          { model: 'ripika', mood: 'frown', at: [0.95, 0, -1.4], turn: -35 },
          { model: 'kid', mood: 'happy', pose: 'sit', at: [1.55, 0, -2.3], turn: -20 },
          { model: 'star', colour: 'flowerYellow', size: 1.6, at: [0, 0, 1.2] },
        ],
        sky: 'skyDayBottom',
        ground: 'pathSand',
      },
    },
    {
      text: 'Out from behind the pink wall tiptoed a mini: a tiny lilac creature with grabby arms and very naughty eyebrows. It grabbed the star. ‘Gotcha!’ shouted Biscuit, and everybody jumped out.',
      picture: {
        cast: [
          { model: 'pinkWall', size: WALL, at: [0, 0, -1.0] },
          { model: 'mini', mood: 'surprised', grab: 1, at: [0, 0, -0.2] },
          { model: 'star', colour: 'flowerYellow', size: 0.9, at: [0.34, 0.14, -0.17] },
          { model: 'biscuit', mood: 'surprised', pose: 'armsUp', at: [-1.0, 0, 0.1], turn: 35 },
          { model: 'ripika', mood: 'surprised', pose: 'armsUp', at: [1.0, 0, 0.1], turn: -35 },
          { model: 'kid', mood: 'surprised', pose: 'armsUp', at: [-1.6, 0, -0.8], turn: 35 },
        ],
        sky: 'skyDayBottom',
        ground: 'pathSand',
        decor: ['speed'],
      },
    },
    {
      text: '‘You took our star!’ cried RiPika. ‘I didn’t TAKE it,’ squeaked the mini. ‘I FOUND it, lying on the path, all alone.’ Biscuit had to admit that was perfectly true.',
      picture: {
        cast: [
          { model: 'pinkWall', size: WALL, at: [0, 0, -1.0] },
          { model: 'mini', mood: 'sad', grab: 0.4, at: [0.1, 0, -0.3], turn: -10 },
          { model: 'star', colour: 'flowerYellow', size: 0.7, at: [0.1, 0.05, -0.04] },
          { model: 'ripika', mood: 'frown', pose: 'wave', at: [1.05, 0, 0.1], turn: -40 },
          { model: 'biscuit', mood: 'blink', at: [-0.95, 0, 0.1], turn: 20 },
          { model: 'magnifyingGlass', at: [-0.5, 0.2, 0.35], turn: 20 },
        ],
        sky: 'skyDayBottom',
        ground: 'pathSand',
      },
    },
    {
      text: 'The mini led everyone behind the wall. There, safe and sound, were the balloon, the keyring and the bowl. ‘People lose things,’ it said, ‘and nobody looks down. But I’m small, so I always do.’',
      picture: {
        cast: [
          { model: 'pinkWall', size: WALL, at: [0, 0, -1.9] },
          { model: 'biscuit', mood: 'surprised', at: [-0.85, 0, -1.1], turn: 15 },
          { model: 'ripika', mood: 'surprised', at: [0.2, 0, -1.1] },
          { model: 'kid', mood: 'surprised', at: [1.35, 0, -1.2], turn: -15 },
          { model: 'stick', at: [-1.75, 0, 0.1] },
          { model: 'balloon', variant: 'dalmatian', at: [-1.75, 0.42, 0.1] },
          { model: 'flatStone', at: [-0.6, 0, 0.35] },
          { model: 'keychain', variant: 'strawberry', size: 3, at: [-0.6, 0.1, 0.35] },
          { model: 'bowl', variant: 'yoghurt', size: 2.2, at: [0.5, 0, 0.3] },
          { model: 'spoon', at: [0.55, 0.22, 0.3], turn: 40 },
          { model: 'mini', mood: 'happy', grab: 0.6, at: [1.45, 0, 0.45], turn: -50 },
        ],
        sky: 'skyDayBottom',
        ground: 'grassLight',
        decor: ['sparkles'],
      },
    },
    {
      text: '‘Then why didn’t you give them back?’ asked Biscuit. The mini sighed. ‘Because of my eyebrows. They look naughty even when I’m asleep. When I run up shouting “MINI ATTACK!”, everybody runs away.’',
      picture: {
        cast: [
          { model: 'pinkWall', size: WALL, at: [0, 0, -1.3] },
          { model: 'mini', mood: 'sad', at: [0.65, 0, 0.3], turn: -40 },
          { model: 'biscuit', mood: 'sad', pose: 'sit', at: [-0.35, -0.15, 0.25], turn: 25 },
          { model: 'ripika', mood: 'sad', at: [-1.3, 0, -0.2], turn: 30 },
        ],
        sky: 'skyDayBottom',
        ground: 'grassLight',
      },
    },
    {
      text: 'So Biscuit let the mini keep the gold star, as a badge: Finder of Lost Things. And now everybody knows a mini attack is really a hug, a very small one, round your knees.',
      picture: {
        cast: [
          { model: 'kid', mood: 'happy' },
          { model: 'mini', mood: 'happy', grab: 1, at: [0, 0, 0.45] },
          { model: 'star', colour: 'flowerYellow', size: 0.5, at: [0, 0.15, 0.72] },
          { model: 'biscuit', mood: 'happy', pose: 'wave', at: [-1.5, 0, -0.2], turn: 30 },
          { model: 'ripika', mood: 'happy', at: [1.5, 0, -0.2], turn: -30 },
        ],
        sky: 'skyDayBottom',
        ground: 'grassLight',
        decor: ['hearts', 'sparkles'],
      },
    },
  ],
};
