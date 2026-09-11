/**
 * TEMPORARY prototype sweep — boots ONE beat, then drives the camera directly
 * through many (yaw, frame height, distance) looks and screenshots each.
 *
 * The point is speed: a boot costs ~22 s, so rebuilding the app per candidate
 * makes iteration hopeless. This releases the arrival's own camera claim and
 * then poses the rig by hand, which is exactly what the shot would do.
 *
 *   node --import ./scripts/ts-extension-resolver-register.mjs \
 *     scripts/tmp-arrival-sweep.mts <beat> <label>
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.ARRIVAL_BASE ?? 'http://127.0.0.1:5641';
const BEAT = process.argv[2] ?? 'stepping-down';
const LABEL = process.argv[3] ?? 'sweep';
const OUT = process.env.ARRIVAL_OUT ?? '/tmp/arrival-frames';
mkdirSync(OUT, { recursive: true });

/** `yaw` is an offset from the rig's own CAMERA_YAW_DEGREES. */
type Look = { name: string; yawOffset: number; frameH: number; distance: number; pitch?: number; fov?: number };
const LOOKS: Look[] = JSON.parse(process.env.ARRIVAL_LOOKS ?? '[]');

const FREEZE = `
let _g;
Object.defineProperty(window, 'game', {
  configurable: true,
  get() { return _g; },
  set(v) { _g = v; window.__g = v; try { v.timeScale = 0; } catch (e) {} }
});`;

const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 2000, height: 1100 } });
  const page = await context.newPage();
  await page.addInitScript(FREEZE);
  await page.goto(`${BASE}/arrive?at=${BEAT}${process.env.ARRIVAL_PROJECTION ? '&projection=' + process.env.ARRIVAL_PROJECTION : ''}`, { waitUntil: 'domcontentloaded' });
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
    g.timeScale = 0.02;
    await new Promise((r) => setTimeout(r, 700));
    g.timeScale = 0;
    // Hand the camera over: the arrival stops re-asserting its own shot every
    // frame, so a hand-posed override sticks instead of being damped back.
    g.arrivalCameraReleased = true;
    await new Promise((r) => setTimeout(r, 300));
  });

  for (const look of LOOKS) {
    const applied = await page.evaluate(
      ({ yawOffset, frameH, distance, pitch, fov, rigYaw, rigPitch, viewHeight }) => {
        const g = (window as any).__g;
        g.camera.snapShotOverride(rigYaw + yawOffset, pitch ?? rigPitch, distance);
        g.camera.snapZoomTarget(viewHeight / frameH);
        const c = g.camera.camera;
        // Perspective only: the rig derives fov from CAMERA_DISTANCE, which is a
        // 9.53-degree telephoto. Set the lens by hand so the sweep can try real ones.
        if (fov !== undefined && c.isPerspectiveCamera) { c.fov = fov; c.updateProjectionMatrix(); }
        return { type: c.type, fov: c.fov ?? null };
      },
      { ...look, rigYaw: 45, rigPitch: 38, viewHeight: 15 },
    );
    void applied;
    await page.waitForTimeout(250);
    const file = `${OUT}/${LABEL}-${BEAT}-${look.name}.png`;
    await page.screenshot({ path: file });
    console.log(`${look.name}: yaw+${look.yawOffset} pitch=${look.pitch ?? 38} dist=${look.distance} fov=${(applied as any).fov?.toFixed?.(1)} (${(applied as any).type}) -> ${file}`);
  }
} finally {
  await browser.close();
}
