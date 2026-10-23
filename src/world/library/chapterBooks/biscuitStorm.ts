import type { LibraryBook, PictureActor } from '../books';

/**
 * **Biscuit and the Storm** — chapter book 5, shelf place 5 (the big readers'
 * shelf). When a scowling storm cloud rains on the Grand Fountain Picnic,
 * Biscuit's own tummy tells him why it is so cross, so he and RiPika brave the
 * wind to feed it, and the greedy bear ends up sharing his picnic with a new
 * friend called Nimbus.
 *
 * The words are `docs/library-build/chapter-books/final.json`'s `books[4]`,
 * verbatim. The pictures name only `PICTURE_MODELS`: Nimbus is the
 * story-props kit's `stormCloud` (grey and cross, `blossomWhite` once she is
 * fed — a page's colour is a `PaletteKey`), the picnic its `picnicBlanket`,
 * `sandwichTower`, `sandwich`, `jamTart`, `cake` and `sandwichHeap` (her
 * forty-one), the storm its `puddle`, `windowFrame`, `umbrellaInsideOut` and
 * `battlement`, the burp its `rainbowArch`; the owl librarian, the library's
 * desk and bookcase, the candy floss and its bare sticks are the park's own;
 * the rain is the 2D decor `rain`. Mrs Crumpet's pile is three closed books
 * at size 3, mint, lilac and pink from the bottom, with the kitten asleep on
 * top.
 */

/** A jam tart on the picnic blanket (whose top is 0.04 m up). */
function tart(x: number, z: number): PictureActor {
  return { model: 'jamTart', size: 1.3, at: [x, 0.04, z] };
}

/** Mrs Crumpet asleep on her pile of three books, the pile's foot at (`x`, `z`). */
function mrsCrumpet(x: number, z: number): PictureActor[] {
  return [
    { model: 'book', colour: 'markerMint', size: 3, at: [x, 0, z] },
    { model: 'book', colour: 'markerLilac', size: 3, at: [x, 0.36, z], turn: 12 },
    { model: 'book', colour: 'markerPink', size: 3, at: [x, 0.72, z], turn: -8 },
    { model: 'kitten', mood: 'blink', at: [x, 1.08, z], turn: -20 },
  ];
}

export const biscuitStorm: LibraryBook = {
  id: 'biscuitStorm',
  kind: 'chapter',
  title: 'Biscuit and the Storm',
  cover: 'grownUpCoat',
  titlePicture: {
    cast: [
      { model: 'stormCloud', mood: 'frown', at: [0.5, 1.75, -1.3] },
      { model: 'picnicBlanket', at: [0.3, 0, 0.3] },
      { model: 'sandwichTower', at: [0.7, 0.04, 0.1] },
      { model: 'biscuit', mood: 'surprised', pose: 'armsUp', at: [-0.7, 0, 0.6], turn: 15 },
    ],
    sky: 'stoneGreyLight',
    ground: 'grassLight',
    decor: ['clouds'],
  },
  pages: [
    {
      text: 'It was the day of the Grand Fountain Picnic. Biscuit had packed forty-two sandwiches, nine jam tarts and a cake. ‘Just a little snack,’ he told RiPika, licking his lips.',
      picture: {
        cast: [
          { model: 'statue', size: 0.3, at: [-0.7, 0, -2.8] },
          { model: 'picnicBlanket', at: [0.25, 0, 0.3] },
          { model: 'sandwichTower', at: [-0.2, 0.04, 0.1] },
          { model: 'sandwich', size: 1.2, at: [-0.35, 0.04, 0.75], turn: 30 },
          { model: 'sandwich', size: 1.2, at: [0.05, 0.04, 0.85], turn: -25 },
          { model: 'cake', at: [0.85, 0.04, -0.05] },
          tart(0.35, 0.5),
          tart(0.65, 0.5),
          tart(0.95, 0.5),
          tart(0.35, 0.75),
          tart(0.65, 0.75),
          tart(0.95, 0.75),
          tart(0.35, 1.0),
          tart(0.65, 1.0),
          tart(0.95, 1.0),
          { model: 'biscuit', mood: 'happy', pose: 'wave', at: [-1.2, 0, 0.6], turn: 20 },
          { model: 'ripika', mood: 'surprised', at: [1.75, 0, 0.55], turn: -30 },
        ],
        sky: 'skyDayBottom',
        ground: 'grassLight',
        decor: ['sun'],
      },
    },
    {
      text: 'But just as Biscuit unwrapped sandwich number one, an enormous grey cloud rolled across the sky. It scowled down at the picnic. RUMBLE, RUMBLE, RUMBLE! RiPika’s fur stood on end.',
      picture: {
        cast: [
          { model: 'stormCloud', mood: 'frown', size: 1.3, at: [0.3, 2.3, -1.6] },
          { model: 'picnicBlanket', at: [0.35, 0, 0.2] },
          { model: 'sandwichTower', at: [0.4, 0.04, -0.15] },
          { model: 'cake', at: [0.95, 0.04, 0.2] },
          tart(0.45, 0.6),
          tart(0.75, 0.65),
          { model: 'biscuit', mood: 'surprised', pose: 'wave', at: [-0.8, 0, 0.55], turn: 15 },
          // Sandwich number one, in his paws.
          { model: 'sandwich', at: [-0.52, 0.62, 0.67], turn: 20 },
          { model: 'ripika', mood: 'surprised', pose: 'armsUp', at: [1.75, 0, 0.45], turn: -25 },
        ],
        sky: 'stoneGreyLight',
        ground: 'grassLight',
        decor: ['clouds'],
      },
    },
    {
      text: 'Whoosh! The wind snatched the sandwiches. Splosh! The rain soaked the cake. Everyone ran for cover, except Biscuit, who chased his jam tarts and fell SPLASH into the fountain.',
      picture: {
        cast: [
          { model: 'statue', size: 0.3, at: [-0.4, 0, -2.6] },
          // Sitting in the fountain's water, up to his tummy.
          { model: 'biscuit', mood: 'surprised', pose: 'armsUp', at: [-0.3, -0.38, 0.55] },
          { model: 'sandwich', size: 1.6, at: [-1.3, 1.35, 0.2], turn: 40 },
          { model: 'sandwich', size: 1.6, at: [0.5, 1.85, 0], turn: -30 },
          { model: 'sandwich', size: 1.6, at: [1.2, 1.15, 0.35], turn: 70 },
          { model: 'jamTart', size: 1.8, at: [-0.75, 0.95, 0.6] },
          { model: 'jamTart', size: 1.8, at: [0.55, 1.2, 0.7] },
          { model: 'cake', at: [1.15, 0, 1.0] },
          { model: 'ripika', mood: 'surprised', at: [2.2, 0, 0.3], turn: 90 },
        ],
        sky: 'stoneGreyLight',
        ground: 'waterTop',
        decor: ['rain', 'splash', 'speed'],
      },
    },
    {
      text: 'Soggy and squelchy, Biscuit and RiPika hurried into the library. Outside, the cloud went RUMBLE! ‘SHHH!’ said the owl librarian sternly, and the rumbling stopped at once. Mrs Crumpet never even woke up.',
      picture: {
        cast: [
          { model: 'bookcase', size: 0.7, at: [0.3, 0, -2.0] },
          { model: 'owl', mood: 'surprised', at: [-1.35, 0, -0.4], turn: 25 },
          { model: 'puddle', at: [0.05, 0, 0.55] },
          { model: 'biscuit', mood: 'blink', at: [0.05, 0, 0.5] },
          { model: 'ripika', mood: 'surprised', at: [1.05, 0, 0.55], turn: -15 },
          ...mrsCrumpet(2.1, -0.4),
        ],
        sky: 'buildingFloor',
        ground: 'woodLight',
        night: true,
        decor: ['zzz', 'splash'],
      },
    },
    {
      text: 'Soon the rumbling started again, soft and sad. Biscuit’s tummy rumbled back, as if to say hello. ‘That’s not thunder,’ Biscuit gasped. ‘That’s a hungry TUMMY! No wonder that cloud is cross.’',
      picture: {
        cast: [
          { model: 'windowFrame', size: 1.4, at: [0.1, 0, -1.3] },
          // The storm, seen through the library window.
          { model: 'stormCloud', mood: 'sad', size: 0.75, at: [0.1, 0.85, -3.2] },
          { model: 'biscuit', mood: 'surprised', pose: 'armsUp', at: [-0.9, 0, 0.55], turn: 15 },
          { model: 'ripika', mood: 'happy', at: [1.05, 0, 0.5], turn: -20 },
        ],
        sky: 'stoneGreyLight',
        ground: 'woodLight',
        night: true,
        decor: ['sparkles'],
      },
    },
    {
      text: 'But what do clouds eat? The owl found a book all about clouds and read: ‘Clouds love anything fluffy.’ RiPika squeaked with joy. Candy floss was the fluffiest food in the park!',
      picture: {
        cast: [
          { model: 'libraryDesk', size: 0.6, at: [-0.5, 0, -0.7] },
          { model: 'owl', mood: 'happy', at: [-0.5, 0, -1.25] },
          // The book all about clouds, open on her desk.
          { model: 'openBook', colour: 'markerSky', at: [-0.5, 0.62, -0.65] },
          { model: 'biscuit', mood: 'happy', at: [0.35, 0, 0.6], turn: -10 },
          { model: 'ripika', mood: 'happy', pose: 'armsUp', at: [1.25, 0, 0.3], turn: -25 },
        ],
        sky: 'buildingFloor',
        ground: 'woodLight',
        night: true,
        decor: ['sparkles'],
      },
    },
    {
      text: 'The library was cosy, but the picnic needed saving. Out into the storm they marched! Biscuit’s umbrella blew inside out, but on they went, and soon they had three candy flosses: pink, blue and rainbow.',
      picture: {
        cast: [
          { model: 'biscuit', mood: 'frown', pose: 'wave', at: [-0.9, 0, 0.3], turn: 40 },
          // Held up in his raised paw.
          { model: 'umbrellaInsideOut', at: [-0.65, 0.6, 0.45], turn: 40 },
          { model: 'ripika', mood: 'happy', pose: 'armsUp', at: [0.9, 0, 0.4], turn: -10 },
          // Held up in her raised paws: pink in one, blue and rainbow in the other.
          { model: 'candyFloss', variant: 'pink', size: 1.3, at: [0.46, 0.5, 0.52], turn: 10 },
          { model: 'candyFloss', variant: 'blue', size: 1.3, at: [1.28, 0.52, 0.52], turn: -10 },
          { model: 'candyFloss', variant: 'rainbow', size: 1.3, at: [1.47, 0.42, 0.6], turn: -20 },
        ],
        sky: 'stoneGreyLight',
        ground: 'pathSand',
        decor: ['rain', 'speed', 'splash', 'clouds'],
      },
    },
    {
      text: 'Up they went in the lift, to the castle roof. Biscuit held up the candy floss, and the cloud gobbled the lot. Then it did an enormous BURP… and out popped a rainbow!',
      picture: {
        cast: [
          { model: 'battlement', at: [-1.25, 0, -2.8] },
          { model: 'battlement', at: [1.25, 0, -2.8] },
          { model: 'stormCloud', mood: 'surprised', size: 0.9, at: [0.4, 1.55, -1.9] },
          // The burp: a rainbow arching out of the cloud.
          { model: 'rainbowArch', size: 0.3, at: [1.32, 1.82, -1.45] },
          { model: 'biscuit', mood: 'surprised', pose: 'armsUp', at: [-1.0, 0, 0.5], turn: 20 },
          // The three empty candy-floss sticks, held up in his paws.
          { model: 'flossStick', size: 2, at: [-1.33, 0.55, 0.62], turn: -10 },
          { model: 'flossStick', size: 2, at: [-0.72, 0.55, 0.62], turn: 10 },
          { model: 'flossStick', size: 2, at: [-0.62, 0.5, 0.68], turn: 20 },
          { model: 'ripika', mood: 'surprised', at: [0.1, 0, 0.75], turn: 15 },
        ],
        sky: 'stoneGreyLight',
        ground: 'grassLight',
        decor: ['clouds', 'sparkles'],
      },
    },
    {
      text: 'The rain stopped. The sun came out. The cloud smiled, then puffed very gently and blew every single sandwich back onto the picnic blanket. ‘Thank you,’ it whispered. ‘My name is Nimbus.’',
      picture: {
        cast: [
          { model: 'stormCloud', colour: 'blossomWhite', mood: 'happy', size: 0.9, at: [-1.0, 1.55, -1.1], turn: 30 },
          // Every sandwich drifting back down onto the blanket.
          { model: 'sandwich', size: 1.5, at: [-0.25, 1.45, -0.75], turn: 30 },
          { model: 'sandwich', size: 1.5, at: [0.2, 1.1, -0.45], turn: -20 },
          { model: 'sandwich', size: 1.5, at: [0.55, 0.7, -0.2], turn: 50 },
          { model: 'sandwich', size: 1.5, at: [0.8, 0.35, 0], turn: -40 },
          { model: 'picnicBlanket', at: [0.7, 0, 0.35] },
          { model: 'sandwich', size: 1.5, at: [0.4, 0.04, 0.6], turn: 10 },
          { model: 'sandwich', size: 1.5, at: [1.0, 0.04, 0.45], turn: -60 },
          { model: 'biscuit', mood: 'happy', pose: 'armsUp', at: [1.85, 0, 0.55], turn: -20 },
          { model: 'ripika', mood: 'happy', at: [2.5, 0, -0.3], turn: -25 },
        ],
        sky: 'skyDayBottom',
        ground: 'grassLight',
        decor: ['sun', 'sparkles'],
      },
    },
    {
      text: 'So Nimbus joined the Grand Fountain Picnic, and kept everyone cool in its shade. Biscuit even shared his sandwiches. Nimbus had forty-one. Biscuit had one. And whose tummy rumbled all the way home?',
      picture: {
        cast: [
          { model: 'statue', size: 0.3, at: [-2.3, 0, -3.4] },
          { model: 'stormCloud', colour: 'blossomWhite', mood: 'happy', size: 1.1, at: [-0.5, 1.65, -1.4] },
          { model: 'picnicBlanket', at: [0, 0, -0.2] },
          // Nimbus's forty-one: the heap is exactly that many.
          { model: 'sandwichHeap', at: [-0.5, 0.04, -0.55] },
          { model: 'biscuit', mood: 'happy', pose: 'sit', at: [0.4, -0.15, 0.45], turn: -10 },
          // Biscuit's one.
          { model: 'sandwich', size: 1.2, at: [0.4, 0.32, 0.95], turn: 15 },
          { model: 'ripika', mood: 'happy', pose: 'sit', at: [1.35, -0.15, 0.3], turn: -20 },
          { model: 'bunny', mood: 'happy', at: [-1.55, 0, 0.45], turn: 20 },
          { model: 'mouse', mood: 'happy', at: [2.2, 0, -0.1], turn: -25 },
        ],
        sky: 'skyDayBottom',
        ground: 'grassLight',
        decor: ['hearts', 'sun'],
      },
    },
  ],
};
