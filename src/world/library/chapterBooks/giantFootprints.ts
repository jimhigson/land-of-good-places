import type { LibraryBook } from '../books';

/**
 * **The Giant Footprints** — chapter book 4, shelf place 4 (the big readers'
 * shelf, readable slot 16). Giant footprints appear all over the park and
 * everyone hides, until brave RiPika works out that whoever made them walks
 * far too slowly to be scary and follows them to Grandpa Tock, a 102-year-old
 * tortoise who has never been on a ride.
 *
 * The words are `docs/library-build/chapter-books/final.json`'s `books[3]`,
 * verbatim. The pictures name only `PICTURE_MODELS`: the footprints are the
 * story-props kit's `giantFootprint`, the flowerbed its `flower` (the yellow
 * ones `nibbled`), the bench its `parkBench`, the petal its `petal` and the
 * finish line its `rainbowArch`; Grandpa Tock is the Reptile House's own
 * tortoise (`tortoise`: `blink` asleep, `neutral` drowsy, `stretch` his
 * poke, `tuck` his head in).
 */
export const giantFootprints: LibraryBook = {
  id: 'giantFootprints',
  kind: 'chapter',
  title: 'The Giant Footprints',
  cover: 'leafBlue',
  titlePicture: {
    cast: [
      { model: 'ripika', mood: 'surprised', at: [-1.0, 0, 0.5], turn: 25 },
      { model: 'giantFootprint', size: 1.5, at: [0.3, 0, 0.6], turn: 100 },
      { model: 'giantFootprint', size: 1.5, at: [1.4, 0, 0.1], turn: 110 },
      { model: 'giantFootprint', size: 1.5, at: [2.5, 0, -0.5], turn: 120 },
    ],
    sky: 'skyDawnBottom',
    ground: 'grassLight',
    decor: ['sun'],
  },
  pages: [
    {
      text: 'One morning, RiPika found footprints by the fountain. Giant ones! Each was as round as a dinner plate, with stubby toes. They went round the fountain twice, then off across the grass.',
      picture: {
        cast: [
          { model: 'statue', size: 0.42, at: [0, 0, -3.2] },
          { model: 'giantFootprint', size: 1.2, at: [-1.5, 0, -2.2], turn: 60 },
          { model: 'giantFootprint', size: 1.2, at: [-0.5, 0, -1.6], turn: 85 },
          { model: 'giantFootprint', size: 1.2, at: [0.6, 0, -1.6], turn: 100 },
          { model: 'giantFootprint', size: 1.2, at: [1.6, 0, -2.0], turn: 70 },
          { model: 'giantFootprint', size: 1.2, at: [2.6, 0, -1.3], turn: 60 },
          { model: 'giantFootprint', size: 1.2, at: [3.5, 0, -0.6], turn: 55 },
          { model: 'ripika', mood: 'surprised', at: [-2.3, 0, 0.5], turn: 35 },
        ],
        sky: 'skyDawnBottom',
        ground: 'pathSand',
        decor: ['sun'],
      },
    },
    {
      text: 'RiPika put her own foot in one. It looked like a pea on a dinner plate. ‘Whoever made these,’ she whispered, ‘has very big feet. And probably a very big tummy.’',
      picture: {
        cast: [
          { model: 'giantFootprint', size: 2.6, at: [0, 0, 0] },
          { model: 'ripika', mood: 'surprised', at: [0, 0, -0.15] },
        ],
        sky: 'skyDawnBottom',
        ground: 'pathSand',
      },
    },
    {
      text: 'The footprints led through the flowerbeds, where somebody had nibbled every yellow flower and left the rest. ‘It likes yellow things,’ said RiPika, who was very yellow. She hid behind you, just in case.',
      picture: {
        cast: [
          { model: 'flower', colour: 'blossomPink', size: 1.3, at: [-2.4, 0, -1.4] },
          { model: 'flower', colour: 'flowerYellow', nibbled: true, size: 1.3, at: [-1.8, 0, -1.1] },
          { model: 'flower', colour: 'flowerBlue', size: 1.3, at: [-1.2, 0, -1.4] },
          { model: 'flower', colour: 'flowerYellow', nibbled: true, size: 1.3, at: [-0.6, 0, -1.1] },
          { model: 'flower', colour: 'blossomPink', size: 1.3, at: [0, 0, -1.4] },
          { model: 'flower', colour: 'flowerYellow', nibbled: true, size: 1.3, at: [0.6, 0, -1.1] },
          { model: 'flower', colour: 'flowerBlue', size: 1.3, at: [1.2, 0, -1.4] },
          { model: 'giantFootprint', size: 1.2, at: [-2.1, 0, -0.5], turn: 80 },
          { model: 'giantFootprint', size: 1.2, at: [-0.9, 0, -0.6], turn: 85 },
          { model: 'giantFootprint', size: 1.2, at: [0.3, 0, -0.5], turn: 95 },
          { model: 'kid', mood: 'surprised', at: [1.6, 0, 0.3], turn: -35 },
          { model: 'ripika', mood: 'surprised', at: [2.35, 0, -0.35], turn: -30 },
        ],
        sky: 'skyDayBottom',
        ground: 'grassLight',
      },
    },
    {
      text: 'Next morning there were more footprints, by the big wheel and the slide. ‘A giant!’ gasped Sir Hopsalot. ‘A monster!’ squeaked the mouse. ‘A GIANT HAMSTER!’ wailed Biscuit, from under a bench.',
      picture: {
        cast: [
          { model: 'giantFootprint', size: 1.2, at: [-2.8, 0, 1.3], turn: 100 },
          { model: 'giantFootprint', size: 1.2, at: [-1.4, 0, 1.4], turn: 95 },
          { model: 'giantFootprint', size: 1.2, at: [0, 0, 1.3], turn: 85 },
          { model: 'giantFootprint', size: 1.2, at: [1.4, 0, 1.4], turn: 95 },
          { model: 'bunny', mood: 'surprised', at: [-2.0, 0, 0.2], turn: 25 },
          { model: 'mouse', mood: 'surprised', at: [-0.6, 0, 0.5], turn: 15 },
          { model: 'parkBench', size: 3, at: [1.3, 0, -0.9], turn: -10 },
          { model: 'biscuit', mood: 'surprised', pose: 'sit', at: [1.3, -0.18, -0.75], turn: -10 },
        ],
        sky: 'skyDayBottom',
        ground: 'grassLight',
        decor: ['speed'],
      },
    },
    {
      text: 'But RiPika was brave. She looked carefully: the footprints were very close together. ‘Whoever it is walks VERY slowly,’ she said, ‘and nothing that slow can be scary. Let’s follow them!’',
      picture: {
        cast: [
          { model: 'giantFootprint', size: 1.2, at: [0.2, 0, -0.6], turn: 175 },
          { model: 'giantFootprint', size: 1.2, at: [0, 0, -1.4], turn: 185 },
          { model: 'giantFootprint', size: 1.2, at: [0.3, 0, -2.2], turn: 175 },
          { model: 'giantFootprint', size: 1.2, at: [0.05, 0, -3.0], turn: 190 },
          { model: 'giantFootprint', size: 1.2, at: [0.35, 0, -3.8], turn: 180 },
          { model: 'ripika', mood: 'happy', pose: 'armsUp', at: [-0.7, 0, 0.6], turn: 15 },
          { model: 'kid', mood: 'happy', pose: 'wave', at: [1.1, 0, 0.3], turn: -15 },
        ],
        sky: 'skyDayBottom',
        ground: 'grassLight',
        decor: ['sparkles'],
      },
    },
    {
      text: 'You and RiPika followed them through the smiling snake-mouth door of the Reptile House. There, in the Tortoise Garden, lay Grandpa Tock, fast asleep, with a yellow petal on his nose.',
      picture: {
        cast: [
          { model: 'lollipopTree', size: 0.8, at: [0.4, 0, -3.2] },
          { model: 'giantFootprint', size: 1.2, at: [-2.2, 0, 1.2], turn: 116 },
          { model: 'giantFootprint', size: 1.2, at: [-1.2, 0, 0.8], turn: 116 },
          { model: 'giantFootprint', size: 1.2, at: [-0.3, 0, 0.4], turn: 116 },
          { model: 'tortoise', mood: 'blink', size: 1.3, at: [1.3, 0, -0.5], turn: -60 },
          { model: 'petal', colour: 'flowerYellow', size: 3, at: [0.29, 0.72, 0.09], turn: -60 },
          { model: 'kid', mood: 'surprised', at: [-1.9, 0, 0.1], turn: 60 },
          { model: 'ripika', mood: 'surprised', at: [-0.8, 0, 0.6], turn: 45 },
        ],
        sky: 'skyDayBottom',
        ground: 'grassLight',
        decor: ['zzz'],
      },
    },
    {
      text: '‘The giant is a tortoise!’ whispered RiPika. Grandpa Tock opened his eyes, very slowly. In fact, he woke up so slowly that it took him until lunchtime to say good morning.',
      picture: {
        cast: [
          { model: 'tortoise', mood: 'neutral', size: 1.3, at: [1.2, 0, -0.4], turn: -45 },
          { model: 'ripika', mood: 'surprised', pose: 'wave', at: [-0.2, 0, 0.5], turn: 30 },
          { model: 'kid', mood: 'blink', pose: 'sit', at: [-1.7, -0.3, 0.1], turn: 30 },
        ],
        sky: 'skyDayBottom',
        ground: 'grassLight',
        decor: ['sun'],
      },
    },
    {
      text: '‘I’m a hundred and two,’ he said, ‘and I’ve never been on a ride. Every evening I set off for the Rail Race, but I’m so slow, the carts are asleep when I arrive.’',
      picture: {
        cast: [
          { model: 'tortoise', mood: 'neutral', size: 1.3, at: [1.2, 0, -0.5], turn: -45 },
          { model: 'ripika', mood: 'sad', pose: 'sit', at: [-0.1, -0.17, 0.4], turn: 30 },
          { model: 'kid', mood: 'sad', pose: 'sit', at: [-1.6, -0.3, 0.1], turn: 35 },
        ],
        sky: 'skyDayBottom',
        ground: 'grassLight',
      },
    },
    {
      text: 'RiPika had an idea. She called the cat bus! Grandpa Tock rode on its roof, all the way to the Rail Race. Everyone who had hidden from the giant came out to wave.',
      picture: {
        cast: [
          { model: 'catBus', size: 0.55, at: [-0.5, 0, -2.5], turn: 30 },
          { model: 'tortoise', mood: 'happy', pose: 'stretch', at: [-0.5, 1.56, -2.5], turn: 30 },
          { model: 'biscuit', mood: 'happy', pose: 'wave', at: [0.6, 0, 1.0], turn: -10 },
          { model: 'ripika', mood: 'happy', pose: 'wave', at: [1.6, 0, 0.6], turn: -20 },
          { model: 'bunny', mood: 'happy', at: [2.6, 0, 0], turn: -25 },
          { model: 'mouse', mood: 'happy', at: [3.4, 0, 0.6], turn: -30 },
        ],
        sky: 'skyDayBottom',
        ground: 'pathSand',
        decor: ['notes', 'sparkles'],
      },
    },
    {
      text: 'In his race cart, Grandpa Tock didn’t need to duck. When a duck bar came, he just popped his head into his shell! At the finish he cried, ‘Again! But slower, please.’',
      picture: {
        cast: [
          { model: 'rainbowArch', size: 0.7, at: [-1.0, 0, -3.5], turn: 35 },
          { model: 'cart', colour: 'markerMint', size: 0.4, turn: 35 },
          { model: 'tortoise', pose: 'tuck', size: 0.7, at: [0, 0.958, 0], turn: 35 },
          { model: 'duckBar', turn: 35 },
        ],
        sky: 'skyDayBottom',
        ground: 'grassLight',
        decor: ['speed', 'sparkles'],
      },
    },
  ],
};
