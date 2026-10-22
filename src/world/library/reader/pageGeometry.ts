/**
 * **Where things go on a painted page** — the page canvas, its margins, the
 * picture box and the chapter page's layout numbers, in canvas pixels. The one
 * owner: `pageFaces.ts` paints with them, `pagePictures.ts` renders pictures at
 * the picture box's size, and `check:book-reader` measures every painted page
 * against them from outside. A leaf with no imports, so a Node check can read
 * it without loading three.js or a single model.
 */

/** The page canvas. 3:4, the shape of a page (`READER_PAGE_WIDTH` × `READER_PAGE_HEIGHT`). */
export const PAGE_CANVAS_WIDTH = 768;
export const PAGE_CANVAS_HEIGHT = 1024;

/** Width and height of a rendered picture, in pixels. 7:6 — the shape of the picture box on a page. */
export const PICTURE_WIDTH = 672;
export const PICTURE_HEIGHT = 576;

/** The page's margins: either side (the picture box's own), above the picture, below the words. */
export const PAGE_MARGIN_X = (PAGE_CANVAS_WIDTH - PICTURE_WIDTH) / 2;
export const PAGE_MARGIN_TOP = 56;
export const PAGE_MARGIN_BOTTOM = 52;

/** Between the picture and the words. */
export const PAGE_GAP = 34;

/** Where the paper's cover-coloured frame is drawn: inset from the edge, and its stroke's width. */
export const PAGE_FRAME_INSET = 22;
export const PAGE_FRAME_STROKE = 6;

/**
 * **The least a picture book's page (or any title page) draws its picture**,
 * against its full size.
 */
export const MIN_PICTURE_SCALE = 0.4;

/**
 * **The least a chapter page draws its picture.** Smaller than a picture
 * book's: on a chapter page the paragraph is the point, and on the smallest
 * phone held upright a forty-word page set in a wide fallback font needs the
 * room (measured: the drafts' longest pages wrap to 11 lines at the 375 x 667
 * floor in Verdana-wide type, which leaves 0.43 of the picture; 40 plain words
 * leave about 0.33). A smaller picture beats asking her to turn a phone that is
 * already upright. A chapter page that would need less still does not fit
 * (`pageFaces.ts`'s `chapterLayout`).
 */
export const CHAPTER_MIN_PICTURE_SCALE = 0.3;

/**
 * **A chapter page's paragraph**, against the floor: it starts this much
 * bigger and comes down to the floor before the picture gives way. A
 * picture book's one sentence starts at 1.55; a paragraph is many lines, and
 * every line it saves is picture kept.
 */
export const CHAPTER_DESIGN_SCALE = 1.2;

/**
 * A chapter page's leading, as a multiple of the font size: the picture books'
 * own 1.2. A looser 1.25 was tried and measured out: it cost a forty-word page
 * a whole line on a small phone held upright, and with a wide fallback font
 * that was the line that stopped the page fitting.
 */
export const CHAPTER_LINE_HEIGHT = 1.2;
