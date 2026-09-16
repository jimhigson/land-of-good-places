/** TEMPORARY: what projection is the arrival camera actually using, per beat, per URL? */
import { chromium } from 'playwright-core';

const BASE = process.env.ARRIVAL_BASE ?? 'http://127.0.0.1:5641';
const FREEZE = `
let _g;
Object.defineProperty(window, 'game', {
  configurable: true, get() { return _g; },
  set(v) { _g = v; window.__g = v; try { v.timeScale = 0; } catch (e) {} }
});`;

const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  for (const url of ['/arrive?at=rolling-in', '/arrive?at=rolling-in&projection=perspective',
                     '/arrive?at=stepping-down&projection=perspective',
                     '/arrive?at=park&projection=perspective']) {
    const context = await browser.newContext({ viewport: { width: 2000, height: 1100 } });
    const page = await context.newPage();
    await page.addInitScript(FREEZE);
    await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' });
    for (let i = 0; i < 60; i += 1) {
      const clicked = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => /Go to the park/.test(x.textContent ?? ''));
        if (b) { (b as HTMLButtonElement).click(); return true; }
        return false;
      });
      if (clicked) break;
      await page.waitForTimeout(250);
    }
    await page.waitForFunction(() => !!(window as any).__g, undefined, { timeout: 180000 });
    await page.evaluate(async () => {
      const g = (window as any).__g;
      g.timeScale = 0.02; await new Promise((r) => setTimeout(r, 700)); g.timeScale = 0;
    });
    const s = await page.evaluate(() => {
      const g = (window as any).__g;
      const c = g.camera.camera;
      const a = g.world.entrance.arrival;
      const p = g.player.position;
      return {
        t: +a.elapsed.toFixed(2), phase: a.phase,
        type: c.type, fov: c.fov ?? null, near: c.near, far: c.far, zoom: +c.zoom.toFixed(3),
        eyeToPlayer: +Math.hypot(c.position.x - p.x, c.position.y - p.y, c.position.z - p.z).toFixed(2),
      };
    });
    console.log(`${url}\n   ${JSON.stringify(s)}`);
    await context.close();
  }
} finally { await browser.close(); }
