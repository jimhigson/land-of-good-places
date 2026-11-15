// node tap.mjs <base> <zoneId> <outPrefix>
// Stands her at the zone's stand point facing it, clicks the target on screen
// with the real mouse, reads the selection and the outline, then presses the
// zone's first action and waits for it to open. Screenshots at each step.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('playwright-core');
const [base, zoneId, outPrefix] = process.argv.slice(2);
const hl = JSON.parse(fs.readFileSync(process.env.HL ?? 'hl-branch.json'));
const z = hl[zoneId];
if (!z) throw new Error(`no zone ${zoneId}`);
const [x0, y0, z0, x1, y1, z1] = z.box;
const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
const [sx, sz] = z.stand;
const facing = (Math.atan2(cx - sx, cz - sz) * 180) / Math.PI;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ channel: 'chromium', headless: true, timeout: 900000, args: ['--mute-audio', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, serviceWorkers: 'block' })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
await page.goto(`${base}/spawn?seed=5&perf=1&pos=${sx.toFixed(2)},${sz.toFixed(2)}&facing=${facing.toFixed(1)}`, { waitUntil: 'domcontentloaded', timeout: 600000 });
for (const t0 = Date.now(); ; ) {
  if (await page.evaluate(() => !!window.game && (window.__perf?.frameCount ?? 0) > 60).catch(() => false)) break;
  if (Date.now() - t0 > 1800000) throw new Error('never settled');
  await sleep(500);
}
await sleep(2500);
// Where the target's middle is on screen, through the game's own camera.
const at = await page.evaluate(([x, y, z]) => {
  const game = window.game;
  const camera = game.cameraOverride ?? game.camera.camera;
  camera.updateMatrixWorld(true);
  const v = game.player.position.clone().set(x, y, z).project(camera);
  return { px: ((v.x + 1) / 2) * window.innerWidth, py: ((1 - v.y) / 2) * window.innerHeight, onScreen: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z < 1 };
}, [cx, (y0 + y1) / 2, cz]);
await page.mouse.click(at.px, at.py);
await sleep(1200);
const selected = await page.evaluate(() => {
  const game = window.game;
  let shells = 0;
  game.engine.scene.traverse((o) => {
    if (o.isMesh && o.visible && o.material?.name !== undefined && /rainbow|highlight/i.test(`${o.name} ${o.material.name} ${o.parent?.name ?? ''}`)) shells += 1;
  });
  return { selected: game.selection.selected?.id ?? null, actions: game.selection.actions.map((a) => a.id), inReach: game.selection.inReach, highlightMeshes: shells };
});
await page.screenshot({ path: `${outPrefix}-selected.png` });
let opened = null;
if (selected.selected === zoneId && selected.actions.length > 0) {
  await page.evaluate(() => window.game.selection.commit(window.game.selection.actions[0]));
  for (const t0 = Date.now(); Date.now() - t0 < 60000; ) {
    opened = await page.evaluate(() => {
      const game = window.game;
      const w = game.world;
      return {
        riding: game.player.riding === true,
        keychainOpen: w.keychainShop?.open === true,
        facePaintUi: w.facePaintStall?.uiOpen === true,
        miniGame: !!game.miniGames?.game,
        overlays: [...document.querySelectorAll('.shop-close, .facepaint-panel, [class*="facepaint"], [class*="panel"]')].filter((e) => e.offsetParent !== null).length,
      };
    });
    if (opened.riding || opened.keychainOpen || opened.facePaintUi || opened.miniGame) break;
    await sleep(500);
  }
  await sleep(2500);
  await page.screenshot({ path: `${outPrefix}-opened.png` });
}
await browser.close();
console.log(JSON.stringify({ zoneId, click: at, ...selected, opened, errors: errors.slice(0, 3) }));
