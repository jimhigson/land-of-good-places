/**
 * Drives drag-to-look-around (#419) with real CDP touch and mouse input at two
 * viewports, traces the camera, and screenshots. Not part of the build.
 *
 *   node qa-look-around.mjs <port> <outDir>
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const port = process.argv[2] ?? '5422';
const outDir = process.argv[3] ?? 'qa-out';
mkdirSync(outDir, { recursive: true });

const SIZES = [
  { name: 'phone-portrait', width: 390, height: 844, touch: true },
  { name: 'desktop', width: 1440, height: 900, touch: false },
];

const URL = `http://127.0.0.1:${port}/spawn?pos=0,-18&facing=0`;

const browser = await chromium.launch();
const rows = [];

const state = (page) =>
  page.evaluate(() => {
    const g = window.game;
    if (!g) return null;
    const f = g.camera.focusPoint;
    const p = g.player.position;
    return {
      look: g.camera.lookDistance,
      idle: g.camera.lookIdle,
      focus: [Number(f.x.toFixed(3)), Number(f.z.toFixed(3))],
      player: [Number(p.x.toFixed(3)), Number(p.z.toFixed(3))],
    };
  });

for (const size of SIZES) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    hasTouch: size.touch,
    isMobile: size.touch,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error(`[${size.name}] PAGE ERROR`, e.message));
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.game, null, { timeout: 45000 });
  await page.waitForTimeout(2500);

  const cx = Math.round(size.width / 2);
  const cy = Math.round(size.height / 2);

  const before = await state(page);
  await page.screenshot({ path: `${outDir}/${size.name}-1-before.png` });

  // ---- a real drag, in many small steps, exactly as a finger produces ----
  const DX = Math.round(size.width * 0.3);
  const DY = Math.round(size.height * 0.18);
  if (size.touch) {
    const client = await context.newCDPSession(page);
    const send = (type, x, y) =>
      client.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
      });
    await send('touchStart', cx, cy);
    for (let i = 1; i <= 24; i += 1) {
      await send('touchMove', cx - (DX * i) / 24, cy - (DY * i) / 24);
      await page.waitForTimeout(12);
    }
    await send('touchEnd', cx - DX, cy - DY);
  } else {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 24; i += 1) {
      await page.mouse.move(cx - (DX * i) / 24, cy - (DY * i) / 24);
      await page.waitForTimeout(12);
    }
    await page.mouse.up();
  }
  await page.waitForTimeout(120);

  const dragged = await state(page);
  await page.screenshot({ path: `${outDir}/${size.name}-2-dragged.png` });

  // ---- it holds for the delay ----
  await page.waitForTimeout(18000);
  const holding = await state(page);
  await page.screenshot({ path: `${outDir}/${size.name}-3-holding.png` });

  // ---- and then comes home ----
  await page.waitForTimeout(45000);
  const home = await state(page);
  await page.screenshot({ path: `${outDir}/${size.name}-4-home.png` });

  // ---- a tap still walks her ----
  const walkX = cx + Math.round(size.width * 0.18);
  const walkY = cy - Math.round(size.height * 0.1);
  const beforeTap = await state(page);
  if (size.touch) {
    const client = await context.newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: walkX, y: walkY }],
    });
    await page.waitForTimeout(60);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.click(walkX, walkY, { delay: 60 });
  }
  await page.waitForTimeout(20000);
  const afterTap = await state(page);
  await page.screenshot({ path: `${outDir}/${size.name}-5-tapped-and-walked.png` });

  const walked = Math.hypot(
    afterTap.player[0] - beforeTap.player[0],
    afterTap.player[1] - beforeTap.player[1],
  );
  const draggedWalk = Math.hypot(
    dragged.player[0] - before.player[0],
    dragged.player[1] - before.player[1],
  );

  rows.push({
    viewport: size.name,
    input: size.touch ? 'touch (CDP)' : 'mouse',
    'drag px': `${-DX},${-DY}`,
    'look m after drag': dragged.look.toFixed(2),
    'player moved by drag (m)': draggedWalk.toFixed(4),
    'look m at 2.5s idle': holding.look.toFixed(2),
    'look m at 6.5s idle': home.look.toFixed(3),
    'player walked on tap (m)': walked.toFixed(2),
  });

  await page.close();
  await context.close();
}

await browser.close();
console.table(rows);
