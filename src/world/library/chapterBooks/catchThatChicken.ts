import type { LibraryBook } from '../books';

/**
 * **Catch That Chicken!** — chapter book 6, shelf place 6 (the big readers'
 * shelf), the bedtime book that closes the shelf. An hour before the Space
 * Ferris Wheel climbs to space, Chicken-looter pinches its golden star, and you
 * and Trilla chase him across the evening sky by jet pack, then win the star
 * back with a better offer.
 *
 * The words are `docs/library-build/chapter-books/final.json`'s `books[5]`,
 * verbatim. The pictures name only `PICTURE_MODELS`: the wheel is the
 * story-props kit's `storyWheel` (dark, its star bracket empty, until `lit`
 * puts the star back and the lights on), the feathers, the cloud he hides in,
 * his nest, the spoons and the biscuit he keeps are the kit's `feather`,
 * `fluffyCloud`, `twigNest`, `spoon` and `biscuitTreat`; Chicken-looter is the
 * park's chicken balloon (string and all), and the star, the jet packs, the
 * keyrings, the disco ball, the trees, the surprise egg and the alien are the
 * park's own.
 *
 * **Trilla wears her `surprised` face on every page.** Her tummy patch stands
 * proud of her face, and from the picture camera's low angle it covers her
 * eyes in every mood but `surprised` and `frown` (measured on the served
 * reader: `happy`, `sad` and `blink` draw no eye at all). Wide eyes fit each of
 * her moments here — the gasp, the chase, the hideout, the nest, the lights,
 * space — and a Trilla with a face beats a happy one with none.
 */
export const catchThatChicken: LibraryBook = {
  id: 'catchThatChicken',
  kind: 'chapter',
  title: 'Catch That Chicken!',
  cover: 'trampolinePad',
  titlePicture: {
    cast: [
      { model: 'balloon', variant: 'chicken', mood: 'happy', size: 1.3, at: [0.5, 0, 0.2], turn: -20 },
      { model: 'star', colour: 'flowerYellow', size: 1.2, at: [0.92, 1.38, 0.38], turn: -20 },
      { model: 'trilla', mood: 'surprised', jetpack: 'on', size: 0.8, at: [-1.0, 0.1, 0.5], turn: 50 },
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
          { model: 'feather', colour: 'flowerRed', size: 3.5, at: [0.45, 0, 1.0], turn: -50 },
          { model: 'feather', size: 3.5, at: [-0.4, 0, 0.9], turn: 35 },
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
          { model: 'lollipopTree', size: 0.6, at: [0.7, 0, -1.6] },
          { model: 'lollipopTree', variant: 'blossom', size: 0.65, at: [2.0, 0, -2.0] },
          { model: 'balloon', variant: 'chicken', mood: 'happy', size: 1.2, at: [1.4, 1.0, -0.8], turn: 60 },
          // Tucked under his wing.
          { model: 'star', colour: 'flowerYellow', at: [1.75, 2.3, -0.55], turn: 60 },
          { model: 'kid', mood: 'surprised', pose: 'wave', at: [-1.2, 0, 0.7], turn: 25 },
          { model: 'trilla', mood: 'surprised', at: [-0.1, 0, 1.0], turn: 10 },
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
          // Side on, so both jet packs show, firing.
          { model: 'kid', mood: 'happy', pose: 'armsUp', jetpack: 'on', at: [-0.7, 0.5, 0.2], turn: 75 },
          { model: 'trilla', mood: 'surprised', jetpack: 'on', at: [1.0, 0.1, 0.3], turn: 85 },
        ],
        sky: 'skySunsetBottom',
        decor: ['speed', 'clouds'],
      },
    },
    {
      text: 'Round the big wheel and over the hotel you chased him. Chicken-looter dived into a fluffy cloud to hide. But Trilla spotted something. His feathery bottom was poking out!',
      picture: {
        cast: [
          // His head in the cloud, his feathery bottom (and his string) hanging out of it.
          { model: 'fluffyCloud', size: 1.3, at: [0, 1.62, -0.5] },
          { model: 'balloon', variant: 'chicken', size: 1.2, at: [0.4, 0, -0.45], turn: 150 },
          { model: 'trilla', mood: 'surprised', jetpack: 'on', size: 0.85, at: [2.0, 0.4, 0.6], turn: -50 },
          { model: 'kid', mood: 'happy', pose: 'wave', jetpack: 'on', size: 0.85, at: [-2.1, 0.25, 0.4], turn: 65 },
        ],
        sky: 'skySunsetBottom',
        decor: ['clouds'],
      },
    },
    {
      text: 'You followed him down to the roof of the Land Hotel, and there was his nest. It was full of shiny things: spoons, keyrings, the hotel’s disco ball and, for some reason, a biscuit.',
      picture: {
        cast: [
          { model: 'twigNest', size: 1.5, at: [0.3, 0, -0.5] },
          { model: 'discoBall', size: 0.9, at: [0.3, 0.15, -0.75] },
          { model: 'keychain', variant: 'star', size: 3, at: [-0.4, 0.3, -0.35], turn: 15 },
          { model: 'keychain', variant: 'heart', size: 3, at: [1.0, 0.3, -0.45], turn: -20 },
          { model: 'keychain', variant: 'strawberry', size: 3, at: [0.7, 0.32, -0.1], turn: -5 },
          { model: 'spoon', size: 1.8, at: [-0.1, 0.45, -0.05], turn: 50 },
          { model: 'spoon', size: 1.8, at: [1.15, 0.42, -0.15], turn: -60 },
          { model: 'spoon', size: 1.8, at: [-0.55, 0.4, -0.7], turn: 100 },
          { model: 'biscuitTreat', size: 1.8, at: [0.3, 0.46, 0.05], turn: 20 },
          { model: 'kid', mood: 'surprised', jetpack: 'off', at: [-1.65, 0, 0.5], turn: 30 },
          { model: 'trilla', mood: 'surprised', jetpack: 'off', at: [2.05, 0, 0.4], turn: -30 },
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
          { model: 'twigNest', size: 1.5, at: [0, 0, -0.4] },
          // Peeking out from under him.
          { model: 'star', colour: 'flowerYellow', size: 1.1, at: [0.4, 0.22, -0.05], turn: -20 },
          // Settled low in the nest like a hen on an egg (his string tucked away under him).
          { model: 'balloon', variant: 'chicken', mood: 'sad', at: [0, -0.5, -0.45] },
          { model: 'kid', mood: 'sad', at: [-1.5, 0, 0.5], turn: 30 },
          { model: 'trilla', mood: 'surprised', at: [1.6, 0, 0.6], turn: -30 },
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
          { model: 'twigNest', size: 1.3, at: [1.4, 0, -1.0] },
          { model: 'balloon', variant: 'chicken', mood: 'happy', at: [1.4, -0.5, -1.0], turn: -25 },
          // Hugged tight.
          { model: 'biscuitTreat', size: 2, at: [1.28, 0.62, -0.72], turn: -25 },
          { model: 'kid', mood: 'happy', pose: 'armsUp', at: [-0.5, 0, 0.4], turn: 20 },
          // In her raised hand.
          { model: 'star', colour: 'flowerYellow', size: 1.3, at: [0.1, 0.95, 0.68], turn: 20 },
          { model: 'discoBall', size: 0.7, at: [0.25, 0, 1.0] },
          { model: 'trilla', mood: 'surprised', at: [-1.9, 0, 0.8], turn: 25 },
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
          { model: 'storyWheel', lit: true, at: [0, 0, -1.8] },
          { model: 'kid', mood: 'happy', pose: 'armsUp', jetpack: 'on', at: [1.55, 1.35, -0.8], turn: -70 },
          { model: 'trilla', mood: 'surprised', at: [-0.6, 0, 1.0], turn: 10 },
          { model: 'balloon', variant: 'chicken', mood: 'happy', size: 1.3, at: [-1.8, 0, 0.7], turn: 25 },
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
          { model: 'alienSaucer', size: 0.32, at: [1.7, 1.9, -3.5] },
          { model: 'kid', mood: 'happy', pose: 'wave', at: [-1.0, 0, 0.5], turn: 20 },
          { model: 'trilla', mood: 'surprised', at: [0.25, -0.35, 0.9] },
          { model: 'balloon', variant: 'chicken', mood: 'happy', at: [1.45, -0.2, 0.3], turn: -15 },
          // Just laid, just below him.
          { model: 'surpriseEgg', colour: 'blossomPink', accent: 'markerSky', size: 1.3, at: [1.68, 0.1, 0.5] },
        ],
        sky: 'skyNightBottom',
        night: true,
        decor: ['stars', 'moon', 'sparkles'],
      },
    },
  ],
};
