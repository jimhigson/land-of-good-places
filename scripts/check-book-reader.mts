/**
 * **`check:book-reader` — the library's picture books, in a real browser** (#717).
 *
 * ```
 * pnpm run check:served-book-reader                 # serves the game itself (the gate's form)
 * CHECK_BOOK_READER_URL=http://127.0.0.1:5471 pnpm run check:book-reader   # against your own server
 * CHECK_BOOK_READER_PARK=shown …                     # keep the paused park drawn under the book (QA shots)
 * ```
 *
 * **Frame-rate independent.** Every read after an input waits for the game's
 * own frames to pass (`settleTurn`, `nextFrames`), never only for
 * milliseconds, so a slow renderer cannot make it read a page before its turn
 * began — and after the first screenshot the paused park under the book is not
 * drawn ({@link PARK_SHOWN}), which is most of a frame's cost on CI's software
 * renderer.
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
 *    the turn finishes — and back by one from the left-hand page. Then every
 *    other road, each exactly one page a press: the outer half of each round
 *    arrow; → held for many frames (the input system's left–right value, the
 *    same road a stick and a d-pad take), A (the hop), ← and Space, with the
 *    page the controller points at wearing the rainbow; and a mouse swipe
 *    each way across the right-hand page, whose closing click must not turn a
 *    second page.
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
 *    close button. On the portrait phone the book shows **one page at a
 *    time**: the framed page must fill most of the screen's width, the
 *    forward button must cover it, the back button must sit clear of it, a
 *    tap must pan to the facing page and then turn the leaf, ‹ must come
 *    back, and reading to the last page there must file the bookmark too.
 * 5. **All twelve books resolve.** Each is opened in turn and every face
 *    painted: 4–6 pages, an even number of faces, every texture a real canvas,
 *    every picture's model coverage — read off the rendered *pixels* — above
 *    nothing, and every face with words at or above the floor. And **no book
 *    links a shader program**: after the first book (which warms them all —
 *    the bus ride does it in a real arrival), opening and painting each of the
 *    others must call `linkProgram` exactly zero times. A link count is the
 *    same on every machine, unlike the milliseconds a link costs.
 * 6. **Reading to the end files a bookmark, and the bookmark reopens it.** One
 *    book is turned to its last page, the Cute-o-dex is opened, its bookmark
 *    must be there and pressable, and pressing it must open that book again.
 * 7. **Escape closes it** and gives the park and the menu back. Then a book is
 *    opened, painted and closed again, and the renderer's own count of live
 *    geometries and textures must come back to exactly what it was: nothing
 *    built for a book — its paper, its cover, a picture's models or the hill
 *    under them — may outlive it on the GPU.
 * 8. **The celebrations wait for the book.** With every Cute-o-dex entry but
 *    one book found (driven through the game's own store and the dex's own
 *    list of entries), that book is read to its end: no celebration may show
 *    over its last page; closing it must let the Cute-o-dex's out, and closing
 *    that the library's — one at a time, never two at once. And `C`, the
 *    dex's own key, must not open the dex over an open book.
 * 9. **A book straight off the shelf** (#718). In a fresh profile, the real
 *    `/library?at=` link stands her at the first readable book's stand
 *    (`SHELF_BOOKS[0]`), facing its case: the game's own selection must hold
 *    that book's zone (so its chip shows over it), and running the zone's
 *    primary action — what the chip and E run — must open that very book as
 *    a mode: the reader on its id, the park paused under it, the menu off the
 *    screen.
 *
 * It does **not** judge whether the pictures look right — a model can cover
 * the picture and still be the wrong model, badly framed. That is visual QA,
 * on the screenshots this writes (`CHECK_BOOK_READER_SHOTS`, default
 * `/tmp/check-book-reader`), and it says so on every run.
 */
import { mkdirSync } from 'node:fs';
import { chromium, type Page } from 'playwright-core';
import { BOOKS, BOOK_MAX_PAGES, BOOK_MIN_PAGES, bookCollectionId } from '../src/world/library/books.ts';
import { CANONICAL_PARK_SEED } from '../src/world/parkSeedPool.ts';
import { SHELF_BOOKS, shelfBookZoneId } from '../src/world/library/shelfBooks.ts';
import { LIBRARY_ORIGIN_X, LIBRARY_ORIGIN_Z } from '../src/world/library/layout.ts';
import { PRIMARY_ACTION } from '../src/world/interact.ts';

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
/**
 * How near the asked-for spot `/library?at=` must stand her (section 9): the
 * link carries centimetres and a book's stand is clear floor (a keep-out), so
 * she lands on it — this is the URL's rounding and float slack, not leeway.
 */
const SHELF_STAND_TOLERANCE = 0.1;

/** The book the deep link opens, the one read to the end, and the one that completes the dex. */
const FIRST = BOOKS[0]?.id ?? '';
const READ_THROUGH = BOOKS[3]?.id ?? FIRST;
const LAST = BOOKS[BOOKS.length - 1]?.id ?? FIRST;

/**
 * **The paused park under the book is drawn only until the first screenshot**
 * (`CHECK_BOOK_READER_PARK=shown` keeps it drawn throughout). No assertion
 * here reads the composed frame — every one asks the reader's state, the DOM,
 * a projection through the reader's own camera or a picture's own render
 * target — but the park is most of every frame's cost: on a software renderer
 * it is the difference between this check fitting a CI shard and not.
 * Measured (14 Oct, the Library PR, run 38580957653): on the hosted runner the
 * check was killed by its shard's watchdog after 19 min, still in section 6;
 * locally under SwiftShader it took 380 s with the park drawn and 70 s
 * without, every assertion the same. The first screenshot (`<id>-open.png`) is
 * taken with the park drawn, so the composition is still on record for QA.
 */
const PARK_SHOWN = process.env.CHECK_BOOK_READER_PARK === 'shown';

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
  /** How many lines of words were painted on it. */
  readonly lines: number;
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
      if (!painted) return { index, kind: 'unpainted', fontPx: 0, lines: 0, onScreenPx: 0, coverage: null, canvas: false };
      const mesh = r.faceMesh(index);
      const image = painted.texture.image as HTMLCanvasElement | undefined;
      const onScreenPx = mesh ? (painted.fontPx * screenHeight(mesh)) / painted.canvasHeight : 0;
      return {
        index,
        kind: painted.face.kind as string,
        fontPx: painted.fontPx as number,
        lines: (painted.lines as readonly string[]).length,
        onScreenPx,
        coverage: painted.coverage as number | null,
        canvas: !!image && image.width > 0 && image.height > 0,
      };
    });
    return { rootPx, faces };
  });
}

/** The two visible pages' projected rectangles, the page buttons' and the close button's. */
interface ScreenRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

function overlap(a: ScreenRect, b: ScreenRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function covers(outer: ScreenRect, inner: ScreenRect): boolean {
  return outer.left <= inner.left + 1 && outer.top <= inner.top + 1 && outer.right >= inner.right - 1 && outer.bottom >= inner.bottom - 1;
}

function rectText(rect: ScreenRect): string {
  return `[${rect.left.toFixed(0)},${rect.top.toFixed(0)}–${rect.right.toFixed(0)},${rect.bottom.toFixed(0)}]`;
}

async function measureLayout(page: Page): Promise<{
  pages: ScreenRect[];
  framing: 'spread' | 'page';
  framed: ScreenRect | null;
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
    const framedFace = r.framedFace() as number | null;
    const framed = framedFace === null ? null : rectOf(r.faceMesh(framedFace));
    const box = (selector: string) => (document.querySelector(selector) as HTMLElement).getBoundingClientRect().toJSON();
    return {
      pages,
      framing: r.framing as 'spread' | 'page',
      framed,
      prev: box('.book-turn--prev'),
      next: box('.book-turn--next'),
      close: box('.book-close'),
    };
  });
}

async function framedState(page: Page): Promise<{ framing: string; face: number | null; spread: number }> {
  return page.evaluate(() => {
    const r = (window as unknown as { game: any }).game.bookReader;
    return { framing: r.framing as string, face: r.framedFace() as number | null, spread: r.spread as number };
  });
}

async function readerState(page: Page): Promise<{ open: boolean; bookId: string | null; spread: number; spreads: number; turning: boolean }> {
  return page.evaluate(() => {
    const r = (window as unknown as { game: any }).game.bookReader;
    return { open: r.isOpen, bookId: r.bookId, spread: r.spread, spreads: r.spreadCount, turning: r.turning };
  });
}

/** The celebrations showing now, by their accessible names. */
async function openPrizes(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.dexprize[data-open="true"]')].map((prize) => prize.getAttribute('aria-label') ?? '?'),
  );
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

async function waitTurned(page: Page): Promise<void> {
  await page.waitForFunction(() => !(window as unknown as { game: any }).game.bookReader.turning, undefined, {
    timeout: TURN_TIMEOUT_MS,
  });
}

/**
 * **`count` of the game's own frames, whatever they cost.** An input — a key,
 * a virtual button, a click — is taken by the game's next frame, and a page
 * turn it starts shows on `bookReader.turning` from then on. A wait in
 * milliseconds is a guess at the frame rate: on a software renderer a frame
 * outlasts it, and the check then reads the reader before the turn has begun.
 * Measured (14 Oct, the Library PR): under SwiftShader with the park drawn,
 * seven assertions went red, every one a page read before its turn started
 * ("spread 2 → 2") or after a late one landed ("a swipe … spread 2 → 0").
 * Two animation frames after an input, the game has run a whole frame since.
 */
async function nextFrames(page: Page, count = 2): Promise<void> {
  await page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        const step = (left: number): void => {
          if (left <= 0) resolve();
          else requestAnimationFrame(() => step(left - 1));
        };
        step(n);
      }),
    count,
  );
}

/**
 * After an input: let the game take it and finish any turn it started — then
 * look again a frame later, so a second turn that starts late (a swipe's
 * closing click, a key read twice) is still caught as a second turn.
 */
async function settleTurn(page: Page): Promise<void> {
  await page.waitForTimeout(150);
  await nextFrames(page);
  await waitTurned(page);
  await nextFrames(page);
  await waitTurned(page);
}

async function turnAndWait(page: Page, button: 'next' | 'prev'): Promise<void> {
  await page.click(`.book-turn--${button}`);
  await settleTurn(page);
}

/** A page button's box and its round arrow's, as the browser laid them out. */
async function arrowBoxes(page: Page, which: 'next' | 'prev'): Promise<{ button: DOMRect; arrow: DOMRect; shown: boolean }> {
  return page.evaluate((w) => {
    const button = document.querySelector(`.book-turn--${w}`) as HTMLButtonElement;
    const arrow = button.querySelector('.book-turn-arrow') as HTMLElement;
    return {
      button: button.getBoundingClientRect().toJSON(),
      arrow: arrow.getBoundingClientRect().toJSON(),
      shown: button.dataset.show === 'true' && !button.disabled,
    };
  }, which);
}

/**
 * Taps the half of a page's round arrow that hangs **outside** its button —
 * the half off the paper, the half a child aims at — and returns the spread
 * before and after. A mouse click, not a touch tap: Chromium's touch
 * adjustment snaps a tap near an edge onto the nearest button, which would
 * make this green against an arrow that takes no taps at all.
 */
async function tapArrowOuterHalf(page: Page, which: 'next' | 'prev'): Promise<{ before: number; after: number; outside: boolean; at: string }> {
  const { button, arrow } = await arrowBoxes(page, which);
  const x = which === 'next' ? (button.right + arrow.right) / 2 : (arrow.left + button.left) / 2;
  const y = arrow.top + arrow.height / 2;
  const outside = which === 'next' ? x > button.right : x < button.left;
  const before = (await readerState(page)).spread;
  await page.mouse.click(x, y);
  await settleTurn(page);
  const after = (await readerState(page)).spread;
  return { before, after, outside, at: `(${x.toFixed(0)}, ${y.toFixed(0)}); button [${button.left.toFixed(0)}–${button.right.toFixed(0)}], arrow [${arrow.left.toFixed(0)}–${arrow.right.toFixed(0)}]` };
}

/**
 * Every worded face's on-screen text size against the floor. A face with words
 * must report a size and lines, and a blank one must report none — so a
 * regression that stops reporting sizes is a failure here, never a face
 * quietly skipped — and something must have been measured at all.
 */
function textFloor(where: string, measured: { rootPx: number; faces: FaceMeasure[] }): number {
  let smallest = Infinity;
  let counted = 0;
  for (const face of measured.faces) {
    const worded = face.kind !== 'blank';
    assert(
      worded ? face.fontPx > 0 && face.lines > 0 : face.fontPx === 0 && face.lines === 0,
      `${where} face ${face.index} (${face.kind}) reports its words`,
      `${face.lines} line(s) at ${face.fontPx.toFixed(1)} canvas px — ${worded ? 'a face with words must have both' : 'a blank face must have neither'}`,
    );
    if (!worded || face.fontPx <= 0) continue;
    counted += 1;
    smallest = Math.min(smallest, face.onScreenPx);
    assert(
      face.onScreenPx >= measured.rootPx - 0.01,
      `${where} face ${face.index} (${face.kind}) text size`,
      `${face.onScreenPx.toFixed(2)} CSS px on screen against the ${measured.rootPx} px minimum (drawn at ${face.fontPx.toFixed(1)} canvas px)`,
    );
  }
  assert(
    counted > 0 && Number.isFinite(smallest),
    `${where} the text floor measured something`,
    `${counted} worded face(s) measured, the smallest ${smallest.toFixed(1)} CSS px`,
  );
  return smallest;
}

// ---------------------------------------------------------------- the run

console.log(`check:book-reader — the library's picture books, in Chromium, against ${BASE} (#717)`);
mkdirSync(SHOTS, { recursive: true });

try {
  // A plain request, not a page: a page would boot the game, and the game with
  // no seed asks the dev server for a random seed's park, which it then solves
  // for minutes in the background of the run that follows.
  const response = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
  // Every program link the page makes, counted from before its first script.
  await page.addInitScript(() => {
    const counter = { links: 0 };
    (window as unknown as { __bookReaderLinks: { links: number } }).__bookReaderLinks = counter;
    for (const proto of [WebGL2RenderingContext.prototype, WebGLRenderingContext.prototype]) {
      const link = proto.linkProgram;
      proto.linkProgram = function (this: WebGLRenderingContext, program: WebGLProgram): void {
        counter.links += 1;
        link.call(this, program);
      };
    }
  });

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
  if (!PARK_SHOWN) {
    await page.evaluate(() => {
      (window as unknown as { game: any }).game.engine.scene.visible = false;
    });
  }
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(250);
  await nextFrames(page);
  const dexOverBook = await page.evaluate(() => {
    const g = (window as unknown as { game: any }).game;
    return { dex: g.cuteODex.isOpen as boolean, book: g.bookReader.isOpen as boolean };
  });
  assert(
    !dexOverBook.dex && dexOverBook.book,
    'C does not open the Cute-o-dex over the book',
    `dex open=${dexOverBook.dex}, book open=${dexOverBook.book}`,
  );

  // 2. A tap turns the page — forwards, and back again.
  await turnAndWait(page, 'next');
  const turned = await readerState(page);
  assert(
    turned.spread === opened.spread + 1,
    'a tap on the right-hand page turns it',
    `spread ${opened.spread} → ${turned.spread} of ${turned.spreads}`,
  );
  await page.screenshot({ path: `${SHOTS}/${FIRST}-turned.png` });
  await turnAndWait(page, 'prev');
  const turnedBack = await readerState(page);
  assert(
    turnedBack.spread === opened.spread,
    'a tap on the left-hand page turns it back',
    `spread ${turned.spread} → ${turnedBack.spread}`,
  );
  const atStart = await arrowBoxes(page, 'prev');
  assert(!atStart.shown, 'at the first spread there is no page to turn back to', atStart.shown ? 'the previous-page button is still live' : 'the previous-page button is hidden and disabled');

  // 2a. The round arrows take taps all over, including the half of each that
  // hangs off the paper, outside its button's box.
  for (const [which, step] of [
    ['next', 1],
    ['prev', -1],
  ] as const) {
    const tapped = await tapArrowOuterHalf(page, which);
    assert(tapped.outside, `the ${which} arrow's outer half is outside its button`, `probed at ${tapped.at}`);
    assert(
      tapped.after === tapped.before + step,
      `a tap on the outer half of the ${which} arrow turns the page`,
      `spread ${tapped.before} → ${tapped.after}, tapped at ${tapped.at}`,
    );
  }
  await turnAndWait(page, 'next');

  // 2b. Keys and a controller's buttons, through the input system.
  const spreadNow = async (): Promise<number> => (await readerState(page)).spread;
  const settle = (): Promise<void> => settleTurn(page);
  const beforeHold = await spreadNow();
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(700);
  await page.keyboard.up('ArrowRight');
  await settle();
  const afterHold = await spreadNow();
  assert(afterHold === beforeHold + 1, 'holding → turns exactly one page', `spread ${beforeHold} → ${afterHold}, → held for 700 ms`);
  const ringed = await page.evaluate(() => {
    const button = document.querySelector('.book-turn--next') as HTMLElement;
    return { pad: button.dataset.padFocus ?? '', ring: getComputedStyle(button, '::after').content };
  });
  assert(
    ringed.pad === 'true' && ringed.ring !== 'none' && ringed.ring !== '',
    'the page the controller points at wears the rainbow',
    `data-pad-focus="${ringed.pad}"; the rainbow ring (its ::after) is ${ringed.ring === 'none' ? 'not drawn' : 'drawn'} (content ${ringed.ring})`,
  );
  await page.evaluate(() => (window as unknown as { game: any }).game.input.pressVirtual('jump'));
  await settle();
  const afterA = await spreadNow();
  assert(afterA === afterHold + 1, 'A (the hop) presses the page the controller points at', `spread ${afterHold} → ${afterA}`);
  await page.keyboard.press('ArrowLeft');
  await settle();
  const afterLeft = await spreadNow();
  assert(afterLeft === afterA - 1, 'a tap of ← turns back exactly one page', `spread ${afterA} → ${afterLeft}`);
  await page.keyboard.press('Space');
  await settle();
  const afterSpace = await spreadNow();
  assert(
    afterSpace === afterLeft - 1,
    'Space presses the page the controller points at, once',
    `spread ${afterLeft} → ${afterSpace} — after ←, the previous page is the one pointed at`,
  );

  // 2c. A mouse swipe across the right-hand page, each way.
  const swipe = async (dx: number): Promise<{ before: number; after: number }> => {
    const box = await page.evaluate(() => (document.querySelector('.book-turn--next') as HTMLElement).getBoundingClientRect().toJSON());
    const y = box.top + box.height * 0.45;
    const x = box.left + box.width * 0.5;
    const before = await spreadNow();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx / 2, y, { steps: 4 });
    await page.mouse.move(x + dx, y, { steps: 4 });
    await page.mouse.up();
    await settle();
    return { before, after: await spreadNow() };
  };
  const leftwards = await swipe(-120);
  assert(leftwards.after === leftwards.before + 1, 'a swipe leftwards turns exactly one page', `spread ${leftwards.before} → ${leftwards.after}`);
  const rightwards = await swipe(120);
  assert(rightwards.after === rightwards.before - 1, 'a swipe rightwards turns back exactly one page', `spread ${rightwards.before} → ${rightwards.after}`);

  // 3 + 4. The words and the buttons, at three window sizes.
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(400);
    await nextFrames(page);
    await waitPainted(page);
    const smallest = textFloor(viewport.name, await measureFaces(page));
    said.push(`  (${viewport.name}: the smallest page text is ${smallest.toFixed(1)} CSS px on screen)`);
    const layout = await measureLayout(page);
    const [leftPage, rightPage] = layout.pages;
    const tall = viewport.height > viewport.width;
    assert(
      layout.framing === (tall ? 'page' : 'spread'),
      `${viewport.name} frames ${tall ? 'one page at a time' : 'the whole spread'}`,
      `framing is "${layout.framing}"`,
    );
    if (layout.framing === 'page' && layout.framed) {
      const framed = layout.framed;
      const share = (framed.right - framed.left) / viewport.width;
      assert(share >= 0.85, `${viewport.name} the page fills the screen's width`, `${(share * 100).toFixed(0)}% of ${viewport.width} px`);
      assert(covers(layout.next, framed), `${viewport.name} the page is the forward button`, `button ${rectText(layout.next)} page ${rectText(framed)}`);
      assert(!overlap(layout.close, framed), `${viewport.name} the ✕ is clear of the page`, `close ${rectText(layout.close)} page ${rectText(framed)}`);
      const prevShown = (await arrowBoxes(page, 'prev')).shown;
      if (prevShown) {
        assert(!overlap(layout.prev, framed), `${viewport.name} the back button is clear of the page`, `back ${rectText(layout.prev)} page ${rectText(framed)}`);
      }
      // A tap pans to the facing page, the next turns the leaf, ‹ comes back.
      const start = await framedState(page);
      const tapTo = async (which: 'next' | 'prev'): Promise<{ face: number | null; spread: number }> => {
        await page.click(`.book-turn--${which}`);
        await settleTurn(page);
        return framedState(page);
      };
      const across = await tapTo('next');
      assert(
        across.face === (start.face ?? 0) + 1 && across.spread === start.spread,
        `${viewport.name} a tap pans to the facing page`,
        `face ${start.face} → ${across.face}, spread ${start.spread} → ${across.spread}`,
      );
      const over = await tapTo('next');
      assert(
        over.face === (across.face ?? 0) + 1 && over.spread === across.spread + 1,
        `${viewport.name} the next tap turns the leaf and follows it`,
        `face ${across.face} → ${over.face}, spread ${across.spread} → ${over.spread}`,
      );
      const back = await tapTo('prev');
      assert(
        back.face === across.face && back.spread === across.spread,
        `${viewport.name} ‹ turns back to the page before`,
        `face ${over.face} → ${back.face}, spread ${over.spread} → ${back.spread}`,
      );
      // And the camera went with her: the page now in view is the one framed.
      const after = await measureLayout(page);
      const followed =
        after.framed !== null &&
        after.framed.left >= -1 &&
        after.framed.right <= viewport.width + 1 &&
        (after.framed.right - after.framed.left) / viewport.width >= 0.85;
      assert(
        followed,
        `${viewport.name} the camera follows her to the page she is reading`,
        `page ${after.framed ? rectText(after.framed) : 'none'} in a ${viewport.width} px wide window`,
      );
      await page.screenshot({ path: `${SHOTS}/${FIRST}-${viewport.name}-one-page.png` });
    }
    for (const [name, rect, pageRect] of [
      ['previous', layout.prev, leftPage],
      ['next', layout.next, rightPage],
    ] as const) {
      if (!pageRect || layout.framing === 'page') continue;
      assert(
        covers(rect, pageRect),
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
      const onButton =
        layout.close.left < rect.right &&
        layout.close.right > rect.left &&
        layout.close.top < rect.bottom &&
        layout.close.bottom > rect.top;
      assert(!onButton, `${viewport.name} the ✕ is clear of the ${name}-page button`, `a tap on the ✕ must never land on a page`);
    }
    // The round arrows are whole on screen: a "tap here" half off the glass
    // is half a target.
    for (const which of ['prev', 'next'] as const) {
      const boxes = await arrowBoxes(page, which);
      if (!boxes.shown) continue;
      const inside =
        boxes.arrow.left >= -0.5 &&
        boxes.arrow.top >= -0.5 &&
        boxes.arrow.right <= viewport.width + 0.5 &&
        boxes.arrow.bottom <= viewport.height + 0.5;
      assert(
        inside,
        `${viewport.name} the ${which} arrow is whole on screen`,
        `arrow [${boxes.arrow.left.toFixed(1)},${boxes.arrow.top.toFixed(1)}–${boxes.arrow.right.toFixed(1)},${boxes.arrow.bottom.toFixed(1)}] in a ${viewport.width}x${viewport.height} window`,
      );
    }
    await page.screenshot({ path: `${SHOTS}/${FIRST}-${viewport.name}.png` });
    if (layout.framing === 'page') {
      // Reading to the last page one page at a time files the bookmark too.
      const portraitBook = BOOKS[1]?.id ?? FIRST;
      await page.evaluate((id) => (window as unknown as { game: any }).game.bookReader.openBook(id), portraitBook);
      await waitPainted(page);
      for (let guard = 0; guard < 12; guard += 1) {
        if (!(await arrowBoxes(page, 'next')).shown) break;
        await page.click('.book-turn--next');
        await settleTurn(page);
      }
      const filed = await page.evaluate(async (collectionId) => {
        const { gameStore } = await import('/src/state/index.ts');
        return gameStore.get().collection[collectionId]?.discovered === true;
      }, bookCollectionId(portraitBook));
      const last = await framedState(page);
      assert(filed, `${viewport.name} reading to the last page files the bookmark`, `${portraitBook} ended on face ${last.face}, bookmark ${filed ? 'filed' : 'missing'}`);
      await page.evaluate((id) => (window as unknown as { game: any }).game.bookReader.openBook(id), FIRST);
      await waitPainted(page);
    }
  }
  await page.setViewportSize({ width: first.width, height: first.height });
  await page.waitForTimeout(400);
  await nextFrames(page);

  // 5. All twelve books.
  said.push('\nall twelve books:');
  for (const book of BOOKS) {
    const linksBefore = await page.evaluate((id) => {
      const before = (window as unknown as { __bookReaderLinks: { links: number } }).__bookReaderLinks.links;
      (window as unknown as { game: any }).game.bookReader.openBook(id);
      return before;
    }, book.id);
    await waitPainted(page);
    await page.waitForTimeout(200);
    const linksAfter = await page.evaluate(() => (window as unknown as { __bookReaderLinks: { links: number } }).__bookReaderLinks.links);
    assert(
      linksAfter === linksBefore,
      `${book.id} opens without linking a shader program`,
      `${linksAfter - linksBefore} program link(s) while it opened and painted`,
    );
    const measured = await measureFaces(page);
    const pages = book.pages.length;
    assert(pages >= BOOK_MIN_PAGES && pages <= BOOK_MAX_PAGES, `${book.id} page count`, `${pages} pages`);
    assert(measured.faces.length % 2 === 0, `${book.id} faces pair into spreads`, `${measured.faces.length} faces`);
    // A printed picture book's order: "The End" last, on a right-hand page,
    // and with an odd number of pages the title on a right-hand page too.
    const kinds = measured.faces.map((face) => face.kind);
    const titleAt = kinds.indexOf('title');
    assert(
      kinds.at(-1) === 'end' && (pages % 2 === 0 || titleAt % 2 === 1),
      `${book.id} opens and ends like a picture book`,
      `faces ${kinds.join(' | ')}`,
    );
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
  await nextFrames(page);
  const back = await page.evaluate(() => {
    const g = (window as unknown as { game: any }).game;
    return {
      dt: g.frameContext.dt as number,
      menu: (document.querySelector('.hud-menu') as HTMLElement | null)?.style.display ?? 'missing',
    };
  });
  assert(back.dt > 0, 'the park runs again', `frameContext.dt = ${back.dt}`);
  assert(back.menu === '', 'the HUD menu is back', `.hud-menu display is "${back.menu}"`);

  // 7a. A book leaves nothing behind on the GPU. Read and opened in one
  // evaluate, and closed and read in another, so no unpaused park frame runs
  // in between to muddy the count.
  const LEAK_PROBE = BOOKS[5]?.id ?? FIRST;
  const memoryBefore = await page.evaluate((id) => {
    const g = (window as unknown as { game: any }).game;
    const memory = g.engine.renderer.info.memory;
    const before = { geometries: memory.geometries as number, textures: memory.textures as number };
    g.bookReader.openBook(id);
    return before;
  }, LEAK_PROBE);
  await waitPainted(page);
  await page.waitForTimeout(300);
  const memoryAfter = await page.evaluate(() => {
    const g = (window as unknown as { game: any }).game;
    g.bookReader.close();
    const memory = g.engine.renderer.info.memory;
    return { geometries: memory.geometries as number, textures: memory.textures as number };
  });
  assert(
    memoryAfter.geometries === memoryBefore.geometries && memoryAfter.textures === memoryBefore.textures,
    `opening and closing ${LEAK_PROBE} leaves nothing on the GPU`,
    `geometries ${memoryBefore.geometries} → ${memoryAfter.geometries}, textures ${memoryBefore.textures} → ${memoryAfter.textures}`,
  );

  // 8. The celebrations wait for the book, and take turns.
  said.push(`\nthe celebrations wait for the book (${LAST} completes the dex):`);
  const primed = await page.evaluate(async (lastId) => {
    // The game's own store and the dex's own list of what counts: Vite serves
    // each module at one URL, so these are the instances the page is running
    // — which the pill's tally below confirms rather than assumes.
    const { gameStore } = await import('/src/state/index.ts');
    const { dexEntries } = await import('/src/ui/CuteODex.ts');
    const entries = dexEntries() as { id: string; name: string; category: string }[];
    for (const entry of entries) {
      if (entry.id !== lastId) gameStore.collect(entry.id, entry.name, entry.category, 'backpack');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    const pill = (document.querySelector('.pill--dex') as HTMLElement | null)?.textContent ?? '';
    return { total: entries.length, pill, hasLast: entries.some((entry) => entry.id === lastId) };
  }, bookCollectionId(LAST));
  assert(
    primed.hasLast && primed.pill.endsWith(`${primed.total - 1}/${primed.total}`),
    'the store the check drives is the game\'s own',
    `every entry but ${LAST} found; the dex pill reads "${primed.pill}" of ${primed.total} entries`,
  );
  await page.evaluate((id) => (window as unknown as { game: any }).game.bookReader.openBook(id), LAST);
  await waitPainted(page);
  for (let guard = 0; guard < 10; guard += 1) {
    const state = await readerState(page);
    if (state.spread >= state.spreads - 1) break;
    await turnAndWait(page, 'next');
  }
  await page.waitForTimeout(300);
  await nextFrames(page);
  const overLastPage = await openPrizes(page);
  const lastState = await readerState(page);
  assert(
    lastState.open && lastState.spread === lastState.spreads - 1 && overLastPage.length === 0,
    'no celebration bursts out over the open book',
    `on the last page of ${lastState.bookId} (spread ${lastState.spread} of ${lastState.spreads}): showing ${JSON.stringify(overLastPage)}`,
  );
  await page.screenshot({ path: `${SHOTS}/${LAST}-last-page-before-the-prize.png` });
  await page.click('.book-close');
  await page.waitForTimeout(400);
  await nextFrames(page);
  const afterClose = await openPrizes(page);
  assert(
    afterClose.length === 1 && afterClose[0] === 'You found every cute thing!',
    'closing the book lets the Cute-o-dex celebration out, on its own',
    `showing ${JSON.stringify(afterClose)}`,
  );
  await page.screenshot({ path: `${SHOTS}/prize-dex.png` });
  if (afterClose.length > 0) await page.click('.dexprize[data-open="true"] .dexprize-ok');
  await page.waitForTimeout(400);
  await nextFrames(page);
  const afterDexPrize = await openPrizes(page);
  assert(
    afterDexPrize.length === 1 && afterDexPrize[0] === 'You read every book!',
    'closing that lets the library celebration out, on its own',
    `showing ${JSON.stringify(afterDexPrize)}`,
  );
  await page.screenshot({ path: `${SHOTS}/prize-books.png` });
  if (afterDexPrize.length > 0) await page.click('.dexprize[data-open="true"] .dexprize-ok');
  await page.waitForTimeout(400);
  await nextFrames(page);
  const afterBoth = await openPrizes(page);
  assert(afterBoth.length === 0, 'and then the park is back', `showing ${JSON.stringify(afterBoth)}`);

  // 9. A book straight off the shelf (#718; plan Step 5's served item).
  const shelf = SHELF_BOOKS[0];
  if (!shelf) throw new Error('check:book-reader: SHELF_BOOKS is empty — no readable book stands on a shelf to take down');
  const stand = { x: Number(shelf.slot.stand.x.toFixed(2)), z: Number(shelf.slot.stand.z.toFixed(2)) };
  const shelfPath = `/library?at=${stand.x},${stand.z}&facing=${shelf.slot.stand.facing}&seed=${SEED}`;
  const zoneId = shelfBookZoneId(shelf.book.id);
  said.push(`\n${shelfPath} — '${shelf.book.id}' taken down off ${shelf.slot.bookcase}:`);
  // The sections above are done with their page. This one gets a fresh
  // profile, so nothing they saved (every entry found, both prizes seen) rides in.
  await page.close();
  const shelfContext = await browser.newContext({ viewport: { width: first.width, height: first.height } });
  try {
    const shelfPage = await shelfContext.newPage();
    shelfPage.on('pageerror', (error) => pageErrors.push(String((error as Error)?.stack ?? error)));
    await shelfPage.goto(`${BASE}${shelfPath}`, { waitUntil: 'domcontentloaded' });
    await shelfPage.waitForFunction(
      ({ x, z, tolerance }) => {
        const g = (window as unknown as { game?: any }).game;
        const p = g?.player?.position;
        return g?.world?.library?.playerIsInside === true && !!p && Math.hypot(p.x - x, p.z - z) <= tolerance;
      },
      { x: LIBRARY_ORIGIN_X + stand.x, z: LIBRARY_ORIGIN_Z + stand.z, tolerance: SHELF_STAND_TOLERANCE },
      { timeout: BOOT_TIMEOUT_MS },
    );
    // Stood at the book's stand, the game's own selection must hold it: that is
    // what puts its chip over the book for a child to press.
    const held = await shelfPage
      .waitForFunction((id) => (window as unknown as { game: any }).game.selection?.selected?.id === id, zoneId, { timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    const holding = await shelfPage.evaluate(() => ((window as unknown as { game: any }).game.selection?.selected?.id as string | undefined) ?? null);
    assert(held, `off the shelf: standing at ${shelf.slot.stand.what}, the selection holds '${shelf.book.id}'`, `selected: ${holding ?? 'nothing'}`);
    await shelfPage.screenshot({ path: `${SHOTS}/shelf-${shelf.book.id}-chip.png` });
    // The zone's primary action — what its chip, or E, runs.
    const pressed = await shelfPage.evaluate(
      ({ id, primary }) => {
        const g = (window as unknown as { game: any }).game;
        const zone = (g.world.library.interactZones() as any[]).find((candidate) => candidate.id === id);
        const action = zone?.actions?.().find((candidate: any) => candidate.id === primary);
        action?.run();
        return { zone: !!zone, action: !!action };
      },
      { id: zoneId, primary: PRIMARY_ACTION },
    );
    assert(pressed.zone && pressed.action, `off the shelf: '${zoneId}' is offered, with a chip`, `zone ${pressed.zone ? 'found' : 'MISSING'}, primary action ${pressed.action ? 'run' : 'MISSING'}`);
    await shelfPage
      .waitForFunction(() => (window as unknown as { game: any }).game.bookReader.isOpen === true, undefined, { timeout: 10_000 })
      .catch(() => {});
    if ((await readerState(shelfPage)).open) await waitPainted(shelfPage);
    await nextFrames(shelfPage);
    const read = await readerState(shelfPage);
    const shelfMode = await shelfPage.evaluate(() => {
      const g = (window as unknown as { game: any }).game;
      return {
        dt: g.frameContext.dt as number,
        menu: (document.querySelector('.hud-menu') as HTMLElement | null)?.style.display ?? 'missing',
      };
    });
    assert(read.open && read.bookId === shelf.book.id, "off the shelf: the book's chip opens that book", `open=${read.open}, book=${read.bookId} (the shelf's book: ${shelf.book.id})`);
    assert(shelfMode.dt === 0, 'off the shelf: the park is paused under it', `frameContext.dt = ${shelfMode.dt}`);
    assert(shelfMode.menu === 'none', 'off the shelf: the HUD menu is off the screen', `.hud-menu display is "${shelfMode.menu}"`);
    await shelfPage.screenshot({ path: `${SHOTS}/shelf-${shelf.book.id}-open.png` });
  } finally {
    await shelfContext.close();
  }
} catch (error) {
  fouls.push(`threw — ${String((error as Error)?.stack ?? error).slice(0, 600)}`);
} finally {
  await browser.close().catch(() => {});
}

for (const error of pageErrors) fouls.push(`page error — ${error.split('\n')[0]}`);
for (const line of said) console.log(line);
process.stderr.write(
  PARK_SHOWN
    ? 'check:book-reader: the park was drawn under the book throughout (CHECK_BOOK_READER_PARK=shown).\n'
    : `check:book-reader: the park under the book was drawn for the first screenshot (${FIRST}-open.png) and hidden\n` +
        'after it — no assertion reads the composed frame; CHECK_BOOK_READER_PARK=shown keeps it drawn.\n',
);
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
