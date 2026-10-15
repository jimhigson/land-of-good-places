import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace, type WebGLRenderer } from 'three';
import { hexToCss, PALETTE } from '../../../core/palette';
import { Rng } from '../../../core/mathUtils';
import { BOOK_MOST_PAGES, type LibraryBook, type PagePicture, type PictureDecor } from '../books';
import { lookKey, PICTURE_HEIGHT, PICTURE_WIDTH, renderPicture, type ReaderLook, type RenderedPicture } from './pagePictures';
import { READER_WORDS } from './readerWords';

/**
 * **One canvas per page face: the paper, the picture and the sentence** (#717).
 *
 * Every face of every page the reader can show is painted here, into a single
 * canvas that becomes a single texture on a single surface. The picture
 * (`pagePictures.ts`, the park's own models rendered to a texture) and the
 * words are therefore one thing that cannot drift apart — the rule in
 * `art/models/CLAUDE.md`, applied to paper.
 *
 * ## The order of a book's faces
 *
 * {@link bookFaces} lays a book out as the sequence of faces a reader sees,
 * left page then right page, spread after spread. When the count would
 * otherwise be odd — every book with an odd number of pages, which today is
 * all twelve — a blank endpaper goes in **first**, the way a printed picture
 * book opens:
 *
 *     [ endpaper | title ] [ page 1 | page 2 ] … [ page 5 | The End ]
 *
 * so the title and "The End" are both right-hand pages, and the last spread is
 * always whole. With an even count there is no endpaper:
 *
 *     [ title | page 1 ] … [ page 4 | The End ]
 *
 * "The End" is the last face either way. `BookReader` hangs them on paper:
 * face 0 is the fixed left-hand page under everything, the last face the fixed
 * right-hand one, and every leaf between carries an odd face on its front and
 * the next even one on its back.
 *
 * ## How big the words are — the TEXT RULE, as rendered
 *
 * GAME_DESIGN.md: nothing may be smaller than the shared minimum, *"not
 * canvas-painted text on in-world signs"* — and a page is exactly that. A
 * canvas pixel is not a screen pixel, so the minimum is not a font size this
 * file can choose on its own: it depends on how tall the page is on screen.
 * The reader works that out from its camera and passes it in as
 * {@link FaceRequest.minFontPx}, in **canvas** pixels; nothing here is ever
 * drawn smaller. `check:book-reader` then measures the result the other way
 * round, off the built page in a real browser, without trusting this sum.
 *
 * ## A chapter book's page — a picture and a paragraph
 *
 * A picture book's page is one big sentence under one big picture. A chapter
 * book's (`LibraryBook.kind` `'chapter'`, Jim's *"~30 words per page"*) is a
 * paragraph of 20–40 words under its picture, so it is laid out by its own
 * rules ({@link chapterLayout}), still never under the floor:
 *
 * - the words start a little above the floor ({@link CHAPTER_DESIGN_SCALE})
 *   and come down to it before anything else gives;
 * - then the picture gives way, never the words — down to
 *   {@link MIN_PICTURE_SCALE} of its size, the same least picture a picture
 *   book's page keeps;
 * - left-aligned and ragged, the way a paragraph is set in a book, with a
 *   little more leading than a picture book's line ({@link CHAPTER_LINE_HEIGHT}).
 *
 * If a page still does not fit — a screen too short for a paragraph and a
 * picture at the floor, which is a phone held on its side — it is said so
 * ({@link chapterBookFits}), and `BookReader` asks her to turn the phone
 * upright rather than draw the words smaller or cut them off. Every painted
 * face reports where its words went ({@link PaintedWords}), so
 * `check:book-reader` can hold every page to its box from outside.
 */

/** The page canvas. 3:4, the shape of a page (`READER_PAGE_WIDTH` × `READER_PAGE_HEIGHT`). */
export const PAGE_CANVAS_WIDTH = 768;
export const PAGE_CANVAS_HEIGHT = 1024;

/** The words "The End", painted on every book's last page — `readerWords.ts`'s, walked by `check:brevity`. */
export const THE_END = READER_WORDS.theEnd;

/** The house font stack — `--lgp-font` in `style.css`, bold. */
const FONT_STACK = "'Baloo 2', 'Nunito', 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";

/** What one face is. */
export type FaceKind = 'title' | 'story' | 'end' | 'blank';

export interface PageFace {
  readonly kind: FaceKind;
  /** For a `story` face, which of the book's pages it is (0-based); -1 otherwise. */
  readonly page: number;
  /** Which side of the spread it is seen on — where its spine edge is. */
  readonly side: 'left' | 'right';
}

/** The faces of `book`, in reading order — see the file comment. Always an even count; "The End" always last. */
export function bookFaces(book: LibraryBook): PageFace[] {
  const kinds: { kind: FaceKind; page: number }[] = [{ kind: 'title', page: -1 }];
  book.pages.forEach((_, page) => kinds.push({ kind: 'story', page }));
  kinds.push({ kind: 'end', page: -1 });
  if (kinds.length % 2 === 1) kinds.unshift({ kind: 'blank', page: -1 });
  return kinds.map((face, index) => ({ ...face, side: index % 2 === 0 ? 'left' : 'right' }));
}

export interface FaceRequest {
  readonly book: LibraryBook;
  readonly faceIndex: number;
  readonly look: ReaderLook;
  /** The smallest font, in canvas pixels, that still meets the TEXT rule on screen. */
  readonly minFontPx: number;
}

/** A rectangle on the page canvas, in canvas pixels from its top left. */
export interface CanvasRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * **Where a face's words went, as painted** — what `check:book-reader`
 * re-measures from outside: it re-measures every line in {@link font} with
 * its own canvas, holds {@link block} inside {@link area}, and scans the
 * painted pixels for ink outside them.
 */
export interface PaintedWords {
  /** The CSS font the lines were drawn in. */
  readonly font: string;
  /** From one line's middle to the next, in canvas pixels. */
  readonly lineHeight: number;
  readonly align: 'center' | 'left';
  /** Where the words had to stay: inside the margins and clear of the picture. */
  readonly area: CanvasRect;
  /** Where they are: the widest line's extent, the first line's top to the last line's bottom. */
  readonly block: CanvasRect;
}

/** A painted face, and what was measured while painting it. */
export interface PaintedFace {
  readonly face: PageFace;
  readonly texture: CanvasTexture;
  /** The font size the face's words were drawn at, in canvas pixels. 0 for a face with no words. */
  readonly fontPx: number;
  /** The canvas's height in pixels — with `fontPx`, what an on-screen size is measured from. */
  readonly canvasHeight: number;
  /** The words as wrapped onto the page. */
  readonly lines: readonly string[];
  /** The picture's model coverage (see `RenderedPicture.coverage`), or null for a face with none. */
  readonly coverage: number | null;
  /** Where the words went, or null for a face with none. */
  readonly words: PaintedWords | null;
  /** The picture's box, or null for a face with none. */
  readonly pictureBox: CanvasRect | null;
  /** How big the picture was drawn against its full size (1), or null for a face with none. */
  readonly pictureScale: number | null;
}

/**
 * How many rendered pictures to keep: one book's worth — a title and the most
 * pages any book has (`BOOK_MOST_PAGES`: a chapter book's ten). Enough to
 * repaint the open book for a new screen size without rendering again; the
 * reader drops them all when the book closes.
 */
const PICTURE_CACHE_SIZE = 1 + BOOK_MOST_PAGES;

/** Line height, as a multiple of the font size. */
const LINE_HEIGHT = 1.2;

/**
 * **A chapter page's paragraph**, against the floor: it starts this much
 * bigger and comes down to the floor before the picture gives way. A
 * picture book's one sentence starts at 1.55; a paragraph is many lines, and
 * every line it saves is picture kept.
 */
export const CHAPTER_DESIGN_SCALE = 1.2;

/** A chapter page's leading: a touch more air than a picture book's single line, for a paragraph a child follows line to line. */
export const CHAPTER_LINE_HEIGHT = 1.25;

/**
 * **The least a page's picture is ever drawn**, against its full size: below
 * this a picture stops reading as one. A picture book's page and title keep
 * it; a chapter page that would need less is a page that does not fit
 * ({@link chapterLayout}).
 */
export const MIN_PICTURE_SCALE = 0.4;

/** The page's margins and the gap between picture and words, in canvas pixels. */
export const PAGE_MARGIN_X = (PAGE_CANVAS_WIDTH - PICTURE_WIDTH) / 2;
export const PAGE_MARGIN_TOP = 56;
export const PAGE_MARGIN_BOTTOM = 52;
const MARGIN_X = PAGE_MARGIN_X;
const MARGIN_TOP = PAGE_MARGIN_TOP;
const MARGIN_BOTTOM = PAGE_MARGIN_BOTTOM;
const GAP = 34;

/** Where the paper's cover-coloured frame is drawn: inset from the edge, and its stroke's width. */
export const PAGE_FRAME_INSET = 22;
export const PAGE_FRAME_STROKE = 6;

/**
 * Paints page faces, remembering the expensive part — the rendered pictures —
 * between books and between openings.
 */
export class PageArtist {
  private readonly renderer: WebGLRenderer;
  /** Rendered pictures by `book:page:look`, oldest first (a tiny LRU). */
  private readonly pictures = new Map<string, RenderedPicture>();

  constructor(renderer: WebGLRenderer) {
    this.renderer = renderer;
  }

  /** Paints one face into a new texture. The caller owns (and disposes) the texture. */
  paint(request: FaceRequest): PaintedFace {
    const { book, faceIndex } = request;
    const faces = bookFaces(book);
    const face = faces[faceIndex];
    if (!face) throw new Error(`PageArtist: ${book.id} has no face ${faceIndex} (it has ${faces.length}).`);

    const canvas = document.createElement('canvas');
    canvas.width = PAGE_CANVAS_WIDTH;
    canvas.height = PAGE_CANVAS_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('PageArtist: no 2D context to paint a page into.');

    paintPaper(ctx, face.side, PALETTE[book.cover]);
    let painted: Painted = { fontPx: 0, lines: [], words: null, pictureBox: null, pictureScale: null };
    let coverage: number | null = null;

    if (face.kind === 'story') {
      const page = book.pages[face.page];
      if (!page) throw new Error(`PageArtist: ${book.id} has no page ${face.page}.`);
      const picture = this.picture(book, face.page, page.picture, request.look);
      coverage = picture.coverage;
      const seed = `${book.id}#${face.page}`;
      painted =
        book.kind === 'chapter'
          ? paintChapter(ctx, page.text, page.picture, picture, request.minFontPx, seed)
          : paintStory(ctx, page.text, page.picture, picture, request.minFontPx, seed);
    } else if (face.kind === 'title') {
      const picture = this.picture(book, -1, book.titlePicture, request.look);
      coverage = picture.coverage;
      painted = paintTitle(ctx, book.title, book.titlePicture, picture, request.minFontPx, book.id);
    } else if (face.kind === 'end') {
      painted = paintEnd(ctx, request.minFontPx, PALETTE[book.cover]);
    } else {
      paintEndpaper(ctx, PALETTE[book.cover]);
    }
    const { fontPx, lines, words, pictureBox: drawnPicture, pictureScale } = painted;

    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 8;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    texture.name = `book:${book.id}:face${faceIndex}`;
    return { face, texture, fontPx, canvasHeight: PAGE_CANVAS_HEIGHT, lines, coverage, words, pictureBox: drawnPicture, pictureScale };
  }

  /** Drops every cached picture — the reader does, when a book closes. */
  clear(): void {
    this.pictures.clear();
  }

  private picture(book: LibraryBook, page: number, picture: PagePicture, look: ReaderLook): RenderedPicture {
    const key = `${book.id}:${page}:${lookKey(look)}`;
    const cached = this.pictures.get(key);
    if (cached) {
      // Most recently used goes to the back.
      this.pictures.delete(key);
      this.pictures.set(key, cached);
      return cached;
    }
    const rendered = renderPicture(this.renderer, picture, look);
    this.pictures.set(key, rendered);
    while (this.pictures.size > PICTURE_CACHE_SIZE) {
      const oldest = this.pictures.keys().next().value;
      if (oldest === undefined) break;
      this.pictures.delete(oldest);
    }
    return rendered;
  }
}

// ------------------------------------------------------------------ painting

/** What painting one face's words (and picture) produced. */
interface Painted {
  readonly fontPx: number;
  readonly lines: string[];
  readonly words: PaintedWords | null;
  readonly pictureBox: CanvasRect | null;
  readonly pictureScale: number | null;
}

function font(px: number): string {
  return `700 ${Math.round(px)}px ${FONT_STACK}`;
}

/** Mixes two hex colours, `t` of the way from `a` to `b`. */
function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/** `#rrggbb` plus a two-digit alpha. */
function cssAlpha(hex: number, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hexToCss(hex)}${a}`;
}

/** Cream paper, a soft shadow in the gutter, and a thin border in the cover colour. */
function paintPaper(ctx: CanvasRenderingContext2D, side: 'left' | 'right', cover: number): void {
  const w = PAGE_CANVAS_WIDTH;
  const h = PAGE_CANVAS_HEIGHT;
  ctx.fillStyle = hexToCss(PALETTE.signBoard);
  ctx.fillRect(0, 0, w, h);
  // The gutter: paper curving down into the spine reads as a soft shadow.
  const spineX = side === 'right' ? 0 : w;
  const gutter = ctx.createLinearGradient(spineX, 0, side === 'right' ? 90 : w - 90, 0);
  gutter.addColorStop(0, cssAlpha(PALETTE.ink, 0.16));
  gutter.addColorStop(1, cssAlpha(PALETTE.ink, 0));
  ctx.fillStyle = gutter;
  ctx.fillRect(side === 'right' ? 0 : w - 90, 0, 90, h);
  // A hairline frame in the cover's colour, the way a printed book has one.
  ctx.strokeStyle = cssAlpha(cover, 0.45);
  ctx.lineWidth = PAGE_FRAME_STROKE;
  roundRect(ctx, PAGE_FRAME_INSET, PAGE_FRAME_INSET, w - PAGE_FRAME_INSET * 2, h - PAGE_FRAME_INSET * 2, 26);
  ctx.stroke();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Greedy word wrap at `maxWidth`, in the current font. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * The biggest size from `design` down to `floor` at which `text` wraps into
 * `maxHeight`. If even `floor` does not fit, `floor` — never smaller — and
 * the caller makes room by shrinking the picture instead.
 */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  design: number,
  floor: number,
  maxWidth: number,
  maxHeight: number,
  lineHeight = LINE_HEIGHT,
): { px: number; lines: string[] } {
  const top = Math.max(design, floor);
  for (let px = top; px >= floor; px = Math.max(floor, px * 0.94)) {
    ctx.font = font(px);
    const lines = wrap(ctx, text, maxWidth);
    if (lines.length * px * lineHeight <= maxHeight) return { px, lines };
    if (px === floor) break;
  }
  ctx.font = font(floor);
  return { px: floor, lines: wrap(ctx, text, maxWidth) };
}

/** The picture box at `scale` of full size, centred under the top margin. */
function pictureBox(scale: number): { x: number; y: number; w: number; h: number } {
  const w = PICTURE_WIDTH * scale;
  const h = PICTURE_HEIGHT * scale;
  return { x: (PAGE_CANVAS_WIDTH - w) / 2, y: MARGIN_TOP, w, h };
}

function rectOf(box: { x: number; y: number; w: number; h: number }): CanvasRect {
  return { left: box.x, top: box.y, right: box.x + box.w, bottom: box.y + box.h };
}

/** Lays out a picture above a block of words, the words as big as they comfortably go. */
function paintStory(
  ctx: CanvasRenderingContext2D,
  text: string,
  spec: PagePicture,
  picture: RenderedPicture,
  minFontPx: number,
  seed: string,
): Painted {
  const maxWidth = PAGE_CANVAS_WIDTH - MARGIN_X * 2;
  const textRoom = PAGE_CANVAS_HEIGHT - MARGIN_TOP - PICTURE_HEIGHT - GAP - MARGIN_BOTTOM;
  // A picture book's words are big: half as big again as the floor, the way
  // the stylesheet's `--lgp-text-xl` is to `--lgp-text-min`.
  let fit = fitText(ctx, text, minFontPx * 1.55, minFontPx, maxWidth, textRoom);
  let scale = 1;
  const needed = fit.lines.length * fit.px * LINE_HEIGHT;
  if (needed > textRoom) {
    // The floor did not fit under a full-size picture: the picture gives way,
    // never the words.
    scale = Math.max(MIN_PICTURE_SCALE, (PAGE_CANVAS_HEIGHT - MARGIN_TOP - GAP - MARGIN_BOTTOM - needed) / PICTURE_HEIGHT);
    fit = fitText(ctx, text, fit.px, minFontPx, maxWidth, PAGE_CANVAS_HEIGHT - MARGIN_TOP - PICTURE_HEIGHT * scale - GAP - MARGIN_BOTTOM);
  }
  const box = pictureBox(scale);
  paintPicture(ctx, box, spec, picture, seed);
  const blockTop = box.y + box.h + GAP;
  const blockHeight = PAGE_CANVAS_HEIGHT - MARGIN_BOTTOM - blockTop;
  const block = paintLines(ctx, fit.lines, fit.px, blockTop, blockHeight, PALETTE.ink);
  return {
    fontPx: fit.px,
    lines: fit.lines,
    words: {
      font: font(fit.px),
      lineHeight: fit.px * LINE_HEIGHT,
      align: 'center',
      area: { left: MARGIN_X, top: blockTop, right: PAGE_CANVAS_WIDTH - MARGIN_X, bottom: PAGE_CANVAS_HEIGHT - MARGIN_BOTTOM },
      block,
    },
    pictureBox: rectOf(box),
    pictureScale: scale,
  };
}

/**
 * **How a chapter page lays out at this floor** — the one owner of it, asked
 * by the painter ({@link paintChapter}) and by the reader before it paints
 * ({@link chapterBookFits}), so the two can never disagree about whether a
 * page fits.
 *
 * 1. Under a full-size picture, the words from {@link CHAPTER_DESIGN_SCALE}
 *    times the floor down to the floor, whole canvas pixels.
 * 2. If even the floor does not fit there, the picture gives way: as big as
 *    the words at the floor leave room for.
 * 3. If that is under {@link MIN_PICTURE_SCALE}, the page does not fit
 *    (`fits` false): painted anyway at the floor with the least picture, its
 *    words run off the bottom — which `check:book-reader` sees, and which the
 *    reader never shows her (it asks her to turn the phone upright instead).
 */
export function chapterLayout(
  ctx: CanvasRenderingContext2D,
  text: string,
  minFontPx: number,
): { px: number; lines: string[]; scale: number; fits: boolean } {
  const maxWidth = PAGE_CANVAS_WIDTH - MARGIN_X * 2;
  const floor = Math.ceil(minFontPx);
  const design = Math.max(floor, Math.round(minFontPx * CHAPTER_DESIGN_SCALE));
  const fullRoom = PAGE_CANVAS_HEIGHT - MARGIN_TOP - PICTURE_HEIGHT - GAP - MARGIN_BOTTOM;
  for (let px = design; px >= floor; px -= 1) {
    ctx.font = font(px);
    const lines = wrap(ctx, text, maxWidth);
    if (lines.length * px * CHAPTER_LINE_HEIGHT <= fullRoom) return { px, lines, scale: 1, fits: true };
  }
  ctx.font = font(floor);
  const lines = wrap(ctx, text, maxWidth);
  const needed = lines.length * floor * CHAPTER_LINE_HEIGHT;
  const scale = Math.min(1, (PAGE_CANVAS_HEIGHT - MARGIN_TOP - GAP - MARGIN_BOTTOM - needed) / PICTURE_HEIGHT);
  if (scale >= MIN_PICTURE_SCALE) return { px: floor, lines, scale, fits: true };
  return { px: floor, lines, scale: MIN_PICTURE_SCALE, fits: false };
}

let measuring: CanvasRenderingContext2D | null = null;

/**
 * True when every page of chapter book `book` lays out at this floor
 * ({@link chapterLayout}) — what `BookReader` asks on every layout before it
 * lets a chapter book be read. Always true for a picture book (one short
 * sentence fits any page the reader draws).
 */
export function chapterBookFits(book: LibraryBook, minFontPx: number): boolean {
  if (book.kind !== 'chapter') return true;
  if (!measuring) measuring = document.createElement('canvas').getContext('2d');
  const ctx = measuring;
  if (!ctx) return true;
  return book.pages.every((page) => chapterLayout(ctx, page.text, minFontPx).fits);
}

/**
 * A chapter page: its picture over a left-aligned paragraph, laid out by
 * {@link chapterLayout}. The paragraph sits in the middle of the room under
 * the picture when it fits; when it does not, it starts right under the
 * picture and runs on down, so what does not fit is plainly what is missing.
 */
function paintChapter(
  ctx: CanvasRenderingContext2D,
  text: string,
  spec: PagePicture,
  picture: RenderedPicture,
  minFontPx: number,
  seed: string,
): Painted {
  const layout = chapterLayout(ctx, text, minFontPx);
  const box = pictureBox(layout.scale);
  paintPicture(ctx, box, spec, picture, seed);
  const lineHeight = layout.px * CHAPTER_LINE_HEIGHT;
  const area: CanvasRect = { left: MARGIN_X, top: box.y + box.h + GAP, right: PAGE_CANVAS_WIDTH - MARGIN_X, bottom: PAGE_CANVAS_HEIGHT - MARGIN_BOTTOM };
  const height = layout.lines.length * lineHeight;
  const top = Math.max(area.top, area.top + (area.bottom - area.top - height) / 2);
  const block = paintLines(ctx, layout.lines, layout.px, top, height, PALETTE.ink, { align: 'left', lineHeight: CHAPTER_LINE_HEIGHT });
  return {
    fontPx: layout.px,
    lines: layout.lines,
    words: { font: font(layout.px), lineHeight, align: 'left', area, block },
    pictureBox: rectOf(box),
    pictureScale: layout.scale,
  };
}

/** The title page: the title, big, over its picture. */
function paintTitle(
  ctx: CanvasRenderingContext2D,
  title: string,
  spec: PagePicture,
  picture: RenderedPicture,
  minFontPx: number,
  seed: string,
): Painted {
  const maxWidth = PAGE_CANVAS_WIDTH - MARGIN_X * 2;
  const titleRoom = 280;
  const fit = fitText(ctx, title, minFontPx * 2.2, minFontPx, maxWidth, titleRoom);
  const titleHeight = fit.lines.length * fit.px * LINE_HEIGHT;
  const block = paintLines(ctx, fit.lines, fit.px, MARGIN_TOP + 20, titleHeight, PALETTE.ink);
  const top = MARGIN_TOP + 20 + titleHeight + GAP;
  const scale = Math.max(MIN_PICTURE_SCALE, Math.min(1, (PAGE_CANVAS_HEIGHT - MARGIN_BOTTOM - top) / PICTURE_HEIGHT));
  const box = { ...pictureBox(scale), y: top };
  paintPicture(ctx, box, spec, picture, seed);
  return {
    fontPx: fit.px,
    lines: fit.lines,
    words: {
      font: font(fit.px),
      lineHeight: fit.px * LINE_HEIGHT,
      align: 'center',
      area: { left: MARGIN_X, top: MARGIN_TOP, right: PAGE_CANVAS_WIDTH - MARGIN_X, bottom: top - GAP },
      block,
    },
    pictureBox: rectOf(box),
    pictureScale: scale,
  };
}

/** "The End", in the middle, with a little flourish of hearts. */
function paintEnd(ctx: CanvasRenderingContext2D, minFontPx: number, cover: number): Painted {
  const px = Math.max(minFontPx * 2.2, minFontPx);
  ctx.font = font(px);
  const lines = [THE_END];
  const blockHeight = px * LINE_HEIGHT;
  const top = (PAGE_CANVAS_HEIGHT - blockHeight) / 2 - 40;
  const block = paintLines(ctx, lines, px, top, blockHeight, PALETTE.ink);
  const rng = new Rng(0x7e4d);
  for (let i = 0; i < 5; i += 1) {
    const x = PAGE_CANVAS_WIDTH / 2 + (i - 2) * 92;
    const y = top + blockHeight + 90 + (i % 2) * 22;
    drawHeart(ctx, x, y, 26 + rng.range(-4, 6), i % 2 === 0 ? PALETTE.markerPink : cover);
  }
  return {
    fontPx: px,
    lines,
    words: {
      font: font(px),
      lineHeight: px * LINE_HEIGHT,
      align: 'center',
      area: { left: MARGIN_X, top: MARGIN_TOP, right: PAGE_CANVAS_WIDTH - MARGIN_X, bottom: PAGE_CANVAS_HEIGHT - MARGIN_BOTTOM },
      block,
    },
    pictureBox: null,
    pictureScale: null,
  };
}

/** A blank endpaper: soft spots in the cover colour. */
function paintEndpaper(ctx: CanvasRenderingContext2D, cover: number): void {
  ctx.fillStyle = cssAlpha(cover, 0.18);
  for (let y = 80; y < PAGE_CANVAS_HEIGHT - 60; y += 88) {
    for (let x = 80 + ((y / 88) % 2) * 44; x < PAGE_CANVAS_WIDTH - 60; x += 88) {
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * Lines vertically centred in their block — centred across the page (a
 * picture book's sentence, a title, "The End") or set from the left margin (a
 * chapter page's paragraph). Returns the block as painted: the widest line's
 * measured extent, the first line's top to the last line's bottom.
 */
function paintLines(
  ctx: CanvasRenderingContext2D,
  lines: readonly string[],
  px: number,
  top: number,
  height: number,
  colour: number,
  options: { readonly align?: 'center' | 'left'; readonly lineHeight?: number } = {},
): CanvasRect {
  const align = options.align ?? 'center';
  ctx.font = font(px);
  ctx.fillStyle = hexToCss(colour);
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  const lineHeight = px * (options.lineHeight ?? LINE_HEIGHT);
  const first = top + (height - lines.length * lineHeight) / 2 + lineHeight / 2;
  const x = align === 'left' ? MARGIN_X : PAGE_CANVAS_WIDTH / 2;
  let widest = 0;
  lines.forEach((line, index) => {
    ctx.fillText(line, x, first + index * lineHeight);
    widest = Math.max(widest, ctx.measureText(line).width);
  });
  const blockTop = first - lineHeight / 2;
  return {
    left: align === 'left' ? x : x - widest / 2,
    top: blockTop,
    right: align === 'left' ? x + widest : x + widest / 2,
    bottom: blockTop + lines.length * lineHeight,
  };
}

/** Behind the models. */
const BACK_DECOR: ReadonlySet<PictureDecor> = new Set(['sun', 'moon', 'stars', 'clouds', 'speed']);

/** The picture box: backdrop, back decor, the rendered models, front decor, a frame. */
function paintPicture(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  spec: PagePicture,
  picture: RenderedPicture,
  seed: string,
): void {
  const radius = 40;
  ctx.save();
  roundRect(ctx, box.x, box.y, box.w, box.h, radius);
  ctx.clip();
  const sky = PALETTE[spec.sky];
  const backdrop = ctx.createLinearGradient(0, box.y, 0, box.y + box.h);
  backdrop.addColorStop(0, hexToCss(sky));
  backdrop.addColorStop(1, hexToCss(mix(sky, spec.night ? PALETTE.flowerViolet : PALETTE.signBoard, 0.5)));
  ctx.fillStyle = backdrop;
  ctx.fillRect(box.x, box.y, box.w, box.h);

  const rng = new Rng(hashString(seed));
  const decor = spec.decor ?? [];
  for (const item of decor) if (BACK_DECOR.has(item)) paintDecor(ctx, item, box, rng, spec);
  ctx.drawImage(picture.canvas, box.x, box.y, box.w, box.h);
  for (const item of decor) if (!BACK_DECOR.has(item)) paintDecor(ctx, item, box, rng, spec);
  ctx.restore();

  ctx.strokeStyle = cssAlpha(PALETTE.ink, 0.55);
  ctx.lineWidth = 7;
  roundRect(ctx, box.x, box.y, box.w, box.h, radius);
  ctx.stroke();
}

/** A small stable hash, so a page's decor lands in the same place every time. */
function hashString(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function paintDecor(
  ctx: CanvasRenderingContext2D,
  item: PictureDecor,
  box: { x: number; y: number; w: number; h: number },
  rng: Rng,
  spec: PagePicture,
): void {
  const { x, y, w, h } = box;
  const u = w / PICTURE_WIDTH;
  switch (item) {
    case 'sun': {
      const cx = x + w * 0.84;
      const cy = y + h * 0.17;
      ctx.fillStyle = hexToCss(PALETTE.flowerYellow);
      ctx.strokeStyle = hexToCss(PALETTE.flowerYellow);
      ctx.lineWidth = 9 * u;
      ctx.lineCap = 'round';
      for (let i = 0; i < 10; i += 1) {
        const a = (i / 10) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * 62 * u, cy + Math.sin(a) * 62 * u);
        ctx.lineTo(cx + Math.cos(a) * 84 * u, cy + Math.sin(a) * 84 * u);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, 48 * u, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'moon': {
      const cx = x + w * 0.82;
      const cy = y + h * 0.2;
      ctx.fillStyle = hexToCss(PALETTE.moon);
      ctx.beginPath();
      ctx.arc(cx, cy, 52 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hexToCss(PALETTE[spec.sky]);
      ctx.beginPath();
      ctx.arc(cx + 24 * u, cy - 14 * u, 44 * u, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'stars':
      for (let i = 0; i < 16; i += 1) {
        drawStar(ctx, x + rng.range(0.05, 0.95) * w, y + rng.range(0.05, 0.55) * h, rng.range(7, 14) * u, PALETTE.flowerYellow);
      }
      break;
    case 'clouds':
      for (let i = 0; i < 3; i += 1) {
        drawCloud(ctx, x + rng.range(0.1, 0.9) * w, y + rng.range(0.1, 0.4) * h, rng.range(26, 40) * u);
      }
      break;
    case 'speed':
      ctx.strokeStyle = cssAlpha(PALETTE.signBoard, 0.8);
      ctx.lineCap = 'round';
      for (let i = 0; i < 9; i += 1) {
        const ly = y + rng.range(0.15, 0.85) * h;
        const lx = x + rng.range(0.02, 0.5) * w;
        ctx.lineWidth = rng.range(5, 10) * u;
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(lx + rng.range(90, 180) * u, ly);
        ctx.stroke();
      }
      break;
    case 'fireflies':
      for (let i = 0; i < 18; i += 1) {
        const fx = x + rng.range(0.05, 0.95) * w;
        const fy = y + rng.range(0.08, 0.8) * h;
        const r = rng.range(16, 28) * u;
        const glow = ctx.createRadialGradient(fx, fy, 0, fx, fy, r);
        glow.addColorStop(0, cssAlpha(PALETTE.buildingWindowWarm, 1));
        glow.addColorStop(0.25, cssAlpha(PALETTE.fairyWarm, 0.85));
        glow.addColorStop(1, cssAlpha(PALETTE.fairyWarm, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(fx, fy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'hearts':
      for (let i = 0; i < 5; i += 1) {
        drawHeart(
          ctx,
          x + rng.range(0.08, 0.92) * w,
          y + rng.range(0.08, 0.45) * h,
          rng.range(16, 26) * u,
          i % 2 === 0 ? PALETTE.markerPink : PALETTE.blossomPink,
        );
      }
      break;
    case 'sparkles':
      for (let i = 0; i < 7; i += 1) {
        drawSparkle(ctx, x + rng.range(0.06, 0.94) * w, y + rng.range(0.06, 0.6) * h, rng.range(12, 22) * u);
      }
      break;
    case 'zzz': {
      ctx.strokeStyle = hexToCss(PALETTE.fairyBlue);
      ctx.lineWidth = 8 * u;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      const sizes = [22, 30, 40];
      sizes.forEach((size, i) => {
        const zx = x + w * (0.66 + i * 0.09);
        const zy = y + h * (0.42 - i * 0.12);
        const s = size * u;
        ctx.beginPath();
        ctx.moveTo(zx - s / 2, zy - s / 2);
        ctx.lineTo(zx + s / 2, zy - s / 2);
        ctx.lineTo(zx - s / 2, zy + s / 2);
        ctx.lineTo(zx + s / 2, zy + s / 2);
        ctx.stroke();
      });
      break;
    }
    case 'splash':
      for (let i = 0; i < 6; i += 1) {
        drawDrop(ctx, x + rng.range(0.1, 0.9) * w, y + rng.range(0.6, 0.9) * h, rng.range(10, 16) * u);
      }
      break;
    case 'notes':
      for (let i = 0; i < 4; i += 1) {
        drawNote(ctx, x + rng.range(0.08, 0.92) * w, y + rng.range(0.1, 0.4) * h, rng.range(16, 22) * u);
      }
      break;
  }
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, colour: number): void {
  ctx.fillStyle = hexToCss(colour);
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    const px = cx + Math.cos(a) * rr;
    const py = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

function drawCloud(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.fillStyle = cssAlpha(PALETTE.blossomWhite, 0.95);
  for (const [dx, dy, s] of [
    [-1.1, 0.2, 0.75],
    [0, 0, 1],
    [1.05, 0.25, 0.7],
    [0.4, 0.45, 0.65],
    [-0.5, 0.45, 0.6],
  ] as const) {
    ctx.beginPath();
    ctx.arc(cx + dx * r, cy + dy * r, r * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHeart(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, colour: number): void {
  ctx.fillStyle = hexToCss(colour);
  ctx.beginPath();
  ctx.moveTo(cx, cy + r * 0.9);
  ctx.bezierCurveTo(cx - r * 1.6, cy - r * 0.2, cx - r * 0.6, cy - r * 1.3, cx, cy - r * 0.45);
  ctx.bezierCurveTo(cx + r * 0.6, cy - r * 1.3, cx + r * 1.6, cy - r * 0.2, cx, cy + r * 0.9);
  ctx.fill();
}

function drawSparkle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.fillStyle = hexToCss(PALETTE.buildingWindowWarm);
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.quadraticCurveTo(cx, cy, cx + r, cy);
  ctx.quadraticCurveTo(cx, cy, cx, cy + r);
  ctx.quadraticCurveTo(cx, cy, cx - r, cy);
  ctx.quadraticCurveTo(cx, cy, cx, cy - r);
  ctx.fill();
}

function drawDrop(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.fillStyle = hexToCss(PALETTE.waterFoam);
  ctx.strokeStyle = hexToCss(PALETTE.waterDeep);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 1.6);
  ctx.quadraticCurveTo(cx + r, cy, cx, cy + r);
  ctx.quadraticCurveTo(cx - r, cy, cx, cy - r * 1.6);
  ctx.fill();
  ctx.stroke();
}

function drawNote(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.fillStyle = hexToCss(PALETTE.ink);
  ctx.strokeStyle = hexToCss(PALETTE.ink);
  ctx.lineWidth = r * 0.28;
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 1.4, r * 0.62, r * 0.48, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.5, cy + r * 1.3);
  ctx.lineTo(cx + r * 0.5, cy - r * 0.6);
  ctx.quadraticCurveTo(cx + r * 1.3, cy - r * 0.2, cx + r * 1.2, cy + r * 0.5);
  ctx.stroke();
}
