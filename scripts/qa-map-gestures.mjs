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

const touch = (cdp, type, points) =>
  cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 12, radiusY: 12, force: 1 })),
  });

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
    // --- test 1: definite tap on the backdrop ------------------------------
    await touch(cdp, 'touchStart', [bd]);
    await page.waitForTimeout(80);
    row.closedOnPointerDown = !(await isOpen(page));
    await touch(cdp, 'touchEnd', []);
    await page.waitForTimeout(200);
    row.closedAfterTap = !(await isOpen(page));

    // --- test 2: a drag that begins on the backdrop ------------------------
    await openMap(page);
    await touch(cdp, 'touchStart', [bd]);
    for (let i = 1; i <= 8; i += 1) {
      await touch(cdp, 'touchMove', [{ x: bd.x + i * 9, y: bd.y + i * 4 }]);
      await page.waitForTimeout(16);
    }
    await touch(cdp, 'touchEnd', []);
    await page.waitForTimeout(250);
    row.survivedBackdropDrag = await isOpen(page);
  } else {
    row.closedOnPointerDown = null;
    row.closedAfterTap = null;
    row.survivedBackdropDrag = null;
  }

  // --- test 3: pinch on the canvas ----------------------------------------
  await openMap(page);
  const s2 = await mapState(page);
  const c = s2.canvas;
  const ccx = c.x + c.w / 2;
  const ccy = c.y + c.h / 2;
  const zoomBefore = s2.zoom;
  await touch(cdp, 'touchStart', [
    { x: ccx - 30, y: ccy },
    { x: ccx + 30, y: ccy },
  ]);
  for (let i = 1; i <= 12; i += 1) {
    const spread = 30 + i * 10;
    await touch(cdp, 'touchMove', [
      { x: ccx - spread, y: ccy },
      { x: ccx + spread, y: ccy },
    ]);
    await page.waitForTimeout(20);
  }
  await touch(cdp, 'touchEnd', [{ x: ccx + 150, y: ccy }]);
  await page.waitForTimeout(60);
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(250);
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
      ` pinchOpen ${String(r.pinchKeptOpen).padEnd(5)} zoom ${r.pinchZoom} errors ${r.errors}`,
  );
}
