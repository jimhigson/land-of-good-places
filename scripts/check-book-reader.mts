/**
 * **`check:book-reader` — the library's picture books, in a real browser** (#717).
 *
 * ```
 * pnpm run check:served-book-reader                 # serves the game itself (the gate's form)
 * CHECK_BOOK_READER_URL=http://127.0.0.1:5471 pnpm run check:book-reader   # against your own server
 * ```
 *
 * The reader is three.js — a book of curling paper meshes whose pictures are
 * the park's own models rendered to textures — so nothing short of a running
 * page can say whether it works. This drives the **real `/book?id=` deep link**
 * in Chromium and asks, off the built page and never off the reader's own
 * arithmetic:
 *
 * 1. **It opens, as a mode.** `/book?id=` lands with the reader showing the
 *    book asked for, the park paused under it (`frameContext.dt` is zero) and
 *    the HUD's menu off the screen (`.hud-menu` is `display: none`, the same
 *    mechanism `check:hud-during-rides` measures for rides).
 * 2. **A tap turns the page.** A real click on the page button over the
 *    right-hand page, and the spread index must advance by exactly one when
 *    the turn finishes.
 * 3. **The words meet the TEXT RULE as rendered.** For every painted face, the
 *    page's height on screen is measured by projecting the face's own mesh
 *    vertices through the reader's camera; the face's font size in canvas
 *    pixels, scaled by that height over the canvas's, is its size on screen in
 *    CSS pixels, and it must be at least the document's root font size — the
 *    one shared minimum (`--lgp-text-min` is `1rem`). At three window sizes:
 *    a laptop, a landscape phone and a portrait phone.
 * 4. **The buttons are where the pages are, and clear of the ✕.** Each page
 *    button must cover its page's projected rectangle (that is where the
 *    HIGHLIGHT RULE's rainbow is drawn), and neither page may sit under the
 *    close button.
 * 5. **All twelve books resolve.** Each is opened in turn and every face
 *    painted: 4–6 pages, an even number of faces, every texture a real canvas,
 *    every picture's model coverage — read off the rendered *pixels* — above
 *    nothing, and every face with words at or above the floor.
 * 6. **Reading to the end files a bookmark, and the bookmark reopens it.** One
 *    book is turned to its last page, the Cute-o-dex is opened, its bookmark
 *    must be there and pressable, and pressing it must open that book again.
 * 7. **Escape closes it** and gives the park and the menu back.
 *
 * It does **not** judge whether the pictures look right — a model can cover
 * the picture and still be the wrong model, badly framed. That is visual QA,
 * on the screenshots this writes (`CHECK_BOOK_READER_SHOTS`, default
 * `/tmp/check-book-reader`), and it says so on every run.
 */
import { mkdirSync } from 'node:fs';
import { chromium, type Page } from 'playwright-core';
import { BOOKS, BOOK_MAX_PAGES, BOOK_MIN_PAGES } from '../src/world/library/books.ts';
import { CANONICAL_PARK_SEED } from '../src/world/parkSeedPool.ts';

const BASE = (process.env.CHECK_BOOK_READER_URL ?? process.env.CHECK_DEEP_LINKS_URL ?? 'http://127.0.0.1:5173').replace(
  /\/$/,
  '',
);
const SEED = Number(process.env.CHECK_BOOK_READER_SEED ?? CANONICAL_PARK_SEED);
const SHOTS = process.env.CHECK_BOOK_READER_SHOTS ?? '/tmp/check-book-reader';
/** Far past the slowest boot measured; this check is about the reader, not the machine's speed. */
const BOOT_TIMEOUT_MS = 240_000;
/** Painting a whole book is a render and a readback a face, one face a frame. */
const PAINT_TIMEOUT_MS = 120_000;
/** A turn is `TURN_SECONDS` of game time; a slow headless frame rate stretches that. */
const TURN_TIMEOUT_MS = 60_000;
/** Below this fraction of its pixels covered, a picture drew no model. */
const MIN_COVERAGE = 0.02;

/** The book the deep link opens, and the one read to the end. */
const FIRST = BOOKS[0]?.id ?? '';
const READ_THROUGH = BOOKS[3]?.id ?? FIRST;

const VIEWPORTS = [
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'phone-landscape', width: 812, height: 375 },
  { name: 'phone-portrait', width: 375, height: 667 },
] as const;

const fouls: string[] = [];
const said: string[] = [];
function assert(ok: boolean, what: string, detail: string): void {
  said.push(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`);
  if (!ok) fouls.push(`${what}: ${detail}`);
}

interface FaceMeasure {
  readonly index: number;
  readonly kind: string;
  readonly fontPx: number;
  readonly onScreenPx: number;
  readonly coverage: number | null;
  readonly canvas: boolean;
}

/**
 * Every painted face of the open book, measured from the outside: its mesh's
 * top and bottom edges projected through the reader's camera.
 */
async function measureFaces(page: Page): Promise<{ rootPx: number; faces: FaceMeasure[] }> {
  return page.evaluate(() => {
    const r = (window as unknown as { game: any }).game.bookReader;
    const camera = r.camera;
    const V = camera.position.constructor;
    const rootPx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    const screenHeight = (mesh: any): number => {
      mesh.updateMatrixWorld(true);
      const position = mesh.geometry.getAttribute('position');
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < position.count; i += 1) {
        minY = Math.min(minY, position.getY(i));
        maxY = Math.max(maxY, position.getY(i));
      }
      const top = new V();
      const bottom = new V();
      let nTop = 0;
      let nBottom = 0;
      const v = new V();
      for (let i = 0; i < position.count; i += 1) {
        const y = position.getY(i);
        v.set(position.getX(i), y, position.getZ(i)).applyMatrix4(mesh.matrixWorld);
        if (Math.abs(y - maxY) < 1e-6) {
          top.add(v);
          nTop += 1;
        } else if (Math.abs(y - minY) < 1e-6) {
          bottom.add(v);
          nBottom += 1;
        }
      }
      top.multiplyScalar(1 / nTop).project(camera);
      bottom.multiplyScalar(1 / nBottom).project(camera);
      const view = (document.getElementById('game-canvas') as HTMLCanvasElement).getBoundingClientRect();
      return (Math.abs(top.y - bottom.y) / 2) * view.height; // flat-ok: normalised device coordinates on screen, not metres
    };
    const faces = (r.facesPainted() as any[]).map((painted, index) => {
      if (!painted) return { index, kind: 'unpainted', fontPx: 0, onScreenPx: 0, coverage: null, canvas: false };
      const mesh = r.faceMesh(index);
      const image = painted.texture.image as HTMLCanvasElement | undefined;
      const onScreenPx = mesh ? (painted.fontPx * screenHeight(mesh)) / painted.canvasHeight : 0;
      return {
        index,
        kind: painted.face.kind as string,
        fontPx: painted.fontPx as number,
        onScreenPx,
        coverage: painted.coverage as number | null,
        canvas: !!image && image.width > 0 && image.height > 0,
      };
    });
    return { rootPx, faces };
  });
}

/** The two visible pages' projected rectangles, the page buttons' and the close button's. */
async function measureLayout(page: Page): Promise<{
  pages: { left: number; top: number; right: number; bottom: number }[];
  prev: DOMRect;
  next: DOMRect;
  close: DOMRect;
}> {
  return page.evaluate(() => {
    const r = (window as unknown as { game: any }).game.bookReader;
    const camera = r.camera;
    const V = camera.position.constructor;
    const rectOf = (mesh: any) => {
      mesh.updateMatrixWorld(true);
      const position = mesh.geometry.getAttribute('position');
      let left = Infinity;
      let top = Infinity;
      let right = -Infinity;
      let bottom = -Infinity;
      const v = new V();
      const view = (document.getElementById('game-canvas') as HTMLCanvasElement).getBoundingClientRect();
      for (let i = 0; i < position.count; i += 1) {
        v.set(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(mesh.matrixWorld).project(camera);
        const x = view.left + ((v.x + 1) / 2) * view.width;
        const y = view.top + ((1 - v.y) / 2) * view.height;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
      return { left, top, right, bottom };
    };
    const { left, right } = r.visibleFaces();
    const pages = [r.faceMesh(left), r.faceMesh(right)].map(rectOf);
    const box = (selector: string) => (document.querySelector(selector) as HTMLElement).getBoundingClientRect().toJSON();
    return { pages, prev: box('.book-turn--prev'), next: box('.book-turn--next'), close: box('.book-close') };
  });
}

async function readerState(page: Page): Promise<{ open: boolean; bookId: string | null; spread: number; spreads: number; turning: boolean }> {
  return page.evaluate(() => {
    const r = (window as unknown as { game: any }).game.bookReader;
    return { open: r.isOpen, bookId: r.bookId, spread: r.spread, spreads: r.spreadCount, turning: r.turning };
  });
}

async function waitPainted(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const faces = (window as unknown as { game: any }).game.bookReader.facesPainted() as unknown[];
      return faces.length > 0 && faces.every((face) => face !== null);
    },
    undefined,
    { timeout: PAINT_TIMEOUT_MS },
  );
}

async function turnAndWait(page: Page, button: 'next' | 'prev'): Promise<void> {
  await page.click(`.book-turn--${button}`);
  await page.waitForFunction(() => !(window as unknown as { game: any }).game.bookReader.turning, undefined, {
    timeout: TURN_TIMEOUT_MS,
  });
}

function textFloor(where: string, measured: { rootPx: number; faces: FaceMeasure[] }): number {
  let smallest = Infinity;
  for (const face of measured.faces) {
    if (face.fontPx <= 0) continue;
    smallest = Math.min(smallest, face.onScreenPx);
    assert(
      face.onScreenPx >= measured.rootPx - 0.01,
      `${where} face ${face.index} (${face.kind}) text size`,
      `${face.onScreenPx.toFixed(2)} CSS px on screen against the ${measured.rootPx} px minimum (drawn at ${face.fontPx.toFixed(1)} canvas px)`,
    );
  }
  return smallest;
}

// ---------------------------------------------------------------- the run

console.log(`check:book-reader — the library's picture books, in Chromium, against ${BASE} (#717)`);
mkdirSync(SHOTS, { recursive: true });

try {
  const probe = await chromium.launch({ channel: 'chromium', headless: true });
  try {
    await (await probe.newPage()).goto(BASE, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  } finally {
    await probe.close().catch(() => {});
  }
} catch (error) {
  console.error(
    `check:book-reader: nothing is serving ${BASE}, so no book was opened at all.\n` +
      `  ${String((error as Error)?.message ?? error).split('\n')[0]}\n` +
      'Run it through the gate\'s own server (`pnpm run check:served-book-reader`), or point it at yours:\n' +
      '  CHECK_BOOK_READER_URL=http://127.0.0.1:<port> pnpm run check:book-reader',
  );
  process.exit(1);
}

const pageErrors: string[] = [];
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const first = VIEWPORTS[0];
  const page = await browser.newPage({ viewport: { width: first.width, height: first.height } });
  page.on('pageerror', (error) => pageErrors.push(String((error as Error)?.stack ?? error)));

  // 1. The deep link opens the reader, as a mode.
  said.push(`\n/book?id=${FIRST}&seed=${SEED}:`);
  await page.goto(`${BASE}/book?id=${FIRST}&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as unknown as { game?: any }).game?.bookReader?.isOpen === true, undefined, {
    timeout: BOOT_TIMEOUT_MS,
  });
  await waitPainted(page);
  const opened = await readerState(page);
  assert(opened.open && opened.bookId === FIRST, 'the deep link opens the book', `open=${opened.open}, book=${opened.bookId}`);
  const mode = await page.evaluate(() => {
    const g = (window as unknown as { game: any }).game;
    return {
      dt: g.frameContext.dt as number,
      menu: (document.querySelector('.hud-menu') as HTMLElement | null)?.style.display ?? 'missing',
    };
  });
  assert(mode.dt === 0, 'the park is paused under it', `frameContext.dt = ${mode.dt}`);
  assert(mode.menu === 'none', 'the HUD menu is off the screen', `.hud-menu display is "${mode.menu}"`);
  await page.screenshot({ path: `${SHOTS}/${FIRST}-open.png` });

  // 2. A tap turns the page.
  await turnAndWait(page, 'next');
  const turned = await readerState(page);
  assert(
    turned.spread === opened.spread + 1,
    'a tap on the right-hand page turns it',
    `spread ${opened.spread} → ${turned.spread} of ${turned.spreads}`,
  );
  await page.screenshot({ path: `${SHOTS}/${FIRST}-turned.png` });

  // 3 + 4. The words and the buttons, at three window sizes.
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(400);
    await waitPainted(page);
    const smallest = textFloor(viewport.name, await measureFaces(page));
    said.push(`  (${viewport.name}: the smallest page text is ${smallest.toFixed(1)} CSS px on screen)`);
    const layout = await measureLayout(page);
    const [leftPage, rightPage] = layout.pages;
    for (const [name, rect, pageRect] of [
      ['previous', layout.prev, leftPage],
      ['next', layout.next, rightPage],
    ] as const) {
      if (!pageRect) continue;
      const covers =
        rect.left <= pageRect.left + 1 &&
        rect.top <= pageRect.top + 1 &&
        rect.right >= pageRect.right - 1 &&
        rect.bottom >= pageRect.bottom - 1;
      assert(
        covers,
        `${viewport.name} ${name}-page button covers its page`,
        `button [${rect.left.toFixed(0)},${rect.top.toFixed(0)}–${rect.right.toFixed(0)},${rect.bottom.toFixed(0)}] ` +
          `page [${pageRect.left.toFixed(0)},${pageRect.top.toFixed(0)}–${pageRect.right.toFixed(0)},${pageRect.bottom.toFixed(0)}]`,
      );
      const overlaps =
        layout.close.left < pageRect.right &&
        layout.close.right > pageRect.left &&
        layout.close.top < pageRect.bottom &&
        layout.close.bottom > pageRect.top;
      assert(!overlaps, `${viewport.name} the ✕ is clear of the ${name === 'next' ? 'right' : 'left'} page`, `close button at [${layout.close.left.toFixed(0)},${layout.close.top.toFixed(0)}]`);
    }
    await page.screenshot({ path: `${SHOTS}/${FIRST}-${viewport.name}.png` });
  }
  await page.setViewportSize({ width: first.width, height: first.height });
  await page.waitForTimeout(400);

  // 5. All twelve books.
  said.push('\nall twelve books:');
  for (const book of BOOKS) {
    await page.evaluate((id) => (window as unknown as { game: any }).game.bookReader.openBook(id), book.id);
    await waitPainted(page);
    const measured = await measureFaces(page);
    const pages = book.pages.length;
    assert(pages >= BOOK_MIN_PAGES && pages <= BOOK_MAX_PAGES, `${book.id} page count`, `${pages} pages`);
    assert(measured.faces.length % 2 === 0, `${book.id} faces pair into spreads`, `${measured.faces.length} faces`);
    const flat = measured.faces.filter((face) => !face.canvas);
    assert(flat.length === 0, `${book.id} every face is a painted canvas`, `${flat.length} of ${measured.faces.length} not`);
    const pictures = measured.faces.filter((face) => face.coverage !== null);
    const thinnest = Math.min(...pictures.map((face) => face.coverage ?? 0));
    assert(
      pictures.length === pages + 1 && thinnest > MIN_COVERAGE,
      `${book.id} every picture drew its models`,
      `${pictures.length} pictures, the thinnest covering ${(thinnest * 100).toFixed(1)}% of its pixels`,
    );
    textFloor(book.id, measured);
    await page.screenshot({ path: `${SHOTS}/book-${book.id}.png` });
  }

  // 6. Reading to the end files a bookmark, and the bookmark reopens the book.
  said.push(`\nreading ${READ_THROUGH} to the end:`);
  await page.evaluate((id) => (window as unknown as { game: any }).game.bookReader.openBook(id), READ_THROUGH);
  await waitPainted(page);
  for (let guard = 0; guard < 10; guard += 1) {
    const state = await readerState(page);
    if (state.spread >= state.spreads - 1) break;
    await turnAndWait(page, 'next');
  }
  const atEnd = await readerState(page);
  assert(atEnd.spread === atEnd.spreads - 1, 'turned to the last page', `spread ${atEnd.spread} of ${atEnd.spreads}`);
  await page.screenshot({ path: `${SHOTS}/${READ_THROUGH}-the-end.png` });
  await page.click('.book-close');
  await page.waitForFunction(() => !(window as unknown as { game: any }).game.bookReader.isOpen, undefined, { timeout: 10_000 });
  await page.evaluate(() => (window as unknown as { game: any }).game.cuteODex.openBook());
  const bookmark = `.dex-card[data-book="${READ_THROUGH}"]`;
  const found = await page.waitForSelector(bookmark, { timeout: 10_000 }).then(() => true).catch(() => false);
  assert(found, 'its bookmark is in the Cute-o-dex', found ? `${bookmark} is there` : `${bookmark} is missing`);
  await page.screenshot({ path: `${SHOTS}/cute-o-dex-books.png` });
  if (found) {
    await page.click(bookmark);
    const again = await page
      .waitForFunction(
        (id) => (window as unknown as { game: any }).game.bookReader.bookId === id,
        READ_THROUGH,
        { timeout: 10_000 },
      )
      .then(() => true)
      .catch(() => false);
    assert(again, 'pressing the bookmark opens the book again', again ? 'it did' : 'the reader did not open it');
  }

  // 7. Escape closes it and gives the park back.
  await page.keyboard.down('Escape');
  await page.waitForTimeout(150);
  await page.keyboard.up('Escape');
  const closed = await page
    .waitForFunction(() => !(window as unknown as { game: any }).game.bookReader.isOpen, undefined, { timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  assert(closed, 'Escape closes the book', closed ? 'closed' : 'still open');
  await page.waitForTimeout(500);
  const back = await page.evaluate(() => {
    const g = (window as unknown as { game: any }).game;
    return {
      dt: g.frameContext.dt as number,
      menu: (document.querySelector('.hud-menu') as HTMLElement | null)?.style.display ?? 'missing',
    };
  });
  assert(back.dt > 0, 'the park runs again', `frameContext.dt = ${back.dt}`);
  assert(back.menu === '', 'the HUD menu is back', `.hud-menu display is "${back.menu}"`);
} catch (error) {
  fouls.push(`threw — ${String((error as Error)?.stack ?? error).slice(0, 600)}`);
} finally {
  await browser.close().catch(() => {});
}

for (const error of pageErrors) fouls.push(`page error — ${error.split('\n')[0]}`);
for (const line of said) console.log(line);
process.stderr.write(
  'check:book-reader coverage note: this measures that every picture DREW (pixel coverage) and that\n' +
    'every word is big enough on screen; it does NOT judge whether a picture looks right — wrong model,\n' +
    `bad framing, an ugly page. That is visual QA, on the screenshots in ${SHOTS}.\n`,
);
console.log(`(park seed ${SEED}; CHECK_BOOK_READER_SEED=n for another)`);
if (fouls.length > 0) {
  console.error(`\ncheck:book-reader FAILED — ${fouls.length} problem(s)`);
  for (const foul of fouls) console.error(`  - ${foul}`);
  process.exit(1);
}
console.log('\ncheck:book-reader passed');
