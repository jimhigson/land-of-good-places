import type { LibraryBook, PictureActor } from '../books';

/**
 * **The Giant Footprints** — chapter book 4, shelf place 4 (the big readers'
 * shelf). Giant footprints appear all over the park and everyone hides, until
 * brave RiPika works out that whoever made them walks far too slowly to be
 * scary and follows them to Grandpa Tock, a 102-year-old tortoise who has
 * never been on a ride.
 *
 * The words are `docs/library-build/chapter-books/final.json`'s `books[3]`,
 * verbatim. The pictures name only `PICTURE_MODELS`: the footprints are the
 * story-props kit's `giantFootprint`, the flowerbed its `flower` (the yellow
 * ones `nibbled`), the bench its `parkBench`, the petal its `petal` and the
 * finish line its `rainbowArch`; Grandpa Tock is the Reptile House's own
 * tortoise (`tortoise`: `blink` asleep, `neutral` drowsy, `stretch` his poke,
 * `tuck` his head in his shell).
 *
 * **Grandpa Tock is drawn big** (size 1.5 to 1.8 beside the others at 1):
 * he is the giant the footprints belong to. On the last page, where nobody
 * stands beside him, the race cart (`cart` at 0.8 of the race's size: twice
 * the park scale the race seats a rider at) and its duck bar (`duckBar` at 2,
 * hung for a rider at that scale) are doubled with him, so the bar still
 * clears his shell exactly as the race hangs it.
 */

/** One of the giant's footprints, toes leading the way it walked (`turn`). */
function print(at: readonly [number, number, number], turn: number, size = 1.2): PictureActor {
  return { model: 'giantFootprint', size, at, turn };
}

export const giantFootprints: LibraryBook = {
  id: 'giantFootprints',
  kind: 'chapter',
  title: 'The Giant Footprints',
  cover: 'leafBlue',
  titlePicture: {
    cast: [
      print([0.9, 0, 1.0], 205, 1.6),
      print([1.5, 0, -0.35], 200, 1.6),
      print([1.1, 0, -1.7], 195, 1.6),
      { model: 'ripika', mood: 'surprised', at: [-0.5, 0, 0.3], turn: 30 },
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
          { model: 'statue', size: 0.33, at: [0.6, 0, -2.6] },
          print([-0.6, 0, -2.0], 40),
          print([0, 0, -1.4], 75),
          print([1.0, 0, -1.35], 105),
          print([1.75, 0, -1.95], 150),
          print([2.3, 0, -0.9], 60),
          print([2.9, 0, -0.2], 50),
          { model: 'ripika', mood: 'surprised', at: [-1.3, 0, 0.6], turn: 35 },
        ],
        sky: 'skyDawnBottom',
        ground: 'pathSand',
        decor: ['sun'],
      },
    },
    {
      text: 'RiPika put her own foot in one. It looked like a pea on a dinner plate. ‘Whoever made these,’ she whispered, ‘has very big feet. And probably a very big tummy.’',
      picture: {
        cast: [print([0, 0, 0], 25, 2.6), { model: 'ripika', mood: 'surprised', at: [0, 0, -0.15] }],
        sky: 'skyDawnBottom',
        ground: 'pathSand',
      },
    },
    {
      text: 'The footprints led through the flowerbeds, where somebody had nibbled every yellow flower and left the rest. ‘It likes yellow things,’ said RiPika, who was very yellow. She hid behind you, just in case.',
      picture: {
        cast: [
          { model: 'flower', colour: 'blossomPink', size: 1.2, at: [-2.2, 0, -1.2] },
          { model: 'flower', colour: 'flowerYellow', nibbled: true, size: 1.2, at: [-1.8, 0, -0.9] },
          { model: 'flower', colour: 'flowerBlue', size: 1.2, at: [-1.4, 0, -1.2] },
          { model: 'flower', colour: 'flowerYellow', nibbled: true, size: 1.2, at: [-1.0, 0, -0.9] },
          { model: 'flower', colour: 'blossomPink', size: 1.2, at: [-0.6, 0, -1.2] },
          { model: 'flower', colour: 'flowerYellow', nibbled: true, size: 1.2, at: [-0.2, 0, -0.9] },
          { model: 'flower', colour: 'flowerBlue', size: 1.2, at: [0.2, 0, -1.2] },
          print([-1.9, 0, -0.25], 80),
          print([-0.8, 0, -0.45], 85),
          print([0.3, 0, -0.3], 95),
          { model: 'kid', mood: 'surprised', at: [1.0, 0, 0.4], turn: -40 },
          { model: 'ripika', mood: 'surprised', at: [1.75, 0, -0.3], turn: -45 },
        ],
        sky: 'skyDayBottom',
        ground: 'grassLight',
      },
    },
    {
      text: 'Next morning there were more footprints, by the big wheel and the slide. ‘A giant!’ gasped Sir Hopsalot. ‘A monster!’ squeaked the mouse. ‘A GIANT HAMSTER!’ wailed Biscuit, from under a bench.',
      picture: {
        cast: [
          print([-1.9, 0, 1.4], 95),
          print([-0.6, 0, 1.6], 90),
          print([0.7, 0, 1.45], 85),
          print([2.0, 0, 1.3], 80),
          // A bench big enough for a bear to hide under; he sits on the grass beneath it.
          { model: 'parkBench', size: 2.6, at: [0.6, 0, -0.9], turn: -35 },
          { model: 'biscuit', mood: 'surprised', pose: 'sit', size: 0.85, at: [0.6, -0.15, -0.8], turn: -35 },
          { model: 'bunny', mood: 'surprised', at: [-1.6, 0, 0.2], turn: 30 },
          { model: 'mouse', mood: 'surprised', at: [-0.55, 0, 0.6], turn: 20 },
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
          print([0.2, 0, -0.6], 175),
          print([0, 0, -1.4], 185),
          print([0.3, 0, -2.2], 175),
          print([0.05, 0, -3.0], 190),
          print([0.35, 0, -3.8], 180),
          { model: 'ripika', mood: 'happy', pose: 'armsUp', at: [-0.6, 0, 0.7], turn: 15 },
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
          print([-2.2, 0, 1.3], 100),
          print([-1.2, 0, 1.2], 100),
          print([-0.2, 0, 1.05], 100),
          { model: 'tortoise', mood: 'blink', size: 1.8, at: [1.1, 0, -0.6], turn: -6 },
          { model: 'petal', colour: 'flowerYellow', size: 4, at: [0.95, 1.0, 1.0], turn: -6 },
          { model: 'kid', mood: 'surprised', at: [-1.9, 0, 0.1], turn: 55 },
          { model: 'ripika', mood: 'surprised', at: [-0.75, 0, 0.55], turn: 40 },
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
          { model: 'tortoise', mood: 'neutral', size: 1.8, at: [1.1, 0, -0.6], turn: -6 },
          { model: 'ripika', mood: 'surprised', pose: 'wave', at: [-0.5, 0, 0.5], turn: 30 },
          // Sitting on the grass: sunk by her hip height, legs out in front.
          { model: 'kid', mood: 'blink', pose: 'sit', at: [-1.85, -0.3, 0], turn: 35 },
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
          { model: 'tortoise', mood: 'neutral', size: 1.8, at: [1.1, 0, -0.6], turn: -6 },
          { model: 'ripika', mood: 'sad', pose: 'sit', at: [-0.45, -0.17, 0.45], turn: 30 },
          { model: 'kid', mood: 'sad', pose: 'sit', at: [-1.85, -0.3, 0.05], turn: 35 },
        ],
        sky: 'skyDayBottom',
        ground: 'grassLight',
      },
    },
    {
      text: 'RiPika had an idea. She called the cat bus! Grandpa Tock rode on its roof, all the way to the Rail Race. Everyone who had hidden from the giant came out to wave.',
      picture: {
        cast: [
          { model: 'catBus', size: 0.4, at: [-0.4, 0, -2.4], turn: 70 },
          // On the roof: the bus's roof tops out at 5.24 of its own metres, 2.1 at size 0.4.
          { model: 'tortoise', mood: 'happy', pose: 'stretch', size: 1.5, at: [-0.72, 2.1, -2.52], turn: 70 },
          { model: 'biscuit', mood: 'happy', pose: 'wave', at: [-1.5, 0, 0.8], turn: 15 },
          { model: 'ripika', mood: 'happy', pose: 'wave', at: [-0.4, 0, 0.9], turn: 5 },
          { model: 'bunny', mood: 'happy', at: [0.6, 0, 0.8], turn: -10 },
          { model: 'mouse', mood: 'happy', at: [1.5, 0, 0.9], turn: -20 },
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
          { model: 'rainbowArch', size: 1.2, at: [-2.0, 0, -6.0], turn: 55 },
          { model: 'cart', colour: 'markerMint', size: 0.8, turn: 55 },
          // In the tub at the seat (SEAT_HEIGHT 0.958 at park scale, doubled), head in his shell.
          { model: 'tortoise', pose: 'tuck', size: 1.8, at: [0, 2.1, 0], turn: 55 },
          { model: 'duckBar', size: 2, turn: 55 },
        ],
        sky: 'skyDayBottom',
        ground: 'grassLight',
        decor: ['speed', 'sparkles'],
      },
    },
  ],
};
