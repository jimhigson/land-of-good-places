/**
 * TEMPORARY prototype harness — not a check, not committed to `main` intent.
 * Shoots every beat of the arrival at Jim's own 2000x1100, frozen, so the
 * shot can be judged by eye instead of by numbers.
 *
 *   node --import ./scripts/ts-extension-resolver-register.mjs \
 *     scripts/tmp-arrival-frames.mts <label>
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.ARRIVAL_BASE ?? 'http://127.0.0.1:5641';
const LABEL = process.argv[2] ?? 'run';
const OUT = process.env.ARRIVAL_OUT ?? '/tmp/arrival-frames';
mkdirSync(OUT, { recursive: true });

const BEATS = (process.env.ARRIVAL_BEATS ?? 'rolling-in,doors-opening,stepping-down,walking-in,park').split(',');

const FREEZE = `
let _g;
Object.defineProperty(window, 'game', {
  configurable: true,
  get() { return _g; },
  set(v) { _g = v; window.__g = v; try { v.timeScale = 0; } catch (e) {} }
});`;

const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  for (const beat of BEATS) {
    const context = await browser.newContext({ viewport: { width: 2000, height: 1100 } });
    const page = await context.newPage();
    await page.addInitScript(FREEZE);
    await page.goto(`${BASE}/arrive?at=${beat}`, { waitUntil: 'domcontentloaded' });
    // Click through the title if it is there.
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
    // Let a couple of frames render at the beat, then hold.
    await page.evaluate(async () => {
      const g = (window as any).__g;
      g.timeScale = 0.02;
      await new Promise((r) => setTimeout(r, 700));
      g.timeScale = 0;
    });
    const state = await page.evaluate(() => {
      const g = (window as any).__g;
      const a = g.world.entrance.arrival;
      const c = g.camera.camera;
      const p = g.player.position;
      return {
        t: +a.elapsed.toFixed(2),
        phase: a.phase,
        type: c.type,
        fov: c.fov === undefined ? null : +c.fov.toFixed(1),
        zoom: +c.zoom.toFixed(3),
        eyeToPlayer: +Math.hypot(c.position.x - p.x, c.position.y - p.y, c.position.z - p.z).toFixed(2),
        eyeY: +c.position.y.toFixed(2),
        playerY: +p.y.toFixed(2),
      };
    });
    const file = `${OUT}/${LABEL}-${beat}.png`;
    await page.screenshot({ path: file });
    console.log(`${beat}: t=${state.t} ${state.phase} ${state.type} fov=${state.fov} zoom=${state.zoom} eye->player=${state.eyeToPlayer}m eyeY=${state.eyeY} -> ${file}`);
    await context.close();
  }
} finally {
  await browser.close();
}
