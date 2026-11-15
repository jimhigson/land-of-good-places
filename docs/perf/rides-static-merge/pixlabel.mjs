// node pixlabel.mjs <base> <path>
// Which batches the differing pixels belong to: with every batch handed back
// to its sources, turn on one area's batches at a time (by label) and count
// the pixels that change. Dev server, frozen ?clock= moment.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('playwright-core');
const [base, urlPath] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--mute-audio', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, serviceWorkers: 'block' })).newPage();
await page.goto(`${base}${urlPath}${urlPath.includes('?') ? '&' : '?'}perf=1`, { waitUntil: 'domcontentloaded', timeout: 600000 });
const riding = /^\/(rail-race|sky-cruiser|slide|ferris)/.test(urlPath);
for (const t0 = Date.now(); ; ) {
  const ok = await page.evaluate((riding) => { const p = window.__perf; if (!p || p.frameCount < 10 || !window.game) return false; const c = p.context(); return (!riding || c.riding === true) && (!c.clock || c.clock.stopped); }, riding).catch(() => false);
  if (ok) break;
  if (Date.now() - t0 > 1800000) throw new Error('never settled');
  await sleep(500);
}
await sleep(1500);
const r = await page.evaluate(async () => {
  const mod = await import('/src/world/staticBatch.ts');
  const game = window.game;
  const scene = game.engine.scene;
  const gl = game.engine.renderer.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const now = performance.now();
  performance.now = () => now;
  const grab = () => { game.render(); game.render(); const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
  const differ = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++; return n; };
  const batches = [];
  scene.traverse((o) => { if (mod.batchRecordOf(o)) batches.push(o); });
  const labels = [...new Set(batches.map((b) => mod.batchRecordOf(b).label))];
  mod.setStaticBatchesDrawn(scene, false);
  for (let i = 0; i < 4; i++) game.render();
  const sources = grab();
  const out = {};
  // One label at a time: its batches drawing, everything else drawing itself.
  const BATCH = Symbol.for('lgp.staticBatch');
  const standAll = (list, drawn) => {
    for (const b of list) {
      const rec = b[BATCH];
      rec.drawn = drawn; b.visible = drawn;
      for (const s of rec.sources) {
        if (drawn) { s.mesh.layers.set(30); if (s.detached) s.parent.remove(s.mesh); }
        else { s.mesh.layers.set(0); if (s.detached && s.mesh.parent !== s.parent) s.parent.add(s.mesh); }
      }
    }
  };
  for (const label of labels) {
    const mine = batches.filter((b) => mod.batchRecordOf(b).label === label);
    standAll(mine, true);
    out[label] = { pixels: differ(grab(), sources), batches: mine.length, folded: mine.filter((b) => mod.batchRecordOf(b).folded).length };
    standAll(mine, false);
  }
  mod.setStaticBatchesDrawn(scene, true);
  return out;
});
await browser.close();
for (const [label, v] of Object.entries(r).sort((a, b) => b[1].pixels - a[1].pixels)) console.log(label.padEnd(26), JSON.stringify(v));
