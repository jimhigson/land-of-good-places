/**
 * Raw trace: click twice on the path, then print her position every 700 ms for
 * a minute. Answers "is she walking, or is this NPC jostle?" without deriving
 * anything.
 *
 *   node qa-walk-trace.mjs <port> <w> <h> <touch:0|1>
 */
import { chromium } from 'playwright-core';

const port = process.argv[2] ?? '5422';
const width = Number(process.argv[3] ?? 1440);
const height = Number(process.argv[4] ?? 900);
const touch = (process.argv[5] ?? '0') === '1';

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width, height },
  hasTouch: touch,
  isMobile: touch,
});
const page = await context.newPage();
page.on('pageerror', (e) => console.error('PAGE ERROR', e.message));
await page.goto(`http://127.0.0.1:${port}/spawn?pos=0,-18&facing=0`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.game, null, { timeout: 60000 });
await page.waitForTimeout(3000);

const client = await context.newCDPSession(page);
const read = () =>
  page.evaluate(() => {
    const g = window.game;
    const p = g.player.position;
    const v = g.player.velocity;
    return {
      p: [Number(p.x.toFixed(2)), Number(p.z.toFixed(2))],
      speed: Number(Math.hypot(v.x, v.z).toFixed(2)),
    };
  });

const tap = async (x, y) => {
  if (touch) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await page.waitForTimeout(80);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.click(x, y, { delay: 80 });
  }
};

const x = Math.round(width * 0.57);
const y = Math.round(height * 0.33);
console.log(`start ${JSON.stringify(await read())}, tapping (${x}, ${y}) twice`);
await tap(x, y);
await page.waitForTimeout(1500);
await tap(x, y);

for (let i = 0; i < 60; i += 1) {
  await page.waitForTimeout(700);
  const r = await read();
  console.log(`${(i * 0.7).toFixed(1)}s  pos=${JSON.stringify(r.p)}  speed=${r.speed}`);
}
await browser.close();
