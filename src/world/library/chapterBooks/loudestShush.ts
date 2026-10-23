import type { LibraryBook, PictureActor } from '../books';

/**
 * **The Loudest Shush** — chapter book 3 on the big readers' shelf (slot 15).
 * The words are the editor's, verbatim: `docs/library-build/chapter-books/final.json`
 * `books[2]`. The pictures follow that file's page notes, drawn only with
 * `PICTURE_MODELS` (see `chapterBooks/index.ts`).
 *
 * Mrs Crumpet is the `kitten`, and on every page that has it she sits on her
 * pile of books ({@link crumpetPile}). Trilla is the `trilla` puff. The
 * library pages are lit by the picture's moonlight rig — the library is one
 * dim, cosy floor — over the library's own warm floor colours: plum and warm
 * light, never black.
 */

/** The closed books' size in Mrs Crumpet's pile: three fat books, as the picture books draw a pile. */
const PILE_BOOK = 3;

/** One book's thickness at {@link PILE_BOOK}, placed by eye on the rendered page so each book rests on the one below. */
const PILE_STEP = 0.366;

/**
 * **Mrs Crumpet's pile of books**, with its foot at `(x, z)`: mint, lilac and
 * pink, each a little turned, about 1.1 m high — the books the kitten sleeps
 * (or sits, or frowns) on. The kitten stands on its top: {@link pileTop}.
 */
function crumpetPile(x: number, z: number): PictureActor[] {
  return [
    { model: 'book', colour: 'markerMint', size: PILE_BOOK, at: [x, 0, z] },
    { model: 'book', colour: 'markerLilac', size: PILE_BOOK, at: [x, PILE_STEP, z], turn: 15 },
    { model: 'book', colour: 'markerPink', size: PILE_BOOK, at: [x, PILE_STEP * 2, z], turn: -10 },
  ];
}

/** The top of {@link crumpetPile}: where the kitten's paws go. */
const pileTop = PILE_STEP * 3;

export const loudestShush: LibraryBook = {
  id: 'loudestShush',
  kind: 'chapter',
  title: 'The Loudest Shush',
  cover: 'trampolinePad',
  titlePicture: {
    cast: [
      ...crumpetPile(0.7, -0.2),
      { model: 'kitten', mood: 'frown', at: [0.7, pileTop, -0.2], turn: -30 },
      { model: 'trilla', mood: 'happy', at: [-0.9, 0, 0.3], turn: 15 },
    ],
    sky: 'buildingFloor',
    ground: 'woodLight',
    night: true,
    decor: ['notes'],
  },
  pages: [
    {
      text: 'Trilla the singing puff sang everywhere she went. She sang on the big wheel. She sang in the bath. She even sang in her sleep, which is very tricky indeed.',
      picture: {
        cast: [
          { model: 'trilla', mood: 'blink', at: [0, 0.25, 0.1] },
          { model: 'petBed', at: [0, -0.02, 0] },
        ],
        sky: 'skyNightBottom',
        ground: 'grassDark',
        night: true,
        decor: ['zzz', 'notes', 'moon'],
      },
    },
    {
      text: 'One afternoon, Trilla bounced into the library to find a book of songs. It was dim and cosy and as quiet as a whisper. Everybody was reading without a sound.',
      picture: {
        cast: [
          { model: 'bookcase', size: 0.8, at: [0.2, 0, -3.0] },
          { model: 'readingLamp', size: 1.2, at: [1.9, 0, -0.6] },
          { model: 'bunny', mood: 'blink', at: [0, 0, -0.1], turn: 15 },
          { model: 'openBook', colour: 'markerSky', size: 1.3, at: [0.05, 0, 0.6], turn: 10 },
          { model: 'mouse', mood: 'blink', at: [1.1, 0, -0.1], turn: -15 },
          { model: 'openBook', colour: 'markerLemon', size: 1.3, at: [1.05, 0, 0.6], turn: -10 },
          { model: 'trilla', mood: 'happy', at: [-1.3, 0.4, 0.3], turn: 25 },
        ],
        sky: 'buildingFloor',
        ground: 'woodLight',
        night: true,
      },
    },
    {
      text: 'On a pile of books slept Mrs Crumpet, the grumpy ginger library cat. The owl librarian was out, so Mrs Crumpet was in charge. She took it very seriously, with her eyes shut.',
      picture: {
        cast: [
          { model: 'libraryDesk', at: [-0.6, 0, -2.0] },
          ...crumpetPile(0.4, 0),
          { model: 'kitten', mood: 'blink', at: [0.4, pileTop, 0], turn: -10 },
        ],
        sky: 'buildingFloor',
        ground: 'woodLight',
        night: true,
        decor: ['zzz'],
      },
    },
    {
      text: 'Trilla found the song book and opened it. Out of Trilla popped a song, all by itself. ‘La la LAAA!’ Mrs Crumpet’s eyes snapped open. ‘SHHHHHH!’ she hissed, so loudly that every page fluttered.',
      picture: {
        cast: [
          ...crumpetPile(1.3, -0.3),
          { model: 'kitten', mood: 'frown', at: [1.3, pileTop, -0.3], turn: -35 },
          { model: 'trilla', mood: 'surprised', at: [-1.0, 0, 0.2], turn: 25 },
          { model: 'openBook', colour: 'markerLilac', at: [-0.4, 0, 0.9], turn: 20 },
          { model: 'loosePage', at: [-0.2, 0.6, 1.0], turn: 30 },
          { model: 'loosePage', at: [-0.7, 0.9, 0.7], turn: -25 },
        ],
        sky: 'buildingFloor',
        ground: 'woodLight',
        night: true,
        decor: ['notes', 'speed'],
      },
    },
    {
      text: 'Trilla tried humming instead. ‘Hmm-hmm-hmmm.’ ‘SHHHHHHHH!’ went Mrs Crumpet. A lamp wobbled and a mouse dropped his book. ‘I can hear you humming,’ she grumbled. ‘I can hear you THINKING about humming.’',
      picture: {
        cast: [
          { model: 'readingLamp', size: 1.2, at: [-1.8, 0, -1.0] },
          { model: 'trilla', mood: 'sad', at: [-0.6, 0, 0.2], turn: 25 },
          { model: 'kitten', mood: 'frown', at: [0.6, 0, 0.3], turn: -35 },
          { model: 'mouse', mood: 'surprised', at: [1.6, 0, -1.2], turn: -20 },
          { model: 'book', colour: 'markerMint', at: [1.45, 0, -0.6], turn: 30 },
        ],
        sky: 'buildingFloor',
        ground: 'woodLight',
        night: true,
        decor: ['notes', 'speed'],
      },
    },
    {
      text: 'So Trilla held her song in. She held it in until she puffed up round, then rounder, then the roundest puff there is. ‘HIC!’ A little note popped out. ‘HIC!’ And another!',
      picture: {
        cast: [
          ...crumpetPile(1.2, -0.8),
          { model: 'kitten', mood: 'frown', at: [1.2, pileTop, -0.8], turn: -40 },
          { model: 'trilla', mood: 'surprised', size: 1.3, at: [-0.4, 0, 0.3] },
        ],
        sky: 'buildingFloor',
        ground: 'woodLight',
        night: true,
        decor: ['notes'],
      },
    },
    {
      text: 'Mrs Crumpet stomped over, crosser than ever. She opened her mouth for her biggest shush yet, and out came an enormous YAWN. Aha, thought Trilla. Grumpy cats are often just sleepy cats.',
      picture: {
        cast: [
          { model: 'kitten', mood: 'surprised', at: [0.45, 0, 0.1], turn: -25 },
          { model: 'trilla', mood: 'happy', at: [-0.55, 0, 0.1], turn: 25 },
        ],
        sky: 'buildingFloor',
        ground: 'woodLight',
        night: true,
        decor: ['zzz'],
      },
    },
    {
      text: '‘No singing in my library!’ huffed Mrs Crumpet. ‘I’m not singing,’ said Trilla sweetly. ‘I’m lullabying. It’s much quieter.’ Mrs Crumpet frowned. She could not find a rule against that.',
      picture: {
        cast: [
          ...crumpetPile(0.5, -0.2),
          { model: 'kitten', mood: 'frown', at: [0.5, pileTop, -0.2], turn: -30 },
          { model: 'trilla', mood: 'happy', at: [-0.8, 0, 0.4], turn: 25 },
        ],
        sky: 'buildingFloor',
        ground: 'woodLight',
        night: true,
        decor: ['sparkles'],
      },
    },
    {
      text: 'So Trilla began her lullaby, as softly and slowly as she could. ‘Shhh…’ started Mrs Crumpet, but it turned into a yawn. ‘Sh…’ Another yawn. Her eyes went droopy, then droopier, then shut.',
      picture: {
        cast: [
          ...crumpetPile(0.5, -0.2),
          { model: 'kitten', mood: 'blink', at: [0.5, pileTop, -0.2], turn: -20 },
          { model: 'trilla', mood: 'blink', at: [-0.8, 0, 0.4], turn: 25 },
        ],
        sky: 'buildingFloor',
        ground: 'woodLight',
        night: true,
        decor: ['notes', 'zzz'],
      },
    },
    {
      text: 'Soon Mrs Crumpet was fast asleep, purring like a tractor. ‘PRRRRRRR!’ The bookshelves rattled. Trilla smiled and whispered, ‘Shhh, Mrs Crumpet!’ And every nap time after that, Trilla lullabied her to sleep.',
      picture: {
        cast: [
          { model: 'bookcase', size: 0.9, at: [0.2, 0, -2.2], turn: 4 },
          ...crumpetPile(0.6, -0.3),
          { model: 'kitten', mood: 'blink', at: [0.6, pileTop, -0.3], turn: -10 },
          { model: 'trilla', mood: 'happy', at: [-0.8, 0, 0.3], turn: 20 },
        ],
        sky: 'buildingFloor',
        ground: 'woodLight',
        night: true,
        decor: ['zzz', 'hearts'],
      },
    },
  ],
};
