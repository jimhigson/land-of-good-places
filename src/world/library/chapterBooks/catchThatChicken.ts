import type { LibraryBook } from '../books';

/**
 * **Catch That Chicken!** — chapter book 6, shelf place 6 (the big readers'
 * shelf, readable slot 18), the bedtime book that closes the shelf. An hour
 * before the Space Ferris Wheel climbs to space, Chicken-looter pinches its
 * golden star, and you and Trilla chase him across the evening sky by jet
 * pack, then win the star back with a better offer.
 *
 * The words are `docs/library-build/chapter-books/final.json`'s `books[5]`,
 * verbatim. The pictures name only `PICTURE_MODELS`: the wheel is the
 * story-props kit's `storyWheel` (dark, its star bracket empty, until `lit`
 * puts the star back and the lights on), the feathers, the cloud he hides in,
 * his nest and the biscuit he keeps are the kit's `feather`, `fluffyCloud`,
 * `twigNest` and `biscuitTreat`; Chicken-looter is the park's chicken balloon,
 * and the star, the jet packs, the keyrings, the disco ball, the trees, the
 * surprise egg and the alien are the park's own.
 */
export const catchThatChicken: LibraryBook = {
  id: 'catchThatChicken',
  kind: 'chapter',
  title: 'Catch That Chicken!',
  cover: 'trampolinePad',
  titlePicture: {
    cast: [
      { model: 'balloon', variant: 'chicken', mood: 'happy', at: [0.3, 0.4, 0], turn: -20 },
      { model: 'star', colour: 'flowerYellow', size: 1.1, at: [0.62, 1.38, 0.15], turn: -20 },
      { model: 'trilla', mood: 'surprised', jetpack: 'on', at: [-1.2, 0.2, 0.3], turn: 25 },
    ],
    sky: 'skySunsetBottom',
    decor: ['clouds', 'speed'],
  },
  pages: [
    {
      text: 'At eight o’clock every night, the Space Ferris Wheel lit its golden star and climbed all the way to space. But tonight, at seven, you and Trilla looked up and gasped. The star was gone!',
      picture: {
        cast: [
          { model: 'storyWheel', at: [0, 0, -2.2] },
          { model: 'kid', mood: 'surprised', at: [-1.0, 0, 1.0], turn: 15 },
          { model: 'trilla', mood: 'surprised', at: [1.0, 0, 1.1], turn: -15 },
        ],
        sky: 'skySunsetBottom',
        ground: 'grassLight',
        decor: ['sun'],
      },
    },
    {
      text: 'On the grass lay one red feather and one white one. ‘Chicken-looter!’ sang Trilla, who sang everything, even bad news. That cheeky balloon loved shiny things, and the star was the shiniest of all.',
      picture: {
        cast: [
          { model: 'feather', colour: 'flowerRed', size: 3, at: [0.4, 0, 1.0], turn: -50 },
          { model: 'feather', size: 3, at: [-0.4, 0, 0.9], turn: 35 },
          { model: 'kid', mood: 'surprised', at: [-1.3, 0, 0], turn: 25 },
          { model: 'trilla', mood: 'surprised', at: [1.3, 0, 0.1], turn: -25 },
        ],
        sky: 'skySunsetBottom',
        ground: 'grassLight',
        decor: ['notes'],
      },
    },
    {
      text: 'Then you spotted him, bobbing above the trees with the golden star tucked under his wing. ‘Shiny, shiny, MINE!’ clucked Chicken-looter. And off he floated, giggling, towards the setting sun.',
      picture: {
        cast: [
          { model: 'lollipopTree', at: [0.6, 0, -2.4] },
          { model: 'lollipopTree', variant: 'blossom', at: [2.6, 0, -2.8] },
          { model: 'balloon', variant: 'chicken', mood: 'happy', at: [1.7, 2.5, -1.8], turn: 60 },
          { model: 'star', colour: 'flowerYellow', at: [1.95, 3.55, -1.55], turn: 60 },
          { model: 'kid', mood: 'surprised', pose: 'wave', at: [-1.6, 0, 0.8], turn: 20 },
          { model: 'trilla', mood: 'surprised', at: [-0.3, 0, 1.0], turn: 10 },
        ],
        sky: 'skySunsetBottom',
        ground: 'grassLight',
        decor: ['sun'],
      },
    },
    {
      text: 'There was only one way to catch a flying chicken. You took a deep breath and switched on your jet pack. Trilla’s popped out too. WHOOSH! Up you zoomed into the evening sky.',
      picture: {
        cast: [
          { model: 'kid', mood: 'happy', pose: 'armsUp', jetpack: 'on', at: [-0.6, 0.4, 0], turn: 30 },
          { model: 'trilla', mood: 'happy', jetpack: 'on', at: [0.9, 0.8, 0], turn: 30 },
        ],
        sky: 'skySunsetBottom',
        decor: ['speed', 'clouds'],
      },
    },
    {
      text: 'Round the big wheel and over the hotel you chased him. Chicken-looter dived into a fluffy cloud to hide. But Trilla spotted something. His feathery bottom was poking out!',
      picture: {
        cast: [
          { model: 'balloon', variant: 'chicken', at: [0.6, -0.05, -0.75], turn: 180 },
          { model: 'fluffyCloud', size: 1.3, at: [0.6, 1.0, -0.9] },
          { model: 'trilla', mood: 'happy', jetpack: 'on', at: [2.6, 1.2, 0.3], turn: -30 },
          { model: 'kid', mood: 'happy', pose: 'wave', jetpack: 'on', at: [-1.9, 0.8, 0.5], turn: 30 },
        ],
        sky: 'skySunsetBottom',
        decor: ['clouds'],
      },
    },
    {
      text: 'You followed him down to the roof of the Land Hotel, and there was his nest. It was full of shiny things: spoons, keyrings, the hotel’s disco ball and, for some reason, a biscuit.',
      picture: {
        cast: [
          { model: 'twigNest', at: [0.2, 0, -0.6] },
          { model: 'discoBall', size: 0.8, at: [0.25, 0.1, -0.85] },
          { model: 'keychain', variant: 'star', size: 2.5, at: [-0.35, 0.18, -0.45], turn: 15 },
          { model: 'keychain', variant: 'heart', size: 2.5, at: [0.8, 0.18, -0.55], turn: -20 },
          { model: 'keychain', variant: 'strawberry', size: 2.5, at: [0.55, 0.2, -0.25], turn: -5 },
          { model: 'spoon', size: 1.4, at: [-0.15, 0.32, -0.2], turn: 50 },
          { model: 'spoon', size: 1.4, at: [0.95, 0.3, -0.3], turn: -60 },
          { model: 'spoon', size: 1.4, at: [-0.5, 0.28, -0.75], turn: 100 },
          { model: 'biscuitTreat', size: 1.4, at: [0.2, 0.34, -0.1], turn: 20 },
          { model: 'kid', mood: 'surprised', jetpack: 'off', at: [-1.9, 0, 0.4], turn: 30 },
          { model: 'trilla', mood: 'surprised', jetpack: 'off', at: [2.2, 0, 0.3], turn: -30 },
        ],
        sky: 'skySunsetBottom',
        ground: 'glassTint',
        decor: ['clouds', 'sparkles'],
      },
    },
    {
      text: 'In the middle was Chicken-looter, hugging the star. ‘Please don’t take it,’ he whispered. ‘I’m scared of the dark. Shiny things are my night-lights.’ Then he sat on the star, just in case.',
      picture: {
        cast: [
          { model: 'twigNest', at: [0, 0, -0.5] },
          { model: 'star', colour: 'flowerYellow', at: [0.3, 0.12, -0.2], turn: -15 },
          { model: 'balloon', variant: 'chicken', mood: 'sad', at: [0, -0.72, -0.5] },
          { model: 'kid', mood: 'sad', at: [-1.7, 0, 0.5], turn: 30 },
          { model: 'trilla', mood: 'sad', at: [1.7, 0, 0.5], turn: -30 },
        ],
        sky: 'skyNightBottom',
        ground: 'glassTint',
        night: true,
        decor: ['moon', 'stars'],
      },
    },
    {
      text: '‘The dark isn’t scary,’ you said. ‘It’s where the stars live. Give back one star, and you can see millions!’ So he gave back the star. And the disco ball. But not the biscuit.',
      picture: {
        cast: [
          { model: 'twigNest', at: [1.1, 0, -1.2] },
          { model: 'balloon', variant: 'chicken', mood: 'happy', at: [1.1, -0.72, -1.2], turn: -20 },
          { model: 'biscuitTreat', size: 1.6, at: [0.95, 0.42, -0.85], turn: -20 },
          { model: 'kid', mood: 'happy', pose: 'armsUp', at: [-0.9, 0, 0.4], turn: 20 },
          { model: 'star', colour: 'flowerYellow', size: 1.4, at: [-0.55, 1.05, 0.55], turn: 20 },
          { model: 'discoBall', size: 0.7, at: [-0.2, 0, 0.9] },
          { model: 'trilla', mood: 'happy', at: [-2.4, 0, 0.1], turn: 25 },
        ],
        sky: 'skyNightBottom',
        ground: 'glassTint',
        night: true,
        decor: ['stars', 'moon', 'sparkles'],
      },
    },
    {
      text: 'It was one minute to eight! You zoomed back and clicked the star into place. Just in time! The lights blazed, everyone jumped aboard, and the great wheel began to climb.',
      picture: {
        cast: [
          { model: 'storyWheel', lit: true, at: [0, 0, -1.6] },
          { model: 'kid', mood: 'happy', pose: 'armsUp', jetpack: 'on', at: [1.35, 1.5, -0.6], turn: -20 },
          { model: 'trilla', mood: 'happy', at: [-1.4, 0, 0.7], turn: 20 },
          { model: 'balloon', variant: 'chicken', mood: 'happy', at: [-2.5, 0, 0.2], turn: 25 },
        ],
        sky: 'skyNightBottom',
        ground: 'grassDark',
        night: true,
        decor: ['sparkles', 'stars'],
      },
    },
    {
      text: 'Up and up, all the way to space, where millions of stars twinkled and an alien waved. Chicken-looter wasn’t scared one bit. He was so happy, he laid an egg. A surprise egg, of course!',
      picture: {
        cast: [
          { model: 'alienSaucer', size: 0.3, at: [-1.6, 1.6, -4] },
          { model: 'kid', mood: 'happy', pose: 'wave', at: [-1.3, 0, 0.5], turn: 20 },
          { model: 'trilla', mood: 'happy', at: [0.1, 0.2, 0.6] },
          { model: 'balloon', variant: 'chicken', mood: 'happy', at: [1.4, -0.3, 0.4], turn: -15 },
          { model: 'surpriseEgg', colour: 'blossomPink', accent: 'markerSky', size: 1.4, at: [1.45, 0.05, 0.55] },
        ],
        sky: 'skyNightBottom',
        night: true,
        decor: ['stars', 'moon', 'sparkles'],
      },
    },
  ],
};
