// node hl.mjs <base> <out.json>
// For every interact zone with a highlight: the pick box Selection uses
// (its own boundsFor) and the rainbow outline shell buildHighlightShell makes
// (vertex count, position checksum, radius). Run on two builds and compare:
// a batch must change neither. Dev server (window.game), park seed 5, ?clock=1.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('playwright-core');
const [base, out] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--mute-audio', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1, serviceWorkers: 'block' })).newPage();
await page.goto(`${base}/spawn?seed=5&clock=1&perf=1`, { waitUntil: 'domcontentloaded', timeout: 600000 });
for (const t0 = Date.now(); ; ) {
  const ok = await page.evaluate(() => { const p = window.__perf; if (!p || p.frameCount < 10 || !window.game) return false; const c = p.context(); return !c.clock || c.clock.stopped; }).catch(() => false);
  if (ok) break;
  if (Date.now() - t0 > 1800000) throw new Error('never settled');
  await sleep(500);
}
await sleep(1000);
const r = await page.evaluate(async () => {
  const { buildHighlightShell } = await import('/src/art/effects/rainbowOutline.ts');
  const game = window.game;
  const rows = {};
  for (const zone of game.world.interactZones()) {
    if (!zone.highlight || zone.highlight.instanceId !== undefined) continue;
    const object = zone.highlight.object;
    const box = game.selection.boundsFor(zone.highlight);
    const shell = buildHighlightShell(object);
    let sum = 0;
    let n = 0;
    if (shell) {
      const p = shell.geometry.getAttribute('position');
      n = p.count;
      for (let i = 0; i < p.array.length; i += 1) sum += p.array[i] * ((i % 7) + 1);
    }
    const r6 = (v) => Math.round(v * 1e6) / 1e6;
    rows[zone.id] = {
      object: object.name || object.type,
      box: box ? [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].map(r6) : null,
      shellVertices: n,
      shellChecksum: r6(sum),
      shellRadius: shell ? r6(shell.radius) : null,
      stand: [r6(zone.standX), r6(zone.standZ)],
    };
  }
  return rows;
});
await browser.close();
fs.writeFileSync(out, JSON.stringify(r, null, 1));
console.log(Object.keys(r).length, 'zones written to', out);
