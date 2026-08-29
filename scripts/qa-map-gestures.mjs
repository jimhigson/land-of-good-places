/**
 * Measures the park map's close/tap/drag/pinch behaviour with real CDP touch
 * input, at four viewports. Not part of the build — a QA harness for
 * fix/map-tap-to-close.
 *
 *   node map-gestures.mjs <port> <outDir> <tag>
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const port = process.argv[2] ?? '5390';
const outDir = process.argv[3] ?? 'qa-out';
const tag = process.argv[4] ?? 'before';
mkdirSync(outDir, { recursive: true });

const SIZES = [
  { name: 'phone-portrait', width: 390, height: 844 },
  { name: 'phone-landscape', width: 844, height: 390 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

const browser = await chromium.launch();
const rows = [];

const isOpen = (page) =>
  page.evaluate(() => document.querySelector('.parkmap')?.dataset.open === 'true');

const mapState = (page) =>
  page.evaluate(() => {
    const canvas = document.querySelector('.parkmap-canvas');
    const card = document.querySelector('.parkmap-card');
    const root = document.querySelector('.parkmap');
    const hint = document.querySelector('.parkmap-card .shop-hint');
    const cr = card?.getBoundingClientRect();
    const rr = root?.getBoundingClientRect();
    const canvasRect = canvas?.getBoundingClientRect();
    return {
      open: root?.dataset.open === 'true',
      hint: hint?.textContent ?? null,
      labels: Number(canvas?.dataset.labelCount ?? -1),
      features: Number(canvas?.dataset.featureCount ?? -1),
      zoom: Number(canvas?.dataset.zoom ?? -1),
      drawn: canvas?.dataset.labelNames ? JSON.parse(canvas.dataset.labelNames) : null,
      missing: canvas?.dataset.missingLabels ? JSON.parse(canvas.dataset.missingLabels) : null,
      card: cr && { x: cr.x, y: cr.y, w: cr.width, h: cr.height },
      root: rr && { x: rr.x, y: rr.y, w: rr.width, h: rr.height },
      canvas: canvasRect && {
        x: canvasRect.x,
        y: canvasRect.y,
        w: canvasRect.width,
        h: canvasRect.height,
      },
    };
  });

/** A point on the dimmed backdrop, or null when the card fills the overlay. */
function backdropPoint(state) {
  const { card, root } = state;
  if (!card || !root) return null;
  const topGap = card.y - root.y;
  const bottomGap = root.y + root.h - (card.y + card.h);
  const leftGap = card.x - root.x;
  const rightGap = root.x + root.w - (card.x + card.w);
  const cx = card.x + card.w / 2;
  const cy = card.y + card.h / 2;
  if (leftGap > 12) return { x: root.x + leftGap / 2, y: cy };
  if (rightGap > 12) return { x: card.x + card.w + rightGap / 2, y: cy };
  if (topGap > 12) return { x: cx, y: root.y + topGap / 2 };
  if (bottomGap > 12) return { x: cx, y: card.y + card.h + bottomGap / 2 };
  return null;
}

async function openMap(page) {
  if (await isOpen(page)) return;
  await page.keyboard.press('m');
  await page.waitForSelector('.parkmap[data-open="true"]', { timeout: 20000 });
  await page.waitForTimeout(600);
}

/**
 * **Every touch carries an explicit `timestamp`, and that is not a detail.**
 *
 * A definite tap is a `pointerdown`/`pointerup` pair inside 600 ms
 * (`src/core/input/tapGesture.ts`). Headless Chromium cannot express that by
 * dispatch timing: with the park rendering behind the map overlay, the main
 * thread is saturated and each `Input.dispatchTouchEvent` takes **2.0-3.1 s**
 * to land, measured repeatedly here — so two events dispatched 80 ms apart
 * arrive stamped ~2.8 s apart and every tap in this harness would read as a
 * long considered press. That would be the *measurement* failing, not the map.
 *
 * `timestamp` (TimeSinceEpoch, seconds) is what Chrome puts on the event, and
 * therefore what `event.timeStamp` reports to the page. Supplying it models a
 * tap that really did take 80 ms of a child's wall clock, independent of how
 * long this machine took to deliver it — which is the thing a phone does and
 * this harness otherwise cannot.
 */
const touch = (cdp, type, points, seconds) =>
  cdp.send('Input.dispatchTouchEvent', {
    type,
    timestamp: seconds,
    touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 12, radiusY: 12, force: 1 })),
  });

/** A fresh gesture clock, in seconds since the epoch, as CDP wants it. */
const gestureClock = () => {
  let at = Date.now() / 1000;
  return (advanceMs = 0) => {
    at += advanceMs / 1000;
    return at;
  };
};

for (const size of SIZES) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: false,
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {
      /* first run */
    }
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${port}/spawn?pos=0,0`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForSelector('.pill--map', { state: 'attached', timeout: 180000 });
  await page.waitForTimeout(2500);
  const cdp = await context.newCDPSession(page);

  const row = { size: size.name };

  // --- default-zoom labels -------------------------------------------------
  await openMap(page);
  const state = await mapState(page);
  row.canvas = state.canvas && `${Math.round(state.canvas.w)}x${Math.round(state.canvas.h)}`;
  row.labels = `${state.labels}/${state.features}`;
  row.zoom = state.zoom;
  row.hint = state.hint;
  row.drawn = state.drawn;
  row.missing = state.missing;
  await page.screenshot({ path: `${outDir}/${tag}-${size.name}-map.png` });

  const bd = backdropPoint(state);
  row.backdrop = bd ? `${Math.round(bd.x)},${Math.round(bd.y)}` : 'none (card fills screen)';

  if (bd) {
    // --- test 1: a definite tap on the backdrop ----------------------------
    // Down, then up 80 ms later in the same spot: what a child's tap is.
    const tapAt = gestureClock();
    await touch(cdp, 'touchStart', [bd], tapAt());
    // Read between the two halves: this is the assertion that fails on the
    // unfixed build, where the map is already gone before the finger lifts.
    row.closedOnPointerDown = !(await isOpen(page));
    await touch(cdp, 'touchEnd', [], tapAt(80));
    await page.waitForTimeout(300);
    row.closedAfterTap = !(await isOpen(page));

    // --- test 2: a drag that begins on the backdrop ------------------------
    await openMap(page);
    const dragAt = gestureClock();
    await touch(cdp, 'touchStart', [bd], dragAt());
    for (let i = 1; i <= 8; i += 1) {
      await touch(cdp, 'touchMove', [{ x: bd.x + i * 9, y: bd.y + i * 4 }], dragAt(16));
    }
    await touch(cdp, 'touchEnd', [], dragAt(16));
    await page.waitForTimeout(300);
    row.survivedBackdropDrag = await isOpen(page);
  } else {
    // Phone portrait is full-bleed: there is no backdrop, which is exactly why
    // the hint must not tell a child to tap outside. The close path there is
    // the cross, so that is what gets demonstrated instead.
    row.closedOnPointerDown = null;
    row.closedAfterTap = null;
    row.survivedBackdropDrag = null;
    const cross = await page.evaluate(() => {
      const r = document.querySelector('.parkmap-card .shop-close')?.getBoundingClientRect();
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    });
    if (cross) {
      const at = gestureClock();
      await touch(cdp, 'touchStart', [cross], at());
      await touch(cdp, 'touchEnd', [], at(80));
      await page.waitForTimeout(300);
      row.closedByCross = !(await isOpen(page));
    }
  }

  // --- test 4: tap-to-walk on the canvas still fires -----------------------
  // The canvas tap gained a 600 ms window with the shared definition; this is
  // the regression guard that a definite tap on open lawn still commits the
  // walk (which closes the map) rather than being rejected as a long press.
  await openMap(page);
  const s4 = await mapState(page);
  const walkAt = gestureClock();
  const spot = { x: s4.canvas.x + s4.canvas.w / 2, y: s4.canvas.y + s4.canvas.h / 2 };
  await touch(cdp, 'touchStart', [spot], walkAt());
  await touch(cdp, 'touchEnd', [], walkAt(90));
  await page.waitForTimeout(400);
  row.canvasTapActed = !(await isOpen(page));

  // --- test 3: pinch on the canvas ----------------------------------------
  await openMap(page);
  const s2 = await mapState(page);
  const c = s2.canvas;
  const ccx = c.x + c.w / 2;
  const ccy = c.y + c.h / 2;
  const zoomBefore = s2.zoom;
  const pinchAt = gestureClock();
  await touch(
    cdp,
    'touchStart',
    [
      { x: ccx - 30, y: ccy },
      { x: ccx + 30, y: ccy },
    ],
    pinchAt(),
  );
  for (let i = 1; i <= 12; i += 1) {
    const spread = 30 + i * 10;
    await touch(
      cdp,
      'touchMove',
      [
        { x: ccx - spread, y: ccy },
        { x: ccx + spread, y: ccy },
      ],
      pinchAt(20),
    );
  }
  await touch(cdp, 'touchEnd', [{ x: ccx + 150, y: ccy }], pinchAt(20));
  await touch(cdp, 'touchEnd', [], pinchAt(20));
  await page.waitForTimeout(300);
  const s3 = await mapState(page);
  row.pinchKeptOpen = s3.open;
  row.pinchZoom = `${zoomBefore.toFixed(2)}->${s3.zoom.toFixed(2)}`;
  row.zoomedLabels = `${s3.labels}/${s3.features}`;
  await page.screenshot({ path: `${outDir}/${tag}-${size.name}-pinched.png` });

  row.errors = errors.length;
  if (errors.length) console.error(`page errors on ${size.name}:`, errors.slice(0, 3));
  rows.push(row);
  await context.close();
}

await browser.close();
console.log(JSON.stringify(rows, null, 2));
for (const r of rows) {
  console.log(
    `${r.size.padEnd(16)} canvas ${String(r.canvas).padEnd(9)} labels ${r.labels.padEnd(6)}` +
      ` backdrop ${String(r.backdrop).padEnd(24)}` +
      ` closedOnDown ${String(r.closedOnPointerDown).padEnd(5)}` +
      ` closedAfterTap ${String(r.closedAfterTap).padEnd(5)}` +
      ` dragKeptOpen ${String(r.survivedBackdropDrag).padEnd(5)}` +
      ` pinchOpen ${String(r.pinchKeptOpen).padEnd(5)} zoom ${r.pinchZoom}` +
      ` cross ${String(r.closedByCross ?? 'n/a').padEnd(5)} canvasTap ${String(r.canvasTapActed).padEnd(5)}` +
      ` errors ${r.errors}`,
  );
}
